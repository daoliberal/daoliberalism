"""PLAN-TAKIP T4: kesimden kesime akış (`holdings.flows`, `sim/flowhook.py`).

Ölçüm yolu KANCA'dır (Adım 0: 3 x 20 hafta medyan süre oranı <= 1,08; ölçüm `scratchpad/cost.py`, sonuç rapor ve `holdings.NOTES["flows"]`'ta).
Kanca modelin kendi teşhis kancasıdır (`Ledger.sx` + `L.secfn`); host kurar. Sahte dünya testleri her zaman koşar; gerçek model testleri OYUN_QUICK ile kısalır."""
from __future__ import annotations

import contextlib
import io
import json
import os
import random
import shutil
import statistics
import time
import unittest
from collections import defaultdict

from oyun_server import config
from oyun_server.sim import flowhook, holdings
from oyun_server.sim.extract import extract_world
from oyun_server.sim.host import ModelHost

from tests.extract_v2_helpers import QUICK, deep, same, snapshot_equal
from tests.test_holdings_lonca import PERSON_ID
from tests.test_holdings_para import holdings_world, owner_recipe_overrides, rng_states, size, state_of, stepped


def hooked_world(scale: float = 1.0):
    """T1 sahte dünyası + kurulu kanca. Sahte `L.pay`, `Ledger.pay`ın kanca satırını (`ledger.py:94-95`) aynen yapar; gerçek `pay` gerçek model testlerindedir."""
    W, P = holdings_world(scale)
    W.L.city_accounts = {c["acct"] for c in W.cities}
    W.L.sx = None
    W.L.secfn = None
    flowhook.install(W)
    L = W.L

    def pay(frm, to, amt, kind):
        L.bal[frm] -= amt
        L.bal[to] += amt
        L.sx[(L.secfn(frm), L.secfn(to), kind)] += amt
        return amt
    L.pay = pay
    return W, P


def end_week(W):
    """`measure.py:90-94` hafta sonu: matris boşaltılır (`KesimMatrisi.clear` içeriği `last`'a koyar), host `take` + `rebuild` yapar."""
    W.L.sx.clear()
    cells = flowhook.take(W)
    flowhook.rebuild(W)
    return cells


class Classification(unittest.TestCase):
    def test_segments_of_every_account_type(self):
        W, P = hooked_world()
        W.L.bal["sig0_rezerv"] = 1.0
        seg = W.L.secfn
        want = {"s0_p0": "players", "n_emp": "npcs", "s0_un0": "npc_firms", "s0_pl0": "player_firms", "s0_dao": "player_firms",
                "s0_belediye0": "public_firms", "s0_ahir0": "public_firms", "sehir0": "city", "lonca0_sermaye": "lonca", "lonca0_refah": "lonca",
                "KFON0_sermaye": "found_fund", "sig0_rezerv": "insurance", "emanet0": "city", "s1_dead": "player_firms"}
        for a, s in want.items():
            self.assertEqual(seg(a), s, a)
        self.assertEqual(seg("lonca1_yeni_hesap"), "lonca")               # hafta içinde açılan hesabı `__missing__` sınıflar
        self.assertEqual(seg("bilinmeyen"), "other")
        self.assertTrue(set(want.values()) <= set(flowhook.SEGMENTS))

    def test_emanet_is_city(self):
        """PLAN-KREDI S2a: kira emanet hesabı `emanet<i>` şehir sayılır; hane kirası players -> city olarak görünür, emanet -> city kesim içidir (yazılmaz)."""
        W, P = hooked_world()
        for a in ("emanet0", "emanet1", "emanet12"):
            self.assertEqual(W.L.secfn(a), "city", a)
        W.L.pay("s0_p0", "emanet0", 40.0, "konut_kirasi")
        W.L.pay("emanet0", "sehir0", 40.0, "konut_kirasi_sehir")
        W.L.pay("emanet0", "s0_p1", 15.0, "konut_kira_geliri")               # ev sahibine giden kira: city -> players
        self.assertEqual(end_week(W), [["players", "city", 40], ["city", "players", 15]])

    def test_kpay_yenileme_classified(self):
        """PLAN-KREDI S2a: `KPAY<i>` (NPC kâr payı havuzu) npc_firms; `<firma>_yenileme` firmanın kesimi (sahiplik değişince bir sonraki haftada yenilenir)."""
        W, P = hooked_world()
        seg = W.L.secfn
        self.assertEqual(seg("KPAY0"), "npc_firms")
        self.assertEqual(seg("KPAY3"), "npc_firms")
        self.assertEqual(seg("s0_un0_yenileme"), "npc_firms")
        self.assertEqual(seg("s0_pl0_yenileme"), "player_firms")
        self.assertEqual(seg("s0_belediye0_yenileme"), "public_firms")
        self.assertEqual(seg("olmayan_firma_yenileme"), "other")                # firması olmayan ad sınıflanamaz
        W.firms["s0_un0"]["owner"] = "s0_p4"                                    # özelleşme
        flowhook.rebuild(W)
        self.assertEqual(W.L.secfn("s0_un0_yenileme"), "player_firms")

    def test_matches_probes_money_facts_partition(self):
        """Kesim haritası, `probes.money_facts` bölüşümüyle uyumlu: hane = players + npcs, yerleşik = npc_firms, oyuncu işletmesi = player_firms, şehir = city."""
        from oyun_server.sim import probes
        W, P = hooked_world()
        f = probes.money_facts(W, P)
        tot = defaultdict(float)
        for a, v in W.L.bal.items():
            tot[W.L.secfn(a)] += v
        self.assertAlmostEqual(tot["players"] + tot["npcs"], f["x_money_households"])
        self.assertAlmostEqual(tot["npc_firms"], f["x_money_npc_firms"])
        self.assertAlmostEqual(tot["player_firms"], f["x_money_player_firms"])
        emanet = sum(v for a, v in W.L.bal.items() if a.startswith("emanet"))
        self.assertGreater(emanet, 0)
        self.assertAlmostEqual(tot["city"], f["x_money_city"])                        # kanca ve `money_facts` kira emanetini aynı biçimde şehir sayar (PLAN-KREDI S2a, T2)
        self.assertAlmostEqual(tot["lonca"] + tot["found_fund"] + tot["insurance"], f["x_money_lonca"])
        self.assertAlmostEqual(tot["public_firms"] + tot["other"], f["x_money_other"])

    def test_rebuild_follows_ownership_change(self):
        W, P = hooked_world()
        self.assertEqual(W.L.secfn("s0_un0"), "npc_firms")
        W.firms["s0_un0"]["owner"] = "s0_p4"                              # özelleşme: sahip değişti
        self.assertEqual(W.L.secfn("s0_un0"), "npc_firms")                # hafta içinde eski kesim (NOTES)
        flowhook.rebuild(W)
        self.assertEqual(W.L.secfn("s0_un0"), "player_firms")


class MevduatSplit(unittest.TestCase):
    def test_mevduat_sources_split(self):
        """Aynı tür (`mevduat`) iki kaynaktan gelir: oyuncudan ve sigorta rezervinden. Tür eşlemesi bunları karıştırırdı; kanca ayırır."""
        W, P = hooked_world()
        W.L.pay("s0_p0", "lonca0_sermaye", 70.0, "mevduat")
        W.L.pay("sig0_rezerv", "lonca0_sermaye", 30.0, "mevduat")
        W.L.pay("s0_p1", "lonca0_sermaye", 20.0, "mevduat")
        cells = end_week(W)
        self.assertEqual({(a, b): v for a, b, v in cells}, {("players", "lonca"): 90, ("insurance", "lonca"): 30})

    def test_inside_segment_cells_not_written(self):
        W, P = hooked_world()
        W.L.pay("s0_p0", "s0_p1", 5.0, "hediye")                         # hane -> hane: kesim içi
        W.L.pay("s0_un0", "s0_pl0", 7.0, "satis")
        self.assertEqual(end_week(W), [["npc_firms", "player_firms", 7]])


class MintSource(unittest.TestCase):
    def test_mint_source(self):
        W, P = hooked_world()
        W.L.sx[("basim", "sehir", "basim")] += 250.0                     # `Ledger.settle` (ledger.py:152): şehir basımı
        W.L.cm_mint = 40.0                                                # kredi parası basımı (`L.cm_mint` kümülatif)
        cells = end_week(W)
        self.assertEqual(sorted(cells), [["mint", "city", 250], ["mint", "lonca", 40]])
        self.assertEqual(end_week(W), [])                                 # sonraki hafta: fark yok, matris boş
        W.L.cm_mint = 55.0
        self.assertEqual(end_week(W), [["mint", "lonca", 15]])            # haftalık FARK

    def test_install_initial_cm_mint_not_counted(self):
        W, P = holdings_world()
        W.L.city_accounts = set()
        W.L.sx = W.L.secfn = None
        W.L.cm_mint = 900.0                                               # kancadan önceki kümülatif basım yeni haftanın akışı değildir
        flowhook.install(W)
        self.assertEqual(end_week(W), [])


class TopCells(unittest.TestCase):
    def test_top_cells_plus_rest(self):
        W, P = hooked_world()
        segs = [s for s in flowhook.SEGMENTS if s != "mint"]
        pairs = [(a, b) for a in segs for b in segs if a != b]
        self.assertGreater(len(pairs), 30)
        amounts = {}
        for k, (a, b) in enumerate(pairs[:40]):
            amounts[(a, b)] = 1000 + 37 * k
            W.L.sx[(a, b, "x")] += amounts[(a, b)] / 2                    # iki tür: toplanır
            W.L.sx[(a, b, "y")] += amounts[(a, b)] / 2
        cells = end_week(W)
        n = flowhook.TOP_CELLS
        self.assertEqual(len(cells), n + 1)
        top = sorted(amounts.items(), key=lambda kv: -kv[1])
        self.assertEqual([tuple(c[:2]) for c in cells[:n]], [k for k, _ in top[:n]])
        self.assertEqual(cells[n], ["rest", "rest", sum(v for _, v in top[n:])])
        self.assertEqual(sum(c[2] for c in cells), sum(amounts.values()))

    def test_rest_row(self):
        """PLAN-KREDI S2b: kalan satır `["rest","rest",x]`; `rest` bir kesim değildir, `other` kesimi ise yalnız gerçek sınıflanamayan hesaptır."""
        self.assertNotIn("rest", flowhook.SEGMENTS)
        W, P = hooked_world()
        W.L.sx[("players", "city", "x")] += 100.0
        W.L.sx[("other", "city", "x")] += 7.0                              # gerçek "other" hücresi, kalan satırından ayrı kalır
        cells = end_week(W)
        self.assertEqual(cells, [["players", "city", 100], ["other", "city", 7]])
        self.assertFalse(any(c[0] == "rest" for c in cells))

    def test_under_limit_has_no_other_row(self):
        W, P = hooked_world()
        W.L.sx[("players", "city", "vergi")] += 5.4
        W.L.sx[("city", "players", "odenek")] += 0.2                      # yuvarlayınca 0: yazılmaz
        self.assertEqual(end_week(W), [["players", "city", 5]])


class Purity(unittest.TestCase):
    def test_install_touches_only_the_hook_and_build_is_pure(self):
        W, P = holdings_world()
        W.L.city_accounts = set()
        W.L.sx = W.L.secfn = None
        before = deep(W)
        flowhook.install(W)
        self.assertTrue(flowhook.installed(W))
        sx, fn = W.L.sx, W.L.secfn
        W.L.sx = W.L.secfn = None                                          # model durumu: kancadan başka alan değişmedi
        snapshot_equal(self, W, before, "flowhook.install")
        W.L.sx, W.L.secfn = sx, fn
        W.L.sx[("players", "city", "vergi")] += 9.0
        end_week(W)
        after = deep(W)
        h = holdings.build(W, P)
        holdings.flows(W)
        snapshot_equal(self, W, after, "holdings.build (flows ile)")
        self.assertEqual(h["flows"], [["players", "city", 9]])
        json.dumps(h, allow_nan=False)

    def test_no_hook_no_flows_section(self):
        W, P = holdings_world()
        self.assertNotIn("flows", holdings.build(W, P))
        W.L.sx = flowhook.KesimMatrisi()                                   # kurulu ama henüz hafta alınmadı
        self.assertNotIn("flows", holdings.build(W, P))

    def test_no_person_ids_and_notes(self):
        W, P = hooked_world()
        W.L.pay("s0_p0", "lonca0_sermaye", 70.0, "mevduat")
        end_week(W)
        h = holdings.build(W, P)
        self.assertIsNone(PERSON_ID.search(json.dumps(h["flows"])))
        self.assertIn("flows", holdings.NOTES)
        self.assertIn("KANCA", holdings.NOTES["flows"])
        for s in flowhook.SEGMENTS:
            self.assertIn(s, holdings.NOTES["flows"], s)


class Size(unittest.TestCase):
    def test_worst_case_block(self):
        """§7: en kötü blok <= 3.000 bayt: 9 lonca, TOP_CELLS + 1 akış satırı, bütün gruplar dolu, 7 basamaklı tutarlar."""
        W, P = hooked_world(scale=1e5)
        W.loncas = [f"lonca{i}" for i in range(9)]
        W.FEES = {lo: 0.0725 for lo in W.loncas}
        for lo in W.loncas:
            W.L.bal[f"{lo}_sermaye"] = 9_876_543.0
            W.dep_tot[lo] = 9_876_543.0
        W.closed = {"lonca5"}
        segs = [s for s in flowhook.SEGMENTS if s != "mint"]
        for k, (a, b) in enumerate([(a, b) for a in segs for b in segs if a != b][:30]):
            W.L.sx[(a, b, "x")] += 9_000_000.0 + k
        W.L.sx[("basim", "sehir", "basim")] += 1_234_567.0
        cells = end_week(W)
        self.assertEqual(len(cells), flowhook.TOP_CELLS + 1)
        h = holdings.build(W, P)
        self.assertEqual(len(h["loncas"]), 9)
        self.assertLessEqual(size(h["flows"]), 750, size(h["flows"]))
        self.assertLessEqual(size(h), 3000, size(h))


# ---------------------------------------------------------------- gerçek model

def weeks_default() -> int:
    return 5 if QUICK else 26


class RealModelFlows(unittest.TestCase):
    """Varsayılan dünya, kancalı: her hafta `L.pay` sarılır (dönen tutarlar toplanır), .sx/.st boyutu ölçülür."""

    @classmethod
    def setUpClass(cls):
        random.seed(20261106)
        cls.host = h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        L = h._W.L
        cls.paid = [0.0]
        orig = L.pay

        def pay(frm, to, amt, kind):
            r = orig(frm, to, amt, kind)
            cls.paid[0] += r
            return r
        L.pay = pay
        cls.weeks = []
        cls.packets = []
        sx = os.path.join(h._csv_dir, "w.csv.sx")
        st = os.path.join(h._csv_dir, "w.csv.st")
        prev_f0, prev_cm = dict(L.flows), float(getattr(L, "cm_mint", 0.0) or 0.0)
        sizes = (0, 0)
        for _ in range(weeks_default()):
            cls.paid[0] = 0.0
            row = h.step()
            pk = {"row": {**row, **h.facts()}, **h.snapshot()}
            cls.packets.append(pk)
            sz = (os.path.getsize(sx) if os.path.exists(sx) else 0, os.path.getsize(st) if os.path.exists(st) else 0)
            settle = sum(v - prev_f0.get(k, 0.0) for k, v in L.flows.items() if k.startswith("basim:"))
            prev_f0 = dict(L.flows)
            alias = flowhook.ALIAS
            intra = sum(v for (a, b, _k), v in L.sx.last.items() if alias.get(a, a) == alias.get(b, b))
            pairs = {(alias.get(a, a), alias.get(b, b)) for (a, b, _k) in L.sx.last}
            cm = float(getattr(L, "cm_mint", 0.0) or 0.0)
            cm_delta, prev_cm = cm - prev_cm, cm
            cls.weeks.append({"paid": cls.paid[0], "matrix": sum(L.sx.last.values()), "settle": settle, "intra": intra, "pairs": len(pairs) + 1, "cm_delta": cm_delta,
                              "grow": (sz[0] - sizes[0], sz[1] - sizes[1]),
                              "cells": pk["holdings"].get("flows"), "cm": L.sx.cm_prev,
                              "other_vol": sum(v for (a, b, _k), v in L.sx.last.items() if "other" in (alias.get(a, a), alias.get(b, b))),
                              "all_vol": sum(L.sx.last.values())})
            sizes = sz

    @classmethod
    def tearDownClass(cls):
        cls.csv_dir = cls.host._csv_dir
        cls.host.close()

    def test_hook_ran_for_real(self):
        h = self.host
        self.assertTrue(isinstance(h._W.L.sx, flowhook.KesimMatrisi))
        self.assertTrue(os.path.exists(os.path.join(h._csv_dir, "w.csv.sx")))              # dal gerçekten çalıştı (model dosyayı yazdı)
        self.assertGreater(os.path.getsize(os.path.join(h._csv_dir, "w.csv.sx")), 0)
        for w, x in enumerate(self.weeks, 1):
            self.assertTrue(x["cells"], f"hafta {w}")

    def test_cells_total_equals_pay_total(self):
        """§8: testte `L.pay` sarılır, dönen tutarlar toplanır; toplam = matris toplamı (kesim içi dahil) - `settle` basımı (matrise `pay` dışından girer)."""
        for w, x in enumerate(self.weeks, 1):
            self.assertAlmostEqual(x["paid"] + x["settle"], x["matrix"], delta=1.0 + 1e-9 * x["matrix"], msg=f"hafta {w}")
        self.assertGreater(sum(x["paid"] for x in self.weeks), 0)

    def test_cells_are_cross_segment_and_bounded(self):
        for w, x in enumerate(self.weeks, 1):
            cells = x["cells"]
            self.assertLessEqual(len(cells), flowhook.TOP_CELLS + 1)
            for a, b, v in cells:
                self.assertIs(type(v), int)
                self.assertGreater(v, 0)
                if "rest" in (a, b):                                           # kalan satır: iki uç da "rest" (bir kesim değil, sunum kovası)
                    self.assertEqual((a, b), ("rest", "rest"))
                else:
                    self.assertIn(a, flowhook.SEGMENTS)
                    self.assertIn(b, flowhook.SEGMENTS)
                    self.assertNotEqual(a, b)
            # TAM kapanış: hücre toplamı (TOP_CELLS + other satırı) = ödenen + settle basımı - kesim içi + kredi parası basım farkı; yalnız hücre başına yuvarlama (<= 0,5) payı
            want = x["paid"] + x["settle"] - x["intra"] + x["cm_delta"]
            self.assertAlmostEqual(sum(c[2] for c in cells), want, delta=0.5 * x["pairs"] + 1e-9 * x["matrix"], msg=f"hafta {w}")
        self.assertTrue(any(a == "players" and b == "npc_firms" for a, b, _ in self.weeks[-1]["cells"]))

    def test_other_touching_volume_tiny(self):
        """PLAN-KREDI S2a: gerçek modelde (varsayılan dünya, hafta başına) "other" kesimine dokunan ham hacim, matris hacminin <= %0,1'i (emanet düzeltmesinden önce ~%3,6-7,5)."""
        other = sum(x["other_vol"] for x in self.weeks)
        total = sum(x["all_vol"] for x in self.weeks)
        self.assertGreater(total, 0)
        self.assertLessEqual(other, 0.001 * total, (other, total))

    def test_hook_tmp(self):
        """§7: geçici .sx/.st dosyaları <= 10 KB/hafta; host kapanınca dizin silinir (sınıf kapanışında denetlenir)."""
        for w, x in enumerate(self.weeks, 1):
            self.assertLessEqual(sum(x["grow"]), 10 * 1024, f"hafta {w}: {x['grow']}")
        self.assertGreater(sum(self.weeks[-1]["grow"]), 0)

    def test_holdings_size(self):
        """Taşınan bütçe kilidi (T2 incelemesi): `holdings` (akışla birlikte) gerçek modelde, varsayılan dünyada 26 haftanın ORTALAMASI <= 2.500 bayt (sert); en kötü hafta <= 3.000 (§7).
        Akış TOP_CELLS = 18 ile bütçeye sığar (24 ile 2.509,5 idi)."""
        sizes = [size(p["holdings"]) for p in self.packets]
        self.assertTrue(all("flows" in p["holdings"] for p in self.packets))
        self.assertLessEqual(sum(sizes) / len(sizes), 2500, sizes)
        self.assertLessEqual(max(sizes), 3000, sizes)
        self.assertLessEqual(sum(size(p["holdings"]["flows"]) for p in self.packets) / len(sizes), 750)

    def test_no_person_ids(self):
        for p in self.packets:
            self.assertIsNone(PERSON_ID.search(json.dumps(p["holdings"]["flows"])))


class RealModelIdentity(unittest.TestCase):
    def ab(self, overrides: dict, weeks: int) -> None:
        """§8: kanca modelin davranışını değiştirmez. A = kancalı (varsayılan host), B = kancasız (`flow_hook=False`); aynı tohum. Ölçüm satırları, L.bal / flows /
        income / events, RNG (global ve `W` üzerindeki nesneler), paketin world / cities / chain blokları ve `holdings` (akış hariç) birebir; A'da `.sx` dosyası oluştu."""
        out = []
        for hook in (True, False):
            random.seed(20261106)
            h = ModelHost(str(config.MODEL_ROOT), dict(overrides), 200, flow_hook=hook)
            try:
                pk = stepped(h, weeks, True)
                sx = os.path.join(h._csv_dir, "w.csv.sx")
                out.append((pk, state_of(h), rng_states(h._W), os.path.exists(sx) and os.path.getsize(sx) > 0, isinstance(h._W.L.sx, flowhook.KesimMatrisi), dict(h._W.bond_stat)))
            finally:
                h.close()
        (pa, sa, ra, xa, ka, bsa), (pb, sb, rb, xb, kb, bsb) = out
        self.assertTrue(xa and ka, "kancalı koşuda w.csv.sx oluşmadı: dal çalışmadı")
        self.assertFalse(xb or kb)
        self.assertEqual(same(sa["wk_csv"], sb["wk_csv"]), [])
        for k in ("bal", "flows", "income", "events"):
            self.assertEqual(same(sa[k], sb[k], k), [], k)
        self.assertEqual(sa["rng"], sb["rng"])
        self.assertEqual(ra, rb)
        for k in set(bsa) & set(bsb):                                      # `W.bond_stat`: ortak anahtarların değeri eşit; kancalı koşuya özgü anahtar yalnız modelin okumasının eklediği iki sıfır (flowhook.py başlığı)
            self.assertEqual(bsa[k], bsb[k], f"bond_stat[{k}]")
        self.assertEqual({k: v for k, v in bsa.items() if k not in bsb}, {k: 0.0 for k in ("kisma_tavan_tl", "kisma_havuz_tl") if k not in bsb})
        self.assertEqual({k for k in bsb if k not in bsa}, set())
        for w, (x, y) in enumerate(zip(pa, pb), 1):
            self.assertIn("flows", x["holdings"])
            self.assertNotIn("flows", y["holdings"])
            self.assertEqual(json.dumps(extract_world(x["row"]), sort_keys=True), json.dumps(extract_world(y["row"]), sort_keys=True), f"hafta {w} world")
            for blk in ("row", "cities", "chain"):
                self.assertEqual(json.dumps(x[blk], sort_keys=True, default=repr), json.dumps(y[blk], sort_keys=True, default=repr), f"hafta {w} {blk}")
            self.assertEqual({k: v for k, v in x["holdings"].items() if k != "flows"}, y["holdings"], f"hafta {w} holdings")

    def test_behaviour_identical(self):
        self.ab({}, 6 if QUICK else 26)

    def test_behaviour_identical_owner_recipe(self):
        self.ab(owner_recipe_overrides(), 3 if QUICK else 12)


class Classifier(unittest.TestCase):
    def test_classifier_error_gives_other_and_step_completes(self):
        """`__missing__` modelin `pay()` içinden çağrılır: sınıflayıcı hatası modele sızmaz, hesap `other` olur; adım biter."""
        W, P = hooked_world()
        W.people = None                                              # sınıflayıcı AttributeError verir
        self.assertEqual(W.L.secfn("yeni_hesap"), "other")
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            h.step()
            orig = flowhook.KesimHaritasi._classify

            def boom(self, a):
                raise RuntimeError("sınıflayıcı hatası (test)")
            flowhook.KesimHaritasi._classify = boom
            try:
                h._W.L.secfn = flowhook.KesimHaritasi(h._W).__getitem__      # boş harita: her hesap `__missing__`
                row = h.step()                                       # model `pay()` içinden çağırır: düşmemeli
            finally:
                flowhook.KesimHaritasi._classify = orig
            self.assertIn("calisan", row)
            m = h._W.L.secfn.__self__
            self.assertGreater(len(m), 1000)
            self.assertEqual(set(m.values()), {"other"})              # her hesap `other`'a düştü, hiçbiri modele hata olarak sızmadı
        finally:
            h.close()


@unittest.skipIf(QUICK, "3 x 20 hafta x 2 koşu: yavaş")
class HookCost(unittest.TestCase):
    def test_hook_cost(self):
        """§7 sert eşik: varsayılan dünyada 20 hafta, kancalı ve kancasız 3'er tekrar (sıra dönüşümlü), medyan süre oranı <= 1,08. Yalnız `step` (+ kancalıda `take`/`rebuild`) süresi."""
        t = {True: [], False: []}
        for i in range(3):
            for hook in ((False, True) if i % 2 == 0 else (True, False)):
                random.seed(1)
                h = ModelHost(str(config.MODEL_ROOT), {}, 200, flow_hook=hook)
                try:
                    t0 = time.perf_counter()
                    for _ in range(20):
                        h.step()
                    t[hook].append(time.perf_counter() - t0)
                finally:
                    h.close()
        ratio = statistics.median(t[True]) / statistics.median(t[False])
        print(f"\nhook_cost medyan oran {ratio:.3f}  kancasız {t[False]}  kancalı {t[True]}")
        self.assertLessEqual(ratio, 1.08, (t, ratio))


class HookLifecycle(unittest.TestCase):
    def test_hook_survives_patch_and_fork(self):
        """Yama, geri alma ve dallanma (yeni koşu = yeni host) sonrası kanca kurulu kalır; matris ve akış sürer."""
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            h.step()
            h.step()
            sx = h._W.L.sx
            self.assertTrue(flowhook.installed(h._W))
            h.patch({"CORP_TAX": 0.4})
            self.assertTrue(flowhook.installed(h._W))
            self.assertIs(h._W.L.sx, sx)                                    # matris korunur
            h.step()
            self.assertTrue(h.snapshot()["holdings"]["flows"], "yama sonrası akış")
            h.revert_to({})
            self.assertTrue(flowhook.installed(h._W))
            h._W.L.secfn = None                                             # modelin kancayı düşürdüğü varsayımı (örn. yeniden kurma)
            h._W.L.sx = None
            h.patch({"WAGE_TAX": 0.25})
            self.assertTrue(flowhook.installed(h._W), "yeniden kurma")
            h.step()
            self.assertTrue(h.snapshot()["holdings"]["flows"], "yeniden kurma sonrası akış")
            self.assertTrue(os.path.exists(os.path.join(h._csv_dir, "w.csv.sx")))
            fork = ModelHost(str(config.MODEL_ROOT), {"CORP_TAX": 0.4}, 200)            # dal: yeni host aynı kurulumu yapar
            try:
                self.assertTrue(flowhook.installed(fork._W))
                fork.step()
                self.assertTrue(fork.snapshot()["holdings"]["flows"])
            finally:
                fork.close()
        finally:
            h.close()

    def test_hook_tmp_removed_on_close(self):
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        d = h._csv_dir
        h.step()
        self.assertTrue(os.path.exists(os.path.join(d, "w.csv.sx")))
        h.close()
        self.assertFalse(os.path.exists(d))

    def test_hook_failure_does_not_break_the_run(self):
        orig = flowhook.take
        buf = io.StringIO()
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            h.step()
            self.assertIn("flows", h.snapshot()["holdings"])                  # ilk hafta sağlam
            flowhook.take = lambda W: 1 / 0
            with contextlib.redirect_stderr(buf):
                for _ in range(3):
                    row = h.step()
                    self.assertNotIn("flows", h.snapshot()["holdings"])       # eski haftanın akışı kalmaz
        finally:
            flowhook.take = orig
            h.close()
        self.assertEqual(buf.getvalue().count("Traceback"), 1)
        self.assertIn("calisan", row)

    def test_csv_dir_deleted_between_steps_does_not_break_run(self):
        """I3: geçici dizin adımlar arasında silinirse (temp temizleyici, SIGKILL yarışı) model adımı `open()` ile düşmez: dizin yeniden oluşturulur, hafta kancalı sürer."""
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            h.step()
            shutil.rmtree(h._csv_dir)
            self.assertFalse(os.path.exists(h._csv_dir))
            row = h.step()
            self.assertIn("calisan", row)
            self.assertTrue(os.path.isdir(h._csv_dir))
            self.assertIn("flows", h.snapshot()["holdings"])                       # kanca sürdü
        finally:
            h.close()

    def test_unwritable_csv_dir_uninstalls_hook_once(self):
        """I3: dizin yeniden oluşturulamıyorsa kanca bir kez not düşülerek kaldırılır ve koşu kancasız sürer."""
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        buf = io.StringIO()
        orig = os.makedirs
        try:
            h.step()
            def boom(*a, **k):
                raise PermissionError("yazma yok")
            os.makedirs = boom
            with contextlib.redirect_stderr(buf):
                for _ in range(3):
                    row = h.step()
                    self.assertIn("calisan", row)
            self.assertIsNone(h._W.L.sx)
            self.assertIsNone(h._W.L.secfn)
            self.assertNotIn("flows", h.snapshot()["holdings"])
        finally:
            os.makedirs = orig
            h.close()
        self.assertEqual(buf.getvalue().count("akış kancası kaldırıldı"), 1)

    def test_stale_week_not_reemitted(self):
        """M2: model haftayı boşaltmazsa (`clear` çağrılmadı) önceki haftanın hücreleri yeni hafta akışı sayılmaz."""
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            h.step()
            self.assertTrue(h._W.L.sx.cells)
            sx = h._W.L.sx
            self.assertFalse(sx.fresh)                                              # `take` aldı
            self.assertEqual(flowhook.take(h._W), [])                               # `clear` yok: yeni hafta yok
        finally:
            h.close()

    def test_flow_hook_off(self):
        h = ModelHost(str(config.MODEL_ROOT), {}, 200, flow_hook=False)
        try:
            h.step()
            self.assertIsNone(h._W.L.sx)
            self.assertNotIn("flows", h.snapshot()["holdings"])
        finally:
            h.close()


if __name__ == "__main__":
    unittest.main()
