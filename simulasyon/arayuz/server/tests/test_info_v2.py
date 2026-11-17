"""S1: `/api/info` bağlamları, `/api/hello` yetenekleri, kayıt yayımı ve tel değer kümeleri (`enums`)."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from tests.route_helpers import call, create_run, live_app
from tests.test_changes_v2 import v2_registry

FIX = json.loads((Path(__file__).parent / "fixtures" / "wire_contract.json").read_text(encoding="utf-8"))
WIRE_TS = Path(__file__).resolve().parents[4] / "apps" / "web" / "src" / "oyun" / "sim" / "live" / "wire.ts"
CAPABILITIES = {"branch": True, "seeds": False, "compare": False, "library": False, "city": True, "chain": True,
                "jobs": False, "rebuild": True, "harita": True}


def by_id(info):
    return {s["id"]: s for s in info["settings"]}


class TestInfoContexts(unittest.TestCase):
    def test_info_changeable_by_context(self):
        with live_app(registry=v2_registry()) as (srv, _a, _w):
            _, _, start = call(srv, "GET", "/api/info")
            s = by_id(start)
            for sid in ("gecis_destegi", "dunya_tohumu", "ornek_sira", "ornek_faiz", "ornek_acik", "ornek_sektorler"):
                self.assertEqual((s[sid]["changeable"], s[sid].get("reason")), (True, None), sid)
                self.assertTrue(all(o["available"] for o in s[sid]["options"]), sid)
            self.assertEqual((s["ornek_tahvil"]["changeable"], s["ornek_tahvil"]["reason"]), (False, "unverified"))
            self.assertNotIn("ornek_pasif", s)                    # düzenlenemez kart ayarlar listesinde yok
            self.assertNotIn("ornek_akce", s)                     # V kartı Şart/canlı yamada kilitli (N1): yalnız dünya senaryosuyla
            rid = create_run(srv)
            _, _, run = call(srv, "GET", f"/api/info?run={rid}")
            r = by_id(run)
            for sid in ("gecis_destegi", "ornek_acik", "ornek_sektorler"):
                self.assertEqual((r[sid]["changeable"], r[sid].get("reason")), (True, None), sid)
            for sid in ("dunya_tohumu", "ornek_sira", "ornek_faiz", "ornek_oncelik"):
                self.assertEqual((r[sid]["changeable"], r[sid]["reason"]), (False, "start_only"), sid)
                self.assertTrue(all(not o["available"] and o["reason"] == "locked" for o in r[sid]["options"]), sid)
            self.assertEqual((r["ornek_tahvil"]["changeable"], r["ornek_tahvil"]["reason"]), (False, "unverified"))

    def test_availability_reasons(self):
        with live_app(registry=v2_registry()) as (srv, _a, _w):
            rid = create_run(srv)
            vals = {"gecis_destegi": "kapali", "dunya_tohumu": 1, "ornek_tahvil": {"acik": True, "vade": 52, "tavan": 104}}
            _, _, a = call(srv, "POST", "/api/availability", {"values": vals})
            self.assertEqual((a["ok"], a["scenarioId"], [(b["settingId"], b["reason"]) for b in a["blocked"]]),
                             (False, None, [("ornek_tahvil", "unverified")]))
            _, _, a = call(srv, "POST", "/api/availability", {"values": vals, "runId": rid})
            self.assertEqual([(b["settingId"], b["reason"]) for b in a["blocked"]],
                             [("dunya_tohumu", "start_only"), ("ornek_tahvil", "unverified")])
            _, _, a = call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "kapali", "ornek_acik": True}, "runId": rid})
            self.assertEqual((a["ok"], a["scenarioId"], a["blocked"]), (True, "canli", []))

    def test_info_carries_registry_durations_capabilities(self):
        with live_app(registry=v2_registry()) as (srv, app, _w):
            _, _, info = call(srv, "GET", "/api/info")
            _, _, reg = call(srv, "GET", "/api/registry")
            self.assertEqual(info["registry"], reg)
            self.assertEqual(info["durations"], [100, 200, 500, 520])
            self.assertEqual(info["durationWeeks"], 200)
            self.assertEqual(info["capabilities"], CAPABILITIES)
            self.assertIn("scenarios", info["registry"])
            self.assertEqual([x["id"] for x in info["registry"]["scenarios"]], ["bol_kitlik"])

    def test_capabilities_in_hello_and_info(self):
        with live_app() as (srv, app, _w):
            _, _, hello = call(srv, "GET", "/api/hello")
            _, _, info = call(srv, "GET", "/api/info")
            self.assertEqual(hello["capabilities"], CAPABILITIES)
            self.assertEqual(info["capabilities"], CAPABILITIES)
            app.capabilities["jobs"] = True                       # sonraki S görevleri kendi yeteneğini açar
            self.assertTrue(call(srv, "GET", "/api/hello")[2]["capabilities"]["jobs"])
            self.assertTrue(call(srv, "GET", "/api/info")[2]["capabilities"]["jobs"])

    def test_info_run_unknown_404(self):
        with live_app() as (srv, _a, _w):
            self.assertEqual(call(srv, "GET", "/api/info?run=canli-yok")[0], 404)


def ts_array(name: str) -> list[str]:
    m = re.search(rf"const {name}\b[^=]*=\s*\[([^\]]*)\]", WIRE_TS.read_text(encoding="utf-8"))
    assert m, name
    return re.findall(r'"([^"]+)"', m.group(1))


class TestWireEnums(unittest.TestCase):
    def test_wire_enums_fixture(self):
        from oyun_server.registry import resolve, schema
        from oyun_server.runs import manager, routes
        enums = FIX["enums"]
        self.assertEqual(enums["durations"], list(resolve.DURATIONS))
        self.assertEqual(list(resolve.DURATIONS), [100, 200, 500, 520])                 # 520 = DAO oyunu (K-231)
        self.assertIn(520, FIX["info"]["durations"])
        self.assertEqual(enums["controlActions"], list(manager.ACTIONS))                 # `olay` T6b ile sunucuda (eşitlik)
        self.assertIn("olay", manager.ACTIONS)
        self.assertEqual(enums["speeds"], list(manager.SPEEDS))
        self.assertEqual(enums["applyClasses"], list(schema.APPLIES))
        self.assertEqual(enums["capabilityKeys"], list(routes.CAPABILITY_KEYS))
        self.assertEqual(enums["changeReasons"], list(routes.CHANGE_REASONS))
        self.assertEqual(enums["availabilityReasons"], list(routes.AVAILABILITY_REASONS))
        self.assertEqual(enums["settingReasons"], list(routes.SETTING_REASONS))
        self.assertEqual(enums["settingLockReasons"], [manager.CONTEXT_LOCK_REASON])
        # web ayrıştırıcısıyla aynı kümeler (wire.ts yalnız okunur)
        self.assertEqual(enums["capabilityKeys"], ts_array("CAPABILITY_KEYS"))
        self.assertEqual(enums["changeReasons"], ts_array("REASONS"))
        self.assertEqual(enums["availabilityReasons"], ts_array("BLOCK_REASONS"))
        self.assertEqual(enums["settingReasons"], ts_array("SETTING_REASONS"))
        self.assertEqual(enums["applyClasses"], ts_array("APPLIES"))
        self.assertEqual(enums["settingLockReasons"], ts_array("SETTING_LOCK_REASONS"))

    def test_server_reasons_inside_enums(self):
        enums = FIX["enums"]
        for key in ("change_locked", "change_start_only", "change_rejected", "change_ended"):
            for f in FIX[key]["fields"]:
                self.assertIn(f["reason"], enums["changeReasons"])
        for b in FIX["availability_blocked"]["blocked"]:
            self.assertIn(b["reason"], enums["availabilityReasons"])


if __name__ == "__main__":
    unittest.main()
