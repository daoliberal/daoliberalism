"""simkit.credit_core: kredi çekirdeği: verilebilir nakit, kredi/özsermaye, risk, faiz, ücret kesintisi, firma kredisi (cx_*, young_lend, renew_lend).

K-218: CREDIT_MONEY açıkken lendable/cx_lend/renew_lend W.cm (simkit.credit_money) köprüsünü kullanır; kapalıyken W.cm yok, yol değişmez.
ARAYÜZ: lendable_cash, lo_credit, lo_equity, lendable, lo_classes, dep_pick (PLAN-KREDI T5: DEP_ROUTE lonca sınıfları ve mevduat hedefi), take_fee, cx_costs, capex_eligible, young_lend, renew_lend, sp_week, keep_amt, cx_base, LR_NEW, lo_risk, rate_ref, cx_rm, cx_ok, cx_lend,
  K-215 kuruluş fonu: fund_pool, fund_bal, fund_debt, opex_week, fund_limit, fund_lend (fon kredisi loans[f] kaydında lo = "KFON<i>"; diğer kredi yolları fon kaydına eklenmez)
OKUR: W durumu (L, loans, bonds, dep_tot, firms, ...). YAZAR: yalnız L.pay ve kredi kayıtları (loans).
KATMAN: L1 (econ_core'a bağımlı).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.econ_core import fee_rate, working_capital
from simkit.young_core import fund_lo, is_fund_lo, yk_add


def lendable_cash(W, lo):
    BOND_ON = W.BOND_ON
    L = W.L
    bonds = W.bonds
    dep_tot = W.dep_tot
    res_ = (CM_RESERVE if CREDIT_MONEY else DEP_RESERVE) * dep_tot[lo] if CREDIT_ON else 0.0
    if BOND_ON and RES_BONDS and res_ > 0:                           # K-185.4: devlet tahvili likit varlıktır: rezerv şartı nakit + tahvil ile karşılanır
        res_ = max(0.0, res_ - sum(b_["out"] for b_ in bonds if b_["lo"] == lo))
    return max(0.0, L.bal[f"{lo}_sermaye"] - res_)


def lo_credit(W, lo):
    loans = W.loans
    mortgages = W.mortgages
    return sum(ln_["out"] for ln_ in loans.values() if ln_["lo"] == lo) + sum(m_["out"] for m_ in mortgages if m_["lo"] == lo)


def lo_equity(W, lo):
    L = W.L
    bonds = W.bonds
    dep_tot = W.dep_tot
    return L.bal[f"{lo}_sermaye"] + lo_credit(W, lo) + sum(b_["out"] for b_ in bonds if b_["lo"] == lo) - dep_tot[lo]


def lendable(W, lo):
    LEV_ON = W.LEV_ON
    base = lendable_cash(W, lo)
    if CREDIT_MONEY and W.cm is not None:                             # K-218: kredi para yaratır: sınır nakit değil, kaldıraç x etkin özsermaye (fren varken eski kural)
        return W.cm.lendable(lo, base)
    if LEV_ON and base > 0:
        cr = lo_credit(W, lo)
        base = min(base, max(0.0, LEV_K * max(0.0, lo_equity(W, lo)) - cr))
    return base


def lo_classes(W):
    """PLAN-KREDI T5 (U5, U6): açık loncaların sınıfı -> (verebilen, batık, ara, h, c). Saf okuma; kapalı lonca hiçbir sınıfta değildir.
    verebilen: öz kaynak > 0 ve (LONCA_LEVERAGE açıkken) kaldıraç payı h = LEV_K x öz kaynak - kredi > 0. batık: öz kaynak < 0. ara: geri kalan.
    c = h - (1 - DEP_RESERVE) x mevduat: loncanın boş mevduat kapasitesi (LONCA_LEVERAGE kapalıyken h = c = sonsuz). h, c: lonca -> değer (kapalı lonca yok)."""
    dep_tot = W.dep_tot
    ver, bat, ara = [], [], []
    h, c = {}, {}
    for lo in W.loncas:
        if lo in W.closed:
            continue
        eq = lo_equity(W, lo)
        hh = (LEV_K * eq - lo_credit(W, lo)) if W.LEV_ON else float("inf")
        h[lo] = hh
        c[lo] = hh - (1.0 - DEP_RESERVE) * dep_tot[lo]
        if eq < 0:
            bat.append(lo)
        elif eq > 0 and hh > 0:
            ver.append(lo)
        else:
            ara.append(lo)
    return ver, bat, ara, h, c


def dep_pick(W, cls):
    """PLAN-KREDI T5 (U6): yeni mevduatın ya da taşınan hesabın hedef loncası (su doldurma); sınıflar `lo_classes`tan, kapasite her çağrıda GÜNCEL mevduatla.
    Verebilenler arasında boş kapasitesi (c) en büyük; c > 0 olan yoksa en büyük h'li; verebilen yoksa ara loncalar aynı kuralla; o da yoksa None (para elde kalır).
    Eşitlikte en yüksek dep_ema, sonra küçük lonca numarası. LONCA_LEVERAGE kapalıyken (h sonsuz) en az mevduatlı lonca."""
    dep_tot, dep_ema = W.dep_tot, W.dep_ema
    ver, _bat, ara, h, _c = cls
    for grp in (ver, ara):
        if not grp:
            continue
        cap = {lo: h[lo] - (1.0 - DEP_RESERVE) * dep_tot[lo] for lo in grp}
        free = [lo for lo in grp if cap[lo] > 0]
        if free:
            if W.LEV_ON:
                return max(free, key=lambda lo: (cap[lo], dep_ema[lo], -int(lo[5:])))
            return min(free, key=lambda lo: (dep_tot[lo], -dep_ema[lo], int(lo[5:])))
        return max(grp, key=lambda lo: (h[lo], dep_ema[lo], -int(lo[5:])))
    return None


def take_fee(W, payer, lonca, base):
    L = W.L
    fee_inc = W.fee_inc
    amt = L.pay(payer, lonca, base * fee_rate(W, lonca), "lonca_fee")
    fee_inc[lonca] += amt
    return amt


def cx_costs(W):
    REF = W.REF
    return MACH_AL * REF["aluminyum"] + MACH_BI * REF["bilesen"], BLD_INS * REF["insaat"]


def capex_eligible(W, d):
    return not d.get("dead") and d["workers"] and d["kind"] not in ("ahir", "belediye", "arge")


def fund_pool(ci):
    return f"{fund_lo(ci)}_sermaye"


def fund_bal(W, ci):
    return W.L.bal[fund_pool(ci)]


def fund_debt(W, f):
    """firmanın kuruluş fonuna kalan borcu (fon kaydı yoksa 0)."""
    ln = W.loans.get(f)
    return ln["out"] if (ln and is_fund_lo(ln["lo"])) else 0.0


def opex_week(W, f, extra=0):
    """haftalık işletme gideri tahmini = işletme sermayesi (WORKING_CAPITAL_CYCLES döngülük ücret + kira + girdi) / döngü x haftalık döngü; extra = ek çalışan."""
    return working_capital(W, W.firms, W.people, f, extra) * CYCLES_PER_WEEK / WORKING_CAPITAL_CYCLES


def fund_limit(W, f):
    """K-216 (1): dayanma limiti = YK_RUNWAY_WEEKS x haftalık işletme gideri (kadro ve hedef kadrodan büyük olanla)."""
    d = W.firms[f]
    n = len(d["workers"])
    st = d.get("yk")
    tgt = max(n, int(st["tgt"] + 0.9999)) if st else n
    return YK_RUNWAY_WEEKS * opex_week(W, f, tgt - n)


def fund_lend(W, f, amt, w, tur="kurulus"):
    """K-215: şehrin kuruluş fonundan firmaya kredi (kind kurulus_fonu_kredi). Firmanın başka alacaklıdan kaydı varsa ya da gecikmişse verilmez. Verilen tutarı döndürür."""
    L = W.L
    loans = W.loans
    d = W.firms[f]
    ci = d["city"]
    ln = loans.get(f)
    if (ln and not is_fund_lo(ln["lo"])) or (ln and ln["miss"] > 0):
        yk_add(W, "fon_red_kayit")
        return 0.0
    amt = min(amt, L.bal[fund_pool(ci)])
    if amt < 1.0:
        return 0.0
    L.pay(fund_pool(ci), f, amt, "kurulus_fonu_kredi")
    if ln:
        ln["p0"] += amt
        ln["out"] += amt
    else:
        loans[f] = dict(lo=fund_lo(ci), p0=amt, out=amt, miss=0, rate=max(CX_RATE_MIN, cx_base(W) * cx_rm(W, f)), tur=tur)
        L.flows["kredi_adet"] += 1
    L.flows["kredi_fon_adet"] += 1
    yk_add(W, "fon_verilen", amt)
    W.yk["wk"]["given"] += amt
    return amt


def young_lend(W, f, amt, w, mc, bc):
    """K-185.12: genç firma kredisi: yaş/kâr şartı yok; limit = k × (işletme sermayesi + başlangıç yuvası maliyeti) × itibar çarpanı; havuzun en çok YOUNG_POOL_SHARE'i."""
    L = W.L
    REP = W.REP
    closed = W.closed
    firms = W.firms
    loans = W.loans
    people = W.people
    young_stat = W.young_stat
    d = firms[f]
    lo = d["lonca"]
    if lo in closed or amt < 1e-9:
        return 0.0
    n = max(1, len(d["workers"]))
    rep = REP[d["owner"]] if (INNOV_ON and d["owner"] in people) else CM_REP
    lim = YOUNG_LIM_MULT * (working_capital(W, firms, people, f, 1) + (mc + bc) * max(2.0, n)) * (1.0 if ENTRY_OPEN else min(1.0, CM_BASE + (1 - CM_BASE) * rep / CM_REP))      # K-213: ENTRY_OPEN'da limit itibara bağlı değil (itibar yalnız faizi etkiler)
    ln = loans.get(f)
    out_ = ln["out"] if ln else 0.0
    if YOUNG_KIT and FOUND_FUND and (not ln or is_fund_lo(ln["lo"])):      # K-216: genç firma yatırım (yuva) kredisi de kuruluş fonundan (dayanma limitinin üstüne yuva limiti)
        amt = min(amt, lim + fund_limit(W, f) - out_)
        got = fund_lend(W, f, amt, w, tur="genc") if amt >= 1.0 else 0.0
        if got <= 0:
            young_stat["red"] += 1
            return 0.0
        d["young_credit"] = True
        young_stat["adet"] += 1
        young_stat["hacim"] += got
        L.flows["kredi_genc_adet"] += 1
        return got
    if ln and is_fund_lo(ln["lo"]):
        young_stat["red"] += 1
        return 0.0
    amt = min(amt, lim - out_, YOUNG_POOL_SHARE * lendable(W, lo))
    if amt < 1.0 or (ln and ln["miss"] > 0):
        young_stat["red"] += 1
        return 0.0
    L.pay(f"{lo}_sermaye", f, amt, "kredi_verilen")
    rate = max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, lo)) * cx_rm(W, f))
    if ln:
        ln["p0"] += amt
        ln["out"] += amt
    else:
        loans[f] = dict(lo=lo, p0=amt, out=amt, miss=0, rate=rate, tur="genc")
    d["young_credit"] = True
    young_stat["adet"] += 1
    young_stat["hacim"] += amt
    L.flows["kredi_genc_adet"] += 1
    return amt


def renew_lend(W, f, amt, w, mc, bc):
    """K-185.12: yenileme/yatırım kredisi (NPC dahil): yaş ve kâr şartı yok; teminat makine/bina (tasfiyede alacaklı önce)."""
    L = W.L
    capex_stat = W.capex_stat
    closed = W.closed
    firms = W.firms
    loans = W.loans
    people = W.people
    d = firms[f]
    lo = d["lonca"]
    if lo in closed or amt < 1e-9:
        return 0.0
    coll = d.get("mach", 0.0) * mc * (1 - LIQ_DISC_M) + d.get("bld", 0.0) * bc * (1 - LIQ_DISC_B)
    ln = loans.get(f)
    if ln and is_fund_lo(ln["lo"]):
        return 0.0                                                   # K-215: fon kaydına lonca kredisi eklenmez
    out_ = ln["out"] if ln else 0.0
    lim = LOAN_LEV * working_capital(W, firms, people, f) + 0.8 * coll
    amt = min(amt, lim - out_, lendable(W, lo))
    if amt < 1.0 or (ln and ln["miss"] > 0):
        return 0.0
    rate = max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, lo)) * cx_rm(W, f))
    if CREDIT_MONEY and W.cm is not None and not W.cm.pd_ok(f, amt, rate, coll):     # K-218: Caiani rasyonlaması (teminatlı: kayıp oranı teminatla düşer)
        return 0.0
    L.pay(f"{lo}_sermaye", f, amt, "kredi_verilen")
    if ln:
        ln["p0"] += amt
        ln["out"] += amt
    else:
        loans[f] = dict(lo=lo, p0=amt, out=amt, miss=0, rate=rate, tur="yenileme")
    capex_stat["yenileme_kredisi"] += amt
    L.flows["kredi_yenileme_adet"] += 1
    return amt


def sp_week(W, q):
    hab = W.hab
    people = W.people
    i_ = people[q]
    return max(i_["wage"] * CYCLES_PER_WEEK, hab.get(q, 0.0) * CYCLES_PER_WEEK)


def keep_amt(W, q):
    return (DEP_KEEP_NEW if DV_ACT else DEP_KEEP) * sp_week(W, q)


def cx_base(W):
    POL_ON = W.POL_ON
    dep_slow = W.dep_slow
    pol = W.pol
    if POL_ON and pol[0] is not None:
        return min(LOAN_RATE, max(CX_RATE_MIN, pol[0] + CX_MARGIN))
    return min(LOAN_RATE, max(CX_RATE_MIN, max(0.0, dep_slow[0]) + CX_MARGIN))


def LR_NEW(W):
    """K-185.18: yeni kuruluş/NPC köprü kredisi faizi politika faizine bağlı (eski: sabit LOAN_RATE)."""
    POL_ON = W.POL_ON
    return cx_base(W) if POL_ON else LOAN_RATE


def lo_risk(W, lo):
    """K-185.5: lonca kendi risk marjını koyar (kredi kaybı yüksekse faiz üstü)."""
    POL_ON = W.POL_ON
    lo_loss = W.lo_loss
    loans = W.loans
    if not POL_ON:
        return 0.0
    out_ = sum(ln_["out"] for ln_ in loans.values() if ln_["lo"] == lo)
    return min(RISK_MAX, RISK_K * lo_loss[lo] / max(2000.0, out_))


def rate_ref(W):
    POL_ON = W.POL_ON
    dep_slow = W.dep_slow
    pol = W.pol
    return pol[0] if (POL_ON and pol[0] is not None) else max(0.0, dep_slow[0])


def cx_rm(W, f):
    REP = W.REP
    firms = W.firms
    orep = W.orep
    people = W.people
    d = firms[f]
    rm = 1.0
    o = d.get("owner")
    if REP_EFFECT and o in people:
        rm = min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[o] / 100))
    if ORG_ACT:
        rm *= 1.2 - 0.4 * orep.get(f, 50.0) / 100.0
    return rm


def cx_ok(W, f, w):
    """K-181: teminat yok; itibar ve kâr geçmişi şart: yaş, kâr, kurum itibarı, taksit kaçırmamış, satış yapıyor (alıcısız oranı düşük)."""
    cx_ref = W.cx_ref
    firms = W.firms
    loans = W.loans
    orep = W.orep
    prof_ema = W.prof_ema
    d = firms[f]
    ln = loans.get(f)
    pv_ = d.get("priv") if CRED_V2 else None
    young_ = CRED_V2 and (w - d.get("born", w) < YOUNG_WEEKS or pv_ is not None)
    if w - d.get("born", w) < CX_MIN_AGE and not young_:
        cx_ref["yas"] += 1
        return False
    if prof_ema[f] < CX_MIN_PROFIT and not (pv_ is not None and w - pv_["w"] < CRED_PLAN_WEEKS):
        cx_ref["kar"] += 1
        return False
    if ln and ln["miss"] > 0:
        cx_ref["gecikme"] += 1
        return False
    if ORG_ACT and orep.get(f, 50.0) < CX_MIN_OREP:
        cx_ref["itibar"] += 1
        return False
    if d["kind"] != "arge" and d.get("unsold_acc", 0.0) / max(1e-9, d.get("prod_acc", 0.0)) > 0.15:
        cx_ref["satilamayan"] += 1
        return False
    cx_ref["gecti"] += 1
    return True


def cx_lend(W, f, amt, tur, w, cap_k):
    """Kredi ver: toplam borç ≤ cap_k × haftalık sönümlü kâr, havuzda yeterli kaynak."""
    L = W.L
    cx_ref = W.cx_ref
    cx_stat = W.cx_stat
    firms = W.firms
    loans = W.loans
    people = W.people
    prof_ema = W.prof_ema
    d = firms[f]
    ln = loans.get(f)
    if ln and is_fund_lo(ln["lo"]):
        return 0.0                                                   # K-215: fon kaydına lonca kredisi eklenmez
    out_ = ln["out"] if ln else 0.0
    if amt <= 1e-9:
        return 0.0
    pe_ = prof_ema[f]
    if CRED_V2 and d.get("priv") is not None and w - d["priv"]["w"] < CRED_PLAN_WEEKS:
        pe_ = max(pe_, CRED_PLAN_PROF * working_capital(W, firms, people, f))
    if out_ + amt > cap_k * pe_:
        cx_ref["limit_kar_katı"] += 1
        return 0.0
    if amt > lendable(W, d["lonca"]):
        cx_ref["havuz_yetmez"] += 1
        return 0.0
    if CREDIT_MONEY and W.cm is not None and not W.cm.pd_ok(f, amt, max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, d["lonca"])) * cx_rm(W, f))):     # K-218: Caiani rasyonlaması
        cx_ref["pd_ret"] += 1
        return 0.0
    L.pay(f"{d['lonca']}_sermaye", f, amt, "kredi_verilen")
    rate = max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, d["lonca"])) * cx_rm(W, f))
    if ln:
        ln["p0"] += amt
        ln["out"] += amt
    else:
        loans[f] = dict(lo=d["lonca"], p0=amt, out=amt, miss=0, rate=rate, tur=tur)
    L.flows["kredi_" + tur + "_adet"] += 1
    cx_stat["hacim_" + tur] += amt
    return amt
