"""R1a-R1c: kayıt verisi gruplarının ortak denetimleri (karışım sınıfı; test_* dosyası değildir).

Bir R görevi bu sınıfı `unittest.TestCase` ile birlikte miras alır ve `GROUPS` (eşlemin `bolum` değerleri) ile gerekirse
`DEFERRED` (eşlemde olup kayıtta sonraki görevde açılacak kartlar, gerekçesiyle) verir. Denetimler:

  cards_cover_mapping       eşlemdeki her kart kayıtta; aynı grup/katman/aktör, aynı params; pasif kart pasif
  params_exist_or_passive   etkin kartın her parametresi modelde var; kart gizli (requires eksik) değil
  texts_complete            title/what/changes, seçenek/alan/öğe etiketleri; gizli kalibrasyon adı yok
  codec_contains_default    model varsayılanı kartın kodlamasından geçer, aralığın içinde
  codec_default_on_step     varsayılan `min + k·step` ızgarasında
  hints_have_measured_or_old_prefix   ipucu ya ölçüm alanlarıyla ya "Eski ölçüm notu:" önekiyle + kaynakla
"""
from __future__ import annotations

import re
from pathlib import Path

from oyun_server.registry import codec as codec_mod

from tests.registry_helpers import REAL_DIR, read_json, real_defaults, real_registry

ESLEM = REAL_DIR / "prototip_eslem.json"
OLD_PREFIX = "Eski ölçüm notu:"
# yer tutucu olarak izinli büyük harfli kısaltmalar (oyuncu metninde kullanılabilir)
IZINLI_KISALTMA = {"KDV", "DAO", "NPC"}


def all_cards(reg):
    return {s.id: s for s in (*reg.settings, *reg.hidden)}


def _walk_numbers(c, value, path=""):
    """(yol, codec, arayüz değeri) üçlüleri: yalnız number codec'ler."""
    if c["type"] == "number":
        yield path, c, value
    elif c["type"] == "fields":
        for f in c["fields"]:
            yield from _walk_numbers(f["codec"], value[f["key"]], f"{path}.{f['key']}" if path else f["key"])


def _texts_walk(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _texts_walk(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _texts_walk(v, f"{path}[{i}]")



def _kaynak_var(kok, yol) -> bool:
    """hint_source dosyası var mı. Açık depoda `simulasyon/kararlar.md` bilerek yoktur (yalnız atıf; arayüz alanı dosya olarak açmaz): yokken kabul edilir."""
    return (kok / yol).is_file() or yol == "simulasyon/kararlar.md"

class GroupChecks:
    GROUPS: tuple[str, ...] = ()
    DEFERRED: dict[str, str] = {}

    # ---- yardımcılar -----------------------------------------------------------------------------------------------
    @classmethod
    def eslem_cards(cls) -> dict:
        kartlar = read_json(ESLEM)["kartlar"]
        return {k: c for k, c in kartlar.items() if c["bolum"] in cls.GROUPS and k not in cls.DEFERRED}

    @classmethod
    def group_cards(cls, reg):
        cards = all_cards(reg)
        return [cards[k] for k in cls.eslem_cards() if k in cards]

    # ---- denetimler ------------------------------------------------------------------------------------------------
    def test_group_cards_cover_mapping(self):
        reg = real_registry()
        cards = all_cards(reg)
        want = self.eslem_cards()
        self.assertTrue(want, "grup eşlemde boş")
        for k, c in want.items():
            with self.subTest(card=k):
                self.assertIn(k, cards, f"{k} kayıtta yok")
                s = cards[k]
                if c["layer"] == "P":
                    self.assertEqual(s.group, c["bolum"])
                else:
                    self.assertEqual(s.layer, c["layer"])
                    if c["layer"] == "V":
                        self.assertEqual(s.actor, c["bolum"])
                if c["status"] != "passive":
                    self.assertNotEqual(s.status, "passive", f"{k}: eşlemde etkin, kayıtta pasif")
                if c["status"] == "passive":
                    self.assertEqual(s.status, "passive")
                    self.assertFalse(s.editable)
                    self.assertEqual(list(s.params), [])
                    self.assertEqual(list(s.requires), [])
                else:
                    self.assertEqual(list(s.params), c["params"])
                    if s.status != "passive":
                        self.assertEqual(s.editable, c["duzenlenebilir"], f"{k}: editable eşlemle uyuşmuyor")
        for k in self.DEFERRED:
            self.assertTrue(self.DEFERRED[k].strip(), "ertelenen kart gerekçesiz")

    def test_group_params_exist_or_passive(self):
        reg = real_registry()
        d = real_defaults()
        hidden = {s.id for s in reg.hidden}
        for s in self.group_cards(reg):
            with self.subTest(card=s.id):
                self.assertNotIn(s.id, hidden, "kart modelde olmayan bir requires yüzünden gizli")
                if s.status == "passive":
                    self.assertEqual(list(s.params), [])
                    continue
                for p in s.params:
                    self.assertIn(p, d, f"{p} modelde yok")
                self.assertNotIn("INNOV_ON", s.params)
                self.assertNotIn("LIFE_ON", s.params)

    def test_group_texts_complete(self):
        reg = real_registry()
        texts = read_json(REAL_DIR / "metinler.tr.json")
        names = set(real_defaults())
        word = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
        for s in self.group_cards(reg):
            t = texts.get(s.id)
            self.assertIsInstance(t, dict, f"{s.id}: metin yok")
            for f in ("title", "what", "changes"):
                self.assertTrue(isinstance(t.get(f), str) and t[f].strip(), f"{s.id}.{f}")
            for path, val in _texts_walk(t, s.id):
                for w in word.findall(val):
                    self.assertNotIn(w, names, f"{path}: model parametre adı oyuncu metnine girmez ({w})")
                    if len(w) >= 4 and w.isupper() and w not in IZINLI_KISALTMA:
                        self.fail(f"{path}: büyük harfli kısaltma {w!r}")
            c = s.codec
            if c["type"] == "enum":
                for k in c["map"]:
                    self.assertTrue(t["options"][k].strip(), f"{s.id}.options.{k}")
            if c["type"] == "fields":
                for f in c["fields"]:
                    self.assertTrue(t["fields"][f["key"]]["label"].strip(), f"{s.id}.fields.{f['key']}")
                    if f["codec"]["type"] == "enum":
                        for k in f["codec"]["map"]:
                            self.assertTrue(t["fields"][f["key"]]["options"][k].strip(), f"{s.id}.{f['key']}.{k}")
            if c["type"] in ("order", "multi"):
                for k in c["items"]:
                    self.assertTrue(t["items"][k].strip())
            b = t.get("basis")
            if b is not None:
                self.assertIn(b["label"], reg.dayanaklar["labels"])
            if t.get("aliases") is not None:
                self.assertTrue(all(isinstance(a, str) and a.strip() for a in t["aliases"]))
            self.assertFalse(re.search(r"capitalism", json_text(t), re.I))
            self.assertIsNone(re.search(r"K-\d+", json_text(t)), f"{s.id}: karar numarası oyuncu metninde olamaz")

    def test_group_codec_contains_default(self):
        reg = real_registry()
        for s in self.group_cards(reg):
            if not s.params:
                continue
            with self.subTest(card=s.id):
                ui = reg.default_ui(s)
                codec_mod.decode(s.codec, ui, reg.seeds)            # aralık, adım, seçenek kümesi
                for path, c, v in _walk_numbers(s.codec, ui):
                    self.assertGreaterEqual(v, c["min"], f"{s.id}.{path}")
                    self.assertLessEqual(v, c["max"], f"{s.id}.{path}")

    def test_group_codec_default_on_step(self):
        reg = real_registry()
        for s in self.group_cards(reg):
            if not s.params:
                continue
            with self.subTest(card=s.id):
                ui = reg.default_ui(s)
                for path, c, v in _walk_numbers(s.codec, ui):
                    q = (v - c["min"]) / c["step"]
                    self.assertAlmostEqual(q, round(q), places=6, msg=f"{s.id}.{path}: varsayılan adım ızgarasında değil")

    def test_group_hints_have_measured_or_old_prefix(self):
        reg = real_registry()
        texts = read_json(REAL_DIR / "metinler.tr.json")
        for s in self.group_cards(reg):
            hint = texts[s.id].get("hint")
            measured = s.measured_at is not None
            with self.subTest(card=s.id):
                if measured:
                    self.assertIsNotNone(s.measured_weeks, "ölçüm haftası yok")
                    self.assertTrue(s.hint_source, "ölçüm kaynağı yok")
                    self.assertTrue(hint, "ölçüm alanı var ama ipucu yok")
                    self.assertTrue(_kaynak_var(Path(__file__).resolve().parents[4], s.hint_source), "hint_source dosyası yok")
                elif hint:
                    self.assertTrue(hint.startswith(OLD_PREFIX), "ölçüm alanı yok: ipucu 'Eski ölçüm notu:' ile başlamalı")
                    self.assertTrue(s.hint_source, "eski ölçüm notunun kaynağı yok")
                    self.assertTrue(_kaynak_var(Path(__file__).resolve().parents[4], s.hint_source), "hint_source dosyası yok")
                else:
                    self.assertIsNone(s.hint_source)
                    self.assertIsNone(s.measured_with)

    def test_existing_ids_kept(self):
        reg = real_registry()
        ids = {s.id for s in reg.settings}
        self.assertTrue({"gecis_destegi", "dunya_tohumu", "ucret_stopaji", "kurumlar_vergisi", "zararda_once_kucul"} <= ids)
        by = reg.by_id
        self.assertEqual(by["ucret_stopaji"].group, "vergi")
        self.assertEqual(by["kurumlar_vergisi"].group, "vergi")
        self.assertEqual(by["gecis_destegi"].group, "kurtarma")
        self.assertEqual(by["zararda_once_kucul"].group, "kurtarma")
        self.assertEqual(by["dunya_tohumu"].group, "dunya")
        self.assertTrue({"kurtarma", "vergi", "dunya"} <= {g["id"] for g in reg.groups})
        self.assertIn("dayanikli_taban", reg.templates)


def json_text(node) -> str:
    import json
    return json.dumps(node, ensure_ascii=False)
