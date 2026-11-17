"""Statik dışa aktarımı (apps/web/out) köke bağlar. Yol gezintisine kapalı."""
from __future__ import annotations

import os
from urllib.parse import unquote

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".map": "application/json; charset=utf-8",
}


def mime_for(path: str) -> str:
    return MIME.get(os.path.splitext(path)[1].lower(), "application/octet-stream")


def _inside(root: str, real: str) -> bool:
    return real == root or real.startswith(root + os.sep)


def lookup(web_root, url_path: str):
    """('file', yol) | ('redirect', hedef) | None (404)."""
    if web_root is None:
        return None
    try:
        raw = unquote(url_path, errors="strict")
    except UnicodeDecodeError:
        return None
    if not raw.startswith("/") or "\x00" in raw or "\\" in raw:
        return None
    segs = raw.split("/")
    if any(s == ".." or (s.startswith(".") and s not in ("", ".")) for s in segs):
        return None
    rel = "/".join(s for s in segs if s not in ("", "."))
    root = os.path.realpath(str(web_root))
    real = os.path.realpath(os.path.join(root, rel))
    if not _inside(root, real):
        return None
    if os.path.isdir(real):
        if rel and not raw.endswith("/"):
            idx = os.path.realpath(os.path.join(real, "index.html"))
            return ("redirect", "/" + rel + "/") if _inside(root, idx) and os.path.isfile(idx) else None
        idx = os.path.realpath(os.path.join(real, "index.html"))
        return ("file", idx) if _inside(root, idx) and os.path.isfile(idx) else None
    if os.path.isfile(real):
        return ("file", real)
    return None
