"""T0: birleşik model dalının yeni adları (kapalı varsayılanlar, kayıt ve kapsam taban çizgisi)."""
from __future__ import annotations

import unittest

from oyun_server import config
from oyun_server.registry import defaults

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry

NEW_FLAG_DEFAULTS = {
    "CREDIT_MONEY": 0,
    "TREASURY_RULE": 0,
    "PROFIT_KEEP": 0,
    "RATE_BEHAV": 0,
    "ENTRY_EXP": 0,
    "KK_MEAS": 0,
    "TR_WEEKS": 4.0,
    "PK_WEEKS": 8.0,
}


class BirlesikModelTests(unittest.TestCase):
    def test_new_flags_present_and_off(self):
        d = defaults.read_param_defaults(str(config.MODEL_ROOT))
        for name, want in NEW_FLAG_DEFAULTS.items():
            self.assertIn(name, d, name)
            self.assertEqual(d[name], want, name)

    def test_string_params_never_registered(self):
        d = real_defaults()
        strings = {k for k, v in d.items() if isinstance(v, str)}
        reg = real_registry()
        registered = {p for s in reg.settings + reg.hidden for p in s.params}
        self.assertEqual(sorted(strings & registered), [])

    def test_coverage_baseline_lists_new_names(self):
        d = real_defaults()
        names = defaults.overridable_names(str(config.MODEL_ROOT), d)
        reg = real_registry()
        registered = {p for s in reg.settings + reg.hidden for p in s.params}
        baseline = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        for name in NEW_FLAG_DEFAULTS:
            self.assertIn(name, names, name)
            self.assertTrue(name in registered or name in baseline, name)


if __name__ == "__main__":
    unittest.main()
