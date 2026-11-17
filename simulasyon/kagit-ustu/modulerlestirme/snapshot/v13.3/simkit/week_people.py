"""simkit.week_people: hafta içi insan/firma fazları: göç, kadro, oyuncu firma kuruluşu, yerli talep, döngü hazırlığı.

ARAYÜZ: phase_migration, phase_staffing, phase_founding, human_found, phase_domestic, phase_cycle_setup
OKUR/YAZAR: W.
KATMAN: L7.
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from functools import partial
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.lab_meas import lab_ev, lab_stamp, human_cikis
from simkit.founding import threshold, worth, young, thr_eff, imp_of
from simkit.credit_core import LR_NEW, lendable
from simkit.dao import dao_reloc, dao_step
from simkit.dao_core import pick_lonca
from simkit.econ_core import freight, hire_cash_ok, isrole, isres, working_capital
from simkit.firms import capex_start
from simkit.households import edu_step, health_step
from simkit.human import human_hide, human_unhide, human_olay, human_basvuru_son, note_firm, kur_eksikleri, kur_yeni_yol
from simkit.labor import mgr_step, openings, player_inflow_all, pop_ahir_player, restaff
from simkit.sector_core import sb_hire_ok, board_stat_add
from simkit.entry_open import eo_pre_week, eo_organic, eo_found, eo_input_ok
from simkit.entry_exp import ee_organic, ee_picks, ee_note, ee_merge
from simkit.young_core import is_fund_lo, yk_young
from simkit.young_kit import yk_fund_step, yk_firm_pre, yk_hire, yk_release_note
from simkit.lonca import fee_step, lonca_step, nl_step, switch_step, welf_step


def phase_migration(W, w):
    """NPC ve oyuncu göçü, inovasyon kayıtları."""
    L = W.L
    REP = W.REP
    RM = W.RM
    cities = W.cities
    jobless = W.jobless
    media_w = W.media_w
    people = W.people
    w_ctx = W.w_ctx
    for c in cities:
        c["freight_prev"] = 0.6 * c["freight_prev"] + 0.4 * c["freight_want_w"] if w_ctx[0] > 2 else c["freight_want_w"]    # hareketli ortalama
        c["freight_w"], c["freight_want_w"] = 0.0, 0.0
        media_w[c["i"]] = 0.0
        c["missed_w"] = c["served_w"] = c["unpaid_w"] = c["paid_w"] = 0
        c["dem_units_prev"] = c.get("dem_units", 0.0)
        c["imp_val"] = c["exp_val"] = c["cons_val"] = c["dem_units"] = c["got_units"] = 0.0
    # --- NPC göçü (K-87)
    if w > 1:
        ranked = sorted(range(len(cities)), key=lambda j: -cities[j]["rep"])
        budget = int(MIGRATION_SHARE * sum(len(c["pool"]) for c in cities))
        for j in ranked:
            if budget <= 0:
                break
            opening = int(openings(W, j) / (max(1.0, RM[j]) ** HOUSE_BRAKE if HOUSE_ON else 1.0))     # K-159: kira göçü frenler
            for src in reversed(ranked):
                if src == j or opening <= 0 or budget <= 0:
                    continue
                while len(cities[src]["pool"]) > NPC_RESERVE and opening > 0 and budget > 0:
                    q = cities[src]["pool"].pop(0)
                    people[q]["city"] = j
                    cities[j]["pool"].append(q)
                    opening -= 1
                    budget -= 1
                    L.flows["goc_npc"] += 1
    # --- oyuncu göçü (K-51, K-113): uzun süredir işsiz oyuncu, iş açığı olan şehre taşınır (bakiyesi ve kimliği ile)
    if w > 1:
        for c in cities:
            for q in c["seekers"]:
                jobless[q] = jobless.get(q, 0) + 1
        for q in list(jobless):
            if people[q]["firm"] is not None:
                jobless.pop(q)
        room = {j: int(openings(W, j) / (max(1.0, RM[j]) ** HOUSE_BRAKE if HOUSE_ON else 1.0)) - len(cities[j]["seekers"]) for j in range(len(cities))}
        for c in cities:
            movers = [q for q in c["seekers"] if jobless.get(q, 0) >= PLAYER_MIGRATE_AFTER and not (HUMAN_ON and q == W.human)]      # DAO oyunu: insan kendiliğinden şehir değiştirmez
            movers = movers[:int(len(movers) * PLAYER_MIGRATE_SHARE + 0.9999)]
            for q in movers:
                j = max(room, key=lambda x: room[x])
                if room[j] <= 0 or j == c["i"]:
                    break
                c["seekers"].remove(q)
                c["players"].remove(q)
                cities[j]["seekers"].append(q)
                cities[j]["players"].append(q)
                people[q]["city"] = j
                jobless[q] = 0
                room[j] -= 1
                L.flows["goc_oyuncu"] += 1
    if INNOV_ON:
        welf_step(W, w)
        lonca_step(W, w)
        nl_step(W, w)
        dao_reloc(W, w)
        fee_step(W, w)
        switch_step(W, w)
        dao_step(W, w)
        mgr_step(W, w)
        if REP_EFFECT:                                           # K-11: işe alımda itibar önceliği
            for c in cities:
                c["seekers"].sort(key=lambda q: -REP[q])


def phase_staffing(W, w):
    """yeniden kadrolama, capex başlangıcı, sağlık/eğitim adımları."""
    cities = W.cities
    svc_rev_prev = W.svc_rev_prev
    svc_rev_w = W.svc_rev_w
    treat_n_prev = W.treat_n_prev
    treat_n_w = W.treat_n_w
    if KR_MEAS or HUMAN_ON:
        dao_tgt = {n: v for n, v in W.staff_tgt.items() if W.firms[n]["kind"] == "arge"} if HUMAN_ON else None      # Ar-Ge DAO'ları kadro hedefini phase_migration'daki dao_step'te (bu temizlikten ÖNCE) yazar: iş ilanı için korunur (KR_MEAS ölçümü eskisi gibi temizler)
        W.staff_tgt.clear()                                        # davranışsız kayıt (§4.6): hedefler her hafta yeniden yazılır; ölü firma girmez
        if dao_tgt:
            W.staff_tgt.update(dao_tgt)
    W.need_by_city = {ci: restaff(W, ci) for ci in range(len(cities))}
    player_inflow_all(W)                                           # D6/D7: PLAYER_INFLOW (varsayılan kapalı); toplam kişi sınırı şehirlere adil bölünür
    capex_start(W, w)
    for k_ in list(treat_n_w):
        treat_n_prev[k_] = treat_n_w[k_]
    treat_n_w.clear()
    for k_ in [k_ for k_ in svc_rev_w if k_[0] != "__last"]:
        svc_rev_prev[k_] = svc_rev_w[k_]
        svc_rev_w[k_] = 0.0
    health_step(W, w)
    edu_step(W, w)


def human_found(W, w, c):
    """DAO oyunu: insanın bekleyen `kur` kararını (W.human_kur) şehri c için değerlendirir; insanın işletme kurabildiği TEK yer (kendiliğinden kurmaz).
    Aday şartları (iki yolda da): bir firmada çalışıyor (ENTRY_JOBLESS açıksa iş arayan da), worked >= FOUND_WORKED (gün), eski yolda L.bal >= FOUND_HARC, kurucu değil, Ar-Ge'de değil, w >= FOUND_WEEK; olmazsa `kurulamadi/sart`.
    ENTRY_OPEN ya da (ENTRY_EXP, EE_REPLACE, EE_FIN_OLD kapalı): doğrudan eo_found (kredi yetmezse `kurulamadi/kredi`, kuruluş beklemez). Eski lonca yolu: sektör W.human_go'ya konur;
    phase_founding insanı cands'in, sektörü imp'in başına koyar ve kuruluş/kredi sonucunu döngüde yazar. Tek seferliktir: W.human_kur her durumda boşalır."""
    h = W.human
    kind = W.human_kur
    p = W.people[h]
    if kind is None or p["city"] != c["i"]:
        return
    W.human_kur = None
    yeni = kur_yeni_yol()
    ok = not kur_eksikleri(W, h, w)                                            # şartların tek kaynağı (gozlem.kurabilir de bunu çağırır)
    prod = PROD_OF[kind]
    if ok and yeni and not eo_input_ok(W, prod):
        ok = False                                                             # girdisi hiçbir şehirde üretilmiyor: kurulamaz
    if not ok:
        human_olay(W, w, "kurulamadi", sektor=kind, neden="sart")
        return
    if not yeni:
        W.human_go = kind
        return
    if eo_found(W, w, c, h, kind):
        W.LAST_ENTRY[(c["i"], prod)] = w
        note_firm(W, W.player_firms[-1], kind, w)
        human_olay(W, w, "kuruldu", firma=W.player_firms[-1], sektor=kind)
    else:
        human_olay(W, w, "kurulamadi", sektor=kind, neden="kredi")


def phase_founding(W, w):
    """oyuncu firma kuruluşu (K-98): sinyal, eşik, fizibilite, lonca sermayesi."""
    L = W.L
    NLAB_ON = W.NLAB_ON
    REP = W.REP
    chain = W.chain
    chain_der = W.chain_der
    cities = W.cities
    closed = W.closed
    contracts = W.contracts
    cx_stat = W.cx_stat
    firms = W.firms
    gate = W.gate
    loans = W.loans
    loncas = W.loncas
    new_slots = W.new_slots
    people = W.people
    player_firms = W.player_firms
    prof_ema = W.prof_ema
    short_hist = W.short_hist
    worked = W.worked
    LAST_ENTRY = W.LAST_ENTRY
    NOW = W.NOW
    PRICE = W.PRICE
    RECIPES = W.RECIPES
    REF = W.REF
    TOPO = W.TOPO
    # --- oyuncu firmaları (K-98): sinyal = dünya eksiği + şehir ithalatı/2; sermaye loncadan (K-34); harç şehre (K-33)
    if ROOM_ACT:
        for p_ in PRODUCER:
            h_ = short_hist[p_]
            h_.append(W.last_root_short_val.get(p_, 0.0))
            if len(h_) > ROOM_N:
                h_.pop(0)
    if HUMAN_ON and w < FOUND_WEEK and W.human_kur is not None:
        human_olay(W, w, "kurulamadi", sektor=W.human_kur, neden="sart")    # kuruluş fazı henüz açık değil: karar sessizce kaybolmaz
        W.human_kur = None
    if w >= FOUND_WEEK:
        if FOUND_FUND and (ENTRY_OPEN or ENTRY_EXP):                               # K-215a: şehir kasasından kuruluş fonuna aktarım (kohort/organik kuruluştan önce; fon yalnız ENTRY_OPEN kuruluşlarına kredi verir)
            yk_fund_step(W, w)
        if ENTRY_OPEN or ENTRY_EXP:                                 # K-213: ölçüm kaydı + rakip kohortu (kohort yalnız ENTRY_OPEN)
            eo_pre_week(W, w)
        world_left = defaultdict(float, W.last_root_short_val)          # K-117: dünya eksiği şehirler arasında bir kez harcanır
        if ENTRY_FIX:                                                 # K-185.14: türetilmiş girdi sinyali: karşılanmayan ürün talebi, tarifte aşağı yayılır (üretici yoksa girdisine talep görünmezdi: ölü zincir yeniden kurulamıyordu)
            dv_ = defaultdict(float)
            for kind_ in reversed(TOPO):
                if kind_ == "ahir":
                    continue
                need_u = W.last_short.get(PROD_OF[kind_], 0.0) + dv_[PROD_OF[kind_]]
                if need_u <= 0:
                    continue
                for q_, per_ in RECIPES[kind_][1].items():
                    if q_ in ("yazilim", "bilgisayar", "koruma"):
                        continue
                    dv_[q_] += need_u * per_
            for q_, u_ in dv_.items():
                if q_ in PRODUCER and q_ != "sut" and q_ not in ("et", "deri"):
                    world_left[q_] += u_ * REF[q_]
                    chain_der[q_] += u_ * REF[q_]
        for c in cities:
            sig = defaultdict(float)
            for p, v in world_left.items():                          # kök eksiklik (pano)
                sig[p] += v
            for p, v in c["last_imports"].items():
                sig[p] += v * 0.5
            imp_l = []
            _sl = NOW[0] // 25 * 25
            for p, v in (sig.items() if not (ENTRY_OPEN or (ENTRY_EXP and EE_REPLACE)) else ()):      # K-213: ENTRY_OPEN'da sinyal/worth kapıları yok (eo_organic ağırlıklandırır)
                if p in PRODUCER and PRODUCER[p] != "ahir":
                    chain[(_sl, p)]["sinyal_hafta"] += 1
                    if v - young(W, w, c, p) * threshold(W, p) * ENTRY_ABSORB >= thr_eff(W, c, p):
                        if worth(W, w, c, p):
                            imp_l.append((v, p))
                            chain[(_sl, p)]["worth_gecti"] += 1
                    else:
                        chain[(_sl, p)]["sinyal_esigi"] += 1
            imp = sorted(imp_l, reverse=True)
            cands = [p for p in c["players"] if (people[p]["firm"] or (ENTRY_JOBLESS and p in c["seekers"])) and worked[p] >= FOUND_WORKED and not people[p].get("founder")
                     and (ENTRY_OPEN or L.bal[p] >= FOUND_HARC) and not isres(people[p]) and not (HUMAN_ON and p == W.human)]      # K-98: harcı biriktirmiş olmak; DAO oyunu: insan kendiliğinden kurucu olmaz
            if ENTRY_EXP and EE_FIN_OLD and not ENTRY_OPEN:
                imp = ee_picks(W, w, c, cands) if EE_REPLACE else ee_merge(imp, ee_picks(W, w, c, cands))                              # beklenen kâr seçer; finansman eski yolda (kendi birikimi harç + lonca kredisi)
            if HUMAN_ON and W.human_kur is not None:
                human_found(W, w, c)                                              # yeni yolda doğrudan kurar; eski yolda sektör W.human_go'da
                if W.human_go is not None:
                    imp.insert(0, (max((v_ for v_, _ in imp), default=0.0) + 1.0, PROD_OF[W.human_go]))
                    cands.insert(0, W.human)
            _g25 = NOW[0] // 25 * 25
            gate[(_g25, "sinyal_esik")] += sum(1 for p, v in sig.items() if p in PRODUCER and PRODUCER[p] != "ahir" and v >= threshold(W, p))
            gate[(_g25, "sinyal_worth_gecen")] += len(imp)
            gate[(_g25, "hafta_sehir")] += 1
            gate[(_g25, "oyuncu_toplam")] += len(c["players"])
            gate[(_g25, "o_calisan")] += sum(1 for p in c["players"] if people[p]["firm"])
            gate[(_g25, "o_worked")] += sum(1 for p in c["players"] if people[p]["firm"] and worked[p] >= FOUND_WORKED)
            gate[(_g25, "o_harc")] += sum(1 for p in c["players"] if people[p]["firm"] and worked[p] >= FOUND_WORKED and L.bal[p] >= FOUND_HARC)
            gate[(_g25, "aday_son")] += len(cands)
            if imp and not cands:
                for _v, _p in imp:
                    chain[(_sl, _p)]["kurucu_yok"] += 1
                if WEEKLY_CSV:
                    W.WKC["kurucu_yok"] += len(imp)
            for lo in (loncas if not (ENTRY_OPEN or (ENTRY_EXP and EE_REPLACE and not EE_FIN_OLD)) else ()):                 # K-213: ENTRY_OPEN'da kuruluş eo_organic/eo_found yolunda
                n_lo = 0                                              # inceleme: tek lonca haftanın tüm kurucularını tüketmesin
                while imp and cands and n_lo < FOUND_PER_LONCA:
                    v, prod = imp[0]
                    kind = PRODUCER[prod]
                    founder = cands[0]
                    fname = f"s{c['i']}_{kind}_oy{L.flows['kurulan_oyuncu_firmasi_adet']:.0f}"
                    firms[fname] = dict(kind=kind, city=c["i"], lonca=lo, workers=[], owner=founder, capacity=CAP_OTHER, capitalized=True, born=w)
                    if PATH_ACT and people[founder].get("innov"):
                        firms[fname]["innov_owner"] = True               # K-170: inovatör firma sahibi
                    wc_need = FOUND_BUF * working_capital(W, firms, people, fname, extra_workers=1)
                    if FOUND_WC_REAL and not FOUNDER_DEFER:             # M2.1: kurucunun gerçek ücreti ilk haftaların sermayesine girer
                        wc_need += FOUND_BUF * WORKING_CAPITAL_CYCLES * max(0.0, people[founder]["wage"] - TIER_WAGE[0])
                    if INNOV_ON:                                          # K-167: firma loncayı telif indirimi ve krediye göre seçer
                        ok_ = [l_ for l_ in loncas if l_ not in closed and lendable(W, l_) + (L.bal[founder] - FOUND_HARC) >= wc_need]
                        lo = pick_lonca(W, kind, ok_ or [l_ for l_ in loncas if l_ not in closed])
                        firms[fname]["lonca"] = lo
                        if NL_ACT and lo in new_slots:
                            firms[fname]["ever_new"] = True
                    grant = lendable(W, lo)
                    if INNOV_ON and REP_EFFECT and not FOUND_COLLAT:      # K-11: kredi limiti itibara bağlı (FOUND_COLLAT: teminatlı kuruluş kredisi, itibar yalnız faizi etkiler)
                        grant = min(grant, wc_need * min(1.0, CM_BASE + (1 - CM_BASE) * REP[founder] / CM_REP))
                    if WEEKLY_CSV:
                        W.WKC["kredi_basvuru"] += 1
                        W.WKC["tavan_orani_toplam"] += (grant + (L.bal[founder] - FOUND_HARC)) / max(1e-9, wc_need)
                    if ENTRY_EXP and EE_FIN_OLD:
                        grant = min(grant, (1.0 - EE_OWN) * wc_need)               # kurucu sermayenin en az EE_OWN payını kendi birikiminden koyar (kalanı lonca kredisi)
                    if grant + (L.bal[founder] - FOUND_HARC) < wc_need:
                        del firms[fname]
                        if HUMAN_ON and founder == W.human:
                            human_olay(W, w, "kurulamadi", sektor=kind, neden="kredi")      # insan ve sektörü çıkar; botlar o hafta engellenmez
                            W.human_go = None
                            cands.pop(0)
                            imp.pop(0)
                            continue
                        gate[(NOW[0] // 25 * 25, "kredi_yetersiz")] += 1
                        if WEEKLY_CSV:
                            W.WKC["kredi_ret"] += 1
                            W.WKC["ret_" + kind] += 1
                            W.WKC["nd_" + ("havuz" if lendable(W, lo) + (L.bal[founder] - FOUND_HARC) < wc_need else "itibar")] += 1
                        chain[(_sl, prod)]["kredi_yetersiz"] += 1
                        break
                    L.pay(founder, c["acct"], FOUND_HARC, "kurulus_harci")       # K-33: harç oyuncudan şehre
                    W.g = min(grant, wc_need)
                    if CREDIT_ON and W.g > 0:                                       # K-158: lonca sermayesi kredidir (geri döner, faiz getirir)
                        ln_ = W.g * LOAN_SHARE
                        L.pay(f"{lo}_sermaye", fname, W.g - ln_, "sermaye")
                        L.pay(f"{lo}_sermaye", fname, ln_, "kredi_verilen")
                        loans[fname] = dict(lo=lo, p0=ln_, out=ln_, miss=0, rate=LR_NEW(W) * (min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[founder] / 100)) if (INNOV_ON and REP_EFFECT) else 1.0), tur="kurulus")
                        if CX_ACT:
                            L.flows["kredi_kurulus_adet"] += 1
                            cx_stat["hacim_kurulus"] += ln_
                        L.flows["kredi_adet"] += 1
                    else:
                        L.pay(f"{lo}_sermaye", fname, W.g, "sermaye")              # K-34: lonca işletme sermayesini verir
                    L.pay(founder, fname, wc_need - W.g, "kurucu_sermayesi")
                    old = people[founder]["firm"]
                    if old:
                        firms[old]["workers"].remove(founder)
                        if KR_MEAS:
                            lab_ev(W, "cikis_gecis", old)                  # davranışsız sayaç (§4.6)
                    elif founder in c["seekers"]:
                        c["seekers"].remove(founder)                       # K-187.5: işsiz deneyimli oyuncu firma kurar
                    firms[fname]["workers"].append(founder)
                    if KR_MEAS:
                        lab_stamp(W, fname)                                # davranışsız: firma türü kuruluşta (kredi onaylandıktan sonra) bir kez
                        lab_ev(W, "ise", fname)
                    people[founder].update(firm=fname, founder=True)
                    if FOUNDER_DEFER > 0:
                        people[founder]["wage"] = 0.0                  # M2.1: kurucu ilk haftalarda kendine ücret ödemez
                    c["firms"].append(fname)
                    player_firms.append(fname)
                    if HUMAN_ON and founder == W.human:
                        W.human_go = None
                        note_firm(W, fname, kind, w)
                        human_olay(W, w, "kuruldu", firma=fname, sektor=kind)
                    if CONTRACT_N > 0:                                            # K-166: tedarik sözleşmesi (en ucuz teslimli kaynak, sabit fiyat)
                        cts = {}
                        for pp in RECIPES[kind][1]:
                            if pp in ("yazilim", "bilgisayar"):
                                continue
                            cj = [(PRICE[(j_, pp)] + freight(W, j_, pp, abs(j_ - c["i"])), j_) for j_ in range(len(cities)) if W.prod_last.get((j_, pp), 0.0) > 1e-9]
                            if cj:
                                _, bj = min(cj)
                                cts[pp] = dict(j=bj, price=PRICE[(bj, pp)] * CONTRACT_PX, until=w + CONTRACT_N)
                        contracts[fname] = cts
                    L.flows["kurulan_oyuncu_firmasi_adet"] += 1
                    if ENTRY_EXP and EE_FIN_OLD:
                        ee_note(W, w, c, fname, kind, founder, wc_need)
                    chain[(_sl, prod)]["kuruldu"] += 1
                    LAST_ENTRY[(c["i"], prod)] = w
                    n_lo += 1
                    cands.pop(0)
                    imp.pop(0)
                    world_left[prod] = max(0.0, world_left[prod] - threshold(W, prod))
            if HUMAN_ON and W.human_go is not None:
                human_olay(W, w, "kurulamadi", sektor=W.human_go, neden="kredi")      # döngü insana hiç sıra vermedi (ör. lonca yok): karar kaybolmaz
                W.human_go = None
            if ENTRY_EXP and not EE_FIN_OLD:
                ee_organic(W, w, c, sig)                                # beklenen kâra bağlı kuruluş (eo_organic yerine)
            elif ENTRY_OPEN:
                eo_organic(W, w, c, sig)
            for fname in [f for f in player_firms if firms[f]["city"] == c["i"] and not firms[f].get("dead")]:
                d = firms[fname]
                if HUMAN_ON and d.get("kapaniyor"):
                    continue                                                           # DAO oyunu: sahibi ayrılan (kapanmakta olan) işletme işçi almaz
                if KR_MEAS or HUMAN_ON:
                    W.staff_tgt[fname] = len(d["workers"])                              # davranışsız kayıt (§4.6): işe alım koşulu sağlanmazsa hedef = mevcut kadro
                yk_ = YOUNG_KIT and yk_young(W, d) and bool(d["workers"])                # K-216: genç oyuncu firması
                if yk_:
                    yk_firm_pre(W, w, c, fname, d)                                        # EMA, açılış reklamı, nakit iadesi, dayanma limitinden çekim
                if CREDIT_ON and GROW_LOAN and (not CX_ACT or (yk_ and not FOUND_FUND)) and len(d["workers"]) < d["capacity"] and c["seekers"]:       # K-158: büyüme kredisi (sağlıklı firma: kasası eşiğe yakın; kaldıraç sınırlı); K-216 (6): genç firmada kasa şartı yok (borç tavanı kalır)
                    wc1 = working_capital(W, firms, people, fname, 1)
                    gap = GROW_FACTOR * wc1 - L.bal[fname]
                    ln_ = loans.get(fname)
                    out_ = ln_["out"] if ln_ else 0.0
                    if (0 < gap if yk_ else 0 < gap <= (1 - GROW_LOAN_MIN) * GROW_FACTOR * wc1) and out_ + gap <= LOAN_LEV * wc1 and gap <= lendable(W, d["lonca"]) and (not ln_ or (ln_["miss"] == 0 and not is_fund_lo(ln_["lo"]))):
                        L.pay(f"{d['lonca']}_sermaye", fname, gap, "kredi_verilen")
                        if ln_:
                            ln_["p0"] += gap
                            ln_["out"] += gap
                        else:
                            loans[fname] = dict(lo=d["lonca"], p0=gap, out=gap, miss=0)
                        L.flows["buyume_kredisi_adet"] += 1
                if SHRINK_FIRST and len(d["workers"]) > 1 and prof_ema[fname] < 0 and L.bal[fname] < SHRINK_WEEKS * CYCLES_PER_WEEK * sum(people[q_]["wage"] for q_ in d["workers"]):
                    cand_ = [q_ for q_ in d["workers"] if q_ != d["owner"] and not isrole(people[q_])]
                    if cand_:
                        q_ = min(cand_, key=lambda x_: REP[x_])
                        d["workers"].remove(q_)
                        if KR_MEAS:
                            lab_ev(W, "cikis_kuculme", fname)              # davranışsız sayaç (§4.6)
                        people[q_]["firm"] = None
                        if HUMAN_ON:
                            human_cikis(W, q_, "kucultme")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
                        (c["pool"] if people[q_]["who"] == "npc" else c["seekers"]).append(q_)
                        L.flows["kuculme_oyuncu_kisi"] += 1
                        if yk_:
                            yk_release_note(W, w, d, q_)                                   # K-216 (2): alım/çıkarma salınımı sayacı
                    continue
                if SECTOR_BOARD and not yk_ and not sb_hire_ok(W, d):             # v13.0: genç firma kendi sipariş/pano kıtlığına göre alır (yk_target); sektör stoku bekletmesi uygulanmaz
                    board_stat_add(W, "oyuncu_ise_alim_bekle")      # K-212: sektör stoku fazla, kıtlık yok: işe alım beklet
                    continue
                if yk_:                                                                   # K-216 (2): talebe bağlı işe alım (haftada birden çok; kasa şartı yok, limit)
                    yk_hire(W, w, c, fname, d, partial(_yk_take, W, c, fname))
                    continue
                if (KR_MEAS or HUMAN_ON) and L.bal[fname] >= GROW_FACTOR * working_capital(W, firms, people, fname, 1) and hire_cash_ok(W, fname, L.bal[fname]):   # son düzeltme I3: kasa kapısı ilanı kesiyorsa hedef = mevcut kadro
                    W.staff_tgt[fname] = max(d["capacity"], len(d["workers"]))           # davranışsız kayıt (§4.6): koşul sağlanıyorsa hedef kapasite
                if len(d["workers"]) < d["capacity"] and L.bal[fname] >= GROW_FACTOR * working_capital(W, firms, people, fname, 1) and hire_cash_ok(W, fname, L.bal[fname]):
                    hid_ = human_hide(W, c, fname) if HUMAN_ON else None                  # DAO oyunu: insan iş arayanlarda kalır ama yalnız başvurduğu firmanın işe alımında görünür
                    q = None
                    try:
                        q = c["seekers"].pop(0) if c["seekers"] else next(
                            (x for x in (pop_ahir_player(W, a) for a in c["firms"] if firms[a]["kind"] == "ahir") if x is not None), None)
                    finally:
                        if hid_ is not None:
                            human_unhide(W, c, hid_, q)
                    if q is None and NLAB_ON and NPC_LAB_PF and c["pool"]:           # K-185.15: oyuncu firması da NPC işçi alır (K-77 'yalnız oyuncu' kuralı kalktı)
                        q = c["pool"].pop(0)
                        L.flows["oyuncu_firmasi_npc_ise_alim"] += 1
                    if q is None:
                        break
                    d["workers"].append(q)
                    if KR_MEAS:
                        lab_ev(W, "ise", fname)                            # davranışsız sayaç (§4.6)
                    people[q].update(firm=fname, avans=True)
    if HUMAN_ON:
        human_basvuru_son(W, w)                                    # DAO oyunu: insanın başvurusu bu haftanın bütün işe alım adımlarından (dao_step, restaff, oyuncu işletmeleri) sonra sonuçlanır; çevrimlerden önce


def _yk_take(W, c, fname=None):
    """K-216 (2): genç firmanın işçi bulma sırası (klasik işe alımla aynı): iş arayan oyuncu -> ahır oyuncusu -> (NPC_LAB_PF) NPC havuzu."""
    firms = W.firms
    hid_ = human_hide(W, c, fname) if HUMAN_ON else None                  # DAO oyunu: insan yalnız başvurduğu firmanın işe alımında görünür
    q = None
    try:
        q = c["seekers"].pop(0) if c["seekers"] else next(
            (x for x in (pop_ahir_player(W, a) for a in c["firms"] if firms[a]["kind"] == "ahir") if x is not None), None)
    finally:
        if hid_ is not None:
            human_unhide(W, c, hid_, q)
    if q is None and W.NLAB_ON and NPC_LAB_PF and c["pool"]:
        q = c["pool"].pop(0)
        W.L.flows["oyuncu_firmasi_npc_ise_alim"] += 1
    return q


def phase_domestic(W, w):
    """yerli dayanıklı talep adımı (K-133)."""
    L = W.L
    cities = W.cities
    closed = W.closed
    dep_tot = W.dep_tot
    firms = W.firms
    loncas = W.loncas
    people = W.people
    TOPO = W.TOPO
    if DOMESTIC_EVERY > 0 and w % DOMESTIC_EVERY == 0:             # K-133: yerli üretim tabanı (loncaların sermaye programı eliyle adım adım)
        for c in cities:
            live = {firms[f]["kind"] for f in c["firms"] if firms[f]["workers"]}
            have = {firms[f]["kind"] for f in c["firms"]}
            miss_k = [k for k in TOPO if k not in live and k not in have and k not in ("ahir", "yazilim", "otel", "elektronik", "bilgisayar", "moda", "maden_altin")]
            if not miss_k:
                continue
            k = max(miss_k, key=partial(imp_of, W, c))
            lo = ([l_ for l_ in loncas if l_ not in closed] or loncas)[len(firms) % len([l_ for l_ in loncas if l_ not in closed] or loncas)] if closed else loncas[len(firms) % 6]
            fname = f"s{c['i']}_{k}_yt{L.flows['yerli_taban_firma_adet']:.0f}"
            firms[fname] = dict(kind=k, city=c["i"], lonca=lo, workers=[], owner=None, capacity=CAP_OTHER, capitalized=False, seed=True)
            if KR_MEAS:
                lab_stamp(W, fname)
            c["firms"].append(fname)
            wc_need = working_capital(W, firms, people, fname, extra_workers=DOMESTIC_SEED)
            W.g = min(max(0.0, L.bal[f"{lo}_sermaye"] - dep_tot[lo]), wc_need)
            L.pay(f"{lo}_sermaye", fname, W.g, "sermaye")                  # lonca sermaye programı; eksik kalanı restaff'ta şehir kasasından tamamlanır
            L.flows["yerli_taban_firma_adet"] += 1


def phase_cycle_setup(W):
    """döngü öncesi şehir/firma sayaçları."""
    cities = W.cities
    firms = W.firms
    for c in cities:
        for p_ in list(c["imp_cum"]):
            c["imp_cum"][p_] *= 0.9                                   # K-133: ithalat hafızası (sönümlü; ithalatı biten ürün de unutulur)
        for p_, v_ in c["last_imports"].items():
            c["imp_cum"][p_] = c["imp_cum"].get(p_, 0.0) + v_
        c["last_demand"] = defaultdict(float)
        c["last_imports"] = defaultdict(float)
        c["last_output"] = defaultdict(float)
        c["last_sold"] = defaultdict(float)
        c["sold_units_prev"] = c["sold_units"]
        c["sold_units"] = 0.0
    W.n_live = defaultdict(int)                                   # (şehir, tür) -> canlı firmaların toplam kadrosu
    for f, d in firms.items():
        if d["workers"]:
            W.n_live[(d["city"], d["kind"])] += len(d["workers"])
    W.wage_fail = 0
    W.separations = 0
