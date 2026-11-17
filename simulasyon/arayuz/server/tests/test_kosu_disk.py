"""D1: koşuların diske yazılması. Sahte saat + süreç içi işçi (test_manager tabanı); gerçek dosya sistemi (geçici dizin)."""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from oyun_server import config
from oyun_server.runs import disk
from oyun_server.runs.manager import RunManager

from tests.test_manager import CONFIG, ManagerBase


def read_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def read_lines(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


class DiskBase(ManagerBase):
    fail_week = None

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="kosu-disk-test-"))
        self.addCleanup(shutil.rmtree, self.root, True)          # önce kaydedilir, yönetici kapanışından SONRA çalışır
        super().setUp()

    def make(self, *a, **kw):
        m = super().make(*a, **kw)
        m.runs_dir = self.root
        m.defaults_hash = "abc123"
        m._disk = disk.DiskStore(self.root)
        return m

    def folders(self) -> list[Path]:
        return sorted(p for p in self.root.iterdir() if p.is_dir())

    def folder_of(self, rid: str) -> Path:
        out = [p for p in self.folders() if p.name.endswith("_" + rid)]
        self.assertEqual(len(out), 1, [p.name for p in self.folders()])
        return out[0]


class TestFolderAndMeta(DiskBase):
    def test_folder_name_and_initial_meta(self):
        m = self.make()
        rid, _ = self.new_run()
        f = self.folder_of(rid)
        self.assertRegex(f.name, r"^\d{8}-\d{6}_canli-[0-9a-f]{8}$")
        k = read_json(f / "kosu.json")
        self.assertEqual(k["runId"], rid)
        self.assertEqual(k["name"], "Deneme")
        self.assertEqual(k["cityNames"], ["A", "B", "C", "D", "E"])
        self.assertEqual(k["scenarioId"], "dayanikli_taban")
        self.assertEqual(k["durationWeeks"], 200)
        self.assertEqual(k["seedIndex"], 0)
        self.assertEqual(k["defaultsHash"], "abc123")
        self.assertEqual(k["serverVersion"], "0.1.0")
        self.assertEqual(k["status"], "paused")
        self.assertEqual(k["week"], 0)
        self.assertIsNone(k["endReason"])
        self.assertIsNone(k["endedAt"])
        self.assertRegex(k["startedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(k["recipe"]["name"], "Deneme")
        self.assertEqual(k["recipe"]["templateId"], "dayanikli_taban")
        self.assertEqual(k["recipe"]["values"], {"gecis_destegi": "kapali"})
        self.assertEqual([v["version"] for v in k["versions"]], [1])

    def test_unsafe_run_id_is_sanitized(self):
        n = disk.safe_name("../../etc/pas swd\x00")
        self.assertRegex(n, r"^[A-Za-z0-9_-]+$")
        self.assertNotIn("..", n)
        self.assertLessEqual(len(disk.safe_name("x" * 500)), 64)

    def test_no_runs_dir_means_no_files(self):
        m = self.make()
        m._disk = disk.DiskStore(None)
        rid, _ = self.new_run()
        m.control(rid, "step", 1)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 1)
        self.assertEqual(self.folders(), [])


class TestWeeks(DiskBase):
    def test_weeks_appended_match_api(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 25)
        m.control(rid, "pause")
        wk = m.get(rid)["state"]["week"]
        lines = read_lines(self.folder_of(rid) / "haftalar.jsonl")
        self.assertGreaterEqual(len(lines), wk - 9)                      # en geç her 10 haftada bir flush
        self.assertLessEqual(len(lines), wk)
        api = m.weeks(rid, 1, len(lines))
        self.assertEqual(lines, [{k: v for k, v in p.items() if k not in ("harita", "haritaFark")} for p in json.loads(json.dumps(api))])   # /weeks satırıyla birebir (world, cities, chain, diagnostics, events, version); `harita` ve `haritaFark` yalnız pakette, diske yazılmaz
        for key in ("world", "cities", "chain", "diagnostics", "events", "version"):
            self.assertIn(key, lines[0])
        self.assertFalse(any(k in l for l in lines for k in ("harita", "haritaFark")))      # kayıt harita'sız: ne tam harita ne fark
        self.assertEqual([l["week"] for l in lines], list(range(1, len(lines) + 1)))

    def test_meta_week_progress_every_ten(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 25)
        m.control(rid, "pause")
        k = read_json(self.folder_of(rid) / "kosu.json")
        self.assertGreaterEqual(k["week"], 20)
        self.assertEqual(k["status"] in ("running", "paused"), True)


class TestEnd(DiskBase):
    def test_ended_final_meta_and_firms(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=60)
        f = self.folder_of(rid)
        k = read_json(f / "kosu.json")
        self.assertEqual((k["status"], k["week"], k["endReason"]), ("ended", 200, "ended"))
        self.assertRegex(k["endedAt"], r"^\d{4}-")
        lines = read_lines(f / "haftalar.jsonl")
        self.assertEqual([l["week"] for l in lines], list(range(1, 201)))
        fi = read_json(f / "firmalar.json")
        self.assertEqual(fi["week"], 200)
        self.assertTrue(fi["sectors"])
        for s in fi["sectors"]:
            for key in ("sector", "product", "firms", "healthy"):
                self.assertIn(key, s)
        self.assertEqual((fi["source"], fi["firmLevel"]), ("model_firms", True))
        self.assertEqual(len(fi["firms"]), 4)

    def test_discard_marks_discarded(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "step", 1)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 1)
        m.delete(rid)
        k = read_json(self.folder_of(rid) / "kosu.json")
        self.assertEqual((k["endReason"], k["status"]), ("discarded", "paused"))
        self.assertEqual(k["week"], 1)
        self.assertRegex(k["endedAt"], r"^\d{4}-")

    def test_discard_after_ended_keeps_ended(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=60)
        m.delete(rid)
        self.assertEqual(read_json(self.folder_of(rid) / "kosu.json")["endReason"], "ended")

    def test_server_shutdown_marks_reason(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "step", 1)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 1)
        m.shutdown()
        k = read_json(self.folder_of(rid) / "kosu.json")
        self.assertEqual(k["endReason"], "server_shutdown")
        self.assertEqual(k["week"], 1)


class TestFirms(DiskBase):
    def test_snapshots_every_ten_weeks_and_final(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=60)
        f = self.folder_of(rid)
        snaps = read_lines(f / "firmalar.jsonl")
        self.assertEqual([x["week"] for x in snaps], [1] + list(range(10, 201, 10)))      # Kurucu: 1. hafta, 10'un katları, son hafta
        row = snaps[0]["firms"][0]
        for key in ("id", "kind", "city", "owner", "privatized", "born", "workers", "cash", "cashWeeks", "health", "lossStreak",
                    "staffless", "dead", "died", "diedSource"):
            self.assertIn(key, row)
        fin = read_json(f / "firmalar.json")
        self.assertEqual((fin["week"], fin["firmLevel"]), (200, True))
        self.assertEqual(fin["firms"], snaps[-1]["firms"])
        self.assertTrue(fin["sectors"])

    def test_snapshot_survives_worker_far_ahead_of_publish(self):
        """Pacer, işçi çok ilerideyken (hafta ve firms ayrı turlara denk gelebilen sıra) yayımlar: hiçbir anlık görüntü kaybolmaz."""
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "pause")
        for _ in range(3):
            m.control(rid, "step")
        self.computed(rid, 3)
        for i in range(40):                                     # her turda tek hafta (adım kredisi), işçi önde
            m.control(rid, "step")
            m.pump(self.clock.t)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 40)
        snaps = read_lines(self.folder_of(rid) / "firmalar.jsonl")
        self.assertEqual([x["week"] for x in snaps], [1, 10, 20, 30, 40])
        self.assertEqual(m._get(rid).firm_buf, {})              # yetim anahtar yok

    def test_orphan_buffer_cleared_on_discard(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 5)
        run = m._get(rid)
        m.delete(rid)
        self.assertEqual(run.firm_buf, {})

    def test_spec_flags_firms_only_for_live_runs(self):
        m = self.make()
        self.new_run()
        self.assertTrue(self.workers[0].spec.get("firms"))

    def test_dead_firm_marked(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 30)
        m.control(rid, "pause")
        snaps = read_lines(self.folder_of(rid) / "firmalar.jsonl")
        dead = [r for r in snaps[-1]["firms"] if r["dead"]]
        self.assertTrue(dead)
        self.assertIn(dead[0]["diedSource"], ("model", "first_seen_snapshot"))
        self.assertIsNotNone(dead[0]["died"])

    def test_discard_writes_last_snapshot(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 25)
        m.delete(rid)
        fin = read_json(self.folder_of(rid) / "firmalar.json")
        self.assertEqual(fin["week"] % 10, 0)
        self.assertTrue(fin["firmLevel"])

    def test_write_failure_in_firms_does_not_stop(self):
        m = self.make()
        rid, _ = self.new_run()
        with mock.patch.object(disk, "append_text", side_effect=OSError("disk dolu")):
            m.control(rid, "play", 16)
            self.pump_until(lambda: m.get(rid)["state"]["week"] >= 30)
        self.assertGreaterEqual(m.get(rid)["state"]["week"], 30)


class TestHostFirmRows(unittest.TestCase):
    def test_real_host_rows_if_model(self):
        if os.environ.get("OYUN_QUICK"):
            self.skipTest("hızlı kip")
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), {}, weeks=12)
        try:
            for _ in range(12):
                h.step()
            rows = h.firm_rows()
            self.assertTrue(rows)
            for key in ("id", "kind", "city", "owner", "workers", "cash", "dead"):
                self.assertIn(key, rows[0])
            json.dumps(rows, allow_nan=False)
        finally:
            h.close()


class TestVersionsAndBranch(DiskBase):
    def test_recipe_and_notes_follow_live_change(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 5)
        m.control(rid, "pause")
        import threading
        res = {}
        t = threading.Thread(target=lambda: res.update(r=m.apply_change(rid, {"gecis_destegi": "kisa_sureli"}, "deneme notu")))
        t.start()
        self.pump_until(lambda: not t.is_alive())
        self.assertTrue(res["r"]["accepted"], res)
        k = read_json(self.folder_of(rid) / "kosu.json")
        self.assertEqual([v["version"] for v in k["versions"]], [1, 2])
        self.assertEqual(k["versions"][1]["note"], "deneme notu")
        sched = k["recipe"]["schedule"]
        self.assertEqual(len(sched), 1)
        self.assertEqual(sched[0]["patch"], {"gecis_destegi": "kisa_sureli"})
        self.assertEqual(sched[0]["week"], k["versions"][1]["fromWeek"])

    def test_branch_has_own_folder_with_parent(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 12)
        m.control(rid, "pause")
        h = m.branch(rid, 6, {"gecis_destegi": "kisa_sureli"})
        bid = h["runId"]
        self.pump_until(lambda: m.get(bid)["state"]["week"] >= 6)
        self.assertNotEqual(self.folder_of(bid), self.folder_of(rid))
        k = read_json(self.folder_of(bid) / "kosu.json")
        self.assertEqual((k["parentRunId"], k["forkWeek"]), (rid, 6))
        self.assertEqual(len(read_lines(self.folder_of(bid) / "haftalar.jsonl")), 6)


class TestRobustness(DiskBase):
    def test_write_failure_does_not_stop_run(self):
        m = self.make()
        rid, _ = self.new_run()
        boom = OSError("disk dolu")
        with mock.patch.object(disk, "write_atomic", side_effect=boom), mock.patch.object(disk, "append_text", side_effect=boom), \
                mock.patch.object(disk, "make_dir", side_effect=boom):
            m.control(rid, "play", 16)
            self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=60)
        self.assertEqual(m.get(rid)["state"]["week"], 200)

    def test_unwritable_root_does_not_stop_run(self):
        m = self.make()
        blocker = self.root / "dosya"
        blocker.write_text("x")
        m._disk = disk.DiskStore(blocker / "alt")              # dizin olamaz
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 10)
        self.assertEqual(m.get(rid)["state"]["status"] in ("running", "paused", "ended"), True)

    def test_quota_warns_but_never_deletes(self):
        for i in range(disk.MAX_FOLDERS + 2):
            (self.root / ("20200101-000000_eski%03d" % i)).mkdir()
        m = self.make()
        with mock.patch("sys.stderr") as err:
            rid, _ = self.new_run()
        self.assertEqual(len([p for p in self.root.iterdir() if p.is_dir()]), disk.MAX_FOLDERS + 3)
        self.assertTrue(any("500" in str(c) or "kota" in str(c) for c in err.write.call_args_list))
        self.assertTrue((self.folder_of(rid) / "kosu.json").is_file())


class TestTarifEdges(unittest.TestCase):
    """Web `tarifOf` ile aynı kenarlar: boş koleksiyon (`goals: []`, `worldScenarioValues: {}`) JS'te doğru sayılır; null/undefined atlanır."""

    ST = {"name": "x", "cityNames": [], "scenarioId": "t", "durationWeeks": 100, "seedIndex": 0, "values": {"a": 1}}

    def test_empty_collections_kept_null_dropped(self):
        t = RunManager.tarif_of(dict(self.ST, goals=[], worldScenarioValues={}, worldScenarioId=None))
        self.assertEqual(t["goals"], [])
        self.assertEqual(t["worldScenarioValues"], {})
        self.assertNotIn("worldScenarioId", t)
        self.assertNotIn("goals", RunManager.tarif_of(dict(self.ST, goals=None)))

    def test_empty_string_world_id_dropped_like_js_falsy(self):
        self.assertNotIn("worldScenarioId", RunManager.tarif_of(dict(self.ST, worldScenarioId="")))

    def test_patch_missing_key_vs_null(self):
        st = dict(self.ST, versions=[{"version": 1, "fromWeek": 0, "values": {"a": 1}},
                                     {"version": 2, "fromWeek": 5, "values": {"a": 1, "b": None}}])
        self.assertEqual(RunManager.tarif_of(st)["schedule"], [{"week": 5, "patch": {"b": None}}])     # JS: undefined != "null"


class TestQuota(unittest.TestCase):
    def test_size_warning(self):
        root = Path(tempfile.mkdtemp(prefix="kosu-kota-"))
        self.addCleanup(shutil.rmtree, root, True)
        (root / "a").mkdir()
        (root / "a" / "x").write_bytes(b"0" * 2048)
        with mock.patch.object(disk, "MAX_BYTES", 1024), mock.patch("sys.stderr") as err:
            disk.DiskStore(root).open("canli-1", 0)
        self.assertTrue(any("boyut" in str(c) for c in err.write.call_args_list))
        self.assertTrue((root / "a" / "x").is_file())


class TestConfig(unittest.TestCase):
    def test_runs_dir_env_and_default(self):
        with mock.patch.dict(os.environ, {"OYUN_RUNS_DIR": "/tmp/x-kosular"}):
            self.assertEqual(config.runs_dir(), Path("/tmp/x-kosular"))
        with mock.patch.dict(os.environ, {"OYUN_RUNS_DIR": ""}):
            self.assertEqual(config.runs_dir(), config.REPO_ROOT / "simulasyon" / "arayuz" / "kosular")

    def test_gitignore_has_runs_dir(self):
        gi = (config.REPO_ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("simulasyon/arayuz/kosular/", gi)

    def test_cli_runs_dir_flag(self):
        from oyun_server import __main__ as cli
        a = cli.parse_args(["--runs-dir", "/tmp/y"])
        self.assertEqual(a.runs_dir, "/tmp/y")


if __name__ == "__main__":
    unittest.main()
