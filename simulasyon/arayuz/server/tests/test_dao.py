"""T6b: DAO uç noktaları (`GET /dao`, `POST /dao/karar`), `olay` eylemi, karar kaydı (`kararlar.jsonl`), kurucu yetkileri ve yeniden oynatma.

HTTP testleri sahte host'la (FakeHost: HUMAN_ON ile belirlenimli gözlem); yeniden oynatma gerçek modelle (süreç içi işçi, 12 hafta).
"""
from __future__ import annotations

import copy
import functools
import json
import shutil
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path

from oyun_server.runs import disk
from oyun_server.runs.manager import DaoPreparing, NotDao, RunManager
from oyun_server.testing import InProcWorker

from tests.registry_helpers import real_registry
from tests.route_helpers import CONFIG, call, live_app, make_cfg
from tests.test_manager import FakeClock, ManagerBase

DAO = dict(CONFIG, mode="dao")


def satirlar(klasor: Path) -> list[dict]:
    f = klasor / "kararlar.jsonl"
    if not f.exists():
        return []
    return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]


def kosu_klasoru(root: Path) -> Path:
    return next(p for p in root.iterdir() if p.is_dir())


class DaoHttpBase(unittest.TestCase):
    @contextmanager
    def uygulama(self):
        root = Path(tempfile.mkdtemp(prefix="dao-6b-"))
        self.addCleanup(shutil.rmtree, root, True)
        with live_app(cfg=make_cfg(MAX_RUNS=4)) as (srv, app, workers):
            app.manager._disk = disk.DiskStore(root)
            self.root, self.srv, self.app = root, srv, app
            yield srv, app, root

    def yarat(self, config_=None) -> str:
        s, _, b = call(self.srv, "POST", "/api/runs", {"config": config_ or DAO})
        self.assertEqual(s, 201, b)
        return b["runId"]

    def bekle(self, kosul, timeout=20.0):
        end = time.time() + timeout
        while time.time() < end:
            if kosul():
                return
            time.sleep(0.01)
        self.fail("koşul sağlanmadı")

    def durum(self, rid) -> dict:
        return call(self.srv, "GET", "/api/runs/" + rid)[2]["state"]

    def kontrol(self, rid, action, speed=None):
        body = {"action": action} if speed is None else {"action": action, "speed": speed}
        return call(self.srv, "POST", "/api/runs/%s/control" % rid, body)

    def adim(self, rid, n):
        """n. haftaya adım adım (duraklatılmış): yayımlanan hafta n ve işçinin haftası n olana dek."""
        for _ in range(n - self.durum(rid)["week"]):
            hedef = self.durum(rid)["week"] + 1
            self.kontrol(rid, "step")
            self.bekle(lambda: self.durum(rid)["week"] >= hedef)
        self.bekle(lambda: self.app.manager.stats(rid)["worker_week"] == self.durum(rid)["week"])

    def karar(self, rid, body):
        return call(self.srv, "POST", "/api/runs/%s/dao/karar" % rid, body)


class TestDaoUclari(DaoHttpBase):
    def test_dao_kosu(self):
        with self.uygulama() as (srv, app, _):
            rid = self.yarat()
            self.assertEqual(self.durum(rid)["mode"], "dao")
            self.assertEqual(self.durum(rid)["durationWeeks"], 200)
            s, _, b = call(srv, "GET", "/api/runs/%s/dao" % rid)
            self.assertEqual((s, b["error"]["code"]), (409, "hazirlaniyor"))
            self.adim(rid, 1)
            s, _, b = call(srv, "GET", "/api/runs/%s/dao" % rid)
            self.assertEqual(s, 200)
            self.assertEqual(b["hafta"], 1)
            self.assertIn("ben", b)
            self.assertEqual(b, app.manager.weeks(rid, 1, 1)[0]["dao"])

    def test_cokmus_isci_failed_ve_dao_409_kosu_cokmus(self):
        """N1: işçi ilk haftadan önce ölürse koşu `failed` olur; `/dao` sonsuza dek `hazirlaniyor` demez, `kosu_cokmus` (409) döner."""
        with self.uygulama() as (srv, app, _root):
            rid = self.yarat()
            s, _, b = call(srv, "GET", "/api/runs/%s/dao" % rid)
            self.assertEqual((s, b["error"]["code"]), (409, "hazirlaniyor"))   # henüz yaşıyor: meşru
            app.manager._runs[rid].worker.kill()                              # işçi beklenmedik ölür (paket yok)
            self.bekle(lambda: self.durum(rid)["status"] == "failed")
            s, _, b = call(srv, "GET", "/api/runs/%s/dao" % rid)
            self.assertEqual((s, b["error"]["code"]), (409, "kosu_cokmus"))
            s, _, b = self.karar(rid, {"tur": "cek", "miktar": 1.0})
            self.assertEqual((s, b["error"]["code"]), (409, "kosu_bitti"))

    def test_dao_get_bilinmeyen_kosu_404(self):
        with self.uygulama() as (srv, _a, _r):
            s, _, b = call(srv, "GET", "/api/runs/canli-yok/dao")
            self.assertEqual((s, b["error"]["code"]), (404, "not_found"))
            s, _, b = call(srv, "POST", "/api/runs/canli-yok/dao/karar", {"tur": "ayril"})
            self.assertEqual((s, b["error"]["code"]), (404, "not_found"))

    def test_kurucu_kosusunda_dao_409(self):
        with self.uygulama() as (srv, _a, _r):
            rid = self.yarat(CONFIG)
            self.assertNotIn("mode", self.durum(rid))
            for s, _, b in (call(srv, "GET", "/api/runs/%s/dao" % rid), self.karar(rid, {"tur": "ayril"}), self.kontrol(rid, "olay")):
                self.assertEqual((s, b["error"]["code"]), (409, "dao_degil"))

    def test_karar_kabul_ve_kayit(self):
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            self.adim(rid, 1)
            ben = call(self.srv, "GET", "/api/runs/%s/dao" % rid)[2]["ben"]
            s, _, b = self.karar(rid, {"tur": "cek", "miktar": 1.0})
            self.assertEqual(s, 202)
            self.assertEqual(b, {"kabul": True, "hafta": 2})
            rows = satirlar(kosu_klasoru(root))
            self.assertEqual(len(rows), 1)
            r = rows[0]
            self.assertEqual(r["uygulama_haftasi"], b["hafta"])
            self.assertEqual(r["sira"], 0)
            self.assertEqual(r["karar"], {"tur": "cek", "miktar": 1.0})
            self.assertEqual(r["durum"], {"nakit": ben["nakit"], "durum": ben["durum"], "servet_dilimi": ben["servet_dilimi"]})
            self.assertEqual(set(r), {"uygulama_haftasi", "sira", "karar", "durum"})

    def test_sira_artar(self):
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            self.adim(rid, 1)
            self.assertEqual(self.karar(rid, {"tur": "mevduat", "lonca": None, "oran": 0.5})[0], 202)
            self.assertEqual(self.karar(rid, {"tur": "cek", "miktar": 1.0})[0], 202)
            self.assertEqual([r["sira"] for r in satirlar(kosu_klasoru(root))], [0, 1])

    def test_sermaye_ekle_karari_kabul_edilir(self):
        """M14 OWNER_INJECT: sermaye_ekle sunucuda tanimli bir karar turu (sahte islemci human_submit ile ayni alan tablosu); gecersiz miktar ve fazla alan 422."""
        with self.uygulama() as (_srv, _a, _root):
            rid = self.yarat()
            self.adim(rid, 1)
            self.assertEqual(self.karar(rid, {"tur": "sermaye_ekle", "miktar": 5.0})[0], 202)
            self.assertEqual(self.karar(rid, {"tur": "sermaye_ekle", "miktar": 5.0, "x": 1})[0], 422)

    def test_kadro_karari_bayrak_kapaliyken_422(self):
        """G17i: kadro {hedef} sunucuda tanimli karar turu (alan tablosu human_submit ile ayni); HIRE_TARGET kapaliyken 422 karar_gecersiz, neden bayrak_kapali; eksik/fazla alan 422."""
        with self.uygulama() as (_srv, _a, _root):
            rid = self.yarat()
            self.adim(rid, 1)
            s, _, b = self.karar(rid, {"tur": "kadro", "hedef": 3})
            self.assertEqual(s, 422)
            self.assertEqual(b["error"]["code"], "karar_gecersiz")
            self.assertIn({"id": "tur", "reason": "bayrak_kapali"}, b["error"]["fields"])
            self.assertEqual(self.karar(rid, {"tur": "kadro"})[0], 422)
            self.assertEqual(self.karar(rid, {"tur": "kadro", "hedef": 3, "x": 1})[0], 422)

    def test_lonca_sec_karari_kabul_edilir_ve_yazilir(self):
        """F2 HUMAN_LONCA: DAO kipinde yonetici bayragi acar (HUMAN_LONCA=1); lonca_sec kabul edilir, kararlar.jsonl'a yazilir; eksik/fazla alan 422."""
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            self.adim(rid, 1)
            self.assertEqual(self.karar(rid, {"tur": "lonca_sec", "lonca": "lonca1"})[0], 202)
            self.assertEqual(self.karar(rid, {"tur": "lonca_sec"})[0], 422)
            self.assertEqual(self.karar(rid, {"tur": "lonca_sec", "lonca": "lonca1", "x": 1})[0], 422)
            satir = [s for s in satirlar(kosu_klasoru(root)) if s.get("karar", {}).get("tur") == "lonca_sec"]
            self.assertEqual(len(satir), 1)
            self.assertEqual(satir[0]["karar"]["lonca"], "lonca1")

    def test_lonca_kur_karari_kabul_edilir_ve_yazilir(self):
        """F3 HUMAN_LONCA: lonca_kur {yol} kabul edilir, kararlar.jsonl'a yazilir; eksik/fazla alan ve bilinmeyen yol 422."""
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            self.adim(rid, 1)
            self.assertEqual(self.karar(rid, {"tur": "lonca_kur", "yol": "girisimci"})[0], 202)
            self.assertEqual(self.karar(rid, {"tur": "lonca_kur"})[0], 422)
            self.assertEqual(self.karar(rid, {"tur": "lonca_kur", "yol": "medya", "x": 1})[0], 422)
            self.assertEqual(self.karar(rid, {"tur": "lonca_kur", "yol": "yok"})[0], 422)
            satir = [s for s in satirlar(kosu_klasoru(root)) if s.get("karar", {}).get("tur") == "lonca_kur"]
            self.assertEqual(len(satir), 1)
            self.assertEqual(satir[0]["karar"]["yol"], "girisimci")

    def test_hafta_0_karari_durumsuz_kaydedilir(self):
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            s, _, b = self.karar(rid, {"tur": "cek", "miktar": 1.0})
            self.assertEqual((s, b), (202, {"kabul": True, "hafta": 1}))
            r = satirlar(kosu_klasoru(root))[0]
            self.assertEqual((r["uygulama_haftasi"], r["durum"]), (1, {"nakit": None, "durum": None, "servet_dilimi": None}))

    def test_reddedilen_kayda_girmez(self):
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            self.adim(rid, 1)
            s, _, b = self.karar(rid, {"tur": "yok"})
            self.assertEqual(s, 422)
            self.assertEqual(b["error"]["code"], "karar_gecersiz")
            self.assertEqual([f["id"] for f in b["error"]["fields"]], ["tur"])
            self.assertEqual(satirlar(kosu_klasoru(root)), [])

    def test_ayni_hafta_422(self):
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            self.adim(rid, 1)
            self.assertEqual(self.karar(rid, {"tur": "cek", "miktar": 1.0})[0], 202)
            s, _, b = self.karar(rid, {"tur": "cek", "miktar": 2.0})
            self.assertEqual((s, b["error"]["code"]), (422, "ayni_hafta"))
            self.assertEqual(len(satirlar(kosu_klasoru(root))), 1)

    def test_gecersiz_govde_422(self):
        with self.uygulama() as (_srv, _a, root):
            rid = self.yarat()
            self.adim(rid, 1)
            s, _, b = call(self.srv, "POST", "/api/runs/%s/dao/karar" % rid, "[1]")
            self.assertEqual((s, b["error"]["code"]), (400, "bad_json"))
            s, _, b = self.karar(rid, {})
            self.assertEqual((s, b["error"]["code"]), (422, "karar_gecersiz"))
            self.assertEqual(satirlar(kosu_klasoru(root)), [])

    def test_ret_nedenleri_govdede_tasinir(self):
        """Modelin nedenli ret öğeleri (`{id, reason}`) 422 gövdesine olduğu gibi gider; nedensiz alan `invalid` kalır. Ahırda `ayril`/`basvur` -> `ahirda`, ahır dışında `ahirdan_cik` -> `ahirda_degil`."""
        with self.uygulama() as (_srv, _app, root):
            rid = self.yarat()
            self.adim(rid, 1)                                              # 1. haftada oyuncu ahırdadır
            for govde, kod, alanlar in (
                ({"tur": "ayril"}, "karar_gecersiz", [{"id": "tur", "reason": "ahirda"}]),
                ({"tur": "basvur", "firma": "fk0"}, "karar_gecersiz", [{"id": "tur", "reason": "ahirda"}]),
                ({"tur": "cek"}, "karar_gecersiz", [{"id": "miktar", "reason": "invalid"}]),
            ):
                s, _, b = self.karar(rid, govde)
                self.assertEqual((s, b["error"]["code"], b["error"]["fields"]), (422, kod, alanlar), govde)
            self.assertEqual(satirlar(kosu_klasoru(root)), [])             # ret kaydedilmez
            self.assertEqual(self.karar(rid, {"tur": "ahirdan_cik"})[0], 202)
            self.adim(rid, 2)
            s, _, b = self.karar(rid, {"tur": "ahirdan_cik"})
            self.assertEqual((s, b["error"]["fields"]), (422, [{"id": "tur", "reason": "ahirda_degil"}]))
            s, _, b = self.karar(rid, {"tur": "basvur", "firma": "yok"})
            self.assertEqual((s, b["error"]["fields"]), (422, [{"id": "firma", "reason": "invalid"}]))

    def test_basvuru_olaylari_gozlemde(self):
        with self.uygulama() as (_srv, _app, _root):
            rid = self.yarat()
            self.adim(rid, 1)
            self.assertEqual(self.karar(rid, {"tur": "ahirdan_cik"})[0], 202)
            self.adim(rid, 2)
            g = call(self.srv, "GET", "/api/runs/%s/dao" % rid)[2]
            self.assertEqual((g["ben"]["durum"], [o["tur"] for o in g["olaylar"]]), ("is_arayan", ["ahirdan_cikti"]))
            self.assertEqual([i["firma"] for i in g["ilanlar"]], ["fk0", "fk1", "fk2"])
            self.assertEqual(self.karar(rid, {"tur": "basvur", "firma": "fk1"})[0], 202)
            self.adim(rid, 3)
            g = call(self.srv, "GET", "/api/runs/%s/dao" % rid)[2]
            self.assertEqual(g["olaylar"], [{"tur": "basvuru_kabul", "hafta": 3, "firma": "fk1"}])
            self.assertEqual((g["ben"]["durum"], g["ben"]["is"]["firma"]), ("calisan", "fk1"))
            self.assertEqual(self.karar(rid, {"tur": "basvur", "firma": "fk2"})[0], 202)
            self.adim(rid, 4)
            g = call(self.srv, "GET", "/api/runs/%s/dao" % rid)[2]
            self.assertEqual(g["olaylar"], [{"tur": "basvuru_kabul", "hafta": 4, "firma": "fk2"}, {"tur": "is_degistirdi", "hafta": 4, "eski": "fk1", "yeni": "fk2"}])          # çalışan insan işten ayrılmadan başka ilana başvurabilir
            self.assertEqual((g["ben"]["durum"], g["ben"]["is"]["firma"]), ("calisan", "fk2"))

    def test_olay_eylemi_duraklar(self):
        with self.uygulama() as (_srv, app, _r):
            rid = self.yarat()
            self.adim(rid, 1)
            self.assertEqual(self.karar(rid, {"tur": "ahirdan_cik"})[0], 202)          # 1. haftada oyuncu ahırdadır: yalnız ahirdan_cik geçerli
            s, _, st = self.kontrol(rid, "olay")
            self.assertEqual(s, 200)
            self.bekle(lambda: self.durum(rid)["status"] == "paused")
            st = self.durum(rid)
            self.assertEqual((st["week"], st["speed"]), (2, 16))
            gozlem = call(self.srv, "GET", "/api/runs/%s/dao" % rid)[2]
            self.assertIn("ahirdan_cikti", [o["tur"] for o in gozlem["olaylar"]])
            stats = app.manager.stats(rid)
            self.assertEqual(stats["worker_week"], stats["released"])
            self.assertEqual(stats["frontier"], stats["released"])
            time.sleep(0.2)                                      # durdu: yeni hafta yayımlanmaz
            self.assertEqual(self.durum(rid)["week"], 2)

    def test_olay_eylemi_olaysiz_haftalari_atlar(self):
        with self.uygulama() as (_srv, app, _r):
            rid = self.yarat()
            self.adim(rid, 1)
            self.kontrol(rid, "olay")                              # karar yok: olay çıkmaz
            time.sleep(0.3)                                      # hiç olay çıkmaz: koşu durmadan sürer
            self.assertEqual(self.durum(rid)["status"], "running")
            self.assertGreater(self.durum(rid)["week"], 4)
            self.assertEqual(self.karar(rid, {"tur": "ayril"})[0], 202)
            self.bekle(lambda: self.durum(rid)["status"] == "paused")
            gozlem = call(self.srv, "GET", "/api/runs/%s/dao" % rid)[2]
            self.assertTrue(gozlem["olaylar"])
            st = app.manager.stats(rid)
            self.assertEqual(st["worker_week"], st["released"])

    def test_olay_eylemi_kurabilir_oldu_olayinda_duraklar(self):
        """I2: modelin `kurabilir_oldu` olayı (karar olmadan, hafta sonunda) `olay` eylemini durdurur."""
        from unittest import mock

        from oyun_server.testing import FakeHost
        gercek = FakeHost._dao_uygula

        def uygula(self_, w):
            return [{"tur": "kurabilir_oldu", "hafta": w}] if w == 4 else gercek(self_, w)

        with mock.patch.object(FakeHost, "_dao_uygula", uygula), self.uygulama() as (_srv, app, _r):
            rid = self.yarat()
            self.adim(rid, 1)
            self.kontrol(rid, "olay")
            self.bekle(lambda: self.durum(rid)["status"] == "paused")
            self.assertEqual(self.durum(rid)["week"], 4)
            gozlem = call(self.srv, "GET", "/api/runs/%s/dao" % rid)[2]
            self.assertEqual([o["tur"] for o in gozlem["olaylar"]], ["kurabilir_oldu"])
            st = app.manager.stats(rid)
            self.assertEqual(st["worker_week"], st["released"])

    def test_olay_eylemi_sure_bitince_biter(self):
        with self.uygulama() as (_srv, app, _r):
            rid = self.yarat()
            app.manager._runs[rid].duration = 3
            self.kontrol(rid, "olay")
            self.bekle(lambda: self.durum(rid)["status"] == "ended")
            self.assertEqual(self.durum(rid)["week"], 3)

    def test_eylem_kumesi(self):
        with self.uygulama() as (srv, _a, _r):
            rid = self.yarat()
            s, _, b = self.kontrol(rid, "olay_yok")
            self.assertEqual((s, b["error"]["code"]), (422, "invalid_control"))

    def test_dao_kurucu_uc_noktalari_403(self):
        with self.uygulama() as (srv, _a, _r):
            rid = self.yarat()
            self.adim(rid, 1)
            s, _, b = call(srv, "POST", "/api/runs/%s/changes" % rid, {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})
            self.assertEqual((s, b["error"]["code"]), (403, "dao_kural_degistiremez"))
            s, _, b = call(srv, "POST", "/api/runs/%s/branch" % rid, {"week": 1})
            self.assertEqual((s, b["error"]["code"]), (403, "dao_kural_degistiremez"))
            kid = self.yarat(CONFIG)                               # Kurucu koşusunda uç noktalar eskisi gibi
            s, _, b = call(srv, "POST", "/api/runs/%s/branch" % kid, {"week": 0})
            self.assertEqual(s, 201, b)

    def test_bitmis_kosuda_karar_409(self):
        with self.uygulama() as (_srv, app, root):
            rid = self.yarat()
            app.manager._runs[rid].duration = 2
            self.kontrol(rid, "play", 16)
            self.bekle(lambda: self.durum(rid)["status"] == "ended")
            s, _, b = self.karar(rid, {"tur": "cek", "miktar": 1.0})
            self.assertEqual((s, b["error"]["code"]), (409, "kosu_bitti"))
            self.assertEqual(satirlar(kosu_klasoru(root)), [])
            s, _, g = call(self.srv, "GET", "/api/runs/%s/dao" % rid)       # bitmiş koşuda daoSonuc (son gözlem), düz gövde
            self.assertEqual(s, 200)
            self.assertEqual(g, app.manager._runs[rid].dao_sonuc)
            self.assertEqual(g["hafta"], 2)

    def test_hazirlanirken_karar_409(self):
        with self.uygulama() as (_srv, app, root):
            rid = self.yarat()
            app.manager._runs[rid].prep = {"total": 5}               # hızlı ileri sarma sürüyor
            s, _, b = self.karar(rid, {"tur": "cek", "miktar": 1.0})
            self.assertEqual((s, b["error"]["code"]), (409, "hazirlaniyor"))
            s, _, b = call(self.srv, "GET", "/api/runs/%s/dao" % rid)
            self.assertEqual((s, b["error"]["code"]), (409, "hazirlaniyor"))
            self.assertEqual(satirlar(kosu_klasoru(root)), [])
            app.manager._runs[rid].prep = None

    def test_zaman_asimi_504_karar_belirsiz(self):
        with self.uygulama() as (_srv, app, root):
            rid = self.yarat()
            self.adim(rid, 1)
            run = app.manager._runs[rid]
            orijinal = run.worker.send
            run.worker.send = lambda cmd: None if cmd.get("cmd") == "karar" else orijinal(cmd)     # yanıt hiç gelmez
            app.manager.dao_karar = functools.partial(RunManager.dao_karar, app.manager, wait_s=0.2)
            s, _, b = self.karar(rid, {"tur": "cek", "miktar": 1.0})
            self.assertEqual((s, b["error"]["code"]), (504, "karar_belirsiz"))
            self.assertIn("gözlem", b["error"]["message"])
            self.assertEqual(satirlar(kosu_klasoru(root)), [])        # onay yok: kayıt yok

    def test_zaman_asimindan_sonra_gelen_onay_yine_kaydedilir(self):
        with self.uygulama() as (_srv, app, root):
            rid = self.yarat()
            self.adim(rid, 1)
            with self.assertRaises(Exception) as cm:
                app.manager.dao_karar(rid, {"tur": "cek", "miktar": 1.0}, wait_s=0.0)
            self.assertEqual(type(cm.exception).__name__, "DaoTimeout")
            self.bekle(lambda: len(satirlar(kosu_klasoru(root))) == 1)    # işçi yine uyguladı: kayıt eksik kalmaz (yeniden oynatma)
            self.assertEqual(satirlar(kosu_klasoru(root))[0]["uygulama_haftasi"], 2)


class TestYoneticiDao(ManagerBase):
    def kur(self):
        m = self.make()
        m.start_thread()
        return m

    def test_olay_kurucuda_not_dao(self):
        m = self.kur()
        rid, _ = self.new_run()
        with self.assertRaises(NotDao):
            m.control(rid, "olay")

    def test_dao_gozlem_hazirlaniyor_ve_not_dao(self):
        m = self.kur()
        rid = m.create(dict(DAO))["runId"]
        with self.assertRaises(DaoPreparing):
            m.dao_gozlem(rid)
        kid, _ = self.new_run()
        with self.assertRaises(NotDao):
            m.dao_gozlem(kid)

    def test_on_dao_end_derin_kopya_alir(self):
        gelen = []

        def kanca(run_id, sonuc, meta):
            gelen.append(sonuc)
            sonuc["ben"]["nakit"] = -1                           # kanca kendi kopyasını bozar

        m = self.kur()
        m._on_dao_end = kanca
        rid = m.create(dict(DAO))["runId"]
        m._runs[rid].duration = 2
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended")
        self.assertEqual(len(gelen), 1)
        self.assertIsNot(gelen[0], m._runs[rid].dao_sonuc)
        self.assertNotEqual(m._runs[rid].dao_sonuc["ben"]["nakit"], -1)
        self.assertEqual(m.weeks(rid, 2, 2)[0]["dao"]["ben"]["nakit"], m._runs[rid].dao_sonuc["ben"]["nakit"])


# ---- yeniden oynatma (gerçek model) ------------------------------------------------------------------------------
def _manager(test: unittest.TestCase) -> RunManager:
    def factory(spec):
        w = InProcWorker(spec)
        test.addCleanup(w.kill)
        return w

    cfg = make_cfg(MAX_RUNS=4)
    m = RunManager(real_registry(), factory, clock=FakeClock(), cfg=cfg)
    m.start_thread()
    test.addCleanup(m.shutdown)
    return m


def _adim(test: unittest.TestCase, m: RunManager, rid: str, hafta: int) -> None:
    m.control(rid, "step")
    end = time.time() + 120
    while time.time() < end:
        st = m.stats(rid)
        if st["released"] >= hafta and st["worker_week"] == st["released"]:
            return
        time.sleep(0.005)
    test.fail("hafta %d yayımlanmadı" % hafta)


def replay_dao(test: unittest.TestCase, tarif: dict, kararlar: list[dict], hafta: int) -> list[dict]:
    """Taze koşu aynı tarifle kurulur; `kararlar.jsonl` satırları `uygulama_haftasi`ndan önceki hafta (`sira` sırasıyla) işçiye `karar` komutu olarak verilir;
    `hafta` haftalık paket satırı döner (`run_id` ayrıştırıcı)."""
    m = _manager(test)
    rid = m.create(copy.deepcopy(tarif))["runId"]
    sirali = sorted(kararlar, key=lambda r: (r["uygulama_haftasi"], r["sira"]))
    for w in range(1, hafta + 1):
        for r in sirali:
            if r["uygulama_haftasi"] == w:
                res = m.dao_karar(rid, copy.deepcopy(r["karar"]))
                test.assertEqual(res, {"kabul": True, "hafta": w}, r)
        _adim(test, m, rid, w)
    return m.weeks(rid, 1, hafta)


class TestYenidenOynatma(unittest.TestCase):
    def test_kayit_yeniden_oynatma(self):
        N = 12
        root = Path(tempfile.mkdtemp(prefix="dao-6b-"))
        self.addCleanup(shutil.rmtree, root, True)
        m = _manager(self)
        m._disk = disk.DiskStore(root)
        tarif = dict(DAO, durationWeeks=100)
        rid = m.create(copy.deepcopy(tarif))["runId"]
        planli = {0: {"tur": "mevduat", "lonca": None, "oran": 0.5},        # hafta 0'da verilir -> uygulama haftası 1
                  4: {"tur": "ahirdan_cik"},                                      # ahırdan yalnız bu kararla çıkılır (ahır alt sınırdayken göç reddedilir)
                  8: {"tur": "cek", "miktar": 1.0}}
        for w in range(0, N):
            if w in planli:
                res = m.dao_karar(rid, copy.deepcopy(planli[w]))
                self.assertTrue(res["kabul"], (w, res))
                self.assertEqual(res["hafta"], w + 1)
            _adim(self, m, rid, w + 1)
        canli = m.weeks(rid, 1, N)
        kararlar = satirlar(kosu_klasoru(root))
        self.assertEqual(len(kararlar), 3)
        self.assertEqual([r["uygulama_haftasi"] for r in kararlar], [1, 5, 9])
        self.assertEqual([r["sira"] for r in kararlar], [0, 1, 2])
        norm = lambda ps: json.dumps([{k: v for k, v in p.items() if k != "run_id"} for p in ps], sort_keys=True)
        yeniden = replay_dao(self, tarif, kararlar, N)
        self.assertEqual(len(yeniden), N)
        self.assertEqual(norm(yeniden), norm(canli))
        # karar kaydı olmadan oynatma ayrışır: kayıt gerçekten belirleyici
        bos = replay_dao(self, tarif, [], N)
        self.assertNotEqual(norm(bos), norm(canli))


if __name__ == "__main__":
    unittest.main()
