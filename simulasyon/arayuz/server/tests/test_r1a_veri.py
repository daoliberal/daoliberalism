"""R1a: kural kartlarının ilk grubu (Para ve faiz, Kredi, Bankacılık, Vergiler, Dünyanın sabit kalemleri)."""
from __future__ import annotations

import re
import unittest

from oyun_server.registry import hints

from tests.group_checks import GroupChecks, all_cards
from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry, evidence_cards

R1A_GROUPS = ("para_faiz", "kredi", "bankacilik", "vergi", "sabit_kalemler")
R1A_IDS = {
    "para_faiz": ["basim_tavani", "acilis_donemi", "sehir_tahvili", "kasa_dengeleme", "faiz_kurali", "enflasyon_hedefi",
                  "dogal_issizlik_kurali", "kredi_canliligi_hedefi", "mevduat_faizi_tavani", "tarafsiz_faiz"],
    "kredi": ["kredi_kurulus", "kredi_genc", "kredi_dayanma", "kredi_buyume", "kredi_yatirim", "kredi_arge", "kredi_devir",
              "kredi_kopru", "kredi_konut", "kredi_medya", "kredi_ortak", "kredi_varyant", "temerrut_esigi"],
    "bankacilik": ["lonca_kaldirac_siniri", "mevduat_nakit_rezervi"],
    "vergi": ["satis_vergisi", "ucret_stopaji", "kurumlar_vergisi", "temettu_stopaji", "yuksek_ucret_vergisi",
              "lonca_sahibi_stopaji", "konut_islem_harci", "kira_geliri_vergisi", "servet_vergisi", "butce_izleyen_kdv"],
    "sabit_kalemler": ["dunya_sabit_kalemleri"],
}
CREDIT_TYPES = {"kredi_kurulus": "kurulus", "kredi_genc": "genc", "kredi_dayanma": "dayanma", "kredi_buyume": "buyume",
                "kredi_yatirim": "yatirim", "kredi_arge": "arge", "kredi_devir": "devir", "kredi_kopru": "kopru",
                "kredi_konut": "konut", "kredi_medya": "medya"}
LIVE_IDS = {"gecis_destegi", "ucret_stopaji", "kurumlar_vergisi"}
ALL_IDS = [i for g in R1A_IDS.values() for i in g]
V13 = "simulasyon/kagit-ustu/modulerlestirme/rapor-v13.0.md"



class R1aGroupTests(GroupChecks, unittest.TestCase):
    GROUPS = R1A_GROUPS
    # R10 kartı: prototipin "Kredi parası" satırı birleşik modelde CREDIT_MONEY; kendi görevinde kartlanır
    DEFERRED = {"kredi_para": "R10: kredide para yaratımı (birleşik model bayrağı)"}


class R1aSpecificTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.cards = all_cards(cls.reg)
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_every_r1a_card_present_by_group(self):
        for g, ids in R1A_IDS.items():
            for i in ids:
                with self.subTest(card=i):
                    self.assertIn(i, self.cards)
                    self.assertEqual(self.cards[i].group, g)
        self.assertEqual(len(ALL_IDS), 36)

    def test_groups_declared_with_titles(self):
        gids = {g["id"] for g in self.reg.groups}
        for g in R1A_GROUPS:
            self.assertIn(g, gids)
            self.assertTrue(self.texts["_gruplar"][g]["title"].strip())

    def test_kredi_para_not_in_r1a(self):
        self.assertIn("kredi_para", self.cards)          # R10 kartladı; R1a grubunda değil: DEFERRED ile dışlanır
        self.assertIn("kurulus_fonu", self.cards)        # R1b (butce grubunda)
        self.assertEqual(self.cards["kurulus_fonu"].group, "butce")

    def test_apply_classes(self):
        for i in ALL_IDS:
            with self.subTest(card=i):
                want = "live" if i in LIVE_IDS else evidence_cards().get(i, "unknown")
                self.assertEqual(self.cards[i].apply, want)
        self.assertEqual(self.cards["gecis_destegi"].apply, "live")
        for i in ("ucret_stopaji", "kurumlar_vergisi"):
            self.assertTrue(self.cards[i].editable)

    def test_credit_types(self):
        for i, ct in CREDIT_TYPES.items():
            self.assertEqual(self.cards[i].credit_type, ct, i)
        for i in ALL_IDS:
            if i not in CREDIT_TYPES:
                self.assertIsNone(self.cards[i].credit_type, i)

    def test_passive_and_readonly_cards(self):
        s = self.cards["kredi_varyant"]
        self.assertEqual((s.status, s.editable, list(s.params), list(s.requires)), ("passive", False, [], []))
        a = self.cards["kredi_arge"]          # K1-ek: etkin, salt okunur, ayarı yok; ortak kuralları gösterir
        self.assertEqual((a.status, a.editable, list(a.params), list(a.requires)), ("active", False, [], []))
        self.assertEqual([(e["key"], e["unit"]) for e in a.shows],
                         [("CX_INV_K", "kat"), ("CX_MIN_AGE", "hafta"), ("CX_MIN_OREP", "sayi")])
        rows = {r["label"]: r["text"] for r in self.reg._card_public(a)["shows"]}
        self.assertEqual(rows["Limit (haftalık kârın kaç katı)"], "40 kat")
        sk = self.cards["dunya_sabit_kalemleri"]
        self.assertEqual({e["key"] for e in sk.shows}, {"LC_FIXED", "LC_MEMBER", "HOUSE_LABOR", "HOUSE_PLOT"})
        srows = [r["text"] for r in self.reg._card_public(sk)["shows"]]
        self.assertEqual(srows, ["400 Akçe", "8 Akçe", "%25", "%10"])
        s = self.cards["dunya_sabit_kalemleri"]
        self.assertFalse(s.editable)
        self.assertEqual(s.status, "active")
        self.assertEqual(list(s.params), ["HOUSE_MAINT"])
        fixed = {r["settingId"]: r["valueText"] for r in self.reg.fixed_rules()}
        self.assertEqual(fixed["dunya_sabit_kalemleri"], "%10")

    def test_every_r1a_card_has_a_basis_label(self):
        # dayanak yalnız gerçekten dayanılan model; faiz kuralı Taylor kuralına, geri kalanı oyuna özgü
        taylor = {"faiz_kurali", "enflasyon_hedefi", "dogal_issizlik_kurali", "tarafsiz_faiz"}
        self.assertNotIn("basis", self.texts["kredi_varyant"])         # modelde yok: dayanılacak model da yok
        for i in ALL_IDS:
            if i == "kredi_varyant":
                continue
            b = self.texts[i].get("basis")
            with self.subTest(card=i):
                self.assertIsNotNone(b)
                want = "Taylor kuralı" if i in taylor else self.reg.dayanaklar["oyuna_ozgu"]
                self.assertEqual(b["label"], want)

    def test_founding_credit_points_to_the_fund_card(self):
        w = self.texts["kredi_kurulus"].get("warning", "")
        self.assertIn("Kuruluş fonu", w)
        self.assertIn("girişim kapıları", w)

    def test_shared_credit_conditions_are_said(self):
        for i in ("kredi_buyume", "kredi_yatirim"):
            blob = " ".join(str(v) for v in _flat(self.texts[i]))
            self.assertIn("Ar-Ge", blob, i)
        self.assertIn("Yatırım", " ".join(_flat(self.texts["kredi_buyume"])))
        self.assertIn("büyüme", " ".join(_flat(self.texts["kredi_yatirim"])).lower())
        self.assertIn("medya", " ".join(_flat(self.texts["kredi_buyume"]["fields"]["itibar"])).lower())

    def test_texts_follow_the_model_not_the_prototype(self):
        blob = {i: " ".join(_flat(self.texts[i])) for i in ALL_IDS}
        for i, b in blob.items():
            self.assertNotIn("2 haftalık", b, i)               # işletme sermayesi iki döngüdür, iki hafta değil
            self.assertNotIn("iki haftalık", b, i)
        # yönetici/uzman ve araştırmacı vergisi stopajın üstüne eklenmez; bu kişilere stopaj uygulanmaz
        self.assertNotIn("üstüne eklenir", blob["yuksek_ucret_vergisi"])
        self.assertIn("stopaj", blob["yuksek_ucret_vergisi"].lower())
        self.assertIn("yönetici", blob["ucret_stopaji"].lower())
        # faiz tavanı itibar çarpanı ve risk payından önce uygulanır
        self.assertIn("aşabilir", blob["kredi_ortak"])
        # politika kapalıyken politika faizi yoktur; kredi tabanı mevduat faizidir
        self.assertIn("mevduat faizi", blob["faiz_kurali"])
        self.assertNotIn("tarafsız faizde kalır", blob["faiz_kurali"])
        # tavan etkisiz: asıl mevduat faizi piyasada oluşur
        self.assertIn("piyasa", blob["mevduat_faizi_tavani"])
        # kira vergisi bakım payından sonra uygulanır
        self.assertIn("bakım", blob["kira_geliri_vergisi"])
        # sabit kalemler: kira bakım payı, lonca giderleri, konut emek ve arsa payı
        for k in ("bakım", "lonca", "arsa"):
            self.assertIn(k, blob["dunya_sabit_kalemleri"].lower())

    def test_corrections_round_1(self):
        t = {i: " ".join(_flat(self.texts[i])) for i in ALL_IDS}
        # kredi canlılığı: oran hedefin ALTINDAyken faiz YÜKSELİR (policy.py: - POL_A_CD * (cd - POL_CD_STAR))
        self.assertIn("altındaysa yükselir", t["kredi_canliligi_hedefi"])
        self.assertNotIn("faiz tabana doğru iner", t["kredi_canliligi_hedefi"])
        self.assertIsNone(self.cards["kredi_canliligi_hedefi"].measured_at)
        self.assertNotIn("hint", self.texts["kredi_canliligi_hedefi"])
        eslem = read_json(REAL_DIR / "prototip_eslem.json")["kartlar"]["kredi_canliligi_hedefi"]
        self.assertIn("K-185.18", eslem.get("not", ""))                     # geliştirici notu; oyuncu metninde K-nn yok
        # yatırım kredisi: varsayılan yol yuva alımı (CAPEX); doğrudan kapasite artışı yalnız yuva kapalıyken
        self.assertIn("yuva", t["kredi_yatirim"])
        self.assertIn("Yuva yatırımı kapalıysa", t["kredi_yatirim"])
        # büyüme kredisi yaş şartı genç sayılma süresinde muaf
        self.assertIn("genç sayılma süresi", " ".join(_flat(self.texts["kredi_buyume"]["fields"]["yas"])))
        self.assertEqual(self.cards["kredi_buyume"].codec["fields"][1]["codec"]["max"], 104)
        # politika işsizliği yalnız iş arayanlardan
        self.assertNotIn("çıraklık", t["dogal_issizlik_kurali"])
        self.assertIn("iş arayanların", t["dogal_issizlik_kurali"])
        # lonca sabit gideri üye sayısıyla ölçeklenir
        self.assertIn("ölçeklenir", t["dunya_sabit_kalemleri"])
        # limit birimi kat
        for i, k in (("kredi_yatirim", None), ("kredi_buyume", "kar_kati")):
            c = self.cards[i].codec if k is None else next(f["codec"] for f in self.cards[i].codec["fields"] if f["key"] == k)
            self.assertEqual(c["unit"], "kat", i)
        # NPC_LEV iki kartta
        self.assertIn("devir", t["kredi_kopru"])
        self.assertIn("köprü", t["kredi_devir"])
        # kurumlar vergisi kapsamı
        self.assertIn("dağıtılan tutar", t["kurumlar_vergisi"])
        self.assertIn("özelleştirilmiş", t["kurumlar_vergisi"])

    def test_corrections_round_2(self):
        t = {i: " ".join(_flat(self.texts[i])) for i in ALL_IDS}
        a = self.cards["kredi_arge"]
        self.assertIs(a.default, True)                       # CX_ACT=True: etkin salt okunur kart "kapalı" görünmez
        self.assertIn("muaf", t["kredi_arge"])
        self.assertIn("devralınan", " ".join(_flat(self.texts["kredi_buyume"]["fields"]["yas"])))
        self.assertIn("teminat", t["kredi_devir"])
        self.assertIn("ileri ve çabuk", t["kredi_canliligi_hedefi"])
        self.assertIn("faiz adımı", t["kredi_canliligi_hedefi"])
        self.assertNotIn("dağıtılabilir", t["kurumlar_vergisi"])
        self.assertNotIn("NPC", " ".join(self.texts["kredi_kopru"]["aliases"]))

    def test_codec_ranges_follow_the_prototype(self):
        c = self.cards
        r = lambda i, k=None: (c[i].codec if k is None else next(f["codec"] for f in c[i].codec["fields"] if f["key"] == k))
        self.assertEqual((r("ucret_stopaji")["min"], r("ucret_stopaji")["max"]), (0, 25))
        self.assertEqual((r("kurumlar_vergisi")["min"], r("kurumlar_vergisi")["max"]), (0, 40))
        self.assertEqual((r("basim_tavani")["min"], r("basim_tavani")["max"]), (0, 10))
        self.assertEqual((r("satis_vergisi")["min"], r("satis_vergisi")["max"]), (0, 10))
        self.assertEqual((r("lonca_kaldirac_siniri")["min"], r("lonca_kaldirac_siniri")["max"]), (10, 40))
        self.assertEqual((r("mevduat_nakit_rezervi")["min"], r("mevduat_nakit_rezervi")["max"]), (0, 50))
        self.assertEqual((r("kredi_ortak", "vade")["min"], r("kredi_ortak", "vade")["max"]), (26, 156))
        self.assertEqual((r("sehir_tahvili", "vade")["min"], r("sehir_tahvili", "vade")["max"]), (52, 156))

    def test_levels_follow_the_prototype(self):
        for i in ("basim_tavani", "faiz_kurali", "enflasyon_hedefi", "kredi_kurulus", "kredi_genc", "lonca_kaldirac_siniri",
                  "satis_vergisi", "ucret_stopaji", "kurumlar_vergisi"):
            self.assertEqual(self.cards[i].level, "A", i)
        for i in ("acilis_donemi", "kredi_canliligi_hedefi", "tarafsiz_faiz", "mevduat_faizi_tavani", "servet_vergisi"):
            self.assertEqual(self.cards[i].level, "U", i)

    def test_measured_hints_are_context_bound(self):
        # v13.0 ölçümü: yalnız bu iki vergi; ölçüm bağlamı model varsayılanı (geçiş desteği açık)
        for i, vals in (("ucret_stopaji", [10, 0]), ("kurumlar_vergisi", [20, 0])):
            s = self.cards[i]
            self.assertEqual(s.measured_at, vals, i)
            self.assertEqual((s.measured_weeks, s.hint_source), (200, V13), i)
            for v in vals:
                self.assertTrue(hints.hint_applies(self.reg, s, v, {"values": {}, "weeks": 200}), (i, v))
            self.assertFalse(hints.hint_applies(self.reg, s, vals[0], {"values": {}, "weeks": 100}), i)
            self.assertFalse(hints.hint_applies(self.reg, s, vals[0], {"values": {"gecis_destegi": "kapali"}, "weeks": 200}), i)
            self.assertFalse(hints.hint_applies(self.reg, s, 7.5, {"values": {}, "weeks": 200}), i)
        other = [i for i in ALL_IDS if self.cards[i].measured_at is not None]
        self.assertEqual(sorted(other), ["kurumlar_vergisi", "ucret_stopaji"])

    def test_vergi_hints_keep_one_percent_style(self):
        for i in ("ucret_stopaji", "kurumlar_vergisi"):
            h = self.texts[i]["hint"]
            self.assertNotIn("yüzde", h.lower(), i)            # '%' ve 'yüzde' karışık kullanılmaz
            self.assertTrue(re.search(r"%\d", h), i)

    def test_old_notes_carry_a_source(self):
        for i in ALL_IDS:
            t = self.texts[i]
            if t.get("hint", "").startswith("Eski ölçüm notu:"):
                self.assertTrue(self.cards[i].hint_source, i)
                self.assertIsNone(self.cards[i].measured_at, i)

    def test_hidden_flags_not_registered(self):
        names = {p for s in (*self.reg.settings, *self.reg.hidden) for p in s.params}
        self.assertFalse({"INNOV_ON", "LIFE_ON"} & names)

    def test_defaults_come_from_the_model(self):
        d = real_defaults()
        spot = {"basim_tavani": 2, "ucret_stopaji": 10, "kurumlar_vergisi": 20, "satis_vergisi": 3, "mevduat_nakit_rezervi": 20,
                "lonca_kaldirac_siniri": 25, "temettu_stopaji": 30, "temerrut_esigi": 6, "kasa_dengeleme": 25}
        for i, v in spot.items():
            self.assertAlmostEqual(self.reg.default_ui(self.cards[i]), v, places=6, msg=i)
        self.assertEqual(d["WAGE_TAX"], 0.1)
        self.assertEqual(self.reg.default_ui(self.cards["faiz_kurali"]), "kural")


def _flat(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _flat(v)
    elif isinstance(node, list):
        for v in node:
            yield from _flat(v)


if __name__ == "__main__":
    unittest.main()
