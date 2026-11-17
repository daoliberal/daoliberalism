"""simkit.cli: komut satırı bayrakları (plan v2 adım 9).

AMAÇ: `python3 model_mod.py [--weeks N] [--cities N] [--ahir-kamu 0|1]` bayraklarını ayrıştırır; koşuyu ve yazdırmayı model_mod.py yapar
(AHIR_KAMU modül düzeyi ataması orada kalır: araçlar `m.AHIR_KAMU` atayabilir).
ARAYÜZ: parse_args(default_cities, argv=None) -> argparse.Namespace(weeks, cities, ahir_kamu)
KATMAN: L0 (bağımsız).
"""
import argparse


def parse_args(default_cities, argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=8)
    ap.add_argument("--cities", type=int, default=default_cities)
    ap.add_argument("--ahir-kamu", type=int, default=1)
    return ap.parse_args(argv)
