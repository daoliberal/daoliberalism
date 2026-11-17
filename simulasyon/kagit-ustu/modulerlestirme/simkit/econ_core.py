"""simkit.econ_core: ekonomi çekirdeği: meslek/kademe, ücret-navlun-kira-ücret oranı, işletme sermayesi, öncelikli paylaştırma, rampa.

ARAYÜZ: prio_alloc, fee_rate, fee_avg, isrole, tier_of, ulc_base, working_capital, hire_cash_ok, hire_gate, city_wage_room, kamu_ucret_yuku, sehir_zorunlu, avans_bekleyen, freight, land, ramp, isres, innov_uygun, cap_ceiling, sehir_destekli
OKUR: W.REF, W.LAND, W.FEES vb. (W gerektiren işlevler), params sabitleri. YAZAR: yok (saf okuma).
KATMAN: L0.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix


def sehir_destekli(d, ek=0):
    """ek: M11 O3: kadroya eklenecek kişi sayısı (varsayılan 0: bugünkü koşul); hire_cash_ok "bu kişi alınırsa destekli olur mu" diye ek=1 ile sorar (sıfır çalışanlı kamu işletmesi ilk kişiyi alabilsin).
    ücreti (eksiği) şehir hesabından ödenen firma mı: belediye, küçük sahipsiz kamu altyapısı (UTILITY türü, 0 < çalışan <= UTILITY_MAX; K-135) ya da KAMU_AVANS=1 iken sahipsiz kamu hizmeti kurumu (KAMU_KINDS).
    week_cycle_parts (avans ve "4) ücret") ve human.ode_hesabi tek bu koşulu kullanır. SAF boolean."""
    n = len(d["workers"]) + ek
    return d["kind"] == "belediye" or (d["kind"] in UTILITY and d["owner"] is None and 0 < n <= UTILITY_MAX) \
        or bool(KAMU_AVANS and d["kind"] in KAMU_KINDS and d["owner"] is None and n > 0)      # M3.4: kamu hizmeti kurumlarında (üniversite, okul, hastane) ücret ve avans açığı da şehirden


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


def prio_alloc(W, items, ci, avail, rent=0.0, mk=1.0):
    """K-174: bakiye yetmezse öncelik grupları sırayla karşılanır: sepet (kalemleri kendi arasında orantılı), dayanıklı, donanım/yazılım, eğlence, restoran, seyahat, moda, mücevher, büyük konut (gelir esnekliği sırası)."""
    avail = max(0.0, avail)
    out = {}
    groups = defaultdict(list)
    for p in items:
        groups[PRIO_RANK.get(p, 0)].append(p)
    for rk in sorted(groups):
        cost = sum(items[p] * land(W, ci, p) * W.MARKET_MARKUP * mk for p in groups[rk]) + (rent if rk == 0 else 0.0)      # zorunlu grup = sepet + kira
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
    return WORKING_CAPITAL_CYCLES * (wages + ix(W, RENT) + inp)


def avans_bekleyen(W, ci):
    """M11.2 (2): ci şehrinde bu hafta alınmış ama avansı henüz ödenmemiş kamu işyeri (ahır ve sehir_destekli) kadrosunun şehir hesabından çıkacak tutarı (week_cycle_parts "0) avans": adv - firma kasası). SAF okuma."""
    top = 0.0
    people = W.people
    for g in W.cities[ci]["firms"]:
        e = W.firms[g]
        if e["kind"] == "ahir" or sehir_destekli(e):
            adv = sum(people[q]["wage"] for q in e["workers"] if people[q].get("avans"))
            if adv > 0:
                top += max(0.0, adv - W.L.bal.get(g, 0.0))
    return top


def sehir_zorunlu(W, ci):
    """M11.2 düzeltme 1 (küçük): ci şehrinin bu hafta yapacağı ZORUNLU çıkışların tahmini (SAF okuma): (a) işsizlik ödeneği = şu an iş arayanlar x döngü ödeneği x haftalık döngü; (b) mevcut (avanssız) kamu kadrosunun ücret + kira açığı
    (kamu_hizmet_destegi / belediye_ucreti, week_cycle_parts "4) ücret": haftalık ücret yükü - firma kasası). Bekleyen avanslar avans_bekleyen'de ayrıca sayılır. HIRE_GATE_CITY_REAL harcanabilir tutardan bunu düşer."""
    people = W.people
    c = W.cities[ci]
    wi = W.WI[ci]
    top = 0.0
    for q in c["seekers"]:
        w_ = min(people[q]["wage"], TIER_WAGE[0] * wi) if SKILL_ON else people[q]["wage"]
        top += UNEMPLOY_BENEFIT * w_ * (WELF_CITY_MULT if W.WELF_ON else 1.0) * CYCLES_PER_WEEK
    for g in c["firms"]:
        e = W.firms[g]
        if e.get("dead") or not (e["kind"] == "belediye" or sehir_destekli(e)):
            continue
        yuk = sum(people[q]["wage"] for q in e["workers"] if not people[q].get("avans")) + (0.0 if e["kind"] == "belediye" else ix(W, RENT))
        top += max(0.0, CYCLES_PER_WEEK * yuk - W.L.bal.get(g, 0.0)) if yuk > 0 else 0.0
    return top


def kamu_ucret_yuku(W, ci):
    """M11.2 (5): ci sehrinin MEVCUT haftalik zorunlu yuku (SAF okuma): is arayanlarin issizlik odenegi + kamu kadrosunun (belediye, sehir_destekli, ahir) tum calisanlarinin haftalik ucreti (avansli yeni alinanlar dahil) + kamu isletmelerinin kirasi. Alinan her kisi workers listesine girdigi icin hafta icinde kumulatiftir."""
    people = W.people
    c = W.cities[ci]
    wi = W.WI[ci]
    top = 0.0
    for q in c["seekers"]:
        w_ = min(people[q]["wage"], TIER_WAGE[0] * wi) if SKILL_ON else people[q]["wage"]
        top += UNEMPLOY_BENEFIT * w_ * (WELF_CITY_MULT if W.WELF_ON else 1.0) * CYCLES_PER_WEEK
    for g in c["firms"]:
        e = W.firms[g]
        if e.get("dead") or not (e["kind"] in ("belediye", "ahir") or sehir_destekli(e)):
            continue
        top += CYCLES_PER_WEEK * sum(people[q]["wage"] for q in e["workers"]) + (0.0 if e["kind"] in ("belediye", "ahir") else CYCLES_PER_WEEK * ix(W, RENT))
    return top


def city_wage_room(W, ci):
    """M11.2 (5) CITY_BUDGET_RULE: sehrin yeni kamu ucreti (belediye is garantisi ve tum kamu alimlari) icin haftalik kalan odasi = (surdurulebilir gelir - mevcut zorunlu yuk) x borc kisma carpani (kasa fazlasi payi girmez: ucret kalici taahhut);
    mevcut zorunlu yuk = max(son pencere zorunlu ort, kamu_ucret_yuku simdi). Butce henuz yoksa (acilis) ya da bayrak kapaliyken sinirsiz (inf). SAF okuma."""
    L = W.L
    par = L.cb_par.get(W.cities[ci]["acct"]) if L.cb is not None else None
    if par is None:
        return float("inf")
    inc, man, dfac = par
    x = inc - max(man, kamu_ucret_yuku(W, ci))                                   # kasa fazlasi payi YOK: ucret kalici taahhut, yalniz surdurulebilir gelirden finanse edilir
    return x * dfac if x > 0 else x


def hire_gate(W, f, bal, kredi=0.0):
    """HIRE_CASH_GATE: firma (kasası bal) bir kişi daha alırsa mevcut kadro + yeni kişinin (taban ücret) HIRE_CASH_CYCLES döngülük ücretini karşılar mı. Hafta 1 (açılış kadrosu) ve bayrak kapalıyken her zaman (True, 0.0). HIRE_GATE_ALL (M11): bayrak açık sayılır ve yeni kişinin ücreti gerçek ölçekte alınır.
    Döner (ok, eksik): eksik = kapı yalnız kredi sayesinde geçiyorsa alımdan ÖNCE fiilen çekilmesi gereken köprü kredisi (credit_core.hire_cash_secure çeker); 0.0 = kasa yeter.
    M11.2: HIRE_GATE_CITY_REAL = sehir_destekli firmada ödeme gücü şehrin gerçekte harcayabileceği tutar (Ledger.city_spendable - bekleyen avans - sehir_zorunlu); kamu işletmesine kredi ve 3b uygulanmaz.
    HIRE_GATE_GROWTH: (a) ödeme gücüne kredi (çağıran credit_core.kopru_limit ile verir) eklenir; (b) boşalan yeri doldurma (çalışan < kadro_son) kasa şartından yalnız şu iki şart BİRLİKTE sağlanırsa muaf: (i) kasa + kredi yeni kişinin ilk haftalık ücretini
    (avans dahil CYCLES_PER_WEEK x ücret, gerçek ölçek) karşılar; (ii) son 4 haftalık ortalama NET faaliyet geliri (satış - girdi alımı - kira - ücret; W.snet_hist) >= yeni kişinin haftalık ücreti. Kadro artıran alım kasa + kredi şartında kalır. SAF okuma."""
    if not (HIRE_CASH_GATE or HIRE_GATE_ALL) or W.week_no <= 1:
        return True, 0.0
    people = W.people
    kamu = HIRE_GATE_ALL and (sehir_destekli(W.firms[f]) or sehir_destekli(W.firms[f], 1))
    if kamu:
        d_ = W.firms[f]
        c_acct = W.cities[d_["city"]]["acct"]
        if HIRE_GATE_CITY_REAL:
            kind_ = "belediye_ucreti" if d_["kind"] == "belediye" else "kamu_hizmet_destegi"      # avansın kendi kind'i (week_cycle_parts "0) avans")
            bal = max(bal, W.L.city_spendable(c_acct, kind_) - avans_bekleyen(W, d_["city"]) - sehir_zorunlu(W, d_["city"]))      # M11.2 (2): şehir bakiyesi değil, avansın gerçekte ödeyebileceği limit; bekleyen avanslar ve o hafta çıkacak zorunlu kalemler aynı havuzdan düşer
        else:
            bal = max(bal, W.L.bal.get(c_acct, 0.0))      # M11 (A): ücreti şehir hesabından ödenen firmada ödeme gücü şehir hesabıdır (human.ode_hesabi ile aynı koşul; M11 O3: kadro 0 iken, "bu kişi alınırsa destekli olur" da sayılır: ilk kişi alınabilir); yoksa kamu hizmeti kasasız kilitlenir
    if HIRE_GATE_REAL or HIRE_GATE_ALL:                                          # M2.3: yeni kişinin ücreti gerçek ölçekte (avans bununla ödenir)
        d = W.firms[f]
        yeni = TIER_WAGE[0] * W.WI[d["city"]] * (KIND_WM.get(d["kind"], 1.0) if SVC_KINDS else 1.0)
    else:
        yeni = TIER_WAGE[0]
    if kamu and CITY_BUDGET_RULE and city_wage_room(W, d["city"]) < CYCLES_PER_WEEK * yeni:
        return False, 0.0                                                        # M11.2 (5): kamu alimi surdurulebilir gelir - mevcut zorunlu yuk (kamu kadro ucreti dahil, hafta icinde kumulatif) marjina bakar: yeni kisinin haftalik ucreti sigmiyorsa taahhut altina girilmez
    yuk = sum(people[q]["wage"] for q in W.firms[f]["workers"]) + yeni
    if REVIVE_HYGIENE and not kamu and W.week_no - W.firms[f].get("wfail_w", -99) <= HIRE_FAIL_WEEKS:
        return False, 0.0                                                        # hijyen: ücret ödeyemeyip çalışan kaybeden işveren kısa süre ilan açamaz (bot ve insan aynı)
    gereken = (HIRE_WEEK_CYCLES if REVIVE_HYGIENE else HIRE_CASH_CYCLES) * yuk      # REVIVE_HYGIENE: bir tam haftalik ucret (ayni hafta al-cikar olmasin)
    if not HIRE_GATE_GROWTH:
        return bal >= gereken, 0.0
    if kamu:
        kredi = 0.0                                                              # kamu işletmesi köprü kredisi çekmez; yalnız şehir limiti (HIRE_GATE_CITY_REAL)
    d = W.firms[f]
    haftalik = CYCLES_PER_WEEK * yeni
    cand = []
    if bal + kredi >= gereken:
        cand.append(max(0.0, gereken - bal))                                     # M11.2 (3a): kredi sayesinde geçiyorsa fark alımdan önce çekilir
    h_ = getattr(W, "snet_hist", {}).get(f)
    if not kamu and h_ and len(d["workers"]) < d.get("kadro_son", 0) and bal + kredi >= haftalik and sum(h_) / len(h_) >= haftalik:
        cand.append(max(0.0, haftalik - bal))                                    # M11.2 (3b): boşalan yer; ilk haftalık ücret kasa/kredi ile karşılanır VE net faaliyet geliri yeni kişinin ücretini taşır
    if not cand:
        return False, 0.0
    return True, min(cand)


def hire_cash_ok(W, f, bal, kredi=0.0):
    """hire_gate'in yalnız karar kısmı (SAF okuma): bal + kredi ile işe alım kapısı geçilir mi. Fiilen kredi çekmek gerekiyorsa credit_core.hire_cash_secure kullanılır."""
    return hire_gate(W, f, bal, kredi)[0]


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


def mk_bottleneck(W, c):
    """M15 (MARKET_OPEN): sehirde market kapasite darbogazi orani = onceki haftanin dongu basi birim talebi / market kapasitesi (calisan x STORE_UNITS_PER_WORKER). Kapasite yoksa buyuk sayi. SAF okuma."""
    cap = sum(len(W.firms[m]["workers"]) for m in c["firms"] if W.firms[m]["kind"] == "market" and not W.firms[m].get("dead")) * STORE_UNITS_PER_WORKER
    dem = c.get("dem_units_prev", 0.0) / CYCLES_PER_WEEK
    if dem <= 1e-9:
        return 0.0
    return dem / cap if cap > 1e-9 else 99.0


def ahirda(W, q):
    """q ahirda mi (gercek bir isi yok): firmasi ahir turunden. Insan (human.kur_eksikleri) ve botlarin kurucu aday listeleri (ENTRY_JOBLESS acikken) ayni tek kaynagi kullanir. SAF okuma."""
    f = W.people[q]["firm"]
    return f is not None and W.firms[f]["kind"] == "ahir"
