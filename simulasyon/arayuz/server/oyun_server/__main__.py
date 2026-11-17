"""Giriş: `PYTHONPATH=<SERVER_ROOT> python3 -P -m oyun_server [--port] [--web DIR] [--origin URL]... [--dev] [--host-kind model|fake]`."""
from __future__ import annotations

import argparse
import os
import re
import signal
import sys
import threading
import time
from pathlib import Path

from . import __version__, config
from .http import Request, Response, Route, make_server

ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9.\-]+(:\d{1,5})?$")

# Kapanışta çağrılacak işlevler (A7b: main RunManager.shutdown'ı ekler).
shutdown_hooks: list = []
HOOK_TIMEOUT_S = 5.0


def run_hooks(hooks, timeout: float = HOOK_TIMEOUT_S) -> None:
    """Her kanca ayrı arka plan iş parçacığında, en çok `timeout` sn beklenir."""
    for hook in list(hooks):
        err = []

        def call(h=hook):
            try:
                h()
            except Exception as e:
                err.append(e)

        t = threading.Thread(target=call, name="shutdown-hook", daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive():
            print(f"oyun_server: kapanış işlevi zaman aşımı ({timeout:g} sn), atlandı.", file=sys.stderr)
        elif err:
            print(f"oyun_server: kapanış işlevi hatası: {err[0]}", file=sys.stderr)


def start_url(port: int) -> str:
    """Açılış adresi. Varsayılan kapıda (8765) arayüz sunucuyu kendiliğinden bulur; başka kapıda `?kaynak=canli` aynı kökeni yoklatır."""
    base = f"http://{config.HOST}:{port}/oyun/"
    return base if port == config.PORT else base + "?kaynak=canli"


def hello(req: Request) -> Response:
    return Response.json({"ok": True, "server_version": __version__, "live": True})


def build_routes(app=None) -> list:
    """`app` (runs.routes.App) yoksa yalnız temel /hello (A2); varsa §2.3'ün bütün uç noktaları (A7b)."""
    if app is None:
        return [Route("GET", re.compile(r"/hello"), hello)]
    from .runs import routes
    return routes.make_routes(app)


def _fail(msg: str, code: int = 1):
    print(f"oyun_server: {msg}", file=sys.stderr)
    raise SystemExit(code)


def parse_args(argv):
    p = argparse.ArgumentParser(prog="oyun_server", description="daoliberalism canlı model sunucusu (yalnız yerel).")
    p.add_argument("--port", type=int, default=config.PORT)
    p.add_argument("--host", default=config.HOST, help="Yalnız 127.0.0.1 kabul edilir.")
    p.add_argument("--web", default=str(config.REPO_ROOT / "apps" / "web" / "out"), help="Statik dışa aktarım dizini.")
    p.add_argument("--origin", action="append", default=[], help="Ek izinli köken (örn. http://localhost:3201).")
    p.add_argument("--dev", action="store_true", help="http://localhost:3000 ve 127.0.0.1:3000 kökenlerine izin ver.")
    p.add_argument("--runs-dir", default=None, help="Koşuların diske yazıldığı dizin (varsayılan OYUN_RUNS_DIR ya da simulasyon/arayuz/kosular).")
    p.add_argument("--host-kind", choices=("model", "fake"), default=os.environ.get("OYUN_HOST") or "model")
    return p.parse_args(argv)


def main(argv=None) -> int:
    try:
        args = parse_args(argv)
    except SystemExit as e:
        return int(e.code or 0)
    if args.host != config.HOST:
        _fail(f"yalnız {config.HOST} adresine bağlanılabilir (istenen: {args.host}).", 2)
    if args.host_kind not in ("model", "fake"):
        _fail("--host-kind yalnız model ya da fake olabilir.", 2)
    if not 0 <= args.port <= 65535:
        _fail("geçersiz kapı numarası.", 2)
    origins = set(config.DEFAULT_ORIGINS) if args.dev else set()
    for o in args.origin:
        o = o.rstrip("/")
        if not ORIGIN_RE.match(o):
            _fail(f"geçersiz köken: {o} (örnek: http://localhost:3201).", 2)
        origins.add(o)
    os.environ["OYUN_HOST"] = args.host_kind
    if args.host_kind == "model" and not (config.MODEL_ROOT / "simbuild.py").is_file():
        _fail(f"model dizini bulunamadı: {config.MODEL_ROOT}\n"
              "OYUN_MODEL_ROOT ortam değişkeni ile doğru dizini verin ya da --host-kind fake kullanın.")
    web = Path(args.web)
    if not web.is_dir():
        print(f"uyarı: statik dizin yok ({web}); önce `pnpm --filter web build` çalıştırın. Yalnız /api sunulacak.",
              file=sys.stderr)
        web = None
    from .runs import routes
    from .sim.client import WorkerClient
    if os.environ.get("OYUN_DB"):
        _fail("OYUN_DB tanımlı ama kalıcı dünya deposu bu sürümde yok; değişkeni kaldırın (dünyalar bellekte tutulur).")
    from .dunyalar import uclar
    from .dunyalar.bellek import BellekDepo
    depo = BellekDepo()                       # OYUN_DB yoksa: sunucu yeniden başlarsa yayınlanan dünyalar silinir (`kalici = False`)
    try:
        app = routes.create_app(WorkerClient.spawn, runs_dir=args.runs_dir, depo=depo)
    except Exception as e:  # model varsayılanları / kayıt okunamadı
        _fail(f"kayıt ya da model varsayılanları yüklenemedi: {e}")
    routes.register_shutdown(app, shutdown_hooks)
    try:
        server = make_server(args.port, build_routes(app), web, origins, sayfa=uclar.sayfa_isleyici(depo))
    except OSError as e:
        if app.jobs is not None:
            app.jobs.shutdown()
        app.manager.shutdown()
        _fail(f"{config.HOST}:{args.port} dinlenemedi ({e.strerror or e}). Başka bir süreç kullanıyor olabilir.")
    # İmza işleyicisi yalnız düz sayaç artırır (kilit/Event yok); ikinci sinyal anında çıkar.
    sig_count = [0]

    def on_signal(signum, _frame):
        sig_count[0] += 1
        if sig_count[0] >= 2:
            os._exit(128 + signum)

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    thread = threading.Thread(target=server.serve_forever, name="http", daemon=True)
    thread.start()
    print(f"oyun sunucusu: {start_url(server.port)}", flush=True)
    while not sig_count[0]:
        time.sleep(0.1)
    run_hooks(shutdown_hooks, HOOK_TIMEOUT_S)
    server.shutdown()
    server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
