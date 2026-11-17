#!/usr/bin/env python3
"""model_mod: kâğıt üstü oyun modelinin İNCE SARMALAYICISI (plan v2 adım 9). Davranış `../model.py` ile bayt bayt aynıdır.

AMAÇ: eski tek dosyalı model.py arayüzünü korur; gerçek kod `simkit/` paketindedir (mimari özeti simkit/__init__.py; modül haritası
atamalar/modules_v2.json; kapı tools/gate.py).
ARAYÜZ:
  run(weeks, n_cities, trace_sink=None) -> R   koşuyu oynatır, sonuç sözlüğü (anahtar sözleşmesi golden/results_keys.json + tek ek anahtar `rt`)
  report(weeks, n_cities) -> str   koşu + rapor metni
  CITIES, Ledger, AHIR_KAMU        araçların kullandığı adlar; `AHIR_KAMU` bu modülde okunur (`m.AHIR_KAMU = ...` run()'dan önce atanabilir)
  CLI: python3 model_mod.py [--weeks N] [--cities N] [--ahir-kamu 0|1]; MODEL_PARAMS ortam değişkeni simkit/params.py'de okunur.
KATMAN: L12 (en üst; yalnız simkit'e bağlı).
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from simkit.params import CITIES, AHIR_KAMU          # noqa: F401
from simkit.ledger import Ledger          # noqa: F401
from simkit.world_init import new_world
from simkit.engine import run_world
from simkit.report import build_report
from simkit.cli import parse_args


def run(weeks, n_cities, trace_sink=None):
    """Koşuyu oynatır ve sonuç sözlüğü R'yi döndürür (AHIR_KAMU bu modülün düzeyinde okunur: CLI/araçlar `m.AHIR_KAMU = ...` atar).
    trace_sink: hata ayıklama izi (DBG* bayrakları) için işlev(metin); verilmezse iz stderr'e gider (simkit/trace.py)."""
    W = new_world(weeks, n_cities, AHIR_KAMU)
    W.trace_sink = trace_sink
    run_world(W, weeks)
    return W.results()


def report(weeks, n_cities):
    """Koşu + rapor metni (arayüz aynı: report(weeks, n_cities))."""
    R = run(weeks, n_cities)
    return build_report(R, weeks, n_cities, AHIR_KAMU)


if __name__ == "__main__":
    a = parse_args(CITIES)
    AHIR_KAMU = bool(a.ahir_kamu)
    print(report(a.weeks, a.cities))
