"""Test yardımcıları: rastgele kapıda sunucu, ham istemci."""
from __future__ import annotations

import http.client
import json
import re
import threading
from contextlib import contextmanager
from pathlib import Path

from oyun_server.http import Response, Route, make_server

HEADERS_POST = {"Content-Type": "application/json", "X-Oyun-Istek": "1"}


def echo(req):
    return Response.json({"got": req.json()})


def boom(req):
    raise RuntimeError("test hatasi")


ROUTES = [
    Route("GET", re.compile(r"/hello"), lambda req: Response.json({"ok": True, "live": True, "server_version": "t"})),
    Route("POST", re.compile(r"/echo"), echo),
    Route("GET", re.compile(r"/boom"), boom),
    Route("GET", re.compile(r"/item/(?P<id>[a-z0-9]+)"), lambda req: Response.json({"id": req.params["id"]})),
]


@contextmanager
def running(web_root: Path | None = None, origins=(), routes=None):
    srv = make_server(0, ROUTES if routes is None else routes, web_root, set(origins))
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield srv
    finally:
        srv.shutdown()
        srv.server_close()
        t.join(2)


def request(srv, method, path, headers=None, body=None):
    """(status, headers_dict_lower, body_bytes). `Host` verilmezse http.client kendi ekler."""
    conn = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        r = conn.getresponse()
        data = r.read()
        return r.status, {k.lower(): v for k, v in r.getheaders()}, data
    finally:
        conn.close()


def jbody(data: bytes):
    return json.loads(data.decode("utf-8"))
