"""simkit.sector_core: K-212 sektör panosu karar okuyucuları (W.board'u OKUR; bayrak kapalıyken W.board yoktur ve hepsi nötr değer döner).

ARAYÜZ: zincir_urunleri, sole_secilen, son_uretici, sole_uretici_yok, mk_weights, mk_share, sb_health, sb_buf_mult, sb_split_row, sb_need_mult, sb_scale_mult, sb_price_target, sb_entry_ok, sb_hire_ok, sb_firm_scarcity, board_stat_add, rs_mmk, _rs_canli, rs_logit, rs_step, ls_cell, mp_etkin
OKUR: W.board, W.firms, W.RECIPES, W.srev_hist (ls_cell); params SB_*, SOLE_*, LS_*, RS_*, MP_*. YAZAR: W.rs_pay (RETAIL_SHARE: market payı, rs_step), W.sb_stat (kural sayaçları), W.sole_zincir (SOLE_KEEP: koşu başına bir kez). Pano hesabı: simkit.sector_board.
KATMAN: L0 (yalnız params).
"""
import math
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403



def zincir_urunleri(W):
    """te-denge G6 (SOLE_KEEP): BASKET ürünleri ve açılış reçeteleri (RECIPES0) üzerinden geçişli girdiler; ölçüm aracıyla (denge_ozet.sepet_zinciri) aynı küme.
    Teknolojiyle sonradan eklenen isteğe bağlı girdiler (yazılım, bilgisayar) dışarıda. Koşu başına bir kez (W.sole_zincir)."""
    z = getattr(W, "sole_zincir", None)
    if z is not None:
        return z
    uretenler = defaultdict(list)
    for tur, (cikti, _girdi) in RECIPES0.items():
        for u in cikti:
            uretenler[u].append(tur)
    gor = set()
    yigin = list(BASKET)
    while yigin:
        u = yigin.pop()
        if u in gor:
            continue
        gor.add(u)
        for tur in uretenler.get(u, ()):
            yigin.extend(g for g in RECIPES0[tur][1] if g not in gor)
    W.sole_zincir = z = frozenset(gor)
    return z


def sole_uretici_yok(W, f, d):
    """te-denge G6: f firmasının ürününü üreten başka, ölü olmayan firma (sahipli ya da sahipsiz, kadrolu ya da değil, her şehir) yok mu? (ölü firmanın canlanma koşulu)"""
    p = PROD_OF[d["kind"]]
    for g, e in W.firms.items():
        if g != f and not e.get("dead") and e["kind"] in PROD_OF and PROD_OF[e["kind"]] == p:
            return False
    return True


def sole_secilen(W, f, d):
    """te-denge G6 (SOLE_KEEP): f ürününün dünyadaki 'son üretici' adayı mıdır ve seçilen TEK firma hangisi? Kimlik döner (None: korunacak firma yok).
    f sahipsiz, ahır/belediye değil, ürünü sepet zincirinde olmalı; dünyada o ürünü üreten BAŞKA işçili canlı firma varsa None.
    Seçim sırası: işçili > zaten 'sole' işaretli > en yüksek kasa > en küçük firma kimliği (adaylar: sahipsiz, işçisiz/işçili canlı firmalar ve f)."""
    if d["owner"] is not None or d["kind"] in ("ahir", "belediye") or d["kind"] not in PROD_OF:
        return None
    p = PROD_OF[d["kind"]]
    if p not in zincir_urunleri(W):
        return None
    bal = W.L.bal
    en = (f, (0 if d["workers"] else 1, 0 if d.get("sole") else 1, -bal[f], f))
    for g, e in W.firms.items():
        if g == f or e.get("dead") or e["kind"] not in PROD_OF or PROD_OF[e["kind"]] != p:
            continue
        if e["workers"]:
            return None
        if e["owner"] is None and e["kind"] not in ("ahir", "belediye"):
            k = (1, 0 if e.get("sole") else 1, -bal[g], g)
            if k < en[1]:
                en = (g, k)
    return en[0]


def son_uretici(W, f, d):
    """te-denge G6 (SOLE_KEEP): f, ürün başına seçilen tek korunan firma mı (bkz. sole_secilen)."""
    return sole_secilen(W, f, d) == f


def sb_health(W, f):
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    r = b["fh"].get(f)
    return 1.0 if r is None else r["h"]


def sb_buf_mult(W, p, ci):
    """girdi tampon hedefi çarpanı (INV_IN_CYC ile çarpılır): tedarikçi riskine göre; tavan SB_BUF_HI.
    Etkin sağlıklı tedarikçi = yerel sağlıklı + 0,5 x (başka şehirlerdeki sağlıklı); >=3: LO; 2: orta; 1: yüksek; sağlıksız/yok: HI; kalıcı kıtlık tamponu artırır."""
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    pr = b["prod"].get(p)
    if pr is None or pr["n_all"] == 0:
        return 1.0
    cl = b["cells"].get((ci, p))
    loc_h = cl["n_healthy"] if cl else 0
    n_eff = loc_h + 0.5 * (pr["n_h"] - loc_h)
    if n_eff >= 3.0:
        m = SB_BUF_LO
    elif n_eff >= 2.0:
        m = SB_BUF_LO + 0.5 * (1.0 - SB_BUF_LO)
    elif n_eff >= 1.5:
        m = 1.0
    elif n_eff >= 1.0:
        m = 1.0 + (SB_BUF_HI - 1.0) / 3.0
    else:
        m = SB_BUF_HI
    m += min(SB_BUF_HI - m, 10.0 * pr["persist"]) if m < SB_BUF_HI else 0.0
    return min(SB_BUF_HI, max(SB_BUF_LO, m))


def sb_split_row(W, sl, row, product):
    """clear_fp: firma alıcı satırı için sağlıksız baskın tedarikçinin ağırlığını, payı <= 1-SB_SECOND olacak şekilde kısar (başka satıcı varsa)."""
    b = getattr(W, "board", None)
    if b is None:
        return row
    tot = sum(row)
    if tot <= 0:
        return row
    mi = max(range(len(row)), key=lambda i: row[i])
    am = row[mi]
    if am / tot <= 1.0 - SB_SECOND:
        return row
    r = b["fh"].get(sl[mi][0])
    if r is None or r["h"] >= SB_H_OK:
        return row
    rest = tot - am
    if rest <= 1e-12:
        return row
    cap = rest * (1.0 - SB_SECOND) / SB_SECOND
    if cap < am:
        row = list(row)
        row[mi] = cap
    return row


def sb_need_mult(W, ci, p):
    """kadro hedefi çarpanı: kalıcı kıtlıkta 1 + en çok SB_GROW; stok fazlası ve kıtlık yokken 1 - en çok SB_STAFF_BRAKE."""
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    pr = b["prod"].get(p)
    if pr is None:
        return 1.0
    if pr["persist"] > SB_SCARCE:
        return 1.0 + min(SB_GROW, 4.0 * (pr["persist"] - SB_SCARCE))
    if pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE:
        return 1.0 - min(SB_STAFF_BRAKE, SB_STAFF_BRAKE * (pr["cover"] - SB_STOCK_HI) / SB_STOCK_HI)
    return 1.0


def sb_scale_mult(W, p):
    """üretim ölçeği çarpanı: sektör stoku fazla ve kıtlık yok: SB_BRAKE_MIN'e kadar fren; kalıcı kıtlık: SB_GROW'a kadar artış (NPC, ölçek < 1 iken çağıran uygular)."""
    b = getattr(W, "board", None)
    if b is None:
        return 1.0
    pr = b["prod"].get(p)
    if pr is None:
        return 1.0
    if pr["persist"] > SB_SCARCE:
        return 1.0 + min(SB_GROW, 4.0 * (pr["persist"] - SB_SCARCE))
    if pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE:
        return max(SB_BRAKE_MIN, 1.0 - (pr["cover"] - SB_STOCK_HI) / (2.0 * SB_STOCK_HI))
    return 1.0


def sb_price_target(W, p, tgt, uc):
    """fiyat hedefi: kalıcı kıtlıkta en çok SB_PREM_MAX prim (düşen fiyat eğiliminde yarısı); stok fazlası+kıtlık yokken en çok SB_DISC_MAX indirim, tam birim maliyet uc'un altına inmez."""
    b = getattr(W, "board", None)
    if b is None:
        return tgt
    pr = b["prod"].get(p)
    if pr is None:
        return tgt
    if pr["persist"] > SB_SCARCE:
        prem = min(SB_PREM_MAX, 2.0 * (pr["persist"] - SB_SCARCE))
        if pr["ptrend"] < -0.01:
            prem *= 0.5
        return tgt * (1.0 + prem)
    if pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE:
        disc = min(SB_DISC_MAX, SB_DISC_MAX * (pr["cover"] - SB_STOCK_HI) / SB_STOCK_HI)
        if pr["ptrend"] < -0.01:
            disc = min(SB_DISC_MAX, disc * 1.5)
        return max(uc, tgt * (1.0 - disc))
    return tgt


def sb_entry_ok(W, p, ci):
    """oyuncu girişi: ürünün kıtlığı kalıcı olmalı; girdi tedarikçisi var ama hiçbiri sağlıklı değilse kurma (bekle). Neden döner (None = tamam)."""
    b = getattr(W, "board", None)
    if b is None:
        return None
    pr = b["prod"].get(p)
    if pr is not None and pr["persist"] < SB_ENTRY_PERSIST and not ENTRY_OPEN:       # K-213: ENTRY_OPEN'da "kalıcı kıtlık yoksa girmez" kuralı yok
        return "gecici_kitlik"
    for q_in in W.RECIPES[PRODUCER[p]][1]:
        if q_in in ("yazilim", "bilgisayar", "koruma") or q_in in NO_STOCK:
            continue
        pi = b["prod"].get(q_in)
        if pi is not None and pi["n_all"] > 0 and pi["n_h"] == 0:
            return "tedarikci_saglik"
    return None


def sb_hire_ok(W, d):
    """oyuncu firması işe alımı: ana ürününün sektör stoku fazla ve kıtlık yoksa beklet."""
    b = getattr(W, "board", None)
    if b is None or d["kind"] not in PROD_OF:
        return True
    pr = b["prod"].get(PROD_OF[d["kind"]])
    if pr is None:
        return True
    return not (pr["cover"] > SB_STOCK_HI and pr["persist"] < 0.5 * SB_SCARCE)


def sb_firm_scarcity(W, f):
    b = getattr(W, "board", None)
    if b is None:
        return 0.0
    d = W.firms.get(f)
    if d is None or d["kind"] not in PROD_OF:
        return 0.0
    return b["persist"].get(PROD_OF[d["kind"]], 0.0)



def board_stat_add(W, key, v=1.0):
    st = getattr(W, "sb_stat", None)
    if st is None:
        st = W.sb_stat = defaultdict(float)
    st[key] += v


def mk_weights(W, markets):
    """Hane ödemesinin marketlere dağıtım ağırlığı (ORG_ACT: itibar ağırlığı). phase_cycle_pay ve SELL_MATCH market kuralı aynı formülü kullanır."""
    if RETAIL_SHARE:                                              # te-rekabet G8: pay tek kaynaktan; ölü ya da işçisiz market 0, hiç pay yoksa (kuruluş haftası) canlılar eşit
        firms_, pay_ = W.firms, W.rs_pay
        canli_ = [(not firms_[m_].get("dead")) and bool(firms_[m_]["workers"]) for m_ in markets]
        n_ = max(1, sum(canli_))
        w_ = [(pay_[m_] if m_ in pay_ else (1.0 - RS_INERTIA) / n_) if c_ else 0.0 for m_, c_ in zip(markets, canli_)]       # rs_pay'de olmayan canlı market (doğum haftası) geçici (1 - RS_INERTIA) / n ağırlık alır; ilk rs_step'te kalıcı pay
        if sum(w_) <= 1e-12:
            w_ = [1.0 if c_ else 0.0 for c_ in canli_]
            if sum(w_) <= 1e-12:
                w_ = [1.0] * len(markets)
        return w_
    orep = W.orep
    return [max(0.2, 1.0 + ORG_SHARE_K * (orep.get(m_, 50.0) - 50.0) / 50.0) for m_ in markets]


def mk_share(W, ci, f):
    """te-denge G1: marketin hane ödemesi payı = ağırlığı / toplam ağırlık (ORG_ACT ve >1 market), yoksa 1 / market sayısı (phase_cycle_pay'deki dağıtımın aynısı). Market listesi phase_cycle_demand'dakiyle aynı."""
    markets = [m_ for m_ in W.cities[ci]["firms"] if W.firms[m_]["kind"] == "market"]
    if f not in markets:
        return None
    if (ORG_ACT and len(markets) > 1) or RETAIL_SHARE:
        w = mk_weights(W, markets)
        return w[markets.index(f)] / sum(w)
    return 1.0 / len(markets)


def mp_etkin():
    """MKT_PRICE etkin mi: market başına fiyat yalnız pay fiyattan türediğinde (RETAIL_SHARE = 1) anlamlıdır; RETAIL_SHARE = 0 iken MKT_PRICE hiçbir şey yapmaz (çıktı ikisi de 0 ile bayt bayt aynı)."""
    return bool(MKT_PRICE and RETAIL_SHARE)


def ls_cell(W, ci, kind, w):
    """REKABET G4 (LONCA_SELECT): kuruluş kredisi başvurusu (şehir ci, tür kind) için hücre göstergeleri, SAF (durum yazmaz, RNG yok): (R, n, b, n_gozlem).
    n = hücredeki (şehir, tür) canlı ve kadrolu firma sayısı; R = bunların son 4 haftalık ortalama haftalık cirosunun (W.srev_hist) ortalaması (hücrede ciro yoksa aynı türün dünya ortalaması; o da yoksa 0.0 = bilgi yok).
    b = hücrede hf [w-104, w-52] arasında doğan sahipli firmalardan 52 haftasını doldurmadan ölenlerin payı (üst sınır w-52: yalnız 52 haftalık sonucu gözlenmiş kuşaklar; w-13 sağdan sansürlü olup pd'yi düşük kestirirdi); hücre gözlemi (n_gozlem) < LS_MIN_N ise türün dünya değeri, o da < LS_MIN_N ise LS_B0.
    Gerçek dünya: sektör ve yer bazlı batış oranına göre küçük işletme skorlaması (Berger ve Udell 2006)."""
    hist = W.__dict__.get("srev_hist") or {}                 # YALNIZ HIRE_GATE_GROWTH açıkken kurulur; yoksa R=0.0 döner ve çağıran cov=1 sayar (ls_sec bunu ks_cov_yok ile sayar)
    lo_b, hi_b = w - 104, w - 52
    n = 0
    revs_c, revs_w = [], []
    gz_c = ol_c = gz_w = ol_w = 0
    for f, d in W.firms.items():
        if d["kind"] != kind:
            continue
        in_cell = d["city"] == ci
        dead = d.get("dead")
        if not dead and d["workers"]:
            h = hist.get(f)
            if in_cell:
                n += 1
            if h:
                r_ = sum(h) / len(h)
                revs_w.append(r_)
                if in_cell:
                    revs_c.append(r_)
        born = d.get("born")
        if d.get("owner") is not None and born is not None and lo_b <= born <= hi_b:
            kayip = 1 if (dead and d.get("died", w) - born < 52) else 0
            gz_w += 1
            ol_w += kayip
            if in_cell:
                gz_c += 1
                ol_c += kayip
    revs = revs_c or revs_w
    R = sum(revs) / len(revs) if revs else 0.0
    if gz_c >= LS_MIN_N:
        b = ol_c / gz_c
    elif gz_w >= LS_MIN_N:
        b = ol_w / gz_w
    else:
        b = LS_B0
    return R, n, b, gz_c


def rs_mmk(d):
    """RETAIL_SHARE: pay fonksiyonunun TEK fiyat girdisi = marketin göreli fiyat çarpanı (MKT_PRICE kapalıyken 1,0)."""
    return d.get("mmk", 1.0)


def _rs_canli(W, ci):
    firms = W.firms
    return [f for f in W.cities[ci]["firms"] if firms[f]["kind"] == "market" and not firms[f].get("dead") and firms[f]["workers"]]


def rs_logit(W, ci):
    """RETAIL_SHARE (saf): şehir ci'nin canlı marketleri için logit payı. u = -RS_BETA x ln(mmk / ort) + RS_Q x (orep - 50) / 50; ort = rs_pay ağırlıklı mmk ortalaması (hiç pay yoksa düz ortalama). Toplam 1; durum yazmaz."""
    mk = _rs_canli(W, ci)
    if not mk:
        return {}
    fx = [rs_mmk(W.firms[f]) for f in mk]
    pay = [W.rs_pay.get(f, 0.0) for f in mk]
    ps = sum(pay)
    ort = (sum(p_ * x_ for p_, x_ in zip(pay, fx)) / ps) if ps > 1e-12 else sum(fx) / len(fx)
    u = [-RS_BETA * math.log(x_ / ort) + RS_Q * (W.orep.get(f, 50.0) - 50.0) / 50.0 for f, x_ in zip(mk, fx)]
    mx = max(u)
    e = [math.exp(v - mx) for v in u]
    s = sum(e)
    return {f: e_ / s for f, e_ in zip(mk, e)}


def rs_step(W):
    """RETAIL_SHARE haftalık: rs_pay ← RS_INERTIA x eski + (1 - RS_INERTIA) x logit, şehirde toplam 1'e bölünür. Yeni market 0 ile başlar; ölü ya da işçisiz market 0. Para akışı yazmaz (yalnız W.rs_pay)."""
    pay = W.rs_pay
    for c in W.cities:
        lg = rs_logit(W, c["i"])
        for f in c["firms"]:
            if W.firms[f]["kind"] == "market" and f not in lg:
                pay.pop(f, None)                          # ölü ya da işçisiz: pay 0; işçi alıp dönerse yeni market gibi başlar
        if not lg:
            continue
        yeni = {f: RS_INERTIA * pay.get(f, 0.0) + (1.0 - RS_INERTIA) * v for f, v in lg.items()}
        s = sum(yeni.values())
        for f, v in yeni.items():
            pay[f] = v / s

