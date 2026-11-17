"""Çekmeceler (S5): şehir, sektör, firma ve lonca ayrıntısı. YALNIZ okur: `W`'ye yazılmaz, koşuyu ilerletmez.

Güvenlik: `ref` yalnız `REF_RE` desenine uyan, sözlük/dizin araması yapılan bir anahtardır (dosya/öznitelik/ifade çözümü yok);
dönen alanlar `*_FIELDS` beyaz listesinden süzülür (firma sahibi kimliği gibi alanlar çıkmaz). Bilinmeyen `ref` -> `UnknownRef`.
Tel biçimi: `{kind, ref, title, fields}` (`week`/`stale` sarmalayıcıyı çalıştıran yönetici ekler).
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from . import extract_chain, extract_cities, holdings, labels
from .probes import finite

KINDS = ("city", "sector", "firm", "lonca", "urun")
REF_RE = re.compile(r"[a-z0-9_-]{1,40}")

CITY_FIELDS = frozenset({
    "index", "served", "employed", "unemployed", "cash", "cash_weeks", "firms_npc", "firms_player", "rent_pct", "occupancy", "migration_in",
    "migration_out", "tenants_per_house", "players", "reputation", "idle_npcs", "wage_index", "rent_multiplier", "import_value", "export_value",
    "consumption_value", "unpaid_households", "top_sectors", "players_seeking", "npc_broke", "npc_pool", "firms_total", "population", "players_in_ahir",
})
SECTOR_FIELDS = frozenset({
    "sector", "label", "product", "firms", "healthy", "shortage", "persist", "cover_days", "price_trend", "price", "workers",
    "cities", "inputs", "users", "firm_refs", "note_key", "capacity", "fill",
})
FIRM_FIELDS = frozenset({
    "kind", "sector_label", "city", "lonca", "workers", "capacity", "cash", "ownership", "privatized", "born", "age", "alive",
    "died", "profit", "debt", "loan_rate", "health", "cover_weeks", "loss_streak", "staffless", "exiting", "stock_units",
    "insolvent_weeks", "product", "price", "wage_avg", "sold_week", "profit_hist",
})
LONCA_FIELDS = frozenset({
    "members", "fee", "deposits", "owner",
    "capital", "credit_out", "equity",                     # PLAN-TAKIP §4.2: paketin lonca satırıyla aynı sayılar (`holdings.LONCA_ROW_KEYS`)
})
URUN_FIELDS = frozenset({
    "urun", "istek", "karsilanmayan", "uretim", "stok", "kapsama_hf", "fiyat_endeksi", "firma", "saglikli", "sehirler",
})


class UnknownRef(KeyError):
    """Bu `kind` için böyle bir kayıt yok."""


def _allow(fields: dict[str, Any], allowed: frozenset) -> dict[str, Any]:
    return {k: v for k, v in fields.items() if k in allowed}


def _ownership(d: dict) -> str:
    if d.get("owner") is not None or d.get("org_owner"):
        return "player"
    return "public" if d["kind"] in ("belediye", "ahir") else "npc"


def firm_profit(W, ref: str, d: dict) -> float:
    """İşletmenin haftalık kârı (çekmece `profit` ile aynı ölçü: NPC için modelin `prof`'u, oyuncu/DAO için sönümlü `prof_ema`)."""
    return d.get("prof", 0.0) if d.get("owner") is None else getattr(W, "prof_ema", {}).get(ref, 0.0)


def product_of(P, kind: str) -> str | None:
    """Sektörün (işletme türünün) ürünü: tarifte bu türü üretici gösteren ilk ürün (ahır gibi çok ürünlüde ilki)."""
    return next((p for p, k in P.PRODUCER.items() if k == kind), None)


def build(W, P, kind: str, ref: str, city_names: list[str] | None = None, city_rows: list[dict] | None = None,
          profit_hist: list[float] | None = None) -> dict[str, Any]:
    """`city_rows`: o haftanın şehir satırları (göç farkı ev sahibi tarafından tutulur; verilmezse göç 0 sayılır).
    `profit_hist`: işletmenin son <=12 haftalık kârı (ev sahibi tutar; eskiden yeniye); yalnız `firm` çekmecesinde kullanılır."""
    if kind not in KINDS or not REF_RE.fullmatch(ref):
        raise UnknownRef(ref)
    if kind == "city":
        return _city(W, P, ref, city_names, city_rows)
    if kind == "firm":
        return _firm(W, P, ref, city_names, profit_hist)
    return _BUILDERS[kind](W, P, ref, city_names)


def _city(W, P, ref: str, city_names, rows: list[dict] | None = None) -> dict:
    if not ref.isdigit():
        raise UnknownRef(ref)
    idx = int(ref)
    c = next((x for x in W.cities if x["i"] == idx), None)
    if c is None:
        raise UnknownRef(ref)
    rows = rows if rows is not None else extract_cities.city_rows(W, P, None)
    f: dict[str, Any] = dict(next(r for r in rows if r["index"] == idx))
    workers: dict[str, int] = defaultdict(int)
    for d in W.firms.values():
        if d["city"] == idx and d["workers"]:
            workers[d["kind"]] += len(d["workers"])
    top = sorted(workers.items(), key=lambda kv: (-kv[1], kv[0]))[:5]
    f.update({
        "players": len(c["players"]), "reputation": finite(c["rep"]), "idle_npcs": len(c["pool"]),
        "wage_index": finite(100.0 * W.WI[idx]) if idx in W.WI else None,
        "rent_multiplier": finite(W.RM.get(idx, 1.0)) if P.HOUSE_ON else None,
        "import_value": finite(c["imp_val"]), "export_value": finite(c["exp_val"]), "consumption_value": finite(c["cons_val"]),
        "unpaid_households": c["unpaid_w"],
        "top_sectors": [{"sector": k, "label": labels.sector_label(k), "workers": n} for k, n in top],
    })
    title = city_names[idx] if city_names and idx < len(city_names) else ref
    return {"kind": "city", "ref": ref, "title": title, "fields": _allow(f, CITY_FIELDS)}


def _sector(W, P, ref: str, city_names) -> dict:
    if ref not in W.TOPO:
        raise UnknownRef(ref)
    snap = extract_chain.chain_snapshot(W, P)
    row = next(s for s in snap["sectors"] if s["sector"] == ref)
    edges = extract_chain.chain_edges(W.RECIPES, list(W.TOPO), P.PRODUCER)
    f: dict[str, Any] = {k: row[k] for k in ("sector", "product", "firms", "healthy", "shortage", "persist", "cover_days", "price_trend", "price")}
    f["label"] = labels.sector_label(ref)
    if ref == "ahir":
        f["note_key"] = "cekmece.ahir_notu"      # metin arayüz kopyasında (tr.ts): "Ahır kamu hizmetidir: sektör panosu bu sektörü izlemez, kıtlık ve sağlık değerleri yoktur."
    firms = [(len(d["workers"]), name, d) for name, d in W.firms.items() if d["kind"] == ref and not d.get("dead") and d["workers"]]
    firms.sort(key=lambda t: (-t[0], t[1]))
    f["workers"] = sum(n for n, _x, _d in firms)
    live = [d for d in W.firms.values() if d["kind"] == ref and not d.get("dead")]      # D7: kadro doluluğu (tür kapasitesi = canlı işletmelerin kapasite toplamı)
    cap = sum(d.get("capacity", 0) for d in live)
    f["capacity"] = cap if ref != "belediye" else None
    f["fill"] = finite(sum(len(d["workers"]) for d in live) / cap) if (cap > 0 and ref != "belediye") else None
    f["cities"] = [{k: n[k] for k in ("city", "firms", "price", "healthy", "demand", "output", "stock", "shortage")}
                   for n in snap["nodes"] if n["sector"] == ref]
    f["inputs"] = [{"from": e["from"], "label": labels.sector_label(e["from"]), "product": e["product"], "qty": e["qty"]}
                   for e in edges if e["to"] == ref]
    f["users"] = [{"to": e["to"], "label": labels.sector_label(e["to"]), "product": e["product"], "qty": e["qty"]}
                  for e in edges if e["from"] == ref]
    f["firm_refs"] = [{"ref": name, "city": d["city"], "workers": n} for n, name, d in firms[:10]]
    return {"kind": "sector", "ref": ref, "title": labels.sector_label(ref), "fields": _allow(f, SECTOR_FIELDS)}


def _firm(W, P, ref: str, city_names, profit_hist: list[float] | None = None) -> dict:
    d = W.firms.get(ref)
    if d is None:
        raise UnknownRef(ref)
    on = extract_chain.board_on(W, P)
    fh = W.board["fh"].get(ref) if on else None
    loan = W.loans.get(ref)
    prof = firm_profit(W, ref, d)
    product = product_of(P, d["kind"])
    nw = len(d["workers"])
    wage = W.fwage.get(ref) if hasattr(W, "fwage") else None
    week = getattr(W, "week_no", 0)
    f = {
        "kind": d["kind"], "sector_label": labels.sector_label(d["kind"]), "city": d["city"], "lonca": d.get("lonca"),
        "workers": len(d["workers"]), "capacity": d.get("capacity"), "cash": finite(W.L.bal.get(ref, 0.0)),
        "ownership": _ownership(d), "privatized": bool(d.get("priv")), "born": d.get("born"),
        "age": (week - d["born"]) if "born" in d else None, "alive": not d.get("dead"), "died": d.get("died"),
        "profit": finite(prof), "debt": finite(loan["out"]) if loan else 0.0, "loan_rate": finite(loan["rate"]) if loan else None,
        "health": finite(fh["h"]) if fh else None, "cover_weeks": finite(fh["cover_w"]) if fh else None,
        "loss_streak": fh["streak"] if fh else None, "staffless": fh["staffless"] if fh else None,
        "exiting": fh["exiting"] if fh else None,
        "stock_units": finite(sum(q for q in d.get("stock", {}).values())),
        "insolvent_weeks": d.get("insolv", 0),
        "product": product, "price": finite(W.PRICE.get((d["city"], product))) if product is not None else None,
        "wage_avg": finite(wage / nw) if (wage is not None and nw) else None,           # haftalık ücret toplamı / çalışan
        "sold_week": finite(W.fsold.get(ref, 0.0)),                                    # haftalık satış (modelde firma başına üretim alanı yok; satılan miktar)
        "profit_hist": [finite(v) or 0.0 for v in (profit_hist or ())][-12:],
    }
    title = labels.sector_label(d["kind"])                       # iç kimlik (`ref`) başlıkta görünmez
    return {"kind": "firm", "ref": ref, "title": title, "fields": _allow(f, FIRM_FIELDS)}


def _lonca(W, P, ref: str, city_names) -> dict:
    if ref not in W.loncas:
        raise UnknownRef(ref)
    row = next(r for r in holdings.loncas(W, P) if r["ref"] == ref)      # paketle AYNI hesap (tek kaynak: holdings.loncas)
    f = {k: v for k, v in row.items() if k != "ref"}                      # members, fee, owner (grup: player/none/closed), capital, deposits, credit_out, equity
    return {"kind": "lonca", "ref": ref, "title": labels.lonca_label(ref), "fields": _allow(f, LONCA_FIELDS)}


def _hafta(cover, P):
    """Pano `cover` değeri döngü (gün) cinsindendir; haftaya çevrilir."""
    cpw = getattr(P, "CYCLES_PER_WEEK", 0) or 0
    v = finite(cover)
    return finite(v / cpw) if (v is not None and cpw > 0) else None


def _urun(W, P, ref: str, city_names) -> dict:
    """İstek üzerine ürün ayrıntısı (M10): dünya düzeyi `W.board["prod"][ürün]` + şehir kırılımı `W.board["cells"][(şehir, ürün)]`. Pano kapalıysa ya da
    ürün tarifte/panoda yoksa `UnknownRef`. Yalnız okur (`.get`); haftalık pakete girmez."""
    if not extract_chain.board_on(W, P) or ref not in P.PRODUCER:
        raise UnknownRef(ref)
    bp = (W.board.get("prod") or {}).get(ref)
    if bp is None:
        raise UnknownRef(ref)
    cells = W.board.get("cells") or {}
    sehirler = []
    for c in W.cities:
        cell = cells.get((c["i"], ref))
        if cell is None:
            continue
        sehirler.append({"sehir": c["i"], "talep": finite(cell.get("dem")), "uretim": finite(cell.get("prod")), "stok": finite(cell.get("stock")),
                         "firma": cell.get("n_prod", 0), "saglikli": cell.get("n_healthy", 0)})
    f = {
        "urun": ref, "istek": finite(bp.get("want")), "karsilanmayan": finite(bp.get("short")), "uretim": finite(bp.get("prod")),
        "stok": finite(bp.get("stock")), "kapsama_hf": _hafta(bp.get("cover"), P), "fiyat_endeksi": finite(bp.get("pidx")),
        "firma": bp.get("n_all", 0), "saglikli": bp.get("n_h", 0), "sehirler": sehirler,
    }
    return {"kind": "urun", "ref": ref, "title": labels.sector_label(P.PRODUCER[ref]), "fields": _allow(f, URUN_FIELDS)}


_BUILDERS = {"sector": _sector, "firm": _firm, "lonca": _lonca, "urun": _urun}


def from_packet(kind: str, ref: str, packet: dict | None, city_names: list[str] | None = None) -> dict[str, Any]:
    """Eski hafta (ya da model artık yok): yalnız o haftanın paket alanları. Firma verisi pakette olmadığından `fields` boş; lonca satırı `holdings.loncas`tan gelir (varsa).
    Doğrulanabilen `ref`ler (şehir indeksi, sektör) bilinmiyorsa `UnknownRef`."""
    fields: dict[str, Any] = {}
    title = ref
    if kind == "city":
        if not ref.isdigit():
            raise UnknownRef(ref)
        idx = int(ref)
        cities = (packet or {}).get("cities")
        if cities is not None and not 0 <= idx < len(cities):
            raise UnknownRef(ref)
        if cities is not None:
            fields = dict(cities[idx])
        title = city_names[idx] if city_names and idx < len(city_names) else ref
    elif kind == "sector":
        chain = (packet or {}).get("chain")
        if chain is not None:
            row = next((s for s in chain["sectors"] if s["sector"] == ref), None)
            if row is None:
                raise UnknownRef(ref)
            fields = {k: row[k] for k in ("sector", "product", "firms", "healthy", "shortage", "persist", "cover_days", "price_trend", "price")}
            fields["label"] = labels.sector_label(ref)
            fields["cities"] = [{k: n[k] for k in ("city", "firms", "price", "healthy", "demand", "output", "stock", "shortage")}
                                for n in chain["nodes"] if n["sector"] == ref]
        title = labels.sector_label(ref)
    elif kind == "urun":
        raise UnknownRef(ref)                                             # ürün ayrıntısı yalnız canlı panodan; kayıtlı pakette yok
    elif kind == "lonca":
        title = labels.lonca_label(ref)
        row = next((r for r in ((packet or {}).get("holdings") or {}).get("loncas", ()) if r.get("ref") == ref), None)
        if row is not None:                                               # PLAN-TAKIP: lonca satırı pakette (eski kayıtta yok: boş)
            fields = _allow({k: v for k, v in row.items() if k != "ref"}, LONCA_FIELDS)
    return {"kind": kind, "ref": ref, "title": title, "fields": fields}
