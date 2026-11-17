"""A8: canlı yama kapıları, sürümler ve ChangeResult (sahte işçi; hızlı). Gerçek model kanıtı: test_replay_equals_live.py."""
from __future__ import annotations

import dataclasses
import threading
import time
import unittest

from oyun_server.registry import loader
from oyun_server.registry.schema import RunConfigError
from oyun_server.runs.manager import RunManager
from oyun_server.testing import InProcWorker

from tests.registry_helpers import EXTRA_CARD, EXTRA_TEXT, copy_data, read_json, real_defaults, real_registry, write_json
from tests.test_manager import CONFIG, ManagerBase, drain, make_cfg

# ChangeResult ve sürüm olayı alan kümeleri (P-01): sabit.
EVENT_FIELDS = {"id", "week", "kind", "textKey", "params", "critical", "sector", "rule_ids", "changes"}
RESULT_FIELDS = {"accepted", "runId", "mode", "scenarioId", "seamWeek", "version"}
PATCH = {"gecis_destegi": "kisa_sureli"}


class ChangeBase(ManagerBase):
    def change(self, rid, patch, timeout=None, pump=True):
        res = {}
        t = threading.Thread(target=lambda: res.update(r=self.mgr.apply_change(rid, patch, None, timeout=timeout)))
        t.start()
        end = time.time() + 30
        while pump and t.is_alive() and time.time() < end:
            self.mgr.pump(self.clock.t)
            time.sleep(0.002)
        t.join(30)
        if "r" not in res:
            self.fail("apply_change 30 sn içinde dönmedi")
        return res["r"]


class TestGate(ChangeBase):
    def test_start_only_rejected_run_untouched(self):             # Review Focus 3
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 2)
        before = (m.get(rid)["state"]["version"], dict(m.get(rid)["state"]["values"]))
        sub = m.subscribe(rid)
        drain(sub)
        r = m.apply_change(rid, {"dunya_tohumu": 3}, None)
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "dunya_tohumu", "reason": "start_only"}]})
        for _ in range(5):
            m.pump(self.clock.t)
            time.sleep(0.005)
        self.assertEqual(self.hosts[0].patch_calls, [])           # işçiye yama hiç gitmedi
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"], st["computing"]), (before[0], before[1], False))
        self.assertEqual([e for e, _ in drain(sub) if e == "world_event"], [])
        self.assertTrue(self.change(rid, PATCH)["accepted"])      # koşu sağlam: canlı ayar sonra kabul edilir

    def test_apply_class_gate_not_only_live_keys(self):
        """Parametresi canlı anahtar kümesinde olsa bile `apply` start_only ise locked."""
        reg = real_registry()
        reg.by_id["gecis_destegi"] = dataclasses.replace(reg.by_id["gecis_destegi"], apply="start_only")
        m = self.make()
        m.registry = reg
        rid, _ = self.new_run()
        r = m.apply_change(rid, PATCH, None)
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "gecis_destegi", "reason": "start_only"}]})
        self.assertEqual(self.hosts[0].patch_calls if self.hosts else [], [])

    def test_gecis_destegi_is_live_class(self):
        self.assertIn(real_registry().by_id["gecis_destegi"].apply, ("live", "live_sync"))
        self.assertEqual(real_registry().by_id["dunya_tohumu"].apply, "start_only")

    def test_unknown_setting_rejected(self):
        m = self.make()
        rid, _ = self.new_run()
        for patch in ({"yok_boyle_ayar": 1}, {"gecis_destegi": "kisa_sureli", "yok": 1}):
            r = m.apply_change(rid, patch, None)
            self.assertFalse(r["accepted"])
            self.assertEqual({f["reason"] for f in r["fields"]}, {"locked"})
        self.assertEqual(m.apply_change(rid, {}, None), {"accepted": False, "fields": [{"id": "*", "reason": "invalid"}]})
        self.assertEqual(m.get(rid)["state"]["version"], 1)

    def test_change_after_end(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["status"] == "ended", timeout=30)
        self.assertEqual(m.apply_change(rid, PATCH, None), {"accepted": False, "fields": [{"id": "*", "reason": "ended"}]})
        self.assertEqual(m.get(rid)["state"]["version"], 1)

    def test_derived_diff_key_rejected(self):
        """Türetim farkı olan anahtar (SALES_TAX -> MARKET_MARKUP0): kart `apply:"live"` olsa da, yönetici BAŞTAN o kayıtla
        kurulsa da canlı anahtar değildir; değişiklik start_only ile reddedilir (bağımsız ölçüm kapısı, bench-sonuc.json)."""
        reg = live_card_registry()
        self.assertEqual(reg.by_id["ek_deneme"].apply, "live")
        m = self.make(registry=reg)
        self.assertNotIn("SALES_TAX", m.live_keys)
        rid, _ = self.new_run()
        r = m.apply_change(rid, {"ek_deneme": 10}, None)
        self.assertEqual(r, {"accepted": False, "fields": [{"id": "ek_deneme", "reason": "start_only"}]})
        self.assertEqual(self.hosts[0].patch_calls if self.hosts else [], [])

    def test_live_sync_without_w_sync_recipe_not_live(self):
        import dataclasses
        from unittest import mock
        from oyun_server import config
        from oyun_server.sim import livepatch
        reg = real_registry()
        reg.by_id["gecis_destegi"] = dataclasses.replace(reg.by_id["gecis_destegi"], apply="live_sync")
        reg.settings = [reg.by_id[s.id] if s.id == "gecis_destegi" else s for s in reg.settings]
        self.assertNotIn("TRANS_SUPPORT", config.load_live_keys(reg))          # W_SYNC tarifi yok
        with mock.patch.dict(livepatch.W_SYNC, {"TRANS_SUPPORT": lambda W, v: None}):
            self.assertIn("TRANS_SUPPORT", config.load_live_keys(reg))


def live_card_registry(apply="live"):
    """Gerçek kayıt + parametresi (SALES_TAX) mvp_live_keys'te OLMAYAN, apply=live bir kart (`ek_deneme`)."""
    import shutil
    import tempfile
    from pathlib import Path
    d = Path(tempfile.mkdtemp(prefix="oyun-a8p-"))
    try:
        copy_data(d, drop=("satis_vergisi",))                 # SALES_TAX'ın gerçek kartı ek karta yer açar
        write_json(d / "settings.x.json", {"settings": [dict(EXTRA_CARD, apply=apply)]})
        texts = read_json(d / "metinler.tr.json")
        texts["ek_deneme"] = EXTRA_TEXT
        write_json(d / "metinler.tr.json", texts)
        return loader.load_registry(d, real_defaults())
    finally:
        shutil.rmtree(d, True)


class TestSharedPredicate(ChangeBase):
    """Tek yüklem `is_live_changeable(card, live_keys)`: yönetici kapısı, /info?run= ve /availability aynı kararı verir."""

    def test_predicate_truth_table(self):
        from oyun_server.runs.manager import is_live_changeable
        reg = live_card_registry()
        live = {"CORP_TAX", "TRANS_SUPPORT", "WAGE_TAX"}
        self.assertTrue(is_live_changeable(reg.by_id["gecis_destegi"], live))
        self.assertFalse(is_live_changeable(reg.by_id["gecis_destegi"], {"CORP_TAX"}))      # param canlı kümede değil
        self.assertFalse(is_live_changeable(reg.by_id["dunya_tohumu"], live))               # apply start_only
        self.assertFalse(is_live_changeable(reg.by_id["ek_deneme"], live))                  # apply live ama SALES_TAX dışarıda
        self.assertTrue(is_live_changeable(reg.by_id["ek_deneme"], live | {"SALES_TAX"}))

    def test_manager_info_availability_agree(self):
        from tests.route_helpers import call, create_run, live_app
        reg = live_card_registry()
        r = self.make()
        r.registry = reg
        rid, _ = self.new_run()
        self.assertEqual(r.apply_change(rid, {"ek_deneme": 10}, None),
                         {"accepted": False, "fields": [{"id": "ek_deneme", "reason": "start_only"}]})
        with live_app(registry=reg) as (srv, app, _w):
            rid2 = create_run(srv)
            _, _, info = call(srv, "GET", f"/api/info?run={rid2}")
            self.assertEqual([x["options"] for x in info["settings"] if x["id"] == "ek_deneme"], [[]])   # sayı kartı: seçenek yok; kilit availability/changes ile
            _, _, a = call(srv, "POST", "/api/availability", {"values": {"ek_deneme": 10}, "runId": rid2})
            self.assertEqual((a["ok"], [b["settingId"] for b in a["blocked"]]), (False, ["ek_deneme"]))
            _, _, a = call(srv, "POST", "/api/availability", {"values": {"ek_deneme": 10}})
            self.assertTrue(a["ok"])                                                       # başlangıç bağlamı serbest
            _, _, c = call(srv, "POST", f"/api/runs/{rid2}/changes", {"from": "next_week", "patch": {"ek_deneme": 10}})
            self.assertEqual(c["fields"], [{"id": "ek_deneme", "reason": "start_only"}])

    def test_info_run_locks_enum_card_with_nonlive_param(self):
        """Seçenekli (enum) kart: apply=live ama param canlı kümede değil -> /info?run= seçenekleri locked."""
        from tests.route_helpers import call, create_run, live_app, make_cfg
        reg = live_card_registry()
        card = reg.by_id["gecis_destegi"]
        reg.by_id["gecis_destegi"] = dataclasses.replace(card, apply="live")
        cfg = make_cfg(load_live_keys=lambda reg=None: frozenset({"CORP_TAX", "WAGE_TAX"}))         # TRANS_SUPPORT dışarıda
        with live_app(registry=reg, cfg=cfg) as (srv, app, _w):
            rid = create_run(srv)
            _, _, info = call(srv, "GET", f"/api/info?run={rid}")
            opts = next(x for x in info["settings"] if x["id"] == "gecis_destegi")["options"]
            self.assertTrue(all((o["available"], o.get("reason")) == (False, "locked") for o in opts))
            _, _, a = call(srv, "POST", "/api/availability", {"values": {"gecis_destegi": "kisa_sureli"}, "runId": rid})
            self.assertFalse(a["ok"])


class TestVersions(ChangeBase):
    def test_change_response_seam_matches_version_event(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 2)
        r = self.change(rid, PATCH)
        self.assertEqual(set(r), RESULT_FIELDS)
        self.assertEqual((r["accepted"], r["mode"], r["version"], r["runId"], r["scenarioId"]),
                         (True, "live", 2, rid, "dayanikli_taban"))
        self.pump_until(lambda: m.stats(rid)["released"] >= r["seamWeek"] + 3)
        ev = drain(sub)
        vs = [d for e, d in ev if e == "world_event"]
        self.assertEqual(len(vs), 1)
        self.assertEqual(set(vs[0]), EVENT_FIELDS)
        self.assertEqual(vs[0]["week"], r["seamWeek"])
        self.assertEqual(vs[0]["id"], "version:2:%d:gecis_destegi" % r["seamWeek"])
        self.assertEqual((vs[0]["kind"], vs[0]["critical"], vs[0]["sector"]), ("neutral", False, None))
        self.assertEqual(vs[0]["params"], {"hafta": r["seamWeek"], "mod": "live", "surum": 2})
        for e, d in ev:
            if e == "week":
                self.assertEqual(d["version"], 1 if d["week"] <= r["seamWeek"] else 2, d["week"])
        # seam, işçinin hesapladığı ön hafta: sonraki ilk hafta yeni değerle hesaplanır
        self.assertEqual(self.hosts[0].patch_calls, [{"TRANS_SUPPORT": 1}])

    def test_two_changes_before_seam_crossed(self):
        m = self.make()
        rid, _ = self.new_run()
        sub = m.subscribe(rid)
        m.control(rid, "play", 1)                                 # sahte saat donuk: yayım yok, işçi 2 hafta önde
        self.computed(rid, 2)
        a = self.change(rid, {"gecis_destegi": "kisa_sureli"})
        b = self.change(rid, {"gecis_destegi": "kurtarma_fonuyla"})
        self.assertEqual((a["version"], b["version"]), (2, 3))
        self.assertEqual(m.stats(rid)["released"], 0)             # ikisi de seam aşılmadan kabul edildi
        self.assertGreaterEqual(b["seamWeek"], a["seamWeek"])
        for _ in range(12):
            self.clock.advance(2.0)
            m.pump(self.clock.t)
            self.pump_until(lambda: m.stats(rid)["worker_week"] >= m.stats(rid)["released"])
        end = time.time() + 30
        while m.stats(rid)["released"] < b["seamWeek"] + 3 and time.time() < end:
            self.clock.advance(2.0)
            m.pump(self.clock.t)
            time.sleep(0.003)
        if m.stats(rid)["released"] < b["seamWeek"] + 3:
            self.fail("seam sonrası 3 hafta yayımlanmadı")
        ev = drain(sub)
        vs = [d for e, d in ev if e == "world_event"]
        self.assertEqual(sorted(d["params"]["surum"] for d in vs), [2, 3])
        self.assertEqual(len({d["id"] for d in vs}), 2)           # çift/yinelenen olay yok
        want = {2: a["seamWeek"], 3: b["seamWeek"]}
        for d in vs:
            self.assertEqual((d["week"], d["params"]["hafta"]), (want[d["params"]["surum"]],) * 2)
        for e, d in ev:                                           # paket sürümü seam'lerle tutarlı
            if e == "week":
                exp = 1 + (d["week"] > a["seamWeek"]) + (d["week"] > b["seamWeek"])
                self.assertEqual(d["version"], exp, d["week"])
        st = m.get(rid)["state"]
        self.assertEqual((st["version"], st["values"]["gecis_destegi"]), (3, "kurtarma_fonuyla"))
        self.assertEqual([c["TRANS_SUPPORT"] for c in self.hosts[0].patch_calls], [1, 2])

    def test_change_applies_while_running_not_busy(self):          # Ö4
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 1)
        self.computed(rid, 2)
        self.assertEqual(m.get(rid)["state"]["status"], "running")
        r = self.change(rid, PATCH)
        self.assertTrue(r["accepted"], r)
        self.assertEqual(m.get(rid)["state"]["status"], "running")


class TestRace(ChangeBase):
    def test_change_and_play_race(self):                          # Review Focus 4
        for _ in range(8):
            self.setUp()
            m = self.make()
            rid, _ = self.new_run()
            sub = m.subscribe(rid)
            out = {}
            go = threading.Barrier(2)

            def play():
                go.wait()
                out["c"] = m.control(rid, "play", 16)

            def chg():
                go.wait()
                out["r"] = m.apply_change(rid, PATCH, None)

            ts = [threading.Thread(target=play), threading.Thread(target=chg)]
            for t in ts:
                t.start()
            end = time.time() + 30
            while any(t.is_alive() for t in ts) and time.time() < end:
                m.pump(self.clock.t)
                time.sleep(0.002)
            for t in ts:
                t.join(2)
            if "r" not in out:
                self.fail("değişiklik 30 sn içinde dönmedi")
            r = out["r"]
            self.assertTrue(r["accepted"], r)                     # tek geçerli sonuç: kabul ya da net ret, yarım sürüm yok
            if m.control(rid, "play", 16)["status"] != "running":
                m.control(rid, "play", 16)
            self.pump_until(lambda: m.stats(rid)["released"] >= r["seamWeek"] + 3)
            ev = drain(sub)
            vs = [d for e, d in ev if e == "world_event"]
            if r["seamWeek"] == 0:                                # hafta 0: sürüm artmaz, olay yok (koordinatör hükmü)
                self.assertEqual((vs, r["version"]), ([], 1))
            else:
                self.assertEqual(len(vs), 1)
                self.assertEqual((vs[0]["week"], vs[0]["params"]["hafta"], vs[0]["params"]["surum"]), (r["seamWeek"],) * 2 + (2,))
                self.assertEqual(vs[0]["id"], "version:2:%d:gecis_destegi" % r["seamWeek"])
            self.assertEqual(self.hosts[0].patch_calls, [{"TRANS_SUPPORT": 1}])
            weeks_seen = [d["week"] for e, d in ev if e == "week"]
            self.assertEqual(len(weeks_seen), len(set(weeks_seen)))                  # yinelenen hafta yok
            last = 0
            for e, d in ev:
                if e == "week":
                    self.assertEqual(d["week"], last + 1)
                    last = d["week"]
                    self.assertEqual(d["version"], 1 if d["week"] <= r["seamWeek"] or r["seamWeek"] == 0 else 2)
            self._cleanup()


if __name__ == "__main__":
    unittest.main()
