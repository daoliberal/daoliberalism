"""simkit.rate_behav: faize duyarlı hane tasarrufu/harcaması ve kredi talebi (RATE_BEHAV; "Dünyanın insanları" katmanı, oyuncu ayarı DEĞİL).

AMAÇ: tasarruf/harcama ve kredi talebi faizden bağımsızdı (ayar denetimi bulgusu). Bayrak açıkken:
  * hane (gelir katmanına göre) harcama düzeyini gerçek mevduat faizi (mevduat - enflasyon) tarafsız düzeyin üstündeyse kısar, altındaysa artırır
    (EIS, Havranek 2015 / Vissing-Jorgensen 2002 / Best ve ark. 2020); yoksul katman ~0 (elden ağıza, Kaplan-Violante 2014), zengin daha duyarlı;
    servetten harcama payı da hafif duyarlı;
  * firma büyüme/yatırım/Ar-Ge kredisi ve hane ipoteği kredi faizi (gerçek) tarafsızın üstündeyse azalır, altındaysa artar (üst sınır: mevcut tavan/teminat
    kuralları aynen geçerli; talep yalnız o kuralların İÇİNDE ayarlanır).
Faiz değişimi RB_SCALE'e bölünerek gerçek dünya eşdeğerine çevrilir (oyun faizleri gerçeğin ~5-9 katı: oyun ölçeği, params K-158). Sinyal haftalık kısmi uyumla
(RB_ADJ) yumuşatılır; hane harcaması ayrıca alışkanlık bütçesiyle (HAB_UP/DOWN) yumuşar.
ARAYÜZ: rb_state, rb_update, rb_spend_factor, rb_credit_factor, rb_credit_gate, rb_week_row
OKUR: W.weekly, W.dep_slow, W.pol, W.POL_ON; params RB_*. YAZAR: W.rb (yalnız kendi durumu). Para hareketi yapmaz.
KATMAN: L0 (yalnız params).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403


def rb_state(W):
    S = getattr(W, "rb", None)
    if S is None:
        S = W.rb = dict(gap=0.0, lgap=0.0, infl=0.0, dep=0.0, lend=0.0, acc={}, stat=defaultdict(float))
    return S


def _clip(x, lo, hi):
    return max(lo, min(hi, x))


def rb_update(W, w):
    """hafta başında sinyalleri günceller (kısmi uyum): gerçek mevduat faizi sapması ve gerçek kredi faizi sapması (gerçek dünya eşdeğeri, yıllık)."""
    S = rb_state(W)
    if w < RB_START:
        return
    weekly = W.weekly
    if FZ_FIX and w < POL_START2 + RB_INFL_WEEKS:
        infl = POL_INF_TGT2 if POL_TGT2 else POL_INF_TGT      # FZ_FIX (tarafsız faizdeki ti_ ile aynı hedef): pencere açılış sıçramasına (hf < POL_START2) uzanmaz; enflasyon hedefte sayılır
    elif len(weekly) >= 2:
        pidx_now = weekly[-1]["series"]["pidx"]
        past = weekly[-RB_INFL_WEEKS]["series"]["pidx"] if len(weekly) >= RB_INFL_WEEKS else weekly[0]["series"]["pidx"]
        infl = _clip((pidx_now / max(1e-9, past) - 1.0) * (52.0 / min(len(weekly), RB_INFL_WEEKS)), -0.5, 0.5)
    else:
        infl = 0.0
    ref = W.pol[0] if (W.POL_ON and W.pol[0] is not None) else max(0.0, W.dep_slow[0])
    dep = max(0.0, W.dep_slow[0]) * 52.0
    lend = min(LOAN_RATE, max(CX_RATE_MIN, ref + CX_MARGIN)) * 52.0
    ti_ = POL_INF_TGT2 if POL_TGT2 else POL_INF_TGT
    neut_real = POL_NEUT * 52.0 - ti_
    neut_lend = (POL_NEUT + CX_MARGIN) * 52.0 - ti_
    g = _clip(((dep - infl) - neut_real) / RB_SCALE, -RB_GAP_MAX, RB_GAP_MAX)
    lg = _clip(((lend - infl) - neut_lend) / RB_SCALE, -RB_GAP_MAX, RB_GAP_MAX)
    S["gap"] += RB_ADJ * (g - S["gap"])
    S["lgap"] += RB_ADJ * (lg - S["lgap"])
    S["infl"], S["dep"], S["lend"] = infl, dep, lend


def rb_spend_factor(W, cls, wealth_share=0.0):
    """harcama çarpanı: 1 - EIS(katman) x gerçek faiz sapması (gelir kısmı) ve 1 - EIS_servet x sapma (servetten harcama kısmı); [RB_F_MIN, RB_F_MAX]."""
    g = rb_state(W)["gap"]
    e_inc = RB_EIS[min(2, max(0, cls))]
    e_w = RB_EIS_WEALTH[min(2, max(0, cls))]
    f = (1.0 - wealth_share) * (1.0 - e_inc * g) + wealth_share * (1.0 - e_w * g)
    return _clip(f, RB_F_MIN, RB_F_MAX)


def rb_credit_factor(W, semi, hi):
    """kredi talebi çarpanı: 1 - yarı-esneklik x gerçek kredi faizi sapması; [RB_C_MIN, hi]."""
    return _clip(1.0 - semi * rb_state(W)["lgap"], RB_C_MIN, hi)


def rb_credit_gate(W, f, kind):
    """kesikli kredi (kapasite yatırımı, Ar-Ge bütçesi): talep çarpanı kadar sıklıkta çalışır (belirlenimci birikim; çarpan 1 iken her seferinde)."""
    S = rb_state(W)
    k = (f, kind)
    a = S["acc"].get(k, 1.0) + rb_credit_factor(W, RB_LOAN_SEMI_FIRM, 1.0)
    if a >= 1.0 - 1e-9:
        S["acc"][k] = min(a - 1.0, 1.0)
        return True
    S["acc"][k] = a
    S["stat"]["erteleme_" + kind] += 1
    return False


def rb_week_row(W):
    S = rb_state(W)
    return dict(rb_gap=round(S["gap"], 5), rb_lgap=round(S["lgap"], 5), rb_infl=round(S["infl"], 4), rb_dep=round(S["dep"], 4), rb_lend=round(S["lend"], 4),
                rb_harc_f_orta=round(rb_spend_factor(W, 1), 4), rb_kredi_f=round(rb_credit_factor(W, RB_LOAN_SEMI_FIRM, RB_C_MAX_FIRM), 4))
