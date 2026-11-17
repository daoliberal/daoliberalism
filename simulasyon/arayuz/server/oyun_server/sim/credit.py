"""Kredi kaydı (PLAN-KREDI T2, S1): paketin `credit` bloğu. Arayüzde GÖSTERİLMEZ; yalnız kayıtta tutulur.

Salt okur: `W` ve `P` değiştirilmez, model içe aktarılmaz (defaultdict'lere yalnız `.items()` / `.get()` ile erişilir; testle kilitli).
Haftalık değer = birikimli sayaçların bir önceki haftaya göre farkı (`ModelHost._labor_prev` deseni, U3): önceki hafta yoksa
(ilk hafta, çatallanan ya da yeniden kurulan koşunun ilk haftası, aradaki hafta atlandıysa) haftalık alanlar `null` yazılır ve
birikimli toplam o hafta tabana alınır. `found.*` modelin KENDİ haftalık satırından okunur (model satır sayaçlarını her hafta sıfırlar).
Okunamayan değer `null`. Tutarlar tam Akçe, oranlar 4 ondalık.

Farklı kurucu sayısı (U4) türetmedir; modelin sayacı değişmez. Ret olunca kuruluş döngüsünde yalnız içteki `while` kırılır, dıştaki
`for lo in loncas` turunda aynı kurucu yeniden denenir; `FOUND_PER_LONCA = 99` olduğundan ilk tur bütün adayları ilk rete kadar işler.
Bu yüzden şehir-hafta başına ret ya 0'dır ya da tam `len(W.loncas)`'tır (kapalı loncalar da döngüdedir): farklı reddedilen kurucu = ret / lonca sayısı.
"""
from __future__ import annotations

from typing import Any, Mapping

# Birikimli sayaçların kaynakları (blok yolu -> model anahtarı).
CAND = {"cities": "hafta_sehir", "players": "oyuncu_toplam", "working": "o_calisan", "worked": "o_worked", "harc": "o_harc",
        "cands": "aday_son", "sig": "sinyal_esik", "sig_ok": "sinyal_worth_gecen"}                       # W.gate anahtarları
PROD = {"signal": "sinyal_hafta", "below": "sinyal_esigi", "input": "girdi_kit", "cooldown": "cooldown", "room": "pazar_yeri",
        "oversupply": "arz_fazlasi", "feas": "fizibilite", "import": "fiyat_ithal_ucuz", "passed": "worth_gecti",
        "no_founder": "kurucu_yok", "credit_short": "kredi_yetersiz", "founded": "kuruldu"}             # W.chain anahtarları (board: Σ sb_*)
FIRM = {"age": "yas", "profit": "kar", "arrears": "gecikme", "rep": "itibar", "unsold": "satilamayan", "ok": "gecti",
        "limit": "limit_kar_katı", "pool": "havuz_yetmez", "pd": "pd_ret"}                              # W.cx_ref anahtarları
CHAN = {"found": ("kredi_kurulus_adet",), "growth": ("buyume_kredisi_adet", "kredi_buyume_adet"), "young": ("kredi_genc_adet",),
        "renew": ("kredi_yenileme_adet",), "invest": ("kredi_yatirim_adet",), "rnd": ("kredi_arge_adet", "kredi_arge_kurulus_adet"),
        "media": ("kredi_medya_adet",), "fund": ("kredi_fon_adet",), "mortgage": ("kredi_konut_adet",), "privat": ("kredi_ozellestirme_adet",),
        "npc_bridge": ("npc_kopru_kredisi_adet",), "npc_revive": ("npc_canlandirma_adet",)}            # L.flows anahtarları (toplanır)
LOSS = {"default_n": ("temerrut_adet",), "default_loss": ("temerrut_kayip_akce",), "exit_loss": ("batis_kayip_akce",),
        "npc_loss": ("npc_batis_kayip_akce", "dao_batis_kayip_akce"), "dep_loss": ("mevduat_kaybi_akce",), "foreclose": ("haciz_adet",)}
DEATHS = {"player": ("batan_oyuncu_firmasi_adet",), "le3": ("batis_yas_le3",), "age_sum": ("batis_yas_hafta",), "dao": ("batan_dao_adet",),
          "npc_fail": ("npc_batis_adet",), "npc_revived": ("npc_canlandirma_adet",)}
CAUSE = {"girdi": "girdi", "talep": "talep", "marj": "marj", "tekno": "teknoloji_geride"}               # L.flows "olum_<yaş>_<neden>"
LONCA_FLOW = {"moved": ("mevduat_tasima",), "founded": ("girisimci_lonca_kurulus_adet",), "refounded": ("lonca_kurulus_adet",),
              "closed": ("lonca_kapanis_adet",)}
LONCA_STAT = {"closed_insolv": "kapanis_batik", "insolv_wait": "batik_bekleme_hafta"}                  # W.lo_stat (yeni model; yoksa null)

NOTES: dict[str, str] = {
    "found": "Kuruluş kredisi (modelin haftalık satırı): `tries` deneme sayısı, `rej` ret, `granted` = tries - rej (verilen), `cover` tavan + birikim / gereken "
             "sermaye deneme ortalaması (1 altı = eksik oran; yeniden deneme aynı oranla sayılır; deneme yoksa null). `founders` / `founders_rej`: aynı kurucu "
             "her lonca turunda yeniden denendiği için FARKLI kurucu sayısı = ret / lonca sayısı (şehir-hafta başına ret ya 0 ya tam lonca sayısıdır); ret lonca "
             "sayısına bölünmüyorsa null. `why` ({`pool`, `rep`}: havuz nakdi / itibar) ve `kinds` ({sektör: n}, yalnız sıfırdan büyükler) aynı biçimde farklı kurucu düzeyindedir.",
    "gate.cand": "Aday hunisi (haftalık, bütün 25 haftalık kovaların toplamının farkı): `cities` şehir-hafta, `players` oyuncu, `working` çalışan, `worked` "
                 "yeterince çalışmış, `harc` harcı biriktirmiş, `cands` kurucu adayı (aday_son), `sig` eşiği geçen ürün sinyali, `sig_ok` değerlendirmeyi geçen sinyal.",
    "gate.prod": "Ürün hunisi (haftalık): `signal` sinyal haftası, `below` eşik altı, `input` girdi kıtlığı, `board` Σ pano kapıları (sb_*), `cooldown` bekleme süresi, "
                 "`room` pazar yeri yok, `oversupply` arz fazlası, `feas` fizibilite, `import` ithal ucuz, `passed` kapıları geçen, `no_founder` kurucu yok, "
                 "`credit_short` kredi yetersiz (deneme düzeyi: yeniden denemeler dahil), `founded` kurulan. `girdi:<x>` alt sayaçları alınmaz.",
    "firm": "Mevcut firma kredisi kapıları (`W.cx_ref` haftalık farkı; bir firma bir kapıda bir kez sayılır): `age` yaş, `profit` kâr, `arrears` gecikme, "
            "`rep` kurum itibarı, `unsold` satılamayan oranı (bu beşi RED nedenidir), `ok` kapıları geçen, `limit` kâr katı limiti, `pool` havuz yetmedi, `pd` rasyonlama reddi.",
    "chan": "Haftada verilen kredi adedi, kanal kanal: `found` kuruluş, `growth` büyüme, `young` genç firma, `renew` yenileme, `invest` yatırım, `rnd` Ar-Ge "
            "(Ar-Ge kuruluşu dahil), `media` medya, `fund` kuruluş fonu kredisi (genç firma kitinin fon yolu; modelin `kredi_fon_adet` sayacı, başka kanalların adedine de "
            "yazılmış olabilir), `mortgage` konut, `privat` özelleştirme, `npc_bridge` yerleşik işletme köprü kredisi, `npc_revive` kredili yeniden "
            "açılış (kredisiz geçiş desteğiyle açılış dahil); `young_rej` genç firma kredisi reddi. Reddi sayılan tek kanal budur: modelde yalnız genç firma kanalının ret sayacı "
            "var; öbür kanalların (büyüme, yenileme, yatırım, Ar-Ge, medya, konut, fon) reddi kayıtta yoktur, kuruluş kredisinin reddi `found` bloğundadır.",
    "loss": "Haftalık kredi kaybı: `default_n` temerrüt adedi, `default_loss` temerrüt kaybı (Akçe), `exit_loss` kurucu ayrılması batışı kaybı, `npc_loss` yerleşik işletme ve "
            "DAO batışı kaybı, `dep_loss` mevduat kaybı, `foreclose` haciz adedi.",
    "deaths": "Haftalık firma ölümleri (birikimli karşılıkları dünya alanlarıdır: `failed_player_cum`, `failed_dao_cum`, `failed_npc_default_cum`; `failed_cum` yalnız "
              "`npc_fail`in birikimlisidir): `player` oyuncu işletmesi, `le3` ömrü 3 hafta ve altı olanlar, `age_sum` ölenlerin yaş toplamı (hafta), `cause` ({`girdi`, `talep`, "
              "`marj`, `tekno`}) oyuncu işletmesi ölüm nedeni, `dao` Ar-Ge DAO, `npc_fail` yerleşik işletme iflası, `npc_default` yerleşik işletme temerrüt ölümü, "
              "`npc_revived` yeniden açılan yerleşik işletme.",
    "lonca": "Lonca sınıfları (stok; verebilen: kapalı değil, öz kaynak > 0 ve kaldıraç payı LEV_K x öz kaynak - kredi > 0; batık: öz kaynak < 0; ara: kalan): `lendable` / "
             "`insolvent` sayı, `dep_lendable` / `dep_insolvent` o sınıfların mevduatı (Akçe), `dep_top_share` en büyük tek loncanın mevduat payı. Haftalık: `moved` loncalar "
             "arası taşınan mevduat (Akçe), `founded` girişimci loncası kuruluşu, `refounded` yeniden kuruluş, `closed` kapanış, `closed_insolv` batıklıktan kapanış, "
             "`insolv_wait` batık loncanın kapanma beklediği hafta (son ikisi eski modelde null).",
}


def _num(x: Any) -> float | None:
    if x is None or isinstance(x, bool):
        return None
    if isinstance(x, str):
        try:
            x = float(x)
        except ValueError:
            return None
    if not isinstance(x, (int, float)) or x != x or x in (float("inf"), float("-inf")):
        return None
    return float(x)


def _int(x: float | None) -> int | None:
    return None if x is None else int(round(x))


def _whole(x: float | None) -> int | None:
    """Tamsayı değerli sayı -> int; değilse None."""
    if x is None or abs(x - round(x)) > 1e-9:
        return None
    return int(round(x))


def founders(row: Mapping[str, Any] | None, n_loncas: int) -> tuple[int | None, int | None]:
    """(deneyen farklı kurucu, reddedilen farklı kurucu): U4. Ret lonca sayısına bölünmüyorsa (ya da girdi okunamıyorsa) (None, None)."""
    if row is None or not isinstance(n_loncas, int) or n_loncas <= 0:
        return None, None
    tries, rej = _whole(_num(row.get("kredi_basvuru"))), _whole(_num(row.get("kredi_ret")))
    if tries is None or rej is None or rej < 0 or rej > tries or rej % n_loncas:
        return None, None
    d_rej = rej // n_loncas
    return tries - rej + d_rej, d_rej


def _lo_money(W) -> dict[str, dict[str, float]]:
    """Lonca başına kredi stoku (firma + konut) ve tahvil stoku; `credit_core.lo_credit` / `lo_equity` ile aynı tanım, tek geçiş."""
    out: dict[str, dict[str, float]] = {}
    for ln in (getattr(W, "loans", None) or {}).values():
        out.setdefault(ln["lo"], {"credit": 0.0, "bond": 0.0})["credit"] += ln["out"]
    for m in getattr(W, "mortgages", None) or ():
        out.setdefault(m["lo"], {"credit": 0.0, "bond": 0.0})["credit"] += m["out"]
    for b in getattr(W, "bonds", None) or ():
        out.setdefault(b["lo"], {"credit": 0.0, "bond": 0.0})["bond"] += b["out"]
    return out


def cum_deaths(W) -> dict[str, int | None]:
    """Birikimli firma ölümleri (PLAN-KREDI T3, B5): oyuncu işletmesi (`batan_oyuncu_firmasi_adet`), Ar-Ge DAO (`batan_dao_adet`) ve yerleşik işletme temerrüt
    ölümü (`W.npc_log` "temerrut"). `failed_cum` (yerleşik işletme iflası, `npc_batis_adet`) bunların dışındadır. Okunamayan sayaç None. Salt okur; `defaultdict`'e
    anahtar eklemez."""
    fl = getattr(getattr(W, "L", None), "flows", None)
    log = getattr(W, "npc_log", None)
    player = dao = None
    if fl is not None:
        player, dao = _int(_num(fl.get("batan_oyuncu_firmasi_adet", 0.0))), _int(_num(fl.get("batan_dao_adet", 0.0)))
    default = None if log is None else sum(1 for e in log if len(e) > 3 and e[3] == "temerrut")
    return {"player": player, "dao": dao, "npc_default": default}


def lonca_classes(W, P) -> dict[str, list[str]]:
    """U5 sınıfları: {"lendable": [...], "insolvent": [...], "middle": [...]} (lonca sırası `W.loncas`). Salt okur."""
    bal, dep = W.L.bal, W.dep_tot
    closed = getattr(W, "closed", None) or ()
    lev_on = bool(getattr(W, "LEV_ON", False))
    lev_k = getattr(P, "LEV_K", 0.0)
    money = _lo_money(W)
    out: dict[str, list[str]] = {"lendable": [], "insolvent": [], "middle": []}
    for lo in W.loncas:
        m = money.get(lo, {})
        credit = m.get("credit", 0.0)
        eq = bal.get(f"{lo}_sermaye", 0.0) + credit + m.get("bond", 0.0) - dep.get(lo, 0.0)
        if eq < 0:
            out["insolvent"].append(lo)
        elif lo not in closed and eq > 0 and (not lev_on or lev_k * eq - credit > 0):
            out["lendable"].append(lo)
        else:
            out["middle"].append(lo)
    return out


def totals(W, P) -> dict[str, Any]:
    """Birikimli sayaçlar (düz sözlük, anahtar = blok yolu). `wk` hafta numarası (ardışıklık denetimi). Salt okur."""
    fl = W.L.flows
    t: dict[str, Any] = {"wk": getattr(W, "week_no", None)}
    want = {v: k for k, v in CAND.items()}
    cand = {k: 0.0 for k in CAND}
    for key, v in (getattr(W, "gate", None) or {}).items():            # {(25 haftalık kova, ad): n}: bütün kovaların toplamı
        k = want.get(key[1]) if isinstance(key, tuple) and len(key) == 2 else None
        if k is not None:
            cand[k] += v
    for k, v in cand.items():
        t["gate.cand." + k] = v
    want = {v: k for k, v in PROD.items()}
    prod = {k: 0.0 for k in PROD}
    board = 0.0
    for _key, d in (getattr(W, "chain", None) or {}).items():           # {(kova, ürün): {ad: n}}
        for name, v in d.items():
            if name in want:
                prod[want[name]] += v
            elif name.startswith("sb_"):
                board += v
    for k, v in prod.items():
        t["gate.prod." + k] = v
    t["gate.prod.board"] = board
    ref = getattr(W, "cx_ref", None) or {}
    for k, src in FIRM.items():
        t["firm." + k] = ref.get(src, 0.0)
    for k, srcs in CHAN.items():
        t["chan." + k] = sum(fl.get(s, 0.0) for s in srcs)
    t["chan.young_rej"] = (getattr(W, "young_stat", None) or {}).get("red", 0.0)
    for k, srcs in LOSS.items():
        t["loss." + k] = sum(fl.get(s, 0.0) for s in srcs)
    for k, srcs in DEATHS.items():
        t["deaths." + k] = sum(fl.get(s, 0.0) for s in srcs)
    cause = {k: 0.0 for k in CAUSE}
    for key, v in fl.items():
        if isinstance(key, str) and key.startswith("olum_"):
            for k, c in CAUSE.items():
                if key.endswith("_" + c):
                    cause[k] += v
    for k, v in cause.items():
        t["deaths.cause." + k] = v
    t["deaths.npc_default"] = float(sum(1 for e in (getattr(W, "npc_log", None) or ()) if len(e) > 3 and e[3] == "temerrut"))
    for k, srcs in LONCA_FLOW.items():
        t["lonca." + k] = sum(fl.get(s, 0.0) for s in srcs)
    st = getattr(W, "lo_stat", None)
    for k, src in LONCA_STAT.items():
        t["lonca." + k] = None if st is None else st.get(src, 0.0)
    return t


def _set(out: dict, path: str, val: Any) -> None:
    parts = path.split(".")
    for p in parts[:-1]:
        out = out.setdefault(p, {})
    out[parts[-1]] = val


def _found(row: Mapping[str, Any] | None, n_loncas: int) -> dict[str, Any] | None:
    if row is None:
        return None
    tries, rej = _int(_num(row.get("kredi_basvuru"))), _int(_num(row.get("kredi_ret")))
    app, d_rej = founders(row, n_loncas)
    why = kinds = None
    if d_rej is not None:
        why = {"pool": _int((_num(row.get("ret_havuz")) or 0) / n_loncas), "rep": _int((_num(row.get("ret_itibar")) or 0) / n_loncas)}
        kinds = {}
        raw = row.get("ret_nedeni")
        if isinstance(raw, str):
            for part in raw.split(";"):
                name, _, n = part.rpartition(":")
                v = _num(n)
                if name and v and v > 0:
                    kinds[name] = _int(v / n_loncas)
        elif isinstance(raw, Mapping):
            kinds = {k: _int(v / n_loncas) for k, v in raw.items() if _num(v)}
    cover = _num(row.get("tavan_orani_ort"))
    return {"tries": tries, "rej": rej, "granted": None if tries is None or rej is None else tries - rej, "founders": app,
            "founders_rej": d_rej, "why": why, "kinds": kinds, "cover": None if not tries or cover is None else round(cover, 3)}


def build(W, P, row: Mapping[str, Any] | None, prev: Mapping[str, Any] | None, cur: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Paketin `credit` bloğu. `row`: modelin bu haftaki satırı (yoksa `found` null), `prev`: bir önceki haftanın `totals` çıktısı (yoksa haftalık alanlar null),
    `cur`: bu haftanın `totals` çıktısı (verilmezse hesaplanır; host aynı değeri bir sonraki hafta için tutar). Salt okur."""
    cur = totals(W, P) if cur is None else cur
    wk, pwk = cur.get("wk"), (prev or {}).get("wk")
    weekly = prev is not None and (wk is None or pwk is None or wk == pwk + 1)
    out: dict[str, Any] = {"found": _found(row, len(W.loncas))}
    for path, v in cur.items():
        if path == "wk":
            continue
        p = (prev or {}).get(path)
        d = None
        if weekly and v is not None and p is not None and v - p >= -1e-9:
            d = max(0.0, v - p)
        _set(out, path, _int(d))
    classes = lonca_classes(W, P)
    dep = W.dep_tot
    tot = sum(dep.get(lo, 0.0) for lo in W.loncas)
    top = max((dep.get(lo, 0.0) for lo in W.loncas), default=0.0)
    out["lonca"].update({"lendable": len(classes["lendable"]), "insolvent": len(classes["insolvent"]),
                         "dep_lendable": _int(sum(dep.get(lo, 0.0) for lo in classes["lendable"])),
                         "dep_insolvent": _int(sum(dep.get(lo, 0.0) for lo in classes["insolvent"])),
                         "dep_top_share": round(top / tot, 4) if tot > 1e-9 else None})
    return out
