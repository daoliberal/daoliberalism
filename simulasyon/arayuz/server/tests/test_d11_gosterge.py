"""D11: para dağılımı (hane / yerleşik işletme / oyuncu işletmesi / kasa / lonca), şehir gelir-gider kalemleri ve hayalet işletme göstergeleri.

Gerçek model testleri OYUN_QUICK ile atlanır; sahte dünya testleri her zaman koşar."""
from __future__ import annotations

import json
import re
import unittest
from collections import defaultdict
from pathlib import Path

from oyun_server.sim import probes
from oyun_server.sim.extract import extract_world, make_packet

from tests.extract_v2_helpers import QUICK, Run, deep, fake_world, params_ns, snapshot_equal

HERE = Path(__file__).resolve().parent
TYPES_TS = HERE.parents[3] / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts"

MONEY = ["money_households", "money_npc_firms", "money_player_firms", "money_city", "money_lonca", "money_other"]
CITY_IN = ["city_in_tax", "city_in_profit", "city_in_rent", "city_in_mint", "city_in_other"]
CITY_OUT = ["city_out_households", "city_out_wages", "city_out_services", "city_out_firms", "city_out_other"]
GHOST = ["ghost_firms", "ghost_closed"]
NEW_WORLD = MONEY + CITY_IN + CITY_OUT + GHOST


def money_world():
    """İki şehir (kasalar 1000 ve 2000), oyuncu 100, NPC 50, yerleşik işletme 30, oyuncu işletmesi 20, belediye 7, lonca sermaye 400 + refah 5, emanet 3."""
    W = fake_world(2)
    ppl = W.people
    ppl["n1"] = dict(tier=0, wage=10, firm="s0_un0", who="npc", city=0)
    W.firms["s0_un0"] = dict(kind="un", city=0, workers=["n1"], owner=None, dead=False, capacity=25)
    W.firms["s0_pl0"] = dict(kind="firin", city=0, workers=[], owner="s0_p0", dead=False, capacity=25)
    W.firms["s0_belediye0"] = dict(kind="belediye", city=0, workers=[], owner=None, dead=False, capacity=100)
    W.firms["s0_org"] = dict(kind="un", city=0, workers=[], owner=None, org_owner=("dao", "d1"), dead=False, capacity=25)
    W.cities[0]["firms"] = list(W.firms)
    W.loncas = ["lo1"]
    W.L.bal.update({"s0_p0": 100.0, "n1": 50.0, "s0_un0": 30.0, "s0_pl0": 20.0, "s0_belediye0": 7.0, "s0_org": 11.0,
                    "lo1_sermaye": 400.0, "lo1_refah": 5.0, "emanet0": 3.0})
    return W, params_ns()


def city_world():
    W, P = money_world()
    W.L.flows.update({"gelir_vergisi": 100.0, "satis_vergisi": 40.0, "kurumlar_vergisi": 5.0, "npc_kar": 300.0, "konut_kirasi_sehir": 70.0, "kira": 8.0,
                      "ucret": 99999.0})
    W.L.city_out = defaultdict(float, {"ciraklik_bursu": 50.0, "issizlik_odenegi": 20.0, "kamu_transferi": 10.0, "belediye_ucreti": 15.0,
                                       "kamu_hizmet_sozlesmesi": 6.0, "altyapi_hizmet_sozlesmesi": 4.0, "npc_kurulus_sermayesi": 9.0,
                                       "kamu_destek_fonu": 1.0, "sehirler_arasi_denge": 777.0, "tahvil_faizi": 2.0})
    W.L.inflow = defaultdict(float, {"sehir0": 300.0, "sehir1": 262.0})
    W.L.fiscal_minted = 12.0
    return W, P


class MoneyDistribution(unittest.TestCase):
    def test_segments_partition_the_money_stock(self):
        W, P = money_world()
        f = probes.money_facts(W, P)
        self.assertEqual(f["x_money_households"], 150.0)                  # oyuncu + NPC nakdi
        self.assertEqual(f["x_money_npc_firms"], 30.0)
        self.assertEqual(f["x_money_player_firms"], 31.0)                 # sahibi oyuncu olan 20 + loncaya bağlı 11
        self.assertEqual(f["x_money_city"], 3003.0)                       # kasalar 3000 + kira emaneti 3 (akış kancasıyla aynı: şehir)
        self.assertEqual(f["x_money_lonca"], 405.0)
        self.assertEqual(f["x_money_other"], 7.0)                         # belediye 7
        self.assertAlmostEqual(sum(f.values()), sum(W.L.bal.values()))
        json.dumps(f, allow_nan=False)

    def test_does_not_mutate(self):
        W, P = money_world()
        before = deep(W)
        probes.money_facts(W, P)
        probes.city_flow_totals(W, P)
        probes.city_inflow_week(W)
        probes.ghost_flow_totals(W, P)
        snapshot_equal(self, W, before, "para dağılımı ölçümleri")

    def test_fields_are_listed_for_world_facts(self):
        W, P = money_world()
        out = probes.world_facts(W, P)
        for k in ("x_" + n for n in MONEY):
            self.assertIn(k, out, k)


class CityBudget(unittest.TestCase):
    def test_cumulative_items(self):
        W, P = city_world()
        t = probes.city_flow_totals(W, P)
        self.assertEqual(t["city_in_tax"], 145.0)                         # gelir + satış + kurumlar vergisi
        self.assertEqual(t["city_in_profit"], 300.0)
        self.assertEqual(t["city_in_rent"], 78.0)                         # konut kirası + kira
        self.assertEqual(t["city_in_mint"], 12.0)
        self.assertEqual(t["city_out_households"], 80.0)                  # burs + işsizlik ödeneği + kamu transferi
        self.assertEqual(t["city_out_wages"], 15.0)
        self.assertEqual(t["city_out_services"], 10.0)
        self.assertEqual(t["city_out_firms"], 10.0)                       # kuruluş sermayesi + destek fonu
        self.assertEqual(t["city_out_other"], 2.0)                        # tahvil faizi; şehirler arası denge hiçbir tarafta sayılmaz
        self.assertNotIn("ucret", " ".join(t))
        self.assertEqual(probes.city_inflow_week(W), 562.0)

    def test_missing_ledger_parts_mean_null(self):
        W, P = money_world()
        del W.L.flows
        self.assertTrue(all(v is None for v in probes.city_flow_totals(W, P).values()))


class HostWeekly(unittest.TestCase):
    """ModelHost._labor_flows: kalemlerin haftalık değeri = birikimli toplamın farkı; diğer gelir = haftalık toplam giriş - adlı kalemler."""

    def _host(self, W, P):
        from oyun_server.sim.host import ModelHost
        h = object.__new__(ModelHost)
        h._W, h._P, h._labor_prev = W, P, {}
        return h

    def test_weekly_differences_and_other_income(self):
        W, P = city_world()
        W.hire_stat = defaultdict(float, hayalet_firma=17, hayalet_kapanan=2)
        h = self._host(W, P)
        o1 = h._labor_flows()
        self.assertEqual((o1["x_city_in_tax"], o1["x_city_in_profit"], o1["x_city_in_rent"], o1["x_city_in_mint"]), (145.0, 300.0, 78.0, 12.0))
        self.assertEqual(o1["x_city_in_other"], 562.0 - 145.0 - 300.0 - 78.0)
        self.assertEqual((o1["x_ghost_firms"], o1["x_ghost_closed"]), (17.0, 2.0))
        W.L.flows["gelir_vergisi"] += 11.0
        W.L.city_out["belediye_ucreti"] += 4.0
        W.hire_stat["hayalet_firma"] += 15
        o2 = h._labor_flows()
        self.assertEqual(o2["x_city_in_tax"], 11.0)
        self.assertEqual(o2["x_city_out_wages"], 4.0)
        self.assertEqual(o2["x_city_out_households"], 0.0)
        self.assertEqual((o2["x_ghost_firms"], o2["x_ghost_closed"]), (15.0, 0.0))

    def test_other_income_never_negative(self):
        W, P = city_world()
        W.L.inflow = defaultdict(float, {"sehir0": 1.0})
        o = self._host(W, P)._labor_flows()
        self.assertEqual(o["x_city_in_other"], 0.0)

    def test_old_model_without_counters_is_null(self):
        W, P = money_world()
        del W.L.flows
        o = self._host(W, P)._labor_flows()
        self.assertIsNone(o["x_city_in_tax"])
        self.assertIsNone(o["x_city_in_other"])
        self.assertIsNone(o["x_ghost_firms"])


class ExtractMapping(unittest.TestCase):
    def test_new_fields_mapped_from_facts(self):
        facts = {("x_" + n): float(i + 1) for i, n in enumerate(NEW_WORLD)}
        w = extract_world({"calisan": "170", "issiz": "8", **facts})
        for i, n in enumerate(NEW_WORLD):
            self.assertEqual(w[n], float(i + 1), n)
        json.dumps(w, allow_nan=False)

    def test_old_rows_have_null_new_fields(self):
        w = extract_world({"calisan": "170", "issiz": "8"})
        for k in NEW_WORLD:
            self.assertIsNone(w[k], k)
        self.assertEqual(set(make_packet("r", 1, 1, {})["world"]) & set(NEW_WORLD), set(NEW_WORLD))

    def test_types_ts_has_new_fields(self):
        body = re.search(r"export type World = \{(.*?)\n\};", TYPES_TS.read_text("utf-8"), re.S).group(1)
        fields = set(re.findall(r"^\s*([a-z_0-9]+)\??:", body, re.M))
        self.assertTrue(set(NEW_WORLD) <= fields, set(NEW_WORLD) - fields)

    def test_field_notes_define_every_new_field_honestly(self):
        for k in NEW_WORLD:
            self.assertIn(k, probes.FIELD_NOTES, k)
            self.assertGreater(len(probes.FIELD_NOTES[k]), 20, k)
        self.assertIn("mevduat", probes.FIELD_NOTES["money_households"])        # mevduat lonca hesabındadır: sınır açıkça yazılı
        self.assertIn("basım", probes.FIELD_NOTES["city_in_mint"])
        self.assertIn("bir kişilik işletme sermayesi", probes.FIELD_NOTES["ghost_firms"])


@unittest.skipIf(QUICK, "gerçek model")
class RealModel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = Run(6)
        cls.idle = Run(6, {"OPEN_MODE": 1, "GHOST_MODE": 2, "GHOST_WEEKS": 2})

    @classmethod
    def tearDownClass(cls):
        cls.base.close()
        cls.idle.close()

    def test_all_new_fields_finite_every_week(self):
        for row, facts in zip(self.base.rows, self.base.facts):
            w = extract_world({**row, **facts})
            for k in NEW_WORLD:
                self.assertIn(k, w, k)
            json.dumps(w, allow_nan=False)
            self.assertTrue(all(w[k] is not None and w[k] >= 0 for k in NEW_WORLD), {k: w[k] for k in NEW_WORLD})

    def test_segments_sum_to_money_total_and_match_the_model_columns(self):
        for row, facts in zip(self.base.rows, self.base.facts):
            seg = [facts["x_" + n] for n in MONEY]
            self.assertAlmostEqual(sum(seg), float(row["para_toplam"]), delta=8.0)
            self.assertAlmostEqual(facts["x_money_households"], row["para_yoksul"] + row["para_orta"] + row["para_zengin"] + row["para_npc_hane"], delta=4.0)
            self.assertAlmostEqual(facts["x_money_npc_firms"], row["para_firma_npc"], delta=1.0)
            self.assertAlmostEqual(facts["x_money_player_firms"], row["para_firma_oyuncu"], delta=1.0)
            self.assertAlmostEqual(facts["x_money_city"], row["para_sehir"], delta=1.0)
            self.assertAlmostEqual(facts["x_money_lonca"], row["para_lonca_sermaye"] + row["para_lonca_refah"] + row["para_lonca_rezerv"] + row["para_lonca_diger"], delta=4.0)

    def test_city_items_add_up_to_ledger_totals(self):
        L = self.base.W.L
        weeks = len(self.base.facts)
        out_names = ("households", "wages", "services", "firms", "other")
        out_sum = sum(f["x_city_out_" + n] for f in self.base.facts for n in out_names)
        self.assertAlmostEqual(out_sum, sum(L.city_out.values()) - L.city_out["sehirler_arasi_denge"], places=4)
        mint = sum(f["x_city_in_mint"] for f in self.base.facts)
        self.assertAlmostEqual(mint, L.fiscal_minted, places=4)
        self.assertGreater(sum(f["x_city_in_profit"] for f in self.base.facts), 0)
        self.assertEqual(weeks, 6)

    def test_ghosts_are_counted_and_closed_firms_are_reported(self):
        last = self.base.facts[-1]
        self.assertGreater(last["x_ghost_firms"], 0)                      # küçük dünyada çok işletme işçisiz
        self.assertEqual(sum(f["x_ghost_closed"] for f in self.base.facts), 0)       # varsayılanda kapanış yok
        self.assertGreater(sum(f["x_ghost_closed"] for f in self.idle.facts), 0)
        W = self.idle.W
        self.assertAlmostEqual(sum(W.L.bal.values()), W.L.minted, places=4)

    def test_default_run_creates_no_ghost_state(self):
        self.assertTrue(all("ghost" not in d and "tsup_miss" not in d for d in self.base.W.firms.values()))


@unittest.skipIf(QUICK, "gerçek model")
class NewPlayerMoneyIsNotCityMint(unittest.TestCase):
    """Son inceleme I3: yeni oyunculara verilen başlangıç parası şehir kasası basımı (`city_in_mint`) sayılmaz."""

    @classmethod
    def setUpClass(cls):
        cls.mrun = Run(5, {"PLAYER_INFLOW": 2})

    @classmethod
    def tearDownClass(cls):
        cls.mrun.close()

    def test_city_mint_counts_only_city_account_top_ups(self):
        W = self.mrun.W
        city_mint = sum(f["x_city_in_mint"] for f in self.mrun.facts)
        top_ups = sum(v for k, v in W.L.flows.items() if k.startswith("basim:"))
        self.assertAlmostEqual(city_mint, top_ups, places=4)

    def test_new_player_money_is_recorded_separately_and_money_is_conserved(self):
        W = self.mrun.W
        start = W.hire_stat["baslangic_parasi_basim"]
        self.assertGreater(start, 0.0)                                   # PLAYER_INFLOW=2: yeni oyuncular geldi ve basımla para aldı
        self.assertAlmostEqual(W.L.fiscal_minted, start + sum(v for k, v in W.L.flows.items() if k.startswith("basim:")), places=4)
        self.assertAlmostEqual(sum(W.L.bal.values()), W.L.minted, places=4)

    def test_field_note_says_what_is_excluded(self):
        self.assertIn("başlangıç", probes.FIELD_NOTES["city_in_mint"])


class PanoDogrulukTests(unittest.TestCase):
    """F1 (para devresi): pano doğruluğu. Toplam batan dört sayacın toplamıdır; 52 haftalık sağkalım ölü oyuncu işletmelerini de paydada sayar."""

    def test_failed_total_cum_dort_sayacin_toplami(self):
        w = extract_world({"batan_kum": 3, "x_failed_player_cum": 5, "x_failed_dao_cum": 1, "x_failed_npc_default_cum": 2})
        self.assertEqual(w["failed_total_cum"], 11)
        self.assertEqual(w["failed_cum"], 3)                                   # eski alan anlamıyla kalır

    def test_failed_total_cum_eski_kayitta_null(self):
        self.assertIsNone(extract_world({"batan_kum": 3})["failed_total_cum"])
        self.assertIsNone(extract_world({"batan_kum": 3, "x_failed_player_cum": 5, "x_failed_dao_cum": 1})["failed_total_cum"])
        self.assertIsNone(extract_world({})["failed_total_cum"])

    def test_survival_52_olenler_paydada(self):
        W = fake_world(week=100)
        W.firms = {
            "s0_un_oy1": dict(kind="un", city=0, workers=[], owner="s0_p0", born=0),                               # canlı, yaş 100
            "s0_un_oy2": dict(kind="un", city=0, workers=[], owner="s0_p0", born=20),                              # canlı, yaş 80
            "s0_un_oy3": dict(kind="un", city=0, workers=[], owner="s0_p0", born=0, dead=True, died=60),           # 60. haftasında öldü: geçti
            "s0_un_oy4": dict(kind="un", city=0, workers=[], owner="s0_p0", born=0, dead=True, died=10),           # 10. haftasında öldü: kaldı
        }
        W.player_firms = ["s0_un_oy1", "s0_un_oy2"]                            # ölenler player_firms'ten silinmiştir
        self.assertAlmostEqual(probes._survival_52(W), 0.75)

    def test_job_serileri_yeni_tanim_anahtarlari_ve_eskiler(self):
        from oyun_server.jobs.manager import SERIES
        for k in ("served", "failed_cum", "city_cash_total", "gini", "unemployment_rate", "failed_total_cum", "unemployment_rate_all"):
            self.assertIn(k, SERIES)
        w = extract_world({"batan_kum": 3, "x_failed_player_cum": 5, "x_failed_dao_cum": 1, "x_failed_npc_default_cum": 2, "calisan": 80, "issiz": 10, "x_npc_pool": 10})
        self.assertEqual([w[k] for k in ("failed_total_cum", "unemployment_rate_all")], [11, 20 / 100])
        self.assertTrue(all(k in w for k in SERIES))

    def test_survival_52_oy_alt_dizesi_eslesmez(self):
        W = fake_world(week=100)
        W.firms = {"s0_koy_x1": dict(kind="un", city=0, workers=[], owner=None, born=0, dead=True, died=5)}      # adında "_oy" geçen ama kimlik kalıbına uymayan
        self.assertIsNone(probes._survival_52(W))

    def test_survival_52_npc_kimlikli_firma_sayilmaz(self):
        W = fake_world(week=100)
        W.firms = {"s0_un0": dict(kind="un", city=0, workers=[], owner=None, born=0, dead=True, died=5)}
        self.assertIsNone(probes._survival_52(W))


if __name__ == "__main__":
    unittest.main()
