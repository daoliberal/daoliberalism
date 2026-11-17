"""simkit.week_cycle_parts: haftanın bir döngüsünün (CYCLES_PER_WEEK) fazları: açılış, plan, talep, takas, alım, ödeme, kapanış.

ARAYÜZ: phase_cycle_open, phase_cycle_plan, phase_cycle_demand, phase_cycle_match, phase_cycle_buy, phase_cycle_pay, phase_cycle_welfare, phase_cycle_close
OKUR/YAZAR: W (döngü geçicileri `W.ad`).
KATMAN: L6.
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from collections import defaultdict
import bisect
import itertools
from simkit.params import *          # noqa: F401,F403
from simkit.lab_meas import lab_ev, human_cikis
from simkit.trace import trace
from simkit.credit_core import take_fee
from simkit.dao import dao_cycle
from simkit.econ_core import isres, isrole, land, prio_alloc, sehir_destekli
from simkit.firms import capex_buy, charge_lonca
from simkit.households import hane_paylasim, life_budget, person_demand
from simkit.housing import house_buy
from simkit.insurance import ins_claim, ins_premium
from simkit.market import clear, clear_fp, contract_pay, pay_telif
from simkit.production import inv_buy
from simkit.sector_core import sb_scale_mult, board_stat_add
from simkit.tech_core import prod_mult


def phase_cycle_open(W):
    """döngü açılışı: firma üretim/istihdam taraması, taşıyıcılar ve navlun kapasitesi."""
    L = W.L
    LD_VER = W.LD_VER
    LIQ_ON = W.LIQ_ON
    cities = W.cities
    firms = W.firms
    freight_cap = W.freight_cap
    fwage = W.fwage
    people = W.people
    stats = W.stats
    wf_week = W.wf_week
    LD_VER[0] += 1
    # 0) avans (işe yeni girene bu döngünün ücreti peşin; ödenemezse K-23)
    for f, d in firms.items():
        if (d["kind"] == "ahir" or sehir_destekli(d)) and any(people[q].get("avans") for q in d["workers"]):    # kamu işyeri avansı şehirden
            adv = sum(people[q]["wage"] for q in d["workers"] if people[q].get("avans"))
            if L.bal[f] < adv:
                L.pay(cities[d["city"]]["acct"], f, adv - L.bal[f], "ciraklik_bursu" if d["kind"] == "ahir" else ("belediye_ucreti" if d["kind"] == "belediye" else "kamu_hizmet_destegi"))
        for q in list(d["workers"]):
            if people[q].pop("avans", False):
                if FP_ACT:
                    fwage[f] += people[q]["wage"]
                if (pw_ := L.pay(f, q, people[q]["wage"], "arastirmaci_ucreti" if d["kind"] == "arge" else ("yonetici_ucreti" if (MGR_ACT and isrole(people[q]) and people[q]["role"] == "yonetici") else ("uzman_ucreti" if (MGR_ACT and isrole(people[q])) else "ucret")))) < people[q]["wage"] - 1e-9:
                    if LIQ_ON:
                        d.setdefault("arrears", {})[q] = d.get("arrears", {}).get(q, 0.0) + people[q]["wage"] - pw_
                    W.wage_fail += 1
                    W.separations += 1
                    cities[d["city"]]["unpaid_w"] += 1
                    wf_week[f] += 1
                    if KR_MEAS:
                        lab_ev(W, "cikis_ucret", f)                  # davranışsız sayaç (§4.6)
                        W.lab_stat["kurucu_ucret_cikis"] += q == d["owner"]
                    d["workers"].remove(q)
                    people[q]["firm"] = None
                    if HUMAN_ON:
                        human_cikis(W, q, "ucret_odenmedi")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
                    (cities[people[q]["city"]]["pool"] if people[q]["who"] == "npc" else cities[people[q]["city"]]["seekers"]).append(q)
                else:
                    people[q]["avans_paid"] = True
                    if WAGE_TAX > 0 and d["kind"] != "arge" and not (MGR_ACT and isrole(people[q])):
                        L.pay(q, cities[d["city"]]["acct"], WAGE_TAX * people[q]["wage"], "gelir_vergisi")      # K-189
    W.carriers_of = {j: [(f, len(firms[f]["workers"])) for f in cities[j]["firms"] if firms[f]["kind"] == "lojistik" and firms[f]["workers"]]
                   for j in range(len(cities))}
    freight_cap.clear()
    freight_cap.update({j: sum(nw for _, nw in W.carriers_of[j]) * LOG_CAP for j in range(len(cities))})
    stats["freight_cap"] += sum(freight_cap.values())


def phase_cycle_plan(W, w, cyc):
    """üretim planı: aşama aşama (K-118) arz ve girdi talebi."""
    AHIR_KAMU = W.AHIR_KAMU
    INV_ON = W.INV_ON
    L = W.L
    cities = W.cities
    firms = W.firms
    fwk_prod = W.fwk_prod
    inq_acc = W.inq_acc
    inv_stat = W.inv_stat
    kind_stats = W.kind_stats
    own_p = W.own_p
    prod_w = W.prod_w
    PRICE = W.PRICE
    RECIPES = W.RECIPES
    REF = W.REF
    STAGES = W.STAGES
    # 1) üretim planı ve girdi takası, TOPO sırasıyla (K-89); üretim = min(kapasite, hedef)
    W.supply = defaultdict(lambda: defaultdict(list))         # ürün -> şehir -> [[firm, qty]]
    plan = {}                                               # firm -> (çıktı ölçeği)
    sup_idx, W.stk0 = {}, {}
    if INV_ON:                                              # K-185.16: önceki döngüden kalan stok satışa çıkar (firma stoğu arz kaydına taşınır)
        for f_, d_ in firms.items():
            st_ = d_.get("stock")
            if st_:
                for p_, q_ in st_.items():
                    if q_ > 1e-9:
                        ent_ = [f_, q_]
                        W.supply[p_][d_["city"]].append(ent_)
                        sup_idx[(f_, p_)] = ent_
                        W.stk0[(f_, p_)] = q_
                d_["stock"] = {}
    for stage in STAGES:                                    # K-118: aynı aşamadaki türler aynı girdiyi birlikte, orantılı paylaşır
        demand = defaultdict(lambda: defaultdict(list))     # ürün -> şehir -> [[firm, qty]]
        planned = {}
        inuse = {}
        for f, d in firms.items():
            kind = d["kind"]
            if kind not in stage or not d["workers"]:
                continue
            outputs, inputs = RECIPES[kind]
            main, rate = next(iter(outputs.items()))
            rate *= d.get("tech", 1.0) * prod_mult(W, d)         # K-134: Ar-Ge verimi; K-136: yazılım verimi
            ci = d["city"]
            n = len(d["workers"])
            kind_stats[kind]["wc"] += n
            if kind == "ahir" and AHIR_KAMU:
                n = min(n, AHIR_HERD_WORKERS)
            scale = 1.0
            if kind != "ahir":
                cap_units = rate * n
                # şehrin hedefi firmalara kadroyla orantılı bölünür; oyuncu firması ayrıca dünya eksiğini kovalar
                target = W.need_by_city[ci][main] * n / max(1, W.n_live[(ci, kind)])
                if d["owner"] is not None:
                    target = cap_units                      # oyuncu firması tam kapasite üretir; risk girişimcinin
                scale = min(1.0, target / cap_units) if cap_units > 0 else 1.0
                if d["owner"] is not None and SELL_THRU and cap_units > 0:
                    sp = d.get("cyc_sold") if SELL_CYC else d.get("sold_prev")
                    scale = min(scale, SELL_START if sp is None else max(SELL_FLOOR, min(1.0, SELL_GROW * sp / cap_units)))
                if INV_ON and cap_units > 0:                # K-185.16: üretim stok düzeyine bakar: stok hedefin üstündeyse kısar, altındaysa (NPC) artırır
                    st_m = W.stk0.get((f, main), 0.0)
                    cover = st_m / max(1e-9, (target if d["owner"] is None else cap_units * scale))
                    if cover > INV_HI:
                        scale *= max(0.2, 1.0 - (cover - INV_HI) / INV_HI)
                        inv_stat["uretim_kisma"] += 1
                    elif d["owner"] is None and cover < INV_LO and scale < 1.0:
                        scale = min(1.0, scale * (1.0 + INV_GAIN))
                        inv_stat["uretim_artirma"] += 1
                if SECTOR_BOARD and cap_units > 0:          # K-212: sektör durumu (pano): stok fazlası ve kıtlık yoksa fren; kalıcı kıtlıkta NPC ölçeği artar
                    m_sb = sb_scale_mult(W, main)
                    if m_sb < 1.0:
                        scale *= m_sb
                        board_stat_add(W, "uretim_fren")
                    elif m_sb > 1.0 and d["owner"] is None and scale < 1.0:
                        scale = min(1.0, scale * m_sb)
                        board_stat_add(W, "uretim_artis")
            if inputs:
                ist_ = d.get("istock", {}) if INV_ON else {}
                est = sum(max(0.0, q * rate * n * scale - ist_.get(p, 0.0)) * land(W, ci, p) * (1 + NAVLUN) for p, q in inputs.items()) if INV_ON else sum(q * land(W, ci, p) * (1 + NAVLUN) for p, q in inputs.items()) * rate * n * scale
                if est > L.bal[f] > 0:
                    scale *= L.bal[f] / est
                elif L.bal[f] <= 0 and not (INV_ON and est <= 1e-9):
                    scale = 0.0
                for p, q in inputs.items():
                    want_ = q * rate * n * scale
                    have_ = ist_.get(p, 0.0) if INV_ON else 0.0
                    inuse[(f, p)] = have_
                    buy_ = max(0.0, want_ - have_)
                    demand[p][ci].append([f, buy_, -1 - d.get("grade", 1)] if QL_ACT else [f, buy_])
                    cities[ci]["last_demand"][p] += buy_
            planned[f] = (n, scale)
            if f == DEBUG_FIRM:
                trace(W, f"[{w}.{cyc}] {f} kadro={len(d['workers'])} hedef={W.need_by_city[ci][main] * n / max(1, W.n_live[(ci, kind)]):.1f} kap={rate * n:.0f} ölçek={scale:.2f} nakit={L.bal[f]:.0f} n_live={W.n_live[(ci, kind)]} PMout={PRICE[(ci, main)]/REF[main]:.2f} PMin={[round(PRICE[(ci, p_)]/REF[p_],2) for p_ in inputs]}")
        got_all = defaultdict(dict)
        for p in list(demand):
            if FP_ACT:
                got, cost, _sr, qrec_ = clear_fp(W, p, W.supply[p], demand[p], "girdi")
                if QL_ACT and p not in NO_FREIGHT and p not in ("bilgisayar", "koruma"):
                    for f_, (u_, qs_) in qrec_.items():
                        ia_ = inq_acc[f_]
                        ia_[0] += u_ * REF[p]
                        ia_[1] += qs_ * REF[p]
            else:
                got, cost = clear(W, p, W.supply[p], demand[p], "girdi")
            for f, cst in cost.items():
                kind_stats[firms[f]["kind"]]["inp"] += cst
            got_all[p] = got
        for f, (n, scale) in planned.items():
            kind = firms[f]["kind"]
            outputs, inputs = RECIPES[kind]
            main, rate = next(iter(outputs.items()))
            tch = firms[f].get("tech", 1.0) * prod_mult(W, firms[f])
            rate *= tch
            if inputs:                                      # eksik girdi varsa çıktı o oranda küçülür
                ratio = 1.0
                for p, q in inputs.items():
                    want = q * rate * n * scale
                    if want > 1e-12:
                        have_ = inuse.get((f, p), 0.0) if INV_ON else 0.0
                        r_ = (got_all[p].get(f, 0.0) + min(have_, want)) / want
                        if INV_ON and have_ > 1e-9 and got_all[p].get(f, 0.0) < want * 0.999:
                            inv_stat["girdi_stok_kullanim_akce"] += min(have_, want - got_all[p].get(f, 0.0)) * REF[p]
                        if p == GRID_GOOD or (p == "komur" and kind == "santral"):     # K-139: yakıt ve elektrik eksikliği üretimi tamamen durdurmaz (yedek yakıt, jeneratör)
                            r_ = ENERGY_FLOOR + (1 - ENERGY_FLOOR) * r_
                        if p == "yazilim":                     # K-136: isteğe bağlı girdi: yoksa üretim durmaz, yalnız verim artışı olmaz
                            firms[f]["sw"] = min(1.0, r_)
                            continue
                        if p == "bilgisayar":                  # K-142: isteğe bağlı girdi (yenileme); eksikse yazılım verimi çalışmaz
                            firms[f]["pc"] = min(1.0, r_)
                            continue
                        if p == "koruma":                      # K-140: güvenlik hizmeti isteğe bağlı: yoksa çıktının %2,5'i fire olur
                            firms[f]["sec"] = min(1.0, r_)
                            continue
                        ratio = min(ratio, r_)
                scale *= max(0.0, ratio)
                if INV_ON:                                          # K-185.16: girdi stoğu: eldeki + alınan - kullanılan; bozulma
                    ist2_ = firms[f].setdefault("istock", {})
                    use_c_ = firms[f].setdefault("use_cyc", {})
                    for p, q in inputs.items():
                        use_ = q * rate * n * scale
                        new_ = max(0.0, inuse.get((f, p), 0.0) + got_all[p].get(f, 0.0) - use_)
                        dec_ = 0.0 if p in NO_STOCK else STOCK_DECAY.get(p, STOCK_DECAY_DEF)
                        inv_stat["bozulma_akce"] += new_ * dec_ * REF[p]
                        ist2_[p] = new_ * (1.0 - dec_)
                        use_c_[p] = 0.7 * use_c_.get(p, use_) + 0.3 * use_
                firms[f]["ok_acc"] = firms[f].get("ok_acc", 0.0) + ratio     # K-125: girdi bulunurluğu (bu hafta)
                if firms[f].get("owner") is not None:
                    firms[f]["life_ok"] = firms[f].get("life_ok", 0.0) + ratio
                    firms[f]["life_n"] = firms[f].get("life_n", 0) + 1
                firms[f]["ok_n"] = firms[f].get("ok_n", 0) + 1
            sec_m = 1.0 - SEC_LOSS * (1.0 - firms[f].get("sec", 1.0)) if TRANS_ON else 1.0
            for p, r in outputs.items():
                r *= tch * sec_m
                if INV_ON and (f, p) in sup_idx:
                    sup_idx[(f, p)][1] += r * n * scale
                else:
                    ent_ = [f, r * n * scale]
                    W.supply[p][firms[f]["city"]].append(ent_)
                    sup_idx[(f, p)] = ent_
                if INV_ON:
                    firms[f].setdefault("lastp", {})[p] = max(r * n * scale, 0.0) if r * n * scale > 0 else firms[f].get("lastp", {}).get(p, 0.0)
                if FP_ACT or RENT_ACT:
                    fwk_prod[f] += r * n * scale
                if firms[f].get("owner") is not None:
                    firms[f]["prod_acc"] = firms[f].get("prod_acc", 0.0) + r * n * scale
                    firms[f]["wk_prod"] = firms[f].get("wk_prod", 0.0) + r * n * scale
                    firms[f]["cyc_p"] = r * n * scale
                    firms[f]["cyc_u"] = 0.0
                cities[firms[f]["city"]]["last_output"][p] += r * n * scale
                prod_w[(firms[f]["city"], p)] += r * n * scale
                if firms[f].get("owner") is not None:
                    own_p[(firms[f]["city"], p)] += r * n * scale
            if f == DEBUG_FIRM:
                trace(W, f"      girdi: " + ", ".join(f"{p} istendi={q * rate * n * planned[f][1]:.0f} alındı={got_all[p].get(f, 0):.0f}" for p, q in inputs.items()) + f" → çıktı={rate * n * scale:.0f} nakit={L.bal[f]:.0f}")


def phase_cycle_demand(W):
    """şehir talebi: hane/firma/konut talebi, küresel birikim."""
    L = W.L
    bf_stat = W.bf_stat
    cities = W.cities
    firms = W.firms
    gate = W.gate
    hab = W.hab
    kind_stats = W.kind_stats
    lvl_cat = W.lvl_cat
    lvl_n = W.lvl_n
    miss_reason = W.miss_reason
    npcpov = W.npcpov
    people = W.people
    qseg_stat = W.qseg_stat
    segd_w = W.segd_w
    sh_req = W.sh_req
    sh_share = W.sh_share
    stat_from = W.stat_from
    stats = W.stats
    NOW = W.NOW
    REF = W.REF
    RENT_CY = W.RENT_CY
    mmk_ = W.MARKET_MARKUP                                      # hız: bu fazda değişmez (hafta başında W.MARKET_MARKUP kurulur)
    # 2) tüketim takası (nihai satış, ücretten önce, K-89): mağaza kapasitesiyle orantılı paylaştırma.
    #    K-122: tüm şehirlerin talebi ürün başına TEK takasta birleşir (şehir sırasından bağımsız, K-99).
    W.city_data = {}
    W.city_idx = {}
    W.seg_ci, W.aggsg_ci, W.mkt_got_seg = {}, {}, {}
    glob_agg = defaultdict(lambda: defaultdict(float))                 # ürün -> şehir -> toplam mağaza talebi
    for c in cities:
        ci = c["i"]
        markets = [f for f in c["firms"] if firms[f]["kind"] == "market"]
        cap_units = sum(len(firms[m]["workers"]) for m in markets) * STORE_UNITS_PER_WORKER
        consumers = c["players"] + [q for f in c["firms"] for q in firms[f]["workers"] if people[q]["who"] == "npc"]
        if NPC_POOL_CONS:
            pool_c_ = [q for q in c["pool"] if L.bal[q] >= NPC_MIN_BAL]
            consumers = consumers + pool_c_
            npcpov[0] += len(c["pool"]) - len(pool_c_)
            npcpov[1] += len(c["pool"])
        if NPC_HOUSE == 1:                                            # D9 (A2): nakdi olan bakmakla yükümlü NPC de hane olarak tüketir (nakdi çalışan üyenin paylaşımından gelir)
            consumers = consumers + [q for q in c.get("deps", ()) if L.bal[q] >= NPC_MIN_BAL]
        if c.get("out"):                                              # D10 (B7): işgücü dışına çıkan NPC de hane olarak (kendi nakdiyle) tüketir
            consumers = consumers + [q for q in c.get("out", ()) if L.bal[q] >= NPC_MIN_BAL]
        wants = {}
        tot_units = 0.0
        q0_ = {}
        cons_idx = {}
        seg_c = {}
        for i_c, p_c in enumerate(consumers):
            cons_idx.setdefault(p_c, i_c)
        LDm = {p_: land(W, ci, p_) for p_ in REF}
        scale_c = sum(LDm[p] * q for p, q in BASKET.items()) / sum(REF[p] * q for p, q in BASKET.items())
        for person in consumers:
            info = people[person]
            if LIFE_ACT:
                items = person_demand(W, info["wage"], info["tier"], ci, L.bal[person], budget=life_budget(W, person, info, ci))
            else:
                items = person_demand(W, info["wage"], 2 if (INNOV_ON and (isres(info) or isrole(info))) else info["tier"], ci, L.bal[person])
            if RESALE_ACT and info["who"] == "oyuncu":                 # K-174: mücevher/konut talebinin bir kısmı ikinci elden (arz kadar) karşılanır, yeni üretim talebi azalır
                for p_ in ("mucevher", "insaat"):
                    q_ = items.get(p_, 0.0)
                    if q_ > 0:
                        sh_q = q_ * sh_share[p_]
                        items[p_] = q_ - sh_q
                        sh_req[p_][person] += sh_q
            shelf = sum([LDm[p] * q for p, q in items.items()]) * mmk_
            aff = min(1.0, L.bal[person] / shelf) if shelf > 0 else 1.0     # müşteri parası
            if info["who"] == "oyuncu":
                _k = "ise" if info["firm"] else "issiz"
                _g = NOW[0] // 25 * 25
                gate[(_g, "tuk_n_" + _k)] += 1
                gate[(_g, "tuk_shelf_" + _k)] += shelf
                gate[(_g, "tuk_cash_" + _k)] += L.bal[person]
                gate[(_g, "tuk_aff_" + _k)] += aff
            if WEEKLY_CSV:
                W.WKC["dem_ham"] += sum(items.values())                  # tur 9: parasızlık öncesi talep (yalnız ölçüm)
            q0_[person] = items                                        # K-155: karşılama göstergesi parasızlığı da saysın (aff öncesi talep)
            if BUDGET_FIRST_ACT and shelf > 0 and L.bal[person] - (RENT_CY.get(ci, 0.0) if HOUSE_ON else 0.0) < shelf:
                items0_ = items
                items = prio_alloc(W, items0_, ci, L.bal[person], RENT_CY.get(ci, 0.0) if HOUSE_ON else 0.0)
                for p_ in BASKET:                                   # mekanizma testi: sepet karşılaması, öncelikli dağıtım ve eski orantılı kısma (aff) karşılaştırması
                    if items0_.get(p_, 0.0) > 1e-12:
                        bf_stat["n"] += 1
                        bf_stat["prio"] += min(1.0, items[p_] / items0_[p_])
                        bf_stat["aff"] += aff
            else:
                items = {p: q * aff for p, q in items.items()}
            if LIFE_ACT and info["who"] == "oyuncu" and NOW[0] > stat_from:     # K-172: hayat düzeyi istatistiği (son 20 hafta): düzey = alışkanlık bütçesi × 28 döngü / fiyat ölçeği
                m_ = hab[person] * 28 / scale_c
                lv_ = 0 if m_ < LEVEL_CUTS[0] else (1 if m_ < LEVEL_CUTS[1] else 2)
                lvl_n[lv_] += 1
                for p, q in items.items():
                    lvl_cat[(lv_, "sepet" if p in BASKET else LIFE_CATNAME.get(p, p))] += q * LDm[p] * mmk_
            if aff < 0.999:
                miss_reason["musteri_parasi"] += 1
            wants[person] = items
            if FP_ACT:                                              # K-183.1 (K-78): hane katmanı = hayat düzeyi (normal / rahat / lüks); yoksa meslek katmanı
                if LIFE_ACT:
                    m_s = hab[person] * 28 / scale_c
                    seg_c[person] = 0 if m_s < LEVEL_CUTS[0] else (1 if m_s < LEVEL_CUTS[1] else 2)
                else:
                    seg_c[person] = info["tier"]
            tot_units += sum(items.values())
        ration = min(1.0, cap_units / tot_units) if tot_units > 0 else 1.0   # mağaza kapasitesi: orantılı
        if ration < 0.999:
            miss_reason["kapasite"] += len(consumers)
        c["dem_units"] += tot_units
        c["sold_units"] += tot_units * ration
        if WEEKLY_CSV:
            W.WKC["dem_aff"] += tot_units
            W.WKC["sold_u"] += tot_units * ration
            W.WKC["cap_u"] += cap_units
        dem_ = stats["demanded"]
        ld_ = c["last_demand"]
        agg = defaultdict(float)
        for it in wants.values():
            for p, q in it.items():
                dem_[p] += q
                ld_[p] += q
        for it in wants.values():
            for p, q in it.items():
                agg[p] += q * ration
        agg_sg = defaultdict(float)
        if FP_ACT:
            for person, it in wants.items():
                sg_ = seg_c[person]
                for p, q in it.items():
                    agg_sg[(p, sg_)] += q * ration
            W.seg_ci[ci] = seg_c
            W.aggsg_ci[ci] = agg_sg
        for p, q in agg.items():
            if p != "luks" and q > 1e-12:
                glob_agg[p][ci] = q
        W.city_data[ci] = (markets, consumers, wants, ration, agg, q0_)
        W.city_idx[ci] = cons_idx
    W.mkt_got_all = {}                                                    # (şehir, ürün) -> (teslim, maliyet)
    for p, bycity in glob_agg.items():
        if FP_ACT:
            demand = {ci: [[m, W.aggsg_ci[ci].get((p, sg_), 0.0) / len(W.city_data[ci][0]), sg_] for m in W.city_data[ci][0] for sg_ in (0, 1, 2) if W.aggsg_ci[ci].get((p, sg_), 0.0) > 1e-12] for ci in bycity}
            got, cost, segrec_, _qr = clear_fp(W, p, W.supply[p], demand, "sepet")
            if QL_ACT:
                for ci in bycity:
                    for sg_ in (0, 1, 2):
                        segd_w[(p, sg_)] += W.aggsg_ci[ci].get((p, sg_), 0.0)
            for ci in bycity:
                for sg_ in (0, 1, 2):
                    rc_ = segrec_.get((ci, sg_))
                    W.mkt_got_seg[(ci, p, sg_)] = (rc_[0], rc_[1]) if rc_ else (0.0, 0.0)
                    if rc_ and NOW[0] > stat_from:
                        qseg_stat[(sg_, p)][0] += rc_[0]
                        qseg_stat[(sg_, p)][1] += rc_[2]
                        qseg_stat[(sg_, p)][2] += rc_[1]
        else:
            demand = {ci: [[m, q / len(W.city_data[ci][0])] for m in W.city_data[ci][0]] for ci, q in bycity.items()}
            got, cost = clear(W, p, W.supply[p], demand, "sepet")
        for ci in bycity:
            mk = W.city_data[ci][0]
            W.mkt_got_all[(ci, p)] = (sum(got.get(m, 0.0) for m in mk), sum(cost.get(m, 0.0) for m in mk))
            kind_stats["market"]["inp"] += sum(cost.get(m, 0.0) for m in mk)


def phase_cycle_match(W, weeks):
    """şehir takası: yerli önce, sonra mesafeye göre; kıtlıkta orantılı paylaştırma."""
    L = W.L
    cities = W.cities
    cov = W.cov
    firms = W.firms
    held = W.held
    jval = W.jval
    kind_stats = W.kind_stats
    miss_item = W.miss_item
    missed = W.missed
    orep = W.orep
    people = W.people
    stats = W.stats
    NOW = W.NOW
    REF = W.REF
    TAXV = W.TAXV
    for c in cities:
        ci = c["i"]
        markets, consumers, wants, ration, agg, q0_ = W.city_data[ci]
        cons_idx = W.city_idx[ci]
        if ORG_ACT and len(markets) > 1:
            mk_w = [max(0.2, 1.0 + ORG_SHARE_K * (orep.get(m_, 50.0) - 50.0) / 50.0) for m_ in markets]
            mk_cum = list(itertools.accumulate(mk_w))
        # müşteriler orantılı pay alır ve raf fiyatı öder
        dlv_ = stats["delivered"]
        secf_ = (1.0 - SEC_LOSS * (1.0 - c.get("sec", 1.0)) if TRANS_ON else 1.0)
        seg_c_ = W.seg_ci[ci] if FP_ACT else None                 # hız: döngü değişmezleri döngü dışına (davranışsız)
        aggsg_c_ = W.aggsg_ci[ci] if FP_ACT else None
        got_seg_get = W.mkt_got_seg.get
        got_all_get = W.mkt_got_all.get
        mmk_ = W.MARKET_MARKUP
        mg_, ag_ = {}, {}
        for p_ in agg:
            mg_[p_] = got_all_get((ci, p_), (0.0, 0.0))
            ag_[p_] = agg[p_] if agg.get(p_, 0) > 0 else 0
        for person, items in wants.items():
            paid_tot, full = 0.0, True
            cov_i, cov_n, full95 = 0.0, 0, True
            for p, q in items.items():
                if p == "luks":
                    continue
                if FP_ACT:
                    sg_ = seg_c_[person]
                    g_tot, c_tot = got_seg_get((ci, p, sg_), (0.0, 0.0))
                    aggd_ = aggsg_c_.get((p, sg_), 0.0)
                    share = (q * ration / aggd_) if aggd_ > 0 else 0.0
                else:
                    g_tot, c_tot = mg_[p] if p in mg_ else got_all_get((ci, p), (0.0, 0.0))
                    share = (q * ration / agg[p]) if ag_.get(p, 0) > 0 else 0.0
                got_q = g_tot * share * secf_    # K-140: güvenliksiz mağazada fire
                if LIFE_ACT and (p == "mucevher" or p == "insaat"):
                    if RESALE_ACT and people[person]["who"] == "oyuncu":
                        held[p][person] += got_q                              # K-174: yeni-eşdeğer değer birimi; piyasa değeri = birim × ikinci el fiyatı
                    jval[person] += got_q * REF[p] * (0.9 if p == "mucevher" else 0.5)     # K-172: mücevher (değer saklama %90) ve büyük konut/iyileştirme (%50) servet kalemi
                dlv_[p] += got_q
                c["got_units"] += got_q
                q_full = q0_[person].get(p, q)
                if p in BASKET and q_full > 1e-12:
                    cov_i += min(1.0, got_q / q_full)
                    cov_n += 1
                    if got_q < q_full * 0.95:
                        full95 = False
                if p in BASKET and got_q < q * 0.999:
                    full = False
                    miss_item[p] += 1
                paid_tot += c_tot * share * mmk_
            if ORG_ACT and len(markets) > 1:
                m = markets[bisect.bisect_left(mk_cum, ((cons_idx[person] + 1) * 0.6180339887498949 % 1.0) * mk_cum[-1])]
            else:
                m = markets[cons_idx[person] % len(markets)]
            paid = L.pay(person, m, paid_tot, "satis")
            if WEEKLY_CSV:
                W.WKC["sp_" + W.SPCLS.get(person, "orta" if people[person]["who"] == "oyuncu" else "npc")] += paid     # tur 9: haftalık harcama, hane sınıfına göre (yalnız ölçüm)
            c["cons_val"] += paid
            tax_ = L.pay(m, c["acct"], paid * TAXV[0] / (1 + TAXV[0]), "satis_vergisi")     # K-152
            fee = take_fee(W, m, firms[m]["lonca"], paid - tax_)
            kind_stats["market"]["rev"] += paid - tax_ - fee
            cov["n"] += 1
            cov["ok95"] += 1 if (full95 and cov_n > 0) else 0
            cov["avg"] += cov_i / max(1, cov_n)
            if NOW[0] > weeks - 50:
                cov["rn"] += 1
                cov["rok95"] += 1 if (full95 and cov_n > 0) else 0
                cov["ravg"] += cov_i / max(1, cov_n)
            if full:
                c["served_w"] += 1
            else:
                c["missed_w"] += 1
                missed[person] += 1
        kind_stats["market"]["wc"] += sum(len(firms[m]["workers"]) for m in markets)


def phase_cycle_buy(W, cyc):
    """sermaye/konut/stok alımı, arz kapanışı ve depo gideri."""
    INV_ON = W.INV_ON
    L = W.L
    cities = W.cities
    firms = W.firms
    fwk_uns = W.fwk_uns
    inv_stat = W.inv_stat
    own_u = W.own_u
    stats = W.stats
    unsold_w = W.unsold_w
    REF = W.REF
    capex_buy(W, cyc, W.supply)
    house_buy(W, cyc, W.supply)
    inv_buy(W, cyc, W.supply)
    # 3) satılmayan arz alıcısız (kapalı dünya, stok devri yok)
    for p, bycity in W.supply.items():
        for ci, entries in bycity.items():
            for f, q_all in entries:
                q = q_all
                if INV_ON and q_all > 1e-9:
                    q = max(0.0, q_all - W.stk0.get((f, p), 0.0))             # yalnız YENİ alıcısız üretim sayılır (stok devri tekrar sayılmaz)
                    if p not in NO_STOCK:
                        dec_ = STOCK_DECAY.get(p, STOCK_DECAY_DEF)
                        cap_ = INV_MAXC * max(firms[f].get("lastp", {}).get(p, 0.0), 1.0)
                        keep_ = min(q_all, cap_)
                        inv_stat["bozulma_akce"] += keep_ * dec_ * REF[p]
                        inv_stat["tasma_akce"] += (q_all - keep_) * REF[p]
                        firms[f].setdefault("stock", {})[p] = keep_ * (1.0 - dec_)
                    else:
                        inv_stat["hizmet_kayip_akce"] += q_all * REF[p]
                if q > 1e-9:
                    stats["unsold"][p] += q * REF[p]
                    if firms[f].get("owner") is not None:
                        firms[f]["unsold_acc"] = firms[f].get("unsold_acc", 0.0) + q
                        firms[f]["wk_uns"] = firms[f].get("wk_uns", 0.0) + q
                        firms[f]["cyc_u"] = firms[f].get("cyc_u", 0.0) + q
                    unsold_w[(ci, p)] += q
                    if FP_ACT or RENT_ACT:
                        fwk_uns[f] += q
                    if firms[f].get("owner") is not None:
                        own_u[(ci, p)] += q
                if f == DEBUG_FIRM:
                    trace(W, f"      satılmadı {p}={q:.0f}  nakit={L.bal[f]:.0f}")
    if INV_ON:                                              # K-185.16: depo gideri (stok değerinin döngü payı, şehir kasasına) ve stok istatistiği
        for f_, d_ in firms.items():
            st_ = d_.get("stock")
            if st_ and not d_.get("dead"):
                val_ = sum(q_ * REF[p_] for p_, q_ in st_.items())
                paid_ = L.pay(f_, cities[d_["city"]]["acct"], min(INV_HOLD * val_, max(0.0, L.bal[f_])), "depo_gideri")
                inv_stat["depo_gideri"] += paid_
    for f_, d_ in firms.items():
        if d_.get("owner") is not None and "cyc_p" in d_:
            d_["cyc_sold"] = max(0.0, d_.pop("cyc_p") - d_.pop("cyc_u", 0.0))


def phase_cycle_pay(W):
    """ödemeler: ücret, kira, istihdam ve hane kirası."""
    AHIR_KAMU = W.AHIR_KAMU
    L = W.L
    LIQ_ON = W.LIQ_ON
    WELF_ON = W.WELF_ON
    cities = W.cities
    firms = W.firms
    fwage = W.fwage
    jobless_c = W.jobless_c
    kind_stats = W.kind_stats
    occ = W.occ
    people = W.people
    rent_pot = W.rent_pot
    skillw = W.skillw
    wf_week = W.wf_week
    worked = W.worked
    RENT_CY = W.RENT_CY
    # 4) ücret, 5) kira (K-57, K-89); K-23; çıraklık bursu (K-95)
    for f, d in firms.items():
        if d.get("dead"):
            continue
        c = cities[d["city"]]
        if d["kind"] == "belediye":
            need = sum(people[q]["wage"] for q in d["workers"])
            if L.bal[f] < need:
                L.pay(c["acct"], f, need - L.bal[f], "belediye_ucreti")
        if d["kind"] != "belediye" and sehir_destekli(d):
            need = sum(people[q]["wage"] for q in d["workers"]) + RENT
            if L.bal[f] < need:
                L.pay(c["acct"], f, need - L.bal[f], "kamu_hizmet_destegi")      # K-135
        if AHIR_KAMU and d["kind"] == "ahir":
            need = sum(people[q]["wage"] for q in d["workers"]) + RENT
            if L.bal[f] < need:
                L.pay(c["acct"], f, need - L.bal[f], "ciraklik_bursu")
        for q in list(d["workers"]):
            if people[q].pop("avans_paid", False):
                worked[q] += 1
                if SKILL_ALL_WORK or d["kind"] not in ("ahir", "belediye", "arge"):     # M3.1: SKILL_ALL_WORK=1 ise her ücretli iş tecrübedir (ahır, belediye, Ar-Ge dahil)
                    skillw[q] += 1
                if d["kind"] not in ("ahir", "belediye", "arge") and WELF_ON:
                    people[q]["lf"] = f
                c["paid_w"] += 1
                continue
            wg = people[q]["wage"]
            if FP_ACT:
                fwage[f] += wg
            if (pw_ := L.pay(f, q, wg, "arastirmaci_ucreti" if d["kind"] == "arge" else ("yonetici_ucreti" if (MGR_ACT and isrole(people[q]) and people[q]["role"] == "yonetici") else ("uzman_ucreti" if (MGR_ACT and isrole(people[q])) else "ucret")))) < wg - 1e-9:
                if LIQ_ON:
                    d.setdefault("arrears", {})[q] = d.get("arrears", {}).get(q, 0.0) + wg - pw_
                W.wage_fail += 1
                W.separations += 1
                c["unpaid_w"] += 1
                wf_week[f] += 1
                if KR_MEAS:
                    lab_ev(W, "cikis_ucret", f)                      # davranışsız sayaç (§4.6)
                    W.lab_stat["kurucu_ucret_cikis"] += q == d["owner"]
                d["workers"].remove(q)
                people[q]["firm"] = None
                if HUMAN_ON:
                    human_cikis(W, q, "ucret_odenmedi")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
                (c["pool"] if people[q]["who"] == "npc" else c["seekers"]).append(q)
            else:
                worked[q] += 1
                if WAGE_TAX > 0 and d["kind"] != "arge" and not (MGR_ACT and isrole(people[q])):
                    L.pay(q, cities[d["city"]]["acct"], WAGE_TAX * wg, "gelir_vergisi")      # K-189
                if SKILL_ALL_WORK or d["kind"] not in ("ahir", "belediye", "arge"):     # M3.1: SKILL_ALL_WORK=1 ise her ücretli iş tecrübedir (ahır, belediye, Ar-Ge dahil)
                    skillw[q] += 1
                if d["kind"] not in ("ahir", "belediye", "arge") and WELF_ON:
                    people[q]["lf"] = f
                c["paid_w"] += 1
        r = L.pay(f, c["acct"], RENT, "kira") if d["kind"] != "belediye" else 0.0
        kind_stats[d["kind"]]["rent"] += r
    if HOUSE_ON:                                          # K-159: hane kirası (oyuncular ve çalışan NPC), toplanan kira şehir hesabında beklemeye alınır, haftalık ev sahiplerine dağıtılır
        for c in cities:
            ten = c["players"] + [q_ for f_ in c["firms"] for q_ in firms[f_]["workers"] if people[q_]["who"] == "npc"]
            occ[c["i"]] = len(ten)
            for q_ in ten:
                r_ = min(L.bal[q_], RENT_CY[c["i"]])
                if r_ > 1e-12:
                    L.pay(q_, f"emanet{c['i']}", r_, "konut_kirasi")          # K-163: kira emanet hesabında toplanır (şehir kasası harcasa da ev sahibi payı güvende)
                    rent_pot[c["i"]] += r_
    if NPC_HOUSE == 1:
        hane_paylasim(W)                                       # D9 (A2): ücret ödendikten sonra hane içi paylaşım (varsayılan: tek kişi, çağrılmaz)
    if INNOV_ON:
        dao_cycle(W)
    # 5b) işsizlik ödeneği (K-109): şehir kasası iş arayan oyuncuya öder; kasa yetmezse şehir açığı basımdır (settle)
    seek_all = {q_ for c_ in cities for q_ in c_["seekers"]}
    for q_ in [k_ for k_ in jobless_c if k_ not in seek_all]:
        del jobless_c[q_]


def phase_cycle_welfare(W):
    """işsiz/şehir kasası ödemeleri."""
    INS_ON = W.INS_ON
    L = W.L
    WELF_ON = W.WELF_ON
    cities = W.cities
    closed = W.closed
    firms = W.firms
    ins = W.ins
    jobless_c = W.jobless_c
    people = W.people
    skillw = W.skillw
    unemp = W.unemp
    wf_eff = W.wf_eff
    wf_ins = W.wf_ins
    wf_paid_w = W.wf_paid_w
    wf_stat = W.wf_stat
    WI = W.WI
    for c in cities:
        for q in c["seekers"]:
            jobless_c[q] = jobless_c.get(q, 0) + 1
            if INNOV_ON:
                unemp[q] += 1
            ben_ = (1.0 if jobless_c[q] <= BENEFIT_WEEKS * CYCLES_PER_WEEK else BENEFIT_LONG) * UNEMPLOY_BENEFIT * (min(people[q]["wage"], TIER_WAGE[0] * WI[c["i"]]) if SKILL_ON else people[q]["wage"])
            L.pay(c["acct"], q, ben_ * (WELF_CITY_MULT if WELF_ON else 1.0), "issizlik_odenegi")
            if WELF_ON:
                wf_stat["issiz_dongu"] += 1
                lf_ = people[q].get("lf")
                lo_w = firms[lf_]["lonca"] if (lf_ in firms and firms[lf_]["lonca"] not in closed) else None
                if lo_w is not None and wf_eff[lo_w] > 1e-9 and jobless_c[q] <= WELF_UNEMP_WEEKS * CYCLES_PER_WEEK:
                    wage_c_ = min(people[q]["wage"], TIER_WAGE[0] * WI[c["i"]]) if SKILL_ON else people[q]["wage"]
                    if INS_ON and wf_ins.get(lo_w) and ins[wf_ins[lo_w]]["alive"]:
                        got_w = ins_claim(W, lo_w, q, wf_eff[lo_w] * wage_c_)
                    else:
                        amt_w = min(wf_eff[lo_w] * wage_c_, L.bal[f"{lo_w}_refah"])
                        got_w = L.pay(f"{lo_w}_refah", q, amt_w, "lonca_issizlik_odenegi")
                        wf_paid_w[lo_w] += got_w
                    wf_stat["lonca_issiz_dongu"] += 1
                    wf_stat["lonca_issiz_akce"] += got_w
                else:
                    wf_stat["asgari_kalan_dongu"] += 1      # K-148: ödenek çırak ücretini aşmaz
    if WELF_ON:                                                       # K-185.3: lonca çıraklık bursu: üye firmaların ilk özel işyeri haftalarındaki çırak oyuncularına
        for f_, d_ in firms.items():
            if d_.get("dead") or not d_["workers"] or d_["kind"] in ("belediye", "arge", "ahir"):
                continue
            lo_b = d_["lonca"]
            if wf_eff[lo_b] <= 1e-9 or lo_b in closed:
                continue
            for q_ in d_["workers"]:
                i_ = people[q_]
                if i_["who"] == "oyuncu" and i_["tier"] == 0 and skillw[q_] < WELF_BURS_WEEKS * CYCLES_PER_WEEK:
                    amt_b = min(wf_eff[lo_b] * WELF_BURS_RATIO * i_["wage"], L.bal[f"{lo_b}_refah"])
                    got_b = L.pay(f"{lo_b}_refah", q_, amt_b, "lonca_ciraklik_bursu")
                    wf_paid_w[lo_b] += got_b
                    wf_stat["burs_akce"] += got_b
    if NPC_ASGARI:                                                    # K-185.13: şehir asgari güvencesi işsiz NPC'ye de (maliyet ölçümü)
        for c in cities:
            for q in c["pool"]:
                b_ = UNEMPLOY_BENEFIT * min(people[q]["wage"], TIER_WAGE[0] * WI[c["i"]]) * (WELF_CITY_MULT if WELF_ON else 1.0)
                L.pay(c["acct"], q, b_, "issizlik_odenegi_npc")


def phase_cycle_close(W, w):
    """medya, lonca programı ve döngü kapanışı (settle)."""
    INS_ON = W.INS_ON
    L = W.L
    WELF_ON = W.WELF_ON
    ad_pay_ema = W.ad_pay_ema
    ad_rev_all = W.ad_rev_all
    ad_w = W.ad_w
    ad_week = W.ad_week
    arge_boost = W.arge_boost
    arge_spent = W.arge_spent
    cities = W.cities
    closed = W.closed
    dep_tot = W.dep_tot
    firms = W.firms
    ins = W.ins
    kind_stats = W.kind_stats
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    media_save = W.media_save
    media_stat = W.media_stat
    media_w = W.media_w
    orep = W.orep
    owner_rec = W.owner_rec
    people = W.people
    rev_lb = W.rev_lb
    rev_lc = W.rev_lc
    wf_claim = W.wf_claim
    wf_g = W.wf_g
    wf_ins = W.wf_ins
    wf_payroll = W.wf_payroll
    KN = W.KN
    # 6) lonca programı (K-39/K-73/K-34)
    medias = [f for f, d in firms.items() if d["kind"] == "medya" and not (MEDIA_ACT and d.get("dead"))]
    prog = PROGRAM_INNOV if INNOV_ON else LONCA_PROGRAM
    base_prog = prog
    if MEDIA_ACT:                                                 # K-183.6: aynı şehirde birden çok medya: reklam etkili erişim^γ × itibar ağırlığıyla bölünür (eski kanal küçülür)
        mw = {m_: (firms[m_].get("eff", 1.0) ** MEDIA_GAMMA) * (max(0.2, 1.0 + ORG_SHARE_K * (orep.get(m_, 50.0) - 50.0) / 50.0) if ORG_ACT else 1.0) for m_ in medias}
        mw_city = defaultdict(float)
        for m_ in medias:
            mw_city[firms[m_]["city"]] += mw[m_]
    for lo in loncas:
        if lo in closed:
            continue
        prog = base_prog
        if NL_ACT and arge_boost[lo] > 0:
            prog = dict(base_prog)
            prog["arge"] = base_prog["arge"] + arge_boost[lo]
            prog["sermaye"] = max(0.0, base_prog["sermaye"] - arge_boost[lo])
        if COST_ACT and w >= OWNER_WEEK:
            charge_lonca(W, lo)
        if WELF_ON and wf_g[lo] > 1e-9:                                   # K-185.3: paket fonu, fee gelirinden (rezerv hedefine kadar, en çok WELF_SHARE_MAX)
            exp_w = max(wf_claim[lo], WELF_EXPO * wf_g[lo] * wf_payroll[lo])
            top_ = max(0.0, WELF_RES_WEEKS * exp_w - L.bal[f"{lo}_refah"])
            L.pay(lo, f"{lo}_refah", min(top_ / CYCLES_PER_WEEK * 2.0, WELF_SHARE_MAX * max(0.0, L.bal[lo])), "lonca_refah_fonu")
        if INS_ON and wf_g[lo] > 1e-9 and wf_ins.get(lo) and ins[wf_ins[lo]]["alive"]:
            ins_premium(W, lo)
        have = L.bal[lo] - (media_save[lo] if MO_ACT else 0.0)
        room_s = max(0.0, SERMAYE_CAP - (L.bal[f"{lo}_sermaye"] - dep_tot[lo]))        # K-120: havuz tavanlı; fazlası şehirlere döner
        to_pool = min(have * prog["sermaye"], room_s)
        L.pay(lo, f"{lo}_sermaye", to_pool, "sermaye_havuzu")
        for c in cities:
            L.pay(lo, c["acct"], (have * prog["sermaye"] - to_pool) / len(cities), "sermaye_fazlasi")
        tot_lc = sum(rev_lc[(lo, c["i"])] for c in cities)
        for mf in medias:
            if MEDIA_ACT:
                ci_m = firms[mf]["city"]
                wgt = ((rev_lc[(lo, ci_m)] / tot_lc) if (TOUR_ON and tot_lc > 0) else 1.0 / len(mw_city)) * mw[mf] / mw_city[ci_m]
                eff_m = firms[mf].get("eff", 1.0)
            else:
                wgt = (rev_lc[(lo, firms[mf]["city"])] / tot_lc) if (TOUR_ON and tot_lc > 0) else 1.0 / len(medias)      # K-138: lonca reklamı üyelerinin sattığı şehirde yapar
                eff_m = 1.0
            if MO_ACT and firms[mf].get("org_owner") == ("lonca", lo):
                full_ = have * prog["reklam"] * wgt
                r = L.pay(lo, mf, (1.0 - MEDIA_OWN_DISC) * full_, "reklam_ic")
                ad_rev_all[mf] += r
                ad_w[lo] += full_ * eff_m
                media_w[firms[mf]["city"]] += full_ * eff_m
                media_stat["indirim"] += full_ - r
            else:
                r = L.pay(lo, mf, have * prog["reklam"] * wgt, "reklam")
                ad_rev_all[mf] += r
                ad_w[lo] += r * eff_m
                media_w[firms[mf]["city"]] += r * eff_m
                ad_pay_ema[(lo, mf)] = 0.9 * ad_pay_ema[(lo, mf)] + 0.1 * r
            if MO_ACT and r > 0 and firms[mf].get("org_owner") != ("lonca", lo):
                media_stat["dis_reklam_" + str((firms[mf].get("org_owner") or ("-", "sehir"))[1])] += r
            fee = take_fee(W, mf, firms[mf]["lonca"], r)
            kind_stats["medya"]["rev"] += r - fee
            if MEDIA_ACT and r > 0:
                ad_week[mf] += r
                rev_lb[(firms[mf]["lonca"], "medya")] += r
                if firms[mf].get("lic"):
                    pay_telif(W, mf, firms[mf], r)                  # K-183.6: medya patenti (kanal) lisansı reklam gelirinden telif
        if INNOV_ON and lo in lonca_owner:                        # K-167: kurucu payı lonca sahibi oyuncuya (K-73 yalnız sahipsiz loncalar)
            own_g = L.pay(lo, lonca_owner[lo][0], have * prog["kurucu_payi"], "kurucu_payi")
            owner_rec[lo] += own_g
            L.pay(lonca_owner[lo][0], cities[people[lonca_owner[lo][0]]["city"]]["acct"], OWNER_TAX * own_g, "temettu_vergisi")      # sermaye geliri stopajı (K-127'ye uygun)
        else:
            for c in cities:
                L.pay(lo, c["acct"], have * prog["kurucu_payi"] / len(cities), "kurucu_payi")
        if INNOV_ON:
            contract_pay(W, lo, have * prog["arge"])
        elif ARGE_ON and have * prog["arge"] > 0:
            br = max(BRANCHES, key=lambda b_: rev_lb[(lo, b_)] * BRANCH_WEIGHT.get(b_, 1.0) * ARGE_COEF[b_] / (KN[lo][b_] + 2000.0) ** 0.5)   # lonca dal seçmek zorunda: üyelerinin gelirinin payı × marjinal verim (azalan getiri) × stratejik ağırlık
            if rev_lb[(lo, br)] > 0:
                amt = L.pay(lo, cities[int(lo[5:]) % len(cities)]["acct"], have * prog["arge"], "arge_harcamasi")   # araştırmacı ücretleri şehirde harcanır
                KN[lo][br] += amt
                arge_spent[lo] += amt
            else:
                L.pay(lo, cities[int(lo[5:]) % len(cities)]["acct"], have * prog["arge"], "kurucu_payi")
    kind_stats["medya"]["wc"] += sum(len(firms[mf]["workers"]) for mf in medias)
    kind_stats["lojistik"]["wc"] += sum(nw for j in W.carriers_of for _, nw in W.carriers_of[j])
    L.settle()
