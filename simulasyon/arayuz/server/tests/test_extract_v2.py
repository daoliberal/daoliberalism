"""S5: çıkarıcı v2: dünya alanları (modelden doğrudan), şehir satırları, zincir/pano. Gerçek model testleri OYUN_QUICK ile atlanır."""
from __future__ import annotations

import json
import math
import re
import unittest
from collections import defaultdict
from pathlib import Path

from oyun_server import config
from oyun_server.sim import extract, extract_chain, extract_cities, probes
from oyun_server.sim.extract import extract_world, make_packet

from tests.extract_v2_helpers import QUICK, Run, deep, fake_world, params_ns, real_run, same, snapshot_equal

HERE = Path(__file__).resolve().parent
TYPES_TS = HERE.parents[3] / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts"
NEW_NUMERIC = ["price_index", "inflation_yoy", "policy_rate", "minted_year", "mint_cap", "deposit_rate", "bond_rate", "lonca_fee_avg",
               "royalty_avg", "rent_pct", "occupancy", "house_index", "survival_52", "wage_index", "loan_rate_avg", "city_cash_weeks"]
CITY_KEYS_NEW = {"index", "served", "employed", "unemployed", "cash", "firms_npc", "firms_player", "firms_total", "rent_pct", "occupancy", "tenants_per_house",
                 "migration_in", "migration_out", "cash_weeks", "npc_pool", "npc_broke", "players_seeking", "population", "players_in_ahir"}
CITY_KEYS = CITY_KEYS_NEW


def finite_json(x) -> None:
    json.dumps(x, allow_nan=False)


@unittest.skipIf(QUICK, "gerçek model")
class RealModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_ = real_run()

    def test_extract_does_not_mutate_W(self):
        r = Run(3)                                           # kendi taze koşusu: paylaşılan koşunun önceki okumaları anahtar oluşturup mutasyonu maskelemesin
        try:
            before = deep(r.W)
            probes.world_facts(r.W, r.P)
            prev = extract_cities.city_map(r.W)
            extract_cities.city_rows(r.W, r.P, prev)
            extract_chain.chain_snapshot(r.W, r.P)
            snapshot_equal(self, r.W, before, "çıkarıcılar")
        finally:
            r.close()

    def test_world_facts_real_values(self):
        r, W = self.run_, self.run_.W
        f, w = r.facts[-1], extract_world({**r.rows[-1], **r.facts[-1]})
        self.assertAlmostEqual(w["price_index"], W.weekly[-1]["series"]["pidx"], places=9)
        self.assertIsNone(w["inflation_yoy"], "16 hafta: 52 haftalık pencere ve açılış sonrası taban yok")
        self.assertAlmostEqual(w["wage_index"], 100.0 * sum(W.WI[c["i"]] for c in W.cities) / len(W.cities), places=9)
        ids = [c["i"] for c in W.cities]
        self.assertAlmostEqual(w["occupancy"], sum(min(W.occ[i], W.hs[i]) for i in ids) / sum(W.hs[i] for i in ids), places=9)
        self.assertLessEqual(w["occupancy"], 1.0)
        self.assertAlmostEqual(w["tenants_per_house"], sum(W.occ[i] for i in ids) / sum(W.hs[i] for i in ids), places=9)
        base = r.P.RENT_H * r.P.TIER_WAGE[0]
        raw = 100.0 * sum(W.RENT_CY[i] * W.hratio[i] for i in ids) / len(ids) / base            # açılış kirasına göre ham değer
        self.assertAlmostEqual(r.raw_house[-1], raw, places=9)
        self.assertAlmostEqual(w["house_index"], 100.0 * raw / r.raw_house[0], places=9)       # ilk ölçüm = 100
        self.assertAlmostEqual(w["house_resale_ratio"], sum(W.hratio[i] for i in ids) / len(ids), places=9)
        self.assertAlmostEqual(w["lonca_fee_avg"], sum(W.FEES[lo] for lo in W.loncas if lo not in W.closed) / len([lo for lo in W.loncas if lo not in W.closed]), places=9)
        tot = sum(l["out"] for l in W.loans.values())
        self.assertTrue(tot > 0)
        self.assertAlmostEqual(w["loan_rate_avg"], sum(l["out"] * l["rate"] for l in W.loans.values()) / tot, places=9)
        self.assertGreater(w["rent_pct"], 0.0)
        self.assertGreater(w["city_cash_weeks"], 0.0)
        self.assertIsNone(f.get("x_survival_52"), "16 hafta: 52 haftalık pencere dolmadı")
        for k in ("price_index", "policy_rate", "wage_index", "rent_pct", "occupancy", "house_index", "lonca_fee_avg",
                  "loan_rate_avg", "city_cash_weeks", "minted_year", "mint_cap"):
            self.assertIsNotNone(w[k], k)
        finite_json(w)

    def test_opening_week_occupancy_is_bounded(self):
        r = self.run_
        for snap, facts, row in zip(r.snaps, r.facts, r.rows):
            w = extract_world({**row, **facts})
            self.assertLessEqual(w["occupancy"], 1.0)
            for c in snap["cities"]:
                self.assertLessEqual(c["occupancy"], 1.0)
        first = extract_world({**r.rows[0], **r.facts[0]})
        self.assertGreater(first["tenants_per_house"], 1.0)        # açılışta kiracı konuttan çok: ham oran ayrı alanda
        self.assertGreater(r.snaps[0]["cities"][0]["tenants_per_house"], 1.0)

    def test_policy_inflation_is_what_the_rule_saw(self):
        r, W = self.run_, self.run_.W
        hist = {h[0]: h for h in W.pol_hist}
        self.assertIsNone(extract_world({**r.rows[0], **r.facts[0]})["policy_inflation"])
        for wk, facts in enumerate(r.facts, start=1):
            if wk in hist:
                self.assertAlmostEqual(extract_world({**r.rows[wk - 1], **facts})["policy_inflation"], hist[wk][3], places=12, msg=wk)

    def test_mint_fields_follow_allowance(self):
        r, W = self.run_, self.run_.W
        w = extract_world({**r.rows[-1], **r.facts[-1]})
        self.assertAlmostEqual(w["mint_cap"], W.mint_allow_tot, places=9)
        self.assertAlmostEqual(w["minted_year"], W.mint_allow_tot - sum(W.L.allow.values()), places=6)
        self.assertEqual(w["minted_total"], w["minted_year"])      # birikimli kullanılan izin; eski ad geriye uyum için
        self.assertGreaterEqual(w["minted_year"], 0.0)
        self.assertLessEqual(w["minted_year"], w["mint_cap"] + 1e-6)
        first = extract_world({**r.rows[0], **r.facts[0]})          # hafta 1: tavan açılış döneminde yok
        self.assertIsNone(first["mint_cap"])
        self.assertIsNone(first["minted_year"])

    def test_policy_rate_matches_model_series(self):
        r = self.run_
        W = r.W
        hist = {h[0]: h for h in W.pol_hist}
        self.assertGreaterEqual(len(hist), 10)
        for wk, facts in enumerate(r.facts, start=1):
            if wk in hist:
                self.assertAlmostEqual(extract_world({**r.rows[wk - 1], **facts})["policy_rate"], hist[wk][1], places=12, msg=wk)
        self.assertAlmostEqual(extract_world({**r.rows[-1], **r.facts[-1]})["policy_rate"], W.pol[0], places=12)

    def test_city_rows_shape_and_sums(self):
        r = self.run_
        for wk in (1, 5, 16):
            rows, row, snap = r.snaps[wk - 1]["cities"], r.rows[wk - 1], r.snaps[wk - 1]
            self.assertEqual(len(rows), 5)
            self.assertEqual([c["index"] for c in rows], list(range(5)))
            for c in rows:
                self.assertEqual(set(c), CITY_KEYS)
            self.assertEqual(sum(c["employed"] for c in rows), int(row["calisan"]), wk)
            self.assertEqual(sum(c["unemployed"] for c in rows), int(row["issiz"]), wk)
            self.assertEqual(sum(c["firms_npc"] for c in rows), int(row["npc_firma"]), wk)
            self.assertEqual(sum(c["firms_player"] for c in rows), int(row["oyuncu_firma"]), wk)
            self.assertAlmostEqual(sum(c["cash"] for c in rows), float(row["sehir_kasasi"]), delta=0.5 + 1e-6)
            finite_json(snap)

    def test_city_cash_weeks_is_model_floor_measure(self):
        """E0: şehir başına kasa-hafta = şehir kasası / sönümlü haftalık zorunlu gider (`L.mand`, modelin TRANS_FLOOR_WEEKS ölçüsü); toplam, payları paydalarıyla birleştirir."""
        r, W = self.run_, self.run_.W
        rows = extract_cities.city_rows(W, r.P, None)
        self.assertIsNotNone(W.L.cexp)
        mand = [max(0.0, W.L.mand.get(c["acct"], 0.0)) for c in W.cities]
        for c, row, m in zip(W.cities, rows, mand):
            if m <= 1e-9:
                self.assertIsNone(row["cash_weeks"])
            else:
                self.assertAlmostEqual(row["cash_weeks"], W.L.bal[c["acct"]] / m, places=9)
        known = [(row["cash_weeks"], m) for row, m in zip(rows, mand) if row["cash_weeks"] is not None]
        self.assertGreater(len(known), 0)
        total = probes.world_facts(W, r.P)["x_city_cash_weeks"]
        self.assertAlmostEqual(total, sum(w * m for w, m in known) / sum(mand), places=6)     # toplam ölçü, şehir ölçülerinin zorunlu gider ağırlıklı ortalaması
        self.assertLessEqual(min(w for w, _ in known), total + 1e-9)

    def test_city_served_weights_to_world(self):
        r, W = self.run_, self.run_.W
        rows = r.snaps[-1]["cities"]
        dem = [c["dem_units"] for c in W.cities]
        got = sum(rows[i]["served"] * dem[i] for i in range(5))
        self.assertAlmostEqual(got / sum(dem), float(r.rows[-1]["talep_karsilama"]), delta=1e-4)

    def test_migration_matches_model_flows(self):
        r = self.run_
        total = 0
        for i, snap in enumerate(r.snaps):
            rows = snap["cities"]
            inn, out = sum(c["migration_in"] for c in rows), sum(c["migration_out"] for c in rows)
            self.assertEqual(inn, out, i + 1)
            self.assertEqual(inn, int(round(r.flow_delta[i])), i + 1)
            total += inn
        self.assertEqual(r.snaps[0]["cities"][0]["migration_in"], 0)       # model 1. haftada göç etmez
        self.assertGreater(total, 0, "16 haftada hiç göç yok: test anlamsız")

    def test_chain_snapshot_shape(self):
        r, W = self.run_, self.run_.W
        ch = r.snaps[-1]["chain"]
        self.assertTrue(ch["board"])
        kinds = [s["sector"] for s in ch["sectors"]]
        self.assertEqual(set(CITY_KEYS_NEW), set(r.snaps[-1]["cities"][0]))
        self.assertEqual(kinds, list(W.TOPO))
        self.assertEqual(len(ch["nodes"]), len(kinds) * 5)
        for n in ch["nodes"]:
            self.assertEqual(set(n), {"sector", "city", "shortage", "price", "firms", "healthy", "demand", "output", "stock"})
        node = next(n for n in ch["nodes"] if n["sector"] == "firin" and n["city"] == 1)
        cell = W.board["cells"][(1, "ekmek")]
        self.assertEqual(node["healthy"], cell["n_healthy"])
        self.assertAlmostEqual(node["demand"], cell["dem"])
        self.assertAlmostEqual(node["price"], W.PRICE[(1, "ekmek")] / W.REF["ekmek"])
        self.assertAlmostEqual(node["shortage"], W.board["prod"]["ekmek"]["short_share"])
        self.assertEqual(node["firms"], sum(1 for d in W.firms.values() if d["kind"] == "firin" and d["city"] == 1 and not d.get("dead") and d["workers"]))
        self.assertEqual(set(ch) - {"edges"}, {"board", "sectors", "nodes", "scarce", "edges_rev"})   # kenar listesi yalnız tarifin değiştiği haftada
        for s in ch["sectors"]:
            self.assertEqual(set(s), {"sector", "product", "firms", "healthy", "shortage", "persist", "cover_days", "price_trend", "price"})
        self.assertIn("edges_rev", ch)
        for s in ch["scarce"]:
            self.assertEqual(set(s), {"sector", "product", "persist", "shortage", "firms", "healthy"})
        finite_json(ch)

    def test_static_chain_info_edges_and_labels(self):
        from tests.registry_helpers import real_defaults
        info = extract_cities.static_world_info(real_defaults(), 5)
        edges = {(e["from"], e["to"], e["product"]) for e in info["chain"]["edges"]}
        self.assertIn(("un", "firin", "un"), edges)
        kinds = {s["sector"] for s in info["chain"]["sectors"]}
        self.assertEqual(kinds, set(self.run_.W.TOPO))
        self.assertTrue(all(s["label"] for s in info["chain"]["sectors"]))
        for e in info["chain"]["edges"]:
            self.assertIn(e["from"], kinds)
            self.assertIn(e["to"], kinds)
            self.assertNotIn("qty", e)                                   # miktar yalnız çekmeceden
        self.assertEqual(info["basis"], "model_defaults")

    def test_house_index_is_100_at_first_measurement(self):
        r = self.run_
        self.assertEqual(r.facts[0]["x_house_index"], 100.0)           # modelin rapor tanımı: ilk ölçüm = 100
        for wk in (5, 16):
            self.assertAlmostEqual(r.facts[wk - 1]["x_house_index"], 100.0 * r.raw_house[wk - 1] / r.raw_house[0], places=9)

    def test_scarce_top5_sorted(self):
        r, W = self.run_, self.run_.W
        sc = r.snaps[-1]["chain"]["scarce"]
        self.assertEqual(len(sc), 5)
        per = [s["persist"] for s in sc]
        self.assertEqual(per, sorted(per, reverse=True))
        want = sorted(W.board["prod"].items(), key=lambda kv: (-kv[1]["persist"], kv[0]))[:5]
        self.assertEqual([s["product"] for s in sc], [p for p, _ in want])
        for s in sc:
            self.assertEqual(s["sector"], r.P.PRODUCER[s["product"]])

    def test_board_off_fields_null(self):
        run = Run(3, {"SECTOR_BOARD": 0})
        try:
            ch = run.snaps[-1]["chain"]
            self.assertFalse(ch["board"])
            self.assertIsNone(ch["scarce"])
            for s in ch["sectors"]:
                for k in ("shortage", "persist", "healthy", "cover_days", "price_trend"):
                    self.assertIsNone(s[k], (s["sector"], k))
            for n in ch["nodes"]:
                for k in ("shortage", "healthy", "demand", "output", "stock"):
                    self.assertIsNone(n[k], (n["sector"], k))
                self.assertIsNotNone(n["price"])                # fiyat panodan değil, modelin fiyat tablosundan
            self.assertTrue(any(n["firms"] > 0 for n in ch["nodes"]))
            finite_json(run.snaps[-1])
        finally:
            run.close()

    def test_parity_old_fields_unchanged(self):
        r = self.run_
        for row, facts in zip(r.rows, r.facts):
            old, new = extract_world(row), extract_world({**row, **facts})
            for name, _src in extract.FIELDS:
                self.assertEqual(old[name], new[name], name)

    def test_packet_carries_new_blocks(self):
        r = self.run_
        pkt = make_packet("r1", 16, 1, {**r.rows[-1], **r.facts[-1]}, cities=r.snaps[-1]["cities"], chain=r.snaps[-1]["chain"])
        self.assertEqual(set(pkt), {"v", "run_id", "week", "version", "world", "events", "cities", "chain"})
        self.assertEqual(set(make_packet("r1", 1, 1, r.rows[0])), {"v", "run_id", "week", "version", "world", "events"})   # eski biçim değişmez
        finite_json(pkt)


class FakeWorldCases(unittest.TestCase):
    def test_zero_firms_or_demand_none(self):
        W, P = fake_world(), params_ns()
        facts = probes.world_facts(W, P)
        self.assertIsNone(facts["x_survival_52"])
        self.assertIsNone(facts["x_occupancy"])
        self.assertIsNone(facts["x_loan_rate_avg"])
        self.assertIsNone(facts["x_bond_rate"])
        self.assertIsNone(facts["x_deposit_rate"])
        self.assertIsNone(facts["x_royalty_avg"])
        self.assertIsNone(facts["x_inflation_yoy"])
        self.assertIsNone(facts["x_price_index"])
        self.assertIsNone(facts["x_city_cash_weeks"])
        rows = extract_cities.city_rows(W, P, extract_cities.city_map(W))
        self.assertEqual(len(rows), 2)
        for c in rows:
            self.assertIsNone(c["cash_weeks"])                 # kasa tabanı kuralı kapalı (cexp None)
            self.assertIsNone(c["served"])
            self.assertEqual((c["employed"], c["firms_npc"], c["firms_player"]), (0, 0, 0))
            self.assertIsNone(c["occupancy"])
            self.assertIsNone(c["tenants_per_house"])
        ch = extract_chain.chain_snapshot(W, P)
        self.assertEqual(sum(n["firms"] for n in ch["nodes"]), 0)
        json.dumps({"facts": facts, "rows": rows, "chain": ch}, allow_nan=False)
        w = extract_world(facts)
        for k in ("survival_52", "occupancy", "loan_rate_avg", "bond_rate", "deposit_rate", "royalty_avg", "inflation_yoy", "price_index",
                  "city_cash_weeks", "lonca_fee_avg", "mint_cap", "minted_year"):
            self.assertIsNone(w[k], k)
        for k in ("wage_index", "rent_pct", "house_index"):                 # firmasız da tablolardan okunur
            self.assertIsNotNone(w[k], k)

    def test_city_cash_weeks_fake_world(self):
        W, P = fake_world(), params_ns()
        W.L.cexp = {}
        W.L.mand = {"sehir0": 250.0, "sehir1": 0.0}           # sehir0: 1000 / 250 = 4 hafta; sehir1: gider ölçülmüyor
        rows = extract_cities.city_rows(W, P, None)
        self.assertAlmostEqual(rows[0]["cash_weeks"], 4.0)
        self.assertIsNone(rows[1]["cash_weeks"])
        W.L.mand = {"sehir0": -5.0, "sehir1": 500.0}          # negatif gider sıfır sayılır (toplam ölçüyle aynı kural)
        rows = extract_cities.city_rows(W, P, None)
        self.assertIsNone(rows[0]["cash_weeks"])
        self.assertAlmostEqual(rows[1]["cash_weeks"], 4.0)
        json.dumps(rows, allow_nan=False)

    def test_extract_on_fake_world_does_not_mutate(self):
        W, P = fake_world(), params_ns()
        W.L.cap_on = True
        W.board["prod"]["un"] = dict(want=1.0, short=0.0, short_share=0.0, persist=0.1, stock=0.0, cover=0.0, n_all=1, n_h=1, ptrend=0.0, pidx=1.0, prod=1.0)
        W.PRICE[(0, "un")] = 1.0
        W.REF["un"] = 1.0
        before = deep(W)
        probes.world_facts(W, P)
        extract_cities.city_rows(W, P, extract_cities.city_map(W))
        extract_chain.chain_snapshot(W, P)
        snapshot_equal(self, W, before, "çıkarıcılar (sahte dünya)")

    def test_survival_52_counts_only_old_enough_firms(self):
        W, P = fake_world(week=100), params_ns()
        W.firms = {
            "s0_un_oy1": dict(kind="un", city=0, workers=[], owner="s0_p0", born=10, died=70),       # 60 hafta yaşadı: geçti
            "s0_un_oy2": dict(kind="un", city=0, workers=[], owner="s0_p0", born=20, dead=True, died=40),   # 20 hafta: kaldı
            "s0_un_oy3": dict(kind="un", city=0, workers=[], owner="s0_p0", born=30),                   # hayatta, 70 hafta
            "s0_un_oy4": dict(kind="un", city=0, workers=[], owner="s0_p0", born=80),                   # 20 hafta: pencereye girmez
            "s0_arge_oy5": dict(kind="arge", city=0, workers=[], owner="s0_p0", born=10, dead=True, died=11),   # Ar-Ge sayılmaz
        }
        W.player_firms = [f for f, d in W.firms.items() if not d.get("dead")]      # ölen firma player_firms'ten silinir (week_close); W.firms'te kalır
        self.assertAlmostEqual(probes.world_facts(W, P)["x_survival_52"], 2.0 / 3.0)

    def test_mint_fields_before_and_after_cap_opens(self):
        W, P = fake_world(), params_ns()
        self.assertIsNone(probes.world_facts(W, P)["x_mint_cap"])
        W.L.cap_on = True
        W.mint_allow_tot = 500.0
        W.L.allow["sehir0"], W.L.allow["sehir1"] = 100.0, 150.0
        f = probes.world_facts(W, P)
        self.assertEqual((f["x_mint_cap"], f["x_minted_year"]), (500.0, 250.0))

    def test_rates_weighted_by_outstanding(self):
        W, P = fake_world(), params_ns()
        W.loans = {"f1": dict(out=100.0, rate=0.01), "f2": dict(out=300.0, rate=0.02), "f3": dict(out=0.0, rate=0.5)}
        W.bonds = [dict(out=50.0, rate=0.004), dict(out=150.0, rate=0.008)]
        W.loncas = ["lonca0", "lonca1"]
        W.dep_tot.update({"lonca0": 100.0, "lonca1": 300.0})
        W.dep_ema.update({"lonca0": 0.002, "lonca1": 0.004})
        W.FEES = {"lonca0": 0.04, "lonca1": 0.06, "lonca2": 0.5}
        W.closed = {"lonca2"}
        f = probes.world_facts(W, P)
        self.assertAlmostEqual(f["x_loan_rate_avg"], 0.0175)
        self.assertAlmostEqual(f["x_bond_rate"], 0.007)
        self.assertAlmostEqual(f["x_deposit_rate"], 0.0035)
        self.assertAlmostEqual(f["x_lonca_fee_avg"], 0.05)

    def test_house_fields_follow_flags(self):
        W = fake_world()
        W.hs.update({0: 10.0, 1: 10.0})
        W.occ.update({0: 5.0, 1: 12.0})
        W.RENT_CY = {0: 1.0, 1: 2.0}
        W.WI = {0: 1.0, 1: 2.0}
        W.hratio.update({0: 0.9, 1: 1.1})
        on = probes.world_facts(W, params_ns())
        self.assertAlmostEqual(on["x_occupancy"], 0.75)                  # Σmin(kiracı, konut) / Σkonut: 1'i aşamaz
        self.assertAlmostEqual(on["x_tenants_per_house"], 0.85)           # ham oran
        self.assertAlmostEqual(on["x_house_index"], 100.0 * 1.55 / 0.8)   # ort(kira x ikinci el oranı) / açılış kirası
        self.assertAlmostEqual(on["x_house_resale_ratio"], 1.0)
        self.assertAlmostEqual(on["x_rent_pct"], (1.0 / 10.0 + 2.0 / 20.0) / 2)       # kira / çırak ücreti
        off = probes.world_facts(W, params_ns(HOUSE_ON=False, HI_ACT=False))
        self.assertIsNone(off["x_occupancy"])
        self.assertIsNone(off["x_rent_pct"])
        self.assertIsNone(off["x_house_index"])
        self.assertIsNone(off["x_tenants_per_house"])
        self.assertIsNone(off["x_house_resale_ratio"])
        self.assertIsNotNone(probes.world_facts(W, params_ns(HI_ACT=False))["x_house_index"])    # fiyat endeksi ikinci el piyasası olmadan da kiradan okunur
        self.assertIsNone(probes.world_facts(W, params_ns(HI_ACT=False))["x_house_resale_ratio"])

    def test_inflation_yoy_is_52_week_after_opening(self):
        W, P = fake_world(), params_ns()
        W.weekly = [{"week": i + 1, "series": {"pidx": 100.0 + i}} for i in range(65)]
        self.assertIsNone(probes.world_facts(W, P)["x_inflation_yoy"])            # taban hafta 13: açılış dönemi
        W.weekly = [{"week": i + 1, "series": {"pidx": 100.0 + i}} for i in range(66)]
        self.assertAlmostEqual(probes.world_facts(W, P)["x_inflation_yoy"], 165.0 / 113.0 - 1.0)    # hafta 66 / hafta 14
        W.weekly = W.weekly[:30]
        self.assertIsNone(probes.world_facts(W, P)["x_inflation_yoy"])

    def test_minted_residue_is_zeroed(self):
        W, P = fake_world(), params_ns()
        W.L.cap_on = True
        W.mint_allow_tot = 100.0
        W.L.allow["sehir0"] = 100.0 - 2.3e-13
        f = probes.world_facts(W, P)
        self.assertEqual((f["x_minted_year"], f["x_minted_total"]), (0.0, 0.0))

    def test_dead_npc_firms_not_counted(self):
        W, P = fake_world(), params_ns()
        W.firms = {"a": dict(kind="un", city=0, workers=[], owner=None), "b": dict(kind="un", city=0, workers=[], owner=None, dead=True),
                   "c": dict(kind="un", city=0, workers=[], owner=None, org_owner="x")}
        self.assertEqual(extract_cities.city_rows(W, P, None)[0]["firms_npc"], 1)


class Contract(unittest.TestCase):
    def test_missing_fields_null_in_packets(self):
        ts = re.search(r"export type World = \{(.*?)\n\};", TYPES_TS.read_text("utf-8"), re.S).group(1)
        world_fields = set(re.findall(r"^\s*([a-z_0-9]+)\??:", ts, re.M))
        for name, why in probes.MISSING.items():
            self.assertIn(name, world_fields)
            self.assertIsInstance(why, str)
            self.assertGreater(len(why), 10)
            self.assertIsNone(extract_world({"x_" + name: 1.0, name: 1.0})[name], name)
            self.assertIsNone(extract.make_packet("r", 1, 1, {})["world"][name])
        self.assertTrue(set(probes.MISSING) <= set(extract.NULL_FIELDS))
        self.assertEqual(set(extract.NEW_WORLD_FIELDS), set())      # W6 dört alanı types.ts'e ekledi

    def test_field_set_equals_types_ts(self):
        ts = re.search(r"export type World = \{(.*?)\n\};", TYPES_TS.read_text("utf-8"), re.S).group(1)
        self.assertEqual(set(extract_world({})), set(re.findall(r"^\s*([a-z_0-9]+)\??:", ts, re.M)) | set(extract.NEW_WORLD_FIELDS))

    def test_every_new_field_has_a_source_or_a_reason(self):
        """16 alanın her biri ya x_ olgusuyla beslenir ya da MISSING'te nedenle durur (sessiz null yok)."""
        fed = {name for name, _src in extract.EXTRA_FIELDS}
        for name in NEW_NUMERIC:
            self.assertTrue(name in fed or name in probes.MISSING, name)
        self.assertFalse(fed & set(probes.MISSING))
        self.assertFalse(set(extract.NULL_FIELDS) - set(probes.MISSING))

    def test_static_world_info(self):
        d = {"COAL_CITIES": [0, 3], "GOLD_CITIES": [1, 4], "LIFE_ON": True, "INNOV_ON": True,
             "SPECIAL": ["tarla_bugday", "tarla_seker", "tarla_pamuk", "maden_silika", "maden_aluminyum"] * 5, "PLAYERS_PER_CITY": 300}
        info = extract_cities.static_world_info(d, 5)
        self.assertEqual(len(info["cities"]), 5)
        c0, c1 = info["cities"][0], info["cities"][1]
        self.assertEqual([c["index"] for c in info["cities"]], list(range(5)))
        self.assertTrue(c0["coal"] and not c0["gold"])
        self.assertTrue(c1["gold"] and not c1["coal"])
        self.assertEqual(len(c0["specialties"]), 5)
        self.assertEqual([s["sector"] for s in c0["specialties"]][:2], ["tarla_bugday", "tarla_seker"])
        self.assertTrue(all(s["label"] for s in c0["specialties"]))
        self.assertTrue(any("Kömür" in r["label"] for r in c0["resources"]))
        self.assertTrue(any("Altın" in r["label"] for r in c1["resources"]))
        self.assertTrue(all(abs(c["population_share"] - 0.2) < 1e-12 for c in info["cities"]))     # model: şehir başına eşit oyuncu
        json.dumps(info, allow_nan=False)



@unittest.skipIf(QUICK, "gerçek model, 70 hafta")
class EdgeRevisions(unittest.TestCase):
    """N1: zincir kenarları koşu boyunca değişir (donanım, yazılım, yeşil enerji); paket tarif sürümünü taşır."""

    @classmethod
    def setUpClass(cls):
        # Tarif değişimi mekaniği sınanır, teknoloji hızı değil: v13.2+ dünyasında yazılım açılışı (SW_UNLOCK) 140 haftada bile gelmiyor, bu yüzden eşikler düşürülür.
        cls.run_ = Run(70, {"SW_UNLOCK": 3000.0, "GREEN_K": 15000.0})

    @classmethod
    def tearDownClass(cls):
        cls.run_.close()

    def test_every_set_change_carries_the_new_list(self):
        from tests.registry_helpers import real_defaults
        r = self.run_
        static = extract_cities.static_world_info(real_defaults(), 5)["chain"]["edges"]
        self.assertEqual({(e["from"], e["to"], e["product"]) for e in static}, {(e["from"], e["to"], e["product"]) for e in r.edges0})
        prev, rev = {(e["from"], e["to"], e["product"]) for e in r.edges0}, 0
        known = set(prev)
        changes = 0
        for i, snap in enumerate(r.snaps):
            ch = snap["chain"]
            cur = r.edge_sets[i]
            if cur != prev:
                changes += 1
                self.assertIn("edges", ch, "hafta %d: tarif değişti ama paket yeni listeyi taşımıyor" % (i + 1))
                self.assertEqual({tuple(row) for row in ch["edges"]}, cur, i + 1)
                self.assertTrue(all(len(row) == 3 for row in ch["edges"]))
                self.assertGreater(ch["edges_rev"], rev)
                rev = ch["edges_rev"]
                known = cur
            else:
                self.assertNotIn("edges", ch, "hafta %d: tarif aynı, liste gereksiz" % (i + 1))
                self.assertEqual(ch["edges_rev"], rev)
            prev = cur
        self.assertGreaterEqual(changes, 3, "70 haftada donanım, yazılım ve yeşil enerji değişimleri beklenir")
        self.assertEqual(known, r.edge_sets[-1])

    def test_drawer_reads_same_recipe_as_packets(self):
        r = self.run_
        d = r.host.drawer("sector", "firin")["fields"]
        self.assertEqual({e["from"] for e in d["inputs"]}, {a for a, b, c in r.edge_sets[-1] if b == "firin"})
        W = r.W
        for e in d["inputs"]:                                            # miktar canlı tariften (W.RECIPES)
            self.assertEqual(e["qty"], W.RECIPES["firin"][1][e["product"]])
        import json
        self.assertNotIn('"qty"', json.dumps(r.snaps))                   # paketlerde miktar yok

    def test_packet_size_with_revisions(self):
        import json
        r = self.run_
        sizes = [len(json.dumps(s["chain"], separators=(",", ":"))) for s in r.snaps]
        print("\nzincir blok boyu: ort %d B, en büyük %d B (kenarlı hafta), kenarsız ort %d B" % (
            sum(sizes) / len(sizes), max(sizes), sum(z for z, s in zip(sizes, r.snaps) if "edges" not in s["chain"]) / max(1, sum(1 for s in r.snaps if "edges" not in s["chain"]))))
        self.assertLess(max(sizes), 60000)


if __name__ == "__main__":
    unittest.main()
