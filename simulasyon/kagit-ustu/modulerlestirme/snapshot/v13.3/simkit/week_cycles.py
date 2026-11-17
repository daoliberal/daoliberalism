"""simkit.week_cycles: haftanın döngüleri (CYCLES_PER_WEEK): üretim, takas, ödemeler.

ARAYÜZ: phase_cycles
OKUR/YAZAR: W.
KATMAN: L7.
"""
from simkit.params import *          # noqa: F401,F403
from simkit.week_cycle_parts import phase_cycle_open, phase_cycle_plan, phase_cycle_demand, phase_cycle_match, phase_cycle_buy, phase_cycle_pay, phase_cycle_welfare, phase_cycle_close      # noqa: F401 (adım 7)


def phase_cycles(W, w, weeks):
    """haftanın CYCLES_PER_WEEK döngüsü: üretim, takas, ödeme, ücret, kira, kapanış."""
    INS_ON = W.INS_ON
    INV_ON = W.INV_ON
    L = W.L
    LIQ_ON = W.LIQ_ON
    WELF_ON = W.WELF_ON
    ad_pay_ema = W.ad_pay_ema
    ad_rev_all = W.ad_rev_all
    ad_w = W.ad_w
    ad_week = W.ad_week
    arge_boost = W.arge_boost
    arge_spent = W.arge_spent
    bf_stat = W.bf_stat
    cities = W.cities
    closed = W.closed
    cov = W.cov
    dep_tot = W.dep_tot
    firms = W.firms
    freight_cap = W.freight_cap
    fwage = W.fwage
    fwk_prod = W.fwk_prod
    fwk_uns = W.fwk_uns
    gate = W.gate
    hab = W.hab
    held = W.held
    inq_acc = W.inq_acc
    ins = W.ins
    inv_stat = W.inv_stat
    jobless_c = W.jobless_c
    jval = W.jval
    kind_stats = W.kind_stats
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    lvl_cat = W.lvl_cat
    lvl_n = W.lvl_n
    media_save = W.media_save
    media_stat = W.media_stat
    media_w = W.media_w
    miss_item = W.miss_item
    miss_reason = W.miss_reason
    missed = W.missed
    npcpov = W.npcpov
    occ = W.occ
    orep = W.orep
    own_p = W.own_p
    own_u = W.own_u
    owner_rec = W.owner_rec
    people = W.people
    prod_w = W.prod_w
    qseg_stat = W.qseg_stat
    rent_pot = W.rent_pot
    rev_lb = W.rev_lb
    rev_lc = W.rev_lc
    segd_w = W.segd_w
    sh_req = W.sh_req
    sh_share = W.sh_share
    skillw = W.skillw
    stat_from = W.stat_from
    stats = W.stats
    unemp = W.unemp
    unsold_w = W.unsold_w
    wf_claim = W.wf_claim
    wf_eff = W.wf_eff
    wf_g = W.wf_g
    wf_ins = W.wf_ins
    wf_paid_w = W.wf_paid_w
    wf_payroll = W.wf_payroll
    wf_stat = W.wf_stat
    wf_week = W.wf_week
    worked = W.worked
    AHIR_KAMU = W.AHIR_KAMU
    LD_VER = W.LD_VER
    for cyc in range(CYCLES_PER_WEEK):
        phase_cycle_open(W)
        phase_cycle_plan(W, w, cyc)
        phase_cycle_demand(W)
        phase_cycle_match(W, weeks)
        phase_cycle_buy(W, cyc)
        phase_cycle_pay(W)
        phase_cycle_welfare(W)
        phase_cycle_close(W, w)
