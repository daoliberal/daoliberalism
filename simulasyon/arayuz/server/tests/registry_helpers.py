"""Kayıt testleri için ortak yardımcılar (A3): gerçek veriyi geçici dizine kopyalama."""
from __future__ import annotations

import functools
import json
import shutil
from pathlib import Path

from oyun_server import config
from oyun_server.registry import defaults, loader

REAL_DIR = loader.DEFAULT_DATA_DIR


@functools.lru_cache(maxsize=1)
def real_defaults() -> dict:
    return defaults.read_param_defaults(str(config.MODEL_ROOT))


def real_registry():
    return loader.load_registry(REAL_DIR, real_defaults())


def copy_data(dst: Path, drop: tuple = ()) -> Path:
    """Gerçek kayıt verisini kopyalar. `drop`: kopyada çıkarılacak kart kimlikleri (örnek kartın parametresini sahiplenen
    gerçek kart varsa; R1a sonrası `SALES_TAX` için `satis_vergisi`)."""
    shutil.copytree(REAL_DIR, dst, dirs_exist_ok=True)
    if drop:
        for f in sorted(Path(dst).glob("settings.*.json")):
            data = read_json(f)
            data["settings"] = [c for c in data["settings"] if c["id"] not in drop]
            write_json(f, data)
        texts = read_json(Path(dst) / "metinler.tr.json")
        for k in drop:
            texts.pop(k, None)
        write_json(Path(dst) / "metinler.tr.json", texts)
    return dst


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


EXTRA_CARD = {
    "id": "ek_deneme",
    "layer": "P",
    "group": "kurtarma",
    "level": "A",
    "editable": True,
    "status": "active",
    "kind": "number",
    "params": ["SALES_TAX"],
    "requires": ["SALES_TAX"],
    "codec": {"type": "number", "scale": 100, "min": 0, "max": 20, "step": 1, "integer": True},
    "apply": "unknown",
}
EXTRA_TEXT = {"title": "Ek deneme", "what": "Deneme kartı.", "changes": "Yok"}


# ---- K1: şema v2 örnek kayıt (sözleşme fikstürü + testler) -------------------------------------------------------------
# Gerçek veri + her kart türünden bir örnek. Örnek parametreler `ORN_*` adlıdır (gerçek modelde kayıtlı hiçbir adla
# çakışmaz); varsayılanlar `example_defaults()` ile eklenir.
EXAMPLE_PARAMS = {
    "ORN_TAHVIL": True, "ORN_VADE": 104, "ORN_TAVAN": 104,
    "ORN_SIRA": ["kurulus", "genc", "dayanma"],
    "ORN_SEKTOR": ["tarim", "sanayi"], "ORN_ONCELIK": ["tarim"],
    "ORN_FAIZ": 0.003, "ORN_PARA": 2000, "ORN_ACIK": False,
    "ORN_BAGLAM": True, "ORN_LIMIT": 12, "ORN_MIN_YAS": 52, "ORN_ESIK": 0.05, "ORN_ORAN": 0.7,
}
_NUM_WEEKS = {"type": "number", "scale": 1, "min": 26, "max": 260, "step": 26, "integer": True, "unit": "hafta"}
_REPORT = "simulasyon/kagit-ustu/modulerlestirme/rapor-birlesik-olcum.md"


def _ex(id_, **kw):
    base = {"id": id_, "layer": "P", "group": "kurtarma", "actor": None, "level": "U", "editable": True,
            "status": "active", "kind": "options", "apply": "unknown", "decision": "K-999"}
    base.update(kw)
    return base


EXAMPLE_CARDS = [
    _ex("ornek_tahvil", kind="fields", status="experimental", params=["ORN_TAHVIL", "ORN_VADE", "ORN_TAVAN"],
        requires=["ORN_TAHVIL"],
        codec={"type": "fields", "fields": [
            {"key": "acik", "param": "ORN_TAHVIL", "codec": {"type": "bool", "on": True, "off": False}},
            {"key": "vade", "param": "ORN_VADE", "codec": _NUM_WEEKS},
            {"key": "tavan", "param": "ORN_TAVAN", "codec": _NUM_WEEKS}]},
        measured_at={"acik": True, "vade": 52, "tavan": 104}, measured_weeks=200),
    _ex("ornek_sira", kind="order", params=["ORN_SIRA"], requires=["ORN_SIRA"], apply="start_only",
        credit_type="kurulus",
        codec={"type": "order", "param": "ORN_SIRA", "items": ["kurulus", "genc", "dayanma"]},
        measured_at=["genc", "kurulus"], measured_weeks=200),
    _ex("ornek_sektorler", kind="multi", params=["ORN_SEKTOR"], requires=["ORN_SEKTOR"], apply="live",
        codec={"type": "multi", "param": "ORN_SEKTOR", "items": ["tarim", "sanayi", "hizmet"]},
        measured_at=["tarim", "sanayi"], measured_with={"gecis_destegi": "kapali"}, measured_weeks=500,
        hint_source=_REPORT),
    _ex("ornek_oncelik", kind="multi", params=["ORN_ONCELIK"], requires=["ORN_ONCELIK"], apply="live_sync",
        codec={"type": "multi", "param": "ORN_ONCELIK", "items": ["tarim", "sanayi", "hizmet"]},
        measured_at=[["tarim"], ["tarim", "sanayi"]], measured_with={"_sablon": "dayanikli_taban"},
        measured_weeks=200, hint_source=_REPORT),
    _ex("ornek_gizli", kind="toggle", params=["ORN_GIZLI"], requires=["ORN_GIZLI"], apply="live",      # ORN_GIZLI varsayılanlarda yok: gizli
        codec={"type": "bool", "on": True, "off": False}),
    _ex("ornek_baglam", kind="toggle", params=["ORN_BAGLAM"], requires=["ORN_BAGLAM"], apply="start_only",
        codec={"type": "bool", "on": True, "off": False}, measured_at=True, measured_with={"ornek_gizli": True},
        measured_weeks=200, hint_source=_REPORT),
    _ex("ornek_faiz", kind="number", params=["ORN_FAIZ"], requires=["ORN_FAIZ"], apply="start_only",
        codec={"type": "number", "scale": 100, "min": 0.1, "max": 1, "step": 0.1, "unit": "yuzde_hafta"},
        measured_at=0.3, measured_weeks=100,
        shows=[{"key": "ORN_MIN_YAS", "unit": "hafta"}]),
    _ex("ornek_akce", kind="number", layer="V", actor="hane", scenario_editable=True, params=["ORN_PARA"],
        requires=["ORN_PARA"],
        codec={"type": "number", "scale": 1, "min": 0, "max": 10000, "step": 500, "integer": True, "unit": "akce"},
        measured_at=2000),
    _ex("ornek_acik", kind="toggle", params=["ORN_ACIK"], requires=["ORN_ACIK"], apply="live",
        codec={"type": "bool", "on": True, "off": False}),
    # K1-ek: etkin, salt okunur, `params` boş; modelde işleyen ama ayarı olmayan kural (yalnız gösterir)
    _ex("ornek_salt_okunur", editable=False, kind="toggle", params=[], requires=[], apply="live",
        codec={"type": "bool", "on": True, "off": False},
        shows=[{"key": "ORN_LIMIT", "unit": "kat"}, {"key": "ORN_MIN_YAS", "unit": "hafta"},
               {"key": "ORN_ESIK", "unit": "yuzde", "scale": 100}, {"key": "ORN_ORAN", "label_key": "agirlik"},
               {"key": "ORN_ACIK"}]),
    _ex("ornek_pasif", layer="V", actor="girisimci", editable=False, status="passive", kind="options", params=[],
        requires=[], apply="passive", default="a", codec={"type": "enum", "map": {"a": 0, "b": 1}}),
]
EXAMPLE_TEXTS = {
    "ornek_tahvil": {
        "title": "Örnek tahvil", "what": "Bileşik kart örneği.", "changes": "Üç alan birlikte yazılır.",
        "warning": "Deneysel kart.", "aliases": ["tahvil"],
        "basis": {"label": "Caiani ve ark. 2016", "note": "Devlet bloğu."},
        "fields": {"acik": {"label": "Açık"}, "vade": {"label": "Vade", "hint": "Hafta"},
                   "tavan": {"label": "Borç tavanı"}}},
    "ornek_sira": {"title": "Örnek sıra", "what": "Sıra kartı.", "changes": "Öncelik değişir.",
                   "items": {"kurulus": "Kuruluş", "genc": "Genç", "dayanma": "Dayanma"}},
    "ornek_sektorler": {"title": "Örnek sektörler", "what": "Alt küme kartı.", "changes": "Kapsam değişir.",
                        "hint": "12 başlangıç dünyasında ölçüldü.",
                        "items": {"tarim": "Tarım", "sanayi": "Sanayi", "hizmet": "Hizmet"}},
    "ornek_oncelik": {"title": "Örnek öncelik", "what": "Alt küme kartı.", "changes": "Kapsam değişir.",
                      "items": {"tarim": "Tarım", "sanayi": "Sanayi", "hizmet": "Hizmet"}},
    "ornek_faiz": {"title": "Örnek faiz", "what": "Haftalık oran.", "changes": "Faiz değişir.",
                   "hint": "6 başlangıç dünyasında ölçüldü.",
                   "shows": {"ORN_MIN_YAS": "En az yaş"}},
    "ornek_salt_okunur": {"title": "Örnek salt okunur", "what": "Modelde işleyen kural.", "changes": "Değişmez.",
                          "shows": {"ORN_LIMIT": "Limit çarpanı", "ORN_MIN_YAS": "En az yaş",
                                    "agirlik": "Ağırlık", "ORN_ACIK": "Anahtar"}},
    "ornek_akce": {"title": "Örnek tutar", "what": "Akçe tutarı.", "changes": "Tutar değişir."},
    "ornek_gizli": {"title": "Örnek gizli kart", "what": "Modelde yok.", "changes": "Yok."},
    "ornek_baglam": {"title": "Örnek bağlam kartı", "what": "Ölçümü gizli bir kartın bağlamında yapıldı.", "changes": "Kural açılır.",
                     "hint": "Ölçüm, modelde olmayan bir kartın bağlamında yapıldı."},
    "ornek_acik": {"title": "Örnek anahtar", "what": "Aç kapa.", "changes": "Kural açılır."},
    "ornek_pasif": {"title": "Örnek pasif", "what": "Pasif kart.", "changes": "Etkisi yok.",
                    "options": {"a": "bir", "b": "iki"}},
}


def example_defaults() -> dict:
    return {**real_defaults(), **EXAMPLE_PARAMS}


def write_examples(d: Path) -> Path:
    """Örnek kartları ve metinlerini `d` (gerçek verinin kopyası) içine yazar."""
    write_json(d / "settings.zz_ornek.json", {"settings": EXAMPLE_CARDS})
    texts = read_json(d / "metinler.tr.json")
    texts.update(EXAMPLE_TEXTS)
    write_json(d / "metinler.tr.json", texts)
    return d


@functools.lru_cache(maxsize=1)
def contract_registry():
    """Gerçek kayıt + örnek kartlar (sözleşme fikstürü bundan üretilir)."""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        d = write_examples(copy_data(Path(td)))
        return loader.load_registry(d, example_defaults())


def evidence_cards() -> dict:
    """R2: kart kimliği -> kanıtlı `apply` sınıfı (registry/apply_classes.json `cards`); dört R1 test dosyasının ortak yardımcısı."""
    return read_json(REAL_DIR / "apply_classes.json")["cards"]
