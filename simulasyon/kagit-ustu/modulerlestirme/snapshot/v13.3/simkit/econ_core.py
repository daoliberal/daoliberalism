"""simkit.econ_core: ekonomi çekirdeği: meslek/kademe, ücret-navlun-kira-ücret oranı, işletme sermayesi, öncelikli paylaştırma, rampa.

ARAYÜZ: prio_alloc, fee_rate, fee_avg, isrole, tier_of, ulc_base, working_capital, hire_cash_ok, freight, land, ramp, isres, innov_uygun, cap_ceiling, sehir_destekli
OKUR: W.REF, W.LAND, W.FEES vb. (W gerektiren işlevler), params sabitleri. YAZAR: yok (saf okuma).
KATMAN: L0.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403


def sehir_destekli(d):
    """ücreti (eksiği) şehir hesabından ödenen firma mı: belediye, küçük sahipsiz kamu altyapısı (UTILITY türü, 0 < çalışan <= UTILITY_MAX; K-135) ya da KAMU_AVANS=1 iken sahipsiz kamu hizmeti kurumu (KAMU_KINDS).
    week_cycle_parts (avans ve "4) ücret") ve human.ode_hesabi tek bu koşulu kullanır. SAF boolean."""
    return d["kind"] == "belediye" or (d["kind"] in UTILITY and d["owner"] is None and 0 < len(d["workers"]) <= UTILITY_MAX) \
        or bool(KAMU_AVANS and d["kind"] in KAMU_KINDS and d["owner"] is None and d["workers"])      # M3.4: kamu hizmeti kurumlarında (üniversite, okul, hastane) ücret ve avans açığı da şehirden


def ulc_base():
    """birim emek maliyeti normu. ULC_BASE_AUTO=0: sabit ULC_BASE (v13.1). 1: NPC kademe karışımının (60/30/10, tier_of) ücret/verim oranı: PROD_TIER ücret primiyle aynı olursa 1,0.
    prices ve week_open (cpi ayıklaması) tek bu değere bölerek ulc'yi normalize eder. SAF."""
    if not ULC_BASE_AUTO:
        return ULC_BASE
    mix = (0.6, 0.3, 0.1)
    return sum(m * TIER_WAGE[k] / TIER_WAGE[0] for k, m in enumerate(mix)) / sum(m * PROD_TIER[k] for k, m in enumerate(mix))


def cap_ceiling(d):
    """K-181 kapasite büyüme tavanı (işletme başına çalışan). v13.0: CX_CAP_MAX x CAP_OTHER. D7: CAP_GROWTH=1 ise işletmenin AÇILIŞ kapasitesi (cap0) tabandır;
    POP_SCALE açıkken taban nüfus ölçeğiyle büyür (kapalıyken çarpan 1,0). Açılış kapasitesini elle/otomatik değiştirmek tavanı yalnız CAP_GROWTH=1 iken değiştirir."""
    if CAP_GROWTH and "cap0" in d:
        return CX_CAP_MAX * d["cap0"]
    return CX_CAP_MAX * CAP_OTHER * POP_SCALE_FACTOR


def prio_alloc(W, items, ci, avail, rent=0.0):
    """K-174: bakiye yetmezse öncelik grupları sırayla karşılanır: sepet (kalemleri kendi arasında orantılı), dayanıklı, donanım/yazılım, eğlence, restoran, seyahat, moda, mücevher, büyük konut (gelir esnekliği sırası)."""
    avail = max(0.0, avail)
    out = {}
    groups = defaultdict(list)
    for p in items:
        groups[PRIO_RANK.get(p, 0)].append(p)
    for rk in sorted(groups):
        cost = sum(items[p] * land(W, ci, p) * W.MARKET_MARKUP for p in groups[rk]) + (rent if rk == 0 else 0.0)      # zorunlu grup = sepet + kira
        frac = 1.0 if cost <= avail + 1e-12 else (avail / cost if cost > 0 else 1.0)
        for p in groups[rk]:
            out[p] = items[p] * frac
        avail = max(0.0, avail - cost * frac)
    return out


def fee_rate(W, lo):
    FEES = W.FEES
    return FEES.get(lo, LONCA_FEE)


def fee_avg(W):
    FEES = W.FEES
    return sum(FEES.values()) / len(FEES) if FEES else LONCA_FEE


def innov_uygun(W, q):
    """q Ar-Ge DAO'suna araştırmacı olarak alınabilir mi (insan dışlaması hariç, o free_innovators'ta): alım önceliği 0 (iş arayan), 1 (başka işte) ya da None (alınamaz).
    free_innovators ve insanın gözlemindeki Ar-Ge ilanı (human.ilanlar) aynı yüklemi kullanır."""
    i_ = W.people[q]
    if not (i_.get("innov") and (not PATH_ACT or i_.get("path") in ("arastirmaci", "dao")) and not i_.get("dao_active") and not i_.get("founder") and not isres(i_) and not isrole(i_)):
        return None
    if i_["firm"] is None:
        return 0
    firms = W.firms
    kd = firms[i_["firm"]]["kind"]
    if kd == "ahir" and len(firms[i_["firm"]]["workers"]) <= AHIR_HERD_WORKERS:
        return None
    if kd == "arge":
        return None
    return 1


def isrole(info):
    """K-170: kişi şu an bir firmada yönetici ya da uzman."""
    return info.get("rolefirm") is not None and info["rolefirm"] == info["firm"]


def tier_of(i):
    r = i % 10
    return 0 if r < 6 else (1 if r < 9 else 2)


def working_capital(W, firms, people, f, extra_workers=0):
    """K-88: iki döngülük ücret + kira + girdi; mağaza için girdi = toptan alım (kapasite × ortalama referans fiyat)."""
    RECIPES = W.RECIPES
    d = firms[f]
    outputs, inputs = RECIPES[d["kind"]]
    n = len(d["workers"]) + extra_workers
    inp = 0.0
    if inputs:
        main, rate = next(iter(outputs.items()))
        inp = sum(q * land(W, d["city"], p) for p, q in inputs.items()) * rate * n
    elif d["kind"] == "market":
        avg_unit = sum(q * land(W, d["city"], p) for p, q in BASKET.items()) / sum(BASKET.values())
        inp = STORE_UNITS_PER_WORKER * avg_unit * n
    wages = sum(people[q]["wage"] for q in d["workers"]) + extra_workers * TIER_WAGE[0]
    return WORKING_CAPITAL_CYCLES * (wages + RENT + inp)


def hire_cash_ok(W, f, bal):
    """HIRE_CASH_GATE: firma (kasası bal) bir kişi daha alırsa mevcut kadro + yeni kişinin (taban ücret) HIRE_CASH_CYCLES döngülük ücretini karşılar mı. Hafta 1 (açılış kadrosu) ve bayrak kapalıyken her zaman True."""
    if not HIRE_CASH_GATE or W.week_no <= 1:
        return True
    people = W.people
    if HIRE_GATE_REAL:                                          # M2.3: yeni kişinin ücreti gerçek ölçekte (avans bununla ödenir)
        d = W.firms[f]
        yeni = TIER_WAGE[0] * W.WI[d["city"]] * (KIND_WM.get(d["kind"], 1.0) if SVC_KINDS else 1.0)
    else:
        yeni = TIER_WAGE[0]
    return bal >= HIRE_CASH_CYCLES * (sum(people[q]["wage"] for q in W.firms[f]["workers"]) + yeni)


def freight(W, j, p, dist):
    """K-119: birim navlun = referans × oran × mesafe × satıcı şehrin ücret endeksi (taşımacılığın ana maliyeti emektir)."""
    LOG_MULT = W.LOG_MULT
    REF = W.REF
    WI = W.WI
    if p in NO_FREIGHT:
        return 0.0                              # K-130: elektrik şebekeden akar, lojistik kapasitesi gerekmez (iletim kaybı ihmal)
    return REF[p] * NAVLUN * dist * WI.get(j, 1.0) * FREIGHT_W.get(p, 1.0) * LOG_MULT[0]


def land(W, ci, p):
    REF = W.REF
    return W.LAND.get((ci, p), REF[p]) if ci is not None else REF[p]


def ramp(W, state):
    """K-143: yeni sektörün benimseme eğrisi: açıldığı haftadan RAMP_WEEKS içinde 0 → 1 (talep ve firma benimsemesi birden gelmez)."""
    NOW = W.NOW
    return min(1.0, (NOW[0] - state.get("since", 0) + 1) / RAMP_WEEKS) if state.get("since") is not None else 1.0


def isres(info):
    """K-167: kişi şu an bir Ar-Ge DAO'sunda çalışıyor mu (araştırmacı ya da kurucu)."""
    return info.get("res") is not None and info["firm"] == info["res"]
