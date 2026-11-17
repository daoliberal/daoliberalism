"""simkit.housing: konut piyasası: house_market, house_cost, house_dev, house_buy.

ARAYÜZ: house_market, house_cost, house_dev, house_buy, house_home_open (REKABET G12 HOME_OWN: açılış mülkiyet dağılımı), house_unit_out, house_unit_in (HOME_OWN: satıcıdan birim çıkar / alıcıya ekler), house_home_meas (HOME_OWN: davranışsız ölçüm), house_bd_builder, house_bd_buy, house_bd_sweep, house_bd_meas (REKABET G12b BUILD_DEV: inşaat firması geliştirici)
OKUR/YAZAR: W.hs, W.RM, W.own, W.L; W.w (yayın). BUILD_DEV açıkken W.bd_stat ((ad, şehir) -> sayaç), firma kaydında d['house_fund'] (ayrılmış malzeme bütçesi) ve d['house_inv'] (alınmış malzeme), W.hdev_q girdileri [sahip, birim, inşaat firması]. HOME_OWN açıkken ayrıca W.home (oturduğu evin sahibi hane -> şehir), W.home_n (şehir -> oturulan sahipli birim; kiralık stok = hs - home_n), W.home_res (açılış NPC kiracı/sahip yedeği), W.home_stat (geçiş sayaçları).
KATMAN: L4.
"""
import hashlib
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import keep_amt, lendable, rate_ref, sp_week
from simkit.econ_core import land, working_capital
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
    firms_ = W.firms
    w = W.w
    prim = unit_rent / HOUSE_YIELD
    ratio = hratio[ci]
    px = ratio * prim
    if ci not in hpx_prev:
        hpx_prev[ci] = px
    g = max(-0.003, min(0.003, HOUSE_EXP_DAMP * hexp[ci]))
    hn = W.home_n[ci] if HOME_OWN else 0.0                                              # HOME_OWN: oturulan sahipli birim; doluluk ve boşluk kiralık stok (hs - hn) üzerinden
    occf = min(1.0, occ[ci] / max(1.0, hs[ci] - hn)) if occ[ci] > 0 else 1.0                  # doluluk: yeni birim kiracıyı artırmaz, mevcut kirayı böler
    net_rent = unit_rent * (1.0 - HOUSE_MAINT) * occf
    d_best = dep_slow[0]
    cost_b = HOUSE_BUILD * prim
    y_hold = net_rent / px + g
    offers = []
    for q, u in list(own[ci].items()):
        if u < 1.0 - 1e-9:
            continue
        if HOME_OWN and q == W.human:
            continue                                                         # HOME_OWN: insanın konutu bot kuralıyla satılmaz (insanın konut kararı arayüzü yok)
        if BUILD_DEV and q in firms_:
            offers.extend([q] * int(u + 1e-9))                               # BUILD_DEV (kural 4): inşaat firması elindeki her birimi her hafta satışa sunar (kendi kararı; satılmayan kirada kalır); firma kişi değil, sp_week okunmaz
            continue
        if q.endswith("_sermaye"):
            offers.append(q)                                                 # haciz: havuz konutu piyasaya arz eder
            continue
        if (L.bal[q] + (deposits[q][1] if q in deposits else 0.0) < HOUSE_SQUEEZE_W * sp_week(W, q)) or y_hold < d_best - HOUSE_SELL_MARGIN:
            offers.append(q)
    if HOME_OWN:                                                             # HOME_OWN (kural 4): ev sahibinin kendi kararı; nakdi HOME_SELL_WEEKS haftalık sepetin altındaysa satışa çıkarır (önce kiralığı, yoksa evi)
        bsk_ = sum(land(W, ci, p_) * q_ for p_, q_ in BASKET.items()) * W.MARKET_MARKUP
        for q in sorted(k_ for k_, v_ in W.home.items() if v_ == ci):
            if q in offers or q == W.human:
                continue
            if people[q]["who"] != "oyuncu" and people[q]["firm"] is None and own[ci].get(q, 0.0) < 1.0 - 1e-9:
                continue                                                     # kira ödemeyecek havuz NPC'si oturduğu evi bu kuralla satmaz (maliyetsiz tasfiye olmasın); kiralık birimini satabilir
            if L.bal[q] + (deposits[q][1] if q in deposits else 0.0) < HOME_SELL_WEEKS * bsk_:
                offers.append(q)
    n_off = len(offers)
    buyers = []
    for q in c["players"]:
        if sum(own[c_].get(q, 0.0) for c_ in list(own)) >= HOUSE_INV_MAX - 1e-9 and not (HOME_OWN and q not in W.home):
            continue                                                         # sahibin kararı: kişi başına en çok HOUSE_INV_MAX yatırım konutu (HOME_OWN: kiracının oturacağı ev yatırım sayılmaz)
        av = L.bal[q] - keep_amt(W, q) + (deposits[q][1] if q in deposits else 0.0)
        if av > 0:
            buyers.append((av, q))
    buyers.sort(key=lambda t: (-t[0], t[1]))
    if HOME_OWN:                                                             # insan bot kuralıyla almaz; çalışan NPC haneler oyunculardan sonra aynı kurallarla alıcıdır (havuz NPC'si değil)
        buyers = [t for t in buyers if t[1] != W.human]
        npcb = []
        for f_ in c["firms"]:
            for q in firms_[f_]["workers"]:
                if people[q]["who"] != "npc" or (sum(own[c_].get(q, 0.0) for c_ in list(own)) >= HOUSE_INV_MAX - 1e-9 and q in W.home):
                    continue
                av = L.bal[q] - keep_amt(W, q) + (deposits[q][1] if q in deposits else 0.0)
                if av > 0:
                    npcb.append((av, q))
        npcb.sort(key=lambda t: (-t[0], t[1]))
        buyers += npcb
    vacancy = hs[ci] - hn - sum(own[ci].values())
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
        tenant = HOME_OWN and q not in W.home                                # kiracının OTURMAK için alımı kullanıcı maliyeti kuralından geçer: ödediği kira (bakım düşülmüş) >= fiyat x (mevduat faizi - beklenen fiyat değişimi)
        nr_b = unit_rent * (1.0 - HOUSE_MAINT) if tenant else net_rent
        prem_b = 0.0 if tenant else HOUSE_RISK_PREM
        if nr_b / price_u + g <= d_best + prem_b:
            continue
        cost = price_u * (1.0 + (HOUSE_TXN if kind == "sec" else 0.0))
        mort_ = None
        if CX_ACT and kind in ("sec", "pri"):
            m_rate = max(CX_RATE_MIN, rate_ref(W) + CX_MORT_MARGIN)
            y_b = nr_b / price_u + g
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
            if HOME_OWN:
                house_unit_out(W, ci, s_)
                house_unit_in(W, ci, q)
            else:
                own[ci][s_] -= 1.0
                if own[ci][s_] < 1e-9:
                    del own[ci][s_]
                own[ci][q] += 1.0
            hst["sec_n"] += 1
            hst["sec_vol"] += price_u + (mort_[1] if mort_ is not None else 0.0)
            if BUILD_DEV and s_ in firms_:
                W.bd_stat[("satis_adet", ci)] += 1
                W.bd_stat[("satis_geliri", ci)] += price_u + (mort_[1] if mort_ is not None else 0.0)       # davranışsız ölçüm: satıştan firmaya giren bedel (ipotek payı dahil)
            L.flows["konut_ikinci_el_adet"] += 1
        elif kind == "pri":
            L.pay(q, c["acct"], price_u, "konut_satisi")
            if HOME_OWN:
                house_unit_in(W, ci, q)
            else:
                own[ci][q] += 1.0
            vacancy -= 1.0
            hst["pri_n"] += 1
            L.flows["konut_alim_adet"] += 1
        else:
            L.pay(q, c["acct"], price_u, "konut_insaat")
            hs[ci] += 1.0
            if HOME_OWN:
                house_unit_in(W, ci, q)
            else:
                own[ci][q] += 1.0
            builds += 1
            hst["build_n"] += 1
            L.flows["konut_yeni_adet"] += 1
        bought += 1
    imb = (want - n_off) / max(1, want + n_off)
    fund_ = net_rent / max(HOUSE_YIELD if HOME_OWN else 1e-4, d_best + HOUSE_RISK_PREM - g) / prim              # alıcının kayıtsız kaldığı fiyat / birincil fiyat (temel değer)
    nr = ratio * (1.0 + HOUSE_PRICE_ADJ * imb) + HOUSE_ANCHOR * (min(HOUSE_PX_MAX, max(HOUSE_PX_MIN, fund_)) - ratio)
    if HOME_OWN and want == 0:
        nr = min(nr, ratio)                                                      # alıcı yokken ikinci el fiyatı yükselmez (yalnız aşağı / temel değere doğru)
    if hs[ci] - (W.home_n[ci] if HOME_OWN else 0.0) - sum(own[ci].values()) >= 1.0 - 1e-9:
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
    hn = W.home_n[ci] if HOME_OWN else 0.0                                              # HOME_OWN: kiralık stok = hs - oturulan sahipli birim
    vac = (hs[ci] - hn - occ[ci]) / max(1.0, hs[ci] - hn)
    pending = sum(e_[1] for e_ in hdev_q[ci])
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
    net_rent = unit_rent * (1.0 - HOUSE_MAINT) * min(1.0, occ[ci] / max(1.0, hs[ci] - hn))
    g = max(-0.003, min(0.003, HOUSE_EXP_DAMP * hexp[ci]))
    if net_rent / cost_u + g <= rate_ref(W) + HOUSE_RISK_PREM:
        hdev_stat["red_getiri"] += 1
        return
    room = max(0, HOUSE_DEV_MAXW - int(pending))
    if room <= 0:
        return
    muni = f"s{ci}_belediye0"
    bf0 = None
    if BUILD_DEV:
        bf0 = house_bd_builder(W, ci)                                        # BUILD_DEV: konutu inşaat firması yapar; şehirde kadrolu inşaat firması yoksa kimse başlatamaz
        if bf0 is None:
            W.bd_stat[("red_firma", ci)] += 1
            return
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
        if BUILD_DEV:                                                        # arsa bedeli şehre; emek + malzeme bedeli inşaatı yapan firmaya (firma işçisine öder, malzemeyi kendisi alır); kredi önce firma payına
            m_f = min(mort_[1], tot_c) if mort_ else 0.0
            L.pay(q, bf0, tot_c - m_f, "konut_insaat_bedeli")
            L.pay(q, c["acct"], plot - ((mort_[1] - m_f) if mort_ else 0.0), "konut_arsa_emek")
            if mort_:
                L.pay(f"{mort_[0]}_sermaye", bf0, m_f, "ipotek_kredisi")
                L.pay(f"{mort_[0]}_sermaye", c["acct"], mort_[1] - m_f, "ipotek_kredisi")
        else:
            L.pay(q, c["acct"], plot + (tot_c - mat), "konut_arsa_emek")            # arsa ve emek payı şehre
            L.pay(q, muni, mat - (mort_[1] if mort_ else 0.0), "konut_insaat_bedeli")     # malzeme bütçesi yapı yönetimine (belediye kaydı)
            if mort_:
                L.pay(f"{mort_[0]}_sermaye", muni, mort_[1], "ipotek_kredisi")
        if mort_:
            mortgages.append(dict(q=q, ci=ci, lo=mort_[0], p0=mort_[1], out=mort_[1], miss=0, rate=mort_[2], since=NOW[0]))
            cx_stat["hacim_konut"] += mort_[1]
            L.flows["kredi_konut_adet"] += 1
            hdev_stat["ipotekli"] += 1
        if BUILD_DEV:
            firms[bf0]["house_fund"] = firms[bf0].get("house_fund", 0.0) + mat
            hdev_q[ci].append([q, 1.0, bf0])
            W.bd_stat[("siparis_basladi", ci)] += 1
        else:
            firms[muni]["house_fund"] = firms[muni].get("house_fund", 0.0) + mat
            hdev_q[ci].append([q, 1.0])
        started += 1
        hdev_stat["basladi"] += 1
        L.flows["konut_baslayan_adet"] += 1
    if BUILD_DEV and started < room:                                         # spekülatif geliştirme: aynı tetik koşulları inşaat firmasına uygulanır; firma işletme sermayesi ve ayrılmış malzeme bütçesi üstündeki kendi nakdiyle yapar (emek kendi kadrosu, malzemeyi house_buy alır)
        for f in house_bd_builders(W, ci):
            if started >= room:
                break
            d_ = firms[f]
            if L.bal[f] - working_capital(W, firms, people, f) - d_.get("house_fund", 0.0) < plot + mat:
                W.bd_stat[("red_nakit", ci)] += 1
                continue
            L.pay(f, c["acct"], plot, "konut_arsa_emek")
            d_["house_fund"] = d_.get("house_fund", 0.0) + mat
            hdev_q[ci].append([f, 1.0, f])
            started += 1
            hdev_stat["basladi"] += 1
            L.flows["konut_baslayan_adet"] += 1
            W.bd_stat[("spek_basladi", ci)] += 1


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
    if BUILD_DEV:
        return house_bd_buy(W, cyc, supply)
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


def house_bd_builders(W, ci):
    """BUILD_DEV: şehrin geliştirici adayları: canlı `insaat` firmaları, kadro büyükten küçüğe, eşitse küçük kimlik önce (deterministik; RNG yok). Kadrosuz firma da aday: siparişin malzeme talebi (house_buy → last_demand) kadro sinyalidir, bedel firmanın kasasına girer."""
    firms = W.firms
    return sorted((f for f in W.cities[ci]["firms"] if firms[f]["kind"] == "insaat" and not firms[f].get("dead")), key=lambda f: (-len(firms[f]["workers"]), f))


def house_bd_builder(W, ci):
    """BUILD_DEV (sipariş usulü): siparişi alan firma = en büyük kadrolu canlı inşaat firması, eşitse küçük kimlik (gerekçe: iş hacmini kadro taşır; kural ve rastgelelik yok; hepsi kadrosuzsa en küçük kimlik). Yoksa None."""
    bl = house_bd_builders(W, ci)
    return bl[0] if bl else None


def house_bd_buy(W, cyc, supply):
    """BUILD_DEV: inşaat firması, ayrılmış malzeme bütçesi (`house_fund`) ve kendi kasasıyla `insaat` malını piyasadan kalan arzdan takasla alır (belediye yapı yönetimi aracı değil);
    90 birim malzeme gelince sıradaki iş biter: sipariş ise birim siparişi verenin (HOME_OWN açıkken oturduğu evi olmayan kiracının ilk birimi oturduğu ev), spekülatif ise firmanın (kirada, satışta). Yeni stok = yeni sahipli birim."""
    L = W.L
    cities = W.cities
    firms = W.firms
    hdev_q = W.hdev_q
    hdev_stat = W.hdev_stat
    hs = W.hs
    hst = W.hst
    own = W.own
    left = CYCLES_PER_WEEK - cyc
    dem = defaultdict(list)
    for ci, q_ in hdev_q.items():
        pend = defaultdict(float)
        for e_ in q_:
            pend[e_[2]] += e_[1]
        for f in sorted(pend):
            d_ = firms[f]
            want = max(0.0, pend[f] * HOUSE_INS_UNITS / left - d_.get("house_inv", 0.0))
            fund = min(d_.get("house_fund", 0.0), L.bal[f])
            est = want * land(W, ci, "insaat") * (1 + NAVLUN)
            if est > fund > 1e-9:
                want *= fund / est
            if want > 1e-9 and fund > 1e-9:
                dem[ci].append([f, want, -2] if QL_ACT else [f, want])
                cities[ci]["last_demand"]["insaat"] += want
    if dem:
        if FP_ACT:
            got, cost, _sr, _qr = clear_fp(W, "insaat", supply["insaat"], dem, "konut")
        else:
            got, cost = clear(W, "insaat", supply["insaat"], dem, "konut")
        for f, u in got.items():
            firms[f]["house_inv"] = firms[f].get("house_inv", 0.0) + u
        for f, cst in cost.items():
            firms[f]["house_fund"] = max(0.0, firms[f].get("house_fund", 0.0) - cst)
            hdev_stat["malzeme_akce"] += cst
            L.flows["konut_malzemesi_akce"] += cst
    for ci, q_ in hdev_q.items():
        for f in sorted({e_[2] for e_ in q_}):
            d_ = firms[f]
            while d_.get("house_inv", 0.0) >= HOUSE_INS_UNITS - 1e-9:
                i_ = next((i for i, e_ in enumerate(q_) if e_[2] == f), None)
                if i_ is None:
                    break
                d_["house_inv"] -= HOUSE_INS_UNITS
                inv_, u, _f = q_.pop(i_)
                if inv_ in firms or not HOME_OWN:
                    own[ci][inv_] += 1.0
                else:
                    house_unit_in(W, ci, inv_)                              # HOME_OWN: oturduğu evi olmayan kiracının ilk birimi oturduğu ev (G12 kuralı)
                hs[ci] += 1.0
                hst["build_n"] += 1
                L.flows["konut_yeni_adet"] += 1
                hdev_stat["tamamlandi"] += 1
                W.bd_stat[("spek_bitti" if inv_ == f else "siparis_bitti", ci)] += 1
            if d_.get("house_fund", 0.0) > 0.0 and not any(e_[2] == f for e_ in q_):
                d_["house_fund"] = 0.0                                      # bekleyen iş kalmadı: ayrılmış malzeme bütçesinin artığı serbest (kasada zaten duruyor; yalnız ayırma kaydı)


def house_bd_alacakli(W, f):
    """BUILD_DEV: batan inşaat firmasının birimlerini devralan lonca (tasfiye alacaklısı): firma tasfiye kaydındaki kredinin loncası; yoksa firmanın kendi loncası; yoksa kimliği en küçük açık lonca."""
    ln = (W.estate.get(f) or {}).get("loan")
    if ln and ln.get("lo") in W.loncas:
        return ln["lo"]
    lo = W.firms[f].get("lonca")
    if lo in W.loncas:
        return lo
    ok = sorted(l_ for l_ in W.loncas if l_ not in W.closed)
    return ok[0] if ok else sorted(W.loncas)[0]


def house_bd_sweep(W):
    """BUILD_DEV: batan inşaat firmasının (herhangi bir ölüm yolu) elindeki birimler kira dağıtımından ÖNCE alacaklı loncanın havuzuna (`<lonca>_sermaye`) geçer: havuz konutu ikinci elde satışa çıkarır, satılana kadar kira havuza gider (ölü kasaya değil; mevcut haciz kuralının aynısı).
    Bekleyen işler biter: sipariş verenin ödediği bedel firmanın tasfiye masasındadır (iade yok), spekülatif iş düşer. Şehrin payı artmaz (birimler sahipli kalır)."""
    firms = W.firms
    own = W.own
    for c in W.cities:
        ci = c["i"]
        for f in sorted(k for k in list(own[ci]) if k in firms and firms[k].get("dead")):
            u = own[ci].pop(f)
            if u > 1e-9:
                own[ci][f"{house_bd_alacakli(W, f)}_sermaye"] += u
                W.bd_stat[("devir_birim", ci)] += u
    for ci, q_ in W.hdev_q.items():
        for e_ in list(q_):
            if firms[e_[2]].get("dead"):
                q_.remove(e_)
                W.bd_stat[("spek_kayip" if e_[0] == e_[2] else "siparis_kayip", ci)] += 1


def house_bd_meas(W):
    """BUILD_DEV: davranışsız ölçüm (yalnız okur). Şehir başına anlık: birim (inşaat firmalarının elindeki), birim_kirada (doluluk oranıyla), birim_satilik (hepsi her hafta satışta), kadro (canlı inşaat firmalarının toplam kadrosu), kasa; kümülatif sayaçlar (W.bd_stat)."""
    out = {}
    firms = W.firms
    for c in W.cities:
        ci = c["i"]
        fl = [f for f in c["firms"] if firms[f]["kind"] == "insaat" and not firms[f].get("dead")]
        birim = sum(u for q, u in W.own[ci].items() if q in firms)
        rs = W.hs[ci] - (W.home_n[ci] if HOME_OWN else 0.0)
        d = dict(birim=birim, birim_kirada=birim * min(1.0, W.occ[ci] / rs) if rs > 0 else 0.0, birim_satilik=birim,
                 kadro=sum(len(firms[f]["workers"]) for f in fl), kasa=sum(W.L.bal[f] for f in fl))
        for k in ("siparis_basladi", "siparis_bitti", "siparis_kayip", "spek_basladi", "spek_bitti", "spek_kayip", "devir_birim", "kira_geliri", "satis_geliri", "satis_adet", "red_firma", "red_nakit"):
            d[k] = W.bd_stat.get((k, ci), 0.0)
        out[ci] = d
    return out


def house_unit_out(W, ci, s_):
    """HOME_OWN: satıcıdan bir konut birimi çıkar: önce kiralık birimi, yoksa oturduğu ev (satıcı kiracı olur). Sayaç: kiralik_satildi / ev_sahibi_satti."""
    own = W.own
    if own[ci].get(s_, 0.0) >= 1.0 - 1e-9:
        own[ci][s_] -= 1.0
        if own[ci][s_] < 1e-9:
            del own[ci][s_]
        W.home_stat[("kiralik_satildi", ci)] += 1
    else:
        del W.home[s_]
        W.home_n[ci] -= 1
        W.home_stat[("ev_sahibi_satti", ci)] += 1


def house_unit_in(W, ci, q):
    """HOME_OWN: alıcıya bir birim ekler: oturduğu evi olmayan kiracının şehirdeki ilk alımı oturduğu ev olur (kira ödemeyi bırakır; birim kiralık stoktan çıkar), sonrakiler yatırım konutu. Sayaç: kiraci_ev_aldi."""
    if q not in W.home:
        W.home[q] = ci
        W.home_n[ci] += 1
        W.home_stat[("kiraci_ev_aldi", ci)] += 1
        if W.people[q]["who"] == "npc":
            W.home_stat[("kiraci_ev_aldi_npc", ci)] += 1
    else:
        W.own[ci][q] += 1.0


def house_home_key(ci, q, salt):
    return int(hashlib.md5(f"home{salt}|{RUN_SEED}|{ci}|{q}".encode()).hexdigest()[:12], 16)


def house_home_open(W):
    """HOME_OWN (REKABET G12): açılışta konut stokunun TAMAMI özel mülkiyete dağıtılır (şehrin payı sıfır). hf1 kadro kurulumundan sonra, ilk kira ödemesinden önce çağrılır (phase_cycle_setup, bir kez).
    Konutta oturan hane kümesi R = kira ödeyen bütün haneler = şehrin oyuncuları + işe girmiş NPC'ler (EV koşulu HOUSE_MODE=1: stok = HOUSE_SLACK x (oyuncu + hf1'de işe giren NPC), hayalet kiracı kalmaz).
    (a) R'nin HOME_OWN_SHARE[şehir] oranı oturduğu evin sahibi (W.home); (b) kalan stok (kiracıların ve boş birimler) bu ev sahiplerinden seçilen çok evli haneye
    HOME_MULTI_MIX oranlarıyla 1/2/3 kiralık birim olarak dağıtılır (W.own); Açılış stoku = ev sahiplerinin oturduğu birimler + HOUSE_SLACK x kiracı hane (HOUSE_MODE=1 tahmini yerine; kiralık boşluk her şehirde ~%13).
    (c) ev sahipleri kalanı 3'erle taşıyamazsa hepsi çok evli olur ve artık eşit dağıtılır (tavan aşılır).
    Seçimler tohumdan (RUN_SEED) ve kimlikten türeyen karmayla belirlenir; hiçbir RNG akışı tüketilmez. Ev bir varlıktır: hiçbir bakiye değişmez."""
    W.home_open = True
    if not (HOME_OWN and HI_ACT):
        return
    sum_mix = float(sum(HOME_MULTI_MIX))
    for c in W.cities:
        ci = c["i"]
        if int(round(W.hs[ci])) <= 0:
            continue
        players = list(c["players"])
        npcs = sorted({q for f in c["firms"] for q in W.firms[f]["workers"] if W.people[q]["who"] == "npc"})
        W.home_res[ci] = set(npcs)
        hane = players + npcs
        share = HOME_OWN_SHARE[ci % len(HOME_OWN_SHARE)]
        n_own = min(len(hane), int(share * len(hane) + 0.5))
        n_st = n_own + int(round(HOUSE_SLACK * (len(hane) - n_own)))          # açılış stoku = sahiplerin oturduğu birimler + HOUSE_SLACK x kiracı hane: boşluk payı yalnız kiralık bölümde, kiracı sayısıyla orantılı (sahiplik oranı kira/fiyatı yapay etkilemesin)
        W.hs[ci] = float(n_st)
        W.hs0[ci] = W.hs[ci]
        owners = sorted(hane, key=lambda q: (house_home_key(ci, q, "o"), q))[:n_own]
        for q in owners:
            W.home[q] = ci
        W.home_n[ci] = n_own
        rem = n_st - n_own
        lords = sorted(owners if owners else hane, key=lambda q: (house_home_key(ci, q, "m"), q))
        n_l = len(lords)
        if rem <= 0 or n_l == 0:
            continue
        if rem > 3 * n_l:                                                   # (c): kalan stok 3'erle taşınamaz; hepsi çok evli, artık eşit
            ks = [rem // n_l + (1 if j < rem % n_l else 0) for j in range(n_l)]
            W.home_stat[("tavan", ci)] = 1
        else:
            avg = sum((j + 1) * p for j, p in enumerate(HOME_MULTI_MIX)) / sum_mix
            m = max(-(-rem // 3), min(int(round(rem / avg)), rem, n_l))
            want = [p / sum_mix * m for p in HOME_MULTI_MIX]
            cnt = [int(round(w_)) for w_ in want]
            cnt[0] = min(cnt[0], m)
            cnt[2] = min(cnt[2], m - cnt[0])
            cnt[1] = m - cnt[0] - cnt[2]
            diff = rem - sum(cnt[j] * (j + 1) for j in range(3))
            while diff > 0:
                j = max((j for j in (0, 1) if cnt[j] > 0), key=lambda j: ((want[j + 1] - cnt[j + 1]) - (want[j] - cnt[j]), -j))
                cnt[j] -= 1
                cnt[j + 1] += 1
                diff -= 1
            while diff < 0:
                j = max((j for j in (1, 2) if cnt[j] > 0), key=lambda j: ((want[j - 1] - cnt[j - 1]) - (want[j] - cnt[j]), j))
                cnt[j] -= 1
                cnt[j - 1] += 1
                diff += 1
            ks = [1] * cnt[0] + [2] * cnt[1] + [3] * cnt[2]
        for q, k in zip(lords, ks):
            W.own[ci][q] += float(k)


def house_home_meas(W):
    """HOME_OWN: davranışsız ölçüm (yalnız okur; RNG yok, durum yok). Şehir başına: stok, ev_sahibi (oturduğu evin sahibi hane), kiraci (kira ödeyen), hane (şehirde oturan: oyuncu + çalışan NPC + şehirde yaşayan konut sahibi),
    dagilim (0,1,2,3,4,5+ konutu olan hane sayısı; konutlar her şehirden, uzaktan ev sahipleri dahil), oyuncu / oyuncu_sahip, ozel/lonca/sehir stok payı, kira_alan, ikinci el fiyat, birim kira, kiralık stok,
    boşluk (kiralık stok ve toplam stok üzerinden ayrı), en çok konutu olan %10 hanenin kiralık stok payı, kira/gelir (kiracı hanelerin ortalama haftalık brüt ücreti), fiyat/yıllık net gelir, sayaçlar (kümülatif)."""
    out = {}
    people = W.people
    tot = defaultdict(int)
    for q in W.home:
        tot[q] += 1
    for od in W.own.values():
        for q, u in od.items():
            if not q.endswith("_sermaye"):
                tot[q] += int(round(u))
    for c in W.cities:
        ci = c["i"]
        hs = W.hs[ci]
        hn = W.home_n[ci]
        rs = hs - hn
        own_c = W.own[ci]
        ozel = sum(u for q, u in own_c.items() if not q.endswith("_sermaye"))
        havuz = sum(u for q, u in own_c.items() if q.endswith("_sermaye"))
        sahip = [q for q, v in W.home.items() if v == ci]
        res = set(c["players"]) | {q for f in c["firms"] for q in W.firms[f]["workers"] if people[q]["who"] == "npc"} | set(sahip) | {q for q in tot if q in people and people[q]["city"] == ci}
        dag = [0] * 6
        for q in res:
            dag[min(tot.get(q, 0), 5)] += 1
        kiraci_l = [q for q in res if q not in W.home]
        unit_rent = W.RENT_CY[ci] * CYCLES_PER_WEEK
        fiyat = unit_rent / HOUSE_YIELD * (W.hratio.get(ci, 1.0) if HI_ACT else 1.0)
        birimler = sorted((u for q, u in own_c.items() if not q.endswith("_sermaye")), reverse=True)
        k10 = max(1, -(-len(res) // 10))
        ort_ucret = lambda L_: sum(people[q]["wage"] for q in L_) * CYCLES_PER_WEEK / len(L_) if L_ else 0.0
        n_pl = len(c["players"])
        out[ci] = dict(stok=hs, ev_sahibi=len(sahip), oyuncu=n_pl, oyuncu_sahip=sum(1 for q in c["players"] if W.home.get(q) == ci),
                       kiraci=int(round(W.occ[ci])), hane=len(res), dagilim=dag,
                       ozel_pay=(ozel + hn) / hs if hs > 0 else 0.0, lonca_pay=havuz / hs if hs > 0 else 0.0, sehir_pay=(hs - hn - ozel - havuz) / hs if hs > 0 else 0.0,
                       kira_alan=sum(1 for q, u in own_c.items() if not q.endswith("_sermaye") and u > 0.5),
                       fiyat=fiyat, kira=unit_rent, kiralik_stok=rs,
                       bosluk_kiralik=(rs - W.occ[ci]) / rs if rs > 0 else 0.0, bosluk_toplam=(rs - W.occ[ci]) / hs if hs > 0 else 0.0,
                       top10_pay=sum(birimler[:k10]) / rs if rs > 0 else 0.0,
                       kira_gelir=unit_rent / ort_ucret(kiraci_l) if kiraci_l and ort_ucret(kiraci_l) > 0 else 0.0,
                       fiyat_gelir=fiyat / (52.0 * ort_ucret(list(res)) * (1.0 - WAGE_TAX)) if res and ort_ucret(list(res)) > 0 else 0.0,
                       kiraci_ev_aldi=W.home_stat.get(("kiraci_ev_aldi", ci), 0), kiraci_ev_aldi_npc=W.home_stat.get(("kiraci_ev_aldi_npc", ci), 0),
                       ev_sahibi_satti=W.home_stat.get(("ev_sahibi_satti", ci), 0), kiralik_satildi=W.home_stat.get(("kiralik_satildi", ci), 0),
                       goc_birakti=W.home_stat.get(("goc_birakti", ci), 0), goc_birakti_npc=W.home_stat.get(("goc_birakti_npc", ci), 0), goc_birakti_oyuncu=W.home_stat.get(("goc_birakti_oyuncu", ci), 0),
                       kira_odeyen=int(round(W.occ[ci])), kiralik_dolu=min(int(round(W.occ[ci])), rs), hayalet=max(0.0, W.occ[ci] - rs))
    return out
