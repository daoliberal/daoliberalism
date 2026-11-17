"""PLAN-TAKIP T1: `holdings` iskeleti (para ayrışımı, gruplar, mevduat).

Sahte dünya testleri her zaman koşar; gerçek model testleri OYUN_QUICK ile kısaltılır ya da atlanır."""
from __future__ import annotations

import contextlib
import io
import json
import random
import unittest
from collections import defaultdict
from pathlib import Path

from oyun_server import config
from oyun_server.sim import credit, holdings, housing_rec, labour, probes
from oyun_server.sim.extract import make_packet
from oyun_server.sim.extract import extract_world
from oyun_server.sim.host import ModelHost

from tests.extract_v2_helpers import QUICK, deep, fake_world, params_ns, same, snapshot_equal

HERE = Path(__file__).resolve().parent
JSON_SEP = (",", ":")
LABOUR_WORLD = ("vacancies", "staffless_npc", "wage_fail", "unemp_long_share", "hires_stable4")     # PLAN-KREDI T4b: `labour` bloğundan türeyen dünya alanları


def size(obj) -> int:
    return len(json.dumps(obj, separators=JSON_SEP, ensure_ascii=False).encode("utf-8"))


def holdings_world(scale: float = 1.0):
    """İki şehir, iki lonca (lonca1 kapalı), bir sigortacı, kuruluş fonu ve bütün grup türlerinden kişiler.

    Oyuncular: p0 lonca sahibi + firma sahibi (öncelik: lonca sahibi), p1 firma sahibi (kendi firmasında çalışıyor), p2 oyuncu firmasında,
    p3 DAO firmasında, p4 yerleşik firmada, p5 belediyede, p6 ahırda, s1_p0 iş arayan + öğrenci (öncelik: iş arayan), s1_p1 öğrenci,
    s1_p2 öbür, s1_p3 ölü firmada (öbür). NPC: her türden bir tane (+ ahırda bir NPC)."""
    W = fake_world(2)
    s = scale
    P_ = lambda i: f"s0_p{i}"
    people = {}
    for i in range(7):
        people[P_(i)] = dict(tier=0, wage=10, firm=None, who="oyuncu", city=0)
    for i in range(4):
        people[f"s1_p{i}"] = dict(tier=0, wage=10, firm=None, who="oyuncu", city=1)
    for n in ("n_emp", "n_plf", "n_muni", "n_pool", "n_dep", "n_out", "n_oth", "n_ahir"):
        people[n] = dict(tier=0, wage=10, firm=None, who="npc", city=0)
    W.people = people
    W.firms = {
        "s0_un0": dict(kind="un", city=0, workers=[P_(4), "n_emp"], owner=None, dead=False, capacity=25),
        "s0_pl0": dict(kind="firin", city=0, workers=[P_(0), P_(2), "n_plf"], owner=P_(0), dead=False, capacity=25),
        "s0_pl1": dict(kind="un", city=0, workers=[P_(1)], owner=P_(1), dead=False, capacity=25),
        "s0_dao": dict(kind="arge", city=0, workers=[P_(3)], owner=None, org_owner=("dao", "d1"), dead=False, capacity=25),
        "s0_belediye0": dict(kind="belediye", city=0, workers=[P_(5), "n_muni"], owner=None, dead=False, capacity=10 ** 6),
        "s0_ahir0": dict(kind="ahir", city=0, workers=[P_(6), "n_ahir"], owner=None, dead=False, capacity=100),
        "s1_dead": dict(kind="un", city=1, workers=[], owner="s1_p3", dead=True, capacity=25),
    }
    for q, f in ((P_(4), "s0_un0"), ("n_emp", "s0_un0"), (P_(0), "s0_pl0"), (P_(2), "s0_pl0"), ("n_plf", "s0_pl0"), (P_(1), "s0_pl1"),
                 (P_(3), "s0_dao"), (P_(5), "s0_belediye0"), ("n_muni", "s0_belediye0"), (P_(6), "s0_ahir0"), ("n_ahir", "s0_ahir0"),
                 ("s1_p3", "s1_dead")):
        people[q]["firm"] = f
    W.cities[0].update(players=[P_(i) for i in range(7)], seekers=[], pool=["n_pool"], deps=["n_dep"], out=["n_out"])
    W.cities[1].update(players=[f"s1_p{i}" for i in range(4)], seekers=["s1_p0"], pool=[], deps=[], out=[])
    W.student = {"s1_p0": 1, "s1_p1": 1}
    W.loncas = ["lonca0", "lonca1"]
    W.closed = {"lonca1"}
    W.lonca_owner = {"lonca0": (P_(0), 3)}
    W.ins = {"sig0": dict(founder=P_(1), alive=True)}
    W.mortgages = [dict(q=P_(2), ci=0, lo="lonca0", out=60.0 * s)]
    W.loans = {"s0_pl0": dict(lo="lonca0", out=500.0 * s), "s0_pl1": dict(lo="KFON0", out=100.0 * s)}
    W.bonds = [dict(city=0, lo="lonca0", out=40.0 * s)]
    W.deposits = {P_(0): ["lonca0", 120.0 * s], P_(1): ["lonca0", 30.0 * s], "s1_p2": ["lonca1", 10.0 * s], "sig0_rezerv": ["lonca0", 80.0 * s]}
    W.dep_tot = defaultdict(float, {"lonca0": 230.0 * s, "lonca1": 10.0 * s})
    bal = W.L.bal
    bal.update({"lonca0_sermaye": 1000.0 * s, "lonca0_refah": 50.0 * s, "lonca1_sermaye": 0.0, "KFON0_sermaye": 300.0 * s, "KFON1_sermaye": 200.0 * s,
                "sig0_rezerv": 400.0 * s})
    for k, q in enumerate(people):
        bal[q] = (10.0 + k) * s
    bal.update({"s0_un0": 30.0 * s, "s0_pl0": 20.0 * s, "s0_pl1": 25.0 * s, "s0_dao": 11.0 * s, "s0_belediye0": 7.0 * s, "s0_ahir0": 5.0 * s, "emanet0": 3.0 * s})
    return W, params_ns()


class LoncaSplit(unittest.TestCase):
    def test_lonca_split(self):
        W, P = holdings_world()
        m = holdings.money(W, P)
        self.assertEqual(set(m), {"deposits_players", "deposits_insurance", "found_fund", "insurance_reserve", "lonca_cash_net", "credit_out",
                                  "fund_credit_out", "bonds_out", "lonca_equity"})
        self.assertEqual(m["deposits_players"], 160)                          # p0 120 + p1 30 + s1_p2 10
        self.assertEqual(m["deposits_insurance"], 80)
        self.assertEqual(m["found_fund"], 500)                                # KFON0 + KFON1
        self.assertEqual(m["insurance_reserve"], 400)
        self.assertEqual(m["credit_out"], 560)                                # işletme kredisi 500 + konut kredisi 60 (fon kredisi hariç)
        self.assertEqual(m["fund_credit_out"], 100)
        self.assertEqual(m["bonds_out"], 40)
        money_lonca = probes.money_facts(W, P)["x_money_lonca"]
        self.assertEqual(money_lonca, 1950.0)
        self.assertEqual(m["lonca_cash_net"], 1950 - 160 - 80 - 500 - 400)    # = 810
        # lonca_equity = Σ (sermaye + kredi + tahvil - mevduat); modelin credit_core.lo_equity formülü
        want = (1000 + 560 + 40 - 230) + (0 + 0 + 0 - 10)
        self.assertEqual(m["lonca_equity"], want)

    def test_lonca_cash_net_can_be_negative(self):
        W, P = holdings_world()
        W.L.bal["lonca0_sermaye"] = 10.0                                      # kredi dışarıda: kasa mevduatı karşılamıyor
        m = holdings.money(W, P)
        self.assertEqual(m["lonca_cash_net"], (10 + 50 + 500 + 400) - 160 - 80 - 500 - 400)
        self.assertLess(m["lonca_cash_net"], 0)
        self.assertGreater(m["credit_out"], 0)

    def test_rounded_to_whole_akce_and_finite(self):
        W, P = holdings_world()
        W.L.bal["lonca0_sermaye"] += 0.49
        W.deposits["s0_p0"][1] += 0.4
        m = holdings.money(W, P)
        for k, v in m.items():
            self.assertIs(type(v), int, k)
        json.dumps(holdings.build(W, P), allow_nan=False)


class OwnerView(unittest.TestCase):
    def test_owner_view_closes(self):
        for neg in (False, True):
            W, P = holdings_world()
            if neg:
                W.L.bal["lonca0_sermaye"] = 10.0
            m = holdings.money(W, P)
            f = probes.money_facts(W, P)
            total = sum(W.L.bal.values())
            view = (f["x_money_households"] + m["deposits_players"]
                    + m["insurance_reserve"] + m["deposits_insurance"]
                    + f["x_money_npc_firms"] + f["x_money_player_firms"]
                    + f["x_money_city"] + m["found_fund"]
                    + m["lonca_cash_net"] + f["x_money_other"])
            self.assertAlmostEqual(view, total, delta=9)

    def test_npc_never_in_deposits(self):
        W, P = holdings_world()
        h = holdings.build(W, P)
        for g, e in h["groups"]["npc"].items():
            self.assertEqual(len(e), 2, g)                                    # NPC grupları [n, nakit]: mevduat alanı yok
        self.assertEqual(set(h["deposits"]["by_group"]) - set(holdings.PLAYER_GROUPS), {"insurance"})
        for k in W.deposits:                                                  # model değişmezi: mevduat sahipleri oyuncu ya da sigortacı
            self.assertTrue(W.people[k]["who"] == "oyuncu" if k in W.people else k.endswith("_rezerv"), k)
        W.deposits["n_pool"] = ["lonca0", 5.0]                                # kuralı bozan sahte NPC mevduatı gruplara girmez
        self.assertEqual(holdings.build(W, P)["deposits"]["by_group"], h["deposits"]["by_group"])


class Groups(unittest.TestCase):
    def test_groups_exclusive_complete(self):
        W, P = holdings_world()
        g = holdings.build(W, P)["groups"]
        self.assertEqual(tuple(g["player"]), holdings.PLAYER_GROUPS)
        self.assertEqual(tuple(g["npc"]), holdings.NPC_GROUPS)
        self.assertEqual(sum(e["n"] for e in g["player"].values()), sum(1 for p in W.people.values() if p["who"] == "oyuncu"))
        self.assertEqual(sum(e[0] for e in g["npc"].values()), sum(1 for p in W.people.values() if p["who"] == "npc"))
        cash_p = sum(e["cash"] for e in g["player"].values())
        cash_n = sum(e[1] for e in g["npc"].values())
        self.assertAlmostEqual(cash_p + cash_n, sum(v for k, v in W.L.bal.items() if k in W.people), delta=len(g["player"]) + len(g["npc"]))
        self.assertLessEqual(g["player"]["seeking"]["n"], sum(len(c["seekers"]) for c in W.cities))

    def test_group_precedence(self):
        W, P = holdings_world()
        g = holdings.build(W, P)["groups"]
        pl = {k: v["n"] for k, v in g["player"].items()}
        self.assertEqual(pl, {"lonca_owner": 1,                               # p0 hem lonca hem firma sahibi: lonca sahibi kazanır
                              "firm_owner": 1,                                # p1 kendi firmasında çalışsa da firma sahibi
                              "employed_player_firm": 2,                      # p2 (oyuncu firması) + p3 (DAO firması)
                              "employed_npc_firm": 1, "municipal": 1, "ahir": 1,
                              "seeking": 1,                                   # s1_p0 hem iş arayan hem öğrenci: iş arayan kazanır
                              "student": 1,                                   # s1_p1
                              "other": 2})                                    # s1_p2 + ölü firmadaki s1_p3
        nn = {k: v[0] for k, v in g["npc"].items()}
        self.assertEqual(nn, {"employed_npc_firm": 1, "employed_player_firm": 1, "municipal": 1, "pool": 1, "dependent": 1, "out": 1,
                              "other": 2})                                    # n_oth + ahırdaki NPC (brief: NPC grupları arasında ahır yok)
        self.assertEqual(g["player"]["lonca_owner"]["cash"], 10)
        # tek kişi fonksiyonları
        ctx = holdings.context(W)
        self.assertEqual(holdings.player_group(ctx, "s0_p0", W.people["s0_p0"]), "lonca_owner")
        self.assertEqual(holdings.player_group(ctx, "s1_p0", W.people["s1_p0"]), "seeking")
        self.assertEqual(holdings.npc_group(ctx, "n_plf", W.people["n_plf"]), "employed_player_firm")

    def test_deposits_by_group_and_totals(self):
        W, P = holdings_world()
        h = holdings.build(W, P)
        self.assertEqual(h["groups"]["player"]["lonca_owner"]["deposits"], 120)
        by = h["deposits"]["by_group"]
        self.assertEqual((by["lonca_owner"], by["firm_owner"], by["other"], by["insurance"]), (120, 30, 10, 80))
        self.assertEqual(sum(by.values()), round(sum(W.dep_tot.values())))
        for k in holdings.PLAYER_GROUPS:
            self.assertEqual(by[k], h["groups"]["player"][k]["deposits"])

    def test_notes_cover_every_field(self):
        W, P = holdings_world()
        h = holdings.build(W, P)
        for k in h["money"]:
            self.assertIn("money." + k, holdings.NOTES)
        for k in h["groups"]["player"]:
            self.assertIn("groups.player." + k, holdings.NOTES)
        for k in h["groups"]["npc"]:
            self.assertIn("groups.npc." + k, holdings.NOTES)
        self.assertIn("deposits.by_group", holdings.NOTES)
        self.assertTrue(all(isinstance(v, str) and v.strip() for v in holdings.NOTES.values()))


class Purity(unittest.TestCase):
    def test_does_not_mutate(self):
        W, P = holdings_world()
        before = deep(W)
        holdings.build(W, P)
        holdings.money(W, P)
        holdings.groups(W)
        snapshot_equal(self, W, before, "holdings.build")

    def test_missing_optional_parts_do_not_crash(self):
        W = fake_world(1)                                                     # kredi, mevduat, sigorta, fon, öğrenci yapıları yok
        h = holdings.build(W, params_ns())
        self.assertEqual(h["money"]["credit_out"], 0)
        self.assertEqual(h["deposits"]["by_group"]["insurance"], 0)


class Size(unittest.TestCase):
    def test_holdings_size(self):
        W, P = holdings_world()
        t1 = ("money", "groups", "deposits")                                  # T1 bölümleri; sonraki görevlerin bölümleri kendi testlerinde ölçülür
        typical = size({k: v for k, v in holdings.build(W, P).items() if k in t1})
        worst_w, worst_p = holdings_world(scale=1e5)                          # 7 basamaklı tutarlar, bütün gruplar dolu
        worst = size({k: v for k, v in holdings.build(worst_w, worst_p).items() if k in t1})
        self.assertLessEqual(typical, 1600)
        self.assertLessEqual(worst, 1800)                                     # T1 payı; T2-T4 kendi bölümlerini ekler (toplam bütçe 3.000)


class PacketCarriesHoldings(unittest.TestCase):
    def test_make_packet_holdings_optional(self):
        row = {"calisan": 1, "issiz": 1}
        self.assertNotIn("holdings", make_packet("r", 1, 1, row))
        self.assertEqual(make_packet("r", 1, 1, row, holdings={"money": {}})["holdings"], {"money": {}})


# ---------------------------------------------------------------- gerçek model

# Kuruluş fonu ve mevduat 12 haftada dolu olsun diye girişim kapıları açık (varsayılan dünyada fon 26 haftada hâlâ 0'dır).
FUND_ON = {"ENTRY_OPEN": 1, "YOUNG_KIT": 1, "EO_COHORT": 0}


def stepped(host: ModelHost, weeks: int, with_snapshot: bool) -> list[dict]:
    """İşçinin yaptığı gibi: adım -> facts -> snapshot. Her hafta için paket parçaları."""
    out = []
    for _ in range(weeks):
        row = host.step()
        if with_snapshot:
            row = {**row, **host.facts()}
            out.append({"row": row, **host.snapshot()})
        else:
            out.append({"row": row})
    return out


def state_of(host: ModelHost) -> dict:
    W = host._W
    return {"wk_csv": W.wk_csv, "bal": dict(W.L.bal), "flows": dict(W.L.flows), "income": dict(W.L.income), "events": list(W.L.events),
            "rng": random.getstate()}


@unittest.skipIf(QUICK, "gerçek model koşusu yavaş")
class RealModelFund(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = ModelHost(str(config.MODEL_ROOT), dict(FUND_ON), 200)
        cls.packets = stepped(cls.host, 20, True)      # denge kapisi 2026-11-12: oyun varsayilani SELL_MATCH/NPC_NET_OWNER/SOLE_KEEP ile ilk oyuncu mevduati hf 16'da dogar (eskiden hf <12); sinama dolu kalsin diye 20 hf

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def test_found_fund_equals_model_fund_balance(self):
        for w, p in enumerate(self.packets, 1):
            self.assertLessEqual(abs(p["holdings"]["money"]["found_fund"] - p["row"]["yk_fon_bakiye"]), 1, f"hafta {w}")
        last = self.packets[-1]
        self.assertGreater(last["row"]["yk_fon_bakiye"], 0)                    # sınama boş değil: fon dolu
        self.assertGreater(last["holdings"]["money"]["fund_credit_out"], 0)
        self.assertGreater(last["holdings"]["money"]["deposits_players"], 0)

    def test_owner_view_closes_every_week(self):
        for w, p in enumerate(self.packets, 1):
            m, row = p["holdings"]["money"], p["row"]
            view = (row["x_money_households"] + m["deposits_players"] + m["insurance_reserve"] + m["deposits_insurance"] + row["x_money_npc_firms"]
                    + row["x_money_player_firms"] + row["x_money_city"] + m["found_fund"] + m["lonca_cash_net"] + row["x_money_other"])
            self.assertAlmostEqual(view, row["para_toplam"], delta=9, msg=f"hafta {w}")

    def test_real_closures(self):
        W = self.host._W
        h = self.packets[-1]["holdings"]
        m, row = h["money"], self.packets[-1]["row"]
        g = h["groups"]
        self.assertEqual(sum(e["n"] for e in g["player"].values()), row["x_players_total"])
        self.assertEqual(sum(e[0] for e in g["npc"].values()), sum(1 for p in W.people.values() if p["who"] == "npc"))
        self.assertLessEqual(g["player"]["seeking"]["n"], row["x_players_seeking"])
        self.assertAlmostEqual(sum(h["deposits"]["by_group"].values()), sum(W.dep_tot.values()), delta=12)
        self.assertAlmostEqual(m["deposits_players"] + m["deposits_insurance"], sum(W.dep_tot.values()), delta=3)
        for k in W.deposits:                                                   # NPC mevduat sahibi olmaz
            self.assertTrue(W.people[k]["who"] == "oyuncu" if k in W.people else k.endswith("_rezerv"), k)
        cc = self.host._mods["simkit.credit_core"]
        self.assertAlmostEqual(m["lonca_equity"], sum(cc.lo_equity(W, lo) for lo in W.loncas), delta=2)

    def test_holdings_size_on_real_model(self):
        sizes = [size(p["holdings"]) for p in self.packets]
        self.assertLessEqual(sum(sizes) / len(sizes), 2500)
        self.assertLessEqual(max(sizes), 3000)


def owner_recipe_overrides() -> dict:
    """Sahibin tarifi: `kosu.json` (canli-92de8515) değerleri, sunucunun koşu kurarken yaptığı gibi çözülür (1.500 oyuncu, 9.600 NPC).
    `kosular/` git dışıdır ve başka makinede/worktree'de yoktur: dosya yoksa kayıtlı `bos_sart` şablonu (tüm şartlar açıkça yazılı, varsayılandan farklı)
    aynı yolla çözülür; böylece gerçek-model testleri dosyaya bağlı kalmadan koşar."""
    from oyun_server.registry.resolve import run_overrides
    from tests.registry_helpers import real_registry
    yol = HERE.parents[1] / "kosular" / "20261106-105124_canli-92de8515" / "kosu.json"
    if yol.exists():
        r = json.loads(yol.read_text(encoding="utf-8"))["recipe"]
    else:
        reg = json.loads((HERE.parents[1] / "registry" / "templates.json").read_text(encoding="utf-8"))
        r = next({"values": t["values"], "templateId": t["id"]} for t in reg["templates"] if t["id"] == "bos_sart")
    return run_overrides(real_registry(), {"durationWeeks": 100, "values": r["values"], "seedIndex": 0, "templateId": r["templateId"]})


def rng_states(W) -> dict:
    """`W` altında (derinlik 4) bulunan `random.Random` nesnelerinin durumu; modelde yoksa boş sözlük."""
    out, seen = {}, set()

    def walk(o, path, depth):
        if id(o) in seen or depth > 4:
            return
        seen.add(id(o))
        if isinstance(o, random.Random):
            out[path] = o.getstate()
        elif isinstance(o, dict):
            for k, v in list(o.items()):
                walk(v, f"{path}[{k!r}]", depth + 1)
        elif isinstance(o, (list, tuple)):
            for i, v in enumerate(o[:200]):
                walk(v, f"{path}[{i}]", depth + 1)
        elif hasattr(o, "__dict__") and not isinstance(o, type):
            for k, v in vars(o).items():
                walk(v, f"{path}.{k}", depth + 1)
    walk(W, "W", 0)
    return out


class RealModelIdentity(unittest.TestCase):
    def ab(self, overrides: dict, weeks: int) -> int:
        """§8: `holdings`, `credit` (PLAN-KREDI T2), `housing` (T4) ve `labour` (T4b) modelin davranışını değiştirmez. Aynı tohum; A = facts + snapshot (cities, chain, holdings, credit, housing, labour), B = aynısı ama
        `holdings.build`, `credit.build`, `housing_rec.build` ve `labour.build` devre dışı (hata yolu da denenir): ölçüm satırları, L.bal / flows / income / events, RNG durumu (global ve `W` üzerindeki nesneler) ve paketin
        world / cities / chain blokları birebir (`labour`un beş dünya alanı B'de null: yalnız onlar ayrılır). `W` üzerindeki RNG nesnesi sayısını döndürür."""
        random.seed(20261106)
        a = ModelHost(str(config.MODEL_ROOT), dict(overrides), 200)
        try:
            pa = stepped(a, weeks, True)
            sa = state_of(a)
            ra = rng_states(a._W)
        finally:
            a.close()

        def boom(W, P, *rest):
            raise RuntimeError("holdings kapalı (test)")

        orig, holdings.build = holdings.build, boom
        orig_credit, credit.build = credit.build, boom
        orig_housing, housing_rec.build = housing_rec.build, boom
        orig_labour, labour.build = labour.build, boom
        random.seed(20261106)
        b = ModelHost(str(config.MODEL_ROOT), dict(overrides), 200)
        try:
            with contextlib.redirect_stderr(io.StringIO()):                    # beklenen hata izi (host stderr'e yazar)
                pb = stepped(b, weeks, True)
            sb = state_of(b)
            rb = rng_states(b._W)
        finally:
            holdings.build = orig
            credit.build = orig_credit
            housing_rec.build = orig_housing
            labour.build = orig_labour
            b.close()
        self.assertEqual(same(sa["wk_csv"], sb["wk_csv"]), [])
        for k in ("bal", "flows", "income", "events"):
            self.assertEqual(same(sa[k], sb[k], k), [], k)
        self.assertEqual(sa["rng"], sb["rng"])
        self.assertEqual(ra, rb)
        for w, (x, y) in enumerate(zip(pa, pb), 1):
            self.assertIn("holdings", x)
            self.assertNotIn("holdings", y)                                    # B: hata koşuyu düşürmedi, blok yalnız yok
            self.assertIn("credit", x)
            self.assertNotIn("credit", y)
            self.assertIn("housing", x)
            self.assertNotIn("housing", y)
            self.assertIn("labour", x)
            self.assertNotIn("labour", y)
            wx, wy = extract_world(x["row"]), extract_world(y["row"])
            for k in LABOUR_WORLD:                                             # beş iş piyasası alanı B'de null (blok yok); öbür dünya alanları birebir
                self.assertIsNone(wy[k], k)
                wx.pop(k), wy.pop(k)
            self.assertEqual(json.dumps(wx, sort_keys=True), json.dumps(wy, sort_keys=True), f"hafta {w} world")
            rx, ry = dict(x["row"]), dict(y["row"])
            for k in LABOUR_WORLD:                                             # satırdaki `x_<alan>` olguları da yalnız labour bloğundan gelir
                self.assertIsNone(ry["x_" + k], k)
                rx.pop("x_" + k), ry.pop("x_" + k)
            self.assertEqual(json.dumps(rx, sort_keys=True, default=repr), json.dumps(ry, sort_keys=True, default=repr), f"hafta {w} row")
            for blk in ("cities", "chain"):
                self.assertEqual(json.dumps(x[blk], sort_keys=True, default=repr), json.dumps(y[blk], sort_keys=True, default=repr), f"hafta {w} {blk}")
        return len(ra)

    def test_behaviour_identical(self):
        self.ab({}, 6 if QUICK else 26)

    def test_behaviour_identical_owner_recipe(self):
        self.ab(owner_recipe_overrides(), 3 if QUICK else 12)            # tam 12 hafta yalnız hızlı olmayan kipte (1,25 sn/hafta)

    def test_persistent_holdings_error_prints_once(self):
        orig, holdings.build = holdings.build, lambda W, P: 1 / 0
        buf = io.StringIO()
        h = ModelHost(str(config.MODEL_ROOT), {}, 200)
        try:
            with contextlib.redirect_stderr(buf):
                stepped(h, 3, True)
        finally:
            holdings.build = orig
            h.close()
        self.assertEqual(buf.getvalue().count("Traceback"), 1)


if __name__ == "__main__":
    unittest.main()
