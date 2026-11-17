"""D10: iş piyasası akışı kartları B2-B7 (kayıt, çözümleme, aralıklar, metinler, apply sınıfı) ve D9 incelemesinden taşınan metin düzeltmeleri (M1, M2)."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server.registry import resolve

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry

KARTLAR = {
    "kadro_hizi": ["STAFF_ADJ", "SHRINK_CAP", "GROW_CAP"],
    "isci_akislari": ["SEP_RATE", "FIND_RATE"],
    "ucret_issizlik_kapsami": ["WAGE_U_ALL"],
    "kamu_istihdami_havuz": ["MUNI_POOL", "JG_WAGE", "JG_MAX"],
    "isgucu_disina_cikis": ["DISCOURAGE_WEEKS", "DISC_RATE", "DISC_RETURN"],
}
RANK = {"live": 0, "live_sync": 1, "start_only": 2}
BAD = re.compile(r"\b(K-\d+|PM_ADJ|[A-Z]+_CAL|BIG_[A-Z_]+|CAP_[A-Z_]+|STAFF_[A-Z_]+|SHRINK_[A-Z_]+|GROW_[A-Z_]+|SEP_RATE|FIND_RATE|WAGE_U_ALL|MUNI_[A-Z_]+|JG_[A-Z_]+|DISC[A-Z_]+|NPC_[A-Z_]+|OPEN_[A-Z_]+|FIRE_ORDER|HIRE_PRIORITY)\b")
SAYI_EK = re.compile(r"\{[a-z_]+\}'?(den|dan|ten|tan|de|da|e|a|ye|ya)\b")        # "{n}'den" gibi sayı+sabit ek kalıbı


class Kartlar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.d = real_defaults()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_cards_in_registry_labor_group_as_experimental(self):
        for k, params in KARTLAR.items():
            s = self.reg.by_id[k]
            self.assertEqual((s.layer, s.group, s.editable, s.status, s.decision), ("P", "is_piyasasi", True, "experimental", "D10"), k)
            self.assertEqual(list(s.params), params, k)

    def test_model_defaults_are_todays_behaviour(self):
        d = self.d
        self.assertEqual((d["STAFF_ADJ"], d["SHRINK_CAP"], d["GROW_CAP"]), (0, 0.03, 0.10))
        self.assertEqual((d["SEP_RATE"], d["FIND_RATE"], d["WAGE_U_ALL"]), (0.0, 1.0, 0))
        self.assertEqual((d["MUNI_POOL"], d["JG_WAGE"], d["JG_MAX"]), (0, 1.0, 0.05))
        self.assertEqual((d["DISCOURAGE_WEEKS"], d["DISC_RATE"], d["DISC_RETURN"]), (0, 0.05, 0.02))

    def test_default_ui_values_and_round_trip(self):
        r = self.reg
        self.assertEqual(r.default_ui(r.by_id["kadro_hizi"]), {"kural": "kapali", "kucul": 3, "buyu": 10})
        self.assertEqual(r.default_ui(r.by_id["isci_akislari"]), {"ayrilma": 0, "is_bulma": 100})
        self.assertEqual(r.default_ui(r.by_id["ucret_issizlik_kapsami"]), False)
        self.assertEqual(r.default_ui(r.by_id["kamu_istihdami_havuz"]), {"kural": "kapali", "ucret": 100, "en_cok": 5})
        self.assertEqual(r.default_ui(r.by_id["isgucu_disina_cikis"]), {"bekleme": 0, "cikis": 5, "donus": 2})
        for k in KARTLAR:
            res = resolve.resolve(r, {k: r.default_ui(r.by_id[k])})
            self.assertEqual(res.errors, [], k)
            for p, v in res.params.items():
                self.assertEqual(v, self.d[p], (k, p))

    def test_resolve_to_params(self):
        r = resolve.resolve(self.reg, {
            "kadro_hizi": {"kural": "acik", "kucul": 5, "buyu": 20},
            "isci_akislari": {"ayrilma": 0.55, "is_bulma": 6},
            "ucret_issizlik_kapsami": True,
            "kamu_istihdami_havuz": {"kural": "acik", "ucret": 80, "en_cok": 10},
            "isgucu_disina_cikis": {"bekleme": 26, "cikis": 10, "donus": 3}})
        self.assertEqual(r.errors, [])
        p = r.params
        self.assertEqual((p["STAFF_ADJ"], p["WAGE_U_ALL"], p["MUNI_POOL"], p["DISCOURAGE_WEEKS"]), (1, 1, 1, 26))
        self.assertAlmostEqual(p["SHRINK_CAP"], 0.05)
        self.assertAlmostEqual(p["GROW_CAP"], 0.2)
        self.assertAlmostEqual(p["SEP_RATE"], 0.0055)
        self.assertAlmostEqual(p["FIND_RATE"], 0.06)
        self.assertAlmostEqual(p["JG_WAGE"], 0.8)
        self.assertAlmostEqual(p["JG_MAX"], 0.1)
        self.assertAlmostEqual(p["DISC_RATE"], 0.1)
        self.assertAlmostEqual(p["DISC_RETURN"], 0.03)

    def test_out_of_range_rejected(self):
        ok = {"kadro_hizi": {"kural": "acik", "kucul": 3, "buyu": 10}, "isci_akislari": {"ayrilma": 0.5, "is_bulma": 6},
              "kamu_istihdami_havuz": {"kural": "acik", "ucret": 100, "en_cok": 5}, "isgucu_disina_cikis": {"bekleme": 26, "cikis": 5, "donus": 2}}
        bad = [("kadro_hizi", {**ok["kadro_hizi"], "kucul": 0}), ("kadro_hizi", {**ok["kadro_hizi"], "kucul": 11}), ("kadro_hizi", {**ok["kadro_hizi"], "buyu": 31}),
               ("kadro_hizi", {**ok["kadro_hizi"], "kural": "belki"}),
               ("isci_akislari", {**ok["isci_akislari"], "ayrilma": 2.5}), ("isci_akislari", {**ok["isci_akislari"], "is_bulma": 0.5}),
               ("isci_akislari", {**ok["isci_akislari"], "is_bulma": 101}),
               ("kamu_istihdami_havuz", {**ok["kamu_istihdami_havuz"], "ucret": 40}), ("kamu_istihdami_havuz", {**ok["kamu_istihdami_havuz"], "en_cok": 16}),
               ("isgucu_disina_cikis", {**ok["isgucu_disina_cikis"], "bekleme": 105}), ("isgucu_disina_cikis", {**ok["isgucu_disina_cikis"], "bekleme": 2.5}),
               ("isgucu_disina_cikis", {**ok["isgucu_disina_cikis"], "cikis": 0}), ("isgucu_disina_cikis", {**ok["isgucu_disina_cikis"], "donus": 51})]
        for id_, v in bad:
            with self.subTest(id=id_, value=v):
                r = resolve.resolve(self.reg, {id_: v})
                self.assertEqual(r.params, {})
                self.assertEqual(r.errors[0].id, id_)
        for id_, v in ok.items():
            self.assertEqual(resolve.resolve(self.reg, {id_: v}).errors, [], id_)

    def test_texts_complete_and_clean(self):
        for k, params in KARTLAR.items():
            t = self.texts[k]
            for part in ("title", "what", "changes"):
                self.assertTrue(t[part].strip(), (k, part))
            blob = json.dumps(t, ensure_ascii=False)
            self.assertIsNone(BAD.search(blob), (k, BAD.search(blob)))
            for p in params:
                self.assertNotIn(p, blob, (k, p))

    def test_texts_claim_only_measured_effects(self):
        """Ölçülen tek etki: kadro düzeltme hızı (haftada en çok yüzde 10 küçülme, tek başına). Öbürleri 'ölçülmedi' der ve sayı iddia etmez."""
        c = self.texts["kadro_hizi"]["changes"]
        for n in ("774", "1.001", "272", "66"):
            self.assertIn(n, c)
        self.assertIn("yüzde 10", c)
        self.assertIn("yalnız geciktirir", c)
        for k in ("isci_akislari", "ucret_issizlik_kapsami", "kamu_istihdami_havuz", "isgucu_disina_cikis"):
            blob = self.texts[k]["changes"] + self.texts[k].get("warning", "")
            self.assertIn("ölçülmedi", blob, k)
            self.assertIsNone(re.search(r"\d\.\d{3}|\d{3,}", self.texts[k]["changes"]), k)       # ölçülmemiş etki için sayı yok

    def test_texts_state_what_the_model_does(self):
        t = self.texts
        self.assertIn("çıkarılacağını", t["kadro_hizi"]["what"])                  # sıra işten çıkarma kartında kalır
        self.assertIn("zarar eden", t["kadro_hizi"]["what"])                            # muafiyet
        self.assertIn("1. hafta", t["isci_akislari"]["what"])                           # açılış kadrosu etkilenmez
        self.assertIn("işgücündeki", t["ucret_issizlik_kapsami"]["what"])
        self.assertIn("iş arayan oyuncular bittikten sonra", t["kamu_istihdami_havuz"]["what"])
        self.assertIn("döner", t["isgucu_disina_cikis"]["what"])                        # dönüş kuralı
        self.assertIn("ölçüme dayanmıyor", t["isgucu_disina_cikis"]["what"] + t["isgucu_disina_cikis"]["changes"])

    def test_correction_round_1_texts(self):
        t = self.texts
        self.assertIn("teorik olarak", t["isci_akislari"]["changes"])
        w = t["ucret_issizlik_kapsami"]["what"]
        self.assertIn("rezervasyon ücreti kartı yok", w)
        self.assertIn("İşgücü kıtlığında ücret", w)
        self.assertIn("Asgari güvence", w)
        k = t["kamu_istihdami_havuz"]["what"]
        self.assertIn("iş arayan oyuncu gelirse", k)

    def test_no_number_plus_suffix_in_texts(self):
        for k in list(KARTLAR) + ["acilis_gecisi"]:
            blob = json.dumps(self.texts[k], ensure_ascii=False)
            self.assertIsNone(SAYI_EK.search(blob), (k, SAYI_EK.search(blob)))

    def test_apply_classes_have_evidence(self):
        ev = read_json(REAL_DIR / "apply_classes.json")
        for k, params in KARTLAR.items():
            for p in params:
                self.assertIn(p, ev["keys"], p)
            worst = max(RANK[ev["keys"][p]["class"]] for p in params)
            self.assertEqual(RANK[ev["cards"][k]], worst, k)
            self.assertEqual(self.reg.by_id[k].apply, ev["cards"][k], k)

    def test_baseline_has_no_carded_names(self):
        base = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        self.assertFalse(base & {p for ps in KARTLAR.values() for p in ps})

    def test_wage_card_text_notes_the_npc_scope(self):
        """Eski ücret tepkisi kartı işsizliği yalnız oyuncu olarak tanımlıyordu; yeni kart açıkken bu değişir ve metin bunu söyler."""
        self.assertIn("Ücretin baktığı işsizlik kapsamı", self.texts["issizlik_ucret_tepkisi"]["what"])


class D9Duzeltmeleri(unittest.TestCase):
    """D9 incelemesi M1 ve M2: açılış geçişi kartı metinleri."""

    @classmethod
    def setUpClass(cls):
        cls.t = read_json(REAL_DIR / "metinler.tr.json")["acilis_gecisi"]

    def test_m1_balanced_mode_names_the_other_rules_it_starts(self):
        blob = self.t["changes"] + self.t["fields"]["kurtarma"]["hint"]
        for part in ("batan işletmenin yeniden kurulması", "işsiz havuz", "geçiş desteği"):
            self.assertIn(part, blob)
        self.assertIsNone(BAD.search(json.dumps(self.t, ensure_ascii=False)))

    def test_m2_measurement_is_not_presented_as_a_difference(self):
        w = self.t["warning"]
        self.assertIn("ayırt edilebilir bir fark görülmedi", w)
        self.assertNotIn("küçük bir fark yarattı", w)
        self.assertIn("269", w)
        self.assertIn("288", w)


if __name__ == "__main__":
    unittest.main()
