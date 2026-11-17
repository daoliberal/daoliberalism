"""A8 kanıtı (gerçek model, yavaş): canlı yama == aynı hafta aynı değerle taze koşu (replay), değer düzeyinde.

Senaryolar (her biri ayrı canlı koşu): `kurtarma` (6. haftada TRANS_SUPPORT 0->2), `kisa` (0->1), `iki_yama` (4. haftada 0->1,
sonra ~4 hafta sonra 1->2: iki farklı seam).
A) Canlı koşu: RunManager + gerçek ModelHost.
B) Taze koşu: ayrı kurulum, her seam haftasından sonra aynı değerler `simkit.*` modüllerine ham setattr (yama yolundan bağımsız).
C) Taban: yama yok; satırlar ilk seam'e dek eşit, sonrası ayrışır.
`OYUN_QUICK=1` ile atlanır.
"""
from __future__ import annotations

import functools
import json
import math
import os
import shutil
import sys
import tempfile
import time
import unittest

from oyun_server import config
from oyun_server.registry.resolve import run_overrides
from oyun_server.runs.manager import RunManager
from oyun_server.sim.host import ModelHost
from oyun_server.testing import InProcWorker

from tests.registry_helpers import real_registry

sys.path.insert(0, str(config.MODEL_ROOT))          # tek kez; simbuild model kökünden
import simbuild  # noqa: E402

CONFIG = {"name": "Kanıt", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban",
          "durationWeeks": 200, "seedIndex": 0, "values": {}}
BASE_PARAMS = run_overrides(real_registry(), CONFIG)       # canlı koşunun kuruluş değerleri: TRANS_SUPPORT=0 + tohum
LOOKAHEAD = config.load_decisions()["lookahead"]
# (ad, [(en az yayımlanmış hafta, ayar değeri, model değeri), ...], en az ardışık hafta sayısı son seam sonrası)
SCENARIOS = {
    "kurtarma": [(6, {"gecis_destegi": "kurtarma_fonuyla"}, {"TRANS_SUPPORT": 2})],
    "kisa": [(6, {"gecis_destegi": "kisa_sureli"}, {"TRANS_SUPPORT": 1})],
    "iki_yama": [(4, {"gecis_destegi": "kisa_sureli"}, {"TRANS_SUPPORT": 1}),
                 (9, {"gecis_destegi": "kurtarma_fonuyla"}, {"TRANS_SUPPORT": 2})],
}
TAIL = 4        # son seam'den sonra karşılaştırılacak en az hafta


def deep_diff(a, b, path="W", memo=None, out=None, limit=20):
    """Değer düzeyinde derin karşılaştırma; farkların yollarını döndürür. Bellek adresi artıkları (functools.partial
    adresi, işlev nesnesi kimliği) yerine işlev adı/modülü ve (özyinelemeli) argümanlar karşılaştırılır."""
    memo = set() if memo is None else memo
    out = [] if out is None else out
    if len(out) >= limit:
        return out
    key = (id(a), id(b))
    if key in memo:
        return out
    if a is b and not isinstance(a, float):
        return out
    memo.add(key)
    if (type(a).__module__, type(a).__qualname__) != (type(b).__module__, type(b).__qualname__):   # ayrı kurulum: ayrı sınıf nesneleri
        out.append((path, "tür", type(a).__name__, type(b).__name__))
    elif isinstance(a, float):
        if not (a == b or (math.isnan(a) and math.isnan(b))):
            out.append((path, a, b))
    elif isinstance(a, (int, str, bytes, bool, type(None))):
        if a != b:
            out.append((path, a, b))
    elif isinstance(a, functools.partial):
        deep_diff(a.func, b.func, path + ".func", memo, out, limit)
        deep_diff(a.args, b.args, path + ".args", memo, out, limit)
        deep_diff(a.keywords, b.keywords, path + ".kw", memo, out, limit)
    elif callable(a) and hasattr(a, "__qualname__"):
        if (a.__module__, a.__qualname__) != (b.__module__, b.__qualname__):
            out.append((path, "işlev", a.__qualname__, b.__qualname__))
    elif isinstance(a, dict):
        if list(a) != list(b):
            ka, kb = set(a), set(b)
            out.append((path, "anahtarlar", sorted(map(repr, ka - kb))[:5], sorted(map(repr, kb - ka))[:5]))
        for k in a:
            if k in b:
                deep_diff(a[k], b[k], "%s[%r]" % (path, k), memo, out, limit)
    elif isinstance(a, (list, tuple)):
        if len(a) != len(b):
            out.append((path, "uzunluk", len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            deep_diff(x, y, "%s[%d]" % (path, i), memo, out, limit)
    elif isinstance(a, (set, frozenset)):
        if a != b:
            out.append((path, "küme", len(a), len(b)))
    elif hasattr(a, "__dict__"):
        deep_diff(vars(a), vars(b), path, memo, out, limit)
    elif a != b:
        out.append((path, repr(a)[:60], repr(b)[:60]))
    return out


# Canlı koşu host'un kurduğu akış kancasını taşır (`oyun_server/sim/flowhook.py`, e243bc9); taze koşu ham modeldir ve kanca yoktur.
# Kancanın doğurduğu TAM üç fark vardır; yalnız bunlar karşılaştırmadan düşülür (kancayı taze koşuya da kurmak karşılaştırmayı güçlendirmez:
# kancanın iç durumu `last/fresh/cells` host'un `take()` çağrısına bağlıdır, taze koşuda çağrı yoktur):
#  1. `W.L.sx` (KesimMatrisi) ve 2. `W.L.secfn` (hesap -> kesim eşlemesi): kancanın kendi nesneleri; taze tarafta `None`.
#  3. `W.bond_stat['kisma_tavan_tl']` ve `['kisma_havuz_tl']`: modelin kendi `measure.py:103-104` okuması (`L.sx is not None` iken sektörel döküm
#     yolunda `bond_stat[...]` okunur). `bond_stat` bir `defaultdict(float)` olduğundan okuma anahtarı 0.0 ile ekler. Model durumuna kancadan yazılan
#     bu iki sıfır anahtar, değeri 0.0 kaldığı sürece davranışsızdır (modelin tek yazımı `+=`; `dict(bond_stat)` çıktıda yalnız anahtar varlığı değişir).
#     Değeri sıfırdan farklı olursa FARK sayılır; bu yüzden değer burada denetlenir.
HOOK_OBJECTS = ("W['L']['sx']", "W['L']['secfn']")
HOOK_ZERO_KEYS = ("kisma_tavan_tl", "kisma_havuz_tl")


def hook_free_diffs(W_live, W_fresh, limit=60):
    """`deep_diff` eksi kancanın doğurduğu üç farkın tamamı (yukarıdaki gerekçe); öbür her fark kalır. Beklenen fark yoksa da hata verir."""
    diffs = deep_diff(W_live, W_fresh, limit=limit)
    bs = W_live.bond_stat
    left, seen = [], set()
    for d in diffs:
        if d[0] in HOOK_OBJECTS and d[1] == "tür" and d[3] == "NoneType":
            seen.add(d[0])
        elif d[0] == "W['bond_stat']" and d[1] == "anahtarlar" and d[3] == [] \
                and sorted(d[2]) == sorted(repr(k) for k in HOOK_ZERO_KEYS) and all(bs.get(k) == 0.0 for k in HOOK_ZERO_KEYS):
            seen.add(d[0])
        else:
            left.append(d)
    return left, seen


def rows_of(W, n):
    return [json.dumps(r, sort_keys=True, default=repr) for r in W.wk_csv[:n]]


def make_raw(overrides):
    """Bağımsız ham kurulum (test_host kalıbı). Döner (mods, W, csv_dir); çağıran csv_dir'i temizler."""
    d = tempfile.mkdtemp(prefix="oyun-a8-")
    old = os.environ.get("WEEKLY_CSV")
    os.environ["WEEKLY_CSV"] = os.path.join(d, "w.csv")
    try:
        m = simbuild.build(simbuild.Params(**overrides))
    finally:
        os.environ.pop("WEEKLY_CSV", None) if old is None else os.environ.__setitem__("WEEKLY_CSV", old)
    mods = m._modules
    W = m.new_world(200, 5, True)
    mods["simkit.engine"].start_world(W)
    return mods, W, d


def run_raw(weeks, patches=()):
    """`patches`: [(seam, {model_adı: değer})]; seam haftası tamamlandıktan sonra her modüle yazılır."""
    mods, W, d = make_raw(BASE_PARAMS)
    try:
        at = {seam: p for seam, p in patches}
        for w in range(1, weeks + 1):
            if w - 1 in at:
                for key, val in at[w - 1].items():
                    for mod in mods.values():
                        if key in mod.__dict__:
                            setattr(mod, key, val)
            mods["simkit.step"].week_step(W, w, 200)
        return W
    finally:
        shutil.rmtree(d, True)


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "gerçek model kanıtı yavaş (OYUN_QUICK)")
class TestReplayEqualsLive(unittest.TestCase):
    runs: dict = {}

    @classmethod
    def setUpClass(cls):
        for name, steps in SCENARIOS.items():
            cls.runs[name] = cls._live(steps)

    @staticmethod
    def _until(cond, secs):
        end = time.time() + secs
        while time.time() < end:
            if cond():
                return
            time.sleep(0.02)
        raise AssertionError("zaman aşımı")

    @classmethod
    def _live(cls, steps):
        hosts: list = []

        def factory(spec):
            return InProcWorker(spec, host_factory=lambda s: hosts.append(ModelHost(
                str(config.MODEL_ROOT), s.get("overrides", {}), s.get("weeks", 200))) or hosts[-1])

        mgr = RunManager(real_registry(), factory, cfg=config)
        mgr.start_thread()
        try:
            rid = mgr.create(CONFIG)["runId"]
            mgr.control(rid, "play", 16)
            results = []                                       # (sonuç, çağrı öncesi released, sonrası released)
            for at_week, values, _params in steps:
                cls._until(lambda: mgr.stats(rid)["released"] >= at_week, 120)
                before = mgr.stats(rid)["released"]
                res = mgr.apply_change(rid, values, None, timeout=60)
                if not res.get("accepted"):
                    raise AssertionError("yama reddedildi: %r" % (res,))
                results.append((res, before, mgr.stats(rid)["released"]))
            last_seam = results[-1][0]["seamWeek"]
            cls._until(lambda: mgr.stats(rid)["released"] >= last_seam + TAIL, 180)
            mgr.control(rid, "pause", None)
            cls._until(lambda: mgr.stats(rid)["worker_week"] >= mgr.stats(rid)["frontier"], 60)
            time.sleep(0.2)
            host = hosts[0]
            n = host.week
            return {"results": results, "n": n, "packets": mgr.weeks(rid, 1, 200), "W": host._W,
                    "rows": rows_of(host._W, n), "steps": steps}
        finally:
            mgr.shutdown()

    def replay(self, name):
        r = self.runs[name]
        if "replay" not in r:
            patches = [(res["seamWeek"], p) for (res, _, _), (_, _, p) in zip(r["results"], r["steps"])]
            W = run_raw(r["n"], patches)
            r["replay"] = (W, rows_of(W, r["n"]))
        return r["replay"]

    def base(self, name):
        r = self.runs[name]
        if "base" not in r:
            host = ModelHost(str(config.MODEL_ROOT), dict(BASE_PARAMS), 200)
            try:
                for _ in range(r["n"]):
                    host.step()
                r["base"] = (host._W, rows_of(host._W, r["n"]))
            finally:
                host.close()
        return r["base"]

    def test_seam_is_frontier_week(self):
        """Seam sınırı türetilir: işçi her an `released <= hesaplanan <= released + LOOKAHEAD` (A7a değişmezi); yama
        çağrısı sırasında released yalnız artar. Dolayısıyla çağrı öncesi released <= seam <= çağrı sonrası released + LOOKAHEAD."""
        for name, r in self.runs.items():
            prev_seam = 0
            for i, (res, before, after) in enumerate(r["results"]):
                seam = res["seamWeek"]
                with self.subTest(name=name, yama=i):
                    self.assertGreaterEqual(seam, before)
                    self.assertLessEqual(seam, after + LOOKAHEAD)
                    self.assertGreaterEqual(seam, prev_seam)
                    self.assertEqual(res["version"], i + 2)
                prev_seam = seam
            seams = [res["seamWeek"] for res, _, _ in r["results"]]
            for p in r["packets"]:
                want = 1 + sum(p["week"] > sm for sm in seams)
                self.assertEqual(p["version"], want, (name, p["week"]))

    def test_replay_equals_live_change(self):
        """Canlı yama sonucu (tüm wk_csv satırları + tüm W değerleri) == aynı seam(ler)de taze koşu."""
        for name, r in self.runs.items():
            with self.subTest(name=name):
                last = r["results"][-1][0]["seamWeek"]
                W_b, rows_b = self.replay(name)
                self.assertGreater(r["n"], last + 1)             # son seam sonrası en az iki hafta karşılaştırılıyor
                self.assertEqual(r["rows"], rows_b)
                diffs, seen = hook_free_diffs(r["W"], W_b)
                self.assertEqual(diffs, [], diffs[:5])
                self.assertEqual(seen, {*HOOK_OBJECTS, "W['bond_stat']"})     # kanca gerçekten kurulu ve üç fark tam beklenen (bu muafiyet sessizce genişleyemez)

    def test_two_patch_seams_differ(self):
        r = self.runs["iki_yama"]
        a, b = r["results"][0][0]["seamWeek"], r["results"][1][0]["seamWeek"]
        self.assertLess(a, b)                                    # iki ayrı seam haftası

    def test_diverges_after_seam(self):
        for name, r in self.runs.items():
            with self.subTest(name=name):
                seam = r["results"][0][0]["seamWeek"]
                _, base_rows = self.base(name)
                self.assertEqual(r["rows"][:seam], base_rows[:seam])        # ilk seam'e kadar tabanla eşit
                self.assertNotEqual(r["rows"][seam:], base_rows[seam:])     # sonrası ayrışır
                first = next(i for i, (a, b) in enumerate(zip(r["rows"], base_rows)) if a != b)
                self.assertEqual(first, seam)                               # ilk fark seam'den sonraki ilk hafta (0 tabanlı indeks)

    def test_deep_diff_detects_value_change(self):
        """Karşılaştırıcının kendisi: bir değer farkı bulunur, adres artığı (partial) görmezden gelinir."""
        W_a, _ = self.replay("kurtarma")
        W_c = run_raw(self.runs["kurtarma"]["results"][0][0]["seamWeek"] + 1)     # yamasız: ayrışmış
        self.assertTrue(deep_diff(W_a, W_c))
        self.assertEqual(deep_diff(W_a, W_a), [])

    def test_hook_filter_still_detects_divergence(self):
        """Kanca muafiyeti körleştirmez: canlı W'de kanca dışı bir değer, kanca anahtarlarından biri sıfırdan farklı olursa ya da
        gerçek bir ek anahtar çıkarsa fark yine bildirilir (bozma sonra geri alınır)."""
        r = self.runs["kurtarma"]
        W_live, (W_fresh, _) = r["W"], self.replay("kurtarma")
        self.assertEqual(hook_free_diffs(W_live, W_fresh)[0], [])
        k = next(iter(W_live.L.bal))
        old = W_live.L.bal[k]
        W_live.L.bal[k] = old + 1.0
        try:
            self.assertTrue(any(d[0].startswith("W['L']['bal']") for d in hook_free_diffs(W_live, W_fresh)[0]))
        finally:
            W_live.L.bal[k] = old
        W_live.bond_stat["kisma_havuz_tl"] = 5.0
        try:
            self.assertTrue(hook_free_diffs(W_live, W_fresh)[0])
        finally:
            W_live.bond_stat["kisma_havuz_tl"] = 0.0
        W_live.bond_stat["baska_anahtar"] = 0.0
        try:
            self.assertTrue(hook_free_diffs(W_live, W_fresh)[0])
        finally:
            del W_live.bond_stat["baska_anahtar"]
        self.assertEqual(hook_free_diffs(W_live, W_fresh)[0], [])


if __name__ == "__main__":
    unittest.main()
