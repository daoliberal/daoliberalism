"""S2: koşu tarifi (config + sürüm takvimi), hızlı yeniden kurma (`ff`), hazırlık (`preparing`), çoklu koşu.

Sahte işçi (FakeHost) ve süreç içi işçi; gerçek model yalnız `TestRealModelRebuild` (tek kabul testi, `OYUN_QUICK` dışında).
"""
from __future__ import annotations

import os
import queue
import shutil
import tempfile
import threading
import time
import unittest
from unittest import mock

from oyun_server import config
from oyun_server.runs import recipe
from oyun_server.runs.manager import BusyPreparing, RunManager, TooManyRuns
from oyun_server.sim.client import WorkerClient
from oyun_server.sim.worker import Session
from oyun_server.testing import FakeHost

from tests.registry_helpers import real_registry
from tests.route_helpers import CONFIG as ROUTE_CONFIG, call, create_run, live_app
from tests.test_manager import CONFIG, ManagerBase, drain, make_cfg

PATCH = {"gecis_destegi": "kisa_sureli"}


def strip(pkt: dict) -> dict:
    return {k: v for k, v in pkt.items() if k != "run_id"}


class RecipeBase(ManagerBase):
    def played(self, m, rid, n, speed=16):
        m.control(rid, "play", speed)
        self.pump_until(lambda: m.stats(rid)["released"] >= n)
        m.control(rid, "pause", None)

    def change(self, rid, patch):
        res = {}
        t = threading.Thread(target=lambda: res.update(r=self.mgr.apply_change(rid, patch, None, timeout=30)))
        t.start()
        end = time.time() + 30
        while t.is_alive() and time.time() < end:
            self.mgr.pump(self.clock.t)
            time.sleep(0.002)
        t.join(30)
        return res["r"]

    def prepared(self, rid):
        self.pump_until(lambda: "preparing" not in self.mgr.get(rid)["state"], 60)


class TestRebuild(RecipeBase):
    def test_recipe_rebuild_equals_original(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        a, _ = self.new_run()
        self.played(m, a, 6)
        res = self.change(a, PATCH)
        self.assertTrue(res["accepted"], res)
        seam = res["seamWeek"]
        self.assertGreaterEqual(seam, 6)
        self.played(m, a, 12)
        orig = m.weeks(a, 1, 12)
        self.assertEqual([p["week"] for p in orig], list(range(1, 13)))
        self.assertEqual({p["version"] for p in orig}, {1, 2})
        h = m.create(dict(CONFIG), [{"week": seam, "patch": PATCH}], 12)
        b = h["runId"]
        self.assertEqual(h["state"]["preparing"], {"done": 0, "total": 12})
        self.assertEqual(h["state"]["status"], "paused")
        self.prepared(b)
        self.assertEqual([strip(p) for p in m.weeks(b, 1, 12)], [strip(p) for p in orig])
        # sürüm olayı da aynı (kimlik, hafta, değişiklikler)
        ev_a = [e for e in m._runs[a].vevents if e["week"] <= 12]
        ev_b = list(m._runs[b].vevents)
        self.assertEqual(ev_b, ev_a)
        st = m.get(b)["state"]
        self.assertEqual((st["week"], st["status"], st["version"]), (12, "paused", 2))
        self.assertEqual(st["values"], m.get(a)["state"]["values"])

    def test_recipe_week0_patch_folds_into_setup(self):
        m = self.make()
        h = m.create(dict(CONFIG), [{"week": 0, "patch": {"gecis_destegi": "kurtarma_fonuyla"}}], 3)
        self.prepared(h["runId"])
        self.assertEqual(m.get(h["runId"])["state"]["values"]["gecis_destegi"], "kurtarma_fonuyla")
        self.assertEqual(m.get(h["runId"])["state"]["version"], 1)
        self.assertEqual(self.hosts[0].patch_calls, [])          # kuruluşa katıldı, yama değil
        self.assertEqual(m._runs[h["runId"]].version_sets[1]["gecis_destegi"], "kurtarma_fonuyla")

    def test_schedule_without_ff_applies_on_the_fly_and_blocks_live_change(self):
        m = self.make()
        h = m.create(dict(CONFIG), [{"week": 3, "patch": PATCH}])
        rid = h["runId"]
        self.assertNotIn("preparing", h["state"])                 # ff yok: önden hesap yok
        self.assertEqual(m.apply_change(rid, {"gecis_destegi": "kapali"}, None)["fields"], [{"id": "*", "reason": "busy"}])
        self.played(m, rid, 6)
        self.assertEqual([c["to"] for e in m._runs[rid].vevents for c in e["changes"]], ["kisa_sureli"])
        self.assertEqual({p["week"]: p["version"] for p in m.weeks(rid, 1, 6)}, {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2})
        self.assertTrue(self.change(rid, {"gecis_destegi": "kapali"})["accepted"])    # takvim bitti: canlı yama serbest

    def test_two_patches_same_seam_keep_two_versions(self):
        m = self.make()
        rid = m.create(dict(CONFIG), [{"week": 2, "patch": PATCH}, {"week": 2, "patch": {"gecis_destegi": "kapali"}}], 5)["runId"]
        self.prepared(rid)
        self.assertEqual([p["version"] for p in m.weeks(rid, 1, 5)], [1, 1, 3, 3, 3])
        self.assertEqual(m.get(rid)["state"]["values"]["gecis_destegi"], "kapali")


class TestFastForward(RecipeBase):
    def test_fast_forward_progress_and_paused(self):
        m = self.make()
        h = m.create(dict(CONFIG), None, 25)
        rid = h["runId"]
        sub = m.subscribe(rid)
        self.assertEqual(h["state"]["preparing"], {"done": 0, "total": 25})
        self.prepared(rid)
        evs = drain(sub)
        dones = [d["preparing"]["done"] for e, d in evs if e == "state" and "preparing" in d]
        self.assertEqual(dones[0], 0)
        self.assertIn(10, dones)
        self.assertIn(20, dones)
        self.assertEqual(dones, sorted(dones))
        self.assertEqual([d["week"] for e, d in evs if e == "week"], list(range(1, 26)))
        st = m.get(rid)["state"]
        self.assertEqual((st["status"], st["week"], st["computing"]), ("paused", 25, False))
        self.assertNotIn("preparing", st)
        m.control(rid, "step", None)                               # sonra normal oynatılır
        self.pump_until(lambda: m.get(rid)["state"]["week"] == 26)

    def test_controls_and_changes_wait_while_preparing(self):
        m = self.make(gated=True)
        rid = m.create(dict(CONFIG), None, 5)["runId"]
        st = m.control(rid, "play", 16)
        self.assertEqual(st["status"], "paused")
        self.assertEqual(m.apply_change(rid, PATCH, None)["fields"], [{"id": "*", "reason": "busy"}])
        self.gate.release(50)
        self.prepared(rid)
        self.assertEqual(m.get(rid)["state"]["week"], 5)

    def test_ff_to_duration_ends_run(self):
        m = self.make()
        rid = m.create(dict(CONFIG, durationWeeks=100), None, 100)["runId"]
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", 60)
        self.assertEqual(m.get(rid)["state"]["week"], 100)

    def test_second_preparing_409(self):
        m = self.make(gated=True)
        m.create(dict(CONFIG), None, 5)
        with self.assertRaises(BusyPreparing):
            m.create(dict(CONFIG), None, 5)
        self.assertEqual(len(m.list_runs()), 1)
        h = m.create(dict(CONFIG))                                 # hazırlık değilse serbest
        self.assertNotIn("preparing", h["state"])
        with self.assertRaises(BusyPreparing):
            m.branch(h["runId"], 2, None)
        self.gate.release(50)

    def test_preparing_slot_frees_after_completion(self):
        m = self.make()
        a = m.create(dict(CONFIG), None, 3)["runId"]
        self.prepared(a)
        b = m.create(dict(CONFIG), None, 3)["runId"]
        self.prepared(b)

    def test_delete_during_preparing_kills_worker(self):
        with mock.patch.dict(os.environ, {"OYUN_FAKE_STEP_MS": "40"}):
            m = self.make()
            rid = m.create(dict(CONFIG), None, 100)["runId"]
            self.pump_until(lambda: m.stats(rid)["worker_week"] >= 2)
            sub = m.subscribe(rid)
            m.delete(rid)
            self.assertIsNone(m.get(rid))
            self.assertFalse(self.workers[0].alive())
            self.assertLess(self.hosts[0].week, 100)                 # hesap yarıda kesildi
            self.assertEqual(drain(sub)[-1], ("__closed__", {}))
            b = m.create(dict(CONFIG), None, 2)["runId"]             # hazırlık yuvası boşaldı
            self.prepared(b)

    def test_ff_failure_marks_run_failed(self):
        self.fail_week = 4
        m = self.make()
        rid = m.create(dict(CONFIG), None, 8)["runId"]
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "failed")
        st = m.get(rid)["state"]
        self.assertNotIn("preparing", st)
        self.assertEqual(st["error"]["week"], 4)
        m.create(dict(CONFIG), None, 3)                            # hazırlık yuvası serbest


class TestMaxRuns(RecipeBase):
    def test_max_runs_default_is_three(self):
        self.assertEqual(config.MAX_RUNS, 3)
        self.assertEqual(config.load_decisions()["max_runs"], 3)

    def test_max_runs_eviction_and_429(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        a, b, c = (self.new_run()[0] for _ in range(3))
        subs = {a: m.subscribe(a)}
        d, _ = self.new_run()                                      # abonesiz en eski (b) çıkar
        self.assertIsNone(m.get(b))
        self.assertEqual([r["runId"] for r in m.list_runs()], [a, c, d])
        self.assertFalse(self.workers[1].alive())
        self.assertTrue(self.workers[0].alive())
        subs[c], subs[d] = m.subscribe(c), m.subscribe(d)
        before = len(self.workers)
        with self.assertRaises(TooManyRuns):
            self.new_run()
        self.assertEqual(len(self.workers), before)               # işçi bile başlatılmadı
        self.assertEqual([r["runId"] for r in m.list_runs()], [a, c, d])
        subs[c].close()                                            # biri bırakılınca yer açılır
        e, _ = self.new_run()
        self.assertIsNone(m.get(c))
        self.assertEqual([r["runId"] for r in m.list_runs()], [a, d, e])

    def test_ended_run_without_subscribers_is_evictable(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=1))
        a = m.create(dict(CONFIG, durationWeeks=100), None, 100)["runId"]
        self.pump_until(lambda: m.get(a)["state"]["status"] == "ended", 60)
        b, _ = self.new_run()
        self.assertIsNone(m.get(a))

    def test_list_runs_in_creation_order(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        ids = [self.new_run()[0] for _ in range(2)]
        self.assertEqual([r["runId"] for r in m.list_runs()], ids)
        self.assertEqual(m.list_runs()[0]["state"]["runId"], ids[0])


class TestValidate(unittest.TestCase):
    reg = real_registry()
    cfg = dict(CONFIG)

    def errs(self, schedule, cfg=None):
        return [(e.id, e.reason) for e in recipe.validate(self.reg, {"config": cfg or self.cfg, "schedule": schedule})]

    def test_valid(self):
        self.assertEqual(self.errs([]), [])
        self.assertEqual(self.errs([{"week": 3, "patch": PATCH}, {"week": 3, "patch": {"gecis_destegi": "kapali"}},
                                    {"week": 199, "patch": PATCH}]), [])
        self.assertEqual(self.errs([{"week": 0, "patch": {"dunya_tohumu": 0}}]), [])      # start_only yalnız hafta 0'da

    def test_recipe_rejects_unsorted_or_out_of_range(self):
        self.assertEqual(self.errs([{"week": 5, "patch": PATCH}, {"week": 4, "patch": PATCH}]), [("schedule[1].week", "invalid")])
        self.assertEqual(self.errs([{"week": -1, "patch": PATCH}]), [("schedule[0].week", "invalid")])
        self.assertEqual(self.errs([{"week": 200, "patch": PATCH}]), [("schedule[0].week", "invalid")])
        self.assertEqual(self.errs([{"week": 100, "patch": PATCH}], dict(self.cfg, durationWeeks=100)), [("schedule[0].week", "invalid")])
        self.assertEqual(self.errs([{"week": True, "patch": PATCH}]), [("schedule[0].week", "invalid")])
        self.assertEqual(self.errs([{"week": 1.5, "patch": PATCH}]), [("schedule[0].week", "invalid")])
        self.assertEqual(self.errs([{"week": 1}]), [("schedule[0].patch", "invalid")])
        self.assertEqual(self.errs([{"week": 1, "patch": {}}]), [("schedule[0].patch", "invalid")])
        self.assertEqual(self.errs("x"), [("schedule", "invalid")])
        self.assertEqual(self.errs([5]), [("schedule[0].week", "invalid"), ("schedule[0].patch", "invalid")])

    def test_patch_reasons_midrun(self):
        got = dict(self.errs([{"week": 4, "patch": {"dunya_tohumu": 1, "yok": 1, "gecis_destegi": "xx"}}]))
        self.assertEqual(got, {"schedule[0].patch.dunya_tohumu": "start_only", "schedule[0].patch.yok": "locked",
                               "schedule[0].patch.gecis_destegi": "invalid"})

    def test_config_errors_pass_through(self):
        self.assertEqual(self.errs([], dict(self.cfg, durationWeeks=7)), [("durationWeeks", "invalid")])
        # hafta 0 yaması hatası takvim girdisine bağlanır (hafta > 0 ile tutarlı); config kaynaklı hata aynen kalır
        self.assertEqual(self.errs([{"week": 0, "patch": {"dunya_tohumu": 3}}]), [("schedule[0].patch.dunya_tohumu", "invalid")])
        self.assertEqual(self.errs([{"week": 2, "patch": PATCH}, {"week": 0, "patch": {"dunya_tohumu": 3}}][::-1]),
                         [("schedule[0].patch.dunya_tohumu", "invalid")])
        self.assertEqual([e.id for e in recipe.validate(self.reg, {"config": "x"})], ["config"])


class TestWorkerSession(unittest.TestCase):
    def run_session(self, init_extra, cmds, until_week=None):
        q: "queue.Queue" = queue.Queue()
        out: list = []
        s = Session(q, out.append, lambda spec: FakeHost("", spec.get("overrides", {}), spec.get("weeks", 200)))
        q.put({"cmd": "init", "overrides": {}, "weeks": 200, **init_extra})
        for c in cmds:
            q.put(c)
        t = threading.Thread(target=s.run, daemon=True)
        t.start()
        end = time.time() + 10
        while t.is_alive() and time.time() < end:           # hedefe varınca (ya da işçi bitince) girdiyi kapat
            if until_week is not None and any(e["ev"] == "week" and e["week"] >= until_week for e in out):
                break
            time.sleep(0.005)
        q.put(None)
        t.join(5)
        return out

    def test_ff_emits_week_and_progress_every_10(self):
        out = self.run_session({}, [{"cmd": "ff", "week": 25}], 25)
        self.assertEqual([e["week"] for e in out if e["ev"] == "week"], list(range(1, 26)))
        self.assertEqual([e["week"] for e in out if e["ev"] == "progress"], [10, 20])
        self.assertEqual([e["total"] for e in out if e["ev"] == "progress"], [25, 25])
        self.assertEqual(out[-1]["ev"], "week")

    def test_ff_bad_args(self):
        for bad in ({"cmd": "ff"}, {"cmd": "ff", "week": -1}, {"cmd": "ff", "week": True}, {"cmd": "ff", "week": "5"}):
            out = self.run_session({}, [bad])
            self.assertEqual(out[-1], {"ev": "failed", "error": "bad_cmd"})

    def test_schedule_applied_before_week_and_versioned(self):
        sched = [{"week": 3, "overrides": {"TRANS_SUPPORT": 1}, "version": 2}, {"week": 5, "overrides": {"TRANS_SUPPORT": 2}, "version": 3}]
        out = self.run_session({"schedule": sched}, [{"cmd": "ff", "week": 7}], 7)
        weeks = {e["week"]: e["version"] for e in out if e["ev"] == "week"}
        self.assertEqual({w: max(1, v) for w, v in weeks.items()}, {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 3, 7: 3})   # 1. sürüm: işçi 0 yayar, yönetici 1'e sıkıştırır
        patched = [(e["from_week"], e["version"], e.get("scheduled")) for e in out if e["ev"] == "patched"]
        self.assertEqual(patched, [(3, 2, True), (5, 3, True)])

    def test_schedule_bad_shape(self):
        out = self.run_session({"schedule": [{"week": 3}]}, [])
        self.assertEqual(out[0], {"ev": "failed", "error": "bad_cmd"})


class TestRoutes(unittest.TestCase):
    def test_capabilities_branch_rebuild_true(self):
        with live_app() as (srv, app, _w):
            for path in ("/api/hello", "/api/info"):
                caps = call(srv, "GET", path)[2]["capabilities"]
                self.assertTrue(caps["branch"] and caps["rebuild"], caps)
                self.assertEqual([k for k, v in caps.items() if v], ["branch", "city", "chain", "rebuild", "harita"])

    def test_create_with_schedule_and_ff(self):
        with live_app() as (srv, _a, _w):
            s, _, h = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG, "schedule": [{"week": 2, "patch": PATCH}], "fastForwardTo": 6})
            self.assertEqual(s, 201, h)
            rid = h["runId"]
            end = time.time() + 20
            while "preparing" in call(srv, "GET", f"/api/runs/{rid}")[2]["state"] and time.time() < end:
                time.sleep(0.02)
            st = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]
            self.assertEqual((st["week"], st["status"], st["version"]), (6, "paused", 2))
            s, _, ws = call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=6")
            self.assertEqual([p["version"] for p in ws], [1, 1, 2, 2, 2, 2])
            s, _, lst = call(srv, "GET", "/api/runs")
            self.assertEqual((s, [r["runId"] for r in lst]), (200, [rid]))
            self.assertEqual(lst[0]["state"]["week"], 6)

    def test_fast_forward_beyond_duration_rejected(self):
        with live_app() as (srv, _a, _w):
            for bad in (201, -1, True, "5", 1.5):
                body = {"config": ROUTE_CONFIG, "fastForwardTo": bad}
                s, _, b = call(srv, "POST", "/api/runs", body)
                self.assertEqual(s, 422, (bad, b))
                self.assertEqual(b["error"]["code"], "invalid_config")
                self.assertEqual(b["error"]["fields"], [{"id": "fastForwardTo", "reason": "invalid"}])
            self.assertEqual(call(srv, "GET", "/api/runs")[2], [])        # hiçbir işçi başlamadı
            self.assertEqual(call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG, "fastForwardTo": 200})[0], 201)

    def test_bad_schedule_422_with_fields(self):
        with live_app() as (srv, _a, _w):
            s, _, b = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG, "schedule": [
                {"week": 5, "patch": PATCH}, {"week": 4, "patch": {"dunya_tohumu": 1}}]})
            self.assertEqual(s, 422)
            self.assertEqual(b["error"]["code"], "invalid_config")
            self.assertEqual(b["error"]["fields"], [{"id": "schedule[1].week", "reason": "invalid"}])
            self.assertEqual(call(srv, "GET", "/api/runs")[2], [])

    def test_second_preparing_409(self):
        with mock.patch.dict(os.environ, {"OYUN_FAKE_STEP_MS": "60"}), live_app() as (srv, _a, _w):
            s, _, h = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG, "fastForwardTo": 40})
            self.assertEqual(s, 201)
            self.assertEqual(h["state"]["preparing"], {"done": 0, "total": 40})
            s, _, b = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG, "fastForwardTo": 5})
            self.assertEqual((s, b["error"]["code"]), (409, "busy_preparing"))
            s, _, b = call(srv, "POST", f"/api/runs/{h['runId']}/branch", {"week": 3})
            self.assertEqual((s, b["error"]["code"]), (409, "busy_preparing"))
            self.assertEqual(call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG})[0], 201)
            self.assertEqual(call(srv, "DELETE", f"/api/runs/{h['runId']}")[0], 204)
            self.assertEqual(call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG, "fastForwardTo": 3})[0], 201)

    def test_too_many_runs_429(self):
        from tests.route_helpers import Stream
        with live_app() as (srv, _a, _w):
            ids = [create_run(srv) for _ in range(3)]
            streams = [Stream(srv, r) for r in ids]
            try:
                end = time.time() + 5
                while time.time() < end and sum(len(_a.manager._runs[r].subs) for r in ids) < 3:
                    time.sleep(0.02)
                s, _, b = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG})
                self.assertEqual((s, b["error"]["code"]), (429, "too_many_runs"))
                self.assertEqual([r["runId"] for r in call(srv, "GET", "/api/runs")[2]], ids)
            finally:
                for st in streams:
                    st.close()


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "gerçek model kanıtı yavaş (OYUN_QUICK)")
class TestRealModelRebuild(unittest.TestCase):
    """Tek kabul testi: GERÇEK model, GERÇEK işçi süreci (NDJSON). 12 hafta, hafta ~6'da yama; yeniden kurma 1..12 eşit."""

    def test_recipe_rebuild_equals_original_real_model(self):
        logdir = tempfile.mkdtemp(prefix="oyun-s2-log-")
        self.addCleanup(shutil.rmtree, logdir, True)
        workers: list = []

        def factory(spec):
            w = WorkerClient.spawn(spec, log_dir=logdir, extra_env={"PYTHONHASHSEED": "0"})
            workers.append(w)
            return w

        mgr = RunManager(real_registry(), factory, cfg=make_cfg(MAX_RUNS=3))
        mgr.start_thread()
        self.addCleanup(lambda: [w.kill() for w in workers])
        try:
            a = mgr.create(dict(CONFIG, values={}))["runId"]
            mgr.control(a, "play", 16)
            self._until(lambda: mgr.stats(a)["released"] >= 6)
            mgr.control(a, "pause", None)
            res = mgr.apply_change(a, PATCH, None, timeout=120)
            self.assertTrue(res["accepted"], res)
            mgr.control(a, "play", 16)
            self._until(lambda: mgr.stats(a)["released"] >= 12)
            mgr.control(a, "pause", None)
            orig = mgr.weeks(a, 1, 12)
            b = mgr.create(dict(CONFIG, values={}), [{"week": res["seamWeek"], "patch": PATCH}], 12)["runId"]
            self._until(lambda: "preparing" not in mgr.get(b)["state"])
            self.assertEqual([strip(p) for p in mgr.weeks(b, 1, 12)], [strip(p) for p in orig])
            self.assertEqual(mgr.get(b)["state"]["version"], 2)
            # dallanma da gerçek modelle: ebeveynin 1..9 haftası bit bit aynı (yama dikişinden sonra dahi)
            c = mgr.branch(a, 9, None)["runId"]
            self._until(lambda: "preparing" not in mgr.get(c)["state"])
            self.assertEqual([strip(p) for p in mgr.weeks(c, 1, 9)], [strip(p) for p in orig[:9]])
        finally:
            mgr.shutdown()

    @staticmethod
    def _until(cond, secs=240):
        end = time.time() + secs
        while time.time() < end:
            if cond():
                return
            time.sleep(0.05)
        raise AssertionError("zaman aşımı")


if __name__ == "__main__":
    unittest.main()
