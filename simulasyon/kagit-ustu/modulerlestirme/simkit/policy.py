"""simkit.policy: politika: faiz kuralı (pol_step), tahvil tabanı ve kancası (bond_base, bond_hook).

ARAYÜZ: bond_base, bond_hook, bond_room, city_budget_step, pol_step
OKUR/YAZAR: W.pol, W.bonds, W.L (bond_hook kanca olarak partial(W) ile bağlanır).
KATMAN: L2 (credit_core'a bağımlı).
"""
from collections import deque
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
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
    if not BOND_ON or need < ix(W, BOND_MIN):
        bond_stat["kisma_adet"] += need >= 1e-9
        return 0.0
    debt = sum(b_["out"] for b_ in bonds if b_["city"] == acct)
    room = max(0.0, BOND_DEBT_MAX_W * city_ref[acct] - debt)
    want = min(need, room)
    if want < ix(W, BOND_MIN):
        bond_stat["kisma_adet"] += 1
        bond_stat["kisma_tavan_tl"] += need
        return 0.0
    cands = [(l_, BOND_POOL_SHARE * lendable_cash(W, l_)) for l_ in loncas if l_ not in closed and lendable_cash(W, l_) > 1e-9 and not (LONCA_INSOLV_CLOSE and l_ in W.lo_insolv)]       # T6: batık lonca havuza girmez
    avail = sum(a_ for _, a_ in cands)
    if avail < ix(W, BOND_MIN):
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


def bond_room(W, acct):
    """M11.2 (2): bond_hook'un acct icin bu an ihrac edebilecegi azami tutar (yan etkisiz: sayac/ledger yazmaz). bond_hook ile ayni tavan (BOND_DEBT_MAX_W x gelir referansi - borc) ve havuz boslugu."""
    if not W.BOND_ON:
        return 0.0
    debt = sum(b_["out"] for b_ in W.bonds if b_["city"] == acct)
    room = max(0.0, BOND_DEBT_MAX_W * W.city_ref[acct] - debt)
    if room < ix(W, BOND_MIN):
        return 0.0
    avail = sum(BOND_POOL_SHARE * lendable_cash(W, l_) for l_ in W.loncas if l_ not in W.closed and lendable_cash(W, l_) > 1e-9 and not (LONCA_INSOLV_CLOSE and l_ in W.lo_insolv))
    return min(room, avail) if avail >= ix(W, BOND_MIN) else 0.0


def city_budget_step(W, w):
    """M11.2 (4) CITY_BUDGET_RULE: haftabasi sehir butcesi. Gecen haftanin duzenli geliri ve zorunlu cikisi (Ledger.cb sayaclari) CB_INCOME_WEEKS'lik pencereye girer; her sehir icin
    butce = max(0, gelir_ort - zorunlu_ort + CB_SURPLUS_SHARE x max(0, kasa - CB_RESERVE_WEEKS x zorunlu_ort)) x borc kisma carpani; carpan = 1 (borc/gelir <= CB_DEBT_SOFT x BOND_DEBT_MAX_W hafta),
    dogrusal 0'a iner (CB_DEBT_HARD x BOND_DEBT_MAX_W). Ledger.pay istege bagli kalemleri (CB_KINDS) bu butceyle tavanlar; zorunlu odemeler (ucret/avans, issizlik, tahvil) butceden bagimsiz. Ilk hafta (gecmis yok) sinirsiz."""
    L = W.L
    if L.cb is None:
        return
    for c_ in W.cities:
        a_ = c_["acct"]
        h_ = L.cb_hist.get(a_)
        if h_ is None:
            h_ = L.cb_hist[a_] = (deque(maxlen=CB_INCOME_WEEKS), deque(maxlen=CB_INCOME_WEEKS))
        used_ = L.cb[("used", a_)]
        h_[0].append(L.cb[("inc", a_)])
        h_[1].append(max(0.0, L.cb[("man", a_)] - used_))
        L.cb[("inc", a_)] = 0.0
        L.cb[("man", a_)] = 0.0
        L.cb[("used", a_)] = 0.0
        dem_ = L.cb[("dem", a_)]
        L.cb[("dem", a_)] = 0.0
        if w <= 1:
            continue                                           # gecmis yok: sinirsiz (acilis)
        inc = sum(h_[0]) / len(h_[0])
        man = sum(h_[1]) / len(h_[1])
        bud = inc - man + CB_SURPLUS_SHARE * max(0.0, L.bal[a_] - CB_RESERVE_WEEKS * man)
        debt = sum(b_["out"] for b_ in W.bonds if b_["city"] == a_)
        dfac = 1.0
        if debt > 1e-9:
            r_ = debt / max(inc, 1e-9)
            lo_, hi_ = CB_DEBT_SOFT * BOND_DEBT_MAX_W, CB_DEBT_HARD * BOND_DEBT_MAX_W
            dfac = max(0.0, min(1.0, (hi_ - r_) / max(1e-9, hi_ - lo_)))
            bud *= dfac
        L.cb_budget[a_] = max(0.0, bud)
        L.cb_par[a_] = (inc, man, dfac)                        # M11.2 (5): ucret odasi (city_wage_room) ayni gelir/zorunlu/borc carpanini kullanir
        L.cb_ratio[a_] = min(1.0, L.cb_budget[a_] / dem_) if dem_ > 1e-9 else 1.0


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
    if POL_U_ALL:                                              # tum is arayanlar (oyuncu + havuz NPC) / (calisan + is arayan)
        sk_ = sum(len(c_["seekers"]) + len(c_["pool"]) for c_ in cities)
        em_ = sr.get("emp_n")
        if em_ is None:
            em_ = sum(1 for i_ in W.people.values() if i_["firm"] is not None)
        un = sk_ / max(1, sk_ + em_)
    pidx_now = sr["pidx"]
    past = weekly[-POL_INF_WEEKS]["series"]["pidx"] if len(weekly) >= POL_INF_WEEKS else weekly[0]["series"]["pidx"]
    infl = (pidx_now / max(1e-9, past) - 1.0) * (52.0 / POL_INF_WEEKS) if len(weekly) >= 2 else 0.0
    infl = max(-1.0, min(1.0, infl))
    ti_ = POL_INF_TGT2 if POL_TGT2 else POL_INF_TGT
    ai_ = POL_A_INF2 if POL_TGT2 else POL_A_INF
    if POL_TGT2:
        infl = ti_ if w < POL_START2 else max(-POL_INFL_CLIP, min(POL_INFL_CLIP, infl))      # açılış oturması: enflasyon sapması 0; sonra ±POL_INFL_CLIP
    dt_ = sum(dep_tot[l_] for l_ in loncas)
    idle = min(1.0, sum(lendable_cash(W, l_) for l_ in loncas if l_ not in closed) / dt_) if dt_ > 1e-9 else POL_IDLE_STAR
    cd_ = (sum(l_["out"] for l_ in loans.values() if not is_fund_lo(l_["lo"])) + sum(m_["out"] for m_ in mortgages) + sum(b_["out"] for b_ in bonds)) / dt_ if dt_ > 1e-9 else POL_CD_STAR
    if POL_CD and FZ_FIX:                                      # FZ_FIX: işaret düzelir (oran düşükken faiz düşer, yüksekken artar); oran POL_CD_MAX'ta kırpılır; açılışta (w < POL_START2) terim 0
        cdk_ = POL_CD_STAR if w < POL_START2 else min(POL_CD_MAX, cd_)
        tgt = POL_NEUT + ai_ * (infl - ti_) - POL_A_U * (un - POL_U_STAR) + POL_A_CD * (cdk_ - POL_CD_STAR)
    elif POL_CD:
        tgt = POL_NEUT + ai_ * (infl - ti_) - POL_A_U * (un - POL_U_STAR) - POL_A_CD * (cd_ - POL_CD_STAR)
    else:
        tgt = POL_NEUT + ai_ * (infl - ti_) - POL_A_U * (un - POL_U_STAR) - POL_A_IDLE * (idle - POL_IDLE_STAR)
    tgt = min(POL_MAX, max(POL_MIN, tgt))
    old_ = pol[0]
    if POL_U_ALL:
        ts_ = getattr(W, "pol_ts", None)
        ts_ = tgt if ts_ is None else ts_ + POL_TGT_ADJ * (tgt - ts_)
        W.pol_ts = ts_
        pol[0] = old_ + max(-POL_STEP2, min(POL_STEP2, ts_ - old_))
    else:
        pol[0] = old_ + max(-POL_STEP, min(POL_STEP, tgt - old_))
    if abs(pol[0] - old_) > 1e-12:
        L.flows["politika_faizi_olayi"] += 1
    pol_hist.append((w, pol[0], un, infl, idle, cd_, sum(l_["out"] for l_ in loans.values()), dt_))
