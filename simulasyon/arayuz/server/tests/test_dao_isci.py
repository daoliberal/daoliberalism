"""T6a: DAO oyunu, işçi protokolü (`karar` komutu), hafta paketinde `dao` gözlemi, önden hesapsız zamanlama, sonuç kaydı ve bitiş kancası.

Gerçek model (süreç içi işçi, kısa süreler) protokol ve gözlem biçimini sınar; sahte host (FakeHost) zamanlamayı hızlı ve belirlenimli sınar.
Sahte saat + elle `pump` (test_manager tabanı).
"""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path

from oyun_server.registry.resolve import DURATIONS, run_overrides
from oyun_server.registry.schema import RunConfigError
from oyun_server.runs import disk
from oyun_server.runs.manager import DaoFinished, NotDao, RunManager
from oyun_server.testing import InProcWorker

from tests.registry_helpers import real_registry
from tests.route_helpers import call, live_app
from tests.test_manager import CONFIG, FakeClock, ManagerBase, make_cfg

DAO = dict(CONFIG, mode="dao")
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "wire_contract.json").read_text(encoding="utf-8"))
KURUCU_PAKET_ANAHTARLARI = {"v", "run_id", "week", "version", "world", "events", "cities", "chain", "holdings", "kurumlar", "ekonomi", "makro", "diagnostics"}


def dao_overrides() -> dict:
    ov = run_overrides(real_registry(), CONFIG)
    ov["HUMAN_ON"] = 1
    ov["HUMAN_LONCA"] = 1                                         # yonetici DAO kipinde ikisini birlikte verir
    ov["FIRM_LIFE_LOG"] = 1                                       # F4: DAO kipinde firma yasam kaydi acik (panoya batis nedeni, uyari, sektor egilimi)
    return ov


def sekil_farki(gercek, ornek, yol="$") -> list[str]:
    """Anahtar kümesi ve tür karşılaştırması (listeler: ikisi de doluysa her gerçek öğe örnek öğelerden birine uymalı; boş liste ve null serbest)."""
    if gercek is None or ornek is None:
        return []
    if isinstance(gercek, bool) != isinstance(ornek, bool):
        return ["%s: bool uyuşmazlığı" % yol]
    if isinstance(gercek, (int, float)) and isinstance(ornek, (int, float)):
        return []
    if isinstance(gercek, dict) and isinstance(ornek, dict):
        out = ["%s.%s: %s" % (yol, k, "yalnız gerçekte" if k in gercek else "yalnız örnekte") for k in sorted(set(gercek) ^ set(ornek))]
        for k in sorted(set(gercek) & set(ornek)):
            out += sekil_farki(gercek[k], ornek[k], "%s.%s" % (yol, k))
        return out
    if isinstance(gercek, list) and isinstance(ornek, list):
        if not gercek or not ornek:
            return []
        out = []
        for i, g in enumerate(gercek):
            denemeler = [sekil_farki(g, o, "%s[%d]" % (yol, i)) for o in ornek]
            if not any(not d for d in denemeler):
                out += denemeler[0]
        return out
    return [] if type(gercek) is type(ornek) else ["%s: %s != %s" % (yol, type(gercek).__name__, type(ornek).__name__)]


class Isci:
    """InProcWorker üstünde komut gönder / olay bekle yardımcısı (gerçek `Session`)."""

    def __init__(self, test: unittest.TestCase, overrides: dict, weeks: int = 10, host: str = "model", firms: bool = False):
        self.w = InProcWorker({"host": host, "overrides": overrides, "weeks": weeks})
        test.addCleanup(self.w.kill)
        self.olaylar: list[dict] = []
        self.w.send({"cmd": "init", "overrides": overrides, "weeks": weeks, "host": host, **({"firms": True} if firms else {})})

    def bekle(self, kosul, timeout: float = 60.0) -> dict:
        end = time.time() + timeout
        for ev in self.olaylar:
            if kosul(ev):
                return ev
        while time.time() < end:
            for ev in self.w.events(0.05):
                self.olaylar.append(ev)
                if kosul(ev):
                    return ev
            if self.w.eof:
                break
        raise AssertionError("olay gelmedi: %r" % (self.olaylar[-3:],))

    def hafta(self, n: int) -> dict:
        self.w.send({"cmd": "target", "week": n})
        return self.bekle(lambda e: e.get("ev") == "week" and e.get("week") == n)


class TestKararKomutu(unittest.TestCase):
    def test_karar_komutu_onay(self):
        i = Isci(self, dao_overrides())
        i.hafta(2)
        i.w.send({"cmd": "karar", "id": 7, "karar": {"tur": "cek", "miktar": 1.0}})
        ev = i.bekle(lambda e: e.get("ev") == "karar")
        self.assertEqual(ev, {"ev": "karar", "id": 7, "kabul": True, "hafta": 3})        # worker_week (2) + 1

    def test_karar_komutu_red(self):
        i = Isci(self, dao_overrides())
        i.hafta(1)
        i.w.send({"cmd": "karar", "id": 8, "karar": {"tur": "bilinmeyen"}})
        ev = i.bekle(lambda e: e.get("ev") == "karar")
        self.assertEqual((ev["id"], ev["kabul"], ev["kod"]), (8, False, "karar_gecersiz"))
        self.assertEqual(ev["fields"], ["tur"])
        i.w.send({"cmd": "karar", "id": 9, "karar": {"tur": "cek", "miktar": 1.0}})                  # red kuyruğu bozmadı
        self.assertTrue(i.bekle(lambda e: e.get("ev") == "karar" and e["id"] == 9)["kabul"])

    def test_nedenli_ret_alani_gecer(self):
        """Modelin nedenli ret öğesi (`{id, reason}`) dizgeye çevrilmeden iletilir; nedensiz alan dizge kalır."""
        i = Isci(self, dao_overrides())
        i.hafta(1)                                                   # oyuncu ahırda
        for n, (karar, alanlar) in enumerate((({"tur": "ayril"}, [{"id": "tur", "reason": "ahirda"}]),
                                              ({"tur": "basvur", "firma": "yok_firma"}, [{"id": "tur", "reason": "ahirda"}]),
                                              ({"tur": "cek"}, ["miktar"]))):
            i.w.send({"cmd": "karar", "id": 20 + n, "karar": karar})
            ev = i.bekle(lambda e, n=n: e.get("ev") == "karar" and e["id"] == 20 + n)
            self.assertEqual((ev["kabul"], ev["kod"], ev["fields"]), (False, "karar_gecersiz", alanlar), karar)
        i.w.send({"cmd": "karar", "id": 30, "karar": {"tur": "ahirdan_cik"}})
        self.assertTrue(i.bekle(lambda e: e.get("ev") == "karar" and e["id"] == 30)["kabul"])
        i.hafta(2)
        i.w.send({"cmd": "karar", "id": 31, "karar": {"tur": "ahirdan_cik"}})
        ev = i.bekle(lambda e: e.get("ev") == "karar" and e["id"] == 31)
        self.assertEqual(ev["fields"], [{"id": "tur", "reason": "ahirda_degil"}])
        i.w.send({"cmd": "karar", "id": 32, "karar": {"tur": "basvur", "firma": "yok_firma"}})
        self.assertEqual(i.bekle(lambda e: e.get("ev") == "karar" and e["id"] == 32)["fields"], ["firma"])

    def test_ayni_hafta_kodu_gecer(self):
        i = Isci(self, dao_overrides())
        i.hafta(1)
        i.w.send({"cmd": "karar", "id": 1, "karar": {"tur": "cek", "miktar": 1.0}})
        i.w.send({"cmd": "karar", "id": 2, "karar": {"tur": "cek", "miktar": 2.0}})
        self.assertTrue(i.bekle(lambda e: e.get("ev") == "karar" and e["id"] == 1)["kabul"])
        ev = i.bekle(lambda e: e.get("ev") == "karar" and e["id"] == 2)
        self.assertEqual((ev["kabul"], ev["kod"]), (False, "ayni_hafta"))

    def test_karar_kurucu_kosusunda_red(self):
        ov = run_overrides(real_registry(), CONFIG)                 # HUMAN_ON yok
        i = Isci(self, ov)
        i.hafta(1)
        i.w.send({"cmd": "karar", "id": 3, "karar": {"tur": "cek", "miktar": 1.0}})
        ev = i.bekle(lambda e: e.get("ev") == "karar")
        self.assertEqual((ev["kabul"], ev["kod"]), (False, "karar_gecersiz"))

    def test_bozuk_karar_komutu_ve_bilinmeyen_komut(self):
        i = Isci(self, dao_overrides())
        i.hafta(1)
        i.w.send({"cmd": "karar", "id": "x", "karar": {}})                   # kimlik sayı değil: bad_cmd (komut bozuk)
        self.assertEqual(i.bekle(lambda e: e.get("ev") == "failed")["error"], "bad_cmd")
        j = Isci(self, dao_overrides())
        j.hafta(1)
        j.w.send({"cmd": "bilinmeyen_komut"})                              # bilinmeyen komut koşuyu düşürmeye devam eder
        self.assertEqual(j.bekle(lambda e: e.get("ev") == "failed")["error"], "bad_cmd")

    def test_hafta_olayi_dao_gozlemi(self):
        i = Isci(self, dao_overrides())
        for n in (1, 2):
            ev = i.hafta(n)
            self.assertIsInstance(ev["dao"], dict)
            self.assertEqual(ev["dao"]["hafta"], n)
            self.assertEqual(set(ev["dao"]), {"hafta", "ben", "firmam", "kurabilir", "sektorler", "loncalar", "lonca_kur", "lonca_kur_ayrinti", "sehir", "tercih", "gecmis", "ilanlar", "olaylar"})

    def test_week0_dao_ready_firms_gercek_model(self):
        """T5b düzeltme 1: DAO işçisinin `ready` olayı hafta 0 firma anlık görüntüsünü taşır (oyuncu ilk paketten önce şehri görür)."""
        i = Isci(self, dao_overrides(), firms=True)
        r = i.bekle(lambda e: e.get("ev") == "ready")
        self.assertIsInstance(r.get("firms"), list)
        self.assertTrue(r["firms"])

    def test_kurucu_ready_firms_tasimaz(self):
        i = Isci(self, run_overrides(real_registry(), CONFIG), firms=True)
        self.assertNotIn("firms", i.bekle(lambda e: e.get("ev") == "ready"))

    def test_kurucu_hafta_olayi_dao_tasimaz(self):
        i = Isci(self, run_overrides(real_registry(), CONFIG))
        self.assertNotIn("dao", i.hafta(1))

    def test_gercek_gozlem_sekli_fikstur_ile_ayni(self):
        i = Isci(self, dao_overrides())
        ev = i.hafta(2)
        self.assertEqual(sekil_farki(ev["dao"], FIXTURE["packet_dao"]["dao"]), [])
        self.assertEqual(sekil_farki(ev["dao"], FIXTURE["dao_gozlem"]), [])


class TestGercekHostOlumKodu(unittest.TestCase):
    """F4: gercek host (ModelHost) firm_rows: FIRM_LIFE_LOG acikken olu firma `diedReason` = firm_log olum satiri; kapaliyken alan yok."""

    def _host(self, **ov):
        from oyun_server import config
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), dict(ov), 40, 2)
        self.addCleanup(h.close)
        return h

    def test_died_reason_ve_kapali_alan_yok(self):
        for acik in (1, 0):
            h = self._host(FIRM_LIFE_LOG=acik)
            for _ in range(3):
                h.step()
            W = h._W
            f = next(r for r, d in W.firms.items() if d["owner"] is None and d["kind"] == "firin" and not d.get("dead"))
            W.firms[f]["dead"], W.firms[f]["died"] = True, W.week_no
            W.week_no += 1
            if acik:
                h._mods["simkit.firm_log"].fl_week(W)
            rows = {r["id"]: r for r in h.firm_rows()}
            if acik:
                self.assertEqual(rows[f]["diedReason"], "diger")
                self.assertTrue(all(("diedReason" in r) == r["dead"] for r in rows.values()))
            else:
                self.assertTrue(all("diedReason" not in r for r in rows.values()))


class DaoBase(ManagerBase):
    """Sahte host (FlakyHost: `HUMAN_ON` ile sahte gözlem) + elle pump."""

    def create_dao(self, **kw):
        h = self.mgr.create(dict(DAO, **kw))
        return h["runId"], h

    def spesifik(self, rid):
        return self.mgr._runs[rid]

    def bekle_hafta(self, rid, n):
        self.pump_until(lambda: self.mgr.stats(rid)["released"] >= n)


class TestDaoKurulum(DaoBase):
    def test_dao_state_mode(self):
        m = self.make()
        rid, h = self.create_dao()
        self.assertEqual(h["state"]["mode"], "dao")
        self.assertEqual(m.get(rid)["state"]["mode"], "dao")
        kid, kh = self.new_run()
        self.assertNotIn("mode", kh["state"])                       # Kurucu durumu bugünküyle aynı: mode alanı yok
        kid2, kh2 = self.new_run(mode="kurucu")
        self.assertNotIn("mode", kh2["state"])
        self.assertNotIn("oyuncu", h["state"])

    def test_week0_dao_state_harita0_kurucuda_yok(self):
        """T5b düzeltme 1: DAO durumu ready'den sonra `harita0` (sıkıştırılmış harita, hafta 0) taşır; Kurucu durumunda alan yoktur."""
        m = self.make()
        rid, h = self.create_dao()
        self.pump_until(lambda: self.spesifik(rid).ready)
        st = m.get(rid)["state"]
        self.assertEqual(st["harita0"]["hafta"], 0)
        self.assertTrue(st["harita0"]["firmalar"])
        kid, _kh = self.new_run()
        self.pump_until(lambda: self.spesifik(kid).ready)
        self.assertNotIn("harita0", m.get(kid)["state"])

    def test_week0_dao_state_dao0_kurucuda_yok(self):
        """I-3: DAO durumu ready'den sonra `dao0` (hafta 0 gözlem paketi) taşır, ilk haftalık paketten önce üst metrikler dolar; Kurucu durumunda alan yoktur."""
        m = self.make()
        rid, h = self.create_dao()
        self.pump_until(lambda: self.spesifik(rid).ready)
        st = m.get(rid)["state"]
        self.assertEqual(st["dao0"]["hafta"], 0)
        self.assertIn("ben", st["dao0"])
        self.assertIn("ilanlar", st["dao0"])
        kid, _kh = self.new_run()
        self.pump_until(lambda: self.spesifik(kid).ready)
        self.assertNotIn("dao0", m.get(kid)["state"])

    def test_dao_varsayilan_sure_520(self):
        m = self.make()
        cfg = {k: v for k, v in DAO.items() if k != "durationWeeks"}
        h = m.create(cfg)
        self.assertEqual(h["state"]["durationWeeks"], 520)
        with self.assertRaises(RunConfigError):                    # Kurucu'da süre zorunlu kalır
            m.create({k: v for k, v in CONFIG.items() if k != "durationWeeks"})
        h2 = m.create(dict(DAO, durationWeeks=100))                # açık süre korunur
        self.assertEqual(h2["state"]["durationWeeks"], 100)

    def test_mode_gecersiz(self):
        m = self.make()
        with self.assertRaises(RunConfigError) as cm:
            m.create(dict(CONFIG, mode="oyun"))
        self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("mode", "invalid")])

    def test_human_on_yalniz_dao_icin(self):
        m = self.make()
        self.create_dao()
        self.until(lambda: len(self.hosts) == 1)                   # host işçi iş parçacığında kurulur
        self.assertEqual(self.hosts[-1]._initial.get("HUMAN_ON"), 1)
        self.assertEqual(self.hosts[-1]._initial.get("HUMAN_LONCA"), 1)      # F2: DAO kipinde lonca_sec açık
        self.assertEqual(self.hosts[-1]._initial.get("FIRM_LIFE_LOG"), 1)    # F4: DAO kipinde firma yaşam kaydı açık
        self.new_run()
        self.until(lambda: len(self.hosts) == 2)
        self.assertNotIn("HUMAN_ON", self.hosts[-1]._initial)
        self.assertNotIn("HUMAN_LONCA", self.hosts[-1]._initial)
        self.assertNotIn("FIRM_LIFE_LOG", self.hosts[-1]._initial)
        self.new_run(mode="kurucu")
        self.until(lambda: len(self.hosts) == 3)
        self.assertNotIn("HUMAN_ON", self.hosts[-1]._initial)

    def test_520_sure(self):
        self.assertIn(520, DURATIONS)
        m = self.make()
        h = m.create(dict(CONFIG, durationWeeks=520))              # Kurucu için de geçerli süre
        self.assertEqual(h["state"]["durationWeeks"], 520)
        self.assertNotIn("mode", h["state"])
        with live_app() as (srv, _a, _w):
            self.assertEqual(call(srv, "GET", "/api/info")[2]["durations"], [100, 200, 500, 520])
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(CONFIG, durationWeeks=520)})
            self.assertEqual(s, 201, b)
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(CONFIG, durationWeeks=521)})
            self.assertEqual(s, 422)

    def test_kosu_json_mode_ve_sonuc_alani(self):
        m = self.make()
        root = Path(tempfile.mkdtemp(prefix="dao-isci-"))
        self.addCleanup(shutil.rmtree, root, True)
        self.addCleanup(m.shutdown)                                 # önce koşular kapanır (son kosu.json yazımı), sonra klasör silinir
        m._disk = disk.DiskStore(root)
        rid, _ = self.create_dao()
        kid, _ = self.new_run()
        metas = {}
        for d in root.iterdir():
            k = json.loads((d / "kosu.json").read_text(encoding="utf-8"))
            metas[k["runId"]] = k
        self.assertEqual(metas[rid]["mode"], "dao")
        self.assertEqual(metas[kid]["mode"], "kurucu")
        self.assertNotIn("daoSonuc", metas[kid])


class TestDaoPaketi(DaoBase):
    def test_dao_her_hafta_paketinde_harita_var(self):
        """Gerçek işçi hattı: `ev["dao"]` firma kararından önce atanır, bu yüzden DAO'da her hafta paketi harita taşır."""
        m = self.make()
        rid, _ = self.create_dao()
        m.control(rid, "play", 16)
        self.bekle_hafta(rid, 5)
        m.control(rid, "pause")
        for p in m.weeks(rid, 1, 5):
            self.assertEqual(p["harita"]["hafta"], p["week"])
            self.assertTrue(p["harita"]["firmalar"])
            self.assertEqual(len(p["harita"]["firmalar"][0]), 8)
            self.assertEqual(p["harita"]["alanlar"][0], "id")

    def test_paket_dao_alani(self):
        m = self.make()
        rid, _ = self.create_dao()
        m.control(rid, "play", 16)
        self.bekle_hafta(rid, 5)
        m.control(rid, "pause")
        paketler = m.weeks(rid, 1, 5)
        self.assertTrue(paketler)
        for p in paketler:
            self.assertIsInstance(p["dao"], dict, p["week"])
            self.assertEqual(p["dao"]["hafta"], p["week"])
            # Web "Ekonomi" penceresi (Kurucu Ayrıntılar, salt okunur) Kurucu ile aynı telemetriyi okur: göstergeler, şehir satırları, zincir, para dağılımı, tanılar.
            self.assertGreaterEqual(set(p), KURUCU_PAKET_ANAHTARLARI, p["week"])
            self.assertTrue(p["cities"] and p["chain"] and p["holdings"], p["week"])

    def test_kurucu_paketi_dao_tasimaz_ve_biçim_ayni(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.bekle_hafta(rid, 11)
        m.control(rid, "pause")
        for p in m.weeks(rid, 1, 11):
            self.assertNotIn("dao", p)
            self.assertEqual(set(p) - {"harita", "haritaFark"}, KURUCU_PAKET_ANAHTARLARI, p["week"])
            tam = p["week"] == 1 or p["week"] % 10 == 0
            self.assertEqual(("harita" in p, "haritaFark" in p), (tam, not tam), p["week"])      # Kurucu: tam harita 10 haftada bir, aradaki haftalarda hafif fark

    def test_kurucu_ve_acik_kurucu_paketleri_ayni(self):
        m = self.make()
        a, _ = self.new_run()
        b, _ = self.new_run(mode="kurucu")
        for rid in (a, b):
            m.control(rid, "play", 16)
        self.pump_until(lambda: all(m.stats(r)["released"] >= 4 for r in (a, b)))
        for rid in (a, b):
            m.control(rid, "pause")
        pa, pb = m.weeks(a, 1, 4), m.weeks(b, 1, 4)
        norm = lambda ps: [{k: v for k, v in p.items() if k != "run_id"} for p in ps]
        self.assertEqual(json.dumps(norm(pa), sort_keys=True), json.dumps(norm(pb), sort_keys=True))


class TestDaoZamanlama(DaoBase):
    def test_dao_onden_hesap_yok(self):
        m = self.make()
        rid, _ = self.create_dao()
        m.control(rid, "play", 16)
        farklar = set()
        end = time.time() + 30
        while time.time() < end and m.stats(rid)["released"] < 8:
            m.pump(self.clock())
            st = m.stats(rid)
            farklar.add(st["worker_week"] - st["released"])
            self.assertLessEqual(st["frontier"], st["released"] + 1)
            time.sleep(0.002)
        self.assertEqual(m.stats(rid)["released"] >= 8, True)
        self.assertTrue(farklar <= {0, 1}, farklar)
        m.control(rid, "pause")
        self.pump_until(lambda: m.stats(rid)["worker_week"] == m.stats(rid)["released"])
        st = m.stats(rid)
        self.assertEqual(st["worker_week"], st["released"])

    def test_kurucu_onden_hesabi_ayni(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 1)                                  # 2 sn aralık: ilk hafta henüz vadesinde değil
        self.assertEqual(m.stats(rid)["frontier"], 2)              # lookahead 2
        kid, _ = self.create_dao()
        m.control(kid, "play", 1)
        self.assertEqual(m.stats(kid)["frontier"], 1)              # DAO: yalnız released + 1

    def test_duraklatinca_hesaplanan_hafta_yayimlanir(self):
        m = self.make(gated=True)
        rid, _ = self.create_dao()
        m.control(rid, "play", 16)
        self.assertEqual(m.stats(rid)["frontier"], 1)
        m.control(rid, "pause")                                    # hafta 1 hesaplanıyor (kapıda)
        self.gate.release(1)
        self.pump_until(lambda: m.stats(rid)["released"] == 1)
        st = m.stats(rid)
        self.assertEqual((st["worker_week"], st["released"], st["buffered"]), (1, 1, 0))
        self.assertEqual(m.get(rid)["state"]["status"], "paused")
        for _ in range(20):                                        # durdu: yeni hafta istenmez
            m.pump(self.clock())
            time.sleep(0.002)
        st = m.stats(rid)
        self.assertEqual((st["worker_week"], st["released"], st["frontier"]), (1, 1, 1))

    def test_duraklatinca_tamponda_bekleyen_hafta_yayimlanir(self):
        m = self.make()
        rid, _ = self.create_dao()
        m.control(rid, "play", 1)                                  # sahte saat sabit: hafta vadesi gelmez, tamponda bekler
        self.pump_until(lambda: m.stats(rid)["worker_week"] == 1)
        self.assertEqual((m.stats(rid)["released"], m.stats(rid)["buffered"]), (0, 1))
        m.control(rid, "pause")
        self.pump_until(lambda: m.stats(rid)["released"] == 1)
        st = m.stats(rid)
        self.assertEqual((st["worker_week"], st["released"], st["buffered"]), (1, 1, 0))
        self.assertEqual(m.get(rid)["state"]["status"], "paused")

    def test_bos_duraklatma_hafta_uretmez(self):
        m = self.make()
        rid, _ = self.create_dao()
        m.control(rid, "pause")
        for _ in range(10):
            m.pump(self.clock())
            time.sleep(0.002)
        st = m.stats(rid)
        self.assertEqual((st["worker_week"], st["released"], st["frontier"]), (0, 0, 0))

    def test_tek_adim_bir_hafta(self):
        m = self.make()
        rid, _ = self.create_dao()
        m.control(rid, "step")
        self.bekle_hafta(rid, 1)
        for _ in range(10):
            m.pump(self.clock())
            time.sleep(0.002)
        st = m.stats(rid)
        self.assertEqual((st["worker_week"], st["released"]), (1, 1))

    def test_duraklat_sonra_oynat_devam(self):
        m = self.make()
        rid, _ = self.create_dao()
        m.control(rid, "play", 1)
        self.pump_until(lambda: m.stats(rid)["worker_week"] == 1)
        m.control(rid, "pause")
        self.bekle_hafta(rid, 1)
        m.control(rid, "play", 16)
        self.bekle_hafta(rid, 4)
        m.control(rid, "pause")
        self.pump_until(lambda: m.stats(rid)["worker_week"] == m.stats(rid)["released"])
        self.assertEqual([p["week"] for p in m.weeks(rid, 1, 99)], list(range(1, m.stats(rid)["released"] + 1)))


class TestDaoKarar(DaoBase):
    def kos(self, **kw):
        m = self.make()
        m.start_thread()
        rid, _ = self.create_dao(**kw)
        return m, rid

    def test_karar_yoneticisi_kabul_ve_hafta(self):
        m, rid = self.kos()
        m.control(rid, "step")
        self.bekle_hafta(rid, 1)
        st = m.stats(rid)
        self.assertEqual(st["worker_week"], st["released"])
        res = m.dao_karar(rid, {"tur": "cek", "miktar": 1.0})
        self.assertEqual(res, {"kabul": True, "hafta": st["worker_week"] + 1})

    def test_karar_yoneticisi_red_kodu(self):
        m, rid = self.kos()
        m.control(rid, "step")
        self.bekle_hafta(rid, 1)
        res = m.dao_karar(rid, {"tur": "yok"})
        self.assertEqual((res["kabul"], res["kod"]), (False, "karar_gecersiz"))
        self.assertEqual(res["fields"], ["tur"])
        self.assertTrue(m.dao_karar(rid, {"tur": "cek", "miktar": 1.0})["kabul"])
        self.assertEqual(m.dao_karar(rid, {"tur": "cek", "miktar": 2.0})["kod"], "ayni_hafta")

    def test_karar_uygulama_haftasi_duraklatilmis_kosuda_ertesi(self):
        m, rid = self.kos()
        m.control(rid, "play", 16)
        self.bekle_hafta(rid, 3)
        m.control(rid, "pause")
        self.pump_until(lambda: m.stats(rid)["worker_week"] == m.stats(rid)["released"])
        released = m.stats(rid)["released"]
        self.assertEqual(m.dao_karar(rid, {"tur": "cek", "miktar": 1.0})["hafta"], released + 1)

    def test_kurucu_kosusunda_dao_degil(self):
        m, rid = self.kos()
        kid, _ = self.new_run()
        with self.assertRaises(NotDao):
            m.dao_karar(kid, {"tur": "cek", "miktar": 1.0})

    def test_bitmis_kosuda_karar(self):
        m, rid = self.kos(durationWeeks=100)
        self.spesifik(rid).duration = 2
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended")
        with self.assertRaises(DaoFinished):
            m.dao_karar(rid, {"tur": "cek", "miktar": 1.0})

    def test_calisan_olurse_bekleyen_karar_biter(self):
        m = self.make()
        m.start_thread()
        rid, _ = self.create_dao()
        m.control(rid, "step")
        self.bekle_hafta(rid, 1)
        run = self.spesifik(rid)
        sonuc = []
        orijinal = run.worker.send
        yutulan = threading.Event()

        def yut(cmd):                                          # karar komutu işçiye hiç gitmez: yanıt gelmez
            if cmd.get("cmd") == "karar":
                yutulan.set()
                return
            orijinal(cmd)

        run.worker.send = yut
        t = threading.Thread(target=lambda: sonuc.append(self._dene(m, rid)), daemon=True)
        t.start()
        self.assertTrue(yutulan.wait(5))
        m.delete(rid)                                          # koşu silinir: bekleyen karar DaoFinished ile uyanır
        t.join(5)
        self.assertEqual(sonuc, ["DaoFinished"])

    @staticmethod
    def _dene(m, rid):
        try:
            m.dao_karar(rid, {"tur": "cek", "miktar": 1.0}, wait_s=30)
        except DaoFinished:
            return "DaoFinished"
        return "?"


class TestDaoSonuc(DaoBase):
    def _bitir(self, m, rid, hafta=3):
        self.spesifik(rid).duration = hafta
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=60)

    def _disk(self, m):
        root = Path(tempfile.mkdtemp(prefix="dao-isci-"))
        self.addCleanup(shutil.rmtree, root, True)
        self.addCleanup(m.shutdown)
        m._disk = disk.DiskStore(root)
        return root

    def test_sonuc_kaydi(self):
        m = self.make()
        root = self._disk(m)
        rid, _ = self.create_dao()
        self._bitir(m, rid)
        run_dir = next(p for p in root.iterdir() if p.is_dir())
        kosu = json.loads((run_dir / "kosu.json").read_text(encoding="utf-8"))
        son = m.weeks(rid, 3, 3)[0]
        self.assertEqual(kosu["daoSonuc"], son["dao"])
        self.assertEqual((kosu["status"], kosu["mode"], kosu["endReason"]), ("ended", "dao", "ended"))

    def test_dao_diske_firma_satiri_yalniz_1_10_katlari_ve_son_hafta(self):
        m = self.make()
        root = self._disk(m)
        rid, _ = self.create_dao()
        self._bitir(m, rid, 23)
        run_dir = next(p for p in root.iterdir() if p.is_dir())
        satirlar = [json.loads(x) for x in (run_dir / "firmalar.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
        self.assertEqual([x["week"] for x in satirlar], [1, 10, 20, 23])

    def test_dao_firmalar_jsonl_olu_firmada_died_reason(self):
        """F4: DAO kosusunda FIRM_LIFE_LOG acik; firmalar.jsonl'da olu firma `diedReason` (firm_log olum kodu) tasir, canli firma tasimaz."""
        m = self.make()
        root = self._disk(m)
        rid, _ = self.create_dao()
        self._bitir(m, rid, 23)
        run_dir = next(p for p in root.iterdir() if p.is_dir())
        satirlar = [json.loads(x) for x in (run_dir / "firmalar.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
        olu = [f for f in satirlar[-1]["firms"] if f["dead"]]
        self.assertTrue(olu)
        self.assertTrue(all(isinstance(f.get("diedReason"), str) and f["diedReason"] for f in olu))
        self.assertTrue(all("diedReason" not in f for f in satirlar[-1]["firms"] if not f["dead"]))

    def test_kurucu_kosusunda_dao_sonuc_yok(self):
        m = self.make()
        root = self._disk(m)
        rid, _ = self.new_run()
        self._bitir(m, rid)
        run_dir = next(p for p in root.iterdir() if p.is_dir())
        self.assertNotIn("daoSonuc", json.loads((run_dir / "kosu.json").read_text(encoding="utf-8")))

    def test_sonuc_yazilmadan_isci_kapanmaz(self):
        """`daoSonuc` işçi kapanmadan (`_retire`) önce yazılır: kosu.json'un son yazımı sonucu taşır."""
        m = self.make()
        root = self._disk(m)
        rid, _ = self.create_dao()
        sirasi = []
        asil = m._retire
        m._retire = lambda run, graceful: (sirasi.append(("retire", run.dao_sonuc is not None)), asil(run, graceful))[1]
        self._bitir(m, rid)
        self.assertEqual(sirasi, [("retire", True)])

    def test_on_dao_end_kancasi(self):
        cagrilar = []

        def kanca(run_id, sonuc, meta):
            cagrilar.append((run_id, sonuc, meta, m._lock._is_owned()))

        m = self.make()
        m._on_dao_end = kanca
        rid, _ = self.create_dao()
        kid, _ = self.new_run()
        self._bitir(m, kid)                                       # Kurucu: kanca çağrılmaz
        self.assertEqual(cagrilar, [])
        self._bitir(m, rid)
        self.assertEqual(len(cagrilar), 1)
        run_id, sonuc, meta, kilitli = cagrilar[0]
        self.assertEqual(run_id, rid)
        self.assertEqual(sonuc, m.weeks(rid, 3, 3)[0]["dao"])
        self.assertFalse(kilitli)                                 # kilit dışında
        self.assertEqual((meta["runId"], meta["mode"], meta["week"], meta["durationWeeks"]), (rid, "dao", 3, 3))
        m.pump(self.clock())
        self.assertEqual(len(cagrilar), 1)                        # bir kez

    def test_kanca_hatasi_kosuyu_dusurmez(self):
        m = self.make()
        m._on_dao_end = lambda *a: 1 / 0
        rid, _ = self.create_dao()
        with contextlib.redirect_stderr(io.StringIO()) as hata:
            self._bitir(m, rid)
        self.assertIn("ZeroDivisionError", hata.getvalue())               # iz yazıldı, koşu düşmedi
        self.assertEqual(m.get(rid)["state"]["status"], "ended")

    def test_kurucu_ctor_parametresi(self):
        cagrilar = []
        m = RunManager(real_registry(), lambda spec: None, clock=FakeClock(), cfg=make_cfg(), on_dao_end=lambda *a: cagrilar.append(a))
        self.managers.append(m)
        self.assertEqual(m._on_dao_end(1, 2, 3) or cagrilar, [(1, 2, 3)])


class TestDaoGercekModel(ManagerBase):
    """Gerçek model, süreç içi işçi: yönetici + işçi + model birlikte (kısa)."""

    def make_real(self):
        def factory(spec):
            w = InProcWorker(spec)
            self.workers.append(w)
            return w

        m = RunManager(real_registry(), factory, clock=self.clock, cfg=make_cfg())
        m.start_thread()
        self.managers.append(m)
        self.mgr = m
        return m

    def test_gercek_model_dao_kosusu(self):
        m = self.make_real()
        rid = m.create(DAO)["runId"]
        m.control(rid, "step")
        self.pump_until(lambda: m.stats(rid)["released"] >= 1, timeout=90)
        p = m.weeks(rid, 1, 1)[0]
        self.assertEqual(p["dao"]["hafta"], 1)
        self.assertEqual(sekil_farki(p["dao"], FIXTURE["packet_dao"]["dao"]), [])
        st = m.stats(rid)
        self.assertEqual(st["worker_week"], st["released"])
        res = m.dao_karar(rid, {"tur": "cek", "miktar": 1.0})
        self.assertEqual(res, {"kabul": True, "hafta": 2})
        m.control(rid, "step")
        self.pump_until(lambda: m.stats(rid)["released"] >= 2, timeout=90)
        self.assertEqual(m.dao_karar(rid, {"tur": "yok"})["kod"], "karar_gecersiz")
        olaylar = [o["tur"] for o in m.weeks(rid, 2, 2)[0]["dao"]["olaylar"]]
        self.assertIn("cekilemedi", olaylar)                     # birikim yok: çekim uygulandı ama çekilemedi

    def test_gercek_model_sonuc_3_hafta(self):
        m = self.make_real()
        root = Path(tempfile.mkdtemp(prefix="dao-isci-"))
        self.addCleanup(shutil.rmtree, root, True)
        self.addCleanup(m.shutdown)
        m._disk = disk.DiskStore(root)
        cagrilar = []
        m._on_dao_end = lambda *a: cagrilar.append(a)
        rid = m.create(DAO)["runId"]
        m._runs[rid].duration = 3
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=120)
        run_dir = next(p for p in root.iterdir() if p.is_dir())
        kosu = json.loads((run_dir / "kosu.json").read_text(encoding="utf-8"))
        self.assertEqual(kosu["daoSonuc"], m.weeks(rid, 3, 3)[0]["dao"])
        self.assertEqual(kosu["daoSonuc"]["hafta"], 3)
        self.assertEqual(len(cagrilar), 1)

    def test_kurucu_durumu_degismedi(self):
        m = self.make_real()
        h = m.create(CONFIG)
        self.assertNotIn("mode", h["state"])


if __name__ == "__main__":
    unittest.main()
