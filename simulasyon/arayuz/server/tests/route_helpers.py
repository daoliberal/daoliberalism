"""A7b test yardımcıları: sahte işçili uygulama, ham SSE okuyucu."""
from __future__ import annotations

import http.client
import json
import threading
import types
from contextlib import contextmanager

from oyun_server import config
from oyun_server.http import make_server
from oyun_server.runs import routes
from oyun_server.runs.manager import RunManager
from oyun_server.testing import FakeHost, InProcWorker

from tests.registry_helpers import real_defaults, real_registry

POST = {"Content-Type": "application/json", "X-Oyun-Istek": "1"}
CONFIG = {"name": "Deneme", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban",
          "durationWeeks": 200, "seedIndex": 0, "values": {}}


def make_cfg(**over):
    ns = types.SimpleNamespace(**{k: getattr(config, k) for k in dir(config) if k.isupper()})
    ns.load_decisions = lambda: {"lookahead": 2, "seam_mode": "frontier", "max_runs": 1}
    ns.load_live_keys = config.load_live_keys
    for k, v in over.items():
        setattr(ns, k, v)
    return ns


@contextmanager
def live_app(ping_s: float = 10.0, cfg=None, port_origins=(), registry=None, depo=None, surum: str = "v-test-1"):
    """(srv, app, workers): gerçek HTTP sunucusu + RunManager (FakeHost, süreç içi işçi) + pacer iş parçacığı.
    `depo` verilirse dünya uç noktaları, `/d/<kod>` sayfası ve DAO bitiş kancası bağlanır (T8b); `surum` = güncel model sürüm dizesi."""
    workers: list[InProcWorker] = []

    def factory(spec):
        w = InProcWorker(spec, host_factory=lambda s: FakeHost("", s.get("overrides", {}), s.get("weeks", 200)))
        workers.append(w)
        return w

    reg = registry or real_registry()
    from oyun_server.dunyalar import uclar
    mgr = RunManager(reg, factory, cfg=cfg or make_cfg(), on_dao_end=uclar.dao_bitti_kancasi(depo) if depo is not None else None)
    app = routes.App(registry=reg, manager=mgr, model_version=str(real_defaults()["VERSION"]),
                     defaults_hash="abc123", ping_s=ping_s, depo=depo, surum=surum)
    srv = make_server(0, routes.make_routes(app), None, set(port_origins), sayfa=uclar.sayfa_isleyici(depo) if depo is not None else None)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    mgr.start_thread()
    try:
        yield srv, app, workers
    finally:
        mgr.shutdown()
        srv.shutdown()
        srv.server_close()
        t.join(2)
        for w in workers:
            w.kill()


def call(srv, method, path, body=None, headers=None):
    """(status, headers, json|None)."""
    h = dict(headers) if headers is not None else (dict(POST) if method in ("POST", "DELETE") else {})
    if method in ("POST", "DELETE") and headers is None:
        h["Origin"] = f"http://127.0.0.1:{srv.port}"
    data = None if body is None else (body if isinstance(body, (bytes, str)) else json.dumps(body))
    c = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=10)
    try:
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        raw = r.read()
        return r.status, {k.lower(): v for k, v in r.getheaders()}, (json.loads(raw) if raw else None)
    finally:
        c.close()


def create_run(srv, config_=None):
    s, _, b = call(srv, "POST", "/api/runs", {"config": config_ or CONFIG})
    assert s == 201, (s, b)
    return b["runId"]


class Stream:
    """Ham SSE okuyucu: (id, olay, veri) ya da ('ping',) üretir."""

    def __init__(self, srv, run_id, headers=None, timeout=10):
        self.c = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=timeout)
        self.c.request("GET", f"/api/runs/{run_id}/events", headers=headers or {})
        self.r = self.c.getresponse()
        self.status = self.r.status

    def items(self):
        eid = ev = None
        data = []
        while True:
            line = self.r.fp.readline()
            if not line:
                return
            line = line.decode("utf-8").rstrip("\n")
            if line.startswith(": ping"):
                yield ("ping",)
            elif line.startswith("id: "):
                eid = int(line[4:])
            elif line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data.append(line[6:])
            elif line == "" and ev is not None:
                yield (eid, ev, json.loads("".join(data)))
                eid = ev = None
                data = []

    def close(self):
        try:
            self.r.close()
        finally:
            self.c.close()
