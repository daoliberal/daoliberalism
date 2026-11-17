"""simkit.pricing_step: haftalık fiyat adımı: fp_step.

ARAYÜZ: fp_step
OKUR/YAZAR: W.firms, W.PRICE, W.L ve altındaki modülleri çağırır.
KATMAN: L5 (en derin işlev).
"""
from functools import partial
from simkit.params import *          # noqa: F401,F403
from simkit.media import ad_step, media_dyn, media_found
from simkit.prices import fc_step, fp_prices, fp_prices_v2, rent_account, v2_acct
from simkit.quality import grade_step, qstat_week, quality_step
from simkit.tech import path_step
from simkit.transition import trans_sales_note


def fp_step(W, w, last_short):
    L = W.L
    PV2 = W.PV2
    fsold = W.fsold
    fwk_prod = W.fwk_prod
    fwk_uns = W.fwk_uns
    media_dyn(W, w)
    media_found(W, w)
    if FIRM_PROD:
        fc_step(W)                                  # REKABET G17g: haftalık üretim henüz silinmedi; fc_rel yeni haftanın üretimine ve fiyatına girer
    if FP_ACT:
        qstat_week(W, w)
        grade_step(W, w)
        quality_step(W, w)
        path_step(W, w)
        ad_step(W, w)
        (partial(fp_prices_v2, W) if PV2 else partial(fp_prices, W))(w, last_short)
        if PV2_ACCT and not PV2:
            v2_acct(W, w)
            L.fexp.clear()
            L.frev.clear()
    if RENT_ACT:
        rent_account(W, w)
    if TRANS_SUPPORT == 2 and TRANS_SHARE_DEF == "sales":
        trans_sales_note(W, fsold)                  # K-211 v2: satış payı tanımı için sönümlü firma satışı
    fwk_prod.clear()
    fwk_uns.clear()
    fsold.clear()
