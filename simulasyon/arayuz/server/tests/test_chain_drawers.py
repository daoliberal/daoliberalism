"""S5: çekmeceler (worker komutu, HTTP rotası), zincir/şehir paket bloklarının sunucu yolu, yetenekler."""
from __future__ import annotations

import json
import queue
import time
import unittest
from unittest import mock

from oyun_server.sim import drawers, extract_cities
from oyun_server.sim.worker import Session
from oyun_server.testing import FakeHost

from tests.extract_v2_helpers import QUICK, deep, real_run, snapshot_equal
from tests.route_helpers import call, create_run, live_app
from tests.test_wire_contract import FIX, shape_diff
from tests.test_extract_v2 import CITY_KEYS
from tests.test_sse import wait_week


def step_to(srv, rid, n):
    for _ in range(n - call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"]):
        call(srv, "POST", f"/api/runs/{rid}/control", {"action": "step", "speed": 16})
    wait_week(srv, rid, n)


def drawer(srv, rid, kind, ref, week=None):
    q = "" if week is None else f"?week={week}"
    return call(srv, "GET", f"/api/runs/{rid}/drawer/{kind}/{ref}{q}")


class WorkerDrawerCommand(unittest.TestCase):
    def session(self):
        cmds, out = queue.Queue(), []
        s = Session(cmds, out.append, host_factory=lambda spec: FakeHost("", {}, 20))
        s._handle({"cmd": "init", "overrides": {}, "weeks": 20, "host": "fake"})
        return s, out

    def test_drawer_command_reads_current_week_without_stepping(self):
        s, out = self.session()
        for _ in range(3):
            s.host.step()
        s._handle({"cmd": "drawer", "id": 7, "kind": "city", "ref": "2"})
        ev = out[-1]
        self.assertEqual((ev["ev"], ev["id"], ev["week"]), ("drawer", 7, 3))
        self.assertEqual(ev["data"]["kind"], "city")
        self.assertEqual(s.host.week, 3)

    def test_drawer_command_unknown_ref_and_bad_args(self):
        s, out = self.session()
        s.host.step()
        s._handle({"cmd": "drawer", "id": 1, "kind": "city", "ref": "99"})
        self.assertEqual((out[-1]["ev"], out[-1]["id"], out[-1]["error"]), ("drawer", 1, "not_found"))
        self.assertTrue(s._handle({"cmd": "drawer", "id": "x", "kind": "city", "ref": "0"}))      # bozuk komut: diğer komutlar gibi bad_cmd ve çıkış
        self.assertEqual(out[-1], {"ev": "failed", "error": "bad_cmd"})


class Routes(unittest.TestCase):
    def test_capabilities_city_chain_true(self):
        with live_app() as (srv, app, _w):
            for path in ("/api/hello", "/api/info"):
                caps = call(srv, "GET", path)[2]["capabilities"]
                self.assertTrue(caps["city"], path)
                self.assertTrue(caps["chain"], path)

    def test_packets_carry_cities_and_chain(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 2)
            pk = call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=2")[2]
            for p in pk:
                self.assertEqual(len(p["cities"]), 5)
                for c in p["cities"]:
                    self.assertEqual(set(c), CITY_KEYS)
                self.assertEqual(set(p["chain"]) - {"edges"}, {"board", "sectors", "nodes", "scarce", "edges_rev"})
                json.dumps(p, allow_nan=False)

    def test_drawer_does_not_advance_or_mutate(self):
        with live_app() as (srv, app, _w):
            rid = create_run(srv)
            step_to(srv, rid, 3)
            run = app.manager._runs[rid]
            before = (run.released, run.worker_week, run.target, run.credit, call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"])
            outs = [drawer(srv, rid, "city", "1", 3) for _ in range(4)] + [drawer(srv, rid, "sector", "un", 3)]
            time.sleep(0.2)
            after = (run.released, run.worker_week, run.target, run.credit, call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"])
            self.assertEqual(before, after)
            for s, _h, b in outs:
                self.assertEqual(s, 200, b)
            self.assertEqual(outs[0][2], outs[1][2])
            self.assertEqual(outs[0][2], outs[3][2])
            self.assertEqual(call(srv, "GET", f"/api/runs/{rid}/weeks?from=1&to=3")[2][2]["week"], 3)

    def test_drawer_fresh_shape(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 3)
            s, _h, b = drawer(srv, rid, "city", "2", 3)
            self.assertEqual(s, 200)
            self.assertEqual((b["kind"], b["ref"], b["week"], b["stale"]), ("city", "2", 3, False))
            self.assertEqual(b["title"], "C")                       # şehir adı koşunun cityNames'inden
            self.assertTrue(CITY_KEYS <= set(b["fields"]))
            s, _h, b = drawer(srv, rid, "city", "2")                # hafta verilmezse en son hesaplanan hafta
            self.assertEqual((s, b["week"], b["stale"]), (200, 3, False))

    def test_drawer_unknown_ref_404(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 2)
            for kind, ref in (("city", "9"), ("sector", "yok_sektor"), ("firm", "firma-yok"), ("lonca", "lonca99")):
                s, _h, b = drawer(srv, rid, kind, ref, 2)
                self.assertEqual((s, b["error"]["code"]), (404, "not_found"), (kind, ref))
            self.assertEqual(call(srv, "GET", "/api/runs/yok/drawer/city/0")[0], 404)

    def test_drawer_bad_ref_pattern_400(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 2)
            for ref in ("Buyuk", "a.b", "a%20b", "a" * 41, "%C4%B1", "x%2Fy", "a%00b"):
                s, _h, b = drawer(srv, rid, "city", ref, 2)
                self.assertEqual((s, b["error"]["code"]), (400, "invalid_drawer"), ref)
            s, _h, b = drawer(srv, rid, "bilinmeyen", "0", 2)
            self.assertEqual((s, b["error"]["code"]), (400, "invalid_drawer"))
            for week in ("abc", "-1", "1.5", "9999999999", "99999"):
                s, _h, b = drawer(srv, rid, "city", "0", week)
                self.assertEqual((s, b["error"]["code"]), (400, "invalid_drawer"), week)
            self.assertEqual(drawer(srv, rid, "city", "a" * 40, 2)[0], 404)    # sınırda geçerli desen, bilinmeyen ref

    def test_drawer_never_beyond_released_week(self):
        with live_app() as (srv, app, _w):
            rid = create_run(srv)
            step_to(srv, rid, 3)
            self.assertEqual(drawer(srv, rid, "city", "1", 4)[0], 400)           # henüz yayımlanmamış hafta
            s, _h, b = drawer(srv, rid, "city", "1", 0)
            self.assertEqual((s, b["error"]["code"]), (400, "invalid_drawer"))
            s, _h, b = drawer(srv, rid, "city", "1")
            self.assertEqual((s, b["week"], b["stale"]), (200, 3, False))        # verilmezse yayımlanan son hafta
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 1})
            end = time.time() + 6
            seen = []
            while time.time() < end:                                            # işçi lookahead kadar önde koşar
                st = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"]
                s, _h, b = drawer(srv, rid, "city", "1")
                after = call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["week"]
                self.assertEqual(s, 200)
                self.assertTrue(st <= b["week"] <= after, (st, b["week"], after))   # asla yayımlanmamış hafta değil
                seen.append(app.manager._runs[rid].worker_week - b["week"])
                time.sleep(0.05)
            self.assertGreater(max(seen), 0, "işçi hiç önde olmadı: test anlamsız")

    def test_drawer_old_week_stale_flag(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 3)
            s, _h, b = drawer(srv, rid, "city", "1", 2)
            self.assertEqual(s, 200)
            self.assertTrue(b["stale"])
            self.assertEqual((b["kind"], b["ref"], b["week"]), ("city", "1", 2))
            pk = call(srv, "GET", f"/api/runs/{rid}/weeks?from=2&to=2")[2][0]
            self.assertEqual(b["fields"], pk["cities"][1])           # eski hafta: yalnız o haftanın paket alanları
            s, _h, b = drawer(srv, rid, "sector", "un", 2)
            self.assertTrue(b["stale"])
            self.assertEqual(b["fields"]["sector"], "un")
            self.assertEqual(b["fields"]["product"], "un")          # bayat çekmecede de ürün
            s, _h, b = drawer(srv, rid, "firm", "fk0", 1)
            self.assertEqual((s, b["stale"], b["fields"]), (200, True, {}))      # pakette firma verisi yok
            self.assertFalse(drawer(srv, rid, "city", "1", 3)[2]["stale"])

    def test_drawer_wire_shapes_match_fixture(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 3)
            self.assertEqual(shape_diff(drawer(srv, rid, "city", "1", 3)[2], FIX["drawer_fresh"]), [])
            self.assertEqual(shape_diff(drawer(srv, rid, "city", "1", 2)[2], FIX["drawer_stale"]), [])
            self.assertEqual(shape_diff(drawer(srv, rid, "firm", "fk0", 3)[2], FIX["drawer_firm"]), [])      # işletme penceresi alanları
            self.assertEqual(drawer(srv, rid, "city", "a" * 41, 3)[2]["error"]["code"], FIX["error_400_drawer"]["error"]["code"])
            self.assertEqual(drawer(srv, rid, "city", "9", 3)[2], FIX["error_404_drawer"])
            self.assertEqual(sorted(FIX["enums"]["drawerKinds"]), sorted(drawers.KINDS))
            self.assertEqual(FIX["enums"]["drawerRefPattern"], "^" + drawers.REF_RE.pattern + "$")

    def test_drawer_on_ended_run_is_stale_packet_view(self):
        with live_app() as (srv, _a, _w):
            s, _, h = call(srv, "POST", "/api/runs", {"config": {"name": "k", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban",
                                                                   "durationWeeks": 100, "seedIndex": 0, "values": {}}})
            rid = h["runId"]
            call(srv, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 16})
            end = time.time() + 30
            while time.time() < end and call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["status"] != "ended":
                time.sleep(0.05)
            self.assertEqual(call(srv, "GET", f"/api/runs/{rid}")[2]["state"]["status"], "ended")
            s, _h, b = drawer(srv, rid, "city", "0", 100)
            self.assertEqual(s, 200)
            self.assertTrue(b["stale"])                                # model artık yok: yalnız paket alanları
            self.assertEqual(b["fields"]["index"], 0)

    def test_drawer_firm_fields_whitelist_fake(self):
        with live_app() as (srv, _a, _w):
            rid = create_run(srv)
            step_to(srv, rid, 2)
            s, _h, b = drawer(srv, rid, "firm", "fk0", 2)
            self.assertEqual(s, 200, b)
            self.assertNotIn("fk0", b["title"])
            self.assertLessEqual(set(b["fields"]), drawers.FIRM_FIELDS)
            s, _h, b = drawer(srv, rid, "lonca", "lonca0", 2)
            self.assertEqual(s, 200, b)
            self.assertLessEqual(set(b["fields"]), drawers.LONCA_FIELDS)


@unittest.skipIf(QUICK, "gerçek model")
class RealModelDrawers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_ = real_run()

    def test_drawer_does_not_advance_or_mutate(self):
        r = self.run_
        before, week = deep(r.W), r.host.week
        for kind, ref in (("city", "0"), ("sector", "firin"), ("lonca", "lonca0"), ("firm", next(iter(r.W.firms)))):
            self.assertEqual(r.host.drawer(kind, ref)["kind"], kind)
        self.assertEqual(r.host.week, week)
        snapshot_equal(self, r.W, before, "çekmece")

    def test_city_drawer_extends_city_row(self):
        r = self.run_
        d = r.host.drawer("city", "3")
        row = r.snaps[-1]["cities"][3]
        for k, v in row.items():
            self.assertEqual(d["fields"][k], v, k)
        self.assertLessEqual(set(d["fields"]), drawers.CITY_FIELDS)
        self.assertEqual(sorted(d["fields"]["top_sectors"], key=lambda t: -t["workers"]), d["fields"]["top_sectors"])
        self.assertEqual(sum(t["workers"] for t in d["fields"]["top_sectors"]) <= d["fields"]["employed"], True)

    def test_sector_drawer(self):
        r, W = self.run_, self.run_.W
        ah = r.host.drawer("sector", "ahir")["fields"]
        self.assertEqual(ah["note_key"], "cekmece.ahir_notu")          # metin sunucuda değil, arayüz kopyasında
        self.assertNotIn("note", ah)
        self.assertIsNone(ah["shortage"])
        d = r.host.drawer("sector", "firin")
        f = d["fields"]
        self.assertLessEqual(set(f), drawers.SECTOR_FIELDS)
        self.assertEqual(f["sector"], "firin")
        self.assertEqual(len(f["cities"]), 5)
        self.assertIn("un", [i["from"] for i in f["inputs"]])
        self.assertAlmostEqual(f["shortage"], W.board["prod"]["ekmek"]["short_share"])
        self.assertLessEqual(len(f["firm_refs"]), 10)
        for ref in f["firm_refs"]:
            self.assertIn(ref["ref"], W.firms)

    def test_drawer_firm_fields_whitelist(self):
        r, W = self.run_, self.run_.W
        pf = next(f for f, d in W.firms.items() if d.get("owner") is not None and not d.get("dead"))        # oyuncu (Ar-Ge dahil) firması
        npc = next(f for f, d in W.firms.items() if d["owner"] is None and d["kind"] not in ("ahir", "belediye") and not d.get("dead"))
        for ref in (pf, npc, "s0_belediye0"):
            d = r.host.drawer("firm", ref)
            self.assertLessEqual(set(d["fields"]), drawers.FIRM_FIELDS, ref)
            self.assertNotIn("owner", d["fields"])
            self.assertNotIn(ref, d["title"])                       # başlıkta iç kimlik yok
            self.assertTrue(d["fields"]["cash"] == 0.0 or abs(d["fields"]["cash"]) >= 1e-9)          # kayan nokta artığı yok
            self.assertNotIn(W.firms[ref].get("owner") or "\0", json.dumps(d))
            json.dumps(d, allow_nan=False)
        self.assertEqual(r.host.drawer("firm", pf)["fields"]["ownership"], "player")
        self.assertEqual(r.host.drawer("firm", npc)["fields"]["ownership"], "npc")
        self.assertAlmostEqual(r.host.drawer("firm", npc)["fields"]["cash"], W.L.bal[npc])

    def test_firm_drawer_isletme_penceresi_alanlari(self):
        r, W = self.run_, self.run_.W
        npc = next(f for f, d in W.firms.items() if d["owner"] is None and d["kind"] == "un" and not d.get("dead") and d["workers"])
        f = r.host.drawer("firm", npc)["fields"]
        self.assertEqual(f["product"], "un")
        self.assertAlmostEqual(f["price"], W.PRICE[(W.firms[npc]["city"], "un")])
        self.assertAlmostEqual(f["sold_week"], W.fsold.get(npc, 0.0))
        self.assertGreater(f["sold_week"], 0.0)
        self.assertAlmostEqual(f["wage_avg"], W.fwage[npc] / len(W.firms[npc]["workers"]))
        h = f["profit_hist"]
        self.assertLessEqual(len(h), 12)
        self.assertEqual(len(h), min(12, r.host.week))
        self.assertAlmostEqual(h[-1], drawers.firm_profit(W, npc, W.firms[npc]))        # son eleman bu haftanın kârı: eskiden yeniye
        json.dumps(f, allow_nan=False)

    def test_lonca_drawer(self):
        r, W = self.run_, self.run_.W
        d = r.host.drawer("lonca", "lonca1")
        f = d["fields"]
        self.assertLessEqual(set(f), drawers.LONCA_FIELDS)
        self.assertEqual(f["members"], sum(1 for x in W.firms.values() if x["lonca"] == "lonca1" and x["workers"] and not x.get("dead")
                                           and x["kind"] not in ("belediye", "arge", "ahir")))
        self.assertAlmostEqual(f["fee"], W.FEES["lonca1"])
        self.assertAlmostEqual(f["capital"], W.L.bal["lonca1_sermaye"], delta=0.5)         # PLAN-TAKIP §4.2: paketin lonca satırıyla aynı sayılar
        self.assertAlmostEqual(f["equity"], self.run_.host._mods["simkit.credit_core"].lo_equity(W, "lonca1"), delta=1)
        self.assertIn(f["owner"], ("player", "none", "closed"))

    def test_unknown_refs_raise(self):
        r = self.run_
        for kind, ref in (("city", "7"), ("city", "x"), ("sector", "zzz"), ("firm", "s0_p0"), ("firm", "nope"), ("lonca", "lonca77")):
            with self.assertRaises(drawers.UnknownRef, msg=(kind, ref)):
                r.host.drawer(kind, ref)

    def test_ref_pattern(self):
        self.assertTrue(drawers.REF_RE.fullmatch("s0_firin0"))
        self.assertTrue(drawers.REF_RE.fullmatch("a" * 40))
        self.assertFalse(drawers.REF_RE.fullmatch("a" * 41))
        self.assertFalse(drawers.REF_RE.fullmatch("A"))
        self.assertFalse(drawers.REF_RE.fullmatch(""))
        self.assertFalse(drawers.REF_RE.fullmatch("a\n"))


class CityStatic(unittest.TestCase):
    def test_info_carries_world_static(self):
        with live_app() as (srv, app, _w):
            app.world_info = extract_cities.static_world_info(
                {"COAL_CITIES": [0, 3], "GOLD_CITIES": [1, 4], "LIFE_ON": True, "INNOV_ON": True, "SPECIAL": ["un"] * 25}, 5)
            info = call(srv, "GET", "/api/info")[2]
            self.assertEqual(info["world"], app.world_info)
            self.assertEqual(len(info["world"]["cities"]), 5)
            self.assertEqual(info["world"]["basis"], "model_defaults")


if __name__ == "__main__":
    unittest.main()
