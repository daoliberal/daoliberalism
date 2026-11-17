"""R2: `apply` sınıflama aracı ve sonuçları (DK-6, DK-17, inceleme I3)."""
from __future__ import annotations

import glob
import json
import math
import unittest
from pathlib import Path

import tools_classify_apply as T
from oyun_server import config
from oyun_server.registry import defaults
from oyun_server.sim import livepatch

ARAYUZ = Path(__file__).resolve().parents[2]
REG = ARAYUZ / "registry"
EVIDENCE = json.loads((REG / "apply_classes.json").read_text(encoding="utf-8")) if (REG / "apply_classes.json").is_file() else None


def all_cards():
    out = []
    for f in sorted(glob.glob(str(REG / "settings.*.json"))):
        out += json.loads(Path(f).read_text(encoding="utf-8"))["settings"]
    return out


def fake_runner(equal: bool, effect: bool = True, w_extra: dict | None = None):
    """Sentetik koşucu: taban satırları r0; Params(KEY=v) satırları r1 (etki varsa); yamalı koşu eşitse r1, değilse r2."""
    def run(spec):
        weeks = spec["weeks"]
        base = ["r0"] * weeks
        if spec.get("patch") is None and not any(k.startswith("KEY") for k in spec["build"]):
            return {"rows": base, "fp": {"params": {}, "w": {}}}
        if spec.get("patch") is None:
            return {"rows": ["r1"] * weeks if effect else base, "fp": {"params": {}, "w": dict(w_extra or {})}}
        return {"rows": ["r1" if equal else "r2"] * weeks, "fp": None}
    return run


class SentetikSinif(unittest.TestCase):
    def test_equal_at_week0_means_live(self):
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=fake_runner(True), sources={})
        self.assertEqual((r["class"], r["equal_at_week0"], r["reason"]), ("live", True, None))

    def test_derived_diff_in_fingerprint_forces_start_only(self):
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=fake_runner(False, w_extra={"MM": "9"}), sources={})
        self.assertEqual((r["class"], r["reason"]), ("start_only", "turetim"))
        self.assertEqual(r["derived_diff"], ["W.MM"])

    def test_no_effect_is_start_only(self):
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=fake_runner(True, effect=False), sources={})
        self.assertEqual((r["class"], r["reason"]), ("start_only", "etki_olculemedi"))


class AstTarama(unittest.TestCase):
    def test_ast_module_level_detects(self):
        hits = T.ast_scan("KEY", {"fake.m": "KEY = 1\nX0 = KEY * 2\ndef f():\n    return KEY\n"})
        self.assertEqual([(h["kind"], h["line"]) for h in hits], [("modul_duzeyi", 2)])

    def test_ast_default_arg_detects(self):
        hits = T.ast_scan("KEY", {"fake.m": "def g(a=KEY, *,\n      b=KEY + 1):\n    return a\n"})
        self.assertEqual({h["kind"] for h in hits}, {"varsayilan_arg"})
        self.assertEqual(len(hits), 2)

    def test_init_time_read_detected(self):
        src = ("class L:\n    def __init__(self):\n        self.cexp = {} if (KEY or Z) else None\n\n"
               "def new_world(a):\n    return L()\n\ndef week_step(W):\n    return KEY\n")
        hits = T.ast_scan("KEY", {"fake.m": src})
        self.assertEqual([(h["kind"], h["line"]) for h in hits], [("kurulus_okuma", 3)])
        r = T.classify("KEY", {}, value=2, trials=[(2, 40)], runner=fake_runner(False), sources={"fake.m": src})
        self.assertEqual((r["class"], r["reason"]), ("start_only", "kurulus_okuma"))

    def test_w_copy_detected(self):
        src = "def new_world(a):\n    W.TAXV = [KEY]\n    return W\n"
        hits = T.ast_scan("KEY", {"fake.m": src})
        self.assertEqual([h["kind"] for h in hits], ["w_kopya"])

    def test_real_ledger_cexp_for_treasury_rule(self):
        hits = T.ast_scan("TREASURY_RULE", T.read_sources())
        self.assertTrue(any(h["module"].endswith("ledger") and h["kind"] == "kurulus_okuma" for h in hits), hits)


class DerinParmakIzi(unittest.TestCase):
    def test_deep_w_fingerprint_detects_nested_copy(self):
        class Sub:
            def __init__(self, v):
                self.cexp = v

        class WW:
            def __init__(self, v):
                self.L = Sub(v)
                self.n = 1

        a, b = T.deep_w_fingerprint(WW({})), T.deep_w_fingerprint(WW(None))
        self.assertNotEqual(a, b)
        self.assertIn("L.cexp", {k for k in a if a.get(k) != b.get(k)})


def window_runner(effect_at: int, diverge_at: int | None, calls: list):
    """Etki `effect_at`. haftada başlar; yamalı koşu `diverge_at`. haftada trial'dan ayrışır (None: hiç)."""
    def run(spec):
        weeks = spec["weeks"]
        calls.append((("patch" if spec.get("patch") is not None else "build"), weeks))
        if spec.get("patch") is None and not any(k.startswith("KEY") for k in spec["build"]):
            return {"rows": ["r0"] * weeks, "fp": {"params": {}, "w": {}}}
        rows = ["r0"] * (effect_at - 1) + ["r1"] * (weeks - effect_at + 1)
        if spec.get("patch") is not None and spec.get("patch_week", 0) != 0:
            return {"rows": ["r0"] * weeks, "fp": None}              # hafta 20 yaması: ıraksama (d) dalı etkisiz
        if spec.get("patch") is None:
            return {"rows": rows, "fp": {"params": {}, "w": {}}}
        if diverge_at is not None:
            rows = rows[:diverge_at - 1] + ["r2"] * max(0, weeks - diverge_at + 1)
        return {"rows": rows[:weeks], "fp": None}
    return run


class EsitlikPenceresi(unittest.TestCase):
    def test_equality_must_hold_20_weeks_after_effect(self):
        calls = []
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=window_runner(40, 45, calls), sources={})
        self.assertEqual((r["class"], r["reason"]), ("start_only", "etki_olculemedi"), r)
        self.assertEqual(r["diverged_week"], 45)
        self.assertGreaterEqual(max(w for _, w in calls), 60)

    def test_equality_horizon_is_extended_past_100(self):
        calls = []
        r = T.classify("KEY1", {}, value=2, trials=[(2, 100)], runner=window_runner(93, None, calls), sources={})
        self.assertEqual(r["class"], "live", r)
        self.assertGreaterEqual(max(w for _, w in calls), 113)
        self.assertEqual(r["context"]["eq_weeks"], 113)

    def test_early_effect_keeps_short_window(self):
        calls = []
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=window_runner(5, None, calls), sources={})
        self.assertEqual(r["class"], "live")
        self.assertEqual(max(w for _, w in calls), 40)


class EsitDalTurevlik(unittest.TestCase):
    def test_derived_diff_blocks_live_even_when_equal(self):
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=fake_runner(True, w_extra={"MM": "9"}), sources={})
        self.assertEqual((r["class"], r["reason"]), ("start_only", "turetim"), r)
        self.assertEqual(r["derived_diff"], ["W.MM"])
        self.assertTrue(r["equal_at_week0"])

    def test_module_level_ast_blocks_live_even_when_equal(self):
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=fake_runner(True), sources={"fake.m": "X0 = KEY1 * 2\n"})
        self.assertEqual((r["class"], r["reason"]), ("start_only", "modul_duzeyi"), r)

    def test_clean_equal_is_live_and_records_empty_derived_diff(self):
        r = T.classify("KEY1", {}, value=2, trials=[(2, 40)], runner=fake_runner(True), sources={})
        self.assertEqual((r["class"], r["derived_diff"]), ("live", []))


def sfc_runner(sfc_ok_ileri=True, sfc_ok_ters=True, calls=None):
    def run(spec):
        if calls is not None:
            calls.append(spec)
        ters = spec["build"].get("KEY1") is not None
        ok = sfc_ok_ters if ters else sfc_ok_ileri
        return {"rows": ["r"] * spec["weeks"], "sfc": {"ok": ok, "week": None if ok else 61, "gap": 0.0}}
    return run


class YapisalGecis(unittest.TestCase):
    def test_both_directions_run_with_open_20_close_60(self):
        calls = []
        r = T.structural_check("KEY1", {"CTX": 1}, 1, 0, runner=sfc_runner(calls=calls))
        self.assertTrue(r["ok"])
        self.assertEqual(len(calls), 2)
        ileri, ters = calls
        self.assertEqual(ileri["patches"], [[20, {"KEY1": 1}], [60, {"KEY1": 0}]])
        self.assertEqual(ters["patches"], [[20, {"KEY1": 0}], [60, {"KEY1": 1}]])
        self.assertEqual(ters["build"], {"CTX": 1, "KEY1": 1})
        self.assertTrue(ileri["sfc"] and ters["sfc"] and ileri["weeks"] == 100)

    def test_sfc_violation_in_reverse_direction_fails(self):
        r = T.structural_check("KEY1", {}, 1, 0, runner=sfc_runner(sfc_ok_ters=False))
        self.assertFalse(r["ok"])
        self.assertTrue(r["runs"]["ileri"]["ok"] and not r["runs"]["ters"]["ok"])
        self.assertEqual(r["runs"]["ters"]["sfc_week"], 61)

    def test_model_error_fails(self):
        r = T.structural_check("KEY1", {}, 1, 0, runner=lambda spec: {"error": "KeyError: x"})
        self.assertFalse(r["ok"])

    def test_is_structural_codecs(self):
        self.assertTrue(T.is_structural({"type": "bool", "on": 1, "off": 0}))
        self.assertTrue(T.is_structural({"type": "enum", "map": {"var": 0, "yok": 1}}))
        self.assertFalse(T.is_structural({"type": "enum", "map": {"a": 13, "b": 26, "c": 52, "d": 104, "e": 9999}}))
        self.assertFalse(T.is_structural({"type": "number", "scale": 1, "min": 0, "max": 1}))

    def test_multivalued_enum_flags_are_structural(self):
        """N3: ORDER_BOOK {0,1,2}, TRANS_SUPPORT {0,1,2}, SB_ENTRY_PERSIST {-1, 0.02} gibi çok değerli kural/modül enumları da yapısal."""
        self.assertTrue(T.is_structural({"type": "enum", "map": {"a": 0, "b": 1, "c": 2}}))
        self.assertTrue(T.is_structural({"type": "enum", "map": {"yok": -1, "var": 0.02}}))
        self.assertFalse(T.is_structural({"type": "enum", "map": {"a": 13, "b": 26, "c": 52, "d": 104, "e": 9999}}))   # süre/büyüklük basamakları
        self.assertFalse(T.is_structural({"type": "number", "scale": 1, "min": 0, "max": 1}))

    def test_real_codecs_of_named_keys(self):
        cards = {p: codec for c in all_cards() if c["status"] == "active" and c.get("editable") for p, codec in T.card_fields(c)}
        for k in ("ORDER_BOOK", "TRANS_SUPPORT", "SB_ENTRY_PERSIST"):
            self.assertIn(k, cards, k)
            self.assertTrue(T.is_structural(cards[k]), k)

    def test_structural_values_covers_every_non_default_value(self):
        """Çok değerli enumda her varsayılan-dışı değer için iki yönlü geçiş (ORDER_BOOK 0<->1, 0<->2); biri geçmezse hepsi geçmez."""
        calls = []
        r = T.structural_values("KEY1", {}, [1, 2], 0, runner=sfc_runner(calls=calls))
        self.assertTrue(r["ok"])
        self.assertEqual(len(calls), 4)
        self.assertEqual(sorted(r["by_value"]), ["1", "2"])
        bad = T.structural_values("KEY1", {}, [1, 2], 0, runner=sfc_runner(sfc_ok_ters=False))
        self.assertFalse(bad["ok"])

    def test_real_child_sfc_flag_present(self):
        """Gerçek alt süreç koşusu: kısa yamalı koşuda sfc alanı döner ve para korunur."""
        r = T.run_spec({"build": {}, "weeks": 3, "sfc": True, "patches": [[1, {"TAX_RULE": 1}], [2, {"TAX_RULE": 0}]]})
        self.assertNotIn("error", r, r)
        self.assertTrue(r["sfc"]["ok"], r)


class DenemeDegerleri(unittest.TestCase):
    def test_both_ends_are_tried(self):
        """N1 kök neden: yalnız uzak uç denenirdi; alt eşikte bağlayan (kasa tamponu) parametrelerin etkisi görünmüyordu."""
        codec = {"type": "number", "scale": 1, "min": 8, "max": 52, "step": 1, "integer": True}
        v = T.trial_values(codec, 26)
        self.assertEqual(v[:2], [27, 25])
        self.assertIn(52, v)
        self.assertIn(8, v)

    def test_no_duplicate_or_default_trials(self):
        codec = {"type": "number", "scale": 1, "min": 0, "max": 2, "step": 1, "integer": True}
        v = T.trial_values(codec, 1)
        self.assertEqual(sorted(v), [0, 2])


class Baglam(unittest.TestCase):
    def _ctx(self, card_id, param):
        cards = all_cards()
        by = {c["id"]: c for c in cards}
        dfl = defaults.read_param_defaults(str(config.MODEL_ROOT))
        return T.card_ctx(by[card_id], dfl, param, by)

    def test_requires_foreign_flag_is_turned_on(self):
        # N1: genç firmalar girişle doğar: YOUNG_KIT bağlamı ENTRY_OPEN'ı da açar (yoksa etki görülmez)
        self.assertEqual(self._ctx("kredi_dayanma", "YK_RUNWAY_WEEKS"), {"YOUNG_KIT": 1, "ENTRY_OPEN": 1})

    def test_effective_when_other_card_state_is_applied(self):
        self.assertEqual(self._ctx("kurma_egilimi", "EO_RATE"), {"ENTRY_OPEN": 1})
        self.assertEqual(self._ctx("genc_kurucu_verimi", "EO_SKILL"), {"ENTRY_OPEN": 1})
        self.assertEqual(self._ctx("genc_firma_davranisi", "YK_HIRE_MAX"), {"YOUNG_KIT": 1, "ENTRY_OPEN": 1})
        self.assertEqual(self._ctx("girisimci_dalgasi", "EO_COHORT_PER").get("ENTRY_OPEN"), 1)

    def test_own_params_in_requires_do_not_enter_context(self):
        self.assertEqual(self._ctx("kurma_egilimi", "EO_RATE").get("EO_RATE"), None)
        self.assertEqual(self._ctx("issizlik_odenegi", "BENEFIT_WEEKS"), {})


    def test_subfield_tested_with_parent_flag_on(self):
        card = next(c for c in all_cards() if c["id"] == "kredi_para")
        dfl = {"CREDIT_MONEY": 0, "CM_RESERVE": 0.08, "CM_BRAKE": 0.1, "CM_PD": 0}
        self.assertEqual(T.card_ctx(card, dfl, "CM_RESERVE", {}), {"CREDIT_MONEY": 1})
        self.assertEqual(T.card_ctx(card, dfl, "CREDIT_MONEY", {}), {})

    @unittest.skipIf(EVIDENCE is None, "apply_classes.json yok")
    def test_subfield_evidence_context(self):
        self.assertEqual(EVIDENCE["keys"]["CM_RESERVE"]["context"]["ctx"].get("CREDIT_MONEY"), 1)


class SunucuIkinciKapi(unittest.TestCase):
    """Important 4: config._bench_derived() apply_classes.json'u da okur (kayıt elle live'a çevrilse bile kapı tutar)."""
    def _with_file(self, payload):
        import tempfile
        d = tempfile.mkdtemp()
        p = Path(d) / "apply_classes.json"
        p.write_text(json.dumps(payload), encoding="utf-8")
        old = config.APPLY_CLASSES
        config.APPLY_CLASSES = p
        config._bench_derived.cache_clear()
        self.addCleanup(lambda: (setattr(config, "APPLY_CLASSES", old), config._bench_derived.cache_clear()))

    def test_derived_and_reason_keys_join_second_gate(self):
        self._with_file({"keys": {
            "AAA": {"class": "live", "reason": None, "derived_diff": ["W.X"]},
            "BBB": {"class": "start_only", "reason": "turetim", "derived_diff": []},
            "CCC": {"class": "start_only", "reason": "w_kopya", "derived_diff": []},
            "DDD": {"class": "start_only", "reason": "modul_duzeyi", "derived_diff": []},
            "EEE": {"class": "start_only", "reason": "etki_olculemedi", "derived_diff": []},
            "FFF": {"class": "live", "reason": None, "derived_diff": []}}})
        got = config.derived_diff_keys()
        self.assertTrue({"AAA", "BBB", "CCC", "DDD"} <= got, got)
        self.assertFalse({"EEE", "FFF"} & got)
        self.assertIn("SALES_TAX", got)

    def _point_to(self, path):
        old = config.APPLY_CLASSES
        config.APPLY_CLASSES = Path(path)
        config._bench_derived.cache_clear()
        self.addCleanup(lambda: (setattr(config, "APPLY_CLASSES", old), config._bench_derived.cache_clear()))

    def test_missing_apply_classes_is_loud(self):
        """N2: kanıt dosyası okunamazsa sessiz boş küme yok: açık hata (kapalı başarısızlık), sunucu açılışında da."""
        self._point_to("/nonexistent/apply_classes.json")
        with self.assertRaises(RuntimeError):
            config.derived_diff_keys()
        with self.assertRaises(RuntimeError):
            config.live_keys_from_registry(type("R", (), {"settings": [type("C", (), {"apply": "live", "params": ["X"]})()]})())

    def test_corrupt_apply_classes_is_loud(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            fh.write("{not json")
        self.addCleanup(lambda: Path(fh.name).unlink(missing_ok=True))
        self._point_to(fh.name)
        with self.assertRaises(RuntimeError):
            config.derived_diff_keys()

    def test_host_patch_rejects_when_gate_unreadable(self):
        """Kapı okunamıyorsa ModelHost.patch tüm yamaları reddeder (ValueError), çökmez."""
        from oyun_server.sim import host as H
        self._point_to("/nonexistent/apply_classes.json")
        h = H.ModelHost.__new__(H.ModelHost)
        h._check_open = lambda: None
        h._mods = {livepatch.PARAMS_MODULE: type("M", (), {"__dict__": {"CORP_TAX": 0.2}})()}
        h._live_keys = frozenset({"CORP_TAX"})
        with self.assertRaises(ValueError):
            h.patch({"CORP_TAX": 0.3})

    @unittest.skipIf(EVIDENCE is None, "apply_classes.json yok")
    def test_real_evidence_blocked_keys_all_in_gate(self):
        want = {k for k, v in EVIDENCE["keys"].items() if v["derived_diff"] or v["reason"] in ("turetim", "w_kopya", "modul_duzeyi")}
        self.assertTrue(want)
        self.assertTrue(want - set(livepatch.W_SYNC) <= config.derived_diff_keys())


class ProvenKeys(unittest.TestCase):
    def test_unreadable_bench_file_is_loud(self):
        old = T.C.RESULTS
        T.C.RESULTS = "/nonexistent/bench-sonuc.json"
        self.addCleanup(lambda: setattr(T.C, "RESULTS", old))
        with self.assertRaises(RuntimeError):
            T.proven_keys()


@unittest.skipIf(EVIDENCE is None, "apply_classes.json yok")
class Sonuclar(unittest.TestCase):
    def test_all_active_editable_classified(self):
        bad = [c["id"] for c in all_cards() if c["status"] == "active" and c.get("editable") and c["apply"] not in ("live", "live_sync", "start_only")]
        self.assertEqual(bad, [])

    def test_registry_apply_equals_evidence(self):
        for c in all_cards():
            if c["id"] in EVIDENCE["cards"]:
                self.assertEqual(c["apply"], EVIDENCE["cards"][c["id"]], c["id"])
        self.assertTrue(EVIDENCE["cards"])

    def test_live_sync_keys_have_w_sync(self):
        for k, v in EVIDENCE["keys"].items():
            if v["class"] == "live_sync":
                self.assertIn(k, livepatch.W_SYNC, k)

    def test_mvp_keys_unchanged(self):
        for k in ("TRANS_SUPPORT", "WAGE_TAX", "CORP_TAX"):
            self.assertEqual(EVIDENCE["keys"][k]["class"], "live", k)

    def test_sales_tax_derived(self):
        v = EVIDENCE["keys"]["SALES_TAX"]
        self.assertEqual((v["class"], v["reason"]), ("start_only", "turetim"))

    def test_apply_classes_hash_matches_defaults(self):
        d = defaults.read_param_defaults(str(config.MODEL_ROOT))
        self.assertEqual(EVIDENCE["model_defaults_hash"], defaults.defaults_hash(d))

    def test_flags_with_import_time_derivation_start_only(self):
        notes = json.loads((REG / "r2_apply_notlari.json").read_text(encoding="utf-8"))["start_only"]
        self.assertGreaterEqual(len(notes), 13)
        for n in (n for n in notes if n["param"] in EVIDENCE["keys"]):       # DEP_ON'un kartı yok (pasif/yok)
            self.assertEqual(EVIDENCE["keys"][n["param"]]["class"], "start_only", n["param"])
        for k in ("TREASURY_RULE", "PROFIT_KEEP"):
            self.assertEqual(EVIDENCE["keys"][k]["class"], "start_only")

    def test_card_class_is_most_restrictive(self):
        rank = {"live": 0, "live_sync": 1, "start_only": 2}
        for c in all_cards():
            if c["id"] in EVIDENCE["cards"]:
                got = max((EVIDENCE["keys"][p]["class"] for p in c["params"] if p in EVIDENCE["keys"]), key=rank.get)
                if c["id"] in T.CARD_LOCKS:
                    got = "start_only"                    # kart kimliğine bağlı elle kilit gevşetilmez
                self.assertEqual(EVIDENCE["cards"][c["id"]], got, c["id"])

    def test_card_reasons_explain_manual_lock(self):
        self.assertIn("zararda_once_kucul", EVIDENCE["card_reasons"])
        self.assertIn("SHRINK_FIRST", EVIDENCE["card_reasons"]["zararda_once_kucul"])

    def test_live_keys_equal_live_card_params_minus_gate(self):
        live_params = {p for c in all_cards() if EVIDENCE["cards"].get(c["id"]) == "live" for p in c["params"]}
        derived = config.derived_diff_keys()
        reg = {p for c in all_cards() if c["apply"] in ("live", "live_sync") for p in c["params"]} - derived
        self.assertTrue(live_params - derived <= reg)

    def test_every_live_key_has_clean_derived_diff_and_no_blocking_ast(self):
        for k, v in EVIDENCE["keys"].items():
            if v["class"] == "live":
                self.assertEqual(v["derived_diff"], [], k)
                self.assertFalse([h for h in v["ast_hits"] if h["kind"] in ("modul_duzeyi", "varsayilan_arg")], k)

    def test_every_class_has_reason_unless_live(self):
        for k, v in EVIDENCE["keys"].items():
            self.assertEqual(v["reason"] is None, v["class"] != "start_only", k)


def meas_runner(a_shift: float, b_shift: float, calls: list | None = None, names=("talep_karsilama", "sehir_kasasi")):
    """Sentetik ölçü koşucusu: varsayılan seri sabit 100; baştan değişim (build) `a_shift`, hafta ortası yama `b_shift` bağıl kayma yapar."""
    def run(spec):
        if calls is not None:
            calls.append(spec)
        weeks = spec["weeks"]
        if spec.get("patch") is not None:
            pw = spec["patch_week"]
            ser = [100.0] * pw + [100.0 * (1 + b_shift)] * (weeks - pw)
        elif any(k.startswith("KEY") for k in spec["build"]):
            ser = [100.0 * (1 + a_shift)] * weeks
        else:
            ser = [100.0] * weeks
        return {"meas": {n: list(ser) for n in names}}
    return run


class YonTutarliligi(unittest.TestCase):
    def test_runs_default_scratch_and_midrun(self):
        calls = []
        T.direction_check("KEY1", {"CTX": 1}, 5, runner=meas_runner(0.1, 0.1, calls))
        self.assertEqual(len(calls), 3)
        kinds = sorted(("patch" if c.get("patch") is not None else "build", c["weeks"], bool(c.get("meas"))) for c in calls)
        self.assertEqual(kinds, [("build", T.DIR_WEEKS, True), ("build", T.DIR_WEEKS, True), ("patch", T.DIR_WEEKS, True)])
        patch = [c for c in calls if c.get("patch") is not None][0]
        self.assertEqual((patch["patch"], patch["patch_week"]), ({"KEY1": 5}, T.DIR_PATCH_WEEK))

    def test_opposite_sign_is_reversed(self):
        r = T.direction_check("KEY1", {}, 5, runner=meas_runner(+0.2, -0.2))
        self.assertTrue(r["ters"])
        self.assertEqual(sorted(r["ters_olcu"]), ["sehir_kasasi", "talep_karsilama"])

    def test_same_sign_is_consistent(self):
        self.assertFalse(T.direction_check("KEY1", {}, 5, runner=meas_runner(+0.2, +0.05))["ters"])
        self.assertFalse(T.direction_check("KEY1", {}, 5, runner=meas_runner(-0.2, -0.3))["ters"])

    def test_below_tolerance_is_noise(self):
        tiny = T.DIR_TOL / 4
        self.assertFalse(T.direction_check("KEY1", {}, 5, runner=meas_runner(+0.2, -tiny))["ters"])
        self.assertFalse(T.direction_check("KEY1", {}, 5, runner=meas_runner(+tiny, -0.2))["ters"])

    def test_no_effect_midrun_skips_scratch_run(self):
        calls = []
        r = T.direction_check("KEY1", {}, 5, runner=meas_runner(0.2, 0.0, calls))
        self.assertFalse(r["ters"])
        self.assertEqual(len(calls), 2)                    # taban + hafta ortası; hafta ortası etkisizse baştan koşu gerekmez

    def test_error_is_not_silent_pass(self):
        r = T.direction_check("KEY1", {}, 5, runner=lambda spec: {"error": "KeyError: x"})
        self.assertTrue(r["ters"] is False and r["error"])

    # E0 (R2-ek2 M2): ölçülemeyen etki "anlamlı değil" sayılıp live bırakılmaz; güvenli taraf = o anahtar start_only / etki_olculemedi.
    def _shaped(self, mid_series, names=("talep_karsilama", "sehir_kasasi"), base_value=100.0):
        def run(spec):
            weeks = spec["weeks"]
            if spec.get("patch") is not None:
                return {"meas": {n: list(mid_series(weeks, spec["patch_week"])) if n == names[0] else [base_value] * weeks for n in names}}
            return {"meas": {n: [base_value] * weeks for n in names}}
        return run

    def test_effect_helper_flags_unmeasurable(self):
        self.assertIsNone(T._effect([100.0] * 10 + [math.nan] * 30, [100.0] * 40, 11))             # NaN: ölçülemez
        self.assertIsNone(T._effect([100.0] * 10 + [math.inf] * 30, [100.0] * 40, 11))
        self.assertIsNone(T._effect([0.0] * 10 + [5.0] * 30, [0.0] * 40, 11))                      # taban ölçeği 0, deneme oynuyor: bağıl fark tanımsız
        self.assertIsNone(T._effect([100.0] * 5, [100.0] * 5, 21))                                 # pencere yok (kısa seri)
        self.assertEqual(T._effect([0.0] * 40, [0.0] * 40, 11), 0.0)                               # ikisi de gerçekten 0: etki yok, ölçülebilir
        self.assertEqual(T._effect([100.0] * 40, [100.0] * 40, 11), 0.0)
        self.assertGreater(T._effect([100.0] * 10 + [130.0] * 30, [100.0] * 40, 11), 0.2)

    def test_nan_series_is_not_silent_live(self):
        run = self._shaped(lambda weeks, pw: [100.0] * pw + [math.nan] * (weeks - pw))
        r = T.direction_check("KEY1", {}, 5, runner=run)
        self.assertFalse(r["ters"])
        self.assertTrue(r.get("error"), r)                         # hata yoluna düşer: classify_job start_only / etki_olculemedi yapar
        self.assertIn("talep_karsilama", r["olculemedi"])

    def test_zero_scale_with_deviation_is_not_silent_live(self):
        def run(spec):
            weeks = spec["weeks"]
            if spec.get("patch") is not None:
                return {"meas": {"talep_karsilama": [0.0] * spec["patch_week"] + [3.0] * (weeks - spec["patch_week"])}}
            return {"meas": {"talep_karsilama": [0.0] * weeks}}
        r = T.direction_check("KEY1", {}, 5, runner=run)
        self.assertTrue(r.get("error"), r)

    def test_zero_scale_without_deviation_is_still_fine(self):
        calls = []
        def run(spec):
            calls.append(spec)
            weeks = spec["weeks"]
            if spec.get("patch") is not None and spec["patch_week"]:
                return {"meas": {"basim_izni": [0.0] * weeks, "talep_karsilama": [100.0] * weeks}}
            return {"meas": {"basim_izni": [0.0] * weeks, "talep_karsilama": [100.0] * weeks}}
        r = T.direction_check("KEY1", {}, 5, runner=run)
        self.assertEqual((r["ters"], r.get("error")), (False, None))

    def test_direction_audit_propagates_unmeasurable(self):
        run = self._shaped(lambda weeks, pw: [100.0] * pw + [math.nan] * (weeks - pw))
        r = T.direction_audit("KEY1", {}, [1, 7], runner=run)
        self.assertTrue(r["error"])

    def test_classify_job_nan_is_start_only(self):
        """Uçtan uca: ölçü NaN ise sayı anahtarı live kalmaz, `etki_olculemedi` ile start_only olur."""
        run = self._shaped(lambda weeks, pw: [100.0] * pw + [math.nan] * (weeks - pw))
        saved = (T.classify, T.run_spec, T.trial_values, T.plan_trials)
        T.classify = lambda *a, **k: {"class": "live", "reason": None, "context": {}}
        T.run_spec, T.trial_values, T.plan_trials = run, (lambda codec, d: [1, 7]), (lambda vals: [])
        try:
            r = T.classify_job(("KEY1", {}, ["kart"], {"type": "number"}), {"KEY1": 3}, {}, {})
        finally:
            T.classify, T.run_spec, T.trial_values, T.plan_trials = saved
        self.assertEqual((r["class"], r["reason"]), ("start_only", "etki_olculemedi"))

    def test_audit_values_are_the_two_ends(self):
        self.assertEqual(T.audit_values([14, 12, 26, 0]), [26, 0])
        self.assertEqual(T.audit_values([1]), [1])

    def test_direction_audit_reports_any_reversed_value(self):
        def run(spec):
            rev = spec.get("patch") is not None and spec["patch"]["KEY1"] == 7
            return meas_runner(0.2, -0.2 if rev else 0.2)(spec)
        r = T.direction_audit("KEY1", {}, [1, 7], runner=run)
        self.assertTrue(r["ters"])
        self.assertEqual(r["by_value"]["7"]["ters"], True)
        self.assertEqual(r["by_value"]["1"]["ters"], False)

    def test_real_child_returns_measures(self):
        r = T.run_spec({"build": {}, "weeks": 2, "meas": True})
        self.assertNotIn("error", r, r)
        self.assertEqual(sorted(r["meas"]), sorted(T.MEASURES))
        self.assertTrue(all(len(v) == 2 for v in r["meas"].values()))


class AnahtarKilidi(unittest.TestCase):
    def test_lock_table(self):
        self.assertEqual(sorted(T.KEY_LOCKS), ["MINT_OPEN_WEEKS", "PATENT_TERM"])
        self.assertIn("cap_on", T.KEY_LOCKS["MINT_OPEN_WEEKS"])
        self.assertIn("front_hist", T.KEY_LOCKS["PATENT_TERM"])

    def test_locked_keys_are_in_second_gate_reasons(self):
        self.assertTrue({"anahtar_kilidi", "yon_ters"} <= config.DERIVED_REASONS)

    @unittest.skipIf(EVIDENCE is None, "apply_classes.json yok")
    def test_evidence_locks(self):
        for k in ("MINT_OPEN_WEEKS", "PATENT_TERM"):
            v = EVIDENCE["keys"][k]
            self.assertEqual((v["class"], v["reason"]), ("start_only", "anahtar_kilidi"), k)
            self.assertIn(k, config.derived_diff_keys())
        for cid in ("acilis_donemi", "patent_suresi"):
            self.assertEqual(EVIDENCE["cards"][cid], "start_only", cid)

    @unittest.skipIf(EVIDENCE is None, "apply_classes.json yok")
    def test_direction_audit_catches_mint_open_weeks(self):
        """Denetimin doğruluk testi: incelemecinin elle bulduğu MINT_OPEN_WEEKS ters etkisi (cap_on mandalı) denetimde de görünür."""
        yon = EVIDENCE["keys"]["MINT_OPEN_WEEKS"]["context"]["yon"]
        self.assertTrue(yon["ters"], yon)

    @unittest.skipIf(EVIDENCE is None, "apply_classes.json yok")
    def test_no_live_numeric_key_is_reversed(self):
        for k, v in EVIDENCE["keys"].items():
            yon = v["context"].get("yon")
            if v["class"] == "live" and yon:
                self.assertFalse(yon["ters"], k)
            if v["reason"] == "yon_ters":
                self.assertTrue(yon["ters"], k)

    @unittest.skipIf(EVIDENCE is None, "apply_classes.json yok")
    def test_every_live_numeric_key_was_audited(self):
        codecs = {p: codec for c in all_cards() if c["status"] == "active" and c.get("editable") for p, codec in T.card_fields(c)}
        for k, v in EVIDENCE["keys"].items():
            if v["class"] == "live" and codecs.get(k, {}).get("type") == "number":
                self.assertIn("yon", v["context"], k)


class AralikKurali(unittest.TestCase):
    def test_fee_range_rule_present_and_ordered_fields(self):
        """M1: lonca aidatında en az > en çok seçilebiliyordu: `artan` kuralı kartın iki alanını sıralı ister ve metni var."""
        rules = {r["id"]: r for r in json.loads((REG / "tutarlilik.json").read_text(encoding="utf-8"))["rules"]}
        self.assertEqual(rules["aralik_lonca_aidat"]["artan"], {"kart": "lonca_aidat_araligi", "alanlar": ["en_az", "en_cok"]})
        text = json.loads((REG / "metinler.tr.json").read_text(encoding="utf-8"))["_uyarilar"]["aralik_lonca_aidat"]
        self.assertIn("üst sınır", text)
        card = next(c for c in all_cards() if c["id"] == "lonca_aidat_araligi")
        self.assertEqual([f["key"] for f in card["codec"]["fields"]], ["en_az", "en_cok"])


if __name__ == "__main__":
    unittest.main()
