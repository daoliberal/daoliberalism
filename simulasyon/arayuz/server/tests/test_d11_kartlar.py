"""D11: para devresi (D1) ve hayalet işletme (D2) kartları: kayıt, çözümleme, aralıklar, metinler, apply sınıfı, yeni ölçüm işareti."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server.registry import resolve
from oyun_server.sim import plan

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry

KARTLAR = {
    "para_devresi": ("butce", ["MONEY_LOOP"]),
    "hayalet_firma": ("kurtarma", ["GHOST_MODE", "GHOST_WEEKS"]),
}
RANK = {"live": 0, "live_sync": 1, "start_only": 2}
BAD = re.compile(r"\b(K-\d+|PM_ADJ|[A-Z]+_CAL|BIG_[A-Z_]+|CAP_[A-Z_]+|MONEY_LOOP|GHOST_[A-Z_]+|TREASURY_RULE|PROFIT_KEEP|TRANS_SUPPORT|NO_BAILOUT|NPC_[A-Z_]+|OPEN_[A-Z_]+|TR_[A-Z_]+|PK_[A-Z_]+)\b")
SAYI_EK = re.compile(r"\{[a-z_]+\}'?(den|dan|ten|tan|de|da|e|a|ye|ya)\b")


class Kartlar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.d = real_defaults()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_cards_are_experimental_d11_cards_in_their_groups(self):
        for k, (group, params) in KARTLAR.items():
            s = self.reg.by_id[k]
            self.assertEqual((s.layer, s.group, s.editable, s.status, s.decision), ("P", group, True, "experimental", "D11"), k)
            self.assertEqual(list(s.params), params, k)

    def test_model_defaults_are_todays_behaviour(self):
        d = self.d
        self.assertEqual(d["MONEY_LOOP"], 0)
        self.assertEqual((d["GHOST_MODE"], d["GHOST_WEEKS"]), (0, 13))
        self.assertEqual((d["TREASURY_RULE"], d["PROFIT_KEEP"]), (0, 0))

    def test_default_ui_values_and_round_trip(self):
        r = self.reg
        self.assertEqual(r.default_ui(r.by_id["para_devresi"]), "kasa_biriktirir")
        self.assertEqual(r.default_ui(r.by_id["hayalet_firma"]), {"kip": "kapali", "hafta": 13})
        for k in KARTLAR:
            res = resolve.resolve(r, {k: r.default_ui(r.by_id[k])})
            self.assertEqual(res.errors, [], k)
            for p, v in res.params.items():
                self.assertEqual(v, self.d[p], (k, p))

    def test_resolve_to_params(self):
        for ui, code in (("kasa_biriktirir", 0), ("kasa_geri_doner", 1), ("kar_hanelere", 2)):
            r = resolve.resolve(self.reg, {"para_devresi": ui})
            self.assertEqual((r.errors, r.params), ([], {"MONEY_LOOP": code}), ui)
        r = resolve.resolve(self.reg, {"hayalet_firma": {"kip": "iscisiz_kalan", "hafta": 26}})
        self.assertEqual((r.errors, r.params), ([], {"GHOST_MODE": 2, "GHOST_WEEKS": 26}))
        r = resolve.resolve(self.reg, {"hayalet_firma": {"kip": "destek_gelmeyen", "hafta": 8}})
        self.assertEqual(r.params, {"GHOST_MODE": 1, "GHOST_WEEKS": 8})

    def test_out_of_range_rejected(self):
        bad = [("para_devresi", "belki"), ("hayalet_firma", {"kip": "iscisiz_kalan", "hafta": 0}), ("hayalet_firma", {"kip": "iscisiz_kalan", "hafta": 105}),
               ("hayalet_firma", {"kip": "iscisiz_kalan", "hafta": 2.5}), ("hayalet_firma", {"kip": "bazen", "hafta": 13})]
        for id_, v in bad:
            with self.subTest(id=id_, value=v):
                r = resolve.resolve(self.reg, {id_: v})
                self.assertEqual(r.params, {})
                self.assertEqual(r.errors[0].id, id_)

    def test_texts_complete_and_clean(self):
        for k in KARTLAR:
            t = self.texts[k]
            for part in ("title", "what", "changes"):
                self.assertTrue(t[part].strip(), (k, part))
            blob = json.dumps(t, ensure_ascii=False)
            self.assertIsNone(BAD.search(blob), (k, BAD.search(blob)))
            self.assertIsNone(SAYI_EK.search(blob), (k, SAYI_EK.search(blob)))

    def test_money_loop_text_names_all_three_options_and_the_division_of_labour(self):
        t = self.texts["para_devresi"]
        self.assertEqual(set(t["options"]), {"kasa_biriktirir", "kasa_geri_doner", "kar_hanelere"})
        what = t["what"]
        for part in ("Kasa biriktirir", "Kasa gelirini geri döndürür", "Kâr hanelere temettü"):
            self.assertIn(part, what)
        self.assertIn("Açılış geçişi", what)                                 # zamanlama o kartta
        self.assertIn("yalnız paranın yönünü", what)
        self.assertIn("para yoktan yaratılmaz", what)                        # temettü ve transferler gerçek bakiye hareketi
        self.assertIn("kapasite tavanı", what)                               # kâr payı yolu kapasite kuralını da değiştirir
        self.assertIn("ayrıca açıksa", what)                                 # eski iki kartla ilişki

    def test_money_loop_text_claims_only_measured_effects(self):
        t = self.texts["para_devresi"]
        w = t["warning"]
        for n in ("269", "288", "246", "56"):
            self.assertIn(n, w)
        self.assertIn("ayırt edilebilir bir fark görülmedi", w)
        self.assertIn("ayrıca ölçülmedi", w)                                 # hanelerin paradaki payı
        self.assertNotRegex(t["changes"], r"\d{3}")                          # ölçülmemiş etki için sayı yok

    def test_ghost_text_defines_the_ghost_and_says_unmeasured(self):
        t = self.texts["hayalet_firma"]
        self.assertEqual(set(t["fields"]["kip"]["options"]), {"kapali", "destek_gelmeyen", "iscisiz_kalan"})
        what = t["what"]
        for part in ("İşçisi kalmayan", "bir kişilik işletme sermayesine", "kamu altyapısı", "geçiş desteği", "kurtarma süresi bitmeden"):
            self.assertIn(part, what)
        blob = t["changes"] + t.get("warning", "")
        self.assertIn("ölçülmedi", blob)
        self.assertNotRegex(t["changes"], r"\d{3}")

    def test_apply_classes_have_evidence(self):
        ev = read_json(REAL_DIR / "apply_classes.json")
        for k, (_, params) in KARTLAR.items():
            for p in params:
                self.assertIn(p, ev["keys"], p)
            worst = max(RANK[ev["keys"][p]["class"]] for p in params)
            self.assertEqual(RANK[ev["cards"][k]], worst, k)
            self.assertEqual(self.reg.by_id[k].apply, ev["cards"][k], k)
        self.assertEqual(ev["cards"]["para_devresi"], "start_only")           # eski bayraklara içe aktarmada türetilir

    def test_baseline_has_no_carded_names(self):
        base = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        self.assertFalse(base & {p for _, ps in KARTLAR.values() for p in ps})

    def test_d11_marks_a_run_as_new_measurement(self):
        self.assertIn("D11", plan.DECISIONS)
        settings = [self.reg.by_id[k] for k in KARTLAR]
        m = plan.new_measurement(settings, {"MONEY_LOOP": 2}, self.d)
        self.assertTrue(m["new"])
        self.assertEqual(m["settings"], ["para_devresi"])
        m = plan.new_measurement(settings, {"GHOST_MODE": 0, "GHOST_WEEKS": 13}, self.d)
        self.assertFalse(m["new"])


class DuzeltmeTuru1(unittest.TestCase):
    """D11 düzeltme 1: inceleme I1, I2, M1, M2, M4 (metin ve gösterim)."""

    @classmethod
    def setUpClass(cls):
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.reg = real_registry()

    def test_i1_side_effect_stated_in_label_changes_and_warning(self):
        t = self.texts["para_devresi"]
        self.assertIn("büyüme kuralı da değişir", t["options"]["kar_hanelere"])
        self.assertNotIn("Bu kart yalnız yönü seçer", t["what"])
        for part in (t["changes"], t["warning"]):
            self.assertIn("kapasite tavanı", part)
        self.assertIn("birleşik etki", t["warning"])
        self.assertIn("ölçülmedi", t["warning"])

    def test_i2_today_label_requires_old_cards_closed(self):
        t = self.texts["para_devresi"]
        self.assertIn("eski iki kart da kapalıyken", t["options"]["kasa_biriktirir"])
        ids = {r["id"] for r in read_json(REAL_DIR / "tutarlilik.json")["rules"]}
        self.assertTrue({"para_devri_eski_kasa", "para_devri_eski_kar"} <= ids)
        for k in ("para_devri_eski_kasa", "para_devri_eski_kar"):
            self.assertIn(k, self.texts["_uyarilar"])

    def test_m1_measurement_timing(self):
        w = self.texts["para_devresi"]["warning"]
        self.assertIn("dengede başla", w)
        self.assertIn("yirmi altıncı hafta", w)

    def test_m2_support_sentence_is_softened(self):
        c = self.texts["para_devresi"]["changes"]
        self.assertIn("ölçülmedi", c)
        self.assertNotIn("verilemeyebilir.", c.replace("ölçülmedi", ""))  # kesin söylem yok

    def test_m4_mode_two_may_close_firms_with_demand(self):
        t = self.texts["hayalet_firma"]
        self.assertIn("işçi bulunamadığı", t["changes"])


if __name__ == "__main__":
    unittest.main()
