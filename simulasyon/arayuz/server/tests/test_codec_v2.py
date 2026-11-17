"""K1: şema v2 codec'leri (fields, order, multi, number birimleri), kodlama ve biçimlendirme."""
from __future__ import annotations

import unittest
from pathlib import Path

from oyun_server.registry import codec
from oyun_server.registry.resolve import resolve

from tests.registry_helpers import contract_registry, example_defaults, read_json, real_registry

FIXTURES = Path(__file__).resolve().parent / "fixtures"
NUM = {"type": "number", "scale": 1, "min": 26, "max": 260, "step": 26, "integer": True, "unit": "hafta"}
FIELDS = {"type": "fields", "fields": [
    {"key": "acik", "param": "A", "codec": {"type": "bool", "on": True, "off": False}},
    {"key": "vade", "param": "B", "codec": NUM},
    {"key": "tavan", "param": "C", "codec": NUM}]}
ORDER = {"type": "order", "param": "O", "items": ["a", "b", "c"]}
MULTI = {"type": "multi", "param": "M", "items": ["a", "b", "c"]}


class FieldsTests(unittest.TestCase):
    def test_fields_decode_writes_all_params(self):
        self.assertEqual(codec.decode(FIELDS, {"acik": True, "vade": 52, "tavan": 104}), {"A": True, "B": 52, "C": 104})
        reg = contract_registry()
        r = resolve(reg, {"ornek_tahvil": {"acik": False, "vade": 26, "tavan": 260}})
        self.assertEqual(r.errors, [])
        self.assertEqual(r.params, {"ORN_TAHVIL": False, "ORN_VADE": 26, "ORN_TAVAN": 260})

    def test_fields_missing_or_extra_key_invalid(self):
        for bad in ({"acik": True, "vade": 52}, {"acik": True, "vade": 52, "tavan": 104, "x": 1}, {}, [1], "x", None,
                    {"acik": True, "vade": 53, "tavan": 104}, {"acik": 1, "vade": 52, "tavan": 104}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                codec.decode(FIELDS, bad)
        r = resolve(contract_registry(), {"ornek_tahvil": {"acik": True, "vade": 52}})
        self.assertEqual([(e.id, e.reason) for e in r.errors], [("ornek_tahvil", "invalid")])
        self.assertEqual(r.params, {})


class OrderMultiTests(unittest.TestCase):
    def test_order_permutation_and_prefix_ok_duplicates_invalid(self):
        self.assertEqual(codec.decode(ORDER, ["c", "a", "b"]), ("c", "a", "b"))
        self.assertEqual(codec.decode(ORDER, ["b", "a"]), ("b", "a"))          # önek
        self.assertEqual(codec.decode(ORDER, ["b"]), ("b",))
        for bad in (["a", "a"], ["a", "b", "c", "a"], ["a", "x"], [], "abc", [1], None, [["a"]]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                codec.decode(ORDER, bad)
        r = resolve(contract_registry(), {"ornek_sira": ["genc", "kurulus"]})
        self.assertEqual(r.params, {"ORN_SIRA": ("genc", "kurulus")})

    def test_multi_subset_preserves_item_order(self):
        self.assertEqual(codec.decode(MULTI, ["c", "a"]), ("a", "c"))
        self.assertEqual(codec.decode(MULTI, []), ())
        self.assertEqual(codec.decode(MULTI, ["b", "c", "a"]), ("a", "b", "c"))
        for bad in (["a", "a"], ["x"], "a", [1], None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                codec.decode(MULTI, bad)
        r = resolve(contract_registry(), {"ornek_sektorler": ["hizmet", "tarim"]})
        self.assertEqual(r.params, {"ORN_SEKTOR": ("tarim", "hizmet")})


class NumberTests(unittest.TestCase):
    def test_number_integer_and_step(self):
        self.assertEqual(codec.decode(NUM, 52), 52)
        self.assertIsInstance(codec.decode(NUM, 52), int)
        self.assertEqual(codec.decode(NUM, 52.0), 52)
        for bad in (53, 52.5, 0, 286, True, "52", float("nan"), None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                codec.decode(NUM, bad)
        c = {"type": "number", "scale": 100, "min": 0.1, "max": 1, "step": 0.1, "unit": "yuzde_hafta"}
        self.assertEqual(codec.decode(c, 0.3), 0.003)
        with self.assertRaises(ValueError):
            codec.decode(c, 0.35)

    def test_default_on_step_grid(self):
        n = 0
        for reg in (real_registry(), contract_registry()):
            for s in reg.settings:
                subs = ([(f["key"], f["codec"]) for f in s.codec["fields"]] if s.codec["type"] == "fields"
                        else [(s.id, s.codec)])
                ui = reg.default_ui(s)
                for key, c in subs:
                    if c["type"] != "number":
                        continue
                    v = ui[key] if s.codec["type"] == "fields" else ui
                    q = (v - c["min"]) / c["step"] if c.get("step") else 0
                    self.assertAlmostEqual(q, round(q), places=6, msg=f"{s.id}.{key}")
                    self.assertTrue(c["min"] <= v <= c["max"], f"{s.id}.{key}")
                    n += 1
        self.assertGreater(n, 5)

    def test_encode_roundtrip_defaults(self):
        for reg in (real_registry(), contract_registry()):
            for s in reg.settings:
                ui = reg.default_ui(s)
                model = codec.decode(s.codec, ui, reg.seeds)
                if s.params:
                    expect = reg.model_value(s)
                    if s.codec["type"] in ("order", "multi"):
                        expect = tuple(expect)
                    self.assertEqual(model, expect, s.id)
                self.assertEqual(codec.encode(s.codec, model, reg.seeds), ui, s.id)

    def test_encode_basic(self):
        self.assertEqual(codec.encode({"type": "enum", "map": {"a": 0, "b": 1}}, 1), "b")
        self.assertIs(codec.encode({"type": "bool", "on": True, "off": False}, True), True)
        self.assertEqual(codec.encode({"type": "number", "scale": 100, "min": 0, "max": 50, "step": 0.5}, 0.075), 7.5)
        self.assertEqual(codec.encode({"type": "number", "scale": 100, "min": 0, "max": 50, "step": 0.5}, 0.07), 7)
        self.assertEqual(codec.encode({"type": "seed"}, 0.08, [0.078, 0.08]), 1)
        with self.assertRaises(ValueError):
            codec.encode({"type": "enum", "map": {"a": 0}}, 5)
        with self.assertRaises(ValueError):
            codec.encode({"type": "enum", "map": {"a": 0, "b": 1}}, True)       # bool, tamsayı değil


class FormatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.words = real_registry().value_words
        cls.cases = read_json(FIXTURES / "registry_format_cases.json")

    def test_format_cases_fixture_matches(self):
        cases = self.cases["cases"]
        self.assertGreaterEqual(len(cases), 40)
        self.assertEqual(self.cases["words"], self.words)
        kinds, units = set(), set()
        for i, k in enumerate(cases):
            with self.subTest(i=i, codec=k["codec"]["type"], model=k["model_value"]):
                seeds = k.get("seeds")
                self.assertEqual(codec.encode(k["codec"], k["model_value"], seeds), k["ui_value"])
                if k["codec"]["type"] == "number":
                    self.assertEqual(k["control"], codec.number_control(k["codec"]))
                if k["codec"]["type"] in ("fields", "order", "multi", "enum", "seed"):
                    self.assertTrue(k.get("labels"), "etiketsiz geri düşüş sözleşmeye girmez")
                dec = codec.decode(k["codec"], k["ui_value"], seeds)
                self.assertEqual(dec, tuple(k["model_value"]) if k["codec"]["type"] in ("order", "multi") else k["model_value"])
                self.assertEqual(codec.format_value(k["codec"], k["model_value"], self.words, k.get("labels"), seeds), k["text"])
            kinds.add(k["codec"]["type"])
            units.add(codec.effective_unit(k["codec"]) if k["codec"]["type"] == "number" else None)
        self.assertEqual(kinds, {"enum", "bool", "number", "seed", "fields", "order", "multi"})
        self.assertTrue({"yuzde", "yuzde_hafta", "akce", "hafta", "kat", "oran", "sayi"} <= units)

    def test_shows_cases_fixture_matches(self):
        cases = self.cases["shows_cases"]
        self.assertGreaterEqual(len(cases), 10)
        units = set()
        for i, k in enumerate(cases):
            with self.subTest(i=i, entry=k["entry"], model=k["model_value"]):
                value, text = codec.show_value(k["entry"], k["model_value"], self.words)
                self.assertEqual(value, k["value"])
                self.assertIs(type(value), type(k["value"]))
                self.assertEqual(text, k["text"])
            units.add(k["entry"].get("unit"))
        self.assertTrue({None, "yuzde", "yuzde_hafta", "akce", "hafta", "kat", "oran", "sayi"} <= units)
        for bad in ("x", [1], None, float("nan"), float("inf")):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                codec.show_value({"key": "A"}, bad, self.words)
        self.assertEqual(codec.show_value({"key": "A", "unit": "hafta"}, True, self.words), (True, "açık"))

    def test_format_thousands_and_comma(self):
        w = self.words
        f = codec.format_value

        def num(scale, unit, **kw):
            return {"type": "number", "scale": scale, "min": -1e9, "max": 1e9, "unit": unit, **kw}

        self.assertEqual(f(num(100, "yuzde"), 0.125, w), "%12,5")
        self.assertEqual(f(num(100, "yuzde_hafta"), 0.003, w), "%0,3/hafta (≈ %15,6/yıl)")
        self.assertEqual(f(num(1, "akce"), 2000, w), "2.000 Akçe")
        self.assertEqual(f(num(1, "akce"), 1234567, w), "1.234.567 Akçe")
        self.assertEqual(f(num(1, "akce"), 999, w), "999 Akçe")
        self.assertEqual(f(num(1, "akce"), 1234.5, w), "1.234,5 Akçe")
        self.assertEqual(f(num(1, "hafta"), 104, w), "104 hafta")
        self.assertEqual(f(num(1, "kat"), 25, w), "25 kat")
        self.assertEqual(f(num(1, "oran"), 0.7, w), "0,7")
        self.assertEqual(f(num(100, None), 0.075, w), "%7,5")                   # birimsiz yüzde ölçeği: eski davranış
        self.assertEqual(f({"type": "bool", "on": True, "off": False}, True, w), "açık")
        self.assertEqual(f({"type": "bool", "on": True, "off": False}, False, w), "kapalı")
        self.assertEqual(f(MULTI, (), w), w["yok"])
        self.assertEqual(f(ORDER, ("b", "a"), w, {"a": "Alfa", "b": "Beta"}), "Beta, Alfa")


if __name__ == "__main__":
    unittest.main()
