"""simkit.tech_core: teknoloji çarpanları (tech_f, sw_mult, prod_mult).

ARAYÜZ: tech_f, prod_mult, sw_mult
OKUR: params.PUB, HW_STATE, SW_STATE. YAZAR: yok.
KATMAN: L0.
"""
from simkit.params import *          # noqa: F401,F403


def tech_f(b, k):
    """K-134: Ar-Ge verimi: çalışan başına çıktı çarpanı (azalan getiri)."""
    return 1.0 + ARGE_COEF[b] * k ** 0.5


def prod_mult(W, d):
    """K-148: firmanın çalışanlarının ortalama tecrübe verimi (ahır sürü bakımı hariç)."""
    m = sw_mult(W, d) * (d.get("skill", 1.0) if d["kind"] != "ahir" else 1.0)
    if d.get("innov_owner"):
        m *= 1.0 + INNOV_FIRM_GAIN                  # K-170: inovatör firma sahibi
    if d.get("mgr_mult"):
        m *= d["mgr_mult"]                          # K-170: yönetici ve uzman verimi
    if QL_ACT:
        m *= QG_RATE[d.get("grade", 1)]             # K-183.4: ucuz strateji daha hızlı/özensiz, pahalı strateji daha yavaş/özenli
    if "capf" in d:
        m *= d["capf"]                              # K-185.7: sermaye ile desteklenen çalışan payı
    if "hf" in d:
        m *= d["hf"]                                # K-185.12: hasta çalışan verim kaybı
    if "ef" in d:
        m *= d["ef"]                                # K-185.12: öğrenci çalışan fırsat maliyeti
    return m


def sw_mult(W, d):
    """K-136: yazılım aboneliği olan firmada çalışan başına çıktı artışı (geçen döngüdeki koltuk bulunurluğu kadar)."""
    HW_STATE = W.HW_STATE
    PUB = W.PUB
    SW_STATE = W.SW_STATE
    if not SW_STATE["on"] or d["kind"] in ("ahir", "yazilim"):
        return 1.0
    return 1.0 + SW_GAIN * tech_f("bilisim", PUB.get("bilisim", 0.0)) * d.get("sw", 0.0) * (d.get("pc", 1.0) if HW_STATE["on"] else 1.0)     # K-142: yazılım bilgisayarsız çalışmaz
