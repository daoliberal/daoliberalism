"""S1 düzeltme (M6): gerçek modelde İKİ anahtarlı atomik canlı yama == aynı seam'de ham taze koşu (değer düzeyinde).

Kayıt: gerçek kayıt (R1a'dan beri `ucret_stopaji` WAGE_TAX; ölçümde türetim farkı boş; canlı ve düzenlenebilir); böylece
`gecis_destegi` (TRANS_SUPPORT) ile aynı yamada değişir. `OYUN_QUICK=1` ile atlanır.
"""
from __future__ import annotations

import json
import os
import time
import unittest

from oyun_server import config
from oyun_server.runs.manager import RunManager
from oyun_server.sim.host import ModelHost
from oyun_server.testing import InProcWorker

from tests.registry_helpers import real_registry
from tests.test_replay_equals_live import BASE_PARAMS, CONFIG, TAIL, hook_free_diffs, rows_of, run_raw

PATCH = {"gecis_destegi": "kisa_sureli", "ucret_stopaji": 25}
MODEL = {"TRANS_SUPPORT": 1, "WAGE_TAX": 0.25}


class TestBenchPremise(unittest.TestCase):
    def test_wage_tax_has_empty_derived_diff_and_is_live(self):
        lp = json.loads(config.BENCH_RESULT.read_text(encoding="utf-8"))["livepatch"]
        self.assertEqual(lp["WAGE_TAX"]["derived_diff"], [])
        self.assertEqual(lp["TRANS_SUPPORT"]["derived_diff"], [])
        self.assertEqual(lp["CORP_TAX"]["derived_diff"], [])
        reg = real_registry()
        live = config.load_live_keys(reg)      # R2: MVP anahtarları + kanıtlı yeni canlı anahtarlar
        self.assertTrue(frozenset({"TRANS_SUPPORT", "WAGE_TAX", "CORP_TAX"}) <= live)
        self.assertNotIn("SALES_TAX", live)


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "gerçek model kanıtı yavaş (OYUN_QUICK)")
class TestTwoKeyPatchEqualsReplay(unittest.TestCase):
    def test_two_key_patch_equals_fresh_run(self):
        reg = real_registry()
        hosts: list = []

        def factory(spec):
            def mk(s):
                h = ModelHost(str(config.MODEL_ROOT), s.get("overrides", {}), s.get("weeks", 200), live_keys=s.get("live_keys"))
                hosts.append(h)
                return h
            return InProcWorker(spec, host_factory=mk)

        mgr = RunManager(reg, factory, cfg=config)
        mgr.start_thread()
        try:
            rid = mgr.create(dict(CONFIG, values={"ucret_stopaji": 10}))["runId"]
            mgr.control(rid, "play", 16)
            self._until(lambda: mgr.stats(rid)["released"] >= 6)
            res = mgr.apply_change(rid, PATCH, None, timeout=60)
            self.assertTrue(res["accepted"], res)
            seam = res["seamWeek"]
            self._until(lambda: mgr.stats(rid)["released"] >= seam + TAIL, 180)
            mgr.control(rid, "pause", None)
            self._until(lambda: mgr.stats(rid)["worker_week"] >= mgr.stats(rid)["frontier"], 60)
            time.sleep(0.2)
            host = hosts[0]
            n, rows, W = host.week, rows_of(host._W, host.week), host._W
            self.assertEqual(res["version"], 2)
            ev = [e for e in mgr._runs[rid].vevents]
            self.assertEqual(len(ev), 1)
            self.assertEqual([c["id"] for c in ev[0]["changes"]], ["gecis_destegi", "ucret_stopaji"])
            self.assertEqual(host.effective["WAGE_TAX"], 0.25)
        finally:
            mgr.shutdown()
        W_b = run_raw(n, [(seam, MODEL)])
        self.assertEqual(rows, rows_of(W_b, n))
        diffs, hook = hook_free_diffs(W, W_b)           # canlı koşu akış kancasını taşır (L.sx, L.secfn, sıfır bond_stat anahtarları; gerekçe test_replay_equals_live.py)
        self.assertEqual(diffs, [], diffs[:5])
        self.assertEqual(hook, {"W['L']['sx']", "W['L']['secfn']", "W['bond_stat']"})   # kanca farkları gerçekten var (sınama boş değil)

    @staticmethod
    def _until(cond, secs=120):
        end = time.time() + secs
        while time.time() < end:
            if cond():
                return
            time.sleep(0.02)
        raise AssertionError("zaman aşımı")


if __name__ == "__main__":
    unittest.main()
