"""simkit.young_kit: K-215/K-216 genç firma kiti: kuruluş fonu, dayanma limiti, talebe bağlı işe alım, açılış reklamı, asgari etkin ölçek ve ortaklı kuruluş.

AMAÇ: sahip kararları (2026-10-28). K-215a kuruluş fonu: şehir kasasından (basımsız; kasa tabanı korunur) ayrı havuz (KFON<i>_sermaye); genç firma kuruluş/işletme kredisi
bu fondan verilir, lonca havuzunu tüketmez. K-216: (1) fon, genç firmaya YK_RUNWAY_WEEKS haftalık işletme gideri kadar limit açar, firma ihtiyaç oldukça çeker; (2) hedef kadro
= asgari etkin ölçek / sektör payı / kendi satış tükenmesi / pano kıtlığı, haftada birden çok alım (tavanlı), ücret kasa yetmezse limitten; (5) açılış reklamı (DIRECT_AD, fondan,
tavanlı); (7) her tür için asgari etkin ölçek (MES): MES > YK_SOLO_MAX olan sektöre tek başına girilmez, 2-3 ortaklı kuruluş. Kredi/fiyat/itibar alt katman parçaları
credit_core (fund_*), prices (yk_entry_cost), market (yk_rep_seen) ve young_core'dadır. Hepsi YOUNG_KIT/FOUND_FUND kapalıyken çağrılmaz.
ARAYÜZ:
  yk_fund_step(W, w)                       haftalık: şehir kasasından fona aktarım (kasa tabanı, haftalık tavan)
  mes_be(W, kind, ci), mes_n(W, kind, ci)  başabaş kadrosu (modelin kendi maliyetinden) ve asgari etkin ölçek (başabaş ve gerçek işyeri büyüklüğü priorunun büyüğü)
  yk_group(n), yk_partner_count(W, kind, ci)   ölçek grubu (A tek / B iki ortak / C üç ortak + büyük limit) ve ortak sayısı
  yk_found_init(W, fname, kind, ci, partners)  kuruluşta d["yk"] (hedef kadro, ortaklar) ve ölçek grubu sayacı
  yk_partner_join(W, fname, c, partners)   ortakları firmaya alır (aynı firmada çalışır, nakit payı ortak sermaye)
  yk_firm_pre(W, w, c, fname, d)           genç firma haftalık: EMA'lar, açılış reklamı, dayanma limitinden çekim, fazla nakit iadesi, fon borcu rollover'ı
  yk_hire(W, w, c, fname, d, take)         talebe bağlı işe alım (take: parametresiz, işçi bulan işlev)
  yk_release_note(W, w, d, q)              SHRINK_FIRST çıkarmasında alım/çıkarma salınımı sayacı
OKUR: W.firms, W.people, W.cities, W.L, W.loans, W.need_by_city, W.last_short, W.want_last. YAZAR: W.yk (young_core), L.pay (kind kurulus_fonu_*), loans (fon kaydı).
KATMAN: L5 (credit_core, media, econ_core, young_core üstünde; entry_open ve week_people altında).
DAVRANIŞSIZ SAYAÇ (PLAN-KREDI T5): KR_MEAS=1 iken işe alım/çıkış yollarında tek satırlık sayaç (`lab_ev`/`lab_stamp`, simkit.lab_meas) ve kadro hedefi kaydı (`W.staff_tgt`); hiçbir karara girmez, kapalıyken çıktı bayt bayt aynı.
"""
import math
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.lab_meas import lab_ev, lab_stamp, hij_say
from simkit.credit_core import cx_costs, fund_bal, fund_debt, fund_lend, fund_limit, fund_pool, opex_week
from simkit.econ_core import fee_avg
from simkit.credit_core import hire_cash_secure
from simkit.media import direct_ad
from simkit.young_core import fund_lo, is_fund_lo, yk_add, yk_state


# ---------------------------------------------------------------- kuruluş fonu
def yk_fund_step(W, w):
    """K-215a: her şehir fon hedefine (FF_SHARE x (şehir kasası + fon + fon alacağı)) kadar, haftalık tavan (FF_WEEKLY x hedef) ve kasa tabanı (FF_FLOOR_WEEKS x sönümlü zorunlu gider) içinde aktarım yapar.
    Para yalnız şehir kasasından (basım yok: kasa pozitif kalır); kind kurulus_fonu_fonlama ∈ MINT_NOPRINT."""
    t0 = FF_START if FF_START >= 0 else (max(0, EO_COHORT_W0 - 10) if (EO_COHORT and ENTRY_OPEN) else 0)
    if not FOUND_FUND or w < t0:
        return
    L, loans, cities = W.L, W.loans, W.cities
    S = yk_state(W)
    out_by = defaultdict(float)
    for ln in loans.values():
        if is_fund_lo(ln["lo"]):
            out_by[ln["lo"]] += ln["out"]
    tot_b = tot_o = 0.0
    for c in cities:
        ci = c["i"]
        lo = fund_lo(ci)
        fb = L.bal[fund_pool(ci)]
        out_ = out_by[lo]
        tgt = FF_SHARE * (max(0.0, L.bal[c["acct"]]) + fb + out_)
        gap = tgt - (fb + out_)
        if gap > 1e-9:
            room = max(0.0, L.bal[c["acct"]] - FF_FLOOR_WEEKS * L.mand.get(c["acct"], 0.0))
            give = min(gap, FF_WEEKLY * tgt, room)
            if give > 1e-9:
                got = L.pay(c["acct"], fund_pool(ci), give, "kurulus_fonu_fonlama")
                S["wk"]["funded"] += got
                yk_add(W, "fon_fonlanan", got)
                fb += got
        tot_b += fb
        tot_o += out_
    S["fund_hist"].append((w, tot_b, tot_o, S["stat"]["fon_verilen"], L.flows["kurulus_fonu_geri_odeme"] + L.flows["kurulus_fonu_faiz"] + L.flows["kurulus_fonu_tasfiye"], S["stat"]["fon_fonlanan"]))


# ---------------------------------------------------------------- asgari etkin ölçek ve ortaklar
def mes_be(W, kind, ci):
    """modelin kendi maliyetinden başabaş kadrosu: sabit giderler (kira + (harç + ilk makine/bina yuvası) / geri ödeme süresi) / kişi başı katkı (satış - girdi - çırak ücreti)."""
    o, i = W.RECIPES[kind]
    if not o or kind not in PROD_OF:
        return 1
    rate = next(iter(o.values()))
    rev = sum(q * W.REF[p] for p, q in o.items()) * (1.0 - fee_avg(W))
    inp = sum(q * W.REF[p] for p, q in i.items()) * rate
    contrib = rev - inp - TIER_WAGE[0] * W.WI.get(ci, 1.0)
    mc, bc = cx_costs(W)
    fixed = ix(W, RENT) + (ix(W, FOUND_HARC) + mc + bc) / (YK_MES_BE_PAYBACK * CYCLES_PER_WEEK)
    return max(1, math.ceil(fixed / contrib)) if contrib > 1e-9 else YK_MES_MAX


def mes_n(W, kind, ci):
    """asgari etkin ölçek (kişi): max(modelin başabaş kadrosu, ceil(YK_MES_FRAC x gerçek ortalama işyeri büyüklüğü)), 1..YK_MES_MAX."""
    S = yk_state(W)
    key = (kind, ci)
    m = S.setdefault("mes", {})
    if key not in m:
        real = math.ceil(YK_MES_FRAC * YK_EST_SIZE.get(kind, 0)) if YK_EST_SIZE.get(kind, 0) else 1
        m[key] = int(min(YK_MES_MAX, max(1, mes_be(W, kind, ci), real)))
    return m[key]


def yk_group(n):
    return "A" if n <= YK_SOLO_MAX else ("B" if n <= YK_B_MAX else "C")


def yk_partner_count(W, kind, ci):
    g = yk_group(mes_n(W, kind, ci))
    return 1 if g == "A" else (YK_PARTNERS_B if g == "B" else YK_PARTNERS_C)


def yk_found_init(W, fname, kind, ci, partners):
    d = W.firms[fname]
    n = mes_n(W, kind, ci)
    d["yk"] = dict(tgt=float(max(n, 1 + len(partners))), mes=n, u=0.0, p0=0.0, s0=0.0, hired=[], ad=0, act=False)
    if partners:
        d["partners"] = list(partners)
    S = yk_state(W)
    S["grp"][yk_group(n)] += 1
    if partners:
        yk_add(W, "ortakli_kurulus")
        yk_add(W, "ortak_kisi", len(partners))


def yk_partner_join(W, fname, c, partners):
    """(DAO oyunu: ortaklar yalnız entry_open'ın dışlamalı _cands/_next_founder listelerinden gelir; insan ortak olamaz, ayrıca kanca yok.) ortaklar firmaya katılır (aynı firmada çalışır, founder işaretli); her ortak nakdinin YK_PARTNER_STAKE payını (en çok peşin nakdin yarısı) ortak sermaye koyar."""
    L, firms, people = W.L, W.firms, W.people
    d = firms[fname]
    cap = 0.5 * L.bal[fname] / max(1, len(partners))
    for q in partners:
        old = people[q]["firm"]
        if old:
            firms[old]["workers"].remove(q)
            if KR_MEAS:
                lab_ev(W, "cikis_gecis", old)                        # davranışsız sayaç (§4.6)
        elif q in c["seekers"]:
            c["seekers"].remove(q)
        d["workers"].append(q)
        if KR_MEAS:
            lab_ev(W, "ise", fname)
        people[q].update(firm=fname, founder=True)
        st_ = min(YK_PARTNER_STAKE * max(0.0, L.bal[q]), cap)
        if st_ > 1e-9:
            L.pay(q, fname, st_, "kurucu_sermayesi")
            yk_add(W, "ortak_sermaye", st_)


# ---------------------------------------------------------------- genç firma haftalık adımı
def _ykst(W, f, d):
    st = d.get("yk")
    if st is None:                                                   # klasik kuruluş yolundan gelen genç firma: hedef kadro asgari etkin ölçek
        n = mes_n(W, d["kind"], d["city"])
        st = d["yk"] = dict(tgt=float(max(n, 1)), mes=n, u=0.0, p0=d.get("prod_acc", 0.0), s0=d.get("unsold_acc", 0.0), hired=[], ad=0, act=False)
        yk_state(W)["grp"][yk_group(n)] += 1
    return st


def yk_draw(W, w, f, d):
    """K-216 (1): kasa (YK_TRIG x YK_COVER_WEEKS haftalık gider)in altına inince dayanma limiti içinde fondan çeker."""
    if not (FOUND_FUND and YOUNG_KIT):
        return 0.0
    L, loans = W.L, W.loans
    ln = loans.get(f)
    if ln and not is_fund_lo(ln["lo"]):
        yk_add(W, "cekim_karisik_kayit")
        return 0.0
    st = d.get("yk")
    if st and st["act"] and st["u"] > YK_DRAW_UNSOLD_MAX and w - d["born"] >= YK_PROBE_WEEKS:
        yk_add(W, "cekim_red_satis")
        return 0.0
    cover = YK_COVER_WEEKS * opex_week(W, f, 0)
    bal = L.bal[f]
    if bal >= YK_TRIG * cover:
        return 0.0
    need = cover - bal
    room = fund_limit(W, f) - (ln["out"] if ln else 0.0)
    if room < need - 1e-9:
        yk_add(W, "limit_siki")
    amt = min(need, room)
    if amt < 1.0:
        return 0.0
    got = fund_lend(W, f, amt, w)
    if got > 0:
        yk_add(W, "cekim_adet")
        yk_add(W, "cekim_akce", got)
    return got


def _sweep(W, f):
    """K-216 (1): kasa YK_SWEEP_WEEKS haftalık giderin üstüne çıkınca fazlası fona iade edilir (döner limit)."""
    L, loans = W.L, W.loans
    ln = loans.get(f)
    if not ln or not is_fund_lo(ln["lo"]) or ln["miss"] > 0:
        return
    lvl = YK_SWEEP_WEEKS * opex_week(W, f, 0)
    amt = min(ln["out"], L.bal[f] - lvl)
    if amt < 1.0:
        return
    paid = L.pay(f, f"{ln['lo']}_sermaye", amt, "kurulus_fonu_geri_odeme")
    ln["out"] -= paid
    if KR_MEAS and ln.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen / iade edilen kredi)
        W.lo_stat["ks_verilen"] -= paid
    ln["p0"] = max(ln["out"], ln["p0"] - paid)
    yk_add(W, "fon_iade", paid)
    W.yk["wk"]["ret"] += paid
    if ln["out"] <= 1e-6:
        del loans[f]


def _open_ad(W, w, f, d, st):
    """K-216 (5): açılış reklamı: fondan (kredi), DIRECT_AD ile medyadan; tek reklam YK_AD_WEEKS haftalık gider, fon bakiyesinin en çok YK_AD_FUND_CAP'i."""
    if st["ad"] or not (DA_ACT and FOUND_FUND) or w - d["born"] > YK_AD_TRY:
        return
    if not any(dm["kind"] == "medya" and not dm.get("dead") and dm["workers"] and m != f for m, dm in W.firms.items()):
        return
    ci = d["city"]
    n = len(d["workers"])
    amt = min(YK_AD_WEEKS * opex_week(W, f, max(0, int(st["tgt"]) - n)), YK_AD_FUND_CAP * fund_bal(W, ci))
    got = fund_lend(W, f, amt, w, tur="genc")
    if got <= 0:
        return
    paid = direct_ad(W, f, got)
    ln = W.loans.get(f)
    if paid < got - 1e-9 and ln:
        back = W.L.pay(f, fund_pool(ci), got - paid, "kurulus_fonu_geri_odeme")
        ln["out"] -= back
        if KR_MEAS and ln.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen / iade edilen kredi)
            W.lo_stat["ks_verilen"] -= back
        ln["p0"] = max(ln["out"], ln["p0"] - back)
    st["ad"] = 1
    yk_add(W, "acilis_reklam_adet")
    yk_add(W, "acilis_reklam_akce", paid)


def yk_firm_pre(W, w, c, fname, d):
    """genç oyuncu firması, haftanın başı: satış EMA'sı, açılış reklamı, nakit iadesi, dayanma limitinden çekim (kadro değişmeden)."""
    st = _ykst(W, fname, d)
    dp = d.get("prod_acc", 0.0) - st["p0"]
    du = d.get("unsold_acc", 0.0) - st["s0"]
    st["p0"], st["s0"] = d.get("prod_acc", 0.0), d.get("unsold_acc", 0.0)
    if dp > 1e-9:
        u_w = du / dp
        st["u"] = u_w if not st["act"] else 0.5 * st["u"] + 0.5 * u_w
        st["act"] = True
    if not d["workers"]:
        return
    if FOUND_FUND and YOUNG_KIT:
        _open_ad(W, w, f=fname, d=d, st=st)
        _sweep(W, fname)
        yk_draw(W, w, fname, d)


def yk_target(W, w, fname, d, st):
    """K-216 (2): hedef kadro: (a) ilk YK_PROBE_WEEKS hafta asgari etkin ölçek; (b) sektörün (şehir) kadro ihtiyacından firma başına pay; (c) kendi satışı tükeniyorsa (kendi sipariş açığı) büyür;
    (d) sektör kıtlığında (pano/karşılanmayan pay) büyür; (e) satılamayan payı yüksekse (satış eğilimi kötü) artmaz. Üst sınır firma kapasitesi."""
    n = len(d["workers"])
    cap = d["capacity"]
    age = w - d["born"]
    k, ci = d["kind"], d["city"]
    tgt = float(n)
    if age < YK_PROBE_WEEKS:
        tgt = max(tgt, float(st["mes"]))
    main = PROD_OF.get(k)
    sh = 0.0
    if main is not None:
        need_u = W.need_by_city[ci].get(main, 0.0) if getattr(W, "need_by_city", None) else 0.0
        nf = sum(1 for f_ in W.cities[ci]["firms"] if W.firms[f_]["kind"] == k and not W.firms[f_].get("dead") and W.firms[f_]["workers"])
        rate_eff = W.RECIPES[k][0][main] * d.get("tech", 1.0)
        if need_u > 0 and rate_eff > 0:
            fair = need_u / (rate_eff * max(1, nf))
            tgt = max(tgt, min(float(math.ceil(fair)), float(n + YK_HIRE_MAX)))
        sh = W.last_short.get(main, 0.0) / max(1e-9, W.want_last.get(main, 0.0))
    if st["act"] and st["u"] <= YK_SELLOUT:
        tgt = max(tgt, n * (1.0 + YK_OWN_GAIN) + 1.0)
    if sh > YK_SHORT_MIN:
        tgt = max(tgt, n * (1.0 + YK_SHORT_GAIN * min(1.0, sh)) + 1.0)
    if st["act"] and st["u"] >= YK_UNSOLD_BRAKE and age >= YK_PROBE_WEEKS:
        tgt = min(tgt, float(n))
    st["tgt"] = min(tgt, float(cap))
    return st["tgt"]


def yk_hire(W, w, c, fname, d, take):
    """K-216 (2): genç firmada talebe bağlı işe alım: haftada en çok YK_HIRE_MAX kişi (hedef kadro açığı kadar); kasa şartı yok, (kasa + çekilebilir limit) >= YK_HIRE_COVER haftalık yeni kadro gideri
    yeter. Çalışanı take() bulur (parametresiz işlev; iş arayan oyuncu / ahır oyuncusu / NPC havuzu). Yeni kadro giderleri için ardından fondan çeker."""
    L, people = W.L, W.people
    st = _ykst(W, fname, d)
    if YK_REHIRE_WAIT > 0 and st.get("shrunk") is not None and w - st["shrunk"] < YK_REHIRE_WAIT:
        yk_add(W, "ise_alim_bekle_kucul")                            # v13.0: SHRINK_FIRST az önce çıkardı: hemen yeniden alım yok (salınım)
        return
    n0 = len(d["workers"])
    tgt = yk_target(W, w, fname, d, st)
    if KR_MEAS or HUMAN_ON:
        W.staff_tgt[fname] = max(n0, min(int(math.ceil(tgt - 1e-9)), d["capacity"]))      # davranışsız kayıt (§4.6): genç kit hedef kadrosu
    want = min(YK_HIRE_MAX, int(math.ceil(tgt - 1e-9)) - n0, d["capacity"] - n0)
    if want <= 0:
        return
    for _ in range(want):
        ln = W.loans.get(fname)
        room = max(0.0, min(fund_limit(W, fname) - (ln["out"] if ln else 0.0), fund_bal(W, d["city"]))) if (FOUND_FUND and (not ln or is_fund_lo(ln["lo"]))) else 0.0
        if L.bal[fname] + room < YK_HIRE_COVER * opex_week(W, fname, 1):
            yk_add(W, "ise_alim_nakit_red")
            break
        if (HIRE_CASH_GATE or HIRE_GATE_ALL) and not hire_cash_secure(W, fname):
            yk_add(W, "ise_alim_kasa_red")                           # T9b (B): kasa (limit hariç) ücreti karşılamıyor
            if KR_MEAS or HUMAN_ON:
                W.staff_tgt[fname] = len(d["workers"])               # davranışsız kayıt (§4.6, son düzeltme I3): kapı ilanı kesti, açık kadro sayılmaz
            break
        q = take()
        if q is None:
            yk_add(W, "ise_alim_aday_yok")
            break
        d["workers"].append(q)
        if KR_MEAS:
            lab_ev(W, "ise", fname)                                  # davranışsız sayaç (§4.6)
        people[q].update(firm=fname, avans=True)
        hij_say(W, "ise", q)                                       # hijyen ölçümü (davranışsız)
        st["hired"].append((q, w))
        yk_add(W, "ise_alim")
    if len(d["workers"]) > n0:
        yk_add(W, "ise_alim_hafta_firma")
        yk_draw(W, w, fname, d)


def yk_release_note(W, w, d, q):
    """SHRINK_FIRST genç firmadan bir kişiyi çıkardı: sayaç; YK_OSC_WEEKS içinde işe alınmışsa alım/çıkarma salınımı."""
    yk_add(W, "kucul_genc_kisi")
    st = d.get("yk")
    if st:
        st["shrunk"] = w
        for i, (q_, w0) in enumerate(st["hired"]):
            if q_ == q and w - w0 <= YK_OSC_WEEKS:
                yk_add(W, "salinim")
                break
        st["hired"] = [(q_, w0) for q_, w0 in st["hired"] if q_ != q]
