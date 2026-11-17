"""simkit.insurance: lonca sigortası (ins_*).

ARAYÜZ: ins_alive, ins_solv, ins_qhat, ins_disc, ins_rate, ins_premium, ins_claim, ins_assign, ins_step, ins_fail
OKUR/YAZAR: W.ins, W.ins_stat, W.wf_* ve L.pay ile ödemeler.
KATMAN: L2 (credit_core'a bağımlı: keep_amt).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import keep_amt, lo_classes, dep_pick


def ins_alive(W):
    ins = W.ins
    return [i for i, I in ins.items() if I["alive"]]


def ins_solv(W, i):
    L = W.L
    ins = W.ins
    I = ins[i]
    return L.bal[f"{i}_rezerv"] / I["req"] if I["req"] > 1e-9 else 9.9


def ins_qhat(W, i):
    ins = W.ins
    I = ins[i]
    return min(INS_QMAX, max(INS_Q0 * 0.25, I["claims_ema"] / I["expo"])) if (I["expo"] > 1e-9 and I["age"] >= 8) else INS_Q0


def ins_disc(W, i):
    REP = W.REP
    ins = W.ins
    I = ins[i]
    return INS_DISC_MAX * min(1.0, max(0.0, REP[I["founder"]] / 100.0)) * (1.0 if I["alive"] else 0.0)


def ins_rate(W, i):
    sv = ins_solv(W, i)
    return (1.0 + INS_LOAD) * ins_qhat(W, i) * (1.0 - ins_disc(W, i)) * (1.0 + 0.5 * max(0.0, 1.0 - sv))     # rezerv şartı altındaki sigortacı primi artırır


def ins_premium(W, lo):
    HEALTH_ON = W.HEALTH_ON
    L = W.L
    ins = W.ins
    ins_stat = W.ins_stat
    wf_cov = W.wf_cov
    wf_g = W.wf_g
    wf_ins = W.wf_ins
    wf_payroll = W.wf_payroll
    wf_prem_due = W.wf_prem_due
    wf_prem_paid = W.wf_prem_paid
    i = wf_ins[lo]
    I = ins[i]
    due_u = ins_rate(W, i) * wf_g[lo] * wf_payroll[lo] / CYCLES_PER_WEEK
    hpart = ((1.0 + INS_LOAD) * I.get("h_mult", 1.0) * HEALTH_PREM * wf_cov[lo] * (1.0 - ins_disc(W, i)) / CYCLES_PER_WEEK) if HEALTH_ON else 0.0
    due = due_u + hpart
    pay_ = L.pay(lo, f"{i}_rezerv", min(due, WELF_SHARE_MAX * max(0.0, L.bal[lo])), "sigorta_primi")
    wf_prem_due[lo] += due
    wf_prem_paid[lo] += pay_
    I["hp_w"] = I.get("hp_w", 0.0) + (pay_ * hpart / due if due > 1e-12 else 0.0)
    I["prem_w"] += pay_
    ins_stat["prim"] += pay_
    re_ = I.get("re")
    if re_ and ins[re_]["alive"] and pay_ > 0:
        ced = INS_REINS_SHARE * pay_
        L.pay(f"{i}_rezerv", f"{re_}_rezerv", ced, "reasurans_primi")
        ins_stat["reasurans_prim"] += ced


def ins_claim(W, lo, q, amt):
    L = W.L
    ins = W.ins
    ins_stat = W.ins_stat
    wf_ins = W.wf_ins
    wf_stat = W.wf_stat
    i = wf_ins[lo]
    I = ins[i]
    acct = f"{i}_rezerv"
    pr_ = min(1.0, max(INS_MIN_PAYOUT, ins_solv(W, i)))                      # rezerv şartı karşılanmıyorsa ödemeler orantılı kısılır (kriz anında kısmen kesinti)
    paid = L.pay(acct, q, min(amt * pr_, L.bal[acct]), "sigorta_odemesi")
    I["claims_w"] += paid
    I["unmet_w"] += amt - paid
    ins_stat["hasar"] += paid
    ins_stat["odenmeyen"] += amt - paid
    re_ = I.get("re")
    if re_ and ins[re_]["alive"] and paid > 0:
        rec = L.pay(f"{re_}_rezerv", acct, min(INS_REINS_SHARE * paid, L.bal[f"{re_}_rezerv"]), "reasurans")
        ins_stat["reasurans_hasar"] += rec
    wf_stat["sigorta_issiz_akce"] += paid
    return paid


def ins_assign(W, lo, w):
    ins_stat = W.ins_stat
    wf_ins = W.wf_ins
    al = ins_alive(W)
    if not al:
        wf_ins.pop(lo, None)
        return
    cur = wf_ins.get(lo)
    best = min(al, key=lambda i: (ins_rate(W, i) + (0.0 if ins_solv(W, i) >= 0.8 else 1.0), i))
    if cur is None or cur not in al or ins_rate(W, best) < 0.95 * ins_rate(W, cur) or (ins_solv(W, cur) < 0.5 and ins_solv(W, best) > 0.8):
        if cur != best:
            ins_stat["gecis"] += 1
        wf_ins[lo] = best


def ins_step(W, w, alive_l, pay_):
    """K-185.11: sigortacıların haftalık işleyişi: risk oranı, rezerv şartı, reasürans seçimi, yatırım, kâr payı, kuruluş ve batış."""
    L = W.L
    REP = W.REP
    closed = W.closed
    dep_ema = W.dep_ema
    dep_tot = W.dep_tot
    deposits = W.deposits
    ins = W.ins
    ins_hist = W.ins_hist
    ins_stat = W.ins_stat
    loncas = W.loncas
    people = W.people
    weeks = W.weeks
    wf_g = W.wf_g
    wf_ins = W.wf_ins
    wf_payroll = W.wf_payroll
    al = ins_alive(W)
    for lo in alive_l:                                          # poliçe ataması
        if wf_g[lo] > 1e-9 and w >= WELF_START:
            ins_assign(W, lo, w)
        elif wf_g[lo] <= 1e-9:
            wf_ins.pop(lo, None)
    for i in al:
        I = ins[i]
        I["age"] += 1
        los = [l_ for l_, i_ in wf_ins.items() if i_ == i and l_ not in closed]
        I["expo"] = sum(wf_g[l_] * wf_payroll[l_] for l_ in los)
        I["n_lonca"] = len(los)
        I["hc_ema"] = 0.9 * I.get("hc_ema", 0.0) + 0.1 * I.get("hc_w", 0.0)
        I["hp_ema"] = 0.9 * I.get("hp_ema", 0.0) + 0.1 * I.get("hp_w", 0.0)
        I["hc_w"] = I["hp_w"] = 0.0
        I["h_mult"] = min(2.5, max(0.6, I["hc_ema"] / I["hp_ema"] * 0.9)) if (I["hp_ema"] > 1e-6 and I["age"] >= 8) else 1.0
        I["claims_ema"] = 0.9 * I["claims_ema"] + 0.1 * I["claims_w"]
        I["claims_w"], I["prem_w_last"], I["prem_w"] = 0.0, I["prem_w"], 0.0
        I["unmet_w"] = 0.0
        I["req"] = INS_RES_WEEKS * (ins_qhat(W, i) * I["expo"] + I.get("hc_ema", 0.0)) * (1.0 - INS_REINS_SHARE * (1 if I.get("re") else 0))
        rez = L.bal[f"{i}_rezerv"]
        sv = rez / I["req"] if I["req"] > 1e-9 else 9.9
        I["low"] = I["low"] + 1 if (sv < INS_FAIL_SOLV and I["expo"] > 1e-9) else 0
        others = [j for j in al if j != i]
        I["re"] = max(others, key=lambda j: (ins_solv(W, j), j)) if others else None
    cls_ = lo_classes(W) if (DEP_ROUTE and DV_ACT) else None     # PLAN-KREDI T5 (U9): rezerv yatırımı da kredi verebilen loncaya; kayıt ödemenin yapıldığı loncaya yazılır
    for i in al:                                                # yatırım, kâr payı, batış
        I = ins[i]
        acct = f"{i}_rezerv"
        rez = L.bal[acct]
        keep = INS_KEEP_MULT * I["req"]
        dep_amt = deposits[acct][1] if acct in deposits else 0.0
        if rez > keep and I["req"] > 1e-9:
            inv = INS_INVEST * (rez - keep)
            best_lo = max((l_ for l_ in loncas if l_ not in closed), key=lambda l_: (dep_ema[l_], -int(l_[5:])), default=None)
            if cls_ is not None:
                ent_ = deposits.get(acct)
                best_lo = dep_pick(W, cls_) if (ent_ is None or ent_[1] <= 1e-9) else (None if ent_[0] in cls_[1] else ent_[0])
            if inv > 5 and best_lo:
                got = L.pay(acct, f"{best_lo}_sermaye", inv, "mevduat")
                ent = deposits.setdefault(acct, [best_lo, 0.0])
                if cls_ is not None and ent[0] != best_lo:             # boş hesap yeni loncada açılır
                    dep_tot[ent[0]] -= ent[1]
                    dep_tot[best_lo] += ent[1]
                    ent[0] = best_lo
                ent[1] += got
                dep_tot[ent[0]] += got
                ins_stat["mevduata_yatirilan"] += got
        elif rez < keep and dep_amt > 1e-9:
            lo_d = deposits[acct][0]
            amt = min(dep_amt, keep - rez, L.bal[f"{lo_d}_sermaye"])
            got = L.pay(f"{lo_d}_sermaye", acct, amt, "mevduat_cekim")
            deposits[acct][1] -= got
            dep_tot[lo_d] -= got
        rez = L.bal[acct]
        if rez > INS_DIV_MULT * I["req"] and I["req"] > 1e-9 and I["age"] > 26:
            dv = INS_DIV_SHARE * (rez - INS_DIV_MULT * I["req"])
            L.pay(acct, I["founder"], dv, "sigorta_kar_payi")
            ins_stat["kar_payi"] += dv
        if I["low"] >= INS_FAIL_WEEKS:
            ins_fail(W, i, w)
    if w >= WELF_START and w % INS_FOUND_EVERY == 0 and len(ins_alive(W)) < INS_MAX:   # kuruluş
        want_lo = [l_ for l_ in alive_l if wf_g[l_] > 1e-9]
        taken = {I["founder"] for I in ins.values() if I["alive"]}
        cands = sorted(((L.bal[q] - keep_amt(W, q), q) for q, i_ in people.items() if i_["who"] == "oyuncu" and q not in taken and REP[q] >= 0 and not (HUMAN_ON and q == W.human)), key=lambda t: (-t[0], t[1]))      # DAO oyunu: insan kendiliğinden sigorta DAO'su kurmaz
        if want_lo and cands and cands[0][0] >= INS_CAPITAL:
            q = cands[0][1]
            iid = f"sig{len(ins)}"
            ins[iid] = dict(founder=q, born=w, alive=True, city=people[q]["city"], claims_ema=0.0, claims_w=0.0, unmet_w=0.0, prem_w=0.0, prem_w_last=0.0, expo=0.0, req=0.0, low=0, age=0, re=None, n_lonca=0, died=None)
            L.pay(q, f"{iid}_rezerv", INS_CAPITAL, "sigorta_sermayesi")
            ins_stat["kurulan"] += 1
            L.flows["sigorta_dao_kurulus_adet"] += 1
    if w % 10 == 0 or w == weeks:
        al2 = ins_alive(W)
        ins_hist.append((w, len(al2), len(ins), sum(1 for l_ in alive_l if wf_ins.get(l_)), sum(L.bal[f"{i}_rezerv"] for i in al2), sum(ins[i]["req"] for i in al2),
                         ins_stat["prim"], ins_stat["hasar"], ins_stat["odenmeyen"], ins_stat["reasurans_prim"], ins_stat["reasurans_hasar"], ins_stat["kar_payi"], ins_stat["mevduata_yatirilan"]))


def ins_fail(W, i, w):
    """K-185.11: batış: rezerv şartı 8 hafta üst üste karşılanamadı: poliçeler başka sigortacıya devredilir (rezerv poliçe sayısıyla orantılı gider), ödemeler kısmen kesilmiş olur, kayıp raporlanır."""
    L = W.L
    dep_tot = W.dep_tot
    deposits = W.deposits
    ins = W.ins
    ins_stat = W.ins_stat
    wf_ins = W.wf_ins
    I = ins[i]
    I["alive"], I["died"] = False, w
    acct = f"{i}_rezerv"
    ins_stat["batan"] += 1
    L.flows["sigorta_batis_adet"] += 1
    succ = [j for j in ins_alive(W)]
    los = [l_ for l_, i_ in wf_ins.items() if i_ == i]
    if acct in deposits and deposits[acct][1] > 1e-9:
        lo_d, am_ = deposits[acct]
        got = L.pay(f"{lo_d}_sermaye", acct, min(am_, L.bal[f"{lo_d}_sermaye"]), "mevduat_cekim")
        deposits[acct][1] -= got
        dep_tot[lo_d] -= got
    rez = L.bal[acct]
    if succ:
        for l_ in los:
            wf_ins[l_] = min(succ, key=lambda j: (ins_rate(W, j), j))
        share = {j: sum(1 for l_ in los if wf_ins[l_] == j) for j in succ}
        ts = sum(share.values()) or len(succ)
        for j in succ:
            part = rez * (share[j] / ts if sum(share.values()) else 1.0 / len(succ))
            L.pay(acct, f"{j}_rezerv", part, "sigorta_devir")
        ins_stat["devredilen_polise"] += len(los)
    else:
        for l_ in los:
            wf_ins.pop(l_, None)
        if rez > 0:
            L.pay(acct, I["founder"], rez, "sigorta_tasfiye")
    ins_stat["kayip_kurucu_sermaye"] += INS_CAPITAL
