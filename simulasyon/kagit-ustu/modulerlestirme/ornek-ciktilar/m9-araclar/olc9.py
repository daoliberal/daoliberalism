#!/usr/bin/env python3
"""M9.0 salt-okur olcum kaydedici. Modele YAZMAZ: her hafta h.step() sonrasi W'yi okur, satirlari bellekte biriktirir, kosu sonunda diske yazar.
Dosyalar (<ad> = kos_m9 adi):
  <ad>_para.csv     haftalik para dagilimi: ust %10 oyuncu / alt %90 oyuncu (nakit+mevduat), oyuncu_nakit (yalniz nakit; te-denge hane cebi), NPC hane (nakit+mevduat), NPC/oyuncu/kamu firma kasasi, lonca (sermaye/refah/rezerv/diger),
                    sehir kasasi, devlet/lonca mevduat havuzu (deposits toplami), sehir tahvili (acik), kredi acik, toplam; oyuncu sayisi
  <ad>_tuk.csv      hane tuketimi (W.gate tuk_*; yalniz oyuncu haneleri; ise/issiz ayri): hafta basina kumulatif toplamlar (n=kisi-hafta, shelf=sepet bedeli, cash, aff=karsilama orani toplami)
  <ad>_sektor.csv   haftalik urun: istek (talep), karsilanmayan, uretim, stok, kapsama (hafta), firma sayisi (tum/saglikli), kadrolu (iscisi olan canli firma sayisi; te-denge G6) -- W.board['prod'];  hucre (sehir x urun) her 13 hf: <ad>_hucre.csv
  <ad>_isgucu.csv   haftalik sehir: is arayan (pool), isgucu disi (out), bos kadro (staff_tgt - kadro, canli firmalar), kadro hedefi; isgucu_disina_cikis_kum (= out + donen kumulatif; modelde dogrudan sayac yok)
  <ad>_batis.csv    batan her firmanin (NPC ve oyuncu) olum haftasina kadar son 12 haftalik serisi: kadro, kasa, kredi, kar, satilmayan orani, stok, borc, nedeni
"""
import csv
import sys
from collections import defaultdict, deque

SERI = 12


def _tipi(d):
    if d.get("owner") is not None or d.get("org_owner"):
        return "oyuncu"
    if d["kind"] in ("belediye", "ahir"):
        return "kamu"
    return "npc"


class Olc:
    def __init__(self, prod_of=None):
        self.prod_of = prod_of or {}
        self.para, self.tuk, self.sek, self.hucre, self.isg, self.bat = [], [], [], [], [], []
        self.ser = {}            # firma -> deque son 12 hafta
        self.olu = set()
        self.ucr = defaultdict(int)   # M11: (hafta, kim, alan) -> sayi; ucret odenemedi cikislari (tenure ayrimli)
        self.ev = []             # haftanin ucret-odenemedi olaylari (f, q, saha, kim)
        self.gor = {}            # q -> (firma, katilim haftasi) (hafta sonu goruntusu)
        self.cur = 0
        self.pz = []             # M11.2 paket: hafta, calisan NPC, is arayan oyuncu, havuz, parasiz havuz (nakit < NPC_MIN_BAL), hane tuketimi
        self.akis = []           # her 26 hf: L.flows kumulatif (tur -> tutar); sehir kasasi gelir/gider ayristirmasi icin

    def kur(self, W):
        """M11 (davranissiz): L.pay'i sarar; ucret odenemedi (K-23) noktalari phase_cycle_open (avans = ise alinma haftasinin ilk ucreti) ve phase_cycle_pay'dir.
        Cagiran cerceve adiyla ayirt edilir; odeme sonucu degismez."""
        L = W.L
        orig = L.pay
        ev, people = self.ev, W.people
        ucret = {"ucret", "yonetici_ucreti", "uzman_ucreti", "arastirmaci_ucreti"}

        def pay(frm, to, amt, kind):
            r = orig(frm, to, amt, kind)
            if kind in ucret and r < amt - 1e-9 and to in people:
                nm = sys._getframe(1).f_code.co_name
                if nm in ("phase_cycle_open", "phase_cycle_pay"):
                    ev.append((frm, to, "A" if nm == "phase_cycle_open" else "B", people[to]["who"]))
            return r
        L.pay = pay

    def _ucret(self, W, w):
        gor = self.gor
        # olaylar: tenure = w - katilim haftasi (onceki hafta sonunda ayni firmada gorulduyse), gorulmediyse 0 (ise alindigi hafta)
        for f, q, saha, kim in self.ev:
            g = gor.get(q)
            ten = (w - g[1]) if (g and g[0] == f) else 0
            if saha == "A":
                ten = 0
            k = "t0" if ten <= 0 else ("t1" if ten == 1 else "t2p")
            self.ucr[(w, kim, k)] += 1
            self.ucr[(w, kim, "A" if saha == "A" else "B")] += 1
            if not (g and g[0] == f) or saha == "A":
                self.ucr[(w, kim, "gizli_ise_alim")] += 1       # gorunmeyen ise alim (haftanin icinde ise alinip ayni hafta cikarilan)
        self.ev.clear()
        yeni = {}
        for f, d in W.firms.items():
            if d.get("dead"):
                continue
            for q in d["workers"]:
                g = gor.get(q)
                if g and g[0] == f:
                    yeni[q] = g
                else:
                    yeni[q] = (f, w)
                    self.ucr[(w, W.people[q]["who"], "katilim")] += 1
        self.gor = yeni

    def _pz(self, W, w):
        P = self.P
        people, L = W.people, W.L
        pool = [q for c in W.cities for q in c["pool"]]
        self.pz.append(dict(hafta=w, calisan_npc=sum(1 for i in people.values() if i["who"] == "npc" and i["firm"] is not None),
                            is_arayan_oyuncu=sum(len(c["seekers"]) for c in W.cities), havuz=len(pool),
                            parasiz_havuz=sum(1 for q in pool if L.bal[q] < P.NPC_MIN_BAL), hane_tuketimi=W.series.get("cons", 0.0),
                            sehir_kasasi=sum(L.bal[c["acct"]] for c in W.cities)))

    def hafta(self, W, w):
        self._ucret(W, w)
        self._pz(W, w)
        self._para(W, w)
        self._tuk(W, w)
        self._sektor(W, w)
        self._isgucu(W, w)
        self._batis(W, w)
        try:
            if w % 26 == 0:
                self.akis.append(dict({'hafta': w}, **{k: round(v, 2) for k, v in W.L.flows.items()}))
        except Exception:
            pass

    # -- para ---------------------------------------------------------------
    def _para(self, W, w):
        L, people, firms, dep = W.L, W.people, W.firms, W.deposits
        oy = []
        npc_hane = npc_mev = oy_nakit = 0.0
        for q, i in people.items():
            v = L.bal[q] + (dep[q][1] if q in dep else 0.0)
            if i["who"] == "oyuncu":
                oy.append(v)
                oy_nakit += L.bal[q]
            elif i["who"] == "npc":
                npc_hane += L.bal[q]
                npc_mev += dep[q][1] if q in dep else 0.0
        oy.sort()
        n = len(oy)
        k = int(n * 0.9)
        alt, ust = sum(oy[:k]), sum(oy[k:])
        cacc = {c["acct"] for c in W.cities}
        r = defaultdict(float)
        for a, v in L.bal.items():
            if a in people:
                continue
            if a in firms:
                r["firma_" + _tipi(firms[a])] += v
            elif a in cacc:
                r["sehir_kasa"] += v
            else:
                sf = a.rsplit("_", 1)[-1]
                if sf in ("sermaye", "refah", "rezerv"):
                    r["lonca_" + sf] += v
                elif a.split("_")[0] in W.loncas:
                    r["lonca_diger"] += v
                else:
                    r["diger"] += v
        mev_tum = sum(x[1] for x in dep.values())
        satir = dict(hafta=w, oyuncu_n=n, oyuncu_nakit=round(oy_nakit), ust10_oyuncu=round(ust), alt90_oyuncu=round(alt), npc_hane_nakit=round(npc_hane), npc_hane_mevduat=round(npc_mev),
                     mevduat_tum=round(mev_tum), tahvil_acik=round(sum(b["out"] for b in W.bonds)), kredi_acik=round(sum(l["out"] for l in W.loans.values())), toplam=round(L.total()))
        for kk in ("firma_npc", "firma_oyuncu", "firma_kamu", "sehir_kasa", "lonca_sermaye", "lonca_refah", "lonca_rezerv", "lonca_diger", "diger"):
            satir[kk] = round(r[kk])
        self.para.append(satir)

    # -- hane tuketimi ------------------------------------------------------
    def _tuk(self, W, w):
        tp = defaultdict(float)
        for (g, kk), v in W.gate.items():
            if isinstance(kk, str) and kk.startswith("tuk_"):
                tp[kk] += v
        s = dict(hafta=w)
        for kk in sorted(tp):
            s[kk] = round(tp[kk], 3)
        self.tuk.append(s)

    # -- sektor -------------------------------------------------------------
    def _sektor(self, W, w):
        b = getattr(W, "board", None)
        if not b:
            return
        kad = defaultdict(int)       # te-denge G6: urun basina dunyada ISCISI olan canli firma sayisi (kabuklar sayilmaz)
        for e in W.firms.values():
            if not e.get("dead") and e["workers"] and e["kind"] in W.RECIPES:
                for u in W.RECIPES[e["kind"]][0]:                # tüm çıktıları (ahır: süt, deri, et)
                    kad[u] += 1
        for p, d in b["prod"].items():
            self.sek.append(dict(hafta=w, urun=p, istek=round(d["want"], 2), karsilanmayan=round(d["short"], 2), uretim=round(d["prod"], 2), stok=round(d["stock"], 2),
                                 kapsama_hf=round(d["cover"], 3), firma=d["n_all"], saglikli=d["n_h"], fiyat_endeksi=round(d["pidx"], 4), kadrolu=kad.get(p, 0)))
        if w % 13 == 0:
            for (ci, p), c in b["cells"].items():
                self.hucre.append(dict(hafta=w, sehir=ci, urun=p, talep=round(c["dem"], 2), uretim=round(c["prod"], 2), stok=round(c["stock"], 2), firma=c["n_prod"], saglikli=c["n_healthy"]))

    # -- isgucu -------------------------------------------------------------
    def _isgucu(self, W, w):
        st = getattr(W, "hire_stat", None) or {}
        donen = st.get("isgucune_donen", 0.0) if hasattr(st, "get") else 0.0
        stg = getattr(W, "staff_tgt", {})
        bos = defaultdict(int)
        tgt = defaultdict(int)
        for f, d in W.firms.items():
            if d.get("dead") or f not in stg:
                continue
            tgt[d["city"]] += stg[f]
            bos[d["city"]] += max(0, stg[f] - len(d["workers"]))
        for c in W.cities:
            ci = c["i"]
            out = len(c.get("out", []))
            self.isg.append(dict(hafta=w, sehir=ci, is_arayan=len(c["pool"]), isgucu_disi=out, bos_kadro=bos[ci], kadro_hedefi=tgt[ci], isgucune_donen_kum=int(donen), isgucu_disina_cikis_kum=int(sum(len(c2.get("out", [])) for c2 in W.cities) + donen)))

    # -- batis serisi ---------------------------------------------------------
    def _batis(self, W, w):
        firms, loans, L = W.firms, W.loans, W.L
        for f, d in firms.items():
            if f in self.olu:
                continue
            dq = self.ser.setdefault(f, deque(maxlen=SERI))
            unsold = d.get("unsold_acc", 0.0) / max(1e-9, d.get("prod_acc", 0.0))
            ln = loans.get(f)
            dq.append(dict(hafta=w, kadro=len(d["workers"]), kasa=round(L.bal[f]), kredi=round(ln["out"]) if ln else 0, kredi_gecikme=ln["miss"] if ln else 0,
                           kar=round(d.get("prof", 0.0)), satilmayan=round(unsold, 3), stok=round(sum(v for v in d.get("stock", {}).values() if v > 0), 2)))
            if d.get("dead") and d["kind"] not in ("belediye", "ahir"):
                self.olu.add(f)
                for i, s in enumerate(dq):
                    self.bat.append(dict(firma=f, tur=d["kind"], urun=self.prod_of.get(d["kind"], ""), sahip=_tipi(d), sehir=d["city"], dogum=d.get("born"), olum_hf=w, nedeni=str(d.get("dead")), insolv=d.get("insolv", 0),
                                         ofset=s["hafta"] - w, **{k: v for k, v in s.items() if k != "hafta"}))
                del self.ser[f]

    def yaz(self, base, _unused=None):
        def csv_yaz(yol, satirlar):
            if not satirlar:
                open(yol, "w").close()
                return
            ad = []
            for r in satirlar:
                for k in r:
                    if k not in ad:
                        ad.append(k)
            with open(yol, "w", newline="") as fh:
                wr = csv.DictWriter(fh, fieldnames=ad, restval="")
                wr.writeheader()
                wr.writerows(satirlar)
        csv_yaz(base + "_para.csv", self.para)
        csv_yaz(base + "_tuk.csv", self.tuk)
        csv_yaz(base + "_sektor.csv", self.sek)
        csv_yaz(base + "_hucre.csv", self.hucre)
        csv_yaz(base + "_isgucu.csv", self.isg)
        csv_yaz(base + "_batis.csv", self.bat)
        csv_yaz(base + "_akis.csv", self.akis)
        satir = defaultdict(dict)
        for (w, kim, k), v in self.ucr.items():
            satir[(w, kim)][k] = v
        csv_yaz(base + "_pz.csv", self.pz)
        csv_yaz(base + "_ucret.csv", [dict(hafta=w, kim=kim, **v) for (w, kim), v in sorted(satir.items())])
