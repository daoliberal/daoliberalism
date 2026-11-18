"""B2: süreç içi, tek iş parçacıklı işçi istemcisi (tarayıcı/Pyodide çekirdeği). `WorkerClient` ile aynı arayüz (send/events/alive/wait/close_stdin/stop/kill).

`send` komutu `SessionCore.handle` ile HEMEN işler (hafta hesaplamaz: hedef/yama/çekmece/karar anında); hafta adımı yalnız `advance_once()` ile atılır
(JS zamanlayıcısı `RunManager.tick()` üzerinden). Olaylar bir kuyruğa yazılır, `events` bunu boşaltır; `events` ve `send` asla uyumaz.
"""
from __future__ import annotations

import shutil
import tempfile
from collections import deque
from typing import Any, Callable, Iterator

from ..sim.worker import SessionCore, make_host


class InProcClient:
    pid = -1
    bad_lines = 0
    stuck_check = False        # süreç içi işçi düşemez (düşerse `advance` failed olayı yayımlar); sekme kısılması / uzun hafta adımı `STUCK_S` ile koşuyu yanlışlıkla düşürmesin

    def __init__(self, spec: dict | None = None, host_factory: Callable[[dict], Any] | None = None):
        self.spec = spec or {}
        self.csv_dir = self.spec.get("csv_dir")
        self.eof = False
        self._done = False
        self._out: deque = deque()
        base = host_factory or make_host

        def fabrika(cmd: dict) -> Any:
            return base({**cmd, "hafiza": True})                  # B3: tarayıcı kipi: host her adımdan sonra okunmayan model geçmişini bırakır (`ModelHost.hafiza`)
        self.core = SessionCore(self._out.append, fabrika)

    def send(self, cmd: dict) -> None:
        if self._done:
            raise BrokenPipeError("işçi kapalı")
        if self.core.handle(cmd):
            self._done = True

    def advance_once(self) -> None:
        """En çok bir hafta hesaplar (`SessionCore.advance`); düşerse (failed olayı yayımlandı) istemci kapanır."""
        if self._done:
            return
        if self.core.advance():
            self._done = True

    def events(self, timeout: float = 0) -> Iterator[dict]:
        while self._out:
            yield self._out.popleft()
        if self._done:
            self.eof = True

    def alive(self) -> bool:
        return not self._done

    def wait(self, timeout: float | None = None) -> int | None:
        return 0 if self._done else None

    def close_stdin(self) -> None:
        self._close()

    def stop(self, timeout: float = 5.0) -> None:
        self._close()

    def kill(self) -> None:
        self._close()

    def _close(self) -> None:
        if not self._done or self.csv_dir:
            self._done = True
            self.core.close()
            if self.csv_dir:
                shutil.rmtree(self.csv_dir, ignore_errors=True)
                self.csv_dir = None


def inproc_factory(model_root: str | None = None, host_factory: Callable[[dict], Any] | None = None):
    """RunManager `worker_factory`si (tarayıcı kipi): her koşu için bir `InProcClient`; CSV dizinini (akış kancası dosyaları) bu kurar ve `kill`de siler."""
    def factory(spec: dict) -> InProcClient:
        spec["csv_dir"] = tempfile.mkdtemp(prefix="oyun-host-")
        if model_root:
            spec["model_root"] = model_root
        return InProcClient(spec, host_factory)
    return factory
