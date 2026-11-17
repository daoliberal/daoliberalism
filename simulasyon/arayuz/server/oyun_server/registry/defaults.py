"""Model varsayılanları: alt süreçte okunur; ana süreç `simkit`i hiç içe aktarmaz."""
from __future__ import annotations

import ast
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

_ENV_KEEP = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SYSTEMROOT")
_EXCLUDED = {"REF_BASE", "STAGES", "TOPO0"}

_CODE = r"""
import json, math, sys
import simkit.params as p
out = {}
for k, v in vars(p).items():
    if k.startswith("_"):
        continue
    if v is not None and not isinstance(v, (bool, int, float, str, tuple, list, dict, set, frozenset)):
        continue
    if isinstance(v, (set, frozenset)):
        continue
    try:
        json.dumps(v, allow_nan=False)
    except (TypeError, ValueError):
        continue
    out[k] = v
sys.stdout.write(json.dumps(out, allow_nan=False))
"""


def _child_env(model_root: str) -> dict[str, str]:
    env = {k: os.environ[k] for k in _ENV_KEEP if k in os.environ}
    env["PYTHONPATH"] = str(model_root)           # MODEL_PARAMS / WEEKLY_CSV bilerek yok
    env["PYTHONHASHSEED"] = "0"
    return env


def read_param_defaults(model_root: str) -> dict[str, Any]:
    """`simkit.params` üst düzey JSON-serileştirilebilir sabitleri (temiz ortamlı alt süreç)."""
    r = subprocess.run([sys.executable, "-P", "-c", _CODE], env=_child_env(model_root), cwd=str(model_root),
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"model varsayılanları okunamadı: {r.stderr.strip()[-400:]}")
    return json.loads(r.stdout)


def model_version(model_root: str) -> str:
    return str(read_param_defaults(model_root)["VERSION"])


def defaults_hash(d: dict[str, Any]) -> str:
    blob = json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def overridable_names(model_root: str, d: dict[str, Any] | None = None) -> set[str]:
    """MODEL_PARAMS ile geçersiz kılınabilen adlar: `params.py`'de geçersiz kılma döngüsünden ÖNCE
    tanımlı, değeri skaler/demet/liste olan ad (sözlük şablonları, REF_BASE, *_ACT, STAGES, TOPO0 hariç)."""
    if d is None:
        d = read_param_defaults(model_root)
    tree = ast.parse((Path(model_root) / "simkit" / "params.py").read_text(encoding="utf-8"))
    names: set[str] = set()

    def targets(t):
        if isinstance(t, ast.Name):
            yield t.id
        elif isinstance(t, (ast.Tuple, ast.List)):
            for e in t.elts:
                yield from targets(e)

    for node in tree.body:
        if isinstance(node, ast.For) and "MODEL_PARAMS" in ast.dump(node.iter):
            break
        if isinstance(node, ast.Assign):
            for t in node.targets:
                names.update(targets(t))
        elif isinstance(node, ast.AnnAssign):
            names.update(targets(node.target))
    out = set()
    for n in names:
        if n.startswith("_") or n in _EXCLUDED or n.endswith("_ACT") or n not in d:
            continue
        v = d[n]
        if isinstance(v, (bool, int, float, str, list)):     # demetler JSON'da liste
            out.add(n)
    return out
