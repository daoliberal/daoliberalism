"""derive_diff: türetim farkı kapısı (PLAN-CANLI §2.6).

diff_key(key, new_value) -> {params_diff: [str], w_diff: [str]}
İki alt süreçte (her biri tek build) `Params()` ve `Params(KEY=yeni)` kurulur; `simkit.params` üst düzey adları (anahtarın kendisi hariç;
işlev/modül/sınıf atlanır) ve `new_world(200,5,True)` sonrası `W.__dict__` parmak izi karşılaştırılır. Anahtar dışı herhangi bir fark:
o ayar yalnız `params` küresellerini yamayarak canlı uygulanamaz (start_only ya da özel W_SYNC tarifi gerekir).
"""
import hashlib
import json
import os
import shutil
import sys
import tempfile
import types

from bench._common import Model, ensure_hashseed, spawn_child


def _fp(v):
    """Değer parmak izi: skaler tam, kapsayıcı için (tür, boyut, anahtar kümesi özeti ve içerik özeti)."""
    if isinstance(v, (bool, int, float, str, type(None))):
        return repr(v)
    if isinstance(v, (tuple, list)):
        return "%s:%d:%s" % (type(v).__name__, len(v), hashlib.md5(repr(v).encode()).hexdigest()[:10])
    if isinstance(v, dict):
        return "dict:%d:%s" % (len(v), hashlib.md5(repr(sorted(map(repr, v.keys()))).encode()).hexdigest()[:10])
    if isinstance(v, (set, frozenset)):
        return "set:%d:%s" % (len(v), hashlib.md5(repr(sorted(map(repr, v))).encode()).hexdigest()[:10])
    return "obj:" + type(v).__name__


def _fp_value_deep(v):
    """params için içerik düzeyinde özet (sözlük/küme değerleri dahil)."""
    try:
        return hashlib.md5(repr(v if not isinstance(v, (set, frozenset)) else sorted(map(repr, v))).encode()).hexdigest()[:12]
    except Exception:
        return "?"


def fingerprint(overrides):
    mdl = Model(overrides)
    P = {}
    for name, v in vars(mdl.params).items():
        if name.startswith("_") or name == "WEEKLY_CSV" or isinstance(v, (types.FunctionType, types.ModuleType, type, types.BuiltinFunctionType)) or callable(v):
            continue
        P[name] = _fp_value_deep(v)
    W = mdl.world(200, 5)
    Wf = {k: _fp(v) for k, v in vars(W).items()}
    # W içindeki kapsayıcıların skaler içerikleri (ör. W.TAXV[0], W.MM_BASE[0]) farkı da görünsün
    for k, v in vars(W).items():
        if isinstance(v, (list, tuple)) and len(v) <= 8 and all(isinstance(x, (int, float, bool, str)) for x in v):
            Wf[k] = repr(v)
    return {"params": P, "w": Wf}


def diff_key(key, new_value):
    tmp = tempfile.mkdtemp(prefix="oyun-dd-")
    try:
        paths = [os.path.join(tmp, "base.json"), os.path.join(tmp, "new.json")]
        procs = [spawn_child("bench.derive_diff", ["--fp", paths[0], "{}"]),
                 spawn_child("bench.derive_diff", ["--fp", paths[1], json.dumps({key: new_value})])]
        for p in procs:
            if p.wait() != 0:
                raise RuntimeError("derive_diff alt sürecı başarısız")
        base, new = (json.load(open(p)) for p in paths)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    params_diff = sorted(n for n in set(base["params"]) | set(new["params"]) if n != key and base["params"].get(n) != new["params"].get(n))
    w_diff = sorted(n for n in set(base["w"]) | set(new["w"]) if base["w"].get(n) != new["w"].get(n))
    return {"params_diff": params_diff, "w_diff": w_diff}


def main():
    ensure_hashseed("bench.derive_diff")
    if len(sys.argv) > 3 and sys.argv[1] == "--fp":
        with open(sys.argv[2], "w") as fh:
            json.dump(fingerprint(json.loads(sys.argv[3])), fh)
        return
    from bench._common import LIVE_KEYS
    for k, v in LIVE_KEYS.items():
        print(k, v, diff_key(k, v))


if __name__ == "__main__":
    main()
