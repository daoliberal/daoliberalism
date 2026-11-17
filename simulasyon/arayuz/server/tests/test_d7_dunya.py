"""D7: tutarlı dünya kurulumu kartları (kayıt, çözümleme, aralıklar, metinler, apply sınıfı), saf açılış hesabı ucu, yeni ölçüm işareti, göstergeler."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server import config
from oyun_server.registry import resolve
from oyun_server.registry.schema import RunConfigError
from oyun_server.sim import extract, plan, probes

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry
from tests.route_helpers import call, live_app
from tests.test_kosu_disk import DiskBase

KARTLAR = {
    "baslangic_istihdami": ["START_EMP"],
    "isletme_sayisi": ["FIRMS_PER_1000"],
    "isletme_kapasitesi": ["CAP_MODE", "CAP_AUTO_SHARE", "CAP_AUTO_MIN", "MCAP_RAW", "MCAP_MAKE", "MCAP_SERV", "MCAP_LOG"],
    "kapasite_buyume_tavani": ["CAP_GROWTH"],
    "acilis_talebi": ["START_DEMAND", "START_STOCK_WEEKS"],
    "npc_baslangic_nakdi": ["NPC_START_CASH"],
    "acilis_konut_stoku": ["HOUSE_MODE"],
    "nufus_olcegi": ["POP_SCALE"],
}


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

    def test_cards_are_experimental_start_only_world_cards(self):
        for k, params in KARTLAR.items():
            s = self.reg.by_id[k]
            self.assertEqual((s.layer, s.group, s.editable, s.status, s.apply, s.decision), ("P", "dunya", True, "experimental", "start_only", "D7"), k)
            self.assertEqual(list(s.params), params, k)

    def test_model_defaults_are_todays_world(self):
        d = self.d
        self.assertEqual((d["START_EMP"], d["FIRMS_PER_1000"], d["CAP_MODE"], d["CAP_GROWTH"], d["START_DEMAND"], d["START_STOCK_WEEKS"]), (0.0, 0.0, 0, 0, 0, 0))
        self.assertEqual((d["NPC_START_CASH"], d["HOUSE_MODE"], d["POP_SCALE"]), (0.0, 1, False))      # rekabet G16: HOUSE_MODE oyun varsayilani 1 (eski 0)
        self.assertEqual((d["MCAP_RAW"], d["MCAP_MAKE"], d["MCAP_SERV"], d["MCAP_LOG"]), (75, 75, 75, 240))
        self.assertEqual((d["CAP_AUTO_SHARE"], d["CAP_AUTO_MIN"], d["POP_SCALE_FACTOR"]), (1.25, 25, 1.0))

    def test_defaults_round_trip_through_codecs(self):
        for k in KARTLAR:
            s = self.reg.by_id[k]
            ui = self.reg.default_ui(s)
            r = resolve.resolve(self.reg, {k: ui})
            self.assertEqual(r.errors, [], k)
            for p, v in r.params.items():
                self.assertEqual(v, self.d[p], (k, p))

    def test_resolve_to_params(self):
        r = resolve.resolve(self.reg, {
            "baslangic_istihdami": 48, "isletme_sayisi": 20,
            "isletme_kapasitesi": {"kip": "otomatik", "pay": 150, "en_az": 30, "hammadde": 300, "imalat": 100, "hizmet": 50, "lojistik": 400},
            "kapasite_buyume_tavani": "acilis_kapasitesi", "acilis_talebi": {"tahmin": "tutarli", "stok": 2},
            "npc_baslangic_nakdi": 1.5, "acilis_konut_stoku": "acilis_kadrosu", "nufus_olcegi": True})
        self.assertEqual(r.errors, [])
        self.assertEqual(r.params, {
            "START_EMP": 0.48, "FIRMS_PER_1000": 20, "CAP_MODE": 1, "CAP_AUTO_SHARE": 1.5, "CAP_AUTO_MIN": 30, "MCAP_RAW": 300, "MCAP_MAKE": 100,
            "MCAP_SERV": 50, "MCAP_LOG": 400, "CAP_GROWTH": 1, "START_DEMAND": 1, "START_STOCK_WEEKS": 2, "NPC_START_CASH": 1.5, "HOUSE_MODE": 1, "POP_SCALE": True})

    def test_out_of_range_rejected(self):
        for id_, v in (("baslangic_istihdami", 95), ("baslangic_istihdami", -1), ("isletme_sayisi", 81), ("npc_baslangic_nakdi", 3.5), ("npc_baslangic_nakdi", 0.25),
                       ("nufus_olcegi", 1), ("acilis_konut_stoku", "bilinmeyen"), ("kapasite_buyume_tavani", 2)):
            r = resolve.resolve(self.reg, {id_: v})
            self.assertTrue(r.errors, (id_, v))

    def test_start_only_blocks_mid_run_change(self):
        from oyun_server.runs.manager import change_block_reason
        live_keys = frozenset()
        for k in KARTLAR:
            self.assertEqual(change_block_reason(self.reg.by_id[k], live_keys, frozenset()), "start_only", k)

    def test_apply_evidence_is_start_only_for_every_key(self):
        ev = read_json(REAL_DIR / "apply_classes.json")
        for k, params in KARTLAR.items():
            self.assertEqual(ev["cards"][k], "start_only", k)
            for p in params:
                self.assertEqual(ev["keys"][p]["class"], "start_only", p)

    def test_texts_warn_about_labor_market_rules(self):
        for k in KARTLAR:
            t = self.texts[k]
            self.assertIn("iş piyasası kuralları", t["warning"], k)
            self.assertIn("gecikir", t["warning"], k)
            for part in ("title", "what", "changes"):
                self.assertTrue(t[part].strip(), (k, part))

    def test_texts_avoid_calibration_names_and_decision_numbers(self):
        bad = re.compile(r"\b(BIG_[A-Z_]+|CAP_[A-Z_]+|MCAP_[A-Z_]+|START_[A-Z_]+|HOUSE_[A-Z_]+|POP_[A-Z_]+|NPC_[A-Z_]+|K-\d+)\b")
        for k in KARTLAR:
            blob = json.dumps(self.texts[k], ensure_ascii=False)
            self.assertIsNone(bad.search(blob), (k, bad.search(blob)))

    def test_new_player_card_no_unmeasured_slowdown_claim(self):
        """D6 incelemesi M3: ölçülmemiş "koşu yavaşlar" iddiası yok."""
        self.assertNotIn("koşu yavaşlar", self.texts["yeni_oyuncu_katilimi"]["changes"])
        self.assertIn("hesap süresi", self.texts["yeni_oyuncu_katilimi"]["changes"])

    def test_staging_flag_text_claims_only_measured_stock_effect(self):
        c = self.texts["acilis_talebi"]["changes"]
        self.assertIn("ölçümde zararlı", c)


class PopulationAndMeasurement(DiskBase):
    def _kosu(self, **values):
        self.make()
        rid, _ = self.new_run(values=values)
        return json.loads((self.folder_of(rid) / "kosu.json").read_text(encoding="utf-8"))

    def test_kosu_json_marks_default_world_as_old_measurement(self):
        self.assertEqual(self._kosu()["measurement"], {"new": False, "settings": []})

    def test_kosu_json_marks_new_measurement(self):
        k = self._kosu(baslangic_istihdami=48, nufus_olcegi=True)
        self.assertTrue(k["measurement"]["new"])
        self.assertEqual(sorted(k["measurement"]["settings"]), ["baslangic_istihdami", "nufus_olcegi"])

    def test_default_valued_card_is_not_new_measurement(self):
        k = self._kosu(baslangic_istihdami=0, isletme_kapasitesi={"kip": "sabit", "pay": 125, "en_az": 25, "hammadde": 75, "imalat": 75, "hizmet": 75, "lojistik": 240})
        self.assertFalse(k["measurement"]["new"])

    def test_non_world_cards_do_not_mark_new_measurement(self):
        k = self._kosu(sehir_basina_oyuncu=500)
        self.assertFalse(k["measurement"]["new"])


class PlanFunction(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = real_defaults()
        cls.root = str(config.MODEL_ROOT)

    def test_default_plan(self):
        p = plan.world_plan(self.root, {}, self.d)
        self.assertEqual(p["population"], {"playersPerCity": 300, "cities": 5, "players": 1500, "npc": 5100, "total": 6600})
        self.assertEqual(p["firms"]["total"], 124)
        self.assertEqual(p["openingStaff"]["total"], 2663)
        self.assertAlmostEqual(p["openingStaff"]["npcRate"], 2663 / 5100, places=4)
        self.assertEqual(set(p["blockedKinds"]), {"maden_silika", "tarla_bugday", "tarla_seker"})
        self.assertEqual((p["capMode"], p["capGrowth"]), ("sabit", "sabit_taban"))
        self.assertAlmostEqual(p["housing"]["total"], 4787.45, places=6)      # rekabet G16: HOUSE_MODE=1 varsayilani (eski 5 * 391.0)
        by = {k["kind"]: k for k in p["kinds"]}
        self.assertEqual((by["tarla_bugday"]["firms"], by["tarla_bugday"]["capacity"], by["tarla_bugday"]["maxPeople"], by["tarla_bugday"]["blocked"]), (2, 75, 150, True))
        self.assertEqual(by["tarla_bugday"]["label"], "Buğday tarlası")
        self.assertEqual(by["tarla_bugday"]["group"], "hammadde")
        self.assertEqual(by["lojistik"]["group"], "lojistik")
        self.assertEqual(by["market"]["group"], "hizmet")
        self.assertEqual(by["un"]["group"], "imalat")
        self.assertEqual(by["un"]["growthCeiling"], 75.0)
        for k in p["kinds"]:
            self.assertEqual(set(k), {"kind", "label", "group", "firms", "capacity", "maxPeople", "target", "planned", "blocked", "shortfall", "growthCeiling"})

    def test_plan_reports_no_ceiling_with_profit_dividends(self):
        """Son inceleme M1: kâr hanelere temettü (MONEY_LOOP=2) seçiliyken kapasite büyüme tavanı yoktur."""
        self.assertEqual(plan.world_plan(self.root, {"MONEY_LOOP": 2}, self.d)["capGrowth"], "yok")
        self.assertEqual(plan.world_plan(self.root, {"MONEY_LOOP": 1}, self.d)["capGrowth"], "sabit_taban")

    def test_plan_follows_settings_without_running_weeks(self):
        p = plan.world_plan(self.root, {"START_EMP": 0.48, "CAP_MODE": 1, "HOUSE_MODE": 1, "FIRMS_PER_1000": 30.0}, self.d)
        self.assertEqual(p["blockedKinds"], [])
        self.assertEqual(p["capMode"], "otomatik")
        self.assertLess(abs(p["openingStaff"]["npcRate"] - 0.48), 0.01)
        self.assertLessEqual(abs(p["firms"]["total"] - 30.0 * 6.6), 2)
        self.assertAlmostEqual(p["firms"]["per1000"], p["firms"]["total"] / 6.6, places=2)
        self.assertGreater(p["housing"]["total"], 5 * 391.0)
        self.assertEqual(len(p["housing"]["tenants"]), 5)

    def test_population_follows_settings(self):
        p = plan.world_plan(self.root, {"PLAYERS_PER_CITY": 600, "NPC_X": 900, "NPC_Y": 2.5, "POP_SCALE": True}, self.d)
        self.assertEqual(p["population"]["players"], 3000)
        self.assertEqual(p["population"]["npc"], int(900 + 2.5 * 600 * 5))
        self.assertGreater(p["scale"]["population"], 1.0)

    def test_cache_returns_equal_result(self):
        a = plan.world_plan(self.root, {"START_EMP": 0.30}, self.d)
        b = plan.world_plan(self.root, {"START_EMP": 0.30}, self.d)
        self.assertEqual(a, b)

    def test_bad_model_root_raises(self):
        with self.assertRaises(RuntimeError):
            plan.world_plan("/nonexistent-model-root", {"START_EMP": 0.11}, self.d)


class PlanRoute(unittest.TestCase):
    def test_route_returns_plan_and_validates(self):
        with live_app() as (srv, app, _w):
            s, _h, b = call(srv, "POST", "/api/world/plan", {"config": {"templateId": "dayanikli_taban", "values": {"baslangic_istihdami": 48, "isletme_kapasitesi": {"kip": "otomatik", "pay": 125, "en_az": 25, "hammadde": 75, "imalat": 75, "hizmet": 75, "lojistik": 240}}}})
            self.assertEqual(s, 200, b)
            self.assertEqual(b["capMode"], "otomatik")
            self.assertEqual(b["population"]["total"], 6600)
            self.assertLess(abs(b["openingStaff"]["npcRate"] - 0.48), 0.01)
            s, _h, b = call(srv, "POST", "/api/world/plan", {"config": {"templateId": "dayanikli_taban", "values": {"baslangic_istihdami": 95}}})
            self.assertEqual(s, 422)
            self.assertEqual(b["error"]["code"], "invalid_config")
            s, _h, b = call(srv, "POST", "/api/world/plan", {})
            self.assertEqual(s, 422)

    def test_route_rejects_foreign_origin(self):
        with live_app() as (srv, app, _w):
            s, _h, b = call(srv, "POST", "/api/world/plan", {"config": {}}, headers={"Content-Type": "application/json", "X-Oyun-Istek": "1", "Origin": "http://evil.example"})
            self.assertIn(s, (403, 400))


class Indicators(unittest.TestCase):
    def test_world_fields_registered_and_noted(self):
        for name in ("staff_fill", "kinds_full", "house_stock", "opening_staff"):
            self.assertIn((name, "x_" + name), extract.EXTRA_FIELDS)
            self.assertIn(name, probes.FIELD_NOTES)
        self.assertEqual(extract.NEW_WORLD_FIELDS, ())

    def test_real_model_facts(self):
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), {}, 3)
        try:
            h.step()
            f = h.facts()
            self.assertEqual(f["x_opening_staff"], 2663)
            self.assertGreater(f["x_staff_fill"], 0.0)
            self.assertLessEqual(f["x_staff_fill"], 1.0)
            self.assertGreaterEqual(f["x_kinds_full"], 1)
            self.assertAlmostEqual(f["x_house_stock"], 5 * 391.0, delta=60)          # birinci hafta sonunda konut yatırımı küçük fark yaratabilir
            d = h.drawer("sector", "tarla_bugday")
            self.assertIn("capacity", d["fields"])
            self.assertGreater(d["fields"]["capacity"], 0)
            self.assertLessEqual(d["fields"]["fill"], 1.0 + 1e-9)
        finally:
            h.close()

    def test_indicators_follow_world_setup(self):
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), {"CAP_MODE": 1, "START_EMP": 0.30}, 3)
        try:
            h.step()
            f = h.facts()
            self.assertEqual(f["x_opening_staff"], plan.world_plan(str(config.MODEL_ROOT), {"CAP_MODE": 1, "START_EMP": 0.30}, real_defaults())["openingStaff"]["total"])
        finally:
            h.close()


if __name__ == "__main__":
    unittest.main()
