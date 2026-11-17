"""Oyuncu dilinde sektör ve kaynak etiketleri (statik; modelden okunmaz). Anahtar: modelin firma türü (`firms[f]["kind"]`).

Etiketler arayüzde olduğu gibi gösterilir: doğru Türkçe, sayı+sabit ek kalıbı yok.
"""
from __future__ import annotations

SECTOR_LABELS: dict[str, str] = {
    "ahir": "Ahır (süt, deri, et)",
    "arge": "Ar-Ge",
    "belediye": "Belediye",
    "bilgisayar": "Bilgisayar",
    "cam": "Cam",
    "deterjan": "Deterjan",
    "eczane": "Eczane",
    "eglence": "Eğlence",
    "elektronik": "Elektronik bileşen",
    "firin": "Fırın",
    "giyim": "Giyim",
    "guvenlik": "Güvenlik",
    "hastane": "Hastane",
    "ilac": "İlaç",
    "insaat": "İnşaat",
    "kereste": "Kereste",
    "kola": "Kola",
    "kuyumcu": "Kuyumcu",
    "lojistik": "Lojistik",
    "maden_altin": "Altın madeni",
    "maden_aluminyum": "Alüminyum madeni",
    "maden_kimyasal": "Kimyasal madeni",
    "maden_komur": "Kömür madeni",
    "maden_silika": "Silika madeni",
    "market": "Market",
    "medya": "Medya",
    "moda": "Moda",
    "mobilya": "Mobilya",
    "okul": "Okul",
    "otel": "Otel",
    "petrol": "Petrol",
    "plastik": "Plastik",
    "restoran": "Restoran",
    "santral": "Elektrik santrali",
    "sise_sut": "Şişe süt",
    "tarla_bugday": "Buğday tarlası",
    "tarla_pamuk": "Pamuk tarlası",
    "tarla_seker": "Şeker tarlası",
    "tekstil": "Tekstil",
    "ulasim": "Ulaşım",
    "un": "Un değirmeni",
    "universite": "Üniversite",
    "yazilim": "Yazılım",
}

RESOURCE_COAL = "Kömür madeni"
RESOURCE_GOLD = "Altın madeni"


def sector_label(kind: str) -> str:
    return SECTOR_LABELS.get(kind, kind)


def lonca_label(ref: str) -> str:
    """`lonca0` -> `Lonca 1` (kimlik sıfırdan, oyuncu sıralaması birden başlar)."""
    digits = "".join(ch for ch in ref if ch.isdigit())
    return "Lonca %d" % (int(digits) + 1) if digits and ref.startswith("lonca") else ref
