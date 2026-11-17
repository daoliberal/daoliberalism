"""simkit.entry_open: K-213 girişim kapıları açılır (yalnız ENTRY_OPEN açıkken çağrılır).

AMAÇ: sahip kararı (2026-10-28): oyuncular zenginleşmek için kıtlığın sürmesini beklemesin. (1) K-212 giriş kuralı kalkar; (2) kuruluşta itibar şartı ve
itibara bağlı kredi tavanı kalkar; (3) kuruluş kredisi harcı + işletme sermayesini (FOUND_BUF dahil) tam karşılar, lonca havuzu yetmezse sıradaki loncaya
bakılır, hiçbiri yetmezse kuruluş bekler (gecikme sayılır); (5) piyasa sinyali, kıtlık, arz fazlası, ithal fiyat, kârlılık ve girdi eşiği kapıları şart değil,
sektör seçiminde tercih ağırlığıdır (deterministik ağırlıklı sıralama; yalnız girdisi hiçbir şehirde üretilmiyorsa kurulmaz); (6) rakip kohortu: her NPC firmaya
(ahır/belediye/Ar-Ge hariç) en az EO_COHORT_PER rakip oyuncu firması, EO_COHORT_W0..W1 haftalarına zincir sırasıyla yayılır. (4) genç firma verim tabanı
week_open'da EO_SKILL ile uygulanır.
ARAYÜZ: eo_pre_week (kohort + izleme), eo_organic (şehir başına organik kuruluş), eo_found (tek kuruluş), eo_input_ok, eo_weight (ölçüm/durum: simkit.entry_open_meas)
OKUR: W.firms, W.people, W.cities, W.loncas, W.L, W.PRICE, W.PM, W.last_short/want_last/prod_last. YAZAR: firma kayıtları, ledger (L.pay), W.eo, W.eo_stat.
KATMAN: L6 (founding, credit_core, dao_core üstünde; week_people altında).
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
import random
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.lab_meas import lab_ev, lab_stamp
from simkit.credit_core import lendable, LR_NEW, fund_bal, fund_pool, opex_week, ls_gider, ls_kayit, lt_damga
from simkit.credit_meas import ks_karar
from simkit.dao_core import pick_lonca
from simkit.econ_core import fee_avg, freight, isres, working_capital, mk_bottleneck, ahirda
from simkit.founding import threshold
from simkit.entry_open_meas import eo_state as _st, eo_stat_add
from simkit.young_core import fund_lo, yk_state
from simkit.young_kit import yk_found_init, yk_partner_count, yk_partner_join


def _depth(W, kind):
    ins = W.RECIPES[kind][1]
    return 0 if not ins else 1 + max((_depth(W, PRODUCER[q]) for q in ins if q in PRODUCER and PRODUCER[q] != kind), default=-1)


def eo_input_ok(W, p):
    """girdisi hiçbir şehirde üretilmiyorsa kurulmaz (isteğe bağlı girdiler hariç)."""
    for q in W.RECIPES[PRODUCER[p]][1]:
        if q in ("yazilim", "bilgisayar", "koruma"):
            continue
        if not any(W.prod_last.get((j, q), 0.0) > 1e-9 for j in range(len(W.cities))):
            return False
    return True


def eo_weight(W, c, p, sig_v, n_live):
    """tercih ağırlığı (>0): kıtlık sinyali, fiyat çarpanı (kıtlık/arz fazlası), birim marj (kârlılık), ithal fiyat, girdi eksiği, rakip kalabalığı, pano kıtlığı."""
    PM, PRICE, LAND, WI = W.PM, W.PRICE, W.LAND, W.WI
    ci = c["i"]
    k = PRODUCER[p]
    thr = max(1e-9, threshold(W, p))
    w_sig = 1.0 + EO_W_SIG * min(EO_W_SIG_CAP, max(0.0, sig_v) / thr)
    w_pm = min(2.0, max(0.5, PM[(ci, p)]))
    o_, i_ = W.RECIPES[k]
    rate_ = list(o_.values())[0]
    rev = sum(PRICE[(ci, pp)] * qq for pp, qq in o_.items()) * (1 - fee_avg(W))
    inp = sum(qq * min(PRICE[(j, pp)] + freight(W, j, pp, abs(j - ci)) for j in range(len(W.cities)) if W.prod_last.get((j, pp), 0.0) > 1e-9 or j == ci)
              for pp, qq in i_.items() if pp not in ("yazilim", "bilgisayar")) * rate_ if i_ else 0.0
    cost = TIER_WAGE[0] * WI[ci] + ix(W, RENT)
    w_feas = min(2.0, max(0.1, (rev - inp) / (FEAS * cost))) if FEAS > 0 else 1.0       # eski fizibilite kapısı: marj >= FEAS x (ücret + kira); şimdi ağırlık (1 = tam eşikte)
    w_imp = 1.0 if PRICE[(ci, p)] <= LAND[(ci, p)] * 1.02 else EO_IMP_PEN
    sh = 0.0
    for q in i_:
        if q in ("yazilim", "bilgisayar", "koruma"):
            continue
        sh = max(sh, W.last_short.get(q, 0.0) / max(1e-9, W.want_last.get(q, 0.0)))
    w_inp = max(0.2, 1.0 - sh)
    w_crowd = 1.0 / (1.0 + n_live.get(k, 0) / EO_CROWD)
    b = getattr(W, "board", None) if SECTOR_BOARD else None
    w_sb = 1.0
    if b is not None:
        pr = b["prod"].get(p)
        if pr is not None:
            w_sb = 1.0 + min(1.0, 10.0 * pr["persist"])
    return w_sig * w_pm * w_feas * w_imp * w_inp * w_crowd * w_sb


def eo_found(W, w, c, founder, kind, cohort=False, key=None, partners=()):
    """tek firma kuruluşu: kredi harç + işletme sermayesini tam karşılar. True = kuruldu; False = lonca havuzu (FOUND_FUND açıkken kuruluş fonu) yetmedi (kuruluş bekler).
    K-215/K-216: FOUND_FUND açıkken kredi şehrin kuruluş fonundan (lonca yalnız üyelik); YOUNG_KIT+FOUND_FUND açıkken peşin nakit = harç + YK_UPFRONT_WEEKS haftalık gider (kalanı dayanma limitinden çekilir);
    partners: ortaklı kuruluş (K-216 (7)), ortaklar aynı firmada çalışır."""
    L = W.L
    REP = W.REP
    closed = W.closed
    firms = W.firms
    loans = W.loans
    loncas = W.loncas
    people = W.people
    player_firms = W.player_firms
    contracts = W.contracts
    cx_stat = W.cx_stat
    PRICE = W.PRICE
    RECIPES = W.RECIPES
    new_slots = W.new_slots
    cities = W.cities
    S = _st(W)
    fname = f"s{c['i']}_{kind}_oy{L.flows['kurulan_oyuncu_firmasi_adet']:.0f}"
    firms[fname] = dict(kind=kind, city=c["i"], lonca=loncas[0], workers=[], owner=founder, capacity=CAP_OTHER, capitalized=True, born=w, eo=True)
    if cohort:
        firms[fname]["cohort"] = True
    if PATH_ACT and people[founder].get("innov"):
        firms[fname]["innov_owner"] = True
    fund_mode = FOUND_FUND and CREDIT_ON
    if YOUNG_KIT and fund_mode:
        wc_need = YK_UPFRONT_WEEKS * opex_week(W, fname, 1 + len(partners))      # K-216 (1): peşin nakit = bir haftalık gider; dayanma limiti ihtiyaç oldukça çekilir
    else:
        wc_need = FOUND_BUF * working_capital(W, firms, people, fname, extra_workers=1)
        if FOUND_WC_REAL and not FOUNDER_DEFER:                     # M2.1: kurucunun gerçek ücreti (TIER_WAGE[0] yerine) ilk haftaların sermayesine girer
            wc_need += FOUND_BUF * WORKING_CAPITAL_CYCLES * max(0.0, people[founder]["wage"] - TIER_WAGE[0])
    total = wc_need + ix(W, FOUND_HARC)                                    # kredi: harç + işletme sermayesi (FOUND_BUF dahil)
    open_ = [l_ for l_ in loncas if l_ not in closed]
    pref = pick_lonca(W, kind, open_) if open_ else None
    fund_ok = fund_mode and bool(open_) and fund_bal(W, c["i"]) >= total       # K-215a: kuruluş kredisi şehrin fonundan (lonca yalnız üyelik)
    if fund_ok:
        ok_ = open_
    elif fund_mode and not FF_FALLBACK:
        ok_ = []
    else:
        ok_ = [l_ for l_ in open_ if lendable(W, l_) >= total]
    if WEEKLY_CSV:
        W.WKC["kredi_basvuru"] += 1
        W.WKC["tavan_orani_toplam"] += max((lendable(W, l_) for l_ in open_), default=0.0) / max(1e-9, total)
    if not ok_:
        ks_karar(W, "ret")                                          # REKABET G4: davranışsız karar sayımı; lonca yoksa (pref None) da ret sayılır
        if KR_MEAS and pref is not None:                            # REKABET G4: davranışsız ret sebebi sayımı (tercih edilen loncaya yazılır)
            ls_kayit(W, w, pref, c["i"], kind, ls_gider(W, fname), "fon_yetersiz" if fund_mode else "kasa_yetersiz")
        del firms[fname]
        eo_stat_add(W, "havuz_gecikme_deneme")
        if fund_mode:
            eo_stat_add(W, "fon_gecikme_deneme")
        if key is not None and key not in S["delayed"]:
            S["delayed"].add(key)
            eo_stat_add(W, "havuz_gecikme_kuruluş")
        if WEEKLY_CSV:
            W.WKC["kredi_ret"] += 1
            W.WKC["nd_havuz"] += 1
        return False
    lo = pref if pref in ok_ else pick_lonca(W, kind, ok_)
    if lo != pref:
        eo_stat_add(W, "sonraki_lonca")
    firms[fname]["lonca"] = lo
    ks_karar(W, "onay")
    if KR_MEAS and not fund_ok:                                    # REKABET G4: davranışsız onay sayımı (fon kipinde kredi şehir fonundan; loncaya yazılmaz)
        ls_kayit(W, w, lo, c["i"], kind, 0.0, None)
    if new_slots and lo in new_slots:
        firms[fname]["ever_new"] = True
    rm = min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[founder] / 100)) if REP_EFFECT else 1.0       # itibar yalnız faizi etkiler
    if fund_ok:
        S_ = yk_state(W)
        L.pay(fund_pool(c["i"]), fname, total, "kurulus_fonu_kredi")      # K-215a: fon kredisi (kaydın alacaklısı KFON<i>; geri ödeme/faiz fona döner)
        loans[fname] = dict(lo=fund_lo(c["i"]), p0=total, out=total, miss=0, rate=LR_NEW(W) * rm, tur="kurulus")
        S_["wk"]["given"] += total
        S_["stat"]["fon_verilen"] += total
        S_["stat"]["fon_kuruluş_kredisi"] += total
        L.flows["kredi_fon_adet"] += 1
        if CX_ACT:
            L.flows["kredi_kurulus_adet"] += 1
            cx_stat["hacim_kurulus"] += total
        L.flows["kredi_adet"] += 1
        if KR_MEAS:                                    # REKABET G0: davranışsız ölçüm (verilen kuruluş kredisi tutarı)
            W.lo_stat["ks_verilen"] += total
    elif CREDIT_ON:
        ln_ = total * LOAN_SHARE
        L.pay(f"{lo}_sermaye", fname, total - ln_, "sermaye")
        L.pay(f"{lo}_sermaye", fname, ln_, "kredi_verilen")
        loans[fname] = dict(lo=lo, p0=ln_, out=ln_, miss=0, rate=LR_NEW(W) * rm, tur="kurulus")
        if CX_ACT:
            L.flows["kredi_kurulus_adet"] += 1
            cx_stat["hacim_kurulus"] += ln_
        L.flows["kredi_adet"] += 1
        if LONCA_TERMS:
            lt_damga(W, fname, loans[fname], ln_)      # REKABET G5: pd'siz kuruluş kredisi: tek açılış damgası (risk_tol sayacına girmez)
        if KR_MEAS:                                    # REKABET G0: davranışsız ölçüm (verilen kuruluş kredisi tutarı)
            W.lo_stat["ks_verilen"] += ln_
    else:
        L.pay(f"{lo}_sermaye", fname, total, "sermaye")
    L.pay(fname, c["acct"], ix(W, FOUND_HARC), "kurulus_harci")           # harç şehre (K-33), kredi parasıyla
    old = people[founder]["firm"]
    if old:
        firms[old]["workers"].remove(founder)
        if KR_MEAS:
            lab_ev(W, "cikis_gecis", old)                            # davranışsız sayaç (§4.6)
    elif founder in c["seekers"]:
        c["seekers"].remove(founder)
    firms[fname]["workers"].append(founder)
    if KR_MEAS:
        lab_stamp(W, fname)                                          # davranışsız: firma türü kuruluşta (kredi onaylandıktan sonra) bir kez
        lab_ev(W, "ise", fname)
    people[founder].update(firm=fname, founder=True)
    if FOUNDER_DEFER > 0:
        people[founder]["wage"] = 0.0                              # M2.1: kurucu ilk haftalarda kendine ücret ödemez (phase_wages sonraki haftalarda da sıfırlar)
    if partners:
        yk_partner_join(W, fname, c, partners)                     # K-216 (7): ortaklar aynı firmada çalışır
    c["firms"].append(fname)
    player_firms.append(fname)
    if YOUNG_KIT:
        yk_found_init(W, fname, kind, c["i"], partners)            # K-216: hedef kadro (asgari etkin ölçek), ölçek grubu sayacı
    if CONTRACT_N > 0:                                              # K-166: tedarik sözleşmesi
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
    S["firms"].append(fname)
    S["rec"][fname] = dict(born=w, cohort=cohort, kind=kind, city=c["i"], dead=None, snap={}, loan=round(total, 2), owner=founder, lonca=lo)
    if partners:
        S["rec"][fname]["partners"] = len(partners)
    eo_stat_add(W, "kurulan_kohort" if cohort else "kurulan_organik")
    return True


def _cands(W, c):
    people, worked = W.people, W.worked
    return [p for p in c["players"] if (people[p]["firm"] or (ENTRY_JOBLESS and p in c["seekers"])) and worked[p] >= FOUND_WORKED and not people[p].get("founder") and not isres(people[p]) and not (HUMAN_ON and p == W.human) and not (ENTRY_JOBLESS and ahirda(W, p))]      # DAO oyunu: insan kendiliğinden kurucu/ortak olmaz


def eo_organic(W, w, c, sig):
    """şehir başına organik kuruluş: oran sınırlı (EO_RATE), sektör ağırlıklı sıralamayla (kapılar yok)."""
    S = _st(W)
    ci = c["i"]
    if w < (EO_ORG_START if EO_ORG_START >= 0 else (EO_COHORT_W1 + 1 if EO_COHORT else 0)):
        return                                                      # kohort havuzu doldururken organik kuruluş bekler (havuz yarışı)
    cands = _cands(W, c)
    S["acc"][ci] += EO_RATE * len(cands)
    n = int(S["acc"][ci])
    if n <= 0 or not cands:
        return
    S["acc"][ci] -= n
    n_live = defaultdict(int)
    for f in c["firms"]:
        d = W.firms[f]
        if not d.get("dead") and d["workers"]:
            n_live[d["kind"]] += 1
    rng = random.Random(f"eo|{w}|{ci}" if not RUN_SEED else f"eo|{RUN_SEED}|{w}|{ci}")      # M3: RUN_SEED > 0 = bağımsız tohum (ölçüm); 0 = eski dizge, çıktı özdeş
    scored = []
    for p in PRODUCER:
        k = PRODUCER[p]
        if k == "ahir" or PROD_OF.get(k) != p:
            continue
        if not eo_input_ok(W, p):
            eo_stat_add(W, "girdi_yok")
            continue
        if w - W.LAST_ENTRY.get((ci, p), -999) < ENTRY_COOLDOWN:
            continue
        wt = eo_weight(W, c, p, sig.get(p, 0.0), n_live)
        scored.append((rng.random() ** (1.0 / max(1e-9, wt)), p))
    if MARKET_OPEN and w - W.LAST_ENTRY.get((ci, "market"), -999) >= ENTRY_COOLDOWN:
        r_ = mk_bottleneck(W, c)                                     # M15: market kurulus sinyali = kapasite darbogazi
        if r_ > MK_BOTTLE:
            wt = (1.0 + min(r_ - MK_BOTTLE, MK_BOTTLE_CAP)) / (1.0 + n_live["market"] / EO_CROWD)
            scored.append((rng.random() ** (1.0 / max(1e-9, wt)), "market"))
    scored.sort(key=lambda t: (-t[0], t[1]))
    for _, p in scored:
        if n <= 0 or not cands:
            break
        kind_ = "market" if p == "market" else PRODUCER[p]
        kp = yk_partner_count(W, kind_, ci) if YOUNG_KIT else 1       # K-216 (7): asgari etkin ölçeği büyük sektöre tek başına girilmez
        if kp > len(cands):
            eo_stat_add(W, "ortak_yok")
            yk_state(W)["stat"]["ortak_yok"] += 1
            continue
        if eo_found(W, w, c, cands[0], kind_, key=("org", w, ci, p), partners=tuple(cands[1:kp])):
            del cands[:kp]
            W.LAST_ENTRY[(ci, p)] = w
            n -= 1
        else:
            S["acc"][ci] += n                                        # havuz yetmedi: hak ertelenir
            break


def _plan(W):
    firms, cities = W.firms, W.cities
    kinds_last = ("market", "medya") + tuple(SVC_KINDS)
    items = []
    for f, d in firms.items():
        if d["owner"] is not None or d["kind"] in EO_COHORT_SKIP or d.get("dead"):
            continue
        k = d["kind"]
        dep = 99 if k in kinds_last else (0 if k == "lojistik" else (_depth(W, k) if k in PROD_OF else 98))
        items.append((dep, k, d["city"], f))
    items.sort()
    slots = [(it, s) for it in items for s in range(EO_COHORT_PER)]
    span = EO_COHORT_W1 - EO_COHORT_W0 + 1
    plan = []
    for idx, ((dep, k, ci, f), s) in enumerate(slots):
        plan.append(dict(npc=f, kind=k, city=ci, slot=s, week=EO_COHORT_W0 + idx * span // max(1, len(slots)), dep=dep, done=False))
    return plan


def _next_founder(W, ci):
    S = _st(W)
    c = W.cities[ci]
    ptr = S["ptr"]
    if ci not in ptr:
        el = [p for p in c["players"] if not W.people[p].get("founder") and not isres(W.people[p]) and not (HUMAN_ON and p == W.human)]      # DAO oyunu: insan kendiliğinden kohort kurucusu/ortağı olmaz
        random.Random(f"eo-cohort|{ci}" if not RUN_SEED else f"eo-cohort|{RUN_SEED}|{ci}").shuffle(el)
        ptr[ci] = [el, 0]
    el, i = ptr[ci]
    while i < len(el):
        q = el[i]
        i += 1
        if not W.people[q].get("founder") and not isres(W.people[q]) and W.people[q]["city"] == ci and q in c["players"] and not (HUMAN_ON and q == W.human):      # göç etmiş oyuncu başka şehrin listesindedir
            ptr[ci][1] = i
            return q
    ptr[ci][1] = i
    return None


def eo_pre_week(W, w):
    """haftanın başı: ölçüm kaydı (ölüm/kadro) ve rakip kohortu kuruluşu."""
    S = _st(W)
    firms = W.firms
    for f in S["firms"]:
        r = S["rec"][f]
        d = firms[f]
        if r["dead"] is None and d.get("dead"):
            r["dead"] = w - 1
        age = w - r["born"]
        if age in (12, 26, 52, 104) and age not in r["snap"]:
            r["snap"][age] = (0 if d.get("dead") else len(d["workers"]), bool(d.get("dead")))
    if EO_COHORT and ENTRY_OPEN and S["plan"] is None:                              # plan açılışta (ilk çağrı) NPC firma listesinden: sonradan eklenen yerli taban firmaları rakipsiz kalır
        S["plan"] = _plan(W)
        S["stat"]["kohort_plan"] = len(S["plan"])
    if not (EO_COHORT and ENTRY_OPEN) or w < EO_COHORT_W0:
        return
    per_city_fund = FOUND_FUND and CREDIT_ON and not FF_FALLBACK        # v13.0 çakışma düzeltmesi: fon şehir başınadır; fonu biten şehir yalnız kendi sırasını bekletir
    blocked = set()
    for it in S["plan"]:
        if it["done"] or it["week"] > w:
            continue
        ci = it["city"] if (EO_COHORT_SAMECITY or it["kind"] not in PROD_OF or (PROD_OF.get(it["kind"]) in LOCAL_ONLY)) else (it["city"] + 1) % len(W.cities)
        if ci in blocked:
            continue
        c = W.cities[ci]
        kp = yk_partner_count(W, it["kind"], ci) if YOUNG_KIT else 1        # K-216 (7): ortaklı kuruluş (ortaklar kohorttan)
        pos0 = W.eo["ptr"][ci][1] if ci in W.eo["ptr"] else 0
        q = _next_founder(W, ci)
        if q is None:
            it["done"] = True
            eo_stat_add(W, "kohort_kurucu_yok")
            continue
        parts = []
        for _ in range(kp - 1):
            x = _next_founder(W, ci)
            if x is None:
                break
            parts.append(x)
        if len(parts) < kp - 1:                                      # yeterli ortak yok: tek başına girmez, kuruluş atlanır (kurucular serbest)
            W.eo["ptr"][ci][1] = pos0
            it["done"] = True
            eo_stat_add(W, "ortak_yok")
            yk_state(W)["stat"]["ortak_yok"] += 1
            continue
        key = ("coh", it["npc"], it["slot"])
        if eo_found(W, w, c, q, it["kind"], cohort=True, key=key, partners=tuple(parts)):
            it["done"] = True
            it["fw"] = w
        else:
            if kp > 1:
                W.eo["ptr"][ci][1] = pos0                            # aynı kurucu ve ortaklar bir sonraki denemede
            else:
                W.eo["ptr"][ci][1] -= 1                              # aynı kurucu bir sonraki denemede
            if per_city_fund:
                blocked.add(ci)                                      # bu şehrin fonu yetmedi: şehrin sıradaki kuruluşları bekler (zincir sırası), diğer şehirler sürer
                continue
            break                                                    # lonca havuzu boş: sıradaki kuruluşlar da bekler (zincir sırası korunur)
