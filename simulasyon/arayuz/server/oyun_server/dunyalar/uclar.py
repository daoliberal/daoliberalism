"""Dünya yayınlama HTTP bağı (T8b): `/api/dunyalar...` rotaları, `/api/runs/{id}/dao/ad`, `/d/<kod>` sayfa işleyicisi ve DAO bitiş kancası.
İş mantığı `routes.py` (saf) ve depodadır; burada yalnız istek çözme, koşu kurma ve tel biçimi."""
from __future__ import annotations

import re
from typing import Callable

from ..http import Request, Response, Route
from ..security import HttpError
from . import routes, sayfa, tarif as tarif_mod
from .depo import dogrula_oyuncu
from .kod import normalize_kod

DAO_HAFTA = 520              # K-231: oyun süresi tarifin süresinden bağımsızdır


def dao_sonucu(dao_sonuc: dict) -> dict:
    """`daoSonuc` (son gözlem) -> depo sonucu: son servet dilimi, unvan, ayakta işletme sayısı, servet (nakit + mevduat)."""
    ben = dao_sonuc["ben"]
    firmalar = (dao_sonuc.get("gecmis") or {}).get("firmalar") or []
    return {"dilim": ben["servet_dilimi"], "unvan": ben["unvan"],
            "isletme": sum(1 for f in firmalar if f.get("ayakta")),
            "servet": round(float(ben["nakit"]) + float(ben["mevduat"]["tutar"]), 2)}


def dao_bitti_kancasi(depo) -> Callable[[str, dict | None, dict], None]:
    """`RunManager(on_dao_end=...)`: dünyadan kurulmuş koşunun sonucunu sunucuda hesaplayıp yazar (kilit dışında çağrılır).
    Bağsız koşu ya da sonuçsuz bitiş yok sayılır; aynı koşunun ikinci yazımı (`sonuc_var`) sessizce atlanır."""
    def kanca(run_id: str, dao_sonuc: dict | None, meta: dict) -> None:
        kod, oyuncu = meta.get("dunyaKodu"), meta.get("oyuncu")
        if kod is None or oyuncu is None or not isinstance(dao_sonuc, dict):
            return
        try:
            depo.sonuc_yaz(kod, run_id, oyuncu, dao_sonucu(dao_sonuc))
        except KeyError as e:
            if e.args and e.args[0] in ("sonuc_var", "dunya_yok"):
                return
            raise
    return kanca


def sayfa_isleyici(depo) -> Callable[[str], tuple[int, str]]:
    """`/d/<kod>` için `(durum, html)`; kod normalize edilir, bilinmeyen kod 404 HTML."""
    def isle(ham_kod: str) -> tuple[int, str]:
        k = normalize_kod(ham_kod)
        d = depo.getir(k) if k else None
        if d is None:
            return 404, sayfa.bulunamadi_sayfasi()
        return 200, sayfa.dunya_sayfasi(d)
    return isle


def make_routes(app) -> list[Route]:
    mgr, reg = app.manager, app.registry
    depo = app.depo

    def yayinla(req: Request) -> Response:
        st, yuk = routes.yayinla(depo, req.json(), reg, app.surum, mgr.live_keys)
        return Response.json(yuk, st)

    def liste(req: Request) -> Response:
        st, yuk = routes.kurucunun(depo, req.query.get("kurucu"))
        return Response.json(yuk, st)

    def getir(req: Request) -> Response:
        st, yuk = routes.getir(depo, req.params["kod"], app.surum)
        return Response.json(yuk, st)

    def skor(req: Request) -> Response:
        st, yuk = routes.skor(depo, req.params["kod"])
        return Response.json(yuk, st)

    def oyna(req: Request) -> Response:
        body = req.json()
        d = routes.dunya_bul(depo, req.params["kod"])
        oyuncu = dogrula_oyuncu(body.get("oyuncu"))
        if d.model_surumu != app.surum:
            raise HttpError(409, "eski_surum", "Bu dünya oyunun eski bir sürümüyle kuruldu; şimdilik oynanamıyor.")
        kosu = tarif_mod.tariften_kosu(d.tarif, d.ad, [], DAO_HAFTA)       # 520 hafta; tarif yayın anında kendi süresiyle doğrulandı
        kosu["config"]["mode"] = "dao"
        from ..registry.schema import RunConfigError
        from ..runs.manager import BusyPreparing, TooManyRuns
        try:
            handle = mgr.create(kosu["config"], kosu["schedule"], dunya=(d.kod, oyuncu))
        except RunConfigError as e:
            raise HttpError(422, "invalid_config", "Koşu ayarları geçersiz.", [{"id": x.id, "reason": x.reason} for x in e.errors])
        except BusyPreparing:
            raise HttpError(409, "busy_preparing", "Başka bir koşu hazırlanıyor; bitmesini bekleyin.")
        except TooManyRuns:
            raise HttpError(429, "too_many_runs", "Açık koşu sınırına ulaşıldı; bir koşuyu kapatın.")
        depo.oynandi(d.kod)
        return Response.json({"runId": handle["runId"]}, 201)

    def ad(req: Request) -> Response:
        st, yuk = routes.ad_yaz(depo, req.params["id"], req.json())
        return Response.json(yuk, st)

    kod, rid = r"(?P<kod>[^/]+)", r"(?P<id>[^/]+)"
    return [
        Route("POST", re.compile(r"/dunyalar"), yayinla),
        Route("GET", re.compile(r"/dunyalar"), liste),
        Route("GET", re.compile(rf"/dunyalar/{kod}"), getir),
        Route("POST", re.compile(rf"/dunyalar/{kod}/oyna"), oyna),
        Route("GET", re.compile(rf"/dunyalar/{kod}/skor"), skor),
        Route("POST", re.compile(rf"/runs/{rid}/dao/ad"), ad),
    ]
