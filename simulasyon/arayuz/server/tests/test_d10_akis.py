"""D10: iş piyasası akışı göstergeleri (F): ayrılma, işe alım, iş bulma oranı, işsizlik süresi, işgücü dışı NPC, belediyedeki NPC. Plan işgücü etiketi (D9 M5b).

Gerçek model testleri OYUN_QUICK ile atlanır; sahte dünya testleri her zaman koşar."""
from __future__ import annotations

import json
import re
import types
import unittest
from collections import defaultdict
from pathlib import Path

from oyun_server import config
from oyun_server.sim import extract, plan, probes
from oyun_server.sim.extract import extract_world, make_packet

from tests.extract_v2_helpers import QUICK, Run, deep, fake_world, params_ns, snapshot_equal
from tests.registry_helpers import real_defaults

HERE = Path(__file__).resolve().parent
TYPES_TS = HERE.parents[3] / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts"

STOCK = ["npc_discouraged", "muni_npc"]
FLOWS = ["hires", "separations", "quits_npc"]
DERIVED = ["job_finding_rate", "unemployment_duration"]
NEW_WORLD = STOCK + FLOWS + DERIVED


def market_world():
    """Şehir 0: NPC firması (2 NPC + 1 oyuncu), belediye (1 oyuncu + 2 NPC), havuzda 3 NPC, işgücü dışında 4 NPC (B7), bakmakla yükümlü 2 NPC (D9)."""
    W = fake_world(2)
    ppl = W.people
    for k, firm in (("n0", "s0_un0"), ("n1", "s0_un0"), ("m0", "s0_belediye0"), ("m1", "s0_belediye0")):
        ppl[k] = dict(tier=0, wage=10, firm=firm, who="npc", city=0)
    ppl["s0_p2"] = dict(tier=0, wage=10, firm="s0_un0", who="oyuncu", city=0)
    ppl["s0_p3"] = dict(tier=0, wage=10, firm="s0_belediye0", who="oyuncu", city=0)
    W.firms["s0_un0"] = dict(kind="un", city=0, workers=["n0", "n1", "s0_p2"], owner=None, dead=False, capacity=25)
    W.firms["s0_belediye0"] = dict(kind="belediye", city=0, workers=["m0", "m1", "s0_p3"], owner=None, dead=False, capacity=100)
    W.cities[0]["firms"] = ["s0_un0", "s0_belediye0"]
    W.cities[0]["pool"] = ["p0", "p1", "p2"]
    W.cities[0]["out"] = ["o0", "o1", "o2", "o3"]
    W.cities[0]["deps"] = ["d0", "d1"]
    for k in ("p0", "p1", "p2", "o0", "o1", "o2", "o3", "d0", "d1"):
        ppl[k] = dict(tier=0, wage=10, firm=None, who="npc", city=0)
    W.L.bal.update({"p0": 5.0, "p1": 0.1, "p2": 0.2, "o0": 3.0, "o1": 0.0, "o2": 2.0, "o3": 0.5, "d0": 4.0, "d1": 0.0})
    W.hire_stat = defaultdict(float, ise_alinan_oyuncu=7, ise_alinan_npc=9, isten_cikan_oyuncu=2, isten_cikan_npc=5, ayrilan_npc=4,
                              ise_giren_issiz=11, issiz_haftabasi=200)
    return W, params_ns()


class MarketProbes(unittest.TestCase):
    def test_stock_facts(self):
        W, P = market_world()
        f = probes.market_facts(W, P)
        self.assertEqual(f["x_npc_discouraged"], 4)
        self.assertEqual(f["x_muni_npc"], 2)
        json.dumps(f, allow_nan=False)

    def test_no_out_list_means_zero(self):
        W, P = fake_world(), params_ns()
        f = probes.market_facts(W, P)
        self.assertEqual((f["x_npc_discouraged"], f["x_muni_npc"]), (0, 0))

    def test_flow_totals_are_cumulative_counters(self):
        W, P = market_world()
        t = probes.market_flow_totals(W, P)
        self.assertEqual(t, {"hires": 16.0, "separations": 11.0, "quits_npc": 4.0, "job_finders": 11.0, "unemployed_start": 200.0})
        self.assertTrue(all(v is None for v in probes.market_flow_totals(fake_world(), params_ns()).values()))      # sayaç yok (eski model): ölçülmedi

    def test_lfp_and_broke_count_people_outside_the_labor_force(self):
        W, P = market_world()
        f = probes.labor_facts(W, P)
        # işgücü: havuz 3 + çalışan NPC (n0, n1, m0, m1 = 4); dışarıda: out 4 + deps 2
        self.assertAlmostEqual(f["x_npc_lfp"], 7 / 13)
        floor = P.NPC_MIN_BAL if hasattr(P, "NPC_MIN_BAL") else 1.0
        broke = sum(1 for q in ("p0", "p1", "p2") if W.L.bal[q] < floor) + sum(1 for q in ("d0", "d1") if W.L.bal[q] < floor)
        broke += sum(1 for q in ("o0", "o1", "o2", "o3") if W.L.bal[q] < floor)
        self.assertEqual(f["x_npc_broke"], broke)

    def test_does_not_mutate(self):
        W, P = market_world()
        before = deep(W)
        probes.market_facts(W, P)
        probes.market_flow_totals(W, P)
        probes.labor_facts(W, P)
        snapshot_equal(self, W, before, "iş piyasası ölçümleri")


class HostRate(unittest.TestCase):
    """ModelHost._labor_flows: iş bulma oranı = o hafta işsizlikten işe girenler / hafta başı işsiz sayısı."""

    def _host(self, W, P):
        from oyun_server.sim.host import ModelHost
        h = object.__new__(ModelHost)
        h._W, h._P, h._labor_prev = W, P, {}
        return h

    def test_weekly_rate_from_cumulative_differences(self):
        W, P = market_world()
        h = self._host(W, P)
        out1 = h._labor_flows()
        self.assertAlmostEqual(out1["x_job_finding_rate"], 11 / 200)
        self.assertEqual((out1["x_hires"], out1["x_separations"], out1["x_quits_npc"]), (16, 11, 4))
        W.hire_stat["ise_giren_issiz"] += 30
        W.hire_stat["issiz_haftabasi"] += 150
        W.hire_stat["ise_alinan_npc"] += 25
        out2 = h._labor_flows()
        self.assertAlmostEqual(out2["x_job_finding_rate"], 30 / 150)
        self.assertEqual(out2["x_hires"], 25)

    def test_no_unemployed_means_null_rate(self):
        W, P = market_world()
        h = self._host(W, P)
        h._labor_flows()
        out = h._labor_flows()                                   # hiçbir şey değişmedi: payda 0
        self.assertIsNone(out["x_job_finding_rate"])

    def test_old_model_without_counters(self):
        W, P = fake_world(), params_ns()
        out = self._host(W, P)._labor_flows()
        self.assertIsNone(out["x_job_finding_rate"])
        self.assertIsNone(out["x_hires"])


class ExtractMapping(unittest.TestCase):
    def test_new_fields_mapped_from_facts(self):
        facts = {"x_npc_discouraged": 40, "x_muni_npc": 12, "x_hires": 33, "x_separations": 29, "x_quits_npc": 8, "x_job_finding_rate": 0.05}
        w = extract_world({"calisan": "170", "issiz": "8", **facts})
        for k in NEW_WORLD:
            self.assertIn(k, w, k)
        self.assertEqual((w["npc_discouraged"], w["muni_npc"], w["hires"], w["separations"], w["quits_npc"]), (40, 12, 33, 29, 8))
        self.assertAlmostEqual(w["job_finding_rate"], 0.05)
        self.assertAlmostEqual(w["unemployment_duration"], 20.0)           # ortalama süre = 1 / iş bulma oranı (hafta)
        json.dumps(w, allow_nan=False)

    def test_duration_is_null_without_a_positive_rate(self):
        for r in (None, 0, 0.0):
            w = extract_world({"calisan": "170", "issiz": "8", "x_job_finding_rate": r})
            self.assertIsNone(w["unemployment_duration"], r)

    def test_old_rows_have_null_new_fields(self):
        w = extract_world({"calisan": "170", "issiz": "8"})
        for k in NEW_WORLD:
            self.assertIsNone(w[k], k)
        self.assertEqual(set(make_packet("r", 1, 1, {})["world"]) & set(NEW_WORLD), set(NEW_WORLD))

    def test_types_ts_has_new_fields(self):
        body = re.search(r"export type World = \{(.*?)\n\};", TYPES_TS.read_text("utf-8"), re.S).group(1)
        fields = set(re.findall(r"^\s*([a-z_0-9]+)\??:", body, re.M))
        self.assertTrue(set(NEW_WORLD) <= fields)

    def test_field_notes_define_every_new_field(self):
        for k in NEW_WORLD:
            self.assertIn(k, probes.FIELD_NOTES, k)
            self.assertGreater(len(probes.FIELD_NOTES[k]), 20, k)

    def test_job_finding_note_defines_the_quantity_honestly(self):
        self.assertIn("işe alım turu başındaki", probes.FIELD_NOTES["job_finding_rate"])
        self.assertIn("tahmin", probes.FIELD_NOTES["unemployment_duration"])           # Little yasası tahmini: ölçülen süre değil


class PlanLaborMode(unittest.TestCase):
    """D9 M5b: işgücü etiketi seçilen kipten gelir, bağımlı sayısından değil."""

    @classmethod
    def setUpClass(cls):
        cls.d = real_defaults()
        cls.root = str(config.MODEL_ROOT)

    def test_household_mode_with_full_participation_is_still_household(self):
        p = plan.world_plan(self.root, {"NPC_HOUSE": 1, "NPC_LFPR": 1.0}, self.d)
        lf = p["laborForce"]
        self.assertEqual(lf["mode"], "hane")
        self.assertEqual(lf["dependents"], 0)
        self.assertAlmostEqual(lf["participation"], 1.0)

    def test_single_person_mode_ignores_participation_value(self):
        p = plan.world_plan(self.root, {"NPC_HOUSE": 0, "NPC_LFPR": 0.4}, self.d)
        self.assertEqual(p["laborForce"]["mode"], "tek_kisi")


class MeasurementMark(unittest.TestCase):
    def test_d10_cards_mark_a_run_as_new_measurement(self):
        self.assertIn("D10", plan.DECISIONS)


@unittest.skipIf(QUICK, "gerçek model")
class RealModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = Run(6)
        cls.flow = Run(6, {"SEP_RATE": 0.05, "FIND_RATE": 0.2, "DISCOURAGE_WEEKS": 1, "DISC_RATE": 0.5, "MUNI_POOL": 1, "MUNI_SPEND": 0.5, "JG_MAX": 0.02})

    @classmethod
    def tearDownClass(cls):
        cls.base.close()
        cls.flow.close()

    def test_default_run_has_all_new_fields_finite(self):
        for row, facts in zip(self.base.rows, self.base.facts):
            w = extract_world({**row, **facts})
            for k in NEW_WORLD:
                self.assertIn(k, w, k)
            json.dumps(w, allow_nan=False)
        last = extract_world({**self.base.rows[-1], **self.base.facts[-1]})
        self.assertEqual((last["npc_discouraged"], last["muni_npc"], last["quits_npc"]), (0, 0, 0))
        self.assertGreater(last["job_finding_rate"], 0)
        self.assertLessEqual(last["job_finding_rate"], 1.0)
        self.assertGreater(last["unemployment_duration"], 1.0)

    def test_default_separations_are_fires_only(self):
        for f in self.base.facts[1:]:
            self.assertEqual(f["x_separations"], f["x_fired_player"] + f["x_fired_npc"])
            self.assertEqual(f["x_hires"], f["x_hired_player"] + f["x_hired_npc"])

    def test_weekly_flows_equal_cumulative_differences(self):
        st = self.flow.W.hire_stat
        for name, total in (("quits_npc", st["ayrilan_npc"]), ("hires", st["ise_alinan_npc"] + st["ise_alinan_oyuncu"])):
            weekly = [f["x_" + name] for f in self.flow.facts]
            self.assertTrue(all(v is not None and v >= 0 for v in weekly), name)
            self.assertAlmostEqual(sum(weekly), total, places=6, msg=name)

    def test_flagged_run_shows_the_new_stocks(self):
        last = self.flow.facts[-1]
        self.assertGreater(sum(f["x_quits_npc"] for f in self.flow.facts), 0)
        self.assertGreater(last["x_npc_discouraged"], 0)
        self.assertGreater(last["x_muni_npc"], 0)
        W = self.flow.W
        self.assertEqual(last["x_npc_discouraged"], sum(len(c.get("out", ())) for c in W.cities))
        pool = last["x_npc_pool"]
        emp = last["x_npc_employed"]
        self.assertAlmostEqual(last["x_npc_lfp"], (pool + emp) / (pool + emp + last["x_npc_discouraged"] + last["x_npc_dependents"]))
        L = W.L
        self.assertAlmostEqual(sum(L.bal.values()), L.minted, places=4)


if __name__ == "__main__":
    unittest.main()
