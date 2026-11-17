"""D8: haftalık işletme sayısı göstergesi (dünya `firms_total`, şehir satırı `firms_total`): yerleşik + oyuncu işletmesi."""
from __future__ import annotations

import unittest

from oyun_server.sim import extract_cities
from oyun_server.sim.extract import extract_world

from tests.extract_v2_helpers import fake_world, params_ns


class IsletmeSayisi(unittest.TestCase):
    def test_dunya_toplami_yerlesik_ve_oyuncu_isletmesi(self):
        w = extract_world({"npc_firma": "419", "oyuncu_firma": "23"})
        self.assertEqual(w["firms_total"], 442)

    def test_olculmediyse_null(self):
        self.assertIsNone(extract_world({"npc_firma": "419"})["firms_total"])
        self.assertIsNone(extract_world({})["firms_total"])

    def test_sehir_satiri_toplami(self):
        W, P = fake_world(), params_ns()
        W.firms = {"a": dict(kind="un", city=0, workers=[], owner=None), "b": dict(kind="un", city=0, workers=[], owner=None, dead=True),
                   "c": dict(kind="un", city=0, workers=[], owner=None, org_owner="x")}
        r = extract_cities.city_rows(W, P, None)[0]
        self.assertEqual(r["firms_total"], r["firms_npc"] + r["firms_player"])
        self.assertEqual(r["firms_total"], 1)


if __name__ == "__main__":
    unittest.main()
