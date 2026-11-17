"""Görev 12b: şehir kurumları (Liman = ithalat, İhracat) salt-okunur `kurumlar` bloğu: şehir başına haftalık ithal ve ihraç hacmi, en çok ithal edilen ürünler.
Model ve altınlar değişmez; blok yalnız okur. Kota modelde yok (K-92 →: kapalı dünya, ihracat başka şehrin ithalatıdır), blokta da yok."""
from __future__ import annotations

import copy
import unittest
from collections import defaultdict

from oyun_server.sim import extract_kurumlar
from oyun_server.sim.extract import make_packet
from oyun_server.testing import FakeHost

from tests.extract_v2_helpers import QUICK, deep, fake_world, real_run, snapshot_equal

SATIR_ANAHTARLARI = {"sehir", "ithalat_hacim", "ithalat_urunler", "ihracat_hacim"}


def dunya(ithal: list[float], ihrac: list[float], cum: list[dict[str, float]]):
    W = fake_world(n_cities=len(ithal))
    for i, c in enumerate(W.cities):
        c["imp_val"], c["exp_val"], c["imp_cum"] = ithal[i], ihrac[i], dict(cum[i])
    return W


class KurumSatirlari(unittest.TestCase):
    def test_sehir_basina_tek_satir_anahtar_kumesi_ve_hacimler(self):
        W = dunya([100.0, 0.0], [40.0, 60.0], [{"un": 3.0, "sut": 1.0}, {}])
        rows = extract_kurumlar.kurum_satirlari(W)
        self.assertEqual([r["sehir"] for r in rows], [0, 1])
        for r in rows:
            self.assertEqual(set(r), SATIR_ANAHTARLARI)
        self.assertEqual(rows[0]["ithalat_hacim"], 100.0)
        self.assertEqual(rows[0]["ihracat_hacim"], 40.0)
        self.assertEqual(rows[1]["ithalat_hacim"], 0.0)
        self.assertEqual(rows[1]["ithalat_urunler"], [])           # ithalat yoksa ürün listesi boş

    def test_en_cok_ithal_edilen_bes_urun_paya_gore_azalan_esitlikte_adla(self):
        cum = {"a": 5.0, "b": 5.0, "c": 4.0, "d": 3.0, "e": 2.0, "f": 1.0, "g": 0.5}
        rows = extract_kurumlar.kurum_satirlari(dunya([10.0], [0.0], [cum]))
        top = rows[0]["ithalat_urunler"]
        self.assertEqual([u["urun"] for u in top], ["a", "b", "c", "d", "e"])
        self.assertEqual(len(top), extract_kurumlar.URUN_SAYISI)
        toplam = sum(cum.values())
        for u in top:
            self.assertAlmostEqual(u["pay"], cum[u["urun"]] / toplam, places=9)       # pay: tüm ithalat içindeki oran (ilk 5 kesilse de payda toplamdır)
        self.assertLess(sum(u["pay"] for u in top), 1.0)

    def test_sonlu_olmayan_ve_sifir_degerler_atilir(self):
        cum = {"a": float("nan"), "b": 0.0, "c": 2.0, "d": float("inf"), "e": -1.0}
        W = dunya([float("nan")], [float("inf")], [cum])
        r = extract_kurumlar.kurum_satirlari(W)[0]
        self.assertEqual(r["ithalat_hacim"], 0.0)
        self.assertEqual(r["ihracat_hacim"], 0.0)
        self.assertEqual([u["urun"] for u in r["ithalat_urunler"]], ["c"])
        self.assertEqual(r["ithalat_urunler"][0]["pay"], 1.0)

    def test_imp_cum_alani_olmayan_sehir_bos_urun_listesi(self):
        W = fake_world(n_cities=2)                                  # sahte dünyada imp_cum yok
        rows = extract_kurumlar.kurum_satirlari(W)
        self.assertEqual([r["ithalat_urunler"] for r in rows], [[], []])

    def test_dunyayi_degistirmez(self):
        W = dunya([5.0, 6.0], [6.0, 5.0], [{"un": 1.0, "sut": 2.0}, {"un": 4.0}])
        once = copy.deepcopy(vars(W))
        extract_kurumlar.kurum_satirlari(W)
        self.assertEqual(vars(W)["cities"], once["cities"])

    def test_tur_ve_hacimler_json_uyumlu(self):
        import json
        rows = extract_kurumlar.kurum_satirlari(dunya([1.5], [2.5], [{"un": 1.0}]))
        self.assertEqual(json.loads(json.dumps(rows)), rows)


class PaketeGirer(unittest.TestCase):
    def test_make_packet_kurumlar_yalniz_verilirse(self):
        row = {"week": 1}
        self.assertNotIn("kurumlar", make_packet("r", 1, 1, row))
        pk = make_packet("r", 1, 1, row, kurumlar=[{"sehir": 0}])
        self.assertEqual(pk["kurumlar"], [{"sehir": 0}])

    def test_sahte_host_snapshot_besi_sehir_kurumlari(self):
        h = FakeHost("", {}, weeks=10)
        for _ in range(2):
            h.step()
        snap = h.snapshot()
        self.assertIn("kurumlar", snap)
        self.assertEqual([r["sehir"] for r in snap["kurumlar"]], [0, 1, 2, 3, 4])
        for r in snap["kurumlar"]:
            self.assertEqual(set(r), SATIR_ANAHTARLARI)
            for u in r["ithalat_urunler"]:
                self.assertEqual(set(u), {"urun", "pay"})


@unittest.skipIf(QUICK, "gerçek model")
class GercekModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_ = real_run()

    def test_snapshot_kurumlar_bloku_sehir_sayisi_kadar(self):
        r = self.run_
        rows = r.snaps[-1]["kurumlar"]
        self.assertEqual(len(rows), len(r.W.cities))
        for row in rows:
            self.assertEqual(set(row), SATIR_ANAHTARLARI)
            self.assertGreaterEqual(row["ithalat_hacim"], 0.0)
            self.assertGreaterEqual(row["ihracat_hacim"], 0.0)
            self.assertLessEqual(len(row["ithalat_urunler"]), extract_kurumlar.URUN_SAYISI)
            paylar = [u["pay"] for u in row["ithalat_urunler"]]
            self.assertEqual(paylar, sorted(paylar, reverse=True))
            self.assertLessEqual(sum(paylar), 1.0 + 1e-9)

    def test_kapali_dunyada_toplam_ithalat_toplam_ihracata_esit(self):
        rows = self.run_.snaps[-1]["kurumlar"]
        self.assertAlmostEqual(sum(r["ithalat_hacim"] for r in rows), sum(r["ihracat_hacim"] for r in rows), places=4)   # her alım bir şehrin ithalatı, öbürünün ihracatı

    def test_kurumlar_dunyayi_degistirmez(self):
        r = self.run_
        before = deep(r.W)
        extract_kurumlar.kurum_satirlari(r.W)
        snapshot_equal(self, r.W, before, "kurumlar")


if __name__ == "__main__":
    unittest.main()
