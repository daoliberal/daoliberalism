"""Konut kaydı (PLAN-KREDI T4, S2d): paketin `housing` bloğu. Arayüzde GÖSTERİLMEZ; yalnız kayıtta tutulur. Kimlik çıkmaz.

Salt okur: `W` ve `P` değiştirilmez, model içe aktarılmaz (`defaultdict`'lere yalnız `.items()` / `.get()` ile erişilir). Stok alanları o haftanın durumudur;
kira alanları modelin `L.flows` birikimli sayaçlarının bir önceki haftaya göre farkıdır (`credit` ile aynı desen, U3): önceki hafta yoksa (ilk hafta, çatallanan ya da
yeniden kurulan koşunun ilk haftası, aradaki hafta atlandıysa) haftalık alanlar `null`dur. Konut kapalıysa (`P.HOUSE_ON` yanlış) bütün alanlar `null`dur.

Kira akışı (model): hane kirası `emanet<i>`e birikir (`konut_kirasi`); hafta kapanışında `own[i]` sahiplerine `(1 - HOUSE_MAINT) x emanet x pay` kadar ödenir
(`konut_kira_geliri`; ödenen paydan `RENT_TAX` oranında `kira_vergisi` şehre gider), kalan (bakım payı ve sahipsiz konutun kirası) şehre geçer (`konut_kirasi_sehir`).
Sahiplik `W.own[şehir][hesap]`: oyuncu, kredi verenin haciz havuzu (`<lonca>_sermaye`, ipotek haczi) ya da başka hesap.
"""
from __future__ import annotations

from typing import Any, Mapping

from .credit import _int, _num

FLOWS = {"rent_paid": "konut_kirasi", "rent_owners": "konut_kira_geliri", "rent_city": "konut_kirasi_sehir", "rent_tax": "kira_vergisi"}   # L.flows anahtarları
FIELDS = ("stock", "owners", "units_players", "units_lonca", "units_other", *FLOWS)
PREFIX = "housing."                                           # `ModelHost._credit_prev` içinde bu blokun anahtarları

NOTES: dict[str, str] = {
    "stock": "Konut stoku (Σ `W.hs`, bütün şehirler; stok).",
    "owners": "En az bir konutu olan farklı oyuncu sayısı (bütün şehirler; stok).",
    "units_players": "Oyuncuların elindeki konut birimi (Σ `W.own`, anahtarı oyuncu olanlar; stok).",
    "units_lonca": "Loncaların elindeki konut birimi: ipotek haczinde konut kredi veren loncanın havuzuna (`<lonca>_sermaye`) geçer (stok).",
    "units_other": "Oyuncu ve lonca havuzu olmayan hesapların elindeki konut birimi (normalde 0; stok). `units_players + units_lonca + units_other` = Σ `W.own`.",
    "rent_paid": "Haftada hanelerin ödediği kira (Akçe; modelin `konut_kirasi` akışı: `emanet<şehir>` hesabına girenler). Oyuncu ve çalışan NPC hanesi öder.",
    "rent_owners": "Haftada ev sahiplerine ödenen kira (Akçe; `konut_kira_geliri`, kira vergisi düşülmeden). Sahibi olan konutların payı: `(1 - bakım payı) x emanet x sahip birimi / stok`.",
    "rent_city": "Haftada şehir kasasına geçen kira (Akçe; `konut_kirasi_sehir`): bakım payı ve sahipsiz (kimsenin olmayan) konutların kirası.",
    "rent_tax": "Haftada ev sahiplerinin ödediği kira vergisi (Akçe; `kira_vergisi`, şehir kasasına; vergi kapalıyken 0). `rent_paid = rent_owners + rent_city` (± 1 Akçe, yuvarlama).",
}


def totals(W, P) -> dict[str, Any]:
    """Birikimli kira sayaçları (düz sözlük, anahtar `housing.<alan>`). `housing.wk` hafta numarası (ardışıklık denetimi). Salt okur."""
    fl = W.L.flows
    t: dict[str, Any] = {PREFIX + "wk": getattr(W, "week_no", None)}
    for k, src in FLOWS.items():
        t[PREFIX + k] = fl.get(src, 0.0)
    return t


def stocks(W) -> dict[str, int]:
    """Stok alanları. `owners`: en az bir birimi olan farklı oyuncu (bir birimden küçük kalıntılar sayılmaz; modelin `week_metrics` ölçütü: > 0,5)."""
    people = W.people
    players: dict[str, float] = {}
    lonca = other = 0.0
    for _ci, per in W.own.items():
        for q, u in per.items():
            p = people.get(q)
            if p is not None and p.get("who") == "oyuncu":
                players[q] = players.get(q, 0.0) + u
            elif isinstance(q, str) and q.endswith("_sermaye"):
                lonca += u
            else:
                other += u
    return {"stock": _int(sum(W.hs.values())), "owners": sum(1 for u in players.values() if u > 0.5),
            "units_players": _int(sum(players.values())), "units_lonca": _int(lonca), "units_other": _int(other)}


def build(W, P, prev: Mapping[str, Any] | None, cur: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Paketin `housing` bloğu (düz alanlar, tam Akçe). `prev`: bir önceki haftanın `totals` çıktısı (yoksa kira alanları null), `cur`: bu haftanınki
    (verilmezse hesaplanır). Konut kapalıysa her alan null. Salt okur."""
    if not getattr(P, "HOUSE_ON", False):
        return {k: None for k in FIELDS}
    cur = totals(W, P) if cur is None else cur
    wk, pwk = cur.get(PREFIX + "wk"), (prev or {}).get(PREFIX + "wk")
    weekly = prev is not None and (wk is None or pwk is None or wk == pwk + 1)
    out: dict[str, Any] = dict(stocks(W))
    for k in FLOWS:
        v, p = _num(cur.get(PREFIX + k)), _num((prev or {}).get(PREFIX + k))
        out[k] = _int(max(0.0, v - p)) if weekly and v is not None and p is not None and v - p >= -1e-9 else None
    return out
