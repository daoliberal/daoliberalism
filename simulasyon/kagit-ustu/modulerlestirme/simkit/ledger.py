"""simkit.ledger: Akçe defteri (plan v2 adım 3). Para yalnız Ledger.pay ile el değiştirir; basım yalnız settle() ile.

AMAÇ: model.py `Ledger` sınıfı AYNEN taşındı (metin kesme). Para korunumu: total() == minted (assert_conserved).
ARAYÜZ: Ledger(city_accounts), pay/settle/total/begin_week; assert_conserved(L, tol) (yeni, çağrılmaz: yalnız test/kapı için).
PX: L.sx (SECDUMP) ve L.bd (BDUMP) ölçüm kancaları yalnız ortam değişkeniyle açılır (kapalıyken None: tek karşılaştırma).
KATMAN: yalnız simkit.params'a bağlıdır (INCOME_KINDS, NONCOST_KINDS, REV_KINDS, HIRE_NET_KINDS, MINT_*).
"""
import os
from collections import defaultdict

from .params import TRANS_SUPPORT, FOUND_FUND, TREASURY_RULE, INCOME_KINDS, NONCOST_KINDS, REV_KINDS, HIRE_NET_KINDS, MINT_NOPRINT, MINT_PRIO, MINT_LOW_SHARE, CITY_BUDGET_RULE, CB_KINDS, CB_INCOME_KINDS, HOME_OWN
if HOME_OWN:
    CB_INCOME_KINDS = tuple(CB_INCOME_KINDS) + ("konut_bakim_oturulan",)      # G12b S-3: oturulan evin sehre odedigi bakim payi duzenli sehir geliridir (params.py degismez; yalniz HOME_OWN acikken)

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
        self.bond_room = None                   # M11.2 (2): hesap -> tahvilin yan etkisiz ihrac odasi (policy.bond_room kanca olarak week_open baglar); None iken tahvil odasi sayilmaz
        self.srev = None                        # M11.2 (3): HIRE_GATE_GROWTH acikken firma -> haftalik satis geliri (labor.srev_roll haftalik tarihe aktarir); None iken izlenmez
        self.sexp = None                        # M11.2 duzeltme 1: HIRE_GATE_GROWTH acikken firma -> haftalik faaliyet gideri (HIRE_NET_KINDS); labor.srev_roll net gelire cevirir; None iken izlenmez
        self.sfirms = None                      # M11.2 duzeltme 1: sexp'in izledigi firma sozlugu (W.firms)
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
        self.opening = 0.0                      # M11: acilis para stoku (NPC isletmelerinin gecmisten devreden kazanci); basim DEGIL: minted/fiscal_minted'e girmez. Korunum: Sbakiye = opening + minted (minted = fiscal_minted + cm_mint - cm_burn). NPC_FIRM_START_WEEKS=0 iken 0
        self.cb = defaultdict(float) if CITY_BUDGET_RULE else None   # M11.2 (4): sehir butce kurali durumu (kapaliyken None: pay() yolu degismez). cb[(ad, hesap)] haftalik sayaclar: inc (duzenli gelir), man (zorunlu cikis), used (butceden harcanan istege bagli)
        self.cb_hist = {}                       # M11.2 (4): hesap -> (deque gelir, deque zorunlu cikis), son CB_INCOME_WEEKS hafta
        self.cb_ratio = {}                      # M11.2 (5): hesap -> istege bagli kalemlerin bu hafta verilen payi (butce / gecen hafta talebi, <=1): kesinti alicilara ORANSAL (dict sirasi degil)
        self.cb_par = {}                        # M11.2 (5): hesap -> (gelir ort, zorunlu ort, borc kisma carpani) (econ_core.city_wage_room okur)
        self.cb_budget = {}                     # M11.2 (4): hesap -> bu haftanin istege bagli harcama butcesi (policy.city_budget_step); hesap yoksa sinirsiz
        self.cb_cut = defaultdict(float)        # M11.2 (4): butce yuzunden kisilan istege bagli harcama, tur basina (kumulatif)
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
            if self.cb is not None and kind in CB_KINDS:
                self.cb[("dem", frm)] += amt                      # M11.2 (5): talep (kesilmemis) bir sonraki haftanin orani icin sayilir
                rt_ = self.cb_ratio.get(frm, 1.0)
                if rt_ < 1.0:
                    self.cb_cut[kind] += amt * (1.0 - rt_)
                    amt *= rt_                                    # oransal pay (alicilar arasi esit oran)
                    if amt <= 1e-12:
                        return 0.0
                rem_ = self.cb_budget.get(frm, float("inf")) - self.cb[("used", frm)]
                if amt > rem_ + 1e-9:
                    self.cb_cut[kind] += amt - max(0.0, rem_)
                    amt = max(0.0, rem_)
                    if amt <= 1e-12:
                        return 0.0
            if self.cap_on:
                amt = self._city_limit(frm, amt, kind)
                if amt <= 1e-12:
                    return 0.0
            self.city_out[kind] += amt
            if self.cb is not None:
                if kind in CB_KINDS:
                    self.cb[("used", frm)] += amt
                if kind not in ("sehirler_arasi_denge", "baslangic_parasi"):
                    self.cb[("man", frm)] += amt        # istege bagli kalemler de yazilir; city_budget_step zorunlu = man - used
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
        if self.cb is not None and to in self.city_accounts and kind in CB_INCOME_KINDS and frm not in self.city_accounts:
            self.cb[("inc", to)] += amt
        if kind in INCOME_KINDS:
            self.income[to] += amt
        if self.srev is not None:
            if kind in REV_KINDS:
                self.srev[to] += amt
            if kind in HIRE_NET_KINDS and frm in self.sfirms:
                self.sexp[frm] += amt
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

    def cb_remaining(self, acct):
        """M11.2 (4): sehrin bu haftaki kalan istege bagli butcesi (CITY_BUDGET_RULE kapaliyken ya da butce henuz hesaplanmadiysa inf). SAF okuma."""
        if self.cb is None:
            return float("inf")
        return self.cb_budget.get(acct, float("inf")) - self.cb[("used", acct)]

    def city_spendable(self, frm, kind):
        """M11.2 (2): sehir hesabi frm'nin kind turu bir odemede GERCEKTE harcayabilecegi ust tutar: _city_limit'in yan etkisiz esi (pozitif kasa + tahvil odasi + basim izni payi). Tavan kapaliyken (cap_on False) sinirsiz (inf). SAF okuma."""
        if not self.cap_on:
            return float("inf")
        b = self.bal[frm]
        lim = max(0.0, b)
        if self.bond_hook and self.bond_room is not None and kind not in self.nobond:
            lim += self.bond_room(frm)
        if kind not in MINT_NOPRINT:
            a = self.allow[frm] * (1.0 if kind in MINT_PRIO else MINT_LOW_SHARE)
            lim += max(0.0, a - max(0.0, -b))
        return lim

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
    """Para korunumu: toplam bakiye == açılış stoku (devreden kazanç, M11; varsayılan 0) + basılan para (göreli tol). Davranışsız denetim; ihlalde AssertionError."""
    tot, mint, opn = L.total(), L.minted, getattr(L, "opening", 0.0)
    assert abs(tot - (mint + opn)) <= tol * max(1.0, abs(mint + opn)), f"para korunumu bozuldu: total={tot!r} minted={mint!r} opening={opn!r}"
