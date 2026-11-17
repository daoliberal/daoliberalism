"""ThreadingHTTPServer kabuğu: yönlendirme, güvenlik, JSON hata gövdeleri, statik sunum."""
from __future__ import annotations

import json
import re
import sys
import traceback
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, unquote, urlsplit

from . import config, static
from .security import MAX_BODY, MUTATING, HttpError, origin_allowed, check_request

DRAIN_LIMIT = 1024 * 1024
OYUN_GIRISLERI = frozenset({"/oyun", "/oyun/", "/oyun/index.html"})


@dataclass
class Response:
    status: int = 200
    body: bytes | dict | list | None = None
    content_type: str = "application/json; charset=utf-8"
    headers: dict = field(default_factory=dict)

    @classmethod
    def json(cls, obj, status: int = 200, headers: dict | None = None) -> "Response":
        return cls(status, obj, "application/json; charset=utf-8", headers or {})

    def payload(self) -> bytes:
        if self.body is None:
            return b""
        if isinstance(self.body, (bytes, bytearray)):
            return bytes(self.body)
        return json.dumps(self.body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


@dataclass
class Route:
    method: str
    pattern: re.Pattern  # `/api` önekinden SONRAKİ yola tam eşleşir (ör. r"/runs/(?P<id>[^/]+)")
    handler: Callable[["Request"], "Response | None"]


class Request:
    def __init__(self, handler, method: str, path: str, query: dict, match: re.Match):
        self.handler = handler
        self.method = method
        self.path = path
        self.query = query
        self.params = match.groupdict()
        self.groups = match.groups()
        self.headers = handler.headers

    def json(self) -> dict:
        n = self.handler.body_length()
        self.handler._body_consumed = True
        if n == 0:
            raise HttpError(400, "bad_json", "Gövde boş.")
        raw = self.handler.rfile.read(n)
        try:
            data = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
        except (ValueError, RecursionError):
            raise HttpError(400, "bad_json", "Gövde geçerli JSON değil.")
        if not isinstance(data, dict):
            raise HttpError(400, "bad_json", "Gövde bir JSON nesnesi olmalı.")
        return data


def _reject_constant(name):
    raise ValueError(name)


def is_api(path: str) -> bool:
    return path == "/api" or path.startswith("/api/")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "oyun-server"
    sys_version = ""
    timeout = 60
    _cors_origin = None
    _api = False
    _body_consumed = False

    # --- yardımcılar -------------------------------------------------
    def log_message(self, format, *args):  # noqa: A002
        if getattr(self.server, "verbose", False):
            sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def body_length(self) -> int:
        if "transfer-encoding" in self.headers:
            raise HttpError(411, "length_required", "Content-Length gerekir.")
        raw = self.headers.get("Content-Length")
        if raw is None:
            return 0
        try:
            n = int(raw)
        except ValueError:
            raise HttpError(400, "bad_length", "Geçersiz Content-Length.")
        if n < 0:
            raise HttpError(400, "bad_length", "Geçersiz Content-Length.")
        if n > MAX_BODY:
            raise HttpError(413, "body_too_large", "Gövde 64 KB'ı aşıyor.")
        return n

    def _drain(self) -> None:
        """Okunmamış gövdeyi tüket (keep-alive sağlam kalsın); büyükse bağlantıyı kapat."""
        if self._body_consumed:
            return
        self._body_consumed = True
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except (ValueError, AttributeError):
            n = 0
        if "transfer-encoding" in (self.headers or {}):
            self.close_connection = True
        elif n > DRAIN_LIMIT:
            self.close_connection = True
        elif n > 0:
            try:
                self.rfile.read(n)
            except OSError:
                self.close_connection = True

    def send_common_headers(self) -> None:
        self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self._cors_origin:
            self.send_header("Access-Control-Allow-Origin", self._cors_origin)
        if self._api:
            self.send_header("Cache-Control", "no-store")

    def _send(self, resp: Response, head_only: bool = False) -> None:
        data = resp.payload()
        self.send_response(resp.status)
        self.send_common_headers()
        self.send_header("Content-Type", resp.content_type)
        self.send_header("Content-Length", str(len(data)))
        for k, v in resp.headers.items():
            self.send_header(k, v)
        self.end_headers()
        if not head_only and self.command != "HEAD" and resp.status not in (204, 304):
            self.wfile.write(data)

    def _send_error_obj(self, err: HttpError, headers: dict | None = None) -> None:
        self._send(Response.json(err.body(), err.status, headers))

    _TR = {
        400: "İstek hatalı.", 408: "İstek zaman aşımına uğradı.", 411: "Content-Length gerekir.",
        414: "İstek adresi çok uzun.", 431: "İstek başlıkları çok büyük.", 501: "Bu yöntem desteklenmiyor.",
        505: "HTTP sürümü desteklenmiyor.",
    }

    def send_error(self, code, message=None, explain=None):  # taban sınıfın HTML/İngilizce gövdesi yerine Türkçe JSON
        self.close_connection = True
        try:
            code = int(code)
            self._send_error_obj(HttpError(code, f"http_{code}", self._TR.get(code, "İstek işlenemedi.")))
        except OSError:
            pass

    # --- yöntemler ---------------------------------------------------
    def do_GET(self):
        self._dispatch()

    do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_GET

    def _dispatch(self) -> None:
        self._cors_origin = None
        self._api = False
        self._body_consumed = False
        try:
            self._dispatch_inner()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True

    def _dispatch_inner(self) -> None:
        try:
            parts = urlsplit(self.path)
            path = parts.path or "/"
            self._api = is_api(path)
            srv = self.server
            origin = self.headers.get("Origin")
            if origin_allowed(origin, srv.allowed_origins, srv.port):
                self._cors_origin = origin
            check_request(self.command, path, self.headers, srv.allowed_origins, srv.port)
            if self.command == "OPTIONS":
                self._send(Response(204, None, "text/plain; charset=utf-8", {
                    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, X-Oyun-Istek",
                    "Access-Control-Max-Age": "600",
                }))
                return
            if self.command in MUTATING:
                self.body_length()  # 411/413 erken ve gövde okunmadan
            if self._api:
                self._route(path, parts.query)
            elif path.startswith("/d/") and getattr(srv, "sayfa", None) is not None:
                self._serve_dunya(path[3:])
            else:
                self._serve_static(path, parts.query)
        except HttpError as e:
            self._drain_safely()
            hdrs = {"Allow": e.allow} if getattr(e, "allow", None) else None
            self._send_error_obj(e, hdrs)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            raise
        except Exception:
            traceback.print_exc(file=sys.stderr)
            self._drain_safely()
            try:
                self._send_error_obj(HttpError(500, "internal", "Sunucu hatası."))
            except OSError:
                self.close_connection = True
        else:
            self._drain_safely()

    def _drain_safely(self) -> None:
        try:
            self._drain()
        except Exception:
            self.close_connection = True

    def _route(self, path: str, query: str):
        sub = path[4:] or "/"
        method = "GET" if self.command == "HEAD" else self.command
        allowed = []
        for r in self.server.routes:
            m = r.pattern.fullmatch(sub)
            if not m:
                continue
            if r.method.upper() == method:
                q = {k: v[0] for k, v in parse_qs(query, keep_blank_values=True).items()}
                req = Request(self, self.command, sub, q, m)
                resp = r.handler(req)
                if resp is None:  # işleyici yanıtı kendisi yazdı (SSE)
                    self.close_connection = True
                else:
                    self._send(resp)
                return
            allowed.append(r.method.upper())
        if allowed:
            e = HttpError(405, "method_not_allowed", "Bu yöntem desteklenmiyor.")
            e.allow = ", ".join(sorted(set(allowed)))
            raise e
        raise HttpError(404, "not_found", "Böyle bir uç nokta yok.")

    def _serve_dunya(self, ham_kod: str) -> None:
        """`/d/<kod>` paylaşım sayfası (API dışı, statik sunucudan önce). Tek parça kod; öteki yollar 404 JSON."""
        if self.command not in ("GET", "HEAD"):
            e = HttpError(405, "method_not_allowed", "Bu yöntem desteklenmiyor.")
            e.allow = "GET, HEAD"
            raise e
        if not ham_kod or "/" in ham_kod:
            raise HttpError(404, "not_found", "Dosya bulunamadı.")
        status, html = self.server.sayfa(unquote(ham_kod))
        self._send(Response(status, html.encode("utf-8"), "text/html; charset=utf-8",
                            {"Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'",
                             "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"}))

    def _serve_static(self, path: str, query: str = "") -> None:
        if self.command not in ("GET", "HEAD"):
            e = HttpError(405, "method_not_allowed", "Bu yöntem desteklenmiyor.")
            e.allow = "GET, HEAD"
            raise e
        found = static.lookup(self.server.web_root, path)
        if found is None:
            raise HttpError(404, "not_found", "Dosya bulunamadı.")
        kind, target = found
        if path in OYUN_GIRISLERI and "kaynak" not in parse_qs(query, keep_blank_values=True):
            # Oyun web'i canlı kaynağı yalnız 8765'te ya da ?kaynak=canli ile seçer; başka portta da canlı açılsın.
            hedef = "/oyun/?" + (query + "&" if query else "") + "kaynak=canli"
            self._send(Response(302, None, "text/plain; charset=utf-8",
                                {"Location": hedef, "Cache-Control": "no-store"}))
            return
        if kind == "redirect":
            self._send(Response(301, None, "text/plain; charset=utf-8", {"Location": target}))
            return
        try:
            f = open(target, "rb")
        except OSError:
            raise HttpError(404, "not_found", "Dosya bulunamadı.")
        with f:
            size = Path(target).stat().st_size
            self.send_response(200)
            self.send_common_headers()
            self.send_header("Content-Type", static.mime_for(target))
            self.send_header("Content-Length", str(size))
            self.end_headers()
            if self.command == "GET":
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 32


def make_server(port: int, routes: list, web_root, origins, host: str = config.HOST, sayfa=None) -> ThreadingHTTPServer:
    """`sayfa`: `/d/<kod>` için `kod -> (durum, html)` (dünya paylaşım sayfası); None ise `/d/...` statik sunucuya gider."""
    if host != "127.0.0.1":
        raise ValueError("Sunucu yalnız 127.0.0.1'e bağlanabilir.")
    srv = Server((host, port), Handler)
    srv.port = srv.server_address[1]
    srv.routes = list(routes)
    srv.web_root = Path(web_root) if web_root is not None else None
    srv.allowed_origins = set(origins or ())
    srv.verbose = False
    srv.sayfa = sayfa
    return srv
