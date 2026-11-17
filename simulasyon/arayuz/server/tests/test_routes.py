"""A7b: HTTP uç noktaları (FakeHost, rastgele kapı)."""
from __future__ import annotations

import copy
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

from oyun_server import __main__ as cli
from oyun_server.runs import routes

from tests.route_helpers import CONFIG, call, create_run, live_app
from tests.test_hello import CAP, cli_env, launch, wait_up


def err_fields(body):
    return [(f["id"], f["reason"]) for f in body["error"]["fields"]]


class Routes(unittest.TestCase):
    def test_create_and_get(self):
        with live_app() as (srv, _app, _w):
            s, h, b = call(srv, "POST", "/api/runs", {"config": CONFIG})
            self.assertEqual(s, 201)
            self.assertTrue(b["runId"].startswith("canli-"))
            st = b["state"]
            self.assertEqual((st["runId"], st["week"], st["version"], st["durationWeeks"]), (b["runId"], 0, 1, 200))
            self.assertEqual(st["name"], "Deneme")
            self.assertEqual(h["cache-control"], "no-store")
            s2, _, g = call(srv, "GET", f"/api/runs/{b['runId']}")
            self.assertEqual(s2, 200)
            self.assertEqual(g["runId"], b["runId"])
            self.assertEqual(g["state"]["status"], b["state"]["status"])

    def test_create_bad_name_or_city_names_422_not_500(self):
        with live_app() as (srv, _a, _w):
            for patch, field in (({"cityNames": 5}, "cityNames"), ({"cityNames": "abc"}, "cityNames"),
                                 ({"cityNames": [1]}, "cityNames"), ({"name": {"a": 1}}, "name")):
                s, _, b = call(srv, "POST", "/api/runs", {"config": dict(CONFIG, **patch)})
                self.assertEqual(s, 422, patch)
                self.assertEqual(b["error"]["code"], "invalid_config")
                self.assertEqual(err_fields(b), [(field, "invalid")], patch)

    def test_create_invalid_config_422_with_fields(self):
        with live_app() as (srv, _a, _w):
            bad = dict(CONFIG, durationWeeks=300)
            s, _, b = call(srv, "POST", "/api/runs", {"config": bad})
            self.assertEqual(s, 422)
            self.assertEqual(b["error"]["code"], "invalid_config")
            self.assertEqual(err_fields(b), [("durationWeeks", "invalid")])
            # bilinmeyen anahtar ve pasif/kilitli kimlikler dışarıya `locked` olarak çevrilir (P-18)
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(CONFIG, values={"yok_boyle_ayar": 1, "dunya_sabit_kalemleri": 10})})
            self.assertEqual(s, 422)
            self.assertEqual(sorted(err_fields(b)), [("dunya_sabit_kalemleri", "locked"), ("yok_boyle_ayar", "locked")])
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(CONFIG, values={"gecis_destegi": "yok"})})
            self.assertEqual((s, err_fields(b)), (422, [("gecis_destegi", "invalid")]))
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(CONFIG, templateId="yok")})
            self.assertEqual((s, err_fields(b)), (422, [("templateId", "locked")]))
            # config yok / nesne değil
            for body in ({}, {"config": 3}, {"config": []}):
                s, _, b = call(srv, "POST", "/api/runs", body)
                self.assertEqual((s, err_fields(b)), (422, [("config", "invalid")]))
            s, _, b = call(srv, "POST", "/api/runs", b"{bozuk")
            self.assertEqual((s, b["error"]["code"]), (400, "bad_json"))

    def test_unknown_run_404_json(self):
        with live_app() as (srv, _a, _w):
            for method, path, body in [
                ("GET", "/api/runs/yok", None),
                ("POST", "/api/runs/yok/control", {"action": "play"}),
                ("POST", "/api/runs/yok/changes", {"from": "next_week", "patch": {}}),
                ("GET", "/api/runs/yok/weeks?from=1&to=2", None),
                ("GET", "/api/runs/yok/events", None),
                ("DELETE", "/api/runs/yok", None),
            ]:
                s, h, b = call(srv, method, path, body)
                self.assertEqual(s, 404, path)
                self.assertTrue(h["content-type"].startswith("application/json"), path)
                self.assertEqual(b["error"]["code"], "not_found", path)
                self.assertEqual(b["error"]["fields"], [])

    def test_control_validation(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            p = f"/api/runs/{rid}/control"
            cases = [
                ({"action": "play", "speed": 2}, [("speed", "invalid")]),
                ({"action": "play", "speed": 0}, [("speed", "invalid")]),
                ({"action": "play", "speed": True}, [("speed", "invalid")]),
                ({"action": "play", "speed": "4"}, [("speed", "invalid")]),
                ({"action": "play", "speed": 4.0}, [("speed", "invalid")]),
                ({"action": "zipla"}, [("action", "invalid")]),
                ({"action": 3}, [("action", "invalid")]),
                ({}, [("action", "invalid")]),
                ({"action": "oyna", "speed": 7}, [("action", "invalid"), ("speed", "invalid")]),
            ]
            for body, want in cases:
                s, _, b = call(srv, "POST", p, body)
                self.assertEqual(s, 422, body)
                self.assertEqual(b["error"]["code"], "invalid_control")
                self.assertEqual(err_fields(b), want, body)
            for sp in (1, 4, 16):
                s, _, st = call(srv, "POST", p, {"action": "pause", "speed": sp})
                self.assertEqual((s, st["speed"], st["runId"]), (200, sp, rid))
            s, _, st = call(srv, "POST", p, {"action": "play"})
            self.assertEqual((s, st["status"]), (200, "running"))

    def test_weeks_range_bounds(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            for _ in range(3):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            deadline = time.time() + 30
            while time.time() < deadline and call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"] < 3:
                time.sleep(0.01)
            self.assertGreaterEqual(call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"], 3, "3 hafta yayımlanmadı")
            s, _, w = call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=3")
            self.assertEqual((s, [p["week"] for p in w]), (200, [1, 2, 3]))
            s, _, w = call(srv, "GET", f"/api/runs/{rid}/weeks?from=2&to=2")
            self.assertEqual([p["week"] for p in w], [2])
            s, _, w = call(srv, "GET", f"/api/runs/{rid}/weeks?from=3&to=200")   # yayımlanmamışlar yok
            self.assertEqual((s, [p["week"] for p in w]), (200, [3]))
            s, _, w = call(srv, "GET", f"/api/runs/{rid}/weeks?from=150&to=160")
            self.assertEqual((s, w), (200, []))
            for q in ("", "?from=1", "?to=3", "?from=0&to=3", "?from=-1&to=3", "?from=4&to=3", "?from=a&to=3", "?from=1&to=201",
                      "?from=1.5&to=3", "?from=1&to=99999999999999999999", "?from=%20&to=3"):
                s, _, b = call(srv, "GET", f"/api/runs/{rid}/weeks{q}")
                self.assertEqual(s, 422, q)
                self.assertEqual(b["error"]["code"], "invalid_range", q)
                self.assertTrue(b["error"]["fields"], q)

    def test_server_restart_old_run_404(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            self.assertEqual(call(srv, "GET", f"/api/runs/{rid}")[0], 200)
        with live_app() as (srv2, _a2, _w2):
            s, _, b = call(srv2, "GET", f"/api/runs/{rid}")
            self.assertEqual((s, b["error"]["code"]), (404, "not_found"))
            self.assertEqual(call(srv2, "GET", f"/api/runs/{rid}/events")[0], 404)

    def test_delete_then_events_404(self):
        with live_app() as (srv, _a, workers):
            rid = create_run(srv)
            s, _, b = call(srv, "DELETE", f"/api/runs/{rid}")
            self.assertEqual((s, b), (204, None))
            for method, path, body in [("GET", f"/api/runs/{rid}/events", None), ("GET", f"/api/runs/{rid}", None),
                                       ("DELETE", f"/api/runs/{rid}", None),
                                       ("POST", f"/api/runs/{rid}/control", {"action": "play"})]:
                self.assertEqual(call(srv, method, path, body)[0], 404, path)
            deadline = time.time() + 30
            while time.time() < deadline and any(w.alive() for w in workers):
                time.sleep(0.02)
            self.assertFalse(any(w.alive() for w in workers))

    def test_availability_hostile_values(self):
        with live_app() as (srv, _a, _w):
            s, _, b = call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "kapali"}})
            self.assertEqual((s, b), (200, {"ok": True, "scenarioId": "canli", "blocked": []}))
            s, _, b = call(srv, "POST", "/api/availability", {"values": {}})
            self.assertEqual((s, b["ok"]), (200, True))
            s, _, b = call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "yok", "dunya_sabit_kalemleri": 10, "hayalet": True}})
            self.assertEqual(s, 200)
            self.assertFalse(b["ok"])
            self.assertIsNone(b["scenarioId"])
            self.assertEqual(sorted((x["settingId"], x["option"], x["reason"]) for x in b["blocked"]),
                             [("dunya_sabit_kalemleri", "10", "locked"), ("gecis_destegi", "yok", "locked"), ("hayalet", "true", "locked")])
            huge = 10 ** 400
            hostile = [
                {"values": []}, {"values": "x"}, {"values": None}, {"values": 7}, {}, {"degerler": {}},
                {"values": {"gecis_destegi": None}}, {"values": {"gecis_destegi": []}}, {"values": {"gecis_destegi": {"a": 1}}},
                {"values": {"gecis_destegi": [[[[]]]]}}, {"values": {"gecis_destegi": True}},
                {"values": {"gecis_destegi": 1e308}}, {"values": {"dunya_tohumu": huge}}, {"values": {"dunya_tohumu": -huge}},
                {"values": {"dunya_tohumu": 1.5}}, {"values": {"dunya_tohumu": True}}, {"values": {"dunya_tohumu": "0"}},
                {"values": {"dunya_sabit_kalemleri": huge}}, {"values": {"": 1}}, {"values": {"\u0000": 1}},
                {"values": {"gecis_destegi": "x" * 5000}}, {"values": {str(i): i for i in range(500)}},
                {"values": {"__proto__": {"a": 1}, "constructor": 1}},
            ]
            for payload in hostile:
                body = json.dumps(payload)
                s, _, b = call(srv, "POST", "/api/availability", body)
                self.assertIn(s, (200, 422), payload if len(body) < 200 else body[:80])
                if s == 200:
                    self.assertIsInstance(b["ok"], bool)
                    for x in b["blocked"]:
                        self.assertIn(x["reason"], ("locked", "no_recording"))
                        self.assertLessEqual(len(x["option"]), 64)
                else:
                    self.assertEqual(b["error"]["code"], "invalid_values")
            for raw in (b"NaN", b'{"values":{"gecis_destegi":NaN}}', b'{"values":{"a":Infinity}}', b"\xff\xfe", b"[1]", b"null", b""):
                s, _, b = call(srv, "POST", "/api/availability", raw)
                self.assertIn(s, (400, 422), raw)
            s, _, b = call(srv, "GET", "/api/availability")
            self.assertEqual(s, 405)

    def test_hello_full_shape(self):
        with live_app() as (srv, app, _w):
            s, _, b = call(srv, "GET", "/api/hello")
            self.assertEqual(s, 200)
            self.assertEqual(sorted(b), ["capabilities", "defaults_hash", "live", "model_version", "ok", "sec_per_week_p50", "server_version"])
            self.assertIs(b["ok"], True)
            self.assertIs(b["live"], True)
            self.assertEqual(b["model_version"], app.model_version)
            self.assertEqual(b["defaults_hash"], "abc123")
            self.assertTrue(b["sec_per_week_p50"] is None or b["sec_per_week_p50"] > 0)

    def test_info_and_registry(self):
        with live_app() as (srv, app, _w):
            s, _, info = call(srv, "GET", "/api/info")
            self.assertEqual(s, 200)
            self.assertEqual((info["kind"], info["modelNote"], info["durationWeeks"]), ("live", app.model_version, 200))
            self.assertEqual(sorted(info), ["capabilities", "dunyalarKalici", "durationWeeks", "durations", "fixedRules", "kind", "modelNote", "registry", "seeds", "settings", "templates", "world"])
            ids = {x["id"] for x in info["settings"]}
            self.assertEqual(ids, {s.id for s in app.registry.settings if s.editable and s.layer != "V"})     # yalnız düzenlenebilir, V değil (N1)
            self.assertTrue({"gecis_destegi", "dunya_tohumu", "ucret_stopaji", "kurumlar_vergisi"} <= ids)
            self.assertNotIn("dunya_sabit_kalemleri", ids)
            gd = next(x for x in info["settings"] if x["id"] == "gecis_destegi")
            self.assertEqual([o["value"] for o in gd["options"]], ["kapali", "kisa_sureli", "kurtarma_fonuyla"])
            self.assertTrue(all(o["available"] is True for o in gd["options"]))
            fr = {x["settingId"]: x for x in info["fixedRules"]}
            self.assertEqual(set(fr), {"dunya_sabit_kalemleri"})        # düzenlenemeyen etkin P kartları
            self.assertEqual(fr["dunya_sabit_kalemleri"]["valueKey"], "lock.deger.dunya_sabit_kalemleri")
            self.assertEqual(fr["dunya_sabit_kalemleri"]["valueText"], "%10")
            self.assertEqual(info["templates"][0]["id"], "gecis_destegi")   # kurucu ilk şablonu seçer: varsayılan geçiş desteği açık
            self.assertEqual(info["seeds"][0]["index"], 0)
            self.assertEqual([x["label"] for x in info["seeds"]], ["Dünya %d" % (i + 1) for i in range(len(info["seeds"]))])   # ham PM_ADJ sızmaz
            s, _, reg = call(srv, "GET", "/api/registry")
            self.assertEqual(s, 200)
            self.assertEqual(reg["model_version"], app.model_version)
            self.assertEqual(sorted(reg), ["cards", "consistency", "groups", "model_version", "scenarios", "templates", "units"])
            self.assertNotIn("decision", json.dumps(reg))

    def test_changes_wired_to_manager(self):
        with live_app() as (srv, app, _w):
            rid = create_run(srv)
            p = f"/api/runs/{rid}/changes"
            s, _, b = call(srv, "POST", p, {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})
            self.assertEqual((s, b["accepted"], b["mode"], b["runId"], b["version"]), (200, True, "live", rid, 1))  # hafta 0: sürüm artmaz
            self.assertEqual((b["seamWeek"], set(b)), (0, {"accepted", "runId", "mode", "scenarioId", "seamWeek", "version"}))
            s, _, b = call(srv, "POST", p, {"from": "next_week", "patch": {"dunya_tohumu": 2}})
            self.assertEqual((s, b), (200, {"accepted": False, "fields": [{"id": "dunya_tohumu", "reason": "start_only"}]}))
            s, _, b = call(srv, "POST", p, {"from": "next_week", "patch": {"yok": 1}})
            self.assertEqual((s, b), (200, {"accepted": False, "fields": [{"id": "yok", "reason": "locked"}]}))
            s, _, b = call(srv, "POST", p, {"from": "next_week", "patch": {"gecis_destegi": "olmayan"}})
            self.assertEqual(b["fields"], [{"id": "gecis_destegi", "reason": "invalid"}])
            s, _, b = call(srv, "POST", p, {"from": "next_week", "patch": {}, "note": "not"})
            self.assertEqual((s, b), (200, {"accepted": False, "fields": [{"id": "*", "reason": "invalid"}]}))
            s, _, b = call(srv, "POST", "/api/runs/yok/changes", {"from": "next_week", "patch": {}})
            self.assertEqual((s, b["error"]["code"]), (404, "not_found"))
            for body in ({}, {"from": "now", "patch": {}}, {"from": "next_week"}, {"from": "next_week", "patch": []},
                         {"from": "next_week", "patch": {}, "note": 5}):
                s, _, b = call(srv, "POST", p, body)
                self.assertEqual((s, b["error"]["code"]), (422, "invalid_change"), body)

    def test_changes_after_end_is_ended(self):
        from tests.route_helpers import make_cfg
        with live_app(cfg=make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0})) as (srv, app, _w):
            rid = create_run(srv)
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
            end = time.time() + 30
            while time.time() < end and app.manager.stats(rid)["status"] != "ended":
                time.sleep(0.05)
            s, _, b = call(srv, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kisa_sureli"}})
            self.assertEqual((s, b), (200, {"accepted": False, "fields": [{"id": "*", "reason": "ended"}]}))

    def test_two_context_availability(self):
        """Başlangıçta tüm düzenlenebilir ayarlar seçilebilir; koşu ortasında yalnız apply=live."""
        with live_app() as (srv, app, _w):
            rid = create_run(srv)
            s, _, start = call(srv, "GET", "/api/info")
            by = {x["id"]: x for x in start["settings"]}
            known = {s.id for s in app.registry.settings if s.apply != "unknown"}              # apply=unknown her bağlamda kapalı (DK-17)
            self.assertTrue(all(o["available"] for x in by.values() if x["id"] in known for o in x["options"]))
            self.assertTrue(all(not x["changeable"] and x["reason"] == "unverified" for x in by.values() if x["id"] not in known))
            s, _, mid = call(srv, "GET", f"/api/info?run={rid}")
            self.assertEqual(s, 200)
            by = {x["id"]: x for x in mid["settings"]}
            self.assertTrue(all(o["available"] and "reason" not in o for o in by["gecis_destegi"]["options"]))
            self.assertTrue(all((o["available"], o.get("reason")) == (False, "locked") for o in by["dunya_tohumu"]["options"]))
            self.assertEqual(call(srv, "GET", "/api/info?run=yok")[0], 404)
            s, _, a = call(srv, "POST", "/api/availability", {"values": {"dunya_tohumu": 1}})
            self.assertTrue(a["ok"])
            s, _, a = call(srv, "POST", "/api/availability", {"values": {"dunya_tohumu": 1}, "runId": rid})
            self.assertEqual((a["ok"], a["blocked"]), (False, [{"settingId": "dunya_tohumu", "option": "1", "reason": "start_only"}]))
            s, _, a = call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "kisa_sureli"}, "runId": rid})
            self.assertTrue(a["ok"])
            self.assertEqual(call(srv, "POST", "/api/availability", {"values": {}, "runId": "yok"})[0], 404)
            self.assertEqual(call(srv, "POST", "/api/availability", {"values": {}, "runId": 5})[0], 422)

    def test_security_headers_apply(self):
        with live_app() as (srv, _a, _w):
            s, _, b = call(srv, "POST", "/api/runs", {"config": CONFIG}, headers={"Content-Type": "application/json"})
            self.assertEqual(s, 403)
            s, _, b = call(srv, "GET", "/api/hello", headers={"Host": "evil.example"})
            self.assertEqual(s, 400)


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:  # zombi sayılmaz
        st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    except OSError:
        return True
    return bool(st) and not st.startswith("Z")


class Shutdown(unittest.TestCase):
    def test_shutdown_hook_kills_workers(self):
        with live_app() as (srv, app, workers):
            create_run(srv)
            self.assertTrue(any(w.alive() for w in workers))
            hooks: list = []
            routes.register_shutdown(app, hooks)
            self.assertEqual(len(hooks), 1)
            hooks[0]()
            self.assertFalse(any(w.alive() for w in workers))

    def test_cli_sigterm_leaves_no_worker(self):
        log = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, log, True)
        proc, port = launch(env=cli_env(OYUN_LOG_DIR=log))
        try:
            wait_up(port)
            import http.client
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            c.request("POST", "/api/runs", body=json.dumps({"config": CONFIG}),
                      headers={"Content-Type": "application/json", "X-Oyun-Istek": "1", "Origin": f"http://127.0.0.1:{port}"})
            r = c.getresponse()
            self.assertEqual(r.status, 201)
            r.read()
            c.close()
            kids = [int(x) for x in subprocess.run(["pgrep", "-P", str(proc.pid)], capture_output=True, text=True).stdout.split()]
            self.assertTrue(kids)                       # işçi sunucunun çocuğu
            proc.send_signal(signal.SIGTERM)
            self.assertEqual(proc.wait(timeout=CAP), 0)
            end = time.time() + CAP
            alive = kids
            while alive and time.time() < end:
                alive = [k for k in alive if _alive(k)]
                time.sleep(0.05)
            self.assertEqual(alive, [])
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            proc.stdout.close()
            proc.stderr.close()


if __name__ == "__main__":
    unittest.main()
