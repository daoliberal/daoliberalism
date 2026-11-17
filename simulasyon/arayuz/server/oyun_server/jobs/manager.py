"""Arka plan işleri (DK-12, S3): aynı şartla 6 dünya (`seeds`), A/B (`ab`), 52 haftalık gerçek önizleme (`preview`).

Her iş üyesi ayrı bir işçi sürecidir (pacer yok; `init` + `ff` ile sonuna kadar hesaplanır, yalnız özet seriler tutulur).
Etkileşimli koşuların temposunu bozmamak için: ayrı sınır (`pool`: en çok 2 işçi, `min(4, cpu-2)` ile de sınırlı),
aynı anda tek etkin iş, işçiler düşük öncelikle (nice) başlar, iptal edilebilir. Toplam süreç <= `MAX_RUNS + pool`.
Sunucu kapanışında (`shutdown`) bütün üye işçileri öldürülür; arkada süreç kalmaz.

Eşzamanlılık: iş başına bir sürücü iş parçacığı (üyeleri sırayla başlatır, olayları okur); durum tek `RLock` altında.
HTTP iş parçacıkları yalnız `start`/`get`/`cancel` çağırır (kısa işler; `cancel` sürücünün bitmesini bekler).
"""
from __future__ import annotations

import copy
import itertools
import os
import re
import sys
import threading
import time
import traceback
import uuid
from collections import deque
from typing import Any, Callable

from .. import config
from ..registry.loader import Registry
from ..registry.resolve import DEFAULT_DURATION, resolve, run_overrides
from ..registry.schema import FieldError, RunConfigError
from ..runs import recipe as recipe_mod
from ..runs.manager import RunManager
from ..sim.extract import extract_world

JOB_ID_RE = re.compile(r"^job-[0-9a-f]{8}$")
KINDS = ("seeds", "ab", "preview")
SERIES = ("served", "failed_cum", "city_cash_total", "gini", "unemployment_rate", "failed_total_cum", "unemployment_rate_all")      # son ikisi: toplam batan ve geniş işsizlik (F1); eskiler pakette kalır
PREVIEW_WEEKS = 52
POOL_CAP = 2                    # arka plan işi en çok bu kadar işçi (sahibin :8765 sunucusu ve etkileşimli koşularla CPU paylaşımı)
KEEP_JOBS = 8                   # bellekte tutulan bitmiş iş sayısı
POLL_S = 0.02
STUCK_S = 30.0                  # üye bu kadar süre hiç olay yayımlamazsa askıda sayılır (RunManager STUCK_S ile tutarlı)
BATCH = 200                     # bir üyeden bir turda en çok okunan olay
JOIN_S = 10.0
NICE = 10
_TERMINAL = ("done", "failed", "cancelled")


class JobBusy(Exception):
    """Zaten etkin bir iş var (409 `job_running`)."""


class UnknownJob(KeyError):
    """Bilinmeyen ya da desene uymayan iş kimliği (404)."""


def default_pool() -> int:
    cpu = os.cpu_count() or 1
    return max(1, min(4, cpu - 2, POOL_CAP))


def nice_factory(factory: Callable[[dict], Any]) -> Callable[[dict], Any]:
    """İş işçilerini düşük öncelikle başlatır (etkileşimli koşuların temposu bozulmasın)."""
    def make(spec: dict) -> Any:
        w = factory(spec)
        pid = getattr(w, "pid", -1)
        if isinstance(pid, int) and pid > 0:
            try:
                os.setpriority(os.PRIO_PROCESS, pid, NICE)
            except (OSError, AttributeError):
                pass
        return w
    return make


class _Member:
    def __init__(self, label: str, spec: dict, total: int, seed_index: int):
        self.label, self.spec, self.total, self.seed_index = label, spec, total, seed_index
        self.status = "queued"
        self.weeks = 0
        self.series: dict[str, list] = {k: [] for k in SERIES}
        self.error: str | None = None           # neden kodu: model_error / worker_crashed / spawn_failed / stuck / internal / cancelled
        self.last_event = time.monotonic()
        self.worker: Any = None


class _Job:
    def __init__(self, job_id: str, kind: str, members: list[_Member]):
        self.id, self.kind, self.members = job_id, kind, members
        self.status = "queued"
        self.cancel = threading.Event()
        self.thread: threading.Thread | None = None


def _strip_seed(recipe: dict, seed: int) -> dict:
    """Tarifin kopyası: `seedIndex = seed`; `dunya_tohumu` değerleri (config ve takvim yamaları) atılır (tek kaynak seedIndex)."""
    r = copy.deepcopy(recipe)
    cfg = r["config"]
    cfg["seedIndex"] = seed
    if isinstance(cfg.get("values"), dict):
        cfg["values"].pop("dunya_tohumu", None)
    sched = []
    for e in r.get("schedule") or []:
        if isinstance(e, dict) and isinstance(e.get("patch"), dict):
            e["patch"].pop("dunya_tohumu", None)
            if not e["patch"]:
                continue
        sched.append(e)
    r["schedule"] = sched
    return r


class JobManager:
    def __init__(self, registry: Registry, worker_factory: Callable[[dict], Any], pool: int | None = None,
                 live_keys: Any = None, host: str | None = None, stuck_s: float | None = None):
        self.registry = registry
        self.factory = worker_factory
        self.pool = max(1, int(pool if pool is not None else default_pool()))
        self.live_keys = live_keys
        self._host = host
        self.stuck_s = float(STUCK_S if stuck_s is None else stuck_s)
        self._lock = threading.RLock()
        self._jobs: dict[str, _Job] = {}
        self._closed = False

    # ---- kurulum -------------------------------------------------------------------------------------------------
    def _live_keys(self) -> Any:
        if self.live_keys is None:
            self.live_keys = config.load_live_keys(self.registry)
        return self.live_keys

    @staticmethod
    def _prefixed(prefix: str, e: RunConfigError) -> RunConfigError:
        return RunConfigError([FieldError(prefix if x.id in ("config", "") else "%s.%s" % (prefix, x.id), x.reason)
                               for x in e.errors])

    def _recipe_of(self, raw: Any, prefix: str) -> dict:
        if not isinstance(raw, dict) or not isinstance(raw.get("config"), dict):
            raise RunConfigError([FieldError(prefix, "invalid")])
        sched = raw.get("schedule")
        errs = recipe_mod.shape_errors(sched)
        if errs:
            raise RunConfigError([FieldError("%s.%s" % (prefix, x.id), x.reason) for x in errs])
        return {"config": raw["config"], "schedule": sched or []}

    def _member(self, job_id: str, label: str, rcp: dict, weeks: int | None = None, from_week: int = 0) -> _Member:
        """Tarifi doğrular ve üye tanımını kurar (işçi başlatmaz). Hata: `RunConfigError` (kimlikler öneksiz)."""
        cfg = rcp["config"]
        RunManager._check_shape(cfg)
        errors = recipe_mod.validate(self.registry, rcp, self._live_keys())
        if errors:
            raise RunConfigError(errors)
        merged, rest = recipe_mod.split_week0(cfg, rcp["schedule"])
        overrides = run_overrides(self.registry, merged)
        sched = []
        for n, e in enumerate(rest):
            res = resolve(self.registry, e["patch"])
            sched.append({"week": e["week"], "overrides": dict(res.params), "version": n + 2})
        duration = merged["durationWeeks"]
        total = weeks if weeks is not None else duration       # önizleme: işçi şartın kendi süresiyle kurulur, `weeks`'te durur
        if weeks is not None and from_week > 0:                # koşu ortası önizleme: `fromWeek`'ten `weeks` hafta sonra durur
            total = min(duration, from_week + weeks)
        spec = {"run_id": "%s-%s" % (job_id, label), "overrides": overrides, "weeks": duration, "schedule": sched,
                "host": self._host or os.environ.get("OYUN_HOST") or "model", "live_keys": sorted(self._live_keys())}
        si = merged.get("seedIndex")
        return _Member(label, spec, total, si if type(si) is int else 0)

    def _build(self, job_id: str, body: dict) -> tuple[str, list[_Member]]:
        kind = body.get("kind")
        if not isinstance(kind, str) or kind not in KINDS:
            raise RunConfigError([FieldError("kind", "invalid")])
        nseeds = len(self.registry.seeds)
        members: list[_Member] = []
        if kind == "seeds":
            rcp = self._recipe_of(body.get("recipe"), "recipe")
            for i in range(nseeds):
                try:
                    members.append(self._member(job_id, "seed-%d" % i, _strip_seed(rcp, i)))
                except RunConfigError as e:
                    raise self._prefixed("recipe", e)
        elif kind == "ab":
            a = self._recipe_of(body.get("a"), "a")
            b = self._recipe_of(body.get("b"), "b")
            si = a["config"].get("seedIndex", 0)
            if type(si) is not int or not 0 <= si < nseeds:
                raise RunConfigError([FieldError("a.seedIndex", "invalid")])
            for label, rcp in (("a", a), ("b", b)):                # aynı dünya: iki tarif de A'nın tohumuyla
                try:
                    members.append(self._member(job_id, label, _strip_seed(rcp, si)))
                except RunConfigError as e:
                    raise self._prefixed(label, e)
        else:
            weeks = body.get("weeks", PREVIEW_WEEKS)
            if type(weeks) is not int or not 1 <= weeks <= PREVIEW_WEEKS:
                raise RunConfigError([FieldError("weeks", "invalid")])
            base, draft = body.get("base"), body.get("draft")
            bad = [FieldError(k, "invalid") for k, v in (("base", base), ("draft", draft)) if not isinstance(v, dict)]
            if bad:
                raise RunConfigError(bad)
            from_week = body.get("fromWeek", 0)                    # isteğe bağlı: koşu ortası (tarifler takvimle koşunun kendisidir)
            if type(from_week) is not int or not 0 <= from_week <= 1000:
                raise RunConfigError([FieldError("fromWeek", "invalid")])
            durs = [c.get("durationWeeks", DEFAULT_DURATION) for c in (base, draft)]
            if any(type(d) is int and from_week >= d for d in durs):    # önizleme koşunun süresini aşamaz (aksi halde sessizce tüm koşuyu hesaplar)
                raise RunConfigError([FieldError("fromWeek", "invalid")])
            si = base.get("seedIndex", 0)
            if type(si) is not int or not 0 <= si < nseeds:
                raise RunConfigError([FieldError("base.seedIndex", "invalid")])
            for label, cfg in (("base", base), ("draft", draft)):  # aynı dünya; süre verilmediyse doğrulama için varsayılan
                cfg = dict(cfg)
                sched = cfg.pop("schedule", None)                # isteğe bağlı takvim: `recipe.validate` ile doğrulanır
                cfg.setdefault("durationWeeks", DEFAULT_DURATION)
                try:
                    errs = recipe_mod.shape_errors(sched)
                    if errs:
                        raise RunConfigError(errs)
                    rcp = {"config": cfg, "schedule": sched or []}
                    members.append(self._member(job_id, label, _strip_seed(rcp, si), weeks, from_week))
                except RunConfigError as e:
                    raise self._prefixed(label, e)
        return kind, members

    # ---- genel arayüz --------------------------------------------------------------------------------------------
    def start(self, body: dict) -> str:
        """İşi doğrular, kaydeder ve sürücü iş parçacığını başlatır. `JobBusy`, `RunConfigError`."""
        job_id = "job-" + uuid.uuid4().hex[:8]
        with self._lock:
            if self._closed or any(j.status not in _TERMINAL for j in self._jobs.values()):
                raise JobBusy()
        kind, members = self._build(job_id, body)
        job = _Job(job_id, kind, members)
        with self._lock:
            if self._closed or any(j.status not in _TERMINAL for j in self._jobs.values()):
                raise JobBusy()
            done = [k for k, j in self._jobs.items() if j.status in _TERMINAL]
            for k in done[:max(0, len(done) - KEEP_JOBS + 1)]:
                del self._jobs[k]
            self._jobs[job_id] = job
            job.thread = threading.Thread(target=self._drive, args=(job,), name=job_id, daemon=True)
            job.thread.start()
        return job_id

    def _get(self, job_id: str) -> _Job:
        job = self._jobs.get(job_id) if isinstance(job_id, str) and JOB_ID_RE.match(job_id) else None
        if job is None:
            raise UnknownJob(job_id)
        return job

    def get(self, job_id: str) -> dict:
        with self._lock:
            return self._snapshot(self._get(job_id))

    def cancel(self, job_id: str) -> dict:
        """Etkin işi iptal eder (üye işçileri öldürülür, sürücü bitene kadar beklenir); bitmiş iş değişmez. İş durumunu döner."""
        with self._lock:
            job = self._get(job_id)
        if job.status not in _TERMINAL:
            job.cancel.set()
            t = job.thread
            if t is not None and t is not threading.current_thread():
                t.join(JOIN_S)
            self._kill_members(job)
        with self._lock:
            return self._snapshot(job)

    def shutdown(self) -> None:
        """Bütün etkin işleri iptal eder; üye işçileri ölür. Yinelenebilir."""
        with self._lock:
            self._closed = True
            jobs = list(self._jobs.values())
        for job in jobs:
            job.cancel.set()
        for job in jobs:
            t = job.thread
            if t is not None and t is not threading.current_thread():
                t.join(JOIN_S)
            self._kill_members(job)

    def active_workers(self) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() for m in j.members if m.worker is not None)

    # ---- sürücü --------------------------------------------------------------------------------------------------
    def _snapshot(self, job: _Job) -> dict:
        total = sum(m.total for m in job.members)
        done = sum(m.total if m.status == "done" else m.weeks for m in job.members)
        members = []
        for m in job.members:
            item = {"label": m.label, "status": m.status, "seedIndex": m.seed_index, "weeks": m.weeks,
                    "series": {k: list(v) for k, v in m.series.items()}}
            if m.error is not None:
                item["error"] = m.error
            members.append(item)
        return {"jobId": job.id, "kind": job.kind, "status": job.status, "progress": {"done": done, "total": total},
                "members": members}

    def _kill_members(self, job: _Job) -> None:
        for m in job.members:
            with self._lock:
                w, m.worker = m.worker, None
            if w is not None:
                try:
                    w.kill()
                except Exception:
                    pass

    def _start_member(self, job: _Job, m: _Member) -> bool:
        try:
            w = self.factory(dict(m.spec))
            with self._lock:
                m.worker = w
                m.status = "running"
                m.last_event = time.monotonic()
            w.send(dict(m.spec, cmd="init"))
            w.send({"cmd": "ff", "week": m.total})
            return True
        except Exception as e:
            self._finish_member(job, m, "failed", "spawn_failed", "%s: %s" % (type(e).__name__, e))
            return False

    def _finish_member(self, job: _Job, m: _Member, status: str, code: str | None = None, detail: str = "",
                       graceful: bool = False) -> None:
        """`code` telde görünen neden kodudur; `detail` (ham istisna metni) yalnız sunucu günlüğüne gider."""
        if detail:
            print("oyun_server: iş %s üyesi %s: %s (%s)" % (job.id, m.label, code, detail[:500]), file=sys.stderr)
        with self._lock:
            w, m.worker = m.worker, None
            m.status = status
            if code is not None:
                m.error = code
        if w is not None:
            try:
                if graceful:
                    w.stop(2.0)
                else:
                    w.kill()
            except Exception:
                try:
                    w.kill()
                except Exception:
                    pass

    def _pump_member(self, job: _Job, m: _Member) -> None:
        w = m.worker
        if w is None:
            return
        for ev in itertools.islice(w.events(POLL_S), BATCH):
            m.last_event = time.monotonic()
            kind = ev.get("ev")
            if kind == "week":
                world = extract_world(ev.get("row") or {})
                with self._lock:
                    m.weeks = max(m.weeks, int(ev.get("week", m.weeks)))
                    for k in SERIES:
                        m.series[k].append(world[k])
                if ev.get("week", 0) >= m.total:
                    self._finish_member(job, m, "done", graceful=True)
                    return
            elif kind == "failed":
                detail = str(ev.get("error") or ev.get("reason") or "failed")
                crashed = ev.get("error") == "exit"
                self._finish_member(job, m, "failed", "worker_crashed" if crashed else "model_error", detail)
                return
            if job.cancel.is_set():
                return

    def _drive(self, job: _Job) -> None:
        try:
            with self._lock:
                job.status = "running"
            pending = deque(job.members)
            active: list[_Member] = []
            while not job.cancel.is_set():
                while pending and len(active) < self.pool and not job.cancel.is_set():
                    m = pending.popleft()
                    if self._start_member(job, m):
                        active.append(m)
                if not active:
                    break
                for m in list(active):
                    if job.cancel.is_set():
                        break
                    self._pump_member(job, m)
                    if m.status == "running" and time.monotonic() - m.last_event > self.stuck_s:
                        self._finish_member(job, m, "failed", "stuck", "%.0f sn olay yok" % self.stuck_s)
                    if m.status != "running":
                        active.remove(m)
        except BaseException:
            traceback.print_exc(file=sys.stderr)
            for m in job.members:
                if m.status in ("queued", "running"):
                    self._finish_member(job, m, "failed", "internal")
        finally:
            self._kill_members(job)
            with self._lock:
                cancelled = job.cancel.is_set()
                for m in job.members:
                    if m.status in ("queued", "running"):
                        m.status = "cancelled" if cancelled else "failed"
                        m.error = "cancelled" if cancelled else "internal"
                if cancelled:
                    job.status = "cancelled"
                elif any(m.status == "done" for m in job.members):
                    job.status = "done"
                else:
                    job.status = "failed"
