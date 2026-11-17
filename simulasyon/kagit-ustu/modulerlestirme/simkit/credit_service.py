"""simkit.credit_service: kredi hizmetleri: yenileme rezervi, özsermaye, firma kredi planı, mortgage.

ARAYÜZ: renew_reserve, eq_ext, equity_step, gp_tutar, cx_credit_step, mortgage_step
OKUR/YAZAR: W.firms, W.loans, W.mortgages, W.L.
KATMAN: L3.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.credit_core import capex_eligible, cx_base, cx_costs, cx_lend, cx_ok, cx_rm, cx_say, gs_harman, keep_amt, lo_oran, lo_risk, ls_oran, rate_ref
from simkit.dao_core import dao_weekly_cost, free_innovators, live_daos
from simkit.econ_core import cap_ceiling, working_capital
from simkit.fiscal import div_net
from simkit.wages import res_wage
from simkit.sector_core import sb_firm_scarcity, board_stat_add
from simkit.credit_meas import gs_izle
from simkit.rate_behav import rb_credit_factor, rb_credit_gate


def renew_reserve(W):
    """K-185.12: temettü ve NPC kâr süpürmesinden önce amortisman kadarı yenileme fonuna ayrılır."""
    L = W.L
    NOW = W.NOW
    RENEW_ON = W.RENEW_ON
    capex_stat = W.capex_stat
    firms = W.firms
    people = W.people
    if not RENEW_ON or NOW[0] < CAPEX_START:
        return
    mc, bc = cx_costs(W)
    for f, d in firms.items():
        if "mach" not in d or not capex_eligible(W, d):
            continue
        a_ = d["mach"] * DEPR_M * mc + d["bld"] * DEPR_B * bc
        wc = working_capital(W, firms, people, f)
        if RENEW_SOFT:
            res_ = min(d.get("renew_res", 0.0), L.bal[f])           # K-185.17: sanal fon nakit değildir; kasadaki paranın yenileme için kilitli kısmı
            amt = min(a_, max(0.0, L.bal[f] - wc - res_))
            if amt > 1e-9 and res_ < 60 * a_:
                d["renew_res"] = res_ + amt
                capex_stat["fon_ayrilan"] += amt
            else:
                d["renew_res"] = res_
            continue
        amt = min(a_, max(0.0, L.bal[f] - wc))
        if amt > 1e-9 and L.bal[f"{f}_yenileme"] < 60 * a_:
            L.pay(f, f"{f}_yenileme", amt, "yenileme_fonu")
            capex_stat["fon_ayrilan"] += amt


def eq_ext(W, f):
    eq_by = W.eq_by
    return sum(h["share"] for h in eq_by[f].values()) if f in eq_by else 0.0


def equity_step(W, w):
    """K-180: kâr eden firma ve DAO pay satar (sahip kontrolü %51+); yatırımcı beklenen getirisi mevduat faizi + risk primini aşıyorsa alır; batan firmada pay değeri sıfırdır."""
    L = W.L
    bal_prev = W.bal_prev
    dep_slow = W.dep_slow
    dep_tot = W.dep_tot
    deposits = W.deposits
    eq_by = W.eq_by
    eq_cap = W.eq_cap
    eq_last = W.eq_last
    eq_log = W.eq_log
    eq_px = W.eq_px
    eq_stat = W.eq_stat
    firms = W.firms
    haz = W.haz
    inj_w = W.inj_w
    loans = W.loans
    orep = W.orep
    out_prev = W.out_prev
    pay_w = W.pay_w
    people = W.people
    player_firms = W.player_firms
    prof_ema = W.prof_ema
    if not EQ_ACT or w < EQ_START:
        return
    for f in list(eq_by):
        if firms[f].get("dead") or not firms[f]["workers"]:
            for inv_, h_ in eq_by[f].items():
                eq_log.append(dict(f=f, inv=inv_, kind=firms[f]["kind"], cost=h_["cost"], div=h_["div"], end=0.0, week=w, status="battı"))
                eq_stat["kayip"] += h_["cost"]
                L.flows["pay_sifirlanan_adet"] += 1
            del eq_by[f]
            eq_cap[f] = 0.0
    ents = [f for f in player_firms if not firms[f].get("dead") and firms[f]["owner"] in people and firms[f]["workers"]] + [n for n in live_daos(W) if firms[n]["workers"]]
    n_f = sum(1 for f in ents if firms[f]["kind"] != "arge")
    n_d = len(ents) - n_f
    dth_f = L.flows["batan_oyuncu_firmasi_adet"] - eq_stat["_df"]
    dth_d = L.flows["batan_dao_ucret_odenemedi"] + L.flows["batan_dao_temerrut"] - eq_stat["_dd"]
    eq_stat["_df"], eq_stat["_dd"] = L.flows["batan_oyuncu_firmasi_adet"], L.flows["batan_dao_ucret_odenemedi"] + L.flows["batan_dao_temerrut"]
    haz["f"] = 0.95 * haz["f"] + 0.05 * dth_f / max(1, n_f + dth_f)
    haz["d"] = 0.95 * haz["d"] + 0.05 * dth_d / max(1, n_d + dth_d)
    for f in ents:
        out_ = loans[f]["out"] if f in loans else 0.0
        if f in bal_prev:
            prof_ema[f] = 0.9 * prof_ema[f] + 0.1 * ((L.bal[f] - bal_prev[f]) - (out_ - out_prev[f]) + pay_w[f] - inj_w[f])
        bal_prev[f], out_prev[f] = L.bal[f], out_
        pay_w[f] = inj_w[f] = 0.0
        hz_ = haz["d" if firms[f]["kind"] == "arge" else "f"]
        eq_px[f] = (1.0 - EQ_DISC) * max(0.0, prof_ema[f]) / (max(0.0, dep_slow[0]) + EQ_RISK_ISS + hz_)
    offers = {}
    for f in ents:
        d = firms[f]
        born_ = d.get("born", 0)
        if prof_ema[f] < ix(W, EQ_MIN_PROFIT) or w - born_ < EQ_MIN_AGE or w - eq_last[f] < EQ_COOL:
            continue
        ext = eq_ext(W, f)
        if ext >= EQ_MAX_EXT - 1e-9:
            continue
        wk_cost = CYCLES_PER_WEEK * sum(people[q_]["wage"] for q_ in d["workers"])
        if len(d["workers"]) < d["capacity"] or L.bal[f] < EQ_CASH_WEEKS * wk_cost:
            offers[f] = min(EQ_TRANCHE, EQ_MAX_EXT - ext)
    if not offers:
        return
    buyers = []
    for q, i_ in people.items():
        if i_["who"] != "oyuncu" or (HUMAN_ON and q == W.human):      # DAO oyunu: insan kendiliğinden firma/DAO payı almaz
            continue
        av = L.bal[q] - keep_amt(W, q) + (deposits[q][1] if q in deposits else 0.0)
        if av >= ix(W, EQ_MIN_TRADE):
            buyers.append((av, q))
    buyers.sort(key=lambda t: (-t[0], t[1]))
    held_n = defaultdict(int)
    for f, hh in eq_by.items():
        for inv_ in hh:
            held_n[inv_] += 1
    for av, q in buyers:
        if not offers:
            break
        if held_n[q] >= EQ_MAX_HOLD:
            continue
        best = None
        for f, rem in offers.items():
            if firms[f]["owner"] == q or rem <= 1e-9 or eq_px[f] <= 0:
                continue
            y_e = div_net(prof_ema[f]) / eq_px[f]
            excess = y_e - haz["d" if firms[f]["kind"] == "arge" else "f"] * ((1.5 - orep.get(f, 50.0) / 100.0) if ORG_ACT else 1.0) - dep_slow[0] - EQ_RISK_INV
            if excess > 0 and (best is None or excess > best[0]):
                best = (excess, f)
        if best is None:
            continue
        f = best[1]
        spend = min(EQ_FRAC * av, offers[f] * eq_px[f])
        if spend < ix(W, EQ_MIN_TRADE):
            continue
        free_ = L.bal[q] - keep_amt(W, q)
        if free_ < spend and q in deposits and deposits[q][1] > 0:
            lo_d = deposits[q][0]
            got_ = L.pay(f"{lo_d}_sermaye", q, min(deposits[q][1], spend - max(0.0, free_), L.bal[f"{lo_d}_sermaye"]), "mevduat_cekim")
            deposits[q][1] -= got_
            dep_tot[lo_d] -= got_
            free_ = L.bal[q] - keep_amt(W, q)
        spend = min(spend, max(0.0, free_ + 1e-9))
        if spend < ix(W, EQ_MIN_TRADE):
            continue
        paid = L.pay(q, f, spend, "dao_pay_satisi" if firms[f]["kind"] == "arge" else "firma_pay_satisi")
        frac = paid / eq_px[f]
        h_ = eq_by.setdefault(f, {}).setdefault(q, dict(share=0.0, cost=0.0, div=0.0, since=w))
        h_["share"] += frac
        h_["cost"] += paid
        eq_cap[f] += paid
        inj_w[f] += paid
        eq_last[f] = w
        offers[f] -= frac
        held_n[q] += 1
        eq_stat["hacim"] += paid
        L.flows["pay_kaydi_adet"] += 1
        if offers[f] <= 1e-9:
            del offers[f]


def gp_tutar(W, f, hedef):
    """REKABET G17d (GROW_PURPOSE): firmanın kadro planı için büyüme kredisi tutarı = hedef kadronun çarpansız işletme sermayesi (ücret + kira + girdi; working_capital(extra = hedef - kadro)) - kasa, en az 0. Hedef <= kadro ise 0. Köprü limiti düşülmez (köprü bir haftalık ücret içindir, plan sermayesi değildir). Not: working_capital(hedef - kadro) hedef kadronun TOPLAM işletme sermayesidir (artış değil); eski 1,5 katsayılı açığın çarpansız ve plana bağlı hali. SAF okuma."""
    d = W.firms[f]
    ek = hedef - len(d["workers"])
    if ek <= 0:
        return 0.0
    return max(0.0, working_capital(W, W.firms, W.people, f, ek) - W.L.bal[f])


def cx_credit_step(W, w):
    """K-181: kazanca bağlı büyüme kredisi, kapasite yatırımı (bina) ve Ar-Ge DAO'su kadro/buluş bütçesi; faizlerin yeniden fiyatlanması."""
    CAPEX_ON = W.CAPEX_ON
    L = W.L
    cities = W.cities
    cx_stat = W.cx_stat
    firms = W.firms
    loans = W.loans
    mortgages = W.mortgages
    people = W.people
    player_firms = W.player_firms
    if not CX_ACT or w < EQ_START:
        return
    if w % CX_REPRICE == 0:
        base = cx_base(W)
        cx_stat["faiz_son"] = base
        for f, ln in loans.items():
            if ln.get("tur") == "medya":
                tg_ = max(CX_RATE_MIN, base)
            elif f in firms:
                tg_ = max(CX_RATE_MIN, (base + lo_risk(W, ln["lo"])) * cx_rm(W, f))
                if LONCA_SELECT and "pd" in ln:                    # REKABET G4: LONCA_SELECT kredisinde risk primi ve açılış spread'i yeniden fiyatlamada korunur (tek formül: ls_oran)
                    tg_ = ls_oran(tg_, ln.get("spread", 0.0), ln["pd"], cx_rm(W, f), w - firms[f].get("born", w))
                if LONCA_TERMS:                                       # REKABET G5: tek faiz fonksiyonu; kayıttaki açılış spread'i ömür boyu sabit (kayıtta yoksa 0)
                    tg_ = lo_oran(W, ln["lo"], f, ln, w - firms[f].get("born", w))
            else:
                continue
            if ln.get("gs_p0") and (ln.get("tur") == "medya" or not LONCA_TERMS):       # G15: gs tranşı kendi pd ve spread'iyle (LONCA_TERMS açıkken lo_oran zaten harmanlar)
                tg_ = gs_harman(W, ln, f, tg_)
            ln["rate"] = (ln.get("rate", tg_) + POL_PASS_ADJ * (tg_ - ln.get("rate", tg_))) if POL_PASS_LOAN else tg_       # M12 ek (3): kademeli uyum
        for m in mortgages:
            tg_ = max(CX_RATE_MIN, rate_ref(W) + CX_MORT_MARGIN)
            m["rate"] = (m.get("rate", tg_) + POL_PASS_ADJ * (tg_ - m.get("rate", tg_))) if POL_PASS_LOAN else tg_
    cx_list_ = [f for f in player_firms if not firms[f].get("dead") and firms[f]["workers"]]
    if SECTOR_BOARD:                                        # K-212: lonca kredi önceliği kıt halkadaki üyeye (aynı cx_ok risk kuralları içinde; kararlı sıralama)
        cx_ord_ = sorted(cx_list_, key=lambda f_: -sb_firm_scarcity(W, f_))
        if cx_ord_ != cx_list_:
            board_stat_add(W, "kredi_oncelik_degisen_hafta")
        cx_list_ = cx_ord_
    if KR_MEAS and GROW_SELECT:
        gs_izle(W, w)                                       # REKABET G15: davranışsız ölçüm (26 hf sonraki işçi sayısı)
    for fname in cx_list_:
        d = firms[fname]
        gp_ = GROW_PURPOSE and not (W.human is not None and d["owner"] == W.human)       # REKABET G17d: bot firma planına bağlı başvurur; insan bugünkü yoldan (yasak yok)
        if gp_:
            hedef_ = d["sp_hedef"] if d.get("sp_hedef_w") == w else len(d["workers"])     # bu haftanın damgasını almayan bot (işe alım döngüsünde atlanan, kapanan) planı yok sayılır: hedef = kadro
            gpt_ = gp_tutar(W, fname, hedef_)
            if KR_MEAS:
                d["gp_ard"] = d.get("gp_ard", 0) + 1 if hedef_ > len(d["workers"]) else 0       # davranışsız: hedef > kadro iken alımın gerçekleşmediği ardışık hafta (hafta sonu kadrosuna göre)
            if len(d["workers"]) < d["capacity"] and gpt_ <= 1e-9:
                continue                                       # planı olmayan (hedef <= kadro ya da plan kasayla karşılanıyor) bot başvurmaz; ret sayılmaz
        if not cx_ok(W, fname, w, "buyume"):
            if KR_MEAS and ((gpt_ > 1e-9 if gp_ else GROW_FACTOR * working_capital(W, firms, people, fname, 1) - L.bal[fname] > 0) and len(d["workers"]) < d["capacity"] or len(d["workers"]) >= d["capacity"] and not CAPEX_ON and d["capacity"] < cap_ceiling(d)):
                cx_say(W, fname, w, W._cx_kod)                 # REKABET G4: eleme reddi yalnız GERÇEK TALEPte sayılır (davranışsız); G17d: bot için gerçek talep = plan tutarı > 0
            continue
        wc1 = working_capital(W, firms, people, fname, 1)
        gap = gpt_ if gp_ else GROW_FACTOR * wc1 - L.bal[fname]
        if gap > 0 and len(d["workers"]) < d["capacity"]:
            amt_g = gap * (rb_credit_factor(W, RB_LOAN_SEMI_FIRM, RB_C_MAX_FIRM) if (RATE_BEHAV and RB_CREDIT) else 1.0)
            if KR_MEAS and amt_g <= 1e-9:
                cx_say(W, fname, w, "buyume_faiz_kapisi")      # REKABET G4: RATE_BEHAV faiz çarpanı talebi sıfırladı (davranışsız sayım)
            cx_lend(W, fname, amt_g, "buyume", w, CX_GROW_K)
        elif not CAPEX_ON and len(d["workers"]) >= d["capacity"] and d["capacity"] < cap_ceiling(d):
            wage_w = (sum(people[q]["wage"] for q in d["workers"]) / max(1, len(d["workers"]))) * CYCLES_PER_WEEK
            cost = CX_CAP_STEP * CX_CAP_WEEKS * wage_w
            kapi_ = not (RATE_BEHAV and RB_CREDIT) or rb_credit_gate(W, fname, "yatirim")      # kapı (durumlu: hak birikimi) karar başına tam bir kez
            if KR_MEAS and not kapi_:
                cx_say(W, fname, w, "yatirim_faiz_kapisi")      # REKABET G4: RATE_BEHAV faiz kapısı kapalı (davranışsız sayım)
            got = cx_lend(W, fname, cost, "yatirim", w, CX_INV_K) if kapi_ else 0.0
            if got > 0:
                L.pay(fname, cities[d["city"]]["acct"], got, "kapasite_yatirimi")
                d["capacity"] += CX_CAP_STEP
                cx_stat["kapasite_artis"] += CX_CAP_STEP
    for n in live_daos(W):
        d = firms[n]
        if not d["workers"] or len(d["workers"]) >= d["capacity"]:
            continue
        if not cx_ok(W, n, w):
            if KR_MEAS and DAO_HIRE_RUNWAY * dao_weekly_cost(W, n, res_wage(W, d["city"])) - L.bal[n] > 0:
                cx_say(W, n, w, W._cx_kod)                     # REKABET G4: yalnız GERÇEK TALEPte (davranışsız)
            continue
        wnew = res_wage(W, d["city"])
        need = DAO_HIRE_RUNWAY * dao_weekly_cost(W, n, wnew) - L.bal[n]
        if need > 0:
            if not free_innovators(W, d["city"]):
                if KR_MEAS:
                    cx_say(W, n, w, "arge_inovator_yok")        # REKABET G4: talep var ama kapı geçilmiyor: kendi sebebiyle sayılır (davranışsız)
            elif not (RATE_BEHAV and RB_CREDIT) or rb_credit_gate(W, n, "arge"):      # kapı (durumlu) yalnız inovatör varken ve bir kez sorulur (eski sıra)
                cx_lend(W, n, need, "arge", w, CX_INV_K)
            elif KR_MEAS:
                cx_say(W, n, w, "arge_faiz_kapisi")


def mortgage_step(W, w):
    """K-181: ipotek servisi (faiz + eşit taksit); 6 hafta ödenmezse haciz: konut havuza devredilir, ikinci el piyasada satışa çıkar."""
    L = W.L
    cx_stat = W.cx_stat
    dep_tot = W.dep_tot
    deposits = W.deposits
    int_in = W.int_in
    mortgages = W.mortgages
    own = W.own
    if not CX_ACT:
        return
    for m in list(mortgages):
        q, pool_ = m["q"], f"{m['lo']}_sermaye"
        it = m["rate"] * m["out"]
        pr = min(m["out"], m["p0"] / CX_MORT_TERM)
        if L.bal[q] < it + pr and q in deposits and deposits[q][1] > 0:
            lo_d = deposits[q][0]
            got_ = L.pay(f"{lo_d}_sermaye", q, min(deposits[q][1], it + pr - L.bal[q], L.bal[f"{lo_d}_sermaye"]), "mevduat_cekim")
            deposits[q][1] -= got_
            dep_tot[lo_d] -= got_
        pi = L.pay(q, pool_, min(L.bal[q], it), "ipotek_faizi")
        int_in[m["lo"]] += pi
        pp = L.pay(q, pool_, min(L.bal[q], pr), "ipotek_geri")
        m["out"] -= pp
        m["miss"] = 0 if (pi >= it - 1e-9 and pp >= pr - 1e-9) else m["miss"] + 1
        if m["out"] <= 1e-6:
            mortgages.remove(m)
            cx_stat["ipotek_kapandi"] += 1
        elif m["miss"] >= CX_MORT_DEF:
            ci = m["ci"]
            if own[ci].get(q, 0.0) >= 1.0 - 1e-9:
                own[ci][q] -= 1.0
                if own[ci][q] < 1e-9:
                    del own[ci][q]
                own[ci][pool_] += 1.0
            elif HOME_OWN and W.home.get(q) == ci:                      # REKABET G12: kiralık birimi olmayan ipotekli ev sahibinin evi de teminattır (mevcut haciz kuralı)
                del W.home[q]
                W.home_n[ci] -= 1
                own[ci][pool_] += 1.0
            mortgages.remove(m)
            L.flows["haciz_adet"] += 1
            cx_stat["haciz_kayip_borc"] += m["out"]
            cx_stat["temerrut_konut"] += 1
