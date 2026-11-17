"""D4: nüfus ve başlangıç şehir kasası kartları (kayıt, çözümleme, üst sınır, NPC_Y çevirisi, gerçek model)."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server.registry import resolve
from oyun_server.registry.schema import RunConfigError
from oyun_server.sim import nufus

from tests.test_kosu_disk import DiskBase
from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry

KARTLAR = {"sehir_basina_oyuncu": ["PLAYERS_PER_CITY"], "npc_nufusu": ["NPC_X", "NPC_Y"], "baslangic_sehir_kasasi": ["CITY_START_CASH"]}


def cfg(**kw):
    base = {"templateId": "dayanikli_taban", "durationWeeks": 200, "seedIndex": 0, "values": {}}
    base.update(kw)
    return base


class Kartlar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.d = real_defaults()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_cards_in_registry_start_only_world_group(self):
        for k, params in KARTLAR.items():
            s = self.reg.by_id[k]
            self.assertEqual((s.layer, s.group, s.apply, s.editable), ("P", "dunya", "start_only", True), k)
            self.assertEqual(list(s.params), params, k)

    def test_model_defaults(self):
        self.assertEqual((self.d["PLAYERS_PER_CITY"], self.d["NPC_X"], self.d["NPC_Y"], self.d["CITY_START_CASH"]), (300, 600, 3, 0))

    def test_ranges_and_steps(self):
        c = self.reg.by_id["sehir_basina_oyuncu"].codec
        self.assertEqual((c["min"], c["max"], c["step"]), (100, 1000, 50))
        f = {x["key"]: x["codec"] for x in self.reg.by_id["npc_nufusu"].codec["fields"]}
        self.assertEqual((f["taban"]["min"], f["taban"]["max"], f["taban"]["step"]), (0, 3000, 100))
        self.assertEqual((f["oyuncu_basina"]["min"], f["oyuncu_basina"]["max"], f["oyuncu_basina"]["step"]), (0, 6, 0.5))
        k = self.reg.by_id["baslangic_sehir_kasasi"].codec
        self.assertEqual((k["min"], k["max"], k["step"], k["unit"]), (0, 2000000, 10000, "akce"))

    def test_default_ui_values(self):
        self.assertEqual(self.reg.default_ui(self.reg.by_id["sehir_basina_oyuncu"]), 300)
        self.assertEqual(self.reg.default_ui(self.reg.by_id["npc_nufusu"]), {"taban": 600, "oyuncu_basina": 3})
        self.assertEqual(self.reg.default_ui(self.reg.by_id["baslangic_sehir_kasasi"]), 0)

    def test_resolve_to_params(self):
        r = resolve.resolve(self.reg, {"sehir_basina_oyuncu": 800, "npc_nufusu": {"taban": 900, "oyuncu_basina": 2.5}, "baslangic_sehir_kasasi": 500000})
        self.assertEqual(r.errors, [])
        self.assertEqual(r.params, {"PLAYERS_PER_CITY": 800, "NPC_X": 900, "NPC_Y": 2.5, "CITY_START_CASH": 500000})

    def test_out_of_range_rejected(self):
        for id_, v in (("sehir_basina_oyuncu", 50), ("sehir_basina_oyuncu", 1050), ("sehir_basina_oyuncu", 325), ("sehir_basina_oyuncu", True),
                       ("npc_nufusu", {"taban": 3100, "oyuncu_basina": 3}), ("npc_nufusu", {"taban": 600, "oyuncu_basina": 6.5}),
                       ("npc_nufusu", {"taban": 600, "oyuncu_basina": 2.7}), ("baslangic_sehir_kasasi", -10000),
                       ("baslangic_sehir_kasasi", 2010000), ("baslangic_sehir_kasasi", 15000)):
            with self.subTest(id=id_, value=v):
                r = resolve.resolve(self.reg, {id_: v})
                self.assertEqual(r.params, {})
                self.assertEqual(r.errors[0].id, id_)

    def test_texts_no_hidden_names(self):
        for k in KARTLAR:
            blob = json.dumps(self.texts[k], ensure_ascii=False)
            self.assertIsNone(re.search(r"K-\d|PM_ADJ|_CAL\b|PLAYERS_PER_CITY|NPC_X|NPC_Y|CITY_START_CASH", blob), k)
            for f in ("title", "what", "changes"):
                self.assertTrue(self.texts[k][f].strip(), (k, f))

    def test_start_only_in_evidence(self):
        ev = read_json(REAL_DIR / "apply_classes.json")
        for k, params in KARTLAR.items():
            self.assertEqual(ev["cards"][k], "start_only", k)
            for p in params:
                self.assertEqual(ev["keys"][p]["class"], "start_only", p)

    def test_baseline_has_no_carded_names(self):
        base = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        self.assertFalse(base & {"PLAYERS_PER_CITY", "NPC_X", "NPC_Y", "CITY_START_CASH"})


class NufusHesabi(unittest.TestCase):
    D = {"PLAYERS_PER_CITY": 300, "NPC_X": 600, "NPC_Y": 3, "CITY_START_CASH": 0}

    def test_defaults_totals(self):
        self.assertEqual(nufus.totals({}, self.D), {"players": 1500, "npc": 5100, "total": 6600})

    def test_overrides_totals(self):
        self.assertEqual(nufus.totals({"PLAYERS_PER_CITY": 800, "NPC_Y": 2.5, "NPC_X": 900}, self.D), {"players": 4000, "npc": 10900, "total": 14900})

    def test_extreme_card_combination_is_within_limit(self):
        t = nufus.totals({"PLAYERS_PER_CITY": 1000, "NPC_X": 3000, "NPC_Y": 6}, self.D)
        self.assertEqual(t["total"], 38000)
        self.assertLessEqual(t["total"], nufus.MAX_POPULATION)
        self.assertFalse(nufus.too_big({"PLAYERS_PER_CITY": 1000, "NPC_X": 3000, "NPC_Y": 6}, self.D))
        self.assertTrue(nufus.too_big({"PLAYERS_PER_CITY": 1000, "NPC_X": 3000, "NPC_Y": 9}, self.D))

    def test_fractional_npc_y_split_keeps_total(self):
        for ppc, x, y in ((300, 600, 2.5), (800, 0, 0.5), (1000, 3000, 5.5), (150, 100, 3.5)):
            p = {"PLAYERS_PER_CITY": ppc, "NPC_X": x, "NPC_Y": y}
            m = nufus.to_model(p, self.D)
            self.assertIsInstance(m["NPC_Y"], int)
            self.assertEqual(nufus.totals(m, self.D)["npc"], nufus.totals(p, self.D)["npc"], p)

    def test_integer_values_untouched(self):
        p = {"NPC_Y": 3.0, "PLAYERS_PER_CITY": 400}
        self.assertIs(nufus.to_model(p, self.D), p)

    def test_split_uses_defaults_for_missing(self):
        m = nufus.to_model({"NPC_Y": 2.5}, self.D)
        self.assertEqual((m["NPC_Y"], m["NPC_X"]), (2, 600 + 0.5 * 300 * 5))


class KosuSiniri(unittest.TestCase):
    def test_run_overrides_rejects_too_big_population(self):
        reg = real_registry()
        r = resolve.run_overrides(reg, cfg(values={"sehir_basina_oyuncu": 1000, "npc_nufusu": {"taban": 3000, "oyuncu_basina": 6}}))
        self.assertEqual(r["PLAYERS_PER_CITY"], 1000)
        old = nufus.MAX_POPULATION
        nufus.MAX_POPULATION = 30_000
        try:
            with self.assertRaises(RunConfigError) as cm:
                resolve.run_overrides(reg, cfg(values={"sehir_basina_oyuncu": 1000, "npc_nufusu": {"taban": 3000, "oyuncu_basina": 6}}))
            self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("sehir_basina_oyuncu", "too_big")])
        finally:
            nufus.MAX_POPULATION = old


class KosuJsonNufus(DiskBase):
    def test_kosu_json_carries_population(self):
        self.make()
        rid, _ = self.new_run(values={"sehir_basina_oyuncu": 800, "npc_nufusu": {"taban": 900, "oyuncu_basina": 2.5}, "baslangic_sehir_kasasi": 500000})
        k = json.loads((self.folder_of(rid) / "kosu.json").read_text(encoding="utf-8"))
        self.assertEqual(k["population"], {"playersPerCity": 800, "cities": 5, "players": 4000, "npc": 10900, "total": 14900, "cityStartCash": 500000})
        self.assertEqual(k["recipe"]["values"]["sehir_basina_oyuncu"], 800)
        self.assertEqual(k["recipe"]["values"]["npc_nufusu"], {"taban": 900, "oyuncu_basina": 2.5})
        self.assertEqual(k["recipe"]["values"]["baslangic_sehir_kasasi"], 500000)

    def test_default_population(self):
        self.make()
        rid, _ = self.new_run()
        k = json.loads((self.folder_of(rid) / "kosu.json").read_text(encoding="utf-8"))
        self.assertEqual(k["population"], {"playersPerCity": 300, "cities": 5, "players": 1500, "npc": 5100, "total": 6600, "cityStartCash": 0})


class GercekModelNufus(unittest.TestCase):
    def test_half_step_npc_y_reaches_model_without_truncation(self):
        from oyun_server import config
        from oyun_server.sim import worker
        spec = {"host": "model", "overrides": {"PLAYERS_PER_CITY": 100, "NPC_X": 0, "NPC_Y": 2.5, "CITY_START_CASH": 200000}, "weeks": 3,
                "model_root": str(config.MODEL_ROOT)}
        host = worker.make_host(spec)
        try:
            W = host._W
            self.assertEqual(sum(1 for p in W.people.values() if p["who"] == "oyuncu"), 500)
            self.assertEqual(sum(1 for p in W.people.values() if p["who"] == "npc"), 1250)       # 2,5 x 100 x 5 (kesilseydi 1000)
            self.assertAlmostEqual(W.L.flows["baslangic_kasasi"], 1_000_000)
        finally:
            host.close()


if __name__ == "__main__":
    unittest.main()
