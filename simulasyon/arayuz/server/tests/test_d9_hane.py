"""D9: NPC hanesi (A2), açılış geçişi (A9) ve hane geliri kartları (C): kayıt, çözümleme, metinler, apply sınıfı, yeni ölçüm işareti, açılış hesabı (işgücü), göstergeler."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server import config
from oyun_server.registry import resolve
from oyun_server.sim import extract, plan, probes

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry
from tests.route_helpers import call, live_app
from tests.test_kosu_disk import DiskBase

A_KARTLARI = {
    "npc_hanesi": ["NPC_HOUSE", "NPC_LFPR", "HOUSE_DEP_EQ"],
    "acilis_gecisi": ["OPEN_MODE", "OPEN_GRACE", "OPEN_TR", "OPEN_CAPEX", "OPEN_SWEEP"],
}
C_KARTLARI = {
    "servet_kurali": ["WEALTH_RULE"],
    "npc_en_az_nakit": ["NPC_MIN_BAL"],
    "npc_havuz_vergisi": ["NPC_POOL_TAX", "NPC_POOL_FLOOR"],
    "npc_asgari": ["NPC_ASGARI"],
}
TUMU = {**A_KARTLARI, **C_KARTLARI}
WORLD_FIELDS = ("npc_dependents", "npc_lfp")


class Kartlar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.d = real_defaults()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_world_cards(self):
        for k, params in A_KARTLARI.items():
            s = self.reg.by_id[k]
            self.assertEqual((s.layer, s.group, s.editable, s.status, s.apply, s.decision), ("P", "dunya", True, "experimental", "start_only", "D9"), k)
            self.assertEqual(list(s.params), params, k)

    def test_household_income_cards(self):
        for k, params in C_KARTLARI.items():
            s = self.reg.by_id[k]
            self.assertEqual((s.layer, s.group, s.editable, s.decision), ("P", "hane_geliri", True, "D9"), k)
            self.assertEqual(list(s.params), params, k)
        self.assertEqual(self.reg.by_id["npc_asgari"].status, "experimental")

    def test_group_registered_with_texts(self):
        self.assertIn("hane_geliri", [g["id"] for g in self.reg.groups])
        self.assertTrue(self.texts["_gruplar"]["hane_geliri"]["title"].strip())

    def test_model_defaults_are_todays_behaviour(self):
        d = self.d
        self.assertEqual((d["NPC_HOUSE"], d["OPEN_MODE"]), (0, 0))
        self.assertEqual((d["OPEN_GRACE"], d["OPEN_TR"], d["OPEN_CAPEX"], d["OPEN_SWEEP"]), (26, 26, 26, 26))
        self.assertEqual((d["NPC_GRACE"], d["TR_START"], d["CAPEX_START"]), (26, 26, 26))
        self.assertEqual((d["WEALTH_RULE"], d["NPC_MIN_BAL"], d["NPC_POOL_TAX"], d["NPC_POOL_FLOOR"], d["NPC_ASGARI"]), (True, 1.0, 0.0, 0.5, False))

    def test_defaults_round_trip_through_codecs(self):
        for k in TUMU:
            s = self.reg.by_id[k]
            ui = self.reg.default_ui(s)
            r = resolve.resolve(self.reg, {k: ui})
            self.assertEqual(r.errors, [], k)
            for p, v in r.params.items():
                self.assertEqual(v, self.d[p], (k, p))

    def test_resolve_to_params(self):
        r = resolve.resolve(self.reg, {
            "npc_hanesi": {"kip": "hane", "katilim": 50, "agirlik": 30},
            "acilis_gecisi": {"kip": "elle", "kurtarma": 10, "kasa": 5, "yatirim": 8, "supurme": 3},
            "servet_kurali": False, "npc_en_az_nakit": 5, "npc_havuz_vergisi": {"oran": 10, "esik": 1}, "npc_asgari": True})
        self.assertEqual(r.errors, [])
        self.assertEqual(r.params, {
            "NPC_HOUSE": 1, "NPC_LFPR": 0.5, "HOUSE_DEP_EQ": 0.3, "OPEN_MODE": 2, "OPEN_GRACE": 10, "OPEN_TR": 5, "OPEN_CAPEX": 8, "OPEN_SWEEP": 3,
            "WEALTH_RULE": False, "NPC_MIN_BAL": 5, "NPC_POOL_TAX": 0.1, "NPC_POOL_FLOOR": 1, "NPC_ASGARI": True})

    def test_out_of_range_rejected(self):
        for id_, v in (("npc_hanesi", {"kip": "hane", "katilim": 10, "agirlik": 50}), ("npc_hanesi", {"kip": "bilinmeyen", "katilim": 50, "agirlik": 50}),
                       ("acilis_gecisi", {"kip": "elle", "kurtarma": 200, "kasa": 5, "yatirim": 8, "supurme": 3}), ("npc_en_az_nakit", 60),
                       ("npc_havuz_vergisi", {"oran": 80, "esik": 1}), ("npc_asgari", 1)):
            r = resolve.resolve(self.reg, {id_: v})
            self.assertTrue(r.errors, (id_, v))

    def test_apply_matches_evidence(self):
        ev = read_json(REAL_DIR / "apply_classes.json")
        for k, params in TUMU.items():
            self.assertEqual(self.reg.by_id[k].apply, ev["cards"][k], k)
            for p in params:
                self.assertIn(p, ev["keys"], p)
        for k, params in A_KARTLARI.items():                    # kuruluşta okunanlar kilitlidir
            self.assertEqual(ev["cards"][k], "start_only", k)

    def test_texts_complete_and_clean(self):
        bad = re.compile(r"\b(BIG_[A-Z_]+|CAP_[A-Z_]+|OPEN_[A-Z_]+|NPC_[A-Z_]+|HOUSE_[A-Z_]+|WEALTH_[A-Z_]+|TR_START|CAPEX_START|K-\d+)\b")
        for k in TUMU:
            t = self.texts[k]
            for part in ("title", "what", "changes"):
                self.assertTrue(t[part].strip(), (k, part))
            self.assertIsNone(bad.search(json.dumps(t, ensure_ascii=False)), (k, bad.search(json.dumps(t, ensure_ascii=False))))

    def test_household_text_says_it_creates_no_money(self):
        w = self.texts["npc_hanesi"]["what"]
        self.assertIn("para yaratılmaz", w)
        self.assertIn("şehir kasasından çıkmaz", w)
        self.assertIn("hane içi paylaşım", w)
        # tüketici sayısı tanımı D7'nindir (Açılış talebi kartı): metin bakmakla yükümlüyü ayrıca saymadığını söyler
        self.assertIn("Açılış talebi", w)

    def test_opening_text_only_defines_timing(self):
        w = self.texts["acilis_gecisi"]["what"]
        self.assertIn("yalnız zamanlamayı belirler", w)
        self.assertIn("yönünü değiştirmez", w)

    def test_asgari_text_is_neutral_transfer_note_with_measurement(self):
        t = self.texts["npc_asgari"]
        self.assertIn("transfer", t["what"])
        self.assertIn("parayı dağıtmanın tek başına sorunu çözmediği", t["what"])
        self.assertIn("641", t["changes"])                       # OLCUM ASG: 20. hafta
        self.assertIn("270", t["changes"])                       # OLCUM ASG: 60. hafta
        self.assertIn("ölçüm", t["what"])

    def test_unmeasured_cards_carry_no_numeric_effect_claim(self):
        for k in ("servet_kurali", "npc_en_az_nakit", "npc_havuz_vergisi", "npc_hanesi"):
            blob = self.texts[k]["changes"] + self.texts[k].get("warning", "")
            self.assertIn("ölçülmedi", blob, k)


class MeasurementMark(DiskBase):
    def _kosu(self, **values):
        self.make()
        rid, _ = self.new_run(values=values)
        return json.loads((self.folder_of(rid) / "kosu.json").read_text(encoding="utf-8"))

    def test_default_is_old_measurement(self):
        self.assertEqual(self._kosu()["measurement"], {"new": False, "settings": []})

    def test_a_and_c_cards_mark_new_measurement(self):
        k = self._kosu(npc_hanesi={"kip": "hane", "katilim": 50, "agirlik": 50}, acilis_gecisi={"kip": "dengede", "kurtarma": 26, "kasa": 26, "yatirim": 26, "supurme": 26}, npc_asgari=True)
        self.assertTrue(k["measurement"]["new"])
        self.assertEqual(sorted(k["measurement"]["settings"]), ["acilis_gecisi", "npc_asgari", "npc_hanesi"])

    def test_default_valued_cards_are_not_new(self):
        k = self._kosu(npc_hanesi={"kip": "tek_kisi", "katilim": 52.7, "agirlik": 50}, npc_en_az_nakit=1)
        self.assertFalse(k["measurement"]["new"])


class PlanLaborForce(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = real_defaults()
        cls.root = str(config.MODEL_ROOT)

    def test_single_person_default(self):
        p = plan.world_plan(self.root, {}, self.d)
        lf = p["laborForce"]
        self.assertEqual(lf, {"mode": "tek_kisi", "players": 1500, "npc": 5100, "dependents": 0, "participation": 1.0, "total": 6600})

    def test_household_mode(self):
        p = plan.world_plan(self.root, {"NPC_HOUSE": 1, "NPC_LFPR": 0.5}, self.d)
        lf = p["laborForce"]
        self.assertEqual(lf["mode"], "hane")
        self.assertEqual(lf["players"], 1500)
        self.assertEqual(lf["npc"] + lf["dependents"], 5100)
        self.assertAlmostEqual(lf["participation"], 0.5, delta=0.01)
        self.assertEqual(lf["total"], lf["players"] + lf["npc"])
        self.assertLess(lf["total"], p["population"]["total"])

    def test_route_returns_labor_force(self):
        with live_app() as (srv, app, _w):
            s, _h, b = call(srv, "POST", "/api/world/plan", {"config": {"templateId": "dayanikli_taban", "values": {"npc_hanesi": {"kip": "hane", "katilim": 60, "agirlik": 50}}}})
            self.assertEqual(s, 200, b)
            self.assertEqual(b["laborForce"]["mode"], "hane")
            self.assertAlmostEqual(b["laborForce"]["participation"], 0.6, delta=0.01)


class Indicators(unittest.TestCase):
    def test_world_fields_registered_and_noted(self):
        for name in WORLD_FIELDS:
            self.assertIn((name, "x_" + name), extract.EXTRA_FIELDS)
            self.assertIn(name, probes.FIELD_NOTES)
        self.assertEqual(extract.NEW_WORLD_FIELDS, ())

    def test_single_person_facts(self):
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), {}, 3)
        try:
            h.step()
            f = h.facts()
            self.assertEqual(f["x_npc_dependents"], 0)
            self.assertEqual(f["x_npc_lfp"], 1.0)
        finally:
            h.close()

    def test_household_facts_and_unable_count(self):
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), {"NPC_HOUSE": 1, "NPC_LFPR": 0.5}, 4)
        try:
            for _ in range(3):
                h.step()
            f = h.facts()
            self.assertAlmostEqual(f["x_npc_lfp"], 0.5, delta=0.01)
            self.assertEqual(f["x_npc_dependents"], 2550)
            W = h._W
            self.assertEqual(f["x_npc_pool"] + f["x_npc_employed"], 2550)             # işgücündeki NPC
            floor = h._P.NPC_MIN_BAL
            want = sum(1 for c in W.cities for q in list(c["pool"]) + list(c["deps"]) if W.L.bal[q] < floor)
            self.assertEqual(f["x_npc_broke"], want)                                  # tüketemeyen NPC bakmakla yükümlüleri de sayar
            from oyun_server.sim import extract_cities
            rows = extract_cities.city_rows(W, h._P, None)
            self.assertEqual(sum(r["npc_broke"] for r in rows), want)
        finally:
            h.close()


if __name__ == "__main__":
    unittest.main()
