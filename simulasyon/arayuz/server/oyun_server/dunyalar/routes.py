"""Saf işleyiciler: `(depo, ...) -> (durum, yük)`. Kayıt (route) yok; 8b bunları HTTP'ye bağlar. Hatalar `HttpError` olarak yükselir."""
from __future__ import annotations

from typing import Any

from ..security import HttpError
from . import tarif as tarif_mod
from .depo import Dunya, DunyaDeposu, dogrula_gorunen_ad, dogrula_oyuncu
from .kod import normalize_kod


def _yok() -> HttpError:
    return HttpError(404, "dunya_yok", "Bu kodla bir dünya bulunamadı.")


def _govde(d: Any) -> dict:
    if not isinstance(d, dict):
        raise HttpError(400, "bad_request", "Gövde bir nesne olmalı.")
    return d


def dunya_bul(depo: DunyaDeposu, ham_kod: Any) -> Dunya:
    k = normalize_kod(ham_kod)
    d = depo.getir(k) if k else None
    if d is None:
        raise _yok()
    return d


def yayinla(depo: DunyaDeposu, body: Any, reg: Any, model_surumu: str, live_keys: Any = None) -> tuple[int, dict]:
    b = _govde(body)
    oyuncu = dogrula_oyuncu(b.get("oyuncu"))
    t = tarif_mod.dogrula(reg, b.get("tarif"), live_keys)
    kod = depo.yayinla(t, model_surumu, b.get("ad"), b.get("aciklama", ""), oyuncu)
    return 201, {"kod": kod, "baglanti": "/d/" + kod}


def getir(depo: DunyaDeposu, ham_kod: Any, guncel_surum: str) -> tuple[int, dict]:
    d = dunya_bul(depo, ham_kod)
    return 200, {"kod": d.kod, "ad": d.ad, "aciklama": d.aciklama, "tarif": d.tarif, "modelSurumu": d.model_surumu,
                 "oynanma": d.oynanma, "guncelSurum": guncel_surum}


def kurucunun(depo: DunyaDeposu, kurucu: Any) -> tuple[int, list]:
    return 200, [{"kod": d.kod, "ad": d.ad, "aciklama": d.aciklama, "oynanma": d.oynanma, "olusturma": d.olusturma,
                  "baglanti": "/d/" + d.kod} for d in depo.kurucunun(dogrula_oyuncu(kurucu))]


def skor(depo: DunyaDeposu, ham_kod: Any) -> tuple[int, list]:
    return 200, depo.skor(dunya_bul(depo, ham_kod).kod, 20)


def ad_yaz(depo: DunyaDeposu, run_id: str, body: Any) -> tuple[int, dict]:
    b = _govde(body)
    oyuncu = dogrula_oyuncu(b.get("oyuncu"))
    ad = dogrula_gorunen_ad(b.get("ad"))
    try:
        depo.ad_yaz(run_id, oyuncu, ad)
    except PermissionError:
        raise HttpError(403, "oyuncu_uyusmuyor", "Bu koşu başka bir oyuncuya ait.")
    except KeyError as e:
        kod = e.args[0] if e.args else ""
        if kod == "ad_var":
            raise HttpError(409, "ad_var", "Bu koşu için ad zaten yazıldı.")
        raise HttpError(409, "sonuc_yok", "Bu koşunun skor kaydı yok.")
    return 200, {"ok": True}
