"""simkit.ledger: Akçe defteri (plan v2 adım 3). Para yalnız Ledger.pay ile el değiştirir; basım yalnız settle() ile.

AMAÇ: model.py `Ledger` sınıfı AYNEN taşındı (metin kesme). Para korunumu: total() == minted (assert_conserved).
ARAYÜZ: Ledger(city_accounts), pay/settle/total/begin_week; assert_conserved(L, tol) (yeni, çağrılmaz: yalnız test/kapı için).
PX: L.sx (SECDUMP) ve L.bd (BDUMP) ölçüm kancaları yalnız ortam değişkeniyle açılır (kapalıyken None: tek karşılaştırma).
KATMAN: yalnız simkit.params'a bağlıdır (INCOME_KINDS, NONCOST_KINDS, REV_KINDS, MINT_*).
"""
import os
from collections import defaultdict

from .params import TRANS_SUPPORT, FOUND_FUND, TREASURY_RULE, INCOME_KINDS, NONCOST_KINDS, REV_KINDS, MINT_NOPRINT, MINT_PRIO, MINT_LOW_SHARE

CEXP_SKIP = ("kamu_destek_fonu", "kurulus_fonu_fonlama", "npc_kurulus_sermayesi", "tahvil_faizi", "tahvil_itfa", "sehirler_arasi_denge")   # K-211: zorunlu gider sayılmayan çıkışlar (K-215: kuruluş fonu aktarımı da)
FUND_KIND_MAP = {"kredi_geri": "kurulus_fonu_geri_odeme", "kredi_tasfiye": "kurulus_fonu_tasfiye", "faiz": "kurulus_fonu_faiz"}   # K-215: kuruluş fonu havuzuna giden ödemelerin kind'ı (fon izi ayrı görünsün; hesap adı KFON<i>_sermaye)


class Ledger:
    def __init__(self, city_accounts):
        self.bal = defaultdict(float)
        self.minted = 0.0
        self.flows = defaultdict(float)
        self.income = defaultdict(float)        # haftalık gelir (ücret, ödenek, temettü, burs): gelir Gini'si için
        self.city_out = defaultdict(float)      # şehir kasasından çıkan akışlar, tür başına (basımın nereye gittiğini göstermek için)
        self.events = []
        self.city_accounts = set(city_accounts)
        self.cap_on = False                     # K-185.1: şehir hesabı çıkışı basım iznine bağlı mı
        self.allow = defaultdict(float)         # K-185.1: şehir hesabı -> kalan basım izni (Akçe)
        self.cut = defaultdict(float)           # K-185.1: kısılan şehir harcaması, tür başına
        self.bond_hook = None                   # K-185.4: şehir açığını tahville kapatan işlev (hesap, açık, tür) -> sağlanan
        self.bond_first = False
        self.nobond = ("sehirler_arasi_denge", "tahvil_faizi", "tahvil_itfa", "kamu_destek_fonu", "kurulus_fonu_fonlama")
        self.inflow = defaultdict(float)        # K-185.4: şehir hesabına dışarıdan gelen haftalık gelir (borç tavanı için)
        self.fset = None                        # K-187: firma sözlüğü (PRICE_V2 açıkken); firma gider defteri
        self.fexp = None                        # K-187: firma -> {gider türü: haftalık tutar}
        self.frev = None                        # K-187: firma -> haftalık satış geliri
        self.cat = None                         # K-187: geçici gider kategorisi (ör. "capex")
        self.cin = 0.0                          # K-187.6: şehir hesaplarına dış gelir (tahvil/denge hariç), haftalık
        self.cout = 0.0                         # K-187.6: şehir hesaplarından dışa gider (tahvil/denge hariç), haftalık
        self.cons = 0.0                         # K-187.6: hane tüketimi (satis), haftalık
        self.sx = defaultdict(float) if os.environ.get("SECDUMP") else None   # tur 19: sektörler arası haftalık akış matrisi (yalnız teşhis)
        self.secfn = None                       # tur 19: hesap -> sektör eşlemesi (simkit.measure.install_secfn)
        self.bd = defaultdict(float) if os.environ.get("BDUMP") else None   # tur 15: şehir kasası gelir/gider kalemi ve kurtarma alıcısı ayrıştırma (yalnız teşhis)

        self.cexp_prev = defaultdict(float)
        self.mand = {}                          # K-211: şehir hesabı -> sönümlü haftalık zorunlu gider
        self.fund_pools = set()                 # K-215: kuruluş fonu havuz hesapları (FOUND_FUND açıkken world_build doldurur); boşken pay() yolu değişmez
        self.fiscal_minted = 0.0                # K-218: yalnız şehir (mali) basımı; minted = fiscal_minted + cm_mint - cm_burn her zaman (kredi parası kayıtlı akış)
        self.cm = None                          # K-218: CreditMoney (CREDIT_MONEY açıkken world_init atar); None iken pay() yolu değişmez
        self.cm_mint = 0.0                      # K-218: kümülatif kredi basımı (kayıt)
        self.cm_burn = 0.0                      # K-218: kümülatif kredi yakımı (kayıt)
        self.cexp = defaultdict(float) if (TRANS_SUPPORT or FOUND_FUND or TREASURY_RULE) else None   # K-211: şehir hesabı -> kümülatif zorunlu gider (destek/kurtarma/tahvil/denge hariç); kasa tabanı için (kapalıyken None)

    def begin_week(self, w):
        if self.cexp is not None:                # K-211: geçen haftanın zorunlu gideri -> sönümlü ortalama (kasa tabanı); kapalıyken işlem yok
            for a_ in self.city_accounts:
                d_ = self.cexp[a_] - self.cexp_prev[a_]
                self.cexp_prev[a_] = self.cexp[a_]
                self.mand[a_] = d_ if a_ not in self.mand else 0.8 * self.mand[a_] + 0.2 * d_
        pass                                    # hafta sınırı kancası (davranışsız): araçlar (digest) sarmalar; modüler yapıda NOW'a bağımlılığı kaldırır

    def pay(self, frm, to, amt, kind):
        if amt <= 1e-12:
            return 0.0
        if self.fund_pools and to in self.fund_pools:
            kind = FUND_KIND_MAP.get(kind, kind)           # K-215: fona giden geri ödeme/faiz/tasfiye ayrı kind
        if self.cm is not None and kind in self.cm.mint_kinds:         # K-218: lonca kredisi: havuz nakdi yetmeyen kısım yeni Akçe olarak basılır (kayıtlı akış)
            m_ = self.cm.mint(frm, amt)
            if m_ > 0.0:
                self.bal[frm] += m_
                self.minted += m_
                self.cm_mint += m_
                self.flows["kredi_basim"] += m_
        if frm not in self.city_accounts and self.bal[frm] + 1e-9 < amt:
            self.events.append(f"YETMEDİ {kind}: {frm} → {to} {amt:.2f} (bakiye {self.bal[frm]:.2f})")
            amt = max(0.0, self.bal[frm])
        if frm in self.city_accounts:
            if self.cap_on:
                amt = self._city_limit(frm, amt, kind)
                if amt <= 1e-12:
                    return 0.0
            self.city_out[kind] += amt
            if self.cexp is not None and kind not in CEXP_SKIP:
                self.cexp[frm] += amt
        self.bal[frm] -= amt
        self.bal[to] += amt
        self.flows[kind] += amt
        if self.cm is not None and kind in self.cm.burn_kinds and to.endswith("_sermaye"):         # K-218: anapara geri ödemesi/tasfiye geliri basılmış parayı yakar (faiz yakılmaz)
            b_ = self.cm.burn(to, amt, kind)
            if b_ > 0.0:
                self.bal[to] -= b_
                self.minted -= b_
                self.cm_burn += b_
                self.flows["kredi_yakim"] += b_
        if self.sx is not None and self.secfn is not None:
            self.sx[(self.secfn(frm), self.secfn(to), kind)] += amt
        if self.bd is not None:
            if frm in self.city_accounts and to not in self.city_accounts:
                self.bd[("gider", kind, to if kind in ("npc_kurulus_sermayesi", "altyapi_hizmet_sozlesmesi", "kamu_hizmet_sozlesmesi") else "")] += amt
            elif to in self.city_accounts and frm not in self.city_accounts:
                self.bd[("gelir", kind, "")] += amt
        if to in self.city_accounts and frm not in self.city_accounts and kind != "tahvil_ihrac":
            self.inflow[to] += amt
        if kind in INCOME_KINDS:
            self.income[to] += amt
        if self.fexp is not None:
            if kind == "satis":
                self.cons += amt
            if kind not in ("tahvil_ihrac", "tahvil_itfa", "tahvil_faizi", "sehirler_arasi_denge"):
                if frm in self.city_accounts and to not in self.city_accounts:
                    self.cout += amt
                elif to in self.city_accounts and frm not in self.city_accounts:
                    self.cin += amt
            if frm in self.fset and kind not in NONCOST_KINDS:
                self.fexp[frm][self.cat or kind] += amt
            if to in self.fset and kind in REV_KINDS:
                self.frev[to] += amt
        return amt

    def _city_limit(self, frm, amt, kind):
        """K-185.1/K-185.4: şehir hesabının çıkışı = pozitif kasa + (tahvil) + basım izni; tavan dolunca kısılır."""
        b = self.bal[frm]
        lim = max(0.0, b)
        need = amt - lim
        if need > 1e-9 and self.bond_first and self.bond_hook and kind not in self.nobond:
            got = self.bond_hook(frm, need, kind)
            lim += got
            need -= got
        if need > 1e-9 and kind not in MINT_NOPRINT:
            a = self.allow[frm] * (1.0 if kind in MINT_PRIO else MINT_LOW_SHARE)
            room = max(0.0, a - max(0.0, -b))
            take = min(need, room)
            lim += take
            need -= take
        if need > 1e-9 and (not self.bond_first) and self.bond_hook and kind not in self.nobond:
            got = self.bond_hook(frm, need, kind)
            lim += got
            need -= got
        if amt > lim + 1e-9:
            self.cut[kind] += amt - lim
            return lim
        return amt

    def settle(self):
        for acct in sorted(self.city_accounts):
            if self.bal[acct] < 0:
                gap = -self.bal[acct]
                self.bal[acct] = 0.0
                self.minted += gap
                self.fiscal_minted += gap
                self.flows["basim:" + acct] += gap
                if self.sx is not None:
                    self.sx[("basim", "sehir", "basim")] += gap
                if self.cap_on:
                    self.allow[acct] = max(0.0, self.allow[acct] - gap)

    def total(self):
        return sum(self.bal.values())


def assert_conserved(L, tol=1e-9):
    """Para korunumu: toplam bakiye == basılan para (göreli tol). Davranışsız denetim; ihlalde AssertionError."""
    tot, mint = L.total(), L.minted
    assert abs(tot - mint) <= tol * max(1.0, abs(mint)), f"para korunumu bozuldu: total={tot!r} minted={mint!r}"
