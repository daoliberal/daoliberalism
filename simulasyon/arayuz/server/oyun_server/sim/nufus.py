"""D4: nüfus (oyuncu + NPC) hesabı, üst sınır ve model parametrelerine çeviri.

Model (simkit/world_build.py, labor.py): toplam oyuncu = PLAYERS_PER_CITY x şehir; NPC havuzu tek toplam
`NPC_X + NPC_Y x PLAYERS_PER_CITY x şehir`. `NPC_Y` modelde tam sayıdır (`Params` varsayılanın türüne çevirir:
2,5 sessizce 2 olurdu). Kartta yarım adım (0,5) vardır; model NPC_X ile NPC_Y'yi yalnız bu toplam içinde okuduğundan
kesirli kısım NPC_X'e eklenir (aynı toplam, aynı dünya). Kart değerleri ve kosu.json arayüz değerlerini taşır;
çeviri yalnız modele giden parametrelerde yapılır.
"""
from __future__ import annotations

from typing import Any

CITIES = 5                      # arayüz oyunu tek dünyada beş şehirle kurar (ModelHost n_cities)
# Ölçüm (D4, gerçek model): 38.000 kişilik en uç kart birleşimi (1000 x 5 oyuncu, NPC 3000 + 6 x 5000) 10 haftada 81 MB,
# haftada yaklaşık 1,3-2,3 sn; süre ağırlıkla oyuncu sayısına bağlıdır (NPC havuzu toplulaştırılır). Üst sınır kart aralıklarının
# üstündedir: kayıt aralıkları genişletilirse koşu nedenli reddedilir.
MAX_POPULATION = 40_000


def _num(params: dict[str, Any], defaults: dict[str, Any], key: str) -> float:
    v = params.get(key, defaults.get(key, 0))
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def totals(params: dict[str, Any], defaults: dict[str, Any], cities: int = CITIES) -> dict[str, int]:
    """{players, npc, total}: `params` geçersiz kılmaları, eksikler `defaults`'tan."""
    per_city = _num(params, defaults, "PLAYERS_PER_CITY")
    players = int(per_city * cities)
    npc = int(_num(params, defaults, "NPC_X") + _num(params, defaults, "NPC_Y") * per_city * cities)
    return {"players": players, "npc": npc, "total": players + npc}


def too_big(params: dict[str, Any], defaults: dict[str, Any]) -> bool:
    return totals(params, defaults)["total"] > MAX_POPULATION


def needs_split(params: dict[str, Any]) -> bool:
    y = params.get("NPC_Y")
    return isinstance(y, float) and not y.is_integer()


def to_model(params: dict[str, Any], defaults: dict[str, Any], cities: int = CITIES) -> dict[str, Any]:
    """Modele giden geçersiz kılmalar: kesirli NPC_Y tam sayıya ve NPC_X'e bölünür (toplam aynı)."""
    if not needs_split(params):
        return params
    y = float(params["NPC_Y"])
    whole = int(y // 1)
    per_city = _num(params, defaults, "PLAYERS_PER_CITY")
    out = dict(params)
    out["NPC_Y"] = whole
    out["NPC_X"] = int(round(_num(params, defaults, "NPC_X") + (y - whole) * per_city * cities))
    return out
