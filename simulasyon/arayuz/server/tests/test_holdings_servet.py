"""PLAN-TAKIP T3 (K2, §4.6): sahip serveti `holdings.wealth`.

Oyuncu serveti = nakit + mevduat + sahibi olduğu CANLI firmaların kasası. Sahte dünya testleri her zaman koşar; elle hesap aşağıda yazılıdır."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server.sim import holdings

from tests.extract_v2_helpers import QUICK, deep, fake_world, params_ns, real_run, snapshot_equal
from tests.test_holdings_lonca import PERSON_ID, lonca_world
from tests.test_holdings_para import holdings_world, size

KEYS = ("b50", "m40", "t10", "t1", "median", "gini", "n")


def hand_world():
    """`lonca_world` + ölü firmaya 99 Akçe (dahil EDİLMEMELİ). Elle hesap (n = 11 oyuncu):

    p0 = 10 nakit + 120 mevduat + 20 (s0_pl0) + 60 (s0_pl2) = 210 (iki firmalı sahip)
    p1 = 11 + 30 + 25 (s0_pl1) = 66 (mevduatlı, firma sahibi)
    p2..p6 = 12, 13, 14, 15, 16;  s1_p0 = 17, s1_p1 = 18
    s1_p2 = 19 + 10 mevduat = 29 (mevduatlı, firmasız); s1_p3 = 20 (ölü firmanın 99'u sayılmaz)
    DAO firması (11), yerleşik firma (30), belediye, ahır: sahibi oyuncu değil, sayılmaz. NPC nakdi ve sigorta mevduatı sayılmaz."""
    W, P = lonca_world()
    W.L.bal["s1_dead"] = 99.0
    return W, P


class WealthByHand(unittest.TestCase):
    def test_hand_computed(self):
        W, P = hand_world()
        w = holdings.owner_wealth(W)
        self.assertEqual(tuple(w), KEYS)
        # artan sıra: 12 13 14 15 16 | 17 18 20 29 | 66 210  (kesimler int(n*0.5)=5, int(n*0.9)=9; modelin top10 / top1_w kuralı), toplam 430
        self.assertEqual(w["n"], 11)
        self.assertAlmostEqual(w["b50"], 70 / 430, places=6)          # 12+13+14+15+16
        self.assertAlmostEqual(w["m40"], 84 / 430, places=6)          # 17+18+20+29
        self.assertAlmostEqual(w["t10"], 276 / 430, places=6)         # 66+210
        self.assertAlmostEqual(w["t1"], 210 / 430, places=6)          # int(11*0.99)=10: en zengin tek kişi
        self.assertEqual(w["median"], 17)                             # pw[11 // 2]
        # Gini = Σ (2(i+1) - n - 1) v / (n toplam) = (-120-104-84-60-32+0+36+80+174+528+2100) / (11*430)
        self.assertAlmostEqual(w["gini"], 2518 / 4730, places=4)

    def test_shares_sum_to_one(self):
        W, P = hand_world()
        w = holdings.owner_wealth(W)
        self.assertAlmostEqual(w["b50"] + w["m40"] + w["t10"], 1.0, delta=1e-9)

    def test_firm_cash_counts_for_owner_only_when_alive_and_player_owned(self):
        W, P = holdings_world()                                       # p0: 20 firma kasası; DAO / yerleşik / ölü firmalar sayılmaz
        W.L.bal["s1_dead"] = 99.0
        before = holdings.owner_wealth(W)
        W.L.bal["s0_pl0"] += 1000.0                                   # oyuncu firmasının kasası sahibinin servetine girer
        after = holdings.owner_wealth(W)
        self.assertGreater(after["t10"], before["t10"])
        for f in ("s0_dao", "s0_un0", "s0_belediye0", "s0_ahir0", "s1_dead"):   # bunların kasası değişince servet değişmez
            W.L.bal[f] += 5000.0
        self.assertEqual(holdings.owner_wealth(W), after)

    def test_org_owner_firm_not_counted_for_founder(self):
        """T3 hükmü: `owner` dolu ama `org_owner` da doluysa (medya firması lonca/DAO'ya satıldı: `media.py:182` sahibi kurucu yazar, `278,307` yalnız `org_owner` koyar)
        firma kurucunun serveti ve sahip sayıları dışındadır."""
        W, P = hand_world()
        W.firms["s0_med"] = dict(kind="medya", city=0, workers=["s0_p3"], owner="s0_p2", org_owner=("lonca", "lonca0"), dead=False, capacity=25)
        W.L.bal["s0_med"] = 500.0
        a, f = holdings.owner_wealth(W), holdings.firms(W)
        self.assertEqual(a, holdings.owner_wealth(hand_world()[0]))   # 500 Akçe kurucu s0_p2'nin servetine girmedi
        self.assertEqual(f, holdings.firms(hand_world()[0]))
        del W.firms["s0_med"][("org_owner")]                          # org_owner kalkarsa (aynı firma yeniden kuruculuk) kasası sahibinindir
        self.assertNotEqual(holdings.owner_wealth(W), a)
        self.assertEqual(holdings.firms(W)["player_count"], f["player_count"] + 1)

    def test_no_dividing_firms_player_without_firm_included(self):
        W, P = hand_world()
        w = holdings.owner_wealth(W)
        self.assertEqual(w["n"], sum(1 for p in W.people.values() if p["who"] == "oyuncu"))      # firma sahibi olmayan oyuncu da dahil

    def test_npc_cash_not_included(self):
        W, P = hand_world()
        a = holdings.owner_wealth(W)
        for q, p in W.people.items():
            if p["who"] == "npc":
                W.L.bal[q] += 10 ** 6
        self.assertEqual(holdings.owner_wealth(W), a)

    def test_negative_wealth_enters_as_is(self):
        W, P = hand_world()
        W.L.bal["s0_p2"] = -50.0                                      # 12 -> -50; toplam 368
        w = holdings.owner_wealth(W)
        self.assertEqual(w["n"], 11)
        self.assertAlmostEqual(w["b50"], (-50 + 13 + 14 + 15 + 16) / 368, places=6)
        self.assertAlmostEqual(w["b50"] + w["m40"] + w["t10"], 1.0, delta=1e-9)

    def test_zero_or_negative_total_gives_null_shares(self):
        W, P = hand_world()
        for q in list(W.L.bal):
            if q in W.people:
                W.L.bal[q] = 0.0
        for f, d in W.firms.items():
            W.L.bal[f] = 0.0
        for k in W.deposits:
            W.deposits[k][1] = 0.0
        w = holdings.owner_wealth(W)
        self.assertEqual((w["b50"], w["m40"], w["t10"], w["t1"], w["gini"]), (None,) * 5)
        self.assertEqual((w["n"], w["median"]), (11, 0))
        W.L.bal["s0_p0"] = -5.0                                       # toplam < 0
        self.assertIsNone(holdings.owner_wealth(W)["b50"])

    def test_no_players(self):
        W = fake_world(1)
        W.people = {}
        w = holdings.owner_wealth(W)
        self.assertEqual(w["n"], 0)
        self.assertIsNone(w["b50"])
        self.assertIsNone(w["median"])


class WealthPurity(unittest.TestCase):
    def test_does_not_mutate(self):
        W, P = hand_world()
        before = deep(W)
        holdings.build(W, P)
        holdings.owner_wealth(W)
        snapshot_equal(self, W, before, "holdings.wealth")

    def test_missing_optional_parts_do_not_crash(self):
        W = fake_world(1)                                             # mevduat yok
        h = holdings.build(W, params_ns())
        self.assertIn("wealth", h)


class WealthInBlock(unittest.TestCase):
    def test_build_carries_wealth_and_notes(self):
        W, P = hand_world()
        h = holdings.build(W, P)
        self.assertEqual(tuple(h["wealth"]), KEYS)
        for k in KEYS:
            self.assertIn("wealth." + k, holdings.NOTES)
        self.assertIn("firmanın kasası sahibinin", holdings.NOTES["wealth.b50"])
        self.assertIn("org_owner", holdings.NOTES["wealth.b50"])         # sahiplik kuralı yazılı: DAO / kamu / özelleşme dışarıda

    def test_no_person_ids(self):
        W, P = hand_world()
        txt = json.dumps(holdings.build(W, P)["wealth"])
        self.assertIsNone(PERSON_ID.search(txt))

    def test_size(self):
        W, P = hand_world()
        self.assertLessEqual(size(holdings.owner_wealth(W)), 150)
        worst_w, worst_p = holdings_world(scale=1e5)
        worst_w.L.bal["s0_p3"] = -1234567.0
        self.assertLessEqual(size(holdings.owner_wealth(worst_w)), 150)


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModelWealth(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rr = real_run()
        cls.blocks = [s["holdings"]["wealth"] for s in cls.rr.snaps[:12]]

    def test_sums_and_counts(self):
        for i, w in enumerate(self.blocks, 1):
            self.assertEqual(tuple(w), KEYS)
            self.assertAlmostEqual(w["b50"] + w["m40"] + w["t10"], 1.0, delta=1e-9, msg=f"hafta {i}")
            self.assertLessEqual(w["t1"], w["t10"])
        self.assertEqual(self.blocks[-1]["n"], self.rr.facts[11]["x_players_total"])

    def test_last_week_recomputed_independently(self):
        """Son haftanın modeli (16. hafta) elle yeniden toplanır: sahip serveti = nakit + mevduat + sahibi olunan canlı firma kasası."""
        W = self.rr.host._W
        w16 = self.rr.snaps[-1]["holdings"]["wealth"]
        vals = []
        for q, p in W.people.items():
            if p["who"] != "oyuncu":
                continue
            v = W.L.bal.get(q, 0.0) + (W.deposits[q][1] if q in W.deposits else 0.0)
            v += sum(W.L.bal.get(f, 0.0) for f, d in W.firms.items() if d.get("owner") == q and not d.get("dead"))
            vals.append(v)
        vals.sort()
        self.assertEqual(w16["n"], len(vals))
        self.assertEqual(w16["median"], round(vals[len(vals) // 2]))
        self.assertAlmostEqual(w16["t1"], sum(vals[int(len(vals) * 0.99):]) / sum(vals), places=6)

    def test_firm_cash_makes_difference(self):
        """K2'nin anlamı: sahip serveti, modelin firma kasasız `world.wealth_top10`'undan sayısal olarak ayrışabilir (yalnız ayrı ölçü olduğu gösterilir)."""
        self.assertTrue(all(b["t10"] is not None for b in self.blocks))

    def test_size_and_purity(self):
        sizes = [size(b) for b in self.blocks]
        self.assertLessEqual(max(sizes), 150, sizes)
        W = self.rr.host._W
        before = deep(W)
        holdings.owner_wealth(W)
        snapshot_equal(self, W, before, "wealth gerçek")


if __name__ == "__main__":
    unittest.main()
