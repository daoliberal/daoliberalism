import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from oyun_server import __main__ as cli
from oyun_server import config, sse
from oyun_server.http import Response, Route

from tests.helpers import ROUTES, jbody, request, running

SERVER_ROOT = Path(__file__).resolve().parent.parent


ADDR_RE = re.compile(r"http://127\.0\.0\.1:(\d+)/oyun/")
CAP = 30.0          # cömert üst sınır: davranış nedenle (rc, metin) doğrulanır, duvar saatiyle değil


def launch(extra=(), script=None, stderr=subprocess.PIPE, env=None, ready_timeout=30.0):
    """Sunucuyu `--port 0` ile başlatır, basılan URL'den kapıyı okur (bırak-sonra-bağla yarışı yok). (proc, port)."""
    import select
    args = ["--port", "0", "--host-kind", "fake", "--web", tempfile.gettempdir(), *extra]
    cmd = [sys.executable, "-P", "-c", script, *args] if script else [sys.executable, "-P", "-m", "oyun_server", *args]
    proc = subprocess.Popen(cmd, cwd=tempfile.gettempdir(), env=env or cli_env(), stdout=subprocess.PIPE,
                            stderr=stderr, text=True)
    end = time.monotonic() + ready_timeout
    while time.monotonic() < end:
        if select.select([proc.stdout], [], [], 0.2)[0]:
            line = proc.stdout.readline()
            m = ADDR_RE.search(line)
            if m:
                return proc, int(m.group(1))
            if not line:
                break
    proc.kill()
    proc.wait(5)
    raise AssertionError("sunucu başlamadı (URL satırı gelmedi)")


def cli_env(**extra):
    env = dict(os.environ, PYTHONPATH=str(SERVER_ROOT), PYTHONHASHSEED="0", PYTHONDONTWRITEBYTECODE="1")
    env.update(extra)
    return env


class Hello(unittest.TestCase):
    def test_hello_shape(self):
        routes = cli.build_routes()
        with running(routes=routes) as srv:
            s, h, b = request(srv, "GET", "/api/hello")
            self.assertEqual(s, 200)
            d = jbody(b)
            self.assertIs(d["ok"], True)
            self.assertIs(d["live"], True)
            self.assertIsInstance(d["server_version"], str)
            self.assertEqual(h["cache-control"], "no-store")

    def test_config_values(self):
        self.assertEqual((config.HOST, config.PORT), ("127.0.0.1", 8765))
        self.assertEqual(config.LIVE_WEEK_MS, {1: 2000, 4: 500, 16: 0})
        self.assertEqual((config.LOOKAHEAD, config.MAX_RUNS, config.IDLE_PAUSE_S), (2, 3, 15))
        self.assertNotIn("http://localhost:3201", config.DEFAULT_ORIGINS)
        self.assertTrue((config.SERVER_ROOT / "oyun_server").is_dir())
        self.assertEqual(config.load_decisions()["max_runs"], 3)

    def test_child_env_whitelist(self):
        old = os.environ.get("SECRET_TOKEN")
        os.environ["SECRET_TOKEN"] = "x"
        os.environ["PYTHONPATH"] = "/baska"
        try:
            env = config.child_env({"FOO": 1, "PYTHONPATH": "/yok"})
        finally:
            os.environ.pop("SECRET_TOKEN", None) if old is None else os.environ.__setitem__("SECRET_TOKEN", old)
            os.environ.pop("PYTHONPATH")
        self.assertNotIn("SECRET_TOKEN", env)
        self.assertEqual(env["PYTHONPATH"], str(config.SERVER_ROOT))
        self.assertEqual(env["FOO"], "1")
        self.assertIn("OYUN_MODEL_ROOT", env)


class SseTests(unittest.TestCase):
    def test_stream_events_and_ping(self):
        seen = {}

        def events(ping_s):
            seen["ping_s"] = ping_s
            yield (1, "state", {"a": 1})
            yield None
            yield (2, "week", {"w": 2})

        def handler(req):
            sse.stream(req.handler, events, ping_s=0.05)

        routes = [Route("GET", re.compile(r"/sse"), handler)]
        with running(routes=routes) as srv:
            s, h, b = request(srv, "GET", "/api/sse")
        self.assertEqual(s, 200)
        self.assertTrue(h["content-type"].startswith("text/event-stream"))
        self.assertEqual(h["cache-control"], "no-store")
        text = b.decode()
        self.assertIn('id: 1\nevent: state\ndata: {"a":1}\n\n', text)
        self.assertIn(": ping\n\n", text)
        self.assertIn('id: 2\nevent: week\ndata: {"w":2}\n\n', text)
        self.assertEqual(seen["ping_s"], 0.05)

    def test_single_cache_control_header_raw(self):
        import http.client
        routes = [Route("GET", re.compile(r"/sse"), lambda req: sse.stream(req.handler, iter([(1, "state", {})])))]
        with running(routes=routes) as srv:
            c = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=5)
            c.request("GET", "/api/sse")
            r = c.getresponse()
            self.assertEqual(len(r.msg.get_all("Cache-Control")), 1)
            r.read()
            c.close()

    def test_generator_exception_ends_stream_cleanly(self):
        def events(ping_s):
            yield (1, "state", {"a": 1})
            raise RuntimeError("uretici coktu")

        routes = [Route("GET", re.compile(r"/sse"), lambda req: sse.stream(req.handler, events))]
        import contextlib, io
        err = io.StringIO()
        with running(routes=routes) as srv, contextlib.redirect_stderr(err):
            s, h, b = request(srv, "GET", "/api/sse")
            self.assertEqual(s, 200)
            self.assertIn(b"event: state", b)
            self.assertNotIn(b'"error"', b)
            self.assertEqual(request(srv, "GET", "/api/yok")[0], 404)  # sunucu ayakta
        self.assertIn("uretici coktu", err.getvalue())

    def test_client_disconnect_ends_stream(self):
        import http.client
        import threading
        closed = threading.Event()

        def events(ping_s):
            try:
                i = 0
                while True:
                    i += 1
                    time.sleep(0.02)
                    yield (i, "week", {"pad": "x" * 2000})
            finally:
                closed.set()

        routes = [Route("GET", re.compile(r"/sse"), lambda req: sse.stream(req.handler, events))]
        with running(routes=routes) as srv:
            c = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=5)
            c.request("GET", "/api/sse")
            r = c.getresponse()
            r.fp.readline()
            r.close()
            c.close()
            self.assertTrue(closed.wait(CAP))


class Cli(unittest.TestCase):
    def run_cli(self, *args, **env):
        return subprocess.run([sys.executable, "-P", "-m", "oyun_server", *args], cwd=tempfile.gettempdir(),
                              env=cli_env(**env), capture_output=True, text=True, timeout=20)

    def test_cli_refuses_non_loopback(self):
        p = self.run_cli("--host", "0.0.0.0", "--port", "0", "--host-kind", "fake")
        self.assertEqual(p.returncode, 2)
        self.assertIn("127.0.0.1", p.stderr)

    def test_cli_missing_model_root(self):
        p = self.run_cli("--port", "0", "--host-kind", "model", OYUN_MODEL_ROOT="/yok/model/dizini")
        self.assertEqual(p.returncode, 1)
        self.assertIn("model dizini bulunamadı", p.stderr)

    def test_cli_bad_origin(self):
        p = self.run_cli("--origin", "http://localhost:3201/yol", "--host-kind", "fake")
        self.assertEqual(p.returncode, 2)

    def test_cli_missing_web_warns(self):
        proc, port = launch(["--web", "/yok/out"])             # sonraki --web ilkini geçersiz kılar
        self.addCleanup(_reap, proc)
        try:
            wait_up(port)
        finally:
            proc.send_signal(signal.SIGTERM)
            _, err = proc.communicate(timeout=CAP)
        self.assertIn("pnpm --filter web build", err)

    def test_shutdown_via_signal_no_deadlock(self):
        for sig in (signal.SIGTERM, signal.SIGINT):
            proc, port = launch(stderr=subprocess.DEVNULL)
            try:
                wait_up(port)
                proc.send_signal(sig)
                rc = proc.wait(timeout=CAP)                    # asılmadan temiz çıkış (rc 0); süre değil neden sınanır
                self.assertEqual(rc, 0)
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()


def wait_up(port, timeout=10):
    import http.client
    end = time.time() + timeout
    while time.time() < end:
        try:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            c.request("GET", "/api/hello")
            if c.getresponse().status == 200:
                return
        except OSError:
            time.sleep(0.05)
    raise AssertionError("sunucu açılmadı")


if __name__ == "__main__":
    unittest.main()


HANG_SCRIPT = (
    "import sys, time\n"
    "from oyun_server import __main__ as m\n"
    "m.HOOK_TIMEOUT_S = 0.5\n"
    "m.shutdown_hooks.append(lambda: time.sleep(60))\n"
    "raise SystemExit(m.main(sys.argv[1:]))\n"
)


def _reap(proc):
    if proc.poll() is None:
        proc.kill()
    try:
        proc.wait(timeout=5)
    finally:
        if getattr(proc, "stderr", None):
            proc.stderr.close()


class SignalAndHooks(unittest.TestCase):
    spawned: list = []

    @classmethod
    def tearDownClass(cls):
        left = [p.pid for p in cls.spawned if p.poll() is None]
        for p in cls.spawned:
            _reap(p)
        cls.spawned = []
        assert not left, f"artakalan oyun_server süreçleri: {left}"

    def spawn(self, script=None):
        proc, port = launch(script=script)
        self.spawned.append(proc)
        self.addCleanup(_reap, proc)
        wait_up(port)
        return proc

    def test_sigint_real_server_exits(self):
        proc = self.spawn()
        proc.send_signal(signal.SIGINT)
        self.assertEqual(proc.wait(timeout=CAP), 0)

    def test_signal_handler_does_not_touch_event(self):
        import inspect
        self.assertNotIn("stop.set", inspect.getsource(cli.main))

    def test_hanging_hook_is_timed_out(self):
        proc = self.spawn(HANG_SCRIPT)
        proc.send_signal(signal.SIGTERM)
        rc = proc.wait(timeout=CAP)                            # 60 sn uyuyan kanca 0,5 sn'de atlanır: rc 0 + metin
        self.assertEqual(rc, 0)
        self.assertIn("zaman aşımı", proc.stderr.read())

    def test_second_signal_hard_exits(self):
        proc = self.spawn(HANG_SCRIPT.replace("0.5", "30"))
        proc.send_signal(signal.SIGTERM)
        time.sleep(0.5)
        proc.send_signal(signal.SIGINT)
        rc = proc.wait(timeout=CAP)
        self.assertNotEqual(rc, 0)

    def test_run_hooks_unit(self):
        calls = []
        cli.run_hooks([lambda: calls.append(1), lambda: time.sleep(5), lambda: calls.append(2)], timeout=0.2)
        self.assertEqual(calls, [1, 2])
