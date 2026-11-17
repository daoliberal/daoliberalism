"""WorkerClient (A5): işçi alt sürecini başlatır, NDJSON olaylarını kuyruğa alır. Saf stdlib."""
from __future__ import annotations

import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Iterator

from .. import config

_EOF = object()
LOG_KEEP = 20                   # saklanan koşu günlüğü sayısı (en yeniler)


def prune_logs(d: Path, keep: int = LOG_KEEP) -> None:
    """`<koşu>.err` (ve `.err.1`) günlüklerinden en yeni `keep` koşununkini bırakır, eskileri siler."""
    try:
        groups: dict[str, float] = {}      # ad -> son değişiklik zamanı
        for p in Path(d).iterdir():
            if p.name.endswith(".err"):
                groups[p.name] = max(groups.get(p.name, 0.0), p.stat().st_mtime)
        for name in sorted(groups, key=lambda n: groups[n])[:max(0, len(groups) - keep)]:
            for suffix in ("", ".1"):
                try:
                    (Path(d) / (name + suffix)).unlink()
                except OSError:
                    pass
    except OSError:
        pass


LOG_MAX = 1024 * 1024          # günlük üst sınırı (iki dosya: .err ve .err.1, her biri ≤ LOG_MAX/2)


class WorkerClient:
    def __init__(self, proc: subprocess.Popen, log_path: Path, csv_dir: str | None = None):
        self._proc = proc
        self.csv_dir = csv_dir
        self.pid = proc.pid
        self.log_path = str(log_path)
        self.bad_lines = 0
        self._q: "queue.Queue" = queue.Queue()
        self._killed = False
        self._expected_exit = False
        self._failed_seen = False
        self._synth_done = False
        self.eof = False
        self._lock = threading.Lock()
        self._threads = [threading.Thread(target=self._read_out, daemon=True),
                         threading.Thread(target=self._drain_err, args=(log_path,), daemon=True)]
        for t in self._threads:
            t.start()

    @classmethod
    def spawn(cls, spec: dict, python: str = sys.executable, extra_env: dict | None = None,
              log_dir: Path | str | None = None) -> "WorkerClient":
        run_id = str(spec.get("run_id") or uuid.uuid4().hex[:12])
        d = Path(log_dir or config.LOG_DIR)
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass                                    # günlük açılamasa da işçi çalışır (stderr atılır)
        prune_logs(d)
        # CSV dizinini ebeveyn oluşturur ve `kill()` siler: işçi SIGKILL ile ölse de sızıntı olmaz. `init` komutu aynı
        # `spec` sözlüğünden kurulduğu için dizin yolu işçiye de ulaşır.
        csv_dir = tempfile.mkdtemp(prefix="oyun-host-")
        spec["csv_dir"] = csv_dir
        env = config.child_env(dict({"PYTHONHASHSEED": "0"}, **(extra_env or {})))
        try:
            proc = subprocess.Popen(
                [python, "-P", "-m", "oyun_server.sim.worker"], env=env, cwd=str(config.SERVER_ROOT),
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,   # stderr sürekli boşaltılır
                start_new_session=True, close_fds=True)
        except BaseException:
            shutil.rmtree(csv_dir, ignore_errors=True)
            raise
        return cls(proc, d / ("%s.err" % run_id), csv_dir)

    # iş parçacıkları
    def _read_out(self) -> None:
        try:
            for line in self._proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except ValueError:
                    self.bad_lines += 1
                    continue
                if isinstance(ev, dict):
                    self._q.put(ev)
                else:
                    self.bad_lines += 1
        except (OSError, ValueError):
            pass
        self._q.put(_EOF)

    def _drain_err(self, path: Path) -> None:
        half = LOG_MAX // 2
        out = None
        size = 0
        try:
            out = open(path, "ab")
            size = out.tell()
        except OSError:
            out = None                                  # günlük yok: yine de oku ve at (boru dolmasın)
        try:
            for chunk in iter(lambda: self._proc.stderr.read1(65536), b""):
                if out is None:
                    continue
                try:
                    if size + len(chunk) > half:
                        out.close()
                        os.replace(path, str(path) + ".1")
                        out = open(path, "ab")
                        size = 0
                    out.write(chunk[:half])
                    size += min(len(chunk), half)
                    out.flush()
                except OSError:
                    out = None
        except (OSError, ValueError):
            pass
        if out is not None:
            try:
                out.close()
            except OSError:
                pass

    # arayüz
    def send(self, cmd: dict) -> None:
        data = (json.dumps(cmd, separators=(",", ":")) + "\n").encode("utf-8")
        if cmd.get("cmd") == "shutdown":
            self._expected_exit = True
        with self._lock:
            if self._killed or self._proc.stdin is None or self._proc.stdin.closed:
                raise BrokenPipeError("işçi kapalı")
            self._proc.stdin.write(data)
            self._proc.stdin.flush()

    def events(self, timeout: float) -> Iterator[dict]:
        """Olay geldikçe verir. Zaman aşımında biter (`eof` False); işçi stdout'u kapanınca biter (`eof` True).

        Beklenmedik ölüm (failed olayı yok; SIGSEGV/OOM/os._exit) EOF'ta tek bir yapay
        `{"ev":"failed","error":"exit","reason":"exit","code":rc}` olayı üretir.
        """
        while True:
            try:
                item = self._q.get(timeout=timeout)
            except queue.Empty:
                return
            if item is _EOF:
                self._q.put(_EOF)
                self.eof = True
                if not (self._synth_done or self._failed_seen or self._expected_exit or self._killed):
                    self._synth_done = True
                    rc = self._proc.poll()      # kilit altında bekleme yok (pump kilidi); kod yoksa None
                    yield {"ev": "failed", "error": "exit", "reason": "exit", "code": rc}
                return
            if item.get("ev") == "failed":
                self._failed_seen = True
            yield item

    def alive(self) -> bool:
        return self._proc.poll() is None

    def close_stdin(self) -> None:
        self._expected_exit = True
        with self._lock:
            try:
                if self._proc.stdin and not self._proc.stdin.closed:
                    self._proc.stdin.close()
            except OSError:
                pass

    def wait(self, timeout: float | None = None) -> int | None:
        try:
            return self._proc.wait(timeout)
        except subprocess.TimeoutExpired:
            return None

    def stop(self, timeout: float = 5.0) -> None:
        """Nazik kapanış: stdin EOF, `timeout` sn bekle (işçi ModelHost.close'u koşar), hâlâ yaşıyorsa kill. Yinelenebilir."""
        self.close_stdin()
        self.wait(timeout)
        self.kill()

    def kill(self) -> None:
        """Yinelenebilir; süreç grubunu öldürür, bekler (zombi bırakmaz)."""
        with self._lock:
            self._killed = True
            self._expected_exit = True
        if self._proc.poll() is None:
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                try:
                    self._proc.kill()
                except OSError:
                    pass
        try:
            self._proc.wait()
        except Exception:
            pass
        for t in self._threads:
            t.join(2)
        if self.csv_dir:
            shutil.rmtree(self.csv_dir, ignore_errors=True)
        for f in (self._proc.stdin, self._proc.stdout, self._proc.stderr):
            try:
                if f:
                    f.close()
            except (OSError, ValueError):
                pass
