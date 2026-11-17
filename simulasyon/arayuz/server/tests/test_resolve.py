"""A3: resolve ve run_overrides."""
from __future__ import annotations

import unittest

from oyun_server.registry import resolve
from oyun_server.registry.schema import RunConfigError

from tests.registry_helpers import real_registry


def cfg(**kw):
    base = {"templateId": "dayanikli_taban", "durationWeeks": 200, "seedIndex": 0, "values": {}}
    base.update(kw)
    return base


class ResolveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()

    def test_resolve_empty(self):
        r = resolve.resolve(self.reg, {})
        self.assertEqual(r.params, {})
        self.assertEqual(r.errors, [])
        self.assertEqual(r.passive_ids, [])

    def test_enum_maps(self):
        self.assertEqual(resolve.resolve(self.reg, {"gecis_destegi": "kisa_sureli"}).params, {"TRANS_SUPPORT": 1})
        self.assertEqual(resolve.resolve(self.reg, {"gecis_destegi": "kapali"}).params, {"TRANS_SUPPORT": 0})
        self.assertEqual(resolve.resolve(self.reg, {"gecis_destegi": "kurtarma_fonuyla"}).params, {"TRANS_SUPPORT": 2})

    def test_resolve_rejects(self):
        cases = [
            ("gecis_destegi", ""), ("gecis_destegi", None), ("gecis_destegi", float("nan")),
            ("gecis_destegi", float("inf")), ("gecis_destegi", True), ("gecis_destegi", ["kapali"]),
            ("gecis_destegi", "1;import os"), ("gecis_destegi", "yok_secenek"), ("gecis_destegi", 1),
            ("dunya_tohumu", 6), ("dunya_tohumu", -1), ("dunya_tohumu", True), ("dunya_tohumu", 1.5),
            ("dunya_tohumu", float("nan")), ("dunya_tohumu", "1"),
            ("yok_boyle_kimlik", 1), ("dunya_sabit_kalemleri", 10), ("zararda_once_kucul", True),
        ]
        for id_, v in cases:
            with self.subTest(id=id_, value=v):
                r = resolve.resolve(self.reg, {id_: v})
                self.assertEqual(r.params, {})
                self.assertEqual(r.errors[0].id, id_)

    def test_reasons(self):
        self.assertEqual(resolve.resolve(self.reg, {"yok": 1}).errors[0].reason, "unknown")
        self.assertEqual(resolve.resolve(self.reg, {"dunya_sabit_kalemleri": 10}).errors[0].reason, "locked")
        self.assertEqual(resolve.resolve(self.reg, {"gecis_destegi": "zz"}).errors[0].reason, "invalid")

    def test_errors_are_atomic(self):
        r = resolve.resolve(self.reg, {"gecis_destegi": "kapali", "yok": 1})
        self.assertEqual(r.params, {})
        self.assertEqual([e.id for e in r.errors], ["yok"])

    def test_non_dict_values(self):
        self.assertEqual(resolve.resolve(self.reg, [1]).errors[0].reason, "invalid")

    def test_passive_card(self):
        import dataclasses
        s = self.reg.by_id["gecis_destegi"]
        reg = self.reg
        orig = reg.by_id["gecis_destegi"]
        reg.by_id["gecis_destegi"] = dataclasses.replace(s, status="passive")
        try:
            r = resolve.resolve(reg, {"gecis_destegi": "kapali"})
        finally:
            reg.by_id["gecis_destegi"] = orig
        self.assertEqual(r.errors[0].reason, "passive")
        self.assertEqual(r.passive_ids, ["gecis_destegi"])


class RunOverridesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()

    def test_template_then_user_then_seed(self):
        o = resolve.run_overrides(self.reg, cfg())
        self.assertEqual(o, {"TRANS_SUPPORT": 0, "PM_ADJ": 0.078})
        o = resolve.run_overrides(self.reg, cfg(values={"gecis_destegi": "kurtarma_fonuyla"}, seedIndex=5))
        self.assertEqual(o, {"TRANS_SUPPORT": 2, "PM_ADJ": 0.088})

    def test_typed_values(self):
        o = resolve.run_overrides(self.reg, cfg(values={"gecis_destegi": "kisa_sureli"}, seedIndex=2))
        self.assertIs(type(o["TRANS_SUPPORT"]), int)
        self.assertIs(type(o["PM_ADJ"]), float)

    def test_no_template_no_seed(self):
        self.assertEqual(resolve.run_overrides(self.reg, {"durationWeeks": 200}), {})

    def test_duration_must_be_100_200_or_500(self):
        for ok in (100, 200, 500):
            self.assertEqual(resolve.run_overrides(self.reg, cfg(durationWeeks=ok)), resolve.run_overrides(self.reg, cfg()))
        for bad in (99, 199, 201, 300, 501, "200", 200.0, True, None, 0, -200):
            with self.subTest(d=bad):
                with self.assertRaises(RunConfigError) as cm:
                    resolve.run_overrides(self.reg, cfg(durationWeeks=bad))
                self.assertEqual(cm.exception.errors[0].id, "durationWeeks")
                self.assertEqual(cm.exception.errors[0].reason, "invalid")
        with self.assertRaises(RunConfigError):
            resolve.run_overrides(self.reg, {"templateId": "dayanikli_taban"})

    def test_bad_config_parts(self):
        for c, id_ in ((cfg(seedIndex=9), "seedIndex"), (cfg(seedIndex=True), "seedIndex"),
                       (cfg(templateId="yok"), "templateId"), (cfg(values={"gecis_destegi": "zz"}), "gecis_destegi"),
                       (cfg(values={"dunya_sabit_kalemleri": 10}), "dunya_sabit_kalemleri"), (cfg(values=[1]), "values")):
            with self.subTest(id=id_):
                with self.assertRaises(RunConfigError) as cm:
                    resolve.run_overrides(self.reg, c)
                self.assertEqual(cm.exception.errors[0].id, id_)
        with self.assertRaises(RunConfigError):
            resolve.run_overrides(self.reg, "x")

    def test_seed_conflict(self):
        with self.assertRaises(RunConfigError) as cm:
            resolve.run_overrides(self.reg, cfg(seedIndex=1, values={"dunya_tohumu": 2}))
        self.assertEqual(cm.exception.errors[0].id, "dunya_tohumu")
        self.assertEqual(resolve.run_overrides(self.reg, cfg(seedIndex=1, values={"dunya_tohumu": 1}))["PM_ADJ"], 0.080)


if __name__ == "__main__":
    unittest.main()
