"""D6: işe alım kuralları ve yeni oyuncu katılımı göstergeleri (sunucu). Her gösterge modelin kendi durumundan okunur.

Gerçek model testleri OYUN_QUICK ile atlanır; sahte dünya testleri her zaman koşar."""
from __future__ import annotations

import json
import re
import unittest
from collections import defaultdict
from pathlib import Path

from oyun_server.sim import extract, probes
from oyun_server.sim.extract import extract_world, make_packet

from tests.extract_v2_helpers import QUICK, Run, deep, fake_world, params_ns, snapshot_equal

HERE = Path(__file__).resolve().parent
TYPES_TS = HERE.parents[3] / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts"

STOCK = ["players_total", "players_new_total", "ahir_capacity", "ahir_fill", "npc_firm_npc", "npc_firm_players"]
FLOWS = ["players_new", "hired_player", "hired_npc", "fired_player", "fired_npc", "ahir_moves", "ahir_backfilled", "inflow_blocked"]
NEW_WORLD = STOCK + FLOWS


def hire_world():
    """2 şehir: şehir 0'da ahır (kapasite 50, 2 oyuncu + 1 NPC), NPC firmasında 2 NPC + 1 oyuncu, ölü firmada işçi yok."""
    W = fake_world(2)
    P = params_ns()
    ppl = W.people
    ppl["s0_p1"] = dict(tier=0, wage=10, firm="s0_ahir0", who="oyuncu", city=0)
    ppl["s0_p2"] = dict(tier=0, wage=10, firm="s0_un0", who="oyuncu", city=0)
    for k in ("npc0", "npc1", "npc2"):
        ppl[k] = dict(tier=0, wage=10, firm="s0_un0" if k != "npc2" else "s0_ahir0", who="npc", city=0)
    W.firms["s0_ahir0"] = dict(kind="ahir", city=0, workers=["s0_p0", "s0_p1", "npc2"], owner=None, dead=False, capacity=50)
    W.firms["s0_un0"] = dict(kind="un", city=0, workers=["s0_p2", "npc0", "npc1"], owner=None, dead=False, capacity=25)
    W.firms["s0_un1"] = dict(kind="un", city=0, workers=["x"], owner=None, dead=True, capacity=25)      # ölü firma sayılmaz
    W.firms["s0_pf"] = dict(kind="un", city=0, workers=["s0_p9"], owner="s0_p9", dead=False, capacity=25)   # oyuncu firması sayılmaz
    W.cities[0]["firms"] = ["s0_ahir0", "s0_un0"]
    W.cities[0]["players"] = ["s0_p0", "s0_p1", "s0_p2"]
    W.hire_stat = defaultdict(float, yeni_oyuncu=4, ise_alinan_oyuncu=7, ise_alinan_npc=9, isten_cikan_oyuncu=2, isten_cikan_npc=5,
                              ahir_gecis=3, belediye_gecis=1, ahir_dolgu_npc=2, katilim_sinir_engel=6)
    return W, P


class HireFacts(unittest.TestCase):
    def test_stock_facts_fake_world(self):
        W, P = hire_world()
        f = probes.hire_facts(W, P)
        self.assertEqual(f["x_players_total"], 4)                  # şehir 0'da 3 + şehir 1'de 1
        self.assertEqual(f["x_players_new_total"], 4)
        self.assertEqual(f["x_ahir_capacity"], 50)
        self.assertAlmostEqual(f["x_ahir_fill"], 3 / 50)           # ahırdaki kişi: oyuncu ve NPC
        self.assertEqual((f["x_npc_firm_npc"], f["x_npc_firm_players"]), (2, 1))
        json.dumps(f, allow_nan=False)

    def test_no_ahir_means_null_fill(self):
        W, P = fake_world(), params_ns()
        f = probes.hire_facts(W, P)
        self.assertIsNone(f["x_ahir_fill"])
        self.assertEqual(f["x_ahir_capacity"], 0)
        self.assertIsNone(f["x_players_new_total"])                # sayaç yok (eski model): ölçülmedi

    def test_flow_totals_are_cumulative_counters(self):
        W, P = hire_world()
        t = probes.hire_flow_totals(W, P)
        self.assertEqual(t, {"players_new": 4.0, "hired_player": 7.0, "hired_npc": 9.0, "fired_player": 2.0, "fired_npc": 5.0,
                             "ahir_moves": 4.0, "ahir_backfilled": 2.0, "inflow_blocked": 6.0})
        W2 = fake_world()
        self.assertTrue(all(v is None for v in probes.hire_flow_totals(W2, P).values()))

    def test_does_not_mutate(self):
        W, P = hire_world()
        before = deep(W)
        probes.hire_facts(W, P)
        probes.hire_flow_totals(W, P)
        snapshot_equal(self, W, before, "işe alım ölçümleri")


class ExtractMapping(unittest.TestCase):
    def test_new_fields_mapped_from_facts(self):
        facts = {"x_players_total": 1510, "x_players_new": 4, "x_players_new_total": 10, "x_ahir_capacity": 1500, "x_ahir_fill": 0.5,
                 "x_npc_firm_npc": 800, "x_npc_firm_players": 30, "x_hired_player": 3, "x_hired_npc": 9, "x_fired_player": 1, "x_fired_npc": 6,
                 "x_ahir_moves": 2, "x_ahir_backfilled": 1, "x_inflow_blocked": 0}
        w = extract_world({"calisan": "170", "issiz": "8", **facts})
        for k in NEW_WORLD:
            self.assertIn(k, w, k)
        self.assertEqual((w["players_total"], w["players_new"], w["players_new_total"]), (1510, 4, 10))
        self.assertEqual((w["npc_firm_npc"], w["npc_firm_players"], w["ahir_fill"]), (800, 30, 0.5))
        self.assertEqual((w["hired_player"], w["hired_npc"], w["fired_player"], w["fired_npc"]), (3, 9, 1, 6))
        json.dumps(w, allow_nan=False)

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


@unittest.skipIf(QUICK, "gerçek model")
class RealModelDefault(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_ = Run(6)

    @classmethod
    def tearDownClass(cls):
        cls.run_.close()

    def test_default_has_no_inflow_and_counts_moves(self):
        r = self.run_
        self.assertTrue(all(f["x_players_new"] == 0 for f in r.facts))
        self.assertTrue(all(f["x_players_total"] == 1500 for f in r.facts))
        self.assertGreater(sum(f["x_ahir_moves"] for f in r.facts), 0)
        self.assertEqual(sum(f["x_fired_player"] for f in r.facts), 0)

    def test_weekly_flows_equal_cumulative_differences(self):
        r = self.run_
        st = r.W.hire_stat
        want = {"hired_player": st["ise_alinan_oyuncu"], "hired_npc": st["ise_alinan_npc"], "fired_npc": st["isten_cikan_npc"],
                "ahir_moves": st["ahir_gecis"] + st["belediye_gecis"]}
        for name, total in want.items():
            weekly = [f["x_" + name] for f in r.facts]
            self.assertTrue(all(v is not None and v >= 0 for v in weekly), name)
            self.assertAlmostEqual(sum(weekly), total, places=6, msg=name)

    def test_stock_matches_model_state(self):
        r, W = self.run_, self.run_.W
        f = r.facts[-1]
        npc_firm = [d for d in W.firms.values() if d["owner"] is None and d["kind"] not in ("ahir", "belediye") and not d.get("dead")]
        self.assertEqual(f["x_npc_firm_npc"], sum(1 for d in npc_firm for q in d["workers"] if W.people[q]["who"] == "npc"))
        self.assertEqual(f["x_npc_firm_players"], sum(1 for d in npc_firm for q in d["workers"] if W.people[q]["who"] == "oyuncu"))
        self.assertEqual(f["x_ahir_capacity"], 5 * 6 * 50)
        self.assertEqual(f["x_players_total"], sum(1 for p in W.people.values() if p["who"] == "oyuncu"))

    def test_packet_fields_finite(self):
        r = self.run_
        for row, facts in zip(r.rows, r.facts):
            w = extract_world({**row, **facts})
            for k in NEW_WORLD:
                self.assertIn(k, w, k)
                self.assertIsNotNone(w[k], k)
            json.dumps(w, allow_nan=False)


@unittest.skipIf(QUICK, "gerçek model")
class RealModelFlags(unittest.TestCase):
    def test_rate_inflow_adds_players_and_conserves_money(self):
        r = Run(4, {"PLAYER_INFLOW": 2, "PLAYER_INFLOW_RATE": 3})
        try:
            self.assertEqual([f["x_players_new"] for f in r.facts], [15, 15, 15, 15])
            self.assertEqual(r.facts[-1]["x_players_total"], 1500 + 60)
            self.assertEqual(r.facts[-1]["x_players_new_total"], 60)
            L = r.W.L
            self.assertAlmostEqual(sum(L.bal.values()), L.minted, places=4)
        finally:
            r.close()

    def test_server_population_cap_applies_inside_the_run(self):
        from oyun_server import config
        from oyun_server.sim.host import ModelHost
        host = ModelHost(str(config.MODEL_ROOT), {"PLAYER_INFLOW": 2, "PLAYER_INFLOW_RATE": 10}, 200, max_population=1500 + 5100 + 20)
        try:
            blocked = 0
            for _ in range(3):
                host.step()
                blocked += host.facts()["x_inflow_blocked"] or 0
            self.assertEqual(len(host._W.people), 1500 + 5100 + 20)
            self.assertGreater(blocked, 0)
        finally:
            host.close()

    def test_backfill_and_equal_rules_run_clean(self):
        r = Run(5, {"AHIR_BACKFILL": 1, "HIRE_PRIORITY": 1, "FIRE_ORDER": 3, "AHIR_MOVE": 1})
        try:
            self.assertGreater(sum(f["x_ahir_backfilled"] for f in r.facts), 0)
            L = r.W.L
            self.assertAlmostEqual(sum(L.bal.values()), L.minted, places=4)
        finally:
            r.close()


if __name__ == "__main__":
    unittest.main()
