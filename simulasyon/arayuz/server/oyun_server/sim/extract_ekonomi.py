"""M10 Ekonomi paneli: haftalık `ekonomi` paket bloğu (tüketim, işletmeler ve iş gücü, para dilimleri). Salt okunur; `W`'ye yazılmaz.

Hane tüketimi modelin KÜMÜLATİF sayaçlarından gelir; haftalık değer = bu haftaki kümülatif - geçen haftaki kümülatif (önceki değeri `EkonomiState` tutar).
  oyuncu hanesi, dünya      `W.gate` (g kovalarının toplamı), `tuk_{n,shelf,aff}_{ise,issiz}`
  şehir ve NPC haneleri     `W.gate_c[(şehir, ad)]` (davranışsız kayıt): `tuk_*_{ise,issiz}` (oyuncu), `tuk_*_npc_{ise,issiz,dis}` (NPC), `harc_oyuncu`, `harc_npc`,
                            `npc_issiz_dusen_n`. Harcama host satırının `harc_*` sütunlarından DEĞİL buradan okunur (o sütunlar yalnız WEEKLY_CSV açıkken dolu).
  Birim: n KİŞİ-DÖNGÜdür (haftada CYCLES_PER_WEEK döngü); karşılanma = Δaff/Δn birimden bağımsızdır; sepet = Δshelf/Δn × CYCLES_PER_WEEK (kişi başı HAFTALIK sepet; Δshelf/Δn tek döngülüktür). Δn <= 0 ya da negatif fark (sayaç sıfırlandı) -> null.
  `npc_issiz_parasiz`: parası NPC_MIN_BAL altında olduğu için o döngüde tüketemeyen havuz işsizi, KİŞİ-HAFTA (kişi-döngü / CYCLES_PER_WEEK). Model NPC_POOL_CONS kapalıysa null.
  Dünya NPC değerleri şehir kayıtlarının toplamıdır; birleşik (oyuncu + NPC) oran istemcide n ile ağırlıklı alınır (blok n taşır).

  `ucret` (salt okunur): ücret endeksi `W.WI[ci]`, fiyat endeksi (modelin week_open'daki geçim endeksi `cpi`: sepetin şehir fiyatı / referans sepet, tecrübe primi ayıklanmış; aynı formül burada yeniden hesaplanır),
  alt kademe net haftalık ücret = TIER_WAGE[0] × WI × CYCLES_PER_WEEK × (1 - WAGE_TAX) (kadro_ucreti(tier 0, kind None) ile aynı), oran = net ücret / TAM sabit sepetin haftalık bedeli (sum BASKET x land x MARKET_MARKUP; hanelerin fiilen aldığı sepet DEĞİL, o Tüketim hane kartlarında). İstemci tam sepeti net / oran olarak türetir.
  Dünya değerleri şehirlerin nüfus (W.people) ağırlıklı ortalamasıdır. Hesaplanamayan alan null.

`ucret` satırı [ücret endeksi, fiyat endeksi, net haftalık ücret, net ücret / sepet].

Blok anahtarları: v, tuketim{hane{ise,issiz,npc{ise,issiz,dis},npc_issiz_parasiz,sehir[]},harcama{npc,oyuncu,toplam},urunler,ucret{dunya,sehir[]}}, isletme{istihdam,hareket,sektor,sektor_diger,sehir[]}, para.
Kişi ve firma kimliği pakete çıkmaz.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Mapping

from . import extract_chain
from .probes import finite

BOY_ESIKLERI = (8, 20, 50)
SEKTOR_SAYISI = 12
URUN_SAYISI = 5
KAMU = ("ahir", "belediye")
_KOVALAR = ("ise", "issiz")
_NPC_KOVALAR = ("ise", "issiz", "dis")


class EkonomiState:
    """Bir önceki haftanın durumu (yalnız `state.week == hafta - 1` iken geçerli)."""
    __slots__ = ("week", "gate", "gc", "staff", "alive", "fcity")

    def __init__(self) -> None:
        self.week: int = -1
        self.gate: dict[str, float] = {}               # tuk_* adı -> önceki kümülatif (W.gate, g toplamı)
        self.gc: dict[tuple[int, str], float] = {}     # (şehir, ad) -> önceki kümülatif (W.gate_c)
        self.staff: dict[str, int] = {}                # özel canlı firma -> önceki çalışan
        self.alive: set[str] = set()                   # özel canlı firmalar
        self.fcity: dict[str, int] = {}                # özel canlı firma -> şehir (batanın şehri için)


def _r(x: Any, nd: int) -> float | None:
    v = finite(x)
    return None if v is None else round(v, nd)


def _i(x: Any) -> int | None:
    v = finite(x)
    return None if v is None else int(round(v))


def _hane(n: float | None, aff: float | None, shelf: float | None, cpw: float = 7.0) -> dict[str, Any]:
    if n is None:
        return {"n": None, "karsilanma": None, "sepet": None}              # ölçülmedi (atlanan hafta, sayaç sıfırlandı)
    if aff is None or shelf is None or n <= 0 or aff < 0 or shelf < 0:
        return {"n": 0 if n <= 0 else int(round(n)), "karsilanma": None, "sepet": None}
    return {"n": int(round(n)), "karsilanma": _r(aff / n, 4), "sepet": _r(shelf / n * cpw, 2)}   # shelf/n = kişinin TEK döngülük sepeti; haftalık = × döngü/hafta


def _ozel(d: Mapping[str, Any]) -> bool:
    return d.get("kind") not in KAMU


def _boy_kovasi(n: int) -> int:
    k = 0
    for e in BOY_ESIKLERI:
        if n >= e:
            k += 1
    return k


def _hareket_say(yeni: list, onceki_staff: Mapping[str, int], simdi_staff: Mapping[str, int], batan: int) -> dict[str, int]:
    buy = kuc = 0
    for f, n in simdi_staff.items():
        if f in onceki_staff:
            if n > onceki_staff[f]:
                buy += 1
            elif n < onceki_staff[f]:
                kuc += 1
    return {"kurulan": len(yeni), "buyuyen": buy, "kuculen": kuc, "batan": batan}


def _urunler(W, P) -> list[dict[str, Any]] | None:
    if not extract_chain.board_on(W, P):
        return None
    rows = []
    for p, d in (W.board.get("prod") or {}).items():
        want, short = finite(d.get("want")), finite(d.get("short"))
        if want is None or short is None or want <= 0:
            continue
        rows.append((short / want, p, want, short, finite(d.get("prod")), finite(d.get("stock"))))
    rows.sort(key=lambda t: (-t[0], t[1]))
    return [{"urun": p, "istek": _r(w, 1), "karsilanmayan": _r(s, 1), "uretim": _r(u, 1), "stok": _r(st, 1)} for _o, p, w, s, u, st in rows[:URUN_SAYISI]]


def _ulc_base(P) -> float | None:
    """simkit.econ_core.ulc_base ile aynı (saf)."""
    base = getattr(P, "ULC_BASE", None)
    if not getattr(P, "ULC_BASE_AUTO", 0):
        return finite(base)
    mix = (0.6, 0.3, 0.1)
    try:
        return sum(m * P.TIER_WAGE[k] / P.TIER_WAGE[0] for k, m in enumerate(mix)) / sum(m * P.PROD_TIER[k] for k, m in enumerate(mix))
    except (AttributeError, IndexError, ZeroDivisionError):
        return None


def _fiyat_endeksi(W, P, ci: int, c: Mapping[str, Any], base_b: float | None, ub: float | None) -> float | None:
    """week_open'daki `cpi` ile aynı formül (yazmaz): sepetin şehir fiyatı / referans sepet / (SKILL_ON iken şehir ulc / ulc_base)."""
    try:
        if not base_b:
            return None
        v = sum(W.LAND[(ci, p)] * q for p, q in P.BASKET.items()) / base_b
        if getattr(P, "SKILL_ON", False):
            if not ub:
                return None
            v /= (c.get("ulc", getattr(P, "ULC_BASE", ub)) / ub)
        return finite(v)
    except (AttributeError, KeyError, TypeError, ZeroDivisionError):
        return None


def _tam_sepet(W, P, ci: int) -> float | None:
    """Tam sabit sepetin haftalık bedeli (şehir `ci`): sum(BASKET[p] x land(ci, p)) x MARKET_MARKUP; BASKET haftalık miktardır (households.life_demand'daki basket_cost ile aynı, orada döngüye bölünür, burada haftaya çarpılır)."""
    try:
        mk = float(getattr(W, "MARKET_MARKUP", 1.0) or 1.0)
        return finite(sum(W.LAND.get((ci, p), W.REF[p]) * q for p, q in P.BASKET.items()) * mk)
    except (AttributeError, KeyError, TypeError):
        return None


def _ucret_blogu(W, P, cpw: float, sehir_hane: list, hane: Mapping[str, Any]) -> dict[str, Any]:
    wi_map = getattr(W, "WI", None) or {}
    try:
        base_b = sum(W.REF[p] * q for p, q in P.BASKET.items())
    except (AttributeError, KeyError, TypeError):
        base_b = None
    ub = _ulc_base(P)
    tier0 = (getattr(P, "TIER_WAGE", None) or (None,))[0]
    vergi = float(getattr(P, "WAGE_TAX", 0.0) or 0.0)
    sayi: dict[Any, int] = defaultdict(int)
    for i in W.people.values():
        sayi[i.get("city")] += 1
    satir, agirlik = [], []
    for c in W.cities:
        ci = c["i"]
        wi = finite(wi_map.get(ci))
        net = None if (wi is None or tier0 is None) else round(tier0 * wi, 3) * cpw * (1.0 - vergi)
        fiyat = _fiyat_endeksi(W, P, ci, c, base_b, ub)
        sepet = _tam_sepet(W, P, ci)
        satir.append((ci, wi, fiyat, net, sepet))
        agirlik.append(sayi.get(ci, 0))

    def ort(k: int) -> float | None:
        num = den = 0.0
        for r, w in zip(satir, agirlik):
            if r[k] is not None and w > 0:
                num += r[k] * w
                den += w
        return num / den if den > 0 else None

    def oran(net: float | None, sepet: float | None) -> float | None:
        return _r(net / sepet, 3) if (net is not None and sepet and sepet > 0) else None

    d_net = ort(3)
    d_sepet = ort(4)
    # bayt bütçesi için satır = [ücret endeksi, fiyat endeksi, alt kademe net haftalık ücret, oran]; `sehir` sırası W.cities sırasıdır (öteki şehir listeleriyle aynı)
    return {
        "dunya": [_r(ort(1), 3), _r(ort(2), 3), _r(d_net, 1), oran(d_net, d_sepet)],
        "sehir": [[_r(wi, 3), _r(fy, 3), _r(net, 1), oran(net, sp)] for ci, wi, fy, net, sp in satir],
    }


def build(W, P, row: Mapping[str, Any] | None, state: EkonomiState | None) -> tuple[dict[str, Any], EkonomiState]:
    wk = int(W.week_no)
    prev = state if (state is not None and state.week == wk - 1) else None
    # önceki durum var ama ardışık değil, ya da hafta > 1 iken durum yok (yeniden başlatma, kayıt yükleme, geç ilk build): kümülatif haftalık sayılmaz, farka dayalı alanlar null;
    # bu çağrı durumu güncel kümülatifle doldurur, sonraki hafta normal çıkar. Hafta 1'de durum yoksa önceki 0'dır.
    atlandi = (state is not None and prev is None) or (state is None and wk > 1)
    pg = state.gate if state is not None else {}
    pgc = state.gc if state is not None else {}
    new = EkonomiState()
    new.week = wk
    cpw = float(getattr(P, "CYCLES_PER_WEEK", 7) or 7)

    # --- hane tüketimi ---
    gate_tot: dict[str, float] = defaultdict(float)
    for (_g, kk), v in W.gate.items():
        if isinstance(kk, str) and kk.startswith("tuk_"):
            gate_tot[kk] += v
    new.gate = dict(gate_tot)

    def dg(kk: str) -> float | None:
        v = gate_tot.get(kk, 0.0) - pg.get(kk, 0.0)
        return v if (v >= 0 and not atlandi) else None

    hane: dict[str, Any] = {k: _hane(dg("tuk_n_" + k), dg("tuk_aff_" + k), dg("tuk_shelf_" + k), cpw) for k in _KOVALAR}

    gc = getattr(W, "gate_c", None)
    gc_var = bool(gc)
    gc_now: dict[tuple[int, str], float] = dict(gc) if gc else {}
    new.gc = gc_now

    def dc(ci: int | None, ad: str) -> float | None:
        """Şehir (ci) ya da dünya (None) için haftalık fark; negatif fark None."""
        if ci is None:
            cur = sum(v for (_c, a), v in gc_now.items() if a == ad)
            old = sum(v for (_c, a), v in pgc.items() if a == ad)
        else:
            cur, old = gc_now.get((ci, ad), 0.0), pgc.get((ci, ad), 0.0)
        d = cur - old
        return d if (d >= 0 and not atlandi) else None

    def npc_blok(ci: int | None) -> dict[str, Any]:
        return {k: _hane(dc(ci, "tuk_n_npc_" + k), dc(ci, "tuk_aff_npc_" + k), dc(ci, "tuk_shelf_npc_" + k), cpw) for k in _NPC_KOVALAR}

    def parasiz(ci: int | None) -> float | None:
        if not getattr(P, "NPC_POOL_CONS", True) or not gc_var:
            return None
        d = dc(ci, "npc_issiz_dusen_n")
        return None if d is None else _r(d / cpw, 1)

    hane["npc"] = npc_blok(None) if gc_var else {k: _hane(None, None, None) for k in _NPC_KOVALAR}
    hane["npc_issiz_parasiz"] = parasiz(None)

    def harc(ci: int | None, ad: str) -> int | None:
        d = dc(ci, ad) if gc_var else None
        return None if d is None else _i(d)

    def bos_null(g: dict[str, Any]) -> dict[str, Any] | None:
        """Şehir satırında hiç hane olmayan grup (n == 0) tek `null`dur (yük); dünya satırında nesne kalır."""
        return None if g.get("n") == 0 else g

    sehir_hane = []
    for c in W.cities:
        ci = c["i"]
        sehir_hane.append({
            "sehir": ci,
            **{k: bos_null(_hane(dc(ci, "tuk_n_" + k), dc(ci, "tuk_aff_" + k), dc(ci, "tuk_shelf_" + k), cpw)) for k in _KOVALAR},
            "npc": {k: bos_null(g) for k, g in npc_blok(ci).items()},
            "npc_issiz_parasiz": parasiz(ci),
            "harcama": {"oyuncu": harc(ci, "harc_oyuncu"), "npc": harc(ci, "harc_npc")},
        } if gc_var else {"sehir": ci, **{k: _hane(None, None, None) for k in _KOVALAR}, "npc": {k: _hane(None, None, None) for k in _NPC_KOVALAR},
                          "npc_issiz_parasiz": None, "harcama": {"oyuncu": None, "npc": None}})
    hane["sehir"] = sehir_hane

    ho, hn = harc(None, "harc_oyuncu"), harc(None, "harc_npc")
    harcama = {"npc": hn, "oyuncu": ho, "toplam": (hn + ho) if (hn is not None and ho is not None) else None}

    # --- işletmeler ve iş gücü ---
    people = W.people
    n_city = len(W.cities)
    sehir_idx = {c["i"]: k for k, c in enumerate(W.cities)}
    ist = {"oyuncu": 0, "npc": 0, "ozel": 0, "kamu": 0}
    per = [{"ozel": 0, "kamu": 0, "calisan_oyuncu": 0, "calisan_npc": 0, "boy": [0] * (len(BOY_ESIKLERI) + 1)} for _ in range(n_city)]
    sek_cal: dict[str, int] = defaultdict(int)
    sek_firma: dict[str, int] = defaultdict(int)
    staff_now: dict[str, int] = {}
    fcity_now: dict[str, int] = {}
    for f, d in W.firms.items():
        if d.get("dead"):
            continue
        ozel = _ozel(d)
        k = sehir_idx.get(d.get("city"))
        nw = 0
        for q in d["workers"]:
            who = people.get(q, {}).get("who")
            if who not in ("oyuncu", "npc"):
                continue
            nw += 1
            ist[who] += 1
            ist["ozel" if ozel else "kamu"] += 1
            if k is not None:
                per[k]["calisan_" + who] += 1
                per[k]["ozel" if ozel else "kamu"] += 1
        if ozel:
            if d["workers"]:
                if k is not None:
                    per[k]["boy"][_boy_kovasi(len(d["workers"]))] += 1
            sek_cal[d["kind"]] += nw
            sek_firma[d["kind"]] += 1
            staff_now[f] = len(d["workers"])
            fcity_now[f] = d.get("city")
    new.staff, new.alive, new.fcity = staff_now, set(staff_now), fcity_now

    hareket: dict[str, Any] | None = None
    sehir_hareket: dict[int, dict[str, int]] = {}
    if prev is not None:
        yeni = [f for f in staff_now if f not in prev.alive]
        batan = [f for f in prev.alive if f not in staff_now]
        hareket = _hareket_say(yeni, prev.staff, staff_now, len(batan))
        for ci in sehir_idx:
            y = [f for f in yeni if fcity_now.get(f) == ci]
            ss = {f: n for f, n in staff_now.items() if fcity_now.get(f) == ci}
            ps = {f: n for f, n in prev.staff.items() if prev.fcity.get(f) == ci}
            sehir_hareket[ci] = _hareket_say(y, ps, ss, sum(1 for f in batan if prev.fcity.get(f) == ci))

    sirali = sorted(sek_cal, key=lambda t: (-sek_cal[t], t))
    sektor = [{"tur": t, "calisan": sek_cal[t], "firma": sek_firma[t]} for t in sirali[:SEKTOR_SAYISI]]
    diger = sirali[SEKTOR_SAYISI:]
    sektor_diger = {"calisan": sum(sek_cal[t] for t in diger), "firma": sum(sek_firma[t] for t in diger)}

    sehir_isl = []
    for c in W.cities:
        ci = c["i"]
        p = per[sehir_idx[ci]]
        sehir_isl.append({"sehir": ci, "ozel_calisan": p["ozel"], "kamu_calisan": p["kamu"], "calisan_oyuncu": p["calisan_oyuncu"], "calisan_npc": p["calisan_npc"],
                          "isgucu_disi": len(c.get("out", []) or []), "boy": p["boy"], "hareket": sehir_hareket.get(ci)})

    # --- para ---
    dep = getattr(W, "deposits", None) or {}
    bal = W.L.bal                                           # defaultdict: okurken .get (anahtar eklemez)
    oy: list[float] = []
    npc_nakit = npc_mev = 0.0
    for q, i in people.items():
        mev = dep[q][1] if q in dep else 0.0
        if i.get("who") == "oyuncu":
            oy.append(bal.get(q, 0.0) + mev)
        elif i.get("who") == "npc":
            npc_nakit += bal.get(q, 0.0)
            npc_mev += mev
    oy.sort()
    n = len(oy)
    k = int(n * 0.9)
    para = {"oyuncu_n": n, "oyuncu_ust10": _i(sum(oy[k:])), "oyuncu_alt90": _i(sum(oy[:k])), "npc_hane_nakit": _i(npc_nakit), "npc_hane_mevduat": _i(npc_mev)}

    blok = {
        "v": 1,
        "tuketim": {"hane": hane, "harcama": harcama, "urunler": _urunler(W, P), "ucret": _ucret_blogu(W, P, cpw, sehir_hane, hane)},
        "isletme": {"istihdam": ist, "hareket": hareket, "sektor": sektor, "sektor_diger": sektor_diger, "sehir": sehir_isl},
        "para": para,
    }
    return blok, new
