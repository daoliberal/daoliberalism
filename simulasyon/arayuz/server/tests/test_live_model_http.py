"""Ö13: GERÇEK model, HTTP + SSE uçtan uca (alt süreçte sunucu). `run_all.py` tam kipinde; `--quick`te atlanır."""
import os
import time
import unittest

from tests.cli_helpers import CONFIG, ServerProc, children_of, pid_alive, wait_gone



def _deadline() -> float:
    """Gerçek model hızına göre tavan: 5 hafta (4x) + yama sonrası 3 hafta için 15 x ölçülen sn/hafta ortancası + 30 sn pay."""
    from oyun_server.runs.routes import bench_p50
    return 15 * (bench_p50() or 1.0) + 30


DEADLINE_S = max(60.0, _deadline())


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "yavaş: gerçek model")
class LiveModelHttp(unittest.TestCase):
    def test_live_model_http_end_to_end(self):
        s = ServerProc(args=["--host-kind", "model"], ready_timeout=60)
        self.addCleanup(s.kill)
        status, hello = s.req("GET", "/api/hello")
        self.assertEqual(status, 200)
        self.assertEqual(hello["live"], True)
        self.assertNotEqual(hello["model_version"], "fake")

        rid = s.create_run({**CONFIG, "values": {"gecis_destegi": "kapali"}})
        self.assertIn(s.req("GET", f"/api/runs/{rid}")[1]["state"]["status"], ("ready", "paused"))
        stream = s.sse(rid)
        for speed in (4, 4, 4, 4):  # play 4x (yinelenen komut zararsız)
            st, state = s.req("POST", f"/api/runs/{rid}/control", {"action": "play", "speed": speed})
            self.assertEqual(st, 200)
        packets = {}
        t0 = time.monotonic()
        for typ, data in stream:
            if typ == "week":
                packets[data["week"]] = data
                if data["week"] >= 5:
                    break
            self.assertLess(time.monotonic() - t0, DEADLINE_S, "5 hafta zamanında gelmedi")
        self.assertEqual(sorted(packets), list(range(1, 6)))
        self.assertTrue(all(p["version"] == 1 for p in packets.values()))
        self.assertIsNotNone(packets[5]["world"]["employed"])
        self.assertIn("credit", packets[5])                       # PLAN-KREDI T2: kredi kaydı paketle gelir (arayüzde gösterilmez)
        self.assertIn("found", packets[5]["credit"])

        st, _ = s.req("POST", f"/api/runs/{rid}/control", {"action": "pause"})
        self.assertEqual(st, 200)
        st, res = s.req("POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": {"gecis_destegi": "kurtarma_fonuyla"}})
        self.assertEqual(st, 200)
        self.assertTrue(res["accepted"], res)
        self.assertEqual(res["mode"], "live")
        self.assertEqual(res["version"], 2)
        seam = res["seamWeek"]
        self.assertGreaterEqual(seam, 5)

        st, _ = s.req("POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
        self.assertEqual(st, 200)
        version_events, post = [], {}
        for typ, data in stream:
            if typ == "world_event" and data["id"].startswith("version:"):
                version_events.append(data)
            if typ == "week" and data["week"] > seam:
                post[data["week"]] = data
                if len(post) >= 3:
                    break
            self.assertLess(time.monotonic() - t0, 2 * DEADLINE_S, "yama sonrası 3 hafta zamanında gelmedi")
        self.assertTrue(version_events, "sürüm olayı gelmedi")
        self.assertTrue(all(p["version"] == 2 for p in post.values()), post.keys())
        state = s.req("GET", f"/api/runs/{rid}")[1]["state"]
        self.assertEqual(state["values"]["gecis_destegi"], "kurtarma_fonuyla")

        kids = children_of(s.pid)
        self.assertTrue(kids, "işçi süreç yok")
        st, _ = s.req("DELETE", f"/api/runs/{rid}")
        self.assertEqual(st, 204)
        self.assertEqual(wait_gone(kids, 10.0), [], "DELETE sonrası işçi yaşıyor")
        self.assertEqual(s.req("GET", f"/api/runs/{rid}")[0], 404)
        s.stop()
        self.assertFalse(pid_alive(s.pid))
        self.assertEqual(children_of(s.pid), [])


if __name__ == "__main__":
    unittest.main()
