"""B2: HTTP'siz yönlendirici (tarayıcı çekirdeği). `runs/routes.py` uç noktalarını (`Route`) aynen çağırır; yalnız taşıma yoktur.

Sunucu yolu (`http.Handler._route`) ile aynı eşleme ve hata sözleşmesi: 404 `not_found`, 405 `method_not_allowed` (+`Allow`), `HttpError` -> `{"error": {...}}`,
beklenmeyen hata -> 500 `internal`. `security.check_request` YOK (Origin/Host/başlık denetimi tarayıcıda anlamsız: tek sayfa, aynı çalışma alanı).
Gövde sınırı (64 KB) ve JSON kuralları sunucuyla aynıdır (`http.Request.json`): bu sınıf `Request`e sahte bir işleyici (`_Kabuk`) verir.
"""
from __future__ import annotations

import io
import json
import sys
import traceback
from typing import Any
from urllib.parse import parse_qs, urlsplit

from ..http import Request, Response, Route
from ..security import MAX_BODY, MUTATING, HttpError


class _Kabuk:
    """`http.Request`in beklediği işleyici arayüzü (headers, body_length, rfile, _body_consumed): gövde bellekte."""

    def __init__(self, raw: bytes):
        self._raw = raw
        self.headers = {"Content-Length": str(len(raw))} if raw else {}
        self.rfile = io.BytesIO(raw)
        self._body_consumed = False

    def body_length(self) -> int:
        n = len(self._raw)
        if n > MAX_BODY:
            raise HttpError(413, "body_too_large", "Gövde 64 KB'ı aşıyor.")
        return n


def govde_baytlari(govde: Any) -> bytes:
    if govde is None:
        return b""
    if isinstance(govde, (bytes, bytearray)):
        return bytes(govde)
    if isinstance(govde, str):
        return govde.encode("utf-8")
    return json.dumps(govde, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class Yonlendirici:
    def __init__(self, routes: list[Route]):
        self.routes = list(routes)

    def isle(self, method: str, yol: str, govde: Any = None) -> tuple[int, dict, Any]:
        """(durum, başlıklar, gövde nesnesi). Gövde ham Python nesnesidir (dict/list/None); JSON turu çağıran tarafta."""
        method = method.upper()
        try:
            parts = urlsplit(yol)
            path = parts.path or "/"
            raw = govde_baytlari(govde)
            kabuk = _Kabuk(raw)
            if method in MUTATING:
                kabuk.body_length()                              # 413 gövde okunmadan (sunucu gibi)
            if not (path == "/api" or path.startswith("/api/")):
                raise HttpError(404, "not_found", "Dosya bulunamadı.")
            resp = self._eslestir(method, path[4:] or "/", parts.query, kabuk)
        except HttpError as e:
            hdrs = {"Allow": e.allow} if getattr(e, "allow", None) else {}
            return e.status, hdrs, e.body()
        except Exception:                                        # noqa: BLE001  sunucudaki 500 `internal` ile aynı
            traceback.print_exc(file=sys.stderr)
            return 500, {}, HttpError(500, "internal", "Sunucu hatası.").body()
        return resp.status, dict(resp.headers), resp.body

    def _eslestir(self, method: str, sub: str, query: str, kabuk: _Kabuk) -> Response:
        allowed = []
        for r in self.routes:
            m = r.pattern.fullmatch(sub)
            if not m:
                continue
            if r.method.upper() == method:
                q = {k: v[0] for k, v in parse_qs(query, keep_blank_values=True).items()}
                resp = r.handler(Request(kabuk, method, sub, q, m))
                if resp is None:
                    raise HttpError(500, "internal", "Sunucu hatası.")   # SSE işleyicisi buraya gelmemeli (çekirdek `/events`i kendi işleyicisiyle değiştirir)
                return resp
            allowed.append(r.method.upper())
        if allowed:
            e = HttpError(405, "method_not_allowed", "Bu yöntem desteklenmiyor.")
            e.allow = ", ".join(sorted(set(allowed)))
            raise e
        raise HttpError(404, "not_found", "Böyle bir uç nokta yok.")
