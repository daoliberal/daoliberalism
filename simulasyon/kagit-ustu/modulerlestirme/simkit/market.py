"""simkit.market: piyasa takası: clear, clear_fp, sözleşme ödemesi, telif ödemesi, DAO ölümleri.

ARAYÜZ: pay_telif, clear, clear_fp, contract_pay, dao_deaths
OKUR/YAZAR: W.cities, W.firms, W.L; W.carriers_of (yayın).
KATMAN: L3.
"""
from collections import defaultdict
import math
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.trace import trace
from simkit.credit_core import lo_kayip_yaz, take_fee
from simkit.dao_core import live_daos
from simkit.econ_core import freight
from simkit.sector_core import sb_split_row
from simkit.young_core import yk_rep_seen


def pay_telif(W, sname, seller, paid):
    """K-134 / K-167: lisanslı firmanın satış telifi. INNOV_ON: oran üyelik durumuna göre (üye = dış oranın 1/3'ü), alıcı DAO (ya da batmışsa lonca); DAO loncaya fee öder."""
    L = W.L
    cities = W.cities
    dao_tel = W.dao_tel
    firms = W.firms
    telif_br = W.telif_br
    telif_in = W.telif_in
    telif_mx = W.telif_mx
    xrate = W.xrate
    h = seller["lic"]
    if not INNOV_ON:
        telif_in[h] += L.pay(sname, h, paid * TELIF, "telif")
        return
    rate_ = xrate.get((seller.get("lic_n"), BRANCH[seller["kind"]]), TELIF_X0) * (TELIF_MEMBER_RATIO if seller.get("lic_mem") else 1.0)
    amt = L.pay(sname, h, paid * rate_, "telif_uye" if seller.get("lic_mem") else "telif_dis")
    telif_in[h] += amt
    hc = firms[h]["city"] if h in firms else int(h[5:]) % len(cities)
    telif_mx[(seller["city"], hc)] += amt
    telif_br[BRANCH[seller["kind"]]] += amt
    if h in firms:
        dao_tel[h] += amt
        telif_in[firms[h]["lonca"]] += amt
        take_fee(W, h, firms[h]["lonca"], amt)


def clear(W, product, supply, demand, bkind):
    """TAKAS (K-99, K-110): supply = şehir -> [[firm, qty]], demand = şehir -> [[buyer, qty]]. Her alıcı şehir, teslim
    fiyatı (satıcı şehir fiyatı + navlun) en düşük satıcıdan başlar; satıcı şehre gelen talep kapasiteyi aşarsa orantılı.
    Ödeme: alıcı → satıcı (satıcı şehrin fiyatı); şehirler arasıysa navlun satıcı şehre. Teslim edilen birim ve maliyet döner."""
    BRAND = W.BRAND
    L = W.L
    PRICE = W.PRICE
    REF = W.REF
    carriers_of = W.carriers_of
    cities = W.cities
    contracts = W.contracts
    firms = W.firms
    freight_cap = W.freight_cap
    kind_stats = W.kind_stats
    rev_lb = W.rev_lb
    rev_lc = W.rev_lc
    short_units = W.short_units
    short_val = W.short_val
    stats = W.stats
    tour_stat = W.tour_stat
    trade = W.trade
    w_ctx = W.w_ctx
    want_units = W.want_units
    got = defaultdict(float)
    cost = defaultdict(float)
    n = len(cities)
    want_units[product] += sum(q for lst in demand.values() for _, q in lst)
    stats["in_want"][(product, bkind)] += sum(q for lst in demand.values() for _, q in lst)
    avail = {j: sum(q for _, q in supply.get(j, [])) for j in range(n)}
    blocked_seen = set()
    if CONTRACT_N > 0 and contracts:
        for ci in range(n):                                                 # K-166: sözleşmeli miktar, orantılı paylaşımdan önce ve sabit fiyatla verilir
            for b in demand.get(ci, []):
                ct = contracts.get(b[0], {}).get(product)
                if not ct or w_ctx[0] > ct["until"] or b[1] <= 1e-12:
                    continue
                j = ct["j"]
                if avail[j] <= 1e-12:
                    continue
                dist = abs(j - ci)
                nav_unit = freight(W, j, product, dist)
                take = min(b[1], avail[j])
                if dist and nav_unit > 0:
                    take = min(take, freight_cap[j] / nav_unit)
                if take <= 1e-12:
                    continue
                price = ct["price"]
                unit = price + nav_unit
                afford = min(1.0, L.bal[b[0]] / (take * unit)) if take * unit > 0 else 1.0
                take *= afford
                if take <= 1e-12:
                    continue
                for s_ in list(supply.get(j, [])):
                    part = take * s_[1] / avail[j]
                    if part <= 1e-12:
                        continue
                    paid = L.pay(b[0], s_[0], part * price, "satis_yerli" if dist == 0 else "satis_sehirlerarasi")
                    seller = firms[s_[0]]
                    fee = take_fee(W, s_[0], seller["lonca"], paid)
                    kind_stats[seller["kind"]]["rev"] += paid - fee
                    rev_lc[(seller["lonca"], seller["city"])] += paid
                    if ARGE_ON and seller["kind"] in BRANCH:
                        rev_lb[(seller["lonca"], BRANCH[seller["kind"]])] += paid
                        if seller.get("lic"):
                            pay_telif(W, s_[0], seller, paid)
                    cities[j]["last_sold"][product] += paid / price
                    if dist:
                        trade[(j, ci)] += paid
                        cities[ci]["imp_val"] += paid
                        cities[j]["exp_val"] += paid
                        cities[ci]["last_imports"][product] += paid
                        stats["imported"][product] += paid
                    else:
                        stats["local"][product] += paid
                if dist:
                    fr = take * nav_unit
                    carriers = carriers_of[j]
                    tot_c = sum(nw for _, nw in carriers) or 1
                    paid_fr = 0.0
                    for cf, nw in carriers:
                        pr = L.pay(b[0], cf, fr * nw / tot_c, "navlun")
                        paid_fr += pr
                        fee_c = take_fee(W, cf, firms[cf]["lonca"], pr)
                        kind_stats["lojistik"]["rev"] += pr - fee_c
                    freight_cap[j] = max(0.0, freight_cap[j] - fr)
                    cities[j]["freight_w"] += paid_fr
                    cities[j]["freight_want_w"] += fr
                    stats["freight_used"] += fr
                av0 = avail[j]
                for s_ in supply.get(j, []):
                    s_[1] -= take * s_[1] / av0
                avail[j] = max(0.0, av0 - take)
                got[b[0]] += take
                cost[b[0]] += take * unit
                b[1] -= take
    for _ in range(3 * n):
        need = {ci: sum(q for _, q in demand.get(ci, [])) for ci in range(n)}
        req = {}
        for ci in range(n):
            if need[ci] <= 1e-12:
                continue
            for j in range(n):                                              # K-119: kapasitesiz şehirdeki engellenen talep de kadro sinyalidir
                if j != ci and avail[j] > 1e-12 and freight_cap[j] <= 1e-9 and product not in NO_FREIGHT and (ci, j) not in blocked_seen:
                    blocked_seen.add((ci, j))
                    cities[j]["freight_want_w"] += 0.25 * min(need[ci], avail[j]) * freight(W, j, product, abs(j - ci))
            opts = [j for j in range(n) if avail[j] > 1e-12 and (j == ci or product not in LOCAL_ONLY) and (j == ci or freight_cap[j] > 1e-9 or product in NO_FREIGHT)]     # K-119: navlun kapasitesi biten şehirden şehirler arası satış olmaz
            if not opts:
                continue
            max_rep = max(cc["rep"] for cc in cities)
            tp = (lambda x: REF[product] * TOUR_PREF * max(0.0, max_rep - cities[x]["rep"]) / 100.0) if product == "konaklama" else (
                (lambda x: REF[product] * MODA_PREF * max(0.0, max(BRAND.values()) - BRAND.get(x, 0.0))) if product == "moda" else (lambda x: 0.0))    # K-138: turist itibarlı şehri tercih eder; K-147: tüketici markalı şehrin modasını tercih eder
            j = min(opts, key=lambda x: (PRICE[(x, product)] + freight(W, x, product, abs(x - ci)) + tp(x), abs(x - ci)))
            req[(ci, j)] = need[ci]
        if not req:
            break
        tot_req = defaultdict(float)
        for (ci, j), q in req.items():
            tot_req[j] += q
        scale_of = {}                                                       # K-122: yakın alıcı önce (mesafe kademesi); aynı mesafede orantılı (şehir sırasından bağımsız)
        for j in range(n):
            left = avail[j]
            by_d = defaultdict(list)
            for (ci, jj), q in req.items():
                if jj == j:
                    by_d[abs(j - ci)].append(((ci, jj), q))
            for d_ in sorted(by_d):
                tier = by_d[d_]
                tq = sum(q for _, q in tier)
                sc = min(1.0, left / tq) if tq > 0 else 1.0
                for key, _ in tier:
                    scale_of[key] = sc
                left = max(0.0, left - tq * sc)
        moved = 0.0
        sold_by = defaultdict(float)
        for (ci, j), q in req.items():
            dist = abs(j - ci)
            scale_j = scale_of[(ci, j)]
            take = q * scale_j
            price = PRICE[(j, product)]
            nav_unit = freight(W, j, product, dist)
            if dist and nav_unit > 0:
                cities[j]["freight_want_w"] += (take - min(take, freight_cap[j] / nav_unit)) * nav_unit     # taşınamayan talep de kadro sinyalidir
                take = min(take, freight_cap[j] / nav_unit)            # lojistik kapasitesi sınırlar
                if take <= 1e-12:
                    continue
            sup = supply.get(j, [])
            dem = demand.get(ci, [])
            for b in dem:
                share = take * b[1] / q if q > 0 else 0.0
                if share <= 1e-12:
                    continue
                unit = price + nav_unit
                afford = min(1.0, L.bal[b[0]] / (share * unit)) if b[0] not in L.city_accounts and share * unit > 0 else 1.0
                if afford < 0.999:
                    L.events.append(f"YETMEDİ alım: {b[0]} {product} {share:.1f} birimin %{afford * 100:.0f}'i")
                b[1] -= share * (1 - afford)                  # parasız talep piyasa eksiği sayılmaz (etkin talep)
                share *= afford
                if share <= 1e-12:
                    continue
                for s_ in sup:
                    part = share * s_[1] / avail[j]
                    if part <= 1e-12:
                        continue
                    paid = L.pay(b[0], s_[0], part * price, "satis_yerli" if dist == 0 else "satis_sehirlerarasi")
                    seller = firms[s_[0]]
                    if s_[0] == DEBUG_FIRM:
                        trace(W, f"      SAT {product} paid={paid:.1f} price={price:.2f} units={paid/price:.1f}")
                    fee = take_fee(W, s_[0], seller["lonca"], paid)
                    kind_stats[seller["kind"]]["rev"] += paid - fee
                    if product == "konaklama":
                        tour_stat[("gelir", j)] += paid
                        if dist:
                            tour_stat[("turist", j)] += paid                 # başka şehirden gelen konaklama geliri
                    rev_lc[(seller["lonca"], seller["city"])] += paid
                    if ARGE_ON and seller["kind"] in BRANCH:
                        rev_lb[(seller["lonca"], BRANCH[seller["kind"]])] += paid
                        if seller.get("lic"):                    # K-134, K-37: lisanslı firma satıştan telif öder (sahip loncaya)
                            pay_telif(W, s_[0], seller, paid)
                    units = paid / price
                    cities[j]["last_sold"][product] += units
                    if dist:
                        trade[(j, ci)] += paid
                        cities[ci]["imp_val"] += paid
                        cities[j]["exp_val"] += paid
                        cities[ci]["last_imports"][product] += paid
                        stats["imported"][product] += paid
                    else:
                        stats["local"][product] += paid
                if dist:
                    fr = share * nav_unit
                    carriers = carriers_of[j]
                    tot_c = sum(nw for _, nw in carriers) or 1
                    paid_fr = 0.0
                    for cf, nw in carriers:
                        pr = L.pay(b[0], cf, fr * nw / tot_c, "navlun")
                        paid_fr += pr
                        fee_c = take_fee(W, cf, firms[cf]["lonca"], pr)
                        kind_stats["lojistik"]["rev"] += pr - fee_c
                    freight_cap[j] = max(0.0, freight_cap[j] - fr)
                    cities[j]["freight_w"] += paid_fr
                    cities[j]["freight_want_w"] += fr
                    stats["freight_used"] += fr
                if b[0] == DEBUG_FIRM:
                    trace(W, f"      ALIM {product} share={share:.2f} unit={unit:.3f} cost={share*unit:.1f}")
                got[b[0]] += share
                cost[b[0]] += share * unit
                b[1] -= share
                sold_by[j] += share
                moved += share
        for j, sd in sold_by.items():
            av = avail[j]
            for s_ in supply.get(j, []):
                s_[1] -= sd * s_[1] / av
            avail[j] = max(0.0, av - sd)
        if moved <= 1e-9:
            break
    for ci in range(n):
        tot_want = 0.0
        rem = sum(q for _, q in demand.get(ci, []))
        if rem > 1e-9:
            stats["in_short"][(product, bkind)] += rem
            short_units[product] += rem
            short_val[product] += rem * REF[product]
    return got, cost


def clear_fp(W, product, supply, demand, bkind):
    """K-183.1: FİRMA FİYATLI TAKAS. Her satıcı kendi fiyatını koyar (şehir referansı × firma çarpanı). Alıcı grubu (şehir × hane katmanı ya da şehir × firma) satıcıları
    skorla seçer: -w_fiyat·ln(teslim fiyatı / referans) + w_kalite·kalite + w_itibar·(itibar-50)/100; pay = exp(skor) ile orantılı (satıcı ve navlun kapasitesiyle sınırlı,
    taşan talep sonraki turda kalan satıcılara yeniden bölünür). Sıra-bağımsız: tüm alıcılar aynı turda orantılı ölçeklenir, ödemeler tur sonunda toplu yapılır.
    demand: şehir -> [[alıcı, miktar] ya da [alıcı, miktar, katman]]. Döner: got, cost, segrec[(şehir, katman)] = [birim, maliyet, kalite×birim], qrec[alıcı] = [birim, kalite×birim]."""
    BRAND = W.BRAND
    FPM = W.FPM
    L = W.L
    PRICE = W.PRICE
    REF = W.REF
    carriers_of = W.carriers_of
    cities = W.cities
    fbuy = W.fbuy
    firms = W.firms
    freight_cap = W.freight_cap
    frev = W.frev
    fsold = W.fsold
    kind_stats = W.kind_stats
    orep = W.orep
    rev_lb = W.rev_lb
    rev_lc = W.rev_lc
    short_units = W.short_units
    short_val = W.short_val
    stats = W.stats
    tour_stat = W.tour_stat
    trade = W.trade
    want_units = W.want_units
    n = len(cities)
    got, cost = defaultdict(float), defaultdict(float)
    segrec = defaultdict(lambda: [0.0, 0.0, 0.0])
    qrec = defaultdict(lambda: [0.0, 0.0])
    tot_dem = sum(b[1] for lst in demand.values() for b in lst)
    want_units[product] += tot_dem
    stats["in_want"][(product, bkind)] += tot_dem
    refp = REF[product]
    # satıcılar
    sl = []                                                     # [firma, şehir, fiyat, kalite, itibar, kalan, supply kaydı]
    for j in range(n):
        for s_ in supply.get(j, []):
            if s_[1] > 1e-12:
                f_ = s_[0]
                d_ = firms[f_]
                sl.append([f_, j, PRICE[(j, product)] * FPM.get(f_, 1.0), d_.get("q", QDEF), ((yk_rep_seen(W, f_, d_, orep.get(f_, 50.0)) if YOUNG_KIT else orep.get(f_, 50.0)) if ORG_ACT else 50.0), s_[1], s_])
    avail = [0.0] * n
    for s in sl:
        avail[s[1]] += s[5]
    # alıcı grupları: (şehir, katman) ; katman -1 = firma alıcı
    groups = {}
    for ci in range(n):
        for b in demand.get(ci, []):
            if b[1] <= 1e-12:
                continue
            key = (ci, b[2] if len(b) > 2 else -2)
            groups.setdefault(key, []).append(b)
    gkeys = sorted(groups)
    blocked_seen = set()
    for (ci, sg) in gkeys:                                       # K-119: kapasitesiz şehirdeki engellenen talep kadro sinyalidir
        need_ = sum(b[1] for b in groups[(ci, sg)])
        for j in range(n):
            if j != ci and avail[j] > 1e-12 and freight_cap[j] <= 1e-9 and product not in NO_FREIGHT and (ci, j) not in blocked_seen:
                blocked_seen.add((ci, j))
                cities[j]["freight_want_w"] += 0.25 * min(need_, avail[j]) * freight(W, j, product, abs(j - ci))
    max_rep = max(cc["rep"] for cc in cities)
    if product == "konaklama":
        tp = lambda x: refp * TOUR_PREF * max(0.0, max_rep - cities[x]["rep"]) / 100.0
    elif product == "moda":
        tp = lambda x: refp * MODA_PREF * max(0.0, max(BRAND.values()) - BRAND.get(x, 0.0))
    else:
        tp = lambda x: 0.0
    # ağırlık matrisi (tur bağımsız)
    WM = {}
    navs = {}
    for key in gkeys:
        ci, sg = key
        wp, wq, wr = SEG_W[sg] if sg >= 0 else FIRM_WG[-1 - sg]
        row = []
        for si, s in enumerate(sl):
            j = s[1]
            if not (j == ci or (product not in LOCAL_ONLY and (freight_cap[j] > 1e-9 or product in NO_FREIGHT))):
                row.append(0.0)
                continue
            nav = freight(W, j, product, abs(j - ci)) if j != ci else 0.0
            navs[(si, ci)] = nav
            dp = s[2] + nav + tp(j)
            row.append(math.exp(-wp * math.log(max(1e-9, dp) / refp) + wq * s[3] + wr * (s[4] - 50.0) / 100.0))
        if SECTOR_BOARD and sg < 0:
            row = sb_split_row(W, sl, row, product)          # K-212: sağlıksız baskın tedarikçinin payı %75'e kısılır, kalanı ikinci kaynağa
        mx = max(row) if row else 0.0
        WM[key] = [(a / mx if a / mx >= FP_PRUNE else 0.0) if mx > 0 else 0.0 for a in row]
    rem_g = {key: sum(b[1] for b in groups[key]) for key in gkeys}
    cap_left = dict(freight_cap)
    acc = defaultdict(float)                                    # (alıcı, satıcı idx) -> teslim miktar
    spent = defaultdict(float)
    for _round in range(6):
        req = {}
        for key in gkeys:
            if rem_g[key] <= 1e-12:
                continue
            row = WM[key]
            tot = 0.0
            for si, a in enumerate(row):
                if a > 0 and sl[si][5] > 1e-12 and (sl[si][1] == key[0] or cap_left[sl[si][1]] > 1e-9 or product in NO_FREIGHT):
                    tot += a
            if tot <= 0:
                continue
            for si, a in enumerate(row):
                if a > 0 and sl[si][5] > 1e-12 and (sl[si][1] == key[0] or cap_left[sl[si][1]] > 1e-9 or product in NO_FREIGHT):
                    req[(key, si)] = rem_g[key] * a / tot
        if not req:
            break
        R = defaultdict(float)
        for (key, si), q in req.items():
            R[si] += q
        if KR_MEAS and _round == 0:                              # REKABET G17a: davranışsız ölçüm; sahipli firmaya yönelen ilk tur talep ve taşan (stok dahil arzı aşan) kısım, haftalık birikim
            hd_ = W.__dict__.get("hk_dem")
            if hd_ is None:
                hd_ = W.hk_dem = defaultdict(float)
                W.hk_sp = defaultdict(float)
            for si_, q_ in R.items():
                f_g = sl[si_][0]
                if firms[f_g].get("owner") is not None:
                    hd_[f_g] += q_
                    W.hk_sp[f_g] += max(0.0, q_ - sl[si_][5])
        trd = {}
        for (key, si), q in req.items():
            trd[(key, si)] = q * min(1.0, sl[si][5] / R[si])
        vj = defaultdict(float)                                 # navlun kapasitesi: şehirlerarası sevkiyat değeri
        for (key, si), q in trd.items():
            j = sl[si][1]
            if j != key[0]:
                vj[j] += q * navs[(si, key[0])]
        for j, v in vj.items():
            if v > cap_left[j] + 1e-12:
                sc = max(0.0, cap_left[j]) / v
                cities[j]["freight_want_w"] += (v - max(0.0, cap_left[j]))
                for (key, si) in list(trd):
                    if sl[si][1] == j and key[0] != j:
                        trd[(key, si)] *= sc
        moved = 0.0
        sold_s = defaultdict(float)
        bytr = defaultdict(list)
        for (key, si), q in trd.items():
            bytr[key].append((si, q))
        for key in gkeys:
            tr = bytr.get(key)
            if not tr:
                continue
            ci, sg = key
            gd = groups[key]
            rg = rem_g[key]
            taken_g = sum(q for _, q in tr)
            cst_g = sum(q * (sl[si][2] + navs.get((si, ci), 0.0)) for si, q in tr)
            for b in gd:
                if b[1] <= 1e-12:
                    continue
                frac = b[1] / rg
                taken_b = taken_g * frac
                if taken_b <= 1e-12:
                    continue
                b0 = b[0]
                if b0 not in L.city_accounts and cst_g * frac > 0:
                    afford = min(1.0, max(0.0, L.bal[b0] - spent[b0]) / (cst_g * frac))
                else:
                    afford = 1.0
                if afford < 0.999:
                    L.events.append(f"YETMEDİ alım: {b0} {product} {taken_b:.1f} birimin %{afford * 100:.0f}'i")
                b[1] -= taken_b * (1 - afford)
                ex_b = taken_b * afford
                spent[b0] += cst_g * frac * afford
                for si, q in tr:
                    part = q * frac * afford
                    if part <= 1e-12:
                        continue
                    acc[(b0, si, ci)] += part
                    sold_s[si] += part
                    moved += part
                    s = sl[si]
                    unit = s[2] + navs.get((si, ci), 0.0)
                    if s[1] != ci:
                        cap_left[s[1]] = max(0.0, cap_left[s[1]] - part * navs[(si, ci)])
                    got[b0] += part
                    cost[b0] += part * unit
                    qr = qrec[b0]
                    qr[0] += part
                    qr[1] += part * s[3]
                    sr = segrec[(ci, sg)]
                    sr[0] += part
                    sr[1] += part * unit
                    sr[2] += part * s[3]
                b[1] -= ex_b
            rem_g[key] = sum(b[1] for b in gd)
        for si, v in sold_s.items():
            sl[si][5] = max(0.0, sl[si][5] - v)
        if moved <= 1e-9:
            break
    # ödemeler (tur sonunda toplu): (alıcı, satıcı) başına tek ödeme
    fr_by = defaultdict(float)
    for (b0, si, ci), qty in acc.items():
        s = sl[si]
        f_, j, price = s[0], s[1], s[2]
        dist = abs(j - ci)
        seller = firms[f_]
        paid = L.pay(b0, f_, qty * price, "satis_yerli" if dist == 0 else "satis_sehirlerarasi")
        tax_h = 0.0
        if bkind == "hane_hizmet" and W.TAXV[0] > 0:                 # M15 (3): dogrudan hizmet KDV'si satici tarafinda (alici sehrine, market yolundaki satis_vergisi ile ayni oran ve kayit)
            tax_h = L.pay(f_, cities[ci]["acct"], paid * W.TAXV[0] / (1 + W.TAXV[0]), "satis_vergisi")
        fee = take_fee(W, f_, seller["lonca"], paid - tax_h)
        kind_stats[seller["kind"]]["rev"] += paid - tax_h - fee
        frev[f_] += paid
        fbuy[b0] += paid
        if product == "konaklama":
            tour_stat[("gelir", j)] += paid
            if dist:
                tour_stat[("turist", j)] += paid
        rev_lc[(seller["lonca"], seller["city"])] += paid
        if ARGE_ON and seller["kind"] in BRANCH:
            rev_lb[(seller["lonca"], BRANCH[seller["kind"]])] += paid
            if seller.get("lic"):
                pay_telif(W, f_, seller, paid)
        fsold[f_] += qty
        cities[j]["last_sold"][product] += paid / price
        if dist:
            trade[(j, ci)] += paid
            cities[ci]["imp_val"] += paid
            cities[j]["exp_val"] += paid
            cities[ci]["last_imports"][product] += paid
            stats["imported"][product] += paid
            fr_by[(b0, j)] += qty * navs[(si, ci)]
        else:
            stats["local"][product] += paid
    for (b0, j), fr in fr_by.items():
        carriers = carriers_of[j]
        tot_c = sum(nw for _, nw in carriers) or 1
        paid_fr = 0.0
        for cf, nw in carriers:
            pr = L.pay(b0, cf, fr * nw / tot_c, "navlun")
            fbuy[b0] += pr
            paid_fr += pr
            fee_c = take_fee(W, cf, firms[cf]["lonca"], pr)
            kind_stats["lojistik"]["rev"] += pr - fee_c
        freight_cap[j] = max(0.0, freight_cap[j] - fr)
        cities[j]["freight_w"] += paid_fr
        cities[j]["freight_want_w"] += fr
        stats["freight_used"] += fr
    for si, s in enumerate(sl):
        s[6][1] = s[5]                                          # supply kaydı kalan stoku taşır
    for ci in range(n):
        rem = sum(q for _, q, *_r in demand.get(ci, []))
        if rem > 1e-9:
            stats["in_short"][(product, bkind)] += rem
            short_units[product] += rem
            short_val[product] += rem * REF[product]
    return got, cost, segrec, qrec


def contract_pay(W, lo, pot):
    """K-167: lonca Ar-Ge payı üye DAO'lara araştırma sözleşmesi olarak gider (gider x CONTRACT_CAP'e kadar); artan Ar-Ge fonu lonca havuzuna."""
    L = W.L
    arge_spent = W.arge_spent
    dao_con = W.dao_con
    firms = W.firms
    orep = W.orep
    people = W.people
    pot_ema = W.pot_ema
    rev_lb = W.rev_lb
    pot_ema[lo] = 0.99 * pot_ema[lo] + 0.01 * pot
    mem = [n for n in live_daos(W) if firms[n]["lonca"] == lo and firms[n]["workers"]]
    wts = {}
    for n in mem:
        d = firms[n]
        tot_b = sum(rev_lb[(lo, b_)] for b_ in BRANCHES) + 1e-9
        wts[n] = (sum(people[q]["wage"] for q in d["workers"]) + ix(W, RENT)) * (0.5 + rev_lb[(lo, d["branch"])] / tot_b) * ((1.0 + ORG_CONTRACT_K * orep.get(n, 0.0) / 100.0) if ORG_ACT else 1.0)
    paid_tot = 0.0
    tw = sum(wts.values())
    for n in mem:
        d = firms[n]
        cap = (sum(people[q]["wage"] for q in d["workers"]) + ix(W, RENT)) * CONTRACT_CAP
        amt = min(cap, pot * wts[n] / tw)
        got = L.pay(lo, n, amt, "arge_sozlesmesi")
        dao_con[n] += got
        arge_spent[lo] += got
        paid_tot += got
    rest = pot - paid_tot
    if rest > 1e-9:
        L.pay(lo, f"{lo}_sermaye", rest, "arge_fonu")


def dao_deaths(W, w):
    L = W.L
    cities = W.cities
    dao_all = W.dao_all
    firms = W.firms
    last_dao_death = W.last_dao_death
    loans = W.loans
    neg = W.neg
    people = W.people
    tech_events = W.tech_events
    for n in list(dao_all):
        d = firms[n]
        if d.get("dead") or d["workers"]:
            continue
        cities[d["city"]]["firms"].remove(n)
        if n in loans:
            ln = loans.pop(n)
            seized = L.pay(n, f"{ln['lo']}_sermaye", min(L.bal[n], ln["out"]), "kredi_tasfiye")
            L.flows["dao_batis_kayip_akce"] += ln["out"] - seized
            lo_kayip_yaz(W, ln, ln["out"] - seized)                         # REKABET G5: LONCA_TERMS iken DAO batışındaki kredi kaybı loncanın kredi kaybına yazılır
            if KR_MEAS and ln.get("tur") == "kurulus":                  # REKABET G0: davranışsız ölçüm (kuruluş kredisi kaybı)
                W.lo_stat["ks_kayip"] += ln["out"] - seized
        L.pay(n, d["lonca"], L.bal[n], "batan_dao_kasasi")
        d["dead"] = True
        d["died"] = w
        L.flows["batan_dao_" + ("temerrut" if d.get("defaulted") else "ucret_odenemedi")] += 1
        o = d["owner"]
        if o in people:
            people[o]["dao_active"] = False
            neg[o] += REP_BANKRUPT
            L.flows["itibar_olayi_adet"] += 1
        last_dao_death[d["city"]] = w
        for d_ in firms.values():
            if d_.get("lic_n") == n:
                d_["lic"] = d["lonca"]
                d_["lic_mem"] = (d["lonca"] == d_["lonca"])
                d_["tech_next"] = 0
        L.flows["batan_dao_adet"] += 1
        tech_events.append(f"hafta {w}: Ar-Ge DAO {n} battı (patentleri {d['lonca']} loncasına geçti)")
