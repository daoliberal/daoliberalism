#!/usr/bin/env python3
"""Kapsam kapısı: geçersiz kılınabilir model adları ya kayıtta ya da coverage_baseline.json'da olmalı.

  PYTHONPATH=<server> python3 -P tools_registry_coverage.py --check
  PYTHONPATH=<server> python3 -P tools_registry_coverage.py --write-baseline
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from oyun_server import config                       # noqa: E402
from oyun_server.registry import defaults, loader     # noqa: E402


def compute(data_dir: Path, model_root: str):
    d = defaults.read_param_defaults(model_root)
    names = defaults.overridable_names(model_root, d)
    reg = loader.load_registry(data_dir, d)
    registered = {p for s in reg.settings + reg.hidden for p in s.params}
    return names, registered, names - registered


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--write-baseline", action="store_true")
    ap.add_argument("--data-dir", default=str(loader.DEFAULT_DATA_DIR))
    ap.add_argument("--model-root", default=str(config.MODEL_ROOT))
    ap.add_argument("--note", default=None, help="--write-baseline: baseline'ın not alanı")
    a = ap.parse_args(argv)
    data_dir = Path(a.data_dir)
    names, registered, unregistered = compute(data_dir, a.model_root)
    path = data_dir / "coverage_baseline.json"
    if a.write_baseline:
        default_note = "Kayıtsız, geçersiz kılınabilir model adları (tools_registry_coverage.py --write-baseline)."
        doc = {"note": a.note or default_note,
               "names": sorted(unregistered)}
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"baseline yazıldı: {len(unregistered)} ad (kayıtlı {len(names & registered)})")
        return 0
    baseline = set(json.loads(path.read_text(encoding="utf-8"))["names"])
    missing, stale = sorted(unregistered - baseline), sorted(baseline - names)
    overlap = sorted(baseline & registered)
    if missing:
        print("HATA: yeni bayrak için kayıt ekle (ya da baseline'a gerekçeyle yaz): " + ", ".join(missing))
    if stale:
        print("HATA: baseline'da modelde olmayan ad var: " + ", ".join(stale))
    if overlap:
        print("HATA: baseline'da zaten kayıtlı ad var (baseline'dan çıkar): " + ", ".join(overlap))
    if not missing and not stale and not overlap:
        print(f"kapsam tamam: {len(names)} ad, {len(baseline)} baseline'da")
    return 1 if (missing or stale or overlap) else 0


if __name__ == "__main__":
    sys.exit(main())
