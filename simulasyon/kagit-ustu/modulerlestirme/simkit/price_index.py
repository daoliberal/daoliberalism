"""simkit.price_index: sabit Akçe tutarlarının fiyat endeksine bağlanması (INDEX_FIXED; M12 ek (8), sahip sorusu "enflasyon gibi endeksleri hesaplayıp gerekli yerlerde kalibrasyon yaptırıyor muyuz").

AMAÇ: sabit Akçe tutarları (işletme kirası RENT, kuruluş harcı FOUND_HARC, lonca kapanış nakdi, kredi/pay eşikleri, lonca sabit giderleri...) enflasyon ve deflasyonda aynı nominal kalıyordu: fiyat 2-3 kat artınca kira ve harç fiilen eriyor, eşikler gevşiyordu
(gerçek dünyada kira, harç, eşikler fiyatlara endekslenir). INDEX_FIXED=1 iken bu tutarlar kullanım yerinde ix(W, X) = X x fiyat_çarpanı olur; çarpan = sepet fiyat endeksinin (W.series["pidx"], hf1 = 100) son INDEX_WEEKS haftalık ortalaması / 100,
[INDEX_MIN, INDEX_MAX] ile sınırlı. 1. haftada ve INDEX_FIXED=0 iken çarpan 1: ix(W, X) tam X'tir (çıktı bayt bayt aynı).
ARAYÜZ: price_factor, ix
OKUR: W.weekly; params INDEX_*. YAZAR: W._pf (yalnız önbellek). Para hareketi yapmaz.
KATMAN: L0 (yalnız params).
"""
from simkit.params import *          # noqa: F401,F403


def price_factor(W):
    """fiyat çarpanı (endeks / 100): son INDEX_WEEKS haftalık sepet fiyat endeksi ortalaması; haftada bir hesaplanır (önbellek)."""
    if not INDEX_FIXED:
        return 1.0
    wk = W.weekly
    n = len(wk)
    c = getattr(W, "_pf", None)
    if c is not None and c[0] == n:
        return c[1]
    if n == 0:
        v = 1.0
    else:
        h = wk[-INDEX_WEEKS:]
        v = sum(x["series"]["pidx"] for x in h) / len(h) / 100.0
        v = min(INDEX_MAX, max(INDEX_MIN, v))
    W._pf = (n, v)
    return v


def ix(W, x):
    """sabit Akçe tutarı x'in bugünkü fiyat düzeyindeki karşılığı (INDEX_FIXED=0: x aynen)."""
    return x * price_factor(W) if INDEX_FIXED else x
