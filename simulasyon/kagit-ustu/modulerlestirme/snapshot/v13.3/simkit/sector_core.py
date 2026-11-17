"""simkit.sector_core: K-212 sektör panosu karar okuyucuları (W.board'u OKUR; bayrak kapalıyken W.board yoktur ve hepsi nötr değer döner).

ARAYÜZ: sb_health, sb_buf_mult, sb_split_row, sb_need_mult, sb_scale_mult, sb_price_target, sb_entry_ok, sb_hire_ok, sb_firm_scarcity, board_stat_add
OKUR: W.board, W.firms, W.RECIPES; params SB_*. YAZAR: W.sb_stat (kural sayaçları). Pano hesabı: simkit.sector_board.
KATMAN: L0 (yalnız params).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403


def sb_health(W, f):
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    r = b["fh"].get(f)
    return 1.0 if r is None else r["h"]


def sb_buf_mult(W, p, ci):
    """girdi tampon hedefi çarpanı (INV_IN_CYC ile çarpılır): tedarikçi riskine göre; tavan SB_BUF_HI.
    Etkin sağlıklı tedarikçi = yerel sağlıklı + 0,5 x (başka şehirlerdeki sağlıklı); >=3: LO; 2: orta; 1: yüksek; sağlıksız/yok: HI; kalıcı kıtlık tamponu artırır."""
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    pr = b["prod"].get(p)
    if pr is None or pr["n_all"] == 0:
        return 1.0
    cl = b["cells"].get((ci, p))
    loc_h = cl["n_healthy"] if cl else 0
    n_eff = loc_h + 0.5 * (pr["n_h"] - loc_h)
    if n_eff >= 3.0:
        m = SB_BUF_LO
    elif n_eff >= 2.0:
        m = SB_BUF_LO + 0.5 * (1.0 - SB_BUF_LO)
    elif n_eff >= 1.5:
        m = 1.0
    elif n_eff >= 1.0:
        m = 1.0 + (SB_BUF_HI - 1.0) / 3.0
    else:
        m = SB_BUF_HI
    m += min(SB_BUF_HI - m, 10.0 * pr["persist"]) if m < SB_BUF_HI else 0.0
    return min(SB_BUF_HI, max(SB_BUF_LO, m))


def sb_split_row(W, sl, row, product):
    """clear_fp: firma alıcı satırı için sağlıksız baskın tedarikçinin ağırlığını, payı <= 1-SB_SECOND olacak şekilde kısar (başka satıcı varsa)."""
    b = getattr(W, "board", None)
    if b is None:
        return row
    tot = sum(row)
    if tot <= 0:
        return row
    mi = max(range(len(row)), key=lambda i: row[i])
    am = row[mi]
    if am / tot <= 1.0 - SB_SECOND:
        return row
    r = b["fh"].get(sl[mi][0])
    if r is None or r["h"] >= SB_H_OK:
        return row
    rest = tot - am
    if rest <= 1e-12:
        return row
    cap = rest * (1.0 - SB_SECOND) / SB_SECOND
    if cap < am:
        row = list(row)
        row[mi] = cap
    return row


def sb_need_mult(W, ci, p):
    """kadro hedefi çarpanı: kalıcı kıtlıkta 1 + en çok SB_GROW; stok fazlası ve kıtlık yokken 1 - en çok SB_STAFF_BRAKE."""
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    pr = b["prod"].get(p)
    if pr is None:
        return 1.0
    if pr["persist"] > SB_SCARCE:
        return 1.0 + min(SB_GROW, 4.0 * (pr["persist"] - SB_SCARCE))
    if pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE:
        return 1.0 - min(SB_STAFF_BRAKE, SB_STAFF_BRAKE * (pr["cover"] - SB_STOCK_HI) / SB_STOCK_HI)
    return 1.0


def sb_scale_mult(W, p):
    """üretim ölçeği çarpanı: sektör stoku fazla ve kıtlık yok: SB_BRAKE_MIN'e kadar fren; kalıcı kıtlık: SB_GROW'a kadar artış (NPC, ölçek < 1 iken çağıran uygular)."""
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    pr = b["prod"].get(p)
    if pr is None:
        return 1.0
    if pr["persist"] > SB_SCARCE:
        return 1.0 + min(SB_GROW, 4.0 * (pr["persist"] - SB_SCARCE))
    if pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE:
        return max(SB_BRAKE_MIN, 1.0 - (pr["cover"] - SB_STOCK_HI) / (2.0 * SB_STOCK_HI))
    return 1.0


def sb_price_target(W, p, tgt, uc):
    """fiyat hedefi: kalıcı kıtlıkta en çok SB_PREM_MAX prim (düşen fiyat eğiliminde yarısı); stok fazlası+kıtlık yokken en çok SB_DISC_MAX indirim, tam birim maliyet uc'un altına inmez."""
    b = getattr(W, "board", None)
    if b is None:
        return tgt
    pr = b["prod"].get(p)
    if pr is None:
        return tgt
    if pr["persist"] > SB_SCARCE:
        prem = min(SB_PREM_MAX, 2.0 * (pr["persist"] - SB_SCARCE))
        if pr["ptrend"] < -0.01:
            prem *= 0.5
        return tgt * (1.0 + prem)
    if pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE:
        disc = min(SB_DISC_MAX, SB_DISC_MAX * (pr["cover"] - SB_STOCK_HI) / SB_STOCK_HI)
        if pr["ptrend"] < -0.01:
            disc = min(SB_DISC_MAX, disc * 1.5)
        return max(uc, tgt * (1.0 - disc))
    return tgt


def sb_entry_ok(W, p, ci):
    """oyuncu girişi: ürünün kıtlığı kalıcı olmalı; girdi tedarikçisi var ama hiçbiri sağlıklı değilse kurma (bekle). Neden döner (None = tamam)."""
    b = getattr(W, "board", None)
    if b is None:
        return None
    pr = b["prod"].get(p)
    if pr is not None and pr["persist"] < SB_ENTRY_PERSIST and not ENTRY_OPEN:       # K-213: ENTRY_OPEN'da "kalıcı kıtlık yoksa girmez" kuralı yok
        return "gecici_kitlik"
    for q_in in W.RECIPES[PRODUCER[p]][1]:
        if q_in in ("yazilim", "bilgisayar", "koruma") or q_in in NO_STOCK:
            continue
        pi = b["prod"].get(q_in)
        if pi is not None and pi["n_all"] > 0 and pi["n_h"] == 0:
            return "tedarikci_saglik"
    return None


def sb_hire_ok(W, d):
    """oyuncu firması işe alımı: ana ürününün sektör stoku fazla ve kıtlık yoksa beklet."""
    b = getattr(W, "board", None)
    if b is None or d["kind"] not in PROD_OF:
        return True
    pr = b["prod"].get(PROD_OF[d["kind"]])
    if pr is None:
        return True
    return not (pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE)


def sb_firm_scarcity(W, f):
    b = getattr(W, "board", None)
    if b is None:
        return 0.0
    d = W.firms.get(f)
    if d is None or d["kind"] not in PROD_OF:
        return 0.0
    return b["persist"].get(PROD_OF[d["kind"]], 0.0)



def board_stat_add(W, key, v=1.0):
    st = getattr(W, "sb_stat", None)
    if st is None:
        st = W.sb_stat = defaultdict(float)
    st[key] += v
