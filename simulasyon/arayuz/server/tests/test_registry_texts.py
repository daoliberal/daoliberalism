"""A3: metinler.tr.json tamlığı ve Türkçe denetim kuralları."""
from __future__ import annotations

import re
import unittest

from oyun_server.registry import loader

from tests.registry_helpers import REAL_DIR, read_json, real_registry


def walk(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}[{i}]")
    else:
        yield path, node


class TextRulesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = read_json(REAL_DIR / "metin_kurallari.json")["forbidden"]
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_rules_catch_bad_samples(self):
        pats = [re.compile(r["pattern"]) for r in self.rules]
        for bad in ("K-211 kararı", "", "  ", "5'te", "%20'de", "6’nın", "3'ü", "7'si", "5'ün", "28bin", "5hf", "12'nde",
                    "{n}'den", "{hafta}'te", "{n}’den", "{n} 'den", "{sayi}'nın"):
            with self.subTest(bad=bad):
                self.assertTrue(any(p.search(bad) for p in pats), bad)
        for good in ("5. haftadan", "%10", "28 bin", "yaklaşık 2 bin", "Hafta 5", "Caiani ve ark. 2016; BAM Engine",
                     "{n}. haftadan", "{hafta}. haftada", "{n} hafta", "%{n}/hafta (≈ %{yillik}/yıl)"):
            with self.subTest(good=good):
                self.assertFalse(any(p.search(good) for p in pats), good)

    def test_texts_rules(self):
        for r in self.rules:
            self.assertTrue(r.get("id") and r.get("message"))
        pats = [(r["id"], re.compile(r["pattern"])) for r in self.rules]
        for path, val in walk(self.texts):
            self.assertIsInstance(val, str, path)
            for rid, p in pats:
                self.assertIsNone(p.search(val), f"{path}: {rid}: {val!r}")

    def test_texts_complete_no_orphans(self):
        reg = real_registry()
        ids = {s.id for s in reg.settings + reg.hidden}
        card_texts = {k for k in self.texts if not k.startswith("_")}
        self.assertEqual(sorted(ids - card_texts), [], "metni olmayan kart")
        self.assertEqual(sorted(card_texts - ids), [], "kartı olmayan metin")
        for i in ids:
            t = self.texts[i]
            for f in ("title", "what", "changes"):
                self.assertTrue(isinstance(t.get(f), str) and t[f].strip(), f"{i}.{f}")
            if "basis" in t:
                self.assertTrue(t["basis"].get("label", "").strip(), f"{i}.basis.label")
        for g in reg.groups:
            self.assertTrue(self.texts["_gruplar"][g["id"]]["title"].strip())
        self.assertEqual(sorted(set(self.texts["_gruplar"]) - {g["id"] for g in reg.groups}), [])
        for tid, t in reg.templates.items():
            self.assertTrue(self.texts["_sablonlar"][tid]["title"].strip())
        self.assertEqual(sorted(set(self.texts["_sablonlar"]) - set(reg.templates)), [])

    def test_enum_options_have_labels(self):
        reg = real_registry()
        for s in reg.settings:
            if s.codec["type"] == "enum":
                for k in s.codec["map"]:
                    self.assertTrue(self.texts[s.id]["options"][k].strip(), f"{s.id}.{k}")

    def test_value_words_present(self):
        for k in ("yuzde", "acik", "kapali", "yok"):
            self.assertTrue(self.texts["_degerler"][k])
        for k in ("yuzde", "yuzde_hafta", "akce", "hafta", "kat", "oran", "sayi"):
            self.assertIn("{n}", self.texts["_birimler"][k])


if __name__ == "__main__":
    unittest.main()
