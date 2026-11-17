"""Codec: arayüz değeri <-> model parametresi (tipli) ve biçimlendirme. Metin değil, tipli değer döner.

Arayüz değeri (UIValue): sayı | dizge | bool | dizge listesi (order, multi) | {alan: sayı|dizge|bool} (fields).
`decode` arayüz değerini model değerine çevirir: fields -> `{param: değer}` (çoklu parametre), order/multi ->
`tuple[str, ...]`, öbürleri skaler. `encode` tersidir. `format_value` birimli, Türkçe sayı biçimli metin üretir.
"""
from __future__ import annotations

import math
from typing import Any

YEARLY_FACTOR = 52     # yuzde_hafta: yıllık karşılık = haftalık oran x 52 (basit çarpım)


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _is_str_list(x: Any) -> bool:
    return isinstance(x, (list, tuple)) and all(isinstance(i, str) for i in x)


def effective_unit(c: dict) -> str | None:
    """Sayı codec'inin birimi; birim yazılmamış ve ölçek 100 ise geriye uyumlu olarak `yuzde`."""
    u = c.get("unit")
    if u:
        return u
    return "yuzde" if c.get("scale") == 100 else None


def _same(a: Any, b: Any) -> bool:
    """bool ile sayıyı ayıran eşitlik (Python'da True == 1)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    return a == b


def decode(c: dict, raw: Any, seeds: list | None = None) -> Any:
    """Arayüz değerini model değerine çevirir; geçersizse ValueError."""
    t = c["type"]
    if t == "enum":
        if not isinstance(raw, str) or raw not in c["map"]:
            raise ValueError("seçenek geçersiz")
        return c["map"][raw]
    if t == "bool":
        if not isinstance(raw, bool):
            raise ValueError("bool bekleniyor")
        return c["on"] if raw else c["off"]
    if t == "number":
        if not _is_num(raw):
            raise ValueError("sayı bekleniyor")
        if raw < c["min"] or raw > c["max"]:
            raise ValueError("aralık dışı")
        if c.get("integer") and raw != int(raw):
            raise ValueError("tamsayı bekleniyor")
        step = c.get("step")
        if step:
            q = (raw - c["min"]) / step
            if abs(q - round(q)) > 1e-6:
                raise ValueError("adım uyumsuz")
        v = round(raw / c["scale"], 12)
        return int(v) if c.get("integer") and c["scale"] == 1 else v
    if t == "seed":
        pm = seeds or []
        if isinstance(raw, bool) or not isinstance(raw, int) or not 0 <= raw < len(pm):
            raise ValueError("tohum geçersiz")
        return float(pm[raw])
    if t == "fields":
        if not isinstance(raw, dict):
            raise ValueError("nesne bekleniyor")
        if set(raw) != {f["key"] for f in c["fields"]}:
            raise ValueError("alan anahtarları eksik ya da fazla")
        return {f["param"]: decode(f["codec"], raw[f["key"]], seeds) for f in c["fields"]}
    if t in ("order", "multi"):
        if not _is_str_list(raw):
            raise ValueError("dizge listesi bekleniyor")
        if len(set(raw)) != len(raw):
            raise ValueError("yinelenen öğe")
        if any(i not in c["items"] for i in raw):
            raise ValueError("bilinmeyen öğe")
        if t == "order":
            if not raw:
                raise ValueError("sıra boş olamaz")
            return tuple(raw)                      # tam permütasyon ya da önek (öncelik sırasının ilk k öğesi)
        chosen = set(raw)
        return tuple(i for i in c["items"] if i in chosen)       # alt küme, öğe sırasıyla
    raise ValueError("bilinmeyen codec")


def encode(c: dict, model_value: Any, seeds: list | None = None) -> Any:
    """Model değerini arayüz değerine çevirir (`decode`un tersi); karşılığı yoksa ValueError."""
    t = c["type"]
    if t == "enum":
        for k, v in c["map"].items():
            if _same(v, model_value):
                return k
        raise ValueError("değer haritada yok")
    if t == "bool":
        if _same(model_value, c["on"]):
            return True
        if _same(model_value, c["off"]):
            return False
        raise ValueError("değer on/off değil")
    if t == "number":
        if not _is_num(model_value):
            raise ValueError("sayı bekleniyor")
        ui = round(float(model_value) * c["scale"], 9)
        return int(round(ui)) if c.get("integer") or ui == int(ui) else ui
    if t == "seed":
        for i, v in enumerate(seeds or []):
            if _is_num(model_value) and math.isclose(float(v), float(model_value), rel_tol=0.0, abs_tol=1e-9):
                return i
        raise ValueError("tohum listede yok")
    if t == "fields":
        if not isinstance(model_value, dict):
            raise ValueError("nesne bekleniyor")
        return {f["key"]: encode(f["codec"], model_value[f["param"]], seeds) for f in c["fields"]}
    if t in ("order", "multi"):
        if not _is_str_list(model_value):
            raise ValueError("dizge listesi bekleniyor")
        return list(model_value)
    raise ValueError("bilinmeyen codec")


def neutral_ui(c: dict) -> Any:
    """Modelde karşılığı olmayan kartlar için tarafsız arayüz değeri (ilk seçenek, kapalı, en küçük sayı…)."""
    t = c["type"]
    if t == "enum":
        return next(iter(c["map"]))
    if t == "bool":
        return False
    if t == "number":
        return int(c["min"]) if c.get("integer") else c["min"]
    if t == "seed":
        return 0
    if t == "fields":
        return {f["key"]: neutral_ui(f["codec"]) for f in c["fields"]}
    if t == "order":
        return list(c["items"])
    return []


def _group(int_text: str) -> str:
    out, neg = int_text.lstrip("-"), int_text.startswith("-")
    parts = []
    while len(out) > 3:
        parts.insert(0, out[-3:])
        out = out[:-3]
    parts.insert(0, out)
    return ("-" if neg else "") + ".".join(parts)


def _num_text(x: float) -> str:
    """Türkçe sayı biçimi: binlik nokta, ondalık virgül, en çok 6 ondalık, sondaki sıfırlar yok."""
    s = f"{round(float(x), 6):.6f}".rstrip("0").rstrip(".")
    if s in ("-0", ""):
        s = "0"
    head, _, frac = s.partition(".")
    head = _group(head)
    return head + ("," + frac if frac else "")


def number_control(c: dict) -> dict:
    """Sayı codec'inden yayımlanan kontrol (arayüz birimi; `step` codec'te zorunlu)."""
    return {"type": "number", "min": c["min"], "max": c["max"], "step": c["step"],
            "unit": effective_unit(c), "integer": bool(c.get("integer"))}


def format_value(c: dict, model_value: Any, words: dict, labels: dict | None = None, seeds: list | None = None) -> str:
    """Model değerini ekranda gösterilecek metne çevirir.

    `words`: birleşik sözcükler (`_degerler` + `_birimler`: `acik`, `kapali`, `yok`, birim şablonları `{n}`/`{yillik}`).
    `labels`: enum/order/multi öğe etiketleri ya da fields alan etiketleri (yoksa anahtarın kendisi);
    seed için `{"0": "Dünya 1", …}` (ham kalibrasyon değeri asla gösterilmez; etiket yoksa ValueError).
    """
    t = c["type"]
    lab = labels or {}
    if t == "enum":
        key = encode(c, model_value)
        return lab.get(key, key)
    if t == "bool":
        return words["acik"] if _same(model_value, c["on"]) else words["kapali"]
    if t == "seed":
        label = lab.get(str(encode(c, model_value, seeds)))
        if label is None:
            raise ValueError("başlangıç dünyası etiketi yok")
        return label
    if t == "number":
        ui = float(model_value) * c["scale"]
        unit = effective_unit(c) or "sayi"
        if unit not in words:
            raise ValueError(f"birim şablonu yok: {unit}")
        tpl = words[unit]
        return tpl.replace("{n}", _num_text(ui)).replace("{yillik}", _num_text(ui * YEARLY_FACTOR))
    if t == "fields":
        return "; ".join(f"{lab.get(f['key'], f['key'])}: {format_value(f['codec'], model_value[f['param']], words)}"
                         for f in c["fields"])
    if t in ("order", "multi"):
        if not model_value:
            return words["yok"]
        return ", ".join(lab.get(i, i) for i in model_value)
    raise ValueError("biçimlenemez")


def show_value(entry: dict, model_value: Any, words: dict) -> tuple[Any, str]:
    """`shows` satırı: model değeri -> (arayüz birimindeki değer, birimli metin). Yalnız sayı ve bool; dizge ve liste yok."""
    if isinstance(model_value, bool):
        return model_value, words["acik"] if model_value else words["kapali"]
    if not _is_num(model_value):
        raise ValueError("gösterilen değer sayı ya da bool olmalı")
    c = {"type": "number", "scale": entry.get("scale", 1), "min": -1e18, "max": 1e18, "step": 1e-12}
    if entry.get("unit"):
        c["unit"] = entry["unit"]
    return encode(c, model_value), format_value(c, model_value, words)
