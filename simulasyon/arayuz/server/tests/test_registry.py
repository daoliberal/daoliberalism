"""A3: kayıt çekirdeği (varsayılanlar, yükleyici, codec, kapsam kapısı, kamusal çıktı)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from oyun_server import config
from oyun_server.registry import codec, defaults, loader
from oyun_server.registry.schema import RegistryError

from tests.registry_helpers import (EXTRA_CARD, EXTRA_TEXT, REAL_DIR, copy_data, read_json, real_defaults,
                                    real_registry, write_json)


class DefaultsTests(unittest.TestCase):
    def test_defaults_clean_env(self):
        with mock.patch.dict(os.environ, {"MODEL_PARAMS": "SALES_TAX=0.9", "WEEKLY_CSV": "/tmp/x.csv"}):
            d = defaults.read_param_defaults(str(config.MODEL_ROOT))
        self.assertEqual(d["SALES_TAX"], 0.03)
        self.assertEqual(d["TRANS_SUPPORT"], 2)

    def test_main_process_untouched(self):
        defaults.read_param_defaults(str(config.MODEL_ROOT))
        self.assertNotIn("simkit", sys.modules)
        self.assertNotIn("simbuild", sys.modules)

    def test_version_and_hash(self):
        self.assertTrue(defaults.model_version(str(config.MODEL_ROOT)).startswith("v"))
        d = real_defaults()
        self.assertEqual(defaults.defaults_hash(d), defaults.defaults_hash(dict(reversed(list(d.items())))))
        self.assertNotEqual(defaults.defaults_hash(d), defaults.defaults_hash({**d, "SALES_TAX": 0.5}))

    def test_json_serializable(self):
        json.dumps(real_defaults(), allow_nan=False)


class LoaderTests(unittest.TestCase):
    def test_every_param_key_exists(self):
        reg = real_registry()
        d = real_defaults()
        for s in reg.settings:
            for p in s.params:
                self.assertIn(p, d, f"{s.id}: {p}")

    def test_requires_missing_hides_card(self):
        d = dict(real_defaults())
        del d["TRANS_SUPPORT"]
        reg = loader.load_registry(REAL_DIR, d)
        self.assertNotIn("gecis_destegi", reg.by_id)
        self.assertIn("gecis_destegi", [s.id for s in reg.hidden])
        self.assertNotIn("gecis_destegi", [s["id"] for s in reg.public()["cards"]])

    def test_coverage_gate(self):
        names = defaults.overridable_names(str(config.MODEL_ROOT), real_defaults())
        reg = real_registry()
        registered = {p for s in reg.settings + reg.hidden for p in s.params}
        baseline = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        self.assertEqual(sorted(names - registered - baseline), [], "yeni bayrak için kayıt ekle")
        self.assertEqual(sorted(baseline - names), [], "baseline'da modelde olmayan ad var")

    def test_new_settings_file_picked_up_without_code(self):
        with tempfile.TemporaryDirectory() as td:
            d = copy_data(Path(td), drop=("satis_vergisi",))          # SALES_TAX'ın gerçek kartı ek karta yer açar
            write_json(d / "settings.x.json", {"settings": [EXTRA_CARD]})
            texts = read_json(d / "metinler.tr.json")
            texts["ek_deneme"] = EXTRA_TEXT
            write_json(d / "metinler.tr.json", texts)
            reg = loader.load_registry(d, real_defaults())
        self.assertIn("ek_deneme", reg.by_id)

    def test_new_settings_file_without_text_fails_load(self):
        with tempfile.TemporaryDirectory() as td:
            d = copy_data(Path(td))
            write_json(d / "settings.x.json", {"settings": [EXTRA_CARD]})
            with self.assertRaises(RegistryError) as cm:
                loader.load_registry(d, real_defaults())
        self.assertIn("ek_deneme", str(cm.exception))

    def test_duplicate_id_fails(self):
        with tempfile.TemporaryDirectory() as td:
            d = copy_data(Path(td))
            dup = dict(EXTRA_CARD, id="gecis_destegi")
            write_json(d / "settings.x.json", {"settings": [dup]})
            with self.assertRaises(RegistryError):
                loader.load_registry(d, real_defaults())

    def test_bad_card_fields_fail(self):
        for patch in ({"layer": "Q"}, {"kind": "zz"}, {"apply": "belki"}, {"group": "yok_grup"}, {"codec": {"type": "x"}}):
            with self.subTest(patch=patch), tempfile.TemporaryDirectory() as td:
                d = copy_data(Path(td))
                texts = read_json(d / "metinler.tr.json")
                texts["ek_deneme"] = EXTRA_TEXT
                write_json(d / "metinler.tr.json", texts)
                write_json(d / "settings.x.json", {"settings": [dict(EXTRA_CARD, **patch)]})
                with self.assertRaises(RegistryError):
                    loader.load_registry(d, real_defaults())

    def _bad_dir(self, td, mutate):
        d = copy_data(Path(td))
        mutate(d)
        return d

    def test_missing_group_or_template_title_fails_load(self):
        for section, key in (("_gruplar", "vergi"), ("_sablonlar", "dayanikli_taban")):
            with self.subTest(section=section), tempfile.TemporaryDirectory() as td:
                def m(d):
                    t = read_json(d / "metinler.tr.json")
                    del t[section][key]
                    write_json(d / "metinler.tr.json", t)
                with self.assertRaises(RegistryError):
                    loader.load_registry(self._bad_dir(td, m), real_defaults())

    def test_same_param_two_cards_fails(self):
        with tempfile.TemporaryDirectory() as td:
            def m(d):
                write_json(d / "settings.x.json", {"settings": [dict(EXTRA_CARD, params=["TRANS_SUPPORT"], requires=["TRANS_SUPPORT"])]})
                t = read_json(d / "metinler.tr.json")
                t["ek_deneme"] = EXTRA_TEXT
                write_json(d / "metinler.tr.json", t)
            with self.assertRaises(RegistryError) as cm:
                loader.load_registry(self._bad_dir(td, m), real_defaults())
        self.assertIn("TRANS_SUPPORT", str(cm.exception))

    def test_integer_key_must_be_bool(self):
        for bad in ("evet", 1, None):
            with self.subTest(v=bad), tempfile.TemporaryDirectory() as td:
                def m(d):
                    write_json(d / "settings.x.json", {"settings": [dict(EXTRA_CARD, codec=dict(EXTRA_CARD["codec"], integer=bad))]})
                    t = read_json(d / "metinler.tr.json")
                    t["ek_deneme"] = EXTRA_TEXT
                    write_json(d / "metinler.tr.json", t)
                with self.assertRaises(RegistryError):
                    loader.load_registry(self._bad_dir(td, m), real_defaults())
        # anlamı: arayüz değeri tamsayı olmalı (ölçekten bağımsız); çıktı tipi ölçekle belirlenir
        c = {"type": "number", "scale": 100, "min": 0, "max": 20, "integer": True}
        self.assertEqual(codec.decode(c, 3), 0.03)
        with self.assertRaises(ValueError):
            codec.decode(c, 3.5)

    def test_public_strips_decision(self):
        reg = real_registry()
        self.assertTrue(any(s.decision for s in reg.settings))
        pub = reg.public()
        self.assertNotIn("K-", json.dumps(pub, ensure_ascii=False))
        for s in pub["cards"]:
            self.assertNotIn("decision", s)
            self.assertTrue(s["title"] and s["what"] and s["changes"])
        g = next(s for s in pub["cards"] if s["id"] == "gecis_destegi")
        self.assertEqual([o["value"] for o in g["control"]["options"]], ["kapali", "kisa_sureli", "kurtarma_fonuyla"])
        self.assertEqual([o["label"] for o in g["control"]["options"]], ["kapalı", "kısa süreli", "kurtarma fonuyla"])
        self.assertEqual(reg.public_seeds()[0], {"index": 0, "label": 0.078})
        self.assertEqual(pub["templates"][0]["id"], "gecis_destegi")

    def test_fixed_rules_value_text_from_defaults(self):
        reg = real_registry()
        fr = {r["settingId"]: r for r in reg.fixed_rules()}
        # ucret_stopaji ve kurumlar_vergisi R1a'dan beri düzenlenebilir: kilitli bağlam kartı yalnız düzenlenemeyen etkin kartlar
        # zararda_once_kucul R1c'de V kartı oldu (dünya senaryosu); kilitli bağlam kartı değildir
        self.assertEqual(set(fr), {"dunya_sabit_kalemleri"})
        self.assertEqual(fr["dunya_sabit_kalemleri"]["valueText"], "%10")
        self.assertEqual(fr["dunya_sabit_kalemleri"]["valueKey"], "lock.deger.dunya_sabit_kalemleri")
        # değer model varsayılanını izler
        d = dict(real_defaults(), HOUSE_MAINT=0.075)
        reg2 = loader.load_registry(REAL_DIR, d)
        self.assertEqual({r["settingId"]: r for r in reg2.fixed_rules()}["dunya_sabit_kalemleri"]["valueText"], "%7,5")

    def test_seed_values(self):
        seeds = read_json(REAL_DIR / "seeds.json")
        self.assertEqual(seeds["pm_adj"], [0.078, 0.080, 0.082, 0.084, 0.086, 0.088])
        idx = config.REPO_ROOT / "apps" / "web" / "public" / "oyun-kayit" / "index.json"
        if idx.is_file():
            labels = [s["label"] for s in read_json(idx)["seeds"]]
            self.assertEqual(labels, seeds["pm_adj"])

    def test_dayanikli_taban_template(self):
        reg = real_registry()
        self.assertEqual(reg.templates["dayanikli_taban"]["values"], {"gecis_destegi": "kapali"})


class CodecTests(unittest.TestCase):
    def test_number_roundtrip_and_format(self):
        c = {"type": "number", "scale": 100, "min": 0, "max": 50, "step": 0.5}
        self.assertEqual(codec.decode(c, 7.5), 0.075)
        self.assertEqual(codec.decode(c, 10), 0.1)
        fmt = {"yuzde": "%{n}", "acik": "açık", "kapali": "kapalı"}
        self.assertEqual(codec.format_value(c, 0.075, fmt), "%7,5")
        self.assertEqual(codec.format_value(c, 0.1, fmt), "%10")

    def test_bool(self):
        c = {"type": "bool", "on": True, "off": False}
        self.assertIs(codec.decode(c, True), True)
        self.assertIs(codec.decode(c, False), False)
        with self.assertRaises(ValueError):
            codec.decode(c, 1)

    def test_enum(self):
        c = {"type": "enum", "map": {"a": 0, "b": 1}}
        self.assertEqual(codec.decode(c, "b"), 1)
        with self.assertRaises(ValueError):
            codec.decode(c, "c")


if __name__ == "__main__":
    unittest.main()
