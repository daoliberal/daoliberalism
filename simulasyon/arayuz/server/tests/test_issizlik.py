"""D5: işsizlik ve NPC havuzu ölçümü. Her gösterge modelin kendi durumundan okunur (uydurma oran yok).

Gerçek model testleri OYUN_QUICK ile atlanır; sahte dünya testleri her zaman koşar."""
from __future__ import annotations

import json
import re
import unittest
from collections import defaultdict
from pathlib import Path

from oyun_server.sim import extract, extract_cities, probes
from oyun_server.sim.extract import extract_world, make_packet

from tests.extract_v2_helpers import QUICK, deep, fake_world, params_ns, real_run, snapshot_equal

HERE = Path(__file__).resolve().parent
TYPES_TS = HERE.parents[3] / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts"

STOCK = ["npc_pool", "npc_employed", "npc_broke", "npc_pool_cash_avg", "players_seeking", "players_in_ahir", "players_students"]
FLOWS = ["benefit_paid", "benefit_paid_npc", "muni_wages", "bursary_paid", "benefit_cut"]
NEW_WORLD = STOCK + ["unemployment_rate_all"] + FLOWS
CITY_NEW = {"npc_pool", "npc_broke", "players_seeking"}


def labor_world():
    """2 şehir: şehir 0'da 3 havuz NPC'si (biri nakitsiz), 1 iş arayan oyuncu, ahırda 1 oyuncu + 1 NPC, 1 çalışan NPC."""
    W = fake_world(2)
    P = params_ns(NPC_MIN_BAL=1.0, NPC_ASGARI=False, EDUCATION=True)
    W.EDU_ON = True
    W.student = {}
    L = W.L
    ppl = W.people
    for k, bal in (("npc0", 50.0), ("npc1", 0.2), ("npc2", 3.0)):
        ppl[k] = dict(tier=0, wage=10, firm=None, who="npc", city=0)
        L.bal[k] = bal
        W.cities[0]["pool"].append(k)
    ppl["npc3"] = dict(tier=0, wage=10, firm="s0_ahir0", who="npc", city=0)
    ppl["s0_p1"] = dict(tier=0, wage=10, firm="s0_ahir0", who="oyuncu", city=0)
    ppl["s0_p2"] = dict(tier=0, wage=10, firm="s0_un0", who="oyuncu", city=0)
    ppl["npc4"] = dict(tier=0, wage=10, firm="s0_un0", who="npc", city=0)
    W.firms["s0_ahir0"] = dict(kind="ahir", city=0, workers=["npc3", "s0_p1"], owner=None, dead=False)
    W.firms["s0_un0"] = dict(kind="un", city=0, workers=["s0_p2", "npc4"], owner=None, dead=False)
    W.cities[0]["firms"] = ["s0_ahir0", "s0_un0"]
    W.cities[0]["players"] = ["s0_p0", "s0_p1", "s0_p2"]
    W.cities[0]["seekers"] = ["s0_p0"]
    W.cities[1]["seekers"] = []
    W.cities[1]["players"] = ["s1_p0"]
    W.student = {"s0_p2": dict(stage=0, left=3)}
    return W, P


class LaborFacts(unittest.TestCase):
    def test_stock_facts_fake_world(self):
        W, P = labor_world()
        f = probes.labor_facts(W, P)
        self.assertEqual(f["x_npc_pool"], 3)
        self.assertEqual(f["x_npc_employed"], 2)
        self.assertEqual(f["x_npc_broke"], 1)                                   # yalnız 0.2 < NPC_MIN_BAL
        self.assertAlmostEqual(f["x_npc_pool_cash_avg"], (50.0 + 0.2 + 3.0) / 3)
        self.assertEqual(f["x_players_seeking"], 1)
        self.assertEqual(f["x_players_in_ahir"], 1)                             # ahırdaki NPC oyuncu sayılmaz
        self.assertEqual(f["x_players_students"], 1)
        json.dumps(f, allow_nan=False)

    def test_empty_pool_and_rules_off(self):
        W, P = fake_world(), params_ns(NPC_MIN_BAL=1.0, NPC_ASGARI=False)
        f = probes.labor_facts(W, P)
        self.assertEqual((f["x_npc_pool"], f["x_npc_employed"], f["x_npc_broke"]), (0, 0, 0))
        self.assertIsNone(f["x_npc_pool_cash_avg"])                             # havuz boşsa ortalama yok
        self.assertEqual(f["x_players_seeking"], 2)
        self.assertEqual(f["x_players_in_ahir"], 0)
        self.assertIsNone(f["x_players_students"])                              # eğitim kapalı / öğrenci tablosu yok: ölçülmez

    def test_does_not_mutate(self):
        W, P = labor_world()
        before = deep(W)
        probes.labor_facts(W, P)
        probes.labor_flow_totals(W, P)
        snapshot_equal(self, W, before, "işsizlik ölçümleri")

    def test_flow_totals_are_cumulative_model_flows(self):
        W, P = labor_world()
        fl, cut = W.L.flows, W.L.cut
        fl["issizlik_odenegi"], fl["lonca_issizlik_odenegi"], fl["issizlik_odenegi_npc"] = 100.0, 40.0, 7.0
        fl["belediye_ucreti"], fl["ciraklik_bursu"], fl["lonca_ciraklik_bursu"] = 500.0, 60.0, 5.0
        cut["issizlik_odenegi"] = 12.0
        t = probes.labor_flow_totals(W, P)
        self.assertEqual(t["benefit_paid"], 140.0)                              # şehir + lonca ödeneği
        self.assertEqual(t["muni_wages"], 500.0)
        self.assertEqual(t["bursary_paid"], 65.0)                               # şehir + lonca bursu
        self.assertEqual(t["benefit_cut"], 12.0)
        self.assertIsNone(t["benefit_paid_npc"])                                # NPC güvencesi kapalı: böyle bir ödenek yok
        P2 = params_ns(NPC_MIN_BAL=1.0, NPC_ASGARI=True)
        self.assertEqual(probes.labor_flow_totals(W, P2)["benefit_paid_npc"], 7.0)

    def test_city_rows_carry_pool_and_seekers(self):
        W, P = labor_world()
        rows = extract_cities.city_rows(W, P, None)
        self.assertEqual((rows[0]["npc_pool"], rows[0]["npc_broke"], rows[0]["players_seeking"]), (3, 1, 1))
        self.assertEqual((rows[1]["npc_pool"], rows[1]["npc_broke"], rows[1]["players_seeking"]), (0, 0, 0))
        for r in rows:
            self.assertEqual(r["players_seeking"], r["unemployed"])
        self.assertTrue(CITY_NEW <= set(rows[0]))


class ExtractMapping(unittest.TestCase):
    def test_new_fields_mapped_from_facts(self):
        facts = {"x_npc_pool": 30, "x_npc_employed": 70, "x_npc_broke": 4, "x_npc_pool_cash_avg": 12.5, "x_players_seeking": 8, "x_players_in_ahir": 5,
                 "x_players_students": 2, "x_benefit_paid": 100.0, "x_benefit_paid_npc": None, "x_muni_wages": 50.0, "x_bursary_paid": 9.0, "x_benefit_cut": 0.0}
        w = extract_world({"calisan": "170", "issiz": "8", **facts})
        for k in NEW_WORLD:
            self.assertIn(k, w, k)
        self.assertEqual((w["npc_pool"], w["npc_employed"], w["npc_broke"], w["npc_pool_cash_avg"]), (30, 70, 4, 12.5))
        self.assertEqual((w["players_seeking"], w["players_in_ahir"], w["players_students"]), (8, 5, 2))
        self.assertEqual((w["benefit_paid"], w["benefit_paid_npc"], w["muni_wages"], w["bursary_paid"], w["benefit_cut"]), (100.0, None, 50.0, 9.0, 0.0))
        # toplam işsizlik = (iş arayan oyuncu + havuz NPC) / (çalışan + iş arayan oyuncu + havuz NPC)
        self.assertAlmostEqual(w["unemployment_rate_all"], (8 + 30) / (170 + 8 + 30))
        self.assertAlmostEqual(w["unemployment_rate"], 8 / 178)                 # oyuncu işsizliği tanımı değişmedi

    def test_rate_all_null_without_pool_or_denominator(self):
        self.assertIsNone(extract_world({"calisan": "170", "issiz": "8"})["unemployment_rate_all"])      # havuz ölçülmedi
        self.assertIsNone(extract_world({"calisan": "0", "issiz": "0", "x_npc_pool": 0})["unemployment_rate_all"])
        self.assertEqual(extract_world({"calisan": "10", "issiz": "0", "x_npc_pool": 0})["unemployment_rate_all"], 0)

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
class RealModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_ = real_run()

    def test_players_seeking_equals_unemployed(self):
        r = self.run_
        for row, facts, snap in zip(r.rows, r.facts, r.snaps):
            self.assertEqual(facts["x_players_seeking"], int(row["issiz"]))
            self.assertEqual(sum(c["players_seeking"] for c in snap["cities"]), int(row["issiz"]))
            for c in snap["cities"]:
                self.assertEqual(c["players_seeking"], c["unemployed"])

    def test_npc_population_consistent(self):
        """havuz + çalışan NPC = NPC nüfusu (göç ve ölüm NPC sayısını değiştirmez); şehir toplamları dünya toplamına eşit."""
        r = self.run_
        W = r.W
        npc_total = sum(1 for p in W.people.values() if p["who"] == "npc")
        self.assertGreater(npc_total, 0)
        for row, facts, snap in zip(r.rows, r.facts, r.snaps):
            self.assertEqual(facts["x_npc_pool"] + facts["x_npc_employed"], npc_total)
            self.assertEqual(facts["x_npc_employed"], int(row["calisan_npc"]))
            self.assertEqual(sum(c["npc_pool"] for c in snap["cities"]), facts["x_npc_pool"])
            self.assertEqual(sum(c["npc_broke"] for c in snap["cities"]), facts["x_npc_broke"])
            self.assertLessEqual(facts["x_npc_broke"], facts["x_npc_pool"])

    def test_pool_measures_match_model_state(self):
        r, W = self.run_, self.run_.W
        pool = [q for c in W.cities for q in c["pool"]]
        f = r.facts[-1]
        self.assertEqual(f["x_npc_pool"], len(pool))
        self.assertEqual(f["x_npc_broke"], sum(1 for q in pool if W.L.bal[q] < r.P.NPC_MIN_BAL))
        if pool:
            self.assertAlmostEqual(f["x_npc_pool_cash_avg"], sum(W.L.bal[q] for q in pool) / len(pool), places=9)
        ahir_players = sum(1 for d in W.firms.values() if d["kind"] == "ahir" for q in d["workers"] if W.people[q]["who"] == "oyuncu")
        self.assertEqual(f["x_players_in_ahir"], ahir_players)
        self.assertEqual(f["x_players_students"], len(W.student))

    def test_player_labor_force_consistent(self):
        """oyuncular = çalışan oyuncu + iş arayan oyuncu (her oyuncu ya bir işte ya iş arayanlar listesinde)."""
        r, W = self.run_, self.run_.W
        players = sum(1 for p in W.people.values() if p["who"] == "oyuncu")
        working = sum(1 for d in W.firms.values() for q in d["workers"] if W.people[q]["who"] == "oyuncu")
        self.assertEqual(working + r.facts[-1]["x_players_seeking"], players)

    def test_weekly_flows_equal_cumulative_differences(self):
        r = self.run_
        fl = r.W.L.flows
        want = {"benefit_paid": fl["issizlik_odenegi"] + fl["lonca_issizlik_odenegi"], "muni_wages": fl["belediye_ucreti"],
                "bursary_paid": fl["ciraklik_bursu"] + fl["lonca_ciraklik_bursu"]}
        for name, total in want.items():
            weekly = [f["x_" + name] for f in r.facts]
            self.assertTrue(all(v is not None and v >= -1e-9 for v in weekly), name)
            self.assertAlmostEqual(sum(weekly), total, places=6, msg=name)
        self.assertGreater(sum(f["x_muni_wages"] for f in r.facts), 0)
        self.assertTrue(all(f["x_benefit_paid_npc"] is None for f in r.facts))   # varsayılan modelde NPC güvencesi kapalı
        self.assertAlmostEqual(sum(f["x_benefit_cut"] for f in r.facts), r.W.L.cut["issizlik_odenegi"], places=6)

    def test_world_packet_has_all_new_fields_finite(self):
        r = self.run_
        for row, facts in zip(r.rows, r.facts):
            w = extract_world({**row, **facts})
            for k in NEW_WORLD:
                self.assertIn(k, w, k)
            for k in ("npc_pool", "npc_employed", "npc_broke", "players_seeking", "players_in_ahir", "benefit_paid", "muni_wages", "bursary_paid", "benefit_cut", "unemployment_rate_all"):
                self.assertIsNotNone(w[k], k)
            self.assertGreaterEqual(w["unemployment_rate_all"], w["unemployment_rate"] - 1e-12)
            json.dumps(w, allow_nan=False)

    def test_extract_does_not_mutate_W(self):
        r = real_run()
        before = deep(r.W)
        probes.labor_facts(r.W, r.P)
        extract_cities.city_rows(r.W, r.P, extract_cities.city_map(r.W))
        snapshot_equal(self, r.W, before, "işsizlik ölçümleri (gerçek dünya)")


if __name__ == "__main__":
    unittest.main()
