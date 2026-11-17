"""simkit.tech: teknoloji: tech_update, build_pats, innov_choice, path_step.

ARAYÜZ: build_pats, innov_choice, tech_update, path_step
OKUR/YAZAR: W.PATS, W.KD, W.HW_STATE, W.SW_STATE, W.FRONT.
KATMAN: L3.
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from collections import defaultdict
import math
from simkit.params import *          # noqa: F401,F403
from simkit.lab_meas import lab_stamp
from simkit.dao_core import kq_vis, live_daos, qgain
from simkit.econ_core import fee_avg, ramp
from simkit.recipes import rebuild_order
from simkit.tech_core import tech_f


def build_pats(W):
    """K-167 (sahip): her DAO'nun kendi bağımsız patenti vardır; telif oranı rakibin sunduğu net kazanca göre ayarlanır (taban TELIF_XMIN)."""
    ANCH = W.ANCH
    KDH = W.KDH
    PATS = W.PATS
    PUB = W.PUB
    PUBQ = W.PUBQ
    dao_all = W.dao_all
    firms = W.firms
    mono = W.mono
    w_ctx = W.w_ctx
    xr_hist = W.xr_hist
    xrate = W.xrate
    prev = dict(xrate)
    for b in BRANCHES:
        PATS[b] = []
    for n in dao_all:
        d = firms[n]
        hist = KDH[n]
        vis = hist[max(0, len(hist) - 1 - ADOPT_LAG)] if hist else {}
        holder = d["lonca"] if d.get("dead") else n
        for b, k in vis.items():
            if k > PUB[b] + 1e-9 or (QL_ACT and kq_vis(W, n, b) > PUBQ[b] + 1e-9):
                PATS[b].append((n, holder, max(k, PUB[b]), d["lonca"]))        # K-183.3: yalnız ürün (kalite) patenti olan DAO da teklif verir
    row = {}
    for b in BRANCHES:
        lst = PATS[b]
        f_pub = tech_f(b, PUB[b])
        gains = {n: (1 - f_pub / tech_f(b, k)) * LABOR_SHARE + qgain(W, n, b) for (n, h, k, lo) in lst}
        for (n, h, k, lo) in lst:
            rivals = [gains[o] - prev.get((o, b), TELIF_X0) for (o, _h, _k, _l) in lst if o != n]
            cap_ = min(TELIF_X0, max(TELIF_XMIN, TELIF_KEEP * gains[n]))
            xrate[(n, b)] = min(cap_, max(TELIF_XMIN, gains[n] - max(rivals) - UNDERCUT)) if rivals else cap_
        mono[b][min(2, len(lst))] += 1
        opts = [(f_pub, 0.0)] + [(tech_f(b, k), xrate[(n, b)]) for (n, h, k, lo) in lst]
        ANCH[b] = min(opts, key=lambda o: (LABOR_SHARE / o[0] + 1 - LABOR_SHARE) / (1 - fee_avg(W) - o[1]))
        row[b] = (len(lst), min([xrate[(n, b)] for (n, h, k, lo) in lst] or [0.0]), max([xrate[(n, b)] for (n, h, k, lo) in lst] or [0.0]))
    xr_hist.append((w_ctx[0], row))


def innov_choice(W, d, b):
    """K-167: firma tüm DAO'ların tekliflerine bakar: verim kazancı - telif (üyeye oran/3) en iyisini alır, yoksa kamu malı / eski teknolojide kalır."""
    PATS = W.PATS
    PUB = W.PUB
    tech_paths = W.tech_paths
    w_ctx = W.w_ctx
    xrate = W.xrate
    w_ = w_ctx[0]
    if d["owner"] is not None and "tech_path" in d and w_ < d.get("tech_next", 0):
        tech_paths[d["tech_path"]] += 1
        return
    d["tech_next"] = w_ + (REEVAL if d["owner"] is not None else 1)
    f_pub = tech_f(b, PUB[b])
    best = None
    for (n, h, k, lo_h) in PATS[b]:
        f_h = tech_f(b, k)
        mem = (lo_h == d["lonca"]) or bool(PATH_ACT and d.get("innov_owner"))
        net = (1 - f_pub / f_h) * LABOR_SHARE + qgain(W, n, b) - xrate[(n, b)] * (TELIF_MEMBER_RATIO if mem else 1.0)
        if net > LIC_MARGIN and (best is None or net > best[0]):
            best = (net, n, h, f_h, k, mem)
    if best:
        _, n, h, f_h, k, mem = best
        d["tech"], d["lic"], d["klevel"], d["lic_n"], d["lic_mem"] = f_h, h, k, n, mem
        path = "lisans (üye oranı)" if mem else "lisans (dış oran)"
    else:
        d["tech"], d["lic"], d["klevel"] = f_pub, None, PUB[b]
        d["lic_n"] = None
        d["lic_mem"] = False
        path = "kamu malı (patent süresi doldu)" if PUB[b] > 0 else "eski teknoloji (lisanssız)"
    d["tech_path"] = path
    tech_paths[path] += 1


def tech_update(W):
    """K-134: öncü ve yayılmış düzey; her firma teknolojisini seçer: kendi loncası / bedava yayılma / telifli lisans / eski."""
    AVGT = W.AVGT
    FRONT = W.FRONT
    FRONTQ = W.FRONTQ
    HW_Q = W.HW_Q
    HW_STATE = W.HW_STATE
    KD = W.KD
    KN = W.KN
    KQ = W.KQ
    KTECH = W.KTECH
    MODA_STATE = W.MODA_STATE
    PRICE = W.PRICE
    PUB = W.PUB
    PUBQ = W.PUBQ
    RECIPES = W.RECIPES
    REF = W.REF
    SW_Q = W.SW_Q
    SW_STATE = W.SW_STATE
    TOUR_STATE = W.TOUR_STATE
    cities = W.cities
    dao_all = W.dao_all
    firms = W.firms
    fq_hist = W.fq_hist
    front_hist = W.front_hist
    green = W.green
    lic_cur = W.lic_cur
    loncas = W.loncas
    tech_events = W.tech_events
    tech_paths = W.tech_paths
    w_ctx = W.w_ctx
    xrate = W.xrate
    w_ = w_ctx[0]
    if INNOV_ON:                                               # K-167: lonca düzeyi = üye (ve batmış) DAO'ların en iyi patenti
        for lo in loncas:
            for b in BRANCHES:
                KN[lo][b] = max([KD[n].get(b, 0.0) for n in dao_all if firms[n]["lonca"] == lo] or [0.0])
    for b in BRANCHES:
        old_front = FRONT[b]
        FRONT[b] = max(KN[lo][b] for lo in loncas)
        front_hist[b].append(FRONT[b])
        idx = len(front_hist[b]) - 1 - (PATENT_TERM if INNOV_ON else DIFFUSE_LAG)
        PUB[b] = front_hist[b][idx] if idx >= 0 else 0.0
        for th in (1.1, 1.2, 1.3, 1.5):                    # verim eşikleri: olay kaydı (hafta, dal, lonca)
            if tech_f(b, old_front) < th <= tech_f(b, FRONT[b]):
                lead = max(loncas, key=lambda l: KN[l][b])
                tech_events.append(f"hafta {w_}: {lead} {b} dalında verim +%{int(round((th - 1) * 100))} eşiğini geçti")
    if QL_ACT:
        for b in BRANCHES:
            FRONTQ[b] = max([KQ[n][b] for n in dao_all if n in KQ] or [0.0])
            fq_hist[b].append(FRONTQ[b])
            idx_q = len(fq_hist[b]) - 1 - PATENT_TERM
            PUBQ[b] = fq_hist[b][idx_q] if idx_q >= 0 else 0.0
    tech_paths.clear()
    if INNOV_ON:
        build_pats(W)
    gsum, gw = 0.0, 0.0
    for f, d in firms.items():
        b = BRANCH.get(d["kind"])
        if not b or d.get("dead"):
            continue
        if INNOV_ON:
            innov_choice(W, d, b)
        else:
            own = KN[d["lonca"]][b]
            base_lv = max(own, PUB[b])
            f_cur = tech_f(b, base_lv)
            best_lo = max(loncas, key=lambda l: KN[l][b])
            f_best = tech_f(b, KN[best_lo][b])
            if best_lo != d["lonca"] and (1 - f_cur / f_best) * LABOR_SHARE > TELIF:
                d["tech"], d["lic"], d["klevel"] = f_best, best_lo, KN[best_lo][b]
                tech_paths["lisans (telifli)"] += 1
            else:
                d["tech"], d["lic"], d["klevel"] = f_cur, None, base_lv
                tech_paths["kendi loncası" if (base_lv == own and own > 0) else ("kendiliğinden yayılma" if PUB[b] > 0 else "eski teknoloji (Ar-Ge yok)")] += 1
        if d["kind"] == "santral" and d["workers"]:
            gsum += min(1.0, d["klevel"] / GREEN_K) * len(d["workers"])
            gw += len(d["workers"])
    if INNOV_ON:
        kt, ln_ = defaultdict(list), defaultdict(int)
        for d in firms.values():
            if d.get("tech") is not None and d["workers"] and not d.get("dead") and d["kind"] in BRANCH:
                kt[d["kind"]].append(d["tech"])
                if d.get("lic_n"):
                    ln_[d["lic_n"]] += 1
        KTECH.clear()
        KTECH.update({k_: sum(v_) / len(v_) for k_, v_ in kt.items()})
        lic_cur.clear()
        lic_cur.update(ln_)
    g_new = max(green[0], gsum / gw) if gw else green[0]           # teknoloji geri alınmaz
    for th in (0.25, 0.5, 0.75, 1.0):
        if green[0] < th <= g_new:
            tech_events.append(f"hafta {w_}: temiz elektrik payı %{int(th * 100)} eşiğini geçti (yeşil enerji)")
    green[0] = g_new
    RECIPES["santral"][1]["komur"] = 0.05 * (1 - green[0])           # temiz elektrik kömür gerektirmez
    if MODA_ON and not MODA_STATE["on"] and FRONT["tekstil"] >= MODA_UNLOCK:        # K-147: ürün inovasyonu: tekstil → moda (tasarım ve markalı giyim), iki şehirde
        lead = max(loncas, key=lambda l: KN[l]["tekstil"])
        c0, nc = int(lead[5:]) % len(cities), len(cities)
        MODA_STATE.update(on=True, since=w_)
        for ci_ in (c0, (c0 + 3) % nc):
            fname = f"s{ci_}_moda0"
            firms[fname] = dict(kind="moda", city=ci_, lonca=lead, workers=[], owner=None, capacity=CAP_OTHER, capitalized=False)
            if KR_MEAS:
                lab_stamp(W, fname)                                      # davranışsız: firma türü kuruluşta bir kez
            cities[ci_]["firms"].append(fname)
        tech_events.append(f"hafta {w_}: MODA AÇILDI: {lead} tekstil dalında tasarım ve marka eşiğini geçti; moda evleri şehir {c0}, {(c0 + 3) % nc}")
    if HW_ON and not HW_STATE["on"] and FRONT["malzeme"] >= HW_UNLOCK:          # K-142: yeni teknoloji yeni sektör açar: elektronik donanım (bileşen + bilgisayar/telefon), uzmanlaşmış şehirlerde
        lead = max(loncas, key=lambda l: KN[l]["malzeme"])
        c0, nc = int(lead[5:]) % len(cities), len(cities)
        HW_STATE.update(on=True, since=w_)
        for kind_, cs_ in (("elektronik", (c0, (c0 + 1) % nc)), ("bilgisayar", ((c0 + 2) % nc, (c0 + 3) % nc))):
            for ci_ in cs_:
                fname = f"s{ci_}_{kind_}0"
                firms[fname] = dict(kind=kind_, city=ci_, lonca=lead, workers=[], owner=None, capacity=CAP_OTHER, capitalized=False)
                if KR_MEAS:
                    lab_stamp(W, fname)                                      # davranışsız: firma türü kuruluşta bir kez
                cities[ci_]["firms"].append(fname)
        for k_, (o_, i_) in RECIPES.items():
            if o_ and k_ not in HW_CHAIN:
                HW_Q[k_] = 1.0 / (PC_LIFE * next(iter(o_.values())))      # işyeri çalışan başına 1/PC_LIFE bilgisayar-döngü (yıpranma ve yenileme)
                i_["bilgisayar"] = 0.0
        rebuild_order(W)                                                         # bağımlılık derinliği değişti
        tech_events.append(f"hafta {w_}: ELEKTRONİK DONANIM AÇILDI: {lead} malzeme dalının eşiğini geçti; bileşen şehir {c0}, {(c0 + 1) % nc}; bilgisayar/telefon şehir {(c0 + 2) % nc}, {(c0 + 3) % nc}")
    if SW_STATE["on"]:                                                           # K-143: firma yazılım benimsemesi eğriyle yükselir
        for k_, q_ in SW_Q.items():
            RECIPES[k_][1]["yazilim"] = q_ * ramp(W, SW_STATE)
    if HW_STATE["on"]:                                                           # K-143: firma bilgisayar benimsemesi eğriyle yükselir
        for k_, q_ in HW_Q.items():
            RECIPES[k_][1]["bilgisayar"] = q_ * ramp(W, HW_STATE) * min(HW_MAXQ, (REF["bilgisayar"] / max(1e-9, min(PRICE[(ci_, "bilgisayar")] for ci_ in range(len(cities))))) ** HW_ELAST)
    if SOFT_ON and not SW_STATE["on"] and FRONT["malzeme"] >= SW_UNLOCK and FRONT["enerji"] >= SW_UNLOCK and (not HW_ON or FRONT["donanim"] >= HW_SW_UNLOCK):     # K-136, K-142: yeni teknoloji yeni sektör açar
        lead = max(loncas, key=lambda l: KN[l]["malzeme"] + KN[l]["enerji"])
        ci_ = int(lead[5:]) % len(cities)
        SW_STATE.update(on=True, since=w_)
        for k_, (o_, i_) in RECIPES.items():
            if o_ and k_ not in ("ahir", "yazilim"):
                SW_Q[k_] = 1.0 / next(iter(o_.values()))                  # her işyerinde çalışan başına bir koltuk (tam düzey; K-143: benimseme eğrisiyle artar)
                i_["yazilim"] = 0.0
        rebuild_order(W)
        fname = f"s{ci_}_yazilim0"
        firms[fname] = dict(kind="yazilim", city=ci_, lonca=lead, workers=[], owner=None, capacity=CAP_OTHER, capitalized=False, seed=True)
        if KR_MEAS:
            lab_stamp(W, fname)                                      # davranışsız: firma türü kuruluşta bir kez
        cities[ci_]["firms"].append(fname)
        tech_events.append(f"hafta {w_}: YAZILIM SEKTÖRÜ AÇILDI: {lead} (şehir {ci_}) malzeme ve enerji altyapısıyla bilişim dalını açtı; ilk yazılım firması {fname}")
    if TOUR_ON and not TOUR_STATE["on"] and FRONT["tekstil"] >= TOUR_UNLOCK and (MODA_STATE["on"] or not MODA_ON):          # K-138: moda → marka → turizm: otel ve yeme-içme açılır
        lead = max(loncas, key=lambda l: KN[l]["tekstil"])
        TOUR_STATE.update(on=True, since=w_)
        for ci_ in range(len(cities)):
            fname = f"s{ci_}_otel0"
            firms[fname] = dict(kind="otel", city=ci_, lonca=lead, workers=[], owner=None, capacity=CAP_OTHER, capitalized=False, seed=True)
            if KR_MEAS:
                lab_stamp(W, fname)                                      # davranışsız: firma türü kuruluşta bir kez
            cities[ci_]["firms"].append(fname)
        tech_events.append(f"hafta {w_}: TURİZM AÇILDI: {lead} tekstil/moda dalının eşiğini geçti; her şehirde bir otel ve yeme-içme firması kuruldu")
    if RENT_ACT and INNOV_ON:                                  # K-183.2: türün çıktı ağırlıklı (kadro × verim) ortalama teknolojisi ve telifi
        acc_ = defaultdict(lambda: [0.0, 0.0, 0.0])
        for f_, d_ in firms.items():
            b_ = BRANCH.get(d_["kind"])
            if not b_ or d_.get("dead") or not d_["workers"] or d_.get("tech") is None:
                continue
            n_ = len(d_["workers"])
            roy_ = xrate.get((d_["lic_n"], b_), TELIF_X0) * (TELIF_MEMBER_RATIO if d_.get("lic_mem") else 1.0) if d_.get("lic_n") else 0.0
            a_ = acc_[d_["kind"]]
            a_[0] += n_
            a_[1] += n_ * d_["tech"]
            a_[2] += n_ * d_["tech"] * roy_
        AVGT.clear()
        for k_, a_ in acc_.items():
            if a_[0] > 0:
                AVGT[k_] = (a_[1] / a_[0], a_[2] / a_[1])
    if SW_STATE["on"]:
        adopt = [d_.get("sw", 0.0) for d_ in firms.values() if d_["kind"] not in ("ahir", "yazilim") and d_["workers"] and not d_.get("dead")]
        SW_STATE["adopt"] = sum(adopt) / len(adopt) if adopt else 0.0


def path_step(W, w):
    """K-183.3: DAO Ar-Ge yolunu seçer: süreç (maliyet düşürme) ya da ürün (kalite artırma). Karşılaştırma: birim Ar-Ge'nin fiyat/değer üzerindeki marjinal etkisi, aynı yoldaki rakip DAO sayısına bölünür."""
    KD = W.KD
    KQ = W.KQ
    PUB = W.PUB
    PUBQ = W.PUBQ
    firms = W.firms
    path_log = W.path_log
    tech_events = W.tech_events
    if not QL_ACT:
        return
    for n in live_daos(W):
        d = firms[n]
        if "path" not in d:
            d["path"], d["path_since"] = "surec", w
        if w - d["path_since"] < QPATH_EVERY:
            continue
        b = d["branch"]
        if b == "medya":
            continue
        kp = max(KD[n][b], PUB[b])
        kq = max(KQ[n][b], PUBQ[b])
        gp = LABOR_SHARE * ARGE_COEF[b] / (2.0 * (kp + 2000.0) ** 0.5) / tech_f(b, kp)
        gq = QPREM * QWR * math.exp(-kq / QK_SCALE) / QK_SCALE
        npth = defaultdict(int)
        for m in live_daos(W):
            if m != n and firms[m]["branch"] == b:
                npth[firms[m].get("path", "surec")] += 1
        sp, sq = gp / (1 + npth["surec"]), gq / (1 + npth["urun"])
        cur = d["path"]
        new = cur
        if cur == "surec" and sq > QPATH_SW * sp:
            new = "urun"
        elif cur == "urun" and sp > QPATH_SW * sq:
            new = "surec"
        if new != cur:
            d["path"], d["path_since"] = new, w
            KQ[n][b] = max(KQ[n][b], PUBQ[b])
            path_log["urun" if new == "urun" else "surec"] += 1
            tech_events.append(f"hafta {w}: {n} Ar-Ge yolu {cur} -> {new} (dal {b})")
