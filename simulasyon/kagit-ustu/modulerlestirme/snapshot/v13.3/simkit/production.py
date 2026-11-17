"""simkit.production: üretim girdisi alımı: inv_buy.

ARAYÜZ: inv_buy
OKUR/YAZAR: W.firms, W.L.
KATMAN: L4.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.econ_core import land, working_capital
from simkit.market import clear, clear_fp
from simkit.sector_core import sb_buf_mult, board_stat_add


def inv_buy(W, cyc, supply):
    """K-185.16: girdi tamponu: üretimden artan (kalan) arzdan firmalar hedef girdi stoğuna doğru alım yapar; tampon talebi kıtlık sinyali sayılmaz."""
    INV_ON = W.INV_ON
    L = W.L
    RECIPES = W.RECIPES
    REF = W.REF
    firms = W.firms
    inv_stat = W.inv_stat
    kind_stats = W.kind_stats
    people = W.people
    short_units = W.short_units
    short_val = W.short_val
    want_units = W.want_units
    if not INV_ON:
        return
    dem = defaultdict(lambda: defaultdict(list))
    for f, d in firms.items():
        if d.get("dead") or not d["workers"]:
            continue
        outs, ins = RECIPES[d["kind"]]
        if not ins or not outs:
            continue
        ci = d["city"]
        ist = d.get("istock", {})
        use = d.get("use_cyc", {})
        wc = working_capital(W, firms, people, f)
        avail = L.bal[f] - wc
        if avail <= 0:
            continue
        tot_est = 0.0
        wants = {}
        for p, u in use.items():
            if p in NO_STOCK or p in ("yazilim", "bilgisayar", "koruma"):
                continue
            bm_ = 1.0
            if SECTOR_BOARD:
                bm_ = sb_buf_mult(W, p, ci)                  # K-212: tampon hedefi tedarikçi riskine göre (pano)
                if bm_ > 1.0:
                    board_stat_add(W, "tampon_yukselt")
                elif bm_ < 1.0:
                    board_stat_add(W, "tampon_dusur")
            gap = INV_IN_CYC * bm_ * u - ist.get(p, 0.0)
            if gap > 1e-9:
                q = INV_FILL * gap
                wants[p] = q
                tot_est += q * land(W, ci, p) * (1 + NAVLUN)
        if not wants:
            continue
        sc = min(1.0, 0.2 * avail / max(1e-9, tot_est))
        for p, q in wants.items():
            dem[p][ci].append([f, q * sc, -1 - d.get("grade", 1)] if QL_ACT else [f, q * sc])
    if not dem:
        return
    su, sv, wu = dict(short_units), dict(short_val), dict(want_units)
    for p, dm in dem.items():
        if FP_ACT:
            got, cost, _sr, _qr = clear_fp(W, p, supply[p], dm, "tampon")
        else:
            got, cost = clear(W, p, supply[p], dm, "tampon")
        for f, u in got.items():
            firms[f].setdefault("istock", {})
            firms[f]["istock"][p] = firms[f]["istock"].get(p, 0.0) + u
            inv_stat["girdi_tamponu_alim_akce"] += u * REF[p]
        for f, cst in cost.items():
            kind_stats[firms[f]["kind"]]["inp"] += cst
    short_units.clear(); short_units.update(su)
    short_val.clear(); short_val.update(sv)
    want_units.clear(); want_units.update(wu)
