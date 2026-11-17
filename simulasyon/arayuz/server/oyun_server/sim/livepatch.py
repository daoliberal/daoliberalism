"""Canlı yama çekirdeği (A4, ortak-baglam §2.6).

`simbuild.build` her `simkit.*` modülüne `from simkit.params import *` ile değer kopyaladığından yalnız
`simkit.params`'a yazmak etkisizdir (A1 ölçümü); ad `__dict__`'inde olan HER modüle yazılır.
Kuruluşta türetilen sabitler (ör. SALES_TAX -> MARKET_MARKUP0) start_only'dir; kayıt (registry) onları `live` yapmaz,
burada yeniden türetme tarifi yoksa `W_SYNC` boştur.
"""
from __future__ import annotations

from types import ModuleType
from typing import Any, Callable

PARAMS_MODULE = "simkit.params"

# anahtar -> f(W, değer): World'e kopyalanmış değeri eşler. MVP canlı anahtarlarında (CORP_TAX, TRANS_SUPPORT,
# WAGE_TAX) türetim farkı yoktur (A1 derive_diff = []), bu yüzden boş.
W_SYNC: dict[str, Callable[[Any, Any], None]] = {}


def coerce_like(current: Any, value: Any) -> Any:
    """NDJSON sınırında tuple/küme -> liste olur; modelin başlangıç yolu gibi (`type(cur)(...)`) tür korunur.
    tuple/set/frozenset ← düz liste; kapsayıcı uyuşmazlığı ya da iç içe yapı `TypeError` (ikinci kapı reddi)."""
    if isinstance(current, (tuple, set, frozenset)):
        if not isinstance(value, (list, tuple)) or any(isinstance(x, (list, tuple, dict, set, frozenset)) for x in value):
            raise TypeError("kapsayıcı değer bekleniyor")
        return type(current)(value)
    if isinstance(current, list) and not isinstance(value, list):
        raise TypeError("liste bekleniyor")
    return value


def apply_overrides(mods: dict[str, ModuleType], W: Any, overrides: dict[str, Any]) -> int:
    """`overrides`'ı tüm modüllere yazar; yazılan (modül, ad) sayısını döndürür.

    Anahtar `simkit.params`'ta yoksa `KeyError` (hiçbir şey yazılmadan). Taban değere dönüş de bu yolla yapılır."""
    params = mods[PARAMS_MODULE]
    for key in overrides:
        if key not in params.__dict__:
            raise KeyError(key)
    written = 0
    for key, value in overrides.items():
        for mod in mods.values():
            if key in mod.__dict__:
                setattr(mod, key, value)
                written += 1
        sync = W_SYNC.get(key)
        if sync is not None:
            sync(W, value)
    return written
