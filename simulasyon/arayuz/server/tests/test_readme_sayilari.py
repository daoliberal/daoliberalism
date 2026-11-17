"""README "Sayılar" satırı yayımlanan kayıttan ve sınıf kanıtından üretilir (son inceleme M5): sayılar bayatlayınca bu test kırılır."""
from __future__ import annotations

import collections
import json
import re
import unittest
from pathlib import Path

ARAYUZ = Path(__file__).resolve().parents[2]
REGISTRY = ARAYUZ.parents[1] / "apps" / "web" / "public" / "oyun-kayit" / "registry.json"


class ReadmeSayilari(unittest.TestCase):
    def test_numbers_line_matches_published_registry_and_evidence(self):
        text = (ARAYUZ / "README.md").read_text(encoding="utf-8")
        line = next(l for l in text.splitlines() if l.startswith("- Sayılar ("))
        nums = [int(x) for x in re.findall(r"\d+", re.sub(r"\(2026-10-30\)", "", line))]
        keys = json.loads((ARAYUZ / "registry" / "apply_classes.json").read_text(encoding="utf-8"))["keys"]
        by_key = collections.Counter(v["class"] for v in keys.values())
        cards = json.loads(REGISTRY.read_text(encoding="utf-8"))["cards"]
        by_card = collections.Counter(c["apply"] for c in cards if c["editable"] and c["status"] == "active")
        unknown = sum(1 for c in cards if c["apply"] == "unknown")
        want = [by_key["live"], by_key["start_only"], by_card["live"], by_card["start_only"], sum(by_card.values()), len(cards), unknown]
        self.assertEqual(nums[:7], want, line)


if __name__ == "__main__":
    unittest.main()
