"""A4: ModelHost (gerçek model, 3-5 hafta) ve FakeHost."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from oyun_server.config import MODEL_ROOT
from oyun_server.sim.host import ModelHost
from oyun_server.testing import FakeHost


def raw_rows(weeks_run, overrides=None, weeks=200):
    """model_mod-eşdeğeri döngü (A1 kalıbı), tek süreçte."""
    sys.path.insert(0, str(MODEL_ROOT))
    import simbuild
    d = tempfile.mkdtemp(prefix="oyun-t-")
    old = os.environ.get("WEEKLY_CSV")
    os.environ["WEEKLY_CSV"] = os.path.join(d, "w.csv")
    try:
        m = simbuild.build(simbuild.Params(**(overrides or {})))
    finally:
        if old is None:
            os.environ.pop("WEEKLY_CSV", None)
        else:
            os.environ["WEEKLY_CSV"] = old
        shutil.rmtree(d, ignore_errors=True)
    W = m.new_world(weeks, 5, True)
    m._modules["simkit.engine"].start_world(W)
    for w in range(1, weeks_run + 1):
        m._modules["simkit.step"].week_step(W, w, weeks)
    return [json.dumps(r, sort_keys=True, default=repr) for r in W.wk_csv]


class ModelHostTests(unittest.TestCase):
    def test_host_rows_equal_model_mod(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            got = [h.step() for _ in range(5)]
            self.assertEqual(h.week, 5)
        finally:
            h.close()
        self.assertEqual([json.dumps(r, sort_keys=True, default=repr) for r in got], raw_rows(5))

    def test_facts_are_separate_idempotent_and_read_only(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            row = h.step()
            f1 = h.facts()
            self.assertTrue({"x_policy_rate", "x_policy_unemployment", "x_city_spend_cut"} <= set(f1))      # S5: dünya olguları (probes.world_facts) da eklenir
            self.assertTrue(all(k.startswith("x_") for k in f1))
            self.assertFalse(set(f1) & set(row))                       # model satırına karışmaz
            self.assertEqual(h.facts(), f1)                             # aynı hafta tekrar: aynı sonuç
            self.assertEqual(f1["x_policy_rate"], h._W.pol[0])
            h.step()
            self.assertEqual(h.facts()["x_city_spend_cut"], 0.0)       # açılışta kısma yok
        finally:
            h.close()

    def test_no_csv_file_written(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            h.step()
            path = os.environ.get("WEEKLY_CSV")
            self.assertTrue(path is None or not os.path.exists(path))
            with os.scandir(h._csv_dir) as it:                          # T4: yalnız akış kancasının geçici .sx / .st dosyaları olabilir (modelin ölçüm CSV'si yazılmaz)
                self.assertLessEqual({e.name for e in it}, {"w.csv.sx", "w.csv.st"})
        finally:
            h.close()

    def test_patch_writes_all_modules(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            h.step()
            n = h.patch({"CORP_TAX": 0.4})
            self.assertGreater(n, 1)
            holders = [m for m in h._model._modules.values() if "CORP_TAX" in m.__dict__]
            self.assertEqual(len(holders), n)
            self.assertTrue(all(m.CORP_TAX == 0.4 for m in holders))
            self.assertEqual(h.effective["CORP_TAX"], 0.4)
            self.assertIn("CORP_TAX", h.base_values)
        finally:
            h.close()

    def test_patch_unknown_key_keyerror(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            with self.assertRaises(KeyError):
                h.patch({"BOYLE_BIR_AD_YOK": 1})
            self.assertEqual(h.effective, {})
        finally:
            h.close()

    def test_revert_to_restores_base_values(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            base = h._model._modules["simkit.params"].WAGE_TAX
            h.patch({"WAGE_TAX": 0.25, "CORP_TAX": 0.4})
            h.revert_to({"WAGE_TAX": 0.25})
            p = h._model._modules
            self.assertEqual(p["simkit.params"].WAGE_TAX, 0.25)
            self.assertEqual(p["simkit.params"].CORP_TAX, h.base_values["CORP_TAX"])
            h.revert_to({})
            self.assertEqual(p["simkit.params"].WAGE_TAX, base)
            self.assertEqual(h.effective, {})
        finally:
            h.close()

    def test_step_past_end(self):
        h = ModelHost(str(MODEL_ROOT), {}, 3, 5)
        try:
            for _ in range(3):
                h.step()
            with self.assertRaises(ValueError):
                h.step()
        finally:
            h.close()

    def test_initial_overrides_typed(self):
        h = ModelHost(str(MODEL_ROOT), {"CORP_TAX": 0.3}, 200, 5)
        try:
            self.assertEqual(h._model._modules["simkit.params"].CORP_TAX, 0.3)
            self.assertEqual(h.effective, {"CORP_TAX": 0.3})
        finally:
            h.close()


class FixRound1Tests(unittest.TestCase):
    def test_model_version(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            self.assertRegex(h.model_version, r"^v13\.3-[0-9a-f]{8}$")
        finally:
            h.close()

    def test_patch_rejects_start_only_key(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        try:
            before = h._model._modules["simkit.params"].SALES_TAX
            with self.assertRaises(ValueError):
                h.patch({"SALES_TAX": 0.10})
            with self.assertRaises(ValueError):
                h.patch({"CORP_TAX": 0.4, "SALES_TAX": 0.10})   # karma: hiçbiri yazılmaz
            mods = h._model._modules.values()
            self.assertTrue(all(m.SALES_TAX == before for m in mods if "SALES_TAX" in m.__dict__))
            self.assertNotEqual(h._model._modules["simkit.params"].CORP_TAX, 0.4)
            self.assertEqual(h.effective, {})
        finally:
            h.close()

    def test_live_keys_arg(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5, live_keys={"WAGE_TAX", "SALES_TAX"})
        try:
            self.assertGreater(h.patch({"WAGE_TAX": 0.2}), 0)
            with self.assertRaises(ValueError):
                h.patch({"CORP_TAX": 0.4})
            with self.assertRaises(ValueError):                  # liste izin verse de türetim farkı kapısı reddeder
                h.patch({"SALES_TAX": 0.1})
        finally:
            h.close()

    def test_patch_rejects_locked_and_reversed_keys_with_real_evidence(self):
        """E0 (R2-ek2 M1): gerçek apply_classes kanıtında nedeni `anahtar_kilidi` ya da `yon_ters` olan her anahtar, canlı anahtar listesinde
        olsa bile `ModelHost.patch` ikinci kapısında reddedilir; ret hiçbir şeyi değiştirmez."""
        path = Path(__file__).resolve().parents[2] / "registry" / "apply_classes.json"
        keys = json.loads(path.read_text(encoding="utf-8"))["keys"]
        locked = sorted(k for k, v in keys.items() if v.get("reason") in ("anahtar_kilidi", "yon_ters"))
        self.assertGreaterEqual(len(locked), 5)
        self.assertTrue({"MINT_OPEN_WEEKS", "PATENT_TERM", "EQUALIZE", "FOUND_HARC", "NPC_KEEP"} <= set(locked))
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5, live_keys=set(locked))        # birinci kapı açık: yalnız ikinci kapı durdurabilir
        try:
            params = h._model._modules["simkit.params"].__dict__
            for k in locked:
                self.assertIn(k, params, k)
                with self.assertRaises(ValueError, msg=k):
                    h.patch({k: params[k]})
            with self.assertRaises(ValueError):                                   # karma: serbest anahtar da yazılmaz
                h.patch({"WAGE_TAX": 0.2, locked[0]: params[locked[0]]})
            self.assertEqual(h.effective, {})
            self.assertEqual(h.base_values, {})
        finally:
            h.close()

    def test_revert_keeps_initial_overrides(self):
        h = ModelHost(str(MODEL_ROOT), {"CORP_TAX": 0.3}, 200, 5)
        try:
            h.patch({"CORP_TAX": 0.5, "WAGE_TAX": 0.25})
            h.revert_to({})
            p = h._model._modules["simkit.params"]
            self.assertEqual(h.effective, {"CORP_TAX": 0.3})
            self.assertEqual(p.CORP_TAX, 0.3)
            h.revert_to({"WAGE_TAX": 0.25})
            self.assertEqual(h.effective, {"CORP_TAX": 0.3, "WAGE_TAX": 0.25})
        finally:
            h.close()

    def test_close_blocks_use(self):
        h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
        h.step()
        h.close()
        self.assertTrue(h.closed)
        self.assertIsNone(h._model)
        self.assertIsNone(h._W)
        with self.assertRaises(RuntimeError):
            h.step()
        with self.assertRaises(RuntimeError):
            h.patch({"CORP_TAX": 0.4})
        h.close()   # ikinci kapatma zararsız

    def test_debug_env_scrubbed_and_restored(self):
        flags = ["DBGF", "SDUMP", "KDUMP", "PFDUMP", "SCDUMP", "CDUMP", "SECDUMP", "BDUMP"]
        saved = {k: os.environ.get(k) for k in flags + ["WEEKLY_CSV"]}
        for k in flags:
            os.environ[k] = "1"
        os.environ["WEEKLY_CSV"] = "/nonexistent/dir/x.csv"
        try:
            h = ModelHost(str(MODEL_ROOT), {}, 200, 5)
            try:
                p = h._model._modules["simkit.params"]
                self.assertIsNone(p.DEBUG_FIRM)
                self.assertFalse(p.SDUMP_ON)
                h.step()
                self.assertTrue(all(os.environ.get(k) == "1" for k in flags))     # çağıranın ortamı geri geldi
                self.assertEqual(os.environ["WEEKLY_CSV"], "/nonexistent/dir/x.csv")
            finally:
                h.close()
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


class FakeHostTests(unittest.TestCase):
    def rows(self, ov, n=6, patch_at=None, patch=None):
        h = FakeHost("x", ov, 200, 5)
        out = []
        for i in range(n):
            if patch_at == i:
                h.patch(patch)
            out.append(h.step())
        return out

    def test_fake_host_deterministic(self):
        self.assertEqual(self.rows({"A": 1}), self.rows({"A": 1}))
        self.assertNotEqual(self.rows({"A": 1}), self.rows({"A": 2}))

    def test_fake_host_patch_diverges(self):
        a = self.rows({}, 8)
        b = self.rows({}, 8, 4, {"TRANS_SUPPORT": 0})
        self.assertEqual(a[:4], b[:4])
        self.assertNotEqual([r["talep_karsilama"] for r in a[4:]], [r["talep_karsilama"] for r in b[4:]])

    def test_fake_interface(self):
        h = FakeHost("x", {}, 3, 5)
        self.assertEqual(h.week, 0)
        h.patch({"CORP_TAX": 0.4})
        self.assertEqual(h.effective, {"CORP_TAX": 0.4})
        h.revert_to({})
        self.assertEqual(h.effective, {})
        for _ in range(3):
            h.step()
        with self.assertRaises(ValueError):
            h.step()
        h.close()


if __name__ == "__main__":
    unittest.main()
