"""Zincir anlık görüntüsü (`ChainSnapshot`) ve sektör panosu verisi (S5). Salt okunur; `W`'ye yazılmaz.

ChainSnapshot = {board, sectors, nodes, scarce, edges_rev, [edges]}
  Kenarlar ve etiketler her pakette değil: `/info.world.chain` BAŞLANGIÇ kümesidir; tarif koşu sırasında değişir (donanım/yazılım girdisi
  eklenir, yeşil enerjiyle kömür girdisi biter). `edges_rev` tarif sürümüdür (kenar KÜMESİ değişince artar); küme değiştiği haftanın
  paketinde ayrıca `edges` (sıkıştırılmış satırlar `[from, to, product]`; MİKTAR paketlerde yoktur, yalnız çekmeceden gelir) gelir. Sürümü ve listeyi `ModelHost.snapshot` tutar (bkz. `edge_rows`).
  board    sektör panosu (SECTOR_BOARD) açık mı; kapalıysa pano türevli alanlar null (firma sayısı ve fiyat panodan gelmez)
  sectors  her firma türü için bir satır: {sector, product, firms, healthy, shortage, persist, cover_days, price_trend, price}
           firms    canlı ve çalışanı olan firma sayısı (tüm şehirler); healthy sağlıklı üretici sayısı (pano)
           shortage o haftanın karşılanmayan talep payı (ÜRÜN düzeyinde: model karşılanmayanı şehir bazında tutmaz; her şehir düğümünde aynı)
           persist  kalıcı kıtlık (karşılanmayan payın üstel ortalaması); cover_days stok örtüsü (gün); price_trend fiyat eğilimi
           price    şehir ortalaması göreli fiyat (fiyat / referans fiyat; 1 = referans)
  nodes    sektör x şehir: {sector, city, shortage, price, firms, healthy, demand, output, stock}; price panodan değil fiyat tablosundan
  edges    (statik, `chain_edges`) tarif kenarları: {from (girdiyi üreten tür), to (kullanan tür), product}; `chain_edges` miktarı (`qty`) da verir, çekmece kullanır
  scarce   panonun en kıt 5 halkası (kalıcı kıtlığa göre azalan; eşitlikte ürün adına göre); pano kapalıysa null
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .probes import finite


def board_on(W, P) -> bool:
    return bool(getattr(P, "SECTOR_BOARD", 0)) and getattr(W, "board", None) is not None


def _rel_price(W, ci: int, p: str) -> float | None:
    pr, ref = W.PRICE.get((ci, p)), W.REF.get(p)
    if pr is None or not ref:
        return None
    return finite(pr / ref)


def chain_edges(recipes, kinds, producer) -> list[dict[str, Any]]:
    """Tarif kenarları (saf; `W.RECIPES` ya da `RECIPES0` varsayılanı verilir)."""
    known = set(kinds)
    edges = []
    for kind in kinds:
        recipe = recipes.get(kind)
        if not recipe:
            continue
        for p, q in recipe[1].items():
            src = producer.get(p)
            if src in known and finite(q) is not None and q > 0:
                edges.append({"from": src, "to": kind, "product": p, "qty": finite(q)})
    return edges


def edge_rows(edges: list[dict[str, Any]]) -> list[list]:
    return [[e["from"], e["to"], e["product"]] for e in edges]


def edge_key(edges: list[dict[str, Any]]) -> frozenset:
    return frozenset((e["from"], e["to"], e["product"]) for e in edges)


def chain_snapshot(W, P) -> dict[str, Any]:
    on = board_on(W, P)
    b = W.board if on else None
    kinds = list(W.TOPO)
    cities = [c["i"] for c in W.cities]
    cnt: dict[tuple[str, int], int] = defaultdict(int)
    for d in W.firms.values():
        if not d.get("dead") and d["workers"]:
            cnt[(d["kind"], d["city"])] += 1
    sectors, nodes = [], []
    by_product: dict[str, dict] = {}
    for kind in kinds:
        p = P.PROD_OF.get(kind)
        bp = b["prod"].get(p) if (b is not None and p is not None) else None
        prices = [_rel_price(W, ci, p) for ci in cities] if p is not None else []
        price = finite(sum(prices) / len(prices)) if prices and all(x is not None for x in prices) else None
        row = {
            "sector": kind, "product": p,
            "firms": sum(cnt[(kind, ci)] for ci in cities),
            "healthy": bp["n_h"] if bp else None,
            "shortage": finite(bp["short_share"]) if bp else None,
            "persist": finite(bp["persist"]) if bp else None,
            "cover_days": finite(bp["cover"]) if bp else None,
            "price_trend": finite(bp["ptrend"]) if bp else None,
            "price": price,
        }
        sectors.append(row)
        if p is not None:
            by_product[p] = row
        for ci in cities:
            cell = b["cells"].get((ci, p)) if (b is not None and p is not None) else None
            nodes.append({
                "sector": kind, "city": ci,
                "shortage": row["shortage"],
                "price": _rel_price(W, ci, p) if p is not None else None,
                "firms": cnt[(kind, ci)],
                "healthy": cell["n_healthy"] if cell else None,
                "demand": finite(cell["dem"]) if cell else None,
                "output": finite(cell["prod"]) if cell else None,
                "stock": finite(cell["stock"]) if cell else None,
            })
    scarce = None
    if b is not None:
        top = sorted(b["prod"].items(), key=lambda kv: (-kv[1]["persist"], kv[0]))[:5]
        scarce = []
        for p, bp in top:
            row = by_product.get(p)
            scarce.append({
                "sector": P.PRODUCER.get(p, p), "product": p,
                "persist": finite(bp["persist"]), "shortage": finite(bp["short_share"]),
                "firms": row["firms"] if row else bp["n_all"], "healthy": bp["n_h"],
            })
    return {"board": on, "sectors": sectors, "nodes": nodes, "scarce": scarce}
