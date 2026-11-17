"""A7b: SSE olay akışı (FakeHost, gerçek HTTP)."""
from __future__ import annotations

import time
import unittest

from tests.route_helpers import call, create_run, live_app, make_cfg, Stream


def wait_week(srv, rid, n, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"] >= n:
            return
        time.sleep(0.01)
    raise AssertionError(f"{n}. hafta yayımlanmadı")


def read_until(stream, pred, limit=2000):
    out = []
    for it in stream.items():
        out.append(it)
        if pred(it, out) or len(out) >= limit:
            break
    return out


def weeks_of(items):
    return [d["week"] for it in items if it[0] != "ping" and it[1] == "week" for d in [it[2]]]


class Sse(unittest.TestCase):
    def test_sse_order_state_weeks(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            for _ in range(3):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            wait_week(srv, rid, 3)
            st = Stream(srv, rid)
            try:
                self.assertEqual(st.status, 200)
                self.assertTrue(st.r.getheader("Content-Type").startswith("text/event-stream"))
                self.assertEqual(st.r.getheader("Cache-Control"), "no-store")
                items = read_until(st, lambda it, out: len(weeks_of(out)) >= 3)
            finally:
                st.close()
            events = [it[1] for it in items if it[0] != "ping"]
            self.assertEqual(events[0], "state")
            self.assertEqual(weeks_of(items), [1, 2, 3])
            self.assertEqual([it[0] for it in items], list(range(1, len(items) + 1)))   # artan olay kimliği
            self.assertEqual(items[0][2]["runId"], rid)
            self.assertEqual(items[1][2]["run_id"], rid)

    def test_sse_get_without_header_allowed_host_checked(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            st = Stream(srv, rid, headers={})            # X-Oyun-Istek yok, Origin yok
            try:
                self.assertEqual(st.status, 200)
            finally:
                st.close()
            st = Stream(srv, rid, headers={"Origin": f"http://127.0.0.1:{srv.port}"})
            try:
                self.assertEqual(st.status, 200)
            finally:
                st.close()
            st = Stream(srv, rid, headers={"Host": "evil.example"})
            try:
                self.assertEqual(st.status, 400)
            finally:
                st.close()
            st = Stream(srv, rid, headers={"Origin": "http://evil.example"})
            try:
                self.assertEqual(st.status, 403)
            finally:
                st.close()

    def test_sse_reconnect_resends_full_history(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            for _ in range(3):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
            wait_week(srv, rid, 3)
            st = Stream(srv, rid)
            first = read_until(st, lambda it, out: len(weeks_of(out)) >= 3)
            st.close()                                   # 3. haftada kesilir
            self.assertEqual(weeks_of(first), [1, 2, 3])
            for _ in range(2):
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step"})
            wait_week(srv, rid, 5)
            st = Stream(srv, rid)
            try:
                second = read_until(st, lambda it, out: len(weeks_of(out)) >= 5)
            finally:
                st.close()
            self.assertEqual([it[1] for it in second if it[0] != "ping"][0], "state")
            self.assertEqual(weeks_of(second), [1, 2, 3, 4, 5])
            self.assertEqual(second[0][0], 1)             # kimlikler her bağlantıda baştan

    def test_sse_heartbeat(self):
        with live_app(ping_s=0.05) as (srv, _a, _w):
            rid = create_run(srv)
            st = Stream(srv, rid)
            try:
                items = read_until(st, lambda it, out: sum(1 for i in out if i[0] == "ping") >= 2)
            finally:
                st.close()
            self.assertGreaterEqual(sum(1 for i in items if i[0] == "ping"), 2)

    def test_sse_ended_final_state_then_ended_then_close(self):
        cfg = make_cfg(LIVE_WEEK_MS={1: 0, 4: 0, 16: 0})
        with live_app(cfg=cfg) as (srv, _a, _w):
            rid = create_run(srv)
            st = Stream(srv, rid, timeout=30)
            try:
                call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
                items = list(st.items())                  # sunucu bitişte akışı kapatır (EOF)
            finally:
                st.close()
            real = [it for it in items if it[0] != "ping"]
            names = [it[1] for it in real]
            self.assertEqual(names[-1], "ended")
            self.assertEqual(names.count("ended"), 1)
            self.assertEqual(names[-2], "state")
            self.assertEqual(real[-2][2]["status"], "ended")
            self.assertEqual(real[-2][2]["endedReason"], "duration")
            self.assertEqual(real[-1][2], {"reason": "duration", "week": 200})
            ws = weeks_of(real)
            self.assertEqual(ws, sorted(set(ws)))
            self.assertEqual(ws[-1], 200)
            last_week_idx = max(i for i, it in enumerate(real) if it[1] == "week")
            self.assertLess(last_week_idx, len(real) - 2)  # haftalardan sonra son state, sonra ended
            # bitmiş koşuya yeni abone: state(ended), haftalar, ended; akış kapanır
            st2 = Stream(srv, rid, timeout=30)
            try:
                again = [it for it in st2.items() if it[0] != "ping"]
            finally:
                st2.close()
            self.assertEqual(again[0][1], "state")
            self.assertEqual(again[0][2]["status"], "ended")
            self.assertEqual(again[-1][1], "ended")
            self.assertEqual(weeks_of(again), list(range(1, 201)))

    def test_sse_closes_on_delete(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            st = Stream(srv, rid)
            try:
                read_until(st, lambda it, out: len(out) >= 1)
                call(srv, "DELETE", f"/api/runs/{rid}")
                rest = list(st.items())                    # EOF gelmeli, asılmamalı
            finally:
                st.close()
            self.assertIsInstance(rest, list)

    def test_disconnect_releases_subscription(self):
        with live_app(ping_s=0.05) as (srv, app, _w):
            rid = create_run(srv)
            st = Stream(srv, rid)
            read_until(st, lambda it, out: len(out) >= 1)
            st.close()
            end = time.time() + 30
            n = -1
            while time.time() < end:
                with app.manager._lock:
                    n = len(app.manager._runs[rid].subs)
                if n == 0:
                    break
                time.sleep(0.02)
            self.assertEqual(n, 0)


if __name__ == "__main__":
    unittest.main()
