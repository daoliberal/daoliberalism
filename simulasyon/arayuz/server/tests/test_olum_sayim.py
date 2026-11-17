"""PLAN-KREDI T3: firma ölüm sayımları (c) ve B6 kurucu tanısı.

`failed_cum` anlamı korunur (yerleşik işletme iflası: `npc_batis_adet`); eksik sayımlar yeni alanlara girer: `failed_player_cum` (oyuncu işletmesi),
`failed_dao_cum` (Ar-Ge DAO), `failed_npc_default_cum` (yerleşik işletme temerrüt ölümü). Sahte dünya testleri her zaman koşar; gerçek model
testleri OYUN_QUICK ile atlanır (26 hafta ~16 sn)."""
from __future__ import annotations

import json
import re
import unittest
from collections import defaultdict
from pathlib import Path

from oyun_server import config
from oyun_server.sim import credit, extract, probes
from oyun_server.sim.extract import extract_world
from oyun_server.sim.host import ModelHost

from tests.extract_v2_helpers import QUICK, deep, snapshot_equal
from tests.test_credit_kayit import ROW, credit_world, leaves
from tests.test_holdings_para import stepped

# Varsayılan dünyada 26 haftada oyuncu işletmesi ve yerleşik işletme ölümü yoktur (kuruluş geç başlar, NPC_GRACE 26 hafta); kapılar gevşetilir ki ölümler doğsun.
STRESS = {"FOUND_WEEK": 1, "FOUND_HARC": 0, "FOUND_WORKED": 1, "FOUND_BUF": 1.0, "NPC_GRACE": 0, "NPC_DIE_WEEKS": 2}
NEW = ("failed_player_cum", "failed_dao_cum", "failed_npc_default_cum")
HERE = Path(__file__).resolve()


def dead_players(W) -> int:
    """Ölü oyuncu işletmesi: kimliği `_oy` taşıyan, sahibi olan ölü firma (Ar-Ge DAO ve yerleşik işletme değil)."""
    dao = set(W.dao_all)
    return sum(1 for n, d in W.firms.items() if d.get("dead") and "_oy" in n and n not in dao)


def dead_npc(W) -> int:
    return sum(1 for d in W.firms.values() if d.get("dead") and d["owner"] is None and d["kind"] not in ("ahir", "belediye"))


class CumDeaths(unittest.TestCase):
    def test_values_by_hand(self):
        W, P = credit_world()
        W.L.flows["batan_dao_adet"] = 2
        self.assertEqual(credit.cum_deaths(W), {"player": 6, "dao": 2, "npc_default": 2})        # npc_log: 2 temerrüt, 1 batış, 1 canlandı

    def test_probe_facts(self):
        W, P = credit_world()
        W.L.flows["batan_dao_adet"] = 2
        W.loncas = ["a", "b", "c", "d", "e", "f"]
        f = probes.credit_facts(W, P, ROW)
        self.assertEqual((f["x_failed_player_cum"], f["x_failed_dao_cum"], f["x_failed_npc_default_cum"]), (6, 2, 2))
        self.assertEqual(f["x_founders_applied"], 3)
        f = probes.credit_facts(W, P, None)                                                      # satır yok: kurucu null, ölüm sayıları satırdan bağımsız
        self.assertIsNone(f["x_founders_applied"])
        self.assertEqual(f["x_failed_player_cum"], 6)

    def test_old_or_broken_world_gives_null(self):
        from tests.extract_v2_helpers import fake_world, params_ns
        W = fake_world(1)
        del W.L.flows
        self.assertEqual(credit.cum_deaths(W), {"player": None, "dao": None, "npc_default": None})
        W2, P = credit_world()
        del W2.npc_log
        self.assertEqual(credit.cum_deaths(W2)["npc_default"], None)
        self.assertEqual(credit.cum_deaths(W2)["player"], 6)
        W3, P = credit_world()
        W3.loncas = ["a"]
        W3.L = None
        self.assertEqual(probes.credit_facts(W3, P, None)["x_failed_player_cum"], None)           # hata düşürmez

    def test_failed_cum_unchanged(self):
        """`failed_cum` hâlâ yalnız modelin `batan_kum` sütunu (yerleşik işletme iflası); yeni alanlar ayrı."""
        self.assertIn(("failed_cum", "batan_kum"), extract.FIELDS)
        w = extract_world({"batan_kum": 81, "x_failed_player_cum": 918, "x_failed_dao_cum": 3, "x_failed_npc_default_cum": 12})
        self.assertEqual((w["failed_cum"], w["failed_player_cum"], w["failed_dao_cum"], w["failed_npc_default_cum"]), (81, 918, 3, 12))
        w = extract_world({"batan_kum": 81})                                                      # eski kayıt: yeni alanlar null, failed_cum aynı
        self.assertEqual(w["failed_cum"], 81)
        self.assertTrue(all(w[k] is None for k in NEW))
        aktar = HERE.parents[2] / "export" / "kayit_aktar.py"
        if aktar.is_file():                                                                       # açık depoda kayıt üretim aracı (export/) yok
            self.assertIn('("failed_cum", "batan_kum")', aktar.read_text(encoding="utf-8"))
        mod = (HERE.parents[3] / "kagit-ustu" / "modulerlestirme" / "simkit" / "measure.py").read_text(encoding="utf-8")
        self.assertIn('batan_kum=_fl.get("npc_batis_adet", 0)', mod)                              # model tarafı: yalnız npc_batis_adet

    def test_notes(self):
        n = probes.FIELD_NOTES
        self.assertIn("yerleşik işletme iflası", n["failed_cum"].lower())
        self.assertIn("BİRİKİMLİ", n["failed_cum"])
        self.assertIn("hariç", n["failed_cum"])
        for k in NEW:
            self.assertIn(k, n)
            self.assertIn("BİRİKİMLİ", n[k])
        self.assertIn("batan_oyuncu_firmasi_adet", n["failed_player_cum"])
        self.assertIn("emerrüt", n["failed_npc_default_cum"])
        self.assertIn("`npc_default`", credit.NOTES["deaths"])

    def test_types_ts_has_fields(self):
        ts = (HERE.parents[4] / "apps" / "web" / "src" / "oyun" / "sim" / "types.ts").read_text(encoding="utf-8")
        for k in NEW:
            self.assertRegex(ts, re.compile(r"^\s*%s\?: number \| null;" % k, re.M))


class DeathsBlock(unittest.TestCase):
    def test_deaths_deltas_sum(self):
        """Haftalık `deaths.player` / `dao` / `npc_default` farklarının toplamı = birikimli sayaç (ilk hafta tabana alınır)."""
        W, P = credit_world(week=1)
        W.L.flows["batan_dao_adet"] = 1
        base = prev = credit.totals(W, P)
        c0 = credit.cum_deaths(W)
        total = defaultdict(int)
        for w in range(2, 14):
            W.week_no = w
            W.L.flows["batan_oyuncu_firmasi_adet"] += w % 3
            W.L.flows["batan_dao_adet"] += w % 2
            W.L.flows["npc_batis_adet"] += w % 4
            if w % 3 == 0:
                W.npc_log.append((w, 0, "un", "temerrut"))
            cur = credit.totals(W, P)
            d = credit.build(W, P, ROW, prev, cur)["deaths"]
            for k in ("player", "dao", "npc_default", "npc_fail"):
                self.assertIsNotNone(d[k], k)
                total[k] += d[k]
            prev = cur
        c1 = credit.cum_deaths(W)
        self.assertEqual(total["player"], c1["player"] - c0["player"])
        self.assertEqual(total["dao"], c1["dao"] - c0["dao"])
        self.assertEqual(total["npc_default"], c1["npc_default"] - c0["npc_default"])
        self.assertEqual(total["npc_fail"], cur["deaths.npc_fail"] - base["deaths.npc_fail"])
        self.assertEqual((cur["deaths.player"], cur["deaths.dao"], cur["deaths.npc_default"]), (c1["player"], c1["dao"], c1["npc_default"]))

    def test_cum_deaths_pure(self):
        W, P = credit_world()
        W.L.flows["batan_dao_adet"] = 1
        before = deep(W)
        n_flows = len(W.L.flows)
        credit.cum_deaths(W)
        probes.credit_facts(W, P, ROW)
        snapshot_equal(self, W, before, "cum_deaths")
        self.assertEqual(len(W.L.flows), n_flows)                                                 # defaultdict'e anahtar eklenmedi

    def test_chan_fund_count(self):
        """Kontrol ruling: fon kredisi (`kredi_fon_adet`) kanal sayısı; yalnız genç firma kanalının ret sayacı var (NOTES)."""
        W, P = credit_world()
        prev = credit.totals(W, P)
        W.week_no += 1
        W.L.flows["kredi_fon_adet"] += 3
        b = credit.build(W, P, ROW, prev)
        self.assertEqual(b["chan"]["fund"], 3)
        self.assertEqual(set(b["chan"]), set(credit.CHAN) | {"young_rej"})
        self.assertIn("fund", credit.CHAN)
        self.assertIn("`fund`", credit.NOTES["chan"])
        self.assertRegex(credit.NOTES["chan"], r"yalnız genç firma kanalının ret sayacı")
        first = credit.build(W, P, ROW, None)
        self.assertIsNone(first["chan"]["fund"])                                                  # ilk hafta null (U3)


class TanisArac(unittest.TestCase):
    def test_module_api(self):
        import tools_tani_kurucu as tk
        self.assertTrue(callable(tk.run))
        self.assertTrue(callable(tk.render))
        # faz adları modelin PHASES sırasıyla aynı olmak zorunda: araç çalıştırırken denetler (burada yalnız ad listesi biçimi)
        self.assertEqual(len(tk.PHASE_ARGS), 18)

    def test_state_labels(self):
        import tools_tani_kurucu as tk
        self.assertEqual(set(tk.STATES), {"is_ariyor", "baska_firma", "sehir_degisti", "kayip"})
        self.assertEqual(tk.classify_state(firm=None, fname="f", seeking=True, moved=False), "is_ariyor")
        self.assertEqual(tk.classify_state(firm="g", fname="f", seeking=False, moved=False), "baska_firma")
        self.assertEqual(tk.classify_state(firm=None, fname="f", seeking=False, moved=True), "sehir_degisti")
        self.assertEqual(tk.classify_state(firm=None, fname="f", seeking=False, moved=False), "kayip")


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModel(unittest.TestCase):
    WEEKS = 26

    @classmethod
    def setUpClass(cls):
        cls.host = ModelHost(str(config.MODEL_ROOT), dict(STRESS), 200)
        cls.packets = stepped(cls.host, cls.WEEKS, True)

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_failed_player_matches_firms(self):
        W = self.host._W
        w = extract_world(self.packets[-1]["row"])
        self.assertGreater(dead_players(W), 0, "sınama boş: oyuncu işletmesi ölümü yok")
        self.assertGreater(w["failed_dao_cum"], 0, "sınama boş: DAO ölümü yok")
        self.assertEqual(w["failed_player_cum"], dead_players(W))
        self.assertEqual(w["failed_player_cum"], W.L.flows["batan_oyuncu_firmasi_adet"])
        self.assertEqual(w["failed_dao_cum"], sum(1 for n in W.dao_all if W.firms[n].get("dead")))

    def test_npc_dead_reconcile(self):
        """Yerleşik işletme: iflas + temerrüt ölümü - yeniden açılan = ölü yerleşik işletme (26. hafta sonunda)."""
        W = self.host._W
        w = extract_world(self.packets[-1]["row"])
        self.assertEqual(w["failed_cum"] + w["failed_npc_default_cum"] - W.L.flows["npc_canlandirma_adet"], dead_npc(W))
        self.assertGreater(w["failed_cum"], 0, "sınama boş: yerleşik işletme iflası yok")
        log = [e[3] for e in W.npc_log]
        self.assertEqual(log.count("battı"), w["failed_cum"])
        self.assertEqual(log.count("temerrut"), w["failed_npc_default_cum"])
        self.assertEqual(log.count("canlandi"), W.L.flows["npc_canlandirma_adet"])

    def test_failed_cum_unchanged_real(self):
        for p in self.packets:
            self.assertEqual(extract_world(p["row"])["failed_cum"], p["row"]["batan_kum"])
        self.assertEqual(self.packets[-1]["row"]["batan_kum"], self.host._W.L.flows["npc_batis_adet"])

    def test_deaths_deltas_sum_real(self):
        total = defaultdict(int)
        for p in self.packets[1:]:
            d = p["credit"]["deaths"]
            for k in ("player", "dao", "npc_default"):
                self.assertIsNotNone(d[k], k)
                total[k] += d[k]
        first, last = extract_world(self.packets[0]["row"]), extract_world(self.packets[-1]["row"])
        self.assertEqual(total["player"], last["failed_player_cum"] - first["failed_player_cum"])
        self.assertEqual(total["dao"], last["failed_dao_cum"] - first["failed_dao_cum"])
        self.assertEqual(total["npc_default"], last["failed_npc_default_cum"] - first["failed_npc_default_cum"])
        self.assertGreater(total["player"], 0)

    def test_fund_channel_real(self):
        self.assertTrue(all(p["credit"]["chan"]["fund"] is not None for p in self.packets[1:]))
        self.assertTrue(json.dumps(self.packets[-1]["credit"], allow_nan=False))

    def test_credit_size_still_in_budget(self):
        sizes = [len(json.dumps(p["credit"], separators=(",", ":"), ensure_ascii=False).encode("utf-8")) for p in self.packets]
        self.assertLessEqual(sum(sizes) / len(sizes), 1150, sizes)


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class PhaseEquivalence(unittest.TestCase):
    def test_phases_equal_week_step(self):
        """Faz faz çağrı `week_step` ile özdeş: `wk_csv`, `L.flows`, `L.events` (sahibin tarifinde 26 hafta araç çıktısıdır; burada gevşek kuruluş kapılarıyla 8 hafta)."""
        import tools_tani_kurucu as tk
        res = tk.run(dict(STRESS), 8, seed=20261106, check=True)
        self.assertTrue(res["equal"], res["diff"])
        self.assertGreater(len(res["rows"]), 0)                                                  # kuruluş haftası kayıtları var
        self.assertTrue(all(r["left_phase"] is None or r["state"] in tk.STATES for r in res["rows"]))


if __name__ == "__main__":
    unittest.main()
