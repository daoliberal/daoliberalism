"""Dilim 2 son inceleme düzeltmesi (sunucu): I1 not sürüm kaydında, I2 bağlam kilidi, M2 şehir adı sınırı, M3 önizleme `fromWeek`."""
from __future__ import annotations

import copy
import threading
import time
import unittest

from oyun_server.registry.schema import RunConfigError
from oyun_server.runs import manager as manager_mod
from oyun_server.runs.routes import MAX_NOTE_LEN
from oyun_server.sim.host import ModelHost
from oyun_server.config import MODEL_ROOT

from tests.test_wire_contract import FIX, shape_diff
from tests.route_helpers import CONFIG as ROUTE_CONFIG, call, create_run, live_app
from tests.test_changes import ChangeBase
from tests.test_jobs import JobBase
from tests.test_manager import CONFIG

LOCKED = dict(CONFIG, templateId="bos_sart")        # gecis_destegi kapalı + kuruluş fonu kapalı (şablon), şehir kasası kuralı varsayılan kapalı
KURTARMA = {"gecis_destegi": "kurtarma_fonuyla"}


class NoteChange(ChangeBase):
    def change_note(self, rid, patch, note):
        res = {}
        t = threading.Thread(target=lambda: res.update(r=self.mgr.apply_change(rid, patch, note)))
        t.start()
        end = time.time() + 30
        while t.is_alive() and time.time() < end:
            self.mgr.pump(self.clock.t)
            time.sleep(0.002)
        t.join(30)
        return res["r"]

    def started(self, cfg=None, weeks=2):
        m = self.make()
        rid = m.create(cfg or CONFIG)["runId"]
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= weeks)
        return m, rid


class TestNoteInVersions(NoteChange):
    def test_note_written_to_version_and_published(self):
        m, rid = self.started()
        r = self.change_note(rid, {"gecis_destegi": "kisa_sureli"}, "  Kasa eridi, destek açtım  ")
        self.assertTrue(r["accepted"], r)
        v = m.get(rid)["state"]["versions"]
        self.assertNotIn("note", v[0])
        self.assertEqual(v[1]["note"], "Kasa eridi, destek açtım")          # kırpılmış
        self.assertEqual((v[1]["version"], v[1]["fromWeek"]), (r["version"], r["seamWeek"]))

    def test_no_note_key_without_note(self):
        m, rid = self.started()
        for note in (None, "", "   "):
            r = self.change_note(rid, {"gecis_destegi": "kisa_sureli" if note is None else "kurtarma_fonuyla"}, note)
            self.assertTrue(r["accepted"], r)
        self.assertTrue(all("note" not in x for x in m.get(rid)["state"]["versions"]))

    def test_note_at_week0_goes_to_version_one(self):
        m = self.make()
        rid = m.create(CONFIG)["runId"]
        r = self.change_note(rid, {"gecis_destegi": "kisa_sureli"}, "Baştan")
        self.assertEqual((r["accepted"], r["seamWeek"], r["version"]), (True, 0, 1), r)
        self.assertEqual(m.get(rid)["state"]["versions"][0]["note"], "Baştan")

    def test_route_note_length_limit_and_roundtrip(self):
        with live_app() as (srv, _app, _w):
            rid = create_run(srv)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            deadline = time.time() + 20
            while call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"] < 1 and time.time() < deadline:
                time.sleep(0.01)
            s, _, b = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}, "note": "x" * (MAX_NOTE_LEN + 1)})
            self.assertEqual((s, b["error"]["code"], b["error"]["fields"]), (422, "invalid_change", [{"id": "note", "reason": "invalid"}]))
            s, _, b = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}, "note": "x" * MAX_NOTE_LEN})
            self.assertEqual((s, b["accepted"]), (200, True), b)
            vs = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["versions"]
            self.assertEqual(vs[-1]["note"], "x" * MAX_NOTE_LEN)

    def test_real_state_matches_fixture_with_note(self):
        """Sözleşme fikstürü: gerçek sunucunun notlu `versions` biçimi `state_note_version` ile aynı (sahte sunucu da aynı dosyadan okur)."""
        with live_app() as (srv, _app, _w):
            rid = create_run(srv)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            deadline = time.time() + 20
            while call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"] < 1 and time.time() < deadline:
                time.sleep(0.01)
            note = FIX["state_note_version"]["versions"][1]["note"]
            call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}, "note": note})
            st = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]
            self.assertEqual(shape_diff(st, FIX["state_note_version"], "$"), [])
            self.assertEqual(st["versions"][1]["note"], note)

    def test_created_state_status_equals_fixture_value(self):
        """Parite bulgusu: sahte sunucu "ready" bildiriyordu, gerçek sunucu hafta 0'da `paused`; fikstür gerçek değeri taşır."""
        with live_app() as (srv, _app, _w):
            st = call(srv, "POST", "/api/runs", {"config": ROUTE_CONFIG})[2]["state"]
            self.assertEqual(st["status"], FIX["state_ready"]["status"])
            self.assertEqual(st["status"], FIX["handle"]["state"]["status"])

    def test_note_limit_is_single_value(self):
        self.assertEqual(MAX_NOTE_LEN, 500)


class TestContextLock(NoteChange):
    LOCK = [{"id": "gecis_destegi", "reason": "no_cash_floor"}]

    def test_helper_rule(self):
        reg = self.make().registry
        lock = lambda ov: manager_mod.context_locks(reg, ov)
        self.assertEqual(lock({"TRANS_SUPPORT": 0, "FOUND_FUND": 0}), frozenset({"TRANS_SUPPORT"}))
        self.assertEqual(lock({"TRANS_SUPPORT": 0}), frozenset())                       # FOUND_FUND varsayılan açık (1)
        self.assertEqual(lock({"TRANS_SUPPORT": 0, "FOUND_FUND": 0, "TREASURY_RULE": 1}), frozenset())
        self.assertEqual(lock({"TRANS_SUPPORT": 2, "FOUND_FUND": 0}), frozenset())      # destek açık başladı: kasa tabanı kurulur
        self.assertEqual(lock({"FOUND_FUND": 0}), frozenset())                          # TRANS_SUPPORT varsayılan 2

    def test_live_change_rejected_in_locked_context_worker_never_called(self):
        m, rid = self.started(LOCKED)
        st = m.get(rid)["state"]
        self.assertEqual(st["settingLocks"], self.LOCK)
        r = m.apply_change(rid, KURTARMA, None)
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "gecis_destegi", "reason": "start_only"}]})
        r2 = m.apply_change(rid, {"gecis_destegi": "kapali"}, None)                       # kart düzeyinde kilit: değer fark etmez
        self.assertEqual(r2, {"accepted": False, "fields": [{"id": "gecis_destegi", "reason": "start_only"}]})
        for _ in range(5):
            m.pump(self.clock.t)
            time.sleep(0.005)
        self.assertEqual(self.hosts[0].patch_calls, [])
        self.assertEqual(m.get(rid)["state"]["version"], 1)

    def test_atomic_with_other_live_setting(self):
        m, rid = self.started(LOCKED)
        r = m.apply_change(rid, {"gecis_destegi": "kisa_sureli", "kurumlar_vergisi": 40}, None)
        self.assertEqual(r["accepted"], False)
        self.assertEqual([f["id"] for f in r["fields"]], ["gecis_destegi"])

    def test_unlocked_contexts_still_changeable(self):
        for cfg in (CONFIG, dict(LOCKED, values={"sehir_kasasi_kurali": {"acik": True, "hafta": 4, "yakinsama": 25}}),
                    dict(LOCKED, values={"kurulus_fonu": {"acik": True, "hedef": 50}}), dict(LOCKED, values={"gecis_destegi": "kurtarma_fonuyla"})):
            with self.subTest(cfg=cfg.get("values")):
                m, rid = self.started(cfg)
                self.assertNotIn("settingLocks", m.get(rid)["state"])
                self.assertTrue(self.change(rid, {"gecis_destegi": "kisa_sureli"})["accepted"])

    def test_schedule_validation_uses_start_context(self):
        m = self.make()
        with self.assertRaises(RunConfigError) as cm:
            m.create(LOCKED, schedule=[{"week": 30, "patch": KURTARMA}])
        self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("schedule[0].patch.gecis_destegi", "start_only")])
        # hafta 0 yaması kuruluşa katılır: bağlam açılır, sonraki takvim geçerli
        h = m.create(LOCKED, schedule=[{"week": 0, "patch": KURTARMA}, {"week": 30, "patch": {"gecis_destegi": "kisa_sureli"}}])
        self.assertNotIn("settingLocks", h["state"])

    def test_branch_from_locked_parent(self):
        m, rid = self.started(LOCKED, weeks=3)
        with self.assertRaises(RunConfigError) as cm:
            m.branch(rid, 2, KURTARMA)
        self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("gecis_destegi", "start_only")])
        b = m.branch(rid, 2)                                                               # yamasız dal ebeveynin bağlamını korur
        self.assertEqual(b["state"]["settingLocks"], self.LOCK)

    def test_info_and_availability_in_run_context(self):
        with live_app() as (srv, _app, _w):
            lid = create_run(srv, dict(ROUTE_CONFIG, templateId="bos_sart"))
            oid = create_run_other(srv)
            lstate = call(srv, "GET", f"/api/runs/{lid}")[2]["state"]
            self.assertEqual(lstate["settingLocks"], self.LOCK)
            self.assertEqual(shape_diff(lstate, FIX["state_setting_locks"], "$"), [])
            self.assertEqual(FIX["state_setting_locks"]["settingLocks"], self.LOCK)
            item = lambda rid: next(x for x in call(srv, "GET", f"/api/info?run={rid}")[2]["settings"] if x["id"] == "gecis_destegi")
            self.assertEqual((item(lid)["changeable"], item(lid)["reason"]), (False, "start_only"))
            self.assertTrue(item(oid)["changeable"])
            body = {"values": KURTARMA}
            self.assertEqual(call(srv, "POST", "/api/availability", dict(body, runId=lid))[2]["blocked"],
                             [{"settingId": "gecis_destegi", "option": "kurtarma_fonuyla", "reason": "start_only"}])
            self.assertTrue(call(srv, "POST", "/api/availability", dict(body, runId=oid))[2]["ok"])
            self.assertTrue(call(srv, "POST", "/api/availability", body)[2]["ok"])       # başlangıç bağlamı serbest
            s, _, ch = call(srv, "POST", f"/api/runs/{lid}/changes", {"from": "next_week", "patch": KURTARMA})
            self.assertEqual((s, ch), (200, {"accepted": False, "fields": [{"id": "gecis_destegi", "reason": "start_only"}]}))


def create_run_other(srv):
    return create_run(srv, dict(ROUTE_CONFIG, templateId="dayanikli_taban"))


class TestModelHostSecondGate(unittest.TestCase):
    """Gerçek model: kuruluşta kasa tabanı yapısı (`L.cexp`) kurulmadıysa TRANS_SUPPORT'u sıfırdan farklı yamalamak reddedilir (yarı uygulama olmaz)."""

    def test_locked_start_rejects_trans_support_patch(self):
        h = ModelHost(str(MODEL_ROOT), {"FOUND_FUND": 0, "TRANS_SUPPORT": 0}, 200, 5)
        try:
            self.assertIsNone(h._W.L.cexp)
            with self.assertRaises(ValueError):
                h.patch({"TRANS_SUPPORT": 2})
            with self.assertRaises(ValueError):
                h.patch({"WAGE_TAX": 0.2, "TRANS_SUPPORT": 1})                          # karma: serbest anahtar da yazılmaz
            self.assertEqual((h.effective, h.base_values), ({"FOUND_FUND": 0, "TRANS_SUPPORT": 0}, {}))
            self.assertEqual(h.patch({"WAGE_TAX": 0.2}) > 0, True)                       # başka canlı anahtar serbest
        finally:
            h.close()

    def test_floor_structure_present_allows_patch(self):
        h = ModelHost(str(MODEL_ROOT), {"FOUND_FUND": 1, "TRANS_SUPPORT": 0}, 200, 5)
        try:
            self.assertIsNotNone(h._W.L.cexp)
            for _ in range(3):
                h.step()
            self.assertGreater(h.patch({"TRANS_SUPPORT": 2}), 0)
            h.step()
        finally:
            h.close()


class TestNameLimits(unittest.TestCase):
    def test_city_name_length_limit(self):
        self.assertEqual(manager_mod.MAX_CITY_NAME_LEN, manager_mod.MAX_NAME_LEN)
        with live_app() as (srv, _app, _w):
            ok = dict(ROUTE_CONFIG, cityNames=["a" * 64] * 5)
            self.assertEqual(call(srv, "POST", "/api/runs", {"config": ok})[0], 201)
            bad = dict(ROUTE_CONFIG, cityNames=["a" * 65, "b", "c", "d", "e"])
            s, _, b = call(srv, "POST", "/api/runs", {"config": bad})
            self.assertEqual((s, b["error"]["fields"]), (422, [{"id": "cityNames", "reason": "invalid"}]))


class TestPreviewFromWeek(JobBase):
    def test_from_week_must_be_before_duration(self):
        self.make()
        cfg = dict(CONFIG, durationWeeks=100)
        for fw in (100, 101, 1000):
            with self.assertRaises(RunConfigError, msg=str(fw)) as cm:
                self.jm.start({"kind": "preview", "base": cfg, "draft": cfg, "fromWeek": fw})
            self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("fromWeek", "invalid")])
        j = self.wait_status(self.jm.start({"kind": "preview", "base": cfg, "draft": cfg, "fromWeek": 99, "weeks": 5}))
        self.assertEqual(j["status"], "done", j)

    def test_default_duration_when_unspecified(self):
        self.make()
        base = {k: v for k, v in CONFIG.items() if k != "durationWeeks"}
        with self.assertRaises(RunConfigError):
            self.jm.start({"kind": "preview", "base": base, "draft": base, "fromWeek": 200})


if __name__ == "__main__":
    unittest.main()
