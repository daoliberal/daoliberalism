"""simkit.firms: firma işlemleri: oda kontrolü, lonca ücreti, capex_*, yeniden satış, hizmet firmaları (svc_*).

ARAYÜZ: resale_step, room_ok, charge_lonca, capex_start, svc_firms, svc_pay, capex_plan, capex_buy
OKUR/YAZAR: W.firms, W.L, W.cities.
KATMAN: L4.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.credit_core import capex_eligible, cx_costs, cx_lend, cx_ok, cx_say, lendable, renew_lend, take_fee, young_lend
from simkit.rate_behav import rb_credit_gate, rb_state
from simkit.cash_rules import pk_grow_ok, pk_rbar_update
from simkit.econ_core import cap_ceiling, land, working_capital
from simkit.firm_exit import liq_buy
from simkit.market import clear, clear_fp


def resale_step(W, w):
    """K-174: değer kaybı; nakit sıkışan (sepet + kira karşılanamıyor) ve gönüllü satıcılar ilan verir; talep (ikinci ele yönlenen alıcılar) ve geri alım; fiyat arz-talebe göre oynar."""
    L = W.L
    REF = W.REF
    RENT_CY = W.RENT_CY
    cities = W.cities
    dealer_inv = W.dealer_inv
    firms = W.firms
    hab = W.hab
    held = W.held
    people = W.people
    sh_price = W.sh_price
    sh_req = W.sh_req
    sh_share = W.sh_share
    sh_stat = W.sh_stat
    for p in held:
        for q in list(held[p]):
            held[p][q] *= 1.0 - DEPR[p]
    players_ = [q for q, i_ in people.items() if i_["who"] == "oyuncu"]
    for p in ("mucevher", "insaat"):
        price = sh_price[p] * REF[p]
        listings = []
        for q in players_:
            v = held[p].get(q, 0.0)
            if v <= 1e-9:
                continue
            ci = people[q]["city"]
            need_w = sum(land(W, ci, pp) * qq for pp, qq in BASKET.items()) * W.MARKET_MARKUP + (RENT_CY.get(ci, 0.0) * CYCLES_PER_WEEK if (HOUSE_ON and not (HOME_OWN and q in W.home)) else 0.0)
            short = SQUEEZE_W * need_w - L.bal[q]
            if short > 0:
                sell = min(v, short / max(1e-9, price))
                listings.append([q, sell, True])
            elif v * price > RESALE_KEEP * hab.get(q, 10.0) * 28 and sh_req[p]:
                listings.append([q, SELL_RATE * v, False])
        for (f_, pp), v in dealer_inv.items():
            if pp == p and v > 1e-9:
                listings.append([f_, v, False])
        S = sum(l[1] for l in listings)
        D = sum(sh_req[p].values())
        m_units = 0.0
        if S > 1e-9 and D > 1e-9:
            m = min(S, D)
            got = {}
            for b, rq in list(sh_req[p].items()):
                u = min(rq * m / D, L.bal[b] / price if price > 0 else 0.0)
                if u > 1e-12:
                    paid = L.pay(b, "ikinci_el_takas", u * price, "ikinci_el_satis")
                    got[b] = paid / price
            m_units = sum(got.values())
            if m_units > 1e-9:
                for b, u in got.items():
                    held[p][b] += u
                for l in listings:
                    sold = l[1] * m_units / S
                    L.pay("ikinci_el_takas", l[0], sold * price, "ikinci_el_satis")
                    if l[0] in people:
                        held[p][l[0]] -= sold
                    else:
                        dealer_inv[(l[0], p)] -= sold
                    l[1] -= sold
                sh_stat[p + "_adet"] += m_units
                sh_stat[p + "_ciro"] += m_units * price
        if L.bal["ikinci_el_takas"] > 1e-9:
            L.pay("ikinci_el_takas", "sehir0", L.bal["ikinci_el_takas"], "ikinci_el_takas_artigi")
        for l in listings:                                          # satılamayan sıkışık satıcı: kuyumcu/inşaat firması geri alır
            if l[2] and l[1] > 1e-9 and l[0] in people:
                q = l[0]
                kd = "kuyumcu" if p == "mucevher" else "insaat"
                cands = [f_ for f_ in cities[people[q]["city"]]["firms"] if firms[f_]["kind"] == kd and not firms[f_].get("dead") and firms[f_]["workers"]]
                if cands:
                    f_ = cands[0]
                    pb = BUYBACK * REF[p]
                    u = min(l[1], 0.3 * L.bal[f_] / pb)
                    if u > 1e-9:
                        paid = L.pay(f_, q, u * pb, "ikinci_el_geri_alim")
                        u = paid / pb
                        held[p][q] -= u
                        dealer_inv[(f_, p)] += u
                        sh_stat[p + "_geri_alim"] += u
        r = (D - S) / max(D, S, 1e-9)
        sh_price[p] = min(1.0, max(SH_MIN, sh_price[p] * (1.0 + SH_ADJ * r)))
        sh_share[p] = SH_SHARE * min(1.0, S / max(D, 1e-9)) if D > 1e-9 else SH_SHARE * (1.0 if S > 0 else 0.0)
        sh_req[p].clear()
        sh_stat[p + "_fiyat_sonu"] = sh_price[p]


def room_ok(W, p, c, w, thr):
    """K-174: kuruluş sinyali istikrarlı olmalı (son 6 haftanın en az 3'ünde kök eksiklik bir çalışanlık çıktı değerinin yarısını aşmış) ve henüz olgunlaşmamış yeni firmaların (12 haftadan genç, 2 çalışan) kapasitesi düşüldükten sonra boşluk en az ROOM_K çalışanlık olmalı."""
    cities = W.cities
    firms = W.firms
    short_hist = W.short_hist
    h = short_hist[p]
    if sum(1 for v in h if v >= 0.5 * thr) < ROOM_MINW:
        return False
    kind = PRODUCER[p]
    scopes = [c["i"]] if p in LOCAL_ONLY else range(len(cities))
    young = sum(2 for d_ in firms.values() if d_["kind"] == kind and not d_.get("dead") and d_.get("owner") is not None and d_["city"] in scopes and w - d_.get("born", -999) < ROOM_YOUNG)
    return h[-1] + 0.5 * c["last_imports"].get(p, 0.0) - young * thr >= ROOM_K * thr


def charge_lonca(W, lo):
    """K-174: lonca işletme gideri (sabit + üye başına), şehre; önce lonca kasasından, yetmezse havuzdan; ödenemeyen kasayı eritir."""
    L = W.L
    cities = W.cities
    cost_stat = W.cost_stat
    lo_members = W.lo_members
    lo_unpaid = W.lo_unpaid
    lonca_owner = W.lonca_owner
    if lo in lonca_owner or True:
        cost = ((ix(W, LC_FIXED) * max(LC_SCALE_MIN, (lo_members[lo] / LC_SCALE_N) ** 0.5) if NL_ACT else ix(W, LC_FIXED)) + ix(W, LC_MEMBER) * lo_members[lo]) / CYCLES_PER_WEEK
        acct = cities[int(lo[5:]) % len(cities)]["acct"]
        paid = L.pay(lo, acct, cost, "lonca_gideri")
        short = cost - paid
        if short > 1e-9:
            p2 = L.pay(f"{lo}_sermaye", acct, min(short, lendable(W, lo)), "lonca_gideri")
            short -= p2
        cost_stat[lo + "_gider"] += cost - max(0.0, short)
        if short > 1e-9:
            lo_unpaid[lo] += short
            cost_stat[lo + "_odenmedi"] += short


def capex_start(W, w):
    """K-185.7: haftabaşı: ilk görülen firmaya başlangıç sermayesi, üretim çarpanı capf = min(1, yuva / çalışan)."""
    CAPEX_ON = W.CAPEX_ON
    firms = W.firms
    if not CAPEX_ON or w < CAPEX_START:
        return
    for f, d in firms.items():
        if not capex_eligible(W, d):
            continue
        n = len(d["workers"])
        if "mach" not in d:
            if d["owner"] is not None and w - d.get("born", -999) <= 2:
                d["mach"] = d["bld"] = CAPEX_NEW_SLOTS
            else:
                d["mach"] = d["bld"] = max(CAPEX_MIN_SLOTS, CAPEX_INIT * n)
            d["cx_need_m"] = d["cx_need_b"] = 0.0
        d["capf"] = min(1.0, min(d["mach"], d["bld"]) / max(1.0, n))


def svc_firms(W, ci, kind):
    cities = W.cities
    firms = W.firms
    return [f for f in cities[ci]["firms"] if firms[f]["kind"] == kind and not firms[f].get("dead") and firms[f]["workers"]]


def svc_pay(W, payer, ci, kind, amt, label):
    """K-185.12: hizmet sektörü firmalarına (kadro payıyla) ödeme; lonca fee'si kesilir; geliri kadroya gider."""
    L = W.L
    firms = W.firms
    svc_rev_w = W.svc_rev_w
    fl = svc_firms(W, ci, kind)
    if not fl or amt <= 1e-9:
        return 0.0
    tw = sum(len(firms[f]["workers"]) for f in fl)
    tot = 0.0
    for f in fl:
        got = L.pay(payer, f, amt * len(firms[f]["workers"]) / tw, label)
        svc_rev_w[(ci, kind)] += got
        take_fee(W, f, firms[f]["lonca"], got)
        tot += got
    return tot


def capex_plan(W, w):
    """K-185.7: hafta sonu: amortisman, hedef yuva, haftalık alım planı (kasa ya da yatırım kredisi ile)."""
    CAPEX_ON = W.CAPEX_ON
    L = W.L
    LIQ_ON = W.LIQ_ON
    RENEW_ON = W.RENEW_ON
    YOUNG_ON = W.YOUNG_ON
    capex_stat = W.capex_stat
    capex_ts = W.capex_ts
    estate = W.estate
    firms = W.firms
    people = W.people
    prof_ema = W.prof_ema
    weeks = W.weeks
    if not CAPEX_ON or w < CAPEX_START:
        return
    mc, bc = cx_costs(W)
    if PROFIT_KEEP and PK_GROW:
        pk_rbar_update(W, w)
    for f, d in firms.items():
        if "mach" not in d or not capex_eligible(W, d):
            continue
        capex_stat["amortisman_akce"] += d["mach"] * DEPR_M * mc + d["bld"] * DEPR_B * bc
        L.flows["amortisman_akce"] += d["mach"] * DEPR_M * mc + d["bld"] * DEPR_B * bc
        d["mach"] *= 1.0 - DEPR_M
        d["bld"] *= 1.0 - DEPR_B
        n = len(d["workers"])
        wc = working_capital(W, firms, people, f)
        target = CAPEX_HEAD * n
        grow = 0.0
        if PROFIT_KEEP and PK_GROW and d["owner"] is None:
            if n >= PK_UBAR * d["capacity"] and pk_grow_ok(W, f, d, n):      # K-220: Caiani birikim kuralı (tavan yok)
                grow = CX_CAP_STEP
        elif n >= 0.9 * d["capacity"] and (PROFIT_KEEP or d["capacity"] < cap_ceiling(d) * 2):      # K-220: PROFIT_KEEP açıkken kapasite tavanı yok
            ok_ = (d["owner"] is not None and prof_ema[f] >= ix(W, CX_MIN_PROFIT)) or (d["owner"] is None and L.bal[f] > CAPEX_PROFIT * wc)
            if ok_:
                grow = CX_CAP_STEP
        target += grow
        need_m, need_b = max(0.0, target - d["mach"]), max(0.0, target - d["bld"])
        lim = max(1.0, CAPEX_MAXW * target)
        need_m, need_b = min(need_m, lim), min(need_b, lim)
        if LIQ_ON and estate and (need_m > 1e-9 or need_b > 1e-9):
            gm_, gb_, sp_ = liq_buy(W, f, d, need_m, need_b, max(0.0, L.bal[f] - CAPEX_KEEP * wc))
            d["mach"] += gm_
            d["bld"] += gb_
            need_m -= gm_
            need_b -= gb_
        cost = need_m * mc + need_b * bc
        fund_b = (min(d.get("renew_res", 0.0), L.bal[f]) if RENEW_SOFT else L.bal[f"{f}_yenileme"]) if RENEW_ON else 0.0
        keep_f = (CAPEX_KEEP if (grow or not RENEW_ON) else RENEW_KEEP) * wc
        budget = (max(0.0, L.bal[f] - keep_f) + (min(fund_b, keep_f) if RENEW_SOFT else fund_b))
        if cost > budget + 1e-9:
            amt_ = cost - budget
            got = 0.0
            young_ok = YOUNG_ON and d["owner"] is not None and w - d.get("born", -999) < YOUNG_WEEKS
            if young_ok:
                got = young_lend(W, f, amt_, w, mc, bc)
            gate_ = FZ_FIX and RATE_BEHAV and RB_CREDIT and got <= 1e-9 and d["owner"] is not None and (CX_ACT or (RENEW_ON and not young_ok))
            gated_ = tok_ = False
            if gate_:                                                 # FZ_FIX: faiz kapısı haftanın TEK yatırım borçlanma kararı (cx_lend ve yedeği renew_lend birlikte); cx_ok'tan bağımsız bir kez; reddederse ikisi de atlanır
                tok_ = rb_credit_gate(W, f, "yatirim")
                gated_ = not tok_
                if gated_ and KR_MEAS:
                    cx_say(W, f, w, "yatirim_faiz_kapisi")            # REKABET G4: FZ_FIX kapısı reddetti, tek başvuru tek sonuç (davranışsız sayım)
            if got <= 1e-9 and CX_ACT and d["owner"] is not None and not gated_:
                if cx_ok(W, f, w, "yatirim"):
                    got = cx_lend(W, f, amt_, "yatirim", w, CX_INV_K)
                elif KR_MEAS:
                    cx_say(W, f, w, W._cx_kod)                        # REKABET G4: capex talebi var, eleme reddi sayılır (davranışsız)
            if got <= 1e-9 and RENEW_ON and not young_ok and not gated_:
                got = renew_lend(W, f, amt_, w, mc, bc)
            if tok_ and got <= 1e-9:
                rb_state(W)["acc"][(f, "yatirim")] += 1.0             # kapıdan geçti ama hiçbir kredi açılmadı: hak iade (renew_lend'den sonra)
            if got > 0:
                capex_stat["kredi_akce"] += got
                budget += got
        if cost > budget + 1e-9 and cost > 0:
            sc_ = budget / cost
            need_m, need_b, cost = need_m * sc_, need_b * sc_, budget
        d["cx_need_m"], d["cx_need_b"] = need_m, need_b
        d["capex_cash"] = max(0.0, cost - fund_b)
        if grow and cost > 0:
            d["cx_grow"] = grow
    n_slots = sum(d["mach"] for d in firms.values() if "mach" in d and capex_eligible(W, d))
    n_work = sum(len(d["workers"]) for d in firms.values() if "mach" in d and capex_eligible(W, d))
    if w % 10 == 0 or w == weeks:
        lowf = sum(1 for d in firms.values() if "capf" in d and capex_eligible(W, d) and d["capf"] < 0.95)
        tot_f = sum(1 for d in firms.values() if "capf" in d and capex_eligible(W, d))
        capex_ts.append((w, n_slots, n_work, lowf, tot_f, capex_stat["makine_akce"], capex_stat["bina_akce"], capex_stat["amortisman_akce"], capex_stat["kredi_akce"],
                         sum(len(d["workers"]) for d in firms.values() if d["kind"] in ("insaat",) and d["workers"]), sum(len(d["workers"]) for d in firms.values() if d["kind"] in ("elektronik", "maden_aluminyum") and d["workers"])))


def capex_buy(W, cyc, supply):
    """K-185.7: döngü içi: yatırım yapan firmalar alüminyum, bileşen ve inşaat birimini kalan arzdan (tüketim takasından sonra) takasla alır; alınan mal yuvaya dönüşür."""
    CAPEX_ON = W.CAPEX_ON
    L = W.L
    NOW = W.NOW
    RENEW_ON = W.RENEW_ON
    capex_stat = W.capex_stat
    capinv = W.capinv
    cities = W.cities
    firms = W.firms
    kind_stats = W.kind_stats
    people = W.people
    if not CAPEX_ON or NOW[0] < CAPEX_START:
        return
    left = CYCLES_PER_WEEK - cyc
    buyers = [f for f, d in firms.items() if (d.get("cx_need_m", 0.0) > 1e-9 or d.get("cx_need_b", 0.0) > 1e-9) and capex_eligible(W, d)]

    def run_stage(wants):
        """wants: ürün -> {firma: miktar}; takas ve envanter."""
        dem = {p: defaultdict(list) for p in wants}
        for p, ws in wants.items():
            for f, q in ws.items():
                if q > 1e-9:
                    d = firms[f]
                    dem[p][d["city"]].append([f, q, -1 - d.get("grade", 1)] if QL_ACT else [f, q])
                    cities[d["city"]]["last_demand"][p] += q
        for p, dm in dem.items():
            if not dm:
                continue
            if FP_ACT:
                got, cost, _sr, _qr = clear_fp(W, p, supply[p], dm, "yatirim")
            else:
                got, cost = clear(W, p, supply[p], dm, "yatirim")
            for f, u in got.items():
                capinv[f][p] += u
            for f, cst in cost.items():
                capex_stat["makine_akce" if p != "insaat" else "bina_akce"] += cst
                L.flows["makine_alimi_akce" if p != "insaat" else "bina_insaati_akce"] += cst
                kind_stats[firms[f]["kind"]]["inp"] += cst
                capex_stat["alim_" + firms[f]["kind"]] += cst

    # aşama 1: bileşen (kıt) ve inşaat; aşama 2: alüminyum, eldeki bileşen yuvasına eşleşecek kadar
    w1 = {"bilesen": {}, "insaat": {}}
    budget = {}
    for f in buyers:
        d = firms[f]
        ci = d["city"]
        nm, nb = d.get("cx_need_m", 0.0), d.get("cx_need_b", 0.0)
        want = {"bilesen": max(0.0, nm / left * MACH_BI - capinv[f]["bilesen"]), "aluminyum": max(0.0, nm / left * MACH_AL - capinv[f]["aluminyum"]),
                "insaat": max(0.0, nb / left * BLD_INS - capinv[f]["insaat"])}
        est = sum(q * land(W, ci, p) * (1 + NAVLUN) for p, q in want.items())
        keep_ = (CAPEX_KEEP if (d.get("cx_grow") or not RENEW_ON) else RENEW_KEEP) * working_capital(W, firms, people, f)
        avail = max(0.0, L.bal[f] - keep_)
        if RENEW_ON:
            fb_ = min(d.get("renew_res", 0.0), L.bal[f]) if RENEW_SOFT else L.bal[f"{f}_yenileme"]
            pull = min(fb_, max(0.0, est - avail), min(L.bal[f], keep_) if RENEW_SOFT else 1e18)
            if pull > 1e-9:
                if RENEW_SOFT:
                    d["renew_res"] = d.get("renew_res", 0.0) - pull
                else:
                    L.pay(f"{f}_yenileme", f, pull, "yenileme_cekimi")
                avail += pull
                capex_stat["fon_kullanilan"] += pull
        if est <= 1e-9 or avail <= 1e-9:
            continue
        sc_ = min(1.0, avail / est)
        budget[f] = (sc_, want)
        w1["bilesen"][f] = want["bilesen"] * sc_
        w1["insaat"][f] = want["insaat"] * sc_
    run_stage(w1)
    w2 = {"aluminyum": {}}
    for f, (sc_, want) in budget.items():
        d = firms[f]
        match = min(d.get("cx_need_m", 0.0), capinv[f]["bilesen"] / MACH_BI) * MACH_AL - capinv[f]["aluminyum"]
        w2["aluminyum"][f] = max(0.0, min(match, want["aluminyum"] * max(sc_, 1.0)))
    run_stage(w2)
    for f in buyers:
        d = firms[f]
        inv = capinv[f]
        sm = min(inv["aluminyum"] / MACH_AL, inv["bilesen"] / MACH_BI, d.get("cx_need_m", 0.0))
        if sm > 0:
            d["mach"] += sm
            inv["aluminyum"] -= sm * MACH_AL
            inv["bilesen"] -= sm * MACH_BI
            d["cx_need_m"] -= sm
            capex_stat["makine_yuva"] += sm
        sb = min(inv["insaat"] / BLD_INS, d.get("cx_need_b", 0.0))
        if sb > 0:
            d["bld"] += sb
            inv["insaat"] -= sb * BLD_INS
            d["cx_need_b"] -= sb
            capex_stat["bina_yuva"] += sb
        if d.get("cx_grow") and d["mach"] >= len(d["workers"]) + d["cx_grow"] - 1e-9 and d["bld"] >= len(d["workers"]) + d["cx_grow"] - 1e-9:
            d["capacity"] = d["capacity"] + d.pop("cx_grow")
            capex_stat["kapasite_artis"] += CX_CAP_STEP
