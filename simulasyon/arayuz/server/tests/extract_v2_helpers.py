"""S5 test yardımcıları: gerçek model dünyası (paylaşılan), yapısal eşitlik, sahte dünya."""
from __future__ import annotations

import atexit
import copy
import math
import os
import types
from collections import defaultdict
from typing import Any

QUICK = bool(os.environ.get("OYUN_QUICK"))


def same(a: Any, b: Any, path: str = "W") -> list[str]:
    """İki nesnenin yapısal eşitsizliklerini listeler (boş = eşit). Fonksiyonlar kimlikle, sayılar tam eşitlikle (NaN = NaN)."""
    if a is b:
        return []
    if isinstance(a, float) and isinstance(b, float):
        return [] if (a == b or (math.isnan(a) and math.isnan(b))) else [f"{path}: {a!r} != {b!r}"]
    if callable(a) or callable(b):
        return [] if (a is b or (type(a) is type(b) and getattr(a, "__qualname__", None) == getattr(b, "__qualname__", None))) else [f"{path}: işlev farkı"]
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        if set(map(repr, a)) != set(map(repr, b)):
            return [f"{path}: anahtar kümesi farklı ({len(a)} != {len(b)}; fark {sorted(set(map(repr, a)) ^ set(map(repr, b)))[:3]})"]
        for k in a:
            out += same(a[k], b[k], f"{path}[{k!r}]")
            if len(out) > 5:
                break
        return out
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b) or type(a) is not type(b):
            return [f"{path}: uzunluk/tür farkı"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += same(x, y, f"{path}[{i}]")
            if len(out) > 5:
                break
        return out
    if isinstance(a, (set, frozenset)) and isinstance(b, (set, frozenset)):
        return [] if a == b else [f"{path}: küme farkı"]
    if hasattr(a, "__dict__") and hasattr(b, "__dict__") and not isinstance(a, type):
        return same(vars(a), vars(b), path)
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


def deep(W):
    return copy.deepcopy(W)


def snapshot_equal(testcase, W, before, what: str) -> None:
    diff = same(before, W)
    testcase.assertEqual(diff, [], f"{what} dünyayı değiştirdi: {diff}")


def params_ns(**over) -> types.SimpleNamespace:
    """Sahte params: probe/çıkarıcıların okuduğu bayraklar ve sabitler."""
    base = dict(HOUSE_ON=True, HI_ACT=True, RENT_H=0.08, SECTOR_BOARD=1, INNOV_ON=True, LIFE_ON=True, FEE_ON=True, LONCA_FEE=0.05,
                TIER_WAGE=(10, 15, 20), CYCLES_PER_WEEK=5, MONEY_CAP=True, MINT_OPEN_WEEKS=13, POL_INF_WEEKS=13,
                PRODUCER={"sut": "ahir", "un": "un", "ekmek": "firin"}, PROD_OF={"ahir": "sut", "un": "un", "firin": "ekmek"},
                COAL_CITIES=(0,), GOLD_CITIES=(1,), SPECIAL=["tarla_bugday"] * 4, LIFE_INNOV=True)
    base.update(over)
    return types.SimpleNamespace(**base)


def fake_world(n_cities: int = 2, week: int = 20, with_board: bool = True) -> types.SimpleNamespace:
    """Gerçek modelin alan adlarını taşıyan küçük sahte dünya (sıfır firma/talep ve kenar durumları için)."""
    W = types.SimpleNamespace()
    bal = defaultdict(float)
    cities = []
    for i in range(n_cities):
        acct = f"sehir{i}"
        bal[acct] = 1000.0 * (i + 1)
        cities.append(dict(i=i, acct=acct, firms=[], players=[f"s{i}_p0"], seekers=[f"s{i}_p0"], pool=[], rep=100.0,
                           last_demand=defaultdict(float), last_imports=defaultdict(float), last_output=defaultdict(float),
                           last_sold=defaultdict(float), got_units=0.0, dem_units=0.0, served_w=0, missed_w=0, unpaid_w=0,
                           paid_w=0, imp_val=0.0, exp_val=0.0, cons_val=0.0))
    W.L = types.SimpleNamespace(bal=bal, minted=0.0, allow=defaultdict(float), cap_on=False, mand={}, cexp=None, flows=defaultdict(float),
                                cut=defaultdict(float), fiscal_minted=0.0)
    W.cities = cities
    W.firms = {}
    W.people = {f"s{i}_p0": dict(tier=0, wage=10, firm=None, who="oyuncu", city=i) for i in range(n_cities)}
    W.player_firms = []
    W.weekly = []
    W.week_no = week
    W.NOW = [week]
    W.w = week
    W.series = {}
    W.hs = defaultdict(float)
    W.occ = defaultdict(float)
    W.RM = defaultdict(lambda: 1.0)
    W.hratio = defaultdict(lambda: 1.0)
    W.RENT_CY = {i: 1.0 for i in range(n_cities)}
    W.WI = {i: 1.0 for i in range(n_cities)}
    W.FEES = {}
    W.loncas = []
    W.closed = set()
    W.loans = {}
    W.bonds = []
    W.dep_ema = defaultdict(float)
    W.dep_tot = defaultdict(float)
    W.xrate = {}
    W.mint_allow_tot = 0.0
    W.TOPO = ["ahir", "un", "firin"]
    W.RECIPES = {"ahir": ({"sut": 20}, {}), "un": ({"un": 10}, {}), "firin": ({"ekmek": 5}, {"un": 1.0})}
    W.PRICE, W.REF, W.PM, W.LAND = {}, {}, {}, {}
    W.want_units, W.short_units, W.prod_w = {}, {}, {}
    W.pol, W.pol_hist, W.POL_ON = [None], [], False
    W.board = None if not with_board else dict(week=week, cells={}, prod={}, fh={}, lo={}, persist={}, pidx={}, ptrend={}, streak={})
    return W


class Run:
    """Gerçek model koşusu (ModelHost), işçinin yaptığı gibi: adım -> facts -> snapshot."""

    def __init__(self, weeks: int, overrides=None):
        from oyun_server import config
        from oyun_server.sim.host import ModelHost
        self.host = ModelHost(str(config.MODEL_ROOT), dict(overrides or {}), 200)
        self.P = self.host._mods["simkit.params"]
        self.rows, self.facts, self.snaps, self.flow_delta = [], [], [], []
        from oyun_server.sim import extract_chain, probes
        self.edge_sets, self.edge_lists, self.raw_house = [], [], []
        edges = lambda: extract_chain.chain_edges(self.W.RECIPES, list(self.W.TOPO), self.P.PRODUCER)
        self.edges0 = edges()
        prev = 0.0
        for _ in range(weeks):
            row = self.host.step()
            self.edge_lists.append(edges())
            self.edge_sets.append({(e["from"], e["to"], e["product"]) for e in self.edge_lists[-1]})
            self.raw_house.append(probes.world_facts(self.W, self.P)["x_house_index"])
            self.facts.append(self.host.facts())
            self.snaps.append(self.host.snapshot())
            self.rows.append(row)
            fl = self.host._W.L.flows
            cur = fl.get("goc_npc", 0.0) + fl.get("goc_oyuncu", 0.0)
            self.flow_delta.append(cur - prev)
            prev = cur

    @property
    def W(self):
        return self.host._W

    def close(self):
        self.host.close()


_RUN = None


def real_run() -> "Run":
    """Paylaşılan gerçek model koşusu (16 hafta); süreç çıkışında kapatılır."""
    global _RUN
    if _RUN is None or _RUN.host.closed:
        _RUN = Run(16)
        atexit.register(_RUN.close)
    return _RUN
