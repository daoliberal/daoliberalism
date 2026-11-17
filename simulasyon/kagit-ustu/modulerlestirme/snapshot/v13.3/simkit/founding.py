"""simkit.founding: oyuncu firması kuruluşu ve yerli taban fazlarının hafta içi eşik/değerlendirme işlevleri (eski run() kapanışları, açık parametreli).

ARAYÜZ: threshold, worth, young, thr_eff, imp_of
OKUR: W.last_short, W.want_last, W.prod_last, W.L, W.cities, W.firms (yalnız okuma); YAZAR: L.flows (pazar_yeri_yok_ret), W.gate (gate_no).
KATMAN: L6.
"""
from simkit.params import *          # noqa: F401,F403
from simkit.diag import gate_no
from simkit.econ_core import fee_avg, freight
from simkit.firms import room_ok
from simkit.sector_core import sb_entry_ok, board_stat_add
from simkit.tech_core import tech_f


def threshold(W, p):
    FRONT = W.FRONT
    RECIPES = W.RECIPES
    REF = W.REF
    k = PRODUCER[p]
    return REF[p] * RECIPES[k][0][p] * CYCLES_PER_WEEK * (tech_f(BRANCH[k], FRONT[BRANCH[k]]) if (ARGE_ON and k in BRANCH) else 1.0)          # bir çalışanın haftalık çıktı değeri (K-146: güncel verimle; ucuzlayan dalda bir çalışan çok daha fazla üretir, girişimci eksik değerini ona göre tartar)


def worth(W, w, c, p):
    """K-117: girişimci piyasa fiyatına bakar: ürün arzı fazlaysa (çarpan < 0,9) ya da ithal teslim fiyatı
    yerelden ucuzsa girilmez (zararına satış)."""
    L = W.L
    cities = W.cities
    FRONT = W.FRONT
    LAND = W.LAND
    LAST_ENTRY = W.LAST_ENTRY
    PM = W.PM
    PRICE = W.PRICE
    RECIPES = W.RECIPES
    WI = W.WI
    for q_in in RECIPES[PRODUCER[p]][1]:                    # girdisi bulunmuyorsa girilmez (isteğe bağlı girdiler hariç, K-149)
        if q_in in ("yazilim", "bilgisayar", "koruma"):
            continue
        if W.last_short.get(q_in, 0.0) > (WORTH_SHORT_X if ENTRY_FIX else WORTH_SHORT) * max(1e-9, W.want_last.get(q_in, 0.0)):
            return gate_no(W, "girdi_kit", p, q_in)
    if SECTOR_BOARD:                                        # K-212: giriş panoya bakar: kalıcı kıtlık yoksa ya da girdi tedarikçisi sağlıksızsa kurulmaz
        why_ = sb_entry_ok(W, p, c["i"])
        if why_:
            board_stat_add(W, "giris_red_" + why_)
            return gate_no(W, "sb_" + why_, p)
    if w - LAST_ENTRY.get((c["i"], p), -999) < ENTRY_COOLDOWN:
        return gate_no(W, "cooldown", p)
    if ROOM_ACT and (ROOM_ALL or p in ROOM_PRODUCTS) and not room_ok(W, p, c, w, threshold(W, p)):
        L.flows["pazar_yeri_yok_ret"] += 1
        return gate_no(W, "pazar_yeri", p)
    ms = [PM[(j, p)] for j in range(len(cities)) if W.prod_last.get((j, p), 0.0) > 1e-9]
    if ms and sum(ms) / len(ms) < ENTRY_PM:
        return gate_no(W, "arz_fazlasi", p)
    if FEAS > 0:
        k_ = PRODUCER[p]
        o_, i_ = RECIPES[k_]
        rate_ = list(o_.values())[0] * (tech_f(BRANCH[k_], FRONT[BRANCH[k_]]) if (ARGE_ON and k_ in BRANCH) else 1.0)
        rev_ = sum(PRICE[(c["i"], pp)] * qq for pp, qq in o_.items()) * (rate_ / list(o_.values())[0]) * (1 - fee_avg(W))
        inp_ = sum(qq * min(PRICE[(j_, pp)] + freight(W, j_, pp, abs(j_ - c["i"])) for j_ in range(len(cities)) if W.prod_last.get((j_, pp), 0.0) > 1e-9 or j_ == c["i"]) for pp, qq in i_.items() if pp not in ("yazilim", "bilgisayar")) * rate_ if i_ else 0.0
        if rev_ - inp_ < FEAS * (TIER_WAGE[0] * WI[c["i"]] + RENT):
            return gate_no(W, "fizibilite", p)
    if not (PRICE[(c["i"], p)] <= LAND[(c["i"], p)] * 1.02):
        return gate_no(W, "fiyat_ithal_ucuz", p)
    return True


def young(W, w, c, p):                                           # K-162: aynı şehirde bu türden henüz olgunlaşmamış oyuncu firması, sinyali önceden karşılar (girişimci seli/kobweb)
    firms = W.firms
    player_firms = W.player_firms
    return sum(1 for f_ in player_firms if firms[f_]["city"] == c["i"] and firms[f_]["kind"] == PRODUCER[p] and w - firms[f_].get("born", -999) < ENTRY_YOUNG) if ENTRY_YOUNG > 0 else 0


def thr_eff(W, c, p):
    PM = W.PM
    return threshold(W, p) * (max(THR_MIN, 1.0 / max(1.0, PM[(c["i"], p)])) if ENTRY_FIX else 1.0)      # K-185.12: kıtlık derinleşince eşik düşer


def imp_of(W, c, k):
    RECIPES = W.RECIPES
    return sum(c["imp_cum"].get(p, 0.0) for p in RECIPES[k][0])
