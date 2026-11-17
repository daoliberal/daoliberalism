"""PLAN-TAKIP T3: dilim dünya alanları (§4.5): modelin kendi servet / gelir / likit varlık dilimleri `World` alanlarına girer.

Kaynak: `W.series` (servet ve gelir), ölçüm satırının `para_*` ve `mev_*` sütunları (likit varlık). Sunucuda formül yeniden yazılmaz."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from oyun_server.sim import extract, probes
from oyun_server.sim.extract import extract_world

from tests.extract_v2_helpers import QUICK, fake_world, real_run

FIELDS = ("wealth_top10", "wealth_top1", "wealth_median", "income_gini", "income_top10", "liquid_b50", "liquid_m40", "liquid_t10")
SERIES = {"wealth_top10": "top10", "wealth_top1": "top1_w", "wealth_median": "med_w", "income_gini": "gini_inc", "income_top10": "top10_inc"}
TYPES = Path(__file__).resolve().parents[4] / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts"


class SeriesFacts(unittest.TestCase):
    def test_series_facts_read_series(self):
        W = fake_world(1)
        W.series = dict(top10=0.6, top1_w=0.2, med_w=33.5, gini_inc=0.4, top10_inc=0.3)
        f = probes.series_facts(W)
        self.assertEqual(f, {"x_wealth_top10": 0.6, "x_wealth_top1": 0.2, "x_wealth_median": 33.5, "x_income_gini": 0.4, "x_income_top10": 0.3})

    def test_series_missing_or_bad_is_null(self):
        W = fake_world(1)
        W.series = dict(top10=float("nan"), top1_w="x")
        f = probes.series_facts(W)
        self.assertTrue(all(v is None for v in f.values()))
        del W.series
        self.assertTrue(all(v is None for v in probes.series_facts(W).values()))

    def test_field_notes(self):
        for k in FIELDS:
            self.assertIn(k, probes.FIELD_NOTES, k)
            self.assertGreater(len(probes.FIELD_NOTES[k]), 20, k)
        self.assertIn("firma kasası", probes.FIELD_NOTES["wealth_top10"])          # modelin ölçüsü firma kasasını saymaz: tanımda yazılı
        self.assertIn("Fiilen çalışmayan", probes.FIELD_NOTES["npc_broke"])


class LiquidShares(unittest.TestCase):
    ROW = {"para_yoksul": "100", "para_orta": "300", "para_zengin": "500", "mev_yoksul": "0", "mev_orta": "100", "mev_zengin": "0"}

    def test_liquid_from_row(self):
        w = extract_world(self.ROW)
        self.assertAlmostEqual(w["liquid_b50"], 100 / 1000, places=12)
        self.assertAlmostEqual(w["liquid_m40"], 400 / 1000, places=12)
        self.assertAlmostEqual(w["liquid_t10"], 500 / 1000, places=12)
        self.assertAlmostEqual(w["liquid_b50"] + w["liquid_m40"] + w["liquid_t10"], 1.0, delta=1e-9)

    def test_old_row_is_null(self):
        w = extract_world({"calisan": 1, "issiz": 1})
        for k in FIELDS:
            self.assertIsNone(w[k], k)
        partial = extract_world({"para_yoksul": "1", "para_orta": "2"})             # sütunların biri yok -> null
        self.assertTrue(all(partial[k] is None for k in ("liquid_b50", "liquid_m40", "liquid_t10")))

    def test_zero_total_is_null(self):
        w = extract_world({k: "0" for k in self.ROW})
        self.assertTrue(all(w[k] is None for k in ("liquid_b50", "liquid_m40", "liquid_t10")))

    def test_x_facts_flow_through(self):
        w = extract_world({"x_wealth_top10": 0.55, "x_income_gini": 0.31})
        self.assertEqual((w["wealth_top10"], w["income_gini"], w["wealth_top1"]), (0.55, 0.31, None))


class Wiring(unittest.TestCase):
    def test_fields_registered_and_in_types(self):
        self.assertEqual(extract.NEW_WORLD_FIELDS, ())
        w = extract_world({})
        ts = TYPES.read_text(encoding="utf-8")
        for k in FIELDS:
            self.assertIn(k, w)
            self.assertRegex(ts, re.compile(rf"^\s*{k}\?: number \| null;", re.M), k)

    def test_npc_broke_note_text(self):
        self.assertIn("nakitsiz", probes.FIELD_NOTES["npc_broke"])


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rr = real_run()
        cls.worlds = [extract_world({**r, **f}) for r, f in zip(cls.rr.rows, cls.rr.facts)]

    def test_fields_equal_series_and_sum_to_one(self):
        W = self.rr.host._W
        last = self.worlds[11]
        for k, s in SERIES.items():
            self.assertTrue(all(w[k] is not None for w in self.worlds), k)
        # son hafta (koşu 16 hafta): alanlar W.series ile birebir
        self.assertEqual(self.worlds[-1]["wealth_top10"], W.series["top10"])
        self.assertEqual(self.worlds[-1]["wealth_top1"], W.series["top1_w"])
        self.assertEqual(self.worlds[-1]["wealth_median"], W.series["med_w"])
        self.assertEqual(self.worlds[-1]["income_gini"], W.series["gini_inc"])
        self.assertEqual(self.worlds[-1]["income_top10"], W.series["top10_inc"])
        for i, w in enumerate(self.worlds[:12], 1):
            tot = w["liquid_b50"] + w["liquid_m40"] + w["liquid_t10"]
            self.assertAlmostEqual(tot, 1.0, delta=1e-9, msg=f"hafta {i}")
        self.assertGreater(last["liquid_t10"], last["liquid_b50"])

    def test_series_week_by_week(self):
        """Her haftanın alanı o haftanın `W.series`'inden gelir: weekly[i]['series']."""
        W = self.rr.host._W
        for i, w in enumerate(self.worlds):
            s = W.weekly[i]["series"]
            self.assertEqual(w["wealth_top10"], probes.finite(s["top10"]), i)
            self.assertEqual(w["income_gini"], probes.finite(s["gini_inc"]), i)


if __name__ == "__main__":
    unittest.main()
