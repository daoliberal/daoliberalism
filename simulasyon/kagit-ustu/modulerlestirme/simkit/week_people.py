"""simkit.week_people: hafta içi insan/firma fazları: göç, kadro, oyuncu firma kuruluşu, yerli talep, döngü hazırlığı.

ARAYÜZ: sm_market, sm_hire_ok, sm_fire_n, sp_hedef, sp_plan, phase_migration, phase_staffing, phase_founding, human_found, phase_domestic, phase_cycle_setup
OKUR/YAZAR: W.
KATMAN: L7.
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from functools import partial
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.lab_meas import lab_ev, lab_stamp, human_cikis, hij_say, hk_snap, hk_yol
from simkit.founding import threshold, worth, young, thr_eff, imp_of
from simkit.credit_core import LR_NEW, home_birak, home_goc_sec, home_goc_sirala, lendable, lo_term, ls_gider, ls_kayit, ls_sec, lt_alacakli, lt_damga, lt_ks_ver, lt_ode
from simkit.credit_meas import ks_karar
from simkit.dao import dao_reloc, dao_step
from simkit.dao_core import pick_lonca
from simkit.credit_core import hire_cash_secure, kopru_limit
from simkit.firm_exit import ox_hafta
from simkit.econ_core import fee_rate, freight, hire_cash_ok, hire_gate, isrole, ahirda, isres, mk_bottleneck, working_capital
from simkit.firms import capex_start
from simkit.housing import house_home_open
from simkit.households import edu_step, health_step
from simkit.human import human_blocked, human_hide, human_unhide, human_olay, human_basvuru_son, note_firm, kur_eksikleri, kur_yeni_yol
from simkit.labor import kadro_kaydet, mgr_step, openings, player_inflow_all, pop_ahir_player, restaff
from simkit.sector_core import sb_hire_ok, board_stat_add, mk_share
from simkit.tech_core import prod_mult
from simkit.entry_open import eo_pre_week, eo_organic, eo_found, eo_input_ok
from simkit.entry_exp import ee_organic, ee_picks, ee_note, ee_merge
from simkit.young_core import is_fund_lo, yk_young
from simkit.young_kit import yk_fund_step, yk_firm_pre, yk_hire, yk_release_note
from simkit.lonca import fee_step, insan_lonca_kur, lonca_yonet_step, lonca_step, nl_step, switch_step, welf_step


def sm_market(W, d, f=None):
    """te-denge G1 SELL_MATCH, sahipli market: kadro karşılığı (kişi, kesirli) ya da None (talep kaydı ya da pay yok) = pay x D'. D' = şehir market talebinin gerektirdiği kadro x (1 + OM_BUF); talep ölçüsü labor.staffing'in market hedefiyle aynı (units = mk_dem_units_prev (SVC_DIRECT) ya da dem_units_prev, / CYCLES_PER_WEEK / STORE_UNITS_PER_WORKER). pay = hane ödemesinin bu markete düşen payı (week_cycle_parts.mk_share): gelir kadroyla değil hane payıyla gelir, bu yüzden şişmiş market de yakalanır."""
    c = W.cities[d["city"]]
    k = "mk_dem_units_prev" if SVC_DIRECT else "dem_units_prev"
    if k not in c:
        return None
    if f is None:
        f = next((k_ for k_, v_ in W.firms.items() if v_ is d), None)
    pay = mk_share(W, d["city"], f)
    if pay is None:
        return None
    return pay * c[k] / CYCLES_PER_WEEK / STORE_UNITS_PER_WORKER * (1.0 + OM_BUF)


def sm_hire_ok(W, d, f=None):
    """te-ist SELL_MATCH: sahipli firma işe alımı. Doğru: art arda SM_HIRE_WEEKS hafta ürün tükendi (sm_so) ya da beklenen satış × (1 + OM_BUF) mevcut kadronun kapasitesini (oran × kafa) aşıyor. Geçen haftanın satışı yoksa (ilk hafta) bilgi yok: eski kural. Bayrak kapalıyken her zaman True."""
    if not SELL_MATCH:
        return True
    if d["kind"] == "market":                                                 # te-denge G1: market reçetesiz; beklenen talep x (1 + OM_BUF) şehir market kadrosunu aşıyorsa alım
        if RETAIL_SHARE and not d["workers"]:
            return True                                                       # te-rekabet G8: işçisiz sahipli market yeniden açılabilmeli (payı 0 olduğundan kar 0'dır; elenme anlık kadro boşluğundan değil pay rekabetinden gelir)
        kar = sm_market(W, d, f)
        return kar is None or kar > len(d["workers"])
    if d.get("sm_so", 0) >= SM_HIRE_WEEKS:
        return True
    sp = d.get("sold_prev")
    if sp is None:
        return True
    rate = next(iter(W.RECIPES[d["kind"]][0].values())) * d.get("tech", 1.0) * prod_mult(W, d)       # dönem içi üretim planındaki kişi başı oran
    return sp / CYCLES_PER_WEEK * (1.0 + OM_BUF) > rate * len(d["workers"])


def sm_fire_n(W, d, f=None):
    """te-denge G1 SELL_MATCH küçülme: sahipli firmanın kadrosu, beklenen satışın (d["sm_des"], döngülük) karşılığı olan kafa sayısının altına SE_FIRE_K hafta üst üste inmediyse 0; sonra haftada en çok SE_FIRE_FRAC x kadro (en az 1 kişi), karşılığın altına inmeden çıkarılacak kişi sayısı. NPC'nin se_hold sürtünmesiyle aynı kural. Yalnız SELL_MATCH açıkken çağrılır; durum d["sm_below"]."""
    n = len(d["workers"])
    if d["kind"] == "market":                                                 # sahipli market: kadro karşılığı = şehir talebinin kadro payı x (1 + OM_BUF) (sm_plan nostock karşılığı)
        kar = sm_market(W, d, f)
        if kar is None or n <= 1:
            d["sm_below"] = 0
            return 0
        need = max(1, int(-(-kar // 1)))
    else:
        des = d.get("sm_des")
        if des is None or n <= 1:
            d["sm_below"] = 0
            return 0
        rate = next(iter(W.RECIPES[d["kind"]][0].values())) * d.get("tech", 1.0) * prod_mult(W, d)
        need = max(1, int(-(-des // rate))) if rate > 0 else n
    if d.get("insan_hedef") and HIRE_TARGET and (HIRE_CASH_GATE or HIRE_GATE_ALL):
        need = max(need, d["insan_hedef"])                                        # REKABET G17i: insanın kadro kararı bot küçülme sezgisini geçersiz kılar. CANLI kol (son inceleme K3 yanlış okundu): ih_ ile hedefe inmiş ya da hedefin altındaki firma (len <= ih_) phase_founding'de bu işleve ulaşır; kol kalkarsa bot sezgisi insanın hedef kadrosunu küçültür
    if n <= need:
        d["sm_below"] = 0
        return 0
    d["sm_below"] = d.get("sm_below", 0) + 1
    if d["sm_below"] < SE_FIRE_K:
        return 0
    return min(n - need, max(1, int(n * SE_FIRE_FRAC)))


def sp_hedef(W, d, f=None):
    """REKABET G17c (HIRE_TARGET): sahipli firmanın bu haftaki açık kadro hedefi (kişi) ya da None. Mal üreten tür: ceil(sold_prev / CYCLES_PER_WEEK × (1 + OM_BUF) / oran) (oran = kişi başı dönem içi üretim; sm_fire_n ile aynı tavan yuvarlama); art arda SM_HIRE_WEEKS hafta tükendi (sm_so) ise en az kadro + 1. Market: ceil(sm_market). Kapasiteyle sınırlıdır.
    None: SELL_MATCH kapalı, beklenen hesaplanamıyor (ilk hafta, satış kaydı olmayan tür: medya vb.); çağıran firmayı eski yoldan geçirir. SAF okuma."""
    if not SELL_MATCH:
        return None
    n = len(d["workers"])
    if d["kind"] == "market":
        kar = sm_market(W, d, f)
        if kar is None:
            return None
        o = int(-(-kar // 1))
        if RETAIL_SHARE and not d["workers"]:
            o = max(o, 1)                                                     # sm_hire_ok ile aynı: işçisiz sahipli market yeniden açılabilmeli
    else:
        sp = d.get("sold_prev")
        if sp is None or not W.RECIPES[d["kind"]][0]:
            return None
        rate = next(iter(W.RECIPES[d["kind"]][0].values())) * d.get("tech", 1.0) * prod_mult(W, d)
        if rate <= 0:
            return None
        o = int(-(-(sp / CYCLES_PER_WEEK * (1.0 + OM_BUF)) // rate))
        if d.get("sm_so", 0) >= SM_HIRE_WEEKS:
            o = max(o, n + 1)
    return min(o, d["capacity"])


def sp_plan(W, d, w, h0):
    """REKABET G17c/G17d: firmanın bu haftanın kadro planı d["sp_hedef"] (+ d["sp_hedef_w"] = w damgası; kredi ve temettü fazları bayat hedefi okumasın) yazılır ve döner. h0: sp_hedef sonucu (HIRE_TARGET açıkken) ya da None; None ise plan kadro < kapasite için kadro + 1, değilse kadro
    (HIRE_TARGET kapalıyken: işe alım kapıları sb_hire_ok ve sm_hire_ok geçildiğinde bugünkü kural en çok bir kişi). Kapılara takılan ve küçülen firmada çağrılmaz: hedef = kadro (çağıran haftanın başında yazar). Bayrak açıkken (HIRE_TARGET ya da GROW_PURPOSE) her hafta çağrılır."""
    n = len(d["workers"])
    d["sp_hedef"] = h0 if h0 is not None else (n + 1 if n < d["capacity"] else n)
    d["sp_hedef_w"] = w
    d["sp_ht"] = h0 is not None                                                       # plan firmanın kendi kadro hedefinden mi (temettü tutması yalnız bu planda)
    return d["sp_hedef"]


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
        c["mk_dem_units_prev"] = c.get("mk_dem_units", 0.0)
        c["mk_dem_units"] = 0.0
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
                    q = cities[src]["pool"].pop(home_goc_sec(W, cities[src]["pool"]) if HOME_OWN else 0)       # REKABET G12: ev sahibi olmayan haneler önce taşınır (sıra tercihi, yasak değil)
                    if HOME_OWN:
                        home_birak(W, q)                                 # REKABET G12: göç eden ev sahibinin evi eski şehirde kiralık birime döner
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
            if HOME_OWN:
                movers = home_goc_sirala(W, movers)                   # REKABET G12: ev sahibi olmayanlar önce (sıra tercihi)
            movers = movers[:int(len(movers) * PLAYER_MIGRATE_SHARE + 0.9999)]
            for q in movers:
                j = max(room, key=lambda x: room[x])
                if room[j] <= 0 or j == c["i"]:
                    break
                c["seekers"].remove(q)
                c["players"].remove(q)
                cities[j]["seekers"].append(q)
                cities[j]["players"].append(q)
                if HOME_OWN:
                    home_birak(W, q)                                     # REKABET G12
                people[q]["city"] = j
                jobless[q] = 0
                room[j] -= 1
                L.flows["goc_oyuncu"] += 1
    if INNOV_ON:
        welf_step(W, w)
        lonca_step(W, w)
        nl_step(W, w)
        if HUMAN_LONCA:
            insan_lonca_kur(W, w)                                # F3: insanın lonca_kur kararı (bot kuruluşundan sonra, aynı hafta)
        dao_reloc(W, w)
        if LONCA_TERMS:
            lonca_yonet_step(W, w)                               # REKABET G5: bot lonca yöneticisi (kredi faizi farkı, risk iştahı, mevduat payı; fee_step'ten önce, fee'ye dokunmaz)
        fee_step(W, w)
        switch_step(W, w)
        dao_step(W, w)
        mgr_step(W, w)
        if REP_EFFECT:                                           # K-11: işe alımda itibar önceliği
            for c in cities:
                c["seekers"].sort(key=lambda q: -REP[q])
    elif HUMAN_LONCA and W.human_lonca_kur is not None:
        human_olay(W, w, "lonca_kurulamadi", yol=W.human_lonca_kur, neden=["kapali"])      # F3: lonca sistemi kapalı (INNOV_ON=0): karar sessizce düşmez
        W.human_lonca_kur = None


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
    eks_ = kur_eksikleri(W, h, w, kind)
    ok = not eks_                                            # şartların tek kaynağı (gozlem.kurabilir de bunu çağırır)
    prod = PROD_OF.get(kind, kind)                                             # M15: "market" ürünsüz tür (anahtar = tür adı)
    if ok and yeni and kind != "market" and not eo_input_ok(W, prod):
        ok = False                                                             # girdisi hiçbir şehirde üretilmiyor: kurulamaz
    if not ok:
        human_olay(W, w, "kurulamadi", sektor=kind, neden="bekleme" if eks_ == ["bekleme"] else "sart")
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
    if OWNER_EXIT:
        ox_hafta(W, w)                                               # REKABET G17h (son inceleme Ö1): zarardaki bot firmanın kapanış kararı işe alımdan ÖNCE (insanın `ayril` yoluyla aynı sıra); kapanan firma o hafta alım/kredi yapmaz
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
            if MARKET_OPEN and not (ENTRY_OPEN or (ENTRY_EXP and EE_REPLACE)) and w - LAST_ENTRY.get((c["i"], "market"), -999) >= ENTRY_COOLDOWN and mk_bottleneck(W, c) > MK_BOTTLE:
                imp.insert(0, (mk_bottleneck(W, c), "market"))             # M15: eski (lonca kredili) yolda market kapasite darbogazi kurulus sinyalidir; ENTRY_OPEN yolunda eo_organic ekler
            cands = [p for p in c["players"] if (people[p]["firm"] or (ENTRY_JOBLESS and p in c["seekers"])) and worked[p] >= FOUND_WORKED and not people[p].get("founder")
                     and (ENTRY_OPEN or L.bal[p] >= ix(W, FOUND_HARC)) and not isres(people[p]) and not (HUMAN_ON and p == W.human) and not (ENTRY_JOBLESS and ahirda(W, p))]      # K-98: harcı biriktirmiş olmak; DAO oyunu: insan kendiliğinden kurucu olmaz
            if ENTRY_EXP and EE_FIN_OLD and not ENTRY_OPEN:
                imp = ee_picks(W, w, c, cands) if EE_REPLACE else ee_merge(imp, ee_picks(W, w, c, cands))                              # beklenen kâr seçer; finansman eski yolda (kendi birikimi harç + lonca kredisi)
            if HUMAN_ON and W.human_kur is not None:
                human_found(W, w, c)                                              # yeni yolda doğrudan kurar; eski yolda sektör W.human_go'da
                if W.human_go is not None:
                    imp.insert(0, (max((v_ for v_, _ in imp), default=0.0) + 1.0, PROD_OF.get(W.human_go, W.human_go)))      # M15: market ürünsüz tür
                    cands.insert(0, W.human)
            _g25 = NOW[0] // 25 * 25
            gate[(_g25, "sinyal_esik")] += sum(1 for p, v in sig.items() if p in PRODUCER and PRODUCER[p] != "ahir" and v >= threshold(W, p))
            gate[(_g25, "sinyal_worth_gecen")] += len(imp)
            gate[(_g25, "hafta_sehir")] += 1
            gate[(_g25, "oyuncu_toplam")] += len(c["players"])
            gate[(_g25, "o_calisan")] += sum(1 for p in c["players"] if people[p]["firm"])
            gate[(_g25, "o_worked")] += sum(1 for p in c["players"] if people[p]["firm"] and worked[p] >= FOUND_WORKED)
            gate[(_g25, "o_harc")] += sum(1 for p in c["players"] if people[p]["firm"] and worked[p] >= FOUND_WORKED and L.bal[p] >= ix(W, FOUND_HARC))
            gate[(_g25, "aday_son")] += len(cands)
            if imp and not cands:
                for _v, _p in imp:
                    chain[(_sl, _p)]["kurucu_yok"] += 1
                if WEEKLY_CSV:
                    W.WKC["kurucu_yok"] += len(imp)
            for lo in ((loncas[:1] if LONCA_SELECT else loncas) if not (ENTRY_OPEN or (ENTRY_EXP and EE_REPLACE and not EE_FIN_OLD)) else ()):                 # K-213: ENTRY_OPEN'da kuruluş eo_organic/eo_found yolunda; REKABET G4 LONCA_SELECT: kurucu tüm loncalardan teklif ister (ls_sec), döngü tek tur
                n_lo = 0                                              # inceleme: tek lonca haftanın tüm kurucularını tüketmesin
                tried_ = []                                           # REKABET G4: bu sektörde reddedilen kurucular (sıradaki aday aynı sektörü deneyebilsin)
                sek_riskli_ = False                                   # bu sektör başvurusunda en az bir ret riskle mi
                while imp and cands and n_lo < FOUND_PER_LONCA * (len(loncas) if LONCA_SELECT else 1):
                    v, prod = imp[0]
                    kind = "market" if prod == "market" else PRODUCER[prod]
                    founder = cands[0]
                    fname = f"s{c['i']}_{kind}_oy{L.flows['kurulan_oyuncu_firmasi_adet']:.0f}"
                    firms[fname] = dict(kind=kind, city=c["i"], lonca=lo, workers=[], owner=founder, capacity=CAP_OTHER, capitalized=True, born=w)
                    if PATH_ACT and people[founder].get("innov"):
                        firms[fname]["innov_owner"] = True               # K-170: inovatör firma sahibi
                    wc_need = FOUND_BUF * working_capital(W, firms, people, fname, extra_workers=1)
                    if FOUND_WC_REAL and not FOUNDER_DEFER:             # M2.1: kurucunun gerçek ücreti ilk haftaların sermayesine girer
                        wc_need += FOUND_BUF * WORKING_CAPITAL_CYCLES * max(0.0, people[founder]["wage"] - TIER_WAGE[0])
                    if INNOV_ON:                                          # K-167: firma loncayı telif indirimi ve krediye göre seçer
                        ok_ = [l_ for l_ in loncas if l_ not in closed and lendable(W, l_) + (L.bal[founder] - ix(W, FOUND_HARC)) >= wc_need]
                        lo = pick_lonca(W, kind, ok_ or [l_ for l_ in loncas if l_ not in closed])
                        firms[fname]["lonca"] = lo
                        if NL_ACT and lo in new_slots:
                            firms[fname]["ever_new"] = True
                    ls_ = None
                    if LONCA_SELECT:                                      # REKABET G4: her lonca batma olasılığına göre teklif verir ya da risk sebebiyle reddeder; en ucuz teklif seçilir, kimse vermezse kurucu nakdi yetiyorsa kendi parasıyla kurar
                        ls_ = ls_sec(W, w, c["i"], kind, founder, wc_need, ls_gider(W, fname), L.bal[founder] - ix(W, FOUND_HARC), min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[founder] / 100)) if (INNOV_ON and REP_EFFECT) else 1.0)
                        if ls_[0] is None and L.bal[founder] - ix(W, FOUND_HARC) >= wc_need:
                            lo = pick_lonca(W, kind, [l_ for l_ in loncas if l_ not in closed] or list(loncas))      # kendi parasıyla kurulan firma da bir loncaya üye olur (kredi 0)
                            ls_ = (None, 0.0, ls_[2], False, [])
                            ks_karar(W, "kendi")
                            if WEEKLY_CSV:
                                W.WKC["kendi_parasiyla"] += 1
                        elif ls_[0] is not None:
                            lo = pick_lonca(W, kind, ls_[4]) if (INNOV_ON and len(ls_[4]) > 1) else ls_[0]      # faiz farkı varsa en ucuz; EŞİTKEN eski kural (K-167 pick_lonca)
                        firms[fname]["lonca"] = lo
                        firms[fname].pop("ever_new", None)                 # INNOV_ON'un ön seçimi geçersiz; yeni loncaya göre yeniden
                        if NL_ACT and lo in new_slots:
                            firms[fname]["ever_new"] = True
                    grant = lendable(W, lo) if not (ls_ is not None and ls_[0] is None) else 0.0
                    if INNOV_ON and REP_EFFECT and not FOUND_COLLAT:      # K-11: kredi limiti itibara bağlı (FOUND_COLLAT: teminatlı kuruluş kredisi, itibar yalnız faizi etkiler)
                        grant = min(grant, wc_need * min(1.0, CM_BASE + (1 - CM_BASE) * REP[founder] / CM_REP))
                    if WEEKLY_CSV:
                        W.WKC["kredi_basvuru"] += 1
                        W.WKC["tavan_orani_toplam"] += (grant + (L.bal[founder] - ix(W, FOUND_HARC))) / max(1e-9, wc_need)
                    if ENTRY_EXP and EE_FIN_OLD:
                        grant = min(grant, (1.0 - EE_OWN) * wc_need)               # kurucu sermayenin en az EE_OWN payını kendi birikiminden koyar (kalanı lonca kredisi)
                    if KR_MEAS and not LONCA_SELECT:                            # REKABET G4: davranışsız ret sebebi sayımı (eski yol; LONCA_SELECT'te ls_sec sayar)
                        ls_kayit(W, w, lo, c["i"], kind, ls_gider(W, fname), None if grant + (L.bal[founder] - ix(W, FOUND_HARC)) >= wc_need else ("kasa_yetersiz" if lendable(W, lo) + (L.bal[founder] - ix(W, FOUND_HARC)) < wc_need else "limit"))
                    if grant + (L.bal[founder] - ix(W, FOUND_HARC)) < wc_need:
                        del firms[fname]
                        riskli_ = ls_ is not None and ls_[3]                    # REKABET G4: en az bir lonca riskle reddetti, kimse vermedi
                        if ls_ is None or (HUMAN_ON and founder == W.human):    # karar düzeyi: eski yol ve insan, her ret bir başvuru; LONCA_SELECT botunda sektör başvurusu sonuçlanınca (aşağıda) tek sayım
                            ks_karar(W, "ret")
                            if riskli_:
                                ks_karar(W, "riskli")
                        if HUMAN_ON and founder == W.human:
                            human_olay(W, w, "kurulamadi", sektor=kind, neden="riskli" if riskli_ else "kredi")      # insan ve sektörü çıkar; botlar o hafta engellenmez
                            W.human_go = None
                            cands.pop(0)
                            imp.pop(0)
                            continue
                        gate[(NOW[0] // 25 * 25, "kredi_yetersiz")] += 1
                        if WEEKLY_CSV:
                            W.WKC["kredi_ret"] += 1
                            W.WKC["ret_" + kind] += 1
                            if riskli_:
                                W.WKC["riskli_ret"] += 1                       # nd_havuz/nd_itibar riskli retle artmaz; ad "ret_" ile başlamaz (measure.py sektör reti sanmasın)
                            else:
                                W.WKC["nd_" + ("havuz" if lendable(W, lo) + (L.bal[founder] - ix(W, FOUND_HARC)) < wc_need else "itibar")] += 1
                        chain[(_sl, prod)]["kredi_yetersiz"] += 1
                        if ls_ is not None:                                    # REKABET G4: lonca reddi (risk, kasa, limit) yalnız KREDİLİ kuruluşu engeller: sektör sırada kalır, sıradaki (nakdi yeten) aday aynı sektörü dener; hepsi reddedilirse sektör düşer
                            tried_.append(cands.pop(0))
                            sek_riskli_ = sek_riskli_ or riskli_
                            if not cands:
                                ks_karar(W, "ret")                             # sektör başvurusu reddedildi: tek sayım
                                if sek_riskli_:
                                    ks_karar(W, "riskli")
                                sek_riskli_ = False
                                imp.pop(0)
                                cands.extend(tried_)
                                tried_.clear()
                            continue
                        break
                    ks_karar(W, "kendi_karar" if (ls_ is not None and ls_[0] is None) else "onay")         # sektör başvurusu sonuçlandı (önceki adayların retleri aynı başvurudur)
                    sek_riskli_ = False
                    W.__dict__.pop("_ls_memo", None)                          # kuruluş hücreyi değiştirdi: ls_hucre önbelleği sıfırlanır
                    L.pay(founder, c["acct"], ix(W, FOUND_HARC), "kurulus_harci")       # K-33: harç oyuncudan şehre
                    W.g = min(grant, wc_need)
                    if CREDIT_ON and W.g > 0:                                       # K-158: lonca sermayesi kredidir (geri döner, faiz getirir)
                        ln_ = W.g * LOAN_SHARE
                        L.pay(f"{lo}_sermaye", fname, W.g - ln_, "sermaye")
                        L.pay(f"{lo}_sermaye", fname, ln_, "kredi_verilen")
                        loans[fname] = dict(lo=lo, p0=ln_, out=ln_, miss=0, rate=LR_NEW(W) * (min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[founder] / 100)) if (INNOV_ON and REP_EFFECT) else 1.0), tur="kurulus")
                        if LONCA_SELECT and ls_ is not None and ls_[0] is not None:
                            loans[fname].update(rate=ls_[1], pd=ls_[2], spread=lo_term(W, lo, "spread"))        # REKABET G4: risk fiyatı, kestirilen batma olasılığı ve açılış spread'i kredi kaydında (yeniden fiyatlama korur)
                        if CX_ACT:
                            L.flows["kredi_kurulus_adet"] += 1
                            cx_stat["hacim_kurulus"] += ln_
                        L.flows["kredi_adet"] += 1
                        if LONCA_TERMS:
                            if "pd" in loans[fname]:
                                lt_ks_ver(W, lo, ln_)                   # REKABET G5: risk_tol girdisi yalnız loncanın KENDİ risk elemesinden geçen (pd'li) kuruluş kredileri
                            else:
                                lt_damga(W, fname, loans[fname], ln_)   # pd'siz kuruluş: tek açılış damgası
                        if KR_MEAS:                                    # REKABET G0: davranışsız ölçüm (verilen kuruluş kredisi tutarı)
                            W.lo_stat["ks_verilen"] += ln_
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
                    if tried_:                                             # REKABET G4: bu sektörde riskle reddedilen kurucular sıradaki sektörü yine dener
                        cands[0:0] = tried_
                        tried_.clear()
                    if prod != "market":
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
                if (HUMAN_ON or OWNER_EXIT) and d.get("kapaniyor"):
                    continue                                                           # DAO oyunu: sahibi ayrılan (kapanmakta olan) işletme işçi almaz (REKABET G17h: bot sahibin OWNER_EXIT kararıyla kapanan firma da)
                if HIRE_TARGET or GROW_PURPOSE:
                    d["sp_hedef"], d["sp_hedef_w"], d["sp_ht"] = len(d["workers"]), w, False   # REKABET G17c/G17d: haftanın başında plan = mevcut kadro; kapıları geçen firma aşağıda sp_plan ile yeniden yazar
                hk_ = hk_snap(W, w, c, fname, d, _HK_FN) if KR_MEAS else None           # REKABET G17a: davranışsız işe alım kapı dökümü (saf okuma)
                if KR_MEAS or HUMAN_ON:
                    W.staff_tgt[fname] = len(d["workers"])                              # davranışsız kayıt (§4.6): işe alım koşulu sağlanmazsa hedef = mevcut kadro
                yk_ = YOUNG_KIT and yk_young(W, d) and bool(d["workers"])                # K-216: genç oyuncu firması
                if yk_:
                    yk_firm_pre(W, w, c, fname, d)                                        # EMA, açılış reklamı, nakit iadesi, dayanma limitinden çekim
                ih_ = max(1, min(d["insan_hedef"], d["capacity"])) if (HIRE_TARGET and (HIRE_CASH_GATE or HIRE_GATE_ALL) and d.get("insan_hedef")) else None      # REKABET G17i: insanın kadro kararı (yoksa None: bot sezgisi)
                if CREDIT_ON and GROW_LOAN and (not CX_ACT or (yk_ and not FOUND_FUND)) and len(d["workers"]) < d["capacity"] and c["seekers"]:       # K-158: büyüme kredisi (sağlıklı firma: kasası eşiğe yakın; kaldıraç sınırlı); K-216 (6): genç firmada kasa şartı yok (borç tavanı kalır)
                    wc1 = working_capital(W, firms, people, fname, 1)
                    gap = GROW_FACTOR * wc1 - L.bal[fname]
                    ln_ = loans.get(fname)
                    out_ = ln_["out"] if ln_ else 0.0
                    lo_g = lt_alacakli(W, fname) if LONCA_TERMS else d["lonca"]            # REKABET G5 (Y2): tranşı kaydın ALACAKLISI öder
                    if lo_g is not None and (0 < gap if yk_ else 0 < gap <= (1 - GROW_LOAN_MIN) * GROW_FACTOR * wc1) and out_ + gap <= LOAN_LEV * wc1 and gap <= lendable(W, lo_g) and (not ln_ or (ln_["miss"] == 0 and not is_fund_lo(ln_["lo"]))):
                        if LONCA_TERMS:
                            lo_g, gap = lt_ode(W, fname, gap, w)                                # devir yapılır, SONRA ödeyenin lendable'ıyla kısılan tutar ödenir; kayda fiilen ödenen yazılır
                        else:
                            L.pay(f"{lo_g}_sermaye", fname, gap, "kredi_verilen")
                        if gap > 1e-9:
                            if ln_:
                                ln_["p0"] += gap
                                ln_["out"] += gap
                                if KR_MEAS and ln_.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen kredi)
                                    W.lo_stat["ks_verilen"] += gap
                            else:
                                loans[fname] = dict(lo=lo_g, p0=gap, out=gap, miss=0)
                            if LONCA_TERMS:
                                lt_damga(W, fname, loans[fname], gap)                           # REKABET G5: tek açılış damgası (oran lo_oran)
                            L.flows["buyume_kredisi_adet"] += 1
                if ih_ is not None and len(d["workers"]) > ih_:                           # REKABET G17i: işten çıkarma insanın kararıdır: haftalık sınır yok, hedef kadronun altındaysa o hafta hedefe inilir; en düşük itibarlı önce (bot küçültmesiyle aynı sıra)
                    cand_ = [q_ for q_ in d["workers"] if q_ != d["owner"] and not isrole(people[q_])]
                    for q_ in sorted(cand_, key=lambda x_: REP[x_])[:len(d["workers"]) - ih_]:
                        d["workers"].remove(q_)
                        if KR_MEAS:
                            lab_ev(W, "cikis_kuculme", fname)
                        people[q_]["firm"] = None
                        if HUMAN_ON:
                            human_cikis(W, q_, "kucultme")
                            human_olay(W, w, "firmam_kuculdu", firma=fname, kisi=q_, neden="karar")      # sahibin kendi kararıyla çıkardığı kişi
                        (c["pool"] if people[q_]["who"] == "npc" else c["seekers"]).append(q_)
                        L.flows["insan_kadro_cikis_kisi"] += 1
                        if yk_:
                            yk_release_note(W, w, d, q_)                                   # K-216 (2): alım/çıkarma salınımı sayacı (bot küçültmesiyle aynı)
                    d["sp_hedef"] = len(d["workers"])                                      # çıkarma haftasında plan güncel (ölçüm okur)
                    W.staff_tgt[fname] = len(d["workers"])
                    if KR_MEAS:
                        hk_yol(W, hk_, "insan")
                    continue
                if SHRINK_FIRST and ih_ is None and len(d["workers"]) > 1 and prof_ema[fname] < 0 and L.bal[fname] < SHRINK_WEEKS * CYCLES_PER_WEEK * sum(people[q_]["wage"] for q_ in d["workers"]):
                    cand_ = [q_ for q_ in d["workers"] if q_ != d["owner"] and not isrole(people[q_])]
                    if cand_:
                        q_ = min(cand_, key=lambda x_: REP[x_])
                        d["workers"].remove(q_)
                        if KR_MEAS:
                            lab_ev(W, "cikis_kuculme", fname)              # davranışsız sayaç (§4.6)
                        people[q_]["firm"] = None
                        if HUMAN_ON:
                            human_cikis(W, q_, "kucultme")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
                            if d["owner"] == W.human:
                                human_olay(W, w, "firmam_kuculdu", firma=fname, kisi=q_, neden="zarar")      # rekabet G1: zarardan küçülme sahibe görünür
                        (c["pool"] if people[q_]["who"] == "npc" else c["seekers"]).append(q_)
                        L.flows["kuculme_oyuncu_kisi"] += 1
                        if yk_:
                            yk_release_note(W, w, d, q_)                                   # K-216 (2): alım/çıkarma salınımı sayacı
                    if KR_MEAS:
                        hk_yol(W, hk_, "shrink")
                    continue
                if SELL_MATCH and not yk_ and (k_ := sm_fire_n(W, d, fname)) > 0:                          # te-denge G1 (SB bekletmesinden ÖNCE: sektör stok fazlası satışı düşürdüğünde çıkarma kapanmasın): beklenen satış kadroyu SE_FIRE_K hafta doyurmuyor: kademeli küçülme (SHRINK_FIRST çıkarma yoluyla aynı)
                    cand_ = [q_ for q_ in d["workers"] if q_ != d["owner"] and not isrole(people[q_])]
                    for q_ in sorted(cand_, key=lambda x_: REP[x_])[:k_]:
                        d["workers"].remove(q_)
                        if KR_MEAS:
                            lab_ev(W, "cikis_kuculme", fname)
                        people[q_]["firm"] = None
                        if HUMAN_ON:
                            human_cikis(W, q_, "kucultme")
                            if d["owner"] == W.human:
                                human_olay(W, w, "firmam_kuculdu", firma=fname, kisi=q_, neden="satis")      # insanın işletmesi beklenen satışa göre küçüldü (sahibe olay)
                        (c["pool"] if people[q_]["who"] == "npc" else c["seekers"]).append(q_)
                        L.flows["sm_kuculme_kisi"] += 1
                    if KR_MEAS or HUMAN_ON:
                        W.staff_tgt[fname] = len(d["workers"])
                    if KR_MEAS:
                        hk_yol(W, hk_, "smfire")
                    continue
                if SECTOR_BOARD and not yk_ and ih_ is None and not sb_hire_ok(W, d):             # v13.0: genç firma kendi sipariş/pano kıtlığına göre alır (yk_target); sektör stoku bekletmesi uygulanmaz
                    board_stat_add(W, "oyuncu_ise_alim_bekle")      # K-212: sektör stoku fazla, kıtlık yok: işe alım beklet
                    if KR_MEAS:
                        hk_yol(W, hk_, "sb")
                    continue
                if SELL_MATCH and not yk_ and ih_ is None and not sm_hire_ok(W, d, fname):                       # te-ist G2: beklenen satış kadroyu doyurmuyor ve kalıcı tükenme yok: işe alım bekle (staff_tgt = mevcut kadro, ilan görünmez)
                    if KR_MEAS:
                        hk_yol(W, hk_, "sm")
                    continue
                if yk_ and ih_ is None:                                                   # K-216 (2): talebe bağlı işe alım (haftada birden çok; kasa şartı yok, limit)
                    if HIRE_TARGET or GROW_PURPOSE:
                        sp_plan(W, d, w, None)                                            # genç kit kendi hedefini kullanır; kredi planı için kadro + 1
                    yk_hire(W, w, c, fname, d, partial(_yk_take, W, c, fname))
                    if KR_MEAS:
                        hk_yol(W, hk_, "yk")
                    continue
                ht_ = (ih_ if ih_ is not None else sp_hedef(W, d, fname)) if (HIRE_TARGET and (HIRE_CASH_GATE or HIRE_GATE_ALL)) else None      # REKABET G17c: firmanın açık kadro hedefi (None: eski yol); G17i: insanın kadro kararı bot hedefinin yerine geçer
                if HIRE_TARGET or GROW_PURPOSE:
                    sp_plan(W, d, w, ht_)
                if ht_ is not None:
                    al_, acik_, kasa_ = 0, False, False
                    while len(d["workers"]) < ht_:
                        if not _kaynak_var(W, c, fname):
                            acik_ = True                                                   # aday yok: köprü kredisi (hire_cash_secure fiilen çeker) kapıya gelmeden durulur
                            break
                        if L.bal[fname] + kopru_limit(W, fname) < working_capital(W, firms, people, fname, 1) or not hire_cash_secure(W, fname):
                            kasa_ = True
                            break                                                          # her kişide kasa + köprü limiti çarpansız işletme sermayesini ve bir haftalık ücreti karşılamalı; geçemeyen ilk kişide durulur (GROW_FACTOR uygulanmaz)
                        q = _yk_take(W, c, fname)                                          # kişi kaynağı bugünkü sırayla (iş arayan oyuncu, ahır, NPC havuzu)
                        if q is None:
                            acik_ = True                                                   # işçi kalmadı: bu firma durur, şehrin kalan firmaları işlenir (bugünkü break şehri atlıyordu)
                            break
                        d["workers"].append(q)
                        if KR_MEAS:
                            lab_ev(W, "ise", fname)
                            if hk_ is not None and al_ == 0:
                                hk_["src"] = people[q]["who"]
                        people[q].update(firm=fname, avans=True)
                        hij_say(W, "ise", q)
                        al_ += 1
                    if KR_MEAS or HUMAN_ON:
                        W.staff_tgt[fname] = ht_ if acik_ else len(d["workers"])           # davranışsız kayıt (§4.6): işçi bulunamadıysa açık kadro ilanda kalır
                    if KR_MEAS:
                        hk_yol(W, hk_, "ise" if al_ else ("isci_yok" if acik_ else ("kasa_kap" if kasa_ else "hedefte")))      # hedefte: kadro zaten hedefte (kapıya gelinmedi)
                    continue
                if (KR_MEAS or HUMAN_ON) and L.bal[fname] >= GROW_FACTOR * working_capital(W, firms, people, fname, 1) and hire_cash_ok(W, fname, L.bal[fname]):   # son düzeltme I3: kasa kapısı ilanı kesiyorsa hedef = mevcut kadro
                    W.staff_tgt[fname] = max(d["capacity"], len(d["workers"]))           # davranışsız kayıt (§4.6): koşul sağlanıyorsa hedef kapasite
                if len(d["workers"]) < d["capacity"] and L.bal[fname] >= GROW_FACTOR * working_capital(W, firms, people, fname, 1) and hire_cash_secure(W, fname):
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
                        if KR_MEAS:
                            hk_yol(W, hk_, "isci_yok")
                            rest_ = [x_ for x_ in player_firms if firms[x_]["city"] == c["i"] and not firms[x_].get("dead") and not ((HUMAN_ON or OWNER_EXIT) and firms[x_].get("kapaniyor"))]
                            for f_hk in rest_[rest_.index(fname) + 1:]:
                                hk_yol(W, hk_snap(W, w, c, f_hk, firms[f_hk], _HK_FN), "ulasilmadi")      # döngü bu şehirde kesildi: kalan firmalar karara varmadı; kapı alanlarıyla "ulasilmadi" yazılır (sayaçları sıfırlanır)
                        break
                    d["workers"].append(q)
                    if KR_MEAS:
                        lab_ev(W, "ise", fname)                            # davranışsız sayaç (§4.6)
                        if hk_ is not None:
                            hk_["src"] = people[q]["who"]
                    people[q].update(firm=fname, avans=True)
                    hij_say(W, "ise", q)                                 # hijyen ölçümü (davranışsız)
                    if KR_MEAS:
                        hk_yol(W, hk_, "ise")
                if KR_MEAS:
                    hk_yol(W, hk_, "kasa_kap")
    if HUMAN_ON:
        human_basvuru_son(W, w)                                    # DAO oyunu: insanın başvurusu bu haftanın bütün işe alım adımlarından (dao_step, restaff, oyuncu işletmeleri) sonra sonuçlanır; çevrimlerden önce


def _kaynak_var(W, c, fname):
    """REKABET G17c: _yk_take'in bu firma için kişi bulup bulamayacağının yan etkisiz ön denetimi (iş arayan, ahır oyuncusu, NPC havuzu); insan yalnız bu firmaya başvurduysa iş arayan sayılır. SAF okuma."""
    h = W.human
    b = W.human_basvuru if h is not None else None
    if any(x != h or (b is not None and b["firma"] == fname and not human_blocked(W, h, fname)) for x in c["seekers"]):
        return True                                                                      # N1: iş arayan insan yalnız bu firmaya başvurduysa ve geri alım engelinde değilse (human_hide ölçütü)
    if b is not None and b["firma"] == fname and h not in c["seekers"] and b.get("eski") is not None and W.people[h]["firm"] == b["eski"] and W.firms[b["eski"]]["kind"] != "ahir" and not human_blocked(W, h, fname):
        return True                                                                      # N1: çalışan insan bu firmaya iş değiştirmek için başvurdu (human_hide/_birak ölçütü)
    for a in c["firms"]:
        e = W.firms[a]
        if e["kind"] == "ahir" and len(e["workers"]) > AHIR_HERD_WORKERS and any(W.people[x]["who"] == "oyuncu" and x != h for x in e["workers"]):
            return True
    return bool(W.NLAB_ON and NPC_LAB_PF and c["pool"])


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
    if HOME_OWN and not W.home_open:                              # REKABET G12: açılış mülkiyet dağılımı hf1 kadro kurulumundan sonra, ilk kira ödemesinden önce (R = kira ödeyen bütün haneler)
        house_home_open(W)
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
    if NPC_NET_OWNER:                                             # te-ist G1: NPC üretim payının paydası yalnız sahipsiz canlı firmaların kafa sayısı
        W.n_live_npc = defaultdict(float)
        for f, d in firms.items():
            if d["workers"] and d["owner"] is None:
                W.n_live_npc[(d["city"], d["kind"])] += len(d["workers"])
    if HIRE_GATE_GROWTH:
        kadro_kaydet(W)                                           # M11.2 (3b): staffing sonu kadro (ertesi hafta "boşalan yer" ölçüsü)
    W.wage_fail = 0
    W.separations = 0


_HK_FN = dict(wc=working_capital, kopru=kopru_limit, gate=hire_gate, sb=sb_hire_ok, sm=sm_hire_ok, pm=prod_mult, fee=fee_rate)      # REKABET G17a: hk_snap kapı işlevleri (lab_meas L0'dır, bu modülün kopyasından verilir). Bağlanma içe aktarma anındadır: sonradan yamalanan işlev snap'e yansımaz
