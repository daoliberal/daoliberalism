"""simkit.week_close: hafta kapanışı: kira, kredi, mevduat/tahvil, temettü, inovasyon kapanışı.

ARAYÜZ: phase_house_rent, phase_credit, phase_deposits, phase_dividends, phase_innov_end, dep_flight (PLAN-KREDI T5: DEP_ROUTE batık loncadan kademeli tam değerli taşıma)
OKUR/YAZAR: W.
KATMAN: L7.
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.lab_meas import lab_ev, human_cikis, human_batis
from simkit.credit_core import sp_week, fund_debt, lo_classes, dep_pick
from simkit.cash_core import PK_MULT
from simkit.cash_rules import tr_step
from simkit.credit_service import cx_credit_step, equity_step, mortgage_step, renew_reserve
from simkit.dao import orep_step, rep_week
from simkit.econ_core import working_capital
from simkit.fiscal import pay_owner_dividend, corp_tax_pay
from simkit.human import human_dep, human_dep_report, human_week_end
from simkit.firm_exit import liq_open, priv_end, priv_step
from simkit.firms import resale_step
from simkit.housing import house_dev, house_market
from simkit.labor import reputation
from simkit.market import dao_deaths
from simkit.media import media_step


def phase_house_rent(W):
    """hane kirası ve konut tasfiyesi (K-159)."""
    HBX_ON = W.HBX_ON
    L = W.L
    RM = W.RM
    cities = W.cities
    hs = W.hs
    occ = W.occ
    own = W.own
    people = W.people
    rent_pot = W.rent_pot
    LD_VER = W.LD_VER
    RENT_CY = W.RENT_CY
    WI = W.WI
    if HOUSE_ON:                                                  # K-159: konut: ev sahibi geliri, alım, inşaat, kira çarpanı
        for c in cities:
            ci = c["i"]
            tot_own = sum(own[ci].values())
            pot_ = L.bal[f"emanet{ci}"]
            if tot_own > 0 and hs[ci] > 0:
                for q_, u_ in list(own[ci].items()):
                    got_r = L.pay(f"emanet{ci}", q_, (1 - HOUSE_MAINT) * pot_ * u_ / hs[ci], "konut_kira_geliri")
                    if RENT_TAX > 0:
                        L.pay(q_, c["acct"], RENT_TAX * got_r, "kira_vergisi")
            L.pay(f"emanet{ci}", c["acct"], L.bal[f"emanet{ci}"], "konut_kirasi_sehir")      # bakım payı ve sahipsiz konutun kirası şehre
            rent_pot[ci] = 0.0
            unit_rent = RENT_CY[ci] * CYCLES_PER_WEEK
            price = unit_rent / HOUSE_YIELD
            rich = sorted((q_ for q_ in c["players"]), key=lambda q_: -L.bal[q_])[:HOUSE_BUY_MAX] if not HI_ACT else []
            if HI_ACT:
                house_market(W, ci, c, unit_rent)
                if HBX_ON:
                    house_dev(W, ci, c, unit_rent)
            for q_ in rich:
                keep = DEP_KEEP * people[q_]["wage"] * CYCLES_PER_WEEK
                if sum(own[ci].values()) < hs[ci] - 1e-9 and L.bal[q_] >= keep + price:
                    L.pay(q_, c["acct"], price, "konut_satisi")
                    own[ci][q_] += 1
                elif RM[ci] > BUILD_RM and L.bal[q_] >= keep + HOUSE_BUILD * price:
                    L.pay(q_, c["acct"], HOUSE_BUILD * price, "konut_insaat")
                    own[ci][q_] += 1
                    hs[ci] += 1
                    L.flows["konut_yeni_adet"] += 1
            tgt = min(RM_MAX, max(RM_MIN, (occ[ci] / max(1.0, hs[ci]) * HOUSE_SLACK) ** HOUSE_ELAST))
            RM[ci] += RM_RATE * (tgt - RM[ci])
            RENT_CY[ci] = RENT_H * TIER_WAGE[0] * WI[ci] * RM[ci]
            LD_VER[0] += 1


def phase_credit(W, w):
    """firma kredisi, vade/temerrüt, çapraz takas (K-158)."""
    BOND_ON = W.BOND_ON
    L = W.L
    PRIV_ON = W.PRIV_ON
    YOUNG_ON = W.YOUNG_ON
    bond_stat = W.bond_stat
    bonds = W.bonds
    cities = W.cities
    cx_stat = W.cx_stat
    firms = W.firms
    int_in = W.int_in
    lo_loss = W.lo_loss
    loans = W.loans
    loncas = W.loncas
    neg = W.neg
    npc_log = W.npc_log
    people = W.people
    soz_acc = W.soz_acc
    if CREDIT_ON:                                                 # K-158: kredi servisi, temerrüt, mevduat
        int_in.clear()
        if BOND_ON and bonds:                                     # K-185.4: tahvil servisi: şehir gelirinden (pozitif kasa), ödenemeyen faiz anaparaya eklenir (temerrüt yok, kısma var)
            for b_ in list(bonds):
                acct_ = b_["city"]
                cpn = b_["rate"] * b_["out"] + b_.get("arr", 0.0)               # ödenmeyen kupon ertelenir (faiz işlemez, anaparaya eklenmez)
                pr_ = min(b_["out"], b_["p0"] / BOND_TERM)
                av_ = max(0.0, L.bal[acct_])
                hold_ = f"{b_['lo']}_sermaye"
                pc_ = L.pay(acct_, hold_, min(av_, cpn), "tahvil_faizi")
                if b_["lo"] in loncas:
                    int_in[b_["lo"]] += pc_
                av_ -= pc_
                new_arr = cpn - pc_
                bond_stat["ertelenen_kupon"] += max(0.0, new_arr - b_.get("arr", 0.0))
                b_["arr"] = new_arr
                pp_ = L.pay(acct_, f"{b_['lo']}_sermaye", min(av_, pr_), "tahvil_itfa")
                b_["out"] -= pp_
                bond_stat["faiz"] += pc_
                bond_stat["itfa"] += pp_
                if b_["out"] <= 1e-6 and b_.get("arr", 0.0) <= 1e-6:
                    bonds.remove(b_)
        for fname in list(loans):
            ln = loans[fname]
            d = firms[fname]
            if d.get("dead") or not d["workers"]:
                continue
            pr = min(ln["out"], ln["p0"] / ln.get("term", LOAN_TERM))
            it = ln.get("rate", LOAN_RATE) * ln["out"]
            if YOUNG_ON and d.get("owner") is not None and "born" in d and w - d["born"] < YOUNG_WEEKS:
                it *= YOUNG_RATE_MULT                                  # K-185.12: genç firma kredisi: düşük faiz, ödemesiz dönem (yalnız faiz)
                if w - d["born"] < (YK_GRACE if YOUNG_KIT else YOUNG_GRACE):      # K-216 (6): YOUNG_KIT açıkken ödemesiz dönem 26 hafta
                    pr = 0.0
            if PRIV_ON and ln.get("grace_until") is not None:
                it *= ln.get("rm", 1.0)                               # K-185.17: özelleştirme kredisi: düşük faiz, ödemesiz dönem (yalnız faiz)
                if w < ln["grace_until"]:
                    pr = 0.0
            src_ = ln.get("payer", fname)
            avail = max(0.0, L.bal[fname] - LOAN_FLOOR * working_capital(W, firms, people, fname, 0)) if src_ == fname else max(0.0, L.bal[src_])
            pool_ = f"{ln['lo']}_sermaye"
            paid_i = L.pay(src_, pool_, min(avail, it), "faiz")
            int_in[ln["lo"]] += paid_i
            avail -= paid_i
            paid_p = L.pay(src_, pool_, min(avail, pr), "kredi_geri")
            ln["out"] -= paid_p
            ln["miss"] = 0 if (paid_i >= it - 1e-9 and paid_p >= pr - 1e-9) else ln["miss"] + 1
            if INNOV_ON and ln["miss"] == 0 and d["owner"] in people:
                soz_acc[d["owner"]] += 1                             # K-11: tutulan söz
            if ln["out"] <= 1e-6:
                if INNOV_ON and d["owner"] in people:
                    soz_acc[d["owner"]] += REP_SOZ_CLOSE / REP_SOZ_RATE
                    L.flows["itibar_olayi_adet"] += 1
                del loans[fname]
            elif ln["miss"] >= DEF_MISS and ln.get("tur") == "medya":
                d["org_owner"] = None                                   # K-181: medya kredisi temerrüdü: medya şehre geri döner, kalan borç havuz kaybı
                L.flows["temerrut_adet"] += 1
                L.flows["temerrut_kayip_akce"] += ln["out"]
                lo_loss[ln["lo"]] += ln["out"]
                cx_stat["temerrut_medya"] += 1
                del loans[fname]
            elif ln["miss"] >= DEF_MISS and INFRA_CONT and NO_BAILOUT and d["owner"] is None and (INFRA_CONT_PRIV or not d.get("priv")) and d["kind"] in NPC_EXEMPT:
                L.flows["temerrut_adet"] += 1                          # K-190: kamu altyapısı temerrütte idari yönetim: borç yeniden yapılandırılır (kalan alacak lonca kaybı; şehir kurtarmaz), hizmet sürer
                L.flows["temerrut_altyapi_adet"] += 1
                L.flows["temerrut_kayip_akce"] += ln["out"]
                lo_loss[ln["lo"]] += ln["out"]
                d["insolv"] = 0
                if d.get("priv"):
                    priv_end(W, fname, d, "temerrut")                      # M4: özelleştirilmiş altyapı: alıcı işletmeyi kaybeder, firma NPC idaresinde sürer (kadro ve hizmet kesilmez)
                npc_log.append((w, d["city"], d["kind"], "yeniden_yapilandi"))
                del loans[fname]
            elif ln["miss"] >= DEF_MISS:
                if CX_ACT:
                    cx_stat["temerrut_" + ln.get("tur", "kurulus")] += 1
                if INNOV_ON and d["owner"] in people:
                    neg[d["owner"]] += REP_DEFAULT
                    L.flows["itibar_olayi_adet"] += 1                          # temerrüt: firma batar, kasası alacaklıya, kalanı kayıp
                seized = L.pay(fname, pool_, min(L.bal[fname], ln["out"]), "kredi_tasfiye")
                d["defaulted"] = True
                L.flows["temerrut_adet"] += 1
                L.flows["temerrut_kayip_akce"] += ln["out"] - seized
                lo_loss[ln["lo"]] += ln["out"] - seized
                if KR_MEAS and d["workers"]:
                    lab_ev(W, "cikis_olum", fname, len(d["workers"]))     # davranışsız sayaç (§4.6): temerrütle kaybedilen işler
                for q in list(d["workers"]):
                    people[q]["firm"] = None
                    if HUMAN_ON:
                        human_cikis(W, q, "firma_kapandi")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
                    (cities[d["city"]]["pool"] if people[q]["who"] == "npc" else cities[d["city"]]["seekers"]).append(q)
                d["workers"] = []
                if d["owner"] is None and NO_BAILOUT:
                    if d.get("priv"):
                        priv_end(W, fname, d, "temerrut")
                    d["dead"] = True
                    d["died"] = w
                    d["capitalized"] = False
                    npc_log.append((w, d["city"], d["kind"], "temerrut"))
                del loans[fname]
    if CX_ACT:
        mortgage_step(W, w)


def dep_flight(W, cls):
    """PLAN-KREDI T5 (DEP_ROUTE, U7, S5): batık loncaların mevduat hesapları tam değerle kredi verebilen loncalara taşınır. Her batık lonca için tavan = DEP_RUN x sermaye nakdi
    (mevduat faizi ödendikten sonra); hesaplar küçükten büyüğe (eşitlikte W.deposits ekleme sırası), birikimli taşınan tavanı aşmadıkça BÜTÜN olarak taşınır
    (L.pay lonca -> lonca, "mevduat_tasima"; tutar ve hesap hakkı değişmez). Boş hesap ödemesiz yeniden yerleşir. Hedef `dep_pick` (her hesaptan sonra güncel mevduatla).
    Sayaçlar: L.flows mevduat_tasima(_adet), mevduat_hedef_yok_hafta (o hafta hedef bulunamadıysa 1); W.lo_stat["tasinamayan_hesap"] = o hafta batık loncada kalan dolu hesap sayısı.
    Hedef bulunamadıysa True döner."""
    L = W.L
    deposits = W.deposits
    dep_tot = W.dep_tot
    left = 0
    no_target = False
    for lo in cls[1]:
        ceiling = DEP_RUN * L.bal[f"{lo}_sermaye"]
        accts = sorted((ent[1], i_, q) for i_, (q, ent) in enumerate(deposits.items()) if ent[0] == lo)
        moved = 0.0
        for amt, _i, q in accts:
            ent = deposits[q]
            if amt <= 1e-9:
                tgt = dep_pick(W, cls)
                if tgt is None:
                    no_target = True
                    continue
                if amt != 0.0:
                    dep_tot[lo] -= amt
                    dep_tot[tgt] += amt
                ent[0] = tgt
                continue
            tgt = dep_pick(W, cls)
            if tgt is None or moved + amt > ceiling + 1e-12:
                no_target = no_target or tgt is None
                left += 1
                continue
            got = L.pay(f"{lo}_sermaye", f"{tgt}_sermaye", amt, "mevduat_tasima")
            moved += got
            dep_tot[lo] -= got
            dep_tot[tgt] += got
            ent[0] = tgt
            L.flows["mevduat_tasima_adet"] += 1
    W.lo_stat["tasinamayan_hesap"] = left
    if no_target:
        L.flows["mevduat_hedef_yok_hafta"] += 1
    return no_target


def phase_deposits(W, w):
    """mevduat, tahvil, faiz ve rezerv."""
    L = W.L
    closed = W.closed
    dep_ema = W.dep_ema
    dep_rate_w = W.dep_rate_w
    dep_slow = W.dep_slow
    dep_tot = W.dep_tot
    deposits = W.deposits
    int_in = W.int_in
    loans = W.loans
    loncas = W.loncas
    people = W.people
    if CREDIT_ON and DEP_ON:
        for lo in loncas:                                         # mevduat faizi: tahsil edilen faizden (tavanlı), mevduatla orantılı
            tot = dep_tot[lo]
            if tot > 1e-9 and int_in[lo] > 0:
                pay_tot = min(DEP_PAYOUT * int_in[lo], DEP_RATE * tot)
                dep_rate_w[lo] = pay_tot / tot
                for q, (lq, am) in list(deposits.items()):
                    if lq == lo and am > 0:
                        L.pay(f"{lo}_sermaye", q, pay_tot * am / tot, "mevduat_faizi")
            else:
                dep_rate_w[lo] = 0.0
            dep_ema[lo] = 0.75 * dep_ema[lo] + 0.25 * dep_rate_w[lo]
        _dt = sum(dep_tot[l_] for l_ in loncas)
        if _dt > 1e-9:
            dep_slow[0] = 0.92 * dep_slow[0] + 0.08 * sum(dep_rate_w[l_] * dep_tot[l_] for l_ in loncas) / _dt
        out_lo = defaultdict(float)
        for ln_ in loans.values():
            out_lo[ln_["lo"]] += ln_["out"]
        cls = lo_classes(W) if (DEP_ROUTE and DV_ACT) else None          # PLAN-KREDI T5: sınıflama bir kez (öz kaynak sonraki mevduat hareketleriyle değişmez)
        none_ = dep_flight(W, cls) if cls is not None else False          # batık loncadan kademeli tam değerli kaçış
        best_dep = max((l_ for l_ in loncas if l_ not in closed), key=lambda l_: (dep_ema[l_], -int(l_[5:])), default=None) if DV_ACT else None
        for q, i_ in people.items():
            if i_["who"] != "oyuncu":
                continue
            wk = i_["wage"] * CYCLES_PER_WEEK
            bq = L.bal[q]
            lo_q = loncas[i_["city"] % len(loncas)]
            if lo_q in closed:
                lo_q = next((l_ for l_ in loncas if l_ not in closed), lo_q)
            if DV_ACT and q not in deposits and best_dep is not None and dep_ema[best_dep] > 0:
                lo_q = best_dep                                    # yeni mevduat: en yüksek (sönümlü) faizi veren lonca
            if q in deposits:
                lo_q = deposits[q][0]
            sh_ = DEP_SHARE
            hd_ = None
            if HUMAN_ON and q == W.human:                          # DAO oyunu: insanın mevduat tercihi (lonca, oran); tercih yoksa bot kuralı
                hd_ = human_dep(W, q, lo_q)
                sh_ = hd_[2]
                if hd_[0] == "hedef":
                    lo_q = hd_[1]
            if DV_ACT:
                kp_ = DEP_KEEP_NEW * sp_week(W, q)
                if bq > kp_:
                    lo_i = lo_q
                    if hd_ is not None and hd_[0] != "bot":
                        lo_i = hd_[1]                              # tercih edilen lonca (hedef) ya da yatırım yok (lonca: null)
                    elif cls is not None:                          # DEP_ROUTE: yeni/boş hesap kredi verebilen loncaya; batık loncada kalmış dolu hesap yatırmaz
                        lo_i = dep_pick(W, cls) if (q not in deposits or deposits[q][1] <= 1e-9) else (None if lo_q in cls[1] else lo_q)
                        if lo_i is None and not none_ and (q not in deposits or deposits[q][1] <= 1e-9):
                            none_ = True                                # hedef yok: para elde kalır (haftada bir sayılır)
                            L.flows["mevduat_hedef_yok_hafta"] += 1
                    if hd_ is not None:
                        human_dep_report(W, lo_i)                  # tercih edilen lonca kapalıysa durum değişince bir kez olay
                    if lo_i is not None:
                        amt = sh_ * (bq - kp_)
                        got = L.pay(q, f"{lo_i}_sermaye", amt, "mevduat")
                        ent = deposits.setdefault(q, [lo_i, 0.0])
                        if ent[0] != lo_i:                             # boş hesap yeni loncada açılır
                            dep_tot[ent[0]] -= ent[1]
                            dep_tot[lo_i] += ent[1]
                            ent[0] = lo_i
                        ent[1] += got
                        dep_tot[lo_i] += got
                elif q in deposits and bq < sp_week(W, q) and deposits[q][1] > 0:
                    amt = min(deposits[q][1], kp_ - bq, L.bal[f"{lo_q}_sermaye"])
                    got = L.pay(f"{lo_q}_sermaye", q, amt, "mevduat_cekim")
                    deposits[q][1] -= got
                    dep_tot[lo_q] -= got
                continue
            if hd_ is not None and bq > DEP_KEEP * wk:
                kabul_ = hd_[0] != "yok" and lo_q not in closed and dep_tot[lo_q] < DEP_MULT * max(DEP_MIN, out_lo[lo_q])      # yatırım gerçekten denenecek mi (aşağıdaki koşulla aynı)
                human_dep_report(W, lo_q if kabul_ else None)
            if bq > DEP_KEEP * wk and dep_tot[lo_q] < DEP_MULT * max(DEP_MIN, out_lo[lo_q]) and not (hd_ is not None and hd_[0] == "yok"):
                amt = min(sh_ * (bq - DEP_KEEP * wk), DEP_MULT * max(DEP_MIN, out_lo[lo_q]) - dep_tot[lo_q])
                got = L.pay(q, f"{lo_q}_sermaye", amt, "mevduat")
                ent = deposits.setdefault(q, [lo_q, 0.0])
                if HUMAN_ON and ent[0] != lo_q:                    # DAO oyunu: boş hesap tercih edilen loncada açılır (DV_ACT yolundaki gibi)
                    dep_tot[ent[0]] -= ent[1]
                    dep_tot[lo_q] += ent[1]
                    ent[0] = lo_q
                ent[1] += got
                dep_tot[lo_q] += got
            elif q in deposits and bq < 2 * wk and deposits[q][1] > 0:
                amt = min(deposits[q][1], 2 * wk - bq, L.bal[f"{lo_q}_sermaye"])
                got = L.pay(f"{lo_q}_sermaye", q, amt, "mevduat_cekim")
                deposits[q][1] -= got
                dep_tot[lo_q] -= got
    renew_reserve(W)
    priv_step(W, w)


def phase_dividends(W, w):
    """oyuncu firması temettüsü, eşitleme, kurucu ayrılması (K-126/K-128)."""
    ANCH = W.ANCH
    L = W.L
    LIQ_ON = W.LIQ_ON
    cities = W.cities
    eq_by = W.eq_by
    eq_cap = W.eq_cap
    estate = W.estate
    firms = W.firms
    loans = W.loans
    media_w = W.media_w
    neg = W.neg
    pay_w = W.pay_w
    people = W.people
    player_firms = W.player_firms
    BRAND = W.BRAND
    if TREASURY_RULE:
        tr_step(W, w)                                             # K-219: şehir kasası kuralı (kasa hedefi üstü fazla haftada TR_CONV kadar geri harcanır)
    for fname in player_firms:                                    # K-126: temettü; kâr firmada birikmez, sahibine akar (harcanır ya da yeni firmaya yatırılır)
        d = firms[fname]
        if d["owner"] in people and d["workers"] and not (fname in loans and loans[fname]["miss"] > 0):
            keep = DIV_KEEP * GROW_FACTOR * working_capital(W, firms, people, fname, 1) + (EQ_KEEP * eq_cap[fname] if EQ_ACT else 0.0) + (d.get("renew_res", 0.0) if RENEW_SOFT else 0.0)
            if PROFIT_KEEP:
                keep = max(keep, PK_MULT * working_capital(W, firms, people, fname))      # K-220: oyuncu firması da PK_WEEKS haftalık nakit tamponu tutar
            if YOUNG_KIT and FOUND_FUND:
                keep += fund_debt(W, fname)                           # K-216 (1): fon borcu varken temettü yalnız borcun üstündeki nakitten (fon işletme gideri için, temettü için değil)
            if L.bal[fname] > keep:
                dv = DIVIDEND_SHARE * (L.bal[fname] - keep)
                dv = corp_tax_pay(L, fname, cities[people[d["owner"]]["city"]]["acct"], dv)      # K-188
                if EQ_ACT:
                    pay_w[fname] += dv
                got_ = pay_owner_dividend(L, fname, cities[people[d["owner"]]["city"]]["acct"], d["owner"], dv, eq_by[fname] if (EQ_ACT and fname in eq_by) else None)
                if d.get("partners") and got_ > 1e-9:                  # K-216 (7): ortaklı firmada temettü ortaklar arasında eşit bölünür
                    sh_ = got_ / (1 + len(d["partners"]))
                    for q_ in d["partners"]:
                        if q_ in people:
                            L.pay(d["owner"], q_, sh_, "ortak_payi")
    if EQUALIZE > 0:                                              # K-128: şehirler arası kasa dengeleme (gerçekte merkezi bütçeden transfer)
        mean_b = sum(L.bal[c["acct"]] for c in cities) / len(cities)
        give = {c["i"]: EQUALIZE * (L.bal[c["acct"]] - mean_b) for c in cities if L.bal[c["acct"]] > mean_b}
        need_ = {c["i"]: mean_b - L.bal[c["acct"]] for c in cities if L.bal[c["acct"]] < mean_b}
        tot_n, tot_g = sum(need_.values()), sum(give.values())
        if tot_n > 0 and tot_g > 0:
            for i, g_ in give.items():
                for j, W.n_ in need_.items():
                    L.pay(cities[i]["acct"], cities[j]["acct"], g_ * W.n_ / tot_n, "sehirler_arasi_denge")
    for c in cities:
        ws_ = [(firms[f_].get("sec", 1.0), len(firms[f_]["workers"])) for f_ in c["firms"] if "sec" in firms[f_] and firms[f_]["workers"]]
        c["sec"] = sum(a_ * b_ for a_, b_ in ws_) / max(1, sum(b_ for _, b_ in ws_)) if ws_ else 1.0   # K-140: şehrin güvenlik düzeyi (koruma bulunurluğu)
    for c in cities:
        tgt_ = min(1.0, media_w[c["i"]] / max(1.0, BRAND_SAT * len(c["players"]) * CYCLES_PER_WEEK)) if TOUR_ON else 0.0
        BRAND[c["i"]] += BRAND_RATE * (tgt_ - BRAND[c["i"]])          # K-147: marka düzeyi reklam birikimidir
    for c in cities:
        c["rep"] = reputation(W, c["i"])
    for fname in list(player_firms):                            # kurucusu ayrılan oyuncu firması batar
        d = firms[fname]
        if not d["workers"]:
            player_firms.remove(fname)
            cities[d["city"]]["firms"].remove(fname)
            if LIQ_ON:
                liq_open(W, fname, d, w)                                   # K-185.10: tasfiye masası: makine/bina ikinci el, gelir sırasıyla ücret, kredi, pay sahipleri, kurucu
                L.flows["kurucu_ayrildi_batis_adet"] += fname in estate and estate[fname]["loan"] is not None
            else:
              if fname in loans:                                          # K-158: alacaklı önce
                ln = loans.pop(fname)
                seized = L.pay(fname, f"{ln['lo']}_sermaye", min(L.bal[fname], ln["out"]), "kredi_tasfiye")
                L.flows["kurucu_ayrildi_batis_adet"] += 1
                L.flows["batis_kayip_akce"] += ln["out"] - seized
              L.pay(fname, cities[d["city"]]["acct"], L.bal[fname], "batan_firma_kasasi")
            d["dead"] = True                                            # silinmez: Δ ayrışımı tutsun
            d["died"] = w
            if HUMAN_ON:
                human_batis(W, fname, d)                                # DAO oyunu: insanın işletmesinin batış nedeni (human_week_end firma_batti.neden okur)
            if d["owner"] in people:
                people[d["owner"]]["founder"] = False                   # K-117: girişimci tekrar deneyebilir
            for q_ in d.get("partners", ()):
                if q_ in people:
                    people[q_]["founder"] = False                       # K-216 (7): ortaklar da
            L.flows["batan_oyuncu_firmasi_adet"] += 1
            L.flows["batis_yas_hafta"] += w - d.get("born", w)
            L.flows["batis_yas_le3"] += (w - d.get("born", w)) <= 3
            _age = "le3" if (w - d.get("born", w)) <= 3 else "gt3"
            _ok = d.get("life_ok", 0.0) / max(1, d.get("life_n", 0))
            _un = d.get("unsold_acc", 0.0) / max(1e-9, d.get("prod_acc", 0.0))
            _cause = "girdi" if (d.get("life_n", 0) > 0 and _ok < 0.6) else ("talep" if _un > 0.3 else "marj")
            if INNOV_ON and _cause == "marj" and d["kind"] in BRANCH and (1 - d.get("tech", 1.0) / ANCH[BRANCH[d["kind"]]][0]) * LABOR_SHARE >= GAP_DEATH:
                _cause = "teknoloji_geride"                          # K-167: batanlar batar, inovasyon kazanır
            if INNOV_ON and d["owner"] in people:
                neg[d["owner"]] += REP_BANKRUPT
                L.flows["itibar_olayi_adet"] += 1
            L.flows["olum_" + _age + "_" + _cause] += 1
    if HUMAN_ON:
        human_week_end(W, w)                                        # DAO oyunu: insanın işletmesi/işi hafta başına göre (batıştan sonra) olay olur


def phase_innov_end(W, w):
    """hafta sonu inovasyon kapanışı."""
    L = W.L
    cities = W.cities
    people = W.people
    if INNOV_ON:
        dao_deaths(W, w)
        media_step(W, w)
        cx_credit_step(W, w)
        orep_step(W, w)
        rep_week(W, w)
        equity_step(W, w)
        if RESALE_ACT:
            resale_step(W, w)
        if WEALTH_TAX > 0:
            for q_, i_ in people.items():
                if i_["who"] == "oyuncu" and L.bal[q_] > WT_FLOOR:
                    L.pay(q_, cities[i_["city"]]["acct"], WEALTH_TAX * (L.bal[q_] - WT_FLOOR), "servet_vergisi")
