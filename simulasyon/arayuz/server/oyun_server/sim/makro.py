"""M10 Ekonomi paneli, Makro göstergeler: haftalık `makro` paket bloğu (ekonomi bloğundan AYRI). Salt okunur; `W`'ye yazılmaz, model içe aktarılmaz.

SAF: `W` ve `P` yalnız okunur (defaultdict'lere `.get` / `.items()`; anahtar eklenmez). Ölçüm aracı (olc9.py) bu dosyayı AYNEN yükleyip `olc(W, P, state)` çağırır: formüller tek kaynaktır.
Bayt bütçesi: en çok 900 bayt / hafta (test: tests/test_makro.py). Okunamayan alan `null` (uydurma yok).

Gösterge kaynakları (modelde):
  fiyat.tuk         tüketici fiyat endeksi, 1. hafta = 1: `W.weekly[-1].series.pidx` / `W.weekly[0].series.pidx` (sepetin şehir ortalaması fiyatı; `week_metrics.phase_metrics`)
  fiyat.enf         yıllık enflasyon: `policy.pol_step` ile AYNI: (pidx_şimdi / pidx_(POL_INF_WEEKS hafta önce; yoksa ilk hafta) - 1) x 52 / POL_INF_WEEKS, [-1, 1] kırpılır; < 2 haftalık kayıtta null
  fiyat.uretici     üretici fiyat endeksi: sepet DIŞI ürünlerin (ara mal) üretim ağırlıklı fiyatı = sum(prod_w x LAND) / sum(prod_w x REF) (REF = 1. hafta fiyatı; 1. hafta = 1)
  fiyat.ucret       ücret endeksi: `W.WI[şehir]` nüfus (`W.people`) ağırlıklı ortalama (1. hafta = 1)
  fiyat.gercek_ucret ücret endeksi / tüketici fiyat endeksi
  uretim.nominal    toplam üretim değeri (brüt, ara mallar dahil): sum(`W.prod_w`[(şehir, ürün)] x `W.LAND`[(şehir, ürün)])
  uretim.gercek     aynı miktarlar, 1. hafta fiyatlarıyla (`W.REF`): sum(prod_w x REF)
  uretim.buyume     gerçek üretimin 13 hafta öncesine göre değişimi (state; geçmiş yoksa null)
  uretim.verimlilik gerçek üretim / çalışan (`W.series.employed`)
  para.stok         `W.L.total()` (açılış dahil); kalemler: mali (`L.fiscal_minted`, şehir basımı), kredi_net (`L.cm_mint` - `L.cm_burn`), acilis (`L.opening`, NPC devreden kazanç)
  para.hiz          dolaşım hızı: haftalık hane harcaması (`W.series.cons` = `L.flows['satis']` haftalık farkı) / para stoku (modelin `hiz_satis` sütunuyla aynı)
  faiz.*            yıllık BİLEŞİK = (1 + haftalık)^52 - 1: politika `W.pol[0]`; mevduat: `W.dep_ema` x `W.dep_tot` ağırlıklı (loncalar); kredi: açık kredi ve ipotek `rate` x `out` ağırlıklı; gercek = (1 + politika) / (1 + enf) - 1 (Fisher)
  marj.npc/oyuncu   firma kârı / satış: modelin gelir-gider defteri (`cash_meas._kar_defter`): sum(`L.frev` - sum(`L.fexp`)) / sum(frev); kamu (belediye, ahır) hariç; `olc9._tipi` ile NPC / oyuncu ayrımı
  konut.kira        kira endeksi = ort(`W.RENT_CY`) / (RENT_H x TIER_WAGE[0]) (açılış kirası = 1); konut.kira_gelir = haftalık kira (RENT_CY x CYCLES_PER_WEEK) / oyuncu ort. haftalık geliri; HOUSE_ON kapalıysa null
  dagilim.*         Gini: nakit + mevduat (oyuncu; `L.bal` + `W.deposits`), gelir (`W.series.gini_inc`), servet (`W.series.gini`, modelin tanımı: ev ve hisse dahil);
                    yoksul = oyuncu net haftalık geliri (`L.income`) şehrin tam sepetinin altında olan pay (tam sepet = sum(BASKET x land) x MARKET_MARKUP); medyan_sepet = medyan gelir / tam sepet (ortalama şehir)
  kredi.stok        sum(`W.loans` out) + sum(`W.mortgages` out); buyume 13 hf (state); temerrut = bu haftaki temerrüt adedi (`L.flows['temerrut_adet']` farkı) / (açık kredi adedi + temerrüt)
Ölçülmeyenler: ayrı bir "net gelir" defteri yok (`L.income` brüt gelir türlerini toplar: ücret, ödenek, temettü, faiz, kira geliri; vergi kesintisi ücret kaleminde zaten net yazılır); firma kârı NPC / oyuncu için yalnız defterdeki satış gelirli kalemlerden.

Blok: v, fiyat{tuk,enf,uretici,ucret,gercek_ucret}, uretim{nominal,gercek,buyume,verimlilik}, para{stok,korunum,mali,kredi_net,acilis,hiz}, faiz{politika,mevduat,kredi,gercek},
      marj{npc,oyuncu}, konut{kira,kira_gelir}|null, dagilim{gini_nakit,gini_gelir,gini_servet,yoksul,medyan_sepet}, kredi{stok,buyume,temerrut}.
"""
from __future__ import annotations

from collections import deque
from typing import Any, Mapping

from .probes import finite

BUYUME_HAFTA = 13
KAMU = ("belediye", "ahir")


class MakroState:
    """Bir önceki haftaların durumu (yalnız ardışık haftalar için geçerli)."""
    __slots__ = ("week", "hist", "temerrut")

    def __init__(self) -> None:
        self.week: int = -1
        self.hist: dict[int, tuple[float | None, float | None]] = {}   # hafta -> (gerçek üretim, kredi stoku); en çok BUYUME_HAFTA + 1 hafta
        self.temerrut: float | None = None                              # önceki haftanın birikimli temerrüt adedi


def _r(x: Any, nd: int) -> float | None:
    v = finite(x)
    return None if v is None else round(v, nd)


def _i(x: Any) -> int | None:
    v = finite(x)
    return None if v is None else int(round(v))


def _oran(a: float | None, b: float | None) -> float | None:
    return None if (a is None or b is None or b == 0) else a / b


def _tipi(d: Mapping[str, Any]) -> str:
    """olc9._tipi ile aynı: oyuncu / kamu / NPC."""
    if d.get("owner") is not None or d.get("org_owner"):
        return "oyuncu"
    if d.get("kind") in KAMU:
        return "kamu"
    return "npc"


def _gini(vals: list[float]) -> float | None:
    """`week_metrics.phase_metrics` ile aynı formül (artan sıralı)."""
    v = sorted(vals)
    n, tot = len(v), sum(vals)
    if n == 0 or tot <= 0:
        return None
    return sum((2 * (i + 1) - n - 1) * x for i, x in enumerate(v)) / (n * tot)


def _tam_sepet(W, P, ci: int) -> float | None:
    """Tam sabit sepetin haftalık bedeli: sum(BASKET[p] x land(ci, p)) x MARKET_MARKUP (`extract_ekonomi._tam_sepet` ile aynı)."""
    try:
        mk = float(getattr(W, "MARKET_MARKUP", 1.0) or 1.0)
        return finite(sum(W.LAND.get((ci, p), W.REF[p]) * q for p, q in P.BASKET.items()) * mk)
    except (AttributeError, KeyError, TypeError):
        return None


def enflasyon(W, P) -> float | None:
    """Yıllık enflasyon, `policy.pol_step` yöntemiyle (pencere = POL_INF_WEEKS)."""
    wk = getattr(W, "weekly", None) or []
    if len(wk) < 2:
        return None
    pencere = int(getattr(P, "POL_INF_WEEKS", 13) or 13)
    try:
        simdi = wk[-1]["series"]["pidx"]
        eski = wk[-pencere]["series"]["pidx"] if len(wk) >= pencere else wk[0]["series"]["pidx"]
        return finite(max(-1.0, min(1.0, (simdi / max(1e-9, eski) - 1.0) * (52.0 / pencere))))
    except (KeyError, TypeError, IndexError):
        return None


def _tuketici(W) -> float | None:
    wk = getattr(W, "weekly", None) or []
    ser = getattr(W, "series", None) or {}
    try:
        taban = wk[0]["series"]["pidx"] if wk else ser["pidx"]
        return finite(ser["pidx"] / taban) if taban else None
    except (KeyError, TypeError, IndexError):
        return None


def _nufus_sehir(W) -> dict[Any, int]:
    sayi: dict[Any, int] = {}
    for i in W.people.values():
        c = i.get("city")
        sayi[c] = sayi.get(c, 0) + 1
    return sayi


def _ucret_endeksi(W) -> float | None:
    wi = getattr(W, "WI", None) or {}
    sayi = _nufus_sehir(W)
    num = den = 0.0
    for c in W.cities:
        ci = c["i"]
        v = finite(wi.get(ci))
        w = sayi.get(ci, 0)
        if v is not None and w > 0:
            num += v * w
            den += w
    return num / den if den > 0 else None


def _uretim(W) -> tuple[float | None, float | None]:
    """(nominal, gerçek): prod_w haftalık üretim miktarı; LAND güncel şehir fiyatı, REF 1. hafta fiyatı."""
    pw = getattr(W, "prod_w", None) or {}
    if not pw:
        return None, None
    nom = gercek = 0.0
    for (ci, p), q in pw.items():
        ref = W.REF.get(p)
        land = W.LAND.get((ci, p), ref)
        if ref is None or land is None:
            continue
        nom += q * land
        gercek += q * ref
    return nom, gercek


def _uretici_fiyat(W, P) -> float | None:
    pw = getattr(W, "prod_w", None) or {}
    sepet = getattr(P, "BASKET", None) or {}
    num = den = 0.0
    for (ci, p), q in pw.items():
        if p in sepet:
            continue
        ref = W.REF.get(p)
        land = W.LAND.get((ci, p), ref)
        if ref is None or land is None:
            continue
        num += q * land
        den += q * ref
    return num / den if den > 0 else None


def yillik(r: float | None) -> float | None:
    """Haftalık faizi yıllık BİLEŞİK orana çevirir: (1 + r)^52 - 1 (M14: basit r x 52 değil)."""
    v = finite(r)
    return None if v is None or v <= -1.0 else (1.0 + v) ** 52 - 1.0


def _faiz(W, P, enf: float | None) -> dict[str, float | None]:
    pol = None
    if getattr(W, "POL_ON", False):
        p0 = (getattr(W, "pol", None) or [None])[0]
        pol = None if p0 is None else yillik(float(p0))
    dep_tot = getattr(W, "dep_tot", None) or {}
    dep_ema = getattr(W, "dep_ema", None) or {}
    d_den = sum(dep_tot.get(lo, 0.0) for lo in W.loncas)
    mev = (sum(dep_ema.get(lo, 0.0) * dep_tot.get(lo, 0.0) for lo in W.loncas) / d_den) if d_den > 1e-9 else None
    num = den = 0.0
    for k in list((getattr(W, "loans", None) or {}).values()) + list(getattr(W, "mortgages", None) or []):
        out = k.get("out", 0.0)
        if out > 0 and k.get("rate") is not None:
            num += k["rate"] * out
            den += out
    kredi = yillik(num / den) if den > 1e-9 else None
    mev = yillik(mev)
    gercek = ((1.0 + pol) / (1.0 + enf) - 1.0) if (pol is not None and enf is not None and enf > -1.0) else None   # Fisher: bileşik reel faiz
    return {"politika": pol, "mevduat": mev, "kredi": kredi, "gercek": gercek}


def _marj(W) -> dict[str, float | None]:
    L = W.L
    if getattr(L, "fexp", None) is None or getattr(L, "frev", None) is None:
        return {"npc": None, "oyuncu": None}
    kar = {"npc": 0.0, "oyuncu": 0.0}
    sat = {"npc": 0.0, "oyuncu": 0.0}
    for f, gid in list(L.fexp.items()):
        d = W.firms.get(f)
        if d is None:
            continue
        t = _tipi(d)
        if t not in kar:
            continue
        rev = L.frev.get(f, 0.0)
        kar[t] += rev - sum(gid.values())
        sat[t] += rev
    return {t: _oran(kar[t], sat[t]) if sat[t] > 0 else None for t in kar}


def _korunum(L) -> float | None:
    """Para korunumu farkı (0 olmalı): tüm hesap bakiyeleri toplamı (`L.total()`: hane, firma, şehir, lonca, ...) - (basılan + açılış stoku).
    `ledger.assert_conserved` ile aynı tanım. NOT: hane `nakit + mevduat` toplamı M ile KARŞILAŞTIRILMAZ: mevduat loncanın borcudur (talep hakkı), nakdi
    kredi yoluyla başkasının bakiyesindedir; aynı para hem borçlunun nakdinde hem mevduat sahibinin alacağında görünür (iç para). Çift sayım ölçümdedir, defterde değil."""
    tot = finite(L.total())
    mint = finite(getattr(L, "minted", None))
    if tot is None or mint is None:
        return None
    return tot - (mint + (finite(getattr(L, "opening", 0.0)) or 0.0))


def _konut(W, P, gelir_ort: float | None) -> dict[str, float | None] | None:
    if not getattr(P, "HOUSE_ON", False):
        return None
    sayi = _nufus_sehir(W)
    rent = getattr(W, "RENT_CY", None) or {}
    num = den = 0.0
    for c in W.cities:
        v = finite(rent.get(c["i"]))
        w = sayi.get(c["i"], 0)
        if v is not None and w > 0:
            num += v * w
            den += w
    if den <= 0:
        return {"kira": None, "kira_gelir": None}
    ort = num / den
    taban = float(P.RENT_H) * float(P.TIER_WAGE[0])
    cpw = float(getattr(P, "CYCLES_PER_WEEK", 7) or 7)
    return {"kira": _oran(ort, taban), "kira_gelir": _oran(ort * cpw, gelir_ort)}


def _dagilim(W, P) -> tuple[dict[str, float | None], float | None]:
    L = W.L
    dep = getattr(W, "deposits", None) or {}
    nakit: list[float] = []
    gelir: list[tuple[float, int]] = []
    for q, i in W.people.items():
        if i.get("who") != "oyuncu":
            continue
        nakit.append(L.bal.get(q, 0.0) + (dep[q][1] if q in dep else 0.0))
        gelir.append((L.income.get(q, 0.0), i.get("city")))
    sepet = {c["i"]: _tam_sepet(W, P, c["i"]) for c in W.cities}
    yoksul = sum(1 for g, ci in gelir if sepet.get(ci) is not None and g < sepet[ci])
    ser = getattr(W, "series", None) or {}
    ort_gelir = (sum(g for g, _c in gelir) / len(gelir)) if gelir else None
    med = None
    sp = [v for v in sepet.values() if v]
    if gelir and sp:
        gs = sorted(g for g, _c in gelir)
        med = _oran(gs[len(gs) // 2], sum(sp) / len(sp))
    return {"gini_nakit": _gini(nakit), "gini_gelir": finite(ser.get("gini_inc")), "gini_servet": finite(ser.get("gini")),
            "yoksul": (yoksul / len(gelir)) if gelir else None, "medyan_sepet": med}, ort_gelir


def _kredi_stoku(W) -> tuple[float, int]:
    loans = list((getattr(W, "loans", None) or {}).values())
    mort = list(getattr(W, "mortgages", None) or [])
    return sum(k.get("out", 0.0) for k in loans) + sum(k.get("out", 0.0) for k in mort), len(loans) + len(mort)


def olc(W, P, state: MakroState | None) -> tuple[dict[str, Any], MakroState]:
    """Ham değerler (yuvarlamasız) ve yeni durum. Paket bloğu `build` bunu yuvarlar; olc9.py ham değeri CSV'ye yazar."""
    wk = int(W.week_no)
    onceki = state if (state is not None and state.week == wk - 1) else None
    atlandi = (state is not None and onceki is None) or (state is None and wk > 1)
    L = W.L
    ser = getattr(W, "series", None) or {}

    enf = enflasyon(W, P)
    cpi = _tuketici(W)
    wi = _ucret_endeksi(W)
    nom, gercek = _uretim(W)
    ppi = _uretici_fiyat(W, P)
    stok = finite(L.total())
    cons = finite(ser.get("cons"))
    emp = finite(ser.get("employed"))
    kstok, kadet = _kredi_stoku(W)
    dag, gelir_ort = _dagilim(W, P)

    yeni = MakroState()
    yeni.week = wk
    if state is not None and not atlandi:
        yeni.hist = {k: v for k, v in state.hist.items() if k > wk - BUYUME_HAFTA - 1}
    yeni.hist[wk] = (gercek, kstok)
    gec = yeni.hist.get(wk - BUYUME_HAFTA)

    def buyume(now: float | None, then: float | None) -> float | None:
        return None if (now is None or then is None or then <= 0) else now / then - 1.0

    tem_now = finite(L.flows.get("temerrut_adet", 0.0))
    yeni.temerrut = tem_now
    tem = None
    if tem_now is not None and (onceki is not None or wk == 1) and not atlandi:
        d = tem_now - ((onceki.temerrut or 0.0) if onceki is not None else 0.0)
        if d >= 0:
            tem = d / (kadet + d) if (kadet + d) > 0 else None

    ham = {
        "fiyat": {"tuk": cpi, "enf": enf, "uretici": ppi, "ucret": wi, "gercek_ucret": _oran(wi, cpi)},
        "uretim": {"nominal": nom, "gercek": gercek, "buyume": buyume(gercek, gec[0] if gec else None), "verimlilik": _oran(gercek, emp)},
        "para": {"stok": stok, "korunum": _korunum(L), "mali": finite(getattr(L, "fiscal_minted", None)),
                 "kredi_net": finite(getattr(L, "cm_mint", 0.0) - getattr(L, "cm_burn", 0.0)), "acilis": finite(getattr(L, "opening", 0.0)),
                 "hiz": _oran(cons, stok)},
        "faiz": _faiz(W, P, enf),
        "marj": _marj(W),
        "konut": _konut(W, P, gelir_ort),
        "dagilim": dag,
        "kredi": {"stok": kstok, "buyume": buyume(kstok, gec[1] if gec else None), "temerrut": tem},
    }
    return ham, yeni


_YUVARLA = {
    "fiyat": {"tuk": 3, "enf": 4, "uretici": 3, "ucret": 3, "gercek_ucret": 3},
    "uretim": {"nominal": 0, "gercek": 0, "buyume": 4, "verimlilik": 2},
    "para": {"stok": 0, "korunum": 2, "mali": 0, "kredi_net": 0, "acilis": 0, "hiz": 4},
    "faiz": {"politika": 4, "mevduat": 4, "kredi": 4, "gercek": 4},
    "marj": {"npc": 4, "oyuncu": 4},
    "konut": {"kira": 3, "kira_gelir": 4},
    "dagilim": {"gini_nakit": 3, "gini_gelir": 3, "gini_servet": 3, "yoksul": 3, "medyan_sepet": 3},
    "kredi": {"stok": 0, "buyume": 4, "temerrut": 4},
}


def build(W, P, state: MakroState | None) -> tuple[dict[str, Any], MakroState]:
    ham, yeni = olc(W, P, state)
    blok: dict[str, Any] = {"v": 1}
    for g, alanlar in _YUVARLA.items():
        src = ham[g]
        if src is None:
            blok[g] = None
            continue
        blok[g] = {k: (_i(src[k]) if nd == 0 else _r(src[k], nd)) for k, nd in alanlar.items()}
    return blok, yeni
