"""simkit.cash_core: K-219/K-220 durum kapsayıcısı (W.kk) ve ortak sabitler.

ARAYÜZ: kk_state(W), PK_MULT, TR_NOSPEND
OKUR/YAZAR: W.kk. KATMAN: L0 (yalnız params).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403

PK_MULT = PK_WEEKS * CYCLES_PER_WEEK / WORKING_CAPITAL_CYCLES      # işletme sermayesi (2 döngü) cinsinden tampon çarpanı (8 hf x 7 / 2 = 28)
TR_NOSPEND = ("belediye", "ahir", "arge", "medya")                  # K-219 hizmet alımı almayan türler


def kk_state(W):
    s = getattr(W, "kk", None)
    if s is None:
        s = W.kk = dict(stat=defaultdict(float), prev={}, mine={}, ema={}, muni={}, res_w=-1, res={}, rbar=0.0, rbar_w=-1, rbar_raw=0.0)
    return s
