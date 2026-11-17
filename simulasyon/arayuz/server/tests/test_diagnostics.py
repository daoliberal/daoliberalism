"""S4: "Ne olmuyor" tanıları. Saf değerlendirme (sentetik seriler) + RunManager bağlantısı (paket başına `diagnostics`)."""
from __future__ import annotations

import json
import os
import re
import unittest
from pathlib import Path

from oyun_server import config
from oyun_server.sim import diagnostics as dg
from oyun_server.sim.extract import NEW_WORLD_FIELDS, extract_world

from tests.registry_helpers import real_registry
from tests.test_manager import CONFIG, FlakyHost, ManagerBase, drain

FIX = json.loads((Path(__file__).parent / "fixtures" / "wire_contract.json").read_text(encoding="utf-8"))
TR_TS = config.REPO_ROOT / "apps" / "web" / "src" / "oyun" / "copy" / "tr.ts"
FOUR_KEYS = {"neolmuyor.faiz_dusmuyor", "neolmuyor.destek_yok", "neolmuyor.kurulus_kredisi_yok", "neolmuyor.basim_siniri"}
NEUT = 0.003                                    # POL_NEUT (model varsayılanı, haftalık)

REG = real_registry()
ON = {"faiz_kurali": "kural", "gecis_destegi": "kurtarma_fonuyla"}


def world(**kw):
    w = dict.fromkeys(extract_world({}))
    assert set(kw) <= set(w), set(kw) - set(w)
    w.update(kw)
    return w


def flat(n, **kw):
    return [world(**kw) for _ in range(n)]


def ids(out):
    return [d["id"] for d in out]


class TestEvaluate(unittest.TestCase):
    def test_support_off_never_reports_support(self):
        hist = flat(30, support_weekly=0, support_denied=5)
        self.assertEqual(ids(dg.evaluate(hist, {"gecis_destegi": "kapali"}, REG)), [])
        self.assertEqual(ids(dg.evaluate(hist, {"gecis_destegi": "kisa_sureli"}, REG)), ["destek_yok"])
        self.assertEqual(ids(dg.evaluate(hist, {"gecis_destegi": "kurtarma_fonuyla"}, REG)), ["destek_yok"])

    def test_support_window_is_eight_weeks(self):
        v = {"gecis_destegi": "kisa_sureli"}
        self.assertEqual(dg.evaluate(flat(7, support_weekly=0, support_denied=5), v, REG), [])
        out = dg.evaluate(flat(8, support_weekly=0, support_denied=5), v, REG)
        self.assertEqual([(d["id"], d["since_week"]) for d in out], [("destek_yok", 1)])
        broken = flat(5, support_weekly=0) + flat(1, support_weekly=900) + flat(8, support_weekly=0, support_denied=5)
        out = dg.evaluate(broken, v, REG)
        self.assertEqual(out[0]["since_week"], 7)                  # seri son ödemeden sonraki haftada başlar

    def test_support_needs_denied_requests(self):
        v = {"gecis_destegi": "kurtarma_fonuyla"}
        # açılış dönemi / başarılı geçiş: ödeme yok ama reddedilen talep de yok -> yanlış alarm yok
        self.assertEqual(dg.evaluate(flat(30, support_weekly=0, support_denied=0), v, REG), [])
        self.assertEqual(dg.evaluate(flat(30, support_weekly=0, support_denied=None), v, REG), [])
        # ödeme çıkıyorsa red olsa da tanı yok
        self.assertEqual(dg.evaluate(flat(30, support_weekly=100, support_denied=5), v, REG), [])
        self.assertEqual(ids(dg.evaluate(flat(8, support_weekly=0, support_denied=5), v, REG)), ["destek_yok"])

    def test_rate_rule_off_no_rate_diag(self):
        hist = flat(30, policy_rate=0.004, policy_unemployment=0.4)
        self.assertEqual(ids(dg.evaluate(hist, {"faiz_kurali": "piyasa"}, REG)), [])
        self.assertEqual(ids(dg.evaluate(hist, {"faiz_kurali": "kural"}, REG)), ["faiz_dusmuyor"])

    def test_rate_needs_both_conditions_for_thirteen_weeks(self):
        v = {"faiz_kurali": "kural"}
        self.assertEqual(dg.evaluate(flat(12, policy_rate=0.004, policy_unemployment=0.4), v, REG), [])
        self.assertEqual(dg.evaluate(flat(20, policy_rate=0.002, policy_unemployment=0.4), v, REG), [])   # faiz tarafsızın altına indi: sorun yok
        self.assertEqual(dg.evaluate(flat(20, policy_rate=0.004, policy_unemployment=0.10), v, REG), [])  # işsizlik normalin altında
        self.assertEqual(dg.evaluate(flat(20, policy_rate=0.004, policy_unemployment=0.25), v, REG), [])  # normalde (eşit): üstünde değil
        out = dg.evaluate(flat(20, policy_rate=NEUT, policy_unemployment=0.4), v, REG)                    # tam tarafsız düzeyde: hâlâ inmiyor
        self.assertEqual(ids(out), ["faiz_dusmuyor"])
        # eski ölçü (paket işsizlik oranı) artık koşulu belirlemez
        self.assertEqual(dg.evaluate(flat(20, policy_rate=0.004, unemployment_rate=0.9), v, REG), [])
        out = dg.evaluate(flat(20, policy_rate=0.004, policy_unemployment=0.4), v, REG)
        self.assertEqual([(d["id"], d["since_week"]) for d in out], [("faiz_dusmuyor", 1)])

    def test_rate_threshold_follows_natural_unemployment_card(self):
        hist = flat(20, policy_rate=0.004, policy_unemployment=0.30)
        self.assertEqual(ids(dg.evaluate(hist, {"faiz_kurali": "kural"}, REG)), ["faiz_dusmuyor"])
        v = {"faiz_kurali": "kural", "dogal_issizlik_kurali": {"normal": 35, "tepki": "orta"}}   # normal %35: %30 altında
        self.assertEqual(dg.evaluate(hist, v, REG), [])

    def test_founding_credit_rule(self):
        """PLAN-KREDI U14: tanı FARKLI kurucu sayısıyla çalışır (`founders_*`); eski deneme sayısı (`loans_*`) artık belirleyici değildir."""
        v = {}
        hist = flat(4, founders_applied=10, founders_rejected=9)
        out = dg.evaluate(hist, v, REG)
        self.assertEqual([(d["id"], d["since_week"]) for d in out], [("kurulus_kredisi_yok", 1)])
        self.assertEqual(dg.evaluate(flat(4, founders_applied=10, founders_rejected=8), v, REG), [])      # %90'ın altında
        self.assertEqual(dg.evaluate(flat(4, founders_applied=0, founders_rejected=0), v, REG), [])       # başvuran kurucu yok: sessiz
        self.assertEqual(dg.evaluate(flat(3, founders_applied=10, founders_rejected=10), v, REG), [])     # 4 hafta dolmadı
        self.assertEqual(dg.evaluate(flat(4, founders_applied=None, founders_rejected=None), v, REG), [])  # ölçülemeyen hafta (ret lonca sayısına bölünmedi): sessiz
        # tek kurucu her hafta reddediliyorsa artık tanı çıkar (eski sayımda aynı kurucu 6 deneme görünürdü)
        out = dg.evaluate(flat(4, founders_applied=1, founders_rejected=1), v, REG)
        self.assertEqual([(d["id"], d["since_week"]) for d in out], [("kurulus_kredisi_yok", 1)])
        self.assertEqual(dg.evaluate(flat(4, loans_applied=10, loans_rejected=10), v, REG), [])           # eski alanlar tanıyı belirlemez

    def test_mint_cut_rule(self):
        out = dg.evaluate(flat(2, city_spend_cut=1500), {}, REG)
        self.assertEqual([(d["id"], d["since_week"]) for d in out], [("basim_siniri", 1)])
        out = dg.evaluate(flat(3, city_spend_cut=0) + flat(2, city_spend_cut=40), {}, REG)
        self.assertEqual([(d["id"], d["since_week"]) for d in out], [("basim_siniri", 4)])
        self.assertEqual(dg.evaluate(flat(1, city_spend_cut=1500), {}, REG), [])                    # 2 hafta dolmadı
        self.assertEqual(dg.evaluate(flat(3, city_spend_cut=0), {}, REG), [])
        self.assertEqual(dg.evaluate(flat(3, minted_year=2000, mint_cap=2000), {}, REG), [])        # gösterim alanları tanıyı belirlemez

    def test_synthetic_flat_series_triggers(self):
        hist = flat(20, policy_rate=0.004, policy_unemployment=0.4, support_weekly=0, support_denied=5, founders_applied=10,
                    founders_rejected=10, city_spend_cut=50)
        out = dg.evaluate(hist, ON, REG)
        self.assertEqual(ids(out), ["faiz_dusmuyor", "destek_yok", "kurulus_kredisi_yok", "basim_siniri"])
        self.assertEqual({d["textKey"] for d in out}, FOUR_KEYS)
        for d in out:
            self.assertEqual(set(d), {"id", "textKey", "params", "rule_ids", "since_week"})
            self.assertIsInstance(d["since_week"], int)
            self.assertTrue(d["rule_ids"] and all(r in REG.by_id for r in d["rule_ids"]), d)
            self.assertTrue(all(isinstance(v, (int, str)) and not isinstance(v, bool) for v in d["params"].values()), d)
        by = {d["id"]: d for d in out}
        self.assertEqual(by["faiz_dusmuyor"]["params"], {"hafta": 20})
        self.assertEqual(by["destek_yok"]["params"], {"hafta": 20})
        self.assertEqual((by["faiz_dusmuyor"]["since_week"], by["basim_siniri"]["since_week"]), (1, 1))
        json.dumps(out, allow_nan=False)

    def test_null_fields_silent(self):
        self.assertEqual(dg.evaluate(flat(40), ON, REG), [])          # hiç alan yok
        self.assertEqual(dg.evaluate([], ON, REG), [])
        # tek alan null: o kural sessiz, ötekiler çalışır
        hist = flat(20, policy_rate=None, policy_unemployment=0.4, support_weekly=0, support_denied=5)
        self.assertEqual(ids(dg.evaluate(hist, ON, REG)), ["destek_yok"])
        # pencerenin ortasında null seriyi böler
        hist = flat(6, support_weekly=0, support_denied=5) + flat(1, support_weekly=None, support_denied=5) + flat(6, support_weekly=0, support_denied=5)
        self.assertEqual(dg.evaluate(hist, ON, REG), [])
        hist = flat(3, city_spend_cut=None)
        self.assertEqual(dg.evaluate(hist, {}, REG), [])
        # bozuk değerler (NaN/metin) sessiz
        self.assertEqual(dg.evaluate(flat(20, support_weekly=float("nan"), support_denied=5), ON, REG), [])
        self.assertEqual(dg.evaluate(flat(20, support_weekly="0", support_denied=5), ON, REG), [])

    def test_unknown_card_or_value_is_silent(self):
        hist = flat(20, support_weekly=0, support_denied=5)
        self.assertEqual(dg.evaluate(hist, {"gecis_destegi": "yok_boyle"}, REG), [])
        rules = [{"id": "x", "requires_cards": {"yok_boyle_kart": "*"}, "when": [{"alan": "support_weekly", "op": "==", "esik": 0, "hafta_sayisi": 1}],
                  "textKey": "neolmuyor.destek_yok", "rule_ids": ["gecis_destegi"]}]
        self.assertEqual(dg.evaluate(hist, ON, REG, rules=rules), [])

    def test_defaults_used_when_card_not_in_values(self):
        # faiz_kurali varsayılanı model varsayılanından (RATE_POLICY=True -> "kural"); gecis_destegi sağlanmadıysa varsayılan kullanılır
        hist = flat(20, policy_rate=0.004, policy_unemployment=0.4)
        self.assertEqual(ids(dg.evaluate(hist, {}, REG)), ["faiz_dusmuyor"])

    def test_first_week_offset(self):
        out = dg.evaluate(flat(8, support_weekly=0, support_denied=5), {"gecis_destegi": "kisa_sureli"}, REG, first_week=21)
        self.assertEqual(out[0]["since_week"], 21)


class TestRulesFile(unittest.TestCase):
    def test_textkeys_match_web_list(self):
        rules = dg.load_rules()
        keys = {r["textKey"] for r in rules}
        self.assertEqual(keys, FOUR_KEYS)
        self.assertEqual(len(rules), 4)
        self.assertEqual(set(FIX["enums"]["diagnosticTextKeys"]), FOUR_KEYS)
        self.assertEqual(FIX["enums"]["diagnosticTextKeys"], sorted(FIX["enums"]["diagnosticTextKeys"]))
        self.assertEqual(list(dg.TEXT_KEYS), FIX["enums"]["diagnosticTextKeys"])
        tr = TR_TS.read_text(encoding="utf-8")
        for k in keys:
            self.assertIsNotNone(re.search(r'"%s"\s*:' % re.escape(k), tr), k)

    def test_rule_ids_exist_in_registry_and_requirements_resolvable(self):
        for r in dg.load_rules():
            for rid in r["rule_ids"]:
                self.assertIn(rid, REG.by_id, r["id"])
            for cid in r["requires_cards"]:
                self.assertIn(cid, REG.by_id, r["id"])
            for c in r["when"]:
                self.assertIn(c["op"], (">", ">=", "<", "<=", "==", "!="))
                self.assertIn(c["alan"], set(extract_world({})))
                p = c.get("esik_param")
                if p:
                    self.assertIn(p, REG.defaults)

    def test_bad_rules_file_rejected(self):
        with self.assertRaises(ValueError):
            dg.check_rules([{"id": "x", "requires_cards": {}, "when": [{"alan": "supportt", "op": "==", "esik": 0, "hafta_sayisi": 1}],
                             "textKey": "neolmuyor.destek_yok", "rule_ids": ["a"]}])
        with self.assertRaises(ValueError):
            dg.check_rules([{"id": "x", "requires_cards": {}, "when": [{"alan": "support_weekly", "op": "==", "esik": 0, "hafta_sayisi": 1}],
                             "textKey": "neolmuyor.yok_boyle", "rule_ids": ["a"]}])


class FundHost(FlakyHost):
    """Gerçek model satırı gibi `fon_verilen` (hep 0) ve `fon_red` sütunları; `RED` = reddedilen talep (0: açılış dönemi)."""

    RED = "5"

    def step(self):
        row = super().step()
        row["fon_verilen"] = "0"
        row["fon_red"] = self.RED
        return row


class TestManagerWiring(ManagerBase):
    def host_factory(self, spec):
        h = FundHost(spec)
        h.fail_week = self.fail_week
        self.hosts.append(h)
        return h

    def play(self, cfg, schedule=None, weeks=16):
        m = self.make()
        rid = m.create(cfg, schedule)["runId"]
        sub = m.subscribe(rid)
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= weeks)
        return m, rid, sub

    def test_packets_carry_diagnostics_list(self):
        m, rid, _ = self.play(dict(CONFIG, values={"gecis_destegi": "kisa_sureli"}), weeks=12)
        pk = m.weeks(rid, 1, 12)
        for p in pk:
            self.assertIsInstance(p["diagnostics"], list)
        self.assertEqual([len(p["diagnostics"]) for p in pk], [0] * 7 + [1] * 5)       # 8. haftada başlar
        d = pk[7]["diagnostics"][0]
        self.assertEqual((d["id"], d["textKey"], d["since_week"], d["rule_ids"]), ("destek_yok", "neolmuyor.destek_yok", 1, ["gecis_destegi"]))

    def test_no_alarm_when_nothing_denied(self):
        FundHost.RED = "0"
        self.addCleanup(setattr, FundHost, "RED", "5")
        m, rid, _ = self.play(dict(CONFIG, values={"gecis_destegi": "kurtarma_fonuyla"}), weeks=14)
        self.assertEqual([p["diagnostics"] for p in m.weeks(rid, 1, 14)], [[]] * 14)

    def test_support_off_run_has_empty_diagnostics(self):
        m, rid, _ = self.play(dict(CONFIG, values={"gecis_destegi": "kapali"}), weeks=12)
        self.assertEqual([p["diagnostics"] for p in m.weeks(rid, 1, 12)], [[]] * 12)

    def test_diag_follows_active_version(self):
        sched = [{"week": 12, "patch": {"gecis_destegi": "kapali"}}]
        m, rid, sub = self.play(dict(CONFIG, values={"gecis_destegi": "kisa_sureli"}), sched, weeks=16)
        pk = m.weeks(rid, 1, 16)
        self.assertEqual([p["version"] for p in pk], [1] * 12 + [2] * 4)
        self.assertEqual([bool(p["diagnostics"]) for p in pk], [False] * 7 + [True] * 5 + [False] * 4)
        # abonelere giden hafta olayı da aynı alanı taşır
        weeks = [d for e, d in drain(sub) if e == "week"]
        self.assertEqual([bool(d.get("diagnostics")) for d in weeks], [bool(p["diagnostics"]) for p in pk])

    def test_window_restarts_when_required_card_changes(self):
        # kapalı -> açık geçişi: pencere değişiklikten sonra yeniden sayılır (yeni kuralın etkisi görülmeden uyarı çıkmaz)
        sched = [{"week": 10, "patch": {"gecis_destegi": "kisa_sureli"}}]
        m, rid, _ = self.play(dict(CONFIG, values={"gecis_destegi": "kapali"}), sched, weeks=22)
        pk = m.weeks(rid, 1, 22)
        flags = [bool(p["diagnostics"]) for p in pk]
        self.assertEqual(flags, [False] * 17 + [True] * 5)                 # seam 10 + 8 hafta = 18. hafta
        self.assertEqual(pk[17]["diagnostics"][0]["since_week"], 11)


@unittest.skipIf(os.environ.get("OYUN_QUICK"), "gerçek model koşusu yavaş")
class TestRealModel(unittest.TestCase):
    """Gerçek modelle kısa koşu (`ModelHost` doğrudan; sunucu/port yok): olgu alanları modelden gelir, tanılar modelin davranışına uyar."""

    WEEKS = 30
    worlds: list = []

    @classmethod
    def setUpClass(cls):
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), {"TRANS_SUPPORT": 2}, weeks=cls.WEEKS)
        try:
            cls.worlds = [extract_world({**h.step(), **h.facts()}) for _ in range(cls.WEEKS)]
        finally:
            h.close()

    def test_facts_come_from_model(self):
        w = self.worlds
        self.assertEqual(w[0]["policy_rate"], NEUT)
        self.assertIsNone(w[0]["policy_unemployment"])                       # kural ilk haftada işsizlik görmedi
        self.assertTrue(all(0 < x["policy_unemployment"] < 1 for x in w[2:]))
        self.assertGreater(max(x["policy_rate"] for x in w[:20]), 0.007)      # kredi/mevduat terimi faizi yükseltiyor (policy.py:97); zirve ~15. hafta (v13.2 dünyasında zirve 0,0072, 16. haftada 0,0069)
        self.assertEqual([x["support_denied"] for x in w], [0] * self.WEEKS)  # destek yalnız 27. haftada başlar, red yok
        self.assertEqual([x["support_weekly"] for x in w[:26]], [0] * 26)
        self.assertGreater(w[26]["support_weekly"], 0)
        self.assertEqual([x["city_spend_cut"] for x in w], [0] * self.WEEKS)

    def test_no_support_alarm_in_opening_period(self):
        v = {"gecis_destegi": "kurtarma_fonuyla"}
        for n in range(1, self.WEEKS + 1):
            self.assertNotIn("destek_yok", ids(dg.evaluate(self.worlds[:n], v, REG)), n)

    def test_rate_diag_when_unemployment_above_normal_and_rate_not_below_neutral(self):
        rules = [dict(r, when=[dict(c, esik=0.02) if c["alan"] == "policy_unemployment" else c for c in r["when"]])
                 for r in dg.load_rules() if r["id"] == "faiz_dusmuyor"]
        for r in rules:
            for c in r["when"]:
                c.pop("esik_param", None) if "esik" in c else None
        v = {"faiz_kurali": "kural"}
        first = next(n for n in range(1, self.WEEKS + 1) if dg.evaluate(self.worlds[:n], v, REG, rules=rules))
        self.assertEqual(first, 15)                                           # 3. haftadan beri (işsizlik ilk iki haftada ölçülmez) ardışık 13 hafta; eşik %2: v13.2 dünyasında işsizlik %2,5-6
        # varsayılan normal (%25) altında işsizlik: kural doğru yönde yükseltiyor, tanı yok
        self.assertEqual(dg.evaluate(self.worlds, v, REG), [])


if __name__ == "__main__":
    unittest.main()
