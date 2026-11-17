"""PLAN-TAKIP T2: lonca satırları, oyuncu işletmesi sahipliği ve lonca çekmecesi (pakette taze).

Sahte dünya testleri her zaman koşar (T1'in `holdings_world` yardımcısı); gerçek model testleri OYUN_QUICK ile atlanır."""
from __future__ import annotations

import json
import re
import time
import unittest

from oyun_server import config
from oyun_server.sim import drawers, holdings
from oyun_server.sim.host import ModelHost

from tests.extract_v2_helpers import QUICK, deep, real_run, snapshot_equal
from tests.route_helpers import call, create_run, live_app
from tests.test_chain_drawers import drawer, step_to
from tests.test_holdings_para import holdings_world, size, stepped

PERSON_ID = re.compile(r"s\d+_p\d+|npc\d+")


def lonca_world():
    """T1 dünyası + sahipsiz üçüncü lonca (`lonca2`), üye işletmeler ve çok işletmeli sahip.

    lonca0 (sahipli): s0_un0 + s0_pl0 üye, DAO Ar-Ge işletmesi ve belediye üye sayılmaz. lonca1 (kapalı): s0_pl1 üye.
    lonca2 (sahipsiz): üyesiz. p0'ın ikinci işletmesi `s0_pl2` (çok işletmeli sahip)."""
    W, P = holdings_world()
    W.loncas.append("lonca2")
    W.L.bal["lonca2_sermaye"] = 75.0
    W.FEES = {"lonca0": 0.05, "lonca1": 0.0725}
    for f, lo in (("s0_un0", "lonca0"), ("s0_pl0", "lonca0"), ("s0_dao", "lonca0"), ("s0_pl1", "lonca1"), ("s0_belediye0", "lonca0")):
        W.firms[f]["lonca"] = lo
    W.firms["s0_pl2"] = dict(kind="firin", city=0, workers=["s0_p2"], owner="s0_p0", dead=False, capacity=25, lonca="lonca0")
    W.L.bal["s0_pl2"] = 60.0
    return W, P


class LoncaRows(unittest.TestCase):
    def test_lonca_rows(self):
        W, P = lonca_world()
        rows = holdings.loncas(W, P)
        self.assertEqual([r["ref"] for r in rows], ["lonca0", "lonca1", "lonca2"])
        for r in rows:
            self.assertEqual(tuple(r), holdings.LONCA_ROW_KEYS)
        a, b, c = rows
        self.assertEqual((a["owner"], b["owner"], c["owner"]), ("player", "closed", "none"))     # sahipli, kapalı, sahipsiz
        self.assertEqual((a["members"], b["members"], c["members"]), (3, 1, 0))                  # un + pl0 + pl2; DAO/Ar-Ge ve belediye sayılmaz
        self.assertEqual((a["fee"], b["fee"], c["fee"]), (0.05, 0.0725, 0.05))                   # lonca2: varsayılan LONCA_FEE
        self.assertEqual((a["capital"], b["capital"], c["capital"]), (1000, 0, 75))
        self.assertEqual((a["deposits"], b["deposits"], c["deposits"]), (230, 10, 0))
        self.assertEqual((a["credit_out"], b["credit_out"], c["credit_out"]), (560, 0, 0))       # işletme 500 + konut 60; fon kredisi hariç
        # equity = sermaye + kredi + tahvil - mevduat (credit_core.lo_equity formülü)
        self.assertEqual((a["equity"], b["equity"], c["equity"]), (1000 + 560 + 40 - 230, -10, 75))
        self.assertEqual(sum(r["equity"] for r in rows), holdings.money(W, P)["lonca_equity"])

    def test_equity_equals_model_formula_on_synthetic_world(self):
        """Modelin `lo_equity` işlevinin gövdesi (credit_core.py:31-35) sahte dünyada aynen kurulup satırla karşılaştırılır."""
        W, P = lonca_world()
        for r in holdings.loncas(W, P):
            lo = r["ref"]
            lo_credit = sum(l["out"] for l in W.loans.values() if l["lo"] == lo) + sum(m["out"] for m in W.mortgages if m["lo"] == lo)
            model = W.L.bal[f"{lo}_sermaye"] + lo_credit + sum(b["out"] for b in W.bonds if b["lo"] == lo) - W.dep_tot[lo]
            self.assertAlmostEqual(r["equity"], model, delta=0.5, msg=lo)

    def test_no_lonca_structures(self):
        W, P = lonca_world()
        W.loncas, W.closed, W.lonca_owner = [], set(), {}
        self.assertEqual(holdings.loncas(W, P), [])

    def test_closed_beats_owner(self):
        W, P = lonca_world()
        W.closed.add("lonca0")
        self.assertEqual(holdings.loncas(W, P)[0]["owner"], "closed")


class FirmOwnership(unittest.TestCase):
    def test_multi_owner_counts(self):
        W, P = lonca_world()
        f = holdings.firms(W)
        self.assertEqual(tuple(f), holdings.FIRMS_KEYS)
        # canlı oyuncu işletmeleri: s0_pl0 + s0_pl2 (p0), s0_pl1 (p1). DAO (sahipsiz), ölü s1_dead (s1_p3) ve yerleşik işletmeler sayılmaz.
        self.assertEqual((f["player_count"], f["owners"], f["multi_owners"]), (3, 2, 1))
        W.firms["s1_dead"]["dead"] = False                                    # s1_p3 de bir işletme açar: sahip sayısı artar, çok işletmeli artmaz
        f = holdings.firms(W)
        self.assertEqual((f["player_count"], f["owners"], f["multi_owners"]), (4, 3, 1))
        W.firms["s0_pl1b"] = dict(kind="un", city=0, workers=[], owner="s0_p1", dead=False)
        self.assertEqual(holdings.firms(W)["multi_owners"], 2)

    def test_cash_top10_share(self):
        W, P = lonca_world()
        for f in [k for k, d in W.firms.items() if d.get("owner") is not None]:
            W.firms[f]["dead"] = True
        for i in range(12):                                                    # 12 işletme: en büyük %10 = tavan(1,2) = 2 işletme
            W.firms[f"x{i}"] = dict(kind="un", city=0, workers=[], owner=f"s0_p{i % 7}", dead=False)
            W.L.bal[f"x{i}"] = float(i + 1) * 10                               # 10 ... 120; toplam 780
        self.assertEqual(holdings.firms(W)["cash_top10_share"], round((120 + 110) / 780, 4))
        W.L.bal["x0"] = -500.0                                                 # toplam <= 0 ise pay yok
        for i in range(1, 12):
            W.L.bal[f"x{i}"] = 0.0
        self.assertIsNone(holdings.firms(W)["cash_top10_share"])
        for f in list(W.firms):
            if f.startswith("x"):
                W.firms[f]["dead"] = True                                      # oyuncu işletmesi yok
        f = holdings.firms(W)
        self.assertEqual((f["player_count"], f["owners"], f["multi_owners"], f["cash_top10_share"]), (0, 0, 0, None))

    def test_single_firm_share_is_one(self):
        W, P = lonca_world()
        for k, d in W.firms.items():
            if d.get("owner") is not None and k != "s0_pl0":
                d["dead"] = True
        self.assertEqual(holdings.firms(W)["cash_top10_share"], 1.0)


class Wire(unittest.TestCase):
    def test_build_has_sections_and_notes(self):
        W, P = lonca_world()
        h = holdings.build(W, P)
        self.assertIn("loncas", h)
        self.assertIn("firms", h)
        for k in holdings.LONCA_ROW_KEYS:
            self.assertIn("loncas." + k, holdings.NOTES)
        for k in h["firms"]:
            self.assertIn("firms." + k, holdings.NOTES)
        json.dumps(h, allow_nan=False)

    def test_no_person_ids(self):
        for W, P in (lonca_world(), holdings_world()):
            h = holdings.build(W, P)
            txt = json.dumps(h, ensure_ascii=False)
            self.assertIsNone(PERSON_ID.search(txt), PERSON_ID.search(txt))
            for r in h["loncas"]:
                self.assertIn(r["owner"], ("player", "none", "closed"))
            self.assertIsNone(PERSON_ID.search(json.dumps(drawers.build(W, P, "lonca", "lonca0"), ensure_ascii=False)))

    def test_lonca_row_size(self):
        """Kabul: lonca satırı ortalama <= 120 bayt (5 basamaklı tutarlar; sahipli/sahipsiz/kapalı). 6-7 basamaklı tutarlar satırı uzatır (en kötü ~135);
        bütçe bu yüzden toplamda denetlenir: 9 lonca + bütün bölümler 7 basamaklı tutarlarla <= 3.000 (§7)."""
        W, P = lonca_world()
        rows = holdings.loncas(W, P)
        W2, P2 = holdings_world(scale=10)
        W2.loncas.append("lonca2")
        W2.L.bal["lonca2_sermaye"] = 99_999.0
        W2.FEES = {"lonca0": 0.05}
        small = [size(r) for r in holdings.loncas(W2, P2)]
        self.assertLessEqual(sum(small) / len(small), 120, small)           # ortalama (sahipli satır bir iki bayt aşabilir: 121)
        self.assertLessEqual(max(small), 125, small)
        self.assertEqual(len(rows), 3)
        worst_w, worst_p = holdings_world(scale=1e5)
        worst_w.loncas = [f"lonca{i}" for i in range(9)]
        worst_w.FEES = {lo: 0.0725 for lo in worst_w.loncas}
        for lo in worst_w.loncas:
            worst_w.L.bal[f"{lo}_sermaye"] = 9_876_543.0
            worst_w.dep_tot[lo] = 9_876_543.0
        worst_w.closed = {"lonca5"}
        h = holdings.build(worst_w, worst_p)
        self.assertEqual(len(h["loncas"]), 9)
        self.assertLessEqual(size(h), 3000, size(h))

    def test_does_not_mutate(self):
        W, P = lonca_world()
        before = deep(W)
        holdings.build(W, P)
        holdings.loncas(W, P)
        holdings.firms(W)
        drawers.build(W, P, "lonca", "lonca0")
        snapshot_equal(self, W, before, "holdings.loncas/firms")

    def test_missing_optional_parts_do_not_crash(self):
        from tests.extract_v2_helpers import fake_world, params_ns
        W = fake_world(1)
        h = holdings.build(W, params_ns())
        self.assertEqual(h["loncas"], [])
        self.assertEqual(h["firms"], {"player_count": 0, "owners": 0, "multi_owners": 0, "cash_top10_share": None})


class DrawerFromHoldings(unittest.TestCase):
    def test_worker_and_packet_lonca_equal_synthetic(self):
        """Çekmece (işçi yolu) ile paket satırı ortak alanlarda aynı sayılar: tek hesap, iki yol."""
        W, P = lonca_world()
        rows = {r["ref"]: r for r in holdings.loncas(W, P)}
        for ref, row in rows.items():
            fields = drawers.build(W, P, "lonca", ref)["fields"]
            for k in holdings.LONCA_ROW_KEYS:
                if k != "ref":
                    self.assertEqual(fields[k], row[k], (ref, k))
            self.assertLessEqual(set(fields), drawers.LONCA_FIELDS)
            # paket yolu: aynı satırdan çekmece
            pk = drawers.from_packet("lonca", ref, {"holdings": {"loncas": list(rows.values())}})
            self.assertEqual(pk["fields"], {k: v for k, v in row.items() if k != "ref"})

    def test_from_packet_without_holdings_stays_empty(self):
        out = drawers.from_packet("lonca", "lonca0", {"cities": []})
        self.assertEqual(out["fields"], {})
        self.assertEqual(drawers.from_packet("lonca", "lonca0", None)["fields"], {})
        out = drawers.from_packet("lonca", "lonca0", {"holdings": {"loncas": [{"ref": "lonca1", "owner": "none", "members": 1}]}})
        self.assertEqual(out["fields"], {})                                    # satır yoksa boş (eski kayıt gibi)

    def test_lonca_fields_cover_row(self):
        for k in holdings.LONCA_ROW_KEYS:
            if k != "ref":
                self.assertIn(k, drawers.LONCA_FIELDS)


class RunPath(unittest.TestCase):
    def test_lonca_drawer_fresh_while_running(self):
        """İşçi yayımlanan haftadan önde koşarken (duraklatıp izlemeden) lonca çekmecesi bayat DEĞİL: paket satırından, `week == released`."""
        with live_app() as (srv, app, _w):
            rid = create_run(srv)
            step_to(srv, rid, 2)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 1})
            run = app.manager._runs[rid]
            end = time.time() + 8
            ahead, seen = 0, 0
            while time.time() < end and seen < 6:
                released_before = run.released
                s, _h, b = drawer(srv, rid, "lonca", "lonca1")
                released_after = run.released
                self.assertEqual(s, 200, b)
                self.assertFalse(b["stale"])
                self.assertTrue(released_before <= b["week"] <= released_after, (released_before, b["week"], released_after))
                self.assertGreater(len(b["fields"]), 5)
                self.assertLessEqual(set(b["fields"]), drawers.LONCA_FIELDS)
                self.assertEqual(b["title"], "Lonca 2")
                ahead = max(ahead, run.worker_week - b["week"])
                seen += 1
                time.sleep(0.1)
            self.assertGreater(ahead, 0, "işçi hiç önde olmadı: test anlamsız")
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "pause"})
            time.sleep(0.3)
            s, _h, b = drawer(srv, rid, "lonca", "lonca1")
            self.assertEqual((s, b["week"], b["stale"]), (200, run.released, False))
            pk = call(srv, "GET", f"/api/runs/{rid}/weeks?from={b['week']}&to={b['week']}")[2][0]
            row = next(r for r in pk["holdings"]["loncas"] if r["ref"] == "lonca1")
            self.assertEqual(b["fields"], {k: v for k, v in row.items() if k != "ref"})
            self.assertIsNone(PERSON_ID.search(json.dumps(b)))

    def test_lonca_drawer_old_week_and_unknown_ref(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 3)
            s, _h, b = drawer(srv, rid, "lonca", "lonca0", 2)
            self.assertEqual((s, b["week"], b["stale"]), (200, 2, False))        # eski haftanın paket satırı: o hafta için doğru
            s, _h, b = drawer(srv, rid, "lonca", "lonca99", 2)
            self.assertEqual((s, b["error"]["code"]), (404, "not_found"))

    def test_packets_carry_loncas_and_firms(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 2)
            for p in call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=2")[2]:
                self.assertGreaterEqual(len(p["holdings"]["loncas"]), 6)
                self.assertEqual(tuple(p["holdings"]["firms"]), holdings.FIRMS_KEYS)
                for r in p["holdings"]["loncas"]:
                    self.assertEqual(tuple(r), holdings.LONCA_ROW_KEYS)
                    self.assertLessEqual(size(r), 120)


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = ModelHost(str(config.MODEL_ROOT), {"ENTRY_OPEN": 1, "YOUNG_KIT": 1, "EO_COHORT": 0}, 200)
        cls.packets = stepped(cls.host, 12, True)

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_real_lonca_rows(self):
        W = self.host._W
        h = self.packets[-1]["holdings"]
        cc = self.host._mods["simkit.credit_core"]
        self.assertEqual([r["ref"] for r in h["loncas"]], list(W.loncas))
        for r in h["loncas"]:
            lo = r["ref"]
            self.assertAlmostEqual(r["equity"], cc.lo_equity(W, lo), delta=1, msg=lo)               # modelin kendi formülü
            self.assertAlmostEqual(r["credit_out"], cc.lo_credit(W, lo), delta=1, msg=lo)
            self.assertEqual(r["owner"], "closed" if lo in W.closed else ("player" if lo in W.lonca_owner else "none"))
        sizes = [size(r) for p in self.packets for r in p["holdings"]["loncas"]]
        self.assertLessEqual(sum(sizes) / len(sizes), 120)                   # ölçüm: ortalama ~116, en büyük ~122 (sahipli lonca, 5 basamak)
        self.assertLessEqual(max(sizes), 125)
        self.assertAlmostEqual(sum(r["equity"] for r in h["loncas"]), h["money"]["lonca_equity"], delta=len(h["loncas"]))
        self.assertAlmostEqual(sum(r["deposits"] for r in h["loncas"]), h["money"]["deposits_players"] + h["money"]["deposits_insurance"], delta=len(h["loncas"]) + 3)

    def test_real_firms(self):
        W = self.host._W
        f = self.packets[-1]["holdings"]["firms"]
        live = [d for d in W.firms.values() if d.get("owner") is not None and not d.get("dead")]
        self.assertEqual(f["player_count"], len(live))
        self.assertEqual(f["owners"], len({d["owner"] for d in live}))
        self.assertGreaterEqual(f["player_count"], f["owners"])
        self.assertGreaterEqual(f["owners"], f["multi_owners"])
        self.assertTrue(f["cash_top10_share"] is None or 0 < f["cash_top10_share"] <= 1)

    def test_real_no_person_ids_and_size(self):
        for p in self.packets:
            txt = json.dumps({"loncas": p["holdings"]["loncas"], "firms": p["holdings"]["firms"]})
            self.assertIsNone(PERSON_ID.search(txt))
        self.assertLessEqual(max(size(p["holdings"]) for p in self.packets), 3000)

    def test_worker_and_packet_lonca_equal(self):
        """Gerçek model: çekmece (işçi yolu, `host.drawer`) ile son haftanın paket satırı ortak alanlarda aynıdır."""
        h = self.packets[-1]["holdings"]
        for row in h["loncas"]:
            d = self.host.drawer("lonca", row["ref"])
            for k in holdings.LONCA_ROW_KEYS:
                if k != "ref":
                    self.assertEqual(d["fields"][k], row[k], (row["ref"], k))
            pk = drawers.from_packet("lonca", row["ref"], {"holdings": h})
            self.assertEqual(d["fields"], pk["fields"], row["ref"])                 # iki yol birebir aynı alan kümesi ve sayı

    def test_does_not_mutate_real(self):
        W = self.host._W
        before = deep(W)
        holdings.build(W, self.host._P)
        self.host.drawer("lonca", W.loncas[0])
        snapshot_equal(self, W, before, "loncas/firms/çekmece")


if __name__ == "__main__":
    unittest.main()
