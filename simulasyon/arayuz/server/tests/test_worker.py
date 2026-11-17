"""A5: NDJSON işçi süreci ve WorkerClient. Her yolda çocuk süreçler temizlenir ve hiçbiri kalmadığı doğrulanır."""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from oyun_server import config
from oyun_server.config import MODEL_ROOT, SERVER_ROOT
from oyun_server.sim.client import WorkerClient

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
    leftovers = []
    deadline = time.time() + 3
    for pid in _PIDS:
        while not _gone(pid) and time.time() < deadline:
            time.sleep(0.05)
        if not _gone(pid):
            leftovers.append(pid)
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    assert not leftovers, "artakalan işçi süreçler: %s" % leftovers


class WorkerBase(unittest.TestCase):
    def setUp(self):
        self._logdir = tempfile.mkdtemp(prefix="oyun-wlog-")
        self.addCleanup(shutil.rmtree, self._logdir, True)

    def spawn(self, spec=None, extra_env=None):
        spec = dict({"host": "fake", "overrides": {}, "weeks": 200}, **(spec or {}))
        c = WorkerClient.spawn(spec, extra_env=extra_env, log_dir=self._logdir)
        c.spec = spec
        _PIDS.append(c.pid)
        self.addCleanup(c.kill)
        return c

    def init(self, c, **spec):
        c.send(dict({"cmd": "init", "overrides": {}, "weeks": 200, "host": "fake"}, **spec))
        ev = next(c.events(10))
        self.assertEqual(ev["ev"], "ready", ev)
        return ev

    def collect(self, c, n, timeout=10):
        out = []
        for ev in c.events(timeout):
            out.append(ev)
            if len(out) >= n:
                break
        return out


class ProtocolTests(WorkerBase):
    def test_ready_reports_hashseed_zero(self):
        c = self.spawn()
        ev = self.init(c)
        self.assertEqual(ev["hashseed"], "0")
        self.assertEqual(ev["model_version"], "fake")

    def test_target_computes_up_to_and_stops(self):
        c = self.spawn()
        self.init(c)
        c.send({"cmd": "target", "week": 3})
        evs = self.collect(c, 3)
        self.assertEqual([e["week"] for e in evs], [1, 2, 3])
        self.assertTrue(all(e["ev"] == "week" and e["version"] == 0 and "hafta" in e["row"] for e in evs))
        self.assertEqual(list(c.events(0.4)), [])           # hedefte durur
        c.send({"cmd": "target", "week": 5})
        self.assertEqual([e["week"] for e in self.collect(c, 2)], [4, 5])

    def test_firms_embedded_in_week_event_only_when_requested(self):
        c = self.spawn()
        self.init(c, firms=True)
        c.send({"cmd": "target", "week": 21})
        evs = self.collect(c, 21)
        self.assertEqual([e["ev"] for e in evs], ["week"] * 21)           # ayrı firms olayı yok (yarış yapısal olarak yok)
        # Görev 7 sözleşmesi: işçi Kurucu'da firma satırını HER hafta üretir; tam harita (1./10'un katı/son hafta) ile aradaki
        # haritaFark ayrımı yöneticide yapılır (tests/test_harita_paketi.py haftaları tek tek sınar).
        self.assertEqual([e["week"] for e in evs if "firms" in e], list(range(1, 22)))
        self.assertTrue(all(isinstance(e["firms"], list) for e in evs))
        c2 = self.spawn()
        self.init(c2)                                                      # bayrak yok (jobs işçileri): firma anlık görüntüsü yok
        c2.send({"cmd": "target", "week": 21})
        self.assertFalse(any("firms" in e for e in self.collect(c2, 21)))

    def test_firms_on_last_week(self):
        c = self.spawn({"weeks": 7})
        self.init(c, firms=True, weeks=7)
        c.send({"cmd": "target", "week": 7})
        evs = self.collect(c, 7)
        self.assertEqual([e["week"] for e in evs if "firms" in e], list(range(1, 8)))     # her hafta (son hafta dahil); tam/fark ayrımı yöneticide
        self.assertEqual([e["week"] for e in evs if "firms" in e][-1], 7)

    def test_patch_between_steps(self):
        c = self.spawn()
        self.init(c)
        c.send({"cmd": "target", "week": 40})
        c.send({"cmd": "patch", "overrides": {"WAGE_TAX": 0.25}, "version": 7})
        evs = self.collect(c, 41)
        patched = [e for e in evs if e["ev"] == "patched"]
        self.assertEqual(len(patched), 1)
        p = patched[0]
        self.assertEqual(p["version"], 1 if p["from_week"] == 0 else 7)   # dikiş 0: başlangıç kuralı, sürüm 1
        weeks = [e for e in evs if e["ev"] == "week"]
        self.assertEqual([w["week"] for w in weeks], list(range(1, 41)))  # yarım/çift adım yok
        for w in weeks:
            self.assertEqual(w["version"], p["version"] if w["week"] > p["from_week"] else 0)
        idx = evs.index(p)
        self.assertEqual(sum(1 for e in evs[:idx] if e["ev"] == "week"), p["from_week"])

    def test_patch_at_week_zero_pins_version_one(self):
        c = self.spawn()
        self.init(c)
        c.send({"cmd": "patch", "overrides": {"WAGE_TAX": 0.25}, "version": 2})
        self.assertEqual(next(c.events(5)), {"ev": "patched", "from_week": 0, "version": 1})
        c.send({"cmd": "target", "week": 2})
        self.assertEqual({e["version"] for e in self.collect(c, 2)}, {1})

    def test_patch_when_idle_reports_current_week(self):
        c = self.spawn()
        self.init(c)
        c.send({"cmd": "target", "week": 2})
        self.collect(c, 2)
        c.send({"cmd": "patch", "overrides": {"A": 1}, "version": 1})
        ev = next(c.events(5))
        self.assertEqual(ev, {"ev": "patched", "from_week": 2, "version": 1})
        c.send({"cmd": "target", "week": 3})
        ev = next(c.events(5))
        self.assertEqual((ev["week"], ev["version"]), (3, 1))

    def test_model_crash_reports_failed(self):
        c = self.spawn(extra_env={"OYUN_FAKE_FAIL_WEEK": "3"})
        self.init(c)
        c.send({"cmd": "target", "week": 10})
        evs = self.collect(c, 3)
        self.assertEqual([(e["ev"], e.get("week")) for e in evs], [("week", 1), ("week", 2), ("failed", 3)])
        self.assertTrue(evs[2]["error"].startswith("KeyError"))
        self.assertIsNotNone(c.wait(5))
        self.assertFalse(c.alive())

    def test_stray_print_does_not_corrupt_protocol(self):
        c = self.spawn(extra_env={"OYUN_FAKE_PRINT": "gurultu {\"ev\":\"week\"}"})
        self.init(c)
        c.send({"cmd": "target", "week": 4})
        evs = self.collect(c, 4)
        self.assertEqual([e["week"] for e in evs], [1, 2, 3, 4])
        self.assertEqual(c.bad_lines, 0)
        self.assertIn("gurultu", Path(c.log_path).read_text(errors="replace"))

    def test_parent_close_terminates(self):
        c = self.spawn()
        self.init(c)
        c.close_stdin()
        self.assertIsNotNone(c.wait(5))
        self.assertFalse(c.alive())

    def test_parent_death_terminates_worker(self):
        code = (
            "import sys,os\n"
            "from oyun_server.sim.client import WorkerClient\n"
            "spec={'host':'fake','overrides':{},'weeks':5}\n"
            "c=WorkerClient.spawn(spec)\n"
            "c.send(dict(spec,cmd='init'))\n"                # ebeveyn ölünce csv_dir'i işçi (host.close) siler
            "next(c.events(10))\n"
            "print(c.pid,flush=True)\n"
            "os._exit(0)\n"
        )
        env = dict(os.environ, PYTHONPATH=str(SERVER_ROOT), OYUN_LOG_DIR=self._logdir)
        p = subprocess.run([sys.executable, "-P", "-c", code], env=env, cwd=str(SERVER_ROOT),
                           capture_output=True, text=True, timeout=30)
        pid = int(p.stdout.strip().splitlines()[-1])
        _PIDS.append(pid)
        self.addCleanup(lambda: None if _gone(pid) else os.kill(pid, signal.SIGKILL))
        deadline = time.time() + 5
        while not _gone(pid) and time.time() < deadline:
            time.sleep(0.05)
        self.assertTrue(_gone(pid), "ebeveyn ölünce işçi yetim kaldı")

    def test_kill_idempotent_no_zombie(self):
        c = self.spawn()
        self.init(c)
        pid = c.pid
        c.kill()
        c.kill()
        self.assertFalse(c.alive())
        self.assertTrue(_gone(pid))                        # wait edildi: zombi yok
        self.assertEqual(list(c.events(0.2)), [])
        with self.assertRaises(OSError):
            c.send({"cmd": "target", "week": 1})

    def test_unknown_cmd_fails_closed(self):
        c = self.spawn()
        self.init(c)
        c.send({"cmd": "frobnicate"})
        ev = next(c.events(5))
        self.assertEqual(ev, {"ev": "failed", "error": "bad_cmd"})
        self.assertIsNotNone(c.wait(5))

    def test_cmd_before_init_and_garbage_fail_closed(self):
        c = self.spawn()
        c.send({"cmd": "target", "week": 1})
        self.assertEqual(next(c.events(5))["error"], "bad_cmd")
        c.wait(5)
        c2 = self.spawn()
        c2._proc.stdin.write(b"not json\n")
        c2._proc.stdin.flush()
        self.assertEqual(next(c2.events(5))["error"], "bad_cmd")

    def test_shutdown_exits_cleanly(self):
        c = self.spawn()
        self.init(c)
        c.send({"cmd": "shutdown"})
        self.assertEqual(c.wait(5), 0)

    def test_stderr_flood_does_not_block(self):
        c = self.spawn(extra_env={"OYUN_FAKE_STDERR_KB": "1024"})
        self.init(c)
        c.send({"cmd": "target", "week": 3})
        self.assertEqual([e["week"] for e in self.collect(c, 3)], [1, 2, 3])
        c.kill()
        total = sum(f.stat().st_size for f in Path(self._logdir).glob("*.err*"))
        self.assertLessEqual(total, 1024 * 1024)
        self.assertGreater(total, 0)

    def test_env_whitelist(self):
        old = {k: os.environ.get(k) for k in ("DBGF", "SDUMP", "MODEL_PARAMS")}
        for k in old:
            os.environ[k] = "x"
        self.addCleanup(lambda: [os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
                                 for k, v in old.items()])
        env = config.child_env({"PYTHONHASHSEED": "0"})
        for k in old:
            self.assertNotIn(k, env)
        self.assertEqual(env["PYTHONPATH"], str(SERVER_ROOT))
        c = self.spawn()
        ev = self.init(c)
        self.assertEqual(ev.get("env_leak", []), [])

    def test_unwritable_log_does_not_deadlock(self):
        blocker = Path(self._logdir) / "dosya"
        blocker.write_text("x")
        c = WorkerClient.spawn({"run_id": "r", "host": "fake"}, extra_env={"OYUN_FAKE_STDERR_KB": "1024"},
                               log_dir=blocker)            # log_dir bir dosya: açılamaz
        _PIDS.append(c.pid)
        self.addCleanup(c.kill)
        self.init(c)
        c.send({"cmd": "target", "week": 2})
        self.assertEqual([e["week"] for e in self.collect(c, 2)], [1, 2])

    def test_stop_graceful(self):
        c = self.spawn()
        self.init(c)
        c.stop(5)
        self.assertFalse(c.alive())
        self.assertEqual(c._proc.returncode, 0)             # kill değil, EOF ile temiz çıkış
        c.stop(1)                                            # yinelenebilir

    def test_eof_vs_timeout(self):
        c = self.spawn()
        self.init(c)
        self.assertEqual(list(c.events(0.2)), [])
        self.assertFalse(c.eof)                              # zaman aşımı
        c.send({"cmd": "shutdown"})
        self.assertEqual(list(c.events(5)), [])
        self.assertTrue(c.eof)                               # EOF, beklenen çıkış: yapay olay yok

    def test_hard_crash_yields_synthetic_failed(self):
        c = self.spawn(extra_env={"OYUN_FAKE_CRASH_WEEK": "2"})
        self.init(c)
        c.send({"cmd": "target", "week": 5})
        evs = list(c.events(10))
        self.assertEqual([(e["ev"], e.get("week")) for e in evs[:1]], [("week", 1)])
        last = evs[-1]
        self.assertEqual((last["ev"], last["error"]), ("failed", "exit"))
        self.assertEqual(last["reason"], "exit")
        self.assertTrue(c.eof)
        self.assertEqual(sum(1 for e in evs if e["ev"] == "failed"), 1)

    def test_worker_ignores_sigint(self):
        c = self.spawn()
        self.init(c)
        os.kill(c.pid, signal.SIGINT)
        time.sleep(0.3)
        self.assertTrue(c.alive())
        c.send({"cmd": "target", "week": 1})
        self.assertEqual(next(c.events(5))["week"], 1)

    def test_new_session(self):
        c = self.spawn()
        self.init(c)
        self.assertEqual(os.getpgid(c.pid), c.pid)
        self.assertNotEqual(os.getpgid(c.pid), os.getpgid(0))


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "yavaş")
class ModelWorkerTests(WorkerBase):
    def test_real_model_three_weeks(self):
        c = self.spawn({"host": "model", "model_root": str(MODEL_ROOT)})
        c.send(dict(c.spec, cmd="init"))                      # spec csv_dir'i taşır (kill'de ebeveyn siler)
        ev = next(c.events(60))
        self.assertEqual(ev["ev"], "ready", ev)
        self.assertNotIn(ev["model_version"], ("", "fake", "?"))
        c.send({"cmd": "target", "week": 3})
        evs = self.collect(c, 3, timeout=60)
        self.assertEqual([e["week"] for e in evs], [1, 2, 3])

    def test_stop_removes_host_tempdir(self):
        tmp = Path(tempfile.gettempdir())
        before = set(tmp.glob("oyun-host-*"))
        c = self.spawn({"host": "model", "model_root": str(MODEL_ROOT)})
        c.send(dict(c.spec, cmd="init"))                      # spec csv_dir'i taşır (kill'de ebeveyn siler)
        self.assertEqual(next(c.events(60))["ev"], "ready")
        self.assertTrue(set(tmp.glob("oyun-host-*")) - before)   # çalışırken var
        c.stop(10)
        self.assertEqual(set(tmp.glob("oyun-host-*")) - before, set())


class InProcWorkerTests(unittest.TestCase):
    def test_same_interface_and_gated_steps(self):
        import threading
        from oyun_server.testing import InProcWorker
        gate = threading.Semaphore(0)
        w = InProcWorker({"host": "fake"}, sleep=lambda s: gate.acquire(timeout=5), step_delay=1.0)
        self.addCleanup(w.kill)
        w.send({"cmd": "init", "overrides": {}, "weeks": 10, "host": "fake"})
        self.assertEqual(next(w.events(5))["ev"], "ready")
        w.send({"cmd": "target", "week": 2})
        self.assertEqual(list(w.events(0.2)), [])           # kapı kapalı: adım yok
        gate.release()
        self.assertEqual(next(w.events(5))["week"], 1)
        gate.release()
        self.assertEqual(next(w.events(5))["week"], 2)
        self.assertTrue(w.alive())
        w.send({"cmd": "shutdown"})
        deadline = time.time() + 5
        while w.alive() and time.time() < deadline:
            time.sleep(0.01)
        self.assertFalse(w.alive())
        w.kill()
        w.kill()

    def test_stop(self):
        from oyun_server.testing import InProcWorker
        w = InProcWorker({"host": "fake"})
        w.send({"cmd": "init", "overrides": {}, "weeks": 10, "host": "fake"})
        self.assertEqual(next(w.events(5))["ev"], "ready")
        w.stop(5)
        self.assertFalse(w.alive())
        self.assertTrue(w.eof or list(w.events(0.2)) == [])


if __name__ == "__main__":
    unittest.main()
