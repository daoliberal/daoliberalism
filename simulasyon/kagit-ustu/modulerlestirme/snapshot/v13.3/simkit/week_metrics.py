"""simkit.week_metrics: hafta sonu göstergeler ve haftalık kayıt.

ARAYÜZ: phase_metrics, phase_gates, phase_close
OKUR/YAZAR: W.
KATMAN: L7.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import lendable, lendable_cash
from simkit.measure import measure_week
from simkit.sector_board import board_update
from simkit.dao_core import live_daos
from simkit.econ_core import isrole
from simkit.firm_exit import liq_settle
from simkit.firms import capex_plan
from simkit.households import health_settle, mkt_val
from simkit.tech_core import tech_f


def phase_metrics(W, w, weeks):
    """hafta sonu göstergeler: dağılım, gini, sepet, seriler."""
    L = W.L
    REP = W.REP
    RM = W.RM
    cities = W.cities
    closed = W.closed
    dao_all = W.dao_all
    dao_tel = W.dao_tel
    dep_ema = W.dep_ema
    dep_tot = W.dep_tot
    deposits = W.deposits
    eq_by = W.eq_by
    eq_px = W.eq_px
    firms = W.firms
    flow_prev = W.flow_prev
    green = W.green
    grp_stat = W.grp_stat
    house_ts = W.house_ts
    hratio = W.hratio
    hs = W.hs
    hst = W.hst
    jval = W.jval
    lic_cur = W.lic_cur
    lic_hist = W.lic_hist
    loans = W.loans
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    mem_hist = W.mem_hist
    new_slots = W.new_slots
    own = W.own
    people = W.people
    tech_paths = W.tech_paths
    FEES = W.FEES
    FRONT = W.FRONT
    HW_STATE = W.HW_STATE
    LAND = W.LAND
    MWI = W.MWI
    REF = W.REF
    RENT_CY = W.RENT_CY
    TOPO = W.TOPO
    W.is_player = lambda k: k in people and people[k]["who"] == "oyuncu"
    W.is_npc = lambda k: k in people and people[k]["who"] == "npc"
    W.is_firm = lambda k: k in firms or k.endswith('_yenileme')
    W.is_lonca = lambda k: k in loncas or k.endswith("_sermaye") or k.endswith("_refah") or k.endswith("_rezerv")
    W.is_city = lambda k: k in L.city_accounts
    W.g = lambda pred: sum(v for k, v in L.bal.items() if pred(k))
    W.dg = lambda pred: sum(L.bal[k] - W.start_bal.get(k, 0.0) for k in sorted(set(L.bal) | set(W.start_bal)) if pred(k))
    W.per_city = []
    for c in cities:
        in_ahir = sum(len(firms[f]["workers"]) for f in c["firms"] if firms[f]["kind"] == "ahir")
        in_pf = sum(len(firms[f]["workers"]) for f in c["firms"] if firms[f]["owner"] is not None and firms[f]["kind"] != "arge")
        in_res = sum(len(firms[f]["workers"]) for f in c["firms"] if firms[f]["kind"] == "arge")
        in_muni = len(firms[f"s{c['i']}_belediye0"]["workers"])
        npc_emp = sum(1 for f in c["firms"] for q in firms[f]["workers"] if people[q]["who"] == "npc")
        W.per_city.append(dict(rep=c["rep"], in_ahir=in_ahir, in_npc=max(0, len(c["players"]) - in_ahir - in_pf - in_res - len(c["seekers"]) - in_muni), in_res=in_res, in_muni=in_muni,
                             in_pf=in_pf, seekers=len(c["seekers"]), npc_emp=npc_emp, pool=len(c["pool"]),
                             pfirms=sum(1 for f in c["firms"] if firms[f]["owner"] is not None and firms[f]["kind"] != "arge"),
                             imp=c["imp_val"], exp=c["exp_val"], met=c["got_units"] / max(1e-9, c["dem_units"]),
                             unpaid=c["unpaid_w"], paid=c["paid_w"], bal=L.bal[c["acct"]]))
    hown = defaultdict(float)
    for ci_, od_ in own.items():
        for q_, u_ in od_.items():
            hown[q_] += u_ * RENT_CY[ci_] * CYCLES_PER_WEEK / HOUSE_YIELD * (hratio[ci_] if HI_ACT else 1.0)
    eqv_ = defaultdict(float)
    if EQ_ACT:
        for f_, hh_ in eq_by.items():
            for inv_, h_ in hh_.items():
                eqv_[inv_] += h_["share"] * eq_px[f_]
    pw = sorted(L.bal[p] + (deposits[p][1] if p in deposits else 0.0) + hown.get(p, 0.0) + (mkt_val(W, p) if RESALE_ACT else jval.get(p, 0.0)) + (eqv_.get(p, 0.0) if EQ_ACT else 0.0) for p in people if people[p]["who"] == "oyuncu")
    tw = sum(pw) or 1.0
    gini = sum((2 * (i + 1) - len(pw) - 1) * v for i, v in enumerate(pw)) / (len(pw) * tw)
    top10 = sum(pw[int(len(pw) * 0.9):]) / tw
    top1_w, med_w = sum(pw[int(len(pw) * 0.99):]) / tw, pw[len(pw) // 2]
    iw = sorted(L.income.get(p, 0.0) for p in people if people[p]["who"] == "oyuncu")
    ti = sum(iw) or 1.0
    gini_inc = sum((2 * (i + 1) - len(iw) - 1) * v for i, v in enumerate(iw)) / (len(iw) * ti)
    top10_inc = sum(iw[int(len(iw) * 0.9):]) / ti
    kinds_all = [k for k in TOPO if k != "ahir"] + ["market", "medya"]
    dist = []
    for c in cities:
        emp = defaultdict(float)
        for f in c["firms"]:
            emp[firms[f]["kind"]] += len(firms[f]["workers"])
        tot_e = sum(emp.values()) or 1.0
        dist.append([emp[k] / tot_e for k in kinds_all])
    spec = (sum(sum(abs(a - b) for a, b in zip(dist[i], dist[j])) / 2 for i in range(len(dist)) for j in range(i + 1, len(dist)))
            / max(1, len(dist) * (len(dist) - 1) // 2))
    base_basket = sum(REF[p] * q for p, q in BASKET.items())
    pidx = sum(sum(LAND[(ci, p)] * q for p, q in BASKET.items()) for ci in range(len(cities))) / len(cities) / base_basket * 100
    dep_n = []                                                  # K-133: şehirde canlı üretimi olmayan (tamamen ithalata bağımlı) ürün türü sayısı
    for c in cities:
        live = {firms[f]["kind"] for f in c["firms"] if firms[f]["workers"]}
        dep_n.append(sum(1 for k in TOPO if k not in ("ahir", "yazilim", "otel", "elektronik", "bilgisayar", "moda", "maden_altin") and k not in live))
    bidx = {b_: sum(sum(LAND[(ci, PROD_OF[k_])] / REF[PROD_OF[k_]] for ci in range(len(cities))) / len(cities) for k_ in BRANCH if BRANCH[k_] == b_ and k_ in PROD_OF) / max(1, sum(1 for k_ in BRANCH if BRANCH[k_] == b_ and k_ in PROD_OF)) * 100 for b_ in BRANCHES}
    W.series = dict(top1_w=top1_w, med_w=med_w, hw_on=HW_STATE["on"], bidx=bidx, front={b_: tech_f(b_, FRONT[b_]) for b_ in BRANCHES}, green=green[0], dep=sum(dep_n) / len(dep_n), dep_max=max(dep_n), pidx=pidx, gini=gini, top10=top10, gini_inc=gini_inc, top10_inc=top10_inc, spec=spec,
                  employed=sum(len(d["workers"]) for d in firms.values()),
                  emp_npc=sum(1 for d in firms.values() for q in d["workers"] if people[q]["who"] == "npc"),
                  seekers=sum(len(c["seekers"]) for c in cities),
                  dem=sum(c["dem_units"] for c in cities), got=sum(c["got_units"] for c in cities),
                  imp=sum(c["imp_val"] for c in cities), cons=sum(c["cons_val"] for c in cities),
                  treasury=sum(L.bal[c["acct"]] for c in cities), rep=sum(c["rep"] for c in cities) / len(cities))
    if INNOV_ON:
        fl = lambda k_: L.flows[k_] - flow_prev[k_]
        lv = live_daos(W)
        nres = sum(len(firms[n]["workers"]) for n in lv)
        W.series["inn"] = dict(dao=len(lv), res=nres, ever=len(dao_all), telif=fl("telif_uye") + fl("telif_dis"), telif_uye=fl("telif_uye"), contract=fl("arge_sozlesmesi"),
                             resw=fl("arastirmaci_ucreti"), wages=fl("ucret") + fl("arastirmaci_ucreti"), repm=sum(REP[q] for q in people if people[q]["who"] == "oyuncu") / max(1, sum(1 for q in people if people[q]["who"] == "oyuncu")),
                             owners=len(lonca_owner),
                             mgr=sum(1 for q_, i_ in people.items() if i_["who"] == "oyuncu" and isrole(i_) and i_.get("role") == "yonetici"),
                             spec=sum(1 for q_, i_ in people.items() if i_["who"] == "oyuncu" and isrole(i_) and i_.get("role") == "uzman"),
                             mwi=MWI[0], fees=dict(FEES))
        for k_ in ("telif_uye", "telif_dis", "arge_sozlesmesi", "arastirmaci_ucreti", "ucret"):
            flow_prev[k_] = L.flows[k_]
        if HOUSE_ON and (w % 10 == 0 or w == weeks):
            hrow = {}
            for c_ in cities:
                ci_ = c_["i"]
                ur_ = RENT_CY[ci_] * CYCLES_PER_WEEK
                pr_ = ur_ / HOUSE_YIELD
                hrow[ci_] = dict(prim=pr_, px=pr_ * (hratio[ci_] if HI_ACT else 1.0), rent=ur_, RM=RM[ci_], owners=sum(1 for u_ in own[ci_].values() if u_ > 0.5), units=sum(own[ci_].values()), hs=hs[ci_],
                                 top10=(sum(sorted(own[ci_].values(), reverse=True)[:10]) / max(1.0, sum(own[ci_].values()))))
            dh_ = [am_ for lo_, am_ in deposits.values() if am_ > 1e-9]
            house_ts.append((w, hrow, dict(sec_n=hst["sec_n"], sec_vol=hst["sec_vol"], pri_n=hst["pri_n"], build_n=hst["build_n"]), dict(n=len(dh_), tot=sum(dh_), rate=sum(dep_ema[l_] * dep_tot[l_] for l_ in loncas) / max(1e-9, sum(dep_tot[l_] for l_ in loncas)), loans=sum(l_["out"] for l_ in loans.values())),
                             dict(top1=top1_w, med=med_w, gini=gini, top10=top10)))
        if NL_ACT and (w % 10 == 0 or w == weeks):
            gs_ = {"yerleşik": dict(mem=0, fee=0.0, nl=0, dao=0), "girişimci": dict(mem=0, fee=0.0, nl=0, dao=0)}
            for l_ in loncas:
                if l_ in closed:
                    continue
                g_ = gs_["girişimci" if l_ in new_slots else "yerleşik"]
                g_["mem"] += sum(1 for d_ in firms.values() if d_["lonca"] == l_ and d_["workers"] and not d_.get("dead") and d_["kind"] not in ("belediye", "arge", "ahir"))
                g_["fee"] += FEES.get(l_, LONCA_FEE)
                g_["nl"] += 1
                g_["dao"] += sum(1 for n_ in live_daos(W) if firms[n_]["lonca"] == l_)
            grp_stat.append((w, gs_, {l_: dao_tel[W.n_] for l_ in []}))
        if w % 10 == 0 or w == weeks:
            lic_hist.append((w, dict(lic_cur), dict(tech_paths)))
            cnt = defaultdict(int)
            for d_ in firms.values():
                if d_["workers"] and not d_.get("dead") and d_["kind"] not in ("belediye", "ahir", "arge"):
                    cnt[d_["lonca"]] += 1
            mem_hist.append((w, dict(cnt)))


def phase_gates(W, w, weeks):
    """25 haftalık pencere kapı toplamları (tanı)."""
    INV_ON = W.INV_ON
    L = W.L
    bonds = W.bonds
    chain_sh = W.chain_sh
    cities = W.cities
    closed = W.closed
    cons_ts = W.cons_ts
    dep_tot = W.dep_tot
    firms = W.firms
    gate = W.gate
    inv_ts = W.inv_ts
    loans = W.loans
    loncas = W.loncas
    npcpov = W.npcpov
    people = W.people
    player_firms = W.player_firms
    pol = W.pol
    prod_w = W.prod_w
    short_units = W.short_units
    want_units = W.want_units
    LAND = W.LAND
    PM = W.PM
    PRICE = W.PRICE
    REF = W.REF
    _sl2 = w // 25 * 25
    for p_ in PRODUCER:
        if want_units.get(p_, 0.0) > 1e-9:
            rec_ = chain_sh[(_sl2, p_)]
            rec_[0] += short_units.get(p_, 0.0)
            rec_[1] += want_units[p_]
            rec_[2] += sum(prod_w.get((ci_, p_), 0.0) for ci_ in range(len(cities)))
            rec_[3] += sum(PM[(ci_, p_)] for ci_ in range(len(cities))) / len(cities)
            rec_[4] += sum(LAND[(ci_, p_)] / max(1e-9, PRICE[(ci_, p_)]) for ci_ in range(len(cities))) / len(cities)
            rec_[5] += short_units.get(p_, 0.0) * REF[p_]
            rec_[6] += 1
    if INV_ON and (w % 25 == 0 or w == weeks):
        tot_ = defaultdict(float)
        for f_, d_ in firms.items():
            for p_, q_ in d_.get("stock", {}).items():
                tot_[p_] += q_ * REF[p_]
            for p_, q_ in d_.get("istock", {}).items():
                tot_["girdi:" + p_] += q_ * REF[p_]
        inv_ts.append((w, dict(tot_), W.series["cons"]))
    if w % 10 == 0 or w == weeks:
        npc_pool_cash = sum(L.bal[q] for c_ in cities for q in c_["pool"])
        npc_all = sum(L.bal[q] for q, i_ in people.items() if i_["who"] == "npc")
        pl_all = sum(L.bal[q] for q, i_ in people.items() if i_["who"] == "oyuncu")
        cons_ts.append((w, L.total(), npc_pool_cash, npc_all, pl_all, W.series["cons"], npcpov[0] / max(1, npcpov[1]), sum(len(c_["pool"]) for c_ in cities)))
        npcpov[0] = npcpov[1] = 0
    _g = w // 25 * 25
    gate[(_g, "haf_n")] += 1
    gate[(_g, "kok_eksik_deg")] += sum(W.last_root_short_val.values())
    gate[(_g, "pm_ort")] += sum(PM.values()) / max(1, len(PM))
    gate[(_g, "havuz_nakit")] += sum(L.bal[f"{l_}_sermaye"] for l_ in loncas if l_ not in closed)
    gate[(_g, "havuz_lendable_cash")] += sum(lendable_cash(W, l_) for l_ in loncas if l_ not in closed)
    gate[(_g, "havuz_lendable")] += sum(lendable(W, l_) for l_ in loncas if l_ not in closed)
    gate[(_g, "mevduat")] += sum(dep_tot[l_] for l_ in loncas)
    gate[(_g, "kredi_acik")] += sum(l_["out"] for l_ in loans.values())
    gate[(_g, "tahvil_acik")] += sum(b_["out"] for b_ in bonds)
    gate[(_g, "pol_faiz")] += (pol[0] or 0.0)
    gate[(_g, "oyuncu_firma_canli")] += sum(1 for f_ in player_firms if not firms[f_].get("dead"))
    gate[(_g, "issiz_nakit_100plus")] += sum(1 for c_ in cities for q_ in c_["seekers"] if L.bal[q_] > 100)
    gate[(_g, "issiz_nakit_toplam")] += sum(L.bal[q_] for c_ in cities for q_ in c_["seekers"])
    gate[(_g, "issiz_n")] += sum(len(c_["seekers"]) for c_ in cities)


def phase_close(W, w):
    """hafta kapanışı: sağlık/capex planı, likidite, haftalık kayıt."""
    L = W.L
    LIQ_ON = W.LIQ_ON
    firms = W.firms
    missed = W.missed
    player_firms = W.player_firms
    weekly = W.weekly
    health_settle(W)
    capex_plan(W, w)
    if LIQ_ON:
        liq_settle(W, w)
    if SECTOR_BOARD:
        board_update(W)                         # K-212: sektör panosu (hafta sonu; ertesi hafta kararları okur)
    if W.cm is not None:                        # K-218: kredi parası haftalık kayıt
        W.cm.end_week(w)
    elif W.cm_obs is not None:                  # K-218 ölçüm gözlemcisi (bayrak kapalı)
        W.cm_obs.end_week(w)
    measure_week(W, w)                          # PX: ölçüm kancası (WEEKLY_CSV/SECDUMP/...; kapalıyken işlem yok)
    weekly.append(dict(series=W.series, week=w, wage_fail=W.wage_fail, separations=W.separations, players=W.g(W.is_player), npcs=W.g(W.is_npc), firms=W.g(W.is_firm),
                       loncas=W.g(W.is_lonca), cities=W.g(W.is_city), minted=L.minted, mint_w=L.minted - W.start_minted,
                       d_players=W.dg(W.is_player), d_npcs=W.dg(W.is_npc), d_firms=W.dg(W.is_firm), d_loncas=W.dg(W.is_lonca), d_cities=W.dg(W.is_city),
                       missed=sum(missed.values()), per_city=W.per_city, events=L.events[W.ev0:],
                       pfirms=len(player_firms), in_pf=sum(len(firms[f]["workers"]) for f in player_firms)))
