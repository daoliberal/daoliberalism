"""Tüm tests/test_*.py modüllerini ayrı süreçlerde koşar. `--quick`: OYUN_QUICK=1 (yavaş testler atlanır)."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent.parent


def run_module(name: str, quick: bool):
    env = dict(os.environ, PYTHONHASHSEED="0", PYTHONPATH=str(SERVER_ROOT), PYTHONDONTWRITEBYTECODE="1")
    if quick:
        env["OYUN_QUICK"] = "1"
    p = subprocess.run([sys.executable, "-P", "-m", "unittest", f"tests.{name}"], cwd=SERVER_ROOT, env=env,
                       capture_output=True, text=True)
    return name, p.returncode, p.stdout + p.stderr


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("-j", type=int, default=1, help="paralel süreç (en çok 3)")
    ap.add_argument("modules", nargs="*", help="yalnız bu modüller (örn. test_security)")
    a = ap.parse_args(argv)
    names = a.modules or sorted(p.stem for p in (SERVER_ROOT / "tests").glob("test_*.py"))
    jobs = max(1, min(a.j, 3))
    failed = []
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        for name, rc, out in ex.map(lambda n: run_module(n, a.quick), names):
            last = [l for l in out.strip().splitlines() if l][-1:] or [""]
            print(f"{'OK  ' if rc == 0 else 'FAIL'} {name}: {last[0]}")
            if rc != 0:
                failed.append(name)
                print(out)
    print(f"{len(names) - len(failed)}/{len(names)} modül yeşil" + (" (hızlı mod)" if a.quick else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
