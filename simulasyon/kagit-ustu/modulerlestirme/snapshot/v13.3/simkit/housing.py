"""simkit.housing: konut piyasası: house_market, house_cost, house_dev, house_buy.

ARAYÜZ: house_market, house_cost, house_dev, house_buy
OKUR/YAZAR: W.hs, W.RM, W.own, W.L; W.w (yayın).
KATMAN: L4.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import keep_amt, lendable, rate_ref, sp_week
from simkit.econ_core import land
from simkit.market import clear, clear_fp
from simkit.rate_behav import rb_credit_factor


def house_market(W, ci, c, unit_rent):
    """K-179: konut yatırımı ve ikinci el piyasası. Alıcı: konutun net getirisi (kira × (1 - bakım) / fiyat + beklenen fiyat değişimi) mevduat faizi + risk primini aşıyorsa
    alır (en ucuz arz: ikinci el, şehrin boş stoku ya da yeni inşaat). Satıcı: nakit sıkışıklığı ya da net getiri mevduatın altına düştü. Fiyat arz-talep dengesizliğiyle oynar."""
    HBX_ON = W.HBX_ON
    L = W.L
    RM = W.RM
    closed = W.closed
    cx_stat = W.cx_stat
    dep_slow = W.dep_slow
    dep_tot = W.dep_tot
    deposits = W.deposits
    hexp = W.hexp
    hpx_prev = W.hpx_prev
    hratio = W.hratio
    hs = W.hs
    hst = W.hst
    inc_ema = W.inc_ema
    loncas = W.loncas
    mortgages = W.mortgages
    occ = W.occ
    own = W.own
    people = W.people
    w = W.w
    prim = unit_rent / HOUSE_YIELD
    ratio = hratio[ci]
    px = ratio * prim
    if ci not in hpx_prev:
        hpx_prev[ci] = px
    g = max(-0.003, min(0.003, HOUSE_EXP_DAMP * hexp[ci]))
    occf = min(1.0, occ[ci] / max(1.0, hs[ci])) if occ[ci] > 0 else 1.0                  # doluluk: yeni birim kiracıyı artırmaz, mevcut kirayı böler
    net_rent = unit_rent * (1.0 - HOUSE_MAINT) * occf
    d_best = dep_slow[0]
    cost_b = HOUSE_BUILD * prim
    y_hold = net_rent / px + g
    offers = []
    for q, u in list(own[ci].items()):
        if u < 1.0 - 1e-9:
            continue
        if q.endswith("_sermaye"):
            offers.append(q)                                                 # haciz: havuz konutu piyasaya arz eder
            continue
        if (L.bal[q] + (deposits[q][1] if q in deposits else 0.0) < HOUSE_SQUEEZE_W * sp_week(W, q)) or y_hold < d_best - HOUSE_SELL_MARGIN:
            offers.append(q)
    n_off = len(offers)
    buyers = []
    for q in c["players"]:
        if sum(own[c_].get(q, 0.0) for c_ in list(own)) >= HOUSE_INV_MAX - 1e-9:
            continue                                                         # sahibin kararı: kişi başına en çok HOUSE_INV_MAX yatırım konutu
        av = L.bal[q] - keep_amt(W, q) + (deposits[q][1] if q in deposits else 0.0)
        if av > 0:
            buyers.append((av, q))
    buyers.sort(key=lambda t: (-t[0], t[1]))
    vacancy = hs[ci] - sum(own[ci].values())
    build_cap = (int(HOUSE_BUILD_K * max(0.0, px / cost_b - 1.0) * hs[ci]) + 1) if px > cost_b else 0
    want = bought = builds = 0
    for av, q in buyers:
        src = next((i for i, s in enumerate(offers) if s != q), None)
        opts = []
        if src is not None:
            opts.append((px, "sec"))
        if vacancy >= 1.0 - 1e-9:
            opts.append((prim, "pri"))
        if not opts and builds < build_cap and RM[ci] > BUILD_RM and not HBX_ON:      # geliştirici yalnız kira baskısı (kıtlık) varken inşa eder (K-185.8: yeni kural house_dev)
            opts.append((cost_b, "build"))
        price_u, kind = min(opts, key=lambda t: t[0]) if opts else (px, None)
        if net_rent / price_u + g <= d_best + HOUSE_RISK_PREM:
            continue
        cost = price_u * (1.0 + (HOUSE_TXN if kind == "sec" else 0.0))
        mort_ = None
        if CX_ACT and kind in ("sec", "pri"):
            m_rate = max(CX_RATE_MIN, rate_ref(W) + CX_MORT_MARGIN)
            y_b = net_rent / price_u + g
            loan_a = CX_LTV * price_u * (rb_credit_factor(W, RB_LOAN_SEMI_HH, RB_C_MAX_HH) if (RATE_BEHAV and RB_CREDIT) else 1.0)
            inc_w = max(inc_ema.get(q, 0.0), people[q]["wage"] * CYCLES_PER_WEEK)
            lend_lo = max((l_ for l_ in loncas if l_ not in closed), key=lambda l_: (lendable(W, l_), l_), default=None)
            if (av < cost or y_b > m_rate + HOUSE_RISK_PREM) and y_b > m_rate and lend_lo is not None and lendable(W, lend_lo) >= loan_a \
                    and loan_a / CX_MORT_TERM + m_rate * loan_a <= CX_DSR * inc_w and av >= cost - loan_a:
                mort_ = (lend_lo, loan_a, m_rate)
        if av < cost and mort_ is None:
            continue
        want += 1
        if kind is None or bought >= HOUSE_BUY_CAP:
            continue
        free_ = L.bal[q] - keep_amt(W, q)
        if mort_ is not None:
            cost -= mort_[1]
        if free_ < cost and q in deposits and deposits[q][1] > 0:           # mevduatı bozar: getiri konutta daha yüksek
            lo_d = deposits[q][0]
            got_ = L.pay(f"{lo_d}_sermaye", q, min(deposits[q][1], cost - max(0.0, free_), L.bal[f"{lo_d}_sermaye"]), "mevduat_cekim")
            deposits[q][1] -= got_
            dep_tot[lo_d] -= got_
            free_ = L.bal[q] - keep_amt(W, q)
        if free_ + 1e-9 < cost:
            continue
        if mort_ is not None:
            L.pay(f"{mort_[0]}_sermaye", (offers[src] if kind == "sec" else c["acct"]), mort_[1], "ipotek_kredisi")
            mortgages.append(dict(q=q, ci=ci, lo=mort_[0], p0=mort_[1], out=mort_[1], miss=0, rate=mort_[2], since=w))
            cx_stat["hacim_konut"] += mort_[1]
            L.flows["kredi_konut_adet"] += 1
            price_u -= mort_[1]
        if kind == "sec":
            s_ = offers.pop(src)
            L.pay(q, s_, price_u, "konut_satis_ikinci_el")
            L.pay(q, c["acct"], HOUSE_TXN * (price_u + (mort_[1] if mort_ is not None else 0.0)), "konut_islem_harci")
            for m_ in [m_ for m_ in mortgages if m_["q"] == s_ and m_["ci"] == ci]:       # satıcının ipoteği satıştan kapanır
                L.pay(s_, f"{m_['lo']}_sermaye", min(m_["out"], L.bal[s_]), "ipotek_kapama")
                mortgages.remove(m_)
            own[ci][s_] -= 1.0
            if own[ci][s_] < 1e-9:
                del own[ci][s_]
            own[ci][q] += 1.0
            hst["sec_n"] += 1
            hst["sec_vol"] += price_u + (mort_[1] if mort_ is not None else 0.0)
            L.flows["konut_ikinci_el_adet"] += 1
        elif kind == "pri":
            L.pay(q, c["acct"], price_u, "konut_satisi")
            own[ci][q] += 1.0
            vacancy -= 1.0
            hst["pri_n"] += 1
            L.flows["konut_alim_adet"] += 1
        else:
            L.pay(q, c["acct"], price_u, "konut_insaat")
            own[ci][q] += 1.0
            hs[ci] += 1.0
            builds += 1
            hst["build_n"] += 1
            L.flows["konut_yeni_adet"] += 1
        bought += 1
    imb = (want - n_off) / max(1, want + n_off)
    fund_ = net_rent / max(1e-4, d_best + HOUSE_RISK_PREM - g) / prim              # alıcının kayıtsız kaldığı fiyat / birincil fiyat (temel değer)
    nr = ratio * (1.0 + HOUSE_PRICE_ADJ * imb) + HOUSE_ANCHOR * (min(HOUSE_PX_MAX, max(HOUSE_PX_MIN, fund_)) - ratio)
    if hs[ci] - sum(own[ci].values()) >= 1.0 - 1e-9:
        nr = min(nr, 1.0)                                                        # şehrin boş stoku birincil fiyattan satılır: fiyat tavanı
    nr = min(HOUSE_PX_MAX, max(HOUSE_PX_MIN, nr))
    new_px = nr * prim
    hexp[ci] = hexp[ci] * (1.0 - 1.0 / HOUSE_EXP_N) + (new_px / hpx_prev[ci] - 1.0) / HOUSE_EXP_N
    hpx_prev[ci] = new_px
    hratio[ci] = nr
    hst["want"] += want
    hst["offers"] += n_off


def house_cost(W, ci, unit_rent):
    prim = unit_rent / HOUSE_YIELD
    mat = HOUSE_INS_UNITS * land(W, ci, "insaat") * (1 + NAVLUN)
    return mat * (1 + HOUSE_LABOR), mat, HOUSE_PLOT * prim


def house_dev(W, ci, c, unit_rent):
    """K-185.8: konut geliştirme: fiyat maliyeti aşarsa, faiz düşükse ve fiziksel boşluk azsa en varlıklı yatırımcılar yeni konut yaptırır (kredi yeni konuta gider)."""
    L = W.L
    NOW = W.NOW
    closed = W.closed
    cx_stat = W.cx_stat
    dep_tot = W.dep_tot
    deposits = W.deposits
    firms = W.firms
    hdev_q = W.hdev_q
    hdev_stat = W.hdev_stat
    hexp = W.hexp
    hratio = W.hratio
    hs = W.hs
    inc_ema = W.inc_ema
    loncas = W.loncas
    mortgages = W.mortgages
    occ = W.occ
    own = W.own
    people = W.people
    prim = unit_rent / HOUSE_YIELD
    px = hratio[ci] * prim
    tot_c, mat, plot = house_cost(W, ci, unit_rent)
    cost_u = tot_c + plot
    vac = (hs[ci] - occ[ci]) / max(1.0, hs[ci])
    pending = sum(u for _, u in hdev_q[ci])
    hdev_stat["gozlem"] += 1
    hdev_stat["oran_toplam"] += px / max(1e-9, cost_u)
    if px <= cost_u * (1 + HOUSE_DEV_MARGIN):
        hdev_stat["red_fiyat"] += 1
        return
    if rate_ref(W) > HOUSE_RATE_MAX:
        hdev_stat["red_faiz"] += 1
        return
    if vac > HOUSE_VAC_MAX:
        hdev_stat["red_bosluk"] += 1
        return
    net_rent = unit_rent * (1.0 - HOUSE_MAINT) * min(1.0, occ[ci] / max(1.0, hs[ci]))
    g = max(-0.003, min(0.003, HOUSE_EXP_DAMP * hexp[ci]))
    if net_rent / cost_u + g <= rate_ref(W) + HOUSE_RISK_PREM:
        hdev_stat["red_getiri"] += 1
        return
    room = max(0, HOUSE_DEV_MAXW - int(pending))
    if room <= 0:
        return
    muni = f"s{ci}_belediye0"
    buyers = sorted(((L.bal[q] - keep_amt(W, q) + (deposits[q][1] if q in deposits else 0.0), q) for q in c["players"]
                     if sum(own[c_].get(q, 0.0) for c_ in list(own)) < HOUSE_INV_MAX - 1e-9), key=lambda t: (-t[0], t[1]))
    started = 0
    for av, q in buyers:
        if started >= room:
            break
        mort_ = None
        if CX_ACT:
            m_rate = max(CX_RATE_MIN, rate_ref(W) + CX_MORT_MARGIN)
            loan_a = CX_LTV * cost_u * (rb_credit_factor(W, RB_LOAN_SEMI_HH, RB_C_MAX_HH) if (RATE_BEHAV and RB_CREDIT) else 1.0)
            inc_w = max(inc_ema.get(q, 0.0), people[q]["wage"] * CYCLES_PER_WEEK)
            lend_lo = max((l_ for l_ in loncas if l_ not in closed), key=lambda l_: (lendable(W, l_), l_), default=None)
            if av < cost_u and lend_lo is not None and lendable(W, lend_lo) >= loan_a and loan_a / CX_MORT_TERM + m_rate * loan_a <= CX_DSR * inc_w and av >= cost_u - loan_a:
                mort_ = (lend_lo, loan_a, m_rate)
        if av < cost_u and mort_ is None:
            continue
        own_cash = cost_u - (mort_[1] if mort_ else 0.0)
        free_ = L.bal[q] - keep_amt(W, q)
        if free_ < own_cash and q in deposits and deposits[q][1] > 0:
            lo_d = deposits[q][0]
            got_ = L.pay(f"{lo_d}_sermaye", q, min(deposits[q][1], own_cash - max(0.0, free_), L.bal[f"{lo_d}_sermaye"]), "mevduat_cekim")
            deposits[q][1] -= got_
            dep_tot[lo_d] -= got_
            free_ = L.bal[q] - keep_amt(W, q)
        if free_ + 1e-9 < own_cash:
            continue
        L.pay(q, c["acct"], plot + (tot_c - mat), "konut_arsa_emek")            # arsa ve emek payı şehre
        L.pay(q, muni, mat - (mort_[1] if mort_ else 0.0), "konut_insaat_bedeli")     # malzeme bütçesi yapı yönetimine (belediye kaydı)
        if mort_:
            L.pay(f"{mort_[0]}_sermaye", muni, mort_[1], "ipotek_kredisi")
            mortgages.append(dict(q=q, ci=ci, lo=mort_[0], p0=mort_[1], out=mort_[1], miss=0, rate=mort_[2], since=NOW[0]))
            cx_stat["hacim_konut"] += mort_[1]
            L.flows["kredi_konut_adet"] += 1
            hdev_stat["ipotekli"] += 1
        firms[muni]["house_fund"] = firms[muni].get("house_fund", 0.0) + mat
        hdev_q[ci].append([q, 1.0])
        started += 1
        hdev_stat["basladi"] += 1
        L.flows["konut_baslayan_adet"] += 1


def house_buy(W, cyc, supply):
    """K-185.8: yapı yönetimi inşaat malını kalan arzdan takasla alır; teslim edilen birim kadar konut tamamlanır (stok ve mülkiyet artar)."""
    HBX_ON = W.HBX_ON
    L = W.L
    capinv = W.capinv
    cities = W.cities
    firms = W.firms
    hdev_q = W.hdev_q
    hdev_stat = W.hdev_stat
    hs = W.hs
    hst = W.hst
    own = W.own
    if not HBX_ON:
        return
    left = CYCLES_PER_WEEK - cyc
    dem = defaultdict(list)
    for ci, q_ in hdev_q.items():
        if not q_:
            continue
        muni = f"s{ci}_belediye0"
        pend = sum(u for _, u in q_)
        want = max(0.0, pend * HOUSE_INS_UNITS / left - capinv[muni]["insaat"])
        fund = firms[muni].get("house_fund", 0.0)
        est = want * land(W, ci, "insaat") * (1 + NAVLUN)
        if est > fund > 1e-9:
            want *= fund / est
        if want > 1e-9 and fund > 1e-9:
            dem[ci].append([muni, want, -2] if QL_ACT else [muni, want])
            cities[ci]["last_demand"]["insaat"] += want
    if not dem:
        return
    if FP_ACT:
        got, cost, _sr, _qr = clear_fp(W, "insaat", supply["insaat"], dem, "konut")
    else:
        got, cost = clear(W, "insaat", supply["insaat"], dem, "konut")
    for muni, u in got.items():
        capinv[muni]["insaat"] += u
    for muni, cst in cost.items():
        firms[muni]["house_fund"] = max(0.0, firms[muni].get("house_fund", 0.0) - cst)
        hdev_stat["malzeme_akce"] += cst
        L.flows["konut_malzemesi_akce"] += cst
    for ci, q_ in hdev_q.items():
        muni = f"s{ci}_belediye0"
        while q_ and capinv[muni]["insaat"] >= HOUSE_INS_UNITS - 1e-9:
            capinv[muni]["insaat"] -= HOUSE_INS_UNITS
            inv_, u = q_.pop(0)
            own[ci][inv_] += 1.0
            hs[ci] += 1.0
            hst["build_n"] += 1
            L.flows["konut_yeni_adet"] += 1
            hdev_stat["tamamlandi"] += 1
