"""M10 Makro göstergeler: `makro.build` haftalık `makro` paket bloğu. Salt okunur; model değişmez; en çok 900 bayt / hafta."""
from __future__ import annotations

import json
import unittest
from collections import defaultdict

from oyun_server.sim import makro as mk

from tests.test_manager import ManagerBase, CONFIG  # noqa: F401
from tests.extract_v2_helpers import QUICK, deep, fake_world, params_ns, snapshot_equal

BUTCE = 900


def _bayt(blok) -> int:
    return len(json.dumps(blok, separators=(",", ":")).encode("utf-8"))


def dunya(week=1, **kw):
    W = fake_world(week=week, **kw)
    W.L.total = lambda: sum(W.L.bal.values())
    W.L.income = defaultdict(float)
    W.L.cm_mint = W.L.cm_burn = W.L.opening = 0.0
    W.deposits = {}
    W.mortgages = []
    W.MARKET_MARKUP = 1.0
    W.series = dict(pidx=100.0, cons=1000.0, employed=10, gini=0.5, gini_inc=0.2)
    W.weekly = [dict(series=dict(pidx=100.0))]
    W.REF.update(ekmek=1.0, sut=2.0, un=4.0)
    for ci in (0, 1):
        for p in W.REF:
            W.LAND[(ci, p)] = W.REF[p]
    W.prod_w = {}
    return W


def P_(**kw):
    return params_ns(BASKET={"ekmek": 2, "sut": 1}, RENT_H=0.08, TIER_WAGE=(10, 15, 20), CYCLES_PER_WEEK=7, HOUSE_ON=True, **kw)


class Blok(unittest.TestCase):
    def setUp(self):
        self.P = P_()

    def test_anahtar_kumesi_ve_json(self):
        blok, _ = mk.build(dunya(), self.P, None)
        self.assertEqual(set(blok), {"v", "fiyat", "uretim", "para", "faiz", "marj", "konut", "dagilim", "kredi"})
        self.assertEqual(set(blok["fiyat"]), {"tuk", "enf", "uretici", "ucret", "gercek_ucret"})
        self.assertEqual(set(blok["para"]), {"stok", "korunum", "mali", "kredi_net", "acilis", "hiz"})
        self.assertEqual(json.loads(json.dumps(blok)), blok)
        self.assertLessEqual(_bayt(blok), BUTCE)

    def test_enflasyon_pol_step_ile_ayni(self):
        W = dunya()
        W.weekly = [dict(series=dict(pidx=100.0))]
        self.assertIsNone(mk.enflasyon(W, self.P))                              # < 2 haftalık kayıt: pol_step 0 alır, burada ölçülmedi
        W.weekly = [dict(series=dict(pidx=100.0 + i)) for i in range(5)]         # 5 kayıt (< 13): pencere = ilk hafta
        self.assertAlmostEqual(mk.enflasyon(W, self.P), (104.0 / 100.0 - 1.0) * (52.0 / 13), 12)
        W.weekly = [dict(series=dict(pidx=100.0 + i)) for i in range(20)]        # 20 kayıt: 13 hafta önce = weekly[-13]
        self.assertAlmostEqual(mk.enflasyon(W, self.P), (119.0 / 107.0 - 1.0) * 4.0, 12)
        W.weekly = [dict(series=dict(pidx=100.0)), dict(series=dict(pidx=400.0))]
        self.assertEqual(mk.enflasyon(W, self.P), 1.0)                          # [-1, 1] kırpma
        W.weekly = [dict(series=dict(pidx=100.0)), dict(series=dict(pidx=1.0))]
        self.assertEqual(mk.enflasyon(W, self.P), -1.0)

    def test_fiyat_ucret_gercek_ucret(self):
        W = dunya(week=3)
        W.series["pidx"] = 125.0
        W.weekly = [dict(series=dict(pidx=100.0)), dict(series=dict(pidx=110.0)), dict(series=dict(pidx=125.0))]
        W.WI = {0: 1.5, 1: 1.0}
        W.people["s0_p1"] = dict(tier=0, wage=10, firm=None, who="npc", city=0)    # şehir 0'da 2 kişi, şehir 1'de 1 kişi
        b, _ = mk.build(W, self.P, None)
        self.assertEqual(b["fiyat"]["tuk"], 1.25)
        self.assertAlmostEqual(b["fiyat"]["ucret"], round((1.5 * 2 + 1.0 * 1) / 3, 3))
        self.assertAlmostEqual(b["fiyat"]["gercek_ucret"], round(((1.5 * 2 + 1.0) / 3) / 1.25, 3))

    def test_uretici_fiyat_sepet_disi_uretim_agirlikli(self):
        W = dunya()
        W.LAND[(0, "un")] = 5.0                                                 # ara mal: un (sepette değil), referans 4
        W.LAND[(0, "ekmek")] = 9.0                                              # sepet ürünü: üretici endeksine girmez
        W.prod_w = {(0, "un"): 10.0, (1, "un"): 30.0, (0, "ekmek"): 100.0}
        b, _ = mk.build(W, self.P, None)
        self.assertEqual(b["fiyat"]["uretici"], round((10 * 5.0 + 30 * 4.0) / (40 * 4.0), 3))
        self.assertEqual(b["uretim"]["nominal"], round(10 * 5.0 + 30 * 4.0 + 100 * 9.0))
        self.assertEqual(b["uretim"]["gercek"], round(10 * 4.0 + 30 * 4.0 + 100 * 1.0))
        self.assertEqual(b["uretim"]["verimlilik"], round((10 * 4.0 + 30 * 4.0 + 100.0) / 10, 2))
        self.assertIsNone(mk.build(dunya(), self.P, None)[0]["fiyat"]["uretici"])  # üretim yok: null

    def test_buyume_13_hafta_state_ve_durum_kaybi(self):
        W = dunya(week=1)
        st = None
        gercek = []
        for w in range(1, 16):
            W.week_no = w
            W.prod_w = {(0, "un"): 100.0 + 10 * w}
            gercek.append((100.0 + 10 * w) * 4.0)
            b, st = mk.build(W, self.P, st)
            if w <= 13:
                self.assertIsNone(b["uretim"]["buyume"], w)
            else:
                self.assertEqual(b["uretim"]["buyume"], round(gercek[-1] / gercek[w - 14] - 1.0, 4))
        W.week_no = 16                                                          # durum kaybı: hafta > 1, state None -> geçmiş yok
        W.prod_w = {(0, "un"): 400.0}
        b, st2 = mk.build(W, self.P, None)
        self.assertIsNone(b["uretim"]["buyume"])
        W.week_no = 18                                                          # aradaki hafta atlandı: eski durum geçmişi sayılmaz
        b, _ = mk.build(W, self.P, st2)
        self.assertIsNone(b["uretim"]["buyume"])

    def test_para_kalemleri_ve_hiz(self):
        W = dunya()
        W.L.bal["a"] = 400.0
        W.L.bal["b"] = 600.0
        W.L.fiscal_minted, W.L.cm_mint, W.L.cm_burn, W.L.opening = 700.0, 400.0, 100.0, 0.0
        b, _ = mk.build(W, self.P, None)
        p = b["para"]
        self.assertEqual(p["stok"], round(sum(W.L.bal.values())))               # L.total()
        self.assertEqual((p["mali"], p["kredi_net"], p["acilis"]), (700, 300, 0))
        self.assertEqual(p["hiz"], round(1000.0 / p["stok"], 4))                # haftalık hane harcaması / stok

    def test_korunum_farki(self):
        W = dunya()
        W.L.bal["a"] = 400.0
        W.L.bal["b"] = 600.0
        W.L.opening = 100.0
        W.L.minted = sum(W.L.bal.values()) - 100.0
        self.assertEqual(mk.build(W, self.P, None)[0]["para"]["korunum"], 0.0)   # toplam = basılan + açılış
        W.L.bal["b"] += 5.0                                                      # kaçak/çift sayım olsaydı fark görünürdü
        self.assertEqual(mk.build(W, self.P, None)[0]["para"]["korunum"], 5.0)

    def test_faiz_agirlikli_ve_gercek_faiz(self):
        W = dunya()
        W.POL_ON, W.pol = True, [0.004]
        W.loncas = ["lonca0", "lonca1"]
        W.dep_tot = {"lonca0": 100.0, "lonca1": 300.0}
        W.dep_ema = {"lonca0": 0.001, "lonca1": 0.002}
        W.loans = {"f": dict(out=100.0, rate=0.01)}
        W.mortgages = [dict(out=300.0, rate=0.02)]
        W.weekly = [dict(series=dict(pidx=100.0)), dict(series=dict(pidx=101.0))]
        W.series["pidx"] = 101.0
        enf = (1.01 - 1.0) * 4.0
        b, _ = mk.build(W, self.P, None)
        f = b["faiz"]
        self.assertEqual(f["politika"], round(1.004 ** 52 - 1.0, 4))
        self.assertEqual(f["mevduat"], round((1 + (0.001 * 100 + 0.002 * 300) / 400) ** 52 - 1.0, 4))
        self.assertEqual(f["kredi"], round((1 + (0.01 * 100 + 0.02 * 300) / 400) ** 52 - 1.0, 4))
        self.assertAlmostEqual(f["gercek"], round((1.004 ** 52) / (1.0 + enf) - 1.0, 4), 3)
        W.POL_ON = False
        self.assertIsNone(mk.build(W, self.P, None)[0]["faiz"]["politika"])
        self.assertIsNone(mk.build(W, self.P, None)[0]["faiz"]["gercek"])

    def test_kar_marji_npc_oyuncu_kamu_haric(self):
        W = dunya()
        W.L.frev = defaultdict(float, {"n1": 100.0, "o1": 200.0, "k1": 500.0})
        W.L.fexp = {"n1": {"ucret": 60.0, "x": 30.0}, "o1": {"ucret": 250.0}, "k1": {"ucret": 1.0}}
        W.firms = {"n1": dict(kind="un", owner=None, workers=[]), "o1": dict(kind="un", owner="p", workers=[]), "k1": dict(kind="belediye", owner=None, workers=[])}
        b, _ = mk.build(W, self.P, None)
        self.assertEqual(b["marj"], {"npc": 0.1, "oyuncu": -0.25})

    def test_konut_kira_endeksi_ve_kira_gelir_orani(self):
        W = dunya()
        W.RENT_CY = {0: 0.8 * 10 * 1.5, 1: 0.8 * 10 * 1.5}                       # taban = RENT_H x TIER_WAGE[0] = 0.8; %50 artış
        W.L.income = defaultdict(float, {"s0_p0": 70.0, "s1_p0": 70.0})
        b, _ = mk.build(W, self.P, None)
        self.assertEqual(b["konut"]["kira"], 1.5 * 10)                          # 12 / 0.8 = 15
        self.assertEqual(b["konut"]["kira_gelir"], round(12.0 * 7 / 70.0, 4))
        kapali = params_ns(BASKET={"ekmek": 2, "sut": 1}, HOUSE_ON=False, RENT_H=0.08, TIER_WAGE=(10,), CYCLES_PER_WEEK=7)
        self.assertIsNone(mk.build(W, kapali, None)[0]["konut"])                # konut modeli kapalı: ölçülmüyor

    def test_gini_yoksulluk(self):
        W = dunya()
        W.people = {f"p{i}": dict(tier=0, wage=10, firm=None, who="oyuncu", city=i % 2) for i in range(4)}
        for i, v in enumerate((0.0, 0.0, 0.0, 100.0)):
            W.L.bal[f"p{i}"] = v
        W.deposits = {"p0": ("lonca0", 0.0)}
        W.L.income = defaultdict(float, {"p0": 5.0, "p1": 10.0, "p2": 100.0, "p3": 200.0})
        b, _ = mk.build(W, self.P, None)
        d = b["dagilim"]
        self.assertEqual(d["gini_nakit"], 0.75)                                 # tek kişide tüm servet, n = 4: (n-1)/n
        self.assertEqual((d["gini_gelir"], d["gini_servet"]), (0.2, 0.5))       # modelin W.series alanları
        # tam sepet = (2 x 1 + 1 x 2) x 1.0 = 4: yalnız geliri 4'ün altında olan yoksul sayılır -> hiçbiri; sepeti 50'ye çıkar
        self.assertEqual(d["yoksul"], 0.0)
        W.LAND[(0, "ekmek")] = W.LAND[(1, "ekmek")] = 24.0                       # sepet = 2 x 24 + 2 = 50
        d2 = mk.build(W, self.P, None)[0]["dagilim"]
        self.assertEqual(d2["yoksul"], 0.5)                                     # 5 ve 10 < 50
        self.assertEqual(d2["medyan_sepet"], round(100.0 / 50.0, 3))            # sıralı gelir [5, 10, 100, 200], ortanca indeks 2

    def test_kredi_stok_buyume_temerrut(self):
        W = dunya(week=1)
        W.loans = {f"f{i}": dict(out=100.0, rate=0.01) for i in range(3)}
        W.mortgages = [dict(out=50.0, rate=0.02)]
        W.L.flows["temerrut_adet"] = 0.0
        b, st = mk.build(W, self.P, None)
        self.assertEqual(b["kredi"]["stok"], 350)
        self.assertEqual(b["kredi"]["temerrut"], 0.0)
        W.week_no = 2
        W.L.flows["temerrut_adet"] = 1.0                                        # bu hafta 1 temerrüt, açık 4 kredi
        b2, st = mk.build(W, self.P, st)
        self.assertEqual(b2["kredi"]["temerrut"], round(1 / 5, 4))
        W.week_no = 5                                                           # atlanan hafta: fark null
        b3, _ = mk.build(W, self.P, st)
        self.assertIsNone(b3["kredi"]["temerrut"])
        b4, _ = mk.build(W, self.P, None)                                       # durum yok, hafta > 1
        self.assertIsNone(b4["kredi"]["temerrut"])

    def test_okunamayan_alan_null_atar_dusmez(self):
        W = dunya()
        W.weekly = []
        W.series = {}
        W.prod_w = {}
        W.L.fexp = None
        b, _ = mk.build(W, self.P, None)
        self.assertIsNone(b["fiyat"]["tuk"])
        self.assertIsNone(b["para"]["hiz"])
        self.assertEqual(b["marj"], {"npc": None, "oyuncu": None})

    def test_W_degismez(self):
        W = dunya()
        W.L.frev = defaultdict(float, {"n1": 100.0})
        W.L.fexp = {"n1": {"ucret": 60.0}}
        W.firms = {"n1": dict(kind="un", owner=None, workers=[])}
        W.prod_w = {(0, "un"): 5.0}
        W.loncas = ["lonca0"]
        W.POL_ON, W.pol = True, [0.003]
        before = deep(W)
        _, st = mk.build(W, self.P, None)
        mk.build(W, self.P, st)
        snapshot_equal(self, W, before, "makro.build")


class PaketYolu(unittest.TestCase):
    def test_make_packet_makro_yalniz_verilirse(self):
        from oyun_server.sim.extract import make_packet
        row = {"week": 1}
        self.assertNotIn("makro", make_packet("r", 1, 1, row))
        blok = {"v": 1}
        self.assertIs(make_packet("r", 1, 1, row, makro=blok)["makro"], blok)

    def test_sahte_host_snapshot_makro_icerir_ve_butce(self):
        from oyun_server.testing import FakeHost
        h = FakeHost("", {}, weeks=60)
        for _ in range(60):
            h.step()
            blok = h.snapshot()["makro"]
            self.assertEqual(blok["v"], 1)
            self.assertEqual(set(blok), {"v", "fiyat", "uretim", "para", "faiz", "marj", "konut", "dagilim", "kredi"})
            self.assertLessEqual(_bayt(blok), BUTCE)


@unittest.skipIf(QUICK, "gerçek model")
class GercekHost(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from oyun_server import config
        from oyun_server.sim.host import ModelHost
        cls.config, cls.ModelHost = config, ModelHost

    def host(self):
        h = self.ModelHost(str(self.config.MODEL_ROOT), {}, 200)
        self.addCleanup(h.close)
        return h

    def test_yuk_butcesi_52_hafta_ve_model_satiri_ayni(self):
        h, g = self.host(), self.host()
        bayt = []
        for _ in range(52):
            ra = h.step()
            blok = h.snapshot()["makro"]
            bayt.append(_bayt(blok))
            self.assertEqual(ra, g.step(), "blok açıkken model satırı değişti")
        print("makro bayt (52 hafta), maks:", max(bayt), "ort:", round(sum(bayt) / len(bayt)))
        self.assertLessEqual(max(bayt), BUTCE)

    def test_blok_dolu_enflasyon_pol_step_ile_ayni_ve_W_degismez(self):
        h = self.host()
        st = None
        blok_onceki = None
        for w in range(1, 30):
            h.step()
            W = h._W
            if blok_onceki is not None and getattr(W, "POL_ON", False) and W.pol_hist and W.pol_hist[-1][0] == w:
                self.assertAlmostEqual(W.pol_hist[-1][3], blok_onceki, 12, f"hafta {w}: pol_step enflasyonu")   # kural geçen haftanın sonunu görür
            before = deep(W)
            blok, st = mk.build(W, h._P, st)
            snapshot_equal(self, W, before, "makro.build (gerçek)")
            blok_onceki = mk.enflasyon(W, h._P)
            if blok_onceki is None:
                blok_onceki = 0.0 if w < 2 else None
        b = blok
        self.assertEqual(b["para"]["stok"], round(h._W.L.total()))
        self.assertEqual(b["para"]["korunum"], 0.0)                              # M14: gerçek modelde para korunumu farkı sıfır
        self.assertIsNotNone(b["fiyat"]["tuk"])
        self.assertIsNotNone(b["uretim"]["gercek"])
        self.assertIsNotNone(b["uretim"]["buyume"])
        self.assertIsNotNone(b["dagilim"]["gini_nakit"])
        self.assertIsNotNone(b["dagilim"]["yoksul"])
        self.assertIsNotNone(b["faiz"]["politika"])

    def test_snapshot_makro_tekrar_cagri_durumu_ilerletmez(self):
        h = self.host()
        h.step()
        s1 = h.snapshot()
        durum = h._makro_state
        self.assertEqual(h.snapshot()["makro"], s1["makro"])
        self.assertIs(h._makro_state, durum)

    def test_blok_hatasi_kosuyu_dusurmez(self):
        import contextlib
        import io
        from unittest import mock
        h = self.host()
        err = io.StringIO()
        with mock.patch.object(mk, "build", side_effect=RuntimeError("bozuk")), contextlib.redirect_stderr(err):
            h.step()
            s1 = h.snapshot()
            h.step()
            s2 = h.snapshot()
        for s in (s1, s2):
            self.assertIn("cities", s)
            self.assertIn("ekonomi", s)
            self.assertNotIn("makro", s)
        self.assertEqual(err.getvalue().count("Traceback (most recent call last)"), 1)
        self.assertIsNone(h._makro_state)

    def test_yeni_host_orta_kosuda_buyume_null(self):
        h = self.host()
        for _ in range(15):
            h.step()
            b = h.snapshot()["makro"]
        self.assertIsNotNone(b["uretim"]["buyume"])
        h._makro_state = None                                                   # durum kaybı
        h.step()
        self.assertIsNone(h.snapshot()["makro"]["uretim"]["buyume"])


@unittest.skipIf(QUICK, "gerçek model")
class OlcumAraci(unittest.TestCase):
    """C: ölçüm aracı (olc9.py `<ad>_makro.csv`) sunucudaki makro.py ile AYNI formülleri kullanır (ortak kaynak); CSV değerleri paket bloğunun yuvarlanmamış hâlidir."""

    def test_olc9_makro_csv_paket_blogu_ile_esit(self):
        import csv
        import importlib.util
        import tempfile
        from pathlib import Path
        from oyun_server import config
        from oyun_server.sim.host import ModelHost
        yol = Path(config.MODEL_ROOT) / "ornek-ciktilar" / "m9-araclar" / "olc9.py"
        spec = importlib.util.spec_from_file_location("olc9_test", yol)
        olc9 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(olc9)
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        self.addCleanup(h.close)
        P = h._mods["simkit.params"]
        ol = olc9.Olc(P.PROD_OF, P=P)
        st = None
        bloklar = []
        for _ in range(16):
            h.step()
            ol.hafta(h._W, h.week)
            b, st = mk.build(h._W, P, st)                     # sunucu yolu (bağımsız durum)
            bloklar.append(b)
        self.assertIs(ol._makro_mod, mk, "olc9 sunucudaki makro.py'yi yüklemeli (kopya değil)")
        with tempfile.TemporaryDirectory() as d:
            def yaz(yol_, satirlar):
                with open(yol_, "w", newline="") as fh:
                    ad = []
                    for r in satirlar:
                        for k in r:
                            if k not in ad:
                                ad.append(k)
                    wr = csv.DictWriter(fh, fieldnames=ad, restval="")
                    wr.writeheader()
                    wr.writerows(satirlar)
            ol.yaz(d + "/x", yaz)
            satirlar = list(csv.DictReader(open(d + "/x_makro.csv", newline="")))
        self.assertEqual(len(satirlar), 16)
        for s, b in zip(satirlar, bloklar):
            for g, alanlar in b.items():
                if g == "v" or alanlar is None:
                    continue
                for k, v in alanlar.items():
                    hucre = s[f"{g}_{k}"]
                    if v is None:
                        self.assertEqual(hucre, "", f"hafta {s['hafta']} {g}_{k}")
                    else:
                        nd = mk._YUVARLA[g][k]
                        self.assertAlmostEqual(float(hucre), v, delta=0.5 * 10 ** (-nd) + 1e-9, msg=f"hafta {s['hafta']} {g}_{k}")   # CSV ham, blok yuvarlanmış
        son = satirlar[-1]
        self.assertTrue(0 <= float(son["isgucu_issizlik"]) <= 1)
        self.assertTrue(0 <= float(son["isgucu_istihdam"]) <= 1)


class ManagerYolu(ManagerBase):
    def test_manager_paketine_makro_gecer(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: self.mgr.stats(rid)["worker_week"] >= 2)
        p1, p2 = m.weeks(rid, 1, 2)
        self.assertEqual(p1["makro"]["v"], 1)
        self.assertEqual(p2["makro"], self.hosts[0].fake_makro())


if __name__ == "__main__":
    unittest.main()
