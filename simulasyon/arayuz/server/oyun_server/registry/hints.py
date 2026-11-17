"""Ölçüm ipucu geçerlilik kuralı (DK-5): ipucu yalnız ölçüldüğü bağlamda gösterilir. W1 bunu TS'te birebir yazar
(`tests/fixtures/registry_hint_cases.json`).

`hint_applies(reg, card, value, context)`; `context = {"values": {kart_kimliği: arayüz değeri}, "weeks": hafta}`.
`values`ta olmayan kart varsayılan değerindedir. En sıkı yorum:
- `measured_values` yok/boş -> ölçülmedi (False).
- `value` ölçülmüş değerlerden biriyle eşleşmeli.
- `measured_weeks: null` -> yalnız MEASURED_WEEKS_DEFAULT (200) haftada geçerli (mevcut ölçümler 200 hafta).
- `measured_with: null` -> bağlam bilinmiyor: yalnız kartın DIŞINDAKİ tüm kartlar varsayılanda iken geçerli.
- `measured_with: {kart: değer}` -> listelenen kartlar o değerde, öbür tüm kartlar varsayılanda.
- `measured_with: {"_sablon": id}` -> şablonun değerleri birebir, öbür tüm kartlar varsayılanda.
Karşılaştırma: multi küme olarak, order sıralı, fields nesne olarak, sayı abs(a-b) <= 1e-9 (NUM_TOL).
"""
from __future__ import annotations

from typing import Any

MEASURED_WEEKS_DEFAULT = 200


NUM_TOL = 1e-9


def _eq(kind: str, a: Any, b: Any) -> bool:
    """multi: küme; öbür listeler: sıralı; nesne: anahtar kümesi ve değerler; sayı: abs(a-b) <= NUM_TOL."""
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if kind == "multi":
            return set(a) == set(b)
        return len(a) == len(b) and all(_eq("", x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a) == set(b) and all(_eq("", a[k], b[k]) for k in a)
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)   # noqa: E731
    if num(a) and num(b):
        return abs(a - b) <= NUM_TOL
    return type(a) is type(b) and a == b


def hint_applies(reg, card, value: Any, context: dict) -> bool:
    mv = reg.measured_values(card)
    if not mv:
        return False
    weeks = card.measured_weeks if card.measured_weeks is not None else MEASURED_WEEKS_DEFAULT
    if context.get("weeks") != weeks:
        return False
    if not any(_eq(card.kind, value, m) for m in mv):
        return False
    values = context.get("values", {})
    expected: dict[str, Any] = {}
    mw = card.measured_with
    if mw and "_sablon" in mw:
        expected = dict(reg.templates[mw["_sablon"]]["values"])
    elif mw:
        expected = dict(mw)
    if mw and "_sablon" not in mw and any(k != card.id and k not in reg.by_id for k in mw):
        return False        # ölçüm bağlamındaki kart kayıtta yok (modelde yok): bağlam yeniden kurulamaz, ipucu gösterilmez
    for other in reg.settings:
        if other.id == card.id:
            continue
        want = expected[other.id] if other.id in expected else reg.default_ui(other)
        have = values[other.id] if other.id in values else reg.default_ui(other)
        if not _eq(other.kind, have, want):
            return False
    return True
