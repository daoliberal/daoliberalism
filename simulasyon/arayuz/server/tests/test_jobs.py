"""S3: arka plan işleri (6 dünya, A/B, 52 haftalık önizleme). Sahte işçi; süreç sınamaları gerçek `WorkerClient` + fake host."""
from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from oyun_server import config
from oyun_server.http import make_server
from oyun_server.jobs import routes as job_routes
from oyun_server.jobs.manager import JobBusy, JobManager, SERIES, UnknownJob, default_pool, nice_factory
from oyun_server.registry.resolve import DEFAULT_DURATION
from oyun_server.registry.schema import RunConfigError
from oyun_server.runs import routes
from oyun_server.runs.manager import RunManager
from oyun_server.sim.client import WorkerClient
from oyun_server.testing import FakeHost, InProcWorker

from tests.registry_helpers import real_defaults, real_registry
from tests.route_helpers import POST, call, make_cfg

FIX = json.loads((Path(__file__).parent / "fixtures" / "wire_contract.json").read_text(encoding="utf-8"))
CONFIG = {"name": "Is", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban", "durationWeeks": 100,
          "seedIndex": 0, "values": {}}
PATCH = {"gecis_destegi": "kurtarma_fonuyla"}
_PIDS: list[int] = []


def _gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


def tearDownModule():
    deadline = time.time() + 3
    left = []
    for pid in _PIDS:
        while not _gone(pid) and time.time() < deadline:
            time.sleep(0.05)
        if not _gone(pid):
            left.append(pid)
    assert not left, "artakalan işçi süreçler: %s" % left


def fake_host(spec):
    return FakeHost("", spec.get("overrides", {}), spec.get("weeks", 200))


class Counting:
    """Süreç içi sahte işçi fabrikası: oluşturulan işçileri ve özelliklerini (spec) kaydeder."""

    def __init__(self, step_delay: float = 0.0):
        self.workers: list[InProcWorker] = []
        self.specs: list[dict] = []
        self.step_delay = step_delay
        self.lock = threading.Lock()

    def __call__(self, spec):
        w = InProcWorker(spec, step_delay=self.step_delay, host_factory=fake_host)
        with self.lock:
            self.workers.append(w)
            self.specs.append(copy.deepcopy(spec))
        return w

    def alive(self) -> int:
        with self.lock:
            return sum(1 for w in self.workers if w.alive())


class JobBase(unittest.TestCase):
    def make(self, factory=None, pool=2):
        self.factory = factory or Counting()
        self.reg = real_registry()
        self.jm = JobManager(self.reg, self.factory, pool=pool, host="fake")
        self.addCleanup(self.jm.shutdown)
        return self.jm

    def wait_status(self, job_id, want=("done", "failed", "cancelled"), timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            j = self.jm.get(job_id)
            if j["status"] in want:
                return j
            time.sleep(0.01)
        self.fail("iş bitmedi: %s" % self.jm.get(job_id)["status"])


class TestJobs(JobBase):
    def test_seeds_job_six_members_distinct_seeds(self):
        self.make()
        jid = self.jm.start({"kind": "seeds", "recipe": {"config": CONFIG, "schedule": []}})
        self.assertRegex(jid, r"^job-[0-9a-f]{8}$")
        j = self.wait_status(jid)
        self.assertEqual(j["status"], "done")
        self.assertEqual(len(j["members"]), 6)
        self.assertEqual([m["label"] for m in j["members"]], ["seed-%d" % i for i in range(6)])
        seeds = [s["overrides"]["PM_ADJ"] for s in self.factory.specs]
        self.assertEqual(sorted(seeds), sorted(self.reg.seeds))               # 6 farklı dünya (tohum -> PM_ADJ)
        self.assertEqual(len(set(seeds)), 6)
        for m in j["members"]:
            self.assertEqual(m["status"], "done")
            self.assertEqual(set(m["series"]), set(SERIES))
            for k in SERIES:
                self.assertEqual(len(m["series"][k]), 100, k)
        self.assertEqual(len({tuple(m["series"]["served"]) for m in j["members"]}), 6)     # her dünya farklı
        self.assertEqual(j["progress"], {"done": 600, "total": 600})

    def test_ab_job_same_seed(self):
        self.make()
        a = {"config": dict(CONFIG, seedIndex=3), "schedule": []}
        b = {"config": dict(CONFIG, seedIndex=1, values={"gecis_destegi": "kurtarma_fonuyla"}), "schedule": []}
        j = self.wait_status(self.jm.start({"kind": "ab", "a": a, "b": b}))
        self.assertEqual(j["status"], "done")
        self.assertEqual([m["label"] for m in j["members"]], ["a", "b"])
        self.assertEqual([s["overrides"]["PM_ADJ"] for s in self.factory.specs], [self.reg.seeds[3]] * 2)     # B de A'nın dünyasında
        self.assertEqual([m["seedIndex"] for m in j["members"]], [3, 3])
        self.assertNotEqual(self.factory.specs[0]["overrides"], self.factory.specs[1]["overrides"])
        self.assertNotEqual(j["members"][0]["series"]["served"], j["members"][1]["series"]["served"])

    def test_ab_job_applies_recipe_schedule(self):
        self.make()
        a = {"config": CONFIG, "schedule": []}
        b = {"config": CONFIG, "schedule": [{"week": 10, "patch": PATCH}]}
        j = self.wait_status(self.jm.start({"kind": "ab", "a": a, "b": b}))
        self.assertEqual(j["status"], "done", j)
        self.assertEqual(self.factory.specs[0]["schedule"], [])
        self.assertEqual([(e["week"], e["version"]) for e in self.factory.specs[1]["schedule"]], [(10, 2)])

    def test_preview_job_52_weeks_two_members(self):
        self.make()
        base = {k: v for k, v in CONFIG.items() if k != "durationWeeks"}
        draft = dict(base, values={"gecis_destegi": "kurtarma_fonuyla"})
        j = self.wait_status(self.jm.start({"kind": "preview", "base": base, "draft": draft, "weeks": 52}))
        self.assertEqual(j["status"], "done", j)
        self.assertEqual([m["label"] for m in j["members"]], ["base", "draft"])
        for m in j["members"]:
            for k in SERIES:
                self.assertEqual(len(m["series"][k]), 52)
        self.assertEqual({s["weeks"] for s in self.factory.specs}, {DEFAULT_DURATION})      # işçi şartın kendi süresiyle kurulur
        self.assertEqual(j["progress"], {"done": 104, "total": 104})
        self.assertEqual(self.factory.specs[0]["overrides"]["PM_ADJ"], self.factory.specs[1]["overrides"]["PM_ADJ"])

    def test_preview_own_duration_stops_at_week_52_and_equals_run_prefix(self):
        self.make()
        cfg = dict(CONFIG, durationWeeks=200)
        j = self.wait_status(self.jm.start({"kind": "preview", "base": cfg, "draft": cfg}))
        self.assertEqual({s["weeks"] for s in self.factory.specs}, {200})
        self.assertEqual([len(m["series"]["served"]) for m in j["members"]], [52, 52])
        full = self.wait_status(self.jm.start({"kind": "ab", "a": {"config": cfg}, "b": {"config": cfg}}))
        for k in SERIES:
            self.assertEqual(j["members"][0]["series"][k], full["members"][0]["series"][k][:52], k)

    def test_preview_from_week_with_schedule_stops_at_from_week_plus_weeks(self):
        self.make()
        cfg = dict(CONFIG, durationWeeks=200)
        sched = [{"week": 10, "patch": PATCH}]
        draft = dict(cfg, schedule=sched + [{"week": 41, "patch": {"gecis_destegi": "kisa_sureli"}}])
        j = self.wait_status(self.jm.start({"kind": "preview", "base": dict(cfg, schedule=sched), "draft": draft, "weeks": 52, "fromWeek": 40}))
        self.assertEqual(j["status"], "done", j)
        self.assertEqual([len(m["series"]["served"]) for m in j["members"]], [92, 92])
        self.assertEqual([e["week"] for e in self.factory.specs[0]["schedule"]], [10])           # taban = koşunun kendi takvimi
        self.assertEqual([e["week"] for e in self.factory.specs[1]["schedule"]], [10, 41])       # taslak = taban + yeni karar
        j2 = self.wait_status(self.jm.start({"kind": "preview", "base": dict(cfg, durationWeeks=100), "draft": dict(cfg, durationWeeks=100), "fromWeek": 70}))
        self.assertEqual([len(m["series"]["served"]) for m in j2["members"]], [100, 100])         # süreyi aşmaz

    def test_preview_mid_run_wire_fixture_accepted(self):
        self.make()
        j = self.wait_status(self.jm.start(copy.deepcopy(FIX["job_request_preview_mid_run"])))
        self.assertEqual(j["status"], "done", j)
        self.assertEqual([len(m["series"]["served"]) for m in j["members"]], [92, 92])

    def test_preview_schedule_and_from_week_validated(self):
        self.make()
        cfg = dict(CONFIG, durationWeeks=200)
        for body, key in (
            ({"fromWeek": -1}, "fromWeek"), ({"fromWeek": "4"}, "fromWeek"), ({"fromWeek": True}, "fromWeek"),
            ({"base": dict(cfg, schedule="x")}, "base"),
            ({"draft": dict(cfg, schedule=[{"week": 5, "patch": {"gecis_destegi": "yok_boyle"}}])}, "draft"),
        ):
            full = {"kind": "preview", "base": cfg, "draft": cfg}
            full.update(body)
            with self.assertRaises(RunConfigError, msg=repr(body)) as cm:
                self.jm.start(full)
            self.assertTrue(cm.exception.errors[0].id.startswith(key), (key, cm.exception.errors))

    def test_preview_weeks_default_and_bound(self):
        self.make()
        base = {k: v for k, v in CONFIG.items() if k != "durationWeeks"}
        for w in (53, 0, "52", True):
            with self.assertRaises(RunConfigError, msg=repr(w)):
                self.jm.start({"kind": "preview", "base": base, "draft": base, "weeks": w})
        self.wait_status(self.jm.start({"kind": "preview", "base": base, "draft": base}))
        self.assertEqual({s["weeks"] for s in self.factory.specs}, {DEFAULT_DURATION})

    def test_pool_limit_respected(self):
        fac = Counting(step_delay=0.001)
        self.make(fac, pool=2)
        jid = self.jm.start({"kind": "seeds", "recipe": {"config": CONFIG, "schedule": []}})
        peak = 0
        end = time.time() + 60
        while time.time() < end:
            peak = max(peak, fac.alive(), self.jm.active_workers())
            if self.jm.get(jid)["status"] == "done":
                break
            time.sleep(0.001)
        self.assertEqual(self.jm.get(jid)["status"], "done")
        self.assertLessEqual(peak, 2)
        self.assertGreaterEqual(peak, 1)
        self.assertEqual(len(fac.workers), 6)
        self.assertEqual(fac.alive(), 0)                          # biten üyelerin işçileri kapandı

    def test_default_pool_bounds(self):
        with mock.patch("os.cpu_count", return_value=16):
            self.assertEqual(default_pool(), 2)                  # denetleyici sınırı: en çok 2 işçi
        with mock.patch("os.cpu_count", return_value=2):
            self.assertEqual(default_pool(), 1)
        with mock.patch("os.cpu_count", return_value=None):
            self.assertEqual(default_pool(), 1)

    def test_second_job_409(self):
        self.make(Counting(step_delay=0.01), pool=1)
        body = {"kind": "seeds", "recipe": {"config": CONFIG, "schedule": []}}
        jid = self.jm.start(body)
        with self.assertRaises(JobBusy):
            self.jm.start(body)
        self.jm.cancel(jid)
        jid2 = self.jm.start(body)                               # iptalden sonra yeni iş serbest
        self.assertNotEqual(jid, jid2)
        self.jm.cancel(jid2)

    def test_failed_member_marks_member_not_job(self):
        reg = real_registry()
        class Failing(Counting):
            def __call__(self, spec):
                if spec["overrides"].get("PM_ADJ") == reg.seeds[2]:
                    spec = dict(spec, weeks=spec["weeks"])
                    w = InProcWorker(spec, host_factory=lambda s: (_ for _ in ()).throw(RuntimeError("bozuk dünya")))
                    self.workers.append(w)
                    return w
                return super().__call__(spec)
        self.make(Failing())
        j = self.wait_status(self.jm.start({"kind": "seeds", "recipe": {"config": CONFIG, "schedule": []}}))
        self.assertEqual(j["status"], "done")
        st = [m["status"] for m in j["members"]]
        self.assertEqual(st, ["done", "done", "failed", "done", "done", "done"])
        self.assertEqual(j["members"][2]["error"], "model_error")          # ham istisna metni telde yok
        self.assertNotIn("bozuk", json.dumps(j))
        self.assertEqual(j["members"][2]["series"]["served"], [])
        self.assertEqual(j["progress"]["total"], 600)

    def test_all_members_failed_marks_job_failed(self):
        def boom(spec):
            raise OSError("süreç açılamadı")
        self.make(boom)
        j = self.wait_status(self.jm.start({"kind": "ab", "a": {"config": CONFIG}, "b": {"config": CONFIG}}))
        self.assertEqual(j["status"], "failed")
        self.assertEqual([m["status"] for m in j["members"]], ["failed", "failed"])
        self.assertEqual([m["error"] for m in j["members"]], ["spawn_failed"] * 2)
        self.assertNotIn("açılamadı", json.dumps(j))

    def test_cancel_stops_inproc_members(self):
        fac = Counting(step_delay=0.01)
        self.make(fac)
        jid = self.jm.start({"kind": "seeds", "recipe": {"config": CONFIG, "schedule": []}})
        end = time.time() + 10
        while time.time() < end and self.jm.get(jid)["progress"]["done"] < 5:
            time.sleep(0.005)
        j = self.jm.cancel(jid)
        self.assertEqual(j["status"], "cancelled")
        self.assertTrue(all(m["status"] in ("cancelled", "done") for m in j["members"]))
        self.assertIn("cancelled", [m["status"] for m in j["members"]])
        self.assertTrue(all(m["error"] == "cancelled" for m in j["members"] if m["status"] == "cancelled"))
        self.assertEqual(fac.alive(), 0)
        self.assertLess(len(fac.workers), 6)                     # başlamamış üyeler hiç başlatılmadı
        self.assertEqual(self.jm.cancel(jid)["status"], "cancelled")      # yinelenebilir

    def test_bad_job_id_404(self):
        self.make()
        for bad in ("job-xyz", "job-0123456789", "../etc", "job-0123456g", "", "JOB-01234567", "job-01234567"):
            with self.assertRaises(UnknownJob, msg=bad):
                self.jm.get(bad)
            with self.assertRaises(UnknownJob, msg=bad):
                self.jm.cancel(bad)

    def test_validation_errors(self):
        self.make()
        bad_cfg = dict(CONFIG, values={"yok_ayar": 1})
        cases = [
            ({"kind": "zzz"}, "kind"),
            ({}, "kind"),
            ({"kind": "seeds"}, "recipe"),
            ({"kind": "seeds", "recipe": {"config": bad_cfg}}, "recipe."),
            ({"kind": "seeds", "recipe": {"config": CONFIG, "schedule": [{"week": 5}]}}, "recipe.schedule"),
            ({"kind": "ab", "a": {"config": CONFIG}}, "b"),
            ({"kind": "ab", "a": {"config": CONFIG}, "b": {"config": bad_cfg}}, "b."),
            ({"kind": "ab", "a": {"config": dict(CONFIG, seedIndex=9)}, "b": {"config": CONFIG}}, "a.seedIndex"),
            ({"kind": "preview", "base": CONFIG}, "draft"),
            ({"kind": "preview", "base": CONFIG, "draft": bad_cfg}, "draft."),
        ]
        for body, prefix in cases:
            with self.assertRaises(RunConfigError, msg=repr(body)) as cm:
                self.jm.start(body)
            self.assertTrue(any(e.id.startswith(prefix) for e in cm.exception.errors), (body, cm.exception.errors))
        self.assertEqual(self.factory.workers, [])               # doğrulama başarısızsa hiçbir işçi açılmaz
        self.assertEqual(self.jm.active_workers(), 0)


class TestJobProcesses(JobBase):
    """Gerçek işçi süreçleri (fake host): PID'ler `poll` ile denetlenir; duvar saati iddiası yok."""

    def setUp(self):
        self.logdir = tempfile.mkdtemp(prefix="oyun-jlog-")
        self.addCleanup(shutil.rmtree, self.logdir, True)
        env = mock.patch.dict(os.environ, {"OYUN_HOST": "fake", "OYUN_FAKE_STEP_MS": "20"})
        env.start()
        self.addCleanup(env.stop)
        self.clients: list[WorkerClient] = []

        def spawn(spec):
            c = WorkerClient.spawn(spec, log_dir=self.logdir)
            self.clients.append(c)
            _PIDS.append(c.pid)
            return c
        self.make(spawn, pool=2)
        self.addCleanup(lambda: [c.kill() for c in self.clients])

    def running(self, jid, n=2):
        end = time.time() + 30
        while time.time() < end:
            j = self.jm.get(jid)
            if sum(m["status"] == "running" for m in j["members"]) >= n and j["progress"]["done"] > 0:
                return
            time.sleep(0.02)
        self.fail("üyeler başlamadı")

    def test_cancel_kills_members(self):
        jid = self.jm.start({"kind": "seeds", "recipe": {"config": CONFIG, "schedule": []}})
        self.running(jid)
        live = [c for c in self.clients if c.alive()]
        self.assertGreaterEqual(len(live), 1)
        self.assertLessEqual(len(live), 2)
        pids = [c.pid for c in self.clients]
        j = self.jm.cancel(jid)
        self.assertEqual(j["status"], "cancelled")
        for c in self.clients:
            self.assertFalse(c.alive(), c.pid)                   # poll() != None: ölü ve toplanmış
        self.assertTrue(all(_gone(p) for p in pids))
        self.assertEqual(self.jm.active_workers(), 0)

    def test_shutdown_kills_job_workers(self):
        jid = self.jm.start({"kind": "seeds", "recipe": {"config": CONFIG, "schedule": []}})
        self.running(jid)
        pids = [c.pid for c in self.clients]
        self.jm.shutdown()
        for c in self.clients:
            self.assertFalse(c.alive(), c.pid)
        self.assertTrue(all(_gone(p) for p in pids))
        self.assertEqual(self.jm.get(jid)["status"], "cancelled")
        with self.assertRaises(JobBusy):                         # kapanmış yönetici yeni iş almaz
            self.jm.start({"kind": "seeds", "recipe": {"config": CONFIG}})

    def test_crashed_worker_marks_member_worker_crashed(self):
        with mock.patch.dict(os.environ, {"OYUN_FAKE_CRASH_WEEK": "3"}):
            jid = self.jm.start({"kind": "ab", "a": {"config": CONFIG}, "b": {"config": CONFIG}})
            j = self.wait_status(jid)
        self.assertEqual(j["status"], "failed")
        self.assertEqual([(m["status"], m["error"]) for m in j["members"]], [("failed", "worker_crashed")] * 2)

    def test_stuck_member_fails_kills_worker_and_frees_slot(self):
        self.jm.stuck_s = 1.0
        with mock.patch.dict(os.environ, {"OYUN_FAKE_STEP_MS": "600000"}):
            jid = self.jm.start({"kind": "ab", "a": {"config": CONFIG}, "b": {"config": CONFIG}})
            j = self.wait_status(jid, timeout=60)
            self.assertEqual([(m["status"], m["error"]) for m in j["members"]], [("failed", "stuck")] * 2)
            self.assertEqual(j["status"], "failed")
            self.assertTrue(all(not c.alive() for c in self.clients))        # askıdaki işçiler öldürüldü
            jid2 = self.jm.start({"kind": "ab", "a": {"config": CONFIG}, "b": {"config": CONFIG}})   # yeni iş serbest
            self.assertNotEqual(jid, jid2)
            self.jm.cancel(jid2)

    def test_workers_niced(self):
        made = []
        fac = nice_factory(lambda spec: made.append(WorkerClient.spawn(spec, log_dir=self.logdir)) or made[-1])
        w = fac({"run_id": "nice-1", "host": "fake", "overrides": {}, "weeks": 5})
        self.addCleanup(w.kill)
        _PIDS.append(w.pid)
        self.assertGreaterEqual(os.getpriority(os.PRIO_PROCESS, w.pid), 1)


class TestJobRoutes(unittest.TestCase):
    def setUp(self):
        self.reg = real_registry()
        self.fac = Counting(step_delay=0.0)
        mgr = RunManager(self.reg, self.fac, cfg=make_cfg())
        self.app = routes.App(registry=self.reg, manager=mgr, model_version=str(real_defaults()["VERSION"]),
                              defaults_hash="abc123")
        self.app.jobs = JobManager(self.reg, self.fac, pool=2, host="fake")
        self.app.capabilities["jobs"] = True
        self.srv = make_server(0, routes.make_routes(self.app), None, set())
        self.t = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.t.start()
        mgr.start_thread()

        def stop():
            self.app.jobs.shutdown()
            mgr.shutdown()
            self.srv.shutdown()
            self.srv.server_close()
        self.addCleanup(stop)

    def wait(self, jid):
        end = time.time() + 30
        while time.time() < end:
            s, _, b = call(self.srv, "GET", "/api/jobs/" + jid)
            if b["status"] in ("done", "failed", "cancelled"):
                return b
            time.sleep(0.01)
        self.fail("bitmedi")

    def test_post_get_delete_and_shapes(self):
        s, _, b = call(self.srv, "POST", "/api/jobs", {"kind": "ab", "a": {"config": CONFIG}, "b": {"config": CONFIG}})
        self.assertEqual((s, list(b)), (201, ["jobId"]))
        job = self.wait(b["jobId"])
        self.assertEqual(set(job), {"jobId", "kind", "status", "progress", "members"})
        self.assertEqual(job["status"], "done")
        self.assertEqual(set(job["progress"]), {"done", "total"})
        for m in job["members"]:
            self.assertEqual({"label", "status", "series"} - set(m), set())
            self.assertEqual(set(m["series"]), set(SERIES))
        s, _, c = call(self.srv, "DELETE", "/api/jobs/" + b["jobId"])
        self.assertEqual((s, c["status"]), (200, "done"))        # bitmiş iş değişmez

    def test_http_errors(self):
        s, _, b = call(self.srv, "POST", "/api/jobs", {"kind": "zzz"})
        self.assertEqual((s, b["error"]["code"], b["error"]["fields"]), (422, "invalid_job", [{"id": "kind", "reason": "invalid"}]))
        s, _, b = call(self.srv, "POST", "/api/jobs", {"kind": "seeds", "recipe": {"config": dict(CONFIG, values={"yok": 1})}})
        self.assertEqual(s, 422)
        self.assertTrue(b["error"]["fields"][0]["id"].startswith("recipe."))
        for path in ("/api/jobs/job-xyz", "/api/jobs/job-00000000", "/api/jobs/..%2Fx"):
            self.assertEqual(call(self.srv, "GET", path)[0], 404, path)
            self.assertEqual(call(self.srv, "DELETE", path)[0], 404, path)

    def test_second_job_409_and_security(self):
        fac = self.app.jobs.factory = Counting(step_delay=0.02)
        body = {"kind": "seeds", "recipe": {"config": CONFIG}}
        s, _, b = call(self.srv, "POST", "/api/jobs", body)
        self.assertEqual(s, 201)
        s2, _, e = call(self.srv, "POST", "/api/jobs", body)
        self.assertEqual((s2, e["error"]["code"]), (409, "job_running"))
        self.assertEqual(e["error"]["fields"], [])
        # POST Origin/başlık kuralı aynı `check_request`'ten geçer
        bad = call(self.srv, "POST", "/api/jobs", body, headers=dict(POST))
        self.assertIn(bad[0], (403, 409))
        s3, _, c = call(self.srv, "DELETE", "/api/jobs/" + b["jobId"])
        self.assertEqual((s3, c["status"]), (200, "cancelled"))
        self.assertEqual(fac.alive(), 0)

    def test_wire_fixtures_shape(self):
        from tests.test_wire_contract import shape_diff
        s, _, b = call(self.srv, "POST", "/api/jobs", {"kind": "preview", "base": CONFIG, "draft": CONFIG})
        job = self.wait(b["jobId"])
        self.assertEqual(shape_diff(job, FIX["job_done"], "$"), [])
        self.assertEqual(shape_diff(job, FIX["job_done_failed_member"], "$"), [])      # kind farkı yalnız değer; `error` isteğe bağlı
        self.app.jobs.factory = Counting(step_delay=0.05)
        s, _, b = call(self.srv, "POST", "/api/jobs", {"kind": "preview", "base": CONFIG, "draft": CONFIG})
        end = time.time() + 20
        run = {}
        while time.time() < end:                                  # iki üye de birkaç hafta üretmiş
            run = call(self.srv, "GET", "/api/jobs/" + b["jobId"])[2]
            if all(m["weeks"] >= 1 for m in run["members"]):
                break
            time.sleep(0.01)
        self.assertEqual(run["status"], "running")
        self.assertEqual(shape_diff(run, FIX["job_running"], "$"), [])
        s2, _, e = call(self.srv, "POST", "/api/jobs", {"kind": "preview", "base": CONFIG, "draft": CONFIG})
        self.assertEqual((s2, e), (409, FIX["error_job_running"]))
        call(self.srv, "DELETE", "/api/jobs/" + b["jobId"])
        s404, _, b404 = call(self.srv, "GET", "/api/jobs/job-00000000")           # başlıklar (Date) karşılaştırılmaz
        self.assertEqual((s404, b404), (404, FIX["error_404_job"]))
        s3, _, bad = call(self.srv, "POST", "/api/jobs", {"kind": "ab", "a": {"config": dict(CONFIG, seedIndex=99)}, "b": {"config": CONFIG}})
        self.assertEqual((s3, bad), (422, FIX["error_422_job"]))


class TestCreateApp(unittest.TestCase):
    def test_create_app_enables_jobs_capability(self):
        with mock.patch.dict(os.environ, {"OYUN_HOST": "fake"}):
            app = routes.create_app(lambda spec: InProcWorker(spec, host_factory=fake_host))
        try:
            self.assertTrue(app.capabilities["jobs"])
            self.assertIsInstance(app.jobs, JobManager)
            hooks = []
            routes.register_shutdown(app, hooks)
            self.assertEqual([h.__self__ for h in hooks], [app.jobs, app.manager])
        finally:
            app.jobs.shutdown()
            app.manager.shutdown()

    def test_no_jobs_manager_no_routes(self):
        from oyun_server.http import Route
        reg = real_registry()
        mgr = RunManager(reg, lambda s: None, cfg=make_cfg())
        app = routes.App(registry=reg, manager=mgr, model_version="x", defaults_hash="y")
        self.assertFalse(app.capabilities["jobs"])
        self.assertFalse(any(r.pattern.pattern.startswith("/jobs") for r in routes.make_routes(app)))


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "yavaş: gerçek model")
class TestJobsRealModel(unittest.TestCase):
    """Tek kısa kabul: GERÇEK model, alt süreçte sunucu. 3 haftalık önizleme (iki gerçek işçi) sonra kapanışta iş işçileri ölür."""

    def test_real_preview_from_week_prefix_equals_run(self):
        """Gerçek model: taban tarif = koşunun kendisi (takvimli); ilk `fromWeek` hafta koşuyla ve taslakla birebir, taslak sonrasında ayrışabilir."""
        from tests.cli_helpers import CONFIG as RUN_CONFIG, ServerProc
        srv = ServerProc(args=["--host-kind", "model"], ready_timeout=60)
        self.addCleanup(srv.kill)
        cfg = dict(RUN_CONFIG, durationWeeks=100)
        base = dict(cfg, schedule=[{"week": 2, "patch": {"gecis_destegi": "kisa_sureli"}}])
        draft = dict(cfg, schedule=[{"week": 2, "patch": {"gecis_destegi": "kisa_sureli"}}, {"week": 3, "patch": {"ucret_stopaji": 25, "kurumlar_vergisi": 40}}])   # dikiş haftası = fromWeek (gerçek next_week değişikliği)

        def run(body):
            st, b = srv.req("POST", "/api/jobs", body)
            self.assertEqual(st, 201, b)
            end = time.monotonic() + 240
            job = {}
            while time.monotonic() < end:
                st, job = srv.req("GET", "/api/jobs/" + b["jobId"])
                if job["status"] in ("done", "failed", "cancelled"):
                    break
                time.sleep(0.5)
            self.assertEqual(job["status"], "done", job)
            return job

        j = run({"kind": "preview", "base": base, "draft": draft, "weeks": 4, "fromWeek": 3})
        ab = run({"kind": "preview", "base": base, "draft": base, "weeks": 7})                    # aynı tarifle 0. haftadan 7 hafta = koşunun ilk 7 haftası
        b, d = j["members"]
        for k in SERIES:
            self.assertEqual(len(b["series"][k]), 7, k)
            self.assertEqual(b["series"][k], ab["members"][0]["series"][k][:7], k)      # taban = koşunun kendisi
            self.assertEqual(d["series"][k][:3], b["series"][k][:3], k)                # ilk fromWeek hafta birebir
        self.assertNotEqual([d["series"][k][3:] for k in SERIES], [b["series"][k][3:] for k in SERIES])   # ayrışma dikişten sonra başlar

    def test_real_preview_then_shutdown_leaves_no_workers(self):
        from tests.cli_helpers import CONFIG as RUN_CONFIG, ServerProc, children_of, wait_gone
        srv = ServerProc(args=["--host-kind", "model"], ready_timeout=60)
        self.addCleanup(srv.kill)
        base = {k: v for k, v in RUN_CONFIG.items() if k != "durationWeeks"}
        draft = dict(base, values={"gecis_destegi": "kurtarma_fonuyla"})
        st, b = srv.req("POST", "/api/jobs", {"kind": "preview", "base": base, "draft": draft, "weeks": 3})
        self.assertEqual(st, 201, b)
        end = time.monotonic() + 240
        job = {}
        while time.monotonic() < end:
            st, job = srv.req("GET", "/api/jobs/" + b["jobId"])
            if job["status"] in ("done", "failed", "cancelled"):
                break
            time.sleep(0.5)
        self.assertEqual(job["status"], "done", job)
        for m in job["members"]:
            self.assertEqual(m["status"], "done")
            for k in SERIES:
                self.assertEqual(len(m["series"][k]), 3, k)
            self.assertIsNotNone(m["series"]["gini"][-1])
        self.assertEqual(job["progress"], {"done": 6, "total": 6})
        self.assertEqual(children_of(srv.pid), [])               # biten işin işçileri kalmadı
        st, b2 = srv.req("POST", "/api/jobs", {"kind": "seeds", "recipe": {"config": RUN_CONFIG}})
        self.assertEqual(st, 201, b2)
        end = time.monotonic() + 60
        kids = []
        while time.monotonic() < end and not kids:
            kids = children_of(srv.pid)
            time.sleep(0.1)
        self.assertTrue(kids)
        self.assertLessEqual(len(kids), 2)
        srv.stop()
        self.assertEqual(wait_gone(kids, 10), [])


if __name__ == "__main__":
    unittest.main()
