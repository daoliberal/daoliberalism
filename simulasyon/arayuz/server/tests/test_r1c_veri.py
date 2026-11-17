"""R1c: dünyanın insanları (V), piyasa göstergeleri (S), dünya kuralları (Y) ve dünya senaryoları."""
from __future__ import annotations

import unittest

from oyun_server.registry import codec as codec_mod, resolve
from oyun_server.registry.schema import ACTORS, RunConfigError
from oyun_server.sim import probes

from tests.group_checks import ESLEM, GroupChecks, all_cards
from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry, evidence_cards

R1C_GROUPS = ("hane", "girisimci", "isci", "yatirimci", "yerlesik", "dunya", "piyasa")
R10 = {"faize_duyarli_davranis": "R10 (RATE_BEHAV)", "beklenen_kar_girisim": "R10 (ENTRY_EXP)"}
PASSIVE = {"hane_konut", "girisimci_risk_tutumu", "is_arama", "dunya_temeli", "sehre_ozel_kural"}
CALIBRATION = ("navlun", "kitlik_esigi", "lonca_gideri", "sektor_acilis_esikleri", "konut_kira_getirisi", "kira_tabani")
EXISTING = ("siparis_defteri_kredisi", "kalici_kitlik", "zararda_once_kucul", "dunya_tohumu", "sehre_ozel_kural")
SCENARIO_IDS = ["gercekci", "tutumlu", "savurgan", "riskten", "atak", "hareketli", "yapiskan", "ozel"]



class R1cGroupTests(GroupChecks, unittest.TestCase):
    GROUPS = R1C_GROUPS
    DEFERRED = dict(R10)


class R1cSpecific(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.cards = all_cards(cls.reg)
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.eslem = read_json(ESLEM)
        cls.d = real_defaults()

    def layer(self, L):
        return [s for s in self.cards.values() if s.layer == L]

    def test_counts_and_actors(self):
        v = self.layer("V")
        self.assertEqual(len(v), 47)                          # 40 yeni + R1b'nin iki kartı + zararda_once_kucul + R10'un iki V kartı + PLAN-KREDI T10'un iki V kartı (mevduat_yonlendirme, issiz_kurucu)
        self.assertEqual(len(self.layer("S")), 10)
        self.assertEqual(len([s for s in self.layer("Y") if s.id not in ("dunya_tohumu", "sehre_ozel_kural")]), 12)
        self.assertEqual({s.actor for s in v}, set(ACTORS))

    def test_every_actor_has_cards(self):
        for a in ACTORS:
            cs = [s for s in self.layer("V") if s.actor == a]
            self.assertTrue(any(s.status == "active" for s in cs), a)
            t = self.texts["_aktorler"][a]
            self.assertTrue(t["title"].strip() and t["intro"].strip(), a)
        self.assertEqual(set(self.texts["_aktorler"]), set(ACTORS))

    def test_v_cards_not_in_sart(self):
        """V kartı Şart değeri değildir: `values`, canlı yama ve şablon `values` onu kabul etmez; yalnız dünya senaryosu / şablon dünya değerleri."""
        for s in self.layer("V"):
            with self.subTest(card=s.id):
                r = resolve.resolve(self.reg, {s.id: self.reg.default_ui(s)})
                self.assertEqual([(e.id, e.reason) for e in r.errors], [(s.id, "locked")])
                self.assertFalse(resolve.run_editable(s))
        for tid, t in self.reg.templates.items():
            self.assertFalse({k for k in t["values"] if self.cards[k].layer == "V"}, tid)
        with self.assertRaises(RunConfigError):
            resolve.run_overrides(self.reg, {"durationWeeks": 200, "values": {"harcama_egrisi": {"ilk": 90, "egim": 0.15}}})

    def test_scenario_editable_only_for_editable_active_v(self):
        for s in self.layer("V"):
            ok = s.editable and s.status == "active"
            self.assertEqual(s.scenario_editable, ok, s.id)
        for s in self.cards.values():
            if s.layer != "V":
                self.assertFalse(s.scenario_editable, s.id)

    def test_passive_and_readonly_cards(self):
        for i in PASSIVE:
            s = self.cards[i]
            self.assertEqual((s.status, s.editable, list(s.params)), ("passive", False, []), i)
        for i in CALIBRATION:
            s = self.cards[i]
            with self.subTest(card=i):
                self.assertEqual((s.layer, s.actor, s.status, s.editable, list(s.params)), ("V", "dunya", "active", False, []))
                self.assertTrue(s.shows)
                rows = self.reg._card_public(s)["shows"]
                self.assertEqual(len(rows), len(s.shows))
                for e in s.shows:
                    self.assertIn(e["key"], self.d)
                for r in rows:
                    self.assertTrue(r["text"].strip())
        rows = {r["label"]: r["text"] for r in self.reg._card_public(self.cards["kira_tabani"])["shows"]}
        self.assertEqual(rows["Açılış kirası (çırak ücretinin payı)"], "%8")
        rows = {r["label"]: r["text"] for r in self.reg._card_public(self.cards["lonca_gideri"])["shows"]}
        self.assertEqual(list(rows.values()), ["400 Akçe", "8 Akçe", "12 hafta"])
        rows = {r["label"]: r["text"] for r in self.reg._card_public(self.cards["sektor_acilis_esikleri"])["shows"]}
        self.assertEqual(list(rows.values()), ["15.000", "3.000", "8.000", "20.000"])

    def test_r10_cards_carded_in_r10(self):
        for i in R10:
            self.assertIn(i, self.cards)            # R10 kartladı (test_new_flag_flow)
        owned = {p for s in self.cards.values() for p in s.params}
        self.assertTrue({"RATE_BEHAV", "RB_CREDIT", "ENTRY_EXP"} <= owned)

    def test_apply_unknown_for_new_cards(self):
        for s in (*self.layer("V"), *self.layer("S"), *self.layer("Y")):
            if s.id in ("dunya_tohumu",):
                continue
            self.assertEqual(s.apply, "start_only" if s.id == "zararda_once_kucul" else evidence_cards().get(s.id, "unknown"), s.id)

    def test_s_cards_bound_to_real_world_fields(self):
        fields = [s.source_world_field for s in self.layer("S")]
        self.assertEqual(len(set(fields)), len(fields))
        for s in self.layer("S"):
            with self.subTest(card=s.id):
                self.assertIn(s.source_world_field, probes.FIELD_NOTES)
                self.assertEqual((s.status, s.editable, list(s.params)), ("active", False, []))
                self.assertIn("ayarlanamaz", self.texts[s.id]["changes"])
        self.assertEqual(self.cards["tahvil_faizi"].source_world_field, "bond_rate")
        self.assertEqual(self.cards["kira_gostergesi"].source_world_field, "rent_pct")

    def test_default_values_match_the_model(self):
        d = self.d
        for cid, ui in (("harcama_egrisi", {"ilk": 90, "egim": 0.15}), ("servetten_harcama", 4.5), ("baslangic_parasi", 100),
                        ("goc", {"npc_payi": 5, "oyuncu_payi": 50, "bekleme": 2}),
                        ("az_birikimli_harcama", {"pay": 3, "esik": 12}), ("aliskanlik_hizi", {"artis": 5, "dusus": 2}),
                        ("mevduat_elde_tutma", {"tutma": 2, "pay": 50}),
                        ("girisimci_dalgasi", {"acik": True, "kisi": 2, "ilk": 35, "son": 50}), ("kurma_egilimi", 0.2),
                        ("piyasa_sinyali", {"fiyat": 0.9, "girdi": 40}), ("fiyat_artis_hizi", 20), ("hedef_kar_marji", 10),
                        ("issizlik_ucret_tepkisi", {"dogal": 20, "katsayi": 1, "dusus": 100}),
                        ("ucret_uyumu", {"yansima": 50, "hiz": 15}), ("mevduata_dagitilan_pay", 80),
                        ("lonca_aidat_arama", {"baslangic": 5, "adim": 0.5, "sikligi": 8}),
                        ("lonca_risk_payi", {"katsayi": 0.5, "en_cok": 0.5}), ("kitlikta_buyume", 2),
                        ("yerlesik_batma_suresi", 13), ("lonca_degistirme", 20)):
            with self.subTest(card=cid):
                self.assertEqual(self.reg.default_ui(self.cards[cid]), ui)
        self.assertEqual(d["MPC0"], 0.9)

    def test_effective_when_declared(self):
        want = {"kalici_kitlik": {"sektor_panosu": True, "itibar_sarti": "var"},
                "siparis_defteri_kredisi": {"zarar_eden_firmayi_kurtarma": "yok"},
                "yerlesik_batma_suresi": {"zarar_eden_firmayi_kurtarma": "yok"},
                "girisimci_dalgasi": {"itibar_sarti": "yok"}, "kurma_egilimi": {"itibar_sarti": "yok"},
                "genc_kurucu_verimi": {"itibar_sarti": "yok"}, "piyasa_sinyali": {"itibar_sarti": "var"},
                "genc_firma_davranisi": {"genc_firma_destegi": True}}
        for i, w in want.items():
            self.assertEqual(self.cards[i].effective_when, w, i)
        self.assertEqual(self.cards["zararda_once_kucul"].effective_when, {})      # oyuncu firmasında koşulsuz (week_people.py:308)
        for i in ("ikinci_kaynak", "girdi_tamponu", "pano_kurallari"):
            self.assertEqual(self.cards[i].effective_when, {"sektor_panosu": True}, i)

    def test_texts_follow_the_model(self):
        t = {i: " ".join(self._flat(self.texts[i])).lower() for i in self.cards if i in self.texts}
        self.assertIn("girişim kapıları açıkken", t["kurma_egilimi"])              # entry_open.py eo_organic
        self.assertIn("piyasa sinyaline", t["kurma_egilimi"])
        self.assertIn("tibar şartı varken", t["piyasa_sinyali"])                           # week_people.py: ENTRY_OPEN'da sinyal kapıları yok
        self.assertIn("kurtarma yokken", t["yerlesik_batma_suresi"])                        # labor.py nb_ = NO_BAILOUT
        self.assertIn("kurtarma yokken", t["siparis_defteri_kredisi"])                      # ob_x_ = ORDER_BOOK and nb_
        self.assertIn("yalnız kurtarma yokken", t["siparis_defteri_kredisi"])
        self.assertIn("sektör panosu açıkken", t["ikinci_kaynak"])                          # sector_core.py: pano yoksa dönüş
        self.assertIn("sektör panosu açıkken", t["girdi_tamponu"])
        self.assertIn("sektör panosu açıkken", t["pano_kurallari"])
        self.assertIn("yalnız yerleşik", t["kitlikta_buyume"])                              # labor.py:120 yalnız yerleşik
        self.assertIn("konut yatırımı da durur", t["haneler_mevduat_yatirir"])              # HI_ACT = ... and DEP_ON
        for i, bad in (("harcama_egrisi", "20 haftalık"), ("servetten_harcama", "20 haftalık")):
            self.assertNotIn(bad, t[i], i)                                                 # prototipin 20 haftalık tampon tarifi etkin kuralda yok
        self.assertNotIn("tampon", t["servetten_harcama"].lower().split("eşik")[0])

    @staticmethod
    def _flat(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, dict):
            for v in node.values():
                yield from R1cSpecific._flat(v)
        elif isinstance(node, list):
            for v in node:
                yield from R1cSpecific._flat(v)

    def test_goc_card_owns_the_wait_param(self):
        self.assertEqual(list(self.cards["goc"].params), ["MIGRATION_SHARE", "PLAYER_MIGRATE_SHARE", "PLAYER_MIGRATE_AFTER"])

    def test_calibration_names_stay_in_baseline(self):
        """Salt okunur kalibrasyon parametrelerinin sahibi yok: kapsam baseline'ında kalır."""
        base = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        owned = {p for s in (*self.reg.settings, *self.reg.hidden) for p in s.params}
        for i in CALIBRATION:
            for e in self.cards[i].shows:
                self.assertIn(e["key"], base | owned, e["key"])


class R1cDuzeltme1(unittest.TestCase):
    """İnceleme düzeltme turu 1: üç önemli ve küçük maddeler."""

    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.cards = all_cards(cls.reg)
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.eslem = read_json(ESLEM)["kartlar"]

    def txt(self, i):
        return " ".join(R1cSpecific._flat(self.texts[i]))

    def test_shrink_first_applies_to_player_firms_unconditionally(self):
        """week_people.py:308 oyuncu firması koşulsuz; labor.py:309 yerleşik yalnız kurtarma yokken."""
        self.assertEqual(self.cards["zararda_once_kucul"].effective_when, {})
        t = {"values": {"zarar_eden_firmayi_kurtarma": "var"}, "world_values": {"zararda_once_kucul": False}}
        self.assertEqual(self.reg.behavior_changes(t), ["zararda_once_kucul"])
        w = self.txt("zararda_once_kucul")
        self.assertIn("oyuncu firmasında", w.lower())
        self.assertIn("yerleşik", w.lower())
        self.assertNotIn("işlemez", self.texts["zararda_once_kucul"]["what"].split("Yerleşik")[0])

    def test_board_growth_is_resident_only_and_premium_is_for_all(self):
        """SB_GROW yalnız yerleşik (labor.py:124, week_cycle_parts.py:143); SB_PREM_MAX bütün firmalar (prices.py:311)."""
        self.assertEqual(self.cards["pano_kurallari"].actor, "yerlesik")
        self.assertEqual(self.eslem["pano_kurallari"]["bolum"], "yerlesik")
        p = self.txt("pano_kurallari")
        self.assertIn("bütün firmaların", p)
        self.assertIn("yerleşik firmalar", p)
        self.assertNotIn("o ürünü üreten firmalar", p)
        k = self.txt("kitlikta_buyume")
        self.assertNotIn("Girişimciler bölümündeki panoya bağlı", k)
        self.assertIn("oyuncu firmalarında kıtlıkta büyüme kuralı yoktur", k)

    def test_sticky_wage_does_not_claim_wages_never_fall(self):
        """week_open.py:194: LAB_DOWN=0 yalnız işsizlik terimini kapatır; ücret geçim hedefine uyumla yine iner."""
        for i in ("issizlik_ucret_tepkisi",):
            t = self.txt(i)
            self.assertNotIn("hiç düşmez", t)
            self.assertNotIn("hiç düşme", t)
            self.assertIn("geçim endeksine", t)
        sc = self.texts["_senaryolar"]["yapiskan"]["what"]
        for bad in ("hiç düşmez", "sabit kalır", "işsizlik yüksekken de düşmez"):
            self.assertNotIn(bad, sc)
        self.assertIn("geçim endeksine", sc)

    def test_minor_texts(self):
        self.assertNotIn("Piyasa bölümündeki", self.txt("navlun"))
        self.assertIn("ücret endeksi", self.txt("navlun"))
        self.assertNotIn("doluluk", self.texts["kira_gostergesi"]["title"].lower())
        self.assertIn("yüzde 10", self.texts["lonca_aidat_arama"]["what"])            # lonca.py:36-39 öncelikli iki kural
        self.assertIn("gider", self.texts["lonca_aidat_arama"]["what"])
        self.assertIn("lojistik", self.texts["hedef_kar_marji"]["what"])               # PV2_EXCL (prices.py:253)
        self.assertIn("şehir başına bir kamu", self.texts["dunya_temeli"]["what"])
        self.assertIn("varsayılan", self.texts["yerlesik_batma_suresi"]["what"])

    def test_no_internal_words_in_aliases_or_texts(self):
        import re
        bad = re.compile(r"NPC|\bFee\b|\bfee|\(hf\)|\bhf\b")
        for i, s in self.cards.items():
            if s.layer == "P" or i not in self.texts:
                continue
            for a in self.texts[i].get("aliases", []):
                self.assertIsNone(bad.search(a), f"{i}: {a}")
            self.assertIsNone(bad.search(self.txt(i)), i)

    def test_dead_world_branch_removed(self):
        """Şablon dünya değeri düzenlenemeyen karta yazılırsa `locked` (ölü `fixed` dalı yok)."""
        import dataclasses
        c = self.cards["kalici_kitlik"]
        saved = self.reg.by_id["kalici_kitlik"]
        self.reg.by_id["kalici_kitlik"] = dataclasses.replace(c, editable=False, apply="start_only")
        try:
            with self.assertRaises(RunConfigError) as cm:
                resolve.run_overrides(self.reg, {"durationWeeks": 200, "templateId": "bos_sart"})
            self.assertIn(("kalici_kitlik", "locked"), [(e.id, e.reason) for e in cm.exception.errors])
        finally:
            self.reg.by_id["kalici_kitlik"] = saved

    def test_consistency_values_are_validated(self):
        import tempfile
        from pathlib import Path
        from oyun_server.registry import loader
        from oyun_server.registry.schema import RegistryError
        from tests.registry_helpers import copy_data, write_json
        muts = (lambda d: d["rules"][0]["when"].update({"gecis_destegi": "yok_boyle_secenek"}),
                lambda d: d["rules"][0]["when"].update({"ozellestirme": {"yok_alan": True}}),
                lambda d: next(r for r in d["rules"] if "artan" in r)["artan"].update({"alanlar": ["yok_alan", "baska_yok"]}))
        for mut in muts:
            with tempfile.TemporaryDirectory() as td:
                d = copy_data(Path(td) / "kayit")
                doc = read_json(d / "tutarlilik.json")
                mut(doc)
                write_json(d / "tutarlilik.json", doc)
                with self.assertRaises(RegistryError):
                    loader.load_registry(d, real_defaults())

    def test_r2_start_only_note(self):
        """Canlı yamada içe aktarımda gömülen bayraklar R2 için kayıt altında not edilir (`r2_apply_notlari.json`)."""
        note = read_json(REAL_DIR / "r2_apply_notlari.json")
        flags = {e["param"]: e for e in note["start_only"]}
        self.assertEqual(set(flags), {"ENERGY_ON", "HEALTH", "EDUCATION", "RESALE_ON", "TOUR_ON", "DEP_ON", "MEDIA_LONCA", "DIRECT_AD",
                                      "LONCA_FEE", "PROG_ARGE", "TREASURY_RULE", "PROFIT_KEEP", "PK_WEEKS",      # TREASURY_RULE ve sonrası R10 (INCOME_KINDS)
                                      "PLAYERS_PER_CITY", "NPC_X", "NPC_Y", "CITY_START_CASH",      # D4: kuruluşta kurulan nüfus ve kasa
                                      "START_EMP", "FIRMS_PER_1000", "CAP_MODE", "CAP_AUTO_SHARE", "CAP_AUTO_MIN", "MCAP_RAW", "MCAP_MAKE", "MCAP_SERV", "MCAP_LOG",
                                      "CAP_GROWTH", "START_DEMAND", "START_STOCK_WEEKS", "NPC_START_CASH", "HOUSE_MODE", "POP_SCALE",      # D7: kuruluşta kurulan dünya ayarları
                                      "NPC_HOUSE", "NPC_LFPR", "HOUSE_DEP_EQ", "OPEN_MODE", "OPEN_GRACE", "OPEN_TR", "OPEN_CAPEX", "OPEN_SWEEP",      # D9: NPC hanesi ve açılış geçişi
                                  "MONEY_LOOP"})      # D11: para devresi seçimi eski bayraklara türetilir
        for p, e in flags.items():
            self.assertIn(p, real_defaults(), p)
            self.assertTrue(e["neden"].strip(), p)
            self.assertIn(p, self.cards[e["kart"]].params, p)


class R1cScenarios(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.cards = all_cards(cls.reg)
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.raw = read_json(REAL_DIR / "senaryolar.json")["scenarios"]
        cls.eslem = {s["kimlik"]: s for s in read_json(ESLEM)["senaryolar"]}

    def test_ids_match_the_prototype(self):
        self.assertEqual([s["id"] for s in self.raw], SCENARIO_IDS)
        self.assertEqual(list(self.eslem), SCENARIO_IDS)
        self.assertEqual([s["id"] for s in self.reg.public()["scenarios"]], SCENARIO_IDS)

    def test_all_unmeasured(self):
        for s in self.raw:
            self.assertIs(s["measured"], False, s["id"])
        for i in SCENARIO_IDS:
            t = self.texts["_senaryolar"][i]
            self.assertTrue(t["title"].strip() and t["what"].strip(), i)

    def test_scenarios_values_decode(self):
        for sc in self.reg.scenarios:
            for cid, ui in sc["values"].items():
                with self.subTest(scenario=sc["id"], card=cid):
                    c = self.cards[cid]
                    self.assertEqual((c.layer, c.scenario_editable), ("V", True))
                    self.assertTrue(set(self.eslem[sc["id"]]["kartlar"]) >= {cid})        # K2 eşlemindeki kartlar
                    codec_mod.decode(c.codec, ui, self.reg.seeds)

    def test_scenario_values_follow_the_prototype(self):
        by = {s["id"]: s["values"] for s in self.raw}
        self.assertEqual(by["gercekci"], {})
        self.assertEqual(by["ozel"], {})
        self.assertEqual(by["tutumlu"]["harcama_egrisi"]["ilk"], 80)
        self.assertEqual(by["tutumlu"]["az_birikimli_harcama"]["pay"], 1.5)
        self.assertEqual(by["tutumlu"]["mevduat_elde_tutma"], {"tutma": 4, "pay": 50})
        self.assertEqual(by["savurgan"]["harcama_egrisi"]["ilk"], 95)
        self.assertEqual(by["savurgan"]["az_birikimli_harcama"]["pay"], 5)
        self.assertEqual(by["savurgan"]["mevduat_elde_tutma"], {"tutma": 1, "pay": 50})
        self.assertEqual(by["riskten"], {"kurma_egilimi": 0.1, "piyasa_sinyali": {"fiyat": 0.95, "girdi": 30}})
        self.assertEqual(by["atak"], {"kurma_egilimi": 0.4, "piyasa_sinyali": {"fiyat": 0.8, "girdi": 50}})
        self.assertEqual(by["hareketli"], {"goc": {"npc_payi": 10, "oyuncu_payi": 100, "bekleme": 1}})
        self.assertEqual(by["yapiskan"]["issizlik_ucret_tepkisi"]["dusus"], 0)
        # karşılığı olmayan satır atlanır ve metin bunu söyler
        for i in ("tutumlu", "savurgan"):
            self.assertIn("tampon", self.texts["_senaryolar"][i]["what"])
            self.assertIn("ayrı bir ayar olmadığı için", self.texts["_senaryolar"][i]["what"])

    def test_scenarios_blocked_until_cards_are_verified(self):
        pub = {s["id"]: s for s in self.reg.public()["scenarios"]}
        self.assertTrue(pub["gercekci"]["startable"] and pub["ozel"]["startable"])
        for i in ("tutumlu", "savurgan", "riskten", "atak", "hareketli", "yapiskan"):
            # R2: kartlar doğrulandıkça senaryo açılır; engelli kalanlar ancak doğrulanmamış kartlardandır
            want = sorted(k for k in self.raw[SCENARIO_IDS.index(i)]["values"] if evidence_cards().get(k, "unknown") == "unknown")
            self.assertEqual(pub[i]["blocked_by"], want, i)          # engel = kanıt dosyasında sınıfı olmayan kartlar (bağımsız hesap)
            self.assertEqual(pub[i]["startable"], not want, i)
        blocked = next((i for i in ("tutumlu", "savurgan", "riskten", "atak", "hareketli", "yapiskan") if pub[i]["blocked_by"]), None)
        if blocked:
            with self.assertRaises(RunConfigError) as cm:
                resolve.run_overrides(self.reg, {"durationWeeks": 200, "worldScenarioId": blocked})
            self.assertTrue(all(e.reason == "unverified" for e in cm.exception.errors))
        resolve.run_overrides(self.reg, {"durationWeeks": 200, "worldScenarioId": "gercekci"})

    def test_scenario_params_reach_the_run_once_verified(self):
        import dataclasses
        reg = self.reg
        saved = dict(reg.by_id)
        try:
            for k in ("harcama_egrisi", "az_birikimli_harcama", "mevduat_elde_tutma"):
                reg.by_id[k] = dataclasses.replace(reg.by_id[k], apply="start_only")
            p = resolve.run_overrides(reg, {"durationWeeks": 200, "worldScenarioId": "tutumlu"})
            self.assertEqual((p["MPC0"], p["POOR_SHARE"], p["DEP_KEEP_NEW"], p["DEP_SHARE"]), (0.8, 0.015, 4, 0.5))
        finally:
            reg.by_id.clear()
            reg.by_id.update(saved)


class R1cLoaderChecks(unittest.TestCase):
    def test_bad_scenario_card_is_an_error(self):
        import tempfile
        from pathlib import Path
        from oyun_server.registry import loader
        from oyun_server.registry.schema import RegistryError
        from tests.registry_helpers import copy_data, write_json
        for card, val in (("navlun", True), ("ucret_stopaji", 10), ("harcama_egrisi", {"ilk": 999, "egim": 0.15}), ("yok_boyle_kart", 1)):
            with self.subTest(card=card), tempfile.TemporaryDirectory() as td:
                d = copy_data(Path(td) / "kayit")
                doc = read_json(d / "senaryolar.json")
                doc["scenarios"][0]["values"] = {card: val}
                write_json(d / "senaryolar.json", doc)
                with self.assertRaises(RegistryError):
                    loader.load_registry(d, real_defaults())

    def test_missing_actor_text_is_an_error(self):
        import tempfile
        from pathlib import Path
        from oyun_server.registry import loader
        from oyun_server.registry.schema import RegistryError
        from tests.registry_helpers import copy_data, write_json
        with tempfile.TemporaryDirectory() as td:
            d = copy_data(Path(td) / "kayit")
            m = read_json(d / "metinler.tr.json")
            del m["_aktorler"]["isci"]
            write_json(d / "metinler.tr.json", m)
            with self.assertRaises(RegistryError):
                loader.load_registry(d, real_defaults())

    def test_fixed_rules_only_p_cards(self):
        reg = real_registry()
        cards = all_cards(reg)
        for r in reg.fixed_rules():
            self.assertEqual(cards[r["settingId"]].layer, "P")


if __name__ == "__main__":
    unittest.main()
