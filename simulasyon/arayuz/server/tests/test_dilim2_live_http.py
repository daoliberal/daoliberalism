"""E1: Dilim 2 GERÇEK model, HTTP + SSE uçtan uca (alt süreçte sunucu). `run_all.py` tam kipinde; `--quick`te atlanır.

Akış: birleşik bayraklardan biri açık şablonla `POST /api/runs`, 5 hafta, beş ayarlı tek yama, 3 hafta, `branch`, `seeds` işi başlat-iptal, `DELETE`;
sunucu kapanınca yetim süreç yok. Beş canlı ayar yayımlanan kayıttan çalışma anında seçilir (adlar sabit yazılmaz).
"""
import json
import os
import time
import unittest
from pathlib import Path

from tests.cli_helpers import CONFIG, SERVER_ROOT, ServerProc, children_of, pid_alive, wait_gone

REGISTRY = SERVER_ROOT.parents[2] / "apps" / "web" / "public" / "oyun-kayit" / "registry.json"
# Birleşik modelin bayraklarından biri (TREASURY_RULE) açık: kart start_only, koşu başında açık kurulur.
BIRLESIK = {"sehir_kasasi_kurali": {"acik": True, "hafta": 4, "yakinsama": 25}}


def _deadline() -> float:
    """Gerçek model hızına göre tavan: 5 + 3 hafta ve dal hazırlığı için 20 x ölçülen sn/hafta ortancası + 30 sn pay."""
    from oyun_server.runs.routes import bench_p50
    return 20 * (bench_p50() or 1.0) + 30


DEADLINE_S = max(90.0, _deadline())


def bes_canli_ayar() -> dict:
    """Kayıtta live/live_sync, sayı türünde, düzenlenebilir ilk beş kural kartı: varsayılandan farklı geçerli değerle."""
    cards = json.loads(REGISTRY.read_text(encoding="utf-8"))["cards"]
    adaylar = [c for c in cards if c["layer"] == "P" and c["kind"] == "number" and c["editable"] and c["status"] == "active"
               and c["apply"] in ("live", "live_sync")]
    if len(adaylar) < 5:
        raise AssertionError(f"kayıtta beş canlı sayı kartı yok ({len(adaylar)})")
    yama = {}
    for c in adaylar[:5]:
        ctl = c["control"]
        d, step = c["default"], ctl.get("step", 1)
        hedef = d + 5 * step
        if hedef > ctl.get("max", float("inf")):
            hedef = max(ctl.get("min", 0), d - 5 * step)
        assert hedef != d, c["id"]
        yama[c["id"]] = int(hedef) if ctl.get("integer") else round(hedef, 6)
    return yama


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "yavaş: gerçek model")
class Dilim2LiveHttp(unittest.TestCase):
    def wait_weeks(self, stream, until: int, packets: dict, limit: float, t0: float) -> None:
        for typ, data in stream:
            if typ == "week":
                packets[data["week"]] = data
                if data["week"] >= until:
                    return
            self.assertLess(time.monotonic() - t0, limit, f"{until}. hafta zamanında gelmedi")
        self.fail("akış bitti")

    def test_dilim2_live_http_end_to_end(self):
        s = ServerProc(args=["--host-kind", "model"], ready_timeout=60)
        self.addCleanup(s.kill)
        status, hello = s.req("GET", "/api/hello")
        self.assertEqual((status, hello["live"]), (200, True))
        self.assertNotEqual(hello["model_version"], "fake")

        # 1) birleşik bayrak açık şablonla koşu; 5 hafta
        rid = s.create_run({**CONFIG, "values": {**BIRLESIK}})
        st = s.req("GET", f"/api/runs/{rid}")[1]["state"]
        self.assertEqual(st["values"]["sehir_kasasi_kurali"], BIRLESIK["sehir_kasasi_kurali"])
        stream = s.sse(rid)
        self.assertEqual(s.req("POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})[0], 200)
        packets: dict = {}
        t0 = time.monotonic()
        self.wait_weeks(stream, 5, packets, DEADLINE_S, t0)
        self.assertEqual(sorted(packets)[:5], [1, 2, 3, 4, 5])
        self.assertEqual(s.req("POST", f"/api/runs/{rid}/control", {"action": "pause"})[0], 200)

        # 2) beş ayarlı tek yama (atomik): sürüm 2, canlı kip
        yama = bes_canli_ayar()
        self.assertEqual(len(yama), 5)
        code, res = s.req("POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": yama})
        self.assertEqual(code, 200)
        self.assertTrue(res["accepted"], res)
        self.assertEqual((res["mode"], res["version"]), ("live", 2))
        seam = res["seamWeek"]
        self.assertGreaterEqual(seam, 5)

        # 3) yama sonrası 3 hafta; hepsi sürüm 2
        self.assertEqual(s.req("POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})[0], 200)
        surum_olaylari, sonra = [], {}
        for typ, data in stream:
            if typ == "world_event" and data["id"].startswith("version:"):
                surum_olaylari.append(data)
            if typ == "week" and data["week"] > seam:
                sonra[data["week"]] = data
                if len(sonra) >= 3:
                    break
            self.assertLess(time.monotonic() - t0, 2 * DEADLINE_S, "yama sonrası 3 hafta zamanında gelmedi")
        self.assertTrue(surum_olaylari, "sürüm olayı gelmedi")
        self.assertTrue(all(p["version"] == 2 for p in sonra.values()))
        self.assertEqual(s.req("POST", f"/api/runs/{rid}/control", {"action": "pause"})[0], 200)
        state = s.req("GET", f"/api/runs/{rid}")[1]["state"]
        for k, v in yama.items():
            self.assertEqual(state["values"][k], v, k)
        self.assertEqual(len(state["versions"]), 2)
        self.assertEqual(state["values"]["sehir_kasasi_kurali"], BIRLESIK["sehir_kasasi_kurali"])

        # 4) dallan: 3. haftadan (yama öncesi), üst koşu kalır
        code, dal = s.req("POST", f"/api/runs/{rid}/branch", {"week": 3, "patch": {}})
        self.assertEqual(code, 201, dal)
        self.assertEqual((dal["state"]["parentRunId"], dal["state"]["forkWeek"]), (rid, 3))
        bid = dal["runId"]
        end = time.monotonic() + 2 * DEADLINE_S
        while time.monotonic() < end:
            bst = s.req("GET", f"/api/runs/{bid}")[1]["state"]
            if bst["status"] in ("ready", "paused") and not bst.get("preparing"):
                break
            time.sleep(0.3)
        else:
            self.fail("dal koşusu hazır olmadı")
        self.assertEqual(bst["week"], 3)
        self.assertEqual(len(bst["versions"]), 1)
        self.assertEqual(s.req("GET", f"/api/runs/{rid}")[1]["state"]["version"], 2)  # üst koşu değişmedi

        # 5) seeds işi: başlat, iptal et
        code, job = s.req("POST", "/api/jobs", {"kind": "seeds", "recipe": {"config": {**CONFIG, "values": {}}, "schedule": []}})
        self.assertEqual(code, 201, job)
        jid = job["jobId"]
        time.sleep(1.0)
        code, cur = s.req("GET", f"/api/jobs/{jid}")
        self.assertEqual(code, 200)
        self.assertIn(cur["status"], ("running", "queued", "done"))
        code, iptal = s.req("DELETE", f"/api/jobs/{jid}")
        self.assertEqual(code, 200)
        end = time.monotonic() + 60
        while time.monotonic() < end:
            fin = s.req("GET", f"/api/jobs/{jid}")[1]
            if fin["status"] in ("cancelled", "done", "failed"):
                break
            time.sleep(0.3)
        self.assertIn(fin["status"], ("cancelled", "done"))

        # 6) DELETE: işçiler gider; sunucu kapanınca yetim yok
        kids = children_of(s.pid)
        self.assertTrue(kids, "işçi süreç yok")
        for r in (bid, rid):
            self.assertEqual(s.req("DELETE", f"/api/runs/{r}")[0], 204)
            self.assertEqual(s.req("GET", f"/api/runs/{r}")[0], 404)
        self.assertEqual(wait_gone(kids, 15.0), [], "DELETE sonrası işçi yaşıyor")
        s.stop()
        self.assertFalse(pid_alive(s.pid))
        self.assertEqual(children_of(s.pid), [])


if __name__ == "__main__":
    unittest.main()
