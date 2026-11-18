"""B2: tarayıcı çekirdeği (Pyodide, tek iş parçacığı) testleri.

- `tarayici/istemci.py` (süreç içi işçi istemcisi), `runs/manager.py` işbirlikçi kipi (`_wait`, `pump_once`, `tick`),
- `tarayici/yonlendirici.py` + `tarayici/cekirdek.py` (HTTP'siz yönlendirme, SSE yerine olay listesi),
- çekirdek ile HTTP yolu aynı senaryoda aynı paketleri verir; `wire_contract.json` uçları çekirdekte geçer.
Sahte host (FakeHost) kullanılır: biçim ve mantık sınanır, model sayısı değil (gerçek model eşitliği B2 raporunda).
"""
from __future__ import annotations

import copy
import json
import os
import sys
import time
import types
import unittest
from pathlib import Path
from unittest import mock

from oyun_server import config
from oyun_server.runs import manager as M
from oyun_server.runs.manager import RunManager
from oyun_server.sim.worker import SessionCore
from oyun_server.tarayici.cekirdek import TarayiciCekirdegi
from oyun_server.tarayici.istemci import InProcClient, inproc_factory
from oyun_server.testing import FakeHost

from tests.registry_helpers import real_defaults, real_registry
from tests.route_helpers import CONFIG, call, create_run, live_app, make_cfg
from tests.test_sse import wait_week
from tests.test_wire_contract import FIX, WireContract, shape_diff


def fake_factory(spec):
    return FakeHost("", spec.get("overrides", {}), spec.get("weeks", 200))


def cekirdek(**kw) -> TarayiciCekirdegi:
    kw.setdefault("host_factory", fake_factory)
    kw.setdefault("defaults", real_defaults())
    kw.setdefault("registry", real_registry())
    return TarayiciCekirdegi(**kw)


def cagri(c: TarayiciCekirdegi, method: str, path: str, body=None):
    """(status, headers, json) -- `route_helpers.call` ile aynı biçim."""
    r = c.istek(method, path, body)
    return r["status"], r["headers"], r["body"]


def bekle_hafta(c: TarayiciCekirdegi, rid: str, n: int, limit: float = 30.0) -> None:
    end = time.monotonic() + limit
    while time.monotonic() < end:
        if c.manager.stats(rid)["released"] >= n:
            return
        c.tick()
    raise AssertionError("%d. hafta yayımlanmadı: %r" % (n, c.manager.stats(rid)))


def adim(c, rid, n=1):
    for _ in range(n):
        cagri(c, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})


class Kopru:
    """B3: JS/IndexedDB rolü. Abone olur, hafta olaylarını depolar; çekirdeğin `arsiv_gerek` yanıtını depodan karşılar (pencere dışı haftalar)."""

    def __init__(self, c, rid):
        self.c, self.rid, self.depo = c, rid, {}
        self.abone = c.istek("GET", f"/api/runs/{rid}/events")["body"]["abone"]

    def bosalt(self):
        for o in self.c.olaylar(self.abone)["olaylar"]:
            if o["event"] == "week":
                self.depo[o["data"]["week"]] = o["data"]

    def istek(self, yontem, yol, govde=None):
        self.bosalt()
        arsiv: dict = {}
        for _ in range(3):                                         # sözleşme: sınırlı yineleme (tick araya girip pencereyi kaydırabilir)
            r = self.c.istek(yontem, yol, govde, list(arsiv.values()))
            if "arsiv_gerek" not in r:
                return r
            g = r["arsiv_gerek"]
            self.bosalt()
            arsiv.update({w: self.depo[w] for w in range(g["from"], g["to"] + 1)})
        raise AssertionError("arsiv_gerek 3 yinelemede bitmedi: %r" % (r,))


def paket_ozeti(pk):
    out = copy.deepcopy(pk)
    for p in out:
        p.pop("run_id", None)
        p.pop("runId", None)
    return out


class IstemciTesti(unittest.TestCase):
    def test_send_hafta_hesaplamaz_advance_once_tek_hafta(self):
        cl = InProcClient({}, fake_factory)
        cl.send({"cmd": "init", "overrides": {}, "weeks": 5})
        cl.send({"cmd": "target", "week": 3})
        evs = list(cl.events())
        self.assertEqual([e["ev"] for e in evs], ["ready"])           # send yalnız komutu işler
        self.assertEqual(cl.core.host.week, 0)
        cl.advance_once()
        self.assertEqual(cl.core.host.week, 1)                        # en çok bir hafta
        self.assertEqual([e["ev"] for e in cl.events()], ["week"])
        cl.stop()
        self.assertFalse(cl.alive())

    def test_stuck_denetimi_kapali(self):
        self.assertFalse(InProcClient({}, fake_factory).stuck_check)

    def test_cekirdek_oturum_isleyisi_ayni(self):
        out = []
        core = SessionCore(out.append, fake_factory)
        core.handle({"cmd": "init", "overrides": {}, "weeks": 2})
        core.handle({"cmd": "target", "week": 2})
        while not core.idle():
            core.advance()
        self.assertEqual([e["ev"] for e in out], ["ready", "week", "week"])

    def test_inproc_factory_csv_dizini_kill_ile_silinir(self):
        cl = inproc_factory(None, fake_factory)({"overrides": {}})
        d = cl.csv_dir
        self.assertTrue(os.path.isdir(d))
        cl.kill()
        self.assertFalse(os.path.exists(d))


class YoneticiIsbirlikciTesti(unittest.TestCase):
    def setUp(self):
        self.mgr = RunManager(real_registry(), inproc_factory(None, fake_factory), cfg=make_cfg())
        self.mgr.cooperative = True
        self.addCleanup(self.mgr.shutdown)

    def test_wait_olay_kuruluysa_hemen_degilse_sinirli(self):
        import threading
        ev = threading.Event()
        t0 = time.monotonic()
        self.assertFalse(self.mgr._wait(ev, 0.05))
        self.assertLess(time.monotonic() - t0, 1.0)                   # uyumaz, süre dolunca döner
        ev.set()
        self.assertTrue(self.mgr._wait(ev, 5.0))

    def test_pump_once_hafta_hesaplamaz_tick_en_cok_bir_hafta(self):
        rid = self.mgr.create(CONFIG)["runId"]
        host = self.mgr._runs[rid].worker.core
        self.mgr.control(rid, "play", 16)
        for _ in range(10):
            self.mgr.pump_once()
        self.assertEqual(self.mgr.stats(rid)["worker_week"], 0)
        self.assertEqual(host.host.week if host.host else 0, 0)       # hiçbir pump bir hafta hesaplamadı
        prev = 0
        for _ in range(6):
            self.mgr.tick()
            w = host.host.week
            self.assertLessEqual(w - prev, 1)
            prev = w
        self.assertGreaterEqual(prev, 1)

    def test_stuck_denetimi_suren_icinde_koşuyu_dusurmez(self):
        rid = self.mgr.create(CONFIG)["runId"]
        self.mgr.control(rid, "play", 16)
        self.mgr.tick()
        run = self.mgr._runs[rid]
        run.owed_since = time.monotonic() - 10_000                    # sekme arka planda kısılmış gibi
        self.mgr.pump_once()
        self.assertNotEqual(self.mgr.stats(rid)["status"], "failed")

    def test_stuck_denetimi_sunucu_istemcisinde_acik(self):
        from oyun_server.sim.client import WorkerClient
        self.assertTrue(getattr(WorkerClient, "stuck_check", True))   # alt süreç istemcisinde denetim açık kalır (sunucu yolu aynı)

    def test_degisiklik_bekleme_dongusu_ust_sinirli(self):
        """Üst sınır kalkarsa test KİLİTLENMEZ, kırılır: sessiz işçi yama gönderildikten 3 sn sonra `AssertionError` fırlatır (pump `events` çağırır)."""
        class Sessiz(InProcClient):                                   # yamayı yutar, yanıt vermez
            patch_t = None

            def send(self, cmd):
                if cmd.get("cmd") == "patch":
                    Sessiz.patch_t = time.monotonic()
                    return
                super().send(cmd)

            def events(self, timeout=0):
                if Sessiz.patch_t is not None and time.monotonic() - Sessiz.patch_t > 3.0:
                    raise AssertionError("bekleme döngüsünün üst sınırı yok")
                return super().events(timeout)

        mgr = RunManager(real_registry(), lambda spec: Sessiz(spec, fake_factory), cfg=make_cfg())
        mgr.cooperative = True
        self.addCleanup(mgr.shutdown)
        rid = mgr.create(CONFIG)["runId"]
        for _ in range(3):
            mgr.control(rid, "step", 16)
        end = time.monotonic() + 20
        while mgr.stats(rid)["released"] < 3 and time.monotonic() < end:
            mgr.tick()
        with mock.patch.object(M, "COOP_WAIT_CAP_S", 0.3):
            t0 = time.monotonic()
            res = mgr.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, timeout=0.05)
            self.assertLess(time.monotonic() - t0, 2.5)
        self.assertEqual(res["accepted"], False)
        self.assertEqual(res["fields"][0]["reason"], "busy")

    def test_sunucu_kipinde_wait_event_wait(self):
        mgr = RunManager(real_registry(), lambda s: None, cfg=make_cfg())
        self.assertFalse(mgr.cooperative)
        ev = mock.Mock()
        ev.wait.return_value = True
        self.assertTrue(mgr._wait(ev, 2.5))
        ev.wait.assert_called_once_with(2.5)


class SurecIciYollarTesti(unittest.TestCase):
    """Alt süreçsiz yollar, alt süreç yollarıyla bire bir aynı sonucu verir (Pyodide'de alt süreç olmadığından)."""

    @unittest.skipIf(os.environ.get("OYUN_QUICK") == "1", "yavaş (model kurar)")
    def test_varsayilanlar_ve_acilis_hesabi_ayni(self):
        from oyun_server.registry import defaults
        from oyun_server.sim import plan
        root = str(config.MODEL_ROOT)
        self.assertEqual(defaults.read_param_defaults(root, inproc=True), defaults.read_param_defaults(root, inproc=False))
        ov = {"TRANS_SUPPORT": 2, "PM_ADJ": 0.078, "RUN_SEED": "1", "HUMAN_ON": "1"}
        self.assertEqual(plan._run(root, ov, inproc=True), plan._run(root, ov, inproc=False))

    def test_inproc_baglami_yalniz_baglam_icinde(self):
        from oyun_server.registry import defaults
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OYUN_INPROC", None)
            self.assertFalse(defaults.inproc_mode())
            with defaults.inproc_baglami():
                self.assertTrue(defaults.inproc_mode())
            self.assertFalse(defaults.inproc_mode())


class GoruntuTesti(unittest.TestCase):
    def test_taninmayan_lambda_acik_hata_ve_cagrilmaz(self):
        import io
        from oyun_server.tarayici import goruntu
        cagrilar = []

        def uret():
            return lambda: cagrilar.append(1) or [0.0, 0.0]            # `[0.0, 0.0]` üretse de modelin lambdası DEĞİL: tanınmaz, çağrılmaz

        goruntu.SnapPickler.UNKNOWN.clear()
        p = goruntu.SnapPickler(io.BytesIO(), protocol=5)
        with self.assertRaises(Exception):
            p.dump({"f": uret()})
        self.assertEqual(cagrilar, [])
        self.assertTrue(goruntu.SnapPickler.UNKNOWN)
        goruntu.SnapPickler.UNKNOWN.clear()

    @unittest.skipIf(os.environ.get("OYUN_QUICK") == "1", "yavaş (gerçek model)")
    def test_goruntu_yukle_devam_kesintisiz_ile_ayni(self):
        """Gerçek model, 2. haftada görüntü + canlı yama; yeni çekirdekte yüklenip devam = kesintisiz koşu (hafta olayları eşit)."""
        import hashlib
        import tempfile
        from oyun_server.tarayici import goruntu

        def ozet(ev):
            return hashlib.sha256(json.dumps(ev, sort_keys=True, default=repr).encode()).hexdigest()[:16]

        spec = {"cmd": "init", "host": "model", "overrides": {}, "weeks": 5, "model_root": str(config.MODEL_ROOT), "csv_dir": tempfile.mkdtemp(prefix="oyun-host-")}
        ev_a = {}
        a = SessionCore(lambda e: ev_a.__setitem__(e["week"], ozet(e)) if e.get("ev") == "week" else None)
        a.handle(dict(spec))
        a.handle({"cmd": "target", "week": 5})
        parcalar = []
        while not a.idle():
            a.advance()
            if a.host.week == 1:
                a.handle({"cmd": "patch", "overrides": {"CORP_TAX": 0.25}, "version": 2})
            if a.host.week == 2 and not parcalar:
                goruntu.dump_session(a, parcalar.append)
        a.close()
        self.assertEqual(sorted(ev_a), [1, 2, 3, 4, 5])
        ev_b = {}
        b = SessionCore(lambda e: ev_b.__setitem__(e["week"], ozet(e)) if e.get("ev") == "week" else None)
        it = iter(parcalar + [b""])
        info = goruntu.load_session(b, lambda: next(it), csv_dir=tempfile.mkdtemp(prefix="oyun-host-"), model_root=str(config.MODEL_ROOT))
        self.assertEqual(info["week"], 2)
        W = b.host._W                                                 # lambda fabrikaları doğru işlevlere bağlandı (yanlış eşleme: M6)
        self.assertEqual(W.tsup["by_kind"].default_factory(), [0.0, 0.0])
        self.assertIs(type(W.is_player), type(None))                  # phase_metrics lambdaları None; hafta girişinde yeniden kurulur
        if getattr(W, "supply", None) is not None:
            import collections
            self.assertEqual(W.supply.default_factory(), collections.defaultdict(list))
        b.handle({"cmd": "target", "week": 5})
        while not b.idle():
            b.advance()
        b.close()
        self.assertEqual({w: ev_b[w] for w in (3, 4, 5)}, {w: ev_a[w] for w in (3, 4, 5)})


class CekirdekTesti(unittest.TestCase):
    def setUp(self):
        self.c = cekirdek(sec_per_week_p50=1.25)
        self.addCleanup(self.c.kapat)

    def test_hello_p50_pyodide_olcumunden(self):
        s, h, b = cagri(self.c, "GET", "/api/hello")
        self.assertEqual(s, 200)
        self.assertEqual(b["sec_per_week_p50"], 1.25)
        self.assertIs(b["capabilities"]["jobs"], False)               # tarayıcıda iş işçisi yok
        self.c.p50_ayarla(2.5)
        self.assertEqual(cagri(self.c, "GET", "/api/hello")[2]["sec_per_week_p50"], 2.5)

    def test_hello_p50_varsayilan_none(self):
        c = cekirdek()
        self.addCleanup(c.kapat)
        self.assertIsNone(cagri(c, "GET", "/api/hello")[2]["sec_per_week_p50"])

    def test_max_runs_iki_oyun_ve_bir_dal(self):
        self.assertEqual(self.c.cfg.MAX_RUNS, 2)
        a = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        s, _, d = cagri(self.c, "POST", f"/api/runs/{a}/branch", {"week": 3})
        self.assertEqual(s, 201, d)                                   # dal: ebeveyn korunur, ikisi birlikte yaşar
        self.assertEqual(d["state"]["parentRunId"], a)
        ids = {r["runId"] for r in cagri(self.c, "GET", "/api/runs")[2]}
        self.assertEqual(ids, {a, d["runId"]})
        for rid in ids:                                               # ikisi de abone: üçüncü koşuya yer yok
            cagri(self.c, "GET", f"/api/runs/{rid}/events")
        s, _, b = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})
        self.assertEqual((s, b["error"]["code"]), (429, "too_many_runs"))

    def test_ucuncu_kosu_abonesiz_eskiyi_cikarir(self):
        a = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        b = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        cc = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        ids = [r["runId"] for r in cagri(self.c, "GET", "/api/runs")[2]]
        self.assertEqual(sorted(ids), sorted([b, cc]))
        self.assertNotIn(a, ids)

    def test_guvenlik_denetimi_yok_ust_bilgi_gerekmez(self):
        s, _, b = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})
        self.assertEqual(s, 201, b)                                   # Origin / X-Oyun-Istek yok, yine de kabul

    def test_hata_govdeleri_http_ile_ayni(self):
        s, _, b = cagri(self.c, "GET", "/api/yok")
        self.assertEqual((s, b["error"]["code"]), (404, "not_found"))
        s, h, b = cagri(self.c, "DELETE", "/api/hello")
        self.assertEqual((s, b["error"]["code"]), (405, "method_not_allowed"))
        self.assertEqual(h["Allow"], "GET")
        s, _, b = cagri(self.c, "GET", "/api/runs/yok")
        self.assertEqual((s, b["error"]["code"]), (404, "not_found"))
        s, _, b = cagri(self.c, "POST", "/api/runs", {"config": dict(CONFIG, durationWeeks=1)})
        self.assertEqual((s, b["error"]["code"]), (422, "invalid_config"))
        r = self.c.istek("POST", "/api/runs", "{bozuk")
        self.assertEqual((r["status"], r["body"]["error"]["code"]), (400, "bad_json"))
        r = self.c.istek("POST", "/api/runs", None)
        self.assertEqual((r["status"], r["body"]["error"]["code"]), (400, "bad_json"))
        r = self.c.istek("POST", "/api/runs", "x" * (64 * 1024 + 1))
        self.assertEqual((r["status"], r["body"]["error"]["code"]), (413, "body_too_large"))

    def test_istek_json_dizge_arayuzu(self):
        out = json.loads(self.c.istek_json("POST", "/api/runs", json.dumps({"config": CONFIG})))
        self.assertEqual(out["status"], 201)
        self.assertIn("runId", out["body"])

    def test_sorgu_dizgesi_ayrilir(self):
        rid = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        adim(self.c, rid, 2)
        bekle_hafta(self.c, rid, 2)
        s, _, pk = cagri(self.c, "GET", f"/api/runs/{rid}/weeks?from=1&to=2")
        self.assertEqual((s, [p["week"] for p in pk]), (200, [1, 2]))

    def test_olay_listesi_sse_yerine(self):
        rid = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        s, _, b = cagri(self.c, "GET", f"/api/runs/{rid}/events")
        self.assertEqual(s, 200)
        ab = b["abone"]
        ilk = self.c.olaylar(ab)
        self.assertEqual([o["event"] for o in ilk["olaylar"]], ["state"])
        self.assertEqual(ilk["olaylar"][0]["id"], 1)
        adim(self.c, rid, 3)
        bekle_hafta(self.c, rid, 3)
        sonra = self.c.olaylar(ab)
        self.assertEqual([o["id"] for o in sonra["olaylar"]], list(range(2, 2 + len(sonra["olaylar"]))))      # abonelik sırası kaldığı yerden
        self.assertEqual(sum(1 for o in sonra["olaylar"] if o["event"] == "week"), 3)
        self.assertEqual(self.c.olaylar(ab)["olaylar"], [])           # boşaltıldı
        self.c.olay_kapat(ab)
        self.assertTrue(self.c.olaylar(ab)["kapandi"])
        s, _, b = cagri(self.c, "GET", "/api/runs/yok/events")
        self.assertEqual((s, b["error"]["code"]), (404, "not_found"))

    def test_cekmece_islemci_onunde_degil(self):
        rid = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        adim(self.c, rid, 3)
        bekle_hafta(self.c, rid, 3)
        s, _, b = cagri(self.c, "GET", f"/api/runs/{rid}/drawer/city/0")
        self.assertEqual((s, b["stale"], b["week"]), (200, False, 3))          # worker yalnız tick'te ilerler: yayımlanan hafta = işçi haftası

    def test_kapat_aboneleri_ve_koşuları_temizler(self):
        rid = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        d = self.c.manager._runs[rid].worker.csv_dir
        self.c.kapat()
        self.assertFalse(os.path.exists(d))


class HttpParitesi(unittest.TestCase):
    """Aynı senaryo, aynı sahte host: çekirdek ile HTTP sunucusu aynı paketleri üretir."""

    def senaryo_http(self, srv, mode=None):
        cfg = dict(CONFIG) if mode is None else {k: v for k, v in CONFIG.items() if k != "durationWeeks"} | {"mode": mode}
        s, _, h = call(srv, "POST", "/api/runs", {"config": cfg})
        rid = h["runId"]
        out = {"state0": h["state"]}
        if mode == "dao":
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            wait_week(srv, rid, 1)
            out["karar"] = call(srv, "POST", f"/api/runs/{rid}/dao/karar", {"tur": "ahirdan_cik"})[2]
        for w in range(1, 7):
            if not (mode == "dao" and w == 1):                                        # DAO'da ilk adım karardan önce atıldı
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            wait_week(srv, rid, w)
            if w == 3 and mode is None:
                out["degisiklik"] = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})[2]
        out["paketler"] = call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=6")[2]
        out["cekmece"] = call(srv, "GET", f"/api/runs/{rid}/drawer/city/0")[2]
        out["state"] = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]
        return out

    def senaryo_cekirdek(self, c, mode=None):
        cfg = dict(CONFIG) if mode is None else {k: v for k, v in CONFIG.items() if k != "durationWeeks"} | {"mode": mode}
        s, _, h = cagri(c, "POST", "/api/runs", {"config": cfg})
        rid = h["runId"]
        kopru = Kopru(c, rid)
        out = {"state0": h["state"]}
        if mode == "dao":
            adim(c, rid)
            bekle_hafta(c, rid, 1)
            out["karar"] = cagri(c, "POST", f"/api/runs/{rid}/dao/karar", {"tur": "ahirdan_cik"})[2]
        for w in range(1, 7):
            if not (mode == "dao" and w == 1):
                adim(c, rid)
            bekle_hafta(c, rid, w)
            if w == 3 and mode is None:
                out["degisiklik"] = cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})[2]
        out["paketler"] = kopru.istek("GET", f"/api/runs/{rid}/weeks?from=1&to=6")["body"]          # pencere 4: 1-2 köprüden (abone olay depodan)
        out["cekmece"] = cagri(c, "GET", f"/api/runs/{rid}/drawer/city/0")[2]
        out["state"] = cagri(c, "GET", f"/api/runs/{rid}")[2]["state"]
        return out

    def karsilastir(self, mode):
        with live_app() as (srv, _a, _w):
            h = self.senaryo_http(srv, mode)
        c = cekirdek()
        self.addCleanup(c.kapat)
        k = self.senaryo_cekirdek(c, mode)
        self.assertEqual(len(h["paketler"]), 6)
        self.assertEqual(paket_ozeti(k["paketler"]), paket_ozeti(h["paketler"]))
        self.assertEqual(k["cekmece"]["kind"], h["cekmece"]["kind"])                  # çekmece içeriği işçi önünde mi (`stale`) zamanlamaya bağlı: ayrıca sınanır (test_cekmece)
        for key in ("karar", "degisiklik"):
            if key in h:
                kk, hh = dict(k[key]), dict(h[key])
                self.assertEqual({a: b for a, b in kk.items() if a != "runId"}, {a: b for a, b in hh.items() if a != "runId"}, key)
        strip = lambda st: {a: b for a, b in st.items() if a not in ("runId", "computing", "buffering", "modelWeeksPerSec")}      # noqa: E731
        self.assertEqual(strip(k["state"]), strip(h["state"]))

    def test_kurucu_paketleri_ayni(self):
        self.karsilastir(None)

    def test_dao_paketleri_ayni(self):
        self.karsilastir("dao")


@unittest.skipIf(os.environ.get("OYUN_QUICK") == "1", "yavaş (gerçek model, alt süreç işçisi)")
@unittest.skipUnless(sys.flags.hash_randomization == 0, "PYTHONHASHSEED=0 gerekir (run_all verir)")
class GercekModelParitesi(unittest.TestCase):
    """Gerçek model, DAO, 8 hafta: tarayıcı çekirdeği (süreç içi) ile HTTP sunucusu + alt süreç işçisi aynı paketleri üretir."""
    N = 8

    def tarif(self):
        return {k: v for k, v in CONFIG.items() if k != "durationWeeks"} | {"mode": "dao"}

    def sur(self, mgr, rid, w, tick):
        if mgr.stats(rid)["released"] < w:
            mgr.control(rid, "step")
        end = time.monotonic() + 300
        while True:
            st = mgr.stats(rid)
            if st["released"] >= w and st["worker_week"] == st["released"]:
                return
            tick()
            if time.monotonic() > end:
                raise AssertionError("hafta %d gelmedi: %r" % (w, st))

    def test_cekirdek_http_ayni_paketler(self):
        import threading
        from oyun_server.http import make_server
        from oyun_server.runs import routes
        from oyun_server.sim.client import WorkerClient
        from oyun_server.sim.extract_cities import static_world_info
        d, reg = real_defaults(), real_registry()
        mgr = RunManager(reg, lambda spec: WorkerClient.spawn(spec), cfg=config)
        app = routes.App(reg, mgr, str(d["VERSION"]), "x", 10.0, None)
        app.world_info = static_world_info(d, routes.MAX_CITIES)
        srv = make_server(0, routes.make_routes(app), None, set())
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        mgr.start_thread()
        c = TarayiciCekirdegi(defaults=d, registry=reg)
        try:
            rid_h = call(srv, "POST", "/api/runs", {"config": self.tarif()})[2]["runId"]
            rid_c = cagri(c, "POST", "/api/runs", {"config": self.tarif()})[2]["runId"]
            kopru = Kopru(c, rid_c)
            kh = call(srv, "POST", f"/api/runs/{rid_h}/dao/karar", {"tur": "ahirdan_cik"})[2]
            kc = cagri(c, "POST", f"/api/runs/{rid_c}/dao/karar", {"tur": "ahirdan_cik"})[2]
            self.assertEqual(kh, kc)
            for w in range(1, self.N + 1):
                self.sur(mgr, rid_h, w, lambda: time.sleep(0.003))
                self.sur(c.manager, rid_c, w, c.tick)
                if w == 3:
                    kh = call(srv, "POST", f"/api/runs/{rid_h}/dao/karar", {"tur": "mevduat", "lonca": "lonca0", "oran": 0.3})[2]
                    kc = cagri(c, "POST", f"/api/runs/{rid_c}/dao/karar", {"tur": "mevduat", "lonca": "lonca0", "oran": 0.3})[2]
                    self.assertEqual(kh, kc)
            ph = call(srv, "GET", f"/api/runs/{rid_h}/weeks?from=1&to={self.N}")[2]
            pc = kopru.istek("GET", f"/api/runs/{rid_c}/weeks?from=1&to={self.N}")["body"]       # pencere 4: eski haftalar köprüden
            self.assertEqual(len(ph), self.N)
            self.assertEqual(paket_ozeti(pc), paket_ozeti(ph))
        finally:
            c.kapat()
            mgr.shutdown()
            srv.shutdown()
            srv.server_close()


class TarayiciTel(unittest.TestCase):
    """`wire_contract.json` uçları çekirdek üzerinden (HTTP'siz) sınanır; biçim denetçisi `test_wire_contract` ile ortak."""
    assertShape = WireContract.assertShape
    assertSettingsShape = WireContract.assertSettingsShape

    def test_uclar(self):
        c = cekirdek(sec_per_week_p50=0.5)
        self.addCleanup(c.kapat)
        self.assertShape(cagri(c, "GET", "/api/hello")[2], "hello")
        info = cagri(c, "GET", "/api/info")[2]
        rest = {k: v for k, v in info.items() if k not in ("registry", "settings", "dunyalarKalici")}
        self.assertEqual(shape_diff(rest, {k: v for k, v in FIX["info"].items() if k != "settings"}, "$"), [])
        self.assertSettingsShape(info["settings"])
        self.assertShape(cagri(c, "POST", "/api/availability", {"values": {"gecis_destegi": "kapali"}})[2], "availability_ok")
        self.assertShape(cagri(c, "POST", "/api/availability", {"values": {"gecis_destegi": "yok"}})[2], "availability_blocked")
        s, _, handle = cagri(c, "POST", "/api/runs", {"config": CONFIG})
        self.assertEqual(s, 201)
        self.assertShape(handle, "handle")
        self.assertShape(handle["state"], "state_ready")
        rid = handle["runId"]
        adim(c, rid, 3)
        bekle_hafta(c, rid, 3)
        self.assertShape(cagri(c, "GET", f"/api/runs/{rid}")[2]["state"], "state_running")
        weeks = cagri(c, "GET", f"/api/runs/{rid}/weeks?from=1&to=2")[2]
        self.assertShape(weeks, "weeks")
        self.assertShape(weeks[0], "packet")
        self.assertIn("ekonomi", weeks[0])
        s_u, _h, b_u = cagri(c, "GET", f"/api/runs/{rid}/drawer/urun/un?week=3")
        self.assertEqual(s_u, 200)
        self.assertEqual(shape_diff(b_u, FIX["drawer_urun"], "$"), [])
        self.assertShape(cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {}})[2], "change_rejected")
        self.assertEqual(cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"dunya_tohumu": 1}})[2], FIX["change_start_only"])
        multi = cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"dunya_tohumu": 1, "dunya_sabit_kalemleri": 10}})[2]
        self.assertEqual(multi, FIX["change_rejected_multi"])
        self.assertShape(cagri(c, "GET", "/api/runs/yok")[2], "error_404")
        self.assertShape(cagri(c, "POST", "/api/runs", {"config": dict(CONFIG, durationWeeks=1)})[2], "error_422")

    def test_dao_kosusu(self):
        c = cekirdek()
        self.addCleanup(c.kapat)
        s, _, handle = cagri(c, "POST", "/api/runs", {"config": {**{k: v for k, v in CONFIG.items() if k != "durationWeeks"}, "mode": "dao"}})
        self.assertEqual(s, 201, handle)
        self.assertShape(handle, "handle_dao")
        rid = handle["runId"]
        adim(c, rid, 2)
        bekle_hafta(c, rid, 2)
        self.assertShape(cagri(c, "GET", f"/api/runs/{rid}")[2]["state"], "state_dao")
        for p in cagri(c, "GET", f"/api/runs/{rid}/weeks?from=1&to=2")[2]:
            self.assertShape(p, "packet_dao")

    def test_degisiklik_ve_surum_olayi(self):
        c = cekirdek()
        self.addCleanup(c.kapat)
        rid = cagri(c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        adim(c, rid, 3)
        bekle_hafta(c, rid, 3)
        res = cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})[2]
        self.assertTrue(res["accepted"], res)
        self.assertShape(res, "change_accepted")
        adim(c, rid, 8)
        bekle_hafta(c, rid, res["seamWeek"])
        ab = cagri(c, "GET", f"/api/runs/{rid}/events")[2]["abone"]
        ol = c.olaylar(ab)["olaylar"]
        ev = next(o["data"] for o in ol if o["event"] == "world_event")
        self.assertShape(ev, "version_event")
        self.assertShape(next(o["data"] for o in ol if o["event"] == "week"), "packet")
        c.olay_kapat(ab)

    def test_hata_ve_bitis(self):
        cfg = make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0})
        c = cekirdek(cfg=cfg)
        self.addCleanup(c.kapat)
        rid = cagri(c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        ab = cagri(c, "GET", f"/api/runs/{rid}/events")[2]["abone"]
        cagri(c, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
        end = time.monotonic() + 120
        tum = []
        while time.monotonic() < end:
            c.tick()
            r = c.olaylar(ab)
            tum += r["olaylar"]
            if r["kapandi"]:
                break
        self.assertTrue(tum and tum[-1]["event"] == "ended", [o["event"] for o in tum][-3:])
        self.assertShape(tum[-1]["data"], "ended")
        self.assertShape(tum[-2]["data"], "state_ended")
        s, _, b = cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})
        self.assertEqual((s, b), (200, FIX["change_ended"]))

    def test_cokme_durumu(self):
        with mock.patch.dict(os.environ, {"OYUN_FAKE_FAIL_WEEK": "2"}):
            c = cekirdek()
            self.addCleanup(c.kapat)
            rid = cagri(c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
            state = None
            end = time.monotonic() + 30
            while time.monotonic() < end:
                adim(c, rid)
                c.tick()
                state = cagri(c, "GET", f"/api/runs/{rid}")[2]["state"]
                if state["status"] == "failed":
                    break
            self.assertEqual(state["status"], "failed")
            self.assertEqual(state["error"]["messageKey"], "hata.model_coktu")
            self.assertShape(state, "state_failed")


if __name__ == "__main__":
    unittest.main()
