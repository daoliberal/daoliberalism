"""simkit.week_open: hafta açılışı fazları: defter kancası, politika, fiyat adımı, ücret ayarı.

ARAYÜZ: phase_begin_week, phase_policy, phase_prices, phase_wages, week_diag_dumps (SCDUMP/CDUMP ölçüm; davranışsız)
OKUR/YAZAR: W (hafta durumu; yerel geçici adlar `W.ad`).
KATMAN: L7 (orkestrasyon; alan modüllerine bağlı).
"""
import os
from collections import defaultdict
from functools import partial
from simkit.params import *          # noqa: F401,F403
from simkit.trace import trace
from simkit.credit_core import lendable, lo_classes, lo_credit
from simkit.econ_core import isres, isrole, ulc_base
from simkit.human import human_week_open
from simkit.labor import staffing
from simkit.policy import bond_hook, pol_step
from simkit.rate_behav import rb_update
from simkit.prices import root_cause, update_prices
from simkit.pricing_step import fp_step
from simkit.tech import tech_update
from simkit.wages import kadro_ucreti, res_wage, role_wage


def week_diag_dumps(W, w):
    """tur 11/17 teşhis dökümleri (yalnız ölçüm; davranışsız): SCDUMP (ölçek tanısı, <csv>.sc), CDUMP (kapasite cırcırı, <csv>.cd). WEEKLY_CSV gerekir."""
    if not WEEKLY_CSV:
        return
    L = W.L
    PM = W.PM
    PRICE = W.PRICE
    REF = W.REF
    cities = W.cities
    firms = W.firms
    freight_cap = W.freight_cap
    last_root_short = W.last_root_short
    last_short = W.last_short
    prod_last = W.prod_last
    want_last = W.want_last
    if WEEKLY_CSV and os.environ.get("SCDUMP") and w % 10 == 0:     # tur 17: ölçek tanısı (yalnız teşhis; davranışı etkilemez)
        with open(WEEKLY_CSV + ".sc", "a") as _sc:
            for ci_ in range(len(cities)):
                need_, _nu = staffing(W, ci_)
                by_ = defaultdict(list)
                for f_ in cities[ci_]["firms"]:
                    d_ = firms[f_]
                    if d_["kind"] in ("ahir", "belediye"):
                        continue
                    by_[d_["kind"]].append(f_)
                for k_, fl_ in by_.items():
                    npc_ = [f_ for f_ in fl_ if firms[f_]["owner"] is None]
                    live_ = [f_ for f_ in npc_ if not firms[f_].get("dead")]
                    _sc.write(f"{w},{ci_},{k_},{len(npc_)},{len(live_)},{len(fl_) - len(npc_)},{need_.get(k_, 0.0):.2f},{sum(len(firms[f_]['workers']) for f_ in live_)},{sum(firms[f_]['capacity'] for f_ in live_)},{sum(L.bal[f_] for f_ in live_):.0f},{sum(firms[f_].get('prof', 0.0) for f_ in live_):.0f}\n")
    if WEEKLY_CSV and os.environ.get("CDUMP"):                  # tur 11: kapasite cırcırı ölçümü (yalnız teşhis; davranışı etkilemez)
        with open(WEEKLY_CSV + ".cd", "a") as _cd:
            for p_ in sorted(q_ for q_ in (set(want_last) | set(prod_last)) if isinstance(q_, str)):
                k_ = PRODUCER.get(p_)
                fs_ = [d_ for d_ in firms.values() if d_["kind"] == k_ and not d_.get("dead")] if k_ else []
                _cd.write(f"{w},{p_},{k_},{want_last.get(p_, 0.0):.0f},{prod_last.get(p_, 0.0):.0f},{last_short.get(p_, 0.0):.0f},{last_root_short.get(p_, 0.0):.0f},{len(fs_)},{sum(len(d_['workers']) for d_ in fs_)},{sum(d_['capacity'] for d_ in fs_)},{sum(1 for d_ in fs_ if not d_['workers'])},{sum(PM.get((ci_, p_), 1.0) for ci_ in range(len(cities))) / len(cities):.2f},{sum(PRICE.get((ci_, p_), 0.0) for ci_ in range(len(cities))) / len(cities) / max(1e-9, REF.get(p_, 1.0)):.2f}\n")
            _cd.write(f"{w},_LOJ,lojistik,{sum(c_['freight_want_w'] for c_ in cities):.0f},{sum(c_['freight_w'] for c_ in cities):.0f},{sum(freight_cap.values()):.0f},{sum(c_['freight_prev'] for c_ in cities):.0f},{sum(1 for d_ in firms.values() if d_['kind'] == 'lojistik' and not d_.get('dead'))},{sum(len(d_['workers']) for d_ in firms.values() if d_['kind'] == 'lojistik' and not d_.get('dead'))},0,0,0,0\n")


def phase_begin_week(W, w):
    """haftanın açılışı: sayaçlar, başlangıç bakiyesi, defter hafta kancası."""
    L = W.L
    w_ctx = W.w_ctx
    NOW = W.NOW
    W.w = w      # yayın (adım 6): taşınan işlevler okur
    week_no = w
    W.week_no = week_no      # yayın (adım 6): taşınan işlevler okur
    w_ctx[0] = w
    NOW[0] = w
    L.begin_week(w)
    W.start_bal = dict(L.bal)
    L.income.clear()
    W.start_minted = L.minted
    if W.cm is not None:                        # K-218: kredi parası haftalık kanca (fren, senkron)
        W.cm.begin_week(w)
    if LONCA_INSOLV_CLOSE:                      # PLAN-KREDI T6: batık (öz kaynak < 0) lonca kümesi; tahvil havuzu süzgeci bu haftaki ihraçlarda okur
        W.lo_insolv = set(lo_classes(W)[1])
    if HUMAN_ON:
        human_week_open(W, w)                   # DAO oyunu: olay listesini boşalt, bekleyen insan kararlarını uygula


def phase_policy(W, w):
    """politika: şehir geliri sönümü, kurtarma tavanı/para basım tavanı (K-185)."""
    BOND_ON = W.BOND_ON
    L = W.L
    cities = W.cities
    city_ref = W.city_ref
    city_rev = W.city_rev
    lo_loss = W.lo_loss
    for c_ in cities:                                        # K-185.4: sönümlü haftalık şehir geliri (önceki haftanın girişleri)
        a_ = c_["acct"]
        city_rev[a_] = L.inflow[a_] if w <= 2 else 0.9 * city_rev[a_] + 0.1 * L.inflow[a_]
        city_ref[a_] = max(city_rev[a_], BOND_REV_DECAY * city_ref[a_])
        L.inflow[a_] = 0.0
    for l_ in list(lo_loss):
        lo_loss[l_] *= 0.98
    pol_step(W, w)
    if RATE_BEHAV:
        rb_update(W, w)                                      # faiz davranışı: sinyal güncellemesi (kısmi uyum)
    if NO_BAILOUT and w > NPC_GRACE:                           # K-185.2: havuzdaki işsiz NPC'nin atıl nakdi şehir kasasına vergi olarak döner (yoksa talepten kaçar)
        for c_ in cities:
            for q_ in c_["pool"]:
                ex_ = L.bal[q_] - NPC_POOL_FLOOR * TIER_WAGE[0] * CYCLES_PER_WEEK
                if ex_ > 1e-9:
                    L.pay(q_, c_["acct"], NPC_POOL_TAX * ex_, "npc_havuz_vergisi")
    if MONEY_CAP and w > MINT_OPEN_WEEKS:                    # K-185.1: basım tavanı: açılış sonrası haftalık izin = yıllık oran / 52 × para arzı (kümülatif)
        L.cap_on = True
        if BOND_ON:
            L.bond_hook = partial(bond_hook, W)
            L.bond_first = BOND_FIRST
        sup_ = L.total()
        for c_ in cities:
            L.allow[c_["acct"]] += MINT_YEAR / 52.0 * sup_ / len(cities)
        W.mint_allow_tot += MINT_YEAR / 52.0 * sup_


def phase_prices(W, w):
    """hafta başı eksik özeti, fiyat güncelleme ve firma fiyatı adımı."""
    FPA = W.FPA
    L = W.L
    V2S = W.V2S
    bonds = W.bonds
    dep_tot = W.dep_tot
    firms = W.firms
    loncas = W.loncas
    people = W.people
    prod_w = W.prod_w
    rev_lb = W.rev_lb
    rev_lc = W.rev_lc
    short_units = W.short_units
    short_val = W.short_val
    want_units = W.want_units
    LOG_MULT = W.LOG_MULT
    MM_BASE = W.MM_BASE
    TAXV = W.TAXV
    W.ev0 = len(L.events)
    W.last_short, last_short_val = dict(short_units), dict(short_val)
    if DBG_EVERY and w % DBG_EVERY == 0:
        grp_ = defaultdict(float)
        for a_, b_ in L.bal.items():
            grp_["firma" if a_ in firms else ("oyuncu" if (a_ in people and people[a_]["who"] == "oyuncu") else ("npcki" if a_ in people else ("sehir" if a_ in L.city_accounts else "diger")))] += b_
        trace(W, f"[W{w}] KDV {TAXV[0]:.3f} MM {W.MARKET_MARKUP / MM_BASE[0]:.2f} LOG {LOG_MULT[0]:.2f} para " + " ".join(f"{k_}:{v_:.0f}" for k_, v_ in sorted(grp_.items())) + f" bono {sum(b_['out'] for b_ in bonds):.0f} npcfirma {sum(1 for d_ in firms.values() if d_['owner'] is None and not d_.get('dead') and d_['workers'])} oyfirma {sum(1 for d_ in firms.values() if d_['owner'] is not None and not d_.get('dead') and d_['workers'])}")
    if DBG_FIRMS and w % max(1, DBG_EVERY or 1) == 0:
        for f_ in DBG_FIRMS.split("+"):
            d_ = firms.get(f_)
            if d_:
                s_ = V2S.get(f_, {})
                trace(W, f"[F{w}] {f_} dead={d_.get('dead')} w={len(d_['workers'])} bal={L.bal[f_]:.0f} fp={FPA.get(f_, 0):.3f} uc={(s_['cF'] / s_['u'] if s_.get('u') else 0):.3f} prodEMA={s_.get('u', 0):.0f} priv={bool(d_.get('priv'))} insolv={d_.get('insolv')} prof={d_.get('prof', 0):.0f}")
    if DBG_CREDIT and w in DBG_CREDIT:
        trace(W, f"[CR hf{w}] " + " | ".join(f"{l_}: nakit {L.bal[f'{l_}_sermaye']:.0f} mev {dep_tot[l_]:.0f} kredi {lo_credit(W, l_):.0f} tahvil {sum(b_['out'] for b_ in bonds if b_['lo'] == l_):.0f} lend {lendable(W, l_):.0f}" for l_ in loncas[:6]))
    last_root_short = root_cause(W, W.last_short)
    W.last_root_short = last_root_short      # yayın (adım 6): taşınan işlevler okur
    W.last_root_short_val = {p: last_short_val[p] for p in last_root_short}
    if ARGE_ON:
        for k_ in list(rev_lb):
            rev_lb[k_] *= 0.9
        for k_ in list(rev_lc):
            rev_lc[k_] *= 0.9
        tech_update(W)
    update_prices(W, W.last_short)
    fp_step(W, w, W.last_short)
    W.prod_last = dict(prod_w)
    W.want_last = dict(want_units)
    week_diag_dumps(W, w)                    # PX: SCDUMP/CDUMP (WEEKLY_CSV açıkken; davranışsız)


def phase_wages(W, w):
    """hafta başı ücret ayarı, firma bütçesi, haftalık sayaç sıfırlama."""
    EDU_ON = W.EDU_ON
    NLAB_ON = W.NLAB_ON
    REP = W.REP
    WELF_ON = W.WELF_ON
    cities = W.cities
    edu_lvl = W.edu_lvl
    firms = W.firms
    own_p = W.own_p
    own_u = W.own_u
    people = W.people
    prod_w = W.prod_w
    short_units = W.short_units
    short_val = W.short_val
    skillw = W.skillw
    unsold_w = W.unsold_w
    want_units = W.want_units
    LAND = W.LAND
    REF = W.REF
    WI = W.WI
    if w > 1:                                                # K-116: ücret endeksi geçim endeksini izler (indeksleme, gecikmeli)
        base_b = sum(REF[p] * q for p, q in BASKET.items())
        for ci in range(len(cities)):
            cpi = sum(LAND[(ci, p)] * q for p, q in BASKET.items()) / base_b / (cities[ci].get("ulc", ulc_base()) / ulc_base() if SKILL_ON else 1.0)     # K-150: tecrübe primi enflasyon değildir; ücret endeksi bunu ayıklanmış fiyat düzeyini izler (aksi halde fiyat-ücret sarmalı)
            lab_ = 0.0
            if NLAB_ON:
                unemp_ = len(cities[ci]["seekers"]) / max(1.0, len(cities[ci]["players"]))
                if WAGE_U_ALL == 1:                                              # D10 (B4): işgücündeki işsiz NPC de görünür: (iş arayan oyuncu + havuz NPC) / (oyuncu + işgücündeki NPC)
                    npc_emp_ = sum(1 for f_ in cities[ci]["firms"] for q_ in firms[f_]["workers"] if people[q_]["who"] == "npc")
                    unemp_ = (len(cities[ci]["seekers"]) + len(cities[ci]["pool"])) / max(1.0, len(cities[ci]["players"]) + npc_emp_ + len(cities[ci]["pool"]))
                lab_ = LAB_K * 0.1 * (LAB_U_STAR - unemp_)                      # işgücü kıtlığı (işsizlik doğal düzeyin altı) ücreti yükseltir; bolluk yapışkan biçimde yavaş düşürür
                lab_ = lab_ if lab_ > 0 else lab_ * LAB_DOWN
            WI[ci] = min(WAGE_MAX, max(WAGE_MIN, WI[ci] + WAGE_CATCHUP * (1 + WAGE_PASS * (cpi - 1) - WI[ci]) + lab_))
        if SKILL_ON:                                             # K-148/K-150: tecrübe basamağı, kontenjanlı terfi (usta/kalfa kadroları sınırlı: NPC dağılımı %60/30/10 ile uyumlu)
            pl_ = sorted((q for q, i_ in people.items() if i_["who"] == "oyuncu"), key=lambda q: -skillw[q] * ((1 + REP_PROMO * REP[q] / 100) if (INNOV_ON and REP_EFFECT) else 1))
            n_pl = len(pl_)
            n_u = sum(1 for q in pl_ if people[q]["tier"] == 2)
            n_k = sum(1 for q in pl_ if people[q]["tier"] == 1)
            for q in pl_:
                wk_ = skillw[q] / CYCLES_PER_WEEK * (1.0 + (EDU_SPEED[edu_lvl[q]] if EDU_ON else 0.0))
                if PROMO_FREE:                                   # M2.2: kontenjan ve sıralama yok; terfi yalnız kişinin kendi birikimine (tecrübe haftası, itibar) bağlı, herkese aynı kural
                    if INNOV_ON and isres(people[q]):
                        continue
                    if people[q]["tier"] < 2 and wk_ >= USTA_WEEKS and not (INNOV_ON and REP_EFFECT and REP[q] < REP_USTA):
                        people[q]["tier"] = 2
                    elif people[q]["tier"] < 1 and wk_ >= KALFA_WEEKS and not (INNOV_ON and REP_EFFECT and REP[q] < REP_KALFA):
                        people[q]["tier"] = 1
                    continue
                if people[q]["tier"] < 2 and wk_ >= USTA_WEEKS and n_u < USTA_SHARE * n_pl and not (INNOV_ON and (isres(people[q]) or (REP_EFFECT and REP[q] < REP_USTA))):
                    n_k -= people[q]["tier"] == 1
                    people[q]["tier"] = 2
                    n_u += 1
            if not PROMO_FREE:
                for q in pl_:
                    wk_ = skillw[q] / CYCLES_PER_WEEK * (1.0 + (EDU_SPEED[edu_lvl[q]] if EDU_ON else 0.0))
                    if people[q]["tier"] < 1 and wk_ >= KALFA_WEEKS and n_k < KALFA_SHARE * n_pl and not (INNOV_ON and (isres(people[q]) or (REP_EFFECT and REP[q] < REP_KALFA))):
                        people[q]["tier"] = 1
                        n_k += 1
        for q, info in people.items():
            fcity = firms[info["firm"]]["city"] if info["firm"] else info["city"]
            info["wage"] = res_wage(W, fcity) if (INNOV_ON and isres(info)) else (role_wage(W, info["role"], fcity) if (MGR_ACT and isrole(info)) else kadro_ucreti(W, info["tier"], firms[info["firm"]]["kind"] if info["firm"] is not None else None, fcity, info["who"] == "npc"))       # K-148: çıraklık ocağı ve belediye burs/ücret sabit (kamu), tecrübe primi özel işyerinde
        if FOUNDER_DEFER > 0:                                    # M2.1: genç oyuncu firmasının kurucusu ilk FOUNDER_DEFER hafta (kuruluş haftası dahil) ücret almaz
            for f_ in W.player_firms:
                d_ = firms[f_]
                if w - d_.get("born", w) < FOUNDER_DEFER and d_["owner"] in d_["workers"]:
                    people[d_["owner"]]["wage"] = 0.0
        if SKILL_ON:
            for d_ in firms.values():
                d_["skill"] = (sum(PROD_TIER[people[q]["tier"]] for q in d_["workers"]) / len(d_["workers"])) if d_["workers"] else 1.0
                if ENTRY_OPEN and EO_SKILL > 0 and d_.get("eo") and d_["workers"] and w - d_["born"] < YOUNG_WEEKS:
                    d_["skill"] = max(d_["skill"], EO_SKILL)            # K-213 (4): genç firma kurucusu hedef sektörde standart verimle başlar (çırak cezası yok)
            for c_ in cities:
                ws_ = [(firms[f_]["skill"], len(firms[f_]["workers"])) for f_ in c_["firms"] if firms[f_]["kind"] not in ("ahir", "belediye", "arge") and firms[f_]["workers"]]
                c_["skill"] = sum(a_ * b_ for a_, b_ in ws_) / max(1, sum(b_ for _, b_ in ws_)) if ws_ else 1.0
                wm_ = [people[q_]["wage"] / (TIER_WAGE[0] * WI[c_["i"]]) for f_ in c_["firms"] if firms[f_]["kind"] not in ("ahir", "belediye", "arge") for q_ in firms[f_]["workers"] if (MGR_PASS or not isrole(people[q_])) and not (FOUNDER_DEFER and people[q_]["wage"] <= 0.0)]       # M2.1: ücret almayan kurucu birim emek maliyetine girmez (şehirde yalnız o varsa ulc 0 olup fiyat endeksini böler)
                c_["ulc"] = (sum(wm_) / len(wm_) / c_["skill"]) if wm_ else 1.0                 # K-150: birim emek maliyeti çarpanı (tam çırak = 1)
    for d_ in firms.values():                                # K-125: geçen haftanın girdi bulunurluğu kadro kararına girer
        if d_.get("ok_n"):
            d_["ok_prev"] = d_["ok_acc"] / d_["ok_n"]
        d_["ok_acc"], d_["ok_n"] = 0.0, 0
        if d_.get("wk_prod", 0.0) > 1e-9:
            d_["sold_prev"] = d_["wk_prod"] - d_.get("wk_uns", 0.0)
        d_["wk_prod"], d_["wk_uns"] = 0.0, 0.0
    short_units.clear()
    short_val.clear()
    want_units.clear()
    prod_w.clear()
    unsold_w.clear()
    own_p.clear()
    own_u.clear()
