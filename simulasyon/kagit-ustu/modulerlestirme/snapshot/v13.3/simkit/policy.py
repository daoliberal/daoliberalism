"""simkit.policy: politika: faiz kuralı (pol_step), tahvil tabanı ve kancası (bond_base, bond_hook).

ARAYÜZ: bond_base, bond_hook, pol_step
OKUR/YAZAR: W.pol, W.bonds, W.L (bond_hook kanca olarak partial(W) ile bağlanır).
KATMAN: L2 (credit_core'a bağımlı).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import lendable_cash
from simkit.young_core import is_fund_lo


def bond_base(W):
    POL_ON = W.POL_ON
    dep_slow = W.dep_slow
    pol = W.pol
    return max(0.5 * CX_RATE_MIN, BOND_RATE_MULT * (pol[0] if (POL_ON and pol[0] is not None) else max(0.0, dep_slow[0])))


def bond_hook(W, acct, need, kind):
    """K-185.4: şehir kasasının açığı lonca havuzlarının boşta nakdiyle (rezerv sonrası) tahvil olarak finanse edilir."""
    BOND_ON = W.BOND_ON
    L = W.L
    NOW = W.NOW
    bond_stat = W.bond_stat
    bonds = W.bonds
    city_ref = W.city_ref
    closed = W.closed
    loncas = W.loncas
    if not BOND_ON or need < BOND_MIN:
        bond_stat["kisma_adet"] += need >= 1e-9
        return 0.0
    debt = sum(b_["out"] for b_ in bonds if b_["city"] == acct)
    room = max(0.0, BOND_DEBT_MAX_W * city_ref[acct] - debt)
    want = min(need, room)
    if want < BOND_MIN:
        bond_stat["kisma_adet"] += 1
        bond_stat["kisma_tavan_tl"] += need
        return 0.0
    cands = [(l_, BOND_POOL_SHARE * lendable_cash(W, l_)) for l_ in loncas if l_ not in closed and lendable_cash(W, l_) > 1e-9 and not (LONCA_INSOLV_CLOSE and l_ in W.lo_insolv)]       # T6: batık lonca havuza girmez
    avail = sum(a_ for _, a_ in cands)
    if avail < BOND_MIN:
        bond_stat["kisma_adet"] += 1
        bond_stat["kisma_havuz_tl"] += want
        return 0.0
    issue = min(want, avail)
    got = 0.0
    rate = bond_base(W) + BOND_MARGIN
    for l_, a_ in cands:
        part = issue * a_ / avail
        if part < 1e-9:
            continue
        g_ = L.pay(f"{l_}_sermaye", acct, part, "tahvil_ihrac")
        got += g_
        ex_ = next((b_ for b_ in bonds if b_["city"] == acct and b_["lo"] == l_), None)       # aynı şehir ve havuzun tahvilleri tek kayıtta birleşir (ağırlıklı faiz)
        if ex_ is not None:
            ex_["rate"] = (ex_["rate"] * ex_["out"] + rate * g_) / max(1e-9, ex_["out"] + g_)
            ex_["out"] += g_
            ex_["p0"] = ex_["out"]                                  # kalan borç yeniden BOND_TERM'e yayılır
        else:
            bonds.append(dict(city=acct, lo=l_, p0=g_, out=g_, rate=rate, born=NOW[0]))
    bond_stat["ihrac"] += got
    bond_stat["ihrac_adet"] += 1
    return got


def pol_step(W, w):
    """K-185.5: politika faizi kuralı (zincirde açık): hedef = tarafsız + a_inf×(enflasyon - hedef) - a_u×(işsizlik - doğal) - a_idle×(boşta - hedef); haftalık sınırlı adım."""
    L = W.L
    POL_ON = W.POL_ON
    bonds = W.bonds
    cities = W.cities
    closed = W.closed
    dep_tot = W.dep_tot
    loans = W.loans
    loncas = W.loncas
    mortgages = W.mortgages
    pol = W.pol
    pol_hist = W.pol_hist
    weekly = W.weekly
    if not POL_ON:
        return
    if pol[0] is None:
        pol[0] = min(POL_MAX, max(POL_MIN, POL_NEUT))
    if not weekly:
        return
    sr = weekly[-1]["series"]
    npl = max(1, sum(len(c_["players"]) for c_ in cities))
    un = sr["seekers"] / npl
    pidx_now = sr["pidx"]
    past = weekly[-POL_INF_WEEKS]["series"]["pidx"] if len(weekly) >= POL_INF_WEEKS else weekly[0]["series"]["pidx"]
    infl = (pidx_now / max(1e-9, past) - 1.0) * (52.0 / POL_INF_WEEKS) if len(weekly) >= 2 else 0.0
    infl = max(-1.0, min(1.0, infl))
    dt_ = sum(dep_tot[l_] for l_ in loncas)
    idle = min(1.0, sum(lendable_cash(W, l_) for l_ in loncas if l_ not in closed) / dt_) if dt_ > 1e-9 else POL_IDLE_STAR
    cd_ = (sum(l_["out"] for l_ in loans.values() if not is_fund_lo(l_["lo"])) + sum(m_["out"] for m_ in mortgages) + sum(b_["out"] for b_ in bonds)) / dt_ if dt_ > 1e-9 else POL_CD_STAR
    if POL_CD:
        tgt = POL_NEUT + POL_A_INF * (infl - POL_INF_TGT) - POL_A_U * (un - POL_U_STAR) - POL_A_CD * (cd_ - POL_CD_STAR)
    else:
        tgt = POL_NEUT + POL_A_INF * (infl - POL_INF_TGT) - POL_A_U * (un - POL_U_STAR) - POL_A_IDLE * (idle - POL_IDLE_STAR)
    tgt = min(POL_MAX, max(POL_MIN, tgt))
    old_ = pol[0]
    pol[0] = old_ + max(-POL_STEP, min(POL_STEP, tgt - old_))
    if abs(pol[0] - old_) > 1e-12:
        L.flows["politika_faizi_olayi"] += 1
    pol_hist.append((w, pol[0], un, infl, idle, cd_, sum(l_["out"] for l_ in loans.values()), dt_))
