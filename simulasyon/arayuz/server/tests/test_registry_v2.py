"""K1: kayıt şeması v2 (yeni alanlar, dayanaklar, ölçüm bağlamı, kamusal çıktı, yayım, kapsam)."""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from oyun_server import config
from oyun_server.registry import codec, hints, loader
from oyun_server.registry.resolve import resolve
from oyun_server.registry.schema import RegistryError

from tests.registry_helpers import (EXAMPLE_CARDS, REAL_DIR, contract_registry, copy_data, example_defaults, read_json,
                                    real_defaults, real_registry, write_examples, write_json)

FIXTURES = Path(__file__).resolve().parent / "fixtures"
WRITE = bool(os.environ.get("OYUN_FIKSTUR_YAZ"))
sys.path.insert(0, str(REAL_DIR))
import yayinla                          # noqa: E402  (registry/yayinla.py)
sys.path.pop(0)

OYUNA_OZGU = "Bu oyuna özgü kural; hazır bir modelden alınmadı"


def pub_json(reg) -> str:
    return json.dumps(reg.public(), sort_keys=True, ensure_ascii=False, indent=1) + "\n"


def mutated(card_id, patch=None, text_patch=None, defaults=None):
    """Örnek kayıtta bir kartı değiştirip yüklemeyi dener; RegistryError fırlatabilir."""
    with tempfile.TemporaryDirectory() as td:
        d = copy_data(Path(td))
        write_examples(d)
        cards = json.loads(json.dumps(EXAMPLE_CARDS))
        for c in cards:
            if c["id"] == card_id:
                c.update(patch or {})
        write_json(d / "settings.zz_ornek.json", {"settings": cards})
        if text_patch is not None:
            t = read_json(d / "metinler.tr.json")
            t[card_id].update(text_patch)
            write_json(d / "metinler.tr.json", t)
        return loader.load_registry(d, defaults or example_defaults())


class BasisTests(unittest.TestCase):
    def test_basis_label_in_dayanaklar(self):
        day = read_json(REAL_DIR / "dayanaklar.json")
        self.assertEqual(day["oyuna_ozgu"], OYUNA_OZGU)
        labels = {OYUNA_OZGU} | {m["label"] for m in day["modeller"]}
        self.assertTrue({"Caiani ve ark. 2016", "BAM Engine", "BeforeIT", "Taylor kuralı"} <= labels)
        for m in day["modeller"]:
            self.assertTrue((config.REPO_ROOT / m["kaynak"]).is_file(), m)
        for reg in (real_registry(), contract_registry()):
            for s in reg.settings + reg.hidden:
                b = reg.texts[s.id].get("basis")
                if b:
                    self.assertIn(b["label"], labels, s.id)
        with self.assertRaises(RegistryError):                      # listede olmayan etiket yüklemeyi bozar
            mutated("ornek_tahvil", text_patch={"basis": {"label": "Havranek 2015"}})


class MeasuredTests(unittest.TestCase):
    def test_measured_fields_valid(self):
        reg = contract_registry()
        ids = {s.id for s in reg.settings + reg.hidden}
        seen = 0
        for s in reg.settings + reg.hidden:
            if s.measured_weeks is not None:
                self.assertIn(s.measured_weeks, (100, 200, 500), s.id)
            if s.measured_at is not None:
                seen += 1
                vals = reg.measured_values(s)
                self.assertTrue(vals, s.id)
                for v in vals:
                    codec.decode(s.codec, v, reg.seeds)
            for k, v in (s.measured_with or {}).items():
                if k == "_sablon":
                    self.assertIn(v, reg.templates)
                else:
                    self.assertIn(k, ids)
                    if k in reg.by_id:                  # gizli bağlam kartı (ornek_gizli) çözülmez: ipucu zaten gösterilmez
                        codec.decode(reg.by_id[k].codec, v, reg.seeds)
        self.assertGreaterEqual(seen, 3)
        by = reg.by_id
        self.assertEqual(reg.measured_values(by["ornek_sektorler"]), [["tarim", "sanayi"]])      # düz liste = tek alt küme
        self.assertEqual(reg.measured_values(by["ornek_oncelik"]), [["tarim"], ["tarim", "sanayi"]])
        self.assertEqual(reg.measured_values(by["ornek_faiz"]), [0.3])
        self.assertEqual(hints.MEASURED_WEEKS_DEFAULT, 200)

    def test_measured_fields_rejected_when_invalid(self):
        bad = [
            ("ornek_sektorler", {"measured_weeks": 150}), ("ornek_sektorler", {"measured_weeks": "200"}),
            ("ornek_sektorler", {"measured_at": ["yok"]}), ("ornek_sektorler", {"measured_at": []}),
            ("ornek_faiz", {"measured_at": 0.35}), ("ornek_faiz", {"measured_at": [0.3, 5]}),
            ("ornek_sektorler", {"measured_with": {"bilinmeyen_kart": 1}}),
            ("ornek_sektorler", {"measured_with": {"gecis_destegi": "yok"}}),
            ("ornek_sektorler", {"measured_with": {"_sablon": "yok_sablon"}}),
            ("ornek_sektorler", {"measured_with": {"_sablon": "dayanikli_taban", "gecis_destegi": "kapali"}}),
            ("ornek_sektorler", {"measured_with": {}}), ("ornek_sektorler", {"measured_with": ["x"]}),
            ("ornek_sektorler", {"hint_source": "/etc/passwd"}), ("ornek_sektorler", {"hint_source": "../x.md"}),
            ("ornek_sektorler", {"hint_source": ""}),
            ("ornek_sira", {"credit_type": "yok"}), ("ornek_sira", {"scenario_editable": "evet"}),
            ("ornek_sira", {"scenario_editable": True}),                     # yalnız V katmanı
            ("ornek_sira", {"actor": "uzaylı"}),
        ]
        for cid, patch in bad:
            with self.subTest(cid=cid, patch=patch), self.assertRaises(RegistryError):
                mutated(cid, patch)

    def test_hint_source_file_exists(self):
        n = 0
        for reg in (real_registry(), contract_registry()):
            for s in reg.settings + reg.hidden:
                if s.hint_source:
                    n += 1
                    self.assertTrue((config.REPO_ROOT / s.hint_source).is_file() or s.hint_source == "simulasyon/kararlar.md", f"{s.id}: {s.hint_source}")   # açık depoda kararlar.md bilerek yok (yalnız atıf)
        self.assertGreaterEqual(n, 2)


class ShowsTests(unittest.TestCase):
    """K1-ek: etkin salt okunur kart (`params` boş) ve `shows` (kartın gösterdiği, ayarı olmayan model değerleri)."""

    def test_empty_params_active_readonly_card_accepted(self):
        reg = contract_registry()
        s = reg.by_id["ornek_salt_okunur"]
        self.assertEqual((s.params, s.requires, s.editable, s.status), ((), (), False, "active"))
        self.assertEqual(resolve(reg, {"ornek_salt_okunur": True}).errors[0].reason, "locked")
        for patch in ({"editable": True}, {"status": "experimental"}):
            with self.subTest(patch=patch), self.assertRaises(RegistryError):
                mutated("ornek_salt_okunur", patch)
        mutated("ornek_salt_okunur", {"shows": None}, {"shows": None})     # shows isteğe bağlı
        with self.assertRaises(RegistryError):                            # satırsız kartta etiket kalamaz
            mutated("ornek_salt_okunur", {"shows": None})

    def test_shows_key_must_exist_in_model(self):
        with self.assertRaises(RegistryError) as cm:
            mutated("ornek_salt_okunur", {"shows": [{"key": "ORN_YOK_BOYLE"}]})
        self.assertIn("ORN_YOK_BOYLE", str(cm.exception))
        d = dict(example_defaults())
        del d["ORN_LIMIT"]
        with self.assertRaises(RegistryError):
            mutated("ornek_salt_okunur", defaults=d)

    def test_shows_string_param_rejected(self):
        d = dict(example_defaults(), ORN_LIMIT="on iki")
        with self.assertRaises(RegistryError) as cm:
            mutated("ornek_salt_okunur", defaults=d)
        self.assertIn("ORN_LIMIT", str(cm.exception))

    def test_shows_hidden_names_rejected(self):
        for name in ("PM_ADJ", "MODEL_PARAMS", "VERSION"):
            with self.subTest(name=name), self.assertRaises(RegistryError):
                mutated("ornek_salt_okunur", {"shows": [{"key": name}]}, {"shows": None},
                        defaults={**example_defaults(), name: 1})

    def test_shows_hidden_patterns_rejected(self):
        for name in ("CAPEX_CAL", "DBG_EVERY", "DEBUG_X", "KK_MEAS", "RB_SCALE", "ORN_MEAS", "FOO_CSV", "X_CAL"):
            with self.subTest(name=name), self.assertRaises(RegistryError):
                mutated("ornek_salt_okunur", {"shows": [{"key": name}]}, {"shows": None},
                        defaults={**example_defaults(), name: 3})
        mutated("ornek_salt_okunur", {"shows": [{"key": "TRANS_PRIV_OK"}]},
                {"shows": {"TRANS_PRIV_OK": "Geçiş"}}, defaults={**example_defaults(), "TRANS_PRIV_OK": 1})

    def test_shows_percent_unit_scale_consistent(self):
        for e in ({"unit": "yuzde"}, {"unit": "yuzde", "scale": 1}, {"unit": "yuzde_hafta", "scale": 10},
                  {"unit": "hafta", "scale": 100}, {"unit": "kat", "scale": 100}, {"unit": "sayi", "scale": 100}):
            with self.subTest(e=e), self.assertRaises(RegistryError):
                mutated("ornek_salt_okunur", {"shows": [{"key": "ORN_LIMIT", **e}]}, {"shows": None})
        for e in ({"unit": "yuzde", "scale": 100}, {"unit": "yuzde_hafta", "scale": 100}, {"scale": 100}, {"unit": "kat"}):
            with self.subTest(e=e):
                mutated("ornek_salt_okunur", {"shows": [{"key": "ORN_LIMIT", **e}]}, {"shows": {"ORN_LIMIT": "L"}})

    def test_shows_shape_rejected(self):
        bad = ["x", {}, [], [{}], [{"key": ""}], [{"key": "ORN_LIMIT"}, {"key": "ORN_LIMIT"}],
               [{"key": "ORN_LIMIT", "unit": "metre"}], [{"key": "ORN_LIMIT", "scale": 0}],
               [{"key": "ORN_LIMIT", "scale": True}], [{"key": "ORN_LIMIT", "label_key": "Büyük Harf"}],
               [{"key": "ORN_LIMIT", "baska": 1}], [{"key": "ORN_LIMIT"}, "x"], [{"key": "ORN_LIMIT", "unit": None}]]
        for shows in bad:
            with self.subTest(shows=shows), self.assertRaises(RegistryError):
                mutated("ornek_salt_okunur", {"shows": shows})

    def test_shows_label_texts_checked(self):
        for tp in ({"shows": {"ORN_YOK": "Etiket"}}, {"shows": {"ORN_LIMIT": ""}}, {"shows": {"ORN_LIMIT": 3}}, {"shows": []}):
            with self.subTest(tp=tp), self.assertRaises(RegistryError):
                mutated("ornek_salt_okunur", text_patch=tp)

    def test_shows_published_without_key(self):
        pub = contract_registry().public()
        by = {c["id"]: c for c in pub["cards"]}
        c = by["ornek_salt_okunur"]
        self.assertEqual(c["shows"], [
            {"label": "Limit çarpanı", "value": 12, "text": "12 kat"},
            {"label": "En az yaş", "value": 52, "text": "52 hafta"},
            {"value": 5, "text": "%5"},                                           # etiketsiz: yalnız text
            {"label": "Ağırlık", "value": 0.7, "text": "0,7"},                    # label_key
            {"label": "Anahtar", "value": False, "text": "kapalı"}])
        self.assertEqual((c["params"], c["editable"], c["status"]), ([], False, "active"))
        self.assertEqual(by["ornek_faiz"]["shows"], [{"label": "En az yaş", "value": 52, "text": "52 hafta"}])
        self.assertTrue(by["ornek_faiz"]["editable"])
        for card in pub["cards"]:
            for row in card.get("shows", []):
                self.assertNotIn("key", row)
                self.assertNotIn("unit", row)
        blob = json.dumps(c, ensure_ascii=False)
        for secret in ("ORN_LIMIT", "ORN_MIN_YAS", "ORN_ESIK", "ORN_ORAN", "ORN_ACIK", "label_key", "agirlik"):
            self.assertNotIn(secret, blob)
        self.assertNotIn("shows", by["ornek_acik"])                                # shows yoksa alan da yok

    def test_real_registry_shows_have_text_and_no_key(self):
        for c in real_registry().public()["cards"]:
            for r in c.get("shows", []):
                self.assertTrue(r["text"])
                self.assertNotIn("key", r)


class SchemaTests(unittest.TestCase):
    def test_string_param_card_rejected(self):
        d = dict(example_defaults(), ORN_PARA="iki bin")
        with self.assertRaises(RegistryError) as cm:
            mutated("ornek_akce", defaults=d)
        self.assertIn("ORN_PARA", str(cm.exception))
        with self.assertRaises(RegistryError):                      # enum haritası dizge model değeri
            mutated("ornek_pasif", {"codec": {"type": "enum", "map": {"a": "x", "b": "y"}}})

    def test_passive_card_empty_params_must_be_locked(self):
        reg = contract_registry()
        s = reg.by_id["ornek_pasif"]
        self.assertEqual((s.params, s.requires, s.editable, s.status), ((), (), False, "passive"))
        for patch in ({"editable": True}, {"status": "experimental"}):
            with self.subTest(patch=patch), self.assertRaises(RegistryError):
                mutated("ornek_pasif", patch)
        r = resolve(reg, {"ornek_pasif": "a"})
        self.assertEqual([(e.id, e.reason) for e in r.errors], [("ornek_pasif", "locked")])

    def test_kind_codec_mismatch_rejected(self):
        for cid, patch in (("ornek_tahvil", {"kind": "number"}), ("ornek_sira", {"kind": "multi"}),
                           ("ornek_acik", {"kind": "number"}), ("ornek_faiz", {"kind": "options"})):
            with self.subTest(cid=cid), self.assertRaises(RegistryError):
                mutated(cid, patch)

    def test_fields_codec_must_cover_params(self):
        c = json.loads(json.dumps(EXAMPLE_CARDS[0]["codec"]))
        for mut in (lambda c: c["fields"].pop(), lambda c: c["fields"][1].update(param="ORN_YOK"),
                    lambda c: c["fields"][1].update(key="acik"), lambda c: c["fields"][1].update(param="ORN_TAHVIL")):
            cc = json.loads(json.dumps(c))
            mut(cc)
            with self.subTest(), self.assertRaises(RegistryError):
                mutated("ornek_tahvil", {"codec": cc})

    def test_order_multi_codec_checks(self):
        for patch in ({"codec": {"type": "order", "param": "ORN_SIRA", "items": ["a", "a"]}},
                      {"codec": {"type": "order", "param": "ORN_SIRA", "items": []}},
                      {"codec": {"type": "order", "param": "BASKA", "items": ["a"]}},
                      {"codec": {"type": "order", "items": ["a"]}}):
            with self.subTest(patch=patch), self.assertRaises(RegistryError):
                mutated("ornek_sira", patch)

    def test_units_and_defaults_validated(self):
        with self.assertRaises(RegistryError):
            mutated("ornek_akce", {"codec": dict(EXAMPLE_CARDS[5]["codec"], unit="dolar")})
        with self.assertRaises(RegistryError):                      # varsayılan ızgarada değil
            mutated("ornek_akce", defaults=dict(example_defaults(), ORN_PARA=2100))
        with self.assertRaises(RegistryError):                      # varsayılan aralık dışı
            mutated("ornek_akce", defaults=dict(example_defaults(), ORN_PARA=20000))

    def test_text_requirements(self):
        for cid, tp in (("ornek_tahvil", {"fields": {"acik": {"label": "Açık"}}}),
                        ("ornek_sira", {"items": {"kurulus": "Kuruluş"}}),
                        ("ornek_pasif", {"options": {"a": "bir"}}),
                        ("ornek_tahvil", {"aliases": "tahvil"}), ("ornek_tahvil", {"warning": 5})):
            with self.subTest(cid=cid, tp=tp), self.assertRaises(RegistryError):
                mutated(cid, text_patch=tp)

    def test_unit_words_required(self):
        with tempfile.TemporaryDirectory() as td:
            d = copy_data(Path(td))
            t = read_json(d / "metinler.tr.json")
            del t["_birimler"]["akce"]
            write_json(d / "metinler.tr.json", t)
            with self.assertRaises(RegistryError):
                loader.load_registry(d, real_defaults())


class PublicTests(unittest.TestCase):
    def test_public_has_no_decision_and_has_control_default(self):
        for reg in (real_registry(), contract_registry()):
            pub = reg.public()
            self.assertEqual(sorted(pub), ["cards", "consistency", "groups", "scenarios", "templates", "units"])
            self.assertEqual(pub["units"], reg.value_words)
            self.assertIn("{yillik}", pub["units"]["yuzde_hafta"])
            self.assertNotIn("decision", json.dumps(pub))
            self.assertNotIn("K-", json.dumps(pub, ensure_ascii=False))
            for c in pub["cards"]:
                self.assertNotIn("decision", c)
                self.assertNotIn("codec", c)
                self.assertTrue(c["title"] and c["what"] and c["changes"], c["id"])
                self.assertIn("control", c)
                self.assertIn("default", c)
                self.assertIsNotNone(c["default"], c["id"])
                self.assertNotIn("measured_at", c)
                mv = c["measured_values"]
                self.assertTrue(mv is None or (isinstance(mv, list) and mv), c["id"])
                self.assertIn(c["apply"], ("live", "live_sync", "start_only", "passive", "unknown"))
                for k in ("actor", "measured_values", "measured_with", "measured_weeks", "hint_source", "credit_type",
                          "scenario_editable", "source_world_field", "params", "requires", "layer", "group", "level",
                          "editable", "status", "kind"):
                    self.assertIn(k, c, f"{c['id']}.{k}")
                self.assertIn(c["control"]["type"], ("options", "number", "fields", "order", "multi"))
        by = {c["id"]: c for c in real_registry().public()["cards"]}
        self.assertEqual(by["gecis_destegi"]["default"], "kurtarma_fonuyla")
        self.assertEqual(by["gecis_destegi"]["control"]["options"][1], {"value": "kisa_sureli", "label": "kısa süreli"})
        self.assertEqual(by["dunya_tohumu"]["default"], 1)
        self.assertEqual([o["label"] for o in by["dunya_tohumu"]["control"]["options"]],
                         [f"Dünya {i}" for i in range(1, 7)])
        self.assertEqual(by["ucret_stopaji"]["control"],
                         {"type": "number", "min": 0, "max": 25, "step": 0.5, "unit": "yuzde", "integer": False})
        self.assertEqual(by["ucret_stopaji"]["default"], 10)
        self.assertIs(by["zararda_once_kucul"]["default"], True)
        self.assertEqual(by["zararda_once_kucul"]["control"]["options"],
                         [{"value": True, "label": "açık"}, {"value": False, "label": "kapalı"}])

    def test_public_control_shapes(self):
        by = {c["id"]: c for c in contract_registry().public()["cards"]}
        f = by["ornek_tahvil"]
        self.assertEqual(f["default"], {"acik": True, "vade": 104, "tavan": 104})
        self.assertEqual([x["key"] for x in f["control"]["fields"]], ["acik", "vade", "tavan"])
        self.assertEqual(f["control"]["fields"][1]["hint"], "Hafta")
        self.assertEqual(f["control"]["fields"][1]["control"]["unit"], "hafta")
        self.assertEqual(by["ornek_sira"]["control"]["items"][1], {"value": "genc", "label": "Genç"})
        self.assertEqual(by["ornek_sira"]["default"], ["kurulus", "genc", "dayanma"])
        self.assertEqual(by["ornek_sektorler"]["default"], ["tarim", "sanayi"])
        self.assertEqual(by["ornek_pasif"]["default"], "a")
        self.assertEqual(by["ornek_pasif"]["params"], [])
        self.assertEqual(by["ornek_faiz"]["default"], 0.3)
        self.assertEqual(by["ornek_tahvil"]["basis"], {"label": "Caiani ve ark. 2016", "note": "Devlet bloğu."})
        self.assertEqual(by["ornek_tahvil"]["aliases"], ["tahvil"])

    def test_measured_values_always_list_of_values(self):
        by = {c["id"]: c for c in contract_registry().public()["cards"]}
        self.assertEqual(by["ornek_sektorler"]["measured_values"], [["tarim", "sanayi"]])
        self.assertEqual(by["ornek_oncelik"]["measured_values"], [["tarim"], ["tarim", "sanayi"]])
        self.assertEqual(by["ornek_faiz"]["measured_values"], [0.3])
        self.assertEqual(by["ornek_akce"]["measured_values"], [2000])
        self.assertIsNone(by["gecis_destegi"]["measured_values"])

    def test_seed_text_is_world_label_not_calibration(self):
        reg = real_registry()
        s = reg.by_id["dunya_tohumu"]
        for i, v in enumerate(reg.seeds):
            txt = codec.format_value(s.codec, v, reg.value_words, reg._format_labels(s), reg.seeds)
            self.assertEqual(txt, f"Dünya {i + 1}")
        with self.assertRaises(ValueError):
            codec.format_value(s.codec, 0.078, reg.value_words)

    def test_number_step_required_and_bool_types(self):
        with self.assertRaises(RegistryError):
            mutated("ornek_akce", {"codec": {"type": "number", "scale": 1, "min": 0, "max": 10000, "unit": "akce"}})
        with self.assertRaises(RegistryError):
            mutated("ornek_acik", {"codec": {"type": "bool", "on": "a", "off": "b"}})

    def test_measured_with_hidden_card_rejected(self):
        d = dict(example_defaults())
        del d["ORN_ACIK"]                      # ornek_acik gizlenir
        with self.assertRaises(RegistryError):
            mutated("ornek_faiz", {"measured_with": {"ornek_acik": True}}, defaults=d)

    def test_hint_applies_cases(self):
        reg = contract_registry()
        cases = read_json(FIXTURES / "registry_hint_cases.json")["cases"]
        self.assertGreaterEqual(len(cases), 12)
        for k in cases:
            with self.subTest(k["name"]):
                got = hints.hint_applies(reg, reg.by_id[k["card"]], k["value"], k["context"])
                self.assertEqual(got, k["applies"])
        self.assertEqual({k["applies"] for k in cases}, {True, False})

    def test_contract_fixture_matches_public(self):
        path = FIXTURES / "registry_contract.json"
        text = pub_json(contract_registry())
        if WRITE:
            path.write_text(text, encoding="utf-8")
        self.assertEqual(path.read_text(encoding="utf-8"), text, "OYUN_FIKSTUR_YAZ=1 ile yeniden üret")

    def test_published_registry_not_stale(self):
        out = config.REPO_ROOT / "apps" / "web" / "public" / "oyun-kayit" / "registry.json"
        self.assertEqual(out.read_text(encoding="utf-8"), pub_json(real_registry()))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(yayinla.main(["--check"]), 0)

    def test_publish_check_reports_diff(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "registry.json"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(yayinla.main(["--out", str(out)]), 0)
                self.assertEqual(yayinla.main(["--check", "--out", str(out)]), 0)
            self.assertEqual(out.read_text(encoding="utf-8"), pub_json(real_registry()))
            self.assertTrue(out.read_text(encoding="utf-8").endswith("}\n"))
            out.write_text(out.read_text(encoding="utf-8").replace("Vergiler", "Vergi"), encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = yayinla.main(["--check", "--out", str(out)])
            self.assertEqual(rc, 1)
            self.assertIn("Vergi", buf.getvalue())

    def test_existing_ids_kept(self):
        reg = real_registry()
        ids = {s.id for s in reg.settings}
        self.assertTrue({"gecis_destegi", "dunya_tohumu", "ucret_stopaji", "kurumlar_vergisi", "zararda_once_kucul"} <= ids)
        self.assertTrue({"kurtarma", "vergi", "dunya"} <= {g["id"] for g in reg.groups})
        self.assertIn("dayanikli_taban", reg.templates)
        t = read_json(REAL_DIR / "metinler.tr.json")["dunya_tohumu"]
        self.assertEqual(t["title"], "Başlangıç dünyası")
        self.assertEqual(t["what"], "Modelde şans payı yok: aynı ayarlar her zaman aynı sonucu verir. "
                                    "Altı başlangıç dünyası, fiyatların arz ve talebe uyum hızındaki küçük farklarla birbirinden ayrılır.")
        self.assertEqual(t["changes"], "Yalnız yeni koşu başlarken seçilir. "
                                       "Aynı kuralı birkaç dünyada denemek sonucun ne kadar sağlam olduğunu gösterir.")
        self.assertEqual(t["options"], {str(i): f"Dünya {i + 1}" for i in range(6)})
        for bad in ("tohum", "rastlant"):
            self.assertNotIn(bad, json.dumps(t, ensure_ascii=False).lower())


class CoverageTests(unittest.TestCase):
    def test_coverage_flags_baseline_registered_overlap(self):
        import tools_registry_coverage as cov
        with tempfile.TemporaryDirectory() as td:
            d = copy_data(Path(td))
            b = read_json(d / "coverage_baseline.json")
            b["names"] = sorted(set(b["names"]) | {"TRANS_SUPPORT"})
            write_json(d / "coverage_baseline.json", b)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = cov.main(["--check", "--data-dir", str(d)])
            self.assertEqual(rc, 1)
            self.assertIn("TRANS_SUPPORT", buf.getvalue())
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cov.main(["--check"]), 0)


if __name__ == "__main__":
    unittest.main()
