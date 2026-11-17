"""simkit.firm_exit: firma çıkışı: NPC firma ölümü, tasfiye (liq_*), özelleştirme (priv_*).

ARAYÜZ: ox_karar, ox_hafta, npc_die, priv_end, priv_value, priv_step, liq_open, liq_buy, liq_settle, revive_plant_take, revive_plant_cost, revive_plant_buy
OKUR/YAZAR: W.firms, W.people, W.L, tasfiye/özelleştirme kayıtları; W.week_no (yayın).
KATMAN: L2 (credit_core, econ_core'a bağımlı).
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.lab_meas import lab_ev, lab_stamp, human_cikis
from simkit.credit_core import sahip_kapat, cx_base, cx_costs, cx_rm, lendable, lo_kayip_yaz, lo_oran, lo_risk, lt_alacakli, lt_damga, lt_odeyen      # noqa: F401  (sahip_kapat: firm_exit.sahip_kapat olarak da erişilir; REKABET G17h)
from simkit.econ_core import isres, land, working_capital
from simkit.transition import trans_blocks_priv
from simkit.sector_core import sole_secilen, sole_uretici_yok, zincir_urunleri
from simkit.young_core import is_fund_lo


def ox_karar(W, f, d, w):
    """REKABET G17h (OWNER_EXIT): bot sahibin firmasını kapatma kararı (True: kapat). Her hafta çağrılır (sayaç ilerler): d["ox_alt"] = art arda prof_ema < 0 haftası, d["ox_oz"] = son OX_WEEKS haftanın öz kaynağı (kasa − kredi bakiyesi; halka, karşılaştırma OX_WEEKS hafta öncesiyle).
    Karar: ox_alt >= OX_WEEKS ve öz kaynak OX_WEEKS hafta öncekinden düşük ve yaş >= OX_MIN_AGE ve sepetin son üreticisi değil (SOLE_KEEP: sole_secilen seçilen firma ya da dünyada ürünü başka üreten canlı firma yok). Kapsam: sahibi bot; priv, org_owner (lonca/DAO'nun satın aldığı firma; npc_die ve OWNER_INJECT ile aynı ayrım), insan, ölü ve kapanmakta olan firma kapsam dışı (sayaç da yazılmaz)."""
    if d.get("priv") or d.get("dead") or d.get("kapaniyor") or d.get("owner") is None or d.get("org_owner"):
        return False
    if HUMAN_ON and d["owner"] == getattr(W, "human", None):
        return False
    ln = W.loans.get(f)
    oz = W.L.bal[f] - (ln["out"] if ln else 0.0)
    pe = W.prof_ema.get(f, 0.0)
    d["ox_alt"] = d.get("ox_alt", 0) + 1 if pe < 0 else 0
    halka = d.setdefault("ox_oz", [])
    eski = halka[0] if len(halka) >= OX_WEEKS else None
    halka.append(oz)
    while len(halka) > OX_WEEKS:
        del halka[0]
    if d["ox_alt"] < OX_WEEKS or eski is None or oz >= eski or w - d.get("born", w) < OX_MIN_AGE or not d["workers"]:
        return False
    if SOLE_KEEP and (sole_secilen(W, f, d) == f or (d["kind"] in PROD_OF and PROD_OF[d["kind"]] in zincir_urunleri(W) and sole_uretici_yok(W, f, d))):
        return False
    return True


def ox_hafta(W, w):
    """REKABET G17h (OWNER_EXIT), son inceleme Ö1: haftanın OX kararları. phase_founding başında, işe alımdan ÖNCE çağrılır (insanın `ayril` kararı da hafta açılışında, işe alımdan önce uygulanır): kapatılan firmaya `kapaniyor` konur, işçileri dağıtılır; o hafta işçi almaz, köprü/büyüme kredisi çekmez. Karar geçen haftanın kapanmış verisiyle (prof_ema, kasa) verilir. Ölüm aynı haftanın batış döngüsündedir (phase_dividends)."""
    firms = W.firms
    for fname in list(W.player_firms):
        d = firms[fname]
        if ox_karar(W, fname, d, w):
            d["ox_cikis"] = w
            sahip_kapat(W, fname)


def npc_die(W, f, d, c):
    """K-185.2: zarar eden NPC firma batar: kadro havuza / iş arayanlara, kredi tasfiyesi, kalan kasa şehre; şehir yeniden kurmaz.
    Öldüyse True. te-denge G6 (SOLE_KEEP=1): sepet zincirinde dünyanın son üreticisi ölmez: 'sole' işaretlenir, sayaçlar sıfırlanır, False döner (çağıran ölüm sayacı/kaydı tutmaz)."""
    if SOLE_KEEP:
        sec_ = sole_secilen(W, f, d)
        if sec_ == f:
            d["sole"] = W.week_no
            d["insolv"] = 0
            d["zmb"] = 0
            d["capitalized"] = False
            return False
        if sec_ is not None:
            W.firms[sec_]["sole"] = W.week_no                  # seçilen başka (ölmeyen, işçisiz) firma işaret ve fon alır; f olağan kurallarla ölür (ürün kadrolu üreticisiz kalmasın)
    L = W.L
    LIQ_ON = W.LIQ_ON
    loans = W.loans
    npc_log = W.npc_log
    people = W.people
    week_no = W.week_no
    if L.bd is not None:
        L.bd[("olum", "npc_batis", f)] += 1
    if KR_MEAS and d["workers"]:
        lab_ev(W, "cikis_olum", f, len(d["workers"]))              # davranışsız sayaç (§4.6): firma ölümüyle kaybedilen işler
    for q in list(d["workers"]):
        people[q]["firm"] = None
        if HUMAN_ON:
            human_cikis(W, q, "firma_kapandi")                  # DAO oyunu: insanın istemsiz iş kaybı nedeni (human_week_end okur)
        (c["pool"] if people[q]["who"] == "npc" else c["seekers"]).append(q)
    d["workers"] = []
    if LIQ_ON:
        liq_open(W, f, d, week_no)
    else:
        if f in loans:
            ln_ = loans.pop(f)
            seized_ = L.pay(f, f"{ln_['lo']}_sermaye", min(L.bal[f], ln_["out"]), "kredi_tasfiye")
            L.flows["npc_batis_kayip_akce"] += ln_["out"] - seized_
            lo_kayip_yaz(W, ln_, ln_["out"] - seized_)                      # REKABET G5: LONCA_TERMS iken batış kaybı loncanın kredi kaybına yazılır
            if KR_MEAS and ln_.get("tur") == "kurulus":                  # REKABET G0: davranışsız ölçüm (kuruluş kredisi kaybı)
                W.lo_stat["ks_kayip"] += ln_["out"] - seized_
        L.pay(f, c["acct"], L.bal[f], "batan_firma_kasasi")
    if d.get("priv"):
        priv_end(W, f, d, "bati")
    d["dead"] = True
    d["died"] = week_no
    d["capitalized"] = False
    if REVIVE_HYGIENE:
        d["zmb"] = 0
        d.pop("tr_left", None)                                   # hijyen: zombi sayaci olumle sifirlanir (canlanan firma bayat sayacla ilk taramada yine olmesin)
    L.flows["npc_batis_adet"] += 1
    npc_log.append((week_no, c["i"], d["kind"], "battı"))
    return True


def priv_end(W, f, d, why):
    """K-185.17: özelleştirilmiş işletme bitti (battı/temerrüt): sahiplik biter, oyuncu girişimci tekrar deneyebilir."""
    people = W.people
    priv_log = W.priv_log
    priv_stat = W.priv_stat
    week_no = W.week_no
    pv = d.pop("priv", None)
    if not pv:
        return
    priv_stat["biten_" + why] += 1
    priv_stat["omur_hafta"] += week_no - pv["w"]
    if pv["tip"] == "oyuncu" and pv["who"] in people:
        people[pv["who"]]["founder"] = False
    for e_ in priv_log:
        if e_["f"] == f and e_.get("end") is None:
            e_["end"] = (week_no, why)


def priv_value(W, f, d):
    """K-185.17: (tasfiye değeri, devam eden işletme değeri): makine/bina yeni maliyet × iskonto, stok."""
    INV_ON = W.INV_ON
    REF = W.REF
    mc, bc = cx_costs(W)
    m, b = d.get("mach", 0.0), d.get("bld", 0.0)
    liq = m * mc * (1 - LIQ_DISC_M) + b * bc * (1 - LIQ_DISC_B)
    gc = PRIV_GC * (m * mc + b * bc)
    if INV_ON:
        stk = sum(q_ * REF[p_] for p_, q_ in d.get("stock", {}).items()) + sum(q_ * REF[p_] for p_, q_ in d.get("istock", {}).items())
        liq += INV_LIQ_DISC * stk
        gc += stk
    return liq, max(gc, liq)


def _priv_kredi(W, kr_lo, price, topup, wc, coll, debt):
    """K-185.17: özelleştirme kredisi (bedel payı cr_price, toplam kredi cr, alıcının payı eq); kredi veren kr_lo'nun o anki havuzu ve kasasıyla sınırlı. Saf."""
    allowed = 0.0
    if kr_lo is not None:
        allowed = max(0.0, min(PRIV_POOL_SHARE * lendable(W, kr_lo), W.L.bal[f"{kr_lo}_sermaye"], NPC_LEV * wc + 0.8 * coll - debt))
    cr_price = min(PRIV_LTV * price, allowed)
    cr = min(allowed, cr_price + topup)
    return cr_price, cr, price - min(cr_price, cr)


def priv_step(W, w):
    """K-185.17: özelleştirme: (1) zarar eden NPC firma ihaleye çıkar, (2) alıcı: en iyi oyuncu ya da (oyuncu yoksa) lonca devralır, lonca %LTV kredi verir,
    (3) alıcı çıkmazsa fiyat düşer; ROUNDS hafta sonra tasfiye (zayıfsa) ya da bekleme. Üretim ve kadro devir sırasında durmaz; işletme bütün olarak (makine, bina, stok, işçi, müşteri, borç) devredilir."""
    L = W.L
    PRIV_ON = W.PRIV_ON
    REP = W.REP
    cities = W.cities
    closed = W.closed
    firms = W.firms
    loans = W.loans
    loncas = W.loncas
    people = W.people
    priv_log = W.priv_log
    priv_q = W.priv_q
    priv_stat = W.priv_stat
    priv_ts = W.priv_ts
    weeks = W.weeks
    if not PRIV_ON or w < PRIV_START:
        return
    new_c = defaultdict(int)
    for f, d in firms.items():
        if d["owner"] is not None or d.get("dead") or d.get("priv") or f in priv_q or d["kind"] in ("ahir", "belediye") or not d["workers"]:
            continue
        if TRANS_SUPPORT == 2 and trans_blocks_priv(W, d):
            continue                                                  # K-211 v2: destek alan sektörde zorunlu özelleştirme yok
        wc = working_capital(W, firms, people, f)
        if d.get("prof", 0.0) < -PRIV_LOSS * wc or d.get("insolv", 0) >= PRIV_INSOLV:
            d["lneg"] = d.get("lneg", 0) + 1
        else:
            d["lneg"] = 0
        if (d["lneg"] >= PRIV_WEEKS or d.get("insolv", 0) >= PRIV_INSOLV) and w >= d.get("priv_next", 0) and new_c[d["city"]] < PRIV_MAX_NEW:
            priv_q[f] = dict(r=0, w0=w)
            new_c[d["city"]] += 1
            priv_stat["ihale"] += 1
    for f in list(priv_q):
        q_ = priv_q[f]
        d = firms[f]
        if d.get("dead") or d.get("priv") or d["owner"] is not None:
            del priv_q[f]
            continue
        c = cities[d["city"]]
        wc = working_capital(W, firms, people, f)
        liq, gc = priv_value(W, f, d)
        frac = max(PRIV_FLOOR, 1.0 - PRIV_FSTEP * q_["r"])        # ihale fiyatı her tur düşer: alıcıların gücü (nakit + lonca havuzu) bağlayıcıdır, tasfiye değeri taban değildir
        debt = loans[f]["out"] if f in loans else 0.0
        price = max(0.0, (liq + PRIV_F0 * (gc - liq)) * frac - debt)
        mc, bc = cx_costs(W)
        coll = d.get("mach", 0.0) * mc * (1 - LIQ_DISC_M) + d.get("bld", 0.0) * bc * (1 - LIQ_DISC_B)
        topup = max(0.0, wc - L.bal[f]) if PRIV_TOPUP else 0.0
        lo = d["lonca"] if d["lonca"] not in closed else next((l_ for l_ in loncas if l_ not in closed), None)
        kr_lo = lo                                                   # kredi veren lonca (alıcı lonca `lo` olarak kalır: firmanın kendi loncası öncelikli)
        if LONCA_TERMS and lo is not None and f in loans and not is_fund_lo(loans[f]["lo"]):
            kr_lo = lt_alacakli(W, f)                                # REKABET G5 (Y2): özelleştirme kredisini kaydın ALACAKLISI verir (devir uygunsa firmanın loncası; devir yalnız kredi gerçekten verilirken yapılır)
        cr_price, cr, eq = _priv_kredi(W, kr_lo, price, topup, wc, coll, debt)
        best, bsc = None, -1.0
        for p_ in c["players"]:
            i_ = people[p_]
            if i_.get("founder") or not i_["firm"] or isres(i_) or (HUMAN_ON and p_ == W.human):      # DAO oyunu: insan kendiliğinden özelleştirme alıcısı olmaz
                priv_stat["red_uygun_degil"] += 1
                continue
            if L.bal[p_] < eq + 1.0:
                priv_stat["red_nakit"] += 1
                continue
            cur = i_["firm"]
            sec = 1.0 if (cur and cur in firms and firms[cur]["kind"] == d["kind"]) else 0.0
            if q_["r"] < (PRIV_ACC_SECTOR if sec > 0 else PRIV_ACC_OTHER):
                priv_stat["red_fiyat"] += 1
                continue
            rep_ = (REP[p_] / CM_REP) if INNOV_ON else 0.5
            sc = 0.5 * min(1.0, rep_) + 0.3 * sec + 0.2 * min(1.0, L.bal[p_] / max(1.0, price))
            if sc > bsc or (sc == bsc and best is not None and p_ < best):
                best, bsc = p_, sc
        tip = None
        lonca_ok = lo is not None and q_["r"] >= PRIV_LONCA_FROM and price + topup <= min(PRIV_LONCA_SHARE * lendable(W, lo), L.bal[f"{lo}_sermaye"])
        if best is not None and (bsc >= PRIV_LONCA_SCORE or not lonca_ok):
            tip = "oyuncu"
        elif lonca_ok:
            tip = "lonca"
        if tip == "oyuncu" and LONCA_TERMS and cr > 1e-9 and f in loans and not is_fund_lo(loans[f]["lo"]):
            kr_lo = lt_odeyen(W, f, w)                               # REKABET G5 (Y2, Ö-D): kredi verilecekken önce devir (uygunsa), SONRA kredi alacaklının devir sonrası kasasıyla yeniden hesaplanır
            cr_price, cr, eq = _priv_kredi(W, kr_lo, price, topup, wc, coll, debt)
            if L.bal[best] < eq + 1.0:
                priv_stat["red_nakit_devir"] += 1                   # devirden sonra kredi küçüldü, alıcının payı yetmiyor: satış bu tur yok (şehir eksik bedel almaz)
                tip = None
        if tip is None:
            priv_stat["alici_yok_tur"] += 1
            q_["r"] += 1
            if q_["r"] > PRIV_ROUNDS:
                del priv_q[f]
                wk_ = d.get("prof", 0.0) < -5 * PRIV_LOSS * wc or d.get("insolv", 0) > 0
                if wk_ and npc_die(W, f, d, c):
                    priv_stat["tasfiye"] += 1
                else:
                    priv_stat["alici_yok_bekle"] += 1
                    d["priv_next"] = w + PRIV_RETRY
                    d["lneg"] = 0
            continue
        # --- devir
        if tip == "oyuncu":
            p_ = best
            paid_eq = L.pay(p_, c["acct"], eq, "ozellestirme_bedeli")
            odenen_ = 0.0
            if cr_price > 1e-9:
                odenen_ += L.pay(f"{kr_lo}_sermaye", c["acct"], min(cr_price, cr), "ozellestirme_kredisi")
            tk_ = max(0.0, cr - cr_price)
            if tk_ > 1e-9:
                odenen_ += L.pay(f"{kr_lo}_sermaye", f, tk_, "ozellestirme_kredisi")
            if LONCA_TERMS:
                cr = odenen_                                         # REKABET G5 (Ö-D): kayda FİİLEN ödenen yazılır (kredi devir sonrası kasayla kısıldığı için tamdır)
            old = people[p_]["firm"]
            if old and old in firms and p_ in firms[old]["workers"]:
                firms[old]["workers"].remove(p_)
                if KR_MEAS:
                    lab_ev(W, "cikis_gecis", old)                  # davranışsız sayaç (§4.6)
            d["workers"].append(p_)
            if KR_MEAS:
                lab_ev(W, "ise", f)
            people[p_].update(firm=f, founder=True, avans=True)
            who = p_
            sc_out = cr
        else:
            L.pay(f"{lo}_sermaye", c["acct"], price, "ozellestirme_bedeli")
            if topup > 1e-9:
                L.pay(f"{lo}_sermaye", f, topup, "ozellestirme_isletme_sermayesi")
            who = lo
            sc_out = 0.0
            cr = 0.0
            paid_eq = price
        if cr > 1e-9:
            rate = lo_oran(W, kr_lo, f) if LONCA_TERMS else max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, kr_lo)) * cx_rm(W, f))     # REKABET G5: tek faiz fonksiyonu
            ln = loans.get(f)
            if ln:
                ln["p0"] += cr
                ln["out"] += cr
                ln["miss"] = 0
                ln["rate"] = rate
                ln["tur"] = "ozellestirme"
            else:
                ln = loans[f] = dict(lo=kr_lo, p0=cr, out=cr, miss=0, rate=rate, tur="ozellestirme")
            if LONCA_TERMS:
                lt_damga(W, f, ln, cr)                               # REKABET G5: tek açılış damgası (kayıt alacaklısı; tranşta spread tutar ağırlıklı)
                ln["rate"] = lo_oran(W, ln["lo"], f, ln, w - d.get("born", w))     # kayıt oranı (K-d: pd'li kayıtta kuruluş primi firma yaşıyla) tutar ağırlıklı spread kuralıyla (diğer tranşlarla aynı)
            ln["grace_until"] = w + PRIV_GRACE
            ln["rm"] = PRIV_RATE_MULT
            ln["term"] = PRIV_TERM
            L.flows["kredi_ozellestirme_adet"] += 1
            priv_stat["kredi_hacim"] += cr
        d["priv"] = dict(tip=tip, who=who, w=w, price=price, book=gc, liq=liq, credit=cr)
        d["capitalized"] = True
        d["insolv"] = 0
        d["lneg"] = 0
        d["prof"] = 0.0
        del priv_q[f]
        priv_stat["devir"] += 1
        priv_stat["devir_" + tip] += 1
        priv_stat["bedel"] += price
        priv_stat["defter"] += gc
        priv_stat["tasfiye_degeri"] += liq
        priv_stat["tur_toplam"] += q_["r"]
        priv_log.append(dict(f=f, w=w, city=d["city"], kind=d["kind"], tip=tip, price=price, book=gc, liq=liq, credit=cr, workers=len(d["workers"]), r=q_["r"], end=None))
    npc_alive = [f for f, d in firms.items() if d["owner"] is None and not d.get("dead") and not d.get("priv") and d["kind"] not in ("ahir", "belediye") and d["workers"]]
    pv_alive = [f for f, d in firms.items() if d.get("priv") and not d.get("dead") and d["workers"]]
    if w % 5 == 0 or w == weeks:
        priv_ts.append((w, len(npc_alive), sum(len(firms[f]["workers"]) for f in npc_alive),
                        sum(1 for f in pv_alive if firms[f]["priv"]["tip"] == "oyuncu"), sum(len(firms[f]["workers"]) for f in pv_alive if firms[f]["priv"]["tip"] == "oyuncu"),
                        sum(1 for f in pv_alive if firms[f]["priv"]["tip"] == "lonca"), sum(len(firms[f]["workers"]) for f in pv_alive if firms[f]["priv"]["tip"] == "lonca"),
                        len(priv_q), sum(l_["out"] for l_ in loans.values() if l_.get("tur") == "ozellestirme")))


def liq_open(W, f, d, w):
    FPM = W.FPM
    INV_ON = W.INV_ON
    L = W.L
    REF = W.REF
    RENEW_ON = W.RENEW_ON
    eq_by = W.eq_by
    estate = W.estate
    liq_stat = W.liq_stat
    loans = W.loans
    if RENEW_ON and RENEW_SOFT:
        d["renew_res"] = 0.0
    elif RENEW_ON and L.bal[f"{f}_yenileme"] > 0:
        L.pay(f"{f}_yenileme", f, L.bal[f"{f}_yenileme"], "yenileme_fonu_devir")
    ln = loans.pop(f, None)
    eqh = {inv: dict(h) for inv, h in eq_by.get(f, {}).items()} if EQ_ACT else {}
    m, b = d.get("mach", 0.0), d.get("bld", 0.0)
    mc, bc = cx_costs(W)
    estate[f] = dict(w=w, kind=d["kind"], city=d["city"], loan=ln, owner=(d.get("owner") if d.get("owner") is not None else (d["priv"]["who"] if d.get("priv") else None)), m=m, b=b, m0=m, b0=b, arrears=dict(d.get("arrears", {})), eq=eqh, sales=0.0, closed=False)
    d["mach"] = d["bld"] = 0.0
    d["arrears"] = {}
    if INV_ON:
        sv_ = sum(q_ * REF[p_] for p_, q_ in d.get("stock", {}).items()) + sum(q_ * REF[p_] for p_, q_ in d.get("istock", {}).items())
        estate[f]["stok_deger"] = sv_
        liq_stat["stok_deger"] += sv_
        FPM[f] = INV_LIQ_DISC                               # tasfiye malı indirimli satılır (alacaklı sırası: gelir masaya)
        d["stock"] = dict(d.get("stock", {}))
        for p_, q_ in d.get("istock", {}).items():
            d["stock"][p_] = d["stock"].get(p_, 0.0) + q_   # girdi stoğu da satılık
        d["istock"] = {}
    liq_stat["acilan"] += 1
    liq_stat["yuva_m_acilis"] += m
    liq_stat["yuva_b_acilis"] += b
    liq_stat["varlik_yeni_deger"] += m * mc + b * bc


def liq_buy(W, f, d, need_m, need_b, budget):
    """K-185.10: alıcı önce ikinci el yuva arar (makine: aynı sektör, bina: aynı şehir); fiyat = yeni maliyet × (1 - iskonto). Döner: (alınan m, alınan b, ödenen)."""
    L = W.L
    estate = W.estate
    liq_stat = W.liq_stat
    mc, bc = cx_costs(W)
    got_m = got_b = spent = 0.0
    for g, e in estate.items():
        if e["closed"] or g == f:
            continue
        if need_m - got_m > 1e-9 and e["m"] > 1e-9 and e["kind"] == d["kind"]:
            pr = mc * (1 - LIQ_DISC_M)
            q = min(need_m - got_m, e["m"], (budget - spent) / pr if pr > 0 else 0.0)
            if q > 1e-9:
                paid = L.pay(f, g, q * pr, "tasfiye_satisi")
                e["m"] -= q
                e["sales"] += paid
                got_m += q
                spent += paid
                liq_stat["makine_islem"] += 1
                liq_stat["makine_yuva_satilan"] += q
                liq_stat["makine_gelir"] += paid
        if need_b - got_b > 1e-9 and e["b"] > 1e-9 and e["city"] == d["city"]:
            pr = bc * (1 - LIQ_DISC_B)
            q = min(need_b - got_b, e["b"], (budget - spent) / pr if pr > 0 else 0.0)
            if q > 1e-9:
                paid = L.pay(f, g, q * pr, "tasfiye_satisi")
                e["b"] -= q
                e["sales"] += paid
                got_b += q
                spent += paid
                liq_stat["bina_islem"] += 1
                liq_stat["bina_yuva_satilan"] += q
                liq_stat["bina_gelir"] += paid
    return got_m, got_b, spent


def liq_settle(W, w):
    """K-185.10: tasfiye şelalesi: ödenmemiş ücret > kredi veren lonca (teminat) > pay sahipleri (maliyet kadar) > kurucu; kalan şehre (sahipsizse)."""
    INV_ON = W.INV_ON
    L = W.L
    REF = W.REF
    cities = W.cities
    closed = W.closed
    estate = W.estate
    firms = W.firms
    liq_stat = W.liq_stat
    loncas = W.loncas
    people = W.people
    mc, bc = cx_costs(W)
    for f, e in list(estate.items()):
        if e["closed"] or w - e["w"] < LIQ_WEEKS:
            continue
        e["closed"] = True
        liq_stat["kapanan"] += 1
        if REVIVE_CAPITAL >= 2 and firms[f]["owner"] is None and (e["m"] > 1e-9 or e["b"] > 1e-9):
            firms[f]["mach"] = firms[f].get("mach", 0.0) + e["m"]      # DAO oyunu M5 (RC=2): sahipsiz NPC kabuğunun satılmayan kalan yuvası hurda olmaz, kabukta durur (yeniden açılırsa geri gelir)
            firms[f]["bld"] = firms[f].get("bld", 0.0) + e["b"]
            liq_stat["kabuga_donen_yuva"] += e["m"] + e["b"]
            e["m"] = e["b"] = 0.0
        liq_stat["hurda_m"] += e["m"]
        liq_stat["hurda_b"] += e["b"]
        if INV_ON and firms[f].get("stock"):
            liq_stat["stok_hurda"] += sum(q_ * REF[p_] for p_, q_ in firms[f]["stock"].items())
            firms[f]["stock"] = {}
        cash = L.bal[f]
        liq_stat["masa_nakit"] += cash
        ar = sum(e["arrears"].values())
        if ar > 1e-9 and cash > 1e-9:
            part = min(1.0, cash / ar)
            for q, a in e["arrears"].items():
                L.pay(f, q, a * part, "tasfiye_ucret")
            liq_stat["ucret_borcu"] += ar
            liq_stat["ucret_odenen"] += ar * part
        elif ar > 1e-9:
            liq_stat["ucret_borcu"] += ar
        cash = L.bal[f]
        ln = e["loan"]
        if ln is not None:
            pay_ = L.pay(f, f"{ln['lo']}_sermaye", min(cash, ln["out"]), "kredi_tasfiye")
            liq_stat["kredi_alacak"] += ln["out"]
            liq_stat["kredi_geri"] += pay_
            L.flows["batis_kayip_akce"] += ln["out"] - pay_
            lo_kayip_yaz(W, ln, ln["out"] - pay_)                           # REKABET G5: tasfiyede kredinin karşılanmayan kalanı loncanın kredi kaybına yazılır
            if KR_MEAS and ln.get("tur") == "kurulus":                  # REKABET G0: davranışsız ölçüm (kuruluş kredisi kaybı)
                W.lo_stat["ks_kayip"] += ln["out"] - pay_
        cash = L.bal[f]
        costs = {inv: h["cost"] for inv, h in e["eq"].items() if h.get("cost", 0) > 0}
        tc = sum(costs.values())
        if tc > 1e-9 and cash > 1e-9:
            part = min(1.0, cash / tc)
            for inv, cst in costs.items():
                L.pay(f, inv, cst * part, "tasfiye_pay_sahibi")
            liq_stat["pay_cost"] += tc
            liq_stat["pay_odenen"] += tc * part
        elif tc > 1e-9:
            liq_stat["pay_cost"] += tc
        cash = L.bal[f]
        if cash > 1e-9:
            if e["owner"] in loncas and e["owner"] not in closed:
                L.pay(f, f"{e['owner']}_sermaye", cash, "tasfiye_lonca")
            elif e["owner"] in people:
                L.pay(f, e["owner"], cash, "tasfiye_kurucu")
                liq_stat["kurucu_kalan"] += cash
            else:
                L.pay(f, cities[e["city"]]["acct"], cash, "batan_firma_kasasi")


def revive_plant_take(W, f, d, extra, commit=True):
    """DAO oyunu M5 (REVIVE_CAPITAL=2): yeniden açılan sahipsiz NPC işletme önce kendi tesisini geri alır: açık tasfiye masasında satılmamış makine/bina ve (masa kapanmışsa) kabukta duran kalan.
    Hedef yuva = CAPEX_HEAD x açılış kadrosu (extra) — standart 12 değil: tesis açılış kadrosunu karşılar, sonrası capex_plan ile büyür. Yoktan yuva yaratılmaz. Döner: (eksik makine, eksik bina).
    commit=False: hiçbir şeyi taşımaz (yalnız eksiği hesaplar); kredi yeterlilik kontrolü bitmeden masadaki yuva çekilmesin diye (M6.1)."""
    estate = W.estate
    liq_stat = W.liq_stat
    tgt = CAPEX_HEAD * extra
    m, b = d.get("mach", 0.0), d.get("bld", 0.0)
    e = estate.get(f)
    if e is not None and not e["closed"]:
        tm, tb = min(e["m"], max(0.0, tgt - m)), min(e["b"], max(0.0, tgt - b))
        if commit:
            e["m"] -= tm
            e["b"] -= tb
            liq_stat["canlanma_geri_alinan_yuva"] += tm + tb
        m += tm
        b += tb
    if commit:
        d["mach"], d["bld"] = m, b
    return max(0.0, tgt - m), max(0.0, tgt - b)


def revive_plant_cost(W, f, d, miss_m, miss_b):
    """RC=2: eksik yuvanın tahmini bedeli: açık başka masalardaki ikinci el (liq_buy fiyatı), kalanı yeni maliyetle (capex_plan girdi alımı). Canlanma kredisine eklenir."""
    mc, bc = cx_costs(W)
    av_m = sum(e["m"] for g, e in W.estate.items() if not e["closed"] and g != f and e["kind"] == d["kind"])
    av_b = sum(e["b"] for g, e in W.estate.items() if not e["closed"] and g != f and e["city"] == d["city"])
    sm, sb = min(miss_m, av_m), min(miss_b, av_b)
    return sm * mc * (1 - LIQ_DISC_M) + (miss_m - sm) * mc + sb * bc * (1 - LIQ_DISC_B) + (miss_b - sb) * bc


def revive_plant_buy(W, f, d, miss_m, miss_b, budget):
    """RC=2: kredi ödendikten sonra eksik yuva açık masalardan bedelli alınır (tasfiye_satisi); masa yetmezse kalan capex_plan'ın girdi alımına (cx_need) kalır."""
    gm, gb, sp = liq_buy(W, f, d, miss_m, miss_b, budget)
    d["mach"] += gm
    d["bld"] += gb
    W.liq_stat["canlanma_bedelli_yuva"] += gm + gb
    return gm, gb, sp


def pcr_of(W, ci, kind):
    """M14 (7): sehir ci'de `kind` uretiminin fiyat / birim maliyet orani (PCR): cikti fiyati / (girdi bedeli + donguluk ucret / isci basi cikti). Tarif yoksa ya da maliyet 0 ise 1.0 (sinyal yok)."""
    outputs, inputs = W.RECIPES[kind]
    if not outputs:
        return 1.0
    main, rate = next(iter(outputs.items()))
    if rate <= 0:
        return 1.0
    cost = sum(q * land(W, ci, p) for p, q in inputs.items()) + TIER_WAGE[1] * W.WI[ci] / rate
    return land(W, ci, main) / cost if cost > 1e-12 else 1.0


def zombie_step(W, w):
    """M14 (7) ZOMBIE_EXIT: haftalik tarama. Kadrosuz ve kasasi < ZB_CASH_WEEKS hf ucret olan canli NPC isletme sayaci artar (aksi halde sifirlanir); sayac ZB_WEEKS'e ulasinca npc_die (kredi tasfiyesi + kalan kasa sehre: para korunur), sehir basina haftada en cok ZB_CAP."""
    if not ZOMBIE_EXIT or not (NO_BAILOUT and w > NPC_GRACE):
        return
    L = W.L
    for ci, c in enumerate(W.cities):
        n = 0
        wk1 = CYCLES_PER_WEEK * TIER_WAGE[0] * W.WI[ci]
        for f in list(c["firms"]):
            d = W.firms[f]
            if d["owner"] is not None or d.get("org_owner") or d.get("dead") or d.get("kapaniyor") or d["kind"] in ("ahir", "belediye") or d["kind"] in NPC_EXEMPT or d["kind"] in NPC_INFRA:
                continue
            if d["workers"] or L.bal[f] >= ZB_CASH_WEEKS * wk1:
                d["zmb"] = 0
                continue
            d["zmb"] = d.get("zmb", 0) + 1
            if d["zmb"] >= ZB_WEEKS and n < ZB_CAP:
                if not npc_die(W, f, d, c):
                    continue                                          # te-denge G6: son üretici ölmez (sayaç sıfırlandı); tasfiye sayılmaz
                n += 1
                L.flows["zombi_tasfiye_adet"] += 1
