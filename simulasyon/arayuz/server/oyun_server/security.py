"""Yerel güvenlik: Host/Origin denetimi, değiştiren isteklerde zorunlu başlıklar."""
from __future__ import annotations

from typing import Mapping

MAX_BODY = 64 * 1024
MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class HttpError(Exception):
    def __init__(self, status: int, code: str, message: str = "", fields: list | None = None):
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code
        self.message = message or code
        self.fields = fields or []

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "fields": self.fields}}


def self_hosts(port: int) -> set[str]:
    return {f"127.0.0.1:{port}", f"localhost:{port}"}


def self_origins(port: int) -> set[str]:
    return {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}


def origin_allowed(origin: str | None, allowed_origins, port: int) -> bool:
    return bool(origin) and (origin in self_origins(port) or origin in allowed_origins)


def media_type(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().lower()


def check_request(method: str, path: str, headers: Mapping[str, str], allowed_origins, port: int) -> None:
    """Geçerliyse None döner; aksi halde HttpError."""
    h = {str(k).lower(): v for k, v in headers.items()}
    method = method.upper()
    if h.get("host") not in self_hosts(port):
        raise HttpError(400, "bad_host", "Geçersiz Host başlığı.")
    origin = h.get("origin")
    if origin is not None and not origin_allowed(origin, allowed_origins, port):
        raise HttpError(403, "bad_origin", "Bu kökene izin verilmiyor.")
    if method == "OPTIONS":
        if origin is None:
            raise HttpError(403, "bad_origin", "Ön uçuş için Origin gerekir.")
        return
    if method in MUTATING:
        if origin is None:
            raise HttpError(403, "missing_origin", "Origin başlığı zorunlu.")
        if h.get("x-oyun-istek") != "1":
            raise HttpError(403, "missing_header", "X-Oyun-Istek başlığı zorunlu.")
        if method == "POST" and media_type(h.get("content-type")) != "application/json":
            raise HttpError(415, "unsupported_media", "İçerik türü application/json olmalı.")
