"""Dünya deposu arayüzü, kayıt türü ve girdi doğrulayıcıları. Yalnız stdlib; HTTP yok.

Hata sözleşmesi: doğrulama `HttpError(422, "karar_gecersiz")`, sınır `HttpError(429, "sinir")`; depo kaynaklı
anahtar hataları `KeyError(<kod>)` (`sonuc_var`, `sonuc_yok`, `ad_var`, `dunya_yok`) ve `PermissionError` (oyuncu uyuşmuyor).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Protocol

from ..security import HttpError

AD_MAX = 60
ACIKLAMA_MAX = 280
GORUNEN_AD_MAX = 30
OYUNCU_RE = re.compile(r"[A-Za-z0-9-]{8,64}")
# Çift yönlü metin ve görünmez satır ayırıcılar (görsel taklit): LRE..RLO, LRI..PDI, LRM, RLM, ALM, LS, PS. ZWJ (U+200D) emoji için serbest.
_BIDI = frozenset(chr(c) for c in (*range(0x202A, 0x202F), *range(0x2066, 0x206A), 0x200E, 0x200F, 0x061C, 0x2028, 0x2029))


@dataclass
class Dunya:
    kod: str
    tarif: dict
    model_surumu: str
    ad: str
    aciklama: str
    kurucu: str                # yalnız sunucuda; hiçbir yanıta ya da sayfaya girmez (kurucunun kendi listesi hariç)
    olusturma: float           # epoch saniye
    oynanma: int = 0


class DunyaDeposu(Protocol):
    kalici: bool

    def yayinla(self, tarif: dict, model_surumu: str, ad: str, aciklama: str, kurucu: str) -> str: ...
    def getir(self, kod: str) -> Dunya | None: ...
    def kurucunun(self, kurucu: str) -> list[Dunya]: ...
    def oynandi(self, kod: str) -> None: ...
    def sonuc_yaz(self, kod: str, run_id: str, oyuncu: str, sonuc: dict) -> None: ...
    def ad_yaz(self, run_id: str, oyuncu: str, ad: str) -> None: ...
    def skor(self, kod: str, n: int = 20) -> list[dict]: ...


def _gecersiz(alan: str, neden: str, mesaj: str) -> HttpError:
    return HttpError(422, "karar_gecersiz", mesaj, [{"id": alan, "reason": neden}])


def _temiz_metin(alan: str, s: Any, lo: int, hi: int, mesaj: str) -> str:
    if not isinstance(s, str):
        raise _gecersiz(alan, "invalid", mesaj)
    if not lo <= len(s) <= hi:
        raise _gecersiz(alan, "length", mesaj)
    for ch in s:
        if ch in _BIDI or unicodedata.category(ch) in ("Cc", "Cs") :
            raise _gecersiz(alan, "chars", mesaj)
    if lo and not s.strip():
        raise _gecersiz(alan, "length", mesaj)
    return s


def dogrula_ad(s: Any) -> str:
    return _temiz_metin("ad", s, 1, AD_MAX, "Dünyanın adı 1-60 karakter olmalı.")


def dogrula_aciklama(s: Any) -> str:
    return _temiz_metin("aciklama", s if s is not None else "", 0, ACIKLAMA_MAX, "Açıklama en çok 280 karakter olmalı.")


def dogrula_gorunen_ad(s: Any) -> str:
    return _temiz_metin("ad", s, 1, GORUNEN_AD_MAX, "Görünen ad 1-30 karakter olmalı.")


def dogrula_oyuncu(s: Any) -> str:
    if not isinstance(s, str) or not OYUNCU_RE.fullmatch(s):
        raise _gecersiz("oyuncu", "invalid", "Oyuncu kimliği geçersiz.")
    return s
