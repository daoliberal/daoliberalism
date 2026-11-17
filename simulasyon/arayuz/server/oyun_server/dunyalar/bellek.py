"""Bellek deposu: süreç yeniden başlarsa silinir (`kalici = False`). Sunucu çok iş parçacıklı: tek kilit."""
from __future__ import annotations

import copy
import dataclasses
import math
import threading
import time
from typing import Callable

from ..security import HttpError
from .depo import Dunya, dogrula_aciklama, dogrula_ad, dogrula_gorunen_ad, dogrula_oyuncu
from .kod import yeni_kod

MAX_DUNYA = 1000
MAX_KURUCU = 20
SONUC_ANAHTARLARI = frozenset({"dilim", "servet", "unvan", "isletme"})


def _say(x) -> bool:
    return type(x) is int


def dogrula_sonuc(sonuc) -> dict:
    """`sonuc_yaz` girdisi: tam olarak {dilim:int>=0, servet:sonlu sayı, unvan:dizge 1-40, isletme:int>=0}. Aksi `ValueError("sonuc_gecersiz")`."""
    if not isinstance(sonuc, dict) or set(sonuc) != SONUC_ANAHTARLARI:
        raise ValueError("sonuc_gecersiz")
    s = sonuc
    sayi = type(s["servet"]) in (int, float) and math.isfinite(s["servet"])
    if not (_say(s["dilim"]) and s["dilim"] >= 0 and sayi and isinstance(s["unvan"], str) and 1 <= len(s["unvan"]) <= 40
            and _say(s["isletme"]) and s["isletme"] >= 0):
        raise ValueError("sonuc_gecersiz")
    return {"dilim": s["dilim"], "servet": s["servet"], "unvan": s["unvan"], "isletme": s["isletme"]}


def _kopya(d: Dunya) -> Dunya:
    return dataclasses.replace(d, tarif=copy.deepcopy(d.tarif))


class BellekDepo:
    kalici = False

    def __init__(self, saat: Callable[[], float] = time.time):
        self._lock = threading.Lock()
        self._saat = saat
        self._dunyalar: dict[str, Dunya] = {}
        self._sonuclar: dict[str, dict] = {}      # run_id -> {kod, oyuncu, sonuc, ad}
        self._kod_uret = yeni_kod

    def yayinla(self, tarif: dict, model_surumu: str, ad: str, aciklama: str, kurucu: str) -> str:
        ad = dogrula_ad(ad)
        aciklama = dogrula_aciklama(aciklama)
        kurucu = dogrula_oyuncu(kurucu)
        with self._lock:
            if len(self._dunyalar) >= MAX_DUNYA or sum(1 for d in self._dunyalar.values() if d.kurucu == kurucu) >= MAX_KURUCU:
                raise HttpError(429, "sinir", "Yayınlanabilecek dünya sınırına ulaşıldı.")
            kod = self._kod_uret(self._dunyalar.__contains__)
            self._dunyalar[kod] = Dunya(kod, copy.deepcopy(tarif), model_surumu, ad, aciklama, kurucu, self._saat(), 0)
            return kod

    def getir(self, kod: str) -> Dunya | None:
        with self._lock:
            d = self._dunyalar.get(kod)
            return _kopya(d) if d else None

    def kurucunun(self, kurucu: str) -> list[Dunya]:
        with self._lock:
            return sorted((_kopya(d) for d in self._dunyalar.values() if d.kurucu == kurucu),
                          key=lambda d: d.olusturma, reverse=True)

    def oynandi(self, kod: str) -> None:
        with self._lock:
            d = self._dunyalar.get(kod)
            if d:
                d.oynanma += 1

    def sonuc_yaz(self, kod: str, run_id: str, oyuncu: str, sonuc: dict) -> None:
        sonuc = dogrula_sonuc(sonuc)
        with self._lock:
            if kod not in self._dunyalar:
                raise KeyError("dunya_yok")
            if run_id in self._sonuclar:
                raise KeyError("sonuc_var")
            self._sonuclar[run_id] = {"kod": kod, "oyuncu": oyuncu, "sonuc": sonuc, "ad": None}

    def ad_yaz(self, run_id: str, oyuncu: str, ad: str) -> None:
        ad = dogrula_gorunen_ad(ad)
        with self._lock:
            r = self._sonuclar.get(run_id)
            if r is None:
                raise KeyError("sonuc_yok")
            if r["oyuncu"] != oyuncu:
                raise PermissionError("oyuncu_uyusmuyor")
            if r["ad"] is not None:
                raise KeyError("ad_var")
            r["ad"] = ad

    def skor(self, kod: str, n: int = 20) -> list[dict]:
        """Satır: `{ad (yoksa None), dilim, unvan, isletme, servet}`. Oyuncu ve koşu kimliği çıkmaz.
        Sıra: `dilim` azalan, sonra `servet` azalan; en çok 20."""
        n = max(0, min(int(n), 20))
        with self._lock:
            rows = [r for r in self._sonuclar.values() if r["kod"] == kod]
        rows.sort(key=lambda r: (-r["sonuc"]["dilim"], -r["sonuc"]["servet"]))
        return [{"ad": r["ad"], "dilim": r["sonuc"]["dilim"], "unvan": r["sonuc"]["unvan"],
                 "isletme": r["sonuc"]["isletme"], "servet": r["sonuc"]["servet"]} for r in rows[:n]]
