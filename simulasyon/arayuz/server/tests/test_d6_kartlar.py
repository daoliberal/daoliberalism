"""D6: işe alım kuralları ve yeni oyuncu katılımı kartları (kayıt, çözümleme, aralıklar, metinler, apply sınıfı, toplam kişi sınırı)."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server.registry import resolve
from oyun_server.sim import nufus

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry

KARTLAR = {
    "ahir_gecisi": ["AHIR_MOVE", "AHIR_MOVE_PREMIUM"],
    "ise_alim_onceligi": ["HIRE_PRIORITY"],
    "isten_cikarma_sirasi": ["FIRE_ORDER"],
    "bosluk_zinciri": ["AHIR_BACKFILL"],
    "yeni_oyuncu_katilimi": ["PLAYER_INFLOW", "AHIR_TARGET", "PLAYER_INFLOW_RATE", "PLAYER_MAX_PER_CITY"],
    "ahir_kapasitesi": ["CAP_AHIR"],
}
RANK = {"live": 0, "live_sync": 1, "start_only": 2}


class Kartlar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.d = real_defaults()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_cards_in_registry_world_labor_group(self):
        for k, params in KARTLAR.items():
            s = self.reg.by_id[k]
            self.assertEqual((s.layer, s.group, s.editable, s.status), ("P", "is_piyasasi", True, "active"), k)
            self.assertEqual(list(s.params), params, k)
        self.assertIn("is_piyasasi", {g["id"] for g in self.reg.groups})

    def test_model_defaults_are_todays_behaviour(self):
        d = self.d
        self.assertEqual((d["AHIR_MOVE"], d["AHIR_MOVE_PREMIUM"], d["HIRE_PRIORITY"], d["FIRE_ORDER"]), (0, 0.2, 0, 0))
        self.assertEqual((d["AHIR_BACKFILL"], d["PLAYER_INFLOW"], d["PLAYER_INFLOW_RATE"], d["AHIR_TARGET"], d["PLAYER_MAX_PER_CITY"]), (0, 0, 10, 0, 1000))
        self.assertEqual(d["CAP_AHIR"], 50)

    def test_default_ui_values(self):
        r = self.reg
        self.assertEqual(r.default_ui(r.by_id["ahir_gecisi"]), {"kural": "otomatik", "prim": 20})
        self.assertEqual(r.default_ui(r.by_id["ise_alim_onceligi"]), "oyuncu_once")
        self.assertEqual(r.default_ui(r.by_id["isten_cikarma_sirasi"]), "yalniz_npc")
        self.assertEqual(r.default_ui(r.by_id["bosluk_zinciri"]), False)
        self.assertEqual(r.default_ui(r.by_id["yeni_oyuncu_katilimi"]), {"kural": "kapali", "hedef": 0, "hiz": 10, "en_cok": 1000})
        self.assertEqual(r.default_ui(r.by_id["ahir_kapasitesi"]), 300)            # şehir başına toplam: 6 ahır x 50

    def test_resolve_to_params(self):
        r = resolve.resolve(self.reg, {"ahir_gecisi": {"kural": "gonullu", "prim": 35}, "ise_alim_onceligi": "esit", "isten_cikarma_sirasi": "son_giren",
                                       "bosluk_zinciri": True, "yeni_oyuncu_katilimi": {"kural": "sabit", "hedef": 250, "hiz": 7, "en_cok": 600},
                                       "ahir_kapasitesi": 360})
        self.assertEqual(r.errors, [])
        self.assertEqual(r.params["AHIR_MOVE"], 1)
        self.assertAlmostEqual(r.params["AHIR_MOVE_PREMIUM"], 0.35)
        self.assertEqual((r.params["HIRE_PRIORITY"], r.params["FIRE_ORDER"], r.params["AHIR_BACKFILL"]), (1, 1, 1))
        self.assertEqual((r.params["PLAYER_INFLOW"], r.params["AHIR_TARGET"], r.params["PLAYER_INFLOW_RATE"], r.params["PLAYER_MAX_PER_CITY"]), (2, 250, 7, 600))
        self.assertEqual(r.params["CAP_AHIR"], 60)                                  # 360 / 6 ahır

    def test_every_enum_option_resolves(self):
        opts = {"ise_alim_onceligi": {"oyuncu_once": 0, "esit": 1, "npc_once": 2},
                "isten_cikarma_sirasi": {"yalniz_npc": 0, "son_giren": 1, "dusuk_verim": 2, "ayrim_yok": 3}}
        for card, m in opts.items():
            param = KARTLAR[card][0]
            for ui, model in m.items():
                self.assertEqual(resolve.resolve(self.reg, {card: ui}).params.get(param, 0), model, (card, ui))
        for ui, model in {"kapali": 0, "bosluk": 1, "sabit": 2}.items():
            self.assertEqual(resolve.resolve(self.reg, {"yeni_oyuncu_katilimi": {"kural": ui, "hedef": 0, "hiz": 10, "en_cok": 1000}}).params.get("PLAYER_INFLOW", 0), model)       # varsayılan (0) çözümlemede yazılmaz

    def test_out_of_range_rejected(self):
        ok_a = {"kural": "gonullu", "prim": 20}
        ok_y = {"kural": "sabit", "hedef": 0, "hiz": 10, "en_cok": 1000}
        bad = [("ahir_gecisi", {**ok_a, "prim": 250}), ("ahir_gecisi", {**ok_a, "prim": 22}), ("ahir_gecisi", {**ok_a, "kural": "belki"}),
               ("ise_alim_onceligi", "rastgele"), ("isten_cikarma_sirasi", "kimse"),
               ("yeni_oyuncu_katilimi", {**ok_y, "hiz": 0}), ("yeni_oyuncu_katilimi", {**ok_y, "hiz": 101}), ("yeni_oyuncu_katilimi", {**ok_y, "hiz": 2.5}),
               ("yeni_oyuncu_katilimi", {**ok_y, "hedef": 1050}), ("yeni_oyuncu_katilimi", {**ok_y, "hedef": 75}),
               ("yeni_oyuncu_katilimi", {**ok_y, "en_cok": 50}), ("yeni_oyuncu_katilimi", {**ok_y, "en_cok": 1100}), ("yeni_oyuncu_katilimi", {**ok_y, "kural": "hep"}),
               ("ahir_kapasitesi", 54), ("ahir_kapasitesi", 1206), ("ahir_kapasitesi", 305)]
        for id_, v in bad:
            with self.subTest(id=id_, value=v):
                r = resolve.resolve(self.reg, {id_: v})
                self.assertEqual(r.params, {})
                self.assertEqual(r.errors[0].id, id_)
        for id_, v in (("ahir_gecisi", ok_a), ("yeni_oyuncu_katilimi", ok_y), ("ahir_kapasitesi", 60), ("ahir_kapasitesi", 1200)):
            self.assertEqual(resolve.resolve(self.reg, {id_: v}).errors, [], (id_, v))

    def test_texts_complete_and_no_hidden_names(self):
        for k, params in KARTLAR.items():
            t = self.texts[k]
            blob = json.dumps(t, ensure_ascii=False)
            self.assertIsNone(re.search(r"K-\d|PM_ADJ|_CAL\b|BIG_|CAP_|PLAYER_PRIO|NPC_POOL|" + "|".join(params), blob), k)
            for f in ("title", "what", "changes"):
                self.assertTrue(t[f].strip(), (k, f))
        self.assertIn("is_piyasasi", self.texts["_gruplar"])

    def test_texts_claim_only_measured_effects(self):
        """Ölçülen etkiler OLCUM-ISGUCU-AYRISTIRMA.md'den (6 tohum ortancası); ölçülmeyenler 'ölçülmedi' der."""
        g = self.texts["ahir_gecisi"]["changes"]
        for n in ("269", "961", "56", "724"):
            self.assertIn(n, g)
        c = self.texts["isten_cikarma_sirasi"]["changes"]
        for n in ("269", "414", "56", "288"):
            self.assertIn(n, c)
        for k in ("ise_alim_onceligi", "bosluk_zinciri", "yeni_oyuncu_katilimi"):
            self.assertIn("ölçülmedi", self.texts[k]["changes"], k)

    def test_apply_classes_have_evidence(self):
        ev = read_json(REAL_DIR / "apply_classes.json")
        for k, params in KARTLAR.items():
            worst = max((RANK[ev["keys"][p]["class"]] for p in params), default=0)
            self.assertEqual(RANK[ev["cards"][k]], worst, k)
            self.assertEqual(self.reg.by_id[k].apply, ev["cards"][k], k)
        self.assertEqual(ev["cards"]["ahir_kapasitesi"], "start_only")             # yalnız kuruluşta okunur (world_build)

    def test_baseline_has_no_carded_names_and_hides_server_cap(self):
        base = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        carded = {p for ps in KARTLAR.values() for p in ps}
        self.assertFalse(base & carded)
        self.assertIn("PLAYER_MAX_TOTAL", base)                                      # toplam kişi sınırı kart değil, sunucu sabitidir
        self.assertNotIn("PLAYER_MAX_TOTAL", {p for s in self.reg.by_id.values() for p in s.params})

    def test_server_population_cap_matches_model_param(self):
        self.assertIn("PLAYER_MAX_TOTAL", self.d)
        self.assertEqual(self.d["PLAYER_MAX_TOTAL"], 0)                              # modelde sınırsız; sunucu ModelHost'ta nufus.MAX_POPULATION yazar
        self.assertGreaterEqual(nufus.MAX_POPULATION, 38000)


if __name__ == "__main__":
    unittest.main()
