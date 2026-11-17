"""Şehir satırları (`CityRow`) ve statik şehir bilgisi (S5). Salt okunur; `W`'ye yazılmaz.

CityRow = {index, served, employed, unemployed, cash, firms_npc, firms_player, cash_weeks, rent_pct, occupancy, tenants_per_house, migration_in, migration_out, npc_pool, npc_broke, players_seeking}
  served        o haftanın karşılanan talep oranı (şehir hanelerinin aldığı birim / istediği birim); talep yoksa null
  employed      şehirdeki firmaların çalışan sayısı (dünya `calisan` ile toplamı eşit)
  unemployed    şehirde iş arayanlar (dünya `issiz` ile toplamı eşit)
  cash          şehir kasası (Akçe, yuvarlanmaz)
  cash_weeks    kasa / sönümlü haftalık zorunlu gider (modelin kasa tabanı ölçüsü, `probes.city_cash_weeks`); taban kuralı kapalıysa ya da gider ölçülmüyorsa null
  firms_total   işletme sayısı = firms_npc + firms_player (D8)
  firms_npc     canlı NPC firma (ahır/belediye hariç); firms_player canlı oyuncu firması (dünya sayaçlarıyla aynı tanım)
  rent_pct      kira / çırak ücreti (kesir); occupancy modelin doluluğu min(1, kiracı/konut); tenants_per_house ham kiracı/konut; konut kapalıysa null
  npc_pool      şehrin havuzundaki işsiz NPC; npc_broke bunlardan (hane kipinde bakmakla yükümlü NPC'lerden de) nakdi NPC_MIN_BAL altında olanlar (tüketemeyen); players_seeking iş arayan oyuncu (= unemployed)
  migration_in/out  o hafta bu şehre gelen / şehirden giden kişi sayısı (NPC + oyuncu): haftalar arası kişi-şehir eşlemesi farkı;
                    modelde göç yalnız 2. haftadan başlar, dünya toplamı model sayacı `goc_npc + goc_oyuncu` ile eşittir.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from . import extract_chain, labels
from .probes import city_cash_weeks, finite


def city_map(W) -> dict[str, int]:
    """Kişi -> şehir (göç farkı için). Saf okuma."""
    return {q: p["city"] for q, p in W.people.items()}


def _ratio(num: float, den: float) -> float | None:
    return finite(num / den) if den > 1e-9 else None


def city_rows(W, P, prev_map: dict[str, int] | None) -> list[dict[str, Any]]:
    cur = city_map(W)
    inn: dict[int, int] = defaultdict(int)
    out: dict[int, int] = defaultdict(int)
    if prev_map:
        for q, ci in cur.items():
            was = prev_map.get(q)
            if was is not None and was != ci:
                inn[ci] += 1
                out[was] += 1
    emp: dict[int, int] = defaultdict(int)
    npc: dict[int, int] = defaultdict(int)
    for d in W.firms.values():
        emp[d["city"]] += len(d["workers"])
        if d.get("owner") is None and d["kind"] not in ("ahir", "belediye") and not d.get("dead") and not d.get("org_owner"):
            npc[d["city"]] += 1
    ply: dict[int, int] = defaultdict(int)
    for f in W.player_firms:
        d = W.firms.get(f)
        if d is not None and not d.get("dead"):
            ply[d["city"]] += 1
    pop: dict[int, int] = defaultdict(int)
    for q in W.people.values():
        pop[q["city"]] += 1
    ahir: dict[int, int] = defaultdict(int)
    for d in W.firms.values():
        if d["kind"] == "ahir":
            ahir[d["city"]] += sum(1 for q in d["workers"] if W.people[q]["who"] == "oyuncu")
    cw = city_cash_weeks(W)
    npc_floor = float(getattr(P, "NPC_MIN_BAL", 1.0))
    rows = []
    for k, c in enumerate(W.cities):
        i = c["i"]
        rent = occ = ten = None
        if P.HOUSE_ON:
            rent = finite(W.RENT_CY[i] / (P.TIER_WAGE[0] * W.WI[i])) if i in W.RENT_CY and i in W.WI else None
            ten = _ratio(W.occ.get(i, 0.0), W.hs.get(i, 0.0))
            occ = None if ten is None else min(1.0, ten)             # modelin doluluk tanımı (housing.py: min(1, occ/hs))
        rows.append({
            "index": i,
            "served": _ratio(c["got_units"], c["dem_units"]),
            "employed": emp[i],
            "unemployed": len(c["seekers"]),
            "cash": finite(W.L.bal.get(c["acct"], 0.0)),
            "cash_weeks": cw[k],
            "firms_npc": npc[i],
            "firms_player": ply[i],
            "firms_total": npc[i] + ply[i],
            "rent_pct": rent,
            "occupancy": occ,
            "tenants_per_house": ten,
            "migration_in": inn[i],
            "migration_out": out[i],
            "npc_pool": len(c["pool"]),
            "npc_broke": sum(1 for q in list(c["pool"]) + list(c.get("deps", ())) if W.L.bal.get(q, 0.0) < npc_floor),      # D9: hane kipinde bakmakla yükümlü NPC dahil
            "players_seeking": len(c["seekers"]),
            "population": pop[i],                                        # şehirdeki kişi sayısı (oyuncu + NPC; haritada yalnız sayı)
            "players_in_ahir": ahir[i],                                  # şehrin ahırında çalışan oyuncu
        })
    return rows


def static_world_info(d: dict[str, Any], n_cities: int = 5) -> dict[str, Any]:
    """Statik dünya bilgisi (`/info.world`): şehir başına kaynak ve uzman sektörler, oyuncu dilinde. Modelin kurulum kuralı
    (`world_build.build`): kömür `COAL_CITIES`'te, altın `GOLD_CITIES`'te (yaşam ve inovasyon açıkken), uzman sektörler `SPECIAL`
    listesinden şehir başına ardışık `len(SPECIAL) // n_cities` tane. Nüfus payı: şehir başına eşit oyuncu."""
    coal, gold = set(d.get("COAL_CITIES", ())), set(d.get("GOLD_CITIES", ()))
    gold_on = bool(d.get("LIFE_ON")) and bool(d.get("INNOV_ON"))
    special = list(d.get("SPECIAL", ()))
    per = len(special) // n_cities if n_cities else 0
    cities = []
    for i in range(n_cities):
        res = []
        if i in coal:
            res.append({"id": "coal", "label": labels.RESOURCE_COAL})
        if gold_on and i in gold:
            res.append({"id": "gold", "label": labels.RESOURCE_GOLD})
        spec = [{"sector": k, "label": labels.sector_label(k)} for k in special[i * per:(i + 1) * per]]
        cities.append({"index": i, "coal": i in coal, "gold": gold_on and i in gold, "resources": res, "specialties": spec,
                       "population_share": 1.0 / n_cities})
    out: dict[str, Any] = {"cities": cities, "basis": "model_defaults"}      # koşunun kartlarına göre değil, modelin varsayılan dünyasına göre
    recipes, producer, prod_of = d.get("RECIPES0"), d.get("PRODUCER"), d.get("PROD_OF")
    if isinstance(recipes, dict) and isinstance(producer, dict) and isinstance(prod_of, dict):
        kinds = [k for k in recipes if k in prod_of]          # zincir sektörleri (belediye, lojistik, market gibi zincir dışı türler yok)
        out["chain"] = {"sectors": [{"sector": k, "label": labels.sector_label(k), "product": prod_of.get(k)} for k in kinds],
                        "edges": [{k: e[k] for k in ("from", "to", "product")}      # miktar yok: tarif koşu boyunca değişir
                                  for e in extract_chain.chain_edges(recipes, kinds, producer)]}
    return out
