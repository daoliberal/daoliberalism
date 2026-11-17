"""simkit.dao: DAO: kuruluş, adım, döngü, yer değiştirme, itibar.

ARAYÜZ: dao_found, dao_step, dao_cycle, rep_week, dao_reloc, orep_step
OKUR/YAZAR: W.dao_*, W.firms, W.people, W.L.
KATMAN: L5.
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from collections import defaultdict
import math
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.lab_meas import lab_ev, lab_stamp, human_cikis
from simkit.credit_core import lendable, LR_NEW, lt_damga, lt_devir
from simkit.dao_core import dao_weekly_cost, free_innovators, live_daos, pick_branch
from simkit.econ_core import isres, isrole
from simkit.fiscal import div_net, pay_div_tax, pay_holders, corp_tax_pay
from simkit.media import direct_ad
from simkit.wages import res_wage
from simkit.human import human_dao_onde


def dao_found(W, c, w, initial):
    KD = W.KD
    KDH = W.KDH
    KQ = W.KQ
    KQH = W.KQH
    L = W.L
    REP = W.REP
    closed = W.closed
    cx_stat = W.cx_stat
    dao_all = W.dao_all
    dao_info = W.dao_info
    firms = W.firms
    loans = W.loans
    loncas = W.loncas
    people = W.people
    pot_ema = W.pot_ema
    tech_events = W.tech_events
    ci = c["i"]
    wage2 = 2 * res_wage(W, ci)
    seed_need = DAO_SEED_WEEKS * CYCLES_PER_WEEK * (wage2 + ix(W, RENT))
    cand = [q for q in c["players"] if people[q].get("innov") and (not PATH_ACT or people[q].get("path") == "dao") and not people[q].get("dao_active") and not people[q].get("founder")
            and not isres(people[q]) and (initial or (ENTRY_OPEN and EO_NOREP_DAO) or REP[q] >= REP_DAO) and not (HUMAN_ON and q == W.human)]      # DAO oyunu: insan kendiliğinden DAO kurmaz
    if not cand:
        return False
    cand.sort(key=lambda q: (-REP[q], int(q.rsplit("p", 1)[1])))
    founder = cand[0]
    nmem = defaultdict(int)
    for m in live_daos(W):
        nmem[firms[m]["lonca"]] += 1
    opts = [lo for lo in loncas if lendable(W, lo) >= 0.5 * seed_need and lo not in closed]
    if not opts:
        return False
    lo = max(opts, key=lambda l: (pot_ema[l] / (nmem[l] + 1), lendable(W, l)))
    contrib = min(max(0.0, L.bal[founder] - 20.0), 0.5 * seed_need)
    loan = min(lendable(W, lo), seed_need - contrib)
    if loan + contrib < 0.6 * seed_need:
        return False
    name = f"s{ci}_arge{len(dao_all)}"
    firms[name] = dict(kind="arge", city=ci, lonca=lo, workers=[], owner=founder, capacity=DAO_TEAM, capitalized=True, born=w)
    if KR_MEAS:
        lab_stamp(W, name)                                           # davranışsız: firma türü kuruluşta bir kez
    KD[name] = {b_: 0.0 for b_ in BRANCHES}
    KDH[name] = []
    KQ[name] = {b_: 0.0 for b_ in BRANCHES}
    KQH[name] = []
    b, score = pick_branch(W, name, firms[name])
    firms[name]["branch"] = b
    firms[name]["branch_since"] = w
    dao_all.append(name)
    c["firms"].append(name)
    L.pay(f"{lo}_sermaye", name, loan, "kredi_verilen")
    rm = min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[founder] / 100)) if REP_EFFECT else 1.0
    loans[name] = dict(lo=lo, p0=loan, out=loan, miss=0, rate=(LR_NEW(W) if FZ_FIX else LOAN_RATE) * rm, tur="arge")
    if LONCA_TERMS:
        lt_damga(W, name, loans[name], loan)                         # REKABET G5: tek açılış damgası (faiz lo_oran, spread kayıtta); kredinin hangi loncadan alındığı (Ar-Ge seçim kuralı) değişmez
    if CX_ACT:
        L.flows["kredi_arge_kurulus_adet"] += 1
        cx_stat["hacim_arge_kurulus"] += loan
    L.pay(founder, name, contrib, "kurucu_sermayesi")
    old = people[founder]["firm"]
    if old:
        firms[old]["workers"].remove(founder)
        if KR_MEAS:
            lab_ev(W, "cikis_gecis", old)                            # davranışsız sayaç (§4.6)
    elif founder in c["seekers"]:
        c["seekers"].remove(founder)
    firms[name]["workers"].append(founder)
    if KR_MEAS:
        lab_ev(W, "ise", name)
    people[founder].update(firm=name, res=name, dao_active=True, dao_founder=True, avans=True, wage=res_wage(W, ci))
    dao_info[name] = dict(city=ci, born=w, lonca=lo, founder=founder, peak=1, branches=[b], initial=initial)
    L.flows["dao_kurulus_adet"] += 1
    tech_events.append(f"hafta {w}: Ar-Ge DAO {name} kuruldu (şehir {ci}, {lo}, dal {b}, kurucu {founder}, itibar {REP[founder]:.1f})")
    return True


def dao_step(W, w):
    # 1) lonca sahipleri (K-167: sahip bir oyuncu; K-73 yalnız sahipsiz loncalar için)
    HW_STATE = W.HW_STATE
    KD = W.KD
    KDH = W.KDH
    KQ = W.KQ
    KQH = W.KQH
    L = W.L
    MODA_STATE = W.MODA_STATE
    PUB = W.PUB
    REP = W.REP
    RWI = W.RWI
    SW_STATE = W.SW_STATE
    TOUR_STATE = W.TOUR_STATE
    ad_stat = W.ad_stat
    cities = W.cities
    closed = W.closed
    dao_all = W.dao_all
    dao_info = W.dao_info
    dao_pay = W.dao_pay
    eq_by = W.eq_by
    eq_cap = W.eq_cap
    firms = W.firms
    last_dao_death = W.last_dao_death
    loans = W.loans
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    neg = W.neg
    pay_w = W.pay_w
    people = W.people
    rival_done = W.rival_done
    tech_events = W.tech_events
    if w >= OWNER_WEEK:
        taken = {v[0] for v in lonca_owner.values()}
        for lo in loncas:
            if lo in lonca_owner or lo in closed:
                continue
            ci = int(lo[5:]) % len(cities)
            cand = [q for q in cities[ci]["players"] if REP[q] >= REP_OWNER and q not in taken and not people[q].get("dao_active") and not (HUMAN_ON and q == W.human)]      # DAO oyunu: insan kendiliğinden lonca sahibi olmaz
            if cand:
                q = max(cand, key=lambda x: (REP[x], -int(x.rsplit("p", 1)[1])))
                lonca_owner[lo] = (q, w)
                taken.add(q)
                people[q]["lonca_owner"] = lo
                L.flows["lonca_sahipligi_adet"] += 1
                tech_events.append(f"hafta {w}: {lo} sahibi {q} oldu (itibar {REP[q]:.1f})")
    for n in live_daos(W):                                         # kurucu ücret alamayıp ayrıldıysa DAO en itibarlı araştırmacıya devredilir
        d = firms[n]
        if d["workers"] and d["owner"] not in d["workers"]:
            if HUMAN_ON and all(x == W.human for x in d["workers"]):
                continue                                           # DAO oyunu: insan DAO'yu devralmaz; aday yoksa devir olmaz
            old_o = d["owner"]
            if old_o in people:
                people[old_o]["dao_active"] = False
                neg[old_o] += REP_BANKRUPT
            new_o = max((x for x in d["workers"] if not (HUMAN_ON and x == W.human)), key=lambda x: REP[x])      # DAO oyunu: insan devralmaz
            d["owner"] = new_o
            people[new_o]["dao_active"] = True
            people[new_o]["dao_founder"] = True
            L.flows["dao_devir_adet"] += 1
    # 2) DAO kuruluşu
    if w >= DAO_START:
        for c in cities:
            ci = c["i"]
            ever = sum(1 for n in dao_all if firms[n]["city"] == ci)
            alive = sum(1 for n in live_daos(W) if firms[n]["city"] == ci)
            if alive < DAO_PER_CITY and w - last_dao_death[ci] >= DAO_COOL:
                dao_found(W, c, w, initial=(ever < DAO_PER_CITY))
    # 3) kadro, dal, dağıtım
    for ci_ in range(len(cities)):
        unmet = 0
        for n in live_daos(W):
            d = firms[n]
            if d["city"] != ci_:
                continue
            b = d["branch"]
            KD[n][b] = max(KD[n][b], PUB[b])
            if w - d["branch_since"] >= 26:
                nb, score = pick_branch(W, n, d)
                if nb != b and score(nb) > 1.5 * score(b):
                    d["branch"], d["branch_since"] = nb, w
                    dao_info[n]["branches"].append(nb)
                    KD[n][nb] = max(KD[n][nb], PUB[nb])
                    tech_events.append(f"hafta {w}: {n} dal değiştirdi {b} -> {nb}")
            # işe alma / çıkarma
            cost_now = dao_weekly_cost(W, n)
            wnew = res_wage(W, ci_)
            if KR_MEAS or HUMAN_ON:
                W.staff_tgt[n] = max(len(d["workers"]), d["capacity"]) if L.bal[n] >= DAO_HIRE_RUNWAY * dao_weekly_cost(W, n, wnew) else len(d["workers"])      # davranışsız kayıt (§4.6)
            if len(d["workers"]) > 1 and L.bal[n] < DAO_FIRE_RUNWAY * cost_now:
                cands = [q for q in d["workers"] if q != d["owner"]]
                q = min(cands, key=lambda x: REP[x])
                d["workers"].remove(q)
                if KR_MEAS:
                    lab_ev(W, "cikis_dao", n)                        # davranışsız sayaç (§4.6)
                people[q]["firm"] = None
                if HUMAN_ON:
                    human_cikis(W, q, "kucultme")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
                cities[ci_]["seekers"].append(q)
                L.flows["arastirmaci_cikarma_adet"] += 1
            elif len(d["workers"]) < d["capacity"] and L.bal[n] >= DAO_HIRE_RUNWAY * dao_weekly_cost(W, n, wnew):
                fi = free_innovators(W, ci_)
                if HUMAN_ON:
                    fi = human_dao_onde(W, n, fi)                    # DAO oyunu: insan yalnız başvurduğu Ar-Ge DAO'suna alınır (free_innovators onu dışlar)
                if fi:
                    q = fi[0]
                    old = people[q]["firm"]
                    if old:
                        firms[old]["workers"].remove(q)
                        if KR_MEAS:
                            lab_ev(W, "cikis_is_degistirme" if (HUMAN_ON and q == W.human) else "cikis_gecis", old)            # davranışsız sayaç (§4.6); insanın iş değiştirmesi ayrı sebep
                    elif q in cities[ci_]["seekers"]:
                        cities[ci_]["seekers"].remove(q)
                    d["workers"].append(q)
                    if KR_MEAS:
                        lab_ev(W, "ise", n)
                    people[q].update(firm=n, res=n, avans=True, wage=wnew)
                    dao_info[n]["peak"] = max(dao_info[n]["peak"], len(d["workers"]))
                    L.flows["arastirmaci_alim_adet"] += 1
                else:
                    unmet += 1
            # kâr dağıtımı
            cost_now = dao_weekly_cost(W, n)
            surplus = L.bal[n] - DAO_SURPLUS_WEEKS * cost_now - (loans[n]["out"] if n in loans else 0.0) - (EQ_KEEP * eq_cap[n] if EQ_ACT else 0.0)
            if DA_ACT and w >= AD_START and surplus > 0 and not (n in loans and loans[n]["miss"] > 0):
                pad_ = direct_ad(W, n, AD_DAO * surplus)                     # K-183.5: DAO fazlasının bir kısmı doğrudan reklama
                ad_stat["dao"] += pad_
                surplus -= pad_
            if surplus > 0 and not (n in loans and loans[n]["miss"] > 0):
                pay = DAO_PAYOUT * surplus
                pay = corp_tax_pay(L, n, cities[ci_]["acct"], pay)          # K-188
                pay_div_tax(L, n, cities[ci_]["acct"], pay)
                net = div_net(pay)
                if EQ_ACT:
                    pay_w[n] += pay
                    if n in eq_by:
                        net = pay_holders(L, n, eq_by[n], net)
                others = [q for q in d["workers"] if q != d["owner"]]
                f_share = DAO_FOUNDER if others else 1.0
                got = L.pay(n, d["owner"], net * f_share, "dao_payi")
                for q in others:
                    got += L.pay(n, q, net * (1 - f_share) / len(others), "dao_payi")
                dao_pay[n] += got
        idle = sum(1 for q in cities[ci_]["seekers"] if people[q].get("innov"))
        if unmet > 0:
            RWI[ci_] = min(RWI_MAX, RWI[ci_] * (1 + RWI_STEP))
        elif idle > 0:
            RWI[ci_] = max(RWI_MIN, RWI[ci_] * (1 - RWI_STEP))
    # 4) ürün inovasyonu: aynı ürünü birden fazla DAO kendi tasarımıyla açabilir (rakip tasarım = ikinci üretici firma)
    for st, kd_, br_, th_ in ((MODA_STATE, "moda", "tekstil", MODA_UNLOCK), (HW_STATE, "bilgisayar", "malzeme", HW_UNLOCK), (SW_STATE, "yazilim", "malzeme", SW_UNLOCK), (TOUR_STATE, "otel", "tekstil", TOUR_UNLOCK)):
        if not st["on"]:
            continue
        for n in live_daos(W):
            d = firms[n]
            if KD[n][br_] >= th_ and (n, kd_) not in rival_done and not any(firms[f_]["kind"] == kd_ and not firms[f_].get("dead") for f_ in cities[d["city"]]["firms"]):
                rival_done.add((n, kd_))
                fname = f"s{d['city']}_{kd_}_rv{len(rival_done)}"
                firms[fname] = dict(kind=kd_, city=d["city"], lonca=d["lonca"], workers=[], owner=None, capacity=CAP_OTHER, capitalized=False, seed=True)
                if KR_MEAS:
                    lab_stamp(W, fname)
                cities[d["city"]]["firms"].append(fname)
                L.flows["rakip_urun_firmasi_adet"] += 1
                tech_events.append(f"hafta {w}: {n} kendi tasarımıyla {kd_} açtı (rakip ürün firması {fname})")
    for n in live_daos(W):
        KDH[n].append(dict(KD[n]))
        if QL_ACT:
            KQH[n].append(dict(KQ[n]))


def dao_cycle(W):
    """K-167: araştırmacı ücreti = Ar-Ge harcaması; birikmiş Ar-Ge ödenen ücretle orantılı (geride kalan DAO biraz daha verimli yetişir)."""
    FRONT = W.FRONT
    FRONTQ = W.FRONTQ
    KD = W.KD
    KQ = W.KQ
    L = W.L
    cities = W.cities
    dao_info = W.dao_info
    firms = W.firms
    kcity = W.kcity
    kw = W.kw
    people = W.people
    res_spent = W.res_spent
    role_list = W.role_list
    tech_events = W.tech_events
    w_ctx = W.w_ctx
    if LIFE_ACT:
        for f_, d_ in firms.items():
            if d_["workers"] and not d_.get("dead") and d_["kind"] in ("restoran", "eglence", "kuyumcu", "maden_altin", "insaat", "otel", "moda", "ulasim"):
                kw[d_["kind"]] += sum(people[q_]["wage"] for q_ in d_["workers"])
                kcity[(d_["kind"], d_["city"])] += len(d_["workers"])
    for q in role_list:
        i_ = people[q]
        if isrole(i_):
            L.pay(q, cities[i_["city"]]["acct"], ROLE_TAX * i_["wage"], "gelir_vergisi")
    for n in live_daos(W):
        d = firms[n]
        if not d["workers"]:
            continue
        spent = sum(people[q]["wage"] for q in d["workers"])
        for q in d["workers"]:
            L.pay(q, cities[d["city"]]["acct"], RES_TAX * people[q]["wage"], "gelir_vergisi")
        b = d["branch"]
        gap = max(0.0, 1.0 - KD[n][b] / FRONT[b]) if FRONT[b] > 0 else 0.0
        if QL_ACT and d.get("path") == "urun":
            gq_ = max(0.0, 1.0 - KQ[n][b] / FRONTQ[b]) if FRONTQ[b] > 0 else 0.0
            KQ[n][b] += RES_EFF * spent * (1.0 + CATCHUP * gq_)             # K-183.3: ürün Ar-Ge'si (kalite) yolu
        else:
            KD[n][b] += RES_EFF * spent * (1.0 + CATCHUP * gap)
        res_spent[n] += spent
        if "patent" not in dao_info[n] and KD[n][b] >= 500.0:
            dao_info[n]["patent"] = (w_ctx[0], b)
            L.flows["patent_kaydi_adet"] += 1
            tech_events.append(f"hafta {w_ctx[0]}: patent kaydı {n} dal {b} (düzey {KD[n][b]:,.0f})")


def rep_week(W, w):
    """K-11: kişi itibarı: çalışılan hafta + kesilen fiş + tutulan söz - cezalar (sönümlü)."""
    L = W.L
    REP = W.REP
    firms = W.firms
    fis_acc = W.fis_acc
    inc_ema = W.inc_ema
    neg = W.neg
    people = W.people
    player_firms = W.player_firms
    soz_acc = W.soz_acc
    wf_week = W.wf_week
    worked = W.worked
    for n, k in list(wf_week.items()):
        o = firms[n]["owner"]
        if o in people and k:
            neg[o] += REP_WF * k
            L.flows["itibar_olayi_adet"] += 1
    for fname in list(player_firms) + live_daos(W):
        d = firms[fname]
        o = d["owner"]
        if o in people and d["workers"] and wf_week.get(fname, 0) == 0:
            fis_acc[o] += len(d["workers"])
    wf_week.clear()
    for q, info in people.items():
        if info["who"] != "oyuncu":
            continue
        neg[q] *= 1.0 - REP_DECAY
        REP[q] = max(0.0, min(100.0, REP_WORK_CAP * (1.0 - math.exp(-worked[q] / CYCLES_PER_WEEK / REP_WORK_TAU)) + min(REP_FIS_CAP, REP_FIS_RATE * fis_acc[q])
                             + min(REP_SOZ_CAP, REP_SOZ_RATE * soz_acc[q]) - neg[q]))
        inc_ema[q] = 0.9 * inc_ema[q] + 0.1 * L.income.get(q, 0.0)


def dao_reloc(W, w):
    """K-176: DAO'lar lonca seçimini gözden geçirir (kişi başına sözleşme geliri: lonca Ar-Ge fonu / üye DAO); yerleşik lonca DAO kaybedince Ar-Ge payını artırır."""
    L = W.L
    arge_boost = W.arge_boost
    closed = W.closed
    dao_info = W.dao_info
    firms = W.firms
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    orep = W.orep
    pot_ema = W.pot_ema
    if not NL_ACT:
        return
    nd = defaultdict(int)
    for n in live_daos(W):
        nd[firms[n]["lonca"]] += 1
    for n in live_daos(W):
        d = firms[n]
        if lonca_owner.get(d["lonca"], (None,))[0] == d["owner"]:
            continue
        if (w + int(n.rsplit("arge", 1)[1])) % DAO_RELOC_EVERY or w - d.get("reloc_last", -999) < 2 * DAO_RELOC_EVERY or w < OWNER_WEEK:
            continue
        cur = d["lonca"]
        alive_l = [l for l in loncas if l not in closed]
        val = lambda l: pot_ema[l] * (1.0 + arge_boost[l]) * (1.0 + (ORG_DAO_W * orep.get(l, 0.0) / 100.0 if ORG_ACT else 0.0)) / (nd[l] + (0 if l == cur else 1))
        bl = max(alive_l, key=lambda l: (val(l), l))
        if bl != cur and val(bl) > DAO_RELOC_GAIN * val(cur):
            nd[cur] -= 1
            nd[bl] += 1
            d["lonca"] = bl
            dao_info[n]["lonca"] = bl
            d["reloc_last"] = w
            if LONCA_TERMS and n in W.loans:
                lt_devir(W, n, bl, w, say_kalan=True)                    # REKABET G5 (Y2): üye değişiminde borç devri lonca_gecis ile aynı kuralla
            L.flows["dao_lonca_gecisi_adet"] += 1
            if cur not in closed:
                arge_boost[cur] = min(ARGE_BOOST_MAX, arge_boost[cur] + ARGE_BOOST)


def orep_step(W, w):
    """K-180: kurum itibarı (0-100). Lonca: reklam birikimi (üye başına, aşınır), ödenen gider/ücret, yaş, üye sahiplerinin kişi itibarı. Firma/DAO: ücret ve söz kaydı, yaş, sahibin kişi itibarı, başarı (DAO: telif/patent; firma: girdi temini)."""
    L = W.L
    REP = W.REP
    ad_stock = W.ad_stock
    ad_w = W.ad_w
    closed = W.closed
    dao_info = W.dao_info
    dao_tel = W.dao_tel
    firms = W.firms
    lo_stress = W.lo_stress
    lonca_info = W.lonca_info
    loncas = W.loncas
    orep = W.orep
    orep_hist = W.orep_hist
    people = W.people
    player_firms = W.player_firms
    wf_week = W.wf_week
    wfail_ema = W.wfail_ema
    if not ORG_ACT:
        return
    for lo in loncas:
        if lo in closed:
            orep.pop(lo, None)
            ad_stock[lo] = 0.0
            continue
        ad_stock[lo] = ORG_AD_DECAY * ad_stock[lo] + ad_w[lo]
        ad_w[lo] = 0.0
        members = [d for d in firms.values() if d["lonca"] == lo and not d.get("dead") and d["workers"] and d["kind"] not in ("belediye", "arge", "ahir")]
        mq = [REP[d["owner"]] / 100.0 for d in members if d["owner"] in people]
        ad_t = 1.0 - math.exp(-(ad_stock[lo] / max(1, len(members))) / ORG_AD_SAT)
        st0 = lonca_info[lo]["start"] if (NL_ACT and lo in lonca_info) else 0
        tgt = 100.0 * (0.35 * ad_t + 0.25 * (1.0 - min(1.0, lo_stress[lo])) + 0.2 * (1.0 - math.exp(-(w - st0) / 104.0)) + 0.2 * (sum(mq) / len(mq) if mq else 0.5))
        old = orep.get(lo)
        orep[lo] = tgt * 0.3 if old is None else 0.9 * old + 0.1 * tgt
    for f, d in firms.items():
        if d.get("dead") or d["kind"] in ("belediye", "ahir") or not d["workers"]:
            orep.pop(f, None)
            continue
        wfail_ema[f] = 0.9 * wfail_ema[f] + 0.1 * (1.0 if wf_week.get(f, 0) > 0 else 0.0)
        age = 1.0 - math.exp(-(w - d.get("born", 0)) / 104.0)
        own = REP[d["owner"]] / 100.0 if d["owner"] in people else 0.5
        if d["kind"] == "arge":
            avg_t = dao_tel[f] / max(1, w - d.get("born", 0))
            succ = min(1.0, (0.3 if "patent" in dao_info[f] else 0.0) + 0.7 * min(1.0, avg_t / ORG_TEL_REF))
        else:
            succ = (d.get("life_ok", 0.0) / d["life_n"]) if d.get("life_n", 0) > 0 else 0.5
        ad_stock[f] = ORG_AD_DECAY * ad_stock[f] + ad_w[f]
        ad_w[f] = 0.0
        tgt = 100.0 * (0.25 * (1.0 - wfail_ema[f]) + 0.15 * age + 0.2 * own + 0.2 * succ + 0.2 * (1.0 - math.exp(-ad_stock[f] / ORG_AD_SAT)))
        if QL_ACT and "q" in d:
            tgt += 100.0 * QREP_W * (d["q"] - QDEF)                  # K-183.3: kaliteli ürün itibarı artırır, kaliteyi düşüren itibar kaybeder
        old = orep.get(f)
        new = tgt * 0.5 if old is None else 0.9 * old + 0.1 * tgt
        if old is not None:
            for th in (25.0, 50.0, 75.0):
                if (old < th) != (new < th):
                    L.flows["orep_olay_adet"] += 1
                    L.flows["orep_olay_yukari" if new >= th else "orep_olay_asagi"] += 1
        orep[f] = new
    if w % 10 == 0:
        vals = lambda ks: [orep[k] for k in ks if k in orep]
        lo_ = vals([l for l in loncas if l not in closed])
        da_ = vals(live_daos(W))
        fi_ = vals([f for f in player_firms if not firms[f].get("dead")])
        mk_ = vals([f for f, d in firms.items() if d["kind"] == "market" and not d.get("dead")])
        orep_hist.append((w, sum(lo_) / max(1, len(lo_)), sum(da_) / max(1, len(da_)), sum(fi_) / max(1, len(fi_)), sum(mk_) / max(1, len(mk_)), (max(lo_) - min(lo_)) if lo_ else 0.0))
