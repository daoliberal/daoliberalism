"""R10: model modülü kartları (K-218 kredi para yaratır, K-219 şehir kasası kuralı, K-220 kâr firmada kalır, RATE_BEHAV, ENTRY_EXP)
ve "yeni bayrak" akışı (baseline'dan çıkar, kart ekle, kapsam kapısı yeşil)."""
from __future__ import annotations

import contextlib
import io
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from oyun_server.registry import loader

from tests.group_checks import ESLEM, GroupChecks
from tests.registry_helpers import REAL_DIR, copy_data, read_json, real_defaults, real_registry, write_json, evidence_cards

R10 = {
    "kredi_para": "R10 (K-218, CREDIT_MONEY)",
    "sehir_kasasi_kurali": "R10 (K-219, TREASURY_RULE)",
    "kar_firmada_kalir": "R10 (K-220, PROFIT_KEEP)",
    "faize_duyarli_davranis": "R10 (RATE_BEHAV)",
    "beklenen_kar_girisim": "R10 (ENTRY_EXP)",
}
FLAGS = {"kredi_para": "CREDIT_MONEY", "sehir_kasasi_kurali": "TREASURY_RULE", "kar_firmada_kalir": "PROFIT_KEEP",
         "faize_duyarli_davranis": "RATE_BEHAV", "beklenen_kar_girisim": "ENTRY_EXP"}
# Ölçüm ve yol adları kartlanmaz: baseline'da kalır
KARTSIZ = ("CM_CSV", "KK_MEAS", "CM_QWEEKS", "PK_RBAR_EMA")
REPO = Path(__file__).resolve().parents[4]
OZEL_DOSYA = REAL_DIR / "settings.yeni-modul.json"



class R10Group(GroupChecks, unittest.TestCase):
    GROUPS = ("para_faiz", "butce", "hane", "girisimci")

    @classmethod
    def eslem_cards(cls) -> dict:
        kartlar = read_json(ESLEM)["kartlar"]
        return {k: kartlar[k] for k in R10}


class R10Specific(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.cards = cls.reg.by_id
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")
        cls.d = real_defaults()

    def test_cards_in_registry_with_layers(self):
        for k in R10:
            self.assertIn(k, self.cards, k)
        self.assertEqual((self.cards["kredi_para"].layer, self.cards["kredi_para"].group), ("P", "para_faiz"))
        for k in ("sehir_kasasi_kurali", "kar_firmada_kalir"):
            self.assertEqual((self.cards[k].layer, self.cards[k].group), ("P", "butce"))
        self.assertEqual((self.cards["faize_duyarli_davranis"].layer, self.cards["faize_duyarli_davranis"].actor), ("V", "hane"))
        self.assertEqual((self.cards["beklenen_kar_girisim"].layer, self.cards["beklenen_kar_girisim"].actor), ("V", "girisimci"))
        for k in ("faize_duyarli_davranis", "beklenen_kar_girisim"):
            self.assertTrue(self.cards[k].scenario_editable, k)
        for k in ("kredi_para", "sehir_kasasi_kurali", "kar_firmada_kalir"):
            self.assertFalse(self.cards[k].scenario_editable, k)
        for k in R10:
            self.assertEqual(self.cards[k].apply, evidence_cards().get(k, "unknown"), k)
            self.assertTrue(self.cards[k].editable, k)

    def test_params_exact(self):
        want = {"kredi_para": ["CREDIT_MONEY", "CM_RESERVE", "CM_BRAKE", "CM_PD"],
                "sehir_kasasi_kurali": ["TREASURY_RULE", "TR_WEEKS", "TR_CONV"],
                "kar_firmada_kalir": ["PROFIT_KEEP", "PK_WEEKS"],
                "faize_duyarli_davranis": ["RATE_BEHAV", "RB_CREDIT"],
                "beklenen_kar_girisim": ["ENTRY_EXP"]}
        for k, p in want.items():
            self.assertEqual(list(self.cards[k].params), p, k)
        every = {p for s in self.reg.settings for p in s.params}
        for n in KARTSIZ:
            self.assertNotIn(n, every, f"{n} ölçüm/yol adı kartlanmaz")

    def test_new_module_cards_default_off(self):
        for k, flag in FLAGS.items():
            with self.subTest(card=k):
                s = self.cards[k]
                self.assertFalse(self.d[flag], f"{flag} modelde varsayılan kapalı olmalı")
                ui = self.reg.default_ui(s)
                self.assertIs(ui["acik"] if isinstance(ui, dict) else ui, False)

    def test_entry_exp_has_warning(self):
        t = self.texts["beklenen_kar_girisim"]
        self.assertEqual(t["warning"], "Ölçümlerde zararlı çıktı: açıldığı her birleşimde çöküş erkene çekildi, yeni firmaların çoğu ilk yılda battı.")
        for k in R10:
            if k != "beklenen_kar_girisim":
                self.assertNotIn("warning", self.texts[k], k)

    def test_basis_only_dayanaklar(self):
        labels = self.reg.dayanaklar["labels"]
        for k in R10:
            b = self.texts[k]["basis"]
            self.assertIn(b["label"], labels, k)
        want = {"kredi_para": "Caiani ve ark. 2016", "kar_firmada_kalir": "Caiani ve ark. 2016"}
        for k, lab in want.items():
            self.assertEqual(self.texts[k]["basis"]["label"], lab, k)
        self.assertEqual(self.texts["kredi_para"]["basis"]["note"],
                         "Kaldıraç sınırı (25) BAM Engine (10), Caiani ve ark. (yaklaşık 17) ve BeforeIT (yaklaşık 33) aralığında")

    def test_rate_behav_basis_is_game_specific(self):
        b = self.texts["faize_duyarli_davranis"]["basis"]
        self.assertEqual(b["label"], self.reg.dayanaklar["oyuna_ozgu"])
        self.assertEqual(b["note"], "Kalibrasyon: Havranek 2015; Kaplan ve Violante 2014")
        self.assertEqual(self.texts["beklenen_kar_girisim"]["basis"]["label"], self.reg.dayanaklar["oyuna_ozgu"])

    def test_new_module_hints_have_context(self):
        for k in R10:
            with self.subTest(card=k):
                s = self.cards[k]
                self.assertTrue(self.texts[k].get("hint"), "ipucu yok")
                self.assertIsNotNone(s.measured_at)
                self.assertEqual(s.measured_weeks, 200)
                self.assertTrue(s.measured_with, "ölçüm bağlamı (measured_with) boş")
                self.assertNotIn("_sablon", s.measured_with)
                self.assertNotIn(k, s.measured_with)
                self.assertTrue(set(s.measured_with) <= set(R10) - {k}, "bağlam yalnız öbür modül kartlarını gösterir")
                self.assertEqual(s.hint_source, "simulasyon/kagit-ustu/modulerlestirme/rapor-birlesik-olcum.md")
                self.assertTrue((REPO / s.hint_source).is_file())
                self.assertNotIn("Eski ölçüm notu", self.texts[k]["hint"])
                self.assertIn("12 başlangıç dünyasında", self.texts[k]["hint"])

    def test_tr_hint_is_the_brief_example(self):
        self.assertEqual(
            self.texts["sehir_kasasi_kurali"]["hint"],
            "12 başlangıç dünyasında ölçüldü: hiç çökmeyen dünya sayısı tabanla aynı kaldı (12 dünyanın yedisi); "
            "son 30 haftada talebi yarıdan fazla karşılayan dünya sayısı dokuzdan on ikiye çıktı. Fark küçük: ölçüm gürültüsü içinde.")

    def test_hints_apply_in_measured_context(self):
        from oyun_server.registry import hints
        reg = self.reg
        for k in R10:
            s = reg.by_id[k]
            val = reg.measured_values(s)[0]
            ctx = {"values": {o: v for o, v in (s.measured_with or {}).items()}, "weeks": 200}
            self.assertTrue(hints.hint_applies(reg, s, val, ctx), k)
            self.assertFalse(hints.hint_applies(reg, s, val, {"values": ctx["values"], "weeks": 100}), k)

    def test_requires_missing_hides_card(self):
        for k, flag in FLAGS.items():
            with self.subTest(card=k):
                d = dict(self.d)
                del d[flag]
                reg = loader.load_registry(REAL_DIR, d)
                self.assertNotIn(k, reg.by_id)
                self.assertIn(k, [s.id for s in reg.hidden])
                self.assertNotIn(k, [c["id"] for c in reg.public()["cards"]])

    def test_cards_in_public(self):
        pub = {c["id"]: c for c in self.reg.public()["cards"]}
        for k in R10:
            self.assertIn(k, pub)
        self.assertEqual(pub["beklenen_kar_girisim"]["warning"][:18], "Ölçümlerde zararlı")

    def test_baseline_no_longer_lists_card_params(self):
        base = set(read_json(REAL_DIR / "coverage_baseline.json")["names"])
        every = {p for k in R10 for p in self.cards[k].params}
        self.assertEqual(base & every, set())
        for n in KARTSIZ:
            self.assertIn(n, base)

    def test_plain_language_and_range(self):
        t = self.texts["kredi_para"]
        self.assertIn("Lonca kredi verdiğinde yeni Akçe yaratılır, geri ödemede yok olur", t["what"])
        self.assertIn("sınır loncanın sermayesinin 25 katıdır", t["what"])
        self.assertIn("yıllık güvenlik freni", t["what"])

    def test_r2_start_only_note_for_income_kinds(self):
        note = read_json(REAL_DIR / "r2_apply_notlari.json")
        by = {e["param"]: e for e in note["start_only"]}
        self.assertEqual(by["TREASURY_RULE"]["kart"], "sehir_kasasi_kurali")
        self.assertEqual(by["PROFIT_KEEP"]["kart"], "kar_firmada_kalir")
        for p in ("TREASURY_RULE", "PROFIT_KEEP"):
            self.assertIn("INCOME_KINDS", by[p]["neden"])
            self.assertRegex(by[p]["neden"], r"params\.py:\d+")

    def test_eslem_rows_are_cards(self):
        es = read_json(ESLEM)
        for r in es["satirlar"]:
            if r["kartlar"] and set(r["kartlar"]) & set(R10):
                self.assertEqual(r["durum"], "kart", r["proto"])
        r5 = [r for r in es["satirlar"] if r.get("no") == 5][0]
        self.assertEqual((r5["durum"], r5["kartlar"]), ("kart", ["kredi_para"]))


class R10Duzeltme1(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_hint_false_when_context_card_missing_from_registry(self):
        """Önemli 1: ölçüm bağlamındaki kart kayıtta yoksa ipucu gösterilmez."""
        from oyun_server.registry import hints
        d = dict(real_defaults())
        del d["CREDIT_MONEY"]
        reg = loader.load_registry(REAL_DIR, d)
        for k in ("sehir_kasasi_kurali", "kar_firmada_kalir", "faize_duyarli_davranis", "beklenen_kar_girisim"):
            s = reg.by_id[k]
            ctx = {"values": dict(s.measured_with), "weeks": 200}
            self.assertFalse(hints.hint_applies(reg, s, reg.measured_values(s)[0], ctx), k)
        self.assertTrue(hints.hint_applies(self.reg, self.reg.by_id["kar_firmada_kalir"], self.reg.measured_values(self.reg.by_id["kar_firmada_kalir"])[0],
                                           {"values": dict(self.reg.by_id["kar_firmada_kalir"].measured_with), "weeks": 200}))

    def test_sehir_basis_is_game_specific_with_similarity_note(self):
        b = self.texts["sehir_kasasi_kurali"]["basis"]
        self.assertEqual(b["label"], self.reg.dayanaklar["oyuna_ozgu"])
        self.assertEqual(b["note"], "Benzerlik: BeforeIT ve Caiani ve ark. 2016 devlet bloğunda devlet nakit biriktirmez; harcama gelire ve borçlanmaya bağlıdır.")

    def test_kar_basis_note_names_accumulation_rule(self):
        n = self.texts["kar_firmada_kalir"]["basis"]["note"]
        self.assertEqual(n, "Tampon Caiani'deki bir çeyreklik ücret bütçesinden (yaklaşık 8 haftalık toplam gider) türetildi; kapasite büyümesi Caiani birikim kuralıdır "
                            "(katsayılar 0,01 ve 0,02, hedef kullanım 0,8).")

    def test_kar_text_covers_player_firm(self):
        self.assertIn("Oyuncu firmaları da en az bu tamponu tutar; temettü tamponun üstünden ödenir.", self.texts["kar_firmada_kalir"]["what"])

    def test_pk_weeks_start_only(self):
        by = {e["param"]: e for e in read_json(REAL_DIR / "r2_apply_notlari.json")["start_only"]}
        self.assertEqual(by["PK_WEEKS"]["kart"], "kar_firmada_kalir")
        self.assertIn("cash_core.py:9", by["PK_WEEKS"]["neden"])

    def test_rate_behav_has_no_decision(self):
        import json as _j
        raw = {c["id"]: c for c in read_json(OZEL_DOSYA)["settings"]}
        self.assertNotIn("decision", raw["faize_duyarli_davranis"])
        self.assertNotIn("decision", raw["beklenen_kar_girisim"])

    def test_minor_texts(self):
        self.assertIn("gevşek", self.texts["sehir_kasasi_kurali"]["changes"])
        self.assertIn("iki hafta", self.texts["sehir_kasasi_kurali"]["changes"])

    def test_effective_when_published(self):
        pub = {c["id"]: c for c in self.reg.public()["cards"]}
        self.assertEqual(pub["kalici_kitlik"]["effective_when"], {"sektor_panosu": True, "itibar_sarti": "var"})
        for k, c in pub.items():
            if c["layer"] != "V" or not self.reg.by_id[k].effective_when:
                self.assertNotIn("effective_when", c, k)


class NewFlagFlow(unittest.TestCase):
    """Yeni bayrak akışı: baseline'dan çıkarılmış ad kartsızsa kapsam kapısı kırmızı, kart eklenince yeşil."""

    def _check(self, d: Path) -> tuple[int, str]:
        import tools_registry_coverage as cov
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = cov.main(["--check", "--data-dir", str(d)])
        return rc, buf.getvalue()

    def test_new_flag_flow(self):
        with tempfile.TemporaryDirectory() as td:
            full = copy_data(Path(td) / "tam")
            self.assertEqual(self._check(full)[0], 0)
            # kartsız kopya: kredi_para dosyadan çıkar (ad baseline'da da yok)
            eksik = copy_data(Path(td) / "eksik", drop=("kredi_para",))
            yeni = read_json(eksik / "settings.yeni-modul.json")
            yeni["settings"] = [c for c in yeni["settings"] if c["id"] != "kredi_para"]
            for c in yeni["settings"]:
                c["measured_with"].pop("kredi_para", None)        # düşen kart öbürlerinin ölçüm bağlamında kalmaz
            write_json(eksik / "settings.yeni-modul.json", yeni)
            rc, out = self._check(eksik)
            self.assertEqual(rc, 1)
            self.assertIn("CREDIT_MONEY", out)
            # kart geri eklenince kapı yeşil ve kart public()'te
            cards = read_json(OZEL_DOSYA)["settings"]
            kart = [c for c in cards if c["id"] == "kredi_para"][0]
            write_json(eksik / "settings.ek.json", {"settings": [dict(kart, measured_with={k: v for k, v in kart["measured_with"].items() if k != "kredi_para"})]})
            texts = read_json(eksik / "metinler.tr.json")
            texts["kredi_para"] = read_json(REAL_DIR / "metinler.tr.json")["kredi_para"]
            write_json(eksik / "metinler.tr.json", texts)
            self.assertEqual(self._check(eksik)[0], 0)
            reg = loader.load_registry(eksik, real_defaults())
            self.assertIn("kredi_para", [c["id"] for c in reg.public()["cards"]])

    def test_name_back_in_baseline_is_flagged_as_overlap(self):
        with tempfile.TemporaryDirectory() as td:
            d = copy_data(Path(td))
            b = read_json(d / "coverage_baseline.json")
            b["names"] = sorted(set(b["names"]) | {"ENTRY_EXP"})
            write_json(d / "coverage_baseline.json", b)
            rc, out = self._check(d)
            self.assertEqual(rc, 1)
            self.assertIn("ENTRY_EXP", out)

    def test_commit_touches_only_registry_and_fixtures(self):
        try:
            out = subprocess.run(["git", "log", "--format=@@%s", "--name-only", "-n", "200"], cwd=REPO, capture_output=True,
                                 text=True, timeout=60).stdout
        except (OSError, subprocess.SubprocessError):
            self.skipTest("git yok")
        blocks = [b for b in out.split("@@") if b.startswith("arayuz: R10 model modülü kartları")]
        if not blocks:
            self.skipTest("R10 commit'i henüz yok")
        izinli = re.compile(r"^(simulasyon/arayuz/registry/.+|simulasyon/arayuz/server/tests/.+|"
                            r"simulasyon/arayuz/server/oyun_server/registry/loader\.py|"      # ölçüm bağlamı: gizli kart hata değil
                            r"apps/web/public/oyun-kayit/registry\.json)$")
        for b in blocks:
            files = [l for l in b.splitlines()[1:] if l.strip()]
            self.assertTrue(files)
            for f in files:
                self.assertRegex(f, izinli, f"R10 commit'inde beklenmeyen dosya: {f}")


if __name__ == "__main__":
    unittest.main()
