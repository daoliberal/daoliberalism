"""S2: dallanma (`POST /api/runs/{id}/branch`): ebeveyn tarifinin `week`'e kadarki kısmı + isteğe bağlı yama `week`'te.

Sahte işçi; hızlı. Dal noktasında `start_only` anahtar: hafta > 0'da reddedilir (dal baştan kurulmaz), hafta 0'da dal
baştan kurulur (kuruluşa katılır).
"""
from __future__ import annotations

import copy
import threading
import time
import unittest

from oyun_server.registry.schema import RunConfigError
from oyun_server.runs.manager import RunManager, TooManyRuns, UnknownRun
from oyun_server.testing import InProcWorker

from tests.route_helpers import CONFIG as ROUTE_CONFIG, call, live_app
from tests.test_changes_v2 import v2_registry
from tests.test_manager import CONFIG, drain, make_cfg
from tests.test_recipe import PATCH, RecipeBase, strip

KURTARMA = {"gecis_destegi": "kurtarma_fonuyla"}


class BranchBase(RecipeBase):
    def parent(self, m, weeks=12, patch=True):
        rid, _ = self.new_run()
        self.played(m, rid, 6)
        seam = None
        if patch:
            res = self.change(rid, PATCH)
            self.assertTrue(res["accepted"], res)
            seam = res["seamWeek"]
        self.played(m, rid, weeks)
        return rid, seam


class TestBranch(BranchBase):
    def test_branch_parent_unchanged_and_prefix_equal(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        a, seam = self.parent(m)
        self.assertLess(seam, 10)
        before = (m.get(a), m.weeks(a, 1, 12), list(m._runs[a].vevents), m._runs[a].accepted_version)
        h = m.branch(a, 10, KURTARMA)
        c = h["runId"]
        self.assertEqual((h["state"]["parentRunId"], h["state"]["forkWeek"]), (a, 10))
        self.assertEqual(h["state"]["preparing"], {"done": 0, "total": 10})
        self.prepared(c)
        st = m.get(c)["state"]
        self.assertEqual((st["status"], st["week"], st["parentRunId"], st["forkWeek"], st["version"]), ("paused", 10, a, 10, 2))
        self.assertNotIn("preparing", st)
        self.assertEqual([strip(p) for p in m.weeks(c, 1, 10)], [strip(p) for p in m.weeks(a, 1, 10)])   # önek eşit
        self.assertEqual(m._runs[c].accepted_version, 3)
        self.assertEqual([e["week"] for e in m._runs[c].vevents], [seam, 10])                          # ebeveynin + dal sürümü
        # ebeveyn değişmedi (durum, paketler, olaylar, sürüm)
        self.assertEqual(m.get(a), before[0])
        self.assertEqual(m.weeks(a, 1, 12), before[1])
        self.assertEqual(list(m._runs[a].vevents), before[2])
        self.assertEqual(m._runs[a].accepted_version, before[3])
        self.assertNotIn("parentRunId", m.get(a)["state"])
        # dal ilerleyince ayrışır: 11. hafta sürüm 3
        m.control(c, "step", None)
        self.pump_until(lambda: m.get(c)["state"]["week"] == 11)
        self.assertEqual(m.weeks(c, 11, 11)[0]["version"], 3)
        self.assertEqual(m.weeks(a, 11, 11)[0]["version"], 2)
        self.assertNotEqual(m.weeks(c, 11, 11)[0]["world"], m.weeks(a, 11, 11)[0]["world"])
        self.assertEqual(m.get(c)["state"]["values"]["gecis_destegi"], "kurtarma_fonuyla")

    def test_branch_without_patch_replays_parent_prefix(self):
        m = self.make()
        a, seam = self.parent(m)
        c = m.branch(a, 12)["runId"]                       # patch yok
        self.prepared(c)
        self.assertEqual([strip(p) for p in m.weeks(c, 1, 12)], [strip(p) for p in m.weeks(a, 1, 12)])
        self.assertEqual(m._runs[c].accepted_version, 2)
        self.assertEqual(m.get(c)["state"]["values"], m.get(a)["state"]["values"])

    def test_branch_before_parent_patch_drops_it(self):
        m = self.make()
        a, seam = self.parent(m)
        c = m.branch(a, 3, {})["runId"]                    # boş yama = yama yok
        self.prepared(c)
        self.assertEqual({p["version"] for p in m.weeks(c, 1, 3)}, {1})
        self.assertEqual(m.get(c)["state"]["values"], {"gecis_destegi": "kapali"})
        self.assertEqual(m._runs[c].schedule, [])

    def test_branch_week0_is_fresh_run_with_patch_folded(self):
        m = self.make()
        a, _ = self.parent(m)
        h = m.branch(a, 0, KURTARMA)
        self.assertNotIn("preparing", h["state"])
        self.assertEqual((h["state"]["week"], h["state"]["forkWeek"], h["state"]["version"]), (0, 0, 1))
        self.assertEqual(h["state"]["values"]["gecis_destegi"], "kurtarma_fonuyla")

    def test_branch_of_branch_and_recipe_roundtrip(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        a, seam = self.parent(m)
        b = m.branch(a, 8, KURTARMA)["runId"]
        self.prepared(b)
        c = m.branch(b, 8, {"gecis_destegi": "kapali"})["runId"]
        self.prepared(c)
        self.assertEqual(m.get(c)["state"]["parentRunId"], b)
        self.assertEqual(m._runs[c].schedule[-1], {"week": 8, "patch": {"gecis_destegi": "kapali"}})
        self.assertEqual([e["week"] for e in m._runs[c].schedule], [seam, 8, 8])

    def test_branch_unknown_parent_and_bad_week(self):
        m = self.make()
        a, _ = self.parent(m)
        with self.assertRaises(UnknownRun):
            m.branch("canli-yok", 3, None)
        for bad in (-1, 200, 201, True, "3", 2.5):
            with self.assertRaises(RunConfigError, msg=repr(bad)) as cm:
                m.branch(a, bad, None)
            self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("week", "invalid")])
        with self.assertRaises(RunConfigError):
            m.branch(a, 3, "x")

    def test_branch_with_start_only_patch_rejected_midrun(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        a, _ = self.parent(m)
        n = len(m.list_runs())
        with self.assertRaises(RunConfigError) as cm:
            m.branch(a, 5, {"dunya_tohumu": 1, "gecis_destegi": "kapali", "yok": 1})
        self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("dunya_tohumu", "start_only"), ("yok", "locked")])
        self.assertEqual(len(m.list_runs()), n)            # hiçbir koşu / işçi oluşmadı
        self.assertEqual(len(self.workers), n)

    def test_branch_start_only_patch_at_week0_rebuilds_from_scratch(self):
        def factory(spec):
            w = InProcWorker(spec, host_factory=self.host_factory)
            self.workers.append(w)
            return w
        m = RunManager(v2_registry(), factory, clock=self.clock, cfg=make_cfg(MAX_RUNS=3))
        self.managers.append(m)
        self.mgr = m
        a, _ = self.new_run()
        h = m.branch(a, 0, {"ornek_acik": True})
        self.assertTrue(h["state"]["values"]["ornek_acik"])
        with self.assertRaises(RunConfigError):
            m.branch(a, 4, {"ornek_sira": ["genc"]})       # hafta > 0: ornek_sira start_only

    def test_branch_paused_at_fork_accepts_live_change(self):
        """Dal W'de duraklarken vadesi gelen takvim yamaları işçi boştayken uygulanır: canlı değişiklik `busy` kalmaz."""
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        a, seam = self.parent(m)
        c = m.branch(a, 8, KURTARMA)["runId"]
        self.prepared(c)
        self.pump_until(lambda: m._runs[c].sched_applied == m._runs[c].sched_total, 5)    # işçi boştayken uyguladı
        res = self.change(c, {"gecis_destegi": "kapali"})
        self.assertTrue(res["accepted"], res)
        self.assertEqual(res["seamWeek"], 8)
        self.assertEqual(m.get(c)["state"]["week"], 8)
        self.assertEqual(m._runs[c].accepted_version, 4)

    def test_branch_then_change_equals_rebuild_from_recipe(self):
        """Dal + canlı değişiklik tarifi yeniden kurulunca aynı satırlar (belirlenimci)."""
        m = self.make(cfg=make_cfg(MAX_RUNS=4))
        a, seam = self.parent(m)
        c = m.branch(a, 8, KURTARMA)["runId"]
        self.prepared(c)
        self.assertTrue(self.change(c, {"gecis_destegi": "kapali"})["accepted"])
        self.played(m, c, 12)
        recipe_ = copy.deepcopy(m._runs[c].schedule)
        self.assertEqual([e["week"] for e in recipe_], [seam, 8, 8])
        d = m.create(copy.deepcopy(m._runs[c].raw_config), recipe_, 12)["runId"]
        self.prepared(d)
        self.assertEqual([strip(p) for p in m.weeks(d, 1, 12)], [strip(p) for p in m.weeks(c, 1, 12)])
        self.assertEqual(list(m._runs[d].vevents), [e for e in m._runs[c].vevents if e["week"] <= 12])
        self.assertEqual(m.get(d)["state"]["values"], m.get(c)["state"]["values"])

    def test_branch_at_full_capacity_does_not_stall_other_runs(self):
        """Ö4: sınır doluyken dallanmada çıkarılan işçinin kapanış beklemesi küresel kilit dışında; pump gecikmez."""
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        a, _ = self.parent(m, patch=False)
        b, _ = self.new_run()                              # abonesiz: çıkarılacak kurban
        c, _ = self.new_run()
        m.subscribe(c)
        m.control(c, "play", 1)
        slow = 1.5
        self.workers[1].wait = lambda timeout=None: time.sleep(slow) or 0      # yavaş kapanan işçi
        done = {}
        t = threading.Thread(target=lambda: done.update(h=m.branch(a, 4, KURTARMA)))
        t0 = time.monotonic()
        t.start()
        worst = 0.0
        while t.is_alive():
            s = time.monotonic()
            m.pump(self.clock())
            m.list_runs()
            worst = max(worst, time.monotonic() - s)
            time.sleep(0.005)
        t.join()
        self.assertGreaterEqual(time.monotonic() - t0, slow * 0.8)              # bekleme gerçekten oldu
        self.assertLess(worst, 0.5, "pump/list küresel kilitte bekledi: %.2f sn" % worst)
        self.assertIsNone(m.get(b))
        self.assertIn("runId", done["h"])

    def test_branch_never_evicts_its_parent(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=2))
        a, _ = self.parent(m)                              # a abonesiz ve en eski, ama ebeveyn
        b, _ = self.new_run()
        m.subscribe(b)                                     # tek öteki aday abonelikli
        with self.assertRaises(TooManyRuns):
            m.branch(a, 4, KURTARMA)
        self.assertIsNotNone(m.get(a))
        sa = m.subscribe(a)                                # ebeveyn aboneli değilken yeni (dal olmayan) koşu a'yı çıkarır
        sa.close()
        d, _ = self.new_run()
        self.assertIsNone(m.get(a))


class TestBranchRoute(unittest.TestCase):
    def play(self, srv, rid, n):
        call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
        end = time.time() + 20
        while time.time() < end and call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"] < n:
            time.sleep(0.02)
        call(srv, "POST", f"/api/runs/{rid}/control", {"action": "pause"})

    def wait_ready(self, srv, rid):
        end = time.time() + 20
        while time.time() < end and "preparing" in call(srv, "GET", f"/api/runs/{rid}")[2]["state"]:
            time.sleep(0.02)

    def test_branch_route(self):
        with live_app() as (srv, _a, _w):
            s, _, h = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG})
            a = h["runId"]
            self.play(srv, a, 8)
            s, _, h2 = call(srv, "POST", f"/api/runs/{a}/branch", {"week": 5, "patch": KURTARMA})
            self.assertEqual(s, 201, h2)
            self.assertEqual((h2["state"]["parentRunId"], h2["state"]["forkWeek"]), (a, 5))
            self.assertEqual(h2["state"]["preparing"], {"done": 0, "total": 5})
            c = h2["runId"]
            self.wait_ready(srv, c)
            s, _, ws_c = call(srv, "GET", f"/api/runs/{c}/weeks?from=1&to=5")
            _, _, ws_a = call(srv, "GET", f"/api/runs/{a}/weeks?from=1&to=5")
            self.assertEqual([strip(p) for p in ws_c], [strip(p) for p in ws_a])
            self.assertEqual([r["runId"] for r in call(srv, "GET", "/api/runs")[2]], [a, c])

    def test_branch_errors(self):
        with live_app() as (srv, _a, _w):
            a = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG})[2]["runId"]
            self.assertEqual(call(srv, "POST", "/api/runs/canli-yok/branch", {"week": 1})[0], 404)
            for body in ({}, {"week": -1}, {"week": 200}, {"week": True}, {"week": "1"}):
                s, _, b = call(srv, "POST", f"/api/runs/{a}/branch", body)
                self.assertEqual((s, b["error"]["code"], b["error"]["fields"]), (422, "invalid_branch", [{"id": "week", "reason": "invalid"}]), body)
            s, _, b = call(srv, "POST", f"/api/runs/{a}/branch", {"week": 3, "patch": "x"})
            self.assertEqual((s, b["error"]["fields"]), (422, [{"id": "patch", "reason": "invalid"}]))
            s, _, b = call(srv, "POST", f"/api/runs/{a}/branch", {"week": 3, "patch": {"dunya_tohumu": 1, "yok": 1, "gecis_destegi": "zz"}})
            self.assertEqual((s, b["error"]["code"]), (422, "invalid_branch"))
            self.assertEqual(b["error"]["fields"], [{"id": "dunya_tohumu", "reason": "start_only"}, {"id": "yok", "reason": "locked"},
                                                    {"id": "gecis_destegi", "reason": "invalid"}])
            self.assertEqual(len(call(srv, "GET", "/api/runs")[2]), 1)


if __name__ == "__main__":
    unittest.main()
