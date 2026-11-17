"""R1c öncesi (R1b kalanları): N1 V kartları Şart değerlerinde ve canlı yamada kilitli; N2 `is_world_card` yalnız V katmanı;
N3 pano kapalıyken etkisiz dünya varsayımı `behavior_changes`'te yok."""
from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from oyun_server.registry import loader, resolve
from oyun_server.registry.schema import RegistryError, RunConfigError

from tests.registry_helpers import copy_data, read_json, real_defaults, real_registry, write_json
from tests.route_helpers import CONFIG, call, live_app
from tests.test_routes import err_fields


class N1VKartlariSartta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()

    def test_resolve_locks_v_without_world(self):
        r = resolve.resolve(self.reg, {"siparis_defteri_kredisi": "kapali"})
        self.assertEqual([(e.id, e.reason) for e in r.errors], [("siparis_defteri_kredisi", "locked")])
        self.assertEqual(r.params, {})

    def test_resolve_world_mode_still_decodes_v(self):
        r = resolve.resolve(self.reg, {"siparis_defteri_kredisi": "hedef_kadro_kitlik"}, world=True)
        self.assertEqual((r.errors, r.params), ([], {"ORDER_BOOK": 2}))

    def test_run_overrides_locks_v_in_values(self):
        for tid in (None, "dayanikli_taban"):
            with self.subTest(template=tid):
                cfg = {"durationWeeks": 200, "values": {"kalici_kitlik": "acik"}}
                if tid:
                    cfg["templateId"] = tid
                with self.assertRaises(RunConfigError) as cm:
                    resolve.run_overrides(self.reg, cfg)
                self.assertEqual([(e.id, e.reason) for e in cm.exception.errors], [("kalici_kitlik", "locked")])

    def test_world_values_path_still_reaches_the_run(self):
        saved = self.reg.by_id["siparis_defteri_kredisi"]
        import dataclasses
        self.reg.by_id["siparis_defteri_kredisi"] = dataclasses.replace(saved, apply="start_only")
        try:
            p = resolve.run_overrides(self.reg, {"durationWeeks": 200, "worldScenarioValues": {"siparis_defteri_kredisi": "hedef_kadro_kitlik"}})
            self.assertEqual(p["ORDER_BOOK"], 2)
        finally:
            self.reg.by_id["siparis_defteri_kredisi"] = saved

    def test_post_runs_values_locked(self):
        with live_app() as (srv, _a, _w):
            s, _, b = call(srv, "POST", "/api/runs", {"config": dict(CONFIG, values={"siparis_defteri_kredisi": "kapali", "zararda_once_kucul": True})})
            self.assertEqual(s, 422)
            self.assertEqual(sorted(err_fields(b)), [("siparis_defteri_kredisi", "locked"), ("zararda_once_kucul", "locked")])

    def test_live_patch_locks_v(self):
        from oyun_server.runs import recipe
        with live_app() as (_srv, app, _w):
            self.assertEqual(app.manager._change_rejects({"kalici_kitlik": "acik"}), [("kalici_kitlik", "locked")])
            errs = recipe.validate(self.reg, {"config": dict(CONFIG), "schedule": [{"week": 10, "patch": {"kalici_kitlik": "acik"}}]})
            self.assertEqual([(e.id, e.reason) for e in errs], [("schedule[0].patch.kalici_kitlik", "locked")])

    def test_availability_and_info_exclude_v(self):
        with live_app() as (srv, _a, _w):
            s, _, b = call(srv, "POST", "/api/availability", {"values": {"kalici_kitlik": "acik"}})
            self.assertEqual(s, 200)
            self.assertFalse(b["ok"])
            self.assertEqual([(x["settingId"], x["reason"]) for x in b["blocked"]], [("kalici_kitlik", "locked")])
            s, _, info = call(srv, "GET", "/api/info")
            ids = {x["id"] for x in info["settings"]}
            self.assertNotIn("kalici_kitlik", ids)
            self.assertIn("gecis_destegi", ids)
            self.assertIn("dunya_tohumu", ids)                                # Y kartı (tohum) Şart yolunda kalır


class N2DunyaKartiTanimi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.by = {s.id: s for s in (*cls.reg.settings, *cls.reg.hidden)}

    def test_only_scenario_editable_v(self):
        for i in ("kalici_kitlik", "siparis_defteri_kredisi", "zararda_once_kucul"):
            self.assertTrue(loader.is_world_card(self.by[i]), i)
        for i in ("ucret_stopaji", "dunya_tohumu", "sehre_ozel_kural", "gecis_destegi", "asgari_ucret"):
            self.assertFalse(loader.is_world_card(self.by[i]), i)

    def test_loader_rejects_y_or_readonly_in_world_values(self):
        for card in ("dunya_tohumu", "ucret_stopaji", "sehre_ozel_kural"):
            with self.subTest(card=card), tempfile.TemporaryDirectory() as td:
                d = copy_data(Path(td) / "kayit")
                doc = read_json(d / "templates.json")
                t = next(x for x in doc["templates"] if x["id"] == "bos_sart")
                t["world_values"] = {**t["world_values"], card: 0}
                write_json(d / "templates.json", doc)
                with self.assertRaises(RegistryError) as cm:
                    loader.load_registry(d, real_defaults())
                self.assertIn(card, str(cm.exception))


class N3EtkisizVarsayim(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.texts = read_json(loader.DEFAULT_DATA_DIR / "metinler.tr.json")

    def test_pano_closed_hides_kalici_kitlik(self):
        pub = {t["id"]: t for t in self.reg.public()["templates"]}
        for tid in ("bos_sart", "serbest_piyasa"):
            self.assertEqual(pub[tid]["behavior_changes"], ["siparis_defteri_kredisi", "zararda_once_kucul"], tid)
            self.assertIn("kalici_kitlik", pub[tid]["world_values"], "değer yine de yazılır (pano açılırsa işler)")

    def test_pano_open_shows_it(self):
        t = copy.deepcopy(self.reg.templates["bos_sart"])
        t["values"]["sektor_panosu"] = True
        self.assertIn("kalici_kitlik", self.reg.behavior_changes(t))
        t["values"].pop("sektor_panosu")                                      # varsayılan: pano açık
        self.assertIn("kalici_kitlik", self.reg.behavior_changes(t))

    def test_texts_do_not_present_it_as_a_change(self):
        for tid in ("bos_sart", "serbest_piyasa"):
            what = self.texts["_sablonlar"][tid]["what"]
            self.assertNotIn("Kalıcı kıtlık yoksa oyuncu girmez kuralı açıktır", what, tid)
        self.assertIn("pano", self.texts["kalici_kitlik"]["what"])


class TutarlilikYayimi(unittest.TestCase):
    """Denetleyici eki: `public()["consistency"]` tutarlilik.json kurallarını çözülmüş metinle yayımlar."""

    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.raw = read_json(loader.DEFAULT_DATA_DIR / "tutarlilik.json")["rules"]
        cls.texts = read_json(loader.DEFAULT_DATA_DIR / "metinler.tr.json")

    def test_published_with_resolved_text(self):
        pub = self.reg.public()["consistency"]
        self.assertEqual([c["id"] for c in pub], [r["id"] for r in self.raw])
        for c, r in zip(pub, self.raw):
            self.assertEqual(c["text"], self.texts["_uyarilar"][r["textKey"].split(".", 1)[1]])
            self.assertEqual(("when" in c, "artan" in c), ("when" in r, "artan" in r))
            self.assertNotIn("textKey", c)
            for card in c.get("when", {}):
                self.assertIn(card, {x["id"] for x in self.reg.public()["cards"]})

    def test_text_rules_pass(self):
        import re
        rules = read_json(loader.DEFAULT_DATA_DIR / "metin_kurallari.json")["forbidden"]
        for c in self.reg.public()["consistency"]:
            for f in rules:
                self.assertIsNone(re.search(f["pattern"], c["text"]), f"{c['id']}: {f['id']}")

    def test_unknown_card_or_text_is_an_error(self):
        for mutate in (lambda d: d["rules"][0]["when"].update({"yok_boyle_kart": 1}),
                       lambda d: d["rules"][0].update({"textKey": "_uyarilar.yok_boyle_metin"})):
            with tempfile.TemporaryDirectory() as td:
                d = copy_data(Path(td) / "kayit")
                doc = read_json(d / "tutarlilik.json")
                mutate(doc)
                write_json(d / "tutarlilik.json", doc)
                with self.assertRaises(RegistryError):
                    loader.load_registry(d, real_defaults())


if __name__ == "__main__":
    unittest.main()
