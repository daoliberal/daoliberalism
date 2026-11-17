"""simkit.prices: fiyat oluşumu: update_prices, fp_* (firma fiyatı), kira hesabı, kök neden, kamu hizmeti, V2 defteri.

ARAYÜZ: update_prices, fp_cost, fp_prices, refresh_land, fp_prices_v2, pubsvc_step, v2_acct, d_kind, fp_disp_calc, rent_account, root_cause
OKUR/YAZAR: W.PRICE, W.LAND, W.REF, firma defterleri (W.firms, fwk_*, rent_*).
KATMAN: L1 (econ_core, tech_core'a bağımlı).
"""
from collections import defaultdict
import json
import math
from simkit.params import *          # noqa: F401,F403
from simkit.econ_core import fee_avg, fee_rate, freight, ulc_base
from simkit.tech_core import tech_f
from simkit.sector_core import sb_price_target, board_stat_add
from simkit.young_core import yk_entry_cost


def update_prices(W, last_short):
    """K-110, K-104: fiyat = yerel maliyet çıpası (navlun dahil girdi, emek, fee) × arz-talep çarpanı. Çarpan: dünya
    eksiği yukarı, şehrin alıcısız kalan üretimi aşağı iter. Teslim fiyatı = en ucuz satıcı + navlun."""
    ANCH = W.ANCH
    ANCHD = W.ANCHD
    ANCS = W.ANCS
    AVGT = W.AVGT
    BRAND = W.BRAND
    FRONT = W.FRONT
    GAPK = W.GAPK
    LAND = W.LAND
    LD_VER = W.LD_VER
    PM = W.PM
    PRICE = W.PRICE
    RECIPES = W.RECIPES
    REF = W.REF
    WI = W.WI
    cities = W.cities
    firms = W.firms
    gap_acc = W.gap_acc
    own_p = W.own_p
    own_u = W.own_u
    prod_w = W.prod_w
    unsold_w = W.unsold_w
    w_ctx = W.w_ctx
    want_units = W.want_units
    TOPO = W.TOPO
    if w_ctx[0] > 1:
        for ci in range(len(cities)):
            for p in REF:
                prod = prod_w.get((ci, p), 0.0)
                if prod <= 1e-9 and not (ORDER_BOOK >= 2 and last_short.get(p, 0.0) > 0 and PRODUCER.get(p) is not None and any(firms[f_]["kind"] == PRODUCER[p] for f_ in cities[ci]["firms"])):      # K-195: üreticisi olmayan/kapanmış üründe kıtlık fiyat çarpanı donmaz
                    continue
                u = unsold_w.get((ci, p), 0.0) / prod if prod > 1e-9 else 0.0
                sh = last_short.get(p, 0.0) / max(1e-9, want_units.get(p, 0.0))
                PM[(ci, p)] = min(PM_MAX, max(PM_MIN, PM[(ci, p)] * (1 + PM_ADJ * (sh - PM_DOWN * max(0.0, u - PM_TOL) - PM_DOWN_OWN * (own_u.get((ci, p), 0.0) / max(1e-9, own_p.get((ci, p), 0.0)) if own_p.get((ci, p), 0.0) > 1e-9 else 0.0) * (own_p.get((ci, p), 0.0) / max(prod, 1e-9))))))
    has = lambda ci, p: prod_w.get((ci, p), 0.0) > 1e-9 or w_ctx[0] <= 1

    def arb_cap(ci, p, base):
        """K-166: tek fiyat yasası: yerel fiyat komşunun teslim fiyatını aşamaz (alıcı kaçar); çarpan buna göre geri çekilir."""
        if ARB <= 0 or w_ctx[0] <= 1:
            return
        nb = [PRICE[(j, p)] + freight(W, j, p, abs(j - ci)) for j in range(len(cities)) if j != ci and has(j, p)]
        if not nb:
            return
        cap = max(ARB * min(nb), ARB_FLOOR * base)
        if PRICE[(ci, p)] > cap:
            PRICE[(ci, p)] = cap
            PM[(ci, p)] = max(PM_MIN, min(PM[(ci, p)], cap / base))

    gap_acc.clear()
    for kind in TOPO:
        outputs, inputs = RECIPES[kind]
        for ci in range(len(cities)):
            labor = PRICE_WAGE * WI[ci] * (1 + PRICE_MARGIN) * (cities[ci].get("ulc", ulc_base()) / ulc_base() if SKILL_ON else 1.0)     # K-150: fiyat çıpası gerçek ortalama ücretten (tecrübe primi) ve tecrübe veriminden türer: birim emek maliyeti = ücret/verim
            if kind == "ahir":
                for p in outputs:
                    PRICE[(ci, p)] = REF[p] * PM[(ci, p)]
                    arb_cap(ci, p, REF[p])
                continue
            main, rate = next(iter(outputs.items()))
            inp_cost = 0.0
            for q_p, q in inputs.items():
                srcs = [PRICE[(j, q_p)] + freight(W, j, q_p, abs(j - ci)) for j in range(len(cities)) if has(j, q_p)]
                inp_cost += q * (min(srcs) if srcs else REF[q_p] * (1 + NAVLUN))
            tf = tech_f(BRANCH[kind], FRONT[BRANCH[kind]]) if (ARGE_ON and kind in BRANCH) else 1.0     # K-134: öncü verimi fiyata yansır (ucuzlama)
            roy_ = 0.0
            if INNOV_ON and kind in BRANCH:
                tf, roy_ = ANCH[BRANCH[kind]]                       # K-167: en ucuz seçenek (kamu malı ya da patent), telif maliyet kalemidir
            tf_f_, roy_f_ = tf, roy_
            if RENT_ACT and INNOV_ON and kind in AVGT and kind != "yazilim":
                tf, roy_ = AVGT[kind]                               # K-183.2: piyasa fiyatı öncünün değil rakiplerin (kadro/çıktı ağırlıklı) ortalama maliyetini izler
            anchor = (labor / (rate * tf) + inp_cost) / (1 - fee_avg(W) - roy_)
            if kind == "moda":
                anchor *= 1.0 + MARKA_PRIM * BRAND.get(ci, 0.0)       # K-147: marka fiyatlama gücü verir (değer bazlı prim)
            if kind == "yazilim":
                anchor = SW_PRICE                                  # K-136: abonelik fiyatı değer bazlı; ölçek ekonomisi marjı yaratır
            if RENT_ACT and INNOV_ON and kind in BRANCH and kind != "yazilim":
                prev_a = ANCS.get((ci, kind))
                if prev_a is not None and anchor < prev_a:
                    anchor = max(anchor, prev_a * (1.0 - RENT_FALL))   # K-183.2: fiyat haftada en çok RENT_FALL düşer (geçici inovasyon rantı)
                ANCS[(ci, kind)] = anchor
                mk_ = (1.0 + MARKA_PRIM * BRAND.get(ci, 0.0)) if kind == "moda" else 1.0
                a_front = (labor / (rate * tf_f_) + inp_cost) / (1 - fee_avg(W) - roy_f_) * mk_
                gap_acc[kind][0] += anchor / a_front - 1.0
                gap_acc[kind][1] += 1
            ANCHD[(ci, kind)] = (labor / rate, inp_cost, anchor)        # K-183: firma maliyeti için bileşenler
            PRICE[(ci, main)] = anchor * PM[(ci, main)]
            arb_cap(ci, main, anchor)
    if RENT_ACT:
        GAPK.clear()
        GAPK.update({k_: v_[0] / v_[1] for k_, v_ in gap_acc.items() if v_[1]})
    for ci in range(len(cities)):
        for p in REF:
            srcs = [PRICE[(j, p)] + freight(W, j, p, abs(j - ci)) for j in range(len(cities)) if has(j, p)]
            LAND[(ci, p)] = min(srcs) if srcs else PRICE[(ci, p)] + REF[p] * NAVLUN
    LD_VER[0] += 1


def fp_cost(W, d):
    """K-183.1: firmanın birim maliyeti (Akçe/birim): şehrin emek ve girdi bileşenleri, firmanın kendi teknolojisi ve ödediği telif, kendi loncasının fee'si."""
    ANCHD = W.ANCHD
    xrate = W.xrate
    kind = d["kind"]
    a = ANCHD.get((d["city"], kind))
    if a is None:
        return None
    lab_u, inp, _anc = a
    b = BRANCH.get(kind)
    tf, roy = 1.0, 0.0
    if b and ARGE_ON:
        tf = d.get("tech", 1.0)
        if INNOV_ON and d.get("lic_n"):
            roy = xrate.get((d["lic_n"], b), TELIF_X0) * (TELIF_MEMBER_RATIO if d.get("lic_mem") else 1.0)
    return (lab_u / tf + inp) / (1 - fee_rate(W, d["lonca"]) - roy)


def fp_prices(W, w, last_short):
    """K-183.1: her satıcı haftalık fiyat çarpanını belirler: satamıyorsa indirir, stok bitiyorsa artırır, kaliteye göre rakiplerin ortalamasına konumlanır, birim maliyetin altına indirmez.
    Çarpanların üretim ağırlıklı ortalaması 1'e normalize edilir (şehir fiyat düzeyini arz-talep çarpanı PM belirler; firma çarpanı göreli konumdur)."""
    FPM = W.FPM
    PRICE = W.PRICE
    firms = W.firms
    fp_disp = W.fp_disp
    fwk_prod = W.fwk_prod
    fwk_uns = W.fwk_uns
    want_units = W.want_units
    if not FP_ACT:
        return
    grp = defaultdict(list)
    for f, d in firms.items():
        k = d["kind"]
        if d.get("dead") or not d["workers"] or k in ("market", "medya", "belediye", "lojistik", "arge", "ahir") or k not in PROD_OF:
            continue
        grp[(d["city"], PROD_OF[k])].append(f)
    for (ci, p), fl in sorted(grp.items()):
        if len(fl) < 2:
            for f in fl:
                FPM[f] = 1.0
            continue
        ref = PRICE[(ci, p)]
        sh = last_short.get(p, 0.0) / max(1e-9, want_units.get(p, 0.0))
        tp_ = sum(fwk_prod[f] for f in fl)
        wts = {f: ((fwk_prod[f] if tp_ > 1e-9 else 1.0) + 1e-6) for f in fl}
        tw = sum(wts.values())
        mean_m = sum(wts[f] * FPM.get(f, 1.0) for f in fl) / tw
        mean_q = sum(wts[f] * firms[f].get("q", QDEF) for f in fl) / tw
        cfs = {f: fp_cost(W, firms[f]) for f in fl}
        cv_ = [(wts[f], cfs[f]) for f in fl if cfs[f]]
        cf_mean = (sum(a_ * b_ for a_, b_ in cv_) / sum(a_ for a_, _ in cv_)) if cv_ else None
        new = {}
        for f in fl:
            d = firms[f]
            m0 = FPM.get(f, 1.0)
            prod, uns = fwk_prod[f], fwk_uns[f]
            m = m0
            if prod > 1e-9 and w > 1:
                u = uns / prod
                if u > FP_TOL:
                    m = m0 * (1 - min(FP_STEP_DN, FP_DN_K * (u - FP_TOL)))
                elif u <= 0.002 and m0 < FP_RIVAL_CAP * mean_m:
                    m = m0 * (1 + FP_STEP_UP * (0.5 + min(1.0, 4.0 * sh)))
            cf = cfs[f]
            adv = max(0.0, 1.0 - cf / cf_mean) if (cf and cf_mean) else 0.0
            tm = mean_m * (1.0 + (QPREM * (d.get("q", QDEF) - mean_q) if QL_ACT else 0.0)) * (1.0 - FP_PASS * adv)
            m += FP_POS * (tm - m)
            if cf is not None and ref > 0:
                m = max(m, min(m0, FP_FLOOR * cf / ref))
            new[f] = min(FP_MAX, max(FP_MIN, m))
        nm = sum(wts[f] * new[f] for f in fl) / tw
        for f in fl:
            FPM[f] = min(FP_MAX, max(FP_MIN, new[f] / nm))
    byp = defaultdict(list)                                     # fiyat yayılımı: aynı ürün için firmalar arası (üretim ağırlıklı) değişim katsayısı
    for f, d in firms.items():
        k = d["kind"]
        if d.get("dead") or not d["workers"] or k in ("market", "medya", "belediye", "lojistik", "arge", "ahir") or k not in PROD_OF or fwk_prod[f] <= 1e-9:
            continue
        p_ = PROD_OF[k]
        byp[p_].append((PRICE[(d["city"], p_)] * FPM.get(f, 1.0), fwk_prod[f], d.get("q", QDEF)))
    cvs, rngs, qsd = [], [], []
    for p_, lst in byp.items():
        if len(lst) < 2:
            continue
        tw_ = sum(x[1] for x in lst)
        mu = sum(x[0] * x[1] for x in lst) / tw_
        cvs.append(math.sqrt(sum(x[1] * (x[0] - mu) ** 2 for x in lst) / tw_) / mu)
        rngs.append(max(x[0] for x in lst) / min(x[0] for x in lst))
        mq_ = sum(x[2] * x[1] for x in lst) / tw_
        qsd.append(math.sqrt(sum(x[1] * (x[2] - mq_) ** 2 for x in lst) / tw_))
    if cvs:
        fp_disp.append((w, sum(cvs) / len(cvs), sum(rngs) / len(rngs), sum(qsd) / len(qsd), len(cvs)))


def refresh_land(W):
    """K-187: firma fiyatları şehir fiyatını değiştirince teslim fiyatını (LAND) yeniden hesaplar."""
    LAND = W.LAND
    LD_VER = W.LD_VER
    PRICE = W.PRICE
    REF = W.REF
    cities = W.cities
    prod_w = W.prod_w
    w_ctx = W.w_ctx
    for ci in range(len(cities)):
        for p in REF:
            srcs = [PRICE[(j, p)] + freight(W, j, p, abs(j - ci)) for j in range(len(cities)) if (prod_w.get((j, p), 0.0) > 1e-9 or w_ctx[0] <= 1)]
            LAND[(ci, p)] = min(srcs) if srcs else PRICE[(ci, p)] + REF[p] * NAVLUN
    LD_VER[0] += 1


def fp_prices_v2(W, w, last_short):
    """K-187 (PRICE_V2): her firma fiyatını kendi tam birim maliyetinden belirler. Birim maliyet = firmanın GERÇEKTE ödediği tüm giderler (L.fexp gider defteri: ücret, yönetici/uzman,
    girdi, navlun, lonca fee, telif, satış vergisi, kira, faiz, depo, sigorta, makine/bina yatırımı...; sermaye/dağıtım kalemleri NONCOST_KINDS dışında) sönümlü toplamı / sönümlü üretim.
    Fiyat = birim maliyet × (1+marj); marj piyasaya tepki verir (satılamayan: indirim; kıtlık/stok bitişi: artış, rakip tavanı), değişken maliyetin altına inmez.
    Çarpanlar normalize EDİLMEZ: şehir fiyatı = firma fiyatlarının üretim ağırlıklı ortalaması (PM artık fiyat çarpanı değil, piyasa sıkılığı göstergesi: kıtlık/alıcısız üretimle güncellenir; girişimci kapısı ve NPC kapasite sinyali okur). Perakende marjı ve navlun denetleyici ile maliyetten türer."""
    ANCHD = W.ANCHD
    CITYP = W.CITYP
    FPA = W.FPA
    FPM = W.FPM
    L = W.L
    LOG_MULT = W.LOG_MULT
    MKS = W.MKS
    MM_BASE = W.MM_BASE
    PRICE = W.PRICE
    TAXS = W.TAXS
    TAXV = W.TAXV
    V2S = W.V2S
    firms = W.firms
    fwk_prod = W.fwk_prod
    fwk_uns = W.fwk_uns
    want_units = W.want_units
    if not FP_ACT:
        return
    v2_acct(W, w)
    grp = defaultdict(list)
    for f, d in firms.items():
        k = d["kind"]
        if d.get("dead") or not d["workers"] or k in PV2_EXCL or k not in PROD_OF:
            continue
        grp[(d["city"], PROD_OF[k])].append(f)
    for key, fl in sorted(grp.items()):
        ci, p = key
        ucs, vcs = {}, {}
        for f in fl:
            s = V2S.get(f)
            if s is None:
                base = FPA.get(f) or CITYP.get(key) or PRICE[key] * FPM.get(f, 1.0)
                s = V2S[f] = dict(n=0, cF=0.0, cV=0.0, cS=0.0, u=0.0, us=0.0, std=base / (1.0 + PV2_M0))
            ex = L.fexp.get(f)
            capx = ex.get("capex", 0.0) if ex else 0.0
            tot = sum(ex.values()) if ex else 0.0
            var = sum(ex.get(kk, 0.0) for kk in PV2_VAR_KINDS) if ex else 0.0
            prod = fwk_prod.get(f, 0.0)
            s["n"] += 1
            a_, as_ = max(PV2_EMA, 1.0 / s["n"]), max(PV2_SLOW, 1.0 / s["n"])
            s["cF"] += a_ * ((tot - capx) - s["cF"])
            s["cV"] += a_ * (var - s["cV"])
            s["u"] += a_ * (prod - s["u"])
            s["cS"] += as_ * (capx - s["cS"])
            s["us"] += as_ * (prod - s["us"])
            wt_ = min(1.0, s["n"] / PV2_WARM)
            if s["u"] > 1e-9 and s["n"] > 1:
                ucl = s["cF"] / s["u"] + (s["cS"] / s["us"] if s["us"] > 1e-9 else 0.0)
                vcl = s["cV"] / s["u"]
                anc_ = ANCHD.get((ci, firms[f]["kind"]))
                if anc_ is not None:
                    ucl = min(ucl, PV2_UC_CAP * anc_[2])
                    vcl = min(vcl, ucl)
                if YOUNG_KIT:
                    ucl = yk_entry_cost(W, firms[f], ucl, vcl)       # K-216 (4): giriş fiyatlaması: sabit giderler hedef ölçekteki çıktıya bölünür (değişken maliyetin altına inmez)
                ucs[f] = wt_ * ucl + (1.0 - wt_) * s["std"]
                vcs[f] = wt_ * vcl + (1.0 - wt_) * s["std"] * PV2_VC_SHARE
            else:
                ucs[f], vcs[f] = s["std"], s["std"] * PV2_VC_SHARE
        sh = last_short.get(p, 0.0) / max(1e-9, want_units.get(p, 0.0))
        tp_ = sum(fwk_prod.get(f, 0.0) for f in fl)
        wts = {f: ((fwk_prod.get(f, 0.0) if tp_ > 1e-9 else 1.0) + 1e-6) for f in fl}
        tw = sum(wts.values())
        fp0s = {f: (FPA.get(f) or CITYP.get(key) or PRICE[key] * FPM.get(f, 1.0)) for f in fl}
        mean_p = sum(wts[f] * fp0s[f] for f in fl) / tw
        mean_q = sum(wts[f] * firms[f].get("q", QDEF) for f in fl) / tw
        new = {}
        for f in fl:
            d = firms[f]
            fp0 = fp0s[f]
            prod, uns = fwk_prod.get(f, 0.0), fwk_uns.get(f, 0.0)
            u = uns / prod if prod > 1e-9 else 0.0
            uc, vc = ucs[f], vcs[f]
            fp = fp0
            if w > 1 and prod > 1e-9:
                if u > FP_TOL:
                    fp = fp0 * (1 - min(FP_STEP_DN, FP_DN_K * (u - FP_TOL)))
                elif u <= 0.002 and fp0 < FP_RIVAL_CAP * mean_p * (1.0 + (QPREM * (d.get("q", QDEF) - mean_q) if QL_ACT else 0.0)):
                    fp = fp0 * (1 + FP_STEP_UP * (0.5 + min(1.0, 4.0 * sh)))
            tgt = uc * (1.0 + PV2_M0)
            if SECTOR_BOARD:                                # K-212: sektör durumu (kalıcı kıtlık/stok fazlası/fiyat eğilimi) hedefe sınırlı prim/indirim ekler; tam maliyet tabanı korunur
                tgt0_ = tgt
                tgt = sb_price_target(W, p, tgt, uc)
                if tgt > tgt0_:
                    board_stat_add(W, "fiyat_prim")
                elif tgt < tgt0_:
                    board_stat_add(W, "fiyat_indirim")
            if u <= FP_TOL:
                if fp < tgt:
                    fp += PV2_CR * (tgt - fp)
                elif fp > tgt * (1.0 + PV2_EXTRA) and sh < 0.01:
                    fp -= PV2_REV * (fp - tgt * (1.0 + PV2_EXTRA))
            fp = max(fp, vc * (1.0 + PV2_VC_MARGIN))
            if PUBSVC and d["kind"] in PV2_REG:
                fp = max(fp, uc * (1.0 + PUBSVC_TARIFF_M))          # düzenlenmiş tarife: tam maliyetin altına inmez
            fp = min(fp, fp0 * (1.0 + PV2_STEP_UP))
            new[f] = max(1e-6, fp)
        pr_ = sum(wts[f] * new[f] for f in fl) / tw
        for f in fl:
            FPA[f] = new[f]
            FPM[f] = new[f] / pr_
        PRICE[key] = pr_
        CITYP[key] = pr_
    for f, d in firms.items():                              # PV2 dışı (yazılım vb.) firmalar: çarpan 1
        if d["kind"] == "yazilim":
            FPM[f] = 1.0
    # perakende ve lojistik: marj gider defterinden
    for nm_, ky_ in (("m", "market"), ("ml", "lojistik")):
        fs_ = [f for f, d in firms.items() if d["kind"] == ky_ and not d.get("dead")]
        C_ = sum(sum(L.fexp[f].values()) for f in fs_ if f in L.fexp)
        R_ = sum(L.frev.get(f, 0.0) for f in fs_)
        kc_, kr_ = ("C", "R") if nm_ == "m" else ("CL", "RL")
        if MKS[kc_] is None:
            MKS[kc_], MKS[kr_] = C_, R_
        else:
            MKS[kc_] += PV2_EMA * (C_ - MKS[kc_])
            MKS[kr_] += PV2_EMA * (R_ - MKS[kr_])
        if w > 3 and MKS[kr_] > 1e-9 and MKS[kc_] > 1e-9:
            ratio_ = MKS[kc_] * (1.0 + PV2_MM_M) / MKS[kr_]
            MKS[nm_] = min(PV2_LOG_MAX if nm_ == "ml" else PV2_MM_MAX, max(0.5 if nm_ == "ml" else PV2_MM_MIN, MKS[nm_] * min(1.1, max(0.9, 1.0 + PV2_MM_RATE * (ratio_ - 1.0)))))
    W.MARKET_MARKUP = MM_BASE[0] * MKS["m"]
    LOG_MULT[0] = MKS["ml"]
    if PUBSVC and w > 3:
        pubsvc_step(W, w)
    if TAX_RULE:
        if TAXS["o"] is None:
            TAXS.update(o=L.cout, i=L.cin, c=L.cons)
        else:
            for k_, v_ in (("o", L.cout), ("i", L.cin), ("c", L.cons)):
                TAXS[k_] += TAX_EMA * (v_ - TAXS[k_])
        if w > 5 and TAXS["c"] > 1e-9:
            gap_ = (TAXS["o"] - TAXS["i"]) / TAXS["c"]
            TAXV[0] = min(TAX_MAX, max(SALES_TAX, TAXV[0] + TAX_GAIN * gap_ * (1.0 + TAXV[0])))
        L.cout = L.cin = L.cons = 0.0
    L.fexp.clear()
    L.frev.clear()
    refresh_land(W)
    fp_disp_calc(W, w)


def pubsvc_step(W, w):
    """K-187.3: düzenlenen altyapıda (PV2_REG) firmanın sönümlü tam maliyeti sönümlü satış gelirini aşıyorsa şehir farkı kendi gelirinden öder (kamu_hizmet_sozlesmesi; basımsız, açık kalem)."""
    L = W.L
    PSV = W.PSV
    cities = W.cities
    firms = W.firms
    for f, d in firms.items():
        if d.get("dead") or not d["workers"] or d["kind"] not in PV2_REG:
            continue
        ex = L.fexp.get(f)
        tot = sum(ex.values()) if ex else 0.0
        rv_ = L.frev.get(f, 0.0)
        st_ = PSV.setdefault(f, [tot, rv_])
        st_[0] += PV2_EMA * (tot - st_[0])
        st_[1] += PV2_EMA * (rv_ - st_[1])
        gap_ = (st_[0] - st_[1]) * PUBSVC_SHARE
        if gap_ > 1e-9:
            L.pay(cities[d["city"]]["acct"], f, gap_, "kamu_hizmet_sozlesmesi")


def v2_acct(W, w):
    """K-187: haftalık firma gelir-gider tablosu (sektör kârlılığı ve tipik firma dökümü); gider defterinden. Bayrak PV2_ACCT ile fiyatı değiştirmeden de tutulur."""
    FPA = W.FPA
    L = W.L
    V2K = W.V2K
    V2S = W.V2S
    V2SNAP = W.V2SNAP
    firms = W.firms
    fwk_prod = W.fwk_prod
    fwk_uns = W.fwk_uns
    loans = W.loans
    weeks = W.weeks
    rowk = defaultdict(lambda: [0.0, 0.0, 0, 0, 0.0, 0.0, 0.0, 0.0])      # tür -> [gelir, gider, firma, zararlı firma, NPC gelir, NPC gider, oyuncu gelir, oyuncu gider]
    snap = (w in V2_SNAP_WEEKS) or (w == weeks)
    for f, d in firms.items():
        if d.get("dead") or not d["workers"] or d["kind"] in ("belediye", "ahir", "arge"):
            continue
        ex = L.fexp.get(f)
        tot = sum(ex.values()) if ex else 0.0
        rv_ = L.frev.get(f, 0.0)
        rk_ = rowk[d["kind"]]
        rk_[0] += rv_
        rk_[1] += tot
        rk_[2] += 1
        rk_[3] += 1 if (tot > rv_ and w > 3) else 0
        if SDUMP_ON and d["owner"] is None and w % 10 == 0 and w >= 10:
            with open(WEEKLY_CSV + ".sd", "a") as _sd:
                _fx = {k_: round(v_) for k_, v_ in (ex or {}).items()}
                _sd.write(json.dumps(dict(w=w, f=f, kind=d["kind"], city=d["city"], n=len(d["workers"]), rev=round(rv_), tot=round(tot), prod=round(fwk_prod.get(f, 0.0), 2), uns=round(fwk_uns.get(f, 0.0), 2), price=round(FPA.get(f, 0.0), 3), uc=round((V2S[f]["cF"] / V2S[f]["u"] + (V2S[f]["cS"] / V2S[f]["us"] if V2S[f]["us"] > 1e-9 else 0.0)) if (f in V2S and V2S[f]["u"] > 1e-9) else 0.0, 3), prof=round(d.get("prof", 0.0)), bal=round(L.bal[f]), loan=round(loans[f]["out"]) if f in loans else 0, fx=_fx)) + "\n")
        ix_ = 4 if d["owner"] is None else 6
        rk_[ix_] += rv_
        rk_[ix_ + 1] += tot
        if snap and ex is not None:
            s_ = V2S.get(f)
            V2SNAP.setdefault(w, {})[f] = dict(kind=d["kind"], npc=d["owner"] is None, rev=rv_, tot=tot, cat=dict(ex), prod=fwk_prod.get(f, 0.0), uns=fwk_uns.get(f, 0.0), price=FPA.get(f, 0.0), uc=(s_["cF"] / s_["u"] if (s_ and s_["u"] > 1e-9) else 0.0), vc=0.0, n=len(d["workers"]), q=d.get("q", QDEF))
    V2K[w] = {k_: list(v_) for k_, v_ in rowk.items()}


def d_kind(W, f):
    firms = W.firms
    return firms[f]["kind"]


def fp_disp_calc(W, w):
    FPM = W.FPM
    PRICE = W.PRICE
    firms = W.firms
    fp_disp = W.fp_disp
    fwk_prod = W.fwk_prod
    byp = defaultdict(list)
    for f, d in firms.items():
        k = d["kind"]
        if d.get("dead") or not d["workers"] or k in ("market", "medya", "belediye", "lojistik", "arge", "ahir") or k not in PROD_OF or fwk_prod[f] <= 1e-9:
            continue
        p_ = PROD_OF[k]
        byp[p_].append((PRICE[(d["city"], p_)] * FPM.get(f, 1.0), fwk_prod[f], d.get("q", QDEF)))
    cvs, rngs, qsd = [], [], []
    for p_, lst in byp.items():
        if len(lst) < 2:
            continue
        tw_ = sum(x[1] for x in lst)
        mu = sum(x[0] * x[1] for x in lst) / tw_
        cvs.append(math.sqrt(sum(x[1] * (x[0] - mu) ** 2 for x in lst) / tw_) / mu)
        rngs.append(max(x[0] for x in lst) / min(x[0] for x in lst))
        mq_ = sum(x[2] * x[1] for x in lst) / tw_
        qsd.append(math.sqrt(sum(x[1] * (x[2] - mq_) ** 2 for x in lst) / tw_))
    if cvs:
        fp_disp.append((w, sum(cvs) / len(cvs), sum(rngs) / len(rngs), sum(qsd) / len(qsd), len(cvs)))


def rent_account(W, w):
    """K-183.2: geçen haftanın inovasyon rantı: firmanın birim maliyeti rakiplerin ağırlıklı ortalamasından düşükse, satılan birim × fiyat × maliyet avantajı oranı (normal üstü kâr).
    Dal bazında haftalık rant, rant dönemi (rant payı > %0,5 olan ardışık haftalar) ve fiyat çıpasının öncü maliyetine uzaklığı kaydedilir."""
    AVGT = W.AVGT
    FPM = W.FPM
    GAPK = W.GAPK
    PRICE = W.PRICE
    firms = W.firms
    fwk_prod = W.fwk_prod
    fwk_uns = W.fwk_uns
    rent_by_player = W.rent_by_player
    rent_hist = W.rent_hist
    rent_owner = W.rent_owner
    rent_run = W.rent_run
    rent_spells = W.rent_spells
    rent_tot = W.rent_tot
    xrate = W.xrate
    if w <= 1:
        return
    by_b = defaultdict(float)
    rev_b = defaultdict(float)
    for f, d in firms.items():
        k = d["kind"]
        b = BRANCH.get(k)
        if not b or k == "yazilim" or k not in PROD_OF or d.get("dead") or not d["workers"] or d.get("tech") is None or k not in AVGT:
            continue
        sold = fwk_prod[f] - fwk_uns[f]
        if sold <= 1e-9:
            continue
        main = PROD_OF[k]
        price = PRICE[(d["city"], main)] * FPM.get(f, 1.0)
        roy_f = xrate.get((d["lic_n"], b), TELIF_X0) * (TELIF_MEMBER_RATIO if d.get("lic_mem") else 1.0) if (INNOV_ON and d.get("lic_n")) else 0.0
        tf_a, roy_a = AVGT[k]
        cf_f = (LABOR_SHARE / d["tech"] + 1 - LABOR_SHARE) / (1 - fee_rate(W, d["lonca"]) - roy_f)
        cf_a = (LABOR_SHARE / tf_a + 1 - LABOR_SHARE) / (1 - fee_avg(W) - roy_a)
        rev_b[b] += sold * price
        r_ = sold * price * max(0.0, 1.0 - cf_f / cf_a)
        if r_ > 0:
            by_b[b] += r_
            typ = "inovatör firma" if d.get("innov_owner") else ("oyuncu firması" if d["owner"] is not None else "NPC firma")
            rent_owner[typ] += r_
            if d["owner"] is not None:
                rent_by_player[d["owner"]] += r_
    gb = defaultdict(list)
    for k_, g_ in GAPK.items():
        if k_ in BRANCH:
            gb[BRANCH[k_]].append(g_)
    for b in BRANCHES:
        share = by_b[b] / rev_b[b] if rev_b[b] > 0 else 0.0
        rent_hist[b].append((w, by_b[b], share, (sum(gb[b]) / len(gb[b])) if gb[b] else 0.0))
        rent_tot[b] += by_b[b]
        if share > 0.005:
            rent_run[b] += 1
        else:
            if rent_run[b] >= 3:
                rent_spells[b].append((w - rent_run[b], rent_run[b]))
            rent_run[b] = 0


def root_cause(W, short):
    """Girdisi de eksik olan ürün eksik sayılmaz; sorumlusu girdidir (pano: kök eksiklik, K-19)."""
    RECIPES = W.RECIPES
    firms = W.firms
    out = {}
    for p, u in short.items():
        k = PRODUCER.get(p)
        if k is None:
            continue
        inputs = RECIPES[k][1]
        explained = max((short.get(q, 0.0) / per for q, per in inputs.items() if per > 1e-9 and q not in ("yazilim", "bilgisayar")), default=0.0)   # K-136: isteğe bağlı girdi eksiği kök neden sayılmaz   # girdi eksiğinin açıkladığı çıktı
        if explained >= 0.5 * u and any(d_["workers"] and d_["kind"] == k for d_ in firms.values()):     # K-138: hiç çalışanı olmayan tür girdiyle açıklanamaz (girdi talebini kendisi yaratmıyor)
            continue
        out[p] = u
    return out
