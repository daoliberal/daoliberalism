"""simkit.credit_core: kredi çekirdeği: verilebilir nakit, kredi/özsermaye, risk, faiz, ücret kesintisi, firma kredisi (cx_*, young_lend, renew_lend).

K-218: CREDIT_MONEY açıkken lendable/cx_lend/renew_lend W.cm (simkit.credit_money) köprüsünü kullanır; kapalıyken W.cm yok, yol değişmez.
ARAYÜZ: sahip_kapat, home_goc_sirala (REKABET G12: oyuncu göçünde aynı sıra tercihi), home_goc_sec (REKABET G12 HOME_OWN: NPC göçünde havuzdan ev sahibi olmayanı öne alan sıra tercihi), home_birak (REKABET G12 HOME_OWN: şehir değiştiren ev sahibinin evi eski şehirde kiralık birime döner), lendable_cash, lo_credit, lo_equity, lendable, lo_term (REKABET G4: lonca koşulu tek okuyucu), lo_terms_ilk, lt_baslat, lt_durum, lt_stat_hucre, lt_say, lt_ks_ver, kayip_say, lo_oran, lo_kredi_faizi, lt_devir, lt_devir_uygun, lt_alacakli, lt_odeyen, lt_ode, _devredilemez, lt_damga, lo_kayip_yaz (REKABET G5 LONCA_TERMS: nötr başlangıç koşulu, yönetici durumu ve net gelir izleme, kuruluş kredisi sayacı, kredi kaybı kaydı, TEK faiz fonksiyonu lo_oran, borç devri, ücret batışındaki kaybın lo_loss'a yazımı), cx_say (büyüme kredisi karar sayımı), gs_acik, gs_olc, gs_pay, gs_harman (REKABET G15 GROW_SELECT: büyüme/yatırım kredisinde loncanın pd ve borç servis ölçüsü; kayıtta gs tranşının anapara payı, pd ve spread'i; kayıp payı ve faiz harmanı), ls_oran (faiz formülü tek kaynak), ls_pd, ls_gider, ls_hucre, ls_olc, ls_teklif, ls_kayit, ls_sec (REKABET G4 LONCA_SELECT: kuruluş kredisinde batma olasılığı, risk fiyatı, teklif seçimi), lonca_score (K-170 lonca seçim skoru, düşük iyi; switch_step, kapanış dağıtımı ve insan gözlemi ortak kullanır), lonca_gecis (F2: firmanın lonca geçişi; bot switch_step ve insan lonca_sec ortak), lonca_kur_eksikleri (F3: lonca kuruluş şartlarının tek kaynağı; bot nl_step, bot yeniden kurulma ve insan lonca_kur çağırır), lonca_kur_baglam, medya_firmalari, lonca_yeniden_esik, lonca_yuva_hazir, lonca_yeniden_yuvasi, lonca_fee_ort, lonca_kur_yeni, lonca_kur_yeniden (F3: kuruluş mekaniği, bot ve insan ortak), lo_classes, dep_pick (PLAN-KREDI T5: DEP_ROUTE lonca sınıfları ve mevduat hedefi), take_fee, cx_costs, capex_eligible, young_lend, renew_lend, sp_week, keep_amt, cx_base, LR_NEW, lo_risk, rate_ref, cx_rm, cx_ok, cx_lend,
  M11.2 işe alım kapısı: kopru_limit (köprü kredisi limiti, salt okuma), hire_cash_secure (kapı kararı + kredi sayesinde geçiyorsa alımdan önce eksik köprü kredisini fiilen çeker; restaff, mgr_step, oyuncu işletmesi ve genç kit hepsi bunu kullanır)
  K-215 kuruluş fonu: fund_pool, fund_bal, fund_debt, opex_week, fund_limit, fund_lend (fon kredisi loans[f] kaydında lo = "KFON<i>"; diğer kredi yolları fon kaydına eklenmez)
OKUR: W durumu (L, loans, bonds, dep_tot, firms, ...). YAZAR: yalnız L.pay ve kredi kayıtları (loans); sahip_kapat (REKABET G17h, human._kapat gövdesi) firma kaydının kapaniyor alanını, çalışan listesini, W.people[q]["firm"] ve şehir havuz/iş arayan listelerini yazar; lonca_gecis firma kaydının lonca alanlarını ve W.switches / lonca_gecis_adet sayacını yazar.
KATMAN: L1 (econ_core'a bağımlı).
"""
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.econ_core import fee_rate, hire_gate, working_capital
from simkit.sector_core import ls_cell
from simkit.credit_meas import ls_say, ls_say_b, ls_say_b_onay, ks_karar, KAYIP_TURLERI, gs_kayit
from simkit.young_core import fund_lo, is_fund_lo, yk_add
from simkit.lab_meas import lab_ev


def lendable_cash(W, lo):
    BOND_ON = W.BOND_ON
    L = W.L
    bonds = W.bonds
    dep_tot = W.dep_tot
    res_ = (CM_RESERVE if CREDIT_MONEY else DEP_RESERVE) * dep_tot[lo] if CREDIT_ON else 0.0
    if BOND_ON and RES_BONDS and res_ > 0:                           # K-185.4: devlet tahvili likit varlıktır: rezerv şartı nakit + tahvil ile karşılanır
        res_ = max(0.0, res_ - sum(b_["out"] for b_ in bonds if b_["lo"] == lo))
    return max(0.0, L.bal[f"{lo}_sermaye"] - res_)


def lo_credit(W, lo):
    loans = W.loans
    mortgages = W.mortgages
    return sum(ln_["out"] for ln_ in loans.values() if ln_["lo"] == lo) + sum(m_["out"] for m_ in mortgages if m_["lo"] == lo)


def lo_equity(W, lo):
    L = W.L
    bonds = W.bonds
    dep_tot = W.dep_tot
    return L.bal[f"{lo}_sermaye"] + lo_credit(W, lo) + sum(b_["out"] for b_ in bonds if b_["lo"] == lo) - dep_tot[lo]


def lendable(W, lo):
    LEV_ON = W.LEV_ON
    base = lendable_cash(W, lo)
    if CREDIT_MONEY and W.cm is not None:                             # K-218: kredi para yaratır: sınır nakit değil, kaldıraç x etkin özsermaye (fren varken eski kural)
        return W.cm.lendable(lo, base)
    if LEV_ON and base > 0:
        cr = lo_credit(W, lo)
        eq_ = lo_equity(W, lo)
        cap_ = max(0.0, LEV_K * max(0.0, eq_) - cr)
        if IDLE_CREDIT and eq_ > 0:                                   # M9.1b: mevduat kaynakli atil para kaldirac tavanina takilmaz (tampon lendable_cash'te zaten ayrik)
            cap_ += (1.0 - DEP_RESERVE) * W.dep_tot[lo]
        base = min(base, cap_)
    return base


def lo_term(W, lo, ad):
    """REKABET G4: loncanın kredi koşulu (`spread`, `risk_tol`, `dep_pay`) için TEK okuyucu. W.lo_terms[lo] varsa oradaki değer; yoksa spread 0.0, risk_tol 0.6, dep_pay DEP_PAYOUT (Görev 5 sözlüğü doldurur, bu yalnız okur)."""
    t = (W.__dict__.get("lo_terms") or {}).get(lo)
    if t is not None and ad in t:
        return t[ad]
    return {"spread": 0.0, "risk_tol": 0.6, "dep_pay": DEP_PAYOUT}[ad]


def lo_terms_ilk(i=0):
    """REKABET G5 (LONCA_TERMS): bütün loncalar AYNI nötr koşulla başlar (i yoksayılır; imza geriye uyum için): spread = bandın ortası (LT_SPREAD_STEP katına yuvarlı), risk_tol = bandın ortası (LT_TOL_STEP katına yuvarlı), dep_pay = DEP_PAYOUT'a en yakın LT_PAY_STEP adımı.
    Ayrışma başlangıç atamasından değil loncanın kendi deneyiminden gelir. Saf."""
    sp = round(round((LT_SPREAD_MAX / 2.0) / LT_SPREAD_STEP) * LT_SPREAD_STEP, 12)
    tol = round(LT_TOL_MIN + round(((LT_TOL_MAX - LT_TOL_MIN) / 2.0) / LT_TOL_STEP) * LT_TOL_STEP, 12)
    pay = round(LT_PAY_MIN + round((DEP_PAYOUT - LT_PAY_MIN) / LT_PAY_STEP) * LT_PAY_STEP, 12)
    return dict(spread=sp, risk_tol=tol, dep_pay=min(LT_PAY_MAX, max(LT_PAY_MIN, pay)))


def lt_baslat(W, lo):
    """REKABET G5 (LONCA_TERMS): lonca için koşul sözlüğünü nötr başlangıca kurar (dünya kurulumu, yeni lonca, kapanmış yuvanın yeniden kurulması); yönetici durumu sıfırlanır. İnsan ayarı yoksa None."""
    W.lo_terms[lo] = lo_terms_ilk(int(lo[5:]))
    W.lo_terms_insan.setdefault(lo, None)
    W.lt_gelir.pop(lo, None)
    W.lt_stat.pop(lo, None)
    if lo in W.lo_loss:
        lt_durum(W, lo)["lo_loss_onc"] = W.lo_loss[lo] / 0.98               # yeniden kurulan yuvada eski lo_loss yeni loncanın net gelirine yazılmaz (sıfırdan başlar)


def lt_durum(W, lo):
    """REKABET G5: yönetici ve net gelir izleme durumu (KR_MEAS'tan bağımsız model durumu): faiz, dagit, kayip (kumulatif), at25 (OWNER_WEEK'teki kümülatif net: yönetici karşılaştırma tabanı), g_son (son göreli getiri), faiz_ema (4 hf sönümlü tahsil edilen faiz), lo_loss_onc, ks_ver/ks_say/ks_kayip (kuruluş kredisi, 0,98 haftalık sönümlü), ziyaret, yon (kaldıraç başına tepe tırmanma durumu)."""
    d = W.lt_gelir.get(lo)
    if d is None:
        d = W.lt_gelir[lo] = dict(faiz=0.0, dagit=0.0, kayip=0.0, faiz_ema=0.0, lo_loss_onc=0.0, ks_ver=0.0, ks_say=0.0, ks_kayip=0.0, ziyaret=0, yon={}, g_son=0.0)
    return d


def lt_stat_hucre(W, lo):
    """REKABET G5: lonca başına davranışsız sayaçlar (mevduat taşıma gelen/giden, nakit yetmeyen, kapanışta mevduat kaybı); karar okumaz."""
    s_ = W.lt_stat.get(lo)
    if s_ is None:
        s_ = W.lt_stat[lo] = dict(tasi_gelen_adet=0, tasi_gelen_akce=0.0, tasi_giden_adet=0, tasi_giden_akce=0.0, tasi_nakit_yok=0, tasi_geri_adet=0, mev_kaybi=0.0, devir_alinan=0, devir_red={})
    return s_


def lt_say(W, lo, faiz, dagit, w=None):
    """REKABET G5 (haftada bir, phase_deposits): loncanın net kredi-mevduat gelirini izler: tahsil edilen faiz, mevduata dağıtılan, kredi kaybı artışı (lo_loss'un haftalık x0,98 sönümü düşülerek). Kuruluş kredisi sayaçları x0,98 sönümlenir."""
    d = lt_durum(W, lo)
    d["faiz"] += faiz
    d["dagit"] += dagit
    d["faiz_ema"] = 0.75 * d["faiz_ema"] + 0.25 * faiz
    for k_ in ("ks_say", "ks_ver", "ks_kayip"):
        d[k_] *= 0.98
    ll = W.lo_loss[lo]
    d["kayip"] += max(0.0, ll - 0.98 * d["lo_loss_onc"])
    d["lo_loss_onc"] = ll
    if w == OWNER_WEEK:
        d["at25"] = d["faiz"] - d["dagit"] - d["kayip"]                  # yönetici karşılaştırma tabanı (ilk karşılaştırma ondan bir LT_EVERY sonra)


def lt_ks_ver(W, lo, amt):
    """REKABET G5 (LONCA_TERMS): lonca lo yeni bir kuruluş kredisi verdi (adet ve tutar; risk_tol yöneticisinin girdisi, KR_MEAS'tan bağımsız)."""
    if LONCA_TERMS:
        d = lt_durum(W, lo)
        d["ks_say"] += 1.0
        d["ks_ver"] += amt


def gs_pay(ln):
    """REKABET G15 (saf): kredi kaydındaki GROW_SELECT tranşlarının anapara payı = min(1, gs_p0 / p0); gs tranşı yoksa 0."""
    g = ln.get("gs_p0", 0.0)
    return min(1.0, g / ln["p0"]) if g > 0.0 and ln.get("p0", 0.0) > 1e-9 else 0.0


def gs_harman(W, ln, f, rest):
    """REKABET G15 (saf): gs tranşlı kaydın faizi = kalan kısmın oranı (rest) ile gs kısmının risk primli oranının anapara payına göre ortalaması. gs kısmı: ls_oran(taban x rm, gs_sp, gs_pd, rm, 0): prim kendi pd'sine bağlı, yaşa bağlı değil, yeniden fiyatlamada korunur.
    Kuruluş (ya da başka) kısmın oranı kendi kuralıyla kalır (kuruluş primi G4 yaş kuralıyla biter)."""
    g = gs_pay(ln)
    if g <= 0.0:
        return rest
    rm = cx_rm(W, f)
    taban = max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, ln["lo"])) * rm)
    return rest * (1.0 - g) + ls_oran(taban, ln.get("gs_sp", 0.0), ln["gs_pd"], rm, 0) * g


def kayip_say(W, ln, kayip):
    """REKABET G5: kredi kaybı kaydı (para hareketi ve lo_loss yazımı YOK; lo_loss'u çağıran yazar ya da lo_kayip_yaz). LONCA_TERMS: kuruluş kredisi kaybı yönetici durumuna (lt_durum ks_kayip).
    KR_MEAS (davranışsız ölçüm): lonca başına kredi türüne göre kayıp dökümü W.kk_tur[lo][tur]."""
    if kayip <= 1e-9:
        return
    g_ = gs_pay(ln)                                                     # REKABET G15: kaydın GROW_SELECT tranşlarının anapara payı (0..1); kayıp payı bu oranda ayrılır
    if LONCA_TERMS:                                                     # yalnız loncanın KENDİ risk elemesinden geçmiş krediler: kuruluş (pd'li) payı ve G15 büyüme/yatırım payı; risk_tol öğrenmesinde pay ve payda aynı tabanda (tranş)
        ks_ = kayip * g_ + (kayip * (1.0 - g_) if ln.get("tur") == "kurulus" and "pd" in ln else 0.0)
        if ks_ > 0.0:
            lt_durum(W, ln["lo"])["ks_kayip"] += ks_
    if KR_MEAS:
        kk = W.__dict__.setdefault("kk_tur", {}).setdefault(ln["lo"], {})
        t_ = ln.get("tur") if ln.get("tur") in KAYIP_TURLERI else "diger"
        if g_ > 0.0:                                                    # G15: gs payı kayip_buyume / kayip_yatirim'a, kalanı kaydın türüne
            tg_ = ln.get("gs_tur", "buyume")
            kk[tg_] = kk.get(tg_, 0.0) + kayip * g_
            kayip = kayip * (1.0 - g_)
        if kayip > 1e-12:
            kk[t_] = kk.get(t_, 0.0) + kayip


def lo_oran(W, lo, f=None, ln=None, yas=0):
    """REKABET G5: loncanın f firmasına kredi faizi için TEK fonksiyon (açılış: cx_lend/young_lend/renew_lend; yeniden fiyatlama; gösterim lo_kredi_faizi). max(CX_RATE_MIN, (cx_base + lo_risk) x rm) [LONCA_TERMS: + spread x rm].
    ln verilirse (kayıtlı kredi) spread KAYITTAKİ açılış spread'idir (yoksa 0): ömür boyu sabit, lonca sonradan değiştirirse yalnız yeni krediler etkilenir; pd'li kuruluş kredisi ls_oran'a gider (yas = firma yaşı). ln yoksa loncanın güncel spread'i.
    f yoksa rm = 1. LONCA_TERMS kapalıyken eski formül aynen."""
    rm = cx_rm(W, f) if f is not None else 1.0
    taban = max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, lo)) * rm)
    if not LONCA_TERMS:
        return taban
    sp = ln.get("spread", 0.0) if ln is not None else lo_term(W, lo, "spread")
    if ln is not None and "pd" in ln:
        r_ = ls_oran(taban, sp, ln["pd"], rm, yas)
    else:
        r_ = taban + sp * rm
    return gs_harman(W, ln, f, r_) if ln is not None and f is not None and ln.get("gs_p0") else r_       # G15: gs tranşları kendi pd'si ve spread'iyle harmanlanır


def lo_kredi_faizi(W, lo, f=None):
    """REKABET G5: loncanın f firmasına gösterilen kredi faizi = tahsil edilen oranla aynı fonksiyon (lo_oran; Görev 6 gözlemi okur)."""
    return lo_oran(W, lo, f)


def lt_devir_uygun(W, f, yeni):
    """REKABET G5 (Ö4/Y3, SAF okuma): firma f'nin kaydı başka loncadaysa `yeni` onu devralabilir mi? (uygun, neden). Şartlar: kayıt var, medya/fon/payer kaydı değil; yeni lonca açık; borç düzenli (miss == 0);
    pd'li kredide pd <= yeni loncanın risk_tol'u (yeni lonca kendi kuralıyla eler); yeni lonca kalan anaparayı TAM nakit ödeyebiliyor (sermaye nakdi ve lendable; kısmi devir yok, karşılıksız aktarım yok). Neden kodları: kapali, miss, risk, nakit."""
    ln = W.loans.get(f)
    if yeni in W.closed:
        return False, "kapali"
    if ln["miss"] > 0:
        return False, "miss"
    if ("pd" in ln or "gs_pd" in ln) and max(ln.get("pd", 0.0), ln.get("gs_pd", 0.0)) > lo_term(W, yeni, "risk_tol"):
        return False, "risk"
    if W.L.bal[f"{yeni}_sermaye"] < ln["out"] - 1e-9 or lendable(W, yeni) < ln["out"] - 1e-9:
        return False, "nakit"
    return True, None


def _devredilemez(ln):
    """medya (payer'lı alım kredisi) ve kuruluş fonu kayıtları başka loncaya devredilmez; tranşı yine kaydın ALACAKLISI (medya: kaydın lonca alanı, fon: fon hesabı) öder."""
    return ln.get("tur") == "medya" or "payer" in ln or is_fund_lo(ln["lo"])


def lt_devir(W, f, yeni, w, say_kalan=False):
    """REKABET G5 (LONCA_TERMS, Ö4): firma f yeni loncaya geçti ya da yeni lonca ona kredi verecek: kredi kaydı hâlâ başka loncadaysa yeni lonca borcu eski loncadan DEVRALIR (lt_devir_uygun şartlarıyla): yeni lonca eski loncaya
    kalan anaparayı öder (L.pay kredi_portfoy_devri; para korunur), kayıt yeni loncaya geçer, spread devir anındaki yeni lonca spread'i olur ve oran lo_oran ile yeniden fiyatlanır. Devralamazsa kayıt eski loncada kalır (tahsilat ve kayıp eskiye);
    neden yeni loncanın devir_red sayacına yazılır (firma-hafta başına bir kez). True: kredi yeni loncada ya da yok. say_kalan: devralamayınca 'lonca_devir_kalan_adet' sayılır (geçiş anı)."""
    ln = W.loans.get(f)
    if ln is None or ln["lo"] == yeni or _devredilemez(ln):
        return True
    ok, neden = lt_devir_uygun(W, f, yeni)
    if not ok:
        if W.__dict__.get("_devir_red_say", (None,))[0] != w:
            W._devir_red_say = (w, set())
        if (f, yeni) not in W._devir_red_say[1]:                        # firma-hafta başına en çok bir kez sayılır
            W._devir_red_say[1].add((f, yeni))
            st_ = lt_stat_hucre(W, yeni)["devir_red"]
            st_[neden] = st_.get(neden, 0) + 1
        if say_kalan:
            W.L.flows["lonca_devir_kalan_adet"] += 1
        return False
    eski = ln["lo"]
    got = W.L.pay(f"{yeni}_sermaye", f"{eski}_sermaye", ln["out"], "kredi_portfoy_devri")
    ln["lo"] = yeni
    ln["spread"] = lo_term(W, yeni, "spread")
    if "gs_sp" in ln:
        ln["gs_sp"] = ln["spread"]                                      # G15: gs kısmının açılış spread'i de devirde yeni loncanınki olur
    ln["rate"] = lo_oran(W, yeni, f, ln, w - W.firms[f].get("born", w))
    W.L.flows["lonca_devir_alindi_adet"] += 1
    lt_stat_hucre(W, yeni)["devir_alinan"] += 1
    rm_ = W.__dict__.get("_lt_risk")                                    # switch_step / _dest_plan önbelleği devirle bayatlamasın
    if rm_ is not None:
        for l_ in (eski, yeni):
            if l_ in rm_:
                rm_[l_] = lo_risk(W, l_)
    return True


def lt_alacakli(W, f):
    """REKABET G5 (Y2, SAF okuma): f'ye yeni tranş verecek lonca. Kayıt yoksa ya da kayıt firmanın loncasındaysa firmanın loncası; kayıt başka loncadaysa devir uygunsa (lt_devir_uygun) firmanın loncası (devir tranştan önce yapılır),
    değilse kaydın ALACAKLISI (açıksa), kapalıysa None. Hiçbir yolda bir loncanın kasasından çıkan para başka loncanın alacağına yazılmaz."""
    d = W.firms[f]
    lo = d.get("lonca")
    ln = W.loans.get(f)
    if ln is None or ln["lo"] == lo or not LONCA_TERMS:
        return lo
    if not _devredilemez(ln) and lt_devir_uygun(W, f, lo)[0]:
        return lo
    return ln["lo"] if ln["lo"] not in W.closed else None


def lt_odeyen(W, f, w):
    """REKABET G5 (Y2): lt_alacakli ile aynı karar, ama devir uygunsa YAPAR. Tranşı ödeyecek loncayı döner (= kaydın alacaklısı), ya da None (alacaklı kapalı: tranş verilmez)."""
    d = W.firms[f]
    lo = d.get("lonca")
    ln = W.loans.get(f)
    if ln is None or ln["lo"] == lo:
        return lo
    if not _devredilemez(ln) and lt_devir(W, f, lo, w):
        return lo
    return ln["lo"] if ln["lo"] not in W.closed else None


def lt_ode(W, f, amt, w):
    """REKABET G5 (Ö-C): f'ye amt tutarında tranşı ödeyen lonca devirden SONRA belirlenir (lt_odeyen), verilebilir tutar ödeyenin lendable'ıyla kısılır ve ödeme yapılır; kayda yazılacak tutar FİİLEN ödenendir (asla fazlası değil).
    (ödeyen lonca ya da None, ödenen tutar) döner."""
    lo = lt_odeyen(W, f, w)
    if lo is None:
        return None, 0.0
    amt = min(amt, lendable(W, lo))
    if amt <= 1e-9:
        return lo, 0.0
    return lo, W.L.pay(f"{lo}_sermaye", f, amt, "kredi_verilen")


def lt_damga(W, f, ln, amt):
    """REKABET G5 (Y5, LONCA_TERMS): loncanın verdiği HER kredinin TEK açılış damgası (yeni kayıt ya da kayda eklenen tranş; amt = bu tranşın tutarı, ln["out"] tranş eklenmiş). Yeni kayıtta açılış spread'i yazılır ve (pd'li kuruluş kredisi değilse)
    oran lo_oran ile (risk primi 0, spread var) konur; eklenen tranşta kayıttaki spread tutar ağırlıklı ortalamayla güncellenir (her tranşın açılış spread'i ömrünce korunur). Medya ve fon kayıtlarına dokunmaz."""
    if not LONCA_TERMS or ln.get("tur") == "medya" or "payer" in ln or is_fund_lo(ln["lo"]):
        return
    sp = lo_term(W, ln["lo"], "spread")
    once = ln["out"] - amt
    if once <= 1e-9:
        ln["spread"] = sp
        if "pd" not in ln:
            ln["rate"] = lo_oran(W, ln["lo"], f)
    else:
        ln["spread"] = (ln.get("spread", 0.0) * once + sp * amt) / ln["out"]


def lo_kayip_yaz(W, ln, kayip):
    """REKABET G5 (LONCA_TERMS): ücret/tasfiye batışında kredinin geri ödenmeyen kalanı loncanın kredi kaybına (lo_loss) yazılır; temerrüt yolları zaten yazar. Para hareketi yok. Kayıp ayrıca kayip_say ile türüne göre kaydedilir."""
    if LONCA_TERMS and kayip > 1e-9:
        W.lo_loss[ln["lo"]] += kayip
    kayip_say(W, ln, kayip)


def ls_pd(b, cov):
    """REKABET G4: batma olasılığı = min(0,95, b x clamp(2 - cov, 0,5, 1,5)); b hücre batış oranı, cov gelir/gider karşılama (1 = başa baş). Gerçek dünya: sektör ve yer bazlı batış oranı ve nakit akışı karşılamasına göre skorlama (Berger ve Udell 2006)."""
    return min(0.95, b * min(1.5, max(0.5, 2.0 - cov)))


def ls_gider(W, fname):
    """REKABET G4: yeni firmanın haftalık işletme gideri = working_capital x CYCLES_PER_WEEK / WORKING_CAPITAL_CYCLES (firms[fname] kurulmuş olmalı; saf)."""
    return working_capital(W, W.firms, W.people, fname, extra_workers=1) * CYCLES_PER_WEEK / WORKING_CAPITAL_CYCLES


def ls_hucre(W, ci, kind, w):
    """REKABET G4: ls_cell önbelleği (salt hız; sonuç aynı): (şehir, tür) için hafta başına bir kez; hafta değişince temizlenir, phase_founding başarılı kuruluşta da sıfırlar (W._ls_memo)."""
    mm = W.__dict__.get("_ls_memo")
    if mm is None or mm[0] != w:
        mm = W._ls_memo = (w, {})
    v = mm[1].get((ci, kind))
    if v is None:
        v = mm[1][(ci, kind)] = ls_cell(W, ci, kind, w)
    return v


def ls_olc(W, ci, kind, gider, w):
    """REKABET G4: (pd, cov). cov = (R x n/(n+1)) / gider (yeni girişle hücre cirosu n+1 firmaya bölünür; hücre boşsa dilüsyon yok); ciro bilgisi yoksa cov = 1. Saf."""
    R, n, b, _ = ls_hucre(W, ci, kind, w)
    if R <= 0.0 or gider <= 1e-12:
        cov = 1.0
    else:
        cov = (R * n / (n + 1) if n > 0 else R) / gider
    return ls_pd(b, cov), cov


def ls_oran(taban_rm, spread, pd, rm, yas=0):
    """REKABET G4: risk fiyatlı faiz, TEK kaynak (teklif ve 4 haftalık yeniden fiyatlama aynı ifadeyi kullanır): min(LOAN_RATE, taban_rm) + (spread + pd x LS_LGD / LS_T) x rm.
    taban_rm = itibar çarpanı dahil taban faiz (teklifte LR_NEW x rm; yeniden fiyatlamada (cx_base + lo_risk) x cx_rm); LOAN_RATE tavanı yalnız tabana uygulanır, risk primi ve spread tavanın üstüne biner.
    yas = firmanın haftalık yaşı: pd primi yalnız kuruluş riskinin taşındığı dönemde (yas < LS_T) uygulanır; sonrasında prim 0, lonca spread'i kalır (beklenen kayıp ufku LS_T)."""
    return min(LOAN_RATE, taban_rm) + (spread + (pd * LS_LGD / LS_T if yas < LS_T else 0.0)) * rm


def ls_teklif(W, lo, ci, kind, gider, rm, w):
    """REKABET G4: lonca lo'nun kuruluş kredisi teklifi (kabul, rate, pd). pd > risk_tol ise ret; değilse rate = ls_oran(LR_NEW x rm, spread, pd, rm). Saf.
    Gerçek dünya: beklenen kayıp = PD x LGD, vadeye bölünüp faize eklenir (Basel II içsel derecelendirme); risk iştahını aşan başvuru reddedilir (Stiglitz ve Weiss 1981)."""
    pd, _ = ls_olc(W, ci, kind, gider, w)
    if pd > lo_term(W, lo, "risk_tol"):
        return False, 0.0, pd
    return True, ls_oran(LR_NEW(W) * rm, lo_term(W, lo, "spread"), pd, rm), pd


def ls_kayit(W, w, lo, ci, kind, gider, sebep):
    """REKABET G4 (yalnız KR_MEAS): lonca kararını ls_say ile sayar; ret satırına pd, cov, risk_tol, şehir, ürün eklenir. Davranışsız."""
    if not KR_MEAS:
        return
    if sebep is None:
        ls_say(W, w, lo, None)
        return
    pd, cov = ls_olc(W, ci, kind, gider, w)
    ls_say(W, w, lo, sebep, pd=round(pd, 4), cov=round(cov, 4), risk_tol=lo_term(W, lo, "risk_tol"), sehir=ci, urun=kind)


def ls_sec(W, w, ci, kind, founder, wc_need, gider, own, rm):
    """REKABET G4 (LONCA_SELECT): kurucu bütün canlı loncalardan teklif ister; havuzu yetmeyen lonca kasa_yetersiz/limit, pd > risk_tol olan risk sebebiyle reddeder (hepsi ls_kayit ile sayılır).
    (lo, rate, pd, riskli, esit) döner: kabul edenlerin en düşük faizi rate; esit = bu faizi veren loncalar (sıra korunur). Yalnız faiz farkı varken en ucuz kazanır (esit tek elemanlı); EŞİTKEN seçimi çağıran eski kuralla yapar
    (K-167 pick_lonca: Ar-Ge telif avantajı, üyelik payı, havuz) ve lo = esit[0] yalnız öntanımlıdır. lo None = kimse vermedi (riskli: en az biri riskle reddetti). Durum yazmaz (yalnız sayaç). Kota ve bekleme yok.
    NOT: ciro bilgisi (W.srev_hist; HIRE_GATE_GROWTH açıkken var) yoksa cov=1 sayılır, bu durum ks_cov_yok ile sayılır (KR_MEAS)."""
    if KR_MEAS and ls_hucre(W, ci, kind, w)[0] <= 0.0:
        ks_karar(W, "cov_yok")
    en = None
    esit = []
    riskli = False
    pd_son = 0.0
    for lo in W.loncas:
        if lo in W.closed:
            continue
        havuz = lendable(W, lo)
        grant = havuz
        if INNOV_ON and REP_EFFECT and not FOUND_COLLAT:
            grant = min(grant, wc_need * min(1.0, CM_BASE + (1 - CM_BASE) * W.REP[founder] / CM_REP))
        if ENTRY_EXP and EE_FIN_OLD:
            grant = min(grant, (1.0 - EE_OWN) * wc_need)
        if grant + own < wc_need:
            ls_kayit(W, w, lo, ci, kind, gider, "kasa_yetersiz" if havuz + own < wc_need else "limit")
            continue
        kabul, rate, pd = ls_teklif(W, lo, ci, kind, gider, rm, w)
        pd_son = pd
        if not kabul:
            riskli = True
            ls_kayit(W, w, lo, ci, kind, gider, "risk")
            continue
        ls_kayit(W, w, lo, ci, kind, gider, None)
        r_ = round(rate, 12)
        if en is None or r_ < en[0]:
            en = (r_, rate, pd)
            esit = [lo]
        elif r_ == en[0]:
            esit.append(lo)
    if en is None:
        return None, 0.0, pd_son, riskli, []
    return esit[0], en[1], en[2], False, esit

def lo_classes(W):
    """PLAN-KREDI T5 (U5, U6): açık loncaların sınıfı -> (verebilen, batık, ara, h, c). Saf okuma; kapalı lonca hiçbir sınıfta değildir.
    verebilen: öz kaynak > 0 ve (LONCA_LEVERAGE açıkken) kaldıraç payı h = LEV_K x öz kaynak - kredi > 0. batık: öz kaynak < 0. ara: geri kalan.
    c = h - (1 - DEP_RESERVE) x mevduat: loncanın boş mevduat kapasitesi (LONCA_LEVERAGE kapalıyken h = c = sonsuz). h, c: lonca -> değer (kapalı lonca yok)."""
    dep_tot = W.dep_tot
    ver, bat, ara = [], [], []
    h, c = {}, {}
    for lo in W.loncas:
        if lo in W.closed:
            continue
        eq = lo_equity(W, lo)
        hh = (LEV_K * eq - lo_credit(W, lo)) if W.LEV_ON else float("inf")
        h[lo] = hh
        c[lo] = hh - (1.0 - DEP_RESERVE) * dep_tot[lo]
        if IDLE_CREDIT and W.LEV_ON and eq > 0:                       # M9.1b: lendable ile tutarli: mevduat kaynakli kisim kaldirac tavanindan sayilmaz (h genisler, c = bos kapasite = h)
            hh += (1.0 - DEP_RESERVE) * dep_tot[lo]
            h[lo] = hh
            c[lo] = hh
        if eq < 0:
            bat.append(lo)
        elif eq > 0 and hh > 0:
            ver.append(lo)
        else:
            ara.append(lo)
    return ver, bat, ara, h, c


def dep_pick(W, cls):
    """PLAN-KREDI T5 (U6): yeni mevduatın ya da taşınan hesabın hedef loncası (su doldurma); sınıflar `lo_classes`tan, kapasite her çağrıda GÜNCEL mevduatla.
    Verebilenler arasında boş kapasitesi (c) en büyük; c > 0 olan yoksa en büyük h'li; verebilen yoksa ara loncalar aynı kuralla; o da yoksa None (para elde kalır).
    Eşitlikte en yüksek dep_ema, sonra küçük lonca numarası. LONCA_LEVERAGE kapalıyken (h sonsuz) en az mevduatlı lonca."""
    dep_tot, dep_ema = W.dep_tot, W.dep_ema
    ver, _bat, ara, h, _c = cls
    for grp in (ver, ara):
        if not grp:
            continue
        cap = {lo: h[lo] - (1.0 - DEP_RESERVE) * dep_tot[lo] for lo in grp}
        free = [lo for lo in grp if cap[lo] > 0]
        if free:
            if W.LEV_ON:
                return max(free, key=lambda lo: (cap[lo], dep_ema[lo], -int(lo[5:])))
            return min(free, key=lambda lo: (dep_tot[lo], -dep_ema[lo], int(lo[5:])))
        return max(grp, key=lambda lo: (h[lo], dep_ema[lo], -int(lo[5:])))
    return None


def take_fee(W, payer, lonca, base):
    L = W.L
    fee_inc = W.fee_inc
    amt = L.pay(payer, lonca, base * fee_rate(W, lonca), "lonca_fee")
    fee_inc[lonca] += amt
    return amt


def cx_costs(W):
    REF = W.REF
    return MACH_AL * REF["aluminyum"] + MACH_BI * REF["bilesen"], BLD_INS * REF["insaat"]


def capex_eligible(W, d):
    return not d.get("dead") and d["workers"] and d["kind"] not in ("ahir", "belediye", "arge")


def fund_pool(ci):
    return f"{fund_lo(ci)}_sermaye"


def fund_bal(W, ci):
    return W.L.bal[fund_pool(ci)]


def fund_debt(W, f):
    """firmanın kuruluş fonuna kalan borcu (fon kaydı yoksa 0)."""
    ln = W.loans.get(f)
    return ln["out"] if (ln and is_fund_lo(ln["lo"])) else 0.0


def opex_week(W, f, extra=0):
    """haftalık işletme gideri tahmini = işletme sermayesi (WORKING_CAPITAL_CYCLES döngülük ücret + kira + girdi) / döngü x haftalık döngü; extra = ek çalışan."""
    return working_capital(W, W.firms, W.people, f, extra) * CYCLES_PER_WEEK / WORKING_CAPITAL_CYCLES


def fund_limit(W, f):
    """K-216 (1): dayanma limiti = YK_RUNWAY_WEEKS x haftalık işletme gideri (kadro ve hedef kadrodan büyük olanla)."""
    d = W.firms[f]
    n = len(d["workers"])
    st = d.get("yk")
    tgt = max(n, int(st["tgt"] + 0.9999)) if st else n
    return YK_RUNWAY_WEEKS * opex_week(W, f, tgt - n)


def fund_lend(W, f, amt, w, tur="kurulus"):
    """K-215: şehrin kuruluş fonundan firmaya kredi (kind kurulus_fonu_kredi). Firmanın başka alacaklıdan kaydı varsa ya da gecikmişse verilmez. Verilen tutarı döndürür."""
    L = W.L
    loans = W.loans
    d = W.firms[f]
    ci = d["city"]
    ln = loans.get(f)
    if (ln and not is_fund_lo(ln["lo"])) or (ln and ln["miss"] > 0):
        yk_add(W, "fon_red_kayit")
        return 0.0
    amt = min(amt, L.bal[fund_pool(ci)])
    if amt < 1.0:
        return 0.0
    L.pay(fund_pool(ci), f, amt, "kurulus_fonu_kredi")
    if ln:
        ln["p0"] += amt
        ln["out"] += amt
    else:
        loans[f] = dict(lo=fund_lo(ci), p0=amt, out=amt, miss=0, rate=max(CX_RATE_MIN, cx_base(W) * cx_rm(W, f)), tur=tur)
        L.flows["kredi_adet"] += 1
    L.flows["kredi_fon_adet"] += 1
    if KR_MEAS and loans[f].get("tur") == "kurulus":       # REKABET G0: davranışsız ölçüm (kuruluş kaydına verilen tutar; kaydın türüne bakar)
        W.lo_stat["ks_verilen"] += amt
    yk_add(W, "fon_verilen", amt)
    W.yk["wk"]["given"] += amt
    return amt


def young_lend(W, f, amt, w, mc, bc):
    """K-185.12: genç firma kredisi: yaş/kâr şartı yok; limit = k × (işletme sermayesi + başlangıç yuvası maliyeti) × itibar çarpanı; havuzun en çok YOUNG_POOL_SHARE'i."""
    L = W.L
    REP = W.REP
    closed = W.closed
    firms = W.firms
    loans = W.loans
    people = W.people
    young_stat = W.young_stat
    d = firms[f]
    lo = d["lonca"]
    if lo in closed or amt < 1e-9:
        return 0.0
    n = max(1, len(d["workers"]))
    rep = REP[d["owner"]] if (INNOV_ON and d["owner"] in people) else CM_REP
    lim = YOUNG_LIM_MULT * (working_capital(W, firms, people, f, 1) + (mc + bc) * max(2.0, n)) * (1.0 if ENTRY_OPEN else min(1.0, CM_BASE + (1 - CM_BASE) * rep / CM_REP))      # K-213: ENTRY_OPEN'da limit itibara bağlı değil (itibar yalnız faizi etkiler)
    ln = loans.get(f)
    if LONCA_TERMS and ln and ln["lo"] != lo and not is_fund_lo(ln["lo"]):       # REKABET G5 (Y2): tranşı kaydın ALACAKLISI öder (borç devralınabiliyorsa önce devir); alacaklı kapalıysa tranş yok
        lo = lt_odeyen(W, f, w)
        if lo is None:
            young_stat["red"] += 1
            return 0.0
        ln = loans.get(f)
    out_ = ln["out"] if ln else 0.0
    if YOUNG_KIT and FOUND_FUND and (not ln or is_fund_lo(ln["lo"])):      # K-216: genç firma yatırım (yuva) kredisi de kuruluş fonundan (dayanma limitinin üstüne yuva limiti)
        amt = min(amt, lim + fund_limit(W, f) - out_)
        got = fund_lend(W, f, amt, w, tur="genc") if amt >= 1.0 else 0.0
        if got <= 0:
            young_stat["red"] += 1
            return 0.0
        d["young_credit"] = True
        young_stat["adet"] += 1
        young_stat["hacim"] += got
        L.flows["kredi_genc_adet"] += 1
        return got
    if ln and is_fund_lo(ln["lo"]):
        young_stat["red"] += 1
        return 0.0
    amt = min(amt, lim - out_, YOUNG_POOL_SHARE * lendable(W, lo))
    if amt < 1.0 or (ln and ln["miss"] > 0):
        young_stat["red"] += 1
        return 0.0
    L.pay(f"{lo}_sermaye", f, amt, "kredi_verilen")
    rate = lo_oran(W, lo, f)                                        # REKABET G5: tek faiz fonksiyonu (LONCA_TERMS kapalıyken eski formül)
    if ln:
        ln["p0"] += amt
        ln["out"] += amt
        if KR_MEAS and ln.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen kredi)
            W.lo_stat["ks_verilen"] += amt
    else:
        loans[f] = dict(lo=lo, p0=amt, out=amt, miss=0, rate=rate, tur="genc")
    if LONCA_TERMS:
        lt_damga(W, f, loans[f], amt)                                       # REKABET G5: tek açılış damgası (spread, oran)
    d["young_credit"] = True
    young_stat["adet"] += 1
    young_stat["hacim"] += amt
    L.flows["kredi_genc_adet"] += 1
    return amt


def renew_lend(W, f, amt, w, mc, bc):
    """K-185.12: yenileme/yatırım kredisi (NPC dahil): yaş ve kâr şartı yok; teminat makine/bina (tasfiyede alacaklı önce)."""
    L = W.L
    capex_stat = W.capex_stat
    closed = W.closed
    firms = W.firms
    loans = W.loans
    people = W.people
    d = firms[f]
    lo = d["lonca"]
    if lo in closed or amt < 1e-9:
        return 0.0
    coll = d.get("mach", 0.0) * mc * (1 - LIQ_DISC_M) + d.get("bld", 0.0) * bc * (1 - LIQ_DISC_B)
    ln = loans.get(f)
    if ln and is_fund_lo(ln["lo"]):
        return 0.0                                                   # K-215: fon kaydına lonca kredisi eklenmez
    if LONCA_TERMS and ln and ln["lo"] != lo:                       # REKABET G5 (Y2): tranşı kaydın ALACAKLISI öder (borç devralınabiliyorsa önce devir); alacaklı kapalıysa tranş yok
        lo = lt_odeyen(W, f, w)
        if lo is None:
            return 0.0
        ln = loans.get(f)
    out_ = ln["out"] if ln else 0.0
    lim = LOAN_LEV * working_capital(W, firms, people, f) + 0.8 * coll
    amt = min(amt, lim - out_, lendable(W, lo))
    if amt < 1.0 or (ln and ln["miss"] > 0):
        return 0.0
    rate = lo_oran(W, lo, f)                                        # REKABET G5: tek faiz fonksiyonu
    if CREDIT_MONEY and W.cm is not None and not W.cm.pd_ok(f, amt, rate, coll):     # K-218: Caiani rasyonlaması (teminatlı: kayıp oranı teminatla düşer)
        return 0.0
    L.pay(f"{lo}_sermaye", f, amt, "kredi_verilen")
    if ln:
        ln["p0"] += amt
        ln["out"] += amt
        if KR_MEAS and ln.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen kredi)
            W.lo_stat["ks_verilen"] += amt
    else:
        loans[f] = dict(lo=lo, p0=amt, out=amt, miss=0, rate=rate, tur="yenileme")
    if LONCA_TERMS:
        lt_damga(W, f, loans[f], amt)                                       # REKABET G5: tek açılış damgası
    capex_stat["yenileme_kredisi"] += amt
    L.flows["kredi_yenileme_adet"] += 1
    return amt


def sp_week(W, q):
    hab = W.hab
    people = W.people
    i_ = people[q]
    return max(i_["wage"] * CYCLES_PER_WEEK, hab.get(q, 0.0) * CYCLES_PER_WEEK)


def keep_amt(W, q):
    return (DEP_KEEP_NEW if DV_ACT else DEP_KEEP) * sp_week(W, q)


def cx_base(W):
    POL_ON = W.POL_ON
    dep_slow = W.dep_slow
    pol = W.pol
    if POL_ON and pol[0] is not None:
        return min(LOAN_RATE, max(CX_RATE_MIN, pol[0] + CX_MARGIN))
    return min(LOAN_RATE, max(CX_RATE_MIN, max(0.0, dep_slow[0]) + CX_MARGIN))


def LR_NEW(W):
    """K-185.18: yeni kuruluş/NPC köprü kredisi faizi politika faizine bağlı (eski: sabit LOAN_RATE)."""
    POL_ON = W.POL_ON
    return cx_base(W) if POL_ON else LOAN_RATE


def lo_risk(W, lo):
    """K-185.5: lonca kendi risk marjını koyar (kredi kaybı yüksekse faiz üstü)."""
    POL_ON = W.POL_ON
    lo_loss = W.lo_loss
    loans = W.loans
    if not POL_ON:
        return 0.0
    out_ = sum(ln_["out"] for ln_ in loans.values() if ln_["lo"] == lo)
    return min(RISK_MAX, RISK_K * lo_loss[lo] / max(2000.0, out_))


def rate_ref(W):
    POL_ON = W.POL_ON
    dep_slow = W.dep_slow
    pol = W.pol
    return pol[0] if (POL_ON and pol[0] is not None) else max(0.0, dep_slow[0])


def cx_rm(W, f):
    REP = W.REP
    firms = W.firms
    orep = W.orep
    people = W.people
    d = firms[f]
    rm = 1.0
    o = d.get("owner")
    if REP_EFFECT and o in people:
        rm = min(RM_HI, max(RM_LO, 1.3 - 0.6 * REP[o] / 100))
    if ORG_ACT:
        rm *= 1.2 - 0.4 * orep.get(f, 50.0) / 100.0
    return rm


def gs_acik(tur):
    """REKABET G15: GROW_SELECT yolu bu kredi türünde açık mı? (GROW_SELECT ve LONCA_SELECT; yalnız büyüme ve yatırım; Ar-Ge eski yolda kalır)."""
    return bool(GROW_SELECT and LONCA_SELECT) and tur in ("buyume", "yatirim")


def gs_olc(W, f, lo, borc, w):
    """REKABET G15 (saf): loncanın firma f için büyüme/yatırım kredisi ölçüsü (rate, pd, cov, dsr_ok). borc = yeni toplam borç (mevcut + istenen).
    Haftalık borç servisi sv = borc / LOAN_TERM + faiz0 x borc (faiz0 = risk primsiz taban: (cx_base + lo_risk) x rm + spread x rm; prim pd'den sonra bilinir).
    cov = NET FAALİYET GELİRİ / sv: gelir = snet_hist son 4 hf ortalaması (satış - girdi alımı/navlun - kira - ücret; FAİZ ÖNCESİ, faiz çıkarılmamıştır); negatif gelir cov'u negatif yapar ve ls_pd'nin clamp'iyle pd = 1,5 x b olur. snet_hist yoksa cov = 1 (pd yalnız hücre b'sine bağlı).
    pd = ls_pd(b, cov), b = firmanın (şehir, tür) hücresi (ls_hucre). DSR tavanı CİROYA göredir: dsr_ok = sv <= CX_DSR x ciro (srev_hist son 4 hf ortalaması). Ciro bilgisi yoksa cov = 1 kuralıyla tutarlı olarak ciro = sv sayılır: tavan aşılır (dsr_ok = False), sınırsız borç verilmez.
    rate = ls_oran(taban x rm, spread, pd, rm, 0): risk primi kredinin kendi pd'sine bağlı (yaş koşulu yok). Gerçek dünya: borç servisi karşılama oranı (DSCR) ve beklenen kayıp = PD x LGD fiyatı (Basel II; Berger ve Udell 2006)."""
    d = W.firms[f]
    rm = cx_rm(W, f)
    taban = max(CX_RATE_MIN, (cx_base(W) + lo_risk(W, lo)) * rm)
    sp = lo_term(W, lo, "spread") if LONCA_TERMS else 0.0
    sv = borc / LOAN_TERM + (taban + sp * rm) * borc
    h = (W.__dict__.get("srev_hist") or {}).get(f)
    dsr_ok = bool(h) and sv <= CX_DSR * (sum(h) / len(h)) + 1e-12
    hn = (W.__dict__.get("snet_hist") or {}).get(f)
    cov = (sum(hn) / len(hn)) / sv if hn and sv > 1e-12 else 1.0
    b = ls_hucre(W, d["city"], d["kind"], w)[2]
    pd = ls_pd(b, cov)
    return ls_oran(taban, sp, pd, rm, 0), pd, cov, dsr_ok


def cx_say(W, f, w, sebep):
    """REKABET G4 (yalnız KR_MEAS; davranışsız): büyüme ailesi (büyüme, yatırım, Ar-Ge) kredi kararını lonca başına sayar. Firma başına HAFTADA en çok bir başvuru ve bir sonuç (ilk gelen; onay ya da tek sebep kodu) sayılır, capex ve büyüme yolları çift saymaz.
    Çağıran yalnız GERÇEK TALEP varken çağırır (fonlama açığı > 0). Eleme sebebi cx_ok'un bıraktığı W._cx_kod'dur. Aynı firma-hafta için önce ret sonra onay gelirse ONAY KAZANIR (ret düzeltilir, başvuru sayısı değişmez)."""
    if not KR_MEAS:
        return
    mm = W.__dict__.get("_cx_say")
    if mm is None or mm[0] != w:
        mm = W._cx_say = (w, {})
    lo = W.firms[f].get("lonca")
    if f in mm[1]:
        eski = mm[1][f]
        if sebep is None and eski is not None:                  # onay kazanır: önce ret, sonra onay gelirse ret onaya çevrilir
            mm[1][f] = None
            ls_say_b_onay(W, lo, eski)
        return
    mm[1][f] = sebep
    ls_say_b(W, lo, sebep)


def cx_ok(W, f, w, tur=None):
    """K-181: teminat yok; itibar ve kâr geçmişi şart: yaş, kâr, kurum itibarı, taksit kaçırmamış, satış yapıyor (alıcısız oranı düşük).
    REKABET G15: tur büyüme/yatırım ve gs_acik ise kâr eşiği uygulanmaz (diğer eleme kuralları aynen); karar cx_lend'de loncanın risk kararıdır."""
    cx_ref = W.cx_ref
    firms = W.firms
    loans = W.loans
    orep = W.orep
    prof_ema = W.prof_ema
    d = firms[f]
    ln = loans.get(f)
    pv_ = d.get("priv") if CRED_V2 else None
    young_ = CRED_V2 and (w - d.get("born", w) < YOUNG_WEEKS or pv_ is not None)
    if w - d.get("born", w) < CX_MIN_AGE and not young_:
        cx_ref["yas"] += 1
        if KR_MEAS:
            W._cx_kod = "buyume_yas"                   # REKABET G4: sayım çağıranda (yalnız gerçek talepte; cx_say)             # REKABET G4: davranışsız ret sebebi sayımı (KR_MEAS)
        return False
    if not gs_acik(tur) and prof_ema[f] < ix(W, CX_MIN_PROFIT) and not (pv_ is not None and w - pv_["w"] < CRED_PLAN_WEEKS):
        cx_ref["kar"] += 1
        if KR_MEAS:
            W._cx_kod = "buyume_kar"                   # REKABET G4: sayım çağıranda (yalnız gerçek talepte; cx_say)
        return False
    if ln and ln["miss"] > 0:
        cx_ref["gecikme"] += 1
        if KR_MEAS:
            W._cx_kod = "buyume_gecikme"                   # REKABET G4: sayım çağıranda (yalnız gerçek talepte; cx_say)
        return False
    if ORG_ACT and orep.get(f, 50.0) < CX_MIN_OREP:
        cx_ref["itibar"] += 1
        if KR_MEAS:
            W._cx_kod = "buyume_itibar"                   # REKABET G4: sayım çağıranda (yalnız gerçek talepte; cx_say)
        return False
    if d["kind"] != "arge" and d.get("unsold_acc", 0.0) / max(1e-9, d.get("prod_acc", 0.0)) > 0.15:
        cx_ref["satilamayan"] += 1
        if KR_MEAS:
            W._cx_kod = "buyume_satilamayan"                   # REKABET G4: sayım çağıranda (yalnız gerçek talepte; cx_say)
        return False
    cx_ref["gecti"] += 1
    return True


def cx_lend(W, f, amt, tur, w, cap_k):
    """Kredi ver: toplam borç ≤ cap_k × haftalık sönümlü kâr, havuzda yeterli kaynak."""
    L = W.L
    cx_ref = W.cx_ref
    cx_stat = W.cx_stat
    firms = W.firms
    loans = W.loans
    people = W.people
    prof_ema = W.prof_ema
    d = firms[f]
    ln = loans.get(f)
    if ln and is_fund_lo(ln["lo"]):
        cx_say(W, f, w, tur + "_fon")                    # REKABET G4: davranışsız ret sebebi sayımı (KR_MEAS)
        return 0.0                                                   # K-215: fon kaydına lonca kredisi eklenmez
    lo = d["lonca"]
    if LONCA_TERMS and ln and ln["lo"] != lo:                        # REKABET G5 (Y2): tranşı kaydın ALACAKLISI öder (borç devralınabiliyorsa önce devir); alacaklı kapalıysa reddedilir
        lo = lt_odeyen(W, f, w)
        if lo is None:
            cx_say(W, f, w, tur + "_devir_fon")
            return 0.0
        ln = loans.get(f)
    out_ = ln["out"] if ln else 0.0
    if amt <= 1e-9:
        return 0.0
    pe_ = prof_ema[f]
    if CRED_V2 and d.get("priv") is not None and w - d["priv"]["w"] < CRED_PLAN_WEEKS:
        pe_ = max(pe_, CRED_PLAN_PROF * working_capital(W, firms, people, f))
    gs_ = gs_acik(tur)
    if gs_:                                                          # REKABET G15: kâr katı tavanı yerine loncanın risk kararı (pd) ve borç servis tavanı (DSR)
        rate_gs, pd_gs, cov_gs, dsr_ok = gs_olc(W, f, lo, out_ + amt, w)
        if not dsr_ok:
            cx_ref["limit_dsr"] += 1
            cx_say(W, f, w, tur + "_dsr")
            return 0.0
        if pd_gs > lo_term(W, lo, "risk_tol"):
            cx_ref["limit_risk"] += 1
            cx_say(W, f, w, tur + "_risk")
            return 0.0
    elif out_ + amt > cap_k * pe_:
        cx_ref["limit_kar_katı"] += 1
        cx_say(W, f, w, tur + "_kar_limiti")
        return 0.0
    if amt > lendable(W, lo):
        cx_ref["havuz_yetmez"] += 1
        cx_say(W, f, w, tur + "_havuz")
        return 0.0
    if CREDIT_MONEY and W.cm is not None and not W.cm.pd_ok(f, amt, lo_oran(W, lo, f)):     # K-218: Caiani rasyonlaması
        cx_ref["pd_ret"] += 1
        cx_say(W, f, w, tur + "_pd")
        return 0.0
    cx_say(W, f, w, None)
    L.pay(f"{lo}_sermaye", f, amt, "kredi_verilen")
    rate = rate_gs if gs_ else lo_oran(W, lo, f)             # REKABET G5: tek faiz fonksiyonu; G15: gs'de risk primli oran
    if ln:
        rate_eski_ = ln.get("rate", rate)
        ln["p0"] += amt
        ln["out"] += amt
        if KR_MEAS and ln.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen kredi)
            W.lo_stat["ks_verilen"] += amt
        if gs_:                                                        # G15: tranşın kendi pd'si ve spread'i kayıtta kendi anapara payıyla izlenir (kaydın başka kısımlarının pd/spread'ine karışmaz)
            ogs_ = ln.get("gs_p0", 0.0) * ((ln["out"] - amt) / max(ln["p0"] - amt, 1e-9))      # önceki gs tranşlarının kalan anapara tahmini (p0 ile orantılı amortisman)
            sp_ = lo_term(W, lo, "spread") if LONCA_TERMS else 0.0
            ln["gs_pd"] = (ln.get("gs_pd", 0.0) * ogs_ + pd_gs * amt) / (ogs_ + amt)         # tutar ağırlıklı: firma iyileştikçe pd düşebilir
            ln["gs_sp"] = (ln.get("gs_sp", 0.0) * ogs_ + sp_ * amt) / (ogs_ + amt)
            ln["gs_p0"] = ln.get("gs_p0", 0.0) + amt
            ln["gs_tur"] = tur
            ln["rate"] = (rate_eski_ * (ln["out"] - amt) + rate * amt) / ln["out"]            # kayıt oranı: eski borç ve yeni tranşın tutar ağırlıklı ortalaması
    else:
        loans[f] = dict(lo=lo, p0=amt, out=amt, miss=0, rate=rate, tur=tur)
        if gs_:
            loans[f].update(gs_p0=amt, gs_pd=pd_gs, gs_sp=lo_term(W, lo, "spread") if LONCA_TERMS else 0.0, gs_tur=tur)
    if LONCA_TERMS:
        lt_damga(W, f, loans[f], amt)                                   # REKABET G5: tek açılış damgası
        if gs_:
            if loans[f]["out"] - amt <= 1e-9:
                loans[f]["rate"] = rate                                 # yeni gs kaydı: risk primli oran (lt_damga primsiz koymuştu)
            lt_ks_ver(W, lo, amt)                                       # G15: yöneticinin kendi elediği kredi stoğuna girer (risk_tol kuralı; pay: gs tranşı)
    if gs_ and KR_MEAS:
        gs_kayit(W, f, lo, tur, amt, rate, pd_gs, cov_gs, w)
    L.flows["kredi_" + tur + "_adet"] += 1
    cx_stat["hacim_" + tur] += amt
    return amt


def wc_limit(W, f):
    """M14 (6) WC_BRIDGE_ALL: oyuncu/bot (sahipli ya da kurum sahipli) isletmenin kullanabilecegi kopru kredisi limiti: min(lendable, WC_BR_WEEKS x haftalik ucret, WC_BR_SALES x son 4 hf ort. haftalik satis) - borc; satis yoksa, lonca kapaliysa, temerrut varsa 0. Salt okuma."""
    d = W.firms[f]
    if d.get("dead") or d["kind"] in NPC_EXEMPT or not (NO_BAILOUT and W.week_no > NPC_GRACE):
        return 0.0
    lo = lt_alacakli(W, f) if LONCA_TERMS else d.get("lonca")        # REKABET G5 (Y2): tranşı ödeyecek lonca = kaydın alacaklısı
    if not lo or lo in W.closed:
        return 0.0
    ln = W.loans.get(f)
    if ln and ln["miss"] > 0:
        return 0.0
    h = getattr(W, "srev_hist", {}).get(f) or []
    sales = (sum(h) / len(h)) if h else 0.0
    if sales <= 1e-9:
        return 0.0
    wk = CYCLES_PER_WEEK * sum(W.people[q]["wage"] for q in d["workers"])
    cap = min(WC_BR_WEEKS * wk, WC_BR_SALES * sales)
    return max(0.0, min(lendable(W, lo), cap - (ln["out"] if ln else 0.0)))


def wc_bridge_cover(W, f, need):
    """M14 (6): oyuncu/bot isletmesinin kasasi `need` (ucret) tutarini karsilamiyorsa eksigi limit kadar kopru kredisi olarak ceker (kind kredi_verilen, tur wc). Bayrak kapaliyken ya da NPC isletmesinde hicbir sey yapmaz."""
    if not WC_BRIDGE_ALL:
        return 0.0
    d = W.firms[f]
    if d["owner"] is None and not d.get("org_owner"):
        return 0.0
    L = W.L
    eksik = need - L.bal[f]
    if eksik <= 1e-9:
        return 0.0
    draw = min(eksik, wc_limit(W, f))
    if draw <= 1e-9:
        return 0.0
    lo = d["lonca"]
    if LONCA_TERMS:
        lo, got = lt_ode(W, f, draw, W.week_no)                      # REKABET G5 (Y2, K-b): devir önce, tutar ödeyenin devir SONRASI lendable'ıyla kısılır; kayda fiilen ödenen
    else:
        got = L.pay(f"{lo}_sermaye", f, draw, "kredi_verilen")
    if got <= 1e-12:
        return 0.0
    ln = W.loans.get(f)
    if ln:
        ln["p0"] += got
        ln["out"] += got
        if KR_MEAS and ln.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen kredi)
            W.lo_stat["ks_verilen"] += got
    else:
        W.loans[f] = dict(lo=lo, p0=got, out=got, miss=0, rate=LR_NEW(W), tur="wc")
    if LONCA_TERMS:
        lt_damga(W, f, W.loans[f], got)                              # REKABET G5: tek açılış damgası (oyuncunun köprü kredisi dahil: gösterilen = tahsil edilen)
    L.flows["wc_kopru_kredisi"] += got
    L.flows["wc_kopru_kredisi_adet"] += 1
    return got


def owner_inject_bots(W):
    """M14 (6) OWNER_INJECT bot kurali: bot sahibi isletmenin kasasi OWNER_INJ_BOT_WEEKS haftalik ucretin altindaysa ve sahibin nakdi varsa eksigi tamamlar (insan karari ayri: human._uygula sermaye_ekle). Transfer; para dogmaz."""
    if not OWNER_INJECT:
        return
    L = W.L
    for f in list(W.player_firms):
        d = W.firms.get(f)
        if d is None or d.get("dead") or d.get("org_owner") or d["owner"] is None or d["owner"] == W.human or not d["workers"]:
            continue
        o = d["owner"]
        wk = CYCLES_PER_WEEK * sum(W.people[q]["wage"] for q in d["workers"])
        eksik = OWNER_INJ_BOT_WEEKS * wk - L.bal[f]
        if eksik > 1e-9 and L.bal.get(o, 0.0) > 1e-9:
            got = L.pay(o, f, min(eksik, L.bal[o]), "kurucu_sermayesi")
            L.flows["owner_inject_bot"] += got


def kopru_limit(W, f):
    """M11.2 (3a) HIRE_GATE_GROWTH: f NPC işletmesinin o an KULLANABİLECEĞİ köprü kredisi limiti (restaff köprü kuralının salt okuma karşılığı: lonca açık, temerrüt yok, lendable ve NPC_LEV x işletme sermayesi - borç tavanı); bayrak kapalı ya da köprü kanalı yoksa 0.0. Çekmez, yazmaz."""
    if not HIRE_GATE_GROWTH:
        return 0.0
    d = W.firms[f]
    if WC_BRIDGE_ALL and (d["owner"] is not None or d.get("org_owner")):
        return wc_limit(W, f)                       # M14 (6): oyuncu/bot isletmesi de ayni kanal
    if d["owner"] is not None or d.get("org_owner") or d["kind"] in NPC_EXEMPT or not (NO_BAILOUT and W.week_no > NPC_GRACE) or not ((NPC_FLOAT and NPC_LONCA_FUND) or NPC_BRIDGE):
        return 0.0
    lo = lt_alacakli(W, f) if LONCA_TERMS else d.get("lonca")        # REKABET G5 (Y2)
    if not lo or lo in W.closed:
        return 0.0
    ln = W.loans.get(f)
    if ln and ln["miss"] > 0:
        return 0.0
    wcb = working_capital(W, W.firms, W.people, f, 1)
    return max(0.0, min(lendable(W, lo), NPC_LEV * wcb - (ln["out"] if ln else 0.0)))


def hire_cash_secure(W, f):
    """M11.2 düzeltme 1 (K1): işe alım kapısının TEK paylaşılan karar + kredi işlevi (restaff, mgr_step rol alımı, oyuncu işletmesi alımı, genç kit; bot ve insan aynı). econ_core.hire_gate kapıyı geçiriyorsa ve geçiş kredi sayesindeyse (kasa < gereken),
    alımdan ÖNCE eksik kadar köprü kredisi FİİLEN çekilir (restaff köprü bloğuyla aynı kayıt: loans, npc_kopru_kredisi akışı). Kredi çekilemezse alım yok. Bayrak kapalıyken (kopru_limit 0, eksik 0) yalnız hire_cash_ok kararıdır, hiçbir şey yazılmaz."""
    L = W.L
    ok, eksik = hire_gate(W, f, L.bal[f], kopru_limit(W, f))
    if not ok:
        return False
    if eksik <= 1e-9:
        return True
    d = W.firms[f]
    lo = d.get("lonca")
    if LONCA_TERMS:
        lo = lt_alacakli(W, f)                                       # REKABET G5 (Y2): tranşı kaydın ALACAKLISI öder (saf okuma; devir ve ödeme aşağıda lt_ode ile)
    ln = W.loans.get(f)
    if not lo or lo in W.closed or (ln and ln["miss"] > 0):
        return False
    if LONCA_TERMS:
        lo, got = lt_ode(W, f, eksik, W.week_no)                     # REKABET G5 (K-b): devir önce, tutar ödeyenin devir SONRASI lendable'ıyla kısılır; kayda fiilen ödenen
    else:
        got = L.pay(f"{lo}_sermaye", f, eksik, "kredi_verilen")
    if got > 1e-12:
        if ln:
            ln["p0"] += got
            ln["out"] += got
            if KR_MEAS and ln.get("tur") == "kurulus":  # REKABET G0: davranışsız ölçüm (kuruluş kaydına eklenen kredi)
                W.lo_stat["ks_verilen"] += got
        else:
            W.loans[f] = dict(lo=lo, p0=got, out=got, miss=0, rate=LR_NEW(W), tur=("wc" if (d["owner"] is not None or d.get("org_owner")) else "npc"))
        if LONCA_TERMS:
            lt_damga(W, f, W.loans[f], got)                          # REKABET G5: tek açılış damgası
        if d["owner"] is not None or d.get("org_owner"):
            L.flows["wc_kopru_kredisi"] += got                       # M14 (6): oyuncu/bot isletmesi NPC akisiyla karismaz
            L.flows["wc_kopru_kredisi_ise_alim"] += got
        else:
            L.flows["npc_kopru_kredisi"] += got
            L.flows["npc_kopru_kredisi_ise_alim"] += got
        d["insolv"] = 0
    return hire_gate(W, f, L.bal[f], 0.0)[0]                                     # çekilen tutar sonrası kasa tek başına yetmeli (kısmi çekimde alım yok)


def lonca_score(W, d, lo, mcount, tot_m, f=None):
    WELF_ON = W.WELF_ON
    cities = W.cities
    firms = W.firms
    orep = W.orep
    wf_eff = W.wf_eff
    xrate = W.xrate
    b = BRANCH.get(d["kind"])
    n = d.get("lic_n")
    xr = xrate.get((n, b)) if (n and b) else None
    lo_n = firms[n]["lonca"] if (n and n in firms) else None
    s = fee_rate(W, lo) + CONGEST * mcount[lo] / tot_m - (LOCAL_W if int(lo[5:]) % len(cities) == d["city"] else 0.0)
    if xr is not None:
        s += xr * (TELIF_MEMBER_RATIO if (lo == lo_n or (PATH_ACT and d.get("innov_owner"))) else 1.0)
    if d["owner"] is not None:
        s -= CREDIT_W * min(1.0, lendable(W, lo) / ix(W, SERMAYE_CAP))
        if LONCA_TERMS:                                                # REKABET G5: sahipli firma loncanın kredi faizini hesaba katar (spread 0,002 -> +0,0104); sahipsiz (NPC) firma katmaz. K5: ağırlık = firmanın borcunun işletme sermayesine oranı (en çok 1; borcu olmayan 0); f verilmezse 1
            wg_ = 1.0
            if f is not None:
                ln_ = W.loans.get(f)
                wg_ = min(1.0, ln_["out"] / max(1e-9, working_capital(W, firms, W.people, f))) if ln_ else 0.0
            if wg_ > 0.0:
                rm_ = W.__dict__.get("_lt_risk")                          # haftalık lo_risk önbelleği (salt hız)
                s += wg_ * LT_RATE_W * (lo_term(W, lo, "spread") + (rm_[lo] if rm_ is not None and lo in rm_ else lo_risk(W, lo))) * 52
    if ORG_ACT:
        s -= ORG_LONCA_W * orep.get(lo, 0.0) / 100.0
    if WELF_ON:
        s -= WELF_ATTR * wf_eff[lo] * (1.0 + WELF_BURS_RATIO)         # K-185.3: paketin değeri (çalışan çekimi)
    return s


def lonca_gecis(W, f, d, yeni, w):
    """F2: f firmasının (kaydı d) `yeni` loncaya geçişi; botun switch_step geçişinin yazdığı alanların tek yeri (bot ve insan lonca_sec aynısını çağırır)."""
    d["lonca"] = yeni
    d["sw_last"] = w
    d["tech_next"] = 0
    if yeni in W.new_slots:
        d["ever_new"] = True
    W.switches[yeni] += 1
    W.L.flows["lonca_gecis_adet"] += 1
    if LONCA_TERMS and f in W.loans:
        lt_devir(W, f, yeni, w, say_kalan=True)                          # REKABET G5 (Ö4): kredi yeni loncaya devredilir (verebiliyorsa); geçiş her halde serbest


# ---------------------------------------------------------------- F3: lonca kuruluşu (şartların ve mekaniğin tek kaynağı)
LONCA_KUR_YOLLARI = ("girisimci", "medya", "yeniden")
LONCA_KUR_EKSIK_KIMLIKLERI = ("erken", "inovator_degil", "medya_firma", "zaten_sahip", "dao_aktif", "nakit", "itibar", "kurucu_yasagi", "dao_telif", "firma_yas_kadro", "yuva_yok", "yol", "kapali")


def lonca_yeniden_esik(W, easy=None):
    """(bekleme, itibar, sermaye) kapanmış yuvanın yeniden kurulma eşikleri (LONCA_EASY açıkken LE_*). easy: lonca modülünün kendi LONCA_EASY değeri (bot adımları verir; verilmezse params)."""
    easy = LONCA_EASY if easy is None else easy
    rf_ = (LE_REFOUND, LE_REP_REFOUND, LE_FOUND_CAP) if easy else (LONCA_REFOUND, REP_OWNER, ix(W, LONCA_FOUND_CAP))
    if LONCA_KUR_ESIK:                                          # NOT: sabit Akçe; INDEX_FIXED=1 olursa ix ile büyüyen LONCA_MIN_CASH (lonca.py kapanış eşiği) bu eşiğin üstüne çıkabilir (yeni lonca hemen kapanma sayacına girer); bugün INDEX_FIXED=0
        rf_ = (rf_[0], rf_[1], min(rf_[2], float(LONCA_KUR_ESIK)))      # rekabet G1: yeniden kurma sermayesi eşiğe iner (yalnız aşağı)
    return rf_


def lonca_yuva_hazir(W, lo, w, easy=None):
    """kapanmış lo yuvası w. haftada yeniden kurulabilir mi (bekleme geçti, girişimci slotu değil)."""
    return not (w - W.closed_at[lo] < lonca_yeniden_esik(W, easy)[0] or (NL_ACT and lo in W.new_slots))


def lonca_yeniden_yuvasi(W, w, easy=None):
    """yeniden kurulabilecek ilk kapanmış yuva (sıralı) ya da None."""
    for lo in sorted(W.closed):
        if lonca_yuva_hazir(W, lo, w, easy):
            return lo
    return None


def lonca_fee_ort(W):
    """açık loncaların ortalama fee'si (yeni lonca fee'si ve üye başına fee geliri tahmini bunu kullanır)."""
    est_l = [l for l in W.loncas if l not in W.closed]
    return sum(W.FEES[l] for l in est_l) / max(1, len(est_l))


def lonca_kur_baglam(W, q, w, yol, fm_=None, easy=None):
    """q'nun girişimci/medya yolundaki türetilmiş eşikleri ve ilgili varlıkları (nl_step ve lonca_kur_eksikleri aynı değerleri kullanır). Saf okuma."""
    firms = W.firms
    i_ = W.people[q]
    easy = LONCA_EASY if easy is None else easy
    if easy:
        e_cap, e_buf, e_rep, e_wk, e_wn, e_mar = LE_FOUND_CAP, LE_BUF, LE_REP_LFOUND, LE_OWNER_MIN_WEEKS, LE_OWNER_MIN_WORKERS, LE_FOUND_MARGIN
    else:
        e_cap, e_buf, e_rep, e_wk, e_wn, e_mar = ix(W, INNOV_LONCA_CAP), 500.0, REP_LFOUND, FIRM_OWNER_MIN_WEEKS, FIRM_OWNER_MIN_WORKERS, ix(W, FOUND_MARGIN)
    if fm_ is None:
        fm_ = medya_firmalari(W, q, w) if yol == "medya" else []
    easy_ = MEDIA_LONCA_EASY and bool(fm_)                     # (MEDIA_LONCA_EASY: medya yolunun kendi gevşetmesi; LONCA_EASY'den bağımsız)
    dn = i_.get("res") if (i_.get("dao_active") and i_.get("res") in firms and not firms[i_["res"]].get("dead")) else None
    med_ = bool(fm_) or bool(dn and firms[dn].get("branch") == "medya")
    m_cap, m_buf, m_rep, m_mar = (ix(W, INNOV_LONCA_CAP), 500.0, REP_LFOUND, ix(W, FOUND_MARGIN)) if med_ else (e_cap, e_buf, e_rep, e_mar)
    cap_q = (MEDIA_EASY_CAP if easy_ else ix(W, MEDIA_LF_CAP)) if fm_ else m_cap
    buf_ = MEDIA_EASY_BUF if easy_ else m_buf
    if LONCA_KUR_ESIK:                                          # rekabet G1: kuruluş sermayesi ve nakit (sermaye + tampon) eşiği LONCA_KUR_ESIK'e iner; yalnız aşağı (medya kolay yolu 250+100 zaten altında)
        e_ = float(LONCA_KUR_ESIK)
        m_cap = min(m_cap, e_)
        cap_q = min(cap_q, e_)
        buf_ = min(buf_, e_ - cap_q)
        m_buf = min(m_buf, e_ - m_cap)
    return dict(fm_=fm_, easy_=easy_, dn=dn, med_=med_, m_cap=m_cap, m_buf=m_buf, m_rep=m_rep, m_mar=m_mar, cap_q=cap_q, buf=buf_, e_wk=e_wk, e_wn=e_wn, e_mar=e_mar)


def medya_firmalari(W, q, w):
    """q'nun sahibi olduğu, medya loncası kurucusu sayılan medya firmaları (MEDIA_ACT açıkken; ≥ 2 çalışan, yaş MEDIA_LF_AGE)."""
    if not MEDIA_ACT:
        return []
    return [d for d in W.firms.values() if d.get("owner") == q and d["kind"] == "medya" and not d.get("dead") and len(d["workers"]) >= 2 and w - d.get("born", w) >= MEDIA_LF_AGE]


def home_birak(W, q):
    """HOME_OWN: oturduğu evin sahibi q şehir değiştirirse evi eski şehirde kiralık birime döner (W.own'a girer), hane yeni şehirde kiracı olur; kendiliğinden satış ya da bedel yok. Sahibi değilse etkisiz."""
    if not HOME_OWN:
        return
    ci = W.home.pop(q, None)
    if ci is not None:
        W.home_n[ci] -= 1
        W.own[ci][q] += 1.0
        W.home_stat[("goc_birakti", ci)] += 1
        W.home_stat[("goc_birakti_npc" if W.people[q]["who"] == "npc" else "goc_birakti_oyuncu", ci)] += 1


def home_goc_sirala(W, kisiler):
    """HOME_OWN: oyuncu göçünde ev sahibi olmayanlar önce (kararlı sıralama; yasak değil, yalnız sıra tercihi)."""
    return sorted(kisiler, key=lambda q: q in W.home)


def home_goc_sec(W, pool):
    """HOME_OWN: NPC göçünde havuzdan çekilecek kişinin sırası: ev sahibi olmayan ilk hane; hepsi ev sahibiyse 0 (yasak değil, yalnız sıra tercihi)."""
    return next((i for i, x in enumerate(pool) if x not in W.home), 0)


def lonca_kur_eksikleri(W, q, w, yol, bag=None, taken=None, kisa=False, easy=None):
    """q'nun w. haftada `yol` ile lonca kurabilmesi için eksik şartlar: [{"id": kimlik, ...}] (boş liste = şartlar tamam). SAF okuma.
    yol: "girisimci" (inovatör: kendi firması ya da DAO'su telif kazanmış), "medya" (medya firması sahibi), "yeniden" (kapanmış yuvayı yeniden kurma).
    nl_step, lonca_step yeniden kurulma yolu ve insanın lonca_kur kararı şartları yalnız buradan okur. Botun kazanç karşılaştırması ve `best` sınırı şart değildir (yalnız bot kararı).
    easy: LONCA_EASY değeri (bot adımları lonca modülündekini verir; verilmezse params). kisa=True: ilk eksik grubunda döner (bot döngüsü; karar aynı, hesap daha az). taken: kurucu olan kişiler kümesi (verilmezse lonca_owner'dan türetilir)."""
    out = []
    if taken is None:
        taken = {v[0] for v in W.lonca_owner.values()}
    i_ = W.people[q]
    L = W.L
    if q in taken:
        out.append({"id": "zaten_sahip"})
    if yol == "yeniden":
        rf_wait, rf_rep, rf_cap = lonca_yeniden_esik(W, easy)
        if W.REP[q] < rf_rep:
            out.append({"id": "itibar", "gerek": rf_rep, "var": W.REP[q]})
        if i_.get("dao_active"):
            out.append({"id": "dao_aktif"})
        if L.bal[q] < rf_cap:
            out.append({"id": "nakit", "gerek": rf_cap, "var": L.bal[q]})
        if lonca_yeniden_yuvasi(W, w, easy) is None:
            out.append({"id": "yuva_yok"})
        return out
    if yol not in ("girisimci", "medya"):
        return [{"id": "yol"}]
    if not NL_ACT or w < OWNER_WEEK + 10:
        out.append({"id": "erken"})
    b = bag if bag is not None else lonca_kur_baglam(W, q, w, yol, None, easy)
    if yol == "medya":
        if not b["fm_"]:
            out.append({"id": "medya_firma"})
    elif not i_.get("innov"):
        out.append({"id": "inovator_degil"})
    if W.REP[q] < b["m_rep"]:
        out.append({"id": "itibar", "gerek": b["m_rep"], "var": W.REP[q]})
    if L.bal[q] < b["cap_q"] + b["buf"]:
        out.append({"id": "nakit", "gerek": b["cap_q"] + b["buf"], "var": L.bal[q]})
    if W.founder_ban.get(q, -999) > w - FOUNDER_BAN:
        out.append({"id": "kurucu_yasagi", "kalan": W.founder_ban[q] + FOUNDER_BAN - w})      # kalan hafta (son kapanıştan FOUNDER_BAN hafta)
    if kisa and out:
        return out
    dn = b["dn"]
    if dn:
        if W.dao_tel[dn] < SUCC_TEL * (MEDIA_LF_SUCC if b["med_"] else 1.0):
            out.append({"id": "dao_telif"})
    elif yol == "girisimci":
        if not any(d.get("owner") == q and d.get("innov_owner") and not d.get("dead") and len(d["workers"]) >= b["e_wn"] and w - d.get("born", w) >= b["e_wk"] for d in W.firms.values()):
            out.append({"id": "firma_yas_kadro"})
    return out


def lonca_kur_yeniden(W, q, w, lo, cap):
    """kapanmış lo yuvasını q yeniden kurar (bot lonca_step ve insan lonca_kur aynısını çağırır)."""
    L = W.L
    L.pay(q, f"{lo}_sermaye", cap, "lonca_kurulus_sermayesi")
    W.closed.discard(lo)
    W.lonca_owner[lo] = (q, w)
    W.people[q]["lonca_owner"] = lo
    W.FEES[lo] = LONCA_FEE
    W.lo_low[lo] = 0
    W.fee_dir[lo] = 1
    W.lo_unpaid[lo] = 0.0
    W.lo_stress[lo] = 0.0
    if LONCA_TERMS:
        lt_baslat(W, lo)                                        # REKABET G5: yeni sahip başlangıç koşullarıyla açar
    L.flows["lonca_kurulus_adet"] += 1
    W.lo_stat["kurulus_yeniden"] += 1                       # T7: davranışsız ölçüm sayacı
    if NL_ACT:
        W.lonca_info[lo] = dict(grp="yerleşik (yeniden)", founder=q, start=w, end=None, peak=0)
    W.tech_events.append(f"hafta {w}: {lo} yeniden kuruldu, sahibi {q}")


def lonca_kur_yeni(W, q, w, dn, fee_e, n_est, cap, gain):
    """q yeni (girişimci) lonca kurar: sermaye havuza, kurucunun firmaları (ve varsa DAO'su dn) yeni loncaya geçer. Bot nl_step ve insan lonca_kur aynısını çağırır. Yeni loncanın adını döner."""
    firms, loncas, closed, L = W.firms, W.loncas, W.closed, W.L
    lo = f"lonca{len(loncas)}"
    loncas.append(lo)
    W.new_slots.add(lo)
    W.KN[lo] = {b_: 0.0 for b_ in BRANCHES}
    L.pay(q, f"{lo}_sermaye", cap, "girisimci_lonca_sermayesi")
    W.lonca_owner[lo] = (q, w)
    W.people[q]["lonca_owner"] = lo
    W.FEES[lo] = fee_e
    W.lo_low[lo] = 0
    W.fee_dir[lo] = 1
    W.lo_unpaid[lo] = 0.0
    W.lo_stress[lo] = 0.0
    W.pot_ema[lo] = 0.0
    if LONCA_TERMS:
        lt_baslat(W, lo)                                        # REKABET G5: yeni lonca kendi sıra numarasının başlangıç koşullarını alır
    W.owner_rec.pop(lo, None)
    W.lonca_info[lo] = dict(grp="girişimci", founder=q, start=w, end=None, peak=0, dao=dn, gain=gain, fee0=fee_e)
    if MEDIA_ACT and ((dn and firms[dn].get("branch") == "medya") or (not dn and any(d_.get("owner") == q and d_["kind"] == "medya" and not d_.get("dead") for d_ in firms.values()))):
        W.lonca_info[lo]["focus"] = "medya"                          # K-183.6: medya loncası (kurucusu medya DAO'su ya da medya firması sahibi inovatör)
        L.flows["medya_lonca_kurulus_adet"] += 1
    moved_ = []
    if dn:
        old = firms[dn]["lonca"]
        firms[dn]["lonca"] = lo
        firms[dn]["reloc_last"] = w
        W.dao_info[dn]["lonca"] = lo
        L.flows["dao_lonca_gecisi_adet"] += 1
        moved_.append(dn)
        if LONCA_TERMS and dn in W.loans:
            lt_devir(W, dn, lo, w, say_kalan=True)                        # REKABET G5 (Y2)
        if old in loncas and old not in closed:
            W.arge_boost[old] = min(ARGE_BOOST_MAX, W.arge_boost[old] + ARGE_BOOST)
    for f_, d_ in firms.items():
        if d_.get("owner") == q and d_["kind"] != "arge" and not d_.get("dead"):
            d_["lonca"] = lo
            d_["ever_new"] = True
            d_["sw_last"] = w
            d_["tech_next"] = 0
            moved_.append(f_)
            if LONCA_TERMS and f_ in W.loans:
                lt_devir(W, f_, lo, w, say_kalan=True)                    # REKABET G5 (Y2): lonca kuran kişinin firmalarının borcu lonca_gecis ile aynı kuralla devredilir
    L.flows["girisimci_lonca_kurulus_adet"] += 1
    W.lo_stat["kurulus_yeni"] += 1                              # T7: davranışsız ölçüm sayacı
    W.tech_events.append(f"hafta {w}: GİRİŞİMCİ LONCA {lo} kuruldu (kurucu {q}{', DAO ' + dn if dn else ', inovatör firma sahibi'}; beklenen kazanç farkı {gain:,.0f} Akçe/hf; fee %{fee_e * 100:.1f}; beklenen üye {n_est:.0f})")
    return lo


def sahip_kapat(W, f):
    """sahibin ayrılması = işletmeyi kapat: firmaya `kapaniyor` konur (işe alım döngüleri atlar), işçiler mevcut küçülme kalıbıyla dağıtılır
    (NPC havuza, oyuncu iş arayanlara); firma aynı haftanın phase_dividends adımında 'işçisiz oyuncu firması batar' yoluyla kapanır.
    REKABET G17h: gövde human._kapat'tan taşındı (insanın `ayril` kararı ve bot sahibin OWNER_EXIT kararı aynı yolu kullanır; davranış aynı).
    firm_exit'ten de içe aktarılır (firm_exit.sahip_kapat); tanım katman gereği burada (human L2, firm_exit L2'ye bağlanamaz)."""
    d = W.firms[f]
    d["kapaniyor"] = True
    c = W.cities[d["city"]]
    for q in list(d["workers"]):
        d["workers"].remove(q)
        if KR_MEAS:
            lab_ev(W, "cikis_kuculme", f)                  # davranışsız sayaç (§4.6)
        W.people[q]["firm"] = None
        (c["pool"] if W.people[q]["who"] == "npc" else c["seekers"]).append(q)
