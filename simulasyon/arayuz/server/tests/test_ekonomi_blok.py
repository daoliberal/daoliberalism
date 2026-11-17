"""M10 Görev 1: `extract_ekonomi.build` haftalık `ekonomi` bloğu. Salt okunur; model değişmez."""
from __future__ import annotations

import json
import unittest
from collections import defaultdict

from oyun_server.sim import extract_ekonomi as ex

from tests.test_manager import ManagerBase, CONFIG  # noqa: F401
from tests.extract_v2_helpers import QUICK, deep, fake_world, params_ns, real_run, snapshot_equal


def dunya(**kw):
    W = fake_world(**kw)
    W.gate = defaultdict(float)
    W.gate_c = defaultdict(float)
    W.deposits = {}
    return W


def gate_koy(W, g, **vals):
    for k, v in vals.items():
        W.gate[(g, "tuk_" + k)] = v


def firma(W, ad, kind, city, n, dead=False, who="npc"):
    ws = []
    for j in range(n):
        q = f"{ad}_w{j}"
        W.people[q] = dict(tier=0, wage=10, firm=ad, who=who, city=city)
        ws.append(q)
    W.firms[ad] = dict(kind=kind, city=city, workers=ws, dead=dead)


class Blok(unittest.TestCase):
    def setUp(self):
        self.P = params_ns(CYCLES_PER_WEEK=7)

    def test_blok_anahtar_kumesi(self):
        blok, _ = ex.build(dunya(), self.P, None, None)
        self.assertEqual(set(blok), {"v", "tuketim", "isletme", "para"})
        self.assertEqual(blok["v"], 1)
        self.assertEqual(set(blok["tuketim"]), {"hane", "harcama", "urunler", "ucret"})
        self.assertEqual(set(blok["isletme"]), {"istihdam", "hareket", "sektor", "sektor_diger", "sehir"})
        self.assertEqual(json.loads(json.dumps(blok)), blok)

    def test_ucret_ve_fiyat_endeksi(self):
        P = params_ns(CYCLES_PER_WEEK=7, BASKET={"ekmek": 2, "sut": 1}, WAGE_TAX=0.1, SKILL_ON=False, ULC_BASE=1.0)
        W = dunya(week=1)
        W.REF.update(ekmek=1.0, sut=2.0)                                       # referans sepet 4
        for ci in (0, 1):
            W.LAND[(ci, "ekmek")], W.LAND[(ci, "sut")] = 1.5 + ci, 2.0
        W.WI = {0: 1.2, 1: 1.0}
        W.MARKET_MARKUP = 1.2
        for k, v in dict(tuk_n_ise=4, tuk_aff_ise=3.0, tuk_shelf_ise=40).items():
            W.gate_c[(0, k)] = v                                                # hanelerin fiilen aldığı sepet oranı ETKİLEMEZ (tam sabit sepet)
        b, _ = ex.build(W, P, None, None)
        u = b["tuketim"]["ucret"]
        net0, net1 = 10 * 1.2 * 7 * 0.9, 10 * 1.0 * 7 * 0.9
        sepet0, sepet1 = (2 * 1.5 + 1 * 2.0) * 1.2, (2 * 2.5 + 1 * 2.0) * 1.2   # tam sepet = sum(BASKET x land) x MARKET_MARKUP (haftalık)
        self.assertEqual(u["sehir"][0], [1.2, 1.25, round(net0, 1), round(net0 / sepet0, 3)])   # fiyat = (2*1.5+2)/4
        self.assertEqual(u["sehir"][1], [1.0, 1.75, round(net1, 1), round(net1 / sepet1, 3)])   # ölçülmeyen hane sepeti oranı bozmaz
        self.assertEqual(u["dunya"][3], round(((net0 + net1) / 2) / ((sepet0 + sepet1) / 2), 3))
        self.assertEqual(u["dunya"][0], 1.1)                                    # iki şehirde birer kişi: eşit ağırlık
        self.assertEqual(u["dunya"][1], 1.5)
        b0, _ = ex.build(dunya(), self.P, None, None)                           # fiyat bilgisi yoksa null
        self.assertEqual(b0["tuketim"]["ucret"]["dunya"][1], None)

    def test_hane_oranlari_kumulatif_farktan(self):
        W = dunya(week=1)
        gate_koy(W, 0, n_ise=4, aff_ise=3.0, shelf_ise=150)
        gate_koy(W, 25, n_ise=6, aff_ise=4.0, shelf_ise=250)          # farklı g kovaları toplanır
        b1, st = ex.build(W, self.P, None, None)
        self.assertEqual(b1["tuketim"]["hane"]["ise"], {"n": 10, "karsilanma": 0.7, "sepet": 280.0})
        W.week_no = 2
        gate_koy(W, 0, n_ise=10, aff_ise=7.0, shelf_ise=400)
        gate_koy(W, 25, n_ise=20, aff_ise=12.0, shelf_ise=900)
        b2, _ = ex.build(W, self.P, None, st)
        self.assertEqual(b2["tuketim"]["hane"]["ise"], {"n": 20, "karsilanma": 0.6, "sepet": 315.0})

    def test_hane_sifir_n_null(self):
        W = dunya()
        gate_koy(W, 0, n_ise=10, aff_ise=7.0, shelf_ise=400, n_issiz=5, aff_issiz=2.0, shelf_issiz=100)
        _, st = ex.build(W, self.P, None, None)
        W.week_no += 1
        gate_koy(W, 0, n_ise=20, aff_ise=14.0, shelf_ise=800)           # issiz değişmedi
        b, _ = ex.build(W, self.P, None, st)
        self.assertEqual(b["tuketim"]["hane"]["issiz"], {"n": 0, "karsilanma": None, "sepet": None})
        self.assertEqual(b["tuketim"]["hane"]["ise"]["n"], 10)

    def test_negatif_fark_null(self):
        W = dunya()
        gate_koy(W, 0, n_ise=10, aff_ise=7.0, shelf_ise=400)
        _, st = ex.build(W, self.P, None, None)
        W.week_no += 1
        gate_koy(W, 0, n_ise=2, aff_ise=1.0, shelf_ise=40)               # sayaç sıfırlandı
        b, _ = ex.build(W, self.P, None, st)
        self.assertEqual(b["tuketim"]["hane"]["ise"], {"n": None, "karsilanma": None, "sepet": None})

    def test_atlanan_hafta_farka_dayali_alanlar_null(self):
        W = dunya(week=20)
        gate_koy(W, 0, n_ise=10, aff_ise=7.0, shelf_ise=400)
        W.gate_c[(0, "harc_oyuncu")] = 100
        _, st = ex.build(W, self.P, None, None)
        W.week_no = 25
        gate_koy(W, 0, n_ise=20, aff_ise=14.0, shelf_ise=800)
        W.gate_c[(0, "harc_oyuncu")] = 300
        b, _ = ex.build(W, self.P, None, st)
        self.assertIsNone(b["tuketim"]["hane"]["ise"]["karsilanma"])
        self.assertEqual(b["tuketim"]["harcama"], {"npc": None, "oyuncu": None, "toplam": None})
        self.assertIsNone(b["isletme"]["hareket"])

    def test_durum_yok_hafta_ustu_1_kumulatif_haftalik_sayilmaz(self):
        """Koşu ortasında durum kaybolursa (yeniden başlatma, kayıt yükleme, geç ilk build) kümülatif değer haftalık diye çıkmaz: null; sonraki hafta normal."""
        W = dunya(n_cities=2, week=4)
        gate_koy(W, 0, n_ise=40, aff_ise=30.0, shelf_ise=1600)
        W.gate_c[(0, "harc_oyuncu")] = 800.0
        W.gate_c[(0, "harc_npc")] = 5000.0
        W.gate_c[(0, "tuk_n_npc_ise")] = 90.0
        W.gate_c[(0, "npc_issiz_dusen_n")] = 70.0
        firma(W, "a", "firin", 0, 3)
        b, st = ex.build(W, self.P, None, None)
        h = b["tuketim"]["hane"]
        self.assertEqual(h["ise"], {"n": None, "karsilanma": None, "sepet": None})
        self.assertEqual(h["npc"]["ise"]["n"], None)
        self.assertIsNone(h["npc_issiz_parasiz"])
        self.assertTrue(all(s["npc_issiz_parasiz"] is None and s["harcama"] == {"oyuncu": None, "npc": None} for s in h["sehir"]))
        self.assertEqual(b["tuketim"]["harcama"], {"npc": None, "oyuncu": None, "toplam": None})
        self.assertIsNone(b["isletme"]["hareket"])
        self.assertTrue(all(s["hareket"] is None for s in b["isletme"]["sehir"]))
        self.assertEqual(st.week, 4)                                       # durum güncel kümülatifle doldu
        W.week_no = 5
        gate_koy(W, 0, n_ise=50, aff_ise=35.0, shelf_ise=1900)           # kümülatif 40 -> 50
        W.gate_c[(0, "harc_oyuncu")] = 900.0
        b2, _ = ex.build(W, self.P, None, st)
        self.assertEqual(b2["tuketim"]["hane"]["ise"], {"n": 10, "karsilanma": 0.5, "sepet": 210.0})
        self.assertEqual(b2["tuketim"]["harcama"]["oyuncu"], 100)
        self.assertIsNotNone(b2["isletme"]["hareket"])

    def test_harcama_gate_c_den_ve_sehir_toplami(self):
        W = dunya(n_cities=2, week=1)
        W.gate_c[(0, "harc_oyuncu")] = 200.0
        W.gate_c[(1, "harc_oyuncu")] = 50.0
        W.gate_c[(0, "harc_npc")] = 600.0
        W.gate_c[(1, "harc_npc")] = 400.0
        b, st = ex.build(W, self.P, {"harc_npc": 999999}, None)            # host satırındaki sütun yok sayılır
        self.assertEqual(b["tuketim"]["harcama"], {"npc": 1000, "oyuncu": 250, "toplam": 1250})
        self.assertEqual([s["harcama"] for s in b["tuketim"]["hane"]["sehir"]], [{"oyuncu": 200, "npc": 600}, {"oyuncu": 50, "npc": 400}])
        W.week_no += 1
        W.gate_c[(1, "harc_npc")] = 700.0
        b2, _ = ex.build(W, self.P, None, st)
        self.assertEqual(b2["tuketim"]["harcama"], {"npc": 300, "oyuncu": 0, "toplam": 300})

    def test_harcama_kayit_yoksa_null(self):
        W = dunya()
        W.gate_c = defaultdict(float)
        b, _ = ex.build(W, self.P, None, None)
        self.assertEqual(b["tuketim"]["harcama"], {"npc": None, "oyuncu": None, "toplam": None})
        del W.gate_c
        b, _ = ex.build(W, self.P, {"harc_npc": 5}, None)
        self.assertEqual(b["tuketim"]["harcama"], {"npc": None, "oyuncu": None, "toplam": None})

    def test_sehir_ve_npc_haneleri_ve_parasiz_issiz(self):
        W = dunya(n_cities=2, week=1)
        for ci, (n, aff, sh) in {0: (10, 8.0, 100.0), 1: (30, 15.0, 600.0)}.items():
            W.gate_c[(ci, "tuk_n_ise")] = n
            W.gate_c[(ci, "tuk_aff_ise")] = aff
            W.gate_c[(ci, "tuk_shelf_ise")] = sh
            W.gate_c[(ci, "tuk_n_npc_issiz")] = n * 2
            W.gate_c[(ci, "tuk_aff_npc_issiz")] = n
            W.gate_c[(ci, "tuk_shelf_npc_issiz")] = n * 10
        W.gate_c[(0, "npc_issiz_dusen_n")] = 14.0
        W.gate_c[(1, "npc_issiz_dusen_n")] = 7.0
        b, _ = ex.build(W, self.P, None, None)
        h = b["tuketim"]["hane"]
        s0, s1 = h["sehir"]
        self.assertEqual(s0["ise"], {"n": 10, "karsilanma": 0.8, "sepet": 70.0})
        self.assertEqual(s1["ise"], {"n": 30, "karsilanma": 0.5, "sepet": 140.0})
        self.assertIsNone(s0["issiz"])                                     # şehirde hane yok: null
        self.assertEqual(s1["npc"]["issiz"], {"n": 60, "karsilanma": 0.5, "sepet": 35.0})
        self.assertEqual(h["npc"]["issiz"]["n"], 80)                      # dünya NPC = şehir toplamı
        self.assertAlmostEqual(h["npc"]["issiz"]["karsilanma"], 0.5)
        self.assertIsNone(s0["npc"]["dis"])
        self.assertEqual(s0["npc_issiz_parasiz"], 2.0)                    # 14 kişi-döngü / 7 döngü = 2 kişi-hafta (CYCLES_PER_WEEK=7)
        self.assertEqual(s1["npc_issiz_parasiz"], 1.0)
        self.assertEqual(h["npc_issiz_parasiz"], 3.0)

    def test_urunler_eksik_orani_azalan_en_fazla_bes(self):
        W = dunya()
        for i, (want, short) in enumerate([(100, 10), (100, 90), (100, 50), (0, 0), (200, 150), (100, 30), (100, 70), (100, 20)]):
            W.board["prod"][f"u{i}"] = dict(want=want, short=short, prod=5.0 + i, stock=1.0)
        b, _ = ex.build(W, self.P, None, None)
        u = b["tuketim"]["urunler"]
        self.assertEqual([x["urun"] for x in u], ["u1", "u4", "u6", "u2", "u5"])      # oran azalan, istek 0 elendi, ilk 5
        self.assertEqual(set(u[0]), {"urun", "istek", "karsilanmayan", "uretim", "stok"})
        W.board = None
        b, _ = ex.build(W, self.P, None, None)
        self.assertIsNone(b["tuketim"]["urunler"])
        W2 = dunya()
        b, _ = ex.build(W2, params_ns(SECTOR_BOARD=0), None, None)
        self.assertIsNone(b["tuketim"]["urunler"])

    def test_istihdam_toplamlari_tutarli(self):
        W = dunya()
        firma(W, "f1", "firin", 0, 5, who="npc")
        firma(W, "f2", "un", 1, 3, who="oyuncu")
        firma(W, "k1", "belediye", 0, 4, who="npc")
        firma(W, "k2", "ahir", 1, 2, who="npc")
        firma(W, "olu", "firin", 0, 9, dead=True)
        b, _ = ex.build(W, self.P, None, None)
        i = b["isletme"]["istihdam"]
        self.assertEqual(i, {"oyuncu": 3, "npc": 11, "ozel": 8, "kamu": 6})
        self.assertEqual(i["oyuncu"] + i["npc"], i["ozel"] + i["kamu"])
        s0, s1 = b["isletme"]["sehir"]
        self.assertEqual((s0["ozel_calisan"], s0["kamu_calisan"], s0["calisan_npc"], s0["calisan_oyuncu"]), (5, 4, 9, 0))
        self.assertEqual((s1["ozel_calisan"], s1["kamu_calisan"], s1["calisan_npc"], s1["calisan_oyuncu"]), (3, 2, 2, 3))

    def test_hareket_ilk_hafta_null_sonra_farktan(self):
        W = dunya(week=20)
        firma(W, "a", "firin", 0, 5)
        firma(W, "b", "firin", 0, 5)
        firma(W, "c", "un", 1, 5)
        firma(W, "d", "un", 1, 5)
        firma(W, "e", "un", 1, 5)
        firma(W, "bat", "un", 1, 5)
        b, st = ex.build(W, self.P, None, None)
        self.assertIsNone(b["isletme"]["hareket"])
        self.assertTrue(all(s["hareket"] is None for s in b["isletme"]["sehir"]))
        W.week_no = 21
        firma(W, "a", "firin", 0, 8)                  # büyür
        firma(W, "b", "firin", 0, 6)                  # büyür
        firma(W, "c", "un", 1, 2)                     # küçülür
        W.firms["bat"]["dead"] = True                 # batar
        firma(W, "yeni", "un", 1, 1)                  # kurulur
        b2, st2 = ex.build(W, self.P, None, st)
        self.assertEqual(b2["isletme"]["hareket"], {"kurulan": 1, "buyuyen": 2, "kuculen": 1, "batan": 1})
        s0, s1 = b2["isletme"]["sehir"]
        self.assertEqual(s0["hareket"], {"kurulan": 0, "buyuyen": 2, "kuculen": 0, "batan": 0})
        self.assertEqual(s1["hareket"], {"kurulan": 1, "buyuyen": 0, "kuculen": 1, "batan": 1})
        W.week_no = 23                                # hafta atlandı
        b3, _ = ex.build(W, self.P, None, st2)
        self.assertIsNone(b3["isletme"]["hareket"])

    def test_hareket_net_firma_degisimi_tutarli(self):
        W = dunya(week=20)
        for i in range(6):
            firma(W, f"o{i}", "firin", 0, 3)
        firma(W, "kam", "belediye", 0, 3)
        _, st = ex.build(W, self.P, None, None)
        once = set(st.alive)
        W.week_no = 21
        W.firms["o0"]["dead"] = True
        W.firms["o1"]["dead"] = True
        firma(W, "n0", "un", 0, 2)
        firma(W, "n1", "un", 0, 2)
        firma(W, "n2", "un", 0, 2)
        firma(W, "kam2", "ahir", 0, 2)               # kamu kurulumu sayılmaz
        b, st2 = ex.build(W, self.P, None, st)
        h = b["isletme"]["hareket"]
        self.assertEqual(h["kurulan"] - h["batan"], len(st2.alive) - len(once))
        self.assertEqual((h["kurulan"], h["batan"]), (3, 2))
        self.assertNotIn("kam", st2.alive)

    def test_boy_kovalari(self):
        W = dunya()
        for ad, n in {"z": 0, "a": 1, "b": 7, "c": 8, "d": 19, "e": 20, "f": 49, "g": 50, "h": 80}.items():
            firma(W, ad, "firin", 0, n)
        b, _ = ex.build(W, self.P, None, None)
        self.assertEqual(b["isletme"]["sehir"][0]["boy"], [2, 2, 2, 2])

    def test_sektor_en_fazla_oniki_ve_diger(self):
        W = dunya()
        for i in range(15):
            firma(W, f"f{i}", f"tur{i:02d}", 0, 15 - i)
        b, _ = ex.build(W, self.P, None, None)
        s = b["isletme"]["sektor"]
        self.assertEqual(len(s), 12)
        self.assertEqual([x["calisan"] for x in s], list(range(15, 3, -1)))
        self.assertEqual(b["isletme"]["sektor_diger"], {"calisan": 3 + 2 + 1, "firma": 3})
        W2 = dunya()
        for i in range(12):
            firma(W2, f"f{i}", f"tur{i:02d}", 0, 2)
        b2, _ = ex.build(W2, self.P, None, None)
        self.assertEqual(b2["isletme"]["sektor_diger"], {"calisan": 0, "firma": 0})

    def test_isgucu_disi_sehir_basina(self):
        W = dunya(n_cities=3)
        W.cities[0]["out"] = ["a", "b"]
        W.cities[2]["out"] = ["c"]
        b, _ = ex.build(W, self.P, None, None)
        self.assertEqual([s["isgucu_disi"] for s in b["isletme"]["sehir"]], [2, 0, 1])

    def test_para_dilimleri(self):
        W = dunya()
        for k in range(1, 11):
            q = f"o{k}"
            W.people[q] = dict(tier=0, wage=10, firm=None, who="oyuncu", city=0)
            W.L.bal[q] = float(k - 1)
            W.deposits[q] = [0, 1.0]
        for j in range(3):
            q = f"n{j}"
            W.people[q] = dict(tier=0, wage=10, firm=None, who="npc", city=0)
            W.L.bal[q] = 100.0
            W.deposits[q] = [0, 20.0]
        del W.people["s0_p0"], W.people["s1_p0"]
        b, _ = ex.build(W, self.P, None, None)
        p = b["para"]
        self.assertEqual((p["oyuncu_n"], p["oyuncu_ust10"], p["oyuncu_alt90"]), (10, 10, 45))
        self.assertEqual((p["npc_hane_nakit"], p["npc_hane_mevduat"]), (300, 60))
        W3 = dunya()
        for q in list(W3.people):
            W3.people[q]["who"] = "npc"
        b3, _ = ex.build(W3, self.P, None, None)
        self.assertEqual((b3["para"]["oyuncu_n"], b3["para"]["oyuncu_ust10"], b3["para"]["oyuncu_alt90"]), (0, 0, 0))

    def test_W_degismez(self):
        W = dunya()
        firma(W, "f1", "firin", 0, 5)
        gate_koy(W, 0, n_ise=10, aff_ise=7.0, shelf_ise=400)
        W.gate_c[(0, "harc_npc")] = 5.0
        W.board["prod"]["un"] = dict(want=10.0, short=2.0, prod=1.0, stock=1.0)
        before = deep(W)
        _, st = ex.build(W, self.P, None, None)
        ex.build(W, self.P, None, st)
        snapshot_equal(self, W, before, "ekonomi.build")


class GercekKosu(unittest.TestCase):
    def test_gercek_kosu_blok_dolu_ve_model_satiri_ayni(self):
        from oyun_server import config
        from oyun_server.sim.host import ModelHost
        weeks = 3
        a = ModelHost(str(config.MODEL_ROOT), {}, 200)
        b = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            st = None
            bloklar = []
            for _ in range(weeks):
                ra, rb = a.step(), b.step()
                W = a._W
                before = deep(W)
                blok, st = ex.build(W, a._P, a._last_row, st)
                snapshot_equal(self, W, before, "ekonomi.build (gerçek)")
                bloklar.append(blok)
                self.assertEqual(ra, rb, "blok açıkken model satırı değişti")
            for blok in bloklar:
                i = blok["isletme"]["istihdam"]
                self.assertGreater(i["oyuncu"] + i["npc"], 0)
                self.assertEqual(i["oyuncu"] + i["npc"], i["ozel"] + i["kamu"])
                self.assertIsNotNone(blok["tuketim"]["harcama"]["toplam"])
                self.assertGreater(blok["tuketim"]["harcama"]["toplam"], 0)
            son = bloklar[-1]
            self.assertIsNotNone(son["isletme"]["hareket"])
            # gate_c sayaçları var ve dünya harcaması şehir toplamıdır
            self.assertTrue(a._W.gate_c)
            h = son["tuketim"]["harcama"]
            self.assertEqual(h["toplam"], h["npc"] + h["oyuncu"])
            # birim tutarlılığı: sepet kişi başı HAFTALIK; Σ(kişi-hafta × sepet) haftalık harcamayla aynı büyüklükte (7 kat sapma olmaz)
            hn = son["tuketim"]["hane"]
            gruplar = [hn["ise"], hn["issiz"], *hn["npc"].values()] if isinstance(hn.get("npc"), dict) else [hn["ise"], hn["issiz"]]
            toplam_sepet = sum(g["n"] / 7 * g["sepet"] for g in gruplar if g and g.get("sepet") is not None and g.get("n"))
            self.assertGreater(toplam_sepet, 0)
            oran = toplam_sepet / h["toplam"]
            print("haftalık sepet / haftalık harcama:", round(oran, 3))
            self.assertTrue(0.3 < oran < 5.0, oran)
            print("ekonomi blok bayt:", len(json.dumps(son, separators=(",", ":"))))
            hs = [s["harcama"] for s in son["tuketim"]["hane"]["sehir"]]
            self.assertAlmostEqual(sum(x["oyuncu"] for x in hs), h["oyuncu"], delta=len(hs))   # yuvarlama farkı
        finally:
            a.close()
            b.close()


BUTCE = 4200            # bayt: tek haftanın `ekonomi` bloğu (kompakt JSON); 5 şehirli gerçek blok ~3900


def _bayt(blok) -> int:
    return len(json.dumps(blok, separators=(",", ":")))


class PaketYolu(unittest.TestCase):
    def test_make_packet_ekonomi_yalniz_verilirse(self):
        from oyun_server.sim.extract import make_packet
        row = {"week": 1}
        self.assertNotIn("ekonomi", make_packet("r", 1, 1, row))
        blok = {"v": 1}
        self.assertIs(make_packet("r", 1, 1, row, ekonomi=blok)["ekonomi"], blok)

    def test_sahte_host_snapshot_ekonomi_icerir(self):
        from oyun_server.testing import FakeHost
        h = FakeHost("", {}, weeks=10)
        h.step()
        blok = h.snapshot()["ekonomi"]
        self.assertEqual(blok["v"], 1)
        self.assertEqual(set(blok), {"v", "tuketim", "isletme", "para"})
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

    def test_snapshot_ekonomi_icerir_ve_tekrar_cagri_durumu_ilerletmez(self):
        h = self.host()
        h.step()
        s1 = h.snapshot()
        durum = h._ekonomi_state
        self.assertEqual(h.snapshot()["ekonomi"], s1["ekonomi"])           # aynı hafta tekrar çağrı: aynı sonuç
        self.assertIs(h._ekonomi_state, durum)                              # durum bir kez ilerler
        self.assertEqual(s1["ekonomi"]["v"], 1)
        self.assertIsNone(s1["ekonomi"]["isletme"]["hareket"])              # ilk hafta: önceki yok
        h.step()
        b2 = h.snapshot()["ekonomi"]
        self.assertIsNotNone(b2["isletme"]["hareket"])
        self.assertIsNotNone(b2["tuketim"]["hane"]["ise"]["n"])

    def test_blok_hatasi_kosuyu_dusurmez(self):
        import contextlib
        import io
        from unittest import mock
        h = self.host()
        err = io.StringIO()
        with mock.patch.object(ex, "build", side_effect=RuntimeError("bozuk")), contextlib.redirect_stderr(err):
            h.step()
            s1 = h.snapshot()
            h.step()
            s2 = h.snapshot()
        for s in (s1, s2):
            self.assertIn("cities", s)
            self.assertIn("chain", s)
            self.assertNotIn("ekonomi", s)
        self.assertEqual(err.getvalue().count("Traceback (most recent call last)"), 1)   # hata izi yalnız bir kez
        self.assertTrue(h._ekonomi_err_shown)
        self.assertIsNone(h._ekonomi_state)

    def test_yuk_butcesi(self):
        h = self.host()
        bayt = []
        for _ in range(52):
            h.step()
            bayt.append(_bayt(h.snapshot()["ekonomi"]))
        print("ekonomi bayt (52 hafta), maks:", max(bayt), bayt)
        self.assertLessEqual(max(bayt), BUTCE)
        self.assertLessEqual(sum(bayt) / len(bayt), BUTCE)

    def test_model_dosyasi_degismedi(self):
        a, b = self.host(), self.host()
        self.assertEqual(a.model_version, b.model_version)
        for _ in range(5):
            ra = a.step()
            a.snapshot()                                                    # blok açık
            rb = b.step()                                                   # blok hiç kurulmaz
            self.assertEqual(ra, rb)

    def test_yeni_host_orta_kosuda_kumulatifi_haftalik_saymaz(self):
        """Durum kaybı (yeniden başlatma): hafta > 1 iken ilk build farka dayalı alanları null verir, sonraki hafta normal."""
        h = self.host()
        for _ in range(3):
            h.step()
            b0 = h.snapshot()["ekonomi"]
        normal = b0["tuketim"]["hane"]["ise"]["n"]
        self.assertGreater(normal, 0)
        h._ekonomi_state = None                                             # durum kaybı
        h.step()
        b = h.snapshot()["ekonomi"]
        self.assertIsNone(b["tuketim"]["hane"]["ise"]["n"])
        self.assertEqual(b["tuketim"]["harcama"]["toplam"], None)
        h.step()
        b2 = h.snapshot()["ekonomi"]
        n2 = b2["tuketim"]["hane"]["ise"]["n"]
        self.assertIsNotNone(n2)
        self.assertLess(n2, 2 * normal)                       # haftalık büyüklükte (kümülatif 4x değil)


class ManagerYolu(ManagerBase):
    def test_manager_paketine_ekonomi_gecer(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.bekle(rid, 2)
        p1, p2 = m.weeks(rid, 1, 2)
        self.assertEqual(p1["ekonomi"]["v"], 1)
        self.assertEqual(p2["ekonomi"], self.hosts[0].fake_ekonomi())

    def test_dict_olmayan_ekonomi_yok_sayilir(self):
        self.kotu = [1, 2]
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.bekle(rid, 2)
        for p in m.weeks(rid, 1, 2):
            self.assertNotIn("ekonomi", p)

    kotu = None

    def host_factory(self, spec):
        h = super().host_factory(spec)
        if self.kotu is not None:
            kotu, eski = self.kotu, h.snapshot
            h.snapshot = lambda: dict(eski(), ekonomi=kotu)
        return h

    def bekle(self, rid, n):
        self.pump_until(lambda: self.mgr.stats(rid)["worker_week"] >= n)


if __name__ == "__main__":
    unittest.main()
