"""simkit.dao_core: DAO çekirdeği: canlı DAO, haftalık maliyet, serbest inovatör, dal/lonca seçimi, kalite kazancı.

ARAYÜZ: kq_vis, rq_of, qgain, live_daos, dao_weekly_cost, pick_branch, pick_lonca, free_innovators
OKUR: W durumu. YAZAR: yok.
KATMAN: L2 (credit_core, econ_core, tech_core'a bağımlı).
"""
from collections import defaultdict
import math
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.credit_core import lendable
from simkit.econ_core import fee_rate, innov_uygun, isres, isrole
from simkit.tech_core import tech_f


def kq_vis(W, n, b):
    """K-183.3: DAO'nun ürün (kalite) Ar-Ge düzeyinin firmalarca görülen (ADOPT_LAG gecikmeli) değeri."""
    KQH = W.KQH
    h = KQH.get(n)
    if not h or b == "medya":                                   # medya dalında kalite yolu yok (kanal ilerlemesi süreç düzeyine bağlı)
        return 0.0
    return h[max(0, len(h) - 1 - ADOPT_LAG)].get(b, 0.0)


def rq_of(W, lv):
    return 1.0 - math.exp(-lv / QK_SCALE)


def qgain(W, n, b):
    """K-183.3: DAO n'in ürün patentinin lisans alan firmaya değeri (kamu malı üstü kalite × fiyat primi payı)."""
    PUBQ = W.PUBQ
    if not QL_ACT:
        return 0.0
    return QPREM * QWR * max(0.0, rq_of(W, kq_vis(W, n, b)) - rq_of(W, PUBQ[b]))


def live_daos(W):
    dao_all = W.dao_all
    firms = W.firms
    return [n for n in dao_all if not firms[n].get("dead")]


def dao_weekly_cost(W, n, extra=0.0):
    firms = W.firms
    people = W.people
    d = firms[n]
    return CYCLES_PER_WEEK * (sum(people[q]["wage"] for q in d["workers"]) + extra + ix(W, RENT))


def pick_branch(W, n, d):
    KD = W.KD
    PUB = W.PUB
    firms = W.firms
    loncas = W.loncas
    rev_lb = W.rev_lb
    rb = {b: sum(rev_lb[(lo, b)] for lo in loncas) for b in BRANCHES}
    act = defaultdict(int)
    for m in live_daos(W):
        if m != n:
            act[firms[m]["branch"]] += 1

    def score(b):
        own = max(KD[n].get(b, 0.0), PUB[b])
        return (rb[b] + 3.0 * rev_lb[(d["lonca"], b)] + 1.0) * BRANCH_WEIGHT.get(b, 1.0) * ARGE_COEF[b] / (own + 2000.0) ** 0.5 / (1 + act[b]) ** 2
    best = max(BRANCHES, key=score)
    return best, score


def pick_lonca(W, kind, options):
    """K-167 (sahip): firma loncayı üyelik telif indirimine ve krediye göre seçer (güçlü Ar-Ge DAO'su olan loncaya akış)."""
    FEES = W.FEES
    PATS = W.PATS
    PUB = W.PUB
    xrate = W.xrate
    b = BRANCH.get(kind)

    def sc(lo):
        s = 0.0
        if b:
            f_pub = tech_f(b, PUB[b])
            for (n, h, k, lo_h) in PATS[b]:
                s = max(s, (1 - f_pub / tech_f(b, k)) * LABOR_SHARE + qgain(W, n, b) - xrate[(n, b)] * (TELIF_MEMBER_RATIO if lo_h == lo else 1.0))
        return (round(s - (fee_rate(W, lo) if FEES else 0.0), 4), lendable(W, lo))
    return max(options, key=sc)


def free_innovators(W, ci):
    REP = W.REP
    c = W.cities[ci]
    out = []
    for q in c["players"]:
        if HUMAN_ON and q == W.human:
            continue                                                  # DAO oyunu: insan kendiliğinden araştırmacı olmaz
        k = innov_uygun(W, q)
        if k is not None:
            out.append((k, -REP[q], q))
    out.sort()
    return [q for _, _, q in out]
