"""PLAN-CANLI son inceleme düzeltmeleri: I1 (bitişte değişiklik), M1 (hafta 0), M2 (create doğrulaması), M4 (önbellek),
M6 (günlük saklama), I4 (geçici dizin sızıntısı). Zamanlama yalnız neden-tabanlı beklemelerle (cömert tavan)."""
from __future__ import annotations

import json
import os
import shutil
import signal
import tempfile
import threading
import time
import unittest
from pathlib import Path

from oyun_server import config
from oyun_server.registry.schema import RunConfigError
from oyun_server.runs.manager import DURATION, RunManager, _Pending
from oyun_server.sim.client import WorkerClient, prune_logs

from tests.cli_helpers import CONFIG as CLI_CONFIG, ServerProc
from tests.registry_helpers import real_registry
from tests.test_manager import CONFIG, ManagerBase, drain, make_cfg

CAP = 30.0


class EndAndWeekZero(ManagerBase):
    fail_week = None

    def run_change(self, rid, patch):
        res = {}
        t = threading.Thread(target=lambda: res.update(r=self.mgr.apply_change(rid, patch, None, timeout=CAP)))
        t.start()
        end = time.time() + CAP
        while t.is_alive() and time.time() < end:
            self.mgr.pump(self.clock.t)
            time.sleep(0.002)
        t.join(CAP)
        if "r" not in res:
            self.fail("apply_change dönmedi")
        return res["r"]

    def test_change_after_frontier_reached_end_rejected(self):
        m = self.make(cfg=make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0}))
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 198, timeout=CAP)
        m.control(rid, "pause", None)
        self.pump_until(lambda: m.stats(rid)["worker_week"] >= DURATION, timeout=CAP)
        drain(sub)
        r = self.run_change(rid, {"gecis_destegi": "kisa_sureli"})
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "*", "reason": "ended"}]})
        run = m._runs[rid]
        self.assertEqual(run.accepted_version, 1)
        self.assertEqual(m.get(rid)["state"]["version"], 1)
        self.assertFalse(m.get(rid)["state"]["computing"])
        self.assertEqual([e for e, _ in drain(sub) if e == "world_event"], [])
        self.assertEqual(self.hosts[0].patch_calls, [])          # işçiye hiç gitmedi

    def test_patched_event_at_end_seam_is_rejected_without_version(self):
        m = self.make()
        rid, _ = self.new_run()
        run = m._runs[rid]
        sub = m.subscribe(rid)
        drain(sub)
        pc = _Pending({"TRANS_SUPPORT": 1}, {"gecis_destegi": "kisa_sureli"}, 2)
        pc.sent = True
        run.pending, run.computing = pc, True
        m._patched(run, {"ev": "patched", "from_week": DURATION, "version": 2}, self.clock.t)
        self.assertTrue(pc.done.is_set())
        self.assertEqual(pc.result, {"accepted": False, "fields": [{"id": "*", "reason": "ended"}]})
        self.assertEqual(run.accepted_version, 1)
        self.assertEqual(sorted(run.version_sets), [1])
        self.assertEqual([e for e, _ in drain(sub) if e == "world_event"], [])

    def test_week_zero_change_does_not_bump_version(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        drain(sub)
        r = self.run_change(rid, {"gecis_destegi": "kisa_sureli"})
        self.assertEqual((r["accepted"], r["seamWeek"], r["version"]), (True, 0, 1), r)
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"]["gecis_destegi"]), (1, "kisa_sureli"))
        self.assertEqual([e for e, _ in drain(sub) if e == "world_event"], [])
        self.assertEqual(self.hosts[0].patch_calls, [{"TRANS_SUPPORT": 1}])
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 5, timeout=CAP)
        pk = [d["version"] for e, d in drain(sub) if e == "week"]
        self.assertEqual(set(pk), {1})
        self.assertEqual(m.get(rid)["state"]["version"], 1)
        r2 = self.run_change(rid, {"gecis_destegi": "kapali"})   # sonraki değişiklik hâlâ 2. sürüm olur
        self.assertEqual((r2["accepted"], r2["version"]), (True, 2), r2)

    def test_play_then_change_before_first_week_keeps_version_one(self):
        """N1: Oynat'tan sonra ilk hafta gelmeden değişiklik: gerçek dikiş 0 -> sürüm 1, olay yok, paketler v1."""
        self.block_init = True                       # işçi kurulurken (hafta 0) değişiklik gelsin
        m = self.make(cfg=make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0}))
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        drain(sub)
        m.control(rid, "play", 16)
        for _ in range(5):
            m.pump(self.clock.t)
        run = m._runs[rid]
        self.assertGreater(run.target, 0)
        self.assertEqual(run.worker_week, 0)
        res = {}
        t = threading.Thread(target=lambda: res.update(r=m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, None, timeout=CAP)))
        t.start()
        for _ in range(20):
            m.pump(self.clock.t)
            time.sleep(0.005)
        self.hold.set()
        end = time.time() + CAP
        while t.is_alive() and time.time() < end:
            m.pump(self.clock.t)
            time.sleep(0.002)
        t.join(CAP)
        r = res["r"]
        self.assertEqual((r["accepted"], r["seamWeek"], r["version"]), (True, 0, 1), r)
        self.pump_until(lambda: m.stats(rid)["released"] >= 10, timeout=CAP)
        evs = drain(sub)
        self.assertEqual({d["version"] for e, d in evs if e == "week"}, {1})
        self.assertEqual([e for e, _ in evs if e == "world_event"], [])
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"]["gecis_destegi"]), (1, "kisa_sureli"))
        self.assertEqual((run.accepted_version, sorted(run.version_sets)), (1, [1]))
        res2 = {}
        t2 = threading.Thread(target=lambda: res2.update(r=m.apply_change(rid, {"gecis_destegi": "kapali"}, None, timeout=CAP)))
        t2.start()
        end = time.time() + CAP
        while t2.is_alive() and time.time() < end:
            m.pump(self.clock.t)
            time.sleep(0.002)
        t2.join(CAP)
        r2 = res2["r"]
        self.assertEqual((r2["accepted"], r2["version"]), (True, 2), r2)
        self.assertGreater(r2["seamWeek"], 0)
        self.pump_until(lambda: m.stats(rid)["released"] >= r2["seamWeek"] + 5, timeout=CAP)
        evs = drain(sub)
        vids = [d["id"] for e, d in evs if e == "world_event" and d["textKey"] == "event.version"]
        self.assertEqual(len(vids), 1)
        self.assertTrue(vids[0].startswith("version:2:%d:" % r2["seamWeek"]), vids)
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"]["gecis_destegi"]), (2, "kapali"))
        r3 = self.run_change(rid, {"gecis_destegi": "kisa_sureli"})
        self.assertEqual((r3["accepted"], r3["version"]), (True, 3), r3)


class CreateValidation(ManagerBase):
    def test_bad_names_and_cities_rejected(self):
        m = self.make()
        for bad in ({"cityNames": 5}, {"cityNames": "abc"}, {"cityNames": [1, 2]}, {"cityNames": list("abcdef")},
                    {"name": {"a": 1}}, {"name": "x" * 65}, {"name": 7}):
            with self.subTest(bad=bad), self.assertRaises(RunConfigError):
                m.create(dict(CONFIG, **bad))
        self.assertEqual(self.workers, [])
        m.create(dict(CONFIG, cityNames=[], name=""))            # boş olanlar serbest


class DecisionsCached(ManagerBase):
    def test_decisions_and_live_keys_read_once(self):
        calls = {"d": 0, "k": 0}

        def dec():
            calls["d"] += 1
            return {"lookahead": 2, "seam_mode": "frontier", "max_runs": 3}

        def keys(reg=None):
            calls["k"] += 1
            return config.load_live_keys(reg)

        m = self.make(cfg=make_cfg(load_decisions=dec, load_live_keys=keys))
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        for _ in range(20):
            m.pump(self.clock.t)
        self.run_change = EndAndWeekZero.run_change.__get__(self)
        self.assertTrue(self.run_change(rid, {"gecis_destegi": "kisa_sureli"})["accepted"])
        self.assertLessEqual(calls["d"], 1, calls)
        self.assertLessEqual(calls["k"], 1, calls)


class LogRetention(unittest.TestCase):
    def test_prune_keeps_newest(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(12):
                p = Path(d) / ("canli-%02d.err" % i)
                p.write_text("x")
                os.utime(p, (1000 + i, 1000 + i))
            (Path(d) / "canli-00.err.1").write_text("y")
            os.utime(Path(d) / "canli-00.err.1", (1000, 1000))
            prune_logs(Path(d), keep=5)
            left = sorted(p.name for p in Path(d).iterdir())
            self.assertEqual(left, ["canli-%02d.err" % i for i in range(7, 12)])


class CsvDirOwnership(unittest.TestCase):
    """Ebeveyn CSV dizinini oluşturur, spec ile verir, kill()'de siler (SIGKILL'e dayanıklı)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="oyun-fx-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.old_tmpdir = tempfile.tempdir
        tempfile.tempdir = self.tmp
        self.addCleanup(setattr, tempfile, "tempdir", self.old_tmpdir)

    def hostdirs(self):
        return [p for p in os.listdir(self.tmp) if p.startswith("oyun-host-")]

    def spawn(self):
        spec = {"run_id": "canli-fx", "host": "fake", "overrides": {}, "weeks": 200}
        c = WorkerClient.spawn(spec, log_dir=Path(self.tmp) / "logs", extra_env={"TMPDIR": self.tmp})
        self.addCleanup(c.kill)
        return spec, c

    def test_spec_gets_dir_and_kill_removes_it(self):
        spec, c = self.spawn()
        d = spec["csv_dir"]
        self.assertTrue(os.path.isdir(d))
        self.assertEqual(self.hostdirs(), [os.path.basename(d)])
        c.kill()
        self.assertFalse(os.path.exists(d))
        self.assertEqual(self.hostdirs(), [])

    def test_sigkilled_worker_dir_removed_by_kill(self):
        spec, c = self.spawn()
        os.kill(c.pid, signal.SIGKILL)
        c.wait(10)
        c.kill()
        self.assertEqual(self.hostdirs(), [])

    def test_stop_is_graceful_and_removes_dir(self):
        spec, c = self.spawn()
        c.send(dict(spec, cmd="init"))
        ev = next(c.events(CAP))
        self.assertEqual(ev["ev"], "ready")
        c.stop(5)
        self.assertEqual(self.hostdirs(), [])


class SigintLeak(unittest.TestCase):
    """Gerçek sunucu + canlı koşu açıkken SIGINT: özel TMPDIR'da `oyun-host-*`/`oyun-wlog-*` kalmaz."""

    def leaks(self, tmp):
        return sorted(p for p in os.listdir(tmp) if p.startswith(("oyun-host-", "oyun-wlog-")))

    def run_case(self, host_kind):
        tmp = tempfile.mkdtemp(prefix="oyun-sig-")
        self.addCleanup(shutil.rmtree, tmp, True)
        srv = ServerProc(args=["--host-kind", host_kind], env_extra={"TMPDIR": tmp})
        try:
            rid = srv.create_run(dict(CLI_CONFIG))
            s, b = srv.req("POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
            self.assertEqual(s, 200)
            end = time.time() + CAP
            while time.time() < end and not self.leaks(tmp):
                time.sleep(0.05)
            self.assertTrue(self.leaks(tmp), "çalışırken CSV dizini görünmeli (ebeveyn oluşturur)")
            self.assertEqual(srv.stop(signal.SIGINT, timeout=CAP), 0, srv.output())
        finally:
            srv.kill()
        self.assertEqual(self.leaks(tmp), [])

    def test_sigint_fake_host_leaves_no_temp_dirs(self):
        self.run_case("fake")

    @unittest.skipIf(os.environ.get("OYUN_QUICK"), "gerçek model")
    def test_sigint_real_model_leaves_no_temp_dirs(self):
        self.run_case("model")


if __name__ == "__main__":
    unittest.main()
