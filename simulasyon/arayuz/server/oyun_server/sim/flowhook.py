"""Kesimden kesime akış (PLAN-TAKIP T4, §4.4): modelin KENDİ teşhis kancası (`Ledger.sx` + `L.secfn`, `ledger.py:94-95`) host tarafından kurulur.

Model koduna dokunulmaz (U1). Kanca davranışsızdır: `pay()` yalnız `sx[(secfn(frm), secfn(to), kind)] += amt` ekler. `measure.py:90-94` hafta sonunda matrisi
geçici `w.csv.sx` / `.st` dosyalarına yazıp `clear()` eder; `KesimMatrisi.clear()` boşaltmadan önce içeriği `last`'a kopyalar, host `take()` ile oradan okur.

Süre için `secfn` bir hesap -> kesim sözlüğünün `__getitem__`'idir (C düzeyi okuma). Sözlük her adımdan sonra `rebuild` ile yenilenir; hafta içinde açılan
hesapları `__missing__` sınıflar. Hafta içindeki sahiplik değişimi (özelleşme, satış) bir sonraki haftanın sözlüğüne yansır.
Kancanın model durumunda doğurduğu üç iz vardır: `L.sx`, `L.secfn` ve iki sıfır değerli `W.bond_stat` anahtarı (`kisma_tavan_tl`, `kisma_havuz_tl`): `L.sx` kurulunca
modelin kendi `measure.py:103-104` satırı bu anahtarları `defaultdict`'ten okur ve okuma 0.0 ekler. Ekonomik davranış değişmez (model bu anahtarlara yalnız `+=` yapar;
A/B testi ölçüm satırlarını, `L.bal`/`flows`/`income`/`events`'i ve RNG'yi birebir doğrular). Kişi/hesap kimliği çıkmaz; yalnız kesim adları.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

SEGMENTS = ("players", "npcs", "npc_firms", "player_firms", "public_firms", "city", "lonca", "found_fund", "insurance", "other", "mint")
PUBLIC_KINDS = ("ahir", "belediye")
TOP_CELLS = 18                                          # §4.4'te 24'tü; bütçe için 18: gerçek 26 hafta ortalaması <= 2.500 ve sentetik en kötü blok <= 3.000 (denetim turu 1)
YENILEME = "_yenileme"
REST = "rest"                                              # `take()` kalan satırının kesim adı: bir kesim DEĞİL, sunum kovası (SEGMENTS'te yok; eski kayıtta `other`)
ALIAS = {"basim": "mint", "sehir": "city"}               # `Ledger.settle` matrise bu iki ham ad ile yazar (`ledger.py:152`)


class KesimMatrisi(defaultdict):
    """`(kaynak_kesim, hedef_kesim, tür) -> tutar`. `clear()` içeriği `last`'a kopyalar (model hafta sonunda boşaltır)."""

    def __init__(self, *_):                              # `*_`: deepcopy / pickle `default_factory` verir
        super().__init__(float)
        self.last: dict[tuple, float] = {}
        self.fresh = False                                    # `clear()` yeni bir hafta bıraktı ve `take` henüz almadı (model boşaltmazsa eski hafta yeniden akış sayılmaz)
        self.cells: list[list[Any]] | None = None             # son `take` çıktısı (`holdings.flows` buradan okur; salt okur kaynak)
        self.cm_prev = 0.0                                    # `L.cm_mint`in bir önceki `take` değeri (haftalık fark için)

    def clear(self):
        self.last = dict(self)
        self.fresh = True
        super().clear()


class KesimHaritasi(dict):
    """Hesap -> kesim. Bilinmeyen hesabı `__missing__` sınıflar ve saklar (firma/kişi dahil; sahiplik değişimi `rebuild` ile yenilenir)."""

    def __init__(self, W):
        super().__init__()
        self.W = W
        self.cacc = {c["acct"] for c in W.cities}
        self.loncas = set(getattr(W, "loncas", ()) or ())

    def __missing__(self, a):
        try:
            r = self._classify(a)
        except Exception:                                    # noqa: BLE001  # modelin `pay()` içinden çağrılır: hata modele ASLA sızmaz
            r = "other"
        self[a] = r
        return r

    @staticmethod
    def _firm(d):
        if d.get("owner") is not None or d.get("org_owner"):
            return "player_firms"
        return "public_firms" if d["kind"] in PUBLIC_KINDS else "npc_firms"

    def _classify(self, a):
        W = self.W
        p = W.people.get(a)
        if p is not None:
            r = "players" if p.get("who") == "oyuncu" else "npcs"
        elif a in W.firms:
            r = self._firm(W.firms[a])
        elif a in self.cacc or a in W.L.city_accounts or a.startswith("emanet"):
            r = "city"                                       # `emanet<i>`: şehir başına kira emanet hesabı; hafta kapanışında ev sahiplerine ve şehir kasasına boşalır (PLAN-KREDI S2a)
        elif a.endswith(YENILEME) and a[:-len(YENILEME)] in W.firms:
            r = self._firm(W.firms[a[:-len(YENILEME)]])      # `<firma>_yenileme`: firmanın kendi yenileme hesabı, firmanın kesimi
        elif a.startswith("KPAY"):
            r = "npc_firms"                                  # NPC kâr payı havuzu (`TREASURY_RULE` / `PROFIT_KEEP`)
        elif a.startswith("KFON"):
            r = "found_fund"
        elif a.endswith("_rezerv"):
            r = "insurance"
        elif a.endswith(("_sermaye", "_refah")) or a.split("_")[0] in self.loncas:
            r = "lonca"
        else:
            r = "other"
        return r


def install(W) -> None:
    """Modelin teşhis kancasını kurar: `L.sx` (matris) ve `L.secfn` (hesap -> kesim). Yeniden çağrı güvenlidir (matris korunur)."""
    L = W.L
    if not isinstance(L.sx, KesimMatrisi):
        L.sx = KesimMatrisi()
        L.sx.cm_prev = float(getattr(L, "cm_mint", 0.0) or 0.0)
    rebuild(W)


def installed(W) -> bool:
    L = W.L
    return isinstance(getattr(L, "sx", None), KesimMatrisi) and getattr(L, "secfn", None) is not None


def rebuild(W) -> None:
    """Haritayı adım sonunda yeniler (sahiplik değişimleri yansır). Artımlı: kişi, şehir, lonca ve öbür hesapların kesimi sabittir (adlarına ve `who`'ya bağlı) ve korunur;
    yalnız FİRMALAR yeniden sınıflanır (özelleşme, satış) ve hata yedeği `other` olan girdiler yeniden denenir. Hafta içi yeni hesapları `__missing__` sınıflar.
    Tam yeniden kurma her adımda yaklaşık bir hafta süresinin %5'ini yerdi (Adım 0 ölçümünden sonra eklendi)."""
    L = W.L
    m = getattr(L.secfn, "__self__", None)
    if not isinstance(m, KesimHaritasi) or m.W is not W:
        m = KesimHaritasi(W)
    m.cacc = {c["acct"] for c in W.cities}
    m.loncas = set(getattr(W, "loncas", ()) or ())
    for a in [a for a, r in m.items() if r == "other"]:
        del m[a]
    for a in W.firms:
        m.pop(a, None)
        m.pop(a + YENILEME, None)                                 # firmanın yenileme hesabı firmanın kesimini izler
        m[a]                                                      # `__missing__` sınıflar ve saklar
    for a in list(W.L.bal):
        m[a]
    L.secfn = m.__getitem__


def take(W) -> list[list[Any]]:
    """Son tamamlanan haftanın kesimden kesime hücreleri: `[[kaynak, hedef, tutar], ...]` (tam Akçe; kesim içi hücre yok; tür toplanır).
    En büyük 18 hücre (`TOP_CELLS`); kalanı tek `["rest", "rest", tutar]` satırında (`rest` kesim değildir; eski kayıtlarda `other`). Kredi parası basımı `("mint", "lonca")` hücresi olarak eklenir."""
    L = W.L
    cells: dict[tuple[str, str], float] = defaultdict(float)
    src = L.sx.last if getattr(L.sx, "fresh", False) else {}
    L.sx.fresh = False
    for (a, b, _k), v in src.items():
        a, b = ALIAS.get(a, a), ALIAS.get(b, b)
        if a != b:
            cells[(a, b)] += v
    cm = float(getattr(L, "cm_mint", 0.0) or 0.0)
    d = cm - L.sx.cm_prev
    L.sx.cm_prev = cm
    if d > 0:
        cells[("mint", "lonca")] += d
    rows = sorted(((a, b, int(round(v))) for (a, b), v in cells.items() if round(v) > 0), key=lambda r: (-r[2], r[0], r[1]))
    out = [list(r) for r in rows[:TOP_CELLS]]
    rest = sum(r[2] for r in rows[TOP_CELLS:])
    if rest:
        out.append([REST, REST, rest])
    L.sx.cells = out
    return out
