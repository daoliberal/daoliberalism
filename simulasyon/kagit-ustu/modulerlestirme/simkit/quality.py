"""simkit.quality: ürün kalitesi: grade_gap, grade_step, quality_step, qstat_week.

ARAYÜZ: grade_gap, grade_step, quality_step, qstat_week
OKUR/YAZAR: W.firms, kalite sayaçları.
KATMAN: L3.
"""
from simkit.params import *          # noqa: F401,F403
from simkit.dao_core import kq_vis, rq_of


def grade_gap(W, p):
    """K-183.4: ürün için hane katmanlarının talep payı - arz payı (strateji sınıfı başına); yoksa None."""
    firms = W.firms
    segd_ema = W.segd_ema
    D = [segd_ema[(p, g)] for g in (0, 1, 2)]
    td = sum(D)
    if td <= 1e-9:
        return None
    S = [0.0, 0.0, 0.0]
    for f_, d_ in firms.items():
        k_ = d_["kind"]
        if d_.get("dead") or not d_["workers"] or k_ not in PROD_OF or PROD_OF[k_] != p:
            continue
        S[d_.get("grade", 1)] += len(d_["workers"]) * QG_RATE[d_.get("grade", 1)]
    ts = sum(S)
    if ts <= 1e-9:
        return [D[g] / td for g in (0, 1, 2)]
    return [D[g] / td - S[g] / ts for g in (0, 1, 2)]


def grade_step(W, w):
    """K-183.4: oyuncu firması stratejisini (ucuz / orta / pahalı) açık kalan hane katmanına göre seçer (kuruluşta ve 13 haftada bir)."""
    firms = W.firms
    grade_log = W.grade_log
    player_firms = W.player_firms
    segd_ema = W.segd_ema
    segd_w = W.segd_w
    if not QL_ACT:
        return
    for (p_, g_), v_ in list(segd_w.items()):
        segd_ema[(p_, g_)] = 0.8 * segd_ema[(p_, g_)] + 0.2 * v_
    segd_w.clear()
    for f_ in player_firms:
        d_ = firms[f_]
        if d_.get("dead") or d_["kind"] not in PROD_OF:
            continue
        if "grade_t" in d_ and w - d_["grade_t"] < GRADE_EVERY:
            continue
        gaps = grade_gap(W, PROD_OF[d_["kind"]])
        first = "grade_t" not in d_
        d_["grade_t"] = w
        if gaps is None:
            d_.setdefault("grade", 1)
            continue
        cur = d_.get("grade", 1)
        pos = [max(0.0, g_) for g_ in gaps]
        if sum(pos) <= 1e-9:
            best = 1
        else:                                                       # firmanın sabit (deterministik) dilimi, açık kalan katmanların payına göre strateji seçer (hepsi aynı katmana yığılmasın)
            u_ = (int(f_.rsplit("oy", 1)[1]) * 0.6180339887498949 % 1.0) * sum(pos) if "oy" in f_ else 0.0
            acc_, best = 0.0, 1
            for g_ in (0, 1, 2):
                acc_ += pos[g_]
                if u_ < acc_:
                    best = g_
                    break
        if first:
            d_["grade0"] = best
        if best != cur and (first or gaps[best] - gaps[cur] > GRADE_GAP):
            d_["grade"] = best
            grade_log[(cur, best)] += 1
        else:
            d_.setdefault("grade", cur)


def quality_step(W, w):
    """K-183.3: firma kalitesi (0-1) = QB + QWI·girdi kalitesi (değer ağırlıklı) + QWX·tecrübe (çırak/kalfa/usta ortalaması) + QWR·ürün Ar-Ge'si (lisans aldığı DAO'nun kalite düzeyi ya da kamu malı) + strateji; haftada %10 yakınsar."""
    PUBQ = W.PUBQ
    firms = W.firms
    inq_acc = W.inq_acc
    if not QL_ACT:
        return
    for f_, d_ in firms.items():
        k_ = d_["kind"]
        if d_.get("dead") or not d_["workers"] or k_ not in PROD_OF or k_ in ("market", "medya", "belediye", "lojistik", "arge", "ahir"):
            continue
        ia_ = inq_acc.get(f_)
        iq_ = (ia_[1] / ia_[0]) if (ia_ and ia_[0] > 1e-9) else QDEF
        xq_ = min(1.0, max(0.0, (d_.get("skill", 1.0) - 1.0) / ((QUAL_TIER_TOP if QUAL_TIER_TOP else PROD_TIER[2]) - 1.0)))
        b_ = BRANCH.get(k_)
        rq_ = 0.0
        if b_:
            lv_ = max(PUBQ[b_], kq_vis(W, d_["lic_n"], b_)) if d_.get("lic_n") else PUBQ[b_]
            rq_ = rq_of(W, lv_)
        tgt = QB + QWI * iq_ + QWX * xq_ + QWR * rq_ + QG_SHIFT[d_.get("grade", 1)]
        q0_ = d_.get("q", QDEF)
        d_["q"] = min(1.0, max(0.02, q0_ + QRATE * (tgt - q0_)))
    inq_acc.clear()


def qstat_week(W, w):
    """K-183.4: son 100 haftanın firma bazlı kalite, gelir, alım, ücret ve çıktı istatistiği (kalite segmentleri raporu)."""
    fbuy = W.fbuy
    firms = W.firms
    frev = W.frev
    fstat = W.fstat
    fwage = W.fwage
    fwk_prod = W.fwk_prod
    rev_prev = W.rev_prev
    weeks = W.weeks
    if w > weeks - 100:
        for f_, d_ in firms.items():
            if f_ in frev or f_ in fwage:
                fs_ = fstat[f_]
                fs_["n"] += 1
                fs_["q"] += d_.get("q", QDEF)
                fs_["rev"] += frev.get(f_, 0.0)
                fs_["buy"] += fbuy.get(f_, 0.0)
                fs_["wage"] += fwage.get(f_, 0.0)
                fs_["w"] += len(d_["workers"])
                fs_["prod"] += fwk_prod.get(f_, 0.0)
                fs_["grade"] = d_.get("grade", 1)
    rev_prev.clear()
    rev_prev.update(frev)
    frev.clear()
    fbuy.clear()
    fwage.clear()
