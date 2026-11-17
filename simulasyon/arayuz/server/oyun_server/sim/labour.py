"""İş piyasası kaydı (PLAN-KREDI T4b, S9, U18): paketin `labour` bloğu. Arayüzde GÖSTERİLMEZ; yalnız kayıtta tutulur. Kişi ve firma kimliği çıkmaz.

Salt okur: `W` ve `P` değiştirilmez, model içe aktarılmaz (`defaultdict`'lere yalnız `.items()` / `.get()` ile erişilir). Üç kaynak:
  (D) host'un hafta sonu DURUM FARKI: önceki hafta ile bu hafta arasında kişi -> firma eşlemesi, canlı firma kümesi, iş arayan kümesi karşılaştırılır
      (`LabourState`; yalnız host'ta durur, `W`'ye yazılmaz). Net giriş/çıkış, firma ölümüyle kaybedilen iş, iş aramaya giriş kökeni, ölçülen işsizlik süresi.
  (M) modelin DAVRANIŞSIZ sayaçları (T5, §4.6; `KR_MEAS=1`): `W.lab_stat` (BİRİKİMLİ `defaultdict`, anahtar `<olay>_<firma türü>`; hiç sıfırlanmaz), `W.lab_type` (firma -> tür, kuruluşta
      bir kez damgalanır) ve `W.staff_tgt` (firma -> o haftanın hedef kadrosu). Yoksa (`KR_MEAS` kapalı) bu alanlar `null` yazılır. Birikimli bir anahtar haftadan haftaya AZALIRSA
      (olmaması gerekir: sayaç sıfırlanmış ya da dünya yeniden kurulmuş) ondan türeyen alan `max(0, ...)` ile bastırılmaz, `null` yazılır.
  Modelin kendi haftalık satırı: `wage_fail` (`W.weekly[-1]`).

Ardışıklık: durum yalnız bir önceki hafta için geçerlidir (`state.week == bu hafta - 1`). İlk hafta, çatallanan / yeniden kurulan koşunun ilk haftası ve aradaki hafta atlanınca
durum bu haftanın dünyasından yeniden kurulur ve FARKA DAYALI alanlar `null` yazılır (stok alanlar ve `spells.ongoing` yine yazılır). `build` saftır: yeni durumu DÖNDÜRÜR.
"""
from __future__ import annotations

from collections import deque
from typing import Any, Iterable, Mapping

from .credit import _int, _num

TYPES = ("npc", "player", "dao", "public")                    # firma türü (sticky: ilk görüldüğü haftanın sınıfı; bkz. NOTES["types"])
PUBLIC_KINDS = ("ahir", "belediye")
BUCKETS = ("lt4", "w4_12", "w13_26", "gt26")                  # işsizlik süresi kovaları (hafta): <4, 4-12, 13-26, >26
TOP_SECTORS, TOP_VAC_SECTORS = 3, 2                            # bütçe (§3.6, ortalama <= 1.100 bayt) için kısa liste; gerisi `rest`
INFLOW = ("entrant", "ahir", "firm_death", "from_firm", "from_out", "other")
PF_DEATH = ("founder_wage", "founder_job", "founder_move", "no_buyer", "cash", "other")
REASONS = {"layoff": ("kuculme", "dao"), "quit": ("ayrilma",), "firm_death": ("olum",), "switch": ("gecis",), "muni": ("belediye",),
           "other": ("diger", "goc", "egitim")}               # `exits.reason` anahtarı -> `W.lab_stat` `cikis_<ad>_<tür>` adları (wage ayrı: türe göre). Bütçe için birleşik kova: göç ve eğitim modelde işten çıkış üretmez
STABLE_LAG = 4

NOTES: dict[str, str] = {
    "types": "Firma türü: `npc` (sahipsiz, ahır ve belediye dışı), `player` (sahibi oyuncu ya da `org_owner` olan, DAO hariç), `dao` (`kind == \"arge\"`), `public` (ahır, belediye). "
             "Sınıflama `holdings` ile aynıdır (DAO ayrı). Model sayaçları açıkken (`KR_MEAS`) tür modelin `W.lab_type` damgasıdır: firma KURULDUĞUNDA bir kez yazılır ve ömrü boyunca sabit kalır; "
             "model damgası yoksa tür firmaya İLK GÖRÜLDÜĞÜ haftada bağlanır. Her iki durumda da tür sonraki sınıf değişimlerini (el değiştirme, özelleşme, medya satışı) İZLEMEZ: "
             "böylece her tür için `çalışan_t - çalışan_{t-1} = hires.net - exits.net` ve (M) Σ işe alım olayı - Σ çıkış olayı tam kapanır. Çıkış, önceki haftanın türüyle; giriş, yeni firmanın türüyle sayılır.",
    "week": "Haftalık değerler iki ardışık hafta sonu durumunun farkıdır (D). Önceki hafta yoksa (ilk hafta, çatallanan / yeniden kurulan koşunun ilk haftası, atlanan hafta) "
            "farka dayalı alanlar null; stok alanlar ve `spells.ongoing` yine yazılır. (M) = modelin davranışsız sayacı (`W.lab_stat` birikimli, `W.staff_tgt`; `KR_MEAS=1`); yoksa null. Birikimli bir anahtar azalırsa ondan türeyen alan null.",
    "emp.by_type": "Çalışan sayısı (stok), firma türüne göre: `people[q][\"firm\"]` canlı bir firma olan herkes (ahır ve belediye dahil).",
    "emp.private": "Özel istihdam (stok): toplam çalışan - ahır - belediye (`npc + player + dao`).",
    "emp.sectors": "En çok çalışanı olan 3 işletme türü `{tür: çalışan}` + `rest` (stok; ahır ve belediye dahil).",
    "vac.npc": "(M) Açık kadro, yerleşik işletme: Σ max(0, hedef - çalışan), canlı firmalar (`W.staff_tgt`). Hedef kaydı yoksa null.",
    "vac.player": "(M) Açık kadro, oyuncu işletmeleri (DAO dahil). Hedef oyuncu işletmesinde, işe alım koşulu sağlanıyorsa kapasite, sağlanmıyorsa mevcut kadrodur (T5).",
    "vac.sectors": "(M) Açık kadrosu en büyük 2 işletme türü + `rest`.",
    "vac.cities": "(M) Şehir başına açık kadro (liste, şehir sırasıyla).",
    "mismatch": "(M) Mekân uyumsuzluğu endeksi: ½ Σ_c |iş arayan_c / İ - açık_c / A| (Jackman-Layard-Savouri; iş arayan = `seekers` + `pool`). Açık kadro yoksa null.",
    "staffless_npc": "İşçisiz canlı yerleşik işletme (`n`; sahipsiz, `org_owner`sız, ahır ve belediye dışı; stok) ve bunlardan kasası < 1 Akçe olanlar (`cash0`).",
    "hires.net": "Net işe giriş, firma türüne göre (yeni firmanın türü): bir önceki hafta çalışmayan ya da firması değişen, bu hafta çalışan kişi sayısı. Aynı hafta alınıp çıkanlar sayılmaz.",
    "hires.events": "(M) Hafta içindeki bütün işe alım olayları, türe göre (`W.lab_stat` `ise_<tür>`).",
    "hires.short": "(D+M) Aynı hafta alınıp hafta sonunda o firmada olmayan: `events - net`, türe göre.",
    "hires.stable4": "4 hafta önce net giren ve bu hafta hâlâ aynı firmada olan kişi sayısı (4 hafta gecikmeli; öncesinde null).",
    "exits.net": "Net işten çıkış, önceki haftanın firma türüne göre: bir önceki hafta çalışan, bu hafta çalışmayan ya da firması değişen kişi sayısı.",
    "exits.firm_death": "Firması bu hafta ölü görünen net çıkış (firma ölümüyle kaybedilen iş), türe göre. Ölüm: firmanın önceki haftada canlı, bu hafta ölü olması; yeniden açılan işletme canlıya döner.",
    "exits.reason": "(M) Hafta içi çıkış olayları nedenine göre: `wage` ücret ödenemedi (türe göre), `layoff` küçültme (DAO çıkarmaları dahil), `quit` NPC kendiliğinden, `firm_death`, `switch` başka işe geçiş, "
                    "`muni` belediye, `other` (diğer; göç ve eğitim çıkışları dahil: modelde bu iki yol işten çıkış üretmez). Her çıkış tam bir nedene düşer.",
    "wage_fail": "Haftada ücreti ödenemediği için işten çıkan kişi sayısı (modelin haftalık satırı `W.weekly[-1][\"wage_fail\"]`; her zaman okunur).",
    "inflow": "İş aramaya (`seekers` ya da `pool`) bu hafta giren kişiler, kökenine göre: `entrant` bu hafta ilk kez görülen, `ahir` önceki firması ahır, `firm_death` önceki firması öldü, "
              "`from_firm` önceki firması canlı (küçültme, ücret ya da ayrılma), `from_out` önceki hafta işgücü dışı / öğrenci / bakmakla yükümlü, `other`. Toplam = iş aramaya giren kişi sayısı.",
    "inflow_reason": "(M) `from_firm`'ün hafta içi neden ayrımı: `wage` (toplam), `layoff`, `quit` (`exits.reason`'dan).",
    "spells.ongoing": "Sürmekte olan işsizlik süreleri (iş arayan + havuz), kovalar `lt4` (<4), `w4_12`, `w13_26`, `gt26` (>26 hafta). Süre = bu hafta - iş aramaya ilk girilen hafta.",
    "spells.done": "Bu hafta biten (işe giren) sürelerin aynı kovaları. İşgücü dışına çıkarak biten süreler sayılmaz.",
    "spells.long_share": "Uzun süreli işsiz payı: 26 haftadan uzun süren / (iş arayan + havuz). TANIM UYARISI (son düzeltme I2): havuzdaki NPC'ler dahildir; hafta 1'den beri hiç çalışmamış, gerçekte iş aramayan NPC kitlesi 27. haftadan sonra hepsi uzun işsiz sayılır, pay bu yüzden şişer. Yalnız iş arayan oyuncular için model sütunu `kr_uzun_issiz_oyuncu_pay` (KR_MEAS=1). `unemployment_duration` (1 / iş bulma oranı) bir TAHMİNdir; bu alan ölçülmüştür.",
    "spells.censored": "Başlangıcı koşunun başlangıcından ya da çatallanma haftasından önceye düşen sürmekte olan süre sayısı: bu süreler gerçekte daha uzundur (\"en az\").",
    "pf_death": "Bu hafta ölen oyuncu işletmeleri (DAO hariç; kuruluş haftasında ölenler dahil), nedenine göre. Sıra: `founder_move` (kurucu şehir değiştirdi), `founder_job` (kurucu başka işte), "
                "`founder_wage` (kurucu iş arıyor ve firmanın önceki hafta kasası ücretinden azdı; (M) `kurucu_ucret_cikis` varsa o sayı), kalanlar `cash` (kasa < ücret), `no_buyer` "
                "(`olum_*_talep` sayısı kadar), `cash` (`olum_*_marj` sayısı kadar), `other` (girdi, teknoloji ve ayrılamayanlar). Seyrek: yalnız sıfırdan büyük nedenler yazılır, boş sözlük = o hafta oyuncu işletmesi ölmedi (bütçe). Farka dayalı: ilk haftada null.",
}


class LabourState:
    """Host'ta tutulan bir önceki haftanın durumu (kişi başına tek geçişle kurulur; `W`'ye yazılmaz)."""
    __slots__ = ("week", "emp", "ftype", "fkind", "fcash", "seek", "nilf", "known", "start", "cens", "net", "lab", "flows")

    def __init__(self) -> None:
        self.week: int = -1
        self.emp: dict[str, str] = {}                  # kişi -> firma (çalışan herkes)
        self.ftype: dict[str, str] = {}                # canlı firma -> tür (sticky)
        self.fkind: dict[str, str] = {}                # canlı firma -> işletme türü
        self.fcash: dict[str, float] = {}              # oyuncu işletmesi -> kasa
        self.seek: set[str] = set()                    # iş arayan + havuz
        self.nilf: set[str] = set()                    # işgücü dışı + öğrenci + bakmakla yükümlü
        self.known: set[str] = set()                   # bu haftaya kadar görülen kişiler
        self.start: dict[str, int] = {}                # iş arayan -> işsizlik süresinin başladığı hafta
        self.cens: set[str] = set()                    # başlangıcı bilinmeyen (koşu / çatallanma öncesi) süreler
        self.net: deque = deque(maxlen=STABLE_LAG)     # son 4 haftanın net girişleri ({kişi: firma})
        self.lab: dict[str, float] | None = None       # `W.lab_stat` birikimli kopyası (yoksa None)
        self.flows: dict[str, float] = {}              # `olum_*` birikimli toplamları


def firm_type(W, f: str) -> str | None:
    """Firmanın türü (`holdings` sınıflamasıyla aynı; DAO ayrı). Bilinmeyen firma None. Salt okur."""
    d = W.firms.get(f)
    if d is None:
        return None
    return _class_of(d)


def _class_of(d: Mapping[str, Any]) -> str:
    kind = d.get("kind")
    if kind in PUBLIC_KINDS:
        return "public"
    if kind == "arge":
        return "dao"
    return "player" if (d.get("owner") is not None or d.get("org_owner")) else "npc"


def _bucket(n: int) -> str:
    return "lt4" if n < 4 else ("w4_12" if n <= 12 else ("w13_26" if n <= 26 else "gt26"))


def _top(counts: Mapping[str, int], n: int) -> dict[str, int]:
    """En büyük `n` türü + `rest` (toplam korunur; eşitlikte tür adına göre)."""
    order = sorted(((k, v) for k, v in counts.items() if v > 0), key=lambda kv: (-kv[1], kv[0]))
    out = dict(order[:n])
    out["rest"] = sum(v for _, v in order[n:])
    return out


def _lab_delta(cur: Mapping[str, float], prev: Mapping[str, float]) -> tuple[dict[str, float], set[str]]:
    """Birikimli sayaçların haftalık farkı ve AZALAN anahtarlar kümesi (azalma = sayaç sıfırlanmış / dünya değişmiş: o anahtardan türeyen alan null yazılır)."""
    d: dict[str, float] = {}
    bad: set[str] = set()
    for k in set(cur) | set(prev):
        x = cur.get(k, 0.0) - prev.get(k, 0.0)
        if x < -1e-9:
            bad.add(k)
        else:
            d[k] = x
    return d, bad


def _hit(bad: set[str], *prefixes: str) -> bool:
    return any(k.startswith(p) for k in bad for p in prefixes)


def _lab_copy(W) -> dict[str, float] | None:
    lab = getattr(W, "lab_stat", None)
    if lab is None:
        return None
    return {k: float(v) for k, v in lab.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}


def _flows_copy(W) -> dict[str, float]:
    out = {"talep": 0.0, "marj": 0.0}
    for k, v in W.L.flows.items():
        if isinstance(k, str) and k.startswith("olum_"):
            if k.endswith("_talep"):
                out["talep"] += float(v)
            elif k.endswith("_marj"):
                out["marj"] += float(v)
    return out


def _pf_death(W, dead: list[str], prev: LabourState, emp: Mapping[str, str], seek: set[str], fw: float | None, flows_d: Mapping[str, int]) -> dict[str, int]:
    people = W.people
    out = dict.fromkeys(PF_DEATH, 0)
    fw_left = None if fw is None else int(round(fw))
    rest: list[tuple[str, float | None, float | None]] = []        # (firma, önceki kasa, kurucu ücreti)
    for f in sorted(dead):
        d = W.firms[f]
        q = d.get("owner")
        p = people.get(q) if q is not None else None
        cash = prev.fcash.get(f)
        wage = _num(p.get("wage")) if p is not None else None
        if p is not None and p.get("city") != d.get("city"):
            out["founder_move"] += 1
        elif p is not None and emp.get(q) is not None:
            out["founder_job"] += 1
        elif p is not None and q in seek and ((fw_left is not None and fw_left > 0) or (fw_left is None and cash is not None and wage is not None and cash < wage)):
            out["founder_wage"] += 1
            if fw_left is not None:
                fw_left -= 1
        else:
            rest.append((f, cash, wage))
    left = []
    for f, cash, wage in rest:
        if cash is not None and wage is not None and cash < wage:
            out["cash"] += 1
        else:
            left.append(f)
    nb = min(len(left), flows_d["talep"])
    out["no_buyer"] += nb
    cs = min(len(left) - nb, flows_d["marj"])
    out["cash"] += cs
    out["other"] += len(left) - nb - cs
    return {k: v for k, v in out.items() if v}                    # seyrek: yalnız sıfırdan büyük nedenler yazılır (bütçe); boş sözlük = o hafta oyuncu işletmesi ölmedi


def build(W, P, state: LabourState | None, row: Mapping[str, Any] | None = None) -> tuple[dict[str, Any], LabourState]:
    """Paketin `labour` bloğu ve YENİ durum. `state`: bir önceki haftanın durumu (yoksa ya da ardışık değilse farka dayalı alanlar null). `row`: modelin bu haftaki satırı
    (şimdilik yalnız hafta numarası için yedek). Salt okur."""
    firms, people, cities = W.firms, W.people, W.cities
    wk = int(W.week_no)
    prev = state if (state is not None and state.week == wk - 1) else None
    new = LabourState()
    new.week = wk

    # --- firmalar: canlı küme, tür (sticky), işletme türü, oyuncu işletmesi kasası; bu hafta ölen oyuncu işletmeleri
    alive: set[str] = set()
    dead_pf: list[str] = []
    lt = getattr(W, "lab_type", None) or {}                     # (M) modelin kuruluşta damgaladığı tür (varsa); yoksa ilk görüldüğü haftanın sınıfı
    bal = W.L.bal
    staffless = cash0 = 0
    for f, d in firms.items():
        if d.get("dead"):
            if d.get("died") == wk and d.get("kind") != "arge" and (d.get("owner") is not None or d.get("org_owner")) and d.get("kind") not in PUBLIC_KINDS:
                dead_pf.append(f)
            continue
        alive.add(f)
        t = lt.get(f)
        if t not in TYPES:
            t = prev.ftype.get(f) if prev is not None else None
            t = t or _class_of(d)
        new.ftype[f] = t
        new.fkind[f] = d.get("kind")
        if t == "player":
            new.fcash[f] = float(bal.get(f, 0.0))
        if t == "npc" and d.get("owner") is None and not d.get("org_owner") and not d["workers"]:
            staffless += 1
            cash0 += float(bal.get(f, 0.0)) < 1.0

    # --- kişiler: çalışanlar (tek geçiş)
    emp = new.emp
    by_type = dict.fromkeys(TYPES, 0)
    by_kind: dict[str, int] = {}
    ftype, fkind = new.ftype, new.fkind
    for q, p in people.items():
        f = p.get("firm")
        if f is not None and f in alive:
            emp[q] = f
            by_type[ftype[f]] += 1
            k = fkind[f]
            by_kind[k] = by_kind.get(k, 0) + 1
    new.known = set(people)

    # --- iş arayanlar (seekers + pool), şehir başına sayılar
    seek: set[str] = set()
    seek_city: list[int] = []
    for c in cities:
        s = set(c.get("seekers", ())) | set(c.get("pool", ()))
        seek_city.append(len(s))
        seek |= s
    new.seek = seek
    nilf: set[str] = set()
    for c in cities:
        nilf.update(c.get("out", ()))
        nilf.update(c.get("deps", ()))
    nilf.update(getattr(W, "student", None) or ())
    new.nilf = nilf

    # --- işsizlik süreleri
    ongoing = dict.fromkeys(BUCKETS, 0)
    for q in seek:
        s = prev.start.get(q) if prev is not None else None
        if s is None:
            s = wk
            if prev is None or q in prev.seek:
                new.cens.add(q)                                    # başlangıcı bilinmiyor: en az bu kadar
        elif q in prev.cens:
            new.cens.add(q)
        new.start[q] = s
        ongoing[_bucket(wk - s)] += 1

    # --- açık kadro (M)
    tgt = getattr(W, "staff_tgt", None)
    vac_block = mismatch = None
    if tgt is not None:
        v_t = {"npc": 0, "player": 0}
        v_k: dict[str, int] = {}
        v_c = [0] * len(cities)
        for f, t_ in tgt.items():
            d = firms.get(f)
            if d is None or d.get("dead"):
                continue
            v = max(0, int(round(float(t_))) - len(d["workers"]))
            if v == 0:
                continue
            ty = ftype.get(f) or _class_of(d)
            if ty not in ("npc", "player", "dao"):
                continue
            v_t["npc" if ty == "npc" else "player"] += v
            v_k[d["kind"]] = v_k.get(d["kind"], 0) + v
            ci = d.get("city")
            if isinstance(ci, int) and 0 <= ci < len(v_c):
                v_c[ci] += v
        vac_total = v_t["npc"] + v_t["player"]
        vac_block = {"npc": v_t["npc"], "player": v_t["player"], "sectors": _top(v_k, TOP_VAC_SECTORS), "cities": v_c}
        n_seek = sum(seek_city)
        if vac_total > 0 and n_seek > 0:
            mismatch = round(0.5 * sum(abs(seek_city[i] / n_seek - v_c[i] / vac_total) for i in range(len(v_c))), 4)

    # --- model sayaçları (M)
    lab = _lab_copy(W)
    new.lab = lab
    new.flows = _flows_copy(W)
    lab_d, lab_bad = (None, set()) if (lab is None or prev is None or prev.lab is None) else _lab_delta(lab, prev.lab)
    wf = None
    wl = getattr(W, "weekly", None)
    if wl:
        last = wl[-1]
        if isinstance(last, Mapping) and last.get("week") == wk:
            wf = _int(_num(last.get("wage_fail")))

    # --- durum farkı (D)
    hires_net = exits_net = exits_death = inflow = done = hires_events = hires_short = reason = inflow_reason = pf = None
    stable4 = None
    if prev is not None:
        pe = prev.emp
        hires_net, exits_net, exits_death = (dict.fromkeys(TYPES, 0) for _ in range(3))
        newhire: dict[str, str] = {}
        for q, f in emp.items():
            if pe.get(q) != f:
                hires_net[ftype[f]] += 1
                newhire[q] = f
        for q, f in pe.items():
            if emp.get(q) != f:
                t = prev.ftype[f]
                exits_net[t] += 1
                if f not in alive:
                    exits_death[t] += 1
        new.net = deque(prev.net, maxlen=STABLE_LAG)
        if len(prev.net) == STABLE_LAG:
            stable4 = sum(1 for q, f in prev.net[0].items() if emp.get(q) == f)
        new.net.append(newhire)
        inflow = dict.fromkeys(INFLOW, 0)
        for q in seek - prev.seek:
            if q not in prev.known:
                inflow["entrant"] += 1
                continue
            f = pe.get(q)
            if f is not None:
                inflow["ahir" if prev.fkind.get(f) == "ahir" else ("firm_death" if f not in alive else "from_firm")] += 1
            else:
                inflow["from_out" if q in prev.nilf else "other"] += 1
        done = dict.fromkeys(BUCKETS, 0)
        for q in prev.seek:
            if q in emp:
                done[_bucket(wk - prev.start.get(q, wk))] += 1
        if lab_d is not None:
            if not _hit(lab_bad, "ise_"):
                hires_events = {t: int(round(lab_d.get("ise_" + t, 0.0))) for t in TYPES}
                hires_short = {t: hires_events[t] - hires_net[t] for t in TYPES}
            if not _hit(lab_bad, "cikis_"):
                reason = {"wage": {t: int(round(lab_d.get("cikis_ucret_" + t, 0.0))) for t in TYPES}}
                for name, ads in REASONS.items():
                    reason[name] = int(round(sum(lab_d.get(f"cikis_{ad}_{t}", 0.0) for ad in ads for t in TYPES)))
                inflow_reason = {"wage": sum(reason["wage"].values()), "layoff": reason["layoff"], "quit": reason["quit"]}
        fd = {k: max(0, int(round(new.flows[k] - prev.flows.get(k, 0.0)))) for k in ("talep", "marj")}
        fw = None if (lab_d is None or "kurucu_ucret_cikis" in lab_bad) else lab_d.get("kurucu_ucret_cikis", 0.0)
        pf = _pf_death(W, dead_pf, prev, emp, seek, fw, fd)

    n_seek = len(seek)
    block: dict[str, Any] = {
        "emp": {"by_type": by_type, "private": by_type["npc"] + by_type["player"] + by_type["dao"], "sectors": _top(by_kind, TOP_SECTORS)},
        "vac": vac_block,
        "mismatch": mismatch,
        "staffless_npc": {"n": staffless, "cash0": cash0},
        "hires": {"net": hires_net, "events": hires_events, "short": hires_short, "stable4": stable4},
        "exits": {"net": exits_net, "firm_death": exits_death, "reason": reason},
        "wage_fail": wf,
        "inflow": inflow,
        "inflow_reason": inflow_reason,
        "spells": {"ongoing": ongoing, "done": done, "long_share": round(ongoing["gt26"] / n_seek, 4) if n_seek else None, "censored": len(new.cens)},
        "pf_death": pf,
    }
    return block, new


def world_facts(block: Mapping[str, Any] | None) -> dict[str, int | float | None]:
    """Beş dünya alanı için `x_*` olguları (`probes.labour_facts`; `extract.EXTRA_FIELDS`). Blok yoksa hepsi None; `x_vacancies` açık kadro kaydı yoksa None."""
    if not block:
        return {"x_vacancies": None, "x_staffless_npc": None, "x_wage_fail": None, "x_unemp_long_share": None, "x_hires_stable4": None}
    vac = block.get("vac")
    return {"x_vacancies": None if vac is None else vac["npc"] + vac["player"], "x_staffless_npc": block["staffless_npc"]["n"], "x_wage_fail": block["wage_fail"],
            "x_unemp_long_share": block["spells"]["long_share"], "x_hires_stable4": block["hires"]["stable4"]}
