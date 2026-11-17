"""PLAN-DUNYA-ISGUCU son inceleme düzeltmeleri (sunucu ve kayıt): I1 yeni ölçüm kapsamı tek kaynak, M4 etkisiz birleşim kuralları, kart metni düzeltmeleri."""
from __future__ import annotations

import json
import re
import unittest

from oyun_server.sim import plan

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry
from tests.test_changes import ChangeBase
from tests.test_kosu_disk import DiskBase, read_json as read_disk_json

D9_HANE_GELIRI = {"servet_kurali", "npc_en_az_nakit", "npc_havuz_vergisi"}


class NewMeasurementScope(unittest.TestCase):
    """I1: "yeni ölçüm" kapsamı tek kaynaktan gelir: kayıt yayını kart başına `new_measurement` taşır, sunucu ve web aynı kümeyi kullanır."""

    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()
        cls.pub = {c["id"]: c for c in cls.reg.public()["cards"]}

    def test_every_public_card_carries_the_flag_from_plan_decisions(self):
        for s in self.reg.settings:
            self.assertIs(self.pub[s.id]["new_measurement"], s.decision in plan.DECISIONS, s.id)

    def test_scope_covers_d7_to_d11_and_the_active_household_income_cards(self):
        flagged = {k for k, c in self.pub.items() if c["new_measurement"]}
        self.assertTrue(D9_HANE_GELIRI <= flagged)
        by_decision = {d: {s.id for s in self.reg.settings if s.decision == d} for d in ("D6", "D7", "D8", "D9", "D10", "D11")}
        for d in ("D7", "D9", "D10", "D11"):
            self.assertTrue(by_decision[d] and by_decision[d] <= flagged, d)
        self.assertFalse(by_decision["D6"] & flagged)                      # D6 kartları "yeni ölçüm" sayılmaz (Faz 1'de kısmen ölçüldü)

    def test_server_marker_uses_the_same_set(self):
        d = real_defaults()
        m = plan.new_measurement(self.reg.settings, {"SERVET_RULE": 0} if "SERVET_RULE" in d else {}, d)
        self.assertEqual(m["new"], bool(m["settings"]))
        self.assertTrue(set(m["settings"]) <= {k for k, c in self.pub.items() if c["new_measurement"]})

    def test_live_changed_cards_enter_the_marker(self):
        """Koşu ortasında değiştirilen canlı kart (kuruluşta varsayılandaydı) da işarete girer."""
        d = real_defaults()
        settings = [self.reg.by_id["kadro_hizi"]]
        self.assertEqual(plan.new_measurement(settings, {}, d), {"new": False, "settings": []})
        m = plan.new_measurement(settings, {}, d, later=[{"STAFF_ADJ": 1}])
        self.assertEqual(m, {"new": True, "settings": ["kadro_hizi"]})
        m = plan.new_measurement(settings, {"STAFF_ADJ": 1}, d, later=[{"STAFF_ADJ": 0}])         # geri alınsa da koşu ölçüm dışı kalmıştır
        self.assertEqual(m["settings"], ["kadro_hizi"])


class LiveChangeMarksTheRun(DiskBase, ChangeBase):
    change = ChangeBase.change

    def _kosu(self, rid):
        return read_disk_json(self.folder_of(rid) / "kosu.json")

    def test_mid_run_card_change_is_recorded_in_measurement(self):
        m = self.make()
        rid, _ = self.new_run()
        self.assertEqual(self._kosu(rid)["measurement"], {"new": False, "settings": []})
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 2)
        r = self.change(rid, {"kadro_hizi": {"kural": "acik", "kucul": 3, "buyu": 10}})
        self.assertTrue(r["accepted"], r)
        k = self._kosu(rid)
        self.assertTrue(k["measurement"]["new"])
        self.assertEqual(k["measurement"]["settings"], ["kadro_hizi"])

    def test_non_measurement_card_change_does_not_mark(self):
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.stats(rid)["released"] >= 2)
        self.assertTrue(self.change(rid, {"gecis_destegi": "kisa_sureli"})["accepted"])
        self.assertFalse(self._kosu(rid)["measurement"]["new"])


class EtkisizBirlesimKurallari(unittest.TestCase):
    """M4 (a)-(c): sonuç vermeyen kart birleşimleri için tutarlılık uyarısı; (b) kart metninde."""

    @classmethod
    def setUpClass(cls):
        cls.rules = {r["id"]: r for r in read_json(REAL_DIR / "tutarlilik.json")["rules"]}
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_rules_exist_with_texts(self):
        for rid, when in (
            ("hayalet_destek_kapali", {"hayalet_firma": {"kip": "destek_gelmeyen"}, "gecis_destegi": "kapali"}),
            ("hayalet_destek_kisa", {"hayalet_firma": {"kip": "destek_gelmeyen"}, "gecis_destegi": "kisa_sureli"}),
            ("bosluk_zinciri_ahir_kapali", {"bosluk_zinciri": True, "ahir_gecisi": {"kural": "kapali"}}),
        ):
            self.assertEqual(self.rules[rid]["when"], when, rid)
            key = self.rules[rid]["textKey"].split(".")[1]
            self.assertTrue(self.texts["_uyarilar"][key].strip(), rid)

    def test_texts_have_no_flag_or_decision_names(self):
        bad = re.compile(r"\b(K-\d+|GHOST_[A-Z_]+|AHIR_[A-Z_]+|NO_BAILOUT|TRANS_SUPPORT)\b")
        for k in ("hayalet_destek", "bosluk_zinciri_ahir"):
            self.assertIsNone(bad.search(self.texts["_uyarilar"][k]))

    def test_ghost_card_says_it_needs_no_bailout(self):
        """(b): İşçisiz kalan işletme kipi yalnız zarar eden firmayı kurtarma kapalıyken kapatır; metin bunu söyler."""
        w = self.texts["hayalet_firma"]["what"]
        self.assertIn("kurtarma yok", w)
        self.assertIn("kurtarma varken", w)


class MetinDuzeltmeleri(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.texts = read_json(REAL_DIR / "metinler.tr.json")

    def test_money_loop_card_no_ambiguous_two_options(self):
        w = self.texts["para_devresi"]["what"]
        self.assertNotIn("İki seçenekte", w)
        self.assertIn("Kasa gelirini geri döndürür ve kâr hanelere temettü seçeneklerinde para yoktan yaratılmaz", w)

    def test_fire_order_card_states_the_measurement_version(self):
        blob = json.dumps(self.texts["isten_cikarma_sirasi"], ensure_ascii=False) if "isten_cikarma_sirasi" in self.texts else ""
        self.assertIn("yönetici ve uzmanları da çıkarabilen bir sürümle", blob)


if __name__ == "__main__":
    unittest.main()
