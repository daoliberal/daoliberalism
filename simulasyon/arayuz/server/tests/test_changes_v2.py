"""S1: çok ayarlı atomik yama, olay `changes`, süre 100/200/500, dünya senaryosu, kimlik anlamları (sahte işçi; hızlı).

Kayıt: gerçek veri + K1 örnek kartları (`write_examples`) + bir dünya senaryosu. Canlı kartlar: gecis_destegi, ornek_sektorler
(multi), ornek_oncelik (multi, live_sync), ornek_acik (toggle); start_only: dunya_tohumu, ornek_sira, ornek_faiz;
unknown: ornek_tahvil; pasif: ornek_pasif; V + scenario_editable: ornek_akce.
"""
from __future__ import annotations

import functools
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path

from oyun_server.registry import loader
from oyun_server.registry.resolve import resolve
from oyun_server.registry.schema import RunConfigError
from oyun_server.runs.manager import RunManager
from oyun_server.testing import InProcWorker

from tests.registry_helpers import copy_data, example_defaults, read_json, write_examples, write_json
from tests.route_helpers import CONFIG as ROUTE_CONFIG, call, create_run, live_app, make_cfg as route_cfg
from tests.test_manager import CONFIG, FakeClock, FlakyHost, ManagerBase, drain, make_cfg

SCENARIO = {"id": "bol_kitlik", "values": {"ornek_akce": 1000}}


def with_card(reg, sid, **changes):
    import dataclasses
    card = dataclasses.replace(reg.by_id[sid], **changes)
    return loader.Registry(**{**reg.__dict__, "settings": [card if s.id == sid else s for s in reg.settings]})


@functools.lru_cache(maxsize=1)
def v2_registry():
    d = Path(tempfile.mkdtemp(prefix="oyun-s1-"))
    try:
        write_examples(copy_data(d))
        write_json(d / "senaryolar.json", {"scenarios": [SCENARIO]})
        texts = read_json(d / "metinler.tr.json")
        texts["_senaryolar"] = {"bol_kitlik": {"title": "Bol ve kıt"}}
        write_json(d / "metinler.tr.json", texts)
        return with_card(loader.load_registry(d, example_defaults()), "ornek_akce", apply="start_only")   # V dünya kartı: başlangıçta etkili
    finally:
        shutil.rmtree(d, True)


class V2Base(ManagerBase):
    def make2(self, reg=None, cfg=None, clock=None):
        def factory(spec):
            w = InProcWorker(spec, host_factory=self.host_factory)
            self.workers.append(w)
            return w

        m = RunManager(reg or v2_registry(), factory, clock=clock or self.clock, cfg=cfg or make_cfg())
        self.managers.append(m)
        self.mgr = m
        return m

    def change(self, rid, patch, timeout=None):
        res = {}
        t = threading.Thread(target=lambda: res.update(r=self.mgr.apply_change(rid, patch, None, timeout=timeout)))
        t.start()
        end = time.time() + 30
        while t.is_alive() and time.time() < end:
            self.mgr.pump(self.clock.t)
            time.sleep(0.002)
        t.join(30)
        if "r" not in res:
            self.fail("apply_change 30 sn içinde dönmedi")
        return res["r"]

    def started(self, weeks=2):
        m = self.make2()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= weeks)
        drain(sub)
        return m, rid, sub


class TestMultiPatch(V2Base):
    def test_multi_patch_atomic_reject(self):
        m, rid, sub = self.started()
        before = m.get(rid)["state"]
        patch = {"gecis_destegi": "kisa_sureli", "ornek_acik": True, "ornek_sira": ["genc", "kurulus"]}
        r = m.apply_change(rid, patch, None)
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "ornek_sira", "reason": "start_only"}]})
        for _ in range(5):
            m.pump(self.clock.t)
            time.sleep(0.003)
        self.assertEqual(self.hosts[0].patch_calls, [])           # hiçbiri işçiye gitmedi
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"], st["computing"]),
                         (before["version"], before["values"], False))
        self.assertEqual(m._runs[rid].accepted_version, 1)
        self.assertEqual([e for e, _ in drain(sub) if e == "world_event"], [])

    def test_multi_patch_reject_lists_every_reason(self):
        m, rid, _ = self.started()
        patch = {"ornek_sira": ["genc"], "ornek_tahvil": {"acik": True, "vade": 52, "tavan": 104},
                 "ornek_pasif": "a", "dunya_tohumu": 1, "yok_boyle": 1, "ornek_acik": "evet", "gecis_destegi": "kapali"}
        r = m.apply_change(rid, patch, None)
        self.assertFalse(r["accepted"])
        self.assertEqual({f["id"]: f["reason"] for f in r["fields"]},
                         {"ornek_sira": "start_only", "ornek_tahvil": "unverified", "ornek_pasif": "locked",
                          "dunya_tohumu": "start_only", "yok_boyle": "locked", "ornek_acik": "invalid"})
        self.assertEqual([f["id"] for f in r["fields"]], [k for k in patch if k != "gecis_destegi"])

    def test_passive_card_reason(self):
        m = self.make2(reg=with_card(v2_registry(), "ornek_acik", status="passive", apply="passive"))
        rid, _ = self.new_run()
        self.assertEqual(m.apply_change(rid, {"ornek_acik": True}, None),
                         {"accepted": False, "fields": [{"id": "ornek_acik", "reason": "passive"}]})

    def test_multi_patch_accept_single_version_event_with_changes(self):
        m, rid, sub = self.started()
        patch = {"gecis_destegi": "kisa_sureli", "ornek_acik": True, "ornek_sektorler": ["sanayi", "tarim"]}
        r = self.change(rid, patch)
        self.assertTrue(r["accepted"], r)
        self.assertEqual((r["version"], r["mode"], r["scenarioId"]), (2, "live", "dayanikli_taban"))
        self.pump_until(lambda: m.stats(rid)["released"] >= r["seamWeek"] + 2)
        ev = [d for e, d in drain(sub) if e == "world_event"]
        self.assertEqual(len(ev), 1)                              # tek sürüm, tek olay
        e = ev[0]
        ids = sorted(patch)
        self.assertEqual(e["id"], "version:2:%d:%s" % (r["seamWeek"], "+".join(ids)))
        self.assertEqual(e["rule_ids"], ids)
        by = {c["id"]: c for c in e["changes"]}
        self.assertEqual([c["id"] for c in e["changes"]], ids)    # sıralı kimlik
        self.assertEqual(by["gecis_destegi"], {"id": "gecis_destegi", "from": "kapali", "to": "kisa_sureli"})
        self.assertEqual(by["ornek_acik"]["to"], True)
        self.assertEqual(by["ornek_sektorler"]["to"], ["sanayi", "tarim"])
        self.assertEqual(self.hosts[0].patch_calls,
                         [{"TRANS_SUPPORT": 1, "ORN_ACIK": True, "ORN_SEKTOR": ("tarim", "sanayi")}])   # tek atomik yama

    def test_changes_from_is_previous_interface_value(self):
        m, rid, sub = self.started()
        a = self.change(rid, {"gecis_destegi": "kisa_sureli"})
        b = self.change(rid, {"gecis_destegi": "kurtarma_fonuyla", "ornek_acik": True})
        self.assertEqual((a["version"], b["version"]), (2, 3))
        self.pump_until(lambda: m.stats(rid)["released"] >= b["seamWeek"] + 2)
        evs = [d for e, d in drain(sub) if e == "world_event"]
        self.assertEqual(len(evs), 2)
        first, second = sorted(evs, key=lambda d: d["params"]["surum"])
        self.assertEqual(first["changes"], [{"id": "gecis_destegi", "from": "kapali", "to": "kisa_sureli"}])
        self.assertEqual(second["changes"][0], {"id": "gecis_destegi", "from": "kisa_sureli", "to": "kurtarma_fonuyla"})
        self.assertEqual(m.get(rid)["state"]["values"]["ornek_acik"], True)

    def test_week0_multi_patch_no_version(self):
        m = self.make2()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        drain(sub)
        r = self.change(rid, {"gecis_destegi": "kisa_sureli", "ornek_acik": True})
        self.assertEqual(r["seamWeek"], 0)
        self.assertEqual((r["accepted"], r["version"]), (True, 1))
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"]["gecis_destegi"], st["values"]["ornek_acik"]), (1, "kisa_sureli", True))
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 3)
        self.assertEqual([e for e, _ in drain(sub) if e == "world_event"], [])      # olay yok
        self.assertEqual(self.hosts[0].patch_calls, [{"TRANS_SUPPORT": 1, "ORN_ACIK": True}])

    def test_order_and_multi_become_tuples(self):
        reg = v2_registry()
        res = resolve(reg, {"ornek_sektorler": ["sanayi", "tarim"], "ornek_sira": ["genc", "kurulus"]})
        self.assertEqual(res.errors, [])
        self.assertEqual(res.params["ORN_SEKTOR"], ("tarim", "sanayi"))           # multi: öğe sırasıyla alt küme
        self.assertEqual(res.params["ORN_SIRA"], ("genc", "kurulus"))
        self.assertIsInstance(res.params["ORN_SEKTOR"], tuple)
        self.assertIsInstance(res.params["ORN_SIRA"], tuple)

    def test_no_op_on_error_in_empty_patch(self):
        m, rid, _ = self.started()
        self.assertEqual(m.apply_change(rid, {}, None), {"accepted": False, "fields": [{"id": "*", "reason": "invalid"}]})


class TestRoutesReasons(unittest.TestCase):
    def test_route_maps_unverified_to_locked_and_keeps_start_only(self):
        with live_app(registry=v2_registry()) as (srv, _a, _w):
            rid = create_run(srv)
            s, _, b = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {
                "ornek_tahvil": {"acik": True, "vade": 52, "tavan": 104}, "ornek_sira": ["genc"], "ornek_acik": True}})
            self.assertEqual(s, 200)
            self.assertEqual(b, {"accepted": False, "fields": [{"id": "ornek_tahvil", "reason": "locked"},
                                                               {"id": "ornek_sira", "reason": "start_only"}]})

    def test_unknown_apply_rejected_at_start(self):
        with live_app(registry=v2_registry()) as (srv, _a, _w):
            cfg = dict(ROUTE_CONFIG, values={"ornek_tahvil": {"acik": True, "vade": 52, "tavan": 104}})
            s, _, b = call(srv, "POST", "/api/runs", {"config": cfg})
            self.assertEqual(s, 422)
            self.assertEqual(b["error"]["fields"], [{"id": "ornek_tahvil", "reason": "unverified"}])


class TestDuration(V2Base):
    def test_duration_500_runs_to_end(self):
        m = self.make2(cfg=make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0}))
        h = m.create(dict(CONFIG, durationWeeks=500))
        rid = h["runId"]
        self.assertEqual(h["state"]["durationWeeks"], 500)
        sub = m.subscribe(rid)
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=60)
        evs = drain(sub)
        ended = [d for e, d in evs if e == "ended"]
        self.assertEqual(ended, [{"reason": "duration", "week": 500}])
        self.assertEqual(m.stats(rid)["released"], 500)
        self.assertEqual(len(m.weeks(rid, 1, 500)), 500)
        self.assertEqual(self.hosts[0].weeks, 500)                # işçi süreyi spec'ten aldı
        self.assertEqual(m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, None),
                         {"accepted": False, "fields": [{"id": "*", "reason": "ended"}]})

    def test_duration_100_ends_at_100(self):
        m = self.make2(cfg=make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0}))
        rid = m.create(dict(CONFIG, durationWeeks=100))["runId"]
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=60)
        self.assertEqual(m.stats(rid)["released"], 100)

    def test_duration_other_rejected(self):
        m = self.make2()
        for bad in (300, 0, 150, 501, "500", 500.0, True, None):
            with self.subTest(bad=bad), self.assertRaises(RunConfigError) as cm:
                m.create(dict(CONFIG, durationWeeks=bad))
            self.assertEqual(cm.exception.errors[0].id, "durationWeeks")
        self.assertEqual(self.workers, [])

    def test_duration_other_rejected_route(self):
        with live_app(registry=v2_registry()) as (srv, _a, _w):
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(ROUTE_CONFIG, durationWeeks=300)})
            self.assertEqual((s, b["error"]["fields"]), (422, [{"id": "durationWeeks", "reason": "invalid"}]))
            s, _, h = call(srv, "POST", "/api/runs", {"config": dict(ROUTE_CONFIG, durationWeeks=100)})
            self.assertEqual((s, h["state"]["durationWeeks"]), (201, 100))
            rid = h["runId"]
            s, _, b = call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=101")
            self.assertEqual(s, 422)                              # süre 100: 101 sınır dışı


class TestWorldScenario(V2Base):
    def test_world_scenario_values_only_v_editable(self):
        m = self.make2()
        with self.assertRaises(RunConfigError) as cm:
            m.create(dict(CONFIG, worldScenarioValues={"ornek_acik": True}))          # P kartı
        self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("ornek_acik", "locked")])
        with self.assertRaises(RunConfigError):
            m.create(dict(CONFIG, worldScenarioValues={"yok_boyle": 1}))
        with self.assertRaises(RunConfigError):
            m.create(dict(CONFIG, worldScenarioValues={"ornek_akce": 777}))            # adım (500) uymuyor
        with self.assertRaises(RunConfigError):
            m.create(dict(CONFIG, worldScenarioId="yok_boyle"))
        self.assertEqual(self.workers, [])

    def test_world_scenario_values_route_422(self):
        with live_app(registry=v2_registry()) as (srv, _a, _w):
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(ROUTE_CONFIG, worldScenarioValues={"gecis_destegi": "kapali"})})
            self.assertEqual((s, b["error"]["fields"]), (422, [{"id": "gecis_destegi", "reason": "locked"}]))

    def test_world_values_do_not_mix_into_state_values(self):
        m = self.make2()
        h = m.create(dict(CONFIG, worldScenarioId="bol_kitlik", worldScenarioValues={"ornek_akce": 3000},
                          values={"ornek_acik": True}))
        st = h["state"]
        self.assertEqual(st["values"], {"gecis_destegi": "kapali", "ornek_acik": True})   # yalnız Şart
        self.assertEqual(st["worldScenarioId"], "bol_kitlik")
        self.assertEqual(st["scenarioId"], "dayanikli_taban")
        # model geçersiz kılmaları: senaryo < dünya değerleri < Şart
        init = [w for w in self.workers][0].spec
        self.assertEqual(init["overrides"]["ORN_PARA"], 3000)
        self.assertEqual(init["overrides"]["ORN_ACIK"], True)
        self.assertEqual(init["overrides"]["TRANS_SUPPORT"], 0)

    def test_scenario_defaults_apply_under_world_values(self):
        m = self.make2()
        m.create(dict(CONFIG, worldScenarioId="bol_kitlik"))
        self.assertEqual(self.workers[0].spec["overrides"]["ORN_PARA"], 1000)

    def test_scenario_id_unchanged_canli(self):
        with live_app(registry=v2_registry()) as (srv, _a, _w):
            _, _, a = call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "kapali"}})
            self.assertEqual((a["ok"], a["scenarioId"]), (True, "canli"))
            cfg = dict(ROUTE_CONFIG, worldScenarioId="bol_kitlik")
            s, _, h = call(srv, "POST", "/api/runs", {"config": cfg})
            self.assertEqual(s, 201)
            rid = h["runId"]
            self.assertEqual(h["state"]["scenarioId"], "dayanikli_taban")       # şablon kimliği
            self.assertEqual(h["state"]["worldScenarioId"], "bol_kitlik")       # ayrı alan
            _, _, a = call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "kapali"}, "runId": rid})
            self.assertEqual(a["scenarioId"], "canli")
            _, _, c = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})
            self.assertEqual((c["accepted"], c["scenarioId"]), (True, "dayanikli_taban"))

    def test_goals_validated_and_echoed(self):
        m = self.make2()
        self.assertEqual(m.create(dict(CONFIG, goals=["alive", "gini"]))["state"]["goals"], ["alive", "gini"])
        self.assertNotIn("goals", m.create(CONFIG)["state"])
        for bad in (["yok"], "alive", ["alive", "alive"], [1]):
            with self.subTest(bad=bad), self.assertRaises(RunConfigError):
                m.create(dict(CONFIG, goals=bad))


class TestLiveKeys(V2Base):
    def test_live_keys_from_registry_cards(self):
        m = self.make2()
        self.assertTrue(frozenset({"TRANS_SUPPORT", "WAGE_TAX", "CORP_TAX", "ORN_SEKTOR", "ORN_ACIK"}) <= m.live_keys)      # R2 gerçek kartlarla canlı anahtar ekler
        self.assertNotIn("ORN_ONCELIK", m.live_keys)      # live_sync: W_SYNC tarifi yok
        self.assertNotIn("SALES_TAX", m.live_keys)

    def test_live_keys_read_once(self):
        calls = []

        def keys(reg=None):
            calls.append(reg)
            return frozenset({"TRANS_SUPPORT", "ORN_ACIK"})

        m = self.make2(cfg=make_cfg(load_live_keys=keys))
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 3)
        self.assertTrue(self.change(rid, {"gecis_destegi": "kisa_sureli"})["accepted"])
        self.assertEqual(self.change(rid, {"ornek_sektorler": ["tarim"]}),
                         {"accepted": False, "fields": [{"id": "ornek_sektorler", "reason": "start_only"}]})
        self.assertEqual(len(calls), 1)
        spec = self.workers[0].spec
        self.assertEqual(sorted(spec["live_keys"]), ["ORN_ACIK", "TRANS_SUPPORT"])    # işçiye spec ile verildi

    def test_registry_without_apply_falls_back_to_decisions(self):
        from oyun_server import config

        class Bare:
            settings = [type("C", (), {"id": "x", "params": ("A",)})()]

        self.assertEqual(config.load_live_keys(Bare()), config.load_live_keys())
        self.assertEqual(config.load_live_keys(), frozenset({"CORP_TAX", "TRANS_SUPPORT", "WAGE_TAX"}))


class TestTupleRestore(unittest.TestCase):
    """JSON işçi sınırında tuple -> liste olur; model tuple bekleyen parametreye liste yazılmamalı."""

    def test_coerce_like(self):
        from oyun_server.sim.livepatch import coerce_like
        self.assertEqual(coerce_like((1, 2), [3, 4]), (3, 4))
        self.assertIsInstance(coerce_like(("a",), ["b"]), tuple)
        self.assertEqual(coerce_like([1], [2]), [2])               # model listeyse liste kalır
        self.assertEqual(coerce_like(0.1, 0.2), 0.2)
        self.assertEqual(coerce_like(frozenset({"a"}), ["b", "c"]), frozenset({"b", "c"}))
        self.assertIsInstance(coerce_like(frozenset({"a"}), ["b"]), frozenset)
        self.assertIsInstance(coerce_like({"a"}, ["b"]), set)
        for cur, bad in (((1,), "x"), ((1,), 5), ((1,), {"a": 1}), ((1, 2), [[1], [2]]), (frozenset(), [["a"]]), ([1], "x")):
            with self.subTest(cur=cur, bad=bad), self.assertRaises(TypeError):
                coerce_like(cur, bad)

    def test_model_host_patch_restores_tuple(self):
        from oyun_server.config import MODEL_ROOT
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5, live_keys={"TIER_WAGE"})
        try:
            p = h._model._modules["simkit.params"]
            self.assertIsInstance(p.TIER_WAGE, tuple)
            h.patch({"TIER_WAGE": [10, 15, 25]})                   # NDJSON'dan gelen biçim
            self.assertEqual(p.TIER_WAGE, (10, 15, 25))
            self.assertIsInstance(p.TIER_WAGE, tuple)
            self.assertEqual(h.effective["TIER_WAGE"], (10, 15, 25))
        finally:
            h.close()


if __name__ == "__main__":
    unittest.main()
