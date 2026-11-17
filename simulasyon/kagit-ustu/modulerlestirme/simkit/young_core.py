"""simkit.young_core: K-215/K-216 genç firma kiti: düşük katman yardımcıları (yalnız params'a bağlı; kapalıyken hiçbiri çağrılmaz).

AMAÇ: sahip kararları (2026-10-28): kuruluş fonu (şehir kasasından basımsız ayrı hesap), genç firma reçetesi. Bu modül, alt katmanların (credit_core, prices, market) çağırdığı
saf işlevleri ve durum kapsayıcısını tutar; kredi/işe alım/kuruluş mantığı young_kit.py ve credit_core.py'dedir.
ARAYÜZ:
  fund_lo(ci), is_fund_lo(lo)         kuruluş fonu "alacaklı" adı (KFON<i>; havuz hesabı KFON<i>_sermaye); loans[f]["lo"] bu ad olduğunda kredi fondandır
  yk_state(W), yk_add(W, key, v)      durum kapsayıcısı W.yk ve sayaçlar
  yk_young(W, d)                      oyuncu firması ilk YOUNG_WEEKS haftada mı
  yk_rep_seen(W, f, d, base)          K-216 (5): alıcıya görünen itibar (kurucu + lonca karışımı)
  yk_entry_cost(W, d, ucl, vcl)       K-216 (4): giriş fiyatlaması: birim maliyet hedef ölçekteki çıktıya göre (değişken maliyetin altına inmez)
OKUR: W.week_no, W.REP, W.orep, W.people, firma kaydı d["yk"]. YAZAR: W.yk.
KATMAN: L0.
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403


def fund_lo(ci):
    return f"KFON{ci}"


def is_fund_lo(lo):
    return isinstance(lo, str) and lo[:4] == "KFON"


def yk_state(W):
    s = getattr(W, "yk", None)
    if s is None:
        s = W.yk = dict(stat=defaultdict(float), grp=defaultdict(int), hist=[], fund_hist=[], wk=dict(given=0.0, ret=0.0, funded=0.0))
    return s


def yk_add(W, key, v=1.0):
    yk_state(W)["stat"][key] += v


def yk_young(W, d):
    return d.get("owner") is not None and "born" in d and W.week_no - d["born"] < YOUNG_WEEKS


def yk_rep_seen(W, f, d, base):
    """K-216 (5): genç oyuncu firmasının alıcı skorundaki itibarı = max(kurum itibarı, fade x (YK_REP_FW x kurucu itibarı + (1 - YK_REP_FW) x lonca itibarı) + (1 - fade) x kurum itibarı); fade yaşla doğrusal söner."""
    o = d.get("owner")
    if o is None or "born" not in d:
        return base
    age = W.week_no - d["born"]
    if age >= YK_REP_WEEKS or o not in W.people:
        return base
    fade = 1.0 - age / YK_REP_WEEKS
    mix = YK_REP_FW * W.REP[o] + (1.0 - YK_REP_FW) * W.orep.get(d["lonca"], 50.0)
    return max(base, fade * mix + (1.0 - fade) * base)


def yk_entry_cost(W, d, ucl, vcl):
    """K-216 (4): ilk YK_ENTRY_WEEKS haftada birim maliyet = değişken kısım (vcl, değişmez) + sabit kısım (ucl - vcl) x (kadro / hedef kadro): sabit giderler hedef ölçekteki çıktıya bölünür.
    Hedef kadro d["yk"]["tgt"] (asgari etkin ölçek ve talebe bağlı hedef). Kadro hedefteyse ya da firma genç değilse değişmez; sonuç hiçbir zaman vcl'nin altına inmez."""
    st = d.get("yk")
    if st is None or d.get("owner") is None or "born" not in d or W.week_no - d["born"] >= YK_ENTRY_WEEKS:
        return ucl
    n = len(d["workers"])
    tgt = st["tgt"]
    if n <= 0 or tgt <= n:
        return ucl
    return vcl + max(0.0, ucl - vcl) * (n / tgt)
