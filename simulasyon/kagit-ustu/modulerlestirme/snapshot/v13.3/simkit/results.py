"""simkit.results: koşu sonucu R'nin derlenmesi (plan v2 adım 5; World.results()).

AMAÇ: run() sonundaki `inn_out`, `spend_diag` ve `return dict(k185=..., k183=..., ...)` bölümünün aynen taşınmış hali. Metin kesme-yapıştırma;
ifadeler bayt bayt aynı. Sonuç sözleşmesi (R anahtar kümesi, iki düzey) `golden/results_keys.json` ve `tools/results_keys.py` ile donmuştur.
ARAYÜZ: results(W) -> dict (World alanlarını okur; salt okunur, durum DEĞİŞTİRMEZ).
KATMAN: world üstü (yalnız simkit.params okur).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.entry_open_meas import eo_results
from simkit.young_meas import yk_results
from simkit.cash_meas import kk_results


def results(W):
    """Koşu sonucu R: dönüş sözleşmesi (anahtar kümesi golden/results_keys.json). World alanlarını eski adlarıyla okur."""
    ANCH = W.ANCH
    FEES = W.FEES
    FPM = W.FPM
    FRONTQ = W.FRONTQ
    KD = W.KD
    KQ = W.KQ
    L = W.L
    PATS = W.PATS
    PUBQ = W.PUBQ
    RENT_CY = W.RENT_CY
    REP = W.REP
    RM = W.RM
    RWI = W.RWI
    V2K = W.V2K
    V2SNAP = W.V2SNAP
    ad_rev_all = W.ad_rev_all
    ad_rev_m = W.ad_rev_m
    ad_stat = W.ad_stat
    arge_boost = W.arge_boost
    arge_spent = W.arge_spent
    bf_stat = W.bf_stat
    bond_hist = W.bond_hist
    bond_stat = W.bond_stat
    bonds = W.bonds
    capex_stat = W.capex_stat
    capex_ts = W.capex_ts
    chain = W.chain
    chain_sh = W.chain_sh
    cities = W.cities
    closed = W.closed
    closed_at = W.closed_at
    cons_ts = W.cons_ts
    cost_stat = W.cost_stat
    cov = W.cov
    cx_ref = W.cx_ref
    cx_stat = W.cx_stat
    dao_all = W.dao_all
    dao_con = W.dao_con
    dao_info = W.dao_info
    dao_pay = W.dao_pay
    dao_tel = W.dao_tel
    dep_ema = W.dep_ema
    dep_rate_w = W.dep_rate_w
    dep_slow = W.dep_slow
    dep_tot = W.dep_tot
    deposits = W.deposits
    edu_hist = W.edu_hist
    edu_lvl = W.edu_lvl
    edu_stat = W.edu_stat
    eq_by = W.eq_by
    eq_cap = W.eq_cap
    eq_log = W.eq_log
    eq_px = W.eq_px
    eq_stat = W.eq_stat
    fee_hist = W.fee_hist
    fee_inc = W.fee_inc
    firms = W.firms
    fp_disp = W.fp_disp
    fstat = W.fstat
    gate = W.gate
    grade_log = W.grade_log
    green = W.green
    grp_stat = W.grp_stat
    hab = W.hab
    haz = W.haz
    hdev_stat = W.hdev_stat
    hdev_ts = W.hdev_ts
    health_hist = W.health_hist
    health_stat = W.health_stat
    held = W.held
    house_ts = W.house_ts
    hratio = W.hratio
    hs = W.hs
    hst = W.hst
    inc_ema = W.inc_ema
    ins = W.ins
    ins_hist = W.ins_hist
    ins_stat = W.ins_stat
    inv_stat = W.inv_stat
    inv_ts = W.inv_ts
    jval = W.jval
    k185_ts = W.k185_ts
    kcity = W.kcity
    kind_stats = W.kind_stats
    kw = W.kw
    lic_hist = W.lic_hist
    liq_stat = W.liq_stat
    lo_members = W.lo_members
    loans = W.loans
    lonca_info = W.lonca_info
    lonca_log = W.lonca_log
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    lvl_cat = W.lvl_cat
    lvl_n = W.lvl_n
    media_log = W.media_log
    media_series = W.media_series
    media_stat = W.media_stat
    mem_hist = W.mem_hist
    mgr_stat = W.mgr_stat
    mint_allow_tot = W.mint_allow_tot
    miss_item = W.miss_item
    miss_reason = W.miss_reason
    missed = W.missed
    mono = W.mono
    mortgages = W.mortgages
    mprof = W.mprof
    new_slots = W.new_slots
    nl_dbg = W.nl_dbg
    npc_log = W.npc_log
    orep = W.orep
    orep_hist = W.orep_hist
    own = W.own
    owner_rec = W.owner_rec
    path_log = W.path_log
    people = W.people
    player_firms = W.player_firms
    pol_hist = W.pol_hist
    priv_log = W.priv_log
    priv_q = W.priv_q
    priv_stat = W.priv_stat
    priv_ts = W.priv_ts
    prof_ema = W.prof_ema
    qseg_stat = W.qseg_stat
    rent_by_player = W.rent_by_player
    rent_hist = W.rent_hist
    rent_owner = W.rent_owner
    rent_run = W.rent_run
    rent_spells = W.rent_spells
    rent_tot = W.rent_tot
    res_spent = W.res_spent
    segd_ema = W.segd_ema
    sh_price = W.sh_price
    sh_stat = W.sh_stat
    skillw = W.skillw
    stats = W.stats
    switches = W.switches
    tech_events = W.tech_events
    tech_paths = W.tech_paths
    telif_br = W.telif_br
    telif_in = W.telif_in
    telif_mx = W.telif_mx
    tour_stat = W.tour_stat
    trade = W.trade
    unemp = W.unemp
    weekly = W.weekly
    wf_eff = W.wf_eff
    wf_g = W.wf_g
    wf_hist = W.wf_hist
    wf_stat = W.wf_stat
    worked = W.worked
    xr_hist = W.xr_hist
    young_stat = W.young_stat
    FRONT = W.FRONT
    KN = W.KN
    PUB = W.PUB
    TOPO = W.TOPO
    inn_out = dict(REP=dict(REP), inc=dict(inc_ema), dao_all=list(dao_all), dao_info=dao_info, KD=KD, res_spent=dict(res_spent), dao_tel=dict(dao_tel), dao_con=dict(dao_con), dao_pay=dict(dao_pay),
                   lonca_owner=dict(lonca_owner), telif_mx=dict(telif_mx), telif_br=dict(telif_br), mono=mono, xr_hist=xr_hist, lic_hist=lic_hist, mem_hist=mem_hist, unemp=dict(unemp), RWI=dict(RWI), PATS={b_: list(v_) for b_, v_ in PATS.items()},
                   own={k_: dict(v_) for k_, v_ in own.items()}, deposits={q_: v_[1] for q_, v_ in deposits.items()}, worked=dict(worked), skillw=dict(skillw), ANCH=dict(ANCH), owner_rec=dict(owner_rec), hab=dict(hab), jval=dict(jval), loncas=list(loncas), new_slots=set(new_slots), lonca_info=dict(lonca_info), lonca_log=list(lonca_log), grp_stat=list(grp_stat), arge_boost=dict(arge_boost), telin={k_: v_ for k_, v_ in telif_in.items()}, arge_sp=dict(arge_spent), held={p_: dict(v_) for p_, v_ in held.items()}, sh_price=dict(sh_price), sh_stat=dict(sh_stat), cost_stat=dict(cost_stat), bf_stat=dict(bf_stat), lo_members=dict(lo_members), lvl_cat=dict(lvl_cat), lvl_n=dict(lvl_n), kw=dict(kw), kcity=dict(kcity), closed=set(closed), closed_at=dict(closed_at), fee_hist=fee_hist, fee_inc=dict((k_, v_) for k_, v_ in fee_inc.items() if isinstance(k_, str)), switches=dict(switches), mgr_stat=mgr_stat, FEES=dict(FEES), PUB=dict(PUB), FRONT=dict(FRONT), cap_hist=None)
    _pl = sorted((q for q, i_ in people.items() if i_["who"] == "oyuncu"), key=lambda q: L.bal[q] + (deposits[q][1] if q in deposits else 0.0))
    spend_diag = []
    for _k in range(10):
        _g = _pl[_k * len(_pl) // 10:(_k + 1) * len(_pl) // 10]
        if _g:
            spend_diag.append((_k + 1, sum(L.bal[q] + (deposits[q][1] if q in deposits else 0.0) for q in _g) / len(_g), sum(inc_ema.get(q, 0.0) for q in _g) / len(_g), sum(hab.get(q, 0.0) for q in _g) / len(_g)))
    R = dict(k185=dict(gate=dict(gate), npc_log=list(npc_log), ts=k185_ts, mint_allow=mint_allow_tot, inv_stat=dict(inv_stat), inv_ts=list(inv_ts), chain={k_: dict(v_) for k_, v_ in chain.items()}, chain_sh={k_: list(v_) for k_, v_ in chain_sh.items()}, cons_ts=list(cons_ts), health_stat=dict(health_stat), health_hist=list(health_hist), edu_stat=dict(edu_stat), edu_hist=list(edu_hist), edu_lvl=dict(edu_lvl), young_stat=dict(young_stat), ins_hist=list(ins_hist), ins_stat=dict(ins_stat), ins={k_: dict(v_) for k_, v_ in ins.items()}, liq_stat=dict(liq_stat), hdev_stat=dict(hdev_stat), hdev_ts=list(hdev_ts), capex_ts=list(capex_ts), capex_stat=dict(capex_stat), pol_hist=list(pol_hist), bond_stat=dict(bond_stat), bond_hist=list(bond_hist), bonds_out=sum(b_['out'] for b_ in bonds), cut=dict(L.cut), cx_ref=dict(cx_ref), spend_diag=spend_diag, priv_stat=dict(priv_stat), priv_log=list(priv_log), priv_ts=list(priv_ts), priv_open=len(priv_q), priv_firms={f_: dict(d_.get('priv', {}), dead=bool(d_.get('dead')), prof=d_.get('prof', 0.0), n=len(d_['workers'])) for f_, d_ in firms.items() if d_.get('priv')}, wf_hist=list(wf_hist), wf_stat=dict(wf_stat), wf_g=dict(wf_g), wf_eff=dict(wf_eff)), k183=dict(fp_disp=fp_disp, qseg=dict(qseg_stat), rent_owner=dict(rent_owner), rent_by_player=dict(rent_by_player), rent_tot=dict(rent_tot), rent_hist=dict(rent_hist), rent_spells=dict(rent_spells), rent_run=dict(rent_run),
                     fstat=dict(fstat), nl_dbg=dict(nl_dbg), orep=dict(orep), FRONT=dict(FRONT), media_series=media_series, lonca_info={k_: dict(v_) for k_, v_ in lonca_info.items()}, closed=set(closed), ad_stat=dict(ad_stat), ad_rev_m=dict(ad_rev_m), ad_rev_all=dict(ad_rev_all), grade_log=dict(grade_log), path_log=dict(path_log), FRONTQ=dict(FRONTQ), PUBQ=dict(PUBQ), KQ=KQ, FPM=dict(FPM), segd=dict(segd_ema), v2k=V2K, v2snap=V2SNAP), inn=inn_out, tour_stat=dict(tour_stat), KN=dict(KN), arge_spent=arge_spent, telif_in=telif_in, tech_events=tech_events, tech_paths=dict(tech_paths), green=green[0], L=L, weekly=weekly, firms=firms, people=people, cities=cities, stats=stats, kind_stats=kind_stats,
                house=dict(hs=dict(hs), own={k_: dict(v_) for k_, v_ in own.items()}, RM=dict(RM), rent=dict(RENT_CY), ratio=dict(hratio), ts=list(house_ts), st=dict(hst), dep_ema=dict(dep_ema), dep_rate=dict(dep_rate_w), dep_slow=dep_slow[0]), media=dict(log=list(media_log), stat=dict(media_stat), mprof=dict(mprof), owners={f_: d_.get('org_owner') for f_, d_ in firms.items() if d_['kind'] == 'medya'}), cx=dict(stat=dict(cx_stat), mort=[dict(m) for m in mortgages]), orep=dict(orep), orep_hist=list(orep_hist), eq=dict(haz=dict(haz), by={f_: {q_: dict(h_) for q_, h_ in hh_.items()} for f_, hh_ in eq_by.items()}, log=list(eq_log), px=dict(eq_px), prof=dict(prof_ema), cap=dict(eq_cap), stat=dict(eq_stat)), credit=dict(out=sum(l_['out'] for l_ in loans.values()), n=len(loans), dep=sum(dep_tot.values()), ndep=sum(1 for v in deposits.values() if v[1] > 1), pool=sum(L.bal[f'{lo}_sermaye'] for lo in loncas)), missed=missed, miss_reason=miss_reason, miss_item=miss_item, cov=dict(cov), trade=trade, player_firms=player_firms)
    R["rt"] = dict(BASKET=BASKET, BRAND=W.BRAND, BRANCHES=BRANCHES, FRONT=W.FRONT, HW_STATE=W.HW_STATE, LAND=W.LAND, LOG_MULT=W.LOG_MULT, MARKET_MARKUP=W.MARKET_MARKUP, MM_BASE=W.MM_BASE, MODA_STATE=W.MODA_STATE, PM=W.PM, RECIPES=W.RECIPES, REF=W.REF, SW_STATE=W.SW_STATE, TAXV=W.TAXV, TOPO=TOPO, TOUR_STATE=W.TOUR_STATE, WI=W.WI)      # adım 8: rapor işlevlerinin okuduğu çalışma zamanı durumu (aynı nesneler; MARKET_MARKUP skaler)
    _ts = getattr(W, "tsup", None) if TRANS_SUPPORT else None
    if _ts is not None:
        R["tsup"] = dict(given=_ts["given"], ret=_ts["ret"], hist=list(_ts["hist"]), by_kind={k_: list(v_) for k_, v_ in _ts["by_kind"].items()}, cap_bind=_ts["cap_bind"], floor_bind=_ts["floor_bind"])                     # K-211: yalnız bayrak açıkken (R sözleşmesi kapalıyken aynı)
    _sb = getattr(W, "board", None) if SECTOR_BOARD else None
    if _sb is not None:
        R["sbrd"] = dict(stat=dict(getattr(W, "sb_stat", {}) or {}), prod=dict(_sb["prod"]), fh=dict(_sb["fh"]))                     # K-212: yalnız bayrak açıkken
    if ENTRY_OPEN or ENTRY_EXP:
        R["eo"] = eo_results(W)                                                                                                      # K-213: yalnız bayrak açıkken
    if YOUNG_KIT or FOUND_FUND:
        R["yk"] = yk_results(W)                                                                                                      # K-215/K-216: yalnız bayrak açıkken
    if TREASURY_RULE or PROFIT_KEEP:
        R["kk"] = kk_results(W)                                                                                                      # K-219/K-220: yalnız bayrak açıkken
    return R
