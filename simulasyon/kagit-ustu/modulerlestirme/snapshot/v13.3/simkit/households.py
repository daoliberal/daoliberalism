"""simkit.households: hanehalkı: yaşam bütçesi, ilaç, sağlık, eğitim, talep (life_demand, person_demand).

ARAYÜZ: mkt_val, hane_paylasim, life_budget, ilac_buy, health_cover, health_step, health_settle, edu_step, life_demand, person_demand
OKUR/YAZAR: W.people, W.L, sağlık/eğitim sayaçları.
KATMAN: L5.
"""
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import take_fee
from simkit.econ_core import isres, land, ramp
from simkit.firms import svc_firms, svc_pay
from simkit.insurance import ins_solv
from simkit.rate_behav import rb_spend_factor


def mkt_val(W, q):
    REF = W.REF
    held = W.held
    sh_price = W.sh_price
    return sum(held[p][q] * sh_price[p] * REF[p] for p in held if q in held[p])


def hane_paylasim(W):
    """D9 (A2): hane içi paylaşım. Çalışan (ücret alan) NPC, ücretinin (stopaj sonrası) eşdeğerlik payını bakmakla yükümlü NPC'lerine geçirir; işsiz çalışan paylaşmaz
    (bağımlılar o hanenin geliri olmadan kalır: tüketemeyen NPC). Hesaplar arası gerçek bakiye hareketidir (kind hane_ici_paylasim): para yaratmaz, kasadan çıkmaz. Hane kapalıyken çağrılmaz."""
    L = W.L
    people = W.people
    for c in W.cities:
        for e in c.get("earners", ()):
            i = people[e]
            if i["firm"] is None:
                continue
            each = max(0.0, min(i["wage"] * (1.0 - WAGE_TAX) * i["hfrac"], L.bal[e] / len(i["deps"])))      # kira sonrası bakiyeyi aşmaz; alttan 0 (D9 M5a: yuvarlama gürültüsüyle negatif pay çıkmaz)
            for q in i["deps"]:
                L.pay(e, q, each, "hane_ici_paylasim")


def life_budget(W, q, info, ci):
    L = W.L
    NOW = W.NOW
    RENT_CY = W.RENT_CY
    WI = W.WI
    WRULE_ON = W.WRULE_ON
    deposits = W.deposits
    hab = W.hab
    inc_ema = W.inc_ema
    y = info["wage"]
    if info["who"] == "oyuncu" and inc_ema.get(q, 0.0) > 0 and NOW[0] > 10:
        y = max(y, inc_ema[q] / CYCLES_PER_WEEK)
    yref = LIFE_YREF * WI[ci]
    if WR_ACT:
        wb_ = L.bal[q] + (deposits[q][1] if q in deposits else 0.0)
        c = MPC0 * y * (max(y, 0.3 * yref) / yref) ** (-MPC_SLOPE) + (WEALTH_DRAW_YEAR / (52 * CYCLES_PER_WEEK)) * max(0.0, wb_ - WS_BUF * info["wage"])
    else:
        c = MPC0 * y * (max(y, 0.3 * yref) / yref) ** (-MPC_SLOPE) + WSPEND * max(0.0, L.bal[q] - WS_BUF * info["wage"])
    if WRULE_ON:
        wb_ = L.bal[q] + (deposits[q][1] if q in deposits else 0.0)
        emp_ = info["firm"] is not None
        mand_ = sum(land(W, ci, p_) * q_ for p_, q_ in BASKET.items()) / CYCLES_PER_WEEK * W.MARKET_MARKUP + (RENT_CY.get(ci, 0.0) if (HOUSE_ON and (emp_ or info["who"] == "oyuncu")) else 0.0)
        sp_ = max(info["wage"] * CYCLES_PER_WEEK, hab.get(q, 0.0) * CYCLES_PER_WEEK)
        T_ = WR_WEEKS * sp_
        lam_ = min(1.0, max(0.0, (wb_ - WR_BLEND[0] * T_) / max(1e-9, (WR_BLEND[1] - WR_BLEND[0]) * T_)))
        y_e = y if emp_ else (inc_ema[q] / CYCLES_PER_WEEK if (info["who"] == "oyuncu" and inc_ema.get(q, 0.0) > 0 and NOW[0] > 10) else 0.0)     # işsizin gelirden harcaması gerçek geliri (ödenek, faiz, temettü); varsayımsal ücret değil
        inc_c = MPC0 * y_e * (max(y_e, 0.3 * yref) / yref) ** (-MPC_SLOPE) if y_e > 0 else 0.0
        c_rich = inc_c + (WEALTH_DRAW_YEAR / (52 * CYCLES_PER_WEEK)) * max(0.0, wb_ - T_)
        c_rich = max(c_rich, mand_)
        c_poor = max(inc_c, mand_) + POOR_SHARE / CYCLES_PER_WEEK * wb_
        c = lam_ * c_rich + (1.0 - lam_) * c_poor
        if RATE_BEHAV:                                                   # faiz davranışı: gerçek mevduat faizi tarafsızın üstündeyse harcama kısılır (katmana göre); zorunlu sepet + kira tabanı korunur
            cls_ = 0 if y / WI[ci] < 0.5 * (TIER_WAGE[0] + TIER_WAGE[1]) else (1 if y / WI[ci] < 0.5 * (TIER_WAGE[1] + TIER_WAGE[2]) else 2)
            if lam_ >= 1.0:
                cls_ = max(cls_, 1)
            wp_ = lam_ * (WEALTH_DRAW_YEAR / (52 * CYCLES_PER_WEEK)) * max(0.0, wb_ - T_) + (1.0 - lam_) * POOR_SHARE / CYCLES_PER_WEEK * wb_
            c = max(c * rb_spend_factor(W, cls_, min(1.0, wp_ / max(c, 1e-9))), min(c, mand_))
    if RATE_BEHAV and not WRULE_ON:
        cls_ = 0 if y / WI[ci] < 0.5 * (TIER_WAGE[0] + TIER_WAGE[1]) else (1 if y / WI[ci] < 0.5 * (TIER_WAGE[1] + TIER_WAGE[2]) else 2)
        c = c * rb_spend_factor(W, cls_, 0.0)
    h = hab.get(q)
    h = c if h is None else h + (HAB_UP if c > h else HAB_DOWN) * (c - h)
    hab[q] = h
    return h


def ilac_buy(W, f, share):
    """hastane / eczane gelirinden ilaç sanayiine toptan alım (ilaç firmaları kadro payıyla; şehir fark etmez)."""
    L = W.L
    cities = W.cities
    firms = W.firms
    health_stat = W.health_stat
    svc_rev_w = W.svc_rev_w
    d = firms[f]
    amt = min(L.bal[f], share * svc_rev_w.get(("__last", f), 0.0))
    if amt <= 1e-9:
        return
    cand = [(cc["i"], g) for cc in cities for g in svc_firms(W, cc["i"], "ilac")]
    tw = sum(len(firms[g]["workers"]) for _, g in cand)
    if tw <= 0:
        return
    for cj, g in cand:
        got = L.pay(f, g, amt * len(firms[g]["workers"]) / tw, "ilac_alimi")
        svc_rev_w[(cj, "ilac")] += got
        take_fee(W, g, firms[g]["lonca"], got)
        health_stat["ilac_akce"] += got


def health_cover(W, q):
    """sigortalı mı: son/şimdiki işyerinin loncasının paketi aktif ve sigortacı canlı."""
    INS_ON = W.INS_ON
    closed = W.closed
    firms = W.firms
    ins = W.ins
    people = W.people
    wf_g = W.wf_g
    wf_ins = W.wf_ins
    wf_prem_ratio = W.wf_prem_ratio
    if not INS_ON:
        return None
    f_ = people[q]["firm"]
    lo = None
    if f_ and firms[f_]["kind"] not in ("ahir", "belediye", "arge"):
        lo = firms[f_]["lonca"]
    elif people[q].get("lf") in firms:
        lo = firms[people[q]["lf"]]["lonca"]
    if lo is None or lo in closed or wf_g[lo] <= 1e-9 or wf_prem_ratio[lo] < 0.5:
        return None
    i = wf_ins.get(lo)
    return i if (i and ins[i]["alive"]) else None


def health_step(W, w):
    """K-185.12: hastalık (deterministik), tedavi ve ödeme; verim kaybı; şehir sağlık düzeyi."""
    HEALTH_ON = W.HEALTH_ON
    L = W.L
    cities = W.cities
    firms = W.firms
    h_lvl = W.h_lvl
    health_hist = W.health_hist
    health_stat = W.health_stat
    ins = W.ins
    ins_stat = W.ins_stat
    people = W.people
    sick_until = W.sick_until
    svc_rev_w = W.svc_rev_w
    treat_n_w = W.treat_n_w
    weeks = W.weeks
    if not HEALTH_ON:
        return
    for k_, v_ in list(svc_rev_w.items()):
        pass
    for c in cities:
        ci = c["i"]
        hs_f = svc_firms(W, ci, "hastane")
        es_f = svc_firms(W, ci, "eczane")
        cap = sum(len(firms[f]["workers"]) for f in hs_f) * TREAT_PER_WORKER
        used = sick_n = untreated = 0
        prev_spend = 0.0
        for q in c["players"]:
            idx = int(q.rsplit("p", 1)[1])
            wk = people[q]["wage"] * CYCLES_PER_WEEK
            if sick_until.get(q, 0) <= w:
                rate = SICK_RATE * (1 - HEALTH_LVL_EFF * h_lvl[ci]) * (1.3 - 0.3 * min(1.0, L.bal[q] / max(1e-9, 20 * wk)))
                if (idx * 0.6180339887 + w * 0.7548776662) % 1.0 < rate:
                    sick_until[q] = w + SICK_DUR_UNTREATED
                    health_stat["hastalanma"] += 1
                else:
                    r_ = L.bal[q] - 25 * wk                         # koruyucu sağlık (gelir ve servetle artar: gelir esnekliği > 1)
                    if r_ > 0 and hs_f:
                        pv = svc_pay(W, q, ci, "hastane", PREVENT_RATE * r_, "koruyucu_saglik")
                        prev_spend += pv
                        health_stat["koruyucu_akce"] += pv
                    continue
            sick_n += 1
            health_stat["hasta_hafta"] += 1
            done = False
            if used < cap and hs_f and es_f:
                r = L.bal[q] / max(1e-9, 10 * wk)
                lv = 2 if r > 4 else (1 if r > 1.5 else 0)
                for lv_t in range(lv, -1, -1):
                    cost = TREAT_COST * (1, 2, 4)[lv_t]
                    ins_i = health_cover(W, q)
                    cover = min(cost, TREAT_COST * 2) * HEALTH_COVER if ins_i else 0.0
                    if L.bal[q] >= cost - cover + 0.2 * wk or (not ins_i and L.bal[q] >= cost + 0.2 * wk):
                        paid_cov = 0.0
                        if cover > 0:
                            for fk, sh in (("hastane", TREAT_SPLIT[0]), ("eczane", TREAT_SPLIT[1])):
                                fl = svc_firms(W, ci, fk)
                                tw = sum(len(firms[f]["workers"]) for f in fl)
                                for f in fl:
                                    part = cover * sh * len(firms[f]["workers"]) / tw
                                    pr_ = min(1.0, max(INS_MIN_PAYOUT, ins_solv(W, ins_i)))
                                    got = L.pay(f"{ins_i}_rezerv", f, min(part * pr_, L.bal[f"{ins_i}_rezerv"]), "sigorta_odemesi")
                                    paid_cov += got
                                    svc_rev_w[(ci, fk)] += got
                                    take_fee(W, f, firms[f]["lonca"], got)
                            ins[ins_i]["hc_w"] = ins[ins_i].get("hc_w", 0.0) + paid_cov
                            ins_stat["saglik_hasar"] += paid_cov
                        pocket = max(0.0, cost - paid_cov)
                        pocket = min(pocket, L.bal[q])
                        svc_pay(W, q, ci, "hastane", pocket * TREAT_SPLIT[0], "saglik_hizmeti")
                        svc_pay(W, q, ci, "eczane", pocket * TREAT_SPLIT[1], "ilac_satisi")
                        used += 1
                        treat_n_w[ci] += 1
                        sick_until[q] = w + 1
                        done = True
                        health_stat["tedavi_n_" + str(lv_t)] += 1
                        health_stat["tedavi_akce"] += cost
                        health_stat["sigortali_tedavi"] += 1 if ins_i else 0
                        break
            if not done:
                untreated += 1
                health_stat["tedavisiz_hafta"] += 1
        if sick_n > 0:
            h_lvl[ci] = 0.95 * h_lvl[ci] + 0.05 * (1.0 - untreated / sick_n)
    for f, d in firms.items():
        if not d["workers"] or d.get("dead"):
            continue
        ns = sum(1 for q in d["workers"] if sick_until.get(q, 0) > w and people[q]["who"] == "oyuncu")
        d["hf"] = 1.0 - SICK_LOSS * ns / len(d["workers"])
        health_stat["kayip_gun"] += ns * CYCLES_PER_WEEK * SICK_LOSS
    if w % 10 == 0 or w == weeks:
        health_hist.append((w, dict(health_stat), [round(h_lvl[c["i"]], 2) for c in cities],
                            sum(len(firms[f]["workers"]) for c in cities for k in ("hastane", "eczane", "ilac") for f in svc_firms(W, c["i"], k)),
                            sum(sick_until.get(q, 0) > w for q in people if people[q]["who"] == "oyuncu")))


def health_settle(W):
    """hafta sonu: hastane ve eczane, haftalık gelirlerinin ilaç payını sanayiye öder; gelir sayaçları devralınır."""
    HEALTH_ON = W.HEALTH_ON
    cities = W.cities
    firms = W.firms
    svc_rev_w = W.svc_rev_w
    if not HEALTH_ON:
        return
    for c in cities:
        ci = c["i"]
        for kind, share in (("hastane", ILAC_SHARE_H), ("eczane", ILAC_SHARE_E)):
            fl = svc_firms(W, ci, kind)
            if fl:
                rev = svc_rev_w[(ci, kind)]
                for f in fl:
                    svc_rev_w[("__last", f)] = rev * len(firms[f]["workers"]) / max(1, sum(len(firms[g]["workers"]) for g in fl))
                    ilac_buy(W, f, share)


def edu_step(W, w):
    """K-185.12: eğitim: öğrenim ücreti, burs, mezuniyet, terfi hızlanması, inovatör üretimi, öğrencinin fırsat maliyeti."""
    EDU_ON = W.EDU_ON
    L = W.L
    WELF_ON = W.WELF_ON
    cities = W.cities
    closed = W.closed
    deposits = W.deposits
    edu_grads = W.edu_grads
    edu_hist = W.edu_hist
    edu_lvl = W.edu_lvl
    edu_stat = W.edu_stat
    firms = W.firms
    people = W.people
    student = W.student
    weeks = W.weeks
    wf_eff = W.wf_eff
    wf_paid_w = W.wf_paid_w
    if not EDU_ON:
        return
    for q, e in list(student.items()):
        ci = people[q]["city"]
        kind = "okul" if e["stage"] == 0 else "universite"
        tui = (TUI_B, TUI_U)[e["stage"]]
        fl = svc_firms(W, ci, kind)
        burs = 0.0
        lo = e.get("lo")
        if lo and lo not in closed and wf_eff[lo] > 1e-9 and WELF_ON:
            burs = min(EDU_BURS * tui, L.bal[f"{lo}_refah"])
        own = tui - burs
        if not fl or L.bal[q] < own:
            del student[q]
            edu_stat["birakan"] += 1
            continue
        if burs > 1e-9:
            got_b = svc_pay(W, f"{lo}_refah", ci, kind, burs, "burs")
            wf_paid_w[lo] += got_b
            edu_stat["burs_akce"] += got_b
        svc_pay(W, q, ci, kind, own, "egitim_ucreti")
        edu_stat["ucret_akce"] += own
        e["left"] -= 1
        if e["left"] <= 0:
            edu_lvl[q] = e["stage"] + 1
            del student[q]
            edu_stat["mezun_" + str(e["stage"])] += 1
            if e["stage"] == 1:
                edu_grads[0] += 1
                if edu_grads[0] % EDU_INNOV_EVERY == 0 and not people[q].get("innov"):
                    people[q]["innov"] = True
                    if PATH_ACT:
                        people[q]["path"] = PATH_CYCLE[(edu_grads[0] // EDU_INNOV_EVERY) % len(PATH_CYCLE)]
                    edu_stat["yeni_inovator"] += 1
    for c in cities:
        ci = c["i"]
        cap = int(EDU_INTAKE * len(c["players"]) + 0.9999)
        wl = sorted((L.bal[q] + (deposits[q][1] if q in deposits else 0.0) for q in c["players"]))
        cands = []
        for q in c["players"]:
            if q in student or edu_lvl[q] >= 2 or isres(people[q]):
                continue
            stage = edu_lvl[q]
            kind = "okul" if stage == 0 else "universite"
            if not svc_firms(W, ci, kind):
                continue
            tui = (TUI_B, TUI_U)[stage]
            f_ = people[q]["firm"] if people[q]["firm"] else people[q].get("lf")
            lo = firms[f_]["lonca"] if (f_ in firms and firms[f_]["kind"] not in ("ahir", "belediye", "arge")) else None
            bursable = bool(lo and WELF_ON and lo not in closed and wf_eff[lo] > 1e-9)
            afford = L.bal[q] >= EDU_AFFORD_WEEKS * tui * (1 - (EDU_BURS if bursable else 0.0))
            if afford:
                cands.append((-(L.bal[q] + (deposits[q][1] if q in deposits else 0.0)), -stage, q, stage, lo if bursable else None))
        cands.sort()
        for _, _, q, stage, lo in cands[:cap]:
            student[q] = dict(stage=stage, left=EDU_WEEKS[stage], lo=lo, w0=w)
            edu_stat["kayit_" + str(stage)] += 1
            wq = L.bal[q] + (deposits[q][1] if q in deposits else 0.0)
            qi = sum(1 for x in wl if x < wq) * 4 // max(1, len(wl))
            edu_stat[f"kayit_ceyrek{qi}"] += 1
    for f, d in firms.items():
        if not d["workers"] or d.get("dead"):
            continue
        ns = sum(1 for q in d["workers"] if q in student)
        d["ef"] = 1.0 - EDU_TIME * ns / len(d["workers"])
    if w % 10 == 0 or w == weeks:
        edu_hist.append((w, len(student), sum(1 for q in people if edu_lvl[q] >= 1), sum(1 for q in people if edu_lvl[q] >= 2), dict(edu_stat)))


def life_demand(W, budget, ci):
    """K-172: hayat düzeyi bütçesinden talep: sepet + kira sonrası kalan, esnekliğe göre kataloğa dağılır (normal düzeyde lüks ~0, yüksek düzeyde moda/seyahat/mücevher/konut)."""
    BRAND = W.BRAND
    HW_STATE = W.HW_STATE
    LD_VER = W.LD_VER
    MODA_STATE = W.MODA_STATE
    NOW = W.NOW
    REF = W.REF
    RENT_CY = W.RENT_CY
    SW_STATE = W.SW_STATE
    TOUR_STATE = W.TOUR_STATE
    WI = W.WI
    _LDC = W._LDC
    e = _LDC.get(ci)
    if e is None or e[0] != LD_VER[0] or e[1] != NOW[0]:
        items0 = {p: q / CYCLES_PER_WEEK for p, q in BASKET.items()}
        basket_cost = sum(land(W, ci, p) * q for p, q in items0.items()) * W.MARKET_MARKUP
        for p in DURABLES:
            items0[p] = 0.0
        avail = {"yazilim": SW_STATE["on"] * ramp(W, SW_STATE), "hw": HW_STATE["on"] * ramp(W, HW_STATE), "moda": MODA_STATE["on"] * ramp(W, MODA_STATE) * (0.5 + 0.5 * BRAND.get(ci, 0.0)),
                 "seyahat": TOUR_STATE["on"] * ramp(W, TOUR_STATE), "restoran": 1.0, "eglence": 1.0, "mucevher": 1.0, "konut": 1.0}
        act = [(cat, a * LIFE_CATS[cat][0], LIFE_CATS[cat][1]) for cat, a in avail.items() if a > 0]
        lm = {p: land(W, ci, p) * W.MARKET_MARKUP for p in REF}
        e = (LD_VER[0], NOW[0], items0, basket_cost, act, lm, LIFE_CATS["dur"][0], LIFE_CATS["dur"][1], 0.5 * 0)
        _LDC[ci] = e
    _, _, items0, basket_cost, act, lm, dur_c, dur_e, _z = e
    items = dict(items0)
    disc = max(0.0, budget - basket_cost - (RENT_CY.get(ci, 0.0) if HOUSE_ON else 0.0))
    if disc <= 1e-9:
        return items
    x = disc / (LIFE_D0 * WI.get(ci, 1.0))
    raw = {"dur": dur_c * x ** dur_e}
    for cat, ac, ex in act:
        raw[cat] = ac * x ** ex
    tot = sum(raw.values())
    sp = {c: disc * v / tot for c, v in raw.items()}
    for p in DURABLES:
        items[p] = sp["dur"] / len(DURABLES) / lm[p]
    for cat, p in (("moda", "moda"), ("hw", "bilgisayar"), ("yazilim", "yazilim"), ("restoran", "yemek"), ("eglence", "eglence"), ("mucevher", "mucevher"), ("konut", "insaat")):
        if cat in sp:
            items[p] = sp[cat] / lm[p]
    if "seyahat" in sp:
        items["konaklama"] = 0.6 * sp["seyahat"] / lm["konaklama"]
        items["yolculuk"] += 0.4 * sp["seyahat"] / lm["yolculuk"]
    return items


def person_demand(W, wage, tier, ci=None, bal=0.0, budget=None):
    """K-97: sepet + gelirin %90'ına kadar yerli dayanıklı; yüksek katmanda sepet dışının yarısı lüks (zincir dışı, harcanmaz)."""
    BRAND = W.BRAND
    HW_STATE = W.HW_STATE
    MODA_STATE = W.MODA_STATE
    RENT_CY = W.RENT_CY
    SW_STATE = W.SW_STATE
    TOUR_STATE = W.TOUR_STATE
    if budget is not None:
        return life_demand(W, budget, ci)
    items = {p: q / CYCLES_PER_WEEK for p, q in BASKET.items()}
    basket_cost = sum(land(W, ci, p) * q for p, q in items.items()) * W.MARKET_MARKUP
    extra = max(0.0, SPEND_SHARE * wage - basket_cost - (RENT_CY.get(ci, 0.0) if HOUSE_ON else 0.0)) + WEALTH_PROP * max(0.0, bal - WEALTH_BUFFER * wage)   # K-115: servet etkisi
    lux = extra * LUXURY_SHARE_TIER2 if tier == 2 else 0.0
    sw = (extra - lux) * SW_HOUSE * ramp(W, SW_STATE) if (SW_STATE["on"] and tier >= 1) else 0.0     # K-136: orta ve yüksek katman yazılım aboneliği alır
    tour = (extra - lux) * TOUR_SHARE * ramp(W, TOUR_STATE) if (TOUR_STATE["on"] and tier >= 1) else 0.0     # K-138: turizm
    hw = (extra - lux) * HW_SHARE * ramp(W, HW_STATE) if (HW_STATE["on"] and tier >= 1) else 0.0     # K-142: bilgisayar/telefon
    mo = (extra - lux) * MODA_SHARE * ramp(W, MODA_STATE) * (0.5 + 0.5 * BRAND.get(ci, 0.0)) if (MODA_STATE["on"] and tier >= 1) else 0.0     # K-147: markalı giyim; marka düzeyi tercihi artırır
    for p in DURABLES:
        items[p] = (extra - lux - sw - tour - hw - mo) / len(DURABLES) / (land(W, ci, p) * W.MARKET_MARKUP)
    if mo > 0:
        items["moda"] = mo / (land(W, ci, "moda") * W.MARKET_MARKUP)
    if hw > 0:
        items["bilgisayar"] = hw / (land(W, ci, "bilgisayar") * W.MARKET_MARKUP)
    if tour > 0:
        items["konaklama"] = tour / (land(W, ci, "konaklama") * W.MARKET_MARKUP)
    if sw > 0:
        items["yazilim"] = sw / (land(W, ci, "yazilim") * W.MARKET_MARKUP)
    return items
