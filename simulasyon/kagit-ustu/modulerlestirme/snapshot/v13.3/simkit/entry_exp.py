"""simkit.entry_exp: beklenen kâra bağlı firma kuruluşu (yalnız ENTRY_EXP açıkken çağrılır).

AMAÇ: sahip kararı (2026-10-28): firma kurulması beklenen kâra bağlı olsun. Her hafta, aday girişimciler (çalışan/işsiz-deneyimli oyuncular) sektör panosuna bakar
(fiyat, birim maliyet, karşılanmayan talep, rakip sayısı) ve her sektör için beklenen haftalık kârı hesaplar:
  V        = beklenen satış hacmi = karşılanmayan talep (şehir payı) + giriş ölçeği x rakip başına ortalama satış  (yeni firma rakip ortalamasının EE_ENTRY_SIZE kadarını yakalar)
  Pi       = (V x (net fiyat - birim girdi) - n x ücret - kira) x (1 - CORP_TAX)       (n = V / işçi başı haftalık çıktı, en az 1; yeni firma EE_MAXN işçiyle sınırlı)
  H_eff    = sum_{t<EE_PAYBACK} (1 - h)^t  (h: haftalık firma ölüm tehlikesi, ilk yıl hayatta kalma EE_SURV1'den)
  hurdle   = FOUND_HARC + K x (kredi faizi LR_NEW + EE_RP) x EE_PAYBACK                   (batık harç + sermaye maliyeti; K = harç + işletme sermayesi)
  oran     = Pi x H_eff / hurdle ;  z = (oran - 1) / EE_TEMP ;  a = logistic(z)
Aday başına haftalık kuruluş olasılığı EE_PMAX x max_sektör a (pürüzsüz: marj arttıkça artar); sektör a^2 ile orantılı seçilir. Şehir/sektör başına haftalık tavan (EE_CAP_*).
İtibar, sektör verimi, kalıcı kıtlık kapıları YOK. Kuruluş eo_found ile (FOUND_FUND kuruluş fonu kredisi; fon dolmamışsa kuruluş bekler). Kendini düzeltir: giriş rakip sayısını artırır,
V (pay ve karşılanmayan talep) düşer, oran düşer. Eski sinyal/worth yolu EE_REPLACE=1 iken kapanır (kohort ENTRY_OPEN'a bağlı kalır).
ARAYÜZ: ee_organic (şehir başına kuruluş), ee_expected (sektör beklenen kâr dökümü; test/ölçüm)
OKUR: W.board (yoksa W.last_short/want_last), W.firms, W.people, W.cities, W.PRICE, W.WI, W.RECIPES. YAZAR: firma kayıtları (eo_found ile), W.eo (stat: ee_*), W.ee_rng dışında yeni durum yok.
KATMAN: L6 (entry_open üstünde, week_people altında).
"""
import math
import random
from simkit.params import *          # noqa: F401,F403
from simkit.credit_core import LR_NEW
from simkit.econ_core import fee_avg, freight, working_capital
from simkit.entry_open import eo_found, eo_input_ok, _cands
from simkit.entry_open_meas import eo_state as _st, eo_stat_add


def _haz(s1=None):
    """haftalık ölüm tehlikesi: ilk yıl hayatta kalma s1 (varsayılan EE_SURV1; BLS BED: yeni işletmelerin ~%78-80'i ilk yılı geçer)."""
    return 1.0 - (EE_SURV1 if s1 is None else s1) ** (1.0 / 52.0)


def _realized(W, k):
    """aynı türden çalışan firmaların işçi başı haftalık gerçekleşen kâr ortalaması (NPC: d['prof'], oyuncu: prof_ema); en az EE_REAL_MIN firma yoksa None."""
    tot = n = 0
    for f, d in W.firms.items():
        if d["kind"] != k or d.get("dead") or not d["workers"]:
            continue
        pr = W.prof_ema.get(f, 0.0) if d.get("owner") is not None else d.get("prof", 0.0)
        tot += pr / len(d["workers"])
        n += 1
    return tot / n if n >= EE_REAL_MIN else None


def _surv_est(W, w, k):
    """sektöre özgü ilk yıl hayatta kalma tahmini: girişimci aynı türden yakın zamanda kurulan oyuncu firmalarının kaderine bakar (gözlenen başarısızlık);
    önsel EE_SURV1 (ağırlık EE_PRIOR_N firma) + son EE_LOOK hafta içinde kurulup en az EE_MIN_AGE hafta yaşamış firmalardan hayatta olanlar (a) ve ölenler (d). Sağ-sansür: genç firmalar sayılmaz."""
    a = d = 0
    firms = W.firms
    for f in W.player_firms:
        x = firms[f]
        if x["kind"] != k:
            continue
        age = w - x.get("born", -999)
        if age < EE_MIN_AGE or age > EE_LOOK:
            continue
        if x.get("dead"):
            d += 1
        else:
            a += 1
    return (EE_SURV1 * EE_PRIOR_N + a) / (EE_PRIOR_N + a + d)


def _heff(h):
    return (1.0 - (1.0 - h) ** EE_PAYBACK) / h if h > 0 else float(EE_PAYBACK)


def ee_expected(W, c, p, n_live, w=0):
    """(ci, p) için beklenen kuruluş getirisi: dict(V, pi, K, hurdle, ratio) ya da None (girdi yok / veri yok)."""
    PRICE, WI = W.PRICE, W.WI
    ci = c["i"]
    k = PRODUCER[p]
    o_, i_ = W.RECIPES[k]
    rate = list(o_.values())[0]
    if rate <= 0:
        return None
    b = getattr(W, "board", None) if SECTOR_BOARD else None
    ncity = len(W.cities)
    if b is not None:
        cl = b["cells"].get((ci, p))
        if cl is None:
            return None
        dem, sold = cl["dem"], cl["prod"]
        pr = b["prod"].get(p)
        sh = pr["short_share"] if pr is not None else 0.0
    else:
        want = W.want_last.get(p, 0.0)
        sh = W.last_short.get(p, 0.0) / want if want > 1e-9 else 0.0
        dem, sold = want / ncity, (want - W.last_short.get(p, 0.0)) / ncity
    unmet = dem * sh                                                       # karşılanmayan talep (hf birim; şehir payı)
    n_riv = n_live.get(k, 0)
    steal = EE_ENTRY_SIZE * sold / max(1, n_riv) if n_riv > 0 else 0.0     # yeni firma rakip başına ortalama satışın EE_ENTRY_SIZE kadarını alır (Dunne-Roberts-Samuelson 1988: yeni girişin ilk boyutu ~ rakip ortalamasının 1/3'ü)
    q_w = rate * CYCLES_PER_WEEK                                           # bir işçinin haftalık çıktısı (birim)
    vol = min(unmet + steal, EE_MAXN * q_w)
    n_w = max(1.0, vol / q_w)
    rev_u = sum(PRICE[(ci, pp)] * qq for pp, qq in o_.items()) / rate * (1 - fee_avg(W))      # birim çıktı başına net gelir
    inp_u = sum(qq * min(PRICE[(j, pp)] + freight(W, j, pp, abs(j - ci)) for j in range(ncity) if W.prod_last.get((j, pp), 0.0) > 1e-9 or j == ci)
                for pp, qq in i_.items() if pp not in ("yazilim", "bilgisayar")) if i_ else 0.0    # birim çıktı başına girdi (reçete girdisi çıktı birimi başına)
    wage_w = TIER_WAGE[0] * WI[ci] * CYCLES_PER_WEEK
    pi = (vol * (rev_u - inp_u) - n_w * wage_w - RENT * CYCLES_PER_WEEK)
    pi = pi * (1 - CORP_TAX) if pi > 0 else pi
    pw = _realized(W, k)                                                   # sektörün gerçekleşen kâr oranı: işçi başı haftalık kâr (rakiplerin kâr EMA'sı); toplam kâr ~0 iken model beklentisini aşağı çeker
    if pw is not None:
        eo_stat_add(W, "ee_real_toplam", pw)
        eo_stat_add(W, "ee_real_adet")
        pi = (1.0 - EE_REAL_W) * pi + EE_REAL_W * pw * n_w * (1 - CORP_TAX if pw > 0 else 1.0)
    wc_c = WORKING_CAPITAL_CYCLES * (TIER_WAGE[0] * WI[ci] + RENT + inp_u * rate)
    K = FOUND_BUF * wc_c + FOUND_HARC
    h = _haz(_surv_est(W, w, k))
    hurdle = FOUND_HARC + K * (LR_NEW(W) + EE_RP) * EE_PAYBACK
    ratio = pi * _heff(h) / hurdle
    return dict(V=vol, pi=pi, K=K, hurdle=hurdle, ratio=ratio)


def _logit(z):
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


def _opts(W, w, c, cands_n):
    """sektör seçenekleri [(çekicilik a, ürün, getiri sözlüğü)] ve haftalık beklenen kuruluş sayısı birikimi."""
    n_live = {}
    for f in c["firms"]:
        d = W.firms[f]
        if not d.get("dead") and d["workers"]:
            n_live[d["kind"]] = n_live.get(d["kind"], 0) + 1
    opts = []
    for p in PRODUCER:
        k = PRODUCER[p]
        if k == "ahir" or PROD_OF.get(k) != p:
            continue
        if not eo_input_ok(W, p):
            continue
        r = ee_expected(W, c, p, n_live, w)
        if r is None:
            continue
        a = _logit((r["ratio"] - 1.0) / EE_TEMP)
        eo_stat_add(W, "ee_oran_toplam", r["ratio"])
        eo_stat_add(W, "ee_oran_adet")
        opts.append((a, p, r))
    return opts


def _draw(W, w, c, opts, n_cands):
    """beklenen kuruluş sayısını biriktirir (kesirli, deterministik) ve sektörleri a^2 ağırlığıyla (tohumlu, ayrı akış) seçer; [(a, p, r)] döner (sektör başına en çok 1)."""
    S = _st(W)
    ci = c["i"]
    if not opts or n_cands <= 0:
        return []
    a_max = max(a for a, _, _ in opts)
    eo_stat_add(W, "ee_amax_toplam", a_max)
    eo_stat_add(W, "ee_amax_adet")
    acc = S.setdefault("acc_ee", {})
    acc[ci] = acc.get(ci, 0.0) + EE_PMAX * a_max * n_cands
    n = min(int(acc[ci]), EE_CAP_CITY)
    if n <= 0:
        return []
    acc[ci] -= n
    rng = random.Random(f"ee|{w}|{ci}" if not RUN_SEED else f"ee|{RUN_SEED}|{w}|{ci}")
    pool = [o for o in opts if o[0] > EE_AMIN]
    out = []
    for _ in range(n):
        if not pool:
            break
        x = rng.random() * sum(a * a for a, _, _ in pool)
        cum = 0.0
        pick = pool[-1]
        for o in pool:
            cum += o[0] * o[0]
            if x <= cum:
                pick = o
                break
        out.append(pick)
        pool.remove(pick)
    return out


def ee_picks(W, w, c, cands):
    """EE_FIN_OLD=1: eski kuruluş yolunun (kurucu harcı kendi birikiminden, lonca kredisi, FOUND_COLLAT teminatı) 'imp' listesini beklenen kâr üretir: [(değer, ürün)]."""
    picks = _draw(W, w, c, _opts(W, w, c, len(cands)), len(cands))
    for a, p, r in picks:
        eo_stat_add(W, "ee_secilen")
        eo_stat_add(W, "ee_secilen_oran_toplam", r["ratio"])
    return [(r["ratio"], p) for a, p, r in picks]


def ee_merge(imp, picks):
    """EE_REPLACE=0: eski sinyal listesi + beklenen-kâr seçimleri (aynı ürün bir kez)."""
    seen = {p for _, p in imp}
    return sorted(list(imp) + [x for x in picks if x[1] not in seen], reverse=True)


def ee_note(W, w, c, fname, kind, founder, loan):
    """eski yolda kurulan firmayı kuruluş kaydına (W.eo) ekler (ölçüm: sağkalım, kadro)."""
    S = _st(W)
    S["firms"].append(fname)
    S["rec"][fname] = dict(born=w, cohort=False, kind=kind, city=c["i"], dead=None, snap={}, loan=round(loan, 2), owner=founder, lonca=W.firms[fname]["lonca"])
    eo_stat_add(W, "ee_kurulan")


def ee_organic(W, w, c, sig):
    """şehir başına beklenen-kâr kuruluşu (eo_organic yerine; EE_FIN_OLD=0: kuruluş fonu/eo_found ile)."""
    cands = _cands(W, c)
    if not cands:
        return
    picks = _draw(W, w, c, _opts(W, w, c, len(cands)), len(cands))
    for k_, (a, p, r) in enumerate(picks):
        if not cands:
            break
        if eo_found(W, w, c, cands[0], PRODUCER[p], key=("ee", w, c["i"], p)):
            cands.pop(0)
            W.LAST_ENTRY[(c["i"], p)] = w
            eo_stat_add(W, "ee_kurulan")
            eo_stat_add(W, "ee_kurulan_oran_toplam", r["ratio"])
        else:
            S = _st(W)
            S["acc_ee"][c["i"]] += len(picks) - k_                       # fon yetmedi: hak ertelenir
            break
