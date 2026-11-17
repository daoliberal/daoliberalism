"""A4: livepatch.apply_overrides birim testleri (sahte modüller; model içe aktarılmaz)."""
from __future__ import annotations

import types
import unittest

from oyun_server.sim import livepatch


def mods():
    p = types.ModuleType("simkit.params")
    p.SALES_TAX, p.CORP_TAX = 0.07, 0.2
    a = types.ModuleType("simkit.a")
    a.CORP_TAX = 0.2
    b = types.ModuleType("simkit.b")
    b.OTHER = 1
    return {"simkit.params": p, "simkit.a": a, "simkit.b": b}


class W:
    pass


class LivePatchUnit(unittest.TestCase):
    def test_writes_every_module_holding_name(self):
        m = mods()
        n = livepatch.apply_overrides(m, W(), {"CORP_TAX": 0.4})
        self.assertEqual(n, 2)
        self.assertEqual(m["simkit.params"].CORP_TAX, 0.4)
        self.assertEqual(m["simkit.a"].CORP_TAX, 0.4)
        self.assertFalse(hasattr(m["simkit.b"], "CORP_TAX"))

    def test_unknown_key_keyerror_and_nothing_written(self):
        m = mods()
        with self.assertRaises(KeyError):
            livepatch.apply_overrides(m, W(), {"CORP_TAX": 0.4, "YOK_BOYLE": 1})
        self.assertEqual(m["simkit.a"].CORP_TAX, 0.2)

    def test_w_sync_called(self):
        m = mods()
        w = W()
        calls = []
        livepatch.W_SYNC["SALES_TAX"] = lambda W_, v: calls.append(v)
        try:
            livepatch.apply_overrides(m, w, {"SALES_TAX": 0.1})
        finally:
            del livepatch.W_SYNC["SALES_TAX"]
        self.assertEqual(calls, [0.1])

    def test_empty_overrides(self):
        self.assertEqual(livepatch.apply_overrides(mods(), W(), {}), 0)


if __name__ == "__main__":
    unittest.main()
