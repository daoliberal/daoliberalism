"""simkit.media: medya ve reklam: media_dyn, media_found, media_step, direct_ad, ad_step.

ARAYÜZ: direct_ad, ad_step, media_dyn, media_found, media_step
OKUR/YAZAR: W.media_*, W.firms, W.L.
KATMAN: L4.
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.lab_meas import lab_ev, lab_stamp
from simkit.credit_core import LR_NEW, cx_base, lendable, take_fee, ls_gider, ls_kayit, lt_damga
from simkit.credit_meas import ks_karar
from simkit.dao_core import dao_weekly_cost, live_daos, pick_lonca
from simkit.econ_core import isres, working_capital
from simkit.market import pay_telif


def direct_ad(W, f, amt):
    """K-183.5: firma ya da DAO medyadan doğrudan reklam alır (medya sahibi olmak gerekmez): bedel medya firmasına (ve lonca fee'si), karşılığı kurum itibarına reklam birikimi (etki = bedel × medyanın erişim çarpanı); aynı şehirdeki medyalar arasında etkinliğe orantılı."""
    L = W.L
    ad_rev_all = W.ad_rev_all
    ad_rev_m = W.ad_rev_m
    ad_w = W.ad_w
    ad_week = W.ad_week
    firms = W.firms
    kind_stats = W.kind_stats
    media_w = W.media_w
    rev_lb = W.rev_lb
    if amt <= 1e-9:
        return 0.0
    meds = [m for m, dm in firms.items() if dm["kind"] == "medya" and not dm.get("dead") and dm["workers"] and m != f]
    if not meds:
        return 0.0
    cand = [m for m in meds if firms[m]["city"] == firms[f]["city"]] or meds
    wts = [(firms[m].get("eff", 1.0) ** MEDIA_GAMMA) if MEDIA_ACT else 1.0 for m in cand]
    tw = sum(wts)
    paid_tot = 0.0
    for m, wt in zip(cand, wts):
        r = L.pay(f, m, amt * wt / tw, "reklam_alimi")
        if r <= 0:
            continue
        fee = take_fee(W, m, firms[m]["lonca"], r)
        kind_stats["medya"]["rev"] += r - fee
        ad_w[f] += r * (firms[m].get("eff", 1.0) if MEDIA_ACT else 1.0)
        media_w[firms[m]["city"]] += r * (firms[m].get("eff", 1.0) if MEDIA_ACT else 1.0)
        ad_rev_m[m] += r
        ad_rev_all[m] += r
        if MEDIA_ACT:
            ad_week[m] += r
            rev_lb[(firms[m]["lonca"], "medya")] += r
            if firms[m].get("lic"):
                pay_telif(W, m, firms[m], r)
        paid_tot += r
    return paid_tot


def ad_step(W, w):
    """K-183.5: oyuncu firmaları gelirinin AD_FIRM payı kadar (fazla nakit şartıyla) medyadan reklam alır."""
    L = W.L
    ad_stat = W.ad_stat
    firms = W.firms
    people = W.people
    player_firms = W.player_firms
    rev_prev = W.rev_prev
    if not DA_ACT or w < AD_START:
        return
    for f in player_firms:
        d = firms[f]
        if d.get("dead") or not d["workers"] or d["kind"] in ("market", "arge", "belediye", "ahir", "medya"):
            continue
        rv = rev_prev.get(f, 0.0)
        if rv <= 0:
            continue
        sur = L.bal[f] - AD_KEEP * working_capital(W, firms, people, f)
        if sur <= 0:
            continue
        paid = direct_ad(W, f, min(AD_FIRM * rv, AD_MAXSURP * sur))
        ad_stat["firma"] += paid
        ad_stat["firma_adet"] += 1 if paid > 0 else 0


def media_dyn(W, w):
    """K-183.6: medya kanalı: firmanın kullandığı medya patentinin düzeyi kanalı belirler (gazete -> radyo -> televizyon -> internet; internet yazılım ve donanım altyapısını ister), kanal Akçe başına etkili erişimi katlar.
    INNOV_RENT: reklamverenin gördüğü etkili erişim (piyasa) rakiplerin ağırlıklı ortalamasını haftada en çok RENT_FALL oranında yukarı izler (kanalı bulan medya geçici rant alır); yoksa anında erişimin tamamı."""
    HW_STATE = W.HW_STATE
    SW_STATE = W.SW_STATE
    ad_week = W.ad_week
    ad_wk_ema = W.ad_wk_ema
    e_mkt = W.e_mkt
    firms = W.firms
    media_ch_max = W.media_ch_max
    media_series = W.media_series
    rent_hist = W.rent_hist
    rent_owner = W.rent_owner
    rent_run = W.rent_run
    rent_spells = W.rent_spells
    rent_tot = W.rent_tot
    tech_events = W.tech_events
    if not MEDIA_ACT:
        return
    meds = [m for m, d in firms.items() if d["kind"] == "medya" and not d.get("dead") and d["workers"]]
    if not meds:
        ad_week.clear()
        return
    infra = SW_STATE["on"] and (HW_STATE["on"] or not HW_ON)
    for m in meds:
        d = firms[m]
        lev = d.get("klevel", 0.0)
        ch = sum(1 for k_ in MEDIA_CH_K[1:] if lev >= k_)
        if ch >= 3 and not infra:
            ch = 2
        if ch > media_ch_max[0]:
            media_ch_max[0] = ch
            tech_events.append(f"hafta {w}: YENİ MEDYA KANALI: {('gazete', 'radyo', 'televizyon', 'internet')[ch]} ({m} kullanıyor; medya Ar-Ge düzeyi {lev:,.0f})")
        d["ch"] = ch
        d["reach"] = MEDIA_REACH[ch]
    wsum = sum(ad_wk_ema[m] + 1e-6 for m in meds)
    e_t = sum((ad_wk_ema[m] + 1e-6) * firms[m]["reach"] for m in meds) / wsum
    prev = e_mkt[0]
    e_mkt[0] = max(1.0, min(e_t, prev / (1.0 - RENT_FALL)) if (RENT_ACT and e_t > prev) else e_t)
    rent_w = rev_w = inn_w = eff_acc = 0.0
    by_ch = [0.0, 0.0, 0.0, 0.0]
    for m in meds:
        d = firms[m]
        rv = ad_week.get(m, 0.0)
        d["eff"] = min(d["reach"], e_mkt[0]) if RENT_ACT else d["reach"]
        by_ch[d["ch"]] += rv
        rev_w += rv
        eff_acc += rv * d["eff"]
        r_ = rv * (1.0 - d["eff"] / d["reach"])
        rent_w += r_
        inn_w += rv * max(0.0, 1.0 - e_t / d["reach"])
        if r_ > 0:
            rent_owner["medya: " + ("oyuncu DAO" if d["owner"] is not None else "NPC medya")] += r_
    rent_tot["medya"] += rent_w
    share_ = rent_w / rev_w if rev_w > 0 else 0.0
    rent_hist["medya"].append((w, rent_w, share_, e_t / e_mkt[0] - 1.0))
    if share_ > 0.005:
        rent_run["medya"] += 1
    else:
        if rent_run["medya"] >= 3:
            rent_spells["medya"].append((w - rent_run["medya"], rent_run["medya"]))
        rent_run["medya"] = 0
    for m in meds:
        ad_wk_ema[m] = 0.9 * ad_wk_ema[m] + 0.1 * ad_week.get(m, 0.0)
    ad_week.clear()
    media_series.append((w, len(meds), e_t, e_mkt[0], max(firms[m]["reach"] for m in meds), (rev_w / eff_acc) if eff_acc > 0 else 1.0, tuple(by_ch), inn_w))


def media_found(W, w):
    """K-183.6: yeni medya DAO'su (oyuncu firması): şehirdeki reklam gelirinin firma başına payı (yeni firma dahil) işletme giderinin MEDIA_ENTRY_K katını aşıyorsa, uygun oyuncu (öncelik inovatör) kurar; sermaye loncadan kredi, tek şehir-tek medya sınırı yok."""
    L = W.L
    REP = W.REP
    WI = W.WI
    ad_wk_ema = W.ad_wk_ema
    cities = W.cities
    closed = W.closed
    cx_stat = W.cx_stat
    firms = W.firms
    last_media_entry = W.last_media_entry
    loans = W.loans
    loncas = W.loncas
    media_n = W.media_n
    people = W.people
    player_firms = W.player_firms
    tech_events = W.tech_events
    worked = W.worked
    if not MEDIA_ACT or w < MEDIA_START:
        return
    for c in cities:
        ci = c["i"]
        if w - last_media_entry[ci] < MEDIA_COOL:
            continue
        meds = [f for f in c["firms"] if firms[f]["kind"] == "medya" and not firms[f].get("dead") and firms[f]["workers"]]
        city_rev = sum(ad_wk_ema[m] for m in meds)
        cost_wk = CYCLES_PER_WEEK * (MEDYA_STAFF * TIER_WAGE[0] * WI[ci] + ix(W, RENT))
        if city_rev / (len(meds) + 1) < MEDIA_ENTRY_K * cost_wk:
            continue
        cands = [p for p in c["players"] if people[p]["firm"] and worked[p] >= FOUND_WORKED and not people[p].get("founder") and L.bal[p] >= ix(W, FOUND_HARC) and not isres(people[p]) and not (HUMAN_ON and p == W.human)]      # DAO oyunu: insan kendiliğinden medya kurucusu olmaz
        if not cands:
            continue
        cands.sort(key=lambda p: (0 if people[p].get("innov") else 1, int(p.rsplit("p", 1)[1])))
        founder = cands[0]
        fname = f"s{ci}_medya_oy{media_n[0]}"
        firms[fname] = dict(kind="medya", city=ci, lonca=loncas[0], workers=[], owner=founder, capacity=CAP_OTHER, capitalized=True, born=w)
        if PATH_ACT and people[founder].get("innov"):
            firms[fname]["innov_owner"] = True
        wc_need = FOUND_BUF * working_capital(W, firms, people, fname, extra_workers=1)
        ok_ = [l_ for l_ in loncas if l_ not in closed and lendable(W, l_) + (L.bal[founder] - ix(W, FOUND_HARC)) >= wc_need]
        lo = pick_lonca(W, "medya", ok_ or [l_ for l_ in loncas if l_ not in closed])
        firms[fname]["lonca"] = lo
        grant = lendable(W, lo)
        if REP_EFFECT and not ENTRY_OPEN:                       # K-213: itibara bağlı kredi tavanı kalkar
            grant = min(grant, wc_need * min(1.0, CM_BASE + (1 - CM_BASE) * REP[founder] / CM_REP))
        if KR_MEAS:                                    # REKABET G4: davranışsız ret sebebi sayımı
            ls_kayit(W, w, lo, ci, "medya", ls_gider(W, fname), None if grant + (L.bal[founder] - ix(W, FOUND_HARC)) >= wc_need else ("kasa_yetersiz" if lendable(W, lo) + (L.bal[founder] - ix(W, FOUND_HARC)) < wc_need else "limit"))
        ks_karar(W, "onay" if grant + (L.bal[founder] - ix(W, FOUND_HARC)) >= wc_need else "ret")
        if grant + (L.bal[founder] - ix(W, FOUND_HARC)) < wc_need:
            del firms[fname]
            continue
        L.pay(founder, c["acct"], ix(W, FOUND_HARC), "kurulus_harci")
        g = min(grant, wc_need)
        if CREDIT_ON and g > 0:
            ln_ = g * LOAN_SHARE
            L.pay(f"{lo}_sermaye", fname, g - ln_, "sermaye")
            L.pay(f"{lo}_sermaye", fname, ln_, "kredi_verilen")
            loans[fname] = dict(lo=lo, p0=ln_, out=ln_, miss=0, rate=LR_NEW(W) * (min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[founder] / 100)) if REP_EFFECT else 1.0), tur="kurulus")
            if CX_ACT:
                L.flows["kredi_kurulus_adet"] += 1
                cx_stat["hacim_kurulus"] += ln_
            L.flows["kredi_adet"] += 1
            if LONCA_TERMS:
                lt_damga(W, fname, loans[fname], ln_)      # REKABET G5: pd'siz kuruluş kredisi: tek açılış damgası (risk_tol sayacına girmez)
            if KR_MEAS:                                    # REKABET G0: davranışsız ölçüm (verilen kuruluş kredisi tutarı)
                W.lo_stat["ks_verilen"] += ln_
        else:
            L.pay(f"{lo}_sermaye", fname, g, "sermaye")
        L.pay(founder, fname, wc_need - g, "kurucu_sermayesi")
        old = people[founder]["firm"]
        if old:
            firms[old]["workers"].remove(founder)
            if KR_MEAS:
                lab_ev(W, "cikis_gecis", old)                        # davranışsız sayaç (§4.6)
        firms[fname]["workers"].append(founder)
        if KR_MEAS:
            lab_stamp(W, fname)                                      # davranışsız: firma türü kuruluşta (kredi onaylandıktan sonra) bir kez
            lab_ev(W, "ise", fname)
        people[founder].update(firm=fname, founder=True)
        c["firms"].append(fname)
        player_firms.append(fname)
        media_n[0] += 1
        last_media_entry[ci] = w
        L.flows["kurulan_medya_dao_adet"] += 1
        tech_events.append(f"hafta {w}: YENİ MEDYA DAO'SU {fname} kuruldu (şehir {ci}, {lo}, kurucu {founder}; şehir reklam geliri {city_rev:,.0f}/hf, medya sayısı {len(meds)} -> {len(meds) + 1})")


def media_step(W, w):
    """K-180: medya firması satın alma. Lonca: kasasından ayırarak biriktirir (beklenen kazanç = medya kârı + kendi reklam tasarrufu); DAO: artı kasasıyla. Fiyat şehir kasasına gider. Sahibi kendi reklamını indirimli yapar, kâr sahibine akar."""
    L = W.L
    ad_pay_ema = W.ad_pay_ema
    cities = W.cities
    closed = W.closed
    cx_stat = W.cx_stat
    eq_cap = W.eq_cap
    firms = W.firms
    loans = W.loans
    loncas = W.loncas
    media_log = W.media_log
    media_save = W.media_save
    mprof = W.mprof
    orep = W.orep
    tech_events = W.tech_events
    if not MO_ACT or w < EQ_START:
        return
    medias = [f for f, d in firms.items() if d["kind"] == "medya" and not d.get("dead")]
    free = [f for f in medias if firms[f].get("org_owner") is None and mprof[f] > 0]
    n_own = defaultdict(int)
    for f in medias:
        og = firms[f].get("org_owner")
        if og:
            n_own[og[1]] += 1
    for lo in loncas:
        if lo in closed or not free:
            continue
        if n_own[lo] >= MEDIA_MAX_PER_OWNER:
            continue
        best = None
        for f in free:
            price = max(ix(W, MEDIA_PRICE_MIN), MEDIA_PE * mprof[f])
            gain = mprof[f] + MEDIA_OWN_DISC * ad_pay_ema[(lo, f)]
            if gain * MEDIA_HORIZON >= price and (best is None or gain / price > best[0]):
                best = (gain / price, f, price)
        if best is None:
            media_save[lo] = 0.0 if not free else media_save[lo]
            continue
        _, f, price = best
        loan_m, lender_m = 0.0, None
        if CX_ACT and orep.get(lo, 0.0) >= CX_MIN_OREP:                       # K-181: medya kredisi (itibar ve geri ödeme gücü şartı)
            lender_m = max((l_ for l_ in loncas if l_ not in closed and l_ != lo), key=lambda l_: (lendable(W, l_), l_), default=None)
            lm_ = CX_MEDIA_LTV * price
            gain_w = mprof[f] + MEDIA_OWN_DISC * ad_pay_ema[(lo, f)]
            if lender_m is not None and lendable(W, lender_m) >= lm_ and lm_ / CX_MEDIA_TERM + cx_base(W) * lm_ <= gain_w:
                loan_m = lm_
        need_m = price - loan_m
        media_save[lo] = min(need_m, media_save[lo] + MEDIA_SAVE * max(0.0, L.bal[lo] - media_save[lo]))
        if media_save[lo] >= need_m - 1e-9 and L.bal[lo] >= need_m:
            if loan_m > 0:
                L.pay(f"{lender_m}_sermaye", lo, loan_m, "kredi_verilen")
                loans[f] = dict(lo=lender_m, p0=loan_m, out=loan_m, miss=0, rate=max(CX_RATE_MIN, cx_base(W)), tur="medya", payer=lo, term=CX_MEDIA_TERM)
                L.flows["kredi_medya_adet"] += 1
                cx_stat["hacim_medya"] += loan_m
            L.pay(lo, cities[firms[f]["city"]]["acct"], price, "medya_satin_alma")
            firms[f]["org_owner"] = ("lonca", lo)
            media_save[lo] = 0.0
            free.remove(f)
            n_own[lo] += 1
            media_log.append(dict(week=w, media=f, owner=lo, kind="lonca", price=price, profit=mprof[f]))
            L.flows["medya_satin_alma_adet"] += 1
            tech_events.append(f"hafta {w}: {lo} {f} medyasını {price:,.0f} Akçeye satın aldı")
    for n in live_daos(W):
        if not free:
            break
        d = firms[n]
        if n_own[n] >= 1 or not d["workers"]:
            continue
        spare = L.bal[n] - DAO_SURPLUS_WEEKS * dao_weekly_cost(W, n) - (loans[n]["out"] if n in loans else 0.0) - (EQ_KEEP * eq_cap[n] if EQ_ACT else 0.0)
        for f in sorted(free, key=lambda x: -mprof[x]):
            price = max(ix(W, MEDIA_PRICE_MIN), MEDIA_PE * mprof[f])
            loan_d, lender_d = 0.0, None
            if CX_ACT and orep.get(n, 0.0) >= CX_MIN_OREP:
                lender_d = d["lonca"] if d["lonca"] not in closed else None
                ld_ = CX_MEDIA_LTV * price
                if lender_d is not None and lendable(W, lender_d) >= ld_ and ld_ / CX_MEDIA_TERM + cx_base(W) * ld_ <= mprof[f]:
                    loan_d = ld_
            if spare >= price - loan_d and mprof[f] * MEDIA_HORIZON >= price:
                if loan_d > 0:
                    L.pay(f"{lender_d}_sermaye", n, loan_d, "kredi_verilen")
                    loans[f] = dict(lo=lender_d, p0=loan_d, out=loan_d, miss=0, rate=max(CX_RATE_MIN, cx_base(W)), tur="medya", payer=n, term=CX_MEDIA_TERM)
                    L.flows["kredi_medya_adet"] += 1
                    cx_stat["hacim_medya"] += loan_d
                L.pay(n, cities[firms[f]["city"]]["acct"], price, "medya_satin_alma")
                firms[f]["org_owner"] = ("dao", n)
                free.remove(f)
                n_own[n] += 1
                media_log.append(dict(week=w, media=f, owner=n, kind="dao", price=price, profit=mprof[f]))
                L.flows["medya_satin_alma_adet"] += 1
                tech_events.append(f"hafta {w}: DAO {n} {f} medyasını {price:,.0f} Akçeye satın aldı")
                break
