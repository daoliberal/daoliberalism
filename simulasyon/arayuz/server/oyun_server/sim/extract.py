"""`W.wk_csv[-1]` satırından `WeekPacket` çıkarır (saf; model içe aktarılmaz).

Eşleme `export/kayit_aktar.py` `FIELDS` ile birebirdir (parite testi kilitler, P-20).
Değerler yuvarlanmaz: canlı paket gerçek değeri taşır.
"""
from __future__ import annotations

import math
import sys
from typing import Any, Mapping

from . import probes

# World alanı -> satır sütunu (None = türetilmiş). `kayit_aktar.FIELDS` ile aynı sıra ve içerik.
FIELDS = [
    ("served", "talep_karsilama"),
    ("employed", "calisan"),
    ("unemployed", "issiz"),
    ("unemployment_rate", None),
    ("npc_firms", "npc_firma"),
    ("player_firms", "oyuncu_firma"),
    ("failed_cum", "batan_kum"),
    ("city_cash_total", "sehir_kasasi"),
    ("gini", "gini_servet"),
    ("money_total", "para_toplam"),
    ("velocity", "hiz_satis"),
    ("loans_applied", "kredi_basvuru"),
    ("loans_rejected", "kredi_ret"),
    ("loans_granted", None),
    ("support_weekly", "fon_verilen"),
    ("privatized_firms", "ozellesen_firma"),
    ("no_founder", "kurucu_yok"),
    ("reject_pool", "ret_havuz"),
    ("reject_reputation", "ret_itibar"),
    ("no_buyer_cum", "alici_yok_kum"),
]

# Tanılar için ek olgular (S4 düzeltme 1). `kayit_aktar.FIELDS` dışında (kayıt parite testi bozulmaz). Kaynak sütunlar:
# `fon_red` modelin satırıdır; `x_*` sütunlarını `ModelHost.step` modelden ekler (satırda yoksa alan null).
#   support_denied      haftada istenip verilemeyen geçiş desteği (Akçe); açılış döneminde 0
#   policy_rate         politika faizi, haftalık birim (`pol[0]`; taban POL_MIN, tarafsız POL_NEUT); kural kapalıysa null
#   policy_unemployment kuralın o hafta gördüğü işsizlik (`pol_hist[-1][2]`, iş arayanlar / oyuncular); kural kapalıysa null
#   city_spend_cut      haftada basım izni ve tahvil yetmediği için kısılan şehir harcaması (Akçe, `L.cut` farkı)
# S5: `types.ts` World'ünün eskiden hep null olan alanları da modelden okunur (`probes.world_facts`; tanımlar `probes.FIELD_NOTES`).
EXTRA_FIELDS = [
    ("support_denied", "fon_red"),
    ("policy_rate", "x_policy_rate"),
    ("policy_unemployment", "x_policy_unemployment"),
    ("city_spend_cut", "x_city_spend_cut"),
] + [(name, "x_" + name) for name in (
    "price_index", "inflation_yoy", "minted_year", "mint_cap", "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg",
    "rent_pct", "occupancy", "house_index", "survival_52", "wage_index", "loan_rate_avg", "city_cash_weeks",
    "tenants_per_house", "house_resale_ratio", "policy_inflation", "minted_total")] + [
    # D5: işsizlik ve NPC havuzu (tanımlar `probes.FIELD_NOTES`; `unemployment_rate_all` türetilmiştir: aşağıda)
    (name, "x_" + name) for name in (
        "npc_pool", "npc_employed", "npc_broke", "npc_pool_cash_avg", "players_seeking", "players_in_ahir", "players_students",
        "benefit_paid", "benefit_paid_npc", "muni_wages", "bursary_paid", "benefit_cut")] + [
    # D9: NPC hanesi (tanımlar `probes.FIELD_NOTES`)
    (name, "x_" + name) for name in ("npc_dependents", "npc_lfp")] + [
    # D6: işe alım kuralları ve yeni oyuncu katılımı (tanımlar `probes.FIELD_NOTES`)
    (name, "x_" + name) for name in (
        "players_total", "players_new", "players_new_total", "ahir_capacity", "ahir_fill", "npc_firm_npc", "npc_firm_players",
        "hired_player", "hired_npc", "fired_player", "fired_npc", "ahir_moves", "ahir_backfilled", "inflow_blocked")] + [
    # D7: dünya kurulumu göstergeleri (tanımlar `probes.FIELD_NOTES`)
    (name, "x_" + name) for name in ("staff_fill", "kinds_full", "house_stock", "opening_staff")] + [
    # D10: iş piyasası akışları (tanımlar `probes.FIELD_NOTES`; `unemployment_duration` türetilmiştir: aşağıda)
    (name, "x_" + name) for name in ("npc_discouraged", "muni_npc", "hires", "separations", "quits_npc", "job_finding_rate")] + [
    # D11: para dağılımı, şehir gelir-gider kalemleri, hayalet işletme (tanımlar `probes.FIELD_NOTES`)
    (name, "x_" + name) for name in (
        "money_households", "money_npc_firms", "money_player_firms", "money_city", "money_lonca", "money_other",
        "city_in_tax", "city_in_profit", "city_in_rent", "city_in_mint", "city_in_other",
        "city_out_households", "city_out_wages", "city_out_services", "city_out_firms", "city_out_other",
        "ghost_firms", "ghost_closed")] + [
    # T3 (PLAN-TAKIP §4.5): servet ve gelir dilimleri (`probes.series_facts`; tanımlar `probes.FIELD_NOTES`). `liquid_*` satırdan türetilir: aşağıda
    (name, "x_" + name) for name in ("wealth_top10", "wealth_top1", "wealth_median", "income_gini", "income_top10")] + [
    # PLAN-KREDI T2 (U4): farklı kurucu sayıları (`probes.credit_facts`; tanımlar `probes.FIELD_NOTES`). `loans_*` eski anlamıyla (deneme sayısı) kalır
    (name, "x_" + name) for name in ("founders_applied", "founders_rejected")] + [
    # PLAN-KREDI T3 (B5): birikimli firma ölümleri (`probes.credit_facts`; tanımlar `probes.FIELD_NOTES`). `failed_cum` anlamı değişmez (yerleşik işletme iflası)
    (name, "x_" + name) for name in ("failed_player_cum", "failed_dao_cum", "failed_npc_default_cum")] + [
    # PLAN-KREDI T4b (S9): iş piyasası kaydından beş dünya alanı (`labour.world_facts`; tanımlar `probes.FIELD_NOTES`)
    (name, "x_" + name) for name in ("vacancies", "staffless_npc", "wage_fail", "unemp_long_share", "hires_stable4")]
LIQUID = (("liquid_b50", "yoksul"), ("liquid_m40", "orta"), ("liquid_t10", "zengin"))     # likit varlık (nakit + mevduat) dilimleri: `para_<s>` + `mev_<s>` sütunları
# `types.ts` World'ünde HENÜZ olmayan alanlar (web görevi ekleyene dek; testle kilitli, eklenince buradan çıkar).
NEW_WORLD_FIELDS = ()

# `World` türünün eşlenmeyen (her zaman null) alanları: kaynağı modelde bulunmayanlar, nedenleriyle `probes.MISSING`'te.
NULL_FIELDS = list(probes.MISSING)


def _num(cell: Any) -> int | float | None:
    """Ham hücre -> sayı ya da None (yok/boş/NaN/inf/bozuk)."""
    if cell is None or isinstance(cell, bool):
        return None
    if isinstance(cell, str):
        t = cell.strip()
        if t == "":
            return None
        try:
            v: int | float = float(t)
        except ValueError:
            return None
        if not any(c in t for c in ".eE"):
            try:
                v = int(t)
            except ValueError:
                return None
    elif isinstance(cell, (int, float)):
        v = cell
    else:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def extract_world(row: Mapping[str, Any]) -> dict[str, float | int | None]:
    raw = {src: _num(row.get(src)) for _, src in FIELDS if src}
    emp, unemp = _num(row.get("calisan")), _num(row.get("issiz"))
    app, rej = _num(row.get("kredi_basvuru")), _num(row.get("kredi_ret"))
    ur = None
    if emp is not None and unemp is not None and (emp + unemp) > 0:
        ur = 0 if unemp == 0 else unemp / (emp + unemp)
    granted = app - rej if app is not None and rej is not None else None
    derived = {"unemployment_rate": ur, "loans_granted": granted}
    world: dict[str, float | int | None] = {}
    for name, src in FIELDS:
        world[name] = derived[name] if src is None else raw[src]
    for name, src in EXTRA_FIELDS:
        world[name] = _num(row.get(src))
    pool = world["npc_pool"]                      # D5: toplam işsizlik = (iş arayan oyuncu + havuz NPC) / (çalışan + iş arayan oyuncu + havuz NPC)
    world["unemployment_rate_all"] = None
    if emp is not None and unemp is not None and pool is not None and (emp + unemp + pool) > 0:
        world["unemployment_rate_all"] = 0 if (unemp + pool) == 0 else (unemp + pool) / (emp + unemp + pool)
    npc_f, ply_f = world["npc_firms"], world["player_firms"]      # D8: işletme sayısı = yerleşik + oyuncu işletmesi (ahır ve belediye hariç, canlılar)
    cum4 = [world["failed_cum"], world["failed_player_cum"], world["failed_dao_cum"], world["failed_npc_default_cum"]]      # F1: toplam batan = dört sayacın toplamı; biri yoksa (eski kayıt) null
    world["failed_total_cum"] = sum(cum4) if all(v is not None for v in cum4) else None
    world["firms_total"] = npc_f + ply_f if npc_f is not None and ply_f is not None else None
    jfr = world["job_finding_rate"]                # D10: ortalama işsizlik süresi (hafta) = 1 / iş bulma oranı (kararlı durum tahmini)
    world["unemployment_duration"] = 1.0 / jfr if (jfr is not None and jfr > 0) else None
    parts = [(_num(row.get("para_" + c)), _num(row.get("mev_" + c))) for _, c in LIQUID]       # T3: likit varlık payı = (nakit + mevduat) / toplam; sütun yoksa ya da toplam 0 ise null
    liq = [a + b for a, b in parts if a is not None and b is not None]
    tot = sum(liq) if len(liq) == len(LIQUID) else 0
    for i, (name, _) in enumerate(LIQUID):
        world[name] = liq[i] / tot if tot > 0 else None
    for name in NULL_FIELDS:                       # kaynağı olmayan alan: satırda x_ olgusu görünse bile null (MISSING kazanır)
        world[name] = None
    return world


HARITA_ALANLAR = ["id", "tur", "sehir", "calisan", "lonca", "sahip", "dogum", "durum"]
HARITA_SAHIPLER = ["npc", "oyuncu", "dao"]
HARITA_DURUMLAR = ["uretim", "zayif", "issiz", "kapali"]
HARITA_KAPALI_HAFTA = 10          # ölü firma, ölümünden sonra bu kadar hafta `kapali` olarak listede kalır
HARITA_ZAYIF_ESIK = 0.5           # pano sağlık sınıfı: `firm_rows["health"]` = `W.board["fh"][ref]["h"]`; modelde sağlıklı = `h >= SB_H_OK` (simkit/params.py, 0.5). Sağlıksız taraf `h < 0.5`.


def _harita_durum(r: dict, week: int) -> str | None:
    """Satırın durumu; listede olmayacaksa (eski ölü) None. Öncelik: kapali > issiz > zayif > uretim. Pano kapalıysa (`health` None) zayif aranmaz."""
    if r.get("dead"):
        died = r.get("died")
        if isinstance(died, (int, float)) and not isinstance(died, bool) and died < week - HARITA_KAPALI_HAFTA:
            return None
        return "kapali"                                           # died None: aynı anlık görüntüde ölü görüldü
    if r.get("staffless"):
        return "issiz"
    h = r.get("health")
    if isinstance(h, (int, float)) and not isinstance(h, bool) and h < HARITA_ZAYIF_ESIK:
        return "zayif"
    return "uretim"


def _harita_no(rid: str, kind: str, city: int) -> int | None:
    """Kimlik `s<şehir>_<tür><sayı>` kalıbındaysa (modelin adlandırması) yalnız sayı; değilse None (kimlik olduğu gibi gider). Kayıpsız: sayı kurallı yazılmış olmalı."""
    pre = "s%d_%s" % (city, kind)
    if rid.startswith(pre):
        rest = rid[len(pre):]
        if rest.isascii() and rest.isdigit() and (rest == "0" or not rest.startswith("0")) and int(rest) <= 2 ** 53 - 1:      # web tarafında güvenli tam sayı sınırı
            return int(rest)
    return None


def _harita_satirlari(week: int, rows: Any) -> list[tuple] | None:
    """Listeye girecek işletmelerin ÇÖZÜLMÜŞ satırları `(kimlik, tur, sehir, calisan, lonca|None, sahip, dogum|None, durum)` (sıkıştırma yok); anlık görüntü yoksa None."""
    if not isinstance(rows, list):
        return None
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        durum = _harita_durum(r, week)
        if durum is None:
            continue
        rid, kind, city = r.get("id"), r.get("kind"), r.get("city")
        if rid is None or kind is None or city is None:          # eksik satır paketi düşürmez: atlanır
            continue
        rid = rid if isinstance(rid, str) else str(rid)           # kimlik hep dizge gider (sayı yalnız kalıptan türeyen sıkıştırmadır)
        lonca = r.get("lonca")
        sahip = "dao" if r.get("orgOwned") else ("oyuncu" if r.get("owner") == "player" else "npc")
        born = r.get("born")
        out.append((rid, kind, city, r.get("workers") or 0, lonca if isinstance(lonca, str) else None, sahip, born if isinstance(born, int) and not isinstance(born, bool) else None, durum))
    return out


def harita_of(week: int, rows: Any) -> dict | None:
    """Şehir haritası (T10), SIKIŞTIRILMIŞ tel biçimi: `{hafta, alanlar, turler, loncalar, sahipler, firmalar}`.
    `firmalar` satırı `[id, tur, sehir, calisan, lonca, sahip, dogum, durum]` (`dogum` = `born` | null, `durum` HARITA_DURUMLAR indeksi değil dizge): `id` kalıba uyuyorsa (`s<şehir>_<tür><n>`) yalnız sayı `n`, değilse dizge;
    `tur`/`lonca`/`sahip` ilgili tablonun indeksi (`lonca` yoksa -1). Kayıpsız; web ayrıştırıcısı eski (dizgeli) biçimi de okur.
    Canlı firmalar + son HARITA_KAPALI_HAFTA haftada ölenler (`kapali`); `sahip`: npc (yerleşik, ahır, belediye) | oyuncu (kişi, insan karakteri dahil) | dao (`org_owner` dolu: DAO/lonca). Anlık görüntü yoksa None."""
    satirlar = _harita_satirlari(week, rows)
    if satirlar is None:
        return None
    turler: dict[str, int] = {}
    loncalar: dict[str, int] = {}
    out = []
    for rid, kind, city, workers, lonca, sahip, dogum, durum in satirlar:
        no = _harita_no(rid, kind, city) if isinstance(kind, str) and isinstance(city, int) else None
        li = -1 if lonca is None else loncalar.setdefault(lonca, len(loncalar))
        out.append([rid if no is None else no, turler.setdefault(kind, len(turler)), city, workers, li, HARITA_SAHIPLER.index(sahip), dogum, durum])
    return {"hafta": week, "alanlar": HARITA_ALANLAR, "turler": list(turler), "loncalar": list(loncalar), "sahipler": HARITA_SAHIPLER, "firmalar": out}


HARITA_BOY_ESIKLERI = (8, 20, 50)   # web `BOY_ESIKLERI` (haritaStili.ts) ile aynı: bina boyu kovası; çalışan sayısı kova değiştirmedikçe delta onu taşımaz


def _boy(calisan: Any) -> int:
    n = calisan if isinstance(calisan, (int, float)) and not isinstance(calisan, bool) else 0
    return sum(1 for e in HARITA_BOY_ESIKLERI if n >= e)


def harita_taban_of(week: int, rows: Any) -> dict | None:
    """Fark tabanı: tam `harita` haftasının çözülmüş satırları `{hafta, satir: {kimlik: satır}}` (yalnız bellekte tutulur; satır sırası korunur). Anlık görüntü yoksa None."""
    satirlar = _harita_satirlari(week, rows)
    if satirlar is None:
        return None
    satir = {s[0]: s for s in satirlar}
    if len(satir) != len(satirlar):                              # kimlik tekil olmalı (istemci de kimliğe göre birleştirir); çiftlenen sessizce birleşmesin
        print("oyun_server: uyarı: harita tabanında çift işletme kimliği (%d satır, %d kimlik); fark yanlış olabilir" % (len(satirlar), len(satir)), file=sys.stderr)
    return {"hafta": week, "satir": satir}


def harita_fark_of(week: int, taban: dict, rows: Any) -> dict | None:
    """Kurucu'da tam harita taşımayan haftanın hafif farkı (tabana göre): `{hafta, taban, degisen, yeni, kapanan}`.
    `degisen`: `[kimlik, durum (HARITA_DURUMLAR indeksi), calisan]`, yalnız `durum` ya da bina boyu kovası (`_boy`) değişenler (işletmenin kapanması `durum = kapali` ile ifade edilir);
    `yeni`: tabanda olmayıp şimdi listede olanlar, tam satır (dizgeli biçim, tablo yok: `[id, tur, sehir, calisan, lonca|null, sahip, dogum, durum]`);
    `kapanan`: tabanda listede olup şimdi listeden düşenler (10 hafta kapalı kalıp düşenler). Kimlikler hep dizge. Anlık görüntü yoksa None."""
    satirlar = _harita_satirlari(week, rows)
    if satirlar is None:
        return None
    eski = taban["satir"]
    simdi: set[str] = set()
    degisen, yeni = [], []
    for s in satirlar:
        simdi.add(s[0])
        o = eski.get(s[0])
        if o is None:
            yeni.append(list(s))
        elif o[7] != s[7] or _boy(o[3]) != _boy(s[3]):
            degisen.append([s[0], HARITA_DURUMLAR.index(s[7]), s[3]])
    return {"hafta": week, "taban": taban["hafta"], "degisen": degisen, "yeni": yeni, "kapanan": [k for k in eski if k not in simdi]}


def make_packet(run_id: str, week: int, version: int, row: Mapping[str, Any], cities: list | None = None, chain: dict | None = None,
                holdings: dict | None = None, credit: dict | None = None, housing: dict | None = None, labour: dict | None = None, harita: dict | None = None, dao: dict | None = None, harita_fark: dict | None = None, kurumlar: list | None = None, ekonomi: dict | None = None, makro: dict | None = None) -> dict:
    """`cities`/`chain` (S5), `holdings` (PLAN-TAKIP) ve `credit` (PLAN-KREDI T2) ve `housing` (T4) ve `labour` (T4b) ve `harita` (T10) ve `dao` (DAO gözlemi, T6a) ve `kurumlar` (şehir kurumları: Liman/İhracat, Görev 12b) ve `ekonomi` (M10 Ekonomi paneli) ve `makro` (M10 Makro göstergeler) yalnız verilirse pakete girer (kayıtlı/eski biçim değişmez)."""
    pkt = {"v": 1, "run_id": run_id, "week": week, "version": version, "world": extract_world(row), "events": []}
    if cities is not None:
        pkt["cities"] = cities
    if chain is not None:
        pkt["chain"] = chain
    if holdings is not None:
        pkt["holdings"] = holdings
    if credit is not None:
        pkt["credit"] = credit
    if housing is not None:
        pkt["housing"] = housing
    if labour is not None:
        pkt["labour"] = labour
    if harita is not None:
        pkt["harita"] = harita
    if dao is not None:
        pkt["dao"] = dao
    if kurumlar is not None:
        pkt["kurumlar"] = kurumlar                           # şehir başına ithal/ihraç hacmi ve en çok ithal edilen ürünler (salt okunur)
    if ekonomi is not None:
        pkt["ekonomi"] = ekonomi                             # M10: haftalık tüketim / işletmeler ve iş gücü / para bloğu (salt okunur)
    if makro is not None:
        pkt["makro"] = makro                                 # M10: haftalık makro göstergeler (fiyat, üretim, para, faiz, dağılım, kredi; salt okunur, <= 900 bayt)
    if harita_fark is not None:
        pkt["haritaFark"] = harita_fark                      # Kurucu: tam `harita` taşımayan haftalarda hafif fark (yalnız bellekte/SSE; diske yazılmaz)
    return pkt
