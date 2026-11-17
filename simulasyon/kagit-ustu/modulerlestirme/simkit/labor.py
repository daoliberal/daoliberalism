"""simkit.labor: işgücü: açık pozisyon, yeniden istihdam, istihdam, yönetici adımı, itibar.

ARAYÜZ: producing_count, owner_sold, base_need, start_consumers, start_targets, start_hires, start_setup, npc_opening_stock, srev_roll, kadro_kaydet, start_stock, start_report, derived_increment, staffing, pop_ahir_player, openings, restaff, reputation, mgr_step,
        offer_ok, pick_worker, fire_pick, player_inflow, player_inflow_all (D6/D7: işe alım ve çıkarma kuralları, yeni oyuncu katılımı),
        adj_target, sep_step, disc_step, npc_population (D10: B2 kadro düzeltme hızı, B3 ayrılma, B7 işgücü dışına çıkış, B6 kamu istihdamı payda),
        ghost_step, ghost_support (D11: D2 hayalet firma sayımı ve kapanışı),
        res_target (te-denge G3: NPC_RES_REL hedef işletme rezervi)
OKUR/YAZAR: W.firms, W.people, W.cities; W.week_no, W.last_root_short (yayın).
KATMAN: L6 (en üst).
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
import math
import zlib
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.lab_meas import lab_ev, human_cikis, hij_say
from simkit.wages import kadro_ucreti
from simkit.credit_core import LR_NEW, lendable, kopru_limit, hire_cash_secure, lt_alacakli, lt_damga, lt_ode, lt_odeyen
from simkit.econ_core import isres, isrole, tier_of, working_capital, city_wage_room
from simkit.firm_exit import pcr_of, npc_die, revive_plant_take, revive_plant_cost, revive_plant_buy
from simkit.sector_core import son_uretici, sole_uretici_yok, zincir_urunleri
from simkit.human import human_hide, human_unhide, human_blocked
from simkit.fiscal import pay_owner_dividend, corp_tax_pay
from simkit.cash_core import PK_MULT
from simkit.cash_rules import pk_div, pk_distribute, tr_muni
from simkit.households import life_budget, life_demand, person_demand
from simkit.tech_core import tech_f
from simkit.transition import trans_scan, trans_support, trans_return, trans_s, trans_grant
from simkit.sector_core import sb_need_mult, board_stat_add, mk_share
from simkit.wages import role_ok, role_wage
from simkit.price_index import ix


def producing_count(W):
    firms = W.firms
    pc = defaultdict(int)
    for f, d in firms.items():
        pc[d["kind"]] += 1
    return pc


def owner_sold(W, ci, p):
    """te-ist G1: şehirde ana ürünü p olan sahipli canlı firmaların haftalık sold_prev toplamı. Canlı: çalışanı var, ölü değil ve geçen hafta üretmiş (prod_live; üretimsiz haftanın bayat sold_prev değeri dışarıda kalır)."""
    firms = W.firms
    tot = 0.0
    for f in W.cities[ci]["firms"]:
        d = firms[f]
        if d["owner"] is None or d.get("dead") or not d["workers"] or not d.get("prod_live"):
            continue
        out = W.RECIPES[d["kind"]][0] if d["kind"] in W.RECIPES else None
        if out and next(iter(out)) == p:
            tot += d.get("sold_prev", 0.0)
    return tot


def base_need(W, ci):
    """K-88: şehrin geçen haftaki SATIŞINA ve dünya kök eksiğine dayanan hedef (birim/döngü), yalnız yerel NPC türleri için."""
    cities = W.cities
    firms = W.firms
    last_root_short = W.last_root_short
    c = cities[ci]
    need = defaultdict(float)
    local_kinds = {firms[f]["kind"] for f in c["firms"] if firms[f]["owner"] is None}
    for p, u in c["last_sold"].items():                       # şehrin geçen hafta SATTIĞI üretim, birim/hafta
        k = PRODUCER.get(p)
        if k in local_kinds:
            if NPC_NET_OWNER:                                 # te-ist G1: kadro, sahipli firmaların satışını çift saymaz
                u = max(0.0, u - owner_sold(W, ci, p))
            need[p] += u / CYCLES_PER_WEEK * STAFF_BUFFER
    if STAFF_DEMAND:                                          # T9b (A): satılamayan değil, istenip bulunamayan talep de kadro planına girer (sipariş defteri)
        ld_, imp_ = c["last_demand"], c["last_imports"]
        for p, u in ld_.items():
            k = PRODUCER.get(p)
            if k in local_kinds and p not in last_root_short:       # kök ürünün dünya eksiği aşağıdaki last_root_short terimiyle zaten sayılır (çift sayım yok)
                miss_ = u - c["last_sold"].get(p, 0.0) - imp_.get(p, 0.0) / max(1e-9, W.PRICE.get((ci, p), 1.0))      # başka şehirden gelen (ithal, değer/fiyat = birim) karşılanmış talep açık değildir
                if miss_ > 0.0:
                    need[p] += miss_ / CYCLES_PER_WEEK * STAFF_BUFFER * STAFF_DEMAND_SHARE
    for p, u in last_root_short.items():                       # dünya KÖK eksiği, boş kapasiteye göre bölünür (K-114)
        k = PRODUCER.get(p)
        if k in local_kinds:
            free_c = sum(firms[f]["capacity"] - len(firms[f]["workers"]) for f in c["firms"] if firms[f]["kind"] == k and firms[f]["owner"] is None)
            free_w = sum(d["capacity"] - len(d["workers"]) for d in firms.values() if d["kind"] == k and d["owner"] is None)
            if free_w > 0:
                need[p] += u / CYCLES_PER_WEEK * STAFF_BUFFER * free_c / free_w
    return need


def derived_increment(W):
    """K-124 türetilmiş talep: alt aşama hedefi, üst aşamanın PLANLANAN girdi ihtiyacından türer (geçmiş satıştan değil).
    Dünya hedefi aşağıdan yukarı: hedef[ürün] = max(satıştan türeyen, tüketici türlerin girdi ihtiyacı toplamı).
    Artış, boş kapasite payıyla şehirlere dağılır. Ölüm sarmalını (kadro 0 → girdi talebi 0 → eksik sinyali yok) keser."""
    RECIPES = W.RECIPES
    cities = W.cities
    derived_cache = W.derived_cache
    firms = W.firms
    player_firms = W.player_firms
    week_no = W.week_no
    TOPO = W.TOPO
    key = (week_no, len(player_firms))
    if key in derived_cache:
        return derived_cache[key]
    base = [base_need(W, ci) for ci in range(len(cities))]
    wb = defaultdict(float)
    for b in base:
        for p, q in b.items():
            wb[p] += q
    wt, der = {}, defaultdict(float)
    for kind in reversed(TOPO):
        if kind == "ahir":
            continue
        outputs, inputs = RECIPES[kind]
        main, rate = next(iter(outputs.items()))
        wt[main] = max(wb.get(main, 0.0), der.get(main, 0.0))
        for q_p, per in inputs.items():
            der[q_p] += wt[main] * per * DERIVED_BUFFER
    inc = {p: wt[p] - wb.get(p, 0.0) for p in wt if wt[p] - wb.get(p, 0.0) > 1e-9}
    out = {}
    for p, extra in inc.items():
        k = PRODUCER[p]
        free = [sum(firms[f]["capacity"] - len(firms[f]["workers"]) for f in cities[ci]["firms"] if firms[f]["kind"] == k and firms[f]["owner"] is None)
                for ci in range(len(cities))]
        tot = sum(free)
        if tot > 0:
            for ci in range(len(cities)):
                out[(ci, p)] = extra * free[ci] / tot
    derived_cache.clear()
    derived_cache[key] = (base, out)
    return derived_cache[key]


def start_consumers(W, ci):
    """hf1 kadro tahmininin tüketim tarafı: ({ürün: şehrin döngü başına toplam talebi}, toplam birim).
    Varsayılan (START_DEMAND=0) v13.0: tüketici sayısı = oyuncu + BIG_NPC_SHARE x NPC nüfusu, kişi başı talep ücretten (person_demand).
    D7 (A6) START_DEMAND=1 tutarlı: tüketici = oyuncu + geliri olacak NPC (W.start_e, sabit nokta), kişi başı talep döngünün kendi talep fonksiyonundan (life_budget + life_demand)."""
    cities = W.cities
    c = cities[ci]
    if START_DEMAND == 1 and getattr(W, "start_e", None) is not None:
        return _coherent_consumers(W, ci, W.start_e)
    n_persons = len(c["players"]) + (int(BIG_NPC_SHARE * (NPC_X + NPC_Y * PLAYERS_PER_CITY * len(cities)) / len(cities)) if BIG_START else NPC_X // len(cities))
    pdem = person_demand(W, PRICE_WAGE, 0, ci)
    return {p: q * n_persons for p, q in pdem.items()}, sum(pdem.values()) * n_persons


def _budget_demand(W, ci, wage, cash):
    """Bir kişinin döngü başına talebi: döngünün bütçe (life_budget) ve talep (life_demand) işlevleriyle; kişi geçici (defter ve alışkanlık kaydı bırakılmaz)."""
    q = "__hf1__"
    W.L.bal[q] = cash
    try:
        b = life_budget(W, q, {"wage": wage, "who": "npc", "firm": "__hf1__"}, ci)
    finally:
        W.L.bal.pop(q, None)
        W.hab.pop(q, None)
    return life_demand(W, b, ci)


def _coherent_consumers(W, ci, e_npc):
    c = W.cities[ci]
    wi = W.WI[ci]
    out = defaultdict(float)
    wage_pl = round(TIER_WAGE[0] * wi * (WELF_AHIR_MULT if W.WELF_ON else 1.0), 3)
    for p, q in _budget_demand(W, ci, wage_pl, float(START_AKCE)).items():
        out[p] += q * len(c["players"])
    for t in (0, 1, 2):
        share = sum(1 for k in range(10) if tier_of(k) == t) / 10.0
        cash = round(MPC0 * TIER_WAGE[t] * CYCLES_PER_WEEK * NPC_START_CASH, 6) if NPC_START_CASH > 0 else 0.0
        for p, q in _budget_demand(W, ci, TIER_WAGE[t] * wi, cash).items():
            out[p] += q * share * e_npc
    return dict(out), sum(out.values())


def start_targets(W, ci, auto=False, seed=False):
    """hf1 açılış kadro planı (restaff'ın 1. hafta hedef kuralı; seed=True ise K-133 tohum kadrosu da, M11 açılış kasası için): [(işletme, hedef kadro, kapasite)] NPC işletmeleri için.
    auto=True ise kapasite hedef kadrodan türetilir (CAP_MODE=1): max(CAP_AUTO_MIN, ceil(işletme başına kadro x CAP_AUTO_SHARE))."""
    firms = W.firms
    c = W.cities[ci]
    PM = W.PM
    RECIPES = W.RECIPES
    workers, _ = staffing(W, ci)
    by_kind = defaultdict(list)
    for f in c["firms"]:
        if firms[f]["owner"] is None and firms[f]["kind"] not in ("ahir", "belediye") and not firms[f].get("dead"):
            by_kind[firms[f]["kind"]].append(f)
    out = []
    for kind, fl in by_kind.items():
        per_firm = workers[kind] / len(fl)
        for f in fl:
            cap = firms[f]["capacity"]
            if auto:
                cap = max(CAP_AUTO_MIN, math.ceil(per_firm * CAP_AUTO_SHARE - 1e-9))
            target = min(cap, int(per_firm + 0.9999)) if (workers[kind] >= MIN_STAFF or PM.get((ci, next(iter(RECIPES[kind][0])) if RECIPES[kind][0] else None), 1.0) >= PM_BOOST_FROM) else 0
            target = max(target, min(cap, RESERVE.get(kind, 0)))
            if seed and firms[f].get("seed"):
                target = max(target, DOMESTIC_SEED)                  # K-133 (restaff ile aynı sıra): program firması en az tohum kadrosuyla başlar (M11 Ku1; yalnız seed=True: start_setup yolu değişmez)
            if target > 1 and RECIPES[kind][1]:
                target = max(1, int(target * max(OK_FLOOR, firms[f].get("ok_prev", 1.0)) + 0.9999))
            out.append((f, target, cap, per_firm))
    return out


def start_hires(W, auto=False):
    """hf1'de her şehirde işe alınacak NPC sayısı (hedeflerin toplamı, havuzla sınırlı)."""
    return [min(len(W.cities[ci]["pool"]), sum(t for _, t, _, _ in start_targets(W, ci, auto))) for ci in range(len(W.cities))]


def start_setup(W):
    """D7 (A3, A5, A6, A8): tutarlı dünya kurulumu. engine.start_world içinde, yalnız bu bayraklardan biri varsayılan dışıysa çağrılır (varsayılanda hiç çalışmaz).
    Sıra (Caiani): (i) dışsal: START_EMP; (ii) tüketici sayısı ve kadro hedefi (START_DEMAND sabit noktası); (iii) kapasite (CAP_MODE=1 otomatik); (iv) konut stoku (HOUSE_MODE)."""
    n_c = len(W.cities)
    if not hasattr(W, "week_no"):
        W.week_no = 1                                               # staffing'in 1. hafta dalı; start_world aynı değeri yazar
    W.start_scale = 1.0
    W.start_e = None
    auto = CAP_MODE == 1
    npc_total = NPC_X + NPC_Y * PLAYERS_PER_CITY * n_c
    if START_DEMAND == 1:
        if START_EMP > 0:
            W.start_e = START_EMP * npc_total / n_c                  # dışsal istihdam: tüketici sayısı ona göre
        else:
            e = BIG_NPC_SHARE * npc_total / n_c                      # sabit nokta: işe alınacak NPC sayısı = tüketici sayısı (şehirler arası ortak)
            for _ in range(60):
                W.start_e = e
                h = sum(start_hires(W, auto)) / n_c
                if abs(h - e) < 0.25:
                    break
                e = 0.5 * e + 0.5 * h
            W.start_e = e
    if START_EMP > 0:
        goal = START_EMP * npc_total
        lo, hi = 0.0, 1.0
        W.start_scale = hi
        while sum(start_hires(W, auto)) < goal and hi < 4096.0:     # üst sınırı bul
            lo, hi = hi, hi * 2.0
            W.start_scale = hi
        reach = min(goal, sum(start_hires(W, auto)))                 # kapasite izin vermiyorsa ulaşılabilir en çok kadro (tıkanan türler plan çıktısında görünür)
        for _ in range(50):                                          # hedefe ulaşan en küçük ölçek
            mid = 0.5 * (lo + hi)
            W.start_scale = mid
            if sum(start_hires(W, auto)) < reach:
                lo = mid
            else:
                hi = mid
        W.start_scale = min((lo, hi), key=lambda x: (abs(_hires_at(W, x, auto) - goal), x))
    if auto or CAP_GROWTH:
        for ci in range(n_c):
            for f, t, cap, _pf in start_targets(W, ci, auto):
                if auto:
                    W.firms[f]["capacity"] = cap
                W.firms[f]["cap0"] = W.firms[f]["capacity"]
    if HOUSE_MODE == 1 and HOUSE_ON:
        hires = start_hires(W, auto)
        for ci in range(n_c):
            W.hs[ci] = HOUSE_SLACK * (len(W.cities[ci]["players"]) + hires[ci])


def _hires_at(W, scale, auto):
    old = W.start_scale
    W.start_scale = scale
    try:
        return sum(start_hires(W, auto))
    finally:
        W.start_scale = old


def npc_hf1_haftalik_yuk(W, f, target):
    """M11 (B): NPC işletmesi f'nin hf1 açılış kadro planının (start_targets hedefi) HAFTALIK ücret yükü, gerçek ölçekte: kişi başı ücret = kademe karışımının (60/30/10, tier_of) ortalaması
    wages.kadro_ucreti (şehir WI'ı ve tür çarpanı KIND_WM dahil, NPC) x CYCLES_PER_WEEK. Hedef 0 ise 0. SAF okuma."""
    d = W.firms[f]
    ort = sum(kadro_ucreti(W, tier_of(k), d["kind"], d["city"], True) for k in range(10)) / 10.0
    return target * ort * CYCLES_PER_WEEK


def srev_roll(W):
    """M11.2 (3b) HIRE_GATE_GROWTH: haftanın açılışında geçen haftanın firma satış gelirini (Ledger.srev) W.srev_hist'e, NET faaliyet gelirini (satış - girdi alımı/navlun - kira - ücret: srev - Ledger.sexp) W.snet_hist'e (son 4 hafta) aktarır. Bayrak kapalıyken çağrılmaz."""
    L = W.L
    if L.srev is None:
        L.srev = defaultdict(float)
        L.sexp = defaultdict(float)
        L.sfirms = W.firms
        W.srev_hist = {}
        W.snet_hist = {}
    h = W.srev_hist
    hn = W.snet_hist
    for f in W.firms:
        s_ = L.srev.get(f, 0.0)
        lst = h.setdefault(f, [])
        lst.append(s_)
        del lst[:-4]
        ln = hn.setdefault(f, [])
        ln.append(s_ - L.sexp.get(f, 0.0))
        del ln[:-4]
    L.srev.clear()
    L.sexp.clear()


def kadro_kaydet(W):
    """M11.2 (3b) HIRE_GATE_GROWTH: staffing sonrası, döngülerden önce her işletmenin kadrosunu d["kadro_son"] olarak yazar (ertesi haftanın "boşalan yer" ölçüsü: döngüde ücret ödenmeyen/ayrılan kadroyu düşürür). Bayrak kapalıyken çağrılmaz."""
    for d in W.firms.values():
        d["kadro_son"] = len(d["workers"])


def npc_opening_stock(W):
    """M11 (B) NPC_FIRM_START_WEEKS > 0: her NPC işletmesine (owner=None; ahır ve belediye hariç) açılış bakiyesi = NPC_FIRM_START_WEEKS x hf1 kadro planının haftalık ücret yükü.
    BASIM DEĞİL: minted/fiscal_minted'e yazılmaz, kamu basımı akışlarında görünmez; Ledger.opening (açılış para stoku, "devreden kazanç") ve flows["acilis_devreden_kazanc"] artar
    (korunum: Σbakiye = opening + minted). İşletmenin özkaynağıdır, borç değil. engine.start_world içinde, 1. hafta başlamadan önce (kadro planı start_targets'tan, restaff'ın 1. hafta kuralı) çağrılır:
    plan dünya kurulumunda (world_build) bilinmez (hedef şehir talebine, fiyatlara ve CAP_MODE=1 kapasitesine bağlı); hafta 1 alımından sonra yazmak ise hf1 kapısını ve avansı değiştirirdi. Döner: toplam açılış stoku."""
    if NPC_FIRM_START_WEEKS <= 0 or getattr(W, "npc_opening_done", False):
        return 0.0                                                   # start_world bir dünyada birden çok kez çağrılabilir (kurulum + run_world): açılış stoku bir kez yazılır
    W.npc_opening_done = True
    L = W.L
    auto = CAP_MODE == 1
    top = 0.0
    gor = set()
    for ci in range(len(W.cities)):
        for f, target, _cap, _pf in start_targets(W, ci, auto, True):
            if f in gor:
                continue                                             # şehir planında aynı türün tekrarı (ör. kola0) c["firms"]'ta aynı ada iki kez girer: açılış stoku firma başına bir kez
            gor.add(f)
            amt = round(NPC_FIRM_START_WEEKS * npc_hf1_haftalik_yuk(W, f, target), 6)
            if amt <= 0.0:
                continue
            L.bal[f] += amt
            firms_ = W.firms[f]
            firms_["acilis_tampon"] = firms_.get("acilis_tampon", 0.0) + amt       # K1: süpürme eşiğine eklenen özkaynak tamponu (labor.restaff sonu)
            L.opening += amt
            L.flows["acilis_devreden_kazanc"] += amt
            top += amt
    return top


def start_report(W):
    """D7 (A5): model koşusu gerektirmeyen açılış özeti (yalnız kurulmuş dünya + hf1 kadro kuralı): tür başına işletme sayısı, kapasite, en çok kişi, hf1 hedef kadrosu ve tıkanma; toplamlar ve konut stoku.
    JSON'a çevrilebilir sade sözlük; sunucu (calc ucu) çocuk süreçte çağırır. Kadro 'açılış kadrosu'dur (hf1'de işe alınan); hf1 sonunda avansını alamayanlar ayrılabilir."""
    if not hasattr(W, "week_no"):
        W.week_no = 1
    auto = CAP_MODE == 1
    n_c = len(W.cities)
    kinds = {}
    firm_total = 0
    for ci in range(n_c):
        for f, t, cap, pf in start_targets(W, ci, auto):
            k = W.firms[f]["kind"]
            r = kinds.setdefault(k, dict(kind=k, group=CAP_KIND_GROUP.get(k, "serv"), firms=0, capacity=0, max_people=0, need=0.0, planned=0, blocked_firms=0, shortfall=0.0, growth_ceiling=0.0))
            r["firms"] += 1
            r["capacity"] = max(r["capacity"], cap)
            r["max_people"] += cap
            r["need"] += pf
            r["planned"] += t
            if pf > cap + 1e-9:
                r["blocked_firms"] += 1
                r["shortfall"] += pf - cap
            r["growth_ceiling"] = max(r["growth_ceiling"], CX_CAP_MAX * W.firms[f]["cap0"] if (CAP_GROWTH and "cap0" in W.firms[f]) else CX_CAP_MAX * CAP_OTHER * POP_SCALE_FACTOR)
            firm_total += 1
    for r in kinds.values():
        r["need"] = round(r["need"], 3)
        r["shortfall"] = round(r["shortfall"], 3)
        r["growth_ceiling"] = round(r["growth_ceiling"], 3)
    hires = start_hires(W, auto)
    players = [len(c["players"]) for c in W.cities]
    npc_total = sum(len(c["pool"]) for c in W.cities)
    n_dep = sum(len(c.get("deps", ())) for c in W.cities)              # D9 (A2): işgücü dışı (bakmakla yükümlü) NPC
    return dict(
        kinds=sorted(kinds.values(), key=lambda r: (r["group"], r["kind"])),
        blocked=sorted(k for k, r in kinds.items() if r["blocked_firms"] > 0),
        firms_total=firm_total,
        firms_per_city=[sum(1 for f in c["firms"] if W.firms[f]["owner"] is None and W.firms[f]["kind"] not in ("ahir", "belediye")) for c in W.cities],
        opening_staff=sum(hires),
        opening_staff_per_city=hires,
        npc_total=npc_total,
        npc_population=npc_total + n_dep,
        npc_in_labor_force=npc_total,
        npc_dependents=n_dep,
        npc_participation=round(npc_total / (npc_total + n_dep), 6) if (npc_total + n_dep) else 1.0,
        labor_force=sum(players) + npc_total,
        players_total=sum(players),
        housing_stock=[round(W.hs[ci], 3) for ci in range(n_c)] if HOUSE_ON else None,
        housing_stock_total=round(sum(W.hs[ci] for ci in range(n_c)), 3) if HOUSE_ON else None,
        scale=round(getattr(W, "start_scale", 1.0), 6),
        pop_scale=round(POP_SCALE_FACTOR, 6),
        cap_mode=CAP_MODE,
        cap_growth=2 if PROFIT_KEEP else CAP_GROWTH)               # 2: kâr hanelere temettü seçiliyken kapasite tavanı yoktur (firms.py: PROFIT_KEEP) — son inceleme M1


def start_stock(W, ci):
    """D7 (A6): hf1 kadrosu belli olunca her NPC üretim işletmesine START_STOCK_WEEKS haftalık girdi stoku (fiziksel; para yaratmaz)."""
    if START_STOCK_WEEKS <= 0 or not W.INV_ON:
        return
    firms = W.firms
    for f in W.cities[ci]["firms"]:
        d = firms[f]
        if d["owner"] is not None or d.get("dead") or d["kind"] in ("ahir", "belediye") or not d["workers"]:
            continue
        outs, ins = W.RECIPES[d["kind"]]
        if not ins or not outs:
            continue
        rate = next(iter(outs.values())) * d.get("tech", 1.0)
        n = len(d["workers"])
        ist = d.setdefault("istock", {})
        for p, per in ins.items():
            if p in NO_STOCK or p in ("yazilim", "bilgisayar", "koruma"):
                continue
            ist[p] = ist.get(p, 0.0) + per * rate * n * CYCLES_PER_WEEK * START_STOCK_WEEKS


def se_expect(W, ci, workers):
    """M9.1 (f) STAFF_EXPECT: (şehir x tür) kadro hedefini (workers, yerinde) tek haftalık gözlemden beklentiye çevirir. 1. hafta: gözlem = açılış planı = başlangıç seviyesi.
    Sonraki haftalar (haftada bir güncellenir, aynı hafta tekrar çağrı önbellekten): seviye += SE_ALPHA x (gözlem - seviye); eğilim = SE_TREND_BETA x seviye değişimi + (1-BETA) x eski; beklenti = seviye + sınırlı eğilim.
    Talep sinyali (düzeltilmemiş, hızlı): karşılanmayan talep payı > SE_SCARCE ya da pano stok örtüsü < SE_COVER_LO: en çok SE_GROW artar; örtü > SE_COVER_HI ve kıtlık yok: en çok SE_BRAKE azalır."""
    st = getattr(W, "se_state", None)
    if st is None:
        st = W.se_state = {}
    wk = W.week_no
    c = W.cities[ci]
    board = getattr(W, "board", None)
    for kind in list(workers):
        if kind in ("ahir", "medya"):
            continue
        raw = workers[kind]
        e = st.get((ci, kind))
        if wk <= 1:
            st[(ci, kind)] = dict(week=1, lvl=raw, trend=0.0, out=raw)
            continue
        if e is None:
            e = st[(ci, kind)] = dict(week=wk - 1, lvl=raw, trend=0.0, out=raw)
        if e["week"] != wk:
            lvl0 = e["lvl"]
            lvl = lvl0 + SE_ALPHA * (raw - lvl0)
            tr = SE_TREND_BETA * (lvl - lvl0) + (1.0 - SE_TREND_BETA) * e["trend"]
            cap_ = SE_TREND_CAP * lvl
            exp_ = lvl + max(-cap_, min(cap_, SE_TREND_H * tr))
            outs_ = W.RECIPES[kind][0] if kind in W.RECIPES else None
            m_ = 1.0
            if outs_:
                p = next(iter(outs_))
                ld_ = c["last_demand"].get(p, 0.0)
                miss_ = ld_ - c["last_sold"].get(p, 0.0) - c["last_imports"].get(p, 0.0) / max(1e-9, W.PRICE.get((ci, p), 1.0))
                sh_ = max(0.0, miss_) / ld_ if ld_ > 1e-9 else 0.0
                pr_ = board["prod"].get(p) if board else None
                cov_ = pr_["cover"] if (pr_ and pr_.get("want", 0.0) > 1e-9) else None
                if sh_ > SE_SCARCE:
                    m_ = 1.0 + min(SE_GROW, 4.0 * (sh_ - SE_SCARCE))
                elif cov_ is not None and cov_ < SE_COVER_LO:
                    m_ = 1.0 + min(SE_GROW, SE_GROW * (SE_COVER_LO - cov_) / SE_COVER_LO)
                elif cov_ is not None and cov_ > SE_COVER_HI and sh_ < 0.5 * SE_SCARCE:
                    m_ = 1.0 - min(SE_BRAKE, SE_BRAKE * (cov_ - SE_COVER_HI) / SE_COVER_HI)
            e.update(week=wk, lvl=lvl, trend=tr, out=max(0.0, exp_ * m_))
        workers[kind] = e["out"]
    return workers


def se_hold(W, f, d, target):
    """M9.1 (f) STAFF_EXPECT: çıkarma sürtünmesi. Hedef kadronun altındaysa SE_FIRE_K hafta üst üste altında kalınmadıkça kadro korunur; sonra haftada en çok SE_FIRE_FRAC x kadro çıkar.
    Korunan kadro ödeme gücüyle sınırlı (kasa + köprü limiti >= HIRE_CASH_CYCLES x ücret yükü); aşan kısım hemen hedefe iner. Artırma yolu (kasa kapısı) değişmez. Döner: bu haftanın etkin hedefi."""
    n = len(d["workers"])
    wk = W.week_no
    if wk <= 1 or target >= n:
        d["se_below"] = 0
        d["se_wk"] = wk
        d["se_want"] = n
        return target
    if d.get("se_wk") == wk:
        return max(target, min(n, d.get("se_want", n)))
    d["se_wk"] = wk
    d["se_below"] = d.get("se_below", 0) + 1
    want = n if d["se_below"] < SE_FIRE_K else max(target, n - max(1, int(n * SE_FIRE_FRAC)))
    if want > target and ((HIRE_CASH_GATE and d["capitalized"]) or HIRE_GATE_ALL):      # işe alım kapısıyla aynı kapsam (sermayesiz/şehir destekli işletmede ödeme gücü şehirden gelir)
        yuk = sum(W.people[q]["wage"] for q in d["workers"])
        pw = W.L.bal[f] + kopru_limit(W, f)
        if yuk > 0 and pw < HIRE_CASH_CYCLES * yuk:
            want = max(target, min(want, int(pw / (HIRE_CASH_CYCLES * yuk / n))))
    d["se_want"] = want
    return want


def staffing(W, ci):
    """K-88, K-124: hedef kadro = (şehrin geçen haftaki talebi + dünya eksiği payı + türetilmiş girdi talebi) × 1,1; 1. hafta tahmin."""
    FRONT = W.FRONT
    KTECH = W.KTECH
    PM = W.PM
    PUB = W.PUB
    RECIPES = W.RECIPES
    SW_STATE = W.SW_STATE
    cities = W.cities
    firms = W.firms
    svc_rev_prev = W.svc_rev_prev
    treat_n_prev = W.treat_n_prev
    week_no = W.week_no
    TOPO = W.TOPO
    c = cities[ci]
    need = defaultdict(float)
    pc = producing_count(W)
    local_kinds = {firms[f]["kind"] for f in c["firms"] if firms[f]["owner"] is None}
    if week_no > 1:
        base, inc = derived_increment(W)
        for p, q in base[ci].items():
            need[p] += q
        for (cj, p), q in inc.items():
            if cj == ci:
                need[p] += q
        if PM_BOOST_MAX > 1.0:                                # K-153: NPC yönetici kalıcı kıtlıkta (fiyat çarpanı yüksek) kapasiteyi fiyat sinyaliyle büyütür (fiyat > maliyet: genişle)
            for p in list(need):
                need[p] *= min(PM_BOOST_MAX, max(1.0, PM.get((ci, p), 1.0) / PM_BOOST_FROM))
        if SECTOR_BOARD:                                      # K-212: kadro hedefi sektör durumuna göre (kalıcı kıtlık: büyür; stok fazlası: frenlenir)
            for p in list(need):
                m_ = sb_need_mult(W, ci, p)
                if m_ != 1.0:
                    need[p] *= m_
                    board_stat_add(W, "kadro_artis" if m_ > 1.0 else "kadro_fren")
    else:
        sc_ = getattr(W, "start_scale", 1.0)                        # D7 (A3): hf1 kadro hedefi ölçeği (START_EMP); 1,0 = türetilmiş (v13.0)
        cons_, units_ = start_consumers(W, ci)                      # D7 (A6): hf1 tüketim tahmini (varsayılan v13.0)
        for p, q in cons_.items():
            need[p] += q * STAFF_BUFFER * sc_ if sc_ != 1.0 else q * STAFF_BUFFER
        for kind in reversed(TOPO):
            if kind == "ahir":
                continue
            outputs, inputs = RECIPES[kind]
            main, rate = next(iter(outputs.items()))
            w_all = need[main] / rate
            for p, per in inputs.items():
                need[p] += w_all * rate * per
        for p in list(need):
            k = PRODUCER.get(p)
            if k and k in local_kinds and pc[k]:
                need[p] *= len(cities) / pc[k]
            elif k and k not in local_kinds:
                need[p] = 0.0
    workers = defaultdict(float)
    for kind in TOPO:
        if kind == "ahir":
            continue
        outputs, _ = RECIPES[kind]
        main, rate = next(iter(outputs.items()))
        workers[kind] = need[main] / (rate * c.get("skill", 1.0) * ((KTECH.get(kind, 1.0) if INNOV_ON else tech_f(BRANCH[kind], PUB[BRANCH[kind]])) if (ARGE_ON and kind in BRANCH) else 1.0)
                                      * (1.0 + SW_GAIN * SW_STATE["adopt"] if (SW_STATE["on"] and kind != "yazilim") else 1.0))   # K-134, K-136
    if week_no == 1:
        units = units_ * sc_ if sc_ != 1.0 else units_
    else:
        units = (c["mk_dem_units_prev"] if SVC_DIRECT else c["dem_units_prev"]) / CYCLES_PER_WEEK                 # mağaza: geçen haftanın talebine göre (satışa değil; yoksa kendi kapasitesine kilitlenir)
    if OUTPUT_MATCH >= 2 and week_no > 1:                         # te-arz: NPC kadro kapasitesi beklenen satisa (hedef / STAFF_BUFFER) + OM_CAP_BUF; uretim turleri
        for kind in workers:
            if kind != "ahir" and kind in RECIPES and RECIPES[kind][0] and kind in PROD_OF:
                workers[kind] *= (1.0 + OM_CAP_BUF) / STAFF_BUFFER
    workers["market"] = units / STORE_UNITS_PER_WORKER * STAFF_BUFFER
    if NPC_NET_OWNER and week_no > 1:                             # te-denge G1: sahipli marketler aynı talebi hane payıyla paylaşır; NPC market hedefi yalnız sahipsiz marketlerin payı (en az 1 kişi)
        mk_ = [f_ for f_ in c["firms"] if firms[f_]["kind"] == "market"]
        if any(firms[f_]["owner"] is not None for f_ in mk_):
            frac_ = 1.0 - sum(mk_share(W, ci, f_) for f_ in mk_ if firms[f_]["owner"] is not None and not firms[f_].get("dead"))          # sahipli olmayan her pay (ölü NPC marketinin payı dahil) canlı NPC marketlere kalır
            workers["market"] = max(1.0, workers["market"] * frac_)
    workers["medya"] = MEDYA_STAFF
    for kind_ in SVC_KINDS:                                       # K-185.12: hizmet sektörleri: kadro geçen haftanın gelirine (ve tedavi sayısına) göre; en az 1 kişi (küçük klinik/okul)
        per_ = CYCLES_PER_WEEK * LOG_CAP * KIND_WM.get(kind_, 1.0) * 0.9
        w_ = svc_rev_prev[(ci, kind_)] / per_
        if kind_ == "ilac" and ARGE_ON:
            w_ /= tech_f("kimya", FRONT["kimya"])
        if kind_ == "hastane":
            w_ = max(w_, treat_n_prev[ci] / TREAT_PER_WORKER)
        workers[kind_] = max(1.0, w_)
    workers["lojistik"] = (int(LOG_INIT_WORKERS * (BIG_CAP_MULT if BIG_START else 1)) if week_no == 1 else max(4.0, c["freight_prev"] / (LOG_CAP * CYCLES_PER_WEEK) * (LOG_BUFFER_NB if (NO_BAILOUT and week_no > NPC_GRACE) else LOG_BUFFER)))   # K-119
    if STAFF_EXPECT:
        se_expect(W, ci, workers)                                 # M9.1 (f): hedef kadro beklentiden (kayan ortalama + talep sinyali); 1. hafta açılış planı beklentinin başlangıcı
    return workers, need


def hire_stat(W):
    """D6: haftalık göstergeler için birikimli sayaçlar (model davranışına girmez)."""
    st = getattr(W, "hire_stat", None)
    if st is None:
        st = W.hire_stat = defaultdict(float)
    return st


def ahir_backfill(W, a):
    """D6 (AHIR_BACKFILL=1): ahırdan oyuncu çıkınca yerine havuzdan bir NPC ahıra girer (ahır ücretiyle, kapasiteyi aşmadan)."""
    d = W.firms[a]
    c = W.cities[d["city"]]
    if c["pool"] and len(d["workers"]) < d["capacity"]:
        q = c["pool"].pop(0)
        d["workers"].append(q)
        if KR_MEAS:
            lab_ev(W, "ise", a)                                  # davranışsız sayaç (§4.6)
        W.people[q]["firm"] = a
        W.people[q]["avans"] = True
        W.people[q]["ahir_dolgu"] = True                       # D7 (M1): geri doldurma NPC'si; ahırda yer lazımsa yeni oyuncuya önce yer açar
        hire_stat(W)["ahir_dolgu_npc"] += 1
        if W.week_no > 1:
            hire_stat(W)["ise_giren_issiz"] += 1                # son inceleme I2: havuzdan işe giren (gösterge; davranışa girmez)


def pop_ahir_player(W, a):
    """K-111: ahırdan oyuncu çıkarır, ama sürü bakımı için en az AHIR_HERD_WORKERS kişi kalır."""
    firms = W.firms
    people = W.people
    ws = firms[a]["workers"]
    if len(ws) <= AHIR_HERD_WORKERS:
        return None
    q = next((x for x in ws if people[x]["who"] == "oyuncu" and x != W.human), None)       # insan ahırdan kendiliğinden çıkmaz (yalnız ahirdan_cik kararı); kapalıyken W.human None
    if q is not None:
        ws.remove(q)
        if KR_MEAS:
            lab_ev(W, "cikis_gecis", a)                       # davranışsız sayaç: oyuncu firmasına geçiş
        if AHIR_BACKFILL:
            ahir_backfill(W, a)                               # D6
    return q


def offer_ok(W, q, f):
    """D6 (AHIR_MOVE=voluntary): f firmasının q'ya önereceği ücret, q'nun şimdiki ücretinin (1 + AHIR_MOVE_PREMIUM) katı ya da fazlası mı."""
    d = W.firms[f]
    i = W.people[q]
    offer = TIER_WAGE[i["tier"]] * W.WI[d["city"]] * (KIND_WM.get(d["kind"], 1.0) if SVC_KINDS else 1.0)
    return offer >= i["wage"] * (1.0 + AHIR_MOVE_PREMIUM) - 1e-9


def _ht():
    """İşe alım/çıkarma sıralaması için kademe verimi. HIRE_TIER=(): PROD_TIER (v13.1, bayt bayt aynı); M4 ayrıştırma: ücret primi PROD_TIER ile üretimde, HIRE_TIER ile işe alımda ayrı denenir."""
    return HIRE_TIER if HIRE_TIER else PROD_TIER


def _score(W, q):
    """D6: işe alım skoru (NLAB ile aynı): verimlilik basamağı + itibar; oyuncu bonusu yok."""
    return _ht()[W.people[q]["tier"]] + 0.3 * W.REP[q] / 100.0


def _peek_mover(W, ci, f, ahirs, key=None):
    """D6: AHIR_MOVE kuralına uygun ahır/belediye oyuncusu (kaldırmadan): (kişi, kaynak) ya da None. key verilirse en yüksek skorlu (eşitlikte ilk), yoksa ilk."""
    if AHIR_MOVE == 2:
        return None
    firms = W.firms
    people = W.people
    best = None
    refused = 0
    for src, ws in [("ahir:" + a, firms[a]["workers"]) for a in ahirs if len(firms[a]["workers"]) > AHIR_HERD_WORKERS] + [("belediye", firms[f"s{ci}_belediye0"]["workers"])]:
        for x in ws:
            if people[x]["who"] != "oyuncu" or x == W.human:      # insan ahırdan kendiliğinden geçmez
                continue
            if AHIR_MOVE == 1 and not offer_ok(W, x, f):
                refused += 1
                continue
            if key is None:
                return x, src
            if best is None or key(x) > best[2]:
                best = (x, src, key(x))
    if best is None:
        if refused:
            hire_stat(W)["ahir_gecis_red"] += 1               # bir işe alım denemesinde geçişe uygun oyuncu çıkmadı (teklif yetmedi)
        return None
    return best[0], best[1]


def pick_worker(W, ci, f, ahirs):
    """D6: HIRE_PRIORITY / AHIR_MOVE kurallarıyla f firmasına işçi seçer ve kaynağından çıkarır: (kişi, kaynak) ya da (None, None).
    Kaynak: "seeker" | "ahir" | "belediye" | "npc". player + auto kipinin v13.0 yolu restaff.take_worker içinde aynen durur."""
    c = W.cities[ci]
    people = W.people
    L = W.L
    prio = HIRE_PRIORITY

    def best_pool():
        return max(c["pool"][:NPC_POOL_K], key=lambda x: _ht()[people[x]["tier"]]) if c["pool"] else None

    def take_mover(mv):
        q, src = mv
        return q, _take_mover_at(W, ci, q, src)

    if prio == 0:
        if c["seekers"]:
            if W.NLAB_ON and c["pool"]:
                sq_ = c["seekers"][0]
                sc_p = _ht()[people[sq_]["tier"]] + 0.3 * W.REP[sq_] / 100.0 + PLAYER_PRIO
                bn_ = best_pool()
                if _ht()[people[bn_]["tier"]] > sc_p:
                    c["pool"].remove(bn_)
                    L.flows["npc_isbasi_secim"] += 1
                    return bn_, "npc"
            return c["seekers"].pop(0), "seeker"
        mv = _peek_mover(W, ci, f, ahirs)
        if mv is not None:
            return take_mover(mv)
        return (c["pool"].pop(0), "npc") if c["pool"] else (None, None)
    if prio == 2:
        n = best_pool()
        if n is not None:
            c["pool"].remove(n)
            return n, "npc"
        if c["seekers"]:
            return c["seekers"].pop(0), "seeker"
        mv = _peek_mover(W, ci, f, ahirs)
        return take_mover(mv) if mv is not None else (None, None)
    # equal: aynı skor (itibar sıralı iş arayanlar, geçişe uygun ahır/belediye oyuncuları, havuz NPC'leri); eşitlikte sıra bu
    cands = []
    if c["seekers"]:
        s = max(c["seekers"][:NPC_POOL_K], key=lambda x: _score(W, x))
        cands.append((_score(W, s), "seeker", s, None))
    mv = _peek_mover(W, ci, f, ahirs, key=lambda x: _score(W, x))
    if mv is not None:
        cands.append((_score(W, mv[0]), "mover", mv[0], mv[1]))
    n = best_pool()
    if n is not None:
        cands.append((_score(W, n), "npc", n, None))
    if not cands:
        return None, None
    best = cands[0]
    for x in cands[1:]:
        if x[0] > best[0] + 1e-12:
            best = x
    _, kind, q, src = best
    if kind == "seeker":
        c["seekers"].remove(q)
        return q, "seeker"
    if kind == "npc":
        c["pool"].remove(q)
        return q, "npc"
    return q, _take_mover_at(W, ci, q, src)


def _take_mover_at(W, ci, q, src):
    """_peek_mover'ın seçtiği q'yu kaynağından çıkarır (insan _peek_mover'dan hiç çıkmaz)."""
    if src.startswith("ahir:"):
        a = src[5:]
        W.firms[a]["workers"].remove(q)
        if KR_MEAS:
            lab_ev(W, "cikis_gecis", a)                      # davranışsız sayaç (§4.6)
        if AHIR_BACKFILL:
            ahir_backfill(W, a)
        return "ahir"
    W.firms[f"s{ci}_belediye0"]["workers"].remove(q)
    if KR_MEAS:
        lab_ev(W, "cikis_gecis", f"s{ci}_belediye0")
    return "belediye"


def _h01(tag, week, q):
    """D10: [0, 1) aralığında deterministik sayı (hafta ve kişi adından; zlib.crc32, PYTHONHASHSEED'den bağımsız)."""
    return zlib.crc32(f"{tag}|{week}|{q}".encode()) / 4294967296.0


def adj_target(target, n, week_no, exempt=False):
    """D10 (B2): kadro düzeltme hızı. n kişilik NPC işletmesinin hedefini haftalık sınıra kırpar: küçülme en çok max(1, int(n x SHRINK_CAP)) kişi
    (muaf işletme: zarar eden ve kasası eşiğin altındaki, SHRINK_FIRST), büyüme en çok max(1, int(n x GROW_CAP)) kişi. 1. hafta (açılış kadrosu) ve STAFF_ADJ=0 hedefi değiştirmez."""
    if STAFF_ADJ != 1 or week_no <= 1:
        return target
    if target < n:
        if exempt:
            return target
        return max(target, n - max(1, int(n * SHRINK_CAP + 1e-9)))
    if target > n:
        return min(target, n + max(1, int(n * GROW_CAP + 1e-9)))
    return target


def sep_step(W, ci, by_kind):
    """D10 (B3, SEP_RATE > 0): yerleşik (NPC) işletmelerde çalışan her NPC, hafta ve kişi adından deterministik olasılıkla (SEP_RATE) kendiliğinden ayrılıp havuza döner;
    çıkarma dalgasından bağımsızdır, yönetici/uzman/araştırmacı ayrılmaz. Sayaç: ayrilan_npc."""
    firms = W.firms
    people = W.people
    c = W.cities[ci]
    n = 0
    for kind, fl in by_kind.items():
        for f in fl:
            d = firms[f]
            for q in list(d["workers"]):
                i = people[q]
                if i["who"] != "npc" or isrole(i) or isres(i):
                    continue
                if _h01("sep", W.week_no, q) < SEP_RATE:
                    d["workers"].remove(q)
                    if KR_MEAS:
                        lab_ev(W, "cikis_ayrilma", f)         # davranışsız sayaç (§4.6)
                    i["firm"] = None
                    c["pool"].append(q)
                    n += 1
    if n:
        hire_stat(W)["ayrilan_npc"] += n


def disc_step(W, ci):
    """D10 (B7, DISCOURAGE_WEEKS > 0): havuzda DISCOURAGE_WEEKS haftadan uzun işsiz kalan NPC haftada DISC_RATE olasılıkla işgücü dışına çıkar (c["out"]): iş aramaz, işe alınmaz.
    İşgücü dışındaki NPC haftada DISC_RETURN olasılıkla havuza döner (dönüş kuralı; işsizlik süresi yeniden sayılır); DISCOURAGE_WEEKS koşu ortasında 0 yapılırsa hepsi döner. Havuzda geçirilen hafta sayısı c["idle"]'da tutulur (havuzdan çıkan silinir)."""
    c = W.cities[ci]
    st = hire_stat(W)
    out = c.setdefault("out", [])
    if DISCOURAGE_WEEKS <= 0:                                        # kural koşu ortasında kapatıldı: işgücü dışındakilerin hepsi havuza döner
        if out:
            c["pool"].extend(out)
            st["isgucune_donen"] += len(out)
            out[:] = []
        c["idle"] = {}
        return
    back = [q for q in out if _h01("ret", W.week_no, q) < DISC_RETURN]
    if back:
        bs = set(back)
        out[:] = [q for q in out if q not in bs]
        c["pool"].extend(back)
        st["isgucune_donen"] += len(back)
    old = c.get("idle", {})
    idle = {}
    leave = set()
    for q in c["pool"]:
        k = old.get(q, 0) + 1
        if k > DISCOURAGE_WEEKS and _h01("disc", W.week_no, q) < DISC_RATE:
            leave.add(q)
        else:
            idle[q] = k
    if leave:
        gone = [q for q in c["pool"] if q in leave]
        c["pool"][:] = [q for q in c["pool"] if q not in leave]
        out.extend(gone)
        st["cesareti_kirilan"] += len(gone)
    c["idle"] = idle


def npc_population(W, ci):
    """D10 (B6): şehrin NPC nüfusu: işgücündeki (havuz + çalışan), hanedeki bakmakla yükümlü ve işgücü dışına çıkmış NPC'ler."""
    c = W.cities[ci]
    firms = W.firms
    people = W.people
    emp = sum(1 for f in c["firms"] for q in firms[f]["workers"] if people[q]["who"] == "npc")
    return emp + len(c["pool"]) + len(c.get("deps", ())) + len(c.get("out", ()))


def ghost_step(W, f, d, c, hst):
    """D11 (D2): hayalet firma: işçisiz ve parasız (nakdi bir kişilik işletme sermayesinden az) yerleşik işletme; kamu altyapısı sayılmaz.
    Her hafta sayılır (gösterge: hst["hayalet_firma"]). GHOST_MODE=2 iken kurtarma geçişi bittikten sonra (NO_BAILOUT ve NPC_GRACE) GHOST_WEEKS hafta üst üste
    hayalet kalan işletme batar (npc_die: kasası şehre, kredisi loncaya; talep dönerse lonca kredisiyle yeniden kurulabilir). Kapanırsa True."""
    if d["workers"] or d.get("dead") or d["kind"] in NPC_EXEMPT or d["kind"] in ("ahir", "belediye") or _ghost_funded(W, f, d) \
            or (W.week_no == 1 and not d.get("capitalized")):          # son inceleme M3: ilk haftada sermaye bu turdan sonra verilir; henüz kurulmamış işletme hayalet değildir
        if "ghost" in d:
            d.pop("ghost")
        return False
    hst["hayalet_firma"] += 1
    if GHOST_MODE != 2:
        return False
    if not (NO_BAILOUT and W.week_no > NPC_GRACE):
        return False
    d["ghost"] = d.get("ghost", 0) + 1
    if d["ghost"] < GHOST_WEEKS:
        return False
    d.pop("ghost")
    if not npc_die(W, f, d, c):
        return False                                              # te-denge G6: son üretici ölmez; kapanış sayılmaz
    hst["hayalet_kapanan"] += 1
    return True


def _ghost_funded(W, f, d):
    """D11 (D2): işletmenin nakdi bir kişilik işletme sermayesini karşılıyor mu (karşılıyorsa hayalet sayılmaz)."""
    return W.L.bal[f] >= working_capital(W, W.firms, W.people, f, 1)


def ghost_support(W, f, d, c, granted):
    """D11 (D2, GHOST_MODE=1): geçiş desteği (TRANS_SUPPORT=2) işletmeye verilemediyse bu hafta sayılır, verildiyse sayaç sıfırlanır; üst üste GHOST_WEEKS hafta
    gelmeyen işletme batar. Kapanırsa True."""
    if granted:
        d.pop("tsup_miss", None)
        return False
    d["tsup_miss"] = d.get("tsup_miss", 0) + 1
    if d["tsup_miss"] < GHOST_WEEKS:
        return False
    d.pop("tsup_miss")
    if not npc_die(W, f, d, c):
        return False                                              # te-denge G6: son üretici ölmez; kapanış sayılmaz
    hire_stat(W)["hayalet_kapanan"] += 1
    return True


def fire_pick(W, cur):
    """D6: küçülen NPC firmasında çıkarılacak kişi (FIRE_ORDER); çıkarılacak yoksa None. Rol sahipleri (yönetici/uzman) ve araştırmacılar yeni sıralarda korunur."""
    people = W.people
    if FIRE_ORDER == 0:
        return next((x for x in reversed(cur) if people[x]["who"] == "npc"), None)
    cand = [x for x in reversed(cur) if not isrole(people[x]) and not isres(people[x])]
    if not cand:
        return None
    if FIRE_ORDER == 1:
        return max(cand, key=lambda x: people[x].get("hired", 0))
    if FIRE_ORDER == 2:
        return min(cand, key=lambda x: _ht()[people[x]["tier"]])
    return min(cand, key=lambda x: zlib.crc32(f"fire|{W.week_no}|{x}".encode()))


def _dolgu_npcs(W, a):
    """D7 (M1): ahırdaki geri doldurma NPC'leri (AHIR_BACKFILL ile girenler); sürü bakımı için bırakılanlar ve öbür NPC'ler sayılmaz."""
    people = W.people
    return [x for x in W.firms[a]["workers"] if people[x].get("ahir_dolgu") and people[x]["who"] == "npc"]


def _inflow_want(W, ci):
    """D6/D7: şehirde bu hafta katılmak isteyen yeni oyuncu sayısı (toplam kişi sınırından ÖNCE)."""
    if PLAYER_INFLOW == 0:
        return 0
    c = W.cities[ci]
    firms = W.firms
    people = W.people
    ahirs = [a for a in c["firms"] if firms[a]["kind"] == "ahir"]
    if PLAYER_INFLOW == 1:
        tgt = AHIR_TARGET if AHIR_TARGET > 0 else PLAYERS_PER_CITY
        in_ahir = sum(1 for a in ahirs for x in firms[a]["workers"] if people[x]["who"] == "oyuncu")
        free = sum(max(0, firms[a]["capacity"] - len(firms[a]["workers"])) + len(_dolgu_npcs(W, a)) for a in ahirs)    # D7 (M1): geri doldurma NPC'leri yeri tutmaz
        want = min(tgt - in_ahir, free)
    else:
        want = PLAYER_INFLOW_RATE
    return max(0, min(want, PLAYER_MAX_PER_CITY - len(c["players"])))


def _inflow_alloc(wants, room):
    """D7 (M4): toplam kişi sınırı darken yer şehirlere eksik oranına göre bölünür (en büyük kalan yöntemi, eşitlikte küçük şehir sırası); deterministik."""
    tot = sum(wants)
    if tot <= room:
        return list(wants)
    base = [room * w // tot for w in wants]
    rem = room - sum(base)
    order = sorted(range(len(wants)), key=lambda i: (-((room * wants[i]) % tot), i))
    for i in order[:rem]:
        base[i] += 1
    return base


def player_inflow_all(W):
    """D6/D7 (PLAYER_INFLOW): bütün şehirler için yeni oyuncu katılımı; toplam kişi sınırı (PLAYER_MAX_TOTAL) şehirlere adil bölünür."""
    if PLAYER_INFLOW == 0:
        return 0
    n_c = len(W.cities)
    wants = [_inflow_want(W, ci) for ci in range(n_c)]
    if PLAYER_MAX_TOTAL > 0 and sum(wants) > 0:
        room = max(0, PLAYER_MAX_TOTAL - len(W.people))
        if sum(wants) > room:
            hire_stat(W)["katilim_sinir_engel"] += sum(wants) - room
        wants = _inflow_alloc(wants, room)
    return sum(player_inflow(W, ci, n=wants[ci]) for ci in range(n_c))


def _inflow_start_money(W, ci, p):
    """D7 (M4): yeni oyuncunun başlangıç parası kuruluşla (world_build) aynı kaynak sırasını izler: CITY_START_CASH > 0 ise önce şehir kasasından, yetmeyen kısım kayıtlı basımla; değilse tümü kayıtlı basım."""
    L = W.L
    acct = W.cities[ci]["acct"]
    x = float(START_AKCE)
    if CITY_START_CASH > 0:
        take = min(x, max(0.0, L.bal[acct]))
        if take > 0.0:
            L.bal[acct] -= take
            L.bal[p] += take
            L.flows["baslangic_parasi"] += take
            x -= take
    if x > 0.0:
        L.bal[p] += x                                          # kuruluş basımıyla aynı kalem: kayıtlı basım (korunum: Σbakiye = minted)
        L.minted += x
        L.fiscal_minted += x
        L.flows["baslangic_parasi"] += x
        hire_stat(W)["baslangic_parasi_basim"] += x                # son inceleme I3: bu basım şehir kasasına girmez (gösterge `city_in_mint` bunu çıkarır)


def player_inflow(W, ci, n=None):
    """D6 (PLAYER_INFLOW): şehirde yeni oyuncular ahıra çırak olarak katılır; world_build'deki oyuncu kurulumuyla aynı (tier 0, innov/path oranı; START_AKCE kayıtlı kaynaktan).
    n verilmezse istek (_inflow_want) toplam kişi sınırına göre kırpılır; player_inflow_all adil bölüşümü kendisi yapıp n verir."""
    if PLAYER_INFLOW == 0:
        return 0
    L = W.L
    c = W.cities[ci]
    firms = W.firms
    people = W.people
    st = hire_stat(W)
    ahirs = [a for a in c["firms"] if firms[a]["kind"] == "ahir"]
    if n is None:
        n = _inflow_want(W, ci)
        if n > 0 and PLAYER_MAX_TOTAL > 0:
            room = max(0, PLAYER_MAX_TOTAL - len(people))
            if n > room:
                st["katilim_sinir_engel"] += n - room
                n = room
    if n <= 0:
        return 0
    for _ in range(n):
        k = c.get("pn", PLAYERS_PER_CITY)
        c["pn"] = k + 1
        p = f"s{ci}_p{k}"
        _inflow_start_money(W, ci, p)
        if PLAYER_INFLOW == 1:
            fits = [a for a in ahirs if len(firms[a]["workers"]) < firms[a]["capacity"] or _dolgu_npcs(W, a)]
            f = min(fits or ahirs, key=lambda a: len(firms[a]["workers"]))
            if len(firms[f]["workers"]) >= firms[f]["capacity"] and _dolgu_npcs(W, f):
                out = _dolgu_npcs(W, f)[-1]                    # D7 (M1): yeni oyuncu önce; geri doldurma NPC'si havuza döner
                firms[f]["workers"].remove(out)
                if KR_MEAS:
                    lab_ev(W, "cikis_diger", f)                  # davranışsız sayaç: yeni oyuncu geri doldurma NPC'sinin yerini alır
                people[out]["firm"] = None
                people[out].pop("ahir_dolgu", None)
                c["pool"].append(out)
                st["ahir_dolgu_cikan"] += 1
        else:
            f = min(ahirs, key=lambda a: len(firms[a]["workers"]))
        firms[f]["workers"].append(p)
        if KR_MEAS:
            lab_ev(W, "ise", f)                                  # davranışsız sayaç: yeni oyuncu ahıra girer
        people[p] = dict(tier=0, wage=round(TIER_WAGE[0] * W.WI[ci] * (WELF_AHIR_MULT if W.WELF_ON else 1.0), 3), firm=f, who="oyuncu", city=ci)
        if INNOV_ON and k % 10 == INNOV_MOD:
            people[p]["innov"] = True
            if INNOV_ON and PATH_ON:
                people[p]["path"] = PATH_CYCLE[(k // 10) % len(PATH_CYCLE)]
        c["players"].append(p)
        if HOUSE_ON:
            W.hs[ci] += HOUSE_SLACK                            # konut stoku açılıştaki kuralla büyür (boşluk × kiracı)
        st["yeni_oyuncu"] += 1
    return n


def openings(W, ci):
    """Şehrin NPC firmalarında kadro hedefine göre boş yer sayısı (kapasite sınırı dahil; K-87 göç için)."""
    PM = W.PM
    RECIPES = W.RECIPES
    cities = W.cities
    firms = W.firms
    need, need_units = staffing(W, ci)
    c = cities[ci]
    by_kind = defaultdict(list)
    for f in c["firms"]:
        if firms[f]["owner"] is None and firms[f]["kind"] not in ("ahir", "belediye") and not firms[f].get("dead"):
            by_kind[firms[f]["kind"]].append(f)
    tot = 0
    for kind, fl in by_kind.items():
        per_firm = need[kind] / len(fl)
        if need[kind] < MIN_STAFF and (not RECIPES[kind][0] or PM.get((ci, next(iter(RECIPES[kind][0]))), 1.0) < PM_BOOST_FROM):
            continue                                              # K-154: restaff ile aynı eşik
        for f in fl:
            tot += max(0, min(firms[f]["capacity"], int(per_firm + 0.9999)) - len(firms[f]["workers"]))
    return tot


def res_target(W, f, d):
    """te-denge G3 (NPC_RES_REL): NPC işletmenin hedef nakit rezervi = RES_REL_WEEKS hafta x döngü x (kadronun döngü ücreti + kira). Gerçek dünya: firma nakit tamponu hacme bağlıdır (Caiani ve ark. 2016)."""
    return RES_REL_WEEKS * CYCLES_PER_WEEK * (sum(W.people[q]["wage"] for q in d["workers"]) + ix(W, RENT))


def npc_kopru_ver(W, f, d, lo_b, need_b, ln_b, week_no, adet):
    """K-185.2 / K-195: NPC köprü kredisi ya da likidite avansı (restaff'ın iki lonca kanalı): lo_b loncası f'ye need_b öder, kayda yazılır, sayaç (adet) ve npc_kopru_kredisi akışı işler, ödeme gücü sayacı sıfırlanır; True döner.
    LONCA_TERMS (REKABET G5, Ö-C/K-a): ödeyen lt_ode ile devirden SONRA belirlenir ve tutar onun lendable'ıyla kısılır; kayda FİİLEN ödenen yazılır; ödenen 0 ise köprü BAŞARISIZ (sayaç, kayıt, insolv dokunulmaz) ve False döner."""
    L = W.L
    loans = W.loans
    if LONCA_TERMS:
        lo_b, need_b = lt_ode(W, f, need_b, week_no)
        if need_b <= 1e-9:
            return False
    else:
        L.pay(f"{lo_b}_sermaye", f, need_b, "kredi_verilen")
    if ln_b and need_b > 1e-9:
        ln_b["p0"] += need_b
        ln_b["out"] += need_b
    elif need_b > 1e-9:
        loans[f] = dict(lo=lo_b, p0=need_b, out=need_b, miss=0, rate=LR_NEW(W), tur="npc")
    if LONCA_TERMS:
        lt_damga(W, f, loans[f], need_b)                             # REKABET G5: tek açılış damgası
    L.flows[adet] += 1
    L.flows["npc_kopru_kredisi"] += need_b
    d["insolv"] = 0
    return True


def restaff(W, ci):
    CAPEX_ON = W.CAPEX_ON
    L = W.L
    last_short = W.last_short
    NLAB_ON = W.NLAB_ON
    PM = W.PM
    PRIV_ON = W.PRIV_ON
    RECIPES = W.RECIPES
    REP = W.REP
    ad_w = W.ad_w
    cities = W.cities
    closed = W.closed
    firms = W.firms
    loans = W.loans
    loncas = W.loncas
    media_stat = W.media_stat
    mprof = W.mprof
    npc_log = W.npc_log
    people = W.people
    priv_stat = W.priv_stat
    week_no = W.week_no
    c = cities[ci]
    need, need_units = staffing(W, ci)
    ahirs = [f for f in c["firms"] if firms[f]["kind"] == "ahir"]
    hst = hire_stat(W)

    src = [None]

    find_cap = [0]                                                    # D10 (B3): FIND_RATE havuzdan haftalık işe alım hakkı (yalnız FIND_RATE < 1 ve 1. haftadan sonra)

    def take_worker(f=None):
        """D10 (B3): FIND_RATE dolunca havuz o çağrı için görünmez (iş arayan oyuncu, ahır ve belediye geçişi sürer); aksi halde _take_worker aynen."""
        if FIND_RATE < 1.0 and week_no > 1:
            if find_cap[0] <= 0 and c["pool"]:
                saved = c["pool"]
                c["pool"] = []
                try:
                    return _take_worker(f)
                finally:
                    c["pool"] = saved
            q_ = _take_worker(f)
            if q_ is not None and src[0] == "npc":
                find_cap[0] -= 1
            return q_
        return _take_worker(f)

    def _take_worker(f=None):
        """1. hafta: açılış kadrosu NPC (K-77). Sonra boşluk: iş arayan oyuncu → ahırdaki oyuncu (K-81) → NPC havuzu.
        D6: HIRE_PRIORITY ya da AHIR_MOVE varsayılan dışıysa pick_worker kararı verir; varsayılanda v13.0 yolu aynen."""
        if week_no == 1 and c["pool"]:
            src[0] = "npc"
            return c["pool"].pop(0)
        if HIRE_PRIORITY != 0 or AHIR_MOVE != 0:
            q_, src[0] = pick_worker(W, ci, f, ahirs)
            return q_
        if c["seekers"]:
            if NLAB_ON and c["pool"]:                              # K-185.15: işveren skorla seçer: iş arayan oyuncu (itibar sıralı ilk) ile havuzdaki en tecrübeli NPC
                sq_ = c["seekers"][0]
                sc_p = _ht()[people[sq_]["tier"]] + 0.3 * REP[sq_] / 100.0 + PLAYER_PRIO
                bn_ = max(c["pool"][:NPC_POOL_K], key=lambda x_: _ht()[people[x_]["tier"]])
                if _ht()[people[bn_]["tier"]] > sc_p:
                    c["pool"].remove(bn_)
                    L.flows["npc_isbasi_secim"] += 1
                    src[0] = "npc"
                    return bn_
            src[0] = "seeker"
            return c["seekers"].pop(0)
        for a in ahirs:
            q = pop_ahir_player(W, a)
            if q is not None:
                src[0] = "ahir"
                return q
        mw = firms[f"s{ci}_belediye0"]["workers"]
        q = next((x for x in mw if people[x]["who"] == "oyuncu" and x != W.human), None)    # belediye işçisi özel işe geçer (DAO oyunu: insan kendiliğinden geçmez)
        if q is not None:
            mw.remove(q)
            if KR_MEAS:
                lab_ev(W, "cikis_gecis", f"s{ci}_belediye0")     # davranışsız sayaç: belediye işçisi özel işe geçer
            src[0] = "belediye"
            return q
        src[0] = "npc"
        return c["pool"].pop(0) if c["pool"] else None
    if TRANS_SUPPORT == 2 and TRANS_REVIVE and NO_BAILOUT and week_no > NPC_GRACE:
        trans_scan(W, ci, need)                                      # K-211 v2: (şehir × tür) özel kesim payı ve destek oranı; yeniden açılıştan ÖNCE (batmış NPC'li türler dahil)
    if NO_BAILOUT and week_no > NPC_GRACE:                           # K-185.2: batan NPC, kârlı sinyal varsa lonca kredisiyle yeniden kurulur (şehir kasasından değil)
        if SOLE_KEEP:
            for f in c["firms"]:
                d = firms[f]
                if d.get("sole") and not son_uretici(W, f, d):
                    d.pop("sole")                                    # te-denge G6: özel/başka kadrolu üretici girdi: işaret düşer, olağan kurallar
                    d["capitalized"] = True
        for f in c["firms"]:
            d = firms[f]
            if SOLE_KEEP and d["owner"] is None and d.get("dead") and d["kind"] not in ("ahir", "belediye") and d["kind"] in PROD_OF \
                    and PROD_OF[d["kind"]] in zincir_urunleri(W) and sole_uretici_yok(W, f, d):
                d.pop("dead")                                        # te-denge G6: dünyada zincir ürününün canlı kadrolu üreticisi yok: sinyal/bekleme aranmaz, kredisiz açılır (işletme sermayesi şehirden, tavanlı)
                d["capitalized"] = False
                d["sole"] = week_no
                d["insolv"] = 0
                d["revived"] = week_no
                if REVIVE_HYGIENE:
                    d["zmb"] = 0
                    d.pop("wfail_w", None)
                    d["nrev"] = d.get("nrev", 0) + 1
                if REVIVE_CAPITAL == 1:
                    d.pop("mach", None)
                    d.pop("bld", None)
                elif REVIVE_CAPITAL >= 2:
                    revive_plant_take(W, f, d, max(SOLE_STAFF, min(d["capacity"], int(need[d["kind"]] / (1 + sum(1 for g_ in c["firms"] if firms[g_]["kind"] == d["kind"] and firms[g_]["owner"] is None and not firms[g_].get("dead"))) + 0.9999))))
                L.flows["npc_canlandirma_adet"] += 1
                npc_log.append((week_no, ci, d["kind"], "canlandi"))
                continue
            if d["owner"] is not None or not d.get("dead") or d["kind"] in ("ahir", "belediye") or week_no - d.get("died", 0) < (REVIVE_REDELAY[min(d["nrev"], 2) - 1] if (REVIVE_HYGIENE and d.get("nrev", 0) >= 1) else NPC_REVIVE_DELAY):
                continue
            k_ = d["kind"]
            if (k_ not in NPC_INFRA or (MARKET_OPEN and k_ == "market")) and not (need[k_] >= (REVIVE_MIN_STAFF if REVIVE_HYGIENE else MIN_STAFF) and ((pcr_of(W, ci, k_) >= (max(ZB_PCR, REVIVE_PCR) if REVIVE_HYGIENE else ZB_PCR)) if ZOMBIE_EXIT else (PM.get((ci, PROD_OF.get(k_)), 1.0) >= NPC_REVIVE_PM) or (ORDER_BOOK and last_short.get(PROD_OF.get(k_), 0.0) > 0))):
                continue
            if TRANS_SUPPORT == 2 and TRANS_REVIVE and trans_s(W, ci, d) > 1e-12:     # K-211 v2 (TRANS_REVIVE=1): destek alan sektörde batan NPC kredisiz yeniden açılır (işletme sermayesi destek fonundan; kredi borcu temerrüde yol açmaz)
                d.pop("dead")
                d["capitalized"] = False
                d["tsup2"] = True
                d["insolv"] = 0
                d["revived"] = week_no
                if REVIVE_HYGIENE:
                    d["zmb"] = 0
                    d.pop("wfail_w", None)
                    d["nrev"] = d.get("nrev", 0) + 1
                if REVIVE_CAPITAL == 1:
                    d.pop("mach", None)                              # DAO oyunu M5: yeniden açılan işletme standart tesisle (capex_start: CAPEX_MIN_SLOTS) başlar; tasfiyede sıfırlanan yuva yeniden kurulmazsa capf = 0 ve üretim sıfır kalır
                    d.pop("bld", None)
                elif REVIVE_CAPITAL >= 2:
                    revive_plant_take(W, f, d, max(2, min(d["capacity"], int(need[k_] / (1 + sum(1 for g_ in c["firms"] if firms[g_]["kind"] == k_ and firms[g_]["owner"] is None and not firms[g_].get("dead"))) + 0.9999))))      # RC=2: kendi tesisini geri alır (destek fonu kredisiz: eksik yuva capex_plan ile kurulur)
                L.flows["npc_canlandirma_adet"] += 1
                npc_log.append((week_no, ci, k_, "canlandi"))
                continue
            ok_lo = [l_ for l_ in loncas if l_ not in closed]
            lo_ = max(ok_lo, key=lambda l_: (lendable(W, l_), l_)) if ok_lo else None
            d.pop("dead")
            n_k_ = sum(1 for g_ in c["firms"] if firms[g_]["kind"] == k_ and firms[g_]["owner"] is None and not firms[g_].get("dead")) + 1
            wc_ = working_capital(W, firms, people, f, extra_workers=max(2, min(d["capacity"], int(need[k_] / n_k_ + 0.9999))))
            d["dead"] = True
            ex_ = max(2, min(d["capacity"], int(need[k_] / n_k_ + 0.9999)))
            if REVIVE_HYGIENE:
                yeni_ = TIER_WAGE[0] * W.WI[ci] * (KIND_WM.get(k_, 1.0) if SVC_KINDS else 1.0)      # hijyen: işletme sermayesi = ise alim kapisinin ister gordugu ucret donguleri (gercek olcek); tesis bedeli ayrica eklenir
                wc_ += max(0.0, HIRE_WEEK_CYCLES * ex_ * yeni_ - WORKING_CAPITAL_CYCLES * ex_ * TIER_WAGE[0])
            tr_ = 0.0
            if REVIVE_HYGIENE and REVIVE_TRANCHE:
                wc1_ = working_capital(W, firms, people, f, extra_workers=1) - WORKING_CAPITAL_CYCLES * TIER_WAGE[0] + HIRE_WEEK_CYCLES * yeni_      # kademeli sermaye: ilk haftada yalniz ilk iscinin bir haftalik ucreti (+kira, girdi); kalani kadro kuruldukca cekilir
                tr_ = max(0.0, wc_ - wc1_)
                wc_ = min(wc_, wc1_)
            if REVIVE_HYGIENE and len(c["pool"]) + len(c["seekers"]) < ex_:
                hij_say(W, "rv_red_arz")                             # hijyen: işgücü arzı ilk kadroya yetmiyorsa canlanmaz (boş firma zombi olur)
                continue
            if lo_ is None or wc_ <= 0 or lendable(W, lo_) < wc_:
                hij_say(W, "rv_red_lonca")                           # davranışsız sayaç: lonca havuzu ilk kredi tutarını karşılamıyor
                continue
            pm_ = pb_ = 0.0
            if REVIVE_CAPITAL >= 2:
                pm_, pb_ = revive_plant_take(W, f, d, ex_, commit=False)   # RC=2: önce kendi masası/kabuğu; eksik yuva kredi + bedelli alım (yoktan tesis yok); yuva kredi kontrolünden SONRA çekilir (M6.1)
                pc_ = revive_plant_cost(W, f, d, pm_, pb_)
                if lendable(W, lo_) < wc_ + pc_:
                    hij_say(W, "rv_red_lonca")
                    continue
                wc_ += pc_
                revive_plant_take(W, f, d, ex_)                      # M6.1: kredi yeterliyse masadaki/kabuktaki yuva şimdi çekilir (yetmezse masa değişmez)
            d.pop("dead")
            L.pay(f"{lo_}_sermaye", f, wc_, "kredi_verilen")
            loans[f] = dict(lo=lo_, p0=wc_, out=wc_, miss=0, rate=LR_NEW(W), tur="npc")
            if LONCA_TERMS:
                lt_damga(W, f, loans[f], wc_)                        # REKABET G5: tek açılış damgası
            if REVIVE_CAPITAL >= 2 and (pm_ > 1e-9 or pb_ > 1e-9):
                revive_plant_buy(W, f, d, pm_, pb_, pc_)
            d["lonca"] = lo_
            d["capitalized"] = True
            d["revived"] = week_no
            if REVIVE_HYGIENE:
                d["tr_left"] = tr_                                  # kademeli sermaye: kalan (henuz cekilmemis) isletme sermayesi
                d["zmb"] = 0
                d.pop("wfail_w", None)
                d["nrev"] = d.get("nrev", 0) + 1                      # tekrar-canlanma freni: sonraki canlanma bekleme suresi REVIVE_REDELAY
            if REVIVE_CAPITAL == 1:
                d.pop("mach", None)                                  # DAO oyunu M5: aynı (lonca kredisiyle yeniden kurulan NPC standart tesisle başlar)
                d.pop("bld", None)
            L.flows["npc_canlandirma_adet"] += 1
            L.flows["npc_canlandirma_kredi"] += wc_
            npc_log.append((week_no, ci, k_, "canlandi"))
    by_kind = defaultdict(list)
    for f in c["firms"]:
        if firms[f]["owner"] is None and firms[f]["kind"] not in ("ahir", "belediye") and not firms[f].get("dead"):
            by_kind[firms[f]["kind"]].append(f)
    if (TRANS_SUPPORT == 1 or (TRANS_SUPPORT == 2 and not TRANS_REVIVE)) and NO_BAILOUT and week_no > NPC_GRACE:
        trans_scan(W, ci, need)                                      # K-211: (şehir × tür) özel kesim payı ve destek oranı
    if week_no > 1:
        if DISCOURAGE_WEEKS > 0 or c.get("out"):
            disc_step(W, ci)                                         # D10 (B7): uzun süre işsiz kalan işgücü dışına çıkar / dönüş (kural kapanırsa herkes döner)
        if SEP_RATE > 0.0:
            sep_step(W, ci, by_kind)                                 # D10 (B3): kendiliğinden ayrılma
        hst["issiz_haftabasi"] += len(c["pool"]) + len(c["seekers"])   # D10 (F): iş bulma oranının paydası (gösterge; davranışa girmez)
        if FIND_RATE < 1.0:
            find_cap[0] = math.ceil(len(c["pool"]) * FIND_RATE - 1e-9)
    for kind, fl in by_kind.items():
        per_firm = need[kind] / len(fl)
        for f in fl:
            d = firms[f]
            exempt_ = False
            target = min(d["capacity"], int(per_firm + 0.9999)) if (need[kind] >= MIN_STAFF or PM.get((ci, next(iter(RECIPES[kind][0])) if RECIPES[kind][0] else None), 1.0) >= PM_BOOST_FROM) else 0     # K-154: talep bir işçinin %MIN_STAFF'ından azsa kadro açılmaz (turist yalnız bir şehre gider; öbür şehirlerde otel boşuna işçi tutup batıyordu)
            target = max(target, min(d["capacity"], RESERVE.get(kind, 0)))
            rv_ = d.get("revived") is not None and week_no - d["revived"] <= 6 and not d["workers"]      # davranışsız sayaç: canlanmış, kadrosuz firma-haftası
            if rv_:
                hij_say(W, "rv_fh")
                if target == 0:
                    hij_say(W, "rv_hedef0")
            if REVIVE_HYGIENE and d.get("revived") is not None and week_no - d["revived"] < REVIVE_GRACE_W:
                target = max(target, min(d["capacity"], 1))             # hijyen: canlanan firma ilk haftalarda talep dalgalanmasıyla boş bırakılmaz
            if d.get("seed"):
                target = max(target, DOMESTIC_SEED)                  # K-133: program firması en az tohum kadrosuyla başlar
            if target > 1 and RECIPES[kind][1]:                      # K-125: girdisi gelmeyen firma kadroyu küçültür (en az 1 kişi: talep sinyali)
                target = max(1, int(target * max(OK_FLOOR, d.get("ok_prev", 1.0)) + 0.9999))
            if SHRINK_FIRST and NO_BAILOUT and week_no > NPC_GRACE and d.get("prof", 0.0) < 0 and d["workers"]:
                if L.bal[f] < SHRINK_WEEKS * CYCLES_PER_WEEK * sum(people[q_]["wage"] for q_ in d["workers"]):
                    exempt_ = True                                   # D10 (B2): zarar eden ve kasası eşiğin altındaki işletme kadro düzeltme hızından muaf
                    strict_ = max(1, int(per_firm / (LOG_BUFFER_NB if kind == "lojistik" else STAFF_BUFFER) + 0.9999))
                    target = min(target, strict_, len(d["workers"]))
                    if target < len(d["workers"]):
                        L.flows["kuculme_npc_kisi"] += len(d["workers"]) - target
            if STAFF_ADJ == 1:
                target = adj_target(target, len(d["workers"]), week_no, exempt_)      # D10 (B2)
            nb_ = NO_BAILOUT and week_no > NPC_GRACE and not d.get("org_owner") and kind not in NPC_EXEMPT
            ob_x_ = max(0, target - len(d["workers"])) if (ORDER_BOOK and nb_) else 0       # K-195: hedef kadronun (talep defteri) açığı için işletme sermayesi
            if d["capitalized"] and (L.bal[f] < TIER_WAGE[0] * WORKING_CAPITAL_CYCLES or (ob_x_ and L.bal[f] < NPC_INSOLV * working_capital(W, firms, people, f, ob_x_))) and target > 0 and (not nb_ or L.bal[f] < NPC_INSOLV * working_capital(W, firms, people, f, ob_x_)):
                if nb_ and TRANS_SUPPORT == 2 and trans_s(W, ci, d) > 1e-12:
                    d["capitalized"] = False                         # K-211 v2 (TRANS_SUPPORT=2): kurtarmalı rejimin kanalı: bu hafta sonunda işletme sermayesi açığı şehirden gelir (kind kamu_destek_fonu, sınırlı), köprü kredisi yok, NPC ölmez
                    d["tsup2"] = True
                    d["insolv"] = 0
                    nb_ok_ = True
                elif nb_ and TRANS_SUPPORT == 1 and TRANS_FIRST and d.get("prof", 0.0) < 0 and trans_support(W, ci, f, d, c, ob_x_):
                    nb_ok_ = True                                    # K-211 (TRANS_FIRST): zarar eden NPC'ye köprü kredisinden ÖNCE şehir desteği (borç biriktirmeden)
                elif nb_ and NPC_FLOAT and NPC_LONCA_FUND and d.get("prof", 0.0) >= -NPC_FAIL * working_capital(W, firms, people, f):
                    wcb_ = working_capital(W, firms, people, f, ob_x_)
                    need_b = wcb_ - L.bal[f]
                    ln_b = loans.get(f)
                    out_b = ln_b["out"] if ln_b else 0.0
                    lo_b = d["lonca"] if d["lonca"] not in closed else None
                    if LONCA_TERMS and lo_b:
                        lo_b = lt_alacakli(W, f)                     # REKABET G5 (Y2): tranşı kaydın ALACAKLISI öder (devir uygunsa devir aşağıda yapılır)
                    if lo_b and need_b > 0 and out_b + need_b <= NPC_LEV * wcb_ and need_b <= lendable(W, lo_b) and not (ln_b and ln_b["miss"] > 0):
                        nb_ok_ = npc_kopru_ver(W, f, d, lo_b, need_b, ln_b, week_no, "npc_likidite_avansi_adet")
                        if not nb_ok_ and L.bd is not None:
                            L.bd[("sebep", "kopru_red_havuz_yetmedi" + ("_kronik" if d.get("prof", 0.0) < -NPC_FAIL * working_capital(W, firms, people, f) else ""), f)] += need_b     # REKABET G5 (K-a): devirden sonra ödenen 0
                    else:
                        nb_ok_ = False
                        if L.bd is not None:
                            _why = "lonca_kapali" if not lo_b else ("temerrut" if (ln_b and ln_b["miss"] > 0) else ("kaldirac" if out_b + need_b > NPC_LEV * wcb_ else ("havuz_yetmedi" if need_b > lendable(W, lo_b) else "ihtiyac_yok")))
                            L.bd[("sebep", "kopru_red_" + _why + ("_kronik" if d.get("prof", 0.0) < -NPC_FAIL * working_capital(W, firms, people, f) else ""), f)] += need_b
                elif nb_ and NPC_FLOAT and not NPC_LONCA_FUND and d.get("prof", 0.0) >= -NPC_FAIL * working_capital(W, firms, people, f):
                    d["capitalized"] = False                      # sağlıklı NPC: şehir geliri (basımsız) nakit avansı verir; kâr sonra şehre süpürülür
                    L.flows["npc_likidite_avansi_adet"] += 1
                    d["insolv"] = 0
                    nb_ok_ = True
                elif nb_ and NPC_BRIDGE:                        # K-185.2: ödeme gücü açığı lonca köprü kredisiyle kapanır (şehir değil); borç sınırı aşılırsa ya da havuz yetmezse sayaç işler
                    wcb_ = working_capital(W, firms, people, f, ob_x_)
                    need_b = wcb_ - L.bal[f]
                    ln_b = loans.get(f)
                    out_b = ln_b["out"] if ln_b else 0.0
                    lo_b = d["lonca"] if d["lonca"] not in closed else None
                    if LONCA_TERMS and lo_b:
                        lo_b = lt_alacakli(W, f)                     # REKABET G5 (Y2): tranşı kaydın ALACAKLISI öder (devir uygunsa devir aşağıda yapılır)
                    if lo_b and need_b > 0 and out_b + need_b <= NPC_LEV * wcb_ and need_b <= lendable(W, lo_b) and not (ln_b and ln_b["miss"] > 0):
                        nb_ok_ = npc_kopru_ver(W, f, d, lo_b, need_b, ln_b, week_no, "npc_kopru_kredisi_adet")
                        if not nb_ok_ and L.bd is not None:
                            L.bd[("sebep", "kopru_red_havuz_yetmedi" + ("_kronik" if d.get("prof", 0.0) < -NPC_FAIL * working_capital(W, firms, people, f) else ""), f)] += need_b     # REKABET G5 (K-a): devirden sonra ödenen 0
                    else:
                        nb_ok_ = False
                        if L.bd is not None:
                            _why = "lonca_kapali" if not lo_b else ("temerrut" if (ln_b and ln_b["miss"] > 0) else ("kaldirac" if out_b + need_b > NPC_LEV * wcb_ else ("havuz_yetmedi" if need_b > lendable(W, lo_b) else "ihtiyac_yok")))
                            L.bd[("sebep", "kopru_red_" + _why + ("_kronik" if d.get("prof", 0.0) < -NPC_FAIL * working_capital(W, firms, people, f) else ""), f)] += need_b
                else:
                    nb_ok_ = False
                if nb_ and not nb_ok_ and TRANS_SUPPORT == 1:
                    nb_ok_ = trans_support(W, ci, f, d, c, ob_x_)    # K-211: köprü yetmezse şehir kendi kasasından (basımsız) geçiş desteği verir
                if nb_ and not nb_ok_:
                    d["insolv"] = d.get("insolv", 0) + 1
                    if d["insolv"] >= NPC_DIE_WEEKS:
                        if npc_die(W, f, d, c):                      # K-185.2: ödeme gücü NPC_DIE_WEEKS hafta üst üste yok: şehir kurtarmaz, firma batar
                            continue                                 # (te-denge G6: son üretici ölmez, False döner; firma bu hafta kadro ve sermaye adımlarına devam eder)
                elif not nb_:
                    d["capitalized"] = False                      # battı; NPC yönetici yeniden kurar (gösterge)
                    L.flows["npc_yeniden_kurulus_adet"] += 1
            elif NO_BAILOUT:
                d["insolv"] = 0
            if STAFF_EXPECT:
                target = se_hold(W, f, d, target)                  # M9.1 (f): çıkarma sürtünmesi (K hafta üst üste altında, haftalık oran sınırı, ödeme gücü sınırı)
            if SOLE_KEEP and d.get("sole"):
                target = max(target, min(d["capacity"], SOLE_STAFF))      # te-denge G6: son üretici asgari kadroyla çalışır (boş kabuk girdi üretmez)
            if KR_MEAS or HUMAN_ON:
                W.staff_tgt[f] = target                           # davranışsız kayıt (§4.6): bu haftanın hedef kadrosu
            cur = d["workers"]
            while len(cur) > target:
                q = fire_pick(W, cur)                              # D6: FIRE_ORDER (varsayılan npc_only: v13.0)
                if q is None:
                    break
                cur.remove(q)
                if KR_MEAS:
                    lab_ev(W, "cikis_kuculme", f)                # davranışsız sayaç (§4.6)
                people[q]["firm"] = None
                if HUMAN_ON:
                    human_cikis(W, q, "kucultme")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
                if people[q]["who"] == "npc":
                    c["pool"].append(q)
                    hst["isten_cikan_npc"] += 1
                else:
                    c["seekers"].append(q)
                    hst["isten_cikan_oyuncu"] += 1
            hid_ = human_hide(W, c, f, len(cur) < target) if HUMAN_ON else None         # DAO oyunu: insan iş arayanlarda kalır ama yalnız başvurduğu firmanın işe alımında görünür
            try:
                while len(cur) < target:
                    if REVIVE_HYGIENE and d.get("tr_left", 0.0) > 1e-9 and f in loans:
                        yk_ = HIRE_WEEK_CYCLES * (sum(people[q_]["wage"] for q_ in cur) + TIER_WAGE[0] * W.WI[ci] * (KIND_WM.get(kind, 1.0) if SVC_KINDS else 1.0))      # kademeli sermaye: sonraki iscinin kapi sarti kadar loncadan cekilir
                        x_ = min(d["tr_left"], max(0.0, yk_ - L.bal[f]), lendable(W, loans[f]["lo"]))
                        if x_ > 1e-9:
                            L.pay(f"{loans[f]['lo']}_sermaye", f, x_, "kredi_verilen")
                            loans[f]["out"] += x_
                            if KR_MEAS and loans[f].get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen / iade edilen kredi)
                                W.lo_stat["ks_verilen"] += x_
                            loans[f]["p0"] += x_
                            if LONCA_TERMS:
                                lt_damga(W, f, loans[f], x_)             # REKABET G5: tranşın açılış spread'i tutar ağırlıklı
                            d["tr_left"] -= x_
                            L.flows["npc_canlandirma_kredi"] += x_
                    if ((HIRE_CASH_GATE and d["capitalized"]) or HIRE_GATE_ALL) and not hire_cash_secure(W, f):
                        if KR_MEAS or HUMAN_ON:
                            W.staff_tgt[f] = len(cur)                  # davranışsız kayıt (§4.6, son düzeltme I3): kapı ilanı kesti, açık kadro sayılmaz (hedef = kapı sonrası kadro)
                        if rv_:
                            hij_say(W, "rv_kapi")
                        break                                          # T9b (B): ücret ödeyecek kasa yok, ilan açılmaz (köprü kredisi yukarıda alımdan önce çekildi). capitalized=False: işletme sermayesini şehir hafta sonunda tamamlar (altyapı/kamu hizmeti, geçiş desteği), kasa şartı aranmaz
                    q = take_worker(f)
                    if q is None:
                        if rv_:
                            hij_say(W, "rv_havuz")
                        break
                    cur.append(q)
                    if KR_MEAS:
                        lab_ev(W, "ise", f)                          # davranışsız sayaç (§4.6)
                    people[q]["firm"] = f
                    people[q]["avans"] = True
                    hij_say(W, "ise", q)                          # hijyen ölçümü (davranışsız)
                    if HIRE_WAGE_REAL:
                        people[q]["wage"] = kadro_ucreti(W, people[q]["tier"], d["kind"], d["city"], people[q]["who"] == "npc")      # M7: alım anında ilan ücreti (sermaye ve avans bununla boyutlanır; NPC ve insan aynı)
                    if FIRE_ORDER == 1:
                        people[q]["hired"] = week_no
                    if week_no > 1:
                        hst["ise_alinan_" + ("npc" if people[q]["who"] == "npc" else "oyuncu")] += 1
                        if src[0] in ("seeker", "npc"):
                            hst["ise_giren_issiz"] += 1                  # D10 (F): işsizlikten (iş arayan oyuncu / havuz NPC'si) işe giren
                        if src[0] in ("ahir", "belediye"):
                            hst[src[0] + "_gecis"] += 1
                    else:
                        hst["acilis_kadrosu"] += 1                         # D7: 1. haftanın açılış kadrosu (gösterge; işe alım akışına girmez)
            finally:
                if hid_ is not None:
                    human_unhide(W, c, hid_)
            ghost_step(W, f, d, c, hst)                               # D11 (D2): hayalet firma sayımı ve (GHOST_MODE=2) kapanış
    muni = firms[f"s{ci}_belediye0"]
    target_m = int((MUNI_SPEND * max(0.0, L.bal[c["acct"]]) + (tr_muni(W, ci) if TREASURY_RULE else 0.0)) / (CYCLES_PER_WEEK * TIER_WAGE[0]))   # K-112: kamu harcaması bütçeyle sınırlı
    if HUMAN_ON:
        W.staff_tgt[f"s{ci}_belediye0"] = target_m             # davranışsız kayıt: belediye ilan verir (human.gozlem ilanlar); KR_MEAS sütunları kamu türünü saymaz
    if CITY_BUDGET_RULE:
        room_ = city_wage_room(W, ci)                      # M11.2 (5): belediye is garantisi ucreti de butce kuralina tabi: yeni kadro yalniz surdurulebilir gelir - mevcut zorunlu yuk marjina sigdigi kadar (mevcut kadro isten cikarilmaz)
        if room_ < float("inf"):
            w_new_ = TIER_WAGE[0] * W.WI[ci] * (KIND_WM.get("belediye", 1.0) if SVC_KINDS else 1.0) * max(1.0, JG_WAGE)
            target_m = min(target_m, len(muni["workers"]) + max(0, int(room_ / (CYCLES_PER_WEEK * w_new_))))
    while len(muni["workers"]) > target_m:
        q = next((x for x in reversed(muni["workers"]) if people[x]["who"] == "npc"), None) if MUNI_POOL == 1 else None      # D10 (B6): daralmada önce son NPC çıkar, oyuncu kalır
        if q is None:
            q = muni["workers"].pop()
        else:
            muni["workers"].remove(q)
        if KR_MEAS:
            lab_ev(W, "cikis_belediye", f"s{ci}_belediye0")      # davranışsız sayaç (§4.6)
        people[q]["firm"] = None
        if HUMAN_ON:
            human_cikis(W, q, "kucultme")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
        (c["pool"] if people[q]["who"] == "npc" else c["seekers"]).append(q)      # D10 (B6): havuzdan alınan NPC havuza döner (varsayılanda belediyede yalnız oyuncu var)
    hid_ = human_hide(W, c, f"s{ci}_belediye0", len(muni["workers"]) < target_m) if HUMAN_ON else None       # DAO oyunu: insan yalnız belediyeye başvurduysa (açık kadro varsa) görünür
    try:
        while len(muni["workers"]) < target_m and c["seekers"]:
            q = c["seekers"].pop(0)
            muni["workers"].append(q)
            if KR_MEAS:
                lab_ev(W, "ise", f"s{ci}_belediye0")                 # davranışsız sayaç (§4.6)
            people[q]["firm"] = f"s{ci}_belediye0"
            if week_no > 1:
                hst["ise_giren_issiz"] += 1                       # son inceleme I2: belediyeye giren iş arayan oyuncu da işten işe girmiştir (gösterge)
        if MUNI_POOL == 1:
            while c["seekers"] and muni["workers"] and len(muni["workers"]) >= target_m > 0:       # D10 (B6, M1): belediye doluyken iş arayan oyuncu, içinde NPC varsa onun yerine girer (oyuncular önce)
                out_ = next((x for x in reversed(muni["workers"]) if people[x]["who"] == "npc"), None)
                if out_ is None:
                    break
                muni["workers"].remove(out_)
                people[out_]["firm"] = None
                c["pool"].append(out_)
                q = c["seekers"].pop(0)
                muni["workers"].append(q)
                if KR_MEAS:
                    lab_ev(W, "cikis_belediye", f"s{ci}_belediye0")     # davranışsız sayaç: NPC tahliyesi + oyuncu girişi
                    lab_ev(W, "ise", f"s{ci}_belediye0")
                people[q]["firm"] = f"s{ci}_belediye0"
                hst["kamu_npc_tahliye"] += 1
                if week_no > 1:
                    hst["ise_giren_issiz"] += 1                   # son inceleme I2: yerine giren iş arayan oyuncu
    finally:
        if hid_ is not None:
            human_unhide(W, c, hid_)
    if MUNI_POOL == 1 and len(muni["workers"]) < target_m and c["pool"]:
        n_jg = sum(1 for q in muni["workers"] if people[q]["who"] == "npc")
        cap_jg = int(JG_MAX * npc_population(W, ci) + 1e-9)
        while len(muni["workers"]) < target_m and c["pool"] and n_jg < cap_jg:
            q = c["pool"].pop(0)                                      # D10 (B6): iş arayan oyuncular bittikten sonra havuzdaki işsiz NPC kamu işine girer
            muni["workers"].append(q)
            if KR_MEAS:
                lab_ev(W, "ise", f"s{ci}_belediye0")             # davranışsız sayaç (§4.6)
            people[q]["firm"] = f"s{ci}_belediye0"
            people[q]["wage"] = round(TIER_WAGE[0] * W.WI[ci] * (KIND_WM.get("belediye", 1.0) if SVC_KINDS else 1.0) * JG_WAGE, 3)      # haftalık ücret güncellemesiyle aynı formül (girdiği hafta da geçerli)
            n_jg += 1
            hst["kamu_npc_alinan"] += 1
            if week_no > 1:
                hst["ise_giren_issiz"] += 1                   # son inceleme I2: havuzdan kamu işine giren NPC
    for a in ahirs:                                                   # K-111: ahır sürü bakımı eksikse NPC havuzundan tamamlanır
        while len(firms[a]["workers"]) < AHIR_HERD_WORKERS and c["pool"]:
            q = c["pool"].pop(0)
            firms[a]["workers"].append(q)
            if KR_MEAS:
                lab_ev(W, "ise", a)                              # davranışsız sayaç (§4.6)
            people[q]["firm"] = a
            people[q]["avans"] = True
            if week_no > 1:
                hst["ise_giren_issiz"] += 1                   # son inceleme I2: sürü tamamlamak için havuzdan ahıra giren NPC
    for f in c["firms"]:
        d = firms[f]
        if d["owner"] is not None or d["kind"] == "belediye":
            continue
        wc = working_capital(W, firms, people, f)
        if d.get("dead"):
            continue
        if d.get("acilis_tampon") and not NPC_RESERVE_KEEP:
            d["acilis_tampon"] = min(d["acilis_tampon"], max(0.0, L.bal[f]))      # M11 K1: açılış kasası özkaynaktır (kâr değil): ücret ödendikçe kasa düşer, tampon kasaya iner; yalnız tamponun ÜSTÜNDEKİ fazla kâr olarak süpürülür
        if NPC_RES_REL and NPC_RESERVE_KEEP and d.get("acilis_tampon") and not d.get("priv") and not d.get("org_owner"):
            d["acilis_tampon"] = min(d["acilis_tampon"], max(res_target(W, f, d), d["acilis_tampon"] * (1.0 - RES_REL_RATE)))      # te-denge G3: fazla açılış rezervi haftada RES_REL_RATE oranında hedefe iner; YALNIZ AŞAĞI (min: hedef tamponun üstündeyse tampon yükselmez, params yorumundaki 'eksiği de yaklaşır' uygulanmaz); özelleştirilmiş ve medya firmalarında uygulanmaz (rezerv şehre dönmez, sahibe temettü olurdu); fazlası aşağıdaki mevcut süpürmeyle npc_kar olur
        if NO_BAILOUT:
            d["prof"] = 0.8 * d.get("prof", 0.0) + 0.2 * (L.bal[f] - d.get("bal_post", L.bal[f]))      # K-185.2: haftalık işletme nakit akışı (süpürme ve avans öncesi)
        if SOLE_KEEP and d.get("sole"):
            d.pop("wfail_w", None)                                   # te-denge G6: ücret ödeyememe izi silinir (firma yeniden ilan açabilsin)
            hedef_ = max(working_capital(W, firms, people, f, max(0, SOLE_STAFF - len(d["workers"]))), HIRE_WEEK_CYCLES * (SOLE_STAFF * TIER_WAGE[0] * W.WI[ci] + RENT))
            ode_ = [x_ for x_ in d.get("sole_ode", ()) if week_no - x_[0] < 4]
            tav_ = SOLE_CAP_WEEKS * SOLE_STAFF * CYCLES_PER_WEEK * TIER_WAGE[0] * W.WI[ci] - sum(x_[1] for x_ in ode_)
            want_ = max(0.0, min(hedef_ - L.bal[f], tav_, L.bal[c["acct"]] - L.mand.get(c["acct"], 0.0)))      # her hafta tamamlanır; 4 hf tavanı bağlar; YALNIZ şehrin eldeki kasasından ve geçen haftanın (sönümlü) zorunlu gideri kadar pay bırakarak (yeni tahvil çıkmaz)
            paid_ = L.pay(c["acct"], f, want_, "altyapi_hizmet_sozlesmesi")
            ode_.append((week_no, paid_))
            d["sole_ode"] = ode_
            d["capitalized"] = True
            if L.bal[f] < hedef_ - 1e-9:
                continue                                         # eksik tamamlanıyor: bu hafta süpürme yok; kasa hedefin üstündeyse olağan yol (süpürme, fon iadesi, kredi geri ödemesi)
        if not d["capitalized"]:
            if d.pop("tsup2", False):
                gap_ = max(0.0, wc - L.bal[f])
                miss_ = trans_grant(W, ci, f, d, c, gap_) <= 1e-9 and gap_ > 1e-9
                if miss_:
                    d["insolv"] = d.get("insolv", 0) + 1             # K-211 v2: destek tavan/kasa tabanı yüzünden verilemedi: ödeme gücü sayacı işler (gelecek haftaki dalda ölüm)
                if GHOST_MODE == 1 and ghost_support(W, f, d, c, not miss_):
                    continue                                          # D11 (D2): destek GHOST_WEEKS hafta üst üste gelmedi: işletme battı
            else:
                want_ = max(0.0, wc - L.bal[f])
                kind_ = "altyapi_hizmet_sozlesmesi" if (PRIV_ON and week_no > NPC_GRACE and d["kind"] in NPC_EXEMPT) else "npc_kurulus_sermayesi"
                paid_ = L.pay(c["acct"], f, want_, kind_)      # K-185.17: altyapı hizmet sözleşmesi şeffaf kalem (yalnız şehir gelirinden)
                if CITY_BUDGET_RULE and kind_ in CB_KINDS and paid_ < want_ - 1e-6 and L.cb is not None:
                    continue                                          # M11.2 (5): sozlesme butce kesintisiyle eksik odendi: sermayeli sayilmaz, kalan sonraki haftalarda tamamlanir (odenen pay firma kasasinda kalir)
            d["capitalized"] = True
        elif L.bal[f] > wc * (1.0 if (TRANS_SUPPORT == 2 and d.get("fon", 0.0) > 1e-9) else ((PK_MULT if PROFIT_KEEP else NPC_KEEP) if (NO_BAILOUT and week_no > SWEEP_FROM and d["kind"] not in NPC_EXEMPT) else 1.0)) + (d.get("capex_cash", 0.0) if CAPEX_ON else 0.0) + (d.get("renew_res", 0.0) if RENEW_SOFT else 0.0) + d.get("acilis_tampon", 0.0) + d.get("house_fund", 0.0):
            if NO_BAILOUT and week_no > SWEEP_FROM and d["kind"] not in NPC_EXEMPT and not (TRANS_SUPPORT == 2 and d.get("fon", 0.0) > 1e-9):
                wc = wc * (PK_MULT if PROFIT_KEEP else NPC_KEEP)      # K-220: PROFIT_KEEP açıkken tampon PK_WEEKS haftalık gider; K-185.2: NPC firma kârını tamponuna (NPC_KEEP × işletme sermayesi) kadar tutar; fazlası şehre (K-211 v2: fon borcu olan firmada tam süpürme)
            wc = wc + d.get("acilis_tampon", 0.0)               # M11 K1: açılış kasası (devreden kazanç) şehre süpürülmez; bayrak 0'da alan yok: +0.0
            wc = wc + d.get("house_fund", 0.0)                  # G12b BUILD_DEV: konut işi için ayrılmış malzeme bütçesi şehre süpürülmez; bayrak 0'da alan yok: +0.0
            if CAPEX_ON:
                wc = wc + d.get("capex_cash", 0.0)              # K-185.7: planlı yatırım için ayrılan nakit şehre süpürülmez
                if RENEW_SOFT:
                    wc = wc + d.get("renew_res", 0.0)           # K-185.17: yenileme fonu firmada kalır (sanal), süpürülmez
            if REVIVE_HYGIENE and d["workers"]:
                wc = max(wc, HIRE_WEEK_CYCLES * (sum(people[q_]["wage"] for q_ in d["workers"]) + RENT))      # hijyen: tampon/capex/yenileme kalemleriyle TOPLANMAZ, max alinir (acilis tamponu zaten ucret icin harcanabilir; ikisini yigmak kasayi iki kez baglar). Kâr/kredi süpürmesi kadronun bir haftalık ücretini (işe alım kapısının gördüğü kasa) şehre/loncaya çekmez; aksi halde alımdan hemen sonra süpürülür, ücret ödenemez
            if SOLE_KEEP and d.get("sole"):
                wc = max(wc, hedef_)                             # te-denge G6: süpürme tabanı sole hedefinin altına inmez (ertesi hafta yeniden fonlama döngüsü olmasın)
            if MO_ACT and d["kind"] == "medya":
                mprof[f] = 0.9 * mprof[f] + 0.1 * (L.bal[f] - wc)
                og_ = d.get("org_owner")
                if og_ is not None and og_[0] == "dao" and firms[og_[1]].get("dead"):
                    d["org_owner"] = og_ = None
                if og_ is not None:
                    pr_ = L.pay(f, og_[1], L.bal[f] - wc, "medya_kar_cekimi")
                    media_stat["kar_" + og_[1]] += pr_
                    ad_w[og_[1]] += MEDIA_AD_CREDIT * pr_
                    continue
            if TRANS_SUPPORT == 2 and d.get("fon", 0.0) > 1e-9 and L.bal[f] - wc > 1e-9:
                fr_ = L.pay(f, c["acct"], min(L.bal[f] - wc, d["fon"]), "npc_kar")      # K-211 v2: kâr önce fona döner (kredi geri ödemesinden ve tamponlardan önce)
                trans_return(W, f, d, fr_)
            if NO_BAILOUT and NPC_LONCA_FUND and f in loans and loans[f].get("tur") in ("npc", "ozellestirme"):
                rep_ = min(L.bal[f] - wc, loans[f]["out"])
                if rep_ > 1e-9:
                    L.pay(f, f"{loans[f]['lo']}_sermaye", rep_, "kredi_geri")
                    loans[f]["out"] -= rep_
                    if loans[f]["out"] <= 1e-6:
                        del loans[f]
            if L.bal[f] - wc > 1e-9:
                pv_ = d.get("priv")
                if pv_ and pv_["tip"] == "oyuncu" and pv_["who"] in people:
                    ex_ = corp_tax_pay(L, f, c["acct"], L.bal[f] - wc)      # K-188: kâr dağıtımından önce
                    pd_ = pay_owner_dividend(L, f, c["acct"], pv_["who"], ex_)
                    priv_stat["temettu_oyuncu"] += pd_
                elif pv_ and pv_["tip"] == "lonca" and pv_["who"] not in closed:
                    if CORP_TAX > 0:
                        corp_tax_pay(L, f, c["acct"], L.bal[f] - wc)      # K-188 (referans uygulamadaki gibi: kalan bakiye loncaya akar)
                    priv_stat["kar_lonca"] += L.pay(f, f"{pv_['who']}_sermaye", L.bal[f] - wc, "ozellestirme_kar_payi")
                elif PROFIT_KEEP and NO_BAILOUT and week_no > SWEEP_FROM and d["kind"] not in NPC_EXEMPT and not (TRANS_SUPPORT == 2 and d.get("fon", 0.0) > 1e-9):
                    pk_div(W, ci, f, d, L.bal[f] - wc)              # K-220: fazla şehre süpürülmez; vergi sonrası hanelere temettü
                else:
                    pk_ = L.pay(f, c["acct"], L.bal[f] - wc, "npc_kar")
                    if TRANS_SUPPORT:
                        trans_return(W, f, d, pk_)                  # K-211: fon izi: kâr süpürmesi fon borcunu geri öder
    if PROFIT_KEEP:
        pk_distribute(W, ci)                                    # K-220: şehir temettü havuzu NPC hanelerine
    if NO_BAILOUT:
        for f in c["firms"]:
            if firms[f]["owner"] is None and not firms[f].get("dead"):
                firms[f]["bal_post"] = L.bal[f]
    if week_no == 1 and START_STOCK_WEEKS > 0:
        start_stock(W, ci)                                            # D7 (A6): açılış girdi stoku (varsayılan kapalı)
    return need_units


def reputation(W, ci):
    HEALTH_ON = W.HEALTH_ON
    cities = W.cities
    firms = W.firms
    green = W.green
    h_lvl = W.h_lvl
    media_w = W.media_w
    TOPO = W.TOPO
    c = cities[ci]
    unpaid = c["unpaid_w"] / max(1, c["unpaid_w"] + c["paid_w"])
    miss = 1 - c["got_units"] / max(1e-9, c["dem_units"])
    imp_dep = c["imp_val"] / max(1.0, c["cons_val"])
    kinds = {firms[f]["kind"] for f in c["firms"] if firms[f]["workers"] and firms[f]["kind"] not in ("market", "medya", "belediye", "arge")}
    promo = min(1.0, media_w[ci] / max(1.0, MEDIA_SAT * len(c["players"]) * CYCLES_PER_WEEK)) if TOUR_ON else 0.0       # K-138: şehir tanıtımı
    return (HEALTH_REP * h_lvl[ci] if HEALTH_ON else 0.0) + max(0.0, 100 - 50 * unpaid - 30 * miss - 20 * min(1.0, imp_dep) + 20 * len(kinds) / len(TOPO) + GREEN_REP * green[0] + PROMO_REP * promo + MODA_REP * min(1.0, sum(len(firms[f]["workers"]) for f in c["firms"] if firms[f]["kind"] == "moda") / MODA_SAT) + SEC_REP * c.get("sec", 1.0) * (1 if TRANS_ON else 0))


def mgr_step(W, w):
    """Yönetici (n >= MGR_MIN) ve uzman (teknoloji yoğun, n >= SPEC_MIN): kıdem + itibar eşikli; önce firmanın kendi çalışanından, yoksa iş arayandan."""
    L = W.L
    MWI = W.MWI
    REP = W.REP
    cities = W.cities
    firms = W.firms
    mgr_stat = W.mgr_stat
    people = W.people
    role_list = W.role_list
    if not MGR_ACT:
        return
    unfilled = filled = 0
    for f, d in firms.items():
        if d.get("dead") or d["kind"] in ("ahir", "belediye", "arge", "lojistik") or not d["workers"]:
            continue
        n = len(d["workers"])
        ci = d["city"]
        need = {"yonetici": ((n - 1) // MGR_SPAN + 1) if n >= MGR_MIN else 0,
                "uzman": ((n - 1) // SPEC_SPAN + 1) if (n >= SPEC_MIN and d["kind"] in SPEC_KINDS) else 0}
        gain = 1.0
        for kind in ("yonetici", "uzman"):
            have = [q for q in d["workers"] if isrole(people[q]) and people[q].get("role") == kind]
            while len(have) > need[kind]:
                q = min(have, key=lambda x: REP[x])
                have.remove(q)
                people[q].pop("role", None)
                people[q].pop("rolefirm", None)
            while len(have) < need[kind]:
                cands = [q for q in d["workers"] if people[q]["who"] == "oyuncu" and q != d["owner"] and not isrole(people[q]) and not isres(people[q]) and role_ok(W, q, kind) and not (HUMAN_ON and q == W.human)]      # DAO oyunu: insan kendiliğinden yönetici/uzman olmaz
                if not cands and len(d["workers"]) < d["capacity"] and (not HIRE_GATE_ALL or hire_cash_secure(W, f)):      # M11 O2: rol alımı da aynı ilan kapısından geçer
                    sk = [q for q in cities[ci]["seekers"] if role_ok(W, q, kind) and not (HUMAN_ON and (q == W.human or human_blocked(W, q, f)))]
                    if sk:
                        q = max(sk, key=lambda x: (people[x].get("innov", False), REP[x]))
                        cities[ci]["seekers"].remove(q)
                        d["workers"].append(q)
                        if KR_MEAS:
                            lab_ev(W, "ise", f)                  # davranışsız sayaç (§4.6)
                        people[q].update(firm=f, avans=True)
                        hij_say(W, "ise", q)
                        cands = [q]
                if not cands:
                    break
                q = max(cands, key=lambda x: (people[x].get("innov", False) if kind == "uzman" else False, REP[x]))
                people[q].update(role=kind, rolefirm=f, wage=role_wage(W, kind, ci))
                have.append(q)
                L.flows[kind + "_atama_adet"] += 1
            if need[kind]:
                frac = len(have) / need[kind]
                gain *= 1.0 + (MGR_GAIN if kind == "yonetici" else SPEC_GAIN) * min(1.0, frac)
                filled += len(have)
                unfilled += need[kind] - len(have)
        if gain > 1.0:
            d["mgr_mult"] = gain
        else:
            d.pop("mgr_mult", None)
    role_list[:] = [q for q, i_ in people.items() if i_["who"] == "oyuncu" and i_.get("rolefirm") is not None]
    if unfilled > 0:
        MWI[0] = min(MWI_MAX, MWI[0] * (1 + MWI_STEP))
    else:
        MWI[0] = max(MWI_MIN, MWI[0] * (1 - MWI_STEP))
    mgr_stat.append((w, filled, unfilled, MWI[0]))
