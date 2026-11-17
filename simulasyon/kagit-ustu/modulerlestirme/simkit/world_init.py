"""simkit.world_init: koşu durumunun kurulumu: params sabitlerinden ve build()'den World nesnesini üretir (eski run() kurulum bölümü, 208 ifade).

ARAYÜZ: new_world
OKUR: simkit.params (salt-okunur sabitler ve şablonlar), build(); YAZAR: yeni World (alanlar eski adlarıyla; çalışma zamanı kapsayıcıları, önbellek LD_VER/_LDC dahil, her koşuda taze).
KATMAN: L7 (alan modüllerine ve world'e bağlı).
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from collections import defaultdict
from functools import partial
from simkit.results import results
from simkit.params import *          # noqa: F401,F403
from simkit.recipes import reset_order
from simkit.world import World, fac_01, fac_02, fac_03, fac_04, fac_05, fac_06, fac_07, fac_08, fac_09, fac_10, fac_11, fac_12
from simkit.world_build import build
from simkit.measure import install_secfn
from simkit.credit_money import CreditMoney
from simkit.credit_core import lt_baslat
from simkit.lab_meas import lab_stamp
from simkit.human import human_init


def new_world(weeks, n_cities, ahir_kamu):
    WELF_ON = LONCA_WELFARE
    POL_ON = RATE_POLICY
    LEV_ON = LONCA_LEVERAGE
    CAPEX_ON = CAPEX
    HBX_ON = HOUSE_BUILD_X
    LIQ_ON = LIQUIDATION
    INS_ON = INSURANCE and LONCA_WELFARE
    YOUNG_ON = YOUNG_CREDIT and CREDIT_ON
    HEALTH_ON = HEALTH
    EDU_ON = EDUCATION
    WRULE_ON = WEALTH_RULE and WR_ACT_FLAG
    NLAB_ON = NPC_LABOR
    INV_ON = INVENTORY
    PRIV_ON = PRIVATIZE and NO_BAILOUT
    inv_stat = defaultdict(float)
    inv_ts = []
    RENEW_ON = RENEW_FUND and CAPEX
    BOND_ON = CITY_BOND and MONEY_CAP
    # çalışma zamanı durumu: HER koşu için taze kapsayıcılar (PK-1: params salt-okunur; iki World aynı süreçte bağımsız)
    REF = dict(REF_BASE)                                   # fiyat çıpaları (şablonun kopyası, aynı sıra)
    PRICE, LAND, WI, PM = {}, {}, {}, {}
    KN, FRONT, PUB, HW_Q, SW_Q, LAST_ENTRY, RENT_CY, BRAND, FEES = {}, {}, {}, {}, {}, {}, {}, {}, {}
    MWI, TAXV, LOG_MULT, MM_BASE, NOW = [1.0], [0.0], [1.0], [MM_BASE0], [1]
    TOUR_STATE, MODA_STATE, HW_STATE = dict(on=False, since=0), dict(on=False, since=0), dict(on=False, since=0)
    SW_STATE = dict(on=False, adopt=0.0, since=0)
    LD_VER = [0]                                 # v11.5 (performans): life_demand'in fiyat/durum önbelleği; her döngü başında ve LAND/kira değişince artar
    _LDC = {}
    L, loncas, cities, firms, people = build(n_cities)
    PV2 = PRICE_V2 and FIRM_PRICE
    LOG_MULT[0] = 1.0
    TAXV[0] = SALES_TAX
    TAXS = {"o": None, "i": None, "c": None}
    if PV2 or PV2_ACCT:                                      # K-187: firma gider defteri
        L.fset = firms
        L.fexp = defaultdict(fac_02)
        L.frev = defaultdict(float)
    PSV = {}
    FPA, V2S, CITYP, MKS, V2K, V2SNAP = {}, {}, {}, {"C": None, "R": None, "m": 1.0, "CL": None, "RL": None, "ml": 1.0}, {}, {}
    kind_stats = defaultdict(fac_01)
    missed = defaultdict(int)
    miss_reason = defaultdict(int)
    cov = defaultdict(float)                             # K-153: sepet karşılama: kişi-döngü sayısı, ≥%95 karşılanan, ortalama karşılama
    miss_item = defaultdict(int)                         # K-122: eksik sepet kalemi -> kişi-döngü
    worked = defaultdict(int)
    jobless_c = {}                                       # K-157: iş arayanın işsizlik süresi (döngü)
    skillw = defaultdict(int)                            # K-148: özel işyerinde ödenen çalışma döngüsü (tecrübe)
    player_firms = []
    hs = defaultdict(float)                              # K-159: şehir -> konut stoku
    own = defaultdict(fac_02)        # şehir -> oyuncu -> sahip olunan konut
    RM = defaultdict(fac_03)                        # şehir -> kira çarpanı
    rent_pot = defaultdict(float)                        # şehir -> haftalık toplanan kira
    occ = defaultdict(float)                             # şehir -> kiracı sayısı (son döngü)
    RENT_CY.clear()
    gate = defaultdict(int)                              # K-185 tanı: girişimci kapısı sayaçları (25 haftalık dilim, neden)
    gate_c = defaultdict(float)                          # M10: şehir anahtarlı hane tüketim kaydı (şehir, ad) -> kümülatif; davranışsız, hiçbir karar okumaz
    chain = defaultdict(fac_04)        # K-185.14 tedarik zinciri izleme: (25 hf dilimi, ürün) -> neden sayaçları
    chain_der = defaultdict(float)
    chain_sh = defaultdict(fac_05)   # (dilim, ürün) -> [eksik, talep, üretim, PM toplamı, ithal/yerel fiyat oranı toplamı, ürün değer toplamı, hafta]
    k185_ts = []                                         # K-185: haftalık seri
    npc_log = []                                         # K-185.2: (hafta, şehir, tür, olay)
    loans = {}                                           # K-158: firma -> kredi (lonca, ilk anapara, kalan, üst üste ödenemeyen hafta)
    deposits = {}                                        # K-158: oyuncu -> [lonca, mevduat]
    dep_tot = defaultdict(float)
    int_in = defaultdict(float)
    pol = [None]                                         # K-185.5: güncel politika faizi (haftalık)
    pol_hist = []                                        # (hafta, faiz, işsizlik, enflasyon, boşta payı)
    lo_loss = defaultdict(float)                         # K-185.5: lonca -> sönümlü kredi kaybı
    bonds = []                                           # K-185.4: şehir tahvilleri: dict(city, lo, p0, out, rate, born)
    city_rev = defaultdict(float)                        # şehir hesabı -> sönümlü haftalık gelir
    city_ref = defaultdict(float)                        # şehir hesabı -> yavaş sönümlenen referans gelir (borç tavanı)
    bond_stat = defaultdict(float)
    bond_hist = []

    trade = defaultdict(float)
    weekly = []
    stats = dict(freight_used=0.0, freight_cap=0.0, local=defaultdict(float), imported=defaultdict(float), unsold=defaultdict(float),
                 demanded=defaultdict(float), delivered=defaultdict(float),
                 in_want=defaultdict(float), in_short=defaultdict(float))
    short_units, short_val = defaultdict(float), defaultdict(float)
    want_units = defaultdict(float)                      # ürün -> haftalık talep (birim), fiyat güncellemesi için
    own_p, own_u = defaultdict(float), defaultdict(float)       # K-164: oyuncu firmalarının (şehir, ürün) haftalık üretimi / alıcısızı
    qseg_stat = defaultdict(fac_06)           # (katman, ürün) -> [birim, kalite×birim, harcama] (son 20 hafta)
    KQ, KQH, PUBQ, FRONTQ, fq_hist = {}, {}, {b_: 0.0 for b_ in BRANCHES}, {b_: 0.0 for b_ in BRANCHES}, {b_: [] for b_ in BRANCHES}     # K-183.3: DAO ürün (kalite) Ar-Ge düzeyi, geçmişi; kamu malı ve öncü kalite düzeyi
    segd_ema, segd_w = defaultdict(float), defaultdict(float)  # K-183.4: (ürün, katman) -> sönümlü haftalık hane talebi (strateji açığı için)
    fstat = defaultdict(fac_07)   # K-183.4: firma -> son 100 haftanın kalite/kâr istatistiği
    frev, fbuy, fwage = defaultdict(float), defaultdict(float), defaultdict(float)
    grade_log, path_log = defaultdict(int), defaultdict(int)
    ad_week, ad_wk_ema, e_mkt, media_series = defaultdict(float), defaultdict(float), [1.0], []   # K-183.6: haftalık / sönümlü medya reklam geliri; piyasanın gördüğü etkili erişim; seri
    media_ch_max, media_n, last_media_entry = [0], [0], defaultdict(fac_10)
    nl_dbg = defaultdict(int)
    ad_rev_all = defaultdict(float)                          # K-183.5: medya firması -> tüm reklam geliri (lonca programı + doğrudan)
    rev_prev, ad_stat, ad_rev_m = {}, defaultdict(float), defaultdict(float)     # K-183.5: önceki haftanın firma geliri; doğrudan reklam istatistiği; medya firması -> alınan doğrudan reklam geliri
    rent_owner, rent_by_player, rent_tot = defaultdict(float), defaultdict(float), defaultdict(float)
    rent_hist, rent_spells, rent_run = defaultdict(list), defaultdict(list), defaultdict(int)
    AVGT, ANCS = {}, {}                                      # K-183.2: tür -> (ağırlıklı ort. teknoloji, ağırlıklı ort. telif); (şehir, tür) -> düzleştirilmiş çıpa
    gap_acc = defaultdict(fac_08)
    GAPK = {}                                                # tür -> fiyat çıpasının öncü maliyetinin üstündeki payı (güncel hafta, şehir ort.)
    fp_disp = []                                             # (hafta, ort. fiyat değişim katsayısı, ort. max/min fiyat, ort. kalite std, ürün sayısı)
    FPM, ANCHD = {}, {}                                      # K-183.1: firma -> fiyat çarpanı; (şehir, tür) -> maliyet çıpası bileşenleri
    fsold, fwk_prod, fwk_uns = defaultdict(float), defaultdict(float), defaultdict(float)
    inq_acc = defaultdict(fac_09)                 # K-183.3: firma -> [değer ağırlığı, kalite × değer] (haftalık girdi kalitesi)
    prod_w, unsold_w = defaultdict(float), defaultdict(float)   # (şehir, ürün) -> haftalık üretim / alıcısız (birim)
    for ci_ in range(n_cities):
        for p_ in REF:
            PRICE[(ci_, p_)] = REF[p_]
            LAND[(ci_, p_)] = REF[p_]
            PM[(ci_, p_)] = 1.0
        WI[ci_] = 1.0
        if HOUSE_ON:
            hs[ci_] = HOUSE_SLACK * (len(cities[ci_]["players"]) + HOUSE_NPC_TEN)
            RENT_CY[ci_] = RENT_H * TIER_WAGE[0]
    price_hist = []
    SW_STATE.update(on=False, adopt=0.0, since=0)
    HW_STATE.update(on=False, since=0)
    HW_Q.clear()
    SW_Q.clear()
    KN.clear(); FRONT.clear(); PUB.clear()

    for lo_ in loncas:
        KN[lo_] = {b_: 0.0 for b_ in BRANCHES}
    for b_ in BRANCHES:
        FRONT[b_] = PUB[b_] = 0.0
    front_hist = {b_: [] for b_ in BRANCHES}
    rev_lb = defaultdict(float)                      # (lonca, dal) -> sönümlü gelir (Ar-Ge dalı seçimi)
    arge_spent, telif_in = defaultdict(float), defaultdict(float)
    tour_stat = defaultdict(float)                   # ("gelir"|"turist", şehir) -> konaklama geliri (K-138)
    media_w = defaultdict(float)                     # şehir -> bu haftaki reklam geliri (tanıtım)
    rev_lc = defaultdict(float)                      # (lonca, şehir) -> sönümlü satış geliri (reklam dağıtımı)
    TOUR_STATE.update(on=False, since=0)
    MODA_STATE.update(on=False, since=0)
    BRAND.clear()
    BRAND.update({ci_: 0.0 for ci_ in range(n_cities)})
    tech_events, tech_paths, green = [], defaultdict(int), [0.0]
    # --- K-167 durumu (INNOV_ON)
    REP, neg = defaultdict(float), defaultdict(float)      # kişi itibarı (K-11) ve sönümlü cezalar
    fis_acc, soz_acc = defaultdict(float), defaultdict(float)
    wf_week = defaultdict(int)                             # firma -> bu hafta ücret ödeyemeyip ayrılan çalışan
    KD, KDH, dao_all = {}, {}, []                          # DAO -> dal -> düzey; haftalık düzey geçmişi; DAO adları
    last_dao_death = defaultdict(fac_10)
    lonca_owner = {}                                       # lonca -> (oyuncu, hafta)
    pot_ema = defaultdict(float)                           # lonca -> Ar-Ge payı (sönümlü, döngü başına)
    RWI = defaultdict(fac_03)                         # şehir -> araştırmacı ücret çarpanı (arz-talep)
    PATS = {b_: [] for b_ in BRANCHES}                     # dal -> [(DAO, hak sahibi hesap, düzey, lonca)]
    ANCH = {b_: (1.0, 0.0) for b_ in BRANCHES}             # dal -> (fiyat çıpası verim, telif)
    KTECH = {}                                             # tür -> canlı firmaların ortalama verimi
    xrate = {}                                             # DAO -> dışarıya telif oranı
    res_spent, dao_tel, dao_con = defaultdict(float), defaultdict(float), defaultdict(float)
    dao_pay = defaultdict(float)
    dao_info = {}                                          # DAO -> bilgi
    telif_mx, telif_br = defaultdict(float), defaultdict(float)
    mono = {b_: [0, 0, 0] for b_ in BRANCHES}              # dal -> [patentsiz, tek mucit, çok mucit] hafta
    xr_hist, lic_hist, mem_hist, inn_series = [], [], [], []
    unemp, inc_ema = defaultdict(int), defaultdict(float)
    flow_prev = defaultdict(float)
    res_unmet = defaultdict(int)
    rival_done = set()
    FEES.clear()
    MWI[0] = 1.0
    if FEE_ACT:
        FEES.update({lo_: LONCA_FEE for lo_ in loncas[:6]})
    fee_inc, fee_prev, fee_dir = defaultdict(float), defaultdict(float), defaultdict(fac_11)
    fee_hist, switches, mgr_stat = [], defaultdict(int), []
    role_list = []
    hab, jval = {}, defaultdict(float)                     # K-172: harcama alışkanlığı (döngü başına bütçe), mücevher + konut yatırımı değeri
    lvl_cat, lvl_n, kw, kcity = defaultdict(float), defaultdict(int), defaultdict(float), defaultdict(float)
    closed, closed_at, lo_low = set(), {}, defaultdict(int)
    eq_by = {}                                                         # K-180: firma -> {yatırımcı: {share, cost, div}}
    eq_cap, prof_ema, bal_prev, out_prev = defaultdict(float), defaultdict(float), {}, {}
    pay_w, inj_w, eq_last, eq_px = defaultdict(float), defaultdict(float), defaultdict(fac_10), defaultdict(float)
    eq_log, eq_stat = [], defaultdict(float)
    mortgages, cx_stat = [], defaultdict(float)                         # K-181: ipotekler; kredi türü sayaçları
    media_save, mprof, ad_pay_ema, media_stat, media_log = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float), []     # K-180: medya sahipliği
    orep, ad_stock, ad_w, wfail_ema, orep_hist = {}, defaultdict(float), defaultdict(float), defaultdict(float), []     # K-180: kurum itibarı
    haz = {'f': 0.01, 'd': 0.005}                                       # K-180: sönümlü haftalık batma oranı (firma, DAO): yatırımcı beklenen kaybı getiriden düşer
    dep_slow = [0.0]                                                   # K-179: mevduat ağırlıklı ortalama faiz, 12 haftalık sönümlü (konut kararları bunu kullanır)
    dep_rate_w, dep_ema = defaultdict(float), defaultdict(float)      # K-179: lonca -> haftalık mevduat faizi (dağıtılan / mevduat) ve 4 haftalık sönümlüsü
    hratio, hexp, hpx_prev = defaultdict(fac_03), defaultdict(float), {}      # K-179: şehir -> ikinci el / birincil fiyat oranı, beklenen haftalık fiyat değişimi, önceki fiyat
    house_ts, hst = [], defaultdict(float)                           # K-179: konut zaman serisi (10 haftada bir), haftalık işlem sayaçları
    new_slots = set(loncas[6:])                               # K-176: girişimci loncaların slotları
    for sl_ in sorted(new_slots):
        closed.add(sl_)
        closed_at[sl_] = -999
    lonca_log, lonca_info = [], {}
    for l_ in loncas[:6]:
        lonca_info[l_] = dict(grp="yerleşik", founder=None, start=0, end=None, peak=0)
    arge_boost = defaultdict(float)
    tel_ema, con_ema, tel_prev, con_prev = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
    fee_snaps = []
    founder_ban = {}
    grp_stat = []
    held = {"mucevher": defaultdict(float), "insaat": defaultdict(float)}   # K-174: oyuncu -> yeni-eşdeğer değer birimi
    sh_price = {"mucevher": SH_DISC, "insaat": SH_DISC}                    # ikinci el fiyat oranı (referansa göre)
    sh_req = {"mucevher": defaultdict(float), "insaat": defaultdict(float)}
    sh_share = {"mucevher": SH_SHARE, "insaat": SH_SHARE}
    dealer_inv = defaultdict(float)                                        # (firma, ürün) -> geri alınan stok
    sh_stat = defaultdict(float)
    short_hist = defaultdict(list)
    lo_unpaid, lo_stress, lo_members = defaultdict(float), defaultdict(float), defaultdict(int)
    wf_g, wf_eff, wf_paid_w, wf_claim, wf_mem_prev, wf_fee_prev, wf_inc_w = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)   # K-185.3: lonca cömertliği, etkin cömertlik, haftalık ödenen, sönümlü haftalık ödeme, geçen üye sayısı, fee geliri
    wf_payroll, wf_stat, wf_hist = defaultdict(float), defaultdict(float), []
    wf_cov = defaultdict(float)                           # K-185.12: lonca üyesi firmalardaki oyuncu çalışan sayısı (sağlık sigortası kapsamı)
    wf_g_set = set()
    ins, wf_ins = {}, {}                                  # K-185.11: sigortacılar; lonca -> sigortacı
    wf_prem_due, wf_prem_paid, wf_prem_ratio, wf_cost = defaultdict(float), defaultdict(float), defaultdict(fac_03), defaultdict(float)
    ins_stat, ins_hist = defaultdict(float), []
    cost_stat = defaultdict(float)
    bf_stat = defaultdict(float)
    stat_from = max(0, weeks - 20)
    owner_rec = defaultdict(float)

    lic_cur = {}

    derived_cache = {}

    CX_GOODS = {"aluminyum": MACH_AL, "bilesen": MACH_BI}
    capinv = defaultdict(fac_02)     # K-185.7: firma -> alınmış ama yuvaya dönüşmemiş sermaye malı
    capex_stat = defaultdict(float)
    capex_ts = []

    young_stat = defaultdict(float)
    cx_ref = defaultdict(float)                      # K-185.18: kredi kapısı red nedenleri
    priv_stat, priv_q, priv_log, priv_ts = defaultdict(float), {}, [], []      # K-185.17: özelleştirme sayaçları, açık ihaleler, devir kayıtları, haftalık seri
    npcpov = [0, 0]                                      # K-185.13: işsiz NPC döngü sayısı: nakdi biten (yoksul), toplam
    cons_ts = []
    sick_until, h_lvl = {}, defaultdict(fac_12)
    health_stat, svc_rev_w, svc_rev_prev = defaultdict(float), defaultdict(float), defaultdict(float)
    treat_n_w, treat_n_prev = defaultdict(float), defaultdict(float)
    edu_lvl, student, edu_stat, edu_grads = defaultdict(int), {}, defaultdict(float), [0]
    health_hist, edu_hist = [], []

    estate = {}                                          # K-185.10: tasfiye masaları: firma -> dict(...)
    liq_stat = defaultdict(float)

    hdev_q = defaultdict(list)                               # K-185.8: şehir -> bekleyen inşaat işleri [yatırımcı, birim]
    hdev_stat = defaultdict(float)
    hdev_ts = []

    w_ctx = [1]
    mint_allow_tot = 0.0
    contracts = {}
    freight_cap = {}
    jobless = {}
    W = World()
    W.results = partial(results, W)          # koşu sonucu R (simkit/results.py sözleşmesi)
    reset_order(W)                           # W.RECIPES (şablonun derin kopyası), W.TOPO, W.STAGES
    W.weeks = weeks                          # run parametreleri: taşınan işlevler (ins_step, v2_acct) W üzerinden okur
    W.AHIR_KAMU = ahir_kamu      # CLI (--ahir-kamu) model_mod modül düzeyine yazar, run() argüman olarak verir; hafta fazları W'den okur (adım 7)
    W.TAXV = TAXV                              # koşuya özgü kapsayıcı
    W.PRICE = PRICE                              # koşuya özgü kapsayıcı
    W.PM = PM                              # koşuya özgü kapsayıcı
    W.MWI = MWI                              # koşuya özgü kapsayıcı
    W.HW_Q = HW_Q                              # koşuya özgü kapsayıcı
    W.SW_Q = SW_Q                              # koşuya özgü kapsayıcı
    W.KN = KN                              # koşuya özgü kapsayıcı
    W.FRONT = FRONT                              # koşuya özgü kapsayıcı
    W.PUB = PUB                              # koşuya özgü kapsayıcı
    W.LAST_ENTRY = LAST_ENTRY                              # koşuya özgü kapsayıcı
    W.MM_BASE = MM_BASE                              # koşuya özgü kapsayıcı
    W.REF = REF                              # koşuya özgü kapsayıcı
    W.LAND = LAND                              # koşuya özgü kapsayıcı
    W.WI = WI                              # koşuya özgü kapsayıcı
    W.FEES = FEES                              # koşuya özgü kapsayıcı
    W.NOW = NOW                              # koşuya özgü kapsayıcı
    W.LOG_MULT = LOG_MULT                              # koşuya özgü kapsayıcı
    W.RENT_CY = RENT_CY                              # koşuya özgü kapsayıcı
    W.BRAND = BRAND                              # koşuya özgü kapsayıcı
    W.SW_STATE = SW_STATE                              # koşuya özgü kapsayıcı
    W.HW_STATE = HW_STATE                              # koşuya özgü kapsayıcı
    W.MODA_STATE = MODA_STATE                              # koşuya özgü kapsayıcı
    W.TOUR_STATE = TOUR_STATE                              # koşuya özgü kapsayıcı
    W.LD_VER = LD_VER                              # koşuya özgü kapsayıcı
    W._LDC = _LDC                              # koşuya özgü kapsayıcı
    W.MARKET_MARKUP = MM_BASE[0]            # skaler: kaynak W (run ve yardımcılar W'den okur); modül düzeyi kopya run sonunda eşitlenir
    W.WELF_ON = WELF_ON
    W.POL_ON = POL_ON
    W.LEV_ON = LEV_ON
    W.CAPEX_ON = CAPEX_ON
    W.HBX_ON = HBX_ON
    W.LIQ_ON = LIQ_ON
    W.INS_ON = INS_ON
    W.YOUNG_ON = YOUNG_ON
    W.HEALTH_ON = HEALTH_ON
    W.EDU_ON = EDU_ON
    W.WRULE_ON = WRULE_ON
    W.NLAB_ON = NLAB_ON
    W.INV_ON = INV_ON
    W.PRIV_ON = PRIV_ON
    W.inv_stat = inv_stat
    W.inv_ts = inv_ts
    W.RENEW_ON = RENEW_ON
    W.BOND_ON = BOND_ON
    W.L = L
    W.loncas = loncas
    W.cities = cities
    W.firms = firms
    W.people = people
    W.PV2 = PV2
    W.TAXS = TAXS
    W.PSV = PSV
    W.FPA = FPA
    W.V2S = V2S
    W.CITYP = CITYP
    W.MKS = MKS
    W.mk_vol = [0.0, 0.0]                              # M14 K1a: haftalik market [satilan birim, kapasite birim]
    W.V2K = V2K
    W.V2SNAP = V2SNAP
    W.kind_stats = kind_stats
    W.missed = missed
    W.miss_reason = miss_reason
    W.cov = cov
    W.miss_item = miss_item
    W.worked = worked
    W.jobless_c = jobless_c
    W.skillw = skillw
    W.player_firms = player_firms
    W.hs = hs
    W.own = own
    W.RM = RM
    W.rent_pot = rent_pot
    W.occ = occ
    if HOME_OWN:                                         # REKABET G12: ev sahibi haneler (bayrak kapalıyken W'ye hiçbir ad eklenmez)
        W.home, W.home_n, W.home_res, W.home_stat, W.home_open, W.hs0 = {}, defaultdict(int), {}, defaultdict(int), False, {}       # kişi -> oturduğu evin şehri; şehir -> oturulan sahipli birim; şehir -> açılış NPC yedeği; (sayaç, şehir) -> kümülatif geçiş
    if BUILD_DEV:                                        # REKABET G12b: inşaat firması geliştirici sayaçları (bayrak kapalıyken W'ye ad eklenmez)
        W.bd_stat = defaultdict(float)                   # (ad, şehir) -> kümülatif sayaç (house_bd_meas okur)
    W.gate = gate
    W.gate_c = gate_c
    W.chain = chain
    W.chain_der = chain_der
    W.chain_sh = chain_sh
    W.k185_ts = k185_ts
    W.npc_log = npc_log
    W.loans = loans
    W.deposits = deposits
    W.dep_tot = dep_tot
    W.int_in = int_in
    W.pol = pol
    W.pol_hist = pol_hist
    W.lo_loss = lo_loss
    W.bonds = bonds
    W.city_rev = city_rev
    W.city_ref = city_ref
    W.bond_stat = bond_stat
    W.bond_hist = bond_hist
    W.trade = trade
    W.weekly = weekly
    W.WKC = defaultdict(float)                 # PX: WEEKLY_CSV haftalık ölçüm sayaçları (yalnız ölçüm)
    W.wk_csv = []
    W.DL_PREV = defaultdict(float)
    W.SPCLS = {}
    W.FL_PREV = defaultdict(float)
    W.stats = stats
    W.short_units = short_units
    W.short_val = short_val
    W.want_units = want_units
    W.own_p = own_p
    W.own_u = own_u
    W.qseg_stat = qseg_stat
    W.KQ = KQ
    W.KQH = KQH
    W.PUBQ = PUBQ
    W.FRONTQ = FRONTQ
    W.fq_hist = fq_hist
    W.segd_ema = segd_ema
    W.segd_w = segd_w
    W.fstat = fstat
    W.frev = frev
    W.fbuy = fbuy
    W.fwage = fwage
    W.grade_log = grade_log
    W.path_log = path_log
    W.ad_week = ad_week
    W.ad_wk_ema = ad_wk_ema
    W.e_mkt = e_mkt
    W.media_series = media_series
    W.media_ch_max = media_ch_max
    W.media_n = media_n
    W.last_media_entry = last_media_entry
    W.nl_dbg = nl_dbg
    W.ad_rev_all = ad_rev_all
    W.rev_prev = rev_prev
    W.ad_stat = ad_stat
    W.ad_rev_m = ad_rev_m
    W.rent_owner = rent_owner
    W.rent_by_player = rent_by_player
    W.rent_tot = rent_tot
    W.rent_hist = rent_hist
    W.rent_spells = rent_spells
    W.rent_run = rent_run
    W.AVGT = AVGT
    W.ANCS = ANCS
    W.gap_acc = gap_acc
    W.GAPK = GAPK
    W.fp_disp = fp_disp
    W.FPM = FPM
    W.ANCHD = ANCHD
    W.fsold = fsold
    W.fwk_prod = fwk_prod
    W.fwk_uns = fwk_uns
    W.inq_acc = inq_acc
    W.prod_w = prod_w
    W.unsold_w = unsold_w
    W.front_hist = front_hist
    W.rev_lb = rev_lb
    W.arge_spent = arge_spent
    W.telif_in = telif_in
    W.tour_stat = tour_stat
    W.media_w = media_w
    W.rev_lc = rev_lc
    W.tech_events = tech_events
    W.tech_paths = tech_paths
    W.green = green
    W.REP = REP
    W.neg = neg
    W.fis_acc = fis_acc
    W.soz_acc = soz_acc
    W.wf_week = wf_week
    W.KD = KD
    W.KDH = KDH
    W.dao_all = dao_all
    W.last_dao_death = last_dao_death
    W.lonca_owner = lonca_owner
    W.pot_ema = pot_ema
    W.RWI = RWI
    W.PATS = PATS
    W.ANCH = ANCH
    W.KTECH = KTECH
    W.xrate = xrate
    W.res_spent = res_spent
    W.dao_tel = dao_tel
    W.dao_con = dao_con
    W.dao_pay = dao_pay
    W.dao_info = dao_info
    W.telif_mx = telif_mx
    W.telif_br = telif_br
    W.mono = mono
    W.xr_hist = xr_hist
    W.lic_hist = lic_hist
    W.mem_hist = mem_hist
    W.unemp = unemp
    W.inc_ema = inc_ema
    W.flow_prev = flow_prev
    W.rival_done = rival_done
    W.fee_inc = fee_inc
    W.fee_prev = fee_prev
    W.fee_dir = fee_dir
    W.fee_hist = fee_hist
    W.switches = switches
    W.mgr_stat = mgr_stat
    W.role_list = role_list
    W.hab = hab
    W.jval = jval
    W.lvl_cat = lvl_cat
    W.lvl_n = lvl_n
    W.kw = kw
    W.kcity = kcity
    W.closed = closed
    W.closed_at = closed_at
    W.lo_low = lo_low
    W.eq_by = eq_by
    W.eq_cap = eq_cap
    W.prof_ema = prof_ema
    W.bal_prev = bal_prev
    W.out_prev = out_prev
    W.pay_w = pay_w
    W.inj_w = inj_w
    W.eq_last = eq_last
    W.eq_px = eq_px
    W.eq_log = eq_log
    W.eq_stat = eq_stat
    W.mortgages = mortgages
    W.cx_stat = cx_stat
    W.media_save = media_save
    W.mprof = mprof
    W.ad_pay_ema = ad_pay_ema
    W.media_stat = media_stat
    W.media_log = media_log
    W.orep = orep
    if RETAIL_SHARE:
        W.rs_pay = {}                        # te-rekabet G8: market -> hane payı (rs_step)
    W.ad_stock = ad_stock
    W.ad_w = ad_w
    W.wfail_ema = wfail_ema
    W.orep_hist = orep_hist
    W.haz = haz
    W.dep_slow = dep_slow
    W.dep_rate_w = dep_rate_w
    W.dep_ema = dep_ema
    if LONCA_TERMS:                                        # REKABET G5: lonca koşulları (kapalıyken W'ye hiçbir şey eklenmez)
        W.lo_terms, W.lo_terms_insan, W.lt_stat, W.lt_gelir, W.lt_son = {}, {}, {}, {}, {}
        for lo_ in loncas:
            lt_baslat(W, lo_)
    W.hratio = hratio
    W.hexp = hexp
    W.hpx_prev = hpx_prev
    W.house_ts = house_ts
    W.hst = hst
    W.new_slots = new_slots
    W.lonca_log = lonca_log
    W.lonca_info = lonca_info
    W.arge_boost = arge_boost
    W.tel_ema = tel_ema
    W.con_ema = con_ema
    W.tel_prev = tel_prev
    W.con_prev = con_prev
    W.fee_snaps = fee_snaps
    W.founder_ban = founder_ban
    W.grp_stat = grp_stat
    W.held = held
    W.sh_price = sh_price
    W.sh_req = sh_req
    W.sh_share = sh_share
    W.dealer_inv = dealer_inv
    W.sh_stat = sh_stat
    W.short_hist = short_hist
    W.lo_unpaid = lo_unpaid
    W.lo_stress = lo_stress
    W.lo_members = lo_members
    W.wf_g = wf_g
    W.wf_eff = wf_eff
    W.wf_paid_w = wf_paid_w
    W.wf_claim = wf_claim
    W.wf_mem_prev = wf_mem_prev
    W.wf_fee_prev = wf_fee_prev
    W.wf_inc_w = wf_inc_w
    W.wf_payroll = wf_payroll
    W.wf_stat = wf_stat
    W.wf_hist = wf_hist
    W.wf_cov = wf_cov
    W.wf_g_set = wf_g_set
    W.ins = ins
    W.wf_ins = wf_ins
    W.wf_prem_due = wf_prem_due
    W.wf_prem_paid = wf_prem_paid
    W.wf_prem_ratio = wf_prem_ratio
    W.wf_cost = wf_cost
    W.ins_stat = ins_stat
    W.ins_hist = ins_hist
    W.cost_stat = cost_stat
    W.bf_stat = bf_stat
    W.stat_from = stat_from
    W.owner_rec = owner_rec
    W.lic_cur = lic_cur
    W.derived_cache = derived_cache
    W.capinv = capinv
    W.capex_stat = capex_stat
    W.capex_ts = capex_ts
    W.young_stat = young_stat
    W.cx_ref = cx_ref
    W.priv_stat = priv_stat
    W.priv_q = priv_q
    W.priv_log = priv_log
    W.priv_ts = priv_ts
    W.npcpov = npcpov
    W.cons_ts = cons_ts
    W.sick_until = sick_until
    W.h_lvl = h_lvl
    W.health_stat = health_stat
    W.svc_rev_w = svc_rev_w
    W.svc_rev_prev = svc_rev_prev
    W.treat_n_w = treat_n_w
    W.treat_n_prev = treat_n_prev
    W.edu_lvl = edu_lvl
    W.student = student
    W.hire_stat = defaultdict(float)                       # D6: işe alım/çıkarma/katılım sayaçları (birikimli; yalnız gösterge)
    W.lo_stat = defaultdict(float)                         # PLAN-KREDI T5: lonca ölçüm sayaçları (davranışsız; çıktıya girmez; kr_* sütunları okur)
    W.lo_insolv = set()                                    # PLAN-KREDI T6: batık lonca kümesi (LONCA_INSOLV_CLOSE açıkken week_open/lonca_step yeniler; çıktıya girmez)
    if KR_MEAS or HUMAN_ON:                                # davranışsız kadro hedefi kaydı: KR_MEAS ölçümü ve DAO oyununun iş ilanı gözlemi (human.gozlem) okur; ikisi de kapalıyken W'ye eklenmez
        W.staff_tgt = {}                                   # firma -> o haftanın hedef kadrosu (her hafta phase_staffing başında temizlenir)
    if KR_MEAS:                                            # PLAN-KREDI T5 (§4.6): davranışsız iş piyasası sayaçları; kapalıyken W'ye hiçbir şey eklenmez
        W.lab_stat = defaultdict(float)                    # "<olay>_<firma türü>" birikimli işe alım/çıkış olayı sayacı (simkit.lab_meas)
        W.lab_type = {}                                    # firma -> tür (kuruluşta bir kez damgalanır; sınıf değişimini izlemez)
        for f_ in firms:
            lab_stamp(W, f_)
    W.edu_stat = edu_stat
    W.edu_grads = edu_grads
    W.health_hist = health_hist
    W.edu_hist = edu_hist
    W.estate = estate
    W.liq_stat = liq_stat
    W.hdev_q = hdev_q
    W.hdev_stat = hdev_stat
    W.hdev_ts = hdev_ts
    W.w_ctx = w_ctx
    W.mint_allow_tot = mint_allow_tot
    W.contracts = contracts
    W.freight_cap = freight_cap
    W.jobless = jobless
    W.cm = None
    W.cm_obs = None
    if CREDIT_MONEY:                            # K-218: kredi para yaratır (kapalıyken W.cm ve L.cm None: yol değişmez)
        W.cm = L.cm = CreditMoney(W)
    elif CM_CSV:                                # K-218 ölçüm: bayrak kapalıyken yalnız haftalık kayıt gözlemcisi (davranışsız; L.cm/W.cm None kalır)
        W.cm_obs = CreditMoney(W)
    if W.L.sx is not None:                      # PX: SECDUMP: hesap -> sektör eşlemesi (yalnız teşhis)
        install_secfn(W)
    human_init(W)                               # DAO oyunu: W.human (HUMAN_ON kapalıyken None) ve olay/geçmiş alanları
    return W
