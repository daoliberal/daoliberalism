"""A7a: RunManager (pacer, olay günlüğü, komutlar). Sahte saat + süreç içi işçi; `pump` elle çağrılır.

İş parçacığı eşzamanlaması için yalnız kısa yoklama beklemeleri (1-2 ms) vardır; zaman mantığı sahte saatledir.
"""
from __future__ import annotations

import os
import random
import re
import signal
import threading
import time
import types
import unittest

from oyun_server import config
from oyun_server.registry.schema import RunConfigError
from oyun_server.runs.manager import RunManager, TooManyRuns, UnknownRun
from oyun_server.sim.client import WorkerClient
from oyun_server.testing import FakeHost, InProcWorker

from tests.registry_helpers import real_registry

CONFIG = {"name": "Deneme", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban",
          "durationWeeks": 200, "seedIndex": 0, "values": {}}


class FakeClock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> float:
        self.t += dt
        return self.t


class FlakyHost(FakeHost):
    """Belirli haftada çöker; yama çağrılarını kaydeder."""

    fail_week: int | None = None

    def __init__(self, spec: dict):
        super().__init__("", spec.get("overrides", {}), spec.get("weeks", 200))
        self.patch_calls: list[dict] = []

    def step(self):
        if self.fail_week is not None and self.week + 1 == self.fail_week:
            raise KeyError("test çökmesi")
        return super().step()

    def patch(self, overrides):
        self.patch_calls.append(dict(overrides))
        return super().patch(overrides)


def make_cfg(**over):
    ns = types.SimpleNamespace(**{k: getattr(config, k) for k in dir(config) if k.isupper()})
    ns.load_decisions = lambda: {"lookahead": ns.LOOKAHEAD, "seam_mode": "frontier", "max_runs": 3}
    ns.load_live_keys = config.load_live_keys
    for k, v in over.items():
        setattr(ns, k, v)
    return ns


def drain(sub):
    out = []
    while True:
        item = sub.next(0)
        if item is None:
            return out
        out.append(item)
        if item[0] == "__closed__":
            return out


class ManagerBase(unittest.TestCase):
    fail_week = None

    def setUp(self):
        self.clock = FakeClock()
        self.workers: list[InProcWorker] = []
        self.hosts: list[FlakyHost] = []
        self.gate = threading.Semaphore(0)
        self.hold = threading.Event()
        self.managers: list[RunManager] = []
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        self.hold.set()
        self.gate.release(500)
        for m in self.managers:
            m.shutdown()
        for w in self.workers:
            w.kill()

    block_init = False

    def host_factory(self, spec):
        if self.block_init:
            self.hold.wait(10)
        h = FlakyHost(spec)
        h.fail_week = self.fail_week
        self.hosts.append(h)
        return h

    def make(self, gated=False, cfg=None, clock=None, registry=None):
        def factory(spec):
            w = InProcWorker(spec, step_delay=1.0 if gated else 0.0,
                             sleep=(lambda _d: self.gate.acquire(timeout=10)) if gated else time.sleep,
                             host_factory=self.host_factory)
            self.workers.append(w)
            return w

        m = RunManager(registry or real_registry(), factory, clock=clock or self.clock, cfg=cfg or make_cfg())
        self.managers.append(m)
        self.mgr = m
        return m

    # yardımcılar
    def until(self, cond, timeout=30.0):
        end = time.time() + timeout
        while time.time() < end:
            if cond():
                return
            time.sleep(0.002)
        self.fail("koşul sağlanmadı (zaman aşımı)")

    def computed(self, rid, n):
        self.pump_until(lambda: self.mgr.stats(rid)["worker_week"] >= n)

    def pump_until(self, cond, timeout=30.0):
        end = time.time() + timeout
        while time.time() < end:
            self.mgr.pump(self.clock())
            if cond():
                return
            time.sleep(0.002)
        self.fail("pump koşulu sağlanmadı")

    def new_run(self, **kw):
        h = self.mgr.create(dict(CONFIG, **kw))
        return h["runId"], h


class TestBasics(ManagerBase):
    def test_create_paused_week0(self):
        m = self.make()
        h = m.create(CONFIG)
        self.assertRegex(h["runId"], r"^canli-[0-9a-f]{8}$")
        st = h["state"]
        self.assertEqual((st["status"], st["week"], st["version"], st["speed"], st["computing"]),
                         ("paused", 0, 1, 1, False))
        self.assertEqual(st["durationWeeks"], 200)
        self.assertEqual(st["runId"], h["runId"])
        self.assertEqual(st["values"], {"gecis_destegi": "kapali"})
        self.assertEqual(m.get(h["runId"])["state"], st)
        self.assertIsNone(m.get("canli-00000000"))
        self.assertEqual(len(self.workers), 1)

    def test_create_invalid_config_raises(self):
        m = self.make()
        with self.assertRaises(RunConfigError):
            m.create(dict(CONFIG, values={"yok_boyle_ayar": 1}))
        self.assertEqual(self.workers, [])

    def test_unknown_run(self):
        m = self.make()
        for call in (lambda: m.control("canli-x", "play", None), lambda: m.weeks("canli-x", 1, 2),
                     lambda: m.subscribe("canli-x"), lambda: m.delete("canli-x")):
            with self.assertRaises(UnknownRun):
                call()

    def test_control_validation(self):
        m = self.make()
        rid, _ = self.new_run()
        with self.assertRaises(ValueError):
            m.control(rid, "zipla", None)
        with self.assertRaises(ValueError):
            m.control(rid, "play", 3)


class TestPacing(ManagerBase):
    def play_and_fill(self, speed):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", speed)
        self.computed(rid, 2)
        return m, rid

    def test_release_pace_1x(self):
        m, rid = self.play_and_fill(1)
        t0 = self.clock.t
        m.pump(t0 + 1.99)
        self.assertEqual(m.get(rid)["state"]["week"], 0)
        m.pump(t0 + 2.0)
        self.assertEqual(m.get(rid)["state"]["week"], 1)
        m.pump(t0 + 3.99)
        self.assertEqual(m.get(rid)["state"]["week"], 1)
        m.pump(t0 + 4.0)
        self.assertEqual(m.get(rid)["state"]["week"], 2)

    def test_release_pace_4x(self):
        m, rid = self.play_and_fill(4)
        t0 = self.clock.t
        m.pump(t0 + 0.49)
        self.assertEqual(m.get(rid)["state"]["week"], 0)
        m.pump(t0 + 0.5)
        self.assertEqual(m.get(rid)["state"]["week"], 1)
        m.pump(t0 + 1.0)
        self.assertEqual(m.get(rid)["state"]["week"], 2)

    def test_16x_limited_by_buffer(self):
        m = self.make(gated=True)
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        m.pump(self.clock.t + 5)
        self.assertEqual(m.get(rid)["state"]["week"], 0)        # işçi hiç adım atmadı
        for n in (1, 2, 3):
            self.gate.release()
            self.computed(rid, n)
            m.pump(self.clock.t + 5)
            st = m.stats(rid)
            self.assertEqual(st["released"], n)                  # atlama yok, tampondan fazlası yok
            self.assertLessEqual(st["released"], st["worker_week"])
            self.assertLessEqual(st["frontier"], st["released"] + 2)

    def test_lookahead_from_decisions(self):
        m = self.make(cfg=make_cfg(load_decisions=lambda: {"lookahead": 1, "seam_mode": "frontier", "max_runs": 3}))
        rid, _ = self.new_run()
        m.control(rid, "play", 1)
        self.computed(rid, 1)
        time.sleep(0.05)
        m.pump(self.clock.t)
        self.assertEqual(m.stats(rid)["worker_week"], 1)         # frontier = released + 1
        self.assertEqual(m.stats(rid)["frontier"], 1)

    def test_buffering_hysteresis(self):
        m = self.make(gated=True)
        rid, _ = self.new_run()
        self.pump_until(lambda: not m.get(rid)["state"]["buffering"])   # işçi hazır
        sub = m.subscribe(rid)
        drain(sub)
        m.control(rid, "play", 4)                                # aralık 0,5 sn; eşik 0,75 sn
        t0 = self.clock.t
        self.clock.t = t0 + 1.0
        drain(sub)
        times: list[float] = []

        def pump(t):
            self.clock.t = t
            m.pump(t)
            for ev, data in drain(sub):
                if ev == "state":
                    times.append(t)
                    flips.append(data["buffering"])

        flips: list[bool] = []
        pump(t0 + 1.05)
        self.assertFalse(m.get(rid)["state"]["buffering"])       # bekleme 0,55 < eşik
        pump(t0 + 1.30)
        self.assertTrue(m.get(rid)["state"]["buffering"])        # bekleme 0,80 > eşik: açıldı
        self.gate.release()
        self.computed(rid, 1)
        pump(t0 + 1.40)                                          # hafta 1 geç yayımlandı
        self.assertEqual(m.stats(rid)["released"], 1)
        self.assertTrue(m.get(rid)["state"]["buffering"])        # tek geç yayım kapatmaz
        self.gate.release(2)                                     # hafta 2 ve 3 önceden hazır
        self.computed(rid, 3)
        pump(t0 + 1.50)
        self.assertTrue(m.get(rid)["state"]["buffering"])
        pump(t0 + 1.90)                                          # hafta 2: zamanında (1)
        self.assertEqual(m.stats(rid)["released"], 2)
        self.assertTrue(m.get(rid)["state"]["buffering"])
        pump(t0 + 2.40)                                          # hafta 3: zamanında (2) -> kapanır
        self.assertEqual(m.stats(rid)["released"], 3)
        self.assertFalse(m.get(rid)["state"]["buffering"])
        # buffering yalnız bir kez açıldı, bir kez kapandı
        seq = [f for i, f in enumerate(flips) if i == 0 or f != flips[i - 1]]
        self.assertLessEqual(len(seq), 3)
        for t in times:                                          # state olayı <= 2/sn
            self.assertLessEqual(sum(1 for x in times if t - 1.0 < x <= t), 2)

    def test_state_events_throttled_at_16x(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        drain(sub)
        m.control(rid, "play", 16)
        drain(sub)
        states = 0
        weeks = 0
        t = self.clock.t
        end = time.time() + 30
        while weeks < 40 and time.time() < end:                  # sahte saat 0,01 sn ilerler; döngü hafta sayısıyla biter
            t += 0.01
            m.pump(t)
            for ev, _d in drain(sub):
                states += ev == "state"
                weeks += ev == "week"
            time.sleep(0.001)
        self.assertGreaterEqual(weeks, 40, "40 hafta 30 sn içinde yayımlanmadı")
        self.assertLessEqual(states, 1 + int((t - self.clock.t) * 2) + 1)

    def test_step_releases_one(self):
        m = self.make()
        rid, _ = self.new_run()
        st = m.control(rid, "step", None)
        self.assertEqual(st["status"], "paused")
        self.computed(rid, 1)
        m.pump(self.clock.t)
        self.assertEqual(m.get(rid)["state"]["week"], 1)
        m.pump(self.clock.t + 100)
        self.assertEqual(m.get(rid)["state"]["week"], 1)         # yalnız bir hafta
        self.assertEqual(m.get(rid)["state"]["status"], "paused")
        m.control(rid, "step", None)
        self.pump_until(lambda: m.get(rid)["state"]["week"] == 2)

    def test_step_buffering_until_computed(self):
        m = self.make(gated=True)
        rid, _ = self.new_run()
        m.control(rid, "step", None)
        m.pump(self.clock.t)
        self.assertTrue(m.get(rid)["state"]["buffering"])
        self.gate.release()
        self.pump_until(lambda: m.get(rid)["state"]["week"] == 1)
        self.assertFalse(m.get(rid)["state"]["buffering"])

    def test_pause_keeps_buffer(self):
        m, rid = self.play_and_fill(1)
        t0 = self.clock.t
        m.pump(t0 + 0.5)
        m.control(rid, "pause", None)
        before = m.stats(rid)
        self.assertEqual(before["buffered"], 2)
        m.pump(t0 + 50)
        time.sleep(0.05)
        after = m.stats(rid)
        self.assertEqual((after["released"], after["worker_week"], after["frontier"]), (0, 2, before["frontier"]))
        self.clock.t = t0 + 60
        m.control(rid, "play", None)
        m.pump(t0 + 62)
        self.assertEqual(m.stats(rid)["released"], 1)            # tampondan, yeniden hesaplanmadan

    def test_idle_pause_after_last_unsubscribe(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 1)
        t = self.clock.t
        sub.close()
        m.pump(t + 14.0)
        self.assertEqual(m.get(rid)["state"]["status"], "running")
        m.pump(t + 15.0)
        self.assertEqual(m.get(rid)["state"]["status"], "paused")

    def test_idle_pause_cancelled_by_new_subscriber(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 1)
        t = self.clock.t
        sub.close()
        m.pump(t + 5)
        sub2 = m.subscribe(rid)
        m.pump(t + 30)
        self.assertEqual(m.get(rid)["state"]["status"], "running")
        sub2.close()


class TestInvariants(ManagerBase):
    def test_rapid_commands_no_dup_weeks(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        rnd = random.Random(7)
        weeks: list[int] = []
        for _ in range(50):
            action = rnd.choice(["play", "pause", "step", "speed"])
            if action == "speed":
                m.control(rid, "play", rnd.choice([1, 4, 16]))
            else:
                m.control(rid, action, rnd.choice([None, 1, 4, 16]))
            for _ in range(rnd.randint(1, 3)):
                self.clock.advance(rnd.random() * 3)
                m.pump(self.clock.t)
                st = m.stats(rid)
                self.assertLessEqual(st["released"], st["frontier"] if st["status"] == "running" else 200)
                if st["status"] == "running":
                    self.assertLessEqual(st["frontier"], st["released"] + 2)
                time.sleep(0.001)
            weeks += [d["week"] for ev, d in drain(sub) if ev == "week"]
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= len(weeks) + 3)
        weeks += [d["week"] for ev, d in drain(sub) if ev == "week"]
        self.assertEqual(weeks, list(range(1, len(weeks) + 1)))
        self.assertEqual(m.stats(rid)["released"], len(weeks))
        self.assertEqual(len(m.weeks(rid, 1, 200)), len(weeks))

    def test_two_subscribers_same_history(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 3)
        m.control(rid, "pause", None)
        a, b = drain(m.subscribe(rid)), drain(m.subscribe(rid))
        self.assertEqual(a, b)
        self.assertEqual(a[0][0], "state")
        n = a[0][1]["week"]
        self.assertEqual([d["week"] for ev, d in a if ev == "week"], list(range(1, n + 1)))
        self.assertTrue(all(ev in ("state", "week", "world_event") for ev, _ in a))

    def test_ended_once_and_no_overflow(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=30)
        events = drain(sub)
        for action in ("play", "step", "pause", "play"):
            st = m.control(rid, action, 4)
            self.assertEqual((st["status"], st["week"]), ("ended", 200))
        m.pump(self.clock.t + 100)
        events += drain(sub)
        names = [e for e, _ in events]
        self.assertEqual(names.count("ended"), 1)
        i = names.index("ended")
        self.assertEqual(events[i - 1][0], "state")              # son state, ended'tan önce
        self.assertEqual(events[i - 1][1]["status"], "ended")
        self.assertEqual(events[i][1], {"reason": "duration", "week": 200})
        self.assertEqual(events[-1], ("__closed__", {}))
        self.assertEqual([d["week"] for e, d in events if e == "week"], list(range(1, 201)))
        self.assertEqual(m.get(rid)["state"]["endedReason"], "duration")
        self.until(lambda: not self.workers[0].alive())
        late = drain(m.subscribe(rid))                           # sonradan gelen: geçmiş + ended + kapanış
        lnames = [e for e, _ in late]
        self.assertEqual(lnames[0], "state")
        self.assertEqual(lnames[-2:], ["ended", "__closed__"])
        self.assertEqual(lnames.count("week"), 200)

    def test_subscription_timeout_and_close(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        self.assertEqual(sub.next(0.01)[0], "state")
        self.assertIsNone(sub.next(0.01))
        sub.close()
        sub.close()
        self.assertEqual(sub.next(0.01), ("__closed__", {}))


class TestFailure(ManagerBase):
    fail_week = 3

    def test_worker_failure_marks_failed_keeps_weeks(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "failed")
        st = m.get(rid)["state"]
        self.assertEqual(st["error"], {"messageKey": "hata.model_coktu", "week": 3})
        self.assertFalse(st["computing"])
        self.assertEqual(len(m.weeks(rid, 1, 200)), st["week"])
        self.assertEqual(st["week"], 2)
        for action in ("play", "step", "pause"):
            self.assertEqual(m.control(rid, action, None)["status"], "failed")
        self.until(lambda: not self.workers[0].alive())

    def test_send_after_death_marks_failed(self):
        self.fail_week = None
        m = self.make()
        rid, _ = self.new_run()
        self.workers[0].kill()
        m.control(rid, "play", 1)
        m.pump(self.clock.t)
        st = m.get(rid)["state"]
        self.assertEqual(st["status"], "failed")
        self.assertEqual(st["error"]["messageKey"], "hata.model_coktu")

    def test_failure_resolves_pending_change(self):
        m = self.make(gated=True)
        rid, _ = self.new_run()
        self.workers[0].kill()
        res = {}
        t = threading.Thread(target=lambda: res.update(r=m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, None)))
        t.start()
        self.pump_until(lambda: not t.is_alive())
        t.join(1)
        self.assertFalse(res["r"]["accepted"])


class TestChanges(ManagerBase):
    fail_week = None

    def change(self, rid, patch, timeout=None, pump=True):
        res = {}
        t = threading.Thread(target=lambda: res.update(r=self.mgr.apply_change(rid, patch, None, timeout=timeout)))
        t.start()
        if pump:
            end = time.time() + 30
            while t.is_alive() and time.time() < end:
                self.mgr.pump(self.clock.t)
                time.sleep(0.002)
        t.join(30)
        if "r" not in res:
            self.fail("apply_change 30 sn içinde dönmedi")
        return res["r"]

    def test_computing_only_while_change_pending(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 1)
        self.assertFalse(m.get(rid)["state"]["computing"])       # koşuyor, hesaplama yok
        res = {}
        t = threading.Thread(target=lambda: res.update(r=m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, None)))
        t.start()
        self.until(lambda: m.get(rid)["state"]["computing"])     # onay beklenirken
        st = m.control(rid, "pause", None)                       # computing iken komut durumu değiştirmez
        self.assertEqual(st["status"], "running")
        self.pump_until(lambda: not t.is_alive())
        t.join(1)
        self.assertTrue(res["r"]["accepted"], res)
        self.assertFalse(m.get(rid)["state"]["computing"])

    def test_change_applies_while_running_and_version_event(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 2)
        r = self.change(rid, {"gecis_destegi": "kisa_sureli"})
        self.assertEqual((r["accepted"], r["mode"], r["version"], r["runId"]), (True, "live", 2, rid))
        self.assertGreaterEqual(r["seamWeek"], 2)
        self.assertEqual(self.hosts[0].patch_calls, [{"TRANS_SUPPORT": 1}])
        self.pump_until(lambda: m.stats(rid)["released"] >= r["seamWeek"] + 3)
        self.assertEqual(m.get(rid)["state"]["version"], 2)
        self.assertEqual(m.get(rid)["state"]["values"]["gecis_destegi"], "kisa_sureli")
        ev = drain(sub)
        pk = {d["week"]: d["version"] for e, d in ev if e == "week"}
        for w, v in pk.items():
            self.assertEqual(v, 1 if w <= r["seamWeek"] else 2, (w, v))
        vevents = [d for e, d in ev if e == "world_event"]
        self.assertEqual(len(vevents), 1)
        self.assertEqual(vevents[0]["textKey"], "event.version")
        self.assertEqual(vevents[0]["week"], r["seamWeek"])
        self.assertEqual(vevents[0]["params"], {"hafta": r["seamWeek"], "mod": "live", "surum": 2})
        self.assertEqual(vevents[0]["rule_ids"], ["gecis_destegi"])
        self.assertEqual(vevents[0]["sector"], None)
        late = [e for e, _ in drain(m.subscribe(rid))]
        self.assertEqual(late.count("world_event"), 1)

    def test_apply_change_timeout_busy_no_patch_sent(self):
        m = self.make()
        rid, _ = self.new_run()
        r = self.change(rid, {"gecis_destegi": "kisa_sureli"}, timeout=0.05, pump=False)
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "*", "reason": "busy"}]})
        self.assertFalse(m.get(rid)["state"]["computing"])
        time.sleep(0.05)
        for _ in range(5):                                       # geri çekilen yama sonradan gitmez
            m.pump(self.clock.t)
            time.sleep(0.01)
        self.assertEqual(self.hosts[0].patch_calls, [])
        self.assertEqual(m.get(rid)["state"]["version"], 1)
        r2 = self.change(rid, {"gecis_destegi": "kisa_sureli"})  # yönetici sağlam kaldı
        self.assertTrue(r2["accepted"])

    def test_rejections(self):
        m = self.make()
        rid, _ = self.new_run()
        r = m.apply_change(rid, {"yok_boyle_ayar": 1}, None)
        self.assertEqual(r["fields"][0]["reason"], "locked")
        r = m.apply_change(rid, {"gecis_destegi": "olmayan"}, None)
        self.assertEqual(r["fields"], [{"id": "gecis_destegi", "reason": "invalid"}])
        self.until(lambda: self.hosts)
        self.assertEqual(self.hosts[0].patch_calls, [])
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=30)
        r = m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, None)
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "*", "reason": "ended"}]})


class TestFixRound1(ManagerBase):
    fail_week = None

    def start_change(self, rid, timeout=5.0):
        res = {}
        t = threading.Thread(target=lambda: res.update(r=self.mgr.apply_change(
            rid, {"gecis_destegi": "kisa_sureli"}, None, timeout=timeout)))
        t.start()
        self.until(lambda: self.mgr.get(rid)["state"]["computing"])
        return t, res

    def test_stuck_worker_during_change_fails_run(self):
        m = self.make(gated=True)
        rid, _ = self.new_run()
        m.control(rid, "play", 1)                                # işçi kapıda takılı (adım gecikmesi)
        t, res = self.start_change(rid)
        t0 = self.clock.t
        m.pump(t0)                                               # yama gönderildi, onay yok
        m.pump(t0 + 29)
        self.assertTrue(m.get(rid)["state"]["computing"])
        m.pump(t0 + 31)
        t.join(5)
        self.assertFalse(t.is_alive())
        st = m.get(rid)["state"]
        self.assertEqual((st["status"], st["computing"]), ("failed", False))
        self.assertEqual(st["error"]["messageKey"], "hata.model_coktu")
        self.assertFalse(res["r"]["accepted"])
        self.gate.release(500)                                   # InProc iş parçacığı kapıdan çıkıp bitebilsin
        self.until(lambda: not self.workers[0].alive())

    def test_stuck_worker_during_stepping_fails_run(self):
        m = self.make(gated=True)
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        t0 = self.clock.t
        m.pump(t0)
        m.pump(t0 + 29)
        self.assertEqual(m.get(rid)["state"]["status"], "running")
        m.pump(t0 + 31)
        self.assertEqual(m.get(rid)["state"]["status"], "failed")
        self.gate.release(500)                                   # InProc iş parçacığı kapıdan çıkıp bitebilsin
        self.until(lambda: not self.workers[0].alive())

    def test_stuck_limit_configurable_and_progress_resets(self):
        m = self.make(gated=True, cfg=make_cfg(STUCK_S=5))
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        t0 = self.clock.t
        for n in (1, 2, 3):
            self.clock.t = t0 + 4 * n                            # her 4 sn'de ilerleme: takılma değil
            self.gate.release()
            self.computed(rid, n)
        self.assertEqual(m.get(rid)["state"]["status"], "running")
        m.pump(t0 + 12 + 6)
        self.assertEqual(m.get(rid)["state"]["status"], "failed")
        self.assertEqual(m.get(rid)["state"]["error"]["week"], 4)

    def test_non_live_key_only_offender_start_only(self):
        m = self.make()
        rid, _ = self.new_run()
        r = m.apply_change(rid, {"gecis_destegi": "kisa_sureli", "dunya_tohumu": 1}, None)
        self.assertFalse(r["accepted"])
        self.assertEqual(r["fields"], [{"id": "dunya_tohumu", "reason": "start_only"}])
        self.until(lambda: self.hosts)
        self.assertEqual(self.hosts[0].patch_calls, [])

    def test_state_version_follows_released_packet(self):
        m = self.make(gated=True)
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        for n in (1, 2, 3):
            self.gate.release()
            self.computed(rid, n)
        res = {}
        t = threading.Thread(target=lambda: res.update(r=m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, None)))
        t.start()
        self.until(lambda: m.get(rid)["state"]["computing"])
        self.gate.release(3)
        self.pump_until(lambda: not t.is_alive())
        t.join(2)
        r = res["r"]
        self.assertEqual(r["version"], 2)
        if m.stats(rid)["released"] < r["seamWeek"]:
            st = m.get(rid)["state"]
            self.assertEqual((st["version"], st["values"]["gecis_destegi"]), (1, "kapali"))
        self.gate.release(10)
        self.pump_until(lambda: m.stats(rid)["released"] >= r["seamWeek"] + 1)
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"]["gecis_destegi"]), (2, "kisa_sureli"))

    def test_seam_state_unchanged_before_release(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 1)                                # 1x: tampon önde, yayım yavaş
        self.computed(rid, 2)
        r = {}
        t = threading.Thread(target=lambda: r.update(r=m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, None)))
        t.start()
        self.pump_until(lambda: not t.is_alive())
        t.join(2)
        self.assertGreaterEqual(r["r"]["seamWeek"], 2)
        st = m.get(rid)["state"]
        self.assertEqual((st["week"], st["version"], st["values"]["gecis_destegi"]), (0, 1, "kapali"))

    def test_loading_until_ready_is_buffering_not_computing(self):
        self.block_init = True
        m = self.make()
        rid, h = self.new_run()
        self.assertTrue(h["state"]["buffering"])
        st = m.control(rid, "play", 1)
        self.assertTrue(st["buffering"])
        self.assertFalse(st["computing"])
        m.pump(self.clock.t)
        self.assertTrue(m.get(rid)["state"]["buffering"])
        self.hold.set()
        self.pump_until(lambda: not m.get(rid)["state"]["buffering"])
        self.assertEqual(m.get(rid)["state"]["status"], "running")


class TestLifecycle(ManagerBase):
    def test_new_run_closes_previous_worker(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=1))                  # S2: sınır 1 iken abonesiz eski koşu çıkar
        a, _ = self.new_run()
        sub = m.subscribe(a)
        with self.assertRaises(TooManyRuns):                      # abonesi olan koşu çıkarılmaz
            self.new_run()
        sub.close()                                              # abone düştü (akış kapandı): eski koşu çıkarılabilir
        b, _ = self.new_run()
        self.assertNotEqual(a, b)
        self.assertFalse(self.workers[0].alive())
        self.assertTrue(self.workers[1].alive())
        self.assertIsNone(m.get(a))
        self.assertEqual(drain(sub)[-1], ("__closed__", {}))
        self.assertIsNotNone(m.get(b))

    def test_max_runs_from_cfg(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=2))
        ids = [self.new_run()[0] for _ in range(3)]
        self.assertIsNone(m.get(ids[0]))
        self.assertIsNotNone(m.get(ids[1]))
        self.assertIsNotNone(m.get(ids[2]))
        self.assertFalse(self.workers[0].alive())

    def test_shutdown_kills_all_workers(self):
        m = self.make(cfg=make_cfg(MAX_RUNS=3))
        ids = [self.new_run()[0] for _ in range(3)]
        sub = m.subscribe(ids[0])
        m.start_thread()
        m.shutdown()
        self.assertEqual([w.alive() for w in self.workers], [False, False, False])
        self.assertEqual(drain(sub)[-1], ("__closed__", {}))
        m.shutdown()                                             # yinelenebilir

    def test_delete_kills_worker(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.delete(rid)
        self.assertFalse(self.workers[0].alive())
        self.assertIsNone(m.get(rid))
        self.assertEqual(drain(sub)[-1], ("__closed__", {}))
        with self.assertRaises(UnknownRun):
            m.delete(rid)

    def test_delete_uses_graceful_stop(self):
        m = self.make()
        rid, _ = self.new_run()
        calls = []
        w = self.workers[0]
        orig_close, orig_wait = w.close_stdin, w.wait
        w.close_stdin = lambda: (calls.append("close_stdin"), orig_close())[1]
        w.wait = lambda timeout=None: (calls.append("wait"), orig_wait(timeout))[1]
        m.delete(rid)
        self.assertEqual(calls[:2], ["close_stdin", "wait"])          # önce stdin EOF, sonra bekleme (sonra kill)

    def test_pacer_thread_runs_without_manual_pump(self):
        m = self.make(clock=time.monotonic)
        rid, _ = self.new_run()
        m.start_thread()
        m.control(rid, "play", 16)
        self.until(lambda: m.get(rid)["state"]["week"] >= 10)
        m.shutdown()


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "gerçek alt süreç")
class TestRealProcess(unittest.TestCase):
    def setUp(self):
        self.procs: list[WorkerClient] = []
        self.addCleanup(lambda: [p.kill() for p in self.procs])

    def manager(self, extra_env=None):
        import shutil
        import tempfile
        logdir = tempfile.mkdtemp(prefix="oyun-mlog-")
        self.addCleanup(shutil.rmtree, logdir, True)

        def factory(spec):
            spec["host"] = "fake"
            w = WorkerClient.spawn(spec, extra_env=extra_env, log_dir=logdir)
            self.procs.append(w)
            return w

        m = RunManager(real_registry(), factory)
        self.addCleanup(m.shutdown)
        return m

    def test_real_worker_runs_and_delete_reaps(self):
        m = self.manager()
        rid = m.create(CONFIG)["runId"]
        m.start_thread()
        m.control(rid, "play", 16)
        end = time.time() + 15
        while m.get(rid)["state"]["week"] < 5 and time.time() < end:
            time.sleep(0.02)
        self.assertGreaterEqual(m.get(rid)["state"]["week"], 5)
        pid = self.procs[0].pid
        m.delete(rid)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_sigkill_worker_marks_failed(self):
        m = self.manager({"OYUN_FAKE_CRASH_WEEK": "3"})
        rid = m.create(CONFIG)["runId"]
        m.start_thread()
        m.control(rid, "play", 16)
        end = time.time() + 15
        while m.get(rid)["state"]["status"] != "failed" and time.time() < end:
            time.sleep(0.02)
        st = m.get(rid)["state"]
        self.assertEqual(st["status"], "failed")
        self.assertEqual(st["error"]["messageKey"], "hata.model_coktu")
        self.assertEqual(len(m.weeks(rid, 1, 200)), st["week"])


if __name__ == "__main__":
    unittest.main()
