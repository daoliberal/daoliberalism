"""simkit.world_build: dünya kurulumu: build(n_cities).

ARAYÜZ: build, city_plans, plan_scale, firm_capacity, make_households
OKUR: params. YAZAR: yok (new_world kullanır).
KATMAN: L1.
"""
from collections import defaultdict
import random
from simkit.params import *          # noqa: F401,F403
from simkit.econ_core import tier_of
from simkit.ledger import Ledger


def plan_scale(plan, f):
    """D7 (A4): şehir planı (tür, adet) listesinin ahır ve belediye dışı adetlerini f ile ölçekler; tür dağılımı korunur, her tür en az bir.
    Adetler en büyük kalan yöntemiyle yuvarlanır (toplam ~ f x eski toplam; her tür >= 1, bu yüzden f çok küçükse alt sınır tür sayısıdır). Saf, deterministik."""
    idx = [i for i, (k, n) in enumerate(plan) if k not in ("ahir", "belediye")]
    base_tot = sum(plan[i][1] for i in idx)
    want = max(len(idx), int(round(base_tot * f)))
    exact = [plan[i][1] * f for i in idx]
    cnt = [max(1, int(e)) for e in exact]
    rest = want - sum(cnt)
    order = sorted(range(len(idx)), key=lambda j: (-(exact[j] - int(exact[j])), j))
    j = 0
    while rest > 0 and order:
        cnt[order[j % len(order)]] += 1
        rest -= 1
        j += 1
    while rest < 0:
        big = [j for j in range(len(cnt)) if cnt[j] > 1]
        if not big:
            break
        k = max(big, key=lambda j: (cnt[j] - exact[j], -j))
        cnt[k] -= 1
        rest += 1
    out = list(plan)
    for j, i in enumerate(idx):
        out[i] = (plan[i][0], cnt[j])
    return out


def firm_capacity(kind):
    """İşletmenin açılış kapasitesi (kişi). Varsayılan (CAP_MODE=0) v13.0: ahır CAP_AHIR, lojistik CAP_LOG ve öbürleri CAP_OTHER, BIG_START ise x BIG_CAP_MULT.
    D7 (A5) CAP_MODE=2 (elle): ahır yine CAP_AHIR; öbür türler tür grubunun MCAP_* değeri. Otomatik kip (1) world_init.start_setup içinde hf1 kadrosundan kurulur (burada varsayılan)."""
    if kind == "ahir":
        return CAP_AHIR
    if CAP_MODE == 2:
        g = CAP_KIND_GROUP.get(kind, "serv")
        return {"raw": MCAP_RAW, "make": MCAP_MAKE, "serv": MCAP_SERV, "log": MCAP_LOG}[g]
    return int(CAP_LOG * (BIG_CAP_MULT if BIG_START else 1)) if kind == "lojistik" else int(CAP_OTHER * (BIG_CAP_MULT if BIG_START else 1))


def city_plans(n_cities):
    """Şehir başına işletme planı [(tür, adet)]: ortak türler, sıralı uzman türler, kömür/altın, yaşam sektörleri, sağlık ve eğitim (v13.0 kuralı aynen).
    D7 (A4) FIRMS_PER_1000 > 0 ise tüm şehirlerde ORTAK bir çarpanla ölçeklenir (hedef toplam işletme = bu değer x toplam nüfus / 1000); tür dağılımı korunur."""
    special_iter = iter(SPECIAL)
    plans = []
    for ci in range(n_cities):
        plan = list(COMMON) + [(next(special_iter), 1) for _ in range(len(SPECIAL) // n_cities)] + ([("maden_komur", 1)] if ci in COAL_CITIES else []) + ([("restoran", 1), ("eglence", 1), ("insaat", 1), ("kuyumcu", 1)] + ([("maden_altin", 1)] if ci in GOLD_CITIES else []) if (LIFE_ON and INNOV_ON) else [])
        plans.append(plan + [(k_, 1) for k_ in SVC_KINDS])
    if FIRMS_PER_1000 > 0:
        pop_k = (n_cities * PLAYERS_PER_CITY + NPC_X + NPC_Y * PLAYERS_PER_CITY * n_cities) / 1000.0
        base_n = sum(n for plan in plans for k, n in plan if k not in ("ahir", "belediye"))
        plans = [plan_scale(plan, FIRMS_PER_1000 * pop_k / base_n) for plan in plans]
    return plans


def make_households(cities, people):
    """D9 (A2): NPC hanesi. Her şehirde NPC'lerin NPC_LFPR payı işgücünde kalır (c["pool"]), kalanı işgücü dışı bakmakla yükümlüdür (c["deps"]): işe alınmaz, iş aramaz.
    Dağılım deterministiktir (şehir sırasında eşit aralıklı seçim). Her bağımlı bir çalışana (geçimi sağlayan) atanır: dağıtım sırayla; çalışan başına n bağımlıysa
    bağımlı başına pay oranı HOUSE_DEP_EQ / (1 + n x HOUSE_DEP_EQ) (OECD-değiştirilmiş eşdeğerlik: çalışan 1, her bağımlı HOUSE_DEP_EQ). Yalnız NPC_HOUSE=1 iken çağrılır."""
    r = min(1.0 - NPC_LFPR, 0.95)
    if r <= 0:
        return
    for c in cities:
        act, dep = [], []
        for i, q in enumerate(c["pool"]):
            (dep if int((i + 1) * r + 1e-9) > int(i * r + 1e-9) else act).append(q)
        c["pool"] = act
        c["deps"] = dep
        c["earners"] = []
        for j, q in enumerate(dep):
            e = act[j % len(act)]
            people[q]["inactive"] = True
            people[q]["earner"] = e
            people[e].setdefault("deps", []).append(q)
        for e in act:
            ds = people[e].get("deps")
            if ds:
                people[e]["hfrac"] = HOUSE_DEP_EQ / (1.0 + len(ds) * HOUSE_DEP_EQ)
                c["earners"].append(e)


def build(n_cities):
    accounts = [f"sehir{i}" for i in range(n_cities)]
    L = Ledger(accounts)
    if FOUND_FUND:
        L.fund_pools = {f"KFON{i}_sermaye" for i in range(n_cities)}        # K-215: kuruluş fonu havuzları (kind eşlemesi Ledger.pay'de)
    loncas = [f"lonca{i}" for i in range(6 + (NEW_SLOTS if (INNOV_ON and LIFE_ON and FEE_ON and LONCA_COST and INNOV_LONCA) else 0))]
    cities, firms, people = [], {}, {}
    plans = city_plans(n_cities)
    for ci in range(n_cities):
        c = dict(i=ci, acct=accounts[ci], imp_cum={}, firms=[], players=[], seekers=[], pool=[], rep=100.0,
                 last_demand=defaultdict(float), last_imports=defaultdict(float), last_output=defaultdict(float),
                 last_sold=defaultdict(float), sold_units=0.0,
                 freight_w=0.0, freight_prev=0.0, freight_want_w=0.0, missed_w=0, served_w=0, unpaid_w=0, paid_w=0, imp_val=0.0, exp_val=0.0, cons_val=0.0, dem_units=0.0, got_units=0.0)
        plan = plans[ci]
        for kind, n in plan:
            for k in range(n):
                name = f"s{ci}_{kind}{k}"
                firms[name] = dict(kind=kind, city=ci, lonca=loncas[len(firms) % 6], workers=[], owner=None,
                                   capacity=firm_capacity(kind), capitalized=False)
                c["firms"].append(name)
        mname = f"s{ci}_belediye0"
        firms[mname] = dict(kind="belediye", city=ci, lonca=loncas[0], workers=[], owner=None, capacity=10 ** 6, capitalized=True)
        c["firms"].append(mname)
        ahirs = [f for f in c["firms"] if firms[f]["kind"] == "ahir"]
        if CITY_START_CASH > 0:                      # D4: başlangıç kasası = kayıtlı basım (minted ve fiscal_minted artar; korunum Σbakiye = minted bozulmaz); oyuncu paraları önce bu kasadan, kalan açık settle() ile basılır
            L.bal[c["acct"]] += CITY_START_CASH
            L.minted += CITY_START_CASH
            L.fiscal_minted += CITY_START_CASH
            L.flows["baslangic_kasasi"] += CITY_START_CASH
        for k in range(PLAYERS_PER_CITY):
            p = f"s{ci}_p{k}"
            L.pay(c["acct"], p, START_AKCE, "baslangic_parasi")
            f = ahirs[k % len(ahirs)]
            firms[f]["workers"].append(p)
            people[p] = dict(tier=0, wage=TIER_WAGE[0], firm=f, who="oyuncu", city=ci)
            if INNOV_ON and k % 10 == INNOV_MOD:
                people[p]["innov"] = True                  # K-167: inovatör (şehir başına %10)
                if INNOV_ON and PATH_ON:
                    people[p]["path"] = PATH_CYCLE[(k // 10) % len(PATH_CYCLE)]     # K-170: inovatör yolu
            c["players"].append(p)
        cities.append(c)
    n_npc_ = NPC_X + NPC_Y * PLAYERS_PER_CITY * n_cities
    tperm_ = random.Random(f"npc-tier|{RUN_SEED}").sample(range(n_npc_), n_npc_) if RUN_SEED else None      # M3: RUN_SEED > 0 = bağımsız tohum: NPC kademe karışımı (60/30/10) şehirlere rastgele dağılır; 0 = eski dağılım (k % 10), çıktı özdeş
    for k in range(n_npc_):
        q = f"npc{k}"
        t = tier_of(k if tperm_ is None else tperm_[k])
        ci = k % n_cities
        people[q] = dict(tier=t, wage=TIER_WAGE[t], firm=None, who="npc", city=ci)
        cities[ci]["pool"].append(q)
        if NPC_START_CASH > 0:                      # D7 (A7): NPC başlangıç nakdi = haftalık harcama x hafta; kayıtlı kuruluş basımı (D4 CITY_START_CASH ile aynı desen: minted ve fiscal_minted artar, korunum bozulmaz)
            cash = round(MPC0 * TIER_WAGE[t] * CYCLES_PER_WEEK * NPC_START_CASH, 6)
            L.bal[q] += cash
            L.minted += cash
            L.fiscal_minted += cash
            L.flows["npc_baslangic_nakdi"] += cash
    if NPC_HH_START > 0:                             # M12 (6): NPC hane acilis birikimi = NPC_HH_START hafta x hf1 haftalik sepet; BASIM DEGIL (M11 deseni): Ledger.opening ve flows acilis_devreden_kazanc_hane (korunum: Sbakiye = opening + minted)
        hh_ = round(NPC_HH_START * sum(REF_BASE[p_] * q_ for p_, q_ in BASKET.items()) * MM_BASE0, 6)
        for q in people:
            if people[q]["who"] == "npc":
                L.bal[q] += hh_
                L.opening += hh_
                L.flows["acilis_devreden_kazanc_hane"] += hh_
    if NPC_HOUSE == 1:
        make_households(cities, people)                          # D9 (A2): işgücü dışı NPC'ler ve geçimi sağlayan çalışan atamaları (varsayılan: tek kişi, hiçbir şey değişmez)
    L.settle()
    return L, loncas, cities, firms, people
