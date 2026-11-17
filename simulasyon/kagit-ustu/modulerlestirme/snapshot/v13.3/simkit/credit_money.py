"""simkit.credit_money: K-218 kredi para yaratır (CREDIT_MONEY): lonca kredisi yeni Akçe basar, geri ödeme yakar.

AMAÇ: kapalı para sisteminde toplam firma kârı ~0 kalıyordu (Kalecki özdeşliği); açık kaynak ABM'ler (Caiani ve ark. 2016, BAM Engine, BeforeIT) kredi=mevduat yaratımıyla çalışır.
  Mekanizma (bayrak açıkken; kapalıyken World.cm = None ve hiçbir yol değişmez):
  * Basım: lonca havuzu `{lo}_sermaye` bir kredi öderken (kind kredi_verilen / ipotek_kredisi) önce havuzun karşılık üstü nakdi kullanılır, kalan yeni Akçe olarak basılır
    (Ledger.pay -> cm.mint). Basılan tutar loncanın `live` (canlı basılmış anapara) kaydına yazılır.
  * Yakım: anapara geri ödemesi/tasfiye geliri havuza girince (kind kredi_geri / kredi_tasfiye / ipotek_geri / ipotek_kapama) tutarın basılmış payı kadarı yakılır
    (pay = live / loncanın toplam kredisi; havuz kredisi tek portföy). Faiz yakılmaz (loncanın geliri).
  * Temerrüt: canlı basılmış anapara kredi stokunu aşarsa fazlası `lost`a geçer (para dolaşımda kalır, lonca özsermayesi düşer; kurtarma yok).
  * Sınır: özsermaye_etkin = nakit + krediler + tahviller - mevduat - live - lost; toplam kredi <= LEV_K x özsermaye_etkin (kaldıraç).
  * Fren: son CM_BRAKE_SPAN haftada toplam para stoku yıllıklandırılmış CM_BRAKE'i aşarsa yeni basım durur (havuz nakdiyle kredi sürer; eski kural).
  * Rasyonlama (Caiani): pd_ok: PD = 1/(1+exp(OCF/borç servisi - CM_PD_SIGMA)); beklenen getiri < 0 ise ret (PD > i/(i+LGD), i çeyreklik faiz).
ARAYÜZ: CreditMoney(W): mint, burn, lendable, begin_week, end_week, pd_ok, credit, eq_eff; MINT_KINDS, BURN_KINDS.
OKUR: W (L, loans, mortgages, dep_tot, bonds, loncas, closed, prof_ema). YAZAR: yalnız kendi kayıtları (live, lost, sayaçlar); para değişimini Ledger yapar.
KATMAN: L1 (yalnız params'a bağlı; credit_core bunu içe aktarır).
"""
import math
from collections import defaultdict

from simkit.params import *          # noqa: F401,F403

MINT_KINDS = frozenset(("kredi_verilen", "ipotek_kredisi"))
BURN_KINDS = frozenset(("kredi_geri", "kredi_tasfiye", "ipotek_geri", "ipotek_kapama"))


class CreditMoney:
    def __init__(self, W):
        self.W = W
        self.loncas = set(W.loncas)
        self.mint_kinds = MINT_KINDS
        self.burn_kinds = BURN_KINDS
        self.live = defaultdict(float)          # lonca -> canlı kredideki basılmış anapara
        self.lost = defaultdict(float)          # lonca -> temerrütle kaybolan basılmış anapara (para dolaşımda, özsermayeden düştü)
        self.hist = {}                          # hafta -> hafta başı toplam para
        self.paused = False
        self.growth = 0.0
        self.wk = defaultdict(float)            # haftalık sayaçlar (end_week sıfırlar)
        self.cum = defaultdict(float)           # kümülatif sayaçlar

    # ------------------------------------------------------------ kredi ve özsermaye
    def credit(self, lo):
        W = self.W
        c = 0.0
        for ln in W.loans.values():
            if ln["lo"] == lo:
                c += ln["out"]
        for m in W.mortgages:
            if m["lo"] == lo:
                c += m["out"]
        return c

    def eq_eff(self, lo, C=None):
        W = self.W
        if C is None:
            C = self.credit(lo)
        return W.L.bal[f"{lo}_sermaye"] + C + sum(b["out"] for b in W.bonds if b["lo"] == lo) - W.dep_tot[lo] - self.live[lo] - self.lost[lo]

    def sync(self, lo, C):
        """canlı basılmış anapara kredi stokunu aşamaz: fazlası temerrütle kaybolmuştur (para dolaşımda kalır)."""
        if self.live[lo] > C:
            self.lost[lo] += self.live[lo] - C
            self.live[lo] = C

    def room(self, lo, C=None):
        if C is None:
            C = self.credit(lo)
        return max(0.0, LEV_K * max(0.0, self.eq_eff(lo, C)) - C)

    def lendable(self, lo, base):
        """credit_core.lendable köprüsü: fren yokken kaldıraç alanı (nakit sınırı yok: eksik basılır); fren varken eski kural (nakit) ve kaldıraç."""
        r = self.room(lo)
        return min(base, r) if self.paused else r

    # ------------------------------------------------------------ Ledger kancaları
    def mint(self, frm, amt):
        """Ledger.pay kredi öderken çağırır: havuzun karşılık üstü nakdi yetmeyen kısmı için basılacak tutarı döndürür (Ledger bakiyeyi yazar)."""
        lo = frm[:-8]
        if self.paused or lo not in self.loncas:
            return 0.0
        W = self.W
        L = W.L
        res = CM_RESERVE * W.dep_tot[lo]
        avail = max(0.0, L.bal[frm] - res)
        short = amt - avail
        if short <= 1e-9:
            return 0.0
        C = self.credit(lo)
        self.sync(lo, C)
        room = max(0.0, LEV_K * max(0.0, self.eq_eff(lo, C)) - C)
        m = min(short, max(0.0, room - avail))
        if m <= 1e-9:
            self.wk["tavan_ret"] += 1
            return 0.0
        self.live[lo] += m
        self.wk["basim"] += m
        self.wk["basim_adet"] += 1
        return m

    def burn(self, to, amt, kind):
        """Ledger.pay anapara havuza girdikten sonra çağırır: yakılacak tutarı döndürür (Ledger bakiyeyi düşer)."""
        lo = to[:-8]
        if lo not in self.loncas or self.live[lo] <= 1e-12:
            return 0.0
        C = self.credit(lo) + (amt if kind == "kredi_tasfiye" else 0.0)      # tasfiyede kredi kaydı çoğu yolda ödemeden ÖNCE silinir: tutarı geri ekle (eksik yakım yönünde sapma)
        self.sync(lo, C)
        if self.live[lo] <= 1e-12 or C <= 1e-9:
            return 0.0
        b = min(amt, amt * self.live[lo] / C, self.live[lo])
        self.live[lo] -= b
        self.wk["yakim"] += b
        return b

    # ------------------------------------------------------------ hafta kancaları
    def begin_week(self, w):
        W = self.W
        L = W.L
        tot = L.total()
        self.hist[w] = tot
        w0 = max(w - CM_BRAKE_SPAN, MINT_OPEN_WEEKS)
        span = w - w0
        if span >= CM_BRAKE_MIN and self.hist.get(w0, 0.0) > 0:
            self.growth = (tot / self.hist[w0]) ** (52.0 / span) - 1.0
        else:
            self.growth = 0.0
        self.paused = self.growth > CM_BRAKE
        if self.paused:
            self.cum["fren_hafta"] += 1
        for lo in self.loncas:
            if self.live[lo] > 0:
                self.sync(lo, self.credit(lo))

    def pd_ok(self, f, amt, rate, coll=0.0):
        """Caiani kredi rasyonlaması: beklenen getiri < 0 ise reddet. OCF = sönümlü net kâr + ödenen faiz; borç servisi = faiz + vade taksiti (yeni toplam borç üzerinden)."""
        W = self.W
        ln = W.loans.get(f)
        out = ln["out"] if ln else 0.0
        term = ln.get("term", LOAN_TERM) if ln else LOAN_TERM
        tot = out + amt
        ds = tot * (rate + 1.0 / term)
        ocf = W.prof_ema.get(f, 0.0) + rate * out
        x = ocf / max(1e-9, ds)
        e = x - CM_PD_SIGMA
        pd = 0.0 if e > 700 else 1.0 / (1.0 + math.exp(e))
        i_q = CM_QWEEKS * rate
        lgd = CM_LGD * (1.0 - min(1.0, 0.8 * coll / max(1e-9, tot))) if coll > 0 else CM_LGD
        pd_max = i_q / (i_q + lgd)
        self.wk["pd_sorgu"] += 1
        if CM_CSV:                              # kalibrasyon ölçümü: OCF/borç servisi örnekleri (davranışsız)
            with open(CM_CSV + ".x", "a") as fh:
                fh.write(f"{W.w},{x:.4f},{amt:.1f},{rate:.5f},{coll:.0f}\n")
        if CM_PD and pd > pd_max:
            self.wk["pd_ret"] += 1
            return False
        return True

    def end_week(self, w):
        """haftalık kayıt (CM_CSV açıksa CSV satırı); sayaçları kümülatife ekler ve sıfırlar."""
        W = self.W
        L = W.L
        for k, v in self.wk.items():
            self.cum[k] += v
        if CM_CSV:
            loans = W.loans
            out_l = sum(l["out"] for l in loans.values())
            out_m = sum(m["out"] for m in W.mortgages)
            eq = sum(max(0.0, self.eq_eff(lo)) for lo in self.loncas if lo not in W.closed)
            kar = sum(v for f, v in W.prof_ema.items() if f in W.firms and not W.firms[f].get("dead") and W.firms[f]["workers"])
            kar_pos = sum(max(0.0, v) for f, v in W.prof_ema.items() if f in W.firms and not W.firms[f].get("dead") and W.firms[f]["workers"])
            kd = nf = npos = 0
            if L.fexp is not None:               # gelir-gider defteri (PRICE_V2): haftalık firma kârı = satış geliri - tüm giderler (faiz, vergi, kira, ücret, capex dahil)
                kd_f = {f: L.frev.get(f, 0.0) - sum(L.fexp[f].values()) for f in list(L.fexp)}
                kd = sum(kd_f.values())
                nf = len(kd_f)
                npos = sum(1 for v in kd_f.values() if v > 0)
            row = dict(hafta=w, kar_defter=kd, firma_adet=nf, firma_kar_pozitif_adet=npos, para_toplam=L.total(), para_buyume=self.growth, fren=int(self.paused), basim_kum=L.cm_mint, yakim_kum=L.cm_burn,
                       mali_basim_kum=L.fiscal_minted, basim_h=self.wk["basim"], yakim_h=self.wk["yakim"], kredi_firma=out_l, kredi_ipotek=out_m,
                       canli_basilmis=sum(self.live.values()), kayip_basilmis=sum(self.lost.values()), ozsermaye=eq,
                       kaldirac=(out_l + out_m) / max(1.0, eq), temerrut_kayip_kum=L.flows["temerrut_kayip_akce"] + L.flows["batis_kayip_akce"],
                       temerrut_adet_kum=L.flows["temerrut_adet"], pd_sorgu=self.wk["pd_sorgu"], pd_ret=self.wk["pd_ret"], tavan_ret=self.wk["tavan_ret"],
                       firma_kar_toplam=kar, firma_kar_pozitif=kar_pos)
            first = not getattr(self, "_hdr", False)
            with open(CM_CSV, "a") as fh:
                if first:
                    fh.write(",".join(row) + "\n")
                    self._hdr = True
                fh.write(",".join(f"{v:.6g}" if isinstance(v, float) else str(v) for v in row.values()) + "\n")
        self.wk.clear()
