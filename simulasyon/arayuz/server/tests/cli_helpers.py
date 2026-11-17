"""Alt süreç olarak gerçek sunucu (L4): kapı bulma, ham HTTP/SSE istemcisi, çocuk süreç denetimi."""
from __future__ import annotations

import http.client
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent.parent
CANLI_SH = SERVER_ROOT.parent / "canli.sh"
CONFIG = {"name": "Deneme", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban",
          "durationWeeks": 200, "seedIndex": 0, "values": {}}
ADDR_RE = re.compile(r"http://127\.0\.0\.1:(\d+)/oyun/")


def server_env(extra: dict | None = None) -> dict:
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "OYUN_RUNS_DIR")}
    env["PYTHONPATH"] = str(SERVER_ROOT)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env.update(extra or {})
    return env


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:  # zombi sayılmaz
        out = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    except OSError:
        return True
    return bool(out) and not out.startswith("Z")


def children_of(pid: int) -> list[int]:
    out = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True).stdout
    return [int(x) for x in out.split()]


def wait_gone(pids, timeout: float) -> list[int]:
    """`timeout` sn içinde ölmeyen PID'lerin listesi (boş = hepsi öldü)."""
    end = time.monotonic() + timeout
    left = list(pids)
    while left and time.monotonic() < end:
        left = [p for p in left if pid_alive(p)]
        if left:
            time.sleep(0.05)
    return left


class ServerProc:
    """`python3 -P -m oyun_server ...` (ya da verilen komut) alt süreçte; ilk satırdan kapıyı okur."""

    def __init__(self, args=None, env_extra=None, cmd=None, web: str | None = None, ready_timeout: float = 30.0):
        self._tmp = tempfile.TemporaryDirectory()
        web_dir = web or self._tmp.name
        self.cmd = cmd or [sys.executable, "-P", "-m", "oyun_server", "--port", "0", "--web", web_dir, *(args or [])]
        env_extra = {"OYUN_LOG_DIR": os.path.join(self._tmp.name, "logs"), **(env_extra or {})}
        self.proc = subprocess.Popen(self.cmd, cwd=SERVER_ROOT, env=server_env(env_extra), stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, text=True)
        self.lines: list[str] = []
        self.port = None
        end = time.monotonic() + ready_timeout
        while time.monotonic() < end:
            line = self.proc.stdout.readline()
            if not line:
                break
            self.lines.append(line)
            m = ADDR_RE.search(line)
            if m:
                self.port = int(m.group(1))
                break
        if self.port is None:
            self.kill()
            raise RuntimeError("sunucu başlamadı: " + "".join(self.lines))

    @property
    def pid(self) -> int:
        return self.proc.pid

    def conn(self, timeout: float = 10.0) -> http.client.HTTPConnection:
        return http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)

    def req(self, method: str, path: str, body=None):
        headers = {"Origin": f"http://127.0.0.1:{self.port}"}
        data = None
        if body is not None or method in ("POST", "DELETE"):
            headers.update({"Content-Type": "application/json", "X-Oyun-Istek": "1"})
            data = json.dumps(body if body is not None else {}).encode()
        c = self.conn()
        try:
            c.request(method, path, body=data, headers=headers)
            r = c.getresponse()
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
        finally:
            c.close()

    def create_run(self, config: dict | None = None) -> str:
        s, b = self.req("POST", "/api/runs", {"config": config or CONFIG})
        assert s == 201, (s, b)
        return b["runId"]

    def sse(self, run_id: str):
        """SSE akışı: (type, data) üreteci; bağlantı `close()` ile kapanır."""
        c = self.conn(timeout=30)
        c.request("GET", f"/api/runs/{run_id}/events", headers={"Origin": f"http://127.0.0.1:{self.port}"})
        r = c.getresponse()
        assert r.status == 200, r.status

        def gen():
            typ = None
            try:
                while True:
                    line = r.readline()
                    if not line:
                        return
                    line = line.decode().rstrip("\n")
                    if line.startswith("event:"):
                        typ = line[6:].strip()
                    elif line.startswith("data:") and typ:
                        yield typ, json.loads(line[5:].strip())
                        typ = None
            finally:
                c.close()
        return gen()

    def stop(self, sig=signal.SIGINT, timeout: float = 15.0) -> int | None:
        if self.proc.poll() is None:
            self.proc.send_signal(sig)
            try:
                self.proc.wait(timeout)
            except subprocess.TimeoutExpired:
                self.kill()
        self._drain()
        return self.proc.returncode

    def kill(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(5)
        self._drain()
        self._tmp.cleanup()

    def _drain(self) -> None:
        """Süreç bittikten sonra kalan çıktıyı al ve borunun dosyasını kapat."""
        f = self.proc.stdout
        if f is None or f.closed:
            return
        try:
            if self.proc.poll() is not None:
                self.lines.append(f.read())
        except (ValueError, OSError):
            pass
        f.close()

    def output(self) -> str:
        self._drain()
        return "".join(self.lines)


@contextmanager
def serving(**kw):
    s = ServerProc(**kw)
    try:
        yield s
    finally:
        s.stop()
        s._tmp.cleanup()
