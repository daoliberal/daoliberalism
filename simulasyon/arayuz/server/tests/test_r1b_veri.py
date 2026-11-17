"""R1b: kural kartlarının ikinci grubu (Şehir bütçesi, Kurtarma, Girişim, Fiyat, Loncalar, Pano, Konut, İnovasyon, Dünya geneli),
altı şablon ve tutarlılık kuralları."""
from __future__ import annotations

import dataclasses
import json
import math
import re
import unittest
from pathlib import Path

from oyun_server import config
from oyun_server.registry import codec as codec_mod, resolve
from oyun_server.registry.schema import RunConfigError

from tests.group_checks import ESLEM, GroupChecks, all_cards
from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry, evidence_cards

R1B_GROUPS = ("butce", "kurtarma", "girisim", "fiyat", "loncalar", "pano", "konut", "inovasyon", "dunya")
R1B_IDS = {
    "butce": ["gider_onceligi", "issizlik_odenegi", "asgari_guvence", "belediye_istihdami", "kamu_hizmet_sozlesmesi", "kasa_tabani",
              "butce_yuzde_paylari", "kamu_alimi", "kurulus_fonu"],
    "kurtarma": ["zarar_eden_firmayi_kurtarma", "destek_tavani", "destek_bitis_esigi", "ozellestirme_durur", "ozellestirme",
                 "kamu_kar_tamponu", "altyapi_idari_yonetim"],
    "girisim": ["itibar_sarti", "kurulus_harci", "genc_firma_destegi"],
    "fiyat": ["duzenlenen_sektorler", "sektor_fiyat_tavani", "yerli_uretim_programi", "asgari_ucret"],
    "loncalar": ["lonca_aidat_araligi", "lonca_isletme_payi", "lonca_uye_ust_siniri", "lonca_sosyal_paket"],
    "pano": ["sektor_panosu"],
    "konut": ["konut_yatirim_siniri", "kira_kontrolu"],
    "inovasyon": ["lonca_arge_payi", "patent_suresi", "telif_orani"],
    "dunya": ["sehre_ozel_kural"],
}
ALL_IDS = [i for g in R1B_IDS.values() for i in g]
PASSIVE = {"butce_yuzde_paylari", "kamu_alimi", "sektor_fiyat_tavani", "asgari_ucret", "lonca_isletme_payi", "lonca_uye_ust_siniri",
           "kira_kontrolu", "sehre_ozel_kural"}
EXISTING = {"gecis_destegi": "R1a/MVP kartı", "dunya_tohumu": "MVP kartı", "zararda_once_kucul": "MVP kartı"}
R10 = {"sehir_kasasi_kurali": "R10 (birleşik model bayrağı TREASURY_RULE)", "kar_firmada_kalir": "R10 (birleşik model bayrağı PROFIT_KEEP)"}
# dayanikli_taban ilk: kurucu adımı varsayılan olarak ilk şablonu seçer (MVP akışı); öbürleri prototip sırasında
TEMPLATE_IDS = ["gecis_destegi", "dayanikli_taban", "bos_sart", "serbest_piyasa", "pano_destek", "girisime_acik"]
V_PARAM_CARD = {"SHRINK_FIRST": "zararda_once_kucul", "ORDER_BOOK": "siparis_defteri_kredisi", "SB_ENTRY_PERSIST": "kalici_kitlik"}
V_PARAM_CARD_OF = {c: p for p, c in V_PARAM_CARD.items()}
V13 = "simulasyon/kagit-ustu/modulerlestirme/rapor-v13.0.md"
REPO = Path(__file__).resolve().parents[4]


def _deferred() -> dict[str, str]:
    """Eşlemde bu gruplarda olup R1b'nin kartlamadığı kartlar: V/S/Y (R1c), R10 kartları ve önceden var olanlar."""
    out = dict(EXISTING)
    for k, c in read_json(ESLEM)["kartlar"].items():
        if c["bolum"] not in R1B_GROUPS or k in out:
            continue
        if k in R10:
            out[k] = R10[k]
        elif c["layer"] != "P" and k not in ALL_IDS:
            out[k] = "R1c: V/S/Y kartı"
    return out


def _flat(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _flat(v)
    elif isinstance(node, list):
        for v in node:
            yield from _flat(v)



class R1bGroupTests(GroupChecks, unittest.TestCase):
    GROUPS = R1B_GROUPS
    DEFERRED = _deferred()


class R1bSpecificTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.cards = all_cards(cls.reg)
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.eslem = read_json(ESLEM)

    def test_every_r1b_card_present_by_group(self):
        for g, ids in R1B_IDS.items():
            for i in ids:
                with self.subTest(card=i):
                    self.assertIn(i, self.cards)
                    self.assertEqual(self.cards[i].group, g)
        self.assertEqual(len(ALL_IDS), 34)

    def test_template_world_cards_exist(self):
        for i, actor, p in (("siparis_defteri_kredisi", "yerlesik", "ORDER_BOOK"), ("kalici_kitlik", "girisimci", "SB_ENTRY_PERSIST")):
            s = self.cards[i]
            self.assertEqual((s.layer, s.actor, list(s.params), s.scenario_editable, s.apply), ("V", actor, [p], True, evidence_cards().get(i, "unknown")), i)
            self.assertEqual(self.reg.default_ui(s), {"siparis_defteri_kredisi": "hedef_kadro", "kalici_kitlik": "kapali"}[i])

    def test_group_order_and_texts(self):
        want = ["para_faiz", "kredi", "bankacilik", "vergi", "sabit_kalemler", "butce", "kurtarma", "girisim", "loncalar", "fiyat",
                "pano", "konut", "inovasyon", "dunya", "is_piyasasi", "hane_geliri"]        # D6: iş piyasası, D9: hane geliri grubu sona eklendi
        self.assertEqual([g["id"] for g in sorted(self.reg.groups, key=lambda g: g["order"])], want)
        self.assertEqual(len({g["order"] for g in self.reg.groups}), len(want))
        for g in R1B_GROUPS:
            t = self.texts["_gruplar"][g]
            self.assertTrue(t["title"].strip(), g)
            self.assertTrue(t["intro"].strip(), g)
        pub = {g["id"]: g for g in self.reg.public()["groups"]}
        self.assertEqual(pub["butce"]["title"], "Şehir bütçesi")
        self.assertTrue(pub["butce"]["intro"])

    def test_existing_ids_unchanged(self):
        for i in ("gecis_destegi", "ucret_stopaji", "kurumlar_vergisi", "zararda_once_kucul", "dunya_tohumu"):
            self.assertIn(i, self.cards)
        self.assertEqual(self.cards["gecis_destegi"].group, "kurtarma")
        self.assertEqual(self.cards["dunya_tohumu"].group, "dunya")
        self.assertEqual(self.cards["gecis_destegi"].apply, "live")

    def test_apply_unknown_for_all_new_cards(self):
        for i in ALL_IDS:
            self.assertEqual(self.cards[i].apply, evidence_cards().get(i, "unknown"), i)

    def test_passive_cards(self):
        for i in PASSIVE:
            s = self.cards[i]
            with self.subTest(card=i):
                self.assertEqual((s.status, s.editable, list(s.params), list(s.requires)), ("passive", False, [], []))
        for i in set(ALL_IDS) - PASSIVE:
            self.assertEqual(self.cards[i].status, "active", i)
        self.assertEqual(self.cards["sehre_ozel_kural"].layer, "Y")

    def test_only_known_innov_flags_stay_out(self):
        for s in self.cards.values():
            self.assertNotIn("INNOV_ON", s.params)
            self.assertNotIn("LIFE_ON", s.params)

    def test_order_and_multi_cards(self):
        o = self.cards["gider_onceligi"]
        self.assertEqual(o.kind, "multi")                           # model yalnız üyeliğe bakar (ledger.py: kind in MINT_PRIO)
        self.assertEqual(self.reg.default_ui(o), ["issizlik_odenegi", "ciraklik_bursu"])
        self.assertEqual(codec_mod.decode(o.codec, ["ciraklik_bursu", "issizlik_odenegi"]), ("issizlik_odenegi", "ciraklik_bursu"))
        self.assertEqual(codec_mod.decode(o.codec, []), ())         # boş küme geçerli: bütün kalemler yarım pay
        # basım iznini hiç kullanamayan kalemler (kamu hizmet sözleşmesi, geçiş desteği...) sırada yok
        self.assertFalse({"kamu_hizmet_sozlesmesi", "kamu_destek_fonu", "kurulus_fonu_fonlama", "tahvil_faizi"} & set(o.codec["items"]))
        m = self.cards["duzenlenen_sektorler"]
        self.assertEqual(m.kind, "multi")
        self.assertEqual(self.reg.default_ui(m), list(real_defaults()["PV2_REG"]))
        self.assertEqual(codec_mod.decode(m.codec, ["ulasim", "lojistik"]), ("lojistik", "ulasim"))

    def test_inverted_and_enum_codecs(self):
        c = self.cards
        self.assertEqual(codec_mod.decode(c["zarar_eden_firmayi_kurtarma"].codec, "var"), False)    # NO_BAILOUT ters
        self.assertEqual(self.reg.default_ui(c["zarar_eden_firmayi_kurtarma"]), "yok")
        self.assertEqual(codec_mod.decode(c["ozellestirme_durur"].codec, True), 0)                    # TRANS_PRIV_OK=0 -> dursun
        self.assertEqual(self.reg.default_ui(c["ozellestirme_durur"]), True)
        self.assertEqual(codec_mod.decode(c["itibar_sarti"].codec, "yok"), 1)                         # ENTRY_OPEN=1 -> şart yok
        self.assertEqual(self.reg.default_ui(c["itibar_sarti"]), "var")
        self.assertEqual(self.reg.default_ui(c["issizlik_odenegi"]), {"oran": 50, "sure": "hafta_26", "sonra": 40})      # v13.1: 26 hafta
        self.assertEqual(codec_mod.decode(c["issizlik_odenegi"].codec, {"oran": 50, "sure": "suresiz", "sonra": 40})["BENEFIT_WEEKS"], 9999)
        self.assertEqual(self.reg.default_ui(c["telif_orani"]), {"tavan": 10, "uye": "ucte_bir"})

    def test_fund_card_shape(self):
        f = self.cards["kurulus_fonu"]
        self.assertEqual(list(f.params), ["FOUND_FUND", "FF_SHARE"])
        self.assertEqual(list(f.requires), ["FOUND_FUND"])
        self.assertEqual(self.reg.default_ui(f), {"acik": True, "hedef": 50})
        self.assertEqual({e["key"] for e in f.shows}, {"FF_WEEKLY", "FF_FLOOR_WEEKS"})
        rows = {r["label"]: r["text"] for r in self.reg._card_public(f)["shows"]}
        self.assertEqual(rows["Haftalık aktarım üst sınırı (hedefin payı)"], "%15")
        # kredi kartı fonu bu kimlikle anar (W5 fon uyarısı)
        self.assertIn("Kuruluş fonu", self.texts["kredi_kurulus"]["warning"])

    def test_texts_follow_the_model_not_the_prototype(self):
        t = {i: " ".join(_flat(self.texts[i])) for i in ALL_IDS}
        # basım izni: sıra değil üyelik; iznin yarısı; hizmet sözleşmesi ve geçiş desteği iznin dışında (ledger.py _city_limit)
        self.assertIn("yarısını", t["gider_onceligi"])
        self.assertIn("Sıra yoktur", t["gider_onceligi"])
        self.assertIn("altyapı hizmet sözleşmesi", t["gider_onceligi"])
        self.assertIn("kuruluş sermayesi", t["gider_onceligi"])
        self.assertIn("basım iznini hiç kullanamaz", t["gider_onceligi"])
        # düzenlenen sektör kuralı yalnız kamu hizmet sözleşmesi açıkken işler (prices.py PUBSVC koşulu)
        self.assertIn("Kamu hizmet sözleşmesi açıkken", t["duzenlenen_sektorler"])
        self.assertIn("tam maliyet", t["duzenlenen_sektorler"])
        self.assertNotIn("düzenleyici belirler", t["duzenlenen_sektorler"])
        # kasa tabanı yalnız kısa süreli destekte; kurtarma fonunda derin taban (transition.py)
        self.assertIn("Kısa süreli geçiş desteği", t["kasa_tabani"])
        self.assertIn("derin taban", t["kasa_tabani"])
        self.assertIn("derin taban", t["destek_bitis_esigi"])
        # özelleştirme durdurma yalnız kurtarma fonunda (TRANS_SUPPORT == 2)
        self.assertIn("Kurtarma fonuyla geçiş desteği", t["ozellestirme_durur"])
        # kurtarma yokken işleyen kurallar (NO_BAILOUT koşulu)
        for i in ("ozellestirme", "kamu_kar_tamponu", "altyapi_idari_yonetim"):
            self.assertIn("kurtarma yokken", t[i], i)
        self.assertIn("hiç batmaz", t["zarar_eden_firmayi_kurtarma"])
        self.assertIn("kurtarma yokken de batmaz", t["zarar_eden_firmayi_kurtarma"])      # muaf türler (labor.py:315,434)
        self.assertIn("sağlık", t["kamu_kar_tamponu"])
        self.assertIn("sağlık", t["altyapi_idari_yonetim"])
        self.assertIn("Lojistikte", t["duzenlenen_sektorler"])                          # PV2_EXCL: lojistik fiyat döngüsünde değil
        self.assertIn("çıraklık ocağında", t["lonca_sosyal_paket"])                      # WELF_AHIR_MULT (week_open.py:214)
        self.assertIn("sosyal paket kapalıysa", t["issizlik_odenegi"])
        rows = {r["label"]: r["text"] for r in self.reg._card_public(self.cards["asgari_guvence"])["shows"]}
        self.assertEqual(list(rows.values()), ["%70"])
        for i in ALL_IDS:
            for a in self.texts[i].get("aliases", []):
                self.assertNotRegex(a, r"NPC|Fee|fee", i)
        # kuruluş fonu yalnız girişim kapıları açıkken çalışır (week_people.py)
        self.assertIn("kapılar kapalıyken fona para aktarılmaz", t["kurulus_fonu"])
        # girişim kapıları tek anahtar: davranış parçaları da değişir
        self.assertIn("kohort", t["itibar_sarti"])
        self.assertIn("tek bir anahtardır", t["itibar_sarti"])
        # kamu firması tamponu: altyapı ve perakende muaf
        self.assertIn("muaf", t["kamu_kar_tamponu"])
        # asgari güvence sosyal paket kapalıyken işlemez
        self.assertIn("Sosyal paket kapalıyken", t["asgari_guvence"])
        # konut: oturulan ev yok
        self.assertIn("herkes kirada oturur", t["konut_yatirim_siniri"])
        # genç firma programı: fon gerektiren parçalar ayrı söylenir
        self.assertIn("kuruluş fonu gerektirir", t["genc_firma_destegi"])
        # yerli üretim: şehirde hiç firması olmayan sektör
        self.assertIn("hiç firması olmayan", t["yerli_uretim_programi"])
        # lonca programı: kurucu payı sabit
        self.assertIn("yüzde yirmi", t["lonca_arge_payi"])
        # prototipin yanlış kalıpları
        for i, b in t.items():
            self.assertNotIn("2 haftalık", b, i)
            self.assertNotIn("iki haftalık", b, i)

    def test_codec_ranges_follow_the_prototype(self):
        c = self.cards

        def r(i, k=None):
            cd = c[i].codec if k is None else next(f["codec"] for f in c[i].codec["fields"] if f["key"] == k)
            return cd["min"], cd["max"]
        self.assertEqual(r("belediye_istihdami"), (0, 30))
        self.assertEqual(r("kasa_tabani"), (0, 4))
        self.assertEqual(r("destek_tavani"), (0, 60000))
        self.assertEqual(r("destek_bitis_esigi"), (20, 100))
        self.assertEqual(r("kamu_kar_tamponu"), (0.5, 2))
        self.assertEqual(r("kurulus_harci"), (0, 500))
        self.assertEqual(r("yerli_uretim_programi"), (0, 12))
        self.assertEqual(r("lonca_aidat_araligi", "en_az"), (0, 25))
        self.assertEqual(r("konut_yatirim_siniri"), (0, 5))
        self.assertEqual(r("lonca_arge_payi"), (0, 60))
        self.assertEqual(r("patent_suresi"), (52, 400))

    def test_levels_follow_the_prototype(self):
        for i in ("gider_onceligi", "issizlik_odenegi", "belediye_istihdami", "kamu_hizmet_sozlesmesi", "zarar_eden_firmayi_kurtarma",
                  "destek_tavani", "ozellestirme_durur", "itibar_sarti", "genc_firma_destegi", "duzenlenen_sektorler", "lonca_aidat_araligi",
                  "lonca_sosyal_paket", "sektor_panosu", "konut_yatirim_siniri", "lonca_arge_payi", "patent_suresi"):
            self.assertEqual(self.cards[i].level, "A", i)
        for i in ("asgari_guvence", "kasa_tabani", "kurulus_fonu", "destek_bitis_esigi", "ozellestirme", "kamu_kar_tamponu",
                  "altyapi_idari_yonetim", "kurulus_harci", "yerli_uretim_programi", "telif_orani"):
            self.assertEqual(self.cards[i].level, "U", i)

    def test_defaults_come_from_the_model(self):
        d = real_defaults()
        for i, p in (("asgari_guvence", "WELF_CITY_MULT"), ("belediye_istihdami", "MUNI_SPEND"), ("kasa_tabani", "TRANS_FLOOR_WEEKS"),
                     ("destek_tavani", "TRANS_CAP"), ("destek_bitis_esigi", "TRANS_THRESH"), ("kamu_kar_tamponu", "NPC_KEEP"),
                     ("kurulus_harci", "FOUND_HARC"), ("yerli_uretim_programi", "DOMESTIC_EVERY"), ("konut_yatirim_siniri", "HOUSE_INV_MAX"),
                     ("lonca_arge_payi", "PROG_ARGE"), ("patent_suresi", "PATENT_TERM")):
            c = self.cards[i].codec
            self.assertAlmostEqual(self.reg.default_ui(self.cards[i]), d[p] * c["scale"], places=6, msg=i)

    def test_hints_use_v13_and_say_the_world_count(self):
        for i in ("kurulus_fonu", "destek_tavani", "ozellestirme_durur", "kamu_kar_tamponu", "altyapi_idari_yonetim", "itibar_sarti",
                  "genc_firma_destegi", "sektor_panosu"):
            s = self.cards[i]
            with self.subTest(card=i):
                self.assertEqual(s.hint_source, V13)
                self.assertEqual(s.measured_weeks, 200)
                self.assertRegex(self.texts[i]["hint"], r"(Altı|12) başlangıç dünyasında 200 hafta koşuldu")
        self.assertEqual(self.cards["genc_firma_destegi"].measured_with, {"itibar_sarti": "yok"})
        self.assertIsNone(self.cards["itibar_sarti"].measured_with)
        # olgusal: hiç ölçüm yoksa ipucu da yok
        for i in ("gider_onceligi", "issizlik_odenegi", "belediye_istihdami", "kasa_tabani", "lonca_sosyal_paket", "telif_orani"):
            self.assertNotIn("hint", self.texts[i], i)

    def test_every_r1b_card_has_a_basis_label_or_none(self):
        for i in ALL_IDS:
            b = self.texts[i].get("basis")
            if i in PASSIVE:
                self.assertIsNone(b, i)
                continue
            self.assertIsNotNone(b, i)
            self.assertEqual(b["label"], self.reg.dayanaklar["oyuna_ozgu"], i)
        self.assertIn("benzer", self.texts["issizlik_odenegi"]["basis"]["note"])

    def test_eslem_owner_rows_match_registry(self):
        """Eşlemin satırları (#35-#50, #54-#58, #61, #66-#77, #80, #86, #91-#97) kartlarıyla kayıtta uyuşur."""
        owners = {}
        for s in self.eslem["satirlar"]:
            for k in s["kartlar"]:
                owners.setdefault(k, []).append(s["proto"])
        for i in ALL_IDS:
            self.assertIn(i, owners, i)
            self.assertEqual(len(owners[i]), 1, f"{i}: birden çok sahip satırı")


class R1bTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.eslem = {s["kimlik"]: s for s in read_json(ESLEM)["sablonlar"]}
        cls.raw = {t["id"]: t for t in read_json(REAL_DIR / "templates.json")["templates"]}
        cls.cards = all_cards(cls.reg)
        cls.defaults = real_defaults()
        cls.owner = {}
        for s in cls.reg.settings:
            for p in s.params:
                cls.owner[p] = s.id

    def test_six_templates_default_first(self):
        self.assertEqual(list(self.reg.templates), TEMPLATE_IDS)
        self.assertEqual([t["id"] for t in self.reg.public()["templates"]], TEMPLATE_IDS)

    def test_templates_resolve_and_measured_text(self):
        for tid in TEMPLATE_IDS:
            with self.subTest(template=tid):
                r = resolve.resolve(self.reg, self.reg.templates[tid]["values"])
                self.assertEqual(r.errors, [])
                t = self.texts["_sablonlar"][tid]
                for k in ("title", "what", "olcum"):
                    self.assertTrue(t[k].strip(), f"{tid}.{k}")
                src = self.raw[tid].get("measured_source")
                if t["olcum"].startswith("Ölçülmedi"):
                    self.assertIsNone(src)
                else:
                    self.assertTrue(src and (REPO / src).is_file(), f"{tid}: ölçüm kaynağı dosyası yok")
                    if t["olcum"].startswith("Eski ölçüm notu:"):
                        self.assertNotIn(V13, src)
                    else:
                        self.assertEqual(src, V13)
                    self.assertRegex(t["olcum"], r"(Altı|12|altı|eski bir model).*200 hafta|Eski ölçüm notu")
        pub = {t["id"]: t for t in self.reg.public()["templates"]}
        for tid in TEMPLATE_IDS:
            self.assertEqual(pub[tid]["olcum"], self.texts["_sablonlar"][tid]["olcum"])
        self.assertEqual(self.texts["_sablonlar"]["bos_sart"]["olcum"], "Ölçülmedi.")

    def test_template_ids_match_recording_index(self):
        idx = json.loads((REPO / "apps/web/public/oyun-kayit/index.json").read_text(encoding="utf-8"))
        self.assertTrue(idx["templates"])
        for t in idx["templates"]:
            self.assertIn(t["id"], self.reg.templates)
            self.assertEqual(self.reg.templates[t["id"]]["values"], t["values"], t["id"])

    def _effective(self, tid):
        t = self.reg.templates[tid]
        r = resolve.resolve(self.reg, t["values"])
        eff = {**self.defaults, **r.params}
        for wid, wval in t["world_values"].items():
            c = self.cards[wid]
            dv = self.reg.decode(c, wval)
            eff.update(dv if isinstance(dv, dict) else {p: dv for p in c.params})
        return eff

    def _board_open(self, tid):
        return bool(self._effective(tid)["SECTOR_BOARD"])

    def test_template_values_match_the_model_values(self):
        """Şablonun etkin model değerleri (varsayılan + şablon değerleri + dünya varsayımları) K2 `model_degerleri` ile BİREBİR (V dahil)."""
        for tid in TEMPLATE_IDS:
            with self.subTest(template=tid):
                eff = self._effective(tid)
                for k, v in self.eslem[tid]["model_degerleri"].items():
                    self.assertIn(k, self.owner, f"{k}: kartı yok")
                    self.assertTrue(math.isclose(float(eff[k]), float(v), abs_tol=1e-9), f"{tid}: {k} = {eff[k]!r}, olması gereken {v!r}")

    def test_world_assumptions_are_derived_not_hand_written(self):
        for tid in TEMPLATE_IDS:
            self.assertNotIn("behavior_changes", self.raw[tid])
        pub = {t["id"]: t for t in self.reg.public()["templates"]}
        for tid in TEMPLATE_IDS:
            with self.subTest(template=tid):
                md = self.eslem[tid]["model_degerleri"]
                want = [c for c, p in V_PARAM_CARD_OF.items() if p in md and md[p] != self.defaults[p]]
                self.assertEqual(pub[tid]["behavior_changes"], sorted(c for c in want if c != "kalici_kitlik" or self._board_open(tid)))
        # dayanikli_taban hiçbir dünya varsayımını değiştirmez (kayıt dizini eşleşmesi)
        self.assertEqual(pub["dayanikli_taban"]["behavior_changes"], [])
        self.assertEqual(pub["dayanikli_taban"]["world_values"], {})
        # kalıcı kıtlık şartı pano kapalıyken etkisiz: değişen sayılmaz (N3)
        self.assertEqual(pub["bos_sart"]["behavior_changes"], ["siparis_defteri_kredisi", "zararda_once_kucul"])

    def test_startable_set_is_locked(self):
        """Başlatılabilir şablonlar bugünkü kurallarla (`unknown`/pasif kart değeri yok) üçtür; R2 `apply` yazdıkça bu küme büyür."""
        pub = {t["id"]: t for t in self.reg.public()["templates"]}
        self.assertTrue({"dayanikli_taban", "gecis_destegi", "pano_destek"} <= {i for i, t in pub.items() if t["startable"]})      # R2: yeni doğrulanan kartlar şablon açar
        self.assertTrue(set(pub["girisime_acik"]["blocked_by"]) <= {"itibar_sarti"})
        ev = evidence_cards()
        for tid, t in pub.items():                       # engel = kanıtsız (unknown) ya da pasif kart değeri: kanıt dosyası + kayıt durumundan bağımsız hesap
            raw = self.reg.templates[tid]
            want = sorted(k for k in (*raw["values"], *raw["world_values"])
                          if ev.get(k, "unknown") == "unknown" or self.reg.by_id[k].status == "passive")
            self.assertEqual(t["blocked_by"], want, tid)
            self.assertEqual(t["startable"], not want, tid)
        for tid, t in pub.items():
            cfg = {"durationWeeks": 200, "templateId": tid}
            if t["startable"]:
                resolve.run_overrides(self.reg, cfg)
            else:
                with self.assertRaises(RunConfigError) as cm:
                    resolve.run_overrides(self.reg, cfg)
                self.assertTrue({e.id for e in cm.exception.errors} <= set(t["blocked_by"]))

    def test_template_world_values_reach_the_run_in_the_right_order(self):
        reg = self.reg
        saved = dict(reg.by_id), dict(reg.templates)
        try:
            for i in ("siparis_defteri_kredisi", "zararda_once_kucul"):
                reg.by_id[i] = dataclasses.replace(reg.by_id[i], apply="start_only")
            reg.templates["t_x"] = {"id": "t_x", "values": {}, "world_values": {"siparis_defteri_kredisi": "hedef_kadro_kitlik", "zararda_once_kucul": False}}
            p = resolve.run_overrides(reg, {"durationWeeks": 200, "templateId": "t_x"})
            self.assertEqual((p["ORDER_BOOK"], p["SHRINK_FIRST"]), (2, False))
            p = resolve.run_overrides(reg, {"durationWeeks": 200, "templateId": "t_x", "worldScenarioValues": {"siparis_defteri_kredisi": "hedef_kadro"}})
            self.assertEqual(p["ORDER_BOOK"], 1)                       # kullanıcı dünya değeri şablonu ezer
        finally:
            reg.by_id.clear()
            reg.by_id.update(saved[0])
            reg.templates.clear()
            reg.templates.update(saved[1])

    def test_world_values_validation(self):
        from oyun_server.registry.loader import is_world_card
        self.assertFalse(is_world_card(self.cards["ucret_stopaji"]))        # düzenlenebilir P kartı `values`'a yazılır
        self.assertTrue(is_world_card(self.cards["zararda_once_kucul"]))
        self.assertTrue(is_world_card(self.cards["kalici_kitlik"]))
        self.assertEqual(self.cards["kalici_kitlik"].layer, "V")

    def eslem_cards(self):
        return read_json(ESLEM)["kartlar"]

    def test_only_live_safe_or_declared_cards_in_recorded_templates(self):
        # kayıtlı iki şablon (kayıt dizini) yalnız kayıtta değişebilen kartı yazar
        for tid in ("dayanikli_taban", "gecis_destegi"):
            self.assertEqual(set(self.reg.templates[tid]["values"]), {"gecis_destegi"})


class R1bConsistencyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.doc = read_json(REAL_DIR / "tutarlilik.json")
        cls.rules = cls.doc["rules"]

    def test_schema_validator(self):
        """tutarlilik.json biçimi (K1 şeması yok; W9 bunu okur): kesin anahtar kümeleri ve türler."""
        self.assertEqual(set(self.doc), {"version", "note", "rules"})
        self.assertIsInstance(self.doc["note"], str)
        self.assertIsInstance(self.rules, list)
        for r in self.rules:
            with self.subTest(rule=r.get("id")):
                self.assertRegex(r["id"], r"^[a-z][a-z0-9_]*$")
                self.assertEqual(set(r) - {"when", "artan"}, {"id", "textKey"})
                if "when" in r:
                    self.assertIsInstance(r["when"], dict)
                    self.assertTrue(r["when"])
                    for card, val in r["when"].items():
                        self.assertIsInstance(card, str)
                        self.assertNotIsInstance(val, (list, type(None)))
                        if isinstance(val, dict):
                            self.assertTrue(val)
                else:
                    self.assertEqual(set(r["artan"]), {"kart", "alanlar"})
                    self.assertIsInstance(r["artan"]["alanlar"], list)
                    self.assertTrue(all(isinstance(a, str) for a in r["artan"]["alanlar"]))
                    self.assertEqual(len(set(r["artan"]["alanlar"])), len(r["artan"]["alanlar"]))

    def test_file_shape(self):
        self.assertEqual(self.doc["version"], 1)
        ids = [r["id"] for r in self.rules]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(ids), 11)
        for r in self.rules:
            self.assertTrue(("when" in r) != ("artan" in r), r["id"])
            self.assertRegex(r["textKey"], r"^_uyarilar\.[a-z_]+$")

    def test_consistency_rules_reference_known_cards(self):
        by = self.reg.by_id
        for r in self.rules:
            with self.subTest(rule=r["id"]):
                if "when" in r:
                    for card, val in r["when"].items():
                        self.assertIn(card, by)
                        s = by[card]
                        self.assertTrue(s.editable and s.status in ("active", "experimental"), f"{card}: düzenlenemeyen karta kural bağlanmaz")
                        if isinstance(val, dict):
                            self.assertEqual(s.codec["type"], "fields")
                            keys = {f["key"]: f for f in s.codec["fields"]}
                            self.assertTrue(val and set(val) <= set(keys))
                            for k, v in val.items():
                                codec_mod.decode(keys[k]["codec"], v)
                        else:
                            codec_mod.decode(s.codec, val)
                else:
                    a = r["artan"]
                    self.assertIn(a["kart"], by)
                    s = by[a["kart"]]
                    self.assertEqual(s.codec["type"], "fields")
                    keys = {f["key"]: f for f in s.codec["fields"]}
                    self.assertGreaterEqual(len(a["alanlar"]), 2)
                    for k in a["alanlar"]:
                        self.assertEqual(keys[k]["codec"]["type"], "number", k)

    def test_texts_exist_and_all_used(self):
        keys = {r["textKey"].split(".", 1)[1] for r in self.rules}
        have = set(self.texts["_uyarilar"])
        self.assertEqual(sorted(keys - have), [])
        self.assertEqual(sorted(have - keys), [])
        for k in have:
            self.assertTrue(self.texts["_uyarilar"][k].strip())

    def test_no_rule_fires_in_the_default_state(self):
        """Varsayılan durumda uyarı çıkmamalı (gürültü olmasın)."""
        by = self.reg.by_id
        for r in self.rules:
            with self.subTest(rule=r["id"]):
                if "when" in r:
                    fire = True
                    for card, val in r["when"].items():
                        have = self.reg.default_ui(by[card])
                        if isinstance(val, dict):
                            fire = fire and all(have[k] == v for k, v in val.items())
                        else:
                            fire = fire and have == val
                    self.assertFalse(fire)
                else:
                    have = self.reg.default_ui(by[r["artan"]["kart"]])
                    vals = [have[k] for k in r["artan"]["alanlar"]]
                    self.assertEqual(vals, sorted(vals))

    def test_rule_set_covers_the_real_conflicts(self):
        ids = {r["id"] for r in self.rules}
        for want in ("kurtarma_var_gecis_kisa", "kurtarma_var_gecis_fon", "kurtarma_var_ozellestirme", "kurtarma_var_altyapi",
                     "kamu_hizmet_kapali", "fon_kapali_genc", "sosyal_paket_kapali", "aralik_tarafsiz_faiz", "aralik_kredi_ortak",
                     "aralik_lonca_aidat", "genc_itibar_var"):
            self.assertIn(want, ids)

    def test_ordered_fields_are_ordered_by_default_in_the_model(self):
        d = real_defaults()
        self.assertLessEqual(d["POL_MIN"], d["POL_MAX"])
        self.assertLessEqual(d["CX_RATE_MIN"], d["LOAN_RATE"])
        self.assertLessEqual(d["FEE_MIN"], d["FEE_MAX"])


if __name__ == "__main__":
    unittest.main()
