"""Kim ne tutuyor (PLAN-TAKIP): paranın hesap ve sahiplik ayrışımı, nüfus grupları ve mevduat. Modelin canlı dünyasından (`W`) SALT OKUNUR;
model içe aktarılmaz, `W`'ye yazılmaz (defaultdict'lere `[]` ile erişilmez, `.get` kullanılır). `probes.py` deseni.

K1: yalnız grup düzeyi; kişi kimliği, takma ad ya da adres yoktur. Tutarlar tam Akçeye yuvarlanır (paket boyutu içindir).
`build(W, P)` bölümleri tek tek çağırır; sonraki görevler kendi bölümünü `build`'e tek satırla ekler.
Her alanın TANIMI `NOTES`'tadır (testle kilitli).
"""
from __future__ import annotations

from typing import Any

from . import probes

PLAYER_GROUPS = ("lonca_owner", "firm_owner", "employed_player_firm", "employed_npc_firm", "municipal", "ahir", "seeking", "student", "other")
NPC_GROUPS = ("employed_npc_firm", "employed_player_firm", "municipal", "pool", "dependent", "out", "other")
PUBLIC_KINDS = ("ahir", "belediye")
NON_MEMBER_KINDS = ("belediye", "arge", "ahir")        # lonca üyesi sayılmayan (kamu ve Ar-Ge) işletme türleri
LONCA_ROW_KEYS = ("ref", "owner", "members", "fee", "capital", "deposits", "credit_out", "equity")
FIRMS_KEYS = ("player_count", "owners", "multi_owners", "cash_top10_share")

NOTES: dict[str, str] = {
    "money.deposits_players": "Oyuncuların lonca mevduatı toplamı, Akçe (`W.deposits[q][1]`, q oyuncu). Hanenin loncadan alacağıdır; para loncanın sermaye hesabında durur.",
    "money.deposits_insurance": "Sigorta rezervlerinin lonca mevduatı, Akçe (`W.deposits[\"sig<i>_rezerv\"]`). Sigortacının loncadan alacağıdır.",
    "money.found_fund": "Kuruluş fonu havuzlarının toplamı, Akçe: Σ `KFON<i>_sermaye` bakiyesi. Kamunun parasıdır; modelin `yk_fon_bakiye` ölçüsüyle eşittir.",
    "money.insurance_reserve": "Sigorta rezerv hesaplarının toplamı, Akçe: Σ `sig<i>_rezerv` bakiyesi (batmış sigortacılar dahil, bakiyeleri sıfırdır).",
    "money.lonca_cash_net": "Loncanın mevduat ve fon düşülünce kalan kasası, Akçe: `money_lonca` - `deposits_players` - `deposits_insurance` - `found_fund` - `insurance_reserve`. "
                            "İŞARETLİ: kredi dışarıdayken (mevduatın bir kısmı krediye gitmişken) negatif olabilir; o zaman açığın karşılığı `credit_out` ve `bonds_out` kalemlerindedir.",
    "money.credit_out": "Loncaların açık kredisi, Akçe: işletme kredileri (`W.loans`, lonca) + konut kredileri (`W.mortgages`). Kuruluş fonunun kredisi hariçtir (`fund_credit_out`).",
    "money.fund_credit_out": "Kuruluş fonunun açık kredisi, Akçe (`W.loans`, kredi veren `KFON<i>`).",
    "money.bonds_out": "Loncaların elindeki açık şehir tahvili, Akçe (`W.bonds`, `out` toplamı).",
    "money.lonca_equity": "Loncaların özkaynağı toplamı, Akçe: Σ (sermaye + kredi + tahvil - mevduat); modelin `credit_core.lo_equity` formülüyle aynıdır.",
    "groups.player.lonca_owner": "Bir loncanın sahibi olan oyuncular (`W.lonca_owner`). Öncelik sırasının ilkidir: bir kişi tek gruba girer. {n, cash, deposits}: kişi sayısı, nakit (`L.bal`), mevduat.",
    "groups.player.firm_owner": "Canlı bir oyuncu işletmesinin (`holdings.player_owned`) sahibi olan (lonca sahibi olmayan) oyuncular. Sahibin işyeri kendi işletmesi olsa da bu gruba girer.",
    "groups.player.employed_player_firm": "Sahibi oyuncu ya da DAO olan (ahır ve belediye dışı, canlı) bir işletmede çalışan, sahip olmayan oyuncular.",
    "groups.player.employed_npc_firm": "Sahipsiz yerleşik (ahır ve belediye dışı, canlı) bir işletmede çalışan oyuncular.",
    "groups.player.municipal": "Belediye işinde çalışan oyuncular.",
    "groups.player.ahir": "Ahırda (çıraklık ocağı) çalışan oyuncular.",
    "groups.player.seeking": "Çalışmayıp iş arayan oyuncular (`c[\"seekers\"]`). Öğrenci olsalar da buraya girerler (öncelik).",
    "groups.player.student": "Öğrenci olup işi de iş araması da olmayan oyuncular (`W.student`).",
    "groups.player.other": "Yukarıdakilerin hiçbirine girmeyen oyuncular (işi yok, iş de aramıyor).",
    "groups.npc.employed_npc_firm": "Sahipsiz yerleşik (ahır ve belediye dışı, canlı) bir işletmede çalışan NPC'ler. [n, nakit].",
    "groups.npc.employed_player_firm": "Sahibi oyuncu ya da DAO olan (ahır ve belediye dışı, canlı) bir işletmede çalışan NPC'ler.",
    "groups.npc.municipal": "Belediye işinde çalışan NPC'ler.",
    "groups.npc.pool": "İşsiz havuzdaki NPC'ler (`c[\"pool\"]`).",
    "groups.npc.dependent": "Bakmakla yükümlü NPC'ler (hane kipinde işgücü dışı, `c[\"deps\"]`).",
    "groups.npc.out": "İşgücü dışına çıkmış (cesareti kırılmış) NPC'ler (`c[\"out\"]`).",
    "groups.npc.other": "Yukarıdakilerin hiçbirine girmeyen NPC'ler. Ahırda çalışan NPC'ler de buradadır (NPC grupları arasında ahır yoktur).",
    "deposits.by_group": "Mevduatın kime ait olduğu, Akçe: her oyuncu grubunun mevduatı + `insurance` (sigorta rezervlerinin mevduatı). Toplamı Σ `dep_tot`'a eşittir (yuvarlama payıyla). "
                         "NPC'nin mevduatı yoktur (model değişmezi; NPC hiçbir grupta mevduatla görünmez).",
    "loncas.ref": "Loncanın iç anahtarı (`lonca<i>`); arayüz bunu \"Lonca N\" etiketiyle gösterir. Yeni yuvalar açıksa en çok 9 satır.",
    "loncas.owner": "Loncanın sahibi, GRUP düzeyinde (kişi kimliği çıkmaz): `closed` kapalı lonca (kapalılık sahipliğin önüne geçer), `player` bir oyuncunun sahip olduğu lonca, `none` sahipsiz.",
    "loncas.members": "Üye işletme sayısı: o loncaya bağlı, çalışanı olan, canlı ve kamu dışı (belediye, Ar-Ge, ahır hariç) işletmeler.",
    "loncas.fee": "Loncanın üyelik ücreti oranı (`W.FEES`; yoksa varsayılan `LONCA_FEE`); 6 ondalığa yuvarlı, para değil oran.",
    "loncas.capital": "Loncanın sermaye hesabının bakiyesi, Akçe (`<lonca>_sermaye`): kredi havuzu ve mevduatın durduğu kasa.",
    "loncas.deposits": "Loncanın toplam mevduat yükümlülüğü, Akçe (`W.dep_tot`): oyuncu ve sigorta rezervi mevduatı.",
    "loncas.credit_out": "O loncanın açık kredisi, Akçe: işletme kredileri + konut kredileri (tahvil ve kuruluş fonu kredisi hariç).",
    "loncas.equity": "Loncanın özkaynağı, Akçe, İŞARETLİ: sermaye + kredi + tahvil - mevduat (`credit_core.lo_equity` formülü). Satırların toplamı `money.lonca_equity`'dir.",
    "firms.player_count": "Canlı oyuncu işletmesi sayısı (`holdings.player_owned`: sahibi bir oyuncu olan ve `org_owner`ı boş; DAO / lonca işletmeleri, `owner` kurucuda kalsa bile, dahil değil).",
    "firms.owners": "Canlı bir oyuncu işletmesi olan oyuncu sayısı (kişi kimliği çıkmaz, yalnız sayı).",
    "firms.multi_owners": "İki ya da daha çok canlı işletmesi olan oyuncu sayısı.",
    "firms.cash_top10_share": "Nakdi en büyük %10 oyuncu işletmesinin (en az 1; yukarı yuvarlı) oyuncu işletmelerinin toplam nakdindeki payı, 0-1, 4 ondalık. İşletme yoksa ya da toplam nakit <= 0 ise null.",
    "wealth.b50": "SAHİP SERVETİ (K2: firmanın kasası sahibinin parasıdır): alt %50 oyuncunun servetteki payı, 0-1, 6 ondalık. Oyuncu serveti = nakit (`L.bal`) + mevduat (`W.deposits`) + "
                  "sahibi olduğu CANLI firmaların kasası. Sahiplik kuralı (`holdings.player_owned`): `firms[f][\"owner\"]` bir oyuncu kişisidir VE `org_owner` boştur; DAO / lonca firması "
                  "(`org_owner` dolu: medya firması satılınca `owner` kurucuda kalsa bile), ahır, belediye, yerleşik (NPC) ve özelleşme taksit planındaki firma (`priv`, owner yok) ve ölü firma SAYILMAZ. Lonca sahibinin loncanın öz kaynağındaki payı sayılmaz. "
                  "Konut ve hisse YOKTUR (modelin `series` ölçüsünden farkı: `world.wealth_*`). Sıralama artan servete göre; kesimler int(n*0.5) ve int(n*0.9) (modelin top10 kuralı); "
                  "negatif servet olduğu gibi girer. Toplam <= 0 ise null.",
    "wealth.m40": "Orta %40 oyuncunun sahip servetindeki payı, 0-1, 6 ondalık (alt %50'den sonraki, üst %10'dan önceki kişiler). Toplam <= 0 ise null.",
    "wealth.t10": "Üst %10 oyuncunun sahip servetindeki payı, 0-1: 1 - b50 - m40 olarak kurulur, üçünün toplamı tam 1'dir. Toplam <= 0 ise null.",
    "wealth.t1": "Üst %1 oyuncunun sahip servetindeki payı, 0-1, 6 ondalık (en az en zengin kişi: int(n*0.99) kesimi, modelin top1_w kuralı); `t10`'un içindedir. Toplam <= 0 ise null.",
    "wealth.median": "Medyan oyuncunun sahip serveti, Akçe (sıralı listenin n // 2. elemanı, modelin med_w kuralı); oyuncu yoksa null.",
    "wealth.gini": "Sahip servetinin Gini katsayısı, 0-1+ (modelle aynı formül: Σ (2(i+1) - n - 1) v / (n x toplam), 4 ondalık). Negatif servet nedeniyle 1'i aşabilir. Toplam <= 0 ise null.",
    "flows": "Kesimden kesime para akışı (§4.4), haftalık: `[[kaynak, hedef, tutar], ...]` (tam Akçe). Kesimler `flowhook.SEGMENTS`: players, npcs, npc_firms, player_firms, public_firms (ahır, belediye), city, "
             "lonca (sermaye, refah ve lonca önekli hesaplar), found_fund, insurance, other, mint (yalnız kaynak: şehir basımı `settle` ve `L.cm_mint` haftalık farkı, hedef city / lonca). "
             "Kesim içi hücre yazılmaz; tür toplanır (tür ayrıntısı şehir bütçesi panelindedir). En büyük 18 hücre (`flowhook.TOP_CELLS`) + kalanı tek `[\"rest\", \"rest\", tutar]` satırı: `rest` bir kesim değildir, sunum kovasıdır (eski kayıtlarda aynı satır `[\"other\", \"other\", tutar]` yazılıydı; kesim içi hücre olmadığından `other`->`other` gerçek akış olamaz). "
             "`other` kesimi yalnız sınıflanamayan hesaptır (gerçek modelde ~%0: `ikinci_el_takas`). Kira emanet hesabı `emanet<i>` `city` sayılır: hane kirası `players -> city` olarak doğrudur; ev sahibine giden kira (emanetten ev sahibine) `city -> players` hücresinde görünür (kira şehir hesabından geçmiş gibi okunur; M1), emanet -> şehir kasası kesim içidir. "
             "`KPAY<i>` npc_firms, `<firma>_yenileme` firmanın kesimidir. "
             "Lonca -> lonca devirleri (`mevduat_tasima`, kapanma devirleri) kesim içidir ve yazılmaz. "
             "ÖLÇÜM YOLU = KANCA (T4 Adım 0: 3 x 20 hafta medyan süre oranı 1,058 <= 1,08; ayrıntı rapor): modelin kendi teşhis kancası `Ledger.sx` + `L.secfn` (`ledger.py:94-95`) host tarafından kurulur, "
             "her `pay()` kaynak ve hedef HESABINI kesime çevirir (tür eşlemesi değil: `mevduat` oyuncudan da sigortadan da gelir). `secfn` hesap -> kesim sözlüğüdür; her adımdan sonra yeniden kurulur, "
             "hafta içinde açılan hesabı `__missing__` sınıflar. Hafta içindeki sahiplik değişimi (özelleşme, firma satışı) bir sonraki haftaya yansır. Yan etki: `measure.py` her hafta host'un geçici "
             "dizinine `w.csv.sx` / `.st` satırları yazar (<= 10 KB/hafta; host kapanınca silinir). Kanca kurulamazsa ya da bir hafta alınamazsa blok o hafta yoktur; geçici dizine yazılamıyorsa (dizin silinmiş: yeniden oluşturulur; yazma hâlâ olmuyorsa) kanca bir kez not düşülerek kaldırılır ve koşu kancasız sürer. Kalan risk: bir hafta yazılırken disk dolması. Kancanın model durumundaki izi `L.sx`, `L.secfn` ve iki sıfır değerli `W.bond_stat` anahtarıdır (`kisma_tavan_tl`, `kisma_havuz_tl`; `L.sx` kurulunca modelin kendi `measure.py:103-104` okuması defaultdict'e 0.0 ekler); ekonomik davranış değişmez. Yedek yol (`flow_kinds`) uygulanmadı.",
    "wealth.n": "Servet sıralamasındaki oyuncu sayısı (firma sahibi olmayan, mevduatsız oyuncu da dahil; NPC dahil değil).",
}


def player_owned(d: dict[str, Any]) -> bool:
    """Firma bir oyuncu kişisinin mi? Canlı, `owner` dolu ve `org_owner` BOŞ. Medya firması lonca/DAO'ya satılınca model `owner`'ı kurucuda bırakıp yalnız
    `org_owner` koyar (`media.py:182,278,307`); o firma kurucunun serveti ve sahip sayısı dışındadır (T3 hükmü)."""
    return d.get("owner") is not None and not d.get("dead") and not d.get("org_owner")


def _akce(v: Any) -> int:
    """Tam Akçe; sonlu olmayan değer 0 sayılır (paket JSON'u NaN taşımaz)."""
    f = probes.finite(v)
    return int(round(f)) if f is not None else 0


def _per_lonca(W) -> dict[str, dict[str, float]]:
    """Lonca başına kredi (işletme + konut, fon hariç), tahvil, mevduat ve sermaye; ayrıca fon kredisi toplamı `"_fund"` anahtarında. Salt okur."""
    loncas = list(getattr(W, "loncas", ()) or ())
    out: dict[str, dict[str, float]] = {lo: {"credit": 0.0, "bonds": 0.0} for lo in loncas}
    fund = 0.0
    for ln in (getattr(W, "loans", None) or {}).values():
        lo = ln.get("lo")
        if isinstance(lo, str) and lo.startswith("KFON"):
            fund += ln["out"]
        elif lo in out:
            out[lo]["credit"] += ln["out"]
    for mt in getattr(W, "mortgages", None) or ():
        if mt.get("lo") in out:
            out[mt["lo"]]["credit"] += mt["out"]
    for b in getattr(W, "bonds", None) or ():
        if b.get("lo") in out:
            out[b["lo"]]["bonds"] += b["out"]
    out["_fund"] = {"credit": fund, "bonds": 0.0}
    return out


def money(W, P) -> dict[str, int]:
    """Para ayrışımı (9 sayı): mevduat, fon, sigorta rezervi, loncanın net kasası, kredi, tahvil ve özkaynak. Tanımlar `NOTES`'ta."""
    bal = W.L.bal
    people = W.people
    ins_accts = {f"{i}_rezerv" for i in (getattr(W, "ins", None) or {})}
    dep_p = dep_i = 0.0
    for k, e in (getattr(W, "deposits", None) or {}).items():
        if k in people:
            if people[k].get("who") == "oyuncu":
                dep_p += e[1]
        elif k in ins_accts:
            dep_i += e[1]
    found = sum(bal.get(f"KFON{c['i']}_sermaye", 0.0) for c in W.cities)
    reserve = sum(bal.get(a, 0.0) for a in ins_accts)
    money_lonca = probes.money_facts(W, P)["x_money_lonca"]
    per = _per_lonca(W)
    fund_credit = per.pop("_fund")["credit"]
    dep_tot = getattr(W, "dep_tot", None) or {}
    equity = sum(bal.get(f"{lo}_sermaye", 0.0) + v["credit"] + v["bonds"] - dep_tot.get(lo, 0.0) for lo, v in per.items())
    return {
        "deposits_players": _akce(dep_p), "deposits_insurance": _akce(dep_i), "found_fund": _akce(found), "insurance_reserve": _akce(reserve),
        "lonca_cash_net": _akce(money_lonca - dep_p - dep_i - found - reserve),
        "credit_out": _akce(sum(v["credit"] for v in per.values())), "fund_credit_out": _akce(fund_credit),
        "bonds_out": _akce(sum(v["bonds"] for v in per.values())), "lonca_equity": _akce(equity),
    }


def context(W) -> dict[str, Any]:
    """Kişi sınıflaması için bir kerelik kümeler (kişi başına tek geçiş)."""
    cities = W.cities
    return {
        "firms": W.firms,
        "lonca_owner": {v[0] for v in (getattr(W, "lonca_owner", None) or {}).values()},
        "firm_owner": {d["owner"] for d in W.firms.values() if player_owned(d)},
        "seekers": {q for c in cities for q in c.get("seekers", ())},
        "pool": {q for c in cities for q in c.get("pool", ())},
        "deps": {q for c in cities for q in c.get("deps", ())},
        "out": {q for c in cities for q in c.get("out", ())},
        "student": set(getattr(W, "student", None) or ()),
    }


def _workplace(ctx: dict[str, Any], p: dict[str, Any]) -> str | None:
    """Kişinin işyeri türü: `municipal`, `ahir`, `player` (sahibi oyuncu/DAO), `npc` (sahipsiz) ya da None (işi yok, firma ölü ya da yok)."""
    f = p.get("firm")
    d = ctx["firms"].get(f) if f is not None else None
    if d is None or d.get("dead"):
        return None
    if d["kind"] == "belediye":
        return "municipal"
    if d["kind"] == "ahir":
        return "ahir"
    return "player" if (d.get("owner") is not None or d.get("org_owner")) else "npc"


def player_group(ctx: dict[str, Any], q: str, p: dict[str, Any]) -> str:
    """Oyuncunun grubu: öncelik sırasında ilk uyan (`PLAYER_GROUPS`)."""
    if q in ctx["lonca_owner"]:
        return "lonca_owner"
    if q in ctx["firm_owner"]:
        return "firm_owner"
    wp = _workplace(ctx, p)
    if wp == "player":
        return "employed_player_firm"
    if wp == "npc":
        return "employed_npc_firm"
    if wp == "municipal":
        return "municipal"
    if wp == "ahir":
        return "ahir"
    if q in ctx["seekers"]:
        return "seeking"
    if q in ctx["student"]:
        return "student"
    return "other"


def npc_group(ctx: dict[str, Any], q: str, p: dict[str, Any]) -> str:
    """NPC'nin grubu: öncelik sırasında ilk uyan (`NPC_GROUPS`). Ahırdaki NPC `other`'a düşer."""
    wp = _workplace(ctx, p)
    if wp == "npc":
        return "employed_npc_firm"
    if wp == "player":
        return "employed_player_firm"
    if wp == "municipal":
        return "municipal"
    if q in ctx["pool"]:
        return "pool"
    if q in ctx["deps"]:
        return "dependent"
    if q in ctx["out"]:
        return "out"
    return "other"


def groups(W) -> dict[str, dict[str, Any]]:
    """Nüfus grupları: `{player: {grup: {n, cash, deposits}}, npc: {grup: [n, cash]}}`. Gruplar birbirini dışlar ve nüfusu tüketir (hepsi her zaman yazılır)."""
    ctx = context(W)
    bal = W.L.bal
    deposits = getattr(W, "deposits", None) or {}
    pl = {g: [0, 0.0, 0.0] for g in PLAYER_GROUPS}
    npc = {g: [0, 0.0] for g in NPC_GROUPS}
    for q, p in W.people.items():
        cash = bal.get(q, 0.0)
        if p.get("who") == "oyuncu":
            e = pl[player_group(ctx, q, p)]
            e[0] += 1
            e[1] += cash
            if q in deposits:
                e[2] += deposits[q][1]
        elif p.get("who") == "npc":
            e = npc[npc_group(ctx, q, p)]
            e[0] += 1
            e[1] += cash
    return {"player": {g: {"n": e[0], "cash": _akce(e[1]), "deposits": _akce(e[2])} for g, e in pl.items()},
            "npc": {g: [e[0], _akce(e[1])] for g, e in npc.items()}}


def deposits(W, grp: dict[str, dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Mevduatın sahibi: oyuncu gruplarının mevduatı + sigorta rezervlerinin mevduatı (`groups` çıktısından)."""
    ins_accts = {f"{i}_rezerv" for i in (getattr(W, "ins", None) or {})}
    dep = getattr(W, "deposits", None) or {}
    by = {g: e["deposits"] for g, e in grp["player"].items()}
    by["insurance"] = _akce(sum(e[1] for k, e in dep.items() if k in ins_accts))
    return {"by_group": by}


def loncas(W, P) -> list[dict[str, Any]]:
    """Lonca satırları (§4.2): `LONCA_ROW_KEYS`. Kapalı lonca da yazılır. Kişi kimliği yoktur; sahip yalnız grup (`player`/`none`/`closed`). Salt okur."""
    los = list(getattr(W, "loncas", ()) or ())
    per = _per_lonca(W)
    mem: dict[str, int] = {}
    for d in W.firms.values():
        lo = d.get("lonca")
        if lo and d["workers"] and not d.get("dead") and d["kind"] not in NON_MEMBER_KINDS:
            mem[lo] = mem.get(lo, 0) + 1
    bal = W.L.bal
    dep_tot = getattr(W, "dep_tot", None) or {}
    fees = getattr(W, "FEES", None) or {}
    closed = getattr(W, "closed", None) or ()
    owned = getattr(W, "lonca_owner", None) or {}
    out = []
    for lo in los:
        v = per[lo]
        cap = bal.get(f"{lo}_sermaye", 0.0)
        fee = probes.finite(fees.get(lo, getattr(P, "LONCA_FEE", 0.0)))
        out.append({"ref": lo, "owner": "closed" if lo in closed else ("player" if lo in owned else "none"), "members": mem.get(lo, 0),
                    "fee": round(fee, 6) if fee is not None else 0.0, "capital": _akce(cap), "deposits": _akce(dep_tot.get(lo, 0.0)),
                    "credit_out": _akce(v["credit"]), "equity": _akce(cap + v["credit"] + v["bonds"] - dep_tot.get(lo, 0.0))})
    return out


def firms(W) -> dict[str, Any]:
    """Oyuncu işletmesi sahipliği (§4.2): sayılar ve nakdin yoğunluğu; kimlik yok. Salt okur."""
    bal = W.L.bal
    by_owner: dict[Any, int] = {}
    cash = []
    for f, d in W.firms.items():
        o = d.get("owner")
        if player_owned(d):
            by_owner[o] = by_owner.get(o, 0) + 1
            cash.append(bal.get(f, 0.0))
    total = sum(cash)
    k = max(1, -(-len(cash) // 10))                                       # tavan(n / 10)
    share = round(sum(sorted(cash, reverse=True)[:k]) / total, 4) if cash and total > 0 else None
    return {"player_count": len(cash), "owners": len(by_owner), "multi_owners": sum(1 for n in by_owner.values() if n >= 2), "cash_top10_share": share}


def owner_wealth(W) -> dict[str, Any]:
    """Sahip serveti (K2, §4.6): oyuncu başına nakit + mevduat + sahibi olduğu canlı firmaların kasası; dilim payları, medyan, Gini, sayı. Salt okur, tek geçiş.
    Kural ve tanımlar `NOTES["wealth.*"]`'ta. Kimlik çıkmaz."""
    bal = W.L.bal
    people = W.people
    dep = getattr(W, "deposits", None) or {}
    firm_cash: dict[Any, float] = {}
    for f, d in W.firms.items():
        o = d.get("owner")
        if player_owned(d):
            firm_cash[o] = firm_cash.get(o, 0.0) + bal.get(f, 0.0)
    pw = sorted(bal.get(q, 0.0) + (dep[q][1] if q in dep else 0.0) + firm_cash.get(q, 0.0) for q, p in people.items() if p.get("who") == "oyuncu")
    n = len(pw)
    out: dict[str, Any] = {"b50": None, "m40": None, "t10": None, "t1": None, "median": None, "gini": None, "n": n}
    if not n:
        return out
    out["median"] = _akce(pw[n // 2])
    tot = sum(pw)
    if tot > 0:
        b50 = round(sum(pw[:int(n * 0.5)]) / tot, 6)
        m40 = round(sum(pw[int(n * 0.5):int(n * 0.9)]) / tot, 6)
        out.update(b50=b50, m40=m40, t10=round(1.0 - b50 - m40, 6), t1=round(sum(pw[int(n * 0.99):]) / tot, 6),
                   gini=round(sum((2 * (i + 1) - n - 1) * v for i, v in enumerate(pw)) / (n * tot), 4))
    return out


def flows(W) -> list[list[Any]] | None:
    """Son adımın kesimden kesime hücreleri (`flowhook.take` host'ta adım sonunda hesaplar ve matriste saklar); kanca kurulu değilse ya da henüz hafta yoksa None. Salt okur."""
    sx = getattr(getattr(W, "L", None), "sx", None)
    cells = getattr(sx, "cells", None)
    return [list(r) for r in cells] if cells else None


def build(W, P) -> dict[str, Any]:
    """Paketin `holdings` bloğu. Her bölüm bir satır; sonraki görevler kendi bölümünü buraya ekler."""
    out: dict[str, Any] = {"money": money(W, P)}
    out["groups"] = groups(W)
    out["deposits"] = deposits(W, out["groups"])
    out["loncas"] = loncas(W, P)
    out["firms"] = firms(W)
    out["wealth"] = owner_wealth(W)
    fl = flows(W)
    if fl is not None:
        out["flows"] = fl
    return out
