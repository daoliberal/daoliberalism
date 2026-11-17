"""simkit.lonca: lonca işleri: lonca_step, nl_step (sınırsız lonca), skor, ücret, geçiş, refah.

ARAYÜZ: insan_lonca_kur (F3: insanın lonca_kur kararı; kuruluş mekaniği bot ile ortak), lonca_yonet_step (REKABET G5 LONCA_TERMS: bot lonca yöneticisi; lo_terms_ilk credit_core'dadır, buradan da erişilir), fee_step, switch_step, welf_step, lonca_pa, lonca_pa_apply (PLAN-KREDI T6: batık loncanın defter değeriyle devri; plan + uygula), lonca_step, nl_step
OKUR/YAZAR: W.loncas, W.lonca_info, W.FEES, W.L, W.ins; LONCA_TERMS açıkken lonca_yonet_step W.lo_terms'ü (W.lo_terms_insan dolu olmayan loncalar için) yazar, W.loans, W.lo_loss ve lendable'ı okur (üyelik payı W.FEES'e DOKUNMAZ: tek karar noktası fee_step); LONCA_INSOLV_CLOSE açıkken W.lo_insolv (batık lonca kümesi), W.lo_stat (kapanış ve devir sayaçları).
KATMAN: L3.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.credit_core import lo_risk, lo_terms_ilk, lt_durum, lt_stat_hucre, lendable, lendable_cash, lo_classes, lo_credit, lo_equity, lonca_score, lonca_gecis, lonca_kur_eksikleri, lonca_yeniden_yuvasi, lonca_kur_baglam, medya_firmalari, lonca_yeniden_esik, lonca_yuva_hazir, lonca_fee_ort, lonca_kur_yeni, lonca_kur_yeniden
from simkit.human import human_olay
from simkit.dao_core import dao_weekly_cost, live_daos
from simkit.econ_core import fee_rate
from simkit.insurance import ins_step


def lonca_yonet_step(W, w):
    """REKABET G5 (LONCA_TERMS): bot lonca yöneticisi. w >= OWNER_WEEK ve w % LT_EVERY == 0 haftalarında, W.lo_terms_insan[lo] dolu olmayan (insanın kurduğu lonca dahil: bot kuralı) her canlı lonca KENDİ deneyiminden ayarlar:
    - spread ve dep_pay: deterministik tepe tırmanma (fee_step mantığı), ziyaret başına dönüşümlü TEK kaldıraç (w // LT_EVERY çiftse spread, tekse dep_pay), bir adım. Hedef büyüklük GÖRELİ getiri:
      g_i = net_i / V_i - Σnet / ΣV (dönemlik; net = tahsil edilen faiz - kredi kaybı - mevduata dağıtılan, lt_say izler; V = kredi stoku + lendable); ortak şok ve sistem büyümesi farkta düşer.
      Karşılaştırma tabanı OWNER_WEEK'te kurulur (lt_say at25), ilk karşılaştırma ondan sonraki ilk ziyarette; zorunlu ilk hamle yok. İlk hamle yönü taban dönemindeki g_i işaretine göre:
      ortalamanın altındaysa spread aşağı / dep_pay yukarı, üstündeyse tersi. Sonra: g_i bir önceki aynı-kaldıraç dönemine göre fee_step'in %3 ölü bandı kadar (mutlak) düştüyse yön değişir, değilse sürer.
      Bant (spread 0..LT_SPREAD_MAX, dep_pay LT_PAY_MIN..MAX) loncanın kendi kural sınırıdır: uca dayanan adım yön değiştirir, yapışma olmaz.
    - risk_tol: yalnız KENDİ ELEDİĞİ kredi türünün (pd'li kuruluş) sonucuna tepki verir: sönümlü kayıp oranı (ks_kayip / ks_ver; en az LS_MIN_N kredi gözlenmişse) LT_NPL_HI üstündeyse bir adım sıkılaşır; LT_NPL_LO altındaysa ve lonca atıl fon tutuyorsa
      (lendable >= loncanın son dönemde verdiği ortalama kuruluş kredisi tutarı ks_ver / ks_say) bir adım gevşer; arada hareket yok. Toplam batık oranı risk_tol'u OYNATMAZ.
    Girdiler yalnız model durumudur (lt_durum; KR_MEAS sayaçlarından okumaz). Üyelik payı (fee) burada ayarlanmaz: tek karar noktası fee_step. RNG yok. Para hareketi yok.
    Gerçek dünya: bankalar faiz marjını ve mevduat dağıtımını göreli karlılığa (sektör ortalamasına göre), risk iştahını kendi kredi kaybı deneyimine göre ayarlar (Berger ve Udell 2006; Stiglitz ve Weiss 1981)."""
    if not LONCA_TERMS or w < OWNER_WEEK or w % LT_EVERY:
        return
    kald = "spread" if (w // LT_EVERY) % 2 == 0 else "dep_pay"
    a_, b_, adim = (0.0, LT_SPREAD_MAX, LT_SPREAD_STEP) if kald == "spread" else (LT_PAY_MIN, LT_PAY_MAX, LT_PAY_STEP)
    stok = defaultdict(float)
    for ln_ in W.loans.values():
        stok[ln_["lo"]] += ln_["out"]
    acik = [lo for lo in W.loncas if lo not in W.closed]
    veri = {}
    for lo in acik:
        d = lt_durum(W, lo)
        y = d["yon"].setdefault(kald, dict(dir=None, at=None, son=None))
        if y["at"] is None and "at25" in d:
            y["at"] = d["at25"]
        if y["at"] is not None:
            veri[lo] = (d["faiz"] - d["dagit"] - d["kayip"] - y["at"], max(1.0, stok.get(lo, 0.0) + lendable(W, lo)))
    sv = sum(v[1] for v in veri.values())
    ort = (sum(v[0] for v in veri.values()) / sv) if sv > 0.0 else 0.0
    for lo in acik:
        d = lt_durum(W, lo)
        y = d["yon"][kald]
        net = d["faiz"] - d["dagit"] - d["kayip"]
        if W.lo_terms_insan.get(lo) is not None:
            y["at"] = net                                                       # insan ayarlı lonca yönetilmez ama karşılaştırma tabanı her dönem ilerler (ortalamayı birikmiş gelirle şişirmez)
            continue
        t = W.lo_terms[lo]
        d["ziyaret"] += 1
        if lo in veri:
            g = veri[lo][0] / veri[lo][1] - ort
            d["g_son"] = g
            if y["dir"] is None:
                alt = g < 0.0
                y["dir"] = (-1 if alt else 1) if kald == "spread" else (1 if alt else -1)
            elif y["son"] is not None and g < y["son"] - 0.03 * abs(y["son"]):
                y["dir"] = -y["dir"]
            y["son"] = g
            y["at"] = net
            yeni = round(t[kald] + y["dir"] * adim, 12)
            if yeni > b_ + 1e-12 or yeni < a_ - 1e-12:
                y["dir"] = -y["dir"]
                yeni = round(t[kald] + y["dir"] * adim, 12)
            t[kald] = round(min(b_, max(a_, yeni)), 12)
        else:
            y["at"] = net                                                       # tabanı olmayan (sonradan kurulan) lonca: bu ziyaret yalnız taban kurar, hareket yok
        if d["ks_say"] >= LS_MIN_N and d["ks_ver"] > 0.0:
            oran = d["ks_kayip"] / d["ks_ver"]
            if oran > LT_NPL_HI:
                t["risk_tol"] = round(min(LT_TOL_MAX, max(LT_TOL_MIN, t["risk_tol"] - LT_TOL_STEP)), 12)
            elif oran < LT_NPL_LO and lendable(W, lo) >= d["ks_ver"] / d["ks_say"]:
                t["risk_tol"] = round(min(LT_TOL_MAX, max(LT_TOL_MIN, t["risk_tol"] + LT_TOL_STEP)), 12)


def fee_step(W, w):
    """Lonca sahibi fee'yi gelir (fee tahsilatı) artıyorsa aynı yönde, azalıyorsa ters yönde 1 adım oynatır (üye kaybı fee'yi indirir, avantaj varsa artırır)."""
    FEES = W.FEES
    L = W.L
    closed = W.closed
    fee_dir = W.fee_dir
    fee_hist = W.fee_hist
    fee_inc = W.fee_inc
    fee_prev = W.fee_prev
    firms = W.firms
    lo_stress = W.lo_stress
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    if not FEE_ACT or w % FEE_EVERY or w < OWNER_WEEK:
        return
    for lo in loncas:
        if lo not in lonca_owner or lo in closed:
            continue
        inc = fee_inc[lo] - fee_prev[lo]
        nm = sum(1 for d in firms.values() if d["lonca"] == lo and not d.get("dead") and d["workers"] and d["kind"] not in ("belediye", "arge", "ahir"))
        pm = fee_prev.get(("m", lo))
        if COST_ACT and lo_stress[lo] > 0.3:
            fee_dir[lo] = 1                                          # gider ödenemiyor: fee artırır
        elif pm is not None and nm < 0.9 * pm:
            fee_dir[lo] = -1                                         # üye kaybediyor: fee indirir
        elif fee_prev.get(("p", lo)) is not None and inc < 0.97 * fee_prev[("p", lo)]:
            fee_dir[lo] = -fee_dir[lo]
        fee_prev[("m", lo)] = nm
        fee_prev[("p", lo)] = inc
        fee_prev[lo] = fee_inc[lo]
        nf = FEES[lo] + fee_dir[lo] * FEE_STEP
        if nf > FEE_MAX or nf < FEE_MIN:
            fee_dir[lo] = -fee_dir[lo]
            nf = min(FEE_MAX, max(FEE_MIN, nf))
        if abs(nf - FEES[lo]) > 1e-12:
            L.flows["fee_degisim_adet"] += 1
        FEES[lo] = nf
    fee_hist.append((w, dict(FEES)))


def switch_step(W, w):
    """Firma lonca seçer: fee + (lisanslıysa) telif oranı - kredi havuzu doluluğu; geçişten sonra bekleme süresi var."""
    closed = W.closed
    firms = W.firms
    loncas = W.loncas
    if not FEE_ACT or w < OWNER_WEEK:
        return
    idx = 0
    mcount = defaultdict(int)
    for d in firms.values():
        if not d.get("dead") and d["workers"] and d["kind"] not in ("belediye", "arge", "ahir"):
            mcount[d["lonca"]] += 1
    if LONCA_TERMS:
        W._lt_risk = {lo_: lo_risk(W, lo_) for lo_ in loncas if lo_ not in closed}      # REKABET G5: lonca_score'un kredi faizi terimi için haftalık lo_risk önbelleği (switch_step boyunca krediler değişmez)
    for f, d in firms.items():
        idx += 1
        if d.get("dead") or d["kind"] in ("belediye", "arge") or not d["workers"] or (idx + w) % SWITCH_EVAL:
            continue
        if HUMAN_LONCA and d.get("lonca_insan") is not None and d["owner"] == W.human:
            continue                                                  # F2: insanın seçtiği lonca korunur (insan hiç seçmediyse bot kuralı sürer)
        if w - d.get("sw_last", -999) < SWITCH_COOL:
            continue
        tot_m = max(1, sum(mcount.values()))

        def score(lo):
            return lonca_score(W, d, lo, mcount, tot_m, f=f) if LONCA_TERMS else lonca_score(W, d, lo, mcount, tot_m)       # REKABET G5: f yalnız LONCA_TERMS iken (borç ağırlığı)
        cur = score(d["lonca"])
        best = min([l for l in loncas if l not in closed], key=lambda l: (score(l), l))
        if best != d["lonca"] and score(best) + SWITCH_GAIN < cur:
            eski_ = d["lonca"]
            lonca_gecis(W, f, d, best, w)
            if HUMAN_ON and d["owner"] == W.human:
                human_olay(W, w, "lonca_degisti", firma=f, eski=eski_, lonca=best, kaynak="otomatik")      # rekabet G1: botun otomatik lonca geçişi sahibe görünür
    W.__dict__.pop("_lt_risk", None)


def welf_step(W, w):
    """K-185.3: haftalık: üye ücret toplamı (taahhüt temeli), etkin cömertlik (rezerv şartı), gözden geçirme (rakipler, üye akışı, maliyet)."""
    INS_ON = W.INS_ON
    L = W.L
    WELF_ON = W.WELF_ON
    closed = W.closed
    fee_inc = W.fee_inc
    firms = W.firms
    ins = W.ins
    loncas = W.loncas
    people = W.people
    weeks = W.weeks
    wf_claim = W.wf_claim
    wf_cost = W.wf_cost
    wf_cov = W.wf_cov
    wf_eff = W.wf_eff
    wf_fee_prev = W.wf_fee_prev
    wf_g = W.wf_g
    wf_g_set = W.wf_g_set
    wf_hist = W.wf_hist
    wf_inc_w = W.wf_inc_w
    wf_ins = W.wf_ins
    wf_mem_prev = W.wf_mem_prev
    wf_paid_w = W.wf_paid_w
    wf_payroll = W.wf_payroll
    wf_prem_due = W.wf_prem_due
    wf_prem_paid = W.wf_prem_paid
    wf_prem_ratio = W.wf_prem_ratio
    wf_stat = W.wf_stat
    if not WELF_ON:
        return
    alive_ = [l for l in loncas if l not in closed]
    pay_ = defaultdict(float)
    mem_ = defaultdict(int)
    cov_ = defaultdict(float)
    for f_, d_ in firms.items():
        if d_.get("dead") or not d_["workers"] or d_["kind"] in ("belediye", "arge", "ahir"):
            continue
        mem_[d_["lonca"]] += 1
        cov_[d_["lonca"]] += sum(1 for q_ in d_["workers"] if people[q_]["who"] == "oyuncu")
        pay_[d_["lonca"]] += sum(people[q_]["wage"] for q_ in d_["workers"] if people[q_]["who"] == "oyuncu") * CYCLES_PER_WEEK
    for lo in alive_:
        if lo not in wf_g_set and w >= WELF_START:
            wf_g_set.add(lo)
            if w == WELF_START:
                wf_g[lo] = WELF_G0[int(lo[5:]) % len(WELF_G0)]                # başlangıç çeşitliliği (deterministik)
            else:
                og_ = [wf_g[l_] for l_ in alive_ if l_ in wf_g_set and l_ != lo]
                wf_g[lo] = round(sum(og_) / len(og_) / WELF_STEP) * WELF_STEP if og_ else 0.0   # yeni lonca piyasa ortalamasından başlar
            wf_mem_prev[lo] = mem_[lo]
        wf_payroll[lo] = pay_[lo]
        wf_cov[lo] = cov_[lo]
        wf_claim[lo] = 0.9 * wf_claim[lo] + 0.1 * wf_paid_w[lo]
        fee_now = fee_inc[lo]
        wf_inc_w[lo] = 0.8 * wf_inc_w[lo] + 0.2 * (fee_now - wf_fee_prev[lo])
        wf_fee_prev[lo] = fee_now
        prem_ratio_w = (wf_prem_paid[lo] / wf_prem_due[lo]) if wf_prem_due[lo] > 1e-9 else 1.0
        wf_prem_ratio[lo] = 0.7 * wf_prem_ratio[lo] + 0.3 * prem_ratio_w
        wf_cost[lo] = 0.9 * wf_cost[lo] + 0.1 * (wf_paid_w[lo] + wf_prem_paid[lo])
        wf_prem_due[lo] = wf_prem_paid[lo] = 0.0
        wf_paid_w[lo] = 0.0
        expo = max(wf_claim[lo], WELF_EXPO * wf_g[lo] * pay_[lo] * (0.3 if wf_ins.get(lo) else 1.0))
        need = WELF_RES_WEEKS * expo
        rv = L.bal[f"{lo}_refah"]
        wf_eff[lo] = wf_g[lo] * min(1.0, rv / need) if need > 1e-9 else 0.0       # rezerv yetmezse paket küçülür
        if INS_ON and wf_ins.get(lo) and ins[wf_ins[lo]]["alive"]:
            wf_eff[lo] = wf_g[lo] * min(1.0, wf_prem_ratio[lo])                    # sigortalı paket: prim ödenebildiği kadar (poliçe sigortacıda)
    if INS_ON:
        ins_step(W, w, alive_, pay_)
    if w >= WELF_START and w % WELF_EVERY == 0:
        gs_ = [wf_g[l] for l in alive_]
        for lo in alive_:
            others = [wf_g[l] for l in alive_ if l != lo]
            avg_o = sum(others) / len(others) if others else 0.0
            dm = mem_[lo] - wf_mem_prev[lo]
            wf_mem_prev[lo] = mem_[lo]
            cost_ok = (wf_cost[lo] if INS_ON else wf_claim[lo]) <= WELF_SHARE_MAX * wf_inc_w[lo] + 1e-9
            rv_ok = wf_eff[lo] >= 0.5 * wf_g[lo] - 1e-9
            g0 = wf_g[lo]
            if not cost_ok or not rv_ok:
                wf_g[lo] = max(0.0, g0 - WELF_STEP)                     # kriz / pahalı: paket kesilir
                wf_stat["kesinti"] += 1
            elif dm < 0 and avg_o > g0:
                wf_g[lo] = min(WELF_GMAX, g0 + WELF_STEP)               # üye kaybeden, rakiplerin gerisinde: cömertliği artırır
            elif dm > 0 and g0 > avg_o + 0.1:
                wf_g[lo] = max(0.0, g0 - WELF_STEP)                     # fazla cömert, üye akıyor: azaltır
    if w % 10 == 0 or w == weeks:
        alive2 = [l for l in loncas if l not in closed]
        wf_hist.append((w, len(alive2), sum(1 for l in alive2 if wf_g[l] > 1e-9), sorted(round(wf_g[l], 2) for l in alive2), sum(wf_eff[l] for l in alive2) / max(1, len(alive2)),
                        sum(L.bal[f"{l}_refah"] for l in alive2), dict(wf_stat)))


def _dest_plan(W, lo, others, mc, nd, tot_m):
    """`lo` kapanırken üyelerin dağılımı (firma -> yeni lonca; sıra firms sırası). Arge firması Ar-Ge payı en yüksek loncaya, öbürleri lonca_score'u en düşüğe gider; döngü içinde firma
    loncası geçici değişir (sonraki skor bunu görür) ve sonda geri alınır: yan etkisiz. mc/nd kopyalanır. lonca_step bu sonucu uygular (tek dağıtım mantığı; devir önce bununla denenir)."""
    firms = W.firms
    pot_ema = W.pot_ema
    mc2, nd2 = defaultdict(int, mc), defaultdict(int, nd)
    dest, saved = {}, {}
    if LONCA_TERMS:
        W._lt_risk = {l_: lo_risk(W, l_) for l_ in others}                  # REKABET G5: lonca_score'un kredi faizi terimi için lo_risk önbelleği (plan boyunca krediler değişmez)
    for f, d in firms.items():
        if d["lonca"] != lo:
            continue
        if d["kind"] == "arge":
            tgt = max(others, key=lambda l: (pot_ema[l] / (nd2[l] + 1), l))
            nd2[tgt] += 1
        else:
            tgt = min(others, key=lambda l: ((lonca_score(W, d, l, mc2, tot_m, f=f) if LONCA_TERMS else lonca_score(W, d, l, mc2, tot_m)), l))
            mc2[tgt] += 1
        saved[f] = d["lonca"]
        d["lonca"] = tgt
        dest[f] = tgt
    for f, v in saved.items():
        firms[f]["lonca"] = v
    W.__dict__.pop("_lt_risk", None)
    return dest


def lonca_pa(W, lo, R, h, dest):
    """PLAN-KREDI T6 (U8, §4.2): öz kaynağı eksi `lo` loncasının defter değeriyle devir PLANI (saf okuma; hiçbir şey değişmez). R = alıcılar (kredi verebilenler), h = lo_classes kaldıraç payları, dest = üye dağılımı.
    Paylar s_r ~ h_r (kaldıraç kapalıyken h sonsuz: öz kaynak oranı). Firma kredisi firmayla birlikte yeni loncasına (o lonca R'de değilse en büyük paylı alıcıya); konut kredisi bütün olarak, hedef payından
    en çok eksiği olan alıcıya; tahvil kaydı s_r oranında bölünür; mevduat hesabı bütün olarak, büyükten küçüğe, hedef payı s_r x D'den en çok eksiği olan alıcıya (tutar ve hak değişmez).
    Nakit: alıcı r'nin nakdi c_r = D_r - nakit dışı varlık_r - s_r x açık; eksi çıkan fark lo'nun sermayesine ödenir, sonra pozitifler dağıtılır (Σ c_r = lo'nun sermaye nakdi; ödeme türü "lonca_devir").
    Uygunluk: alıcı var, her alıcının sonraki öz kaynağı > 0, eksi payı ödeyecek alıcının nakdi var; değilse None (kapanma bekler). Uygunsa lonca_pa_apply'ın uygulayacağı plan sözlüğü."""
    L = W.L
    bonds = W.bonds
    deposits = W.deposits
    firms = W.firms
    loans = W.loans
    mortgages = W.mortgages
    if not R:
        return None
    eq = {r: lo_equity(W, r) for r in R}
    deficit = -lo_equity(W, lo)
    wt = {r: (h[r] if h[r] != float("inf") else eq[r]) for r in R}
    tw = sum(wt.values())
    if tw <= 0:
        return None
    s = {r: wt[r] / tw for r in R}
    for r in R:
        if eq[r] - s[r] * deficit <= 0:
            return None
    top = max(R, key=lambda r: (s[r], -int(r[5:])))                                         # en büyük pay, eşitlikte küçük lonca numarası
    noncash = {r: 0.0 for r in R}
    credit_to = {r: 0.0 for r in R}
    loan_to = {}
    for fn, ln_ in loans.items():
        if ln_["lo"] != lo:
            continue
        tgt = dest.get(fn, firms[fn]["lonca"] if fn in firms else None)
        r = tgt if tgt in noncash else top
        loan_to[fn] = r
        noncash[r] += ln_["out"]
        credit_to[r] += ln_["out"]
    mort_tot = sum(m_["out"] for m_ in mortgages if m_["lo"] == lo)
    mort_got = {r: 0.0 for r in R}
    mort_to = {}
    for i_, m_ in sorted(((i, m) for i, m in enumerate(mortgages) if m["lo"] == lo), key=lambda x: -x[1]["out"]):
        r = max(R, key=lambda r_: (s[r_] * mort_tot - mort_got[r_], -int(r_[5:])))
        mort_to[i_] = r
        mort_got[r] += m_["out"]
        noncash[r] += m_["out"]
        credit_to[r] += m_["out"]
    bad_bonds = [b_ for b_ in bonds if b_["lo"] == lo]
    for b_ in bad_bonds:
        for r in R:
            noncash[r] += b_["out"] * s[r]
    accts = sorted(((e_[1], -i_, q_) for i_, (q_, e_) in enumerate(deposits.items()) if e_[0] == lo), reverse=True)
    dep_all = sum(a_ for a_, _i, _q in accts)                                               # hesap toplamı (dep_tot[lo] ile aynı olmalı; sapma olsa da nakit kapanışı hesaplardan türer)
    dep_got = {r: 0.0 for r in R}
    dep_to = {}
    for amt, _i, q_ in accts:
        r = max(R, key=lambda r_: (s[r_] * dep_all - dep_got[r_], -int(r_[5:])))
        dep_to[q_] = r
        dep_got[r] += amt
    c = {r: dep_got[r] - noncash[r] - s[r] * deficit for r in R}
    for r in R:
        if c[r] < -1e-9 and L.bal[f"{r}_sermaye"] + 1e-9 < -c[r]:
            return None
    return dict(R=list(R), s=s, c=c, loan_to=loan_to, mort_to=mort_to, dep_to=dep_to, bad_bonds=bad_bonds, deficit=deficit, credit_to=credit_to, top=top)


def lonca_pa_apply(W, lo, plan):
    """lonca_pa planını uygular. Başarısız olabilecek hiçbir denetim yoktur (hepsi planda yapıldı); nakit, kredi/konut/tahvil kayıtları, mevduat hesapları, CREDIT_MONEY basılmış anapara kaydı ve sayaç."""
    L = W.L
    bonds = W.bonds
    deposits = W.deposits
    dep_tot = W.dep_tot
    loans = W.loans
    mortgages = W.mortgages
    R, s, c = plan["R"], plan["s"], plan["c"]
    pool = f"{lo}_sermaye"
    for r in R:
        if c[r] < -1e-9:
            L.pay(f"{r}_sermaye", pool, -c[r], "lonca_devir")
    for r in R:
        if c[r] > 1e-9:
            L.pay(pool, f"{r}_sermaye", c[r], "lonca_devir")
    for fn, r in plan["loan_to"].items():
        loans[fn]["lo"] = r
    for i_, r in plan["mort_to"].items():
        mortgages[i_]["lo"] = r
    last = R[-1]
    for b_ in plan["bad_bonds"]:
        rest, rest0 = b_["out"], b_["p0"]
        for r in R:
            part = rest if r == last else b_["out"] * s[r]
            part0 = rest0 if r == last else b_["p0"] * s[r]
            if part < 1e-12 and r != last:
                continue                                                                    # çok küçük pay son alıcının kalanına eklenir (toplam korunur)
            rest -= part
            rest0 -= part0
            ex_ = next((x for x in bonds if x["city"] == b_["city"] and x["lo"] == r), None)
            if ex_ is not None:
                ex_["rate"] = (ex_["rate"] * ex_["out"] + b_["rate"] * part) / max(1e-9, ex_["out"] + part)
                ex_["out"] += part
                ex_["p0"] = ex_["out"]
            else:
                bonds.append(dict(b_, lo=r, p0=part0, out=part))
    bad_ids = {id(b_) for b_ in plan["bad_bonds"]}
    bonds[:] = [b_ for b_ in bonds if id(b_) not in bad_ids]
    for q_, r in plan["dep_to"].items():
        e_ = deposits[q_]
        dep_tot[r] += e_[1]
        e_[0] = r
    dep_tot[lo] = 0.0
    cm = W.cm
    if cm is not None:                                                                      # K-218: basılmış anapara (live) ve kayıp (lost) devralınan kredi oranında alıcılara geçer
        ct = plan["credit_to"]
        tot = sum(ct.values())
        for r in R:
            f_ = ct[r] / tot if tot > 1e-12 else (1.0 if r == plan["top"] else 0.0)
            cm.live[r] += cm.live[lo] * f_
            cm.lost[r] += cm.lost[lo] * f_
        cm.live[lo] = 0.0
        cm.lost[lo] = 0.0
    W.lo_stat["devir_acik_akce"] += plan["deficit"]


def lonca_step(W, w):
    """K-171/K-174: ödenemeyen gider ya da üyesizlik/kasasızlık 12 hafta sürerse lonca kapanır; her üye firma kendi skoruna göre başka loncaya geçer, DAO'lar Ar-Ge payına göre, krediler firmayla, havuz taşınanlarla orantılı dağılır; kapanan slotu itibarlı oyuncu yeniden kurabilir."""
    FEES = W.FEES
    L = W.L
    LEV_ON = W.LEV_ON
    LIQ_ON = W.LIQ_ON
    REP = W.REP
    WELF_ON = W.WELF_ON
    arge_boost = W.arge_boost
    bonds = W.bonds
    closed = W.closed
    closed_at = W.closed_at
    dep_tot = W.dep_tot
    deposits = W.deposits
    fee_dir = W.fee_dir
    fee_prev = W.fee_prev
    firms = W.firms
    founder_ban = W.founder_ban
    liq_stat = W.liq_stat
    lo_low = W.lo_low
    lo_members = W.lo_members
    lo_stress = W.lo_stress
    lo_unpaid = W.lo_unpaid
    loans = W.loans
    lonca_info = W.lonca_info
    lonca_log = W.lonca_log
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    media_log = W.media_log
    media_save = W.media_save
    mortgages = W.mortgages
    mprof = W.mprof
    new_slots = W.new_slots
    owner_rec = W.owner_rec
    people = W.people
    pot_ema = W.pot_ema
    rev_lb = W.rev_lb
    rev_lc = W.rev_lc
    tech_events = W.tech_events
    wf_eff = W.wf_eff
    wf_g = W.wf_g
    if not LIFE_ACT or w < OWNER_WEEK:
        return
    alive_l = [l for l in loncas if l not in closed]
    mc = defaultdict(int)
    for f, d in firms.items():
        if not d.get("dead") and d["workers"] and d["kind"] not in ("belediye", "arge", "ahir"):
            mc[d["lonca"]] += 1
    for l in loncas:
        lo_members[l] = mc[l]
        lo_stress[l] = 0.8 * lo_stress[l] + (1.0 if lo_unpaid[l] > 1e-9 else 0.0)
    cls = lo_classes(W) if LONCA_INSOLV_CLOSE else None                        # PLAN-KREDI T6: batık lonca kapanır (kapalıyken bu blokların hiçbiri çalışmaz)
    insolv = set(cls[1]) if cls else set()
    order = sorted(alive_l, key=lambda l: (0, lo_equity(W, l)) if l in insolv else (1, 0)) if insolv else alive_l     # batık önce, en büyük açık (en küçük öz kaynak) önce
    for lo in list(order):
        ins_ = lo in insolv
        if len(alive_l) <= 2 and not ins_:
            break
        loan_out_ = sum(ln_["out"] for ln_ in loans.values() if ln_["lo"] == lo)
        cash = L.bal[lo] + L.bal[f"{lo}_sermaye"] - dep_tot[lo] + loan_out_
        unpaid = COST_ACT and lo_unpaid[lo] > 1e-9
        lo_low[lo] = lo_low[lo] + 1 if ((mc[lo] <= LONCA_MIN_MEMBERS and cash < ix(W, LONCA_MIN_CASH)) or unpaid) else 0
        lo_unpaid[lo] = 0.0
        if not ins_ and lo_low[lo] < LONCA_DEAD_WEEKS:
            continue
        others = [l for l in alive_l if l != lo]
        if cls is not None:                                           # T6: üyeler batık loncaya dağılmaz (hedef kümesinden çıkar)
            others = [l for l in others if l not in insolv] or others
        nd = defaultdict(int)
        for n in live_daos(W):
            nd[firms[n]["lonca"]] += 1
        tot_m = max(1, sum(mc[l] for l in others))
        plan = None
        if ins_:                                                      # T6: devir önce denenir; olmazsa kapanma bekler (hiçbir şey değişmez)
            R_ = [r for r in cls[0] if r != lo]
            dest = _dest_plan(W, lo, others, mc, nd, tot_m) if (R_ and others) else None
            plan = lonca_pa(W, lo, R_, cls[3], dest) if dest is not None else None
            if plan is None:
                W.lo_stat["batik_bekleme_hafta"] += 1
                continue
        else:
            dest = _dest_plan(W, lo, others, mc, nd, tot_m)
        moved = defaultdict(int)
        for f, tgt in dest.items():
            d = firms[f]
            if d["kind"] == "arge":
                nd[tgt] += 1
            else:
                mc[tgt] += 1
            d["lonca"] = tgt
            d["tech_next"] = 0
            if tgt in new_slots:
                d["ever_new"] = True
            moved[tgt] += 1
            if HUMAN_LONCA and d.get("lonca_insan") is not None:         # F2: insanın seçtiği lonca kapandı: firma bot kuralıyla yeniden atandı, seçim silinir
                del d["lonca_insan"]
                human_olay(W, w, "lonca_kapandi_yeniden_atandi", firma=f, eski=lo, lonca=tgt)
            elif HUMAN_ON and d.get("owner") == W.human:
                human_olay(W, w, "lonca_degisti", firma=f, eski=lo, lonca=tgt, kaynak="kapanma")      # rekabet G1: seçim yapmamış insanın firması kapanan loncadan bot kuralıyla taşındı
        h_snap = None
        if HUMAN_LONCA and lo in lonca_owner and lonca_owner[lo][0] == W.human:         # F3: insanın loncası kapanıyor: kayıp ve mevduat taşınması defterden hesaplanır
            h_ent = deposits.get(W.human)
            h_snap = (L.bal[W.human], h_ent[0] if (h_ent is not None and h_ent[1] > 1e-9) else None, h_ent[1] if (h_ent is not None and h_ent[1] > 1e-9) else 0.0)
        main = max(others, key=lambda l: (moved[l], mc[l], l))
        for f, d in firms.items():
            if d.get("lic") == lo:
                d["lic"] = main
        sol_ = 1.0
        liq_paid_out = False
        if ins_:                                                  # T6: defter değeriyle devir (indirimli LIQUIDATION satışı kullanılmaz); plan önceden denetlendi
            lonca_pa_apply(W, lo, plan)
        if LIQ_ON and not ins_:                                                # K-185.10: kredi portföyü ve ipotekler satılır/devredilir; satış geliri ve havuz nakdi önce mevduat sahiplerine
            pool_lo = f"{lo}_sermaye"
            for fn, ln_ in list(loans.items()):
                if ln_["lo"] == lo:
                    acq = dest.get(fn, main)
                    price_ = ln_["out"] * (1 - LOAN_SALE_DISC) * ((1 - LOAN_SALE_BAD) if ln_["miss"] > 0 else 1.0)
                    price_ = min(price_, lendable_cash(W, acq))
                    got_ = L.pay(f"{acq}_sermaye", pool_lo, price_, "kredi_portfoy_devri")
                    ln_["lo"] = acq
                    liq_stat["portfoy_adet"] += 1
                    liq_stat["portfoy_defter"] += ln_["out"]
                    liq_stat["portfoy_satis"] += got_
            for m_ in mortgages:
                if m_["lo"] == lo:
                    price_ = min(m_["out"] * (1 - LOAN_SALE_DISC), lendable_cash(W, main))
                    got_ = L.pay(f"{main}_sermaye", pool_lo, price_, "kredi_portfoy_devri")
                    m_["lo"] = main
                    liq_stat["portfoy_adet"] += 1
                    liq_stat["portfoy_defter"] += m_["out"]
                    liq_stat["portfoy_satis"] += got_
            for b_ in bonds:
                if b_["lo"] == lo:
                    b_["lo"] = main
            P_ = L.bal[pool_lo] + L.bal[lo]
            dt_ = dep_tot[lo]
            if dt_ > 1e-9:
                hc_ = min(1.0, P_ / dt_)
                L.pay(lo, pool_lo, L.bal[lo], "lonca_tasfiye_ic")
                for q_, e_ in deposits.items():
                    if e_[0] == lo and e_[1] > 1e-9:
                        L.pay(pool_lo, q_, e_[1] * hc_, "mevduat_tasfiye")
                        e_[1] = 0.0
                liq_stat["mevduat_tasfiye"] += dt_
                liq_stat["mevduat_odenen"] += dt_ * hc_
                if hc_ < 1.0 - 1e-9:
                    L.flows["mevduat_kaybi_akce"] += dt_ * (1 - hc_)
                    if LONCA_TERMS:
                        lt_stat_hucre(W, lo)["mev_kaybi"] += dt_ * (1 - hc_)           # REKABET G5 (davranışsız): lonca başına kapanışta mevduat kaybı
                    L.flows["mevduat_kayipli_lonca_adet"] += 1
                dep_tot[lo] = 0.0
            liq_paid_out = True
        if LEV_ON and not LIQ_ON and not ins_ and dep_tot[lo] > 1e-9:                          # K-185.6: mevduat sigortası yok: varlık (nakit + krediler + ipotek + tahvil) mevduatı karşılamazsa mevduat sahipleri oranında kayıp yaşar
            assets_ = L.bal[f"{lo}_sermaye"] + L.bal[lo] + lo_credit(W, lo) + sum(b_["out"] for b_ in bonds if b_["lo"] == lo)
            sol_ = max(0.0, min(1.0, assets_ / dep_tot[lo]))
            if sol_ < 1.0 - 1e-9:
                L.flows["mevduat_kaybi_akce"] += dep_tot[lo] * (1 - sol_)
                if LONCA_TERMS:
                    lt_stat_hucre(W, lo)["mev_kaybi"] += dep_tot[lo] * (1 - sol_)
                L.flows["mevduat_kayipli_lonca_adet"] += 1
                n_h_ = sum(1 for e_ in deposits.values() if e_[0] == lo and e_[1] > 1e-9)
                L.flows["mevduat_kayipli_hesap_adet"] += n_h_
        for fn, ln_ in loans.items():
            if ln_["lo"] == lo:
                ln_["lo"] = dest.get(fn, main)
        if LEV_ON:
            for m_ in mortgages:
                if m_["lo"] == lo:
                    m_["lo"] = main
            for b_ in bonds:
                if b_["lo"] == lo:
                    b_["lo"] = main
        for e_ in deposits.values():
            if e_[0] == lo:
                e_[0] = main
                e_[1] *= sol_
        dep_tot[main] += dep_tot[lo] * sol_
        dep_tot[lo] = 0.0
        wsum = sum(moved[l] for l in others) or 1
        pool_amt, cash_amt = L.bal[f"{lo}_sermaye"], L.bal[lo]
        for l in others:
            sh_ = moved[l] / wsum if sum(moved.values()) else (1.0 if l == main else 0.0)
            L.pay(f"{lo}_sermaye", f"{l}_sermaye", pool_amt * sh_, "lonca_tasfiye")
            L.pay(lo, l, cash_amt * sh_, "lonca_tasfiye")
        if WELF_ON and L.bal[f"{lo}_refah"] > 0:
            L.pay(f"{lo}_refah", f"{main}_refah", L.bal[f"{lo}_refah"], "lonca_tasfiye")
        wf_g[lo] = 0.0
        wf_eff[lo] = 0.0
        pot_ema[lo] = 0.0
        for b_ in BRANCHES:
            rev_lb[(lo, b_)] = 0.0
        owner_rec.pop(lo, None)
        own_ = lonca_owner.pop(lo, None)
        if h_snap is not None and own_:
            odenen = W.human_lonca_odenen.pop(lo, 0.0)
            h_ent = deposits.get(W.human)
            kalan_ = float(h_ent[1]) if (h_snap[1] == lo and h_ent is not None and h_ent[1] > 1e-9) else 0.0
            tasindi = {"lonca": h_ent[0], "tutar": kalan_} if kalan_ > 0 else None
            dep_odendi = max(0.0, h_snap[2] - kalan_) if h_snap[1] == lo else 0.0      # mevduat hesabının nakit ödenen kısmı (kapanışta kredi portföyü satışıyla)
            iade = max(0.0, L.bal[W.human] - h_snap[0] - dep_odendi)                    # sermaye olarak insana dönen para (şu an yok; defterden ölçülür)
            human_olay(W, w, "loncam_kapandi", lonca=lo, neden="batik" if ins_ else ("gider" if unpaid else "uyesiz"), kayip=float(max(0.0, odenen - iade)), mevduat_tasindi=tasindi, mevduat_odendi=float(dep_odendi))      # F3: kayıp = insanın kuruluşta koyduğu sermayeden geri almadığı tutar; mevduat kayıp değil, taşınır
        if own_:
            people[own_[0]].pop("lonca_owner", None)
        closed.add(lo)
        closed_at[lo] = w
        alive_l.remove(lo)
        if MO_ACT:
            for f_, d_ in firms.items():
                if d_.get("org_owner") == ("lonca", lo):
                    d_["org_owner"] = None
                    media_save[lo] = 0.0
                    media_log.append(dict(week=w, media=f_, owner=lo, kind="lonca", price=0.0, profit=mprof[f_], end=True))
        L.flows["lonca_kapanis_adet"] += 1
        W.lo_stat["kapanis_batik" if ins_ else ("kapanis_gider" if unpaid else "kapanis_uyesiz")] += 1
        if cls is not None:
            cls = lo_classes(W)                                   # T6: her kapanıştan sonra sınıflar yeniden hesaplanır
            insolv = set(cls[1])
        if NL_ACT:
            FEES.pop(lo, None)
            if lo in lonca_info:
                lonca_info[lo]["end"] = w
                lonca_info[lo]["reason"] = "batık" if ins_ else ("gider ödenemedi" if unpaid else "üyesiz/kasasız")
                lonca_log.append(dict(lonca_info[lo], lo=lo))
            if own_:
                founder_ban[own_[0]] = w
            for k_ in [("m", lo), ("p", lo), lo]:
                fee_prev.pop(k_, None)
            for k_ in [k2 for k2 in rev_lc if k2[0] == lo]:
                rev_lc.pop(k_, None)
            arge_boost.pop(lo, None)
        tech_events.append(f"hafta {w}: {lo} kapandı (üye {sum(moved.values())}, kasa+alacak {cash:,.0f}{', gider ödenemedi' if unpaid else ''}{', öz kaynağı eksi: varlık ve mevduat kredi verebilen loncalara devredildi' if ins_ else ''}); üyeler skorlarına göre " + ", ".join(f"{l} {moved[l]}" for l in others if moved[l]) + " loncalarına dağıldı, sahibi rolünü kaybetti")
    rf_wait, rf_rep, rf_cap = lonca_yeniden_esik(W, LONCA_EASY)                # T7: kolay kurulum eşikleri
    for lo in sorted(closed):
        if not lonca_yuva_hazir(W, lo, w, LONCA_EASY):
            continue
        taken = {v[0] for v in lonca_owner.values()}
        cand = [q for q, i_ in people.items() if i_["who"] == "oyuncu" and not (HUMAN_ON and q == W.human) and not lonca_kur_eksikleri(W, q, w, "yeniden", taken=taken, kisa=True, easy=LONCA_EASY)]      # DAO oyunu: insan kendiliğinden lonca sahibi olmaz; şartlar F3 tek kaynağından
        if cand:
            q = max(cand, key=lambda x: (REP[x], x))
            lonca_kur_yeniden(W, q, w, lo, rf_cap)
    if cls is not None:
        W.lo_insolv = set(lo_classes(W)[1])                       # T6: kapanışlardan sonra batık küme (tahvil havuzu süzgeci)


def nl_step(W, w):
    """K-176: başarılı inovatör (DAO'su telif kazanan kurucu ya da yerleşmiş inovatör firma sahibi), mevcut loncasında kalmanın getirisini kendi loncasının beklenen getirisiyle karşılaştırır; üstünse yeni (girişimci) lonca kurar."""
    FEES = W.FEES
    KN = W.KN
    L = W.L
    REP = W.REP
    arge_boost = W.arge_boost
    closed = W.closed
    con_ema = W.con_ema
    con_prev = W.con_prev
    dao_con = W.dao_con
    dao_info = W.dao_info
    dao_tel = W.dao_tel
    fee_dir = W.fee_dir
    fee_inc = W.fee_inc
    fee_snaps = W.fee_snaps
    firms = W.firms
    founder_ban = W.founder_ban
    lo_low = W.lo_low
    lo_stress = W.lo_stress
    lo_unpaid = W.lo_unpaid
    lonca_info = W.lonca_info
    lonca_owner = W.lonca_owner
    loncas = W.loncas
    new_slots = W.new_slots
    nl_dbg = W.nl_dbg
    owner_rec = W.owner_rec
    people = W.people
    pot_ema = W.pot_ema
    tech_events = W.tech_events
    tel_ema = W.tel_ema
    tel_prev = W.tel_prev
    if not NL_ACT or w < OWNER_WEEK:
        return
    for l_ in list(arge_boost):
        arge_boost[l_] *= ARGE_DECAY
    # tepe üye sayısı ve haftalık fee anlık görüntüsü
    alive_l = [l for l in loncas if l not in closed]
    mc = defaultdict(int)
    for f, d in firms.items():
        if not d.get("dead") and d["workers"] and d["kind"] not in ("belediye", "arge", "ahir"):
            mc[d["lonca"]] += 1
    for l in alive_l:
        if l in lonca_info:
            lonca_info[l]["peak"] = max(lonca_info[l]["peak"], mc[l])
    fee_snaps.append((w, {l: fee_inc[l] for l in loncas}))
    if len(fee_snaps) > 9:
        fee_snaps.pop(0)
    for n in live_daos(W):
        tel_ema[n] = 0.85 * tel_ema[n] + 0.15 * (dao_tel[n] - tel_prev[n])
        con_ema[n] = 0.85 * con_ema[n] + 0.15 * (dao_con[n] - con_prev[n])
        tel_prev[n], con_prev[n] = dao_tel[n], dao_con[n]
    if w < OWNER_WEEK + 10 or len(fee_snaps) < 9:
        return
    est_l = [l for l in alive_l]
    tot_mem = max(1, sum(mc[l] for l in est_l))
    fee_now = sum(fee_inc[l] for l in est_l) - sum(fee_snaps[0][1].get(l, 0.0) for l in est_l)
    phi = fee_now / 8.0 / tot_mem                       # üye başına haftalık fee geliri (Akçe)
    fee_avg_ = lonca_fee_ort(W)
    fee_est = max(FEE_MIN, fee_avg_ * (1.0 - NEW_UNDERCUT))
    taken = {v[0] for v in lonca_owner.values()}
    prog = PROGRAM_INNOV
    best = None
    for q, i_ in people.items():
        if i_["who"] != "oyuncu" or q in taken or (HUMAN_ON and q == W.human):      # DAO oyunu: insan kendiliğinden lonca kurmaz
            continue
        fm_ = medya_firmalari(W, q, w)
        if fm_:                                                       # K-183.6: medya loncası adaylarının neden elendiğini say (rapor)
            nl_dbg["medya sahibi aday-hafta"] += 1
            nl_dbg["  itibar < eşik"] += REP[q] < REP_LFOUND
            nl_dbg["  likit < eşik"] += L.bal[q] < (ix(W, MEDIA_LF_CAP) + 500.0 if not LONCA_KUR_ESIK else sum(lonca_kur_baglam(W, q, w, "medya", fm_, LONCA_EASY)[k_] for k_ in ("cap_q", "buf")))      # rekabet G1: bayraklı eşik; bayrak 0 iken eski sayım aynen
            nl_dbg["  en yüksek likit (Akçe)"] = max(nl_dbg["  en yüksek likit (Akçe)"], int(L.bal[q]))
        yol = "medya" if fm_ else "girisimci"
        bag = lonca_kur_baglam(W, q, w, yol, fm_, LONCA_EASY)
        if lonca_kur_eksikleri(W, q, w, yol, bag, taken, kisa=True, easy=LONCA_EASY):      # F3: kuruluş şartları tek kaynaktan (bot ve insan)
            continue
        easy_, dn, med_, m_mar, cap_q = bag["easy_"], bag["dn"], bag["med_"], bag["m_mar"], bag["cap_q"]
        ci = i_["city"]
        if dn:
            n_lic = sum(1 for d in firms.values() if d.get("lic_n") == dn and d["workers"] and not d.get("dead"))
            T, C = tel_ema[dn], con_ema[dn]
            dcost = dao_weekly_cost(W, dn)
        else:
            n_lic, T, C, dcost = 0, 0.0, 0.0, 0.0
        n_loc = 0.25 * sum(1 for d in firms.values() if d["city"] == ci and d["workers"] and not d.get("dead") and d["kind"] not in ("belediye", "arge", "ahir"))
        n_est = n_lic + n_loc
        fee_inc_est = phi * (fee_est / max(1e-9, fee_avg_)) * n_est
        own_contract = min(prog["arge"] * fee_inc_est, CONTRACT_CAP * dcost) if dn else 0.0
        cost_est = ix(W, LC_FIXED) * max(LC_SCALE_MIN, (n_est / LC_SCALE_N) ** 0.5) + ix(W, LC_MEMBER) * n_est
        found = prog["kurucu_payi"] * fee_inc_est + own_contract + (TELIF_MEMBER_RATIO * T if dn else 0.0) - cost_est
        stay = T + C
        gain = found - stay
        if med_:
            nl_dbg["kazanç değerlendirildi"] += 1
            nl_dbg["  kazanç > eşik"] += gain > m_mar * ix(W, MEDIA_LF_MARGIN)
        if (gain > (m_mar * ix(W, MEDIA_LF_MARGIN) if med_ else bag["e_mar"]) or easy_) and (best is None or gain > best[0]):
            best = (gain, q, dn, fee_est, n_est, cap_q)
    if best:
        gain, q, dn, fee_e, n_est, cap_best = best
        lonca_kur_yeni(W, q, w, dn, fee_e, n_est, cap_best, gain)


def insan_lonca_kur(W, w):
    """F3: insanın bekleyen lonca_kur kararını (W.human_lonca_kur) uygular; botun kazanç karşılaştırması yoktur, yalnız lonca_kur_eksikleri (bot ile aynı şartlar) boşsa kurar.
    Olaylar: lonca_kuruldu{lonca}, lonca_kurulamadi{yol, neden: [eksik kimlikleri]}. Tek seferliktir."""
    yol = W.human_lonca_kur
    if yol is None:
        return
    W.human_lonca_kur = None
    q = W.human
    ek = lonca_kur_eksikleri(W, q, w, yol, easy=LONCA_EASY)
    if ek:
        human_olay(W, w, "lonca_kurulamadi", yol=yol, neden=[e["id"] for e in ek])
        return
    if yol == "yeniden":
        lo = lonca_yeniden_yuvasi(W, w, LONCA_EASY)
        lonca_kur_yeniden(W, q, w, lo, lonca_yeniden_esik(W, LONCA_EASY)[2])
    else:
        firms = W.firms
        bag = lonca_kur_baglam(W, q, w, yol, None, LONCA_EASY)
        dn = bag["dn"]
        n_lic = sum(1 for d in firms.values() if d.get("lic_n") == dn and d["workers"] and not d.get("dead")) if dn else 0
        n_loc = 0.25 * sum(1 for d in firms.values() if d["city"] == W.people[q]["city"] and d["workers"] and not d.get("dead") and d["kind"] not in ("belediye", "arge", "ahir"))
        fee_e = max(FEE_MIN, lonca_fee_ort(W) * (1.0 - NEW_UNDERCUT))
        lo = lonca_kur_yeni(W, q, w, dn, fee_e, n_lic + n_loc, bag["cap_q"], 0.0)
    for d in W.firms.values():
        if d.get("owner") == q and d["lonca"] == lo:
            d["lonca_insan"] = w                                       # F2: bot switch_step insanın seçimini bozmaz
    W.human_lonca_odenen[lo] = float(lonca_yeniden_esik(W, LONCA_EASY)[2] if yol == "yeniden" else bag["cap_q"])      # F3: kapanışta kayıp hesabı için insanın ödediği sermaye
    human_olay(W, w, "lonca_kuruldu", lonca=lo)
