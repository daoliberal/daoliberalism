"""B3: tarayıcı kipi bellek kırpması (model davranışı değişmez; yalnız bellek).

- Yönetici: tarayıcı kipinde `run.packets` yalnız son `PAKET_PENCERESI` (4) haftayı tutar; eski haftalar abonelere zaten gitmiştir (JS/IndexedDB tutar),
  `/weeks` ve çekmece isteği pencere dışına düşerse çekirdek `arsiv_gerek` ile köprüden o haftaları ister. Tanılar (S4) tam geçmişi okur: geçmiş dünya listesi ayrıdır.
- Host: `hafiza` bayrağı (yalnız tarayıcı kipi) her hafta adımından sonra modelin okunmayan geçmişini bırakır; sunucu kipi (bayrak yok) aynen kalır.
Sahte host ile biçim/mantık, gerçek modelle (yavaş) bayt eşitliği sınanır.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from unittest import mock

from oyun_server import config
from oyun_server.runs import manager as M
from oyun_server.runs.manager import RunManager
from oyun_server.sim import host as host_mod
from oyun_server.sim import worker as worker_mod
from oyun_server.tarayici.cekirdek import PAKET_PENCERESI, TarayiciCekirdegi
from oyun_server.tarayici.istemci import InProcClient

from tests.route_helpers import CONFIG
from tests.test_tarayici_cekirdek import adim, bekle_hafta, cagri, cekirdek


def paketsiz(p):
    q = copy.deepcopy(p)
    q.pop("run_id", None)
    return q


def kos(c, n):
    rid = cagri(c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
    ab = cagri(c, "GET", f"/api/runs/{rid}/events")[2]["abone"]
    adim(c, rid, n)
    bekle_hafta(c, rid, n)
    return rid, ab


def hafta_olaylari(c, ab):
    return [o["data"] for o in c.olaylar(ab)["olaylar"] if o["event"] == "week"]


class PaketPenceresi(unittest.TestCase):
    def setUp(self):
        self.c = cekirdek()
        self.addCleanup(self.c.kapat)
        self.tam = cekirdek(paket_penceresi=None)                 # karşılaştırma: paket penceresi yok (yönetici paketlerin hepsini tutar; host `hafiza` yine açık)
        self.addCleanup(self.tam.kapat)

    def test_varsayilan_pencere_dort(self):
        self.assertEqual(PAKET_PENCERESI, 4)
        self.assertEqual(self.c.manager.packet_keep, 4)
        self.assertIsNone(self.tam.manager.packet_keep)

    def test_sunucu_yoneticisi_pencere_yok(self):
        self.assertIsNone(RunManager.packet_keep)                      # sınıf varsayılanı None: yalnız tarayıcı çekirdeği pencere kurar

    def test_son_dort_hafta_tutulur_abone_hepsini_alir(self):
        rid, ab = kos(self.c, 10)
        run = self.c.manager._runs[rid]
        self.assertEqual([p["week"] for p in run.packets], [7, 8, 9, 10])
        self.assertEqual(run.released, 10)
        self.assertEqual(run.packet_base, 6)
        self.assertEqual([p["week"] for p in hafta_olaylari(self.c, ab)], list(range(1, 11)))

    def test_pencere_disi_tam_kosuyla_birebir_ayni_paketler(self):
        rid, ab = kos(self.c, 10)
        rid2, _ = kos(self.tam, 10)
        a = [paketsiz(p) for p in hafta_olaylari(self.c, ab)]
        b = [paketsiz(p) for p in self.tam.manager._runs[rid2].packets]
        self.assertEqual(len(self.tam.manager._runs[rid2].packets), 10)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_weeks_pencere_icinde_dogrudan(self):
        rid, _ = kos(self.c, 10)
        r = self.c.istek("GET", f"/api/runs/{rid}/weeks?from=7&to=10")
        self.assertEqual((r["status"], [p["week"] for p in r["body"]]), (200, [7, 8, 9, 10]))
        self.assertNotIn("arsiv_gerek", r)

    def test_weeks_pencere_disi_arsiv_ister_ve_birlestirir(self):
        rid, ab = kos(self.c, 10)
        gelen = hafta_olaylari(self.c, ab)                         # JS'in sakladığı paketler
        r = self.c.istek("GET", f"/api/runs/{rid}/weeks?from=3&to=10")
        self.assertEqual(r["arsiv_gerek"], {"runId": rid, "from": 3, "to": 6})
        self.assertEqual(r["status"], 0)
        arsiv = [p for p in gelen if 3 <= p["week"] <= 6]
        r2 = self.c.istek("GET", f"/api/runs/{rid}/weeks?from=3&to=10", None, arsiv)
        self.assertEqual((r2["status"], [p["week"] for p in r2["body"]]), (200, list(range(3, 11))))
        self.assertNotIn("arsiv_gerek", r2)
        self.assertEqual(json.dumps(r2["body"], sort_keys=True), json.dumps(json.loads(json.dumps(gelen[2:])), sort_keys=True))
        self.assertEqual(self.c.manager._arsiv, {})                # geçici: çağrıdan sonra temiz

    def test_weeks_gecersiz_aralik_arsiv_istemez(self):
        rid, _ = kos(self.c, 10)
        r = self.c.istek("GET", f"/api/runs/{rid}/weeks?from=0&to=3")
        self.assertEqual(r["status"], 422)
        r = self.c.istek("GET", "/api/runs/yok/weeks?from=1&to=3")
        self.assertEqual(r["status"], 404)

    def test_cekmece_eski_hafta_arsivle_tam_kosu_ile_ayni(self):
        rid, ab = kos(self.c, 10)
        rid2, _ = kos(self.tam, 10)
        gelen = hafta_olaylari(self.c, ab)
        r = self.c.istek("GET", f"/api/runs/{rid}/drawer/city/0?week=3")
        self.assertEqual(r["arsiv_gerek"], {"runId": rid, "from": 3, "to": 3})
        r2 = self.c.istek("GET", f"/api/runs/{rid}/drawer/city/0?week=3", None, [gelen[2]])
        ref = self.tam.istek("GET", f"/api/runs/{rid2}/drawer/city/0?week=3")
        self.assertEqual((r2["status"], r2["body"]), (ref["status"], ref["body"]))

    def test_istek_json_arsiv_alanlari(self):
        rid, ab = kos(self.c, 10)
        gelen = hafta_olaylari(self.c, ab)
        s = json.loads(self.c.istek_json("GET", f"/api/runs/{rid}/weeks?from=1&to=10"))
        self.assertEqual(s["arsiv_gerek"], {"runId": rid, "from": 1, "to": 6})
        s2 = json.loads(self.c.istek_json("GET", f"/api/runs/{rid}/weeks?from=1&to=10", None, json.dumps(gelen[:6])))
        self.assertEqual((s2["status"], len(s2["body"])), (200, 10))

    def test_tani_gecmisi_pencereden_bagimsiz_tam(self):
        gorulen = {}
        gercek = M.diagnostics.evaluate_run

        def spy(worlds, versions, version_sets, reg, rules=None):
            gorulen["n"], gorulen["vn"] = len(worlds), len(versions)
            gorulen.setdefault("ilk", []).append(worlds[0] if worlds else None)
            return gercek(worlds, versions, version_sets, reg, rules)

        with mock.patch.object(M.diagnostics, "evaluate_run", spy):
            rid, _ = kos(self.c, 9)
            self.assertEqual(len(self.c.manager._runs[rid].packets), 4)
        self.assertEqual((gorulen["n"], gorulen["vn"]), (9, 9))     # son çağrı tam geçmişi okur
        self.assertEqual(len({id(x) for x in gorulen["ilk"]}), 1)     # her çağrıda geçmişin ilk haftası aynı (1. hafta)

    def test_tani_ciktisi_tam_kosuyla_ayni(self):
        rid, ab = kos(self.c, 12)
        rid2, _ = kos(self.tam, 12)
        a = [p.get("diagnostics") for p in hafta_olaylari(self.c, ab)]
        b = [p.get("diagnostics") for p in self.tam.manager._runs[rid2].packets]
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_dao_gozlem_son_paketten(self):
        rid, _ = kos(self.c, 6)
        self.assertEqual(self.c.manager._runs[rid].packets[-1]["week"], 6)
        self.assertEqual(self.c.manager._packet_at(self.c.manager._runs[rid], 6)["week"], 6)
        self.assertIsNone(self.c.manager._packet_at(self.c.manager._runs[rid], 2))      # yayımlanmış ama pencere dışı: köprüden gelmedikçe yok
        self.assertIsNone(self.c.manager._packet_at(self.c.manager._runs[rid], 7))      # yayımlanmamış

    # ---- düzeltme turu 1 ------------------------------------------------------------------------------------
    def test_abonesiz_haftalar_kaybolmaz_abone_gelince_hepsi_oynar(self):          # Ö1
        rid = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        adim(self.c, rid, 10)
        bekle_hafta(self.c, rid, 10)
        run = self.c.manager._runs[rid]
        self.assertEqual((len(run.packets), run.packet_base), (10, 0))            # abone yok: kırpma yok
        ab = cagri(self.c, "GET", f"/api/runs/{rid}/events")[2]["abone"]
        self.assertEqual([p["week"] for p in hafta_olaylari(self.c, ab)], list(range(1, 11)))
        adim(self.c, rid, 1)
        bekle_hafta(self.c, rid, 11)
        self.assertEqual((len(run.packets), run.packet_base), (4, 7))             # abone varken kırpılır
        self.assertEqual([p["week"] for p in hafta_olaylari(self.c, ab)], [11])

    def test_abone_kapaninca_aralikta_paket_tutulur(self):                         # Ö1 (a)
        rid, ab = kos(self.c, 6)
        self.c.olay_kapat(ab)
        adim(self.c, rid, 4)
        bekle_hafta(self.c, rid, 10)
        run = self.c.manager._runs[rid]
        self.assertEqual([p["week"] for p in run.packets][-5:], [6, 7, 8, 9, 10])
        ab2 = cagri(self.c, "GET", f"/api/runs/{rid}/events")[2]["abone"]
        self.assertEqual([p["week"] for p in hafta_olaylari(self.c, ab2)], [p["week"] for p in run.packets])
        self.assertEqual(run.packet_base + len(run.packets), run.released)

    def test_arsiv_sinif_duzeyinde_degil(self):                                    # K3
        self.assertNotIn("_arsiv", vars(RunManager))
        self.assertIsNot(self.c.manager._arsiv, self.tam.manager._arsiv)

    def test_arsiv_paketi_kosu_ve_hafta_dogrulanir(self):                          # K4
        rid, ab = kos(self.c, 10)
        gelen = hafta_olaylari(self.c, ab)
        yol = f"/api/runs/{rid}/weeks?from=3&to=6"
        yanlis = [dict(p, run_id="baska") for p in gelen[2:6]]
        self.assertEqual(self.c.istek("GET", yol, None, yanlis)["arsiv_gerek"], {"runId": rid, "from": 3, "to": 6})
        boolw = [dict(gelen[0], week=True)]
        r = self.c.istek("GET", f"/api/runs/{rid}/weeks?from=1&to=1", None, boolw)
        self.assertEqual(r["arsiv_gerek"], {"runId": rid, "from": 1, "to": 1})
        self.assertEqual(self.c.istek("GET", yol, None, gelen[2:6])["status"], 200)

    def test_paket_penceresi_gecersiz_acik_hata(self):                              # K5
        for v in (0, -1, 1.5, True):
            with self.assertRaises(ValueError):
                cekirdek(paket_penceresi=v)

    def test_weeks_tamamen_pencere_disi_yalniz_arsiv(self):                         # K5
        rid, ab = kos(self.c, 10)
        gelen = hafta_olaylari(self.c, ab)
        r = self.c.istek("GET", f"/api/runs/{rid}/weeks?from=2&to=5", None, gelen[1:5])
        self.assertEqual([p["week"] for p in r["body"]], [2, 3, 4, 5])

    def test_kismi_arsiv_eksik_araligi_ister(self):                                 # K5
        rid, ab = kos(self.c, 10)
        gelen = hafta_olaylari(self.c, ab)
        r = self.c.istek("GET", f"/api/runs/{rid}/weeks?from=3&to=10", None, gelen[2:4])        # 3,4 var; 5,6 eksik
        self.assertEqual(r["arsiv_gerek"], {"runId": rid, "from": 5, "to": 6})

    def test_bitmis_kosuya_abonelik_pencereyi_oynatir(self):                        # K5
        rid = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        run = self.c.manager._runs[rid]
        run.duration = 8
        ab = cagri(self.c, "GET", f"/api/runs/{rid}/events")[2]["abone"]
        adim(self.c, rid, 8)
        bekle_hafta(self.c, rid, 8)
        self.assertEqual(run.status, "ended")
        ab2 = cagri(self.c, "GET", f"/api/runs/{rid}/events")[2]["abone"]
        olaylar = self.c.olaylar(ab2)["olaylar"]
        self.assertEqual([o["data"]["week"] for o in olaylar if o["event"] == "week"], [5, 6, 7, 8])
        self.assertIn("ended", [o["event"] for o in olaylar])
        self.assertEqual([p["week"] for p in hafta_olaylari(self.c, ab)], list(range(1, 9)))      # ilk abone hepsini aldı

    def test_yarista_arsiv_yeniden_gerekir_ikinci_yineleme_tamam(self):             # K2
        rid, ab = kos(self.c, 10)
        depo = {p["week"]: p for p in hafta_olaylari(self.c, ab)}
        yol = f"/api/runs/{rid}/weeks?from=1&to=10"
        r = self.c.istek("GET", yol)
        self.assertEqual(r["arsiv_gerek"]["to"], 6)
        adim(self.c, rid, 1)                                                          # köprü IndexedDB'yi beklerken tick bir hafta yayımladı
        bekle_hafta(self.c, rid, 11)
        depo.update({p["week"]: p for p in hafta_olaylari(self.c, ab)})
        r = self.c.istek("GET", yol, None, [depo[w] for w in range(1, 7)])
        self.assertEqual(r["arsiv_gerek"], {"runId": rid, "from": 7, "to": 7})       # yeni düşen hafta
        r = self.c.istek("GET", yol, None, [depo[w] for w in range(1, 8)])
        self.assertEqual((r["status"], len(r["body"])), (200, 10))


class HostFlagleri(unittest.TestCase):
    def test_istemci_host_fabrikasina_hafiza_verir(self):
        gorulen = []

        def hf(cmd):
            gorulen.append(dict(cmd))
            from oyun_server.testing import FakeHost
            return FakeHost("", cmd.get("overrides", {}), cmd.get("weeks", 5))

        cl = InProcClient({}, hf)
        cl.send({"cmd": "init", "overrides": {}, "weeks": 5})
        self.assertTrue(gorulen[0]["hafiza"])
        cl.kill()

    def test_sunucu_make_host_hafiza_yok(self):
        yakalanan = {}

        class Sahte:
            def __init__(self, *a, **kw):
                yakalanan.update(kw)

        with mock.patch.object(host_mod, "ModelHost", Sahte):
            worker_mod.make_host({"host": "model", "overrides": {}, "weeks": 3, "model_root": str(config.MODEL_ROOT)})
        self.assertFalse(yakalanan.get("hafiza", False))
        yakalanan.clear()
        with mock.patch.object(host_mod, "ModelHost", Sahte):
            worker_mod.make_host({"host": "model", "overrides": {}, "weeks": 3, "model_root": str(config.MODEL_ROOT), "hafiza": True})
        self.assertIs(yakalanan.get("hafiza"), True)


class KosuSonuRaporu(unittest.TestCase):
    """Model geçmişi olayları (`L.events`, `W.weekly[i]["events"]`) yalnız koşu sonu raporunu besler (`simkit/report.py:183`, `build_report`). Oyun sunucusu ve tarayıcı çekirdeği
    o raporu hiç üretmez (host haftayı `week_step` ile adımlar; `run_world`, `W.results()`, `measure_finish`, `build_report` yalnız toplu araçlarda): `hafiza` kırpması bu yüzden
    görünür bir şey kaybettirmez. Biri bu çağrılardan birini oyun yoluna eklerse bu test kırmızı olur: önce olay geçmişinin nereden geleceği (JS/IndexedDB) kararlaştırılmalı."""

    YASAK = {"build_report", "results", "measure_finish", "run_world", "report_text"}

    def test_oyun_sunucusu_rapor_uretici_cagirmaz(self):
        import ast
        from pathlib import Path
        kok = Path(config.SERVER_ROOT) / "oyun_server"
        bulunan = []
        for yol in sorted(kok.rglob("*.py")):
            for n in ast.walk(ast.parse(yol.read_text(encoding="utf-8"))):
                if isinstance(n, ast.Call):
                    f = n.func
                    ad = f.attr if isinstance(f, ast.Attribute) else (f.id if isinstance(f, ast.Name) else None)
                    if ad in self.YASAK:
                        bulunan.append("%s:%d %s" % (yol.relative_to(kok), n.lineno, ad))
        self.assertEqual(bulunan, [])

    @unittest.skipIf(os.environ.get("OYUN_QUICK") == "1", "yavaş (gerçek model)")
    def test_tarayici_kipinde_rapor_uretici_calismaz_davranissal(self):                # K8
        def patla(*a, **k):
            raise AssertionError("koşu sonu raporu üretici çağrıldı")
        c = TarayiciCekirdegi()
        self.addCleanup(c.kapat)
        rid = c.istek("POST", "/api/runs", {"config": CONFIG})["body"]["runId"]
        host = c.manager._runs[rid].worker.core.host
        for modul, ad in (("simkit.report", "build_report"), ("simkit.engine", "run_world"), ("simkit.measure", "measure_finish")):
            m = host._mods.get(modul)
            if m is not None and hasattr(m, ad):
                pt = mock.patch.object(m, ad, patla)
                pt.start()
                self.addCleanup(pt.stop)
        pt = mock.patch.object(host._W, "results", patla)
        pt.start()
        self.addCleanup(pt.stop)
        adim(c, rid, 2)
        bekle_hafta(c, rid, 2)
        self.assertEqual(c.manager.stats(rid)["released"], 2)


@unittest.skipIf(os.environ.get("OYUN_QUICK") == "1", "yavaş (gerçek model)")
class GercekModelKirpma(unittest.TestCase):
    N = 3

    def _kos(self, hafiza):
        h = host_mod.ModelHost(str(config.MODEL_ROOT), {}, 200, 5, hafiza=hafiza)
        rows, snaps, izler = [], [], []
        try:
            for _ in range(self.N):
                rows.append(json.dumps(h.step(), sort_keys=True, default=repr))
                facts = h.facts()
                snaps.append(json.dumps([facts, h.snapshot()], sort_keys=True, default=repr))
                W = h._W
                sizes = {n: os.path.getsize(os.path.join(h._csv_dir, "w.csv" + n)) for n in (".sx", ".st") if os.path.exists(os.path.join(h._csv_dir, "w.csv" + n))}
                izler.append(dict(events=len(W.L.events), weekly_events=sum(len(r["events"]) for r in W.weekly), wk_csv=len(W.wk_csv), sizes=sizes))
        finally:
            h.close()
        return rows, snaps, izler

    def test_hafiza_cikti_ayni_gecmis_birakilir(self):
        r0, s0, i0 = self._kos(False)
        r1, s1, i1 = self._kos(True)
        self.assertEqual(r0, r1)                                      # model satırları bayt bayt aynı
        self.assertEqual(s0, s1)                                      # facts + snapshot aynı
        self.assertEqual(i0[-1]["wk_csv"], self.N)                    # sunucu kipi: tam geçmiş
        self.assertGreater(i0[-1]["sizes"][".sx"], 0)
        for iz in i1:                                                 # tarayıcı kipi: her adımdan sonra bırakılır
            self.assertEqual((iz["events"], iz["weekly_events"]), (0, 0))
            self.assertLessEqual(iz["wk_csv"], 1)
            self.assertEqual(iz["sizes"], {".sx": 0, ".st": 0})

    def test_kirp_olay_gecmisini_dogrudan_birakir(self):
        h = host_mod.ModelHost(str(config.MODEL_ROOT), {}, 200, 5, hafiza=True)
        try:
            h.step()
            W = h._W
            W.L.events.extend(["YETMEDİ alım: a b 1.0 birimin %50'i", "YETMEDİ kira: a → b 1.00 (bakiye 0.00)"])
            W.weekly[-1]["events"] = list(W.L.events)
            W.wk_csv.append({"hafta": 99})
            h._kirp()
            self.assertEqual((W.L.events, W.weekly[-1]["events"], len(W.wk_csv)), ([], [], 1))
            self.assertEqual(W.wk_csv[-1], {"hafta": 99})                     # yalnız SON satır kalır
            h.step()                                                          # sonraki hafta: ev0 = 0, dilim tamam
            self.assertEqual(W.ev0, 0)
        finally:
            h.close()


if __name__ == "__main__":
    unittest.main()
