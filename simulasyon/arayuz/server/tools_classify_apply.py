"""R2: kural kartlarının `apply` sınıflaması (DK-6, DK-17, inceleme I3).

Her kart parametresi için kanıtlı sınıf: `live` | `live_sync` | `start_only`. Kapılar:
  (e) eşitlik: kuruluştan sonra hafta 0'da `livepatch.apply_overrides` ile verilen değer = `Params(KEY=değer)` ile kurulan dünya,
      N hafta (40) bit bit eşit -> `live` (etki en az bir denemede görülmüş olmalı);
  (a) türetim farkı: `bench.derive_diff` parmak izi (W altı nesneler bir düzey derin) -> `turetim` / `w_kopya`;
  (b) AST: modül düzeyi atama, varsayılan argüman, kuruluş çağrı ağacında okuma -> `modul_duzeyi` / `kurulus_okuma` / `w_kopya`;
  (d) ıraksama: hafta 20 yaması 100 haftada tabandan ayrışıyorsa `live`; ölçülemeyen -> `start_only` (`etki_olculemedi`).
Alt alan parametreleri ana bayrak AÇIK bir dünyada sınanır. Kart sınıfı = parametre sınıflarının en kısıtlısı.
Koşular alt süreçte (tek build/süreç), sonuçlar `bench/results/apply_cache/` önbelleğinde: araç yeniden başlatılabilir.

  PYTHONPATH=$PWD python3 -P -m tools_classify_apply [--jobs N] [--only KEY[,KEY...]] [--resume] [--budget SN] [--write-registry]
"""
from __future__ import annotations

import argparse
import ast
import glob
import hashlib
import json
import math
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent
ARAYUZ = SERVER_ROOT.parent
REGISTRY_DIR = ARAYUZ / "registry"
OUT_PATH = REGISTRY_DIR / "apply_classes.json"
CACHE_DIR = SERVER_ROOT / "bench" / "results" / "apply_cache"
KEYS_DIR = CACHE_DIR / "keys"
ROOTS = ("new_world", "start_world")
EQ_WEEKS = 40
LONG_WEEKS = 100
SFC_TOL = 1e-9         # para korunumu göreli toleransı (simkit.ledger.assert_conserved ile aynı)
EQ_AFTER = 20          # etki görüldükten sonra eşitliğin korunması gereken en az hafta
MAX_WEEKS = 200        # model dünyasının koşu üst sınırı (world(200, ...))
PATCH_WEEK = 20
DIR_WEEKS = 50          # yön denetimi ufku (hafta; kısa: bütçe)
DIR_PATCH_WEEK = 20     # "koşu ortası" değişim haftası
DIR_TOL = 0.05          # ölçü ölçeğine göre %5: altı gürültü (aşağıdaki gerekçe: yön denetimi bölümü)
DIR_SPAN = 8            # ilk anlamlı sapmadan sonra işareti ortalayan hafta sayısı
MEASURES = ("talep_karsilama", "calisan", "sehir_kasasi", "basim_izni")
RANK = {"live": 0, "live_sync": 1, "start_only": 2}

if __name__ == "__main__" or "bench" not in sys.modules:
    sys.path.insert(0, str(SERVER_ROOT))
from bench import _common as C                      # noqa: E402
from oyun_server.sim import livepatch               # noqa: E402


# --------------------------------------------------------------------------------------------- AST taraması
def read_sources() -> dict[str, str]:
    """Model kaynakları: {modül adı: metin} (simkit/*.py + model_mod.py)."""
    root = Path(C.MODEL_ROOT)
    out = {}
    for p in sorted((root / "simkit").glob("*.py")):
        out["simkit." + p.stem] = p.read_text(encoding="utf-8")
    mm = root / "model_mod.py"
    if mm.is_file():
        out["model_mod"] = mm.read_text(encoding="utf-8")
    return out


def _loads(node, key):
    for n in ast.walk(node):
        if isinstance(n, ast.Name) and n.id == key and isinstance(n.ctx, ast.Load):
            yield n


def _module_level(body, key, mod, hits, func=None):
    """İçe aktarmada yürütülen deyimlerde okuma; işlev gövdesine inilmez (yalnız varsayılan argüman/dekoratör)."""
    for st in body:
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in list(st.args.defaults) + [x for x in st.args.kw_defaults if x is not None]:
                for n in _loads(d, key):
                    hits.append({"kind": "varsayilan_arg", "module": mod, "line": n.lineno, "func": st.name})
            for d in st.decorator_list:
                for n in _loads(d, key):
                    hits.append({"kind": "modul_duzeyi", "module": mod, "line": n.lineno, "func": st.name})
        elif isinstance(st, ast.ClassDef):
            for d in list(st.bases) + list(st.decorator_list):
                for n in _loads(d, key):
                    hits.append({"kind": "modul_duzeyi", "module": mod, "line": n.lineno, "func": st.name})
            _module_level(st.body, key, mod, hits, st.name)
        else:
            subs = [c for c in ast.iter_child_nodes(st)]
            bodies = [st.body, getattr(st, "orelse", []), getattr(st, "finalbody", [])] if hasattr(st, "body") and isinstance(st.body, list) else []
            for h in getattr(st, "handlers", []):
                bodies.append(h.body)
            nested = {id(x) for b in bodies for x in b} | {id(h) for h in getattr(st, "handlers", [])}
            for c in subs:
                if id(c) in nested:
                    continue
                for n in _loads(c, key):
                    # lambda gövdesi çağrılana dek yürümez; varsayılan argümanı ayrı sayılır (sade: yine de modül düzeyi say)
                    hits.append({"kind": "modul_duzeyi", "module": mod, "line": n.lineno, "func": func})
            for b in bodies:
                _module_level(b, key, mod, hits, func)


def _founding_closure(trees: dict, roots) -> list[tuple[str, ast.AST, str]]:
    """Kuruluş çağrı ağacı: kökten ulaşılan işlevler (ad eşlemesi; sınıf adı çağrısı -> __init__/__post_init__).
    Aşırı yaklaşıktır (metot çağrısı ada göre eşlenir): fazla `start_only` yönünde yanılır."""
    funcs: dict[str, list] = {}
    classes: dict[str, list] = {}
    for mod, tree in trees.items():
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                funcs.setdefault(n.name, []).append((mod, n))
            elif isinstance(n, ast.ClassDef):
                classes.setdefault(n.name, []).append((mod, n))
    seen: dict[int, tuple[str, ast.AST, str]] = {}
    todo = [x for r in roots for x in funcs.get(r, [])]
    while todo:
        mod, fn = todo.pop()
        if id(fn) in seen:
            continue
        seen[id(fn)] = (mod, fn, fn.name)
        for c in ast.walk(fn):
            if not isinstance(c, ast.Call):
                continue
            f = c.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
            if name is None:
                continue
            todo.extend(funcs.get(name, []))
            for cm, cls in classes.get(name, []):
                for b in cls.body:
                    if isinstance(b, ast.FunctionDef) and b.name in ("__init__", "__post_init__"):
                        todo.append((cm, b))
    return list(seen.values())


def _w_target(t) -> bool:
    while isinstance(t, (ast.Attribute, ast.Subscript)):
        t = t.value
    return isinstance(t, ast.Name) and t.id == "W"


def ast_scan(key: str, sources: dict[str, str], roots=ROOTS) -> list[dict]:
    """Anahtarın canlı yamayı kıran okumaları: [{kind, module, line, func}], kind:
    modul_duzeyi | varsayilan_arg | kurulus_okuma | w_kopya (yalnız kuruluş çağrı ağacındaki işlevlerde)."""
    trees = {m: ast.parse(t) for m, t in sources.items()}
    hits: list[dict] = []
    for mod, tree in trees.items():
        if mod.endswith(".params") or mod == "params":
            # kendi tanım satırı (KEY = ...) okuma değildir; türetimler modül düzeyi okumadır
            pass
        _module_level(tree.body, key, mod, hits)
    for mod, fn, name in _founding_closure(trees, roots):
        wlines = set()
        for st in ast.walk(fn):
            if isinstance(st, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
                tg = st.targets if isinstance(st, ast.Assign) else [st.target]
                if any(_w_target(t) for t in tg) and st.value is not None:
                    for n in _loads(st.value, key):
                        wlines.add(n.lineno)
                        hits.append({"kind": "w_kopya", "module": mod, "line": n.lineno, "func": name})
        for n in _loads(fn, key):
            if n.lineno not in wlines:
                hits.append({"kind": "kurulus_okuma", "module": mod, "line": n.lineno, "func": name})
    uniq, seen = [], set()
    for h in sorted(hits, key=lambda h: (h["module"], h["line"], h["kind"])):
        k = (h["module"], h["line"], h["kind"])
        if k not in seen:
            seen.add(k)
            uniq.append(h)
    return uniq


# --------------------------------------------------------------------------------------- derin W parmak izi
def deep_w_fingerprint(W) -> dict[str, str]:
    """`derive_diff._fp` ile W alanları + `W` altındaki nesnelerin `__dict__` alanları (bir düzey): {ad: parmak izi}."""
    from bench.derive_diff import _fp
    out = {}
    for k, v in vars(W).items():
        out[k] = _fp(v)
        if isinstance(v, (list, tuple)) and len(v) <= 8 and all(isinstance(x, (int, float, bool, str)) for x in v):
            out[k] = repr(v)
        d = getattr(v, "__dict__", None)
        if isinstance(d, dict) and out[k].startswith("obj:"):
            for k2, v2 in d.items():
                out["%s.%s" % (k, k2)] = _fp(v2)
    return out


def params_fingerprint(params_mod) -> dict[str, str]:
    import types
    from bench.derive_diff import _fp_value_deep
    P = {}
    for name, v in vars(params_mod).items():
        if name.startswith("_") or name == "WEEKLY_CSV" or isinstance(v, (types.FunctionType, types.ModuleType, type, types.BuiltinFunctionType)) or callable(v):
            continue
        P[name] = _fp_value_deep(v)
    return P


# ------------------------------------------------------------------------------------------ alt süreç koşusu
def _child(spec_path, out_path):
    spec = _dec(json.load(open(spec_path)))
    mdl = C.Model(spec["build"])
    out = {}
    try:
        W = mdl.world(200, 5)
        if spec.get("fp"):
            out["fp"] = {"params": params_fingerprint(mdl.params), "w": deep_w_fingerprint(W)}
        patch = spec.get("patch")
        pw = spec.get("patch_week", 0)
        seq = {int(w): d for w, d in (spec.get("patches") or [])}      # [[hafta, {anahtar: değer}], ...] (yapısal geçiş)
        if patch is not None and pw == 0:
            livepatch.apply_overrides(mdl.mods, W, _as_model(patch))
        if 0 in seq:
            livepatch.apply_overrides(mdl.mods, W, seq[0])
        sfc = {"ok": True, "week": None, "gap": 0.0}
        meas = {n: [] for n in MEASURES} if spec.get("meas") else None
        for w in range(1, spec["weeks"] + 1):
            if patch is not None and pw and w == pw:
                livepatch.apply_overrides(mdl.mods, W, _as_model(patch))
            if w in seq:
                livepatch.apply_overrides(mdl.mods, W, seq[w])
            mdl.week_step(W, w, 200)
            if meas is not None:
                _measure(W, meas)
            if spec.get("sfc"):                                   # stok-akım tutarlılığı: toplam bakiye == basılan para
                L = getattr(W, "L", None)
                gap = abs(L.total() - L.minted) if L is not None else float("inf")
                sfc["gap"] = max(sfc["gap"], gap)
                if sfc["ok"] and not gap <= SFC_TOL * max(1.0, abs(L.minted if L is not None else 0.0)):
                    sfc.update(ok=False, week=w)
        if spec.get("sfc"):
            out["sfc"] = sfc
        if meas is not None:
            out["meas"] = meas
        out["rows"] = [hashlib.md5(r.encode()).hexdigest()[:12] for r in C.rows_json(W.wk_csv)]
    except Exception as e:                      # noqa: BLE001 (model hatası = ölçülemedi)
        out["error"] = "%s: %s" % (type(e).__name__, e)
    tmp = out_path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(out, fh)
    os.replace(tmp, out_path)


def _measure(W, meas):
    """Haftalık ana göstergeler: sunucunun yayımladığı talep karşılama, çalışan, şehir kasası; ve basım izni payı
    (tavan açıkken toplam izin, tavan kapalıyken para arzı: sınırsız izin para arzıyla sınırlı sayılır)."""
    r = W.wk_csv[-1]
    for n in ("talep_karsilama", "calisan", "sehir_kasasi"):
        meas[n].append(float(r[n]))
    L = W.L
    meas["basim_izni"].append(float(sum(L.allow.values())) if L.cap_on else float(L.total()))


def _as_model(d):
    return d


def _enc(v):
    if isinstance(v, tuple):
        return {"$tuple": [_enc(x) for x in v]}
    if isinstance(v, dict):
        return {k: _enc(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_enc(x) for x in v]
    return v


def _dec(v):
    if isinstance(v, dict):
        if set(v) == {"$tuple"}:
            return tuple(_dec(x) for x in v["$tuple"])
        return {k: _dec(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_dec(x) for x in v]
    return v


_HASH = ""
_LOCKS: dict = {}
_LOCKS_GUARD = threading.Lock()


def run_spec(spec: dict) -> dict:
    """Koşuyu önbellekten ya da alt süreçte yapar: {rows, fp?} | {error}."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    spec = _enc(spec)
    ident = hashlib.sha1(json.dumps([_HASH, spec], sort_keys=True, default=repr).encode()).hexdigest()[:20]
    path = CACHE_DIR / (ident + ".json")
    with _LOCKS_GUARD:
        lk = _LOCKS.setdefault(ident, threading.Lock())
    with lk:
        return _run_locked(spec, ident, path)


def _run_locked(spec, ident, path):
    if not path.is_file():
        sp = CACHE_DIR / (ident + ".spec")
        sp.write_text(json.dumps(spec))
        p = C.spawn_child("tools_classify_apply", ["--child", str(sp), str(path)])
        if p.wait() != 0 or not path.is_file():
            return {"error": "alt süreç başarısız"}
        sp.unlink(missing_ok=True)
    return json.loads(path.read_text())


# -------------------------------------------------------------------------------------------------- sınıflama
def _first_diff(a, b):
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i + 1
    return None


STRICT_FUNCS = {"__init__", "__post_init__", "build", "new_world", "start_world", "world_init"}


def proven_keys() -> set:
    """A1 canlı yama ölçümüyle (bench-sonuc.json) kanıtlanmış anahtarlar: türetim farkı yok, hafta 20 yaması ayrışıyor."""
    try:
        lp = json.loads(Path(C.RESULTS).read_text())["livepatch"]
    except (OSError, ValueError, KeyError, TypeError) as e:     # sessiz boş küme TRANS_SUPPORT'u da kilitlerdi: açık hata
        raise RuntimeError("A1 bench sonucu okunamadı (%s): %s" % (C.RESULTS, e)) from e
    return {k for k, v in lp.items() if v.get("diverges_after") and v.get("equal_before") and not v.get("derived_diff")}


def classify(key, ctx, value=None, *, trials=None, runner=None, sources=None, note=None):
    """Bir parametre için kanıtlı sınıf (DK-6). `trials`: [(değer, hafta)] denemeler (ilk etki görüleni kullanılır);
    `runner(spec)` koşucu (varsayılan: alt süreç + önbellek); `sources` AST kaynakları (varsayılan: model)."""
    run = runner or run_spec
    sources = read_sources() if sources is None else sources
    trials = trials or [(value, EQ_WEEKS)]
    hits = ast_scan(key, sources)
    res = {"class": "start_only", "reason": None, "equal_at_week0": False, "derived_diff": [], "ast_hits": hits,
           "init_reads": [h for h in hits if h["kind"] == "kurulus_okuma"],
           "w_copies": [h for h in hits if h["kind"] == "w_kopya"], "diverged_week": None,
           "context": {"ctx": dict(ctx), "trials": [list(t) for t in trials]}}
    if note:
        res["context"]["note"] = note
    base_cache: dict[int, dict] = {}

    def base(weeks):
        if weeks not in base_cache:
            base_cache[weeks] = run({"build": dict(ctx), "weeks": weeks, "fp": True})
        return base_cache[weeks]

    for tv, weeks in trials:
        b = base(weeks)
        a = run({"build": dict(ctx, **{key: tv}), "weeks": weeks, "fp": True})
        err = a.get("error") or b.get("error")
        if err:
            res["context"]["error"] = err
            continue
        if a["rows"] == b["rows"]:
            continue                                             # etki görülmedi: sonraki deneme
        eff = _first_diff(a["rows"], b["rows"])
        # eşitlik penceresi etki haftasına göre: etkiden sonra en az EQ_AFTER hafta (ufuk gerekirse uzar)
        eq_weeks = max(weeks, eff + EQ_AFTER)
        if eq_weeks > MAX_WEEKS:
            res["context"].update(trial=tv, weeks=weeks, effect_week=eff, error="etki geç: eşitlik penceresi %d haftayı aşar" % MAX_WEEKS)
            continue
        if eq_weeks != weeks:
            a2 = run({"build": dict(ctx, **{key: tv}), "weeks": eq_weeks, "fp": True})
            if a2.get("error"):
                res["context"]["error"] = a2["error"]
                continue
            a = a2
        res["context"].update(trial=tv, weeks=weeks, effect_week=eff, eq_weeks=eq_weeks)
        p = run({"build": dict(ctx), "patch": {key: tv}, "patch_week": 0, "weeks": eq_weeks})
        if p.get("error"):
            res["context"]["error"] = p["error"]
            break
        res["diverged_week"] = _first_diff(a["rows"], p["rows"])
        equal = a["rows"] == p["rows"]
        pd = sorted(n for n in set(a["fp"]["params"]) | set(b["fp"]["params"]) if n != key and a["fp"]["params"].get(n) != b["fp"]["params"].get(n))
        wd = sorted("W." + n for n in set(a["fp"]["w"]) | set(b["fp"]["w"]) if a["fp"]["w"].get(n) != b["fp"]["w"].get(n))
        res["derived_diff"] = pd + wd                            # eşit dalda da kayda yazılır
        res["equal_at_week0"] = equal
        mod = [h for h in hits if h["kind"] in ("modul_duzeyi", "varsayilan_arg")]
        if res["derived_diff"]:
            res["reason"] = "w_kopya" if (wd and not pd and res["w_copies"]) else "turetim"
            return res
        if equal:
            if mod:
                res["reason"] = "modul_duzeyi"                   # modül düzeyi türetim pencerede görünmese de canlı yamayı kırar
                return res
            strict = [h for h in hits if h["kind"] in ("kurulus_okuma", "w_kopya") and h["func"] in STRICT_FUNCS]
            if strict and key not in proven_keys():          # kuruluş işlevinde okuma: eşitlik tek başına yetmez (şüphede kilit)
                res.update({"class": "start_only", "reason": "kurulus_okuma"})
                res["context"]["equal_but_founding_read"] = True
                return res
            res["class"] = "live"
            return res
        if mod:
            res["reason"] = "modul_duzeyi"
        elif res["init_reads"]:
            res["reason"] = "kurulus_okuma"
        elif res["w_copies"]:
            res["reason"] = "w_kopya"
        else:                                                    # (d) ıraksama: hafta 20 yaması 100 haftada ayrışıyor mu
            bl = base(LONG_WEEKS)
            d = run({"build": dict(ctx), "patch": {key: tv}, "patch_week": PATCH_WEEK, "weeks": LONG_WEEKS})
            if d.get("error") or bl.get("error"):
                res["reason"] = "etki_olculemedi"
                res["context"]["error"] = d.get("error") or bl.get("error")
            else:
                first = _first_diff(bl["rows"], d["rows"])
                res["context"]["patch_diverged_week"] = first
                if first is not None and first >= PATCH_WEEK:
                    res["class"] = "live"
                else:
                    res["reason"] = "etki_olculemedi"
        return res
    res["reason"] = "etki_olculemedi"
    return res


# ---------------------------------------------------------------------------------------------- yön tutarlılığı
def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _effect(var, base, start):
    """`start`. haftadan (1 tabanlı) sonra, deneme koşusunun varsayılandan ilk anlamlı sapmasından DIR_SPAN hafta boyunca
    bağıl farkın (ölçü ölçeği: varsayılan serinin pencere ortalama büyüklüğü) ortalaması; sapma yoksa 0.

    Ölçülemeyen durumda `None` (E0, R2-ek2 M2: kapalı-başarısız ilkesi; "anlamlı değil" = live demek olurdu): pencere yok (kısa seri),
    pencerede NaN/sonsuz değer, ya da taban ölçeği 0 iken deneme serisi 0'dan ayrılıyor (bağıl fark tanımsız). İki seri de gerçekten
    0 ise etki yoktur: 0.0 (ölçülebilir)."""
    win = base[start - 1:]
    tail = var[start - 1:]
    if not win or not tail:
        return None
    if not all(math.isfinite(x) for x in win) or not all(math.isfinite(x) for x in tail):
        return None
    scale = _mean([abs(x) for x in win])
    if scale <= 1e-9:
        return 0.0 if all(abs(x) <= 1e-9 for x in tail) else None
    rel = [(v - b) / scale for v, b in zip(tail, win)]
    for i, x in enumerate(rel):
        if abs(x) > DIR_TOL:
            return _mean(rel[i:i + DIR_SPAN])
    return 0.0


def _material(x):
    return abs(x) > DIR_TOL


def direction_check(key, ctx, trial, *, runner=None) -> dict:
    """Aynı deneme değeriyle (b) hafta DIR_PATCH_WEEK'te yamalanan koşu ile (a) baştan kurulan koşunun ana göstergelerdeki
    ilk tepki işaretini karşılaştırır; ikisi de anlamlıysa ve işaretleri zıtsa o ölçüde yön ters. Ters = koşu ortası
    değişim, baştan değişimin tersini yapıyor (kart anlatımı yalnız biriyle doğru): kilit."""
    run = runner or run_spec
    out = {"ters": False, "ters_olcu": [], "measures": {}, "weeks": DIR_WEEKS, "patch_week": DIR_PATCH_WEEK, "tol": DIR_TOL}
    base = run({"build": dict(ctx), "weeks": DIR_WEEKS, "meas": True})
    b = run({"build": dict(ctx), "patch": {key: trial}, "patch_week": DIR_PATCH_WEEK, "weeks": DIR_WEEKS, "meas": True})
    err = base.get("error") or b.get("error")
    if err:
        out["error"] = err
        return out
    eb = {n: _effect(b["meas"][n], base["meas"][n], DIR_PATCH_WEEK + 1) for n in MEASURES if n in base["meas"]}
    bad = sorted(n for n, x in eb.items() if x is None)
    if bad:                                                      # ölçülemeyen etki sessizce "anlamlı değil" olmaz (güvenli taraf: start_only)
        out["olculemedi"] = bad
        out["error"] = "yön denetimi ölçülemedi: " + ", ".join(bad)
        return out
    if not any(_material(x) for x in eb.values()):
        out["measures"] = {n: {"a": None, "b": round(x, 4)} for n, x in eb.items()}
        return out                                               # koşu ortası değişim hiçbir ölçüyü oynatmıyor: karşılaştıracak işaret yok
    a = run({"build": dict(ctx, **{key: trial}), "weeks": DIR_WEEKS, "meas": True})
    if a.get("error"):
        out["error"] = a["error"]
        return out
    xas = {n: _effect(a["meas"][n], base["meas"][n], 1) for n in eb}
    bad = sorted(n for n, x in xas.items() if x is None)
    if bad:
        out["olculemedi"] = bad
        out["error"] = "yön denetimi ölçülemedi: " + ", ".join(bad)
        return out
    for n, xb in eb.items():
        xa = xas[n]
        rev = _material(xa) and _material(xb) and (xa > 0) != (xb > 0)
        out["measures"][n] = {"a": round(xa, 4), "b": round(xb, 4), "ters": bool(rev)}
        if rev:
            out["ters_olcu"].append(n)
    out["ters"] = bool(out["ters_olcu"])
    return out


def audit_values(vals: list) -> list:
    """Yön denetimi değerleri: deneme listesinin son iki öğesi (sayıda iki uç; ±1 adım uçlarla çakışmışsa onlar)."""
    return list(vals[-2:])


def direction_audit(key, ctx, vals, *, runner=None) -> dict:
    by = {str(v): direction_check(key, ctx, v, runner=runner) for v in audit_values(vals)}
    return {"ters": any(x["ters"] for x in by.values()), "ters_olcu": sorted({n for x in by.values() for n in x["ters_olcu"]}),
            "error": next((x["error"] for x in by.values() if x.get("error")), None), "by_value": by}


def is_structural(codec: dict) -> bool:
    """Yapısal anahtar: bool ya da en çok 3 değerli enum (iki durumlu {0,1}, ORDER_BOOK/TRANS_SUPPORT {0,1,2}, SB_ENTRY_PERSIST {-1, 0.02}):
    açıkken biriken durum kapanışta sahipsiz kalabilir. Süre/oran basamakları (4+ değer) sayı gibi davranır, kapsam dışı."""
    t = codec["type"]
    if t == "bool":
        return True
    return t == "enum" and 2 <= len({repr(v) for v in codec["map"].values()}) <= 3


STRUCT_WEEKS = 100
STRUCT_OPEN, STRUCT_CLOSE = 20, 60


def structural_check(key, ctx, trial, default, *, runner=None) -> dict:
    """Yapısal bayrak için iki yönlü geçiş: (ileri) varsayılan kurulur, hafta 20 deneme değerine, hafta 60 varsayılana;
    (ters) deneme değeriyle kurulur, hafta 20 varsayılana, hafta 60 deneme değerine. İki koşuda hata yok ve para korunumu (SFC) sürmeli."""
    run = runner or run_spec
    out = {"ok": True, "runs": {}}
    legs = {"ileri": (dict(ctx), trial, default), "ters": (dict(ctx, **{key: trial}), default, trial)}
    for name, (build, first, second) in legs.items():
        r = run({"build": build, "weeks": STRUCT_WEEKS, "sfc": True,
                 "patches": [[STRUCT_OPEN, {key: first}], [STRUCT_CLOSE, {key: second}]]})
        sfc = r.get("sfc") or {}
        ok = not r.get("error") and bool(sfc.get("ok"))
        out["runs"][name] = {"ok": ok, "error": r.get("error"), "sfc_week": sfc.get("week"), "sfc_gap": sfc.get("gap")}
        out["ok"] = out["ok"] and ok
    return out


def structural_values(key, ctx, trials, default, *, runner=None) -> dict:
    """`structural_check`'i varsayılan-dışı her deneme değeri için koşar (çok değerli enum: her değer çifti varsayılanla)."""
    by_value = {str(v): structural_check(key, ctx, v, default, runner=runner) for v in trials}
    return {"ok": all(x["ok"] for x in by_value.values()), "by_value": by_value}


# --------------------------------------------------------------------------------- kart ve denemeler (kayıt)
def load_cards() -> list[dict]:
    out = []
    for f in sorted(glob.glob(str(REGISTRY_DIR / "settings.*.json"))):
        out += json.loads(Path(f).read_text(encoding="utf-8"))["settings"]
    return out


def classifiable(card) -> bool:
    return card["status"] in ("active", "experimental") and bool(card.get("editable")) and card["codec"]["type"] != "seed"      # D7: deneysel (düzenlenebilir) kartlar da sınıflanır


def card_fields(card):
    """[(param, codec)] kartın sınanacak parametreleri."""
    c = card["codec"]
    if c["type"] == "fields":
        return [(f["param"], f["codec"]) for f in c["fields"]]
    return [(c.get("param") or card["params"][0], c)]


def _same(a, b):
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    return a == b


def _state_value(ref: dict, state):
    """Başka kartın durumunun (bool/enum) model parametre değeri: (param, değer) | None."""
    c = ref["codec"]
    if c["type"] == "bool" and isinstance(state, bool):
        return ref["params"][0], (c["on"] if state else c["off"])
    if c["type"] == "enum" and state in c["map"]:
        return ref["params"][0], c["map"][state]
    return None


# Genç firmalar kuruluş akışıyla (ENTRY_OPEN) doğar: ENTRY_OPEN kapalıyken YOUNG_KIT parametreleri (YK_RUNWAY_WEEKS) neredeyse etkisiz
IMPLIED_CTX = {"YOUNG_KIT": {"ENTRY_OPEN": 1}}
# D6: alt parametre yalnız ana seçenek belirli bir değerdeyken etkilidir (fields kartının enum alanı; yukarıdaki bool kuralı bunu görmez):
# sınanan parametre için ana alan bu değerde kurulur (varsayılan değer etkisiz kalır ve parametre haksız yere start_only olurdu).
PARAM_CTX = {"AHIR_MOVE_PREMIUM": {"AHIR_MOVE": 1}, "AHIR_TARGET": {"PLAYER_INFLOW": 1},
             "PLAYER_INFLOW_RATE": {"PLAYER_INFLOW": 2}, "PLAYER_MAX_PER_CITY": {"PLAYER_INFLOW": 2},
             "NPC_POOL_FLOOR": {"NPC_POOL_TAX": 0.1},          # D9: havuz vergisi eşiği yalnız vergi oranı sıfırdan büyükken etkilidir
             "SHRINK_CAP": {"STAFF_ADJ": 1}, "GROW_CAP": {"STAFF_ADJ": 1},                 # D10: kadro hızı sınırları yalnız kural açıkken etkilidir
             "JG_WAGE": {"MUNI_POOL": 1}, "JG_MAX": {"MUNI_POOL": 1},                       # D10: belediyedeki NPC ücreti ve üst sınırı yalnız kamu istihdamı havuza açıkken
             "DISC_RATE": {"DISCOURAGE_WEEKS": 4}, "DISC_RETURN": {"DISCOURAGE_WEEKS": 4},  # D10: çıkış ve dönüş olasılıkları yalnız bekleme süresi tanımlıyken
             "GHOST_WEEKS": {"GHOST_MODE": 2}, "GHOST_MODE": {"GHOST_WEEKS": 4}}              # D11: kapanış haftası yalnız kural açıkken etkilidir; kural da kısa bir süreyle sınanır (etki 100 hafta içinde görünsün)


def card_ctx(card, dfl: dict, param: str, by_id: dict | None = None) -> dict:
    """Sınanan parametrenin okunduğu bağlam (alt alan 'ana bayrak AÇIKKEN' sınanır):
      1) fields kartının ilk bool alanı kapalıysa AÇIK (sınanan parametrenin kendisi bağlama girmez);
      2) kartın `requires` listesinde kartın kendi parametreleri DIŞINDA kalan bayraklar (varsayılanı 0/kapalı) AÇIK;
      3) `effective_when`: başka kartların gereken durumu (bool/enum kod çözülür) varsayılandan farklıysa uygulanır."""
    by_id = by_id or {}
    ctx: dict = {}
    c = card["codec"]
    if c["type"] == "fields":
        for f in c["fields"]:
            if f["codec"]["type"] == "bool":
                if f["param"] != param and not _same(dfl.get(f["param"]), f["codec"]["on"]) and (dfl.get(f["param"]) != f["codec"]["on"]):
                    ctx[f["param"]] = f["codec"]["on"]
                break
    own = set(card.get("params") or [])
    for r in card.get("requires") or []:
        if r in own or r == param or r not in dfl:
            continue
        if isinstance(dfl[r], (bool, int, float)) and not dfl[r]:
            ctx[r] = 1
    for cid, state in (card.get("effective_when") or {}).items():
        ref = by_id.get(cid)
        pv = _state_value(ref, state) if ref else None
        if pv and pv[0] != param and dfl.get(pv[0]) != pv[1]:
            ctx[pv[0]] = pv[1]
    ctx.update(PARAM_CTX.get(param, {}))
    for flag, implied in IMPLIED_CTX.items():       # bağlam bayrağı kendi başına etkisiz: bağımlı bayraklar da açılır
        if ctx.get(flag) and not own & set(implied):
            for k, v in implied.items():
                if k in dfl and k != param and not dfl[k]:
                    ctx[k] = v
    return ctx


def trial_values(codec: dict, default) -> list:
    """Denemeler (codec geçerli, varsayılandan farklı): bool ters; sayı ±1 adım ve uç; enum sonraki seçenek; çoklu: son öğe düşer."""
    t = codec["type"]
    out = []
    if t == "bool":
        out.append(codec["off"] if _same(default, codec["on"]) or default == codec["on"] else codec["on"])
    elif t == "enum":
        opts = [v for v in codec["map"].values() if not (v == default and isinstance(v, bool) == isinstance(default, bool))]
        out += opts[:2]
    elif t == "number":
        sc, mn, mx, st = codec["scale"], codec["min"], codec["max"], codec.get("step") or 1
        ui = round(float(default) * sc, 9)
        far, near = (mx, mn) if abs(mx - ui) >= abs(ui - mn) else (mn, mx)
        cands = [ui + st, ui - st, far, near]       # iki uç da: alt eşikte bağlayan parametrelerin etkisi yalnız orada görünür
        for u in cands:
            if mn - 1e-9 <= u <= mx + 1e-9 and abs(u - ui) > 1e-9:
                v = round(u / sc, 12)
                v = int(v) if codec.get("integer") and sc == 1 else v
                if v not in out:
                    out.append(v)
    elif t == "multi":
        items = list(default)
        if len(items) > 1:
            out.append(tuple(items[:-1]))
        out.append(tuple(codec["items"]))
        out = [x for x in out if tuple(x) != tuple(default)]
    return out


def plan_trials(values: list) -> list:
    """[(değer, hafta)]: 40 hafta her değer; etkisiz kalırsa son değer 100 hafta."""
    return [(v, EQ_WEEKS) for v in values] + ([(values[-1], LONG_WEEKS)] if values else [])


def notes_start_only() -> dict:
    p = REGISTRY_DIR / "r2_apply_notlari.json"
    if not p.is_file():
        return {}
    return {n["param"]: n["neden"] for n in json.loads(p.read_text(encoding="utf-8")).get("start_only", [])}


def build_jobs(cards, dfl):
    """[(param, ctx, kart kimlikleri, codec)] — her parametre bir kez (ilk kartın bağlamı)."""
    jobs, seen = [], {}
    by_id = {c["id"]: c for c in cards}
    for card in cards:
        if not classifiable(card):
            continue
        for param, codec in card_fields(card):
            if param in seen:
                seen[param][2].append(card["id"])
                continue
            seen[param] = (param, card_ctx(card, dfl, param, by_id), [card["id"]], codec)
            jobs.append(seen[param])
    return jobs


# --------------------------------------------------------------------------------------------------- sürücü
def key_path(param):
    return KEYS_DIR / (param + ".json")


def classify_job(job, dfl, notes, sources):
    param, ctx, card_ids, codec = job
    if param in notes:
        r = classify_static(param, ctx, notes[param], sources)
    elif param not in dfl:
        r = classify_static(param, ctx, "model varsayılanı okunamaz (JSON dışı)", sources)
        r["reason"] = "etki_olculemedi"
    else:
        vals = trial_values(codec, dfl[param])
        if not vals:
            r = classify_static(param, ctx, "deneme değeri üretilemedi", sources)
            r["reason"] = "etki_olculemedi"
        else:
            r = classify(param, ctx, trials=plan_trials(vals), sources=sources)
            if r["class"] == "live" and is_structural(codec):
                st = structural_values(param, ctx, vals, dfl[param])
                r["context"]["structural"] = st
                if not st["ok"]:
                    r.update({"class": "start_only", "reason": "yapisal_gecis"})
            elif r["class"] == "live" and codec["type"] == "number":
                yon = direction_audit(param, ctx, vals)
                r["context"]["yon"] = yon
                if yon["error"]:
                    r.update({"class": "start_only", "reason": "etki_olculemedi"})
                    r["context"]["error"] = yon["error"]
                elif yon["ters"]:
                    r.update({"class": "start_only", "reason": "yon_ters"})
    if param in KEY_LOCKS:
        r.update({"class": "start_only", "reason": "anahtar_kilidi"})
        r["context"]["kilit"] = KEY_LOCKS[param]
    r["cards"] = card_ids
    return r


def classify_static(param, ctx, note, sources):
    hits = ast_scan(param, sources)
    return {"class": "start_only", "reason": "modul_duzeyi", "equal_at_week0": False, "derived_diff": [], "ast_hits": hits,
            "init_reads": [h for h in hits if h["kind"] == "kurulus_okuma"], "w_copies": [h for h in hits if h["kind"] == "w_kopya"],
            "diverged_week": None, "context": {"ctx": dict(ctx), "note": note}}


KEY_LOCKS = {
    "MINT_OPEN_WEEKS": "elle start_only (anahtar kilidi; R2-ek2, inceleme I1): week_open.py:103 `MONEY_CAP and w > MINT_OPEN_WEEKS` ile açılan `L.cap_on` "
                       "mandalı hiç sıfırlanmaz. Süre koşu ortasında uzatılırsa tavan açık kalır, ama izin birikimi pencere boyunca durur: şehir "
                       "daha az basabilir (kart anlatımı 'açılışta daha rahat harcar' diyor). Baştan uzatma tavanı geciktirir (gevşetir), koşu "
                       "ortasında uzatma sıkılaştırır: ters ve geriye dönük etki. Model düzeltmesi yapılırsa live olabilir",
    "PATENT_TERM": "elle start_only (anahtar kilidi; R2-ek2, inceleme I2): tech.py:130-131 her hafta `PUB = front_hist[len-1-PATENT_TERM]` hesaplar. "
                   "Süre koşu ortasında uzatılırsa geçmiş indeksi geriye düşer; süresi dolmuş buluşlar yeniden patentli sayılır, kamu malı "
                   "olanlar geri alınır (DAO KD mandalı ve telif tahsili eski bilgiyi yeniden ödetir). Gerçekte süre uzatan yasa dolmuş patenti "
                   "geri getirmez: geriye dönük etki. Model düzeltmesi (PUB'u tekdüze tutmak) yapılırsa live olabilir",
}

CARD_LOCKS = {"zararda_once_kucul": "elle start_only (kayıtta önceden konmuş; R2 gevşetmez): SHRINK_FIRST anahtarı kanıtta live ölçüldü, ama kart "
                                    "anlatımı modelle birebir değil (R1c incelemesi: koşulsuz küçülme, kıtlıkta büyüme yalnız yerleşik firmada, fiyat primi tüm firmalarda) "
                                    "ve kart V (dünya varsayımı) katmanında; şüphede kilit. Kanıt anahtar düzeyinde, kilit kart düzeyinde"}


def assemble(cards, keys, dfl_hash):
    out_cards, card_reasons = {}, {}
    for card in cards:
        if not classifiable(card):
            continue
        ps = [p for p, _ in card_fields(card)]
        if all(p in keys for p in ps):
            cls = max((keys[p]["class"] for p in ps), key=RANK.get)
            if card["id"] in CARD_LOCKS and cls != "start_only":
                cls = "start_only"                      # kart kimliğine bağlı elle kilit (gevşetilmez); neden kayda yazılır
                card_reasons[card["id"]] = CARD_LOCKS[card["id"]]
            out_cards[card["id"]] = cls
    return {"model_defaults_hash": dfl_hash, "keys": dict(sorted(keys.items())), "cards": dict(sorted(out_cards.items())),
            "card_reasons": dict(sorted(card_reasons.items()))}


def write_registry(cards_cls: dict):
    """Kayıt dosyalarında yalnız `apply` değerini yerinde değiştirir (biçim korunur)."""
    import re
    for f in sorted(glob.glob(str(REGISTRY_DIR / "settings.*.json"))):
        text = Path(f).read_text(encoding="utf-8")
        orig = text
        for cid, cls in cards_cls.items():
            m = re.search(r'"id":\s*"%s"' % re.escape(cid), text)
            if not m:
                continue
            m2 = re.compile(r'"apply":\s*"[a-z_]+"').search(text, m.end())
            if m2:
                text = text[:m2.start()] + '"apply": "%s"' % cls + text[m2.end():]
        if text != orig:
            Path(f).write_text(text, encoding="utf-8")


def main(argv=None):
    global _HASH
    ap = argparse.ArgumentParser()
    ap.add_argument("--child", nargs=2)
    ap.add_argument("--jobs", type=int, default=min(4, max(1, (os.cpu_count() or 4) - 2)))
    ap.add_argument("--only")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--budget", type=float, default=0, help="saniye: bu süreden sonra yeni parametre başlatılmaz")
    ap.add_argument("--write-registry", action="store_true")
    a = ap.parse_args(argv)
    if a.child:
        return _child(*a.child)
    a.jobs = max(1, min(a.jobs, 3))
    from oyun_server.registry import defaults
    dfl = defaults.read_param_defaults(str(C.MODEL_ROOT))
    _HASH = dfl_hash = defaults.defaults_hash(dfl)
    cards = load_cards()
    jobs = build_jobs(cards, dfl)
    if a.only:
        only = set(a.only.split(","))
        jobs = [j for j in jobs if j[0] in only]
    notes, sources = notes_start_only(), read_sources()
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    keys, lock, t0 = {}, threading.Lock(), time.time()
    for j in jobs:
        kp = key_path(j[0])
        if kp.is_file():
            d = json.loads(kp.read_text())
            if d.get("_hash") == dfl_hash and a.resume:      # --only yeniden ölçer (eski kayıt kilitlemez); koşu önbelleği yine kullanılır
                keys[j[0]] = d["r"]

    def work(job):
        if a.budget and time.time() - t0 > a.budget:
            return
        t1 = time.time()
        r = classify_job(job, dfl, notes, sources)
        with lock:
            keys[job[0]] = r
            key_path(job[0]).write_text(json.dumps({"_hash": dfl_hash, "r": r}))
            print("%-22s %-10s %-16s %5.0fs  (%d/%d)" % (job[0], r["class"], r["reason"] or "-", time.time() - t1, len(keys), len(jobs)), flush=True)

    todo = [j for j in jobs if j[0] not in keys]
    # ortak taban koşuları önce (bağlam başına bir kez; ağır) — önbelleğe yazılır
    ctxs = {json.dumps(j[1], sort_keys=True): j[1] for j in todo if j[0] not in notes}
    with ThreadPoolExecutor(max_workers=a.jobs) as ex:
        list(ex.map(lambda c: run_spec({"build": dict(c), "weeks": LONG_WEEKS, "fp": True}) if not a.budget or time.time() - t0 < a.budget else None, ctxs.values()))
        list(ex.map(lambda c: run_spec({"build": dict(c), "weeks": DIR_WEEKS, "meas": True}) if not a.budget or time.time() - t0 < a.budget else None, ctxs.values()))
        list(ex.map(work, todo))
    if not a.only:
        all_keys = {}
        for j in build_jobs(cards, dfl):
            kp = key_path(j[0])
            if kp.is_file() and json.loads(kp.read_text()).get("_hash") == dfl_hash:
                all_keys[j[0]] = json.loads(kp.read_text())["r"]
        res = assemble(cards, all_keys, dfl_hash)
        res["complete"] = len(all_keys) == len(build_jobs(cards, dfl))
        OUT_PATH.write_text(json.dumps(res, indent=1, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        print("yazıldı: %s (%d anahtar, %d kart, tam=%s)" % (OUT_PATH.name, len(res["keys"]), len(res["cards"]), res["complete"]))
        if a.write_registry and res["complete"]:
            write_registry(res["cards"])
    return 0


if __name__ == "__main__":
    C.ensure_hashseed("tools_classify_apply")
    sys.exit(main())
