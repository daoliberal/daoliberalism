"""W10 düzeltme 1: koşu durumu `versions` (sürüm takvimi) ve `worldScenarioValues` (özel dünya değerleri) yayımlar."""
from __future__ import annotations

import unittest

from tests.test_changes_v2 import V2Base
from tests.test_manager import CONFIG


class TestStateVersions(V2Base):
    def test_state_has_versions_with_seam_weeks_and_full_values(self):
        m, rid, _sub = self.started()
        st0 = m.get(rid)["state"]
        self.assertEqual(st0["versions"], [{"version": 1, "fromWeek": 0, "values": st0["values"]}])
        r = self.change(rid, {"gecis_destegi": "kisa_sureli"})
        self.assertTrue(r["accepted"], r)
        v = m.get(rid)["state"]["versions"]
        self.assertEqual([(x["version"], x["fromWeek"]) for x in v], [(1, 0), (2, r["seamWeek"])])
        self.assertEqual(v[0]["values"]["gecis_destegi"], "kapali")
        self.assertEqual(v[1]["values"]["gecis_destegi"], "kisa_sureli")      # TAM değer kümesi (yama değil)
        self.assertEqual(set(v[0]["values"]), set(v[1]["values"]))

    def test_preloaded_schedule_and_week0_patch(self):
        m = self.make2()
        h = m.create(CONFIG, schedule=[{"week": 0, "patch": {"ornek_acik": True}}, {"week": 30, "patch": {"gecis_destegi": "kisa_sureli"}}])
        v = h["state"]["versions"]
        self.assertEqual([(x["version"], x["fromWeek"]) for x in v], [(1, 0), (2, 30)])
        self.assertEqual(v[0]["values"]["ornek_acik"], True)                    # hafta 0 yaması kuruluşa katıldı
        self.assertEqual(v[1]["values"]["gecis_destegi"], "kisa_sureli")

    def test_world_scenario_values_echoed_in_state(self):
        m = self.make2()
        st = m.create(dict(CONFIG, worldScenarioId="bol_kitlik", worldScenarioValues={"ornek_akce": 3000}))["state"]
        self.assertEqual(st["worldScenarioValues"], {"ornek_akce": 3000})
        self.assertNotIn("worldScenarioValues", m.create(CONFIG)["state"])

    def test_branch_keeps_world_values_and_schedule_prefix(self):
        m = self.make2()
        h = m.create(dict(CONFIG, worldScenarioValues={"ornek_akce": 3000}), schedule=[{"week": 30, "patch": {"gecis_destegi": "kisa_sureli"}}])
        b = m.branch(h["runId"], 10)
        self.assertEqual(b["state"]["worldScenarioValues"], {"ornek_akce": 3000})
        self.assertEqual([x["fromWeek"] for x in b["state"]["versions"]], [0])


if __name__ == "__main__":
    unittest.main()
