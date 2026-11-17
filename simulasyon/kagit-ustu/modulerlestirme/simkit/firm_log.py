"""simkit.firm_log: firma yaşam kaydı ve sektör tablosu (para devresi planı Görev 2; DAVRANIŞSIZ ÖLÇÜM, yalnız FIRM_LIFE_LOG=1 iken çağrılır).

AMAÇ: hangi tür ve sahip tipi para yakıyor, firma neden battı. Ölüm yollarına kanca konmaz: doğum, ölüm ve devir hafta sonunda DURUM FARKINDAN çıkarılır
  (geçen hafta canlı olmayan canlı firma = doğum; canlı olup `dead` olan ya da `firms`'ten düşen = ölüm; `owner`/`priv`/`org_owner` değişen = devir).
  Canlanan NPC (dead -> canlı) ikinci bir doğum satırı alır.
ARAYÜZ: olum_satiri (F4: firmanın son ölüm satırı, dizinden), _kullanilan_pay, _yetmedi_satis, _flog, _sahip_anahtar, _gider_kirilimi, _gelir_gider, _kredi_ayristir, _olum_satiri, _dok, _dok_yolu, _dokulen, _bos, temizle, son_satirlar, olumler, sahip_tipi, neden_kodu, fl_snap, fl_week, rows, sektor_topla, sektor_rows, write
OKUR: W.firms, W.L (bal, fexp, frev), W.loans, W.fwk_prod, W.fwk_uns, W.staff_tgt, W.human, W.week_no. YAZAR: yalnız W.flog (kendi kaydı); hiçbir karara girmez, L.pay çağırmaz, L.flows'a yazmaz.
KATMAN: L0 (yalnız params).

GELİR VE GİDER: fl_week hafta sonunda canlı `L.frev`/`L.fexp` okur (prices bunları ertesi haftanın başında siler). fl_snap silmeden hemen önce (prices.py) kopyalar ve
  geçen haftanın satırını kopyayla uzlaştırır (hafta sonu ile silme arasında yazılan kalem olursa kopya geçerli). `taksit_odenen` = faiz gideri + firmadan gerçekten çıkan kredi anaparası
  (`kredi_geri` firma gider defterine yazılmayan bir türdür; anapara `W.loans[f]["out"]` farkından okunur). Kredi kaydı ödenmeden silinirse (yeniden yapılandırma, temerrüt, borcu başkası ödüyor)
  tutar `kredi_silinen`e gider, taksit 0 kalır. Erken tam ödeme (NPC_LONCA_FUND süpürmesi) ödenmiş sayılır.
SEKTÖR SÜTUNLARI: gider = ücret + girdi + navlun + kira + faiz + lonca payı + vergi + diğer gider; faaliyet_net = ciro - gider; kredi_net = girişte net kredi nakdi (bakiye farkı);
  sahibe_ve_sehre_aktarim = net - faaliyet_net - kredi_net (KALAN: temettü, NPC kârının şehre aktarımı, tasfiye, sermaye ve gider defterine girmeyen kalemler; ayrı ölçülmez).
  net = hafta sonu kasa farkı; doğum haftasında ve ölüm haftasında (firma satır almaz) 0 sayılır, yani Σ net sektör kasasının değişimine eşit değildir.
BELLEK: haftalık satırlar her SPILL_HF (26) haftada bir sektör toplamına işlenir. Koşucu FIRM_LOG_DOK=<taban> ortam değişkeni verdiyse satırlar <taban>_yasam_haftalik.tmp dosyasına dökülüp bellekten atılır (W'de dosya nesnesi tutulmaz; deepcopy güvenli);
  yol yoksa (sunucu) son PENCERE_HF (60) hafta bellekte kalır, eski haftalık satırlar atılır (sektör toplamı, doğum, ölüm, devir korunur) ve geçici dosya açılmaz.
  Pano için ucuz erişim: son_satirlar(W, firma, n) ve olum_satiri(W, firma) (firma başına dizin), olumler(W). Ölüm satırı alanları: neden (öncelik kuralıyla tek kod), yakin_neden (kasa olayı: ucret_odenemedi, kredi_odenemedi, ...; olum_neden atlanır), kok_neden (olum_neden: marj, talep, girdi, teknoloji_geride; yoksa boş).
SAHİP TİPİ: npc, kamu (ahır, belediye), bot, insan (HUMAN_ON ve sahip == W.human), dao (arge ya da org_owner DAO'su). Lonca özelleştirmesi (priv.tip != oyuncu) ve lonca medyası npc kalır.
"""
import csv
import json
import os
from collections import deque
from simkit.params import *          # noqa: F401,F403

_UCRET = ("ucret", "yonetici_ucreti", "uzman_ucreti", "arastirmaci_ucreti")
_GIRDI = ("satis_yerli", "satis_sehirlerarasi")
_GIDER_ALAN = ("ucret", "girdi", "navlun", "kira", "faiz", "lonca_payi", "vergi", "diger_gider")
_SEKTOR_ALAN = ("hafta", "tur", "sahip_tipi", "firma_sayisi", "isci", "kasa", "ciro", "ucret", "gider", "faaliyet_net", "kredi_net", "sahibe_ve_sehre_aktarim", "net", "dogum", "olum")
PENCERE_HF = 60                                                        # dosya yolu verilmediyse (sunucu) bellekte tutulan haftalık satır penceresi; doğum, ölüm ve devir satırları sınırsız
SON_N = 60                                                             # firma başına son_satirlar dizininin uzunluğu
SPILL_HF = 26                                                          # bellek: haftalık satırlar bu aralıkla geçici dosyaya dökülür (520 hf koşuda RAM'de en çok ~26 hf kalır)

NEDEN = ("sahip_cikisi", "sahip_ayrildi", "kredi_odenemedi", "zombi", "girdi", "talep", "marj", "teknoloji_geride", "ucret_odenemedi", "odeme_gucu", "ozellestirme_alici_yok", "dao_bitti", "diger")


def _flog(W):
    st = W.__dict__.get("flog")
    if st is None:
        st = W.flog = dict(hafta=None, hafta_no=0, satir=[], dogum=[], olum=[], devir=[], onceki={}, uzlasma_fark=0, spill_yol=None, acc={}, acc_hf=0, idx={}, olum_idx={})
    return st


def sahip_tipi(W, d):
    """npc, kamu, bot, insan ya da dao."""
    k = d["kind"]
    if k in ("ahir", "belediye"):
        return "kamu"
    if k == "arge":
        return "dao"
    o = d.get("owner")
    if o is None:
        pv = d.get("priv")
        if pv and pv.get("tip") == "oyuncu":
            o = pv.get("who")
    if o is None:
        og = d.get("org_owner")
        return "dao" if (og and og[0] == "dao") else "npc"
    return "insan" if (HUMAN_ON and o == getattr(W, "human", None)) else "bot"


def _sahip_anahtar(d):
    pv = d.get("priv")
    return (d.get("owner"), (pv.get("tip"), pv.get("who")) if pv else None, tuple(d["org_owner"]) if d.get("org_owner") else None)


def neden_kodu(d, dao=False, ucret_son=0.0, isci_son=0, zmb_onceki=0, defaulted_onceki=False, priv_onceki=False, yakin=False, kasa_yetersiz=False):
    """ölüm nedeni, tek kod; öncelik: sahip_ayrildi, kredi_odenemedi, zombi, (sahipli) olum_neden, (sahipli) ucret_odenemedi, (sahipsiz) odeme_gucu, ozellestirme_alici_yok, dao_bitti, diger.
    d: hafta sonundaki firma sözlüğü. `defaulted` hiç silinmez: yalnız bu hafta yeni konan işarete bakılır (defaulted_onceki: geçen hafta sonunda zaten vardı -> bayat, yok sayılır).
    zmb_onceki: REVIVE_HYGIENE ölümde `zmb`'yi sıfırladığı için geçen haftanın sayacı. priv_onceki: geçen hafta özelleştirme ihalesindeydi (alıcı çıkmayınca tasfiye, firm_exit priv_step).
    yakin=True: `olum_neden` (kök neden) atlanır; kasa olayı (yakın neden) döner: sahip_ayrildi, kredi_odenemedi, zombi, ucret_odenemedi, ...; hiçbiri değilse "diger".
    kasa_yetersiz (yalnız yakin=True): son canlı hafta sonunda kasa o haftanın ücret giderinden azdı -> ücret ödenemedi sayılır (ölüm haftasında ücret defteri çoğu zaman sıfır olmaz: çıkan işçiden önceki ödemeler yazılmıştır). `neden` bundan etkilenmez."""
    if d.get("ox_cikis") is not None:
        return "sahip_cikisi"                                          # REKABET G17h (OWNER_EXIT): ekonomik zarar nedeniyle sahibin kendi kararı
    if d.get("kapaniyor"):
        return "sahip_ayrildi"
    if d.get("defaulted") and not defaulted_onceki:
        return "kredi_odenemedi"
    z = d.get("zmb", 0)
    if z >= ZB_WEEKS or (z == 0 and zmb_onceki + 1 >= ZB_WEEKS and d.get("owner") is None and not dao):
        return "zombi"
    sahipli = d.get("owner") is not None and not dao
    if sahipli and d.get("olum_neden") and not yakin:
        return d["olum_neden"]
    if sahipli and ((ucret_son <= 0.0 and isci_son > 0) or (yakin and kasa_yetersiz)):
        return "ucret_odenemedi"
    if d.get("owner") is None and not dao and d.get("insolv", 0) >= NPC_DIE_WEEKS:
        return "odeme_gucu"
    if d.get("owner") is None and not dao and priv_onceki:
        return "ozellestirme_alici_yok"
    if dao:
        return "dao_bitti"
    return "diger"


def _gider_kirilimi(ex):
    """fexp[f] -> (ucret, girdi, navlun, kira, faiz, lonca_payi, vergi, diger_gider)."""
    if not ex:
        return 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    u = sum(ex.get(k, 0.0) for k in _UCRET)
    g = sum(ex.get(k, 0.0) for k in _GIRDI)
    nv, ki, fa, lf, vg = (ex.get(k, 0.0) for k in ("navlun", "kira", "faiz", "lonca_fee", "satis_vergisi"))
    tum = sum(ex.values())
    return u, g, nv, ki, fa, lf, vg, tum - (u + g + nv + ki + fa + lf + vg)


def _gelir_gider(L, f):
    ex = L.fexp.get(f) if L.fexp is not None else None
    rv = L.frev.get(f, 0.0) if L.frev is not None else 0.0
    return rv, ex


def _kredi_ayristir(o, ln, f):
    """geçen haftanın kredi durumu `o` ile bu haftanınki `ln` -> (kredi_geri, kredi_silinen, kredi_net).
    kredi_geri: firmadan gerçekten çıkan anapara (aynı kredinin bakiye düşüşü ya da ödenerek biten kredinin son bakiyesi).
    kredi_silinen: kayıt ödenmeden silindi (yeniden yapılandırma, temerrüt: DEF_MISS'e son hafta ya da borcu başkası ödüyor); firmadan para çıkmadı, taksit sayılmaz.
    kredi_net: firmaya giren net kredi nakdi (bakiye farkı; silinmede 0)."""
    if o is None or not o["canli"]:
        return 0.0, 0.0, 0.0
    out0 = o["kredi_out"]
    out1 = ln["out"] if ln else 0.0
    if ln is None:
        if out0 <= 0.0:
            return 0.0, 0.0, 0.0
        if o["kredi_payer_baska"] or o["kredi_miss"] + 1 >= DEF_MISS:
            return 0.0, out0, 0.0
        return out0, 0.0, -out0
    kg = max(0.0, out0 - out1) if ln["p0"] == o["kredi_p0"] else 0.0
    return kg, 0.0, out1 - out0


def fl_snap(W):
    """prices: L.frev/L.fexp silinmeden hemen önce çağrılır. Firma başına geçen haftanın gelir ve gider kırılımını W.flog["hafta"]'ya kopyalar, geçen haftanın satırını kopyayla uzlaştırır."""
    L = W.L
    st = _flog(W)
    if L.fexp is None:
        st["hafta"] = {}
        return
    snap = {}
    for f in set(L.fexp) | set(L.frev):
        snap[f] = (L.frev.get(f, 0.0), dict(L.fexp.get(f) or {}))
    st["hafta"] = snap
    st["hafta_no"] = W.week_no - 1
    for r in reversed(st["satir"]):
        if r["hafta"] < st["hafta_no"]:
            break
        if r["hafta"] == st["hafta_no"] and r["firma"] in snap:
            rv, ex = snap[r["firma"]]
            if abs(rv - r["ciro"]) > 1e-9 or abs(sum(ex.values()) - r["gider"]) > 1e-9:
                st["uzlasma_fark"] += 1
                r["ciro"] = rv
                r.update(zip(_GIDER_ALAN, _gider_kirilimi(ex)))
                r["gider"] = sum(ex.values())
                r["taksit_odenen"] = r["faiz"] + r["kredi_geri"]


def _olum_satiri(st, w, f, o, d, ex, L, priv_q, yeni_temerrut=False):
    """yeni_temerrut: kredi kaydı bu hafta silindi (f loans'ta yok); o["kredi_miss"]+1 >= DEF_MISS ve borcu firma ödüyorsa bu hafta konan `defaulted` yenidir (canlanan NPC'nin ikinci temerrüdü)."""
    yeni = yeni_temerrut and o["kredi_out"] > 0.0 and o["kredi_miss"] + 1 >= DEF_MISS and not o["kredi_payer_baska"]
    u_son = _gider_kirilimi(ex)[0]
    h = list(o["hist"])
    son8 = h[-8:]
    st["olum_idx"][f] = satir = dict(satir="olum", hafta=w, firma=f, tur=o["tur"], sehir=o["sehir"], sahip_tipi=o["tip"], yas=w - o["dogum_hf"],
                           neden=neden_kodu(d, dao=(o["tip"] == "dao"), ucret_son=u_son, isci_son=o["isci"], zmb_onceki=o["zmb"], defaulted_onceki=o["defaulted"] and not yeni, priv_onceki=o["priv_q"]),
                           yakin_neden=neden_kodu(d, dao=(o["tip"] == "dao"), ucret_son=u_son, isci_son=o["isci"], zmb_onceki=o["zmb"], defaulted_onceki=o["defaulted"] and not yeni, priv_onceki=o["priv_q"], yakin=True, kasa_yetersiz=bool(h) and h[-1][2] > 0.0 and h[-1][0] < h[-1][2]),
                           kok_neden=(d.get("olum_neden") or "") if (d.get("owner") is not None and o["tip"] != "dao") else "",
                           son8_kasa_farki=(h[-1][0] - h[0][0]) if len(h) > 1 else 0.0, son8_ciro=sum(x[1] for x in son8), son8_ucret=sum(x[2] for x in son8))
    st["olum"].append(satir)


def _yetmedi_satis(olaylar):
    """MKT_PRICE ölçümü (yalnız ölçüm): haftanın L.events satırlarından `YETMEDİ satis: hane → market ...` sayısı, market başına."""
    out = {}
    for e in olaylar:
        if e.startswith("YETMEDİ satis: "):
            to = e.split(" → ", 1)[1].split(" ", 1)[0]
            out[to] = out.get(to, 0) + 1
    return out


def _kullanilan_pay(W):
    """RETAIL_SHARE ölçümü: okuyucuların (sector_core.mk_weights) fiilen kullandığı pay = şehirde canlı marketler arasında 1'e bölünmüş ağırlık (rs_pay'de olmayan geçici (1 - RS_INERTIA) / n, toplam 0 ise eşit)."""
    pay = getattr(W, "rs_pay", {})
    sehir = {}
    for f, d in W.firms.items():
        if d["kind"] == "market" and not d.get("dead") and d["workers"]:
            sehir.setdefault(d.get("city"), []).append(f)
    out = {}
    for fl in sehir.values():
        w = [pay[f] if f in pay else (1.0 - RS_INERTIA) / len(fl) for f in fl]
        s = sum(w)
        for f, x in zip(fl, w):
            out[f] = (x / s) if s > 1e-12 else 1.0 / len(fl)
    return out


def fl_week(W):
    """week_close sonunda çağrılır: canlı her firma için haftalık satır, doğum, ölüm ve devir satırları."""
    L = W.L
    w = W.week_no
    st = _flog(W)
    firms = W.firms
    loans = W.loans
    priv_q = getattr(W, "priv_q", None) or {}
    fprod = getattr(W, "fwk_prod", None) or {}
    funs = getattr(W, "fwk_uns", None) or {}
    tgt = getattr(W, "staff_tgt", None)
    onc = st["onceki"]
    canli = {}
    kul_pay = _kullanilan_pay(W) if RETAIL_SHARE else {}
    yetmedi = _yetmedi_satis(L.events[W.ev0:])                          # te-rekabet G9 (yalnız ölçüm, her koşuda): markete düşen kırpılan ödeme sayısı, sepeti alamayan hane oranı
    yoksul = getattr(W, "yoksul_stat", {})
    for f, d in firms.items():
        if d.get("dead"):
            continue
        tip = sahip_tipi(W, d)
        rv, ex = _gelir_gider(L, f)
        u, g, nv, ki, fa, lf, vg, dg = _gider_kirilimi(ex)
        kasa = L.bal.get(f, 0.0)
        ln = loans.get(f)
        o = onc.get(f)
        pr = fprod.get(f, 0.0)
        kg, ksil, knet = _kredi_ayristir(o, ln, f)
        if o is None or not o["canli"]:
            yol = "acilis" if w == 1 else ("canlanma" if o is not None else "kurulus")
            st["dogum"].append(dict(satir="dogum", hafta=w, firma=f, tur=d["kind"], sehir=d.get("city"), sahip_tipi=tip, lonca=d.get("lonca"), kasa=kasa, yol=yol))
            dogum_hf = w
        else:
            dogum_hf = o["dogum_hf"]
            if o["sahip_anahtar"] != _sahip_anahtar(d):
                st["devir"].append(dict(satir="devir", hafta=w, firma=f, tur=d["kind"], eski_sahip_tipi=o["tip"], yeni_sahip_tipi=tip, eski_sahip=o["sahip_anahtar"][0], yeni_sahip=d.get("owner")))
        kasa_fark = (kasa - o["kasa"]) if (o is not None and o["canli"]) else 0.0
        yeni = o is None or not o["canli"]                                 # doğum satırı: kasa farkı tanımsız (0)
        sg = getattr(W, "fl_sermaye", None)
        sermaye_giris = sg.pop(f, 0.0) if sg else 0.0                        # insanın bu hafta eklediği sermaye (human.sermaye_ekle yazar)
        satir = dict(satir="hafta", hafta=w, firma=f, tur=d["kind"], sehir=d.get("city"), sahip_tipi=tip, lonca=d.get("lonca"), isci=len(d["workers"]), kasa=kasa, kasa_fark=kasa_fark, yeni=yeni, sermaye_giris=sermaye_giris,
                     ciro=rv, ucret=u, girdi=g, navlun=nv, kira=ki, faiz=fa, lonca_payi=lf, vergi=vg, diger_gider=dg, gider=u + g + nv + ki + fa + lf + vg + dg,
                     kredi=ln["out"] if ln else 0.0, kredi_gecikme=ln["miss"] if ln else 0, kredi_geri=kg, kredi_silinen=ksil, kredi_net=knet, taksit_odenen=fa + kg,
                     satilmayan_pay=(funs.get(f, 0.0) / pr) if pr > 1e-9 else 0.0, staff_tgt=(tgt.get(f) if tgt else None))
        if RETAIL_SHARE and d["kind"] == "market":                            # te-rekabet G8: pay, göreli fiyat, itibar (yalnız ölçüm)
            satir.update(pay=kul_pay.get(f, 0.0), pay_ham=getattr(W, "rs_pay", {}).get(f, 0.0), mmk=d.get("mmk", 1.0), itibar=W.orep.get(f, 50.0))
        if d["kind"] == "market":                                             # te-rekabet G9 (yalnız ölçüm, bayraktan bağımsız): kırpılan ödeme sayısı; şehirde bakiyesi tüm isteğe (istek_yetmeyen_hane) ve yalnız temel sepete (sepet_yetmeyen_hane) yetmeyen hane-döngü ve toplam hane-döngü (hane_yetmeyen, week_cycle_parts)
            ys_ = yoksul.get(d.get("city"), (0, 0, 0))
            satir.update(yetmedi_satis=yetmedi.get(f, 0), istek_yetmeyen_hane=ys_[0], hane=ys_[1], sepet_yetmeyen_hane=ys_[2])
        st["satir"].append(satir)
        st["idx"].setdefault(f, deque(maxlen=SON_N)).append(satir)
        hist = o["hist"] if (o is not None and o["canli"]) else deque(maxlen=9)
        hist.append((kasa, rv, u))
        canli[f] = dict(canli=True, tip=tip, tur=d["kind"], sehir=d.get("city"), lonca=d.get("lonca"), kasa=kasa, isci=satir["isci"], ucret=u, zmb=d.get("zmb", 0), dogum_hf=dogum_hf,
                        sahip_anahtar=_sahip_anahtar(d), kredi_out=ln["out"] if ln else 0.0, kredi_p0=ln["p0"] if ln else 0.0, kredi_miss=ln["miss"] if ln else 0,
                        kredi_payer_baska=bool(ln and ln.get("payer", f) != f), defaulted=bool(d.get("defaulted")), priv_q=f in priv_q,
                        isaret=dict(kapaniyor=d.get("kapaniyor"), olum_neden=d.get("olum_neden"), owner=d.get("owner"), insolv=d.get("insolv", 0)), hist=hist)
    for f, o in onc.items():
        if f in canli:
            continue
        if not o["canli"]:
            canli[f] = o                                                  # ölü kalmaya devam: canlanırsa ikinci doğum satırı
            continue
        d = firms.get(f) or dict(o["isaret"])                             # firms'ten düşen: son bilinen işaretler
        _, ex = _gelir_gider(L, f)
        _olum_satiri(st, w, f, o, d, ex, L, priv_q, yeni_temerrut=(f not in loans))
        canli[f] = dict(o, canli=False)
    for f, d in firms.items():                                            # aynı hafta doğup ölen firma: hiç canlı görülmedi, doğum ve ölüm satırı birlikte
        if f in canli or f in onc or not d.get("dead") or d.get("died") != w:
            continue
        tip = sahip_tipi(W, d)
        st["dogum"].append(dict(satir="dogum", hafta=w, firma=f, tur=d["kind"], sehir=d.get("city"), sahip_tipi=tip, lonca=d.get("lonca"), kasa=L.bal.get(f, 0.0), yol="kurulus"))
        o = dict(canli=True, tip=tip, tur=d["kind"], sehir=d.get("city"), isci=0, zmb=0, defaulted=False, priv_q=False, dogum_hf=w, hist=deque(maxlen=9))
        _, ex = _gelir_gider(L, f)
        _olum_satiri(st, w, f, o, d, ex, L, priv_q)
        canli[f] = dict(o, canli=False, isaret={})
    st["onceki"] = canli
    if SPILL_HF and w % SPILL_HF == 0:
        _dok(st, w)


def _dok_yolu(st):
    """geçici haftalık satır dosyası yolu: yalnız koşucu FIRM_LOG_DOK ortam değişkeniyle bir taban yolu verdiyse (denge_kos); yoksa None (sunucu: pencere modu). W'de dosya nesnesi tutulmaz."""
    if st["spill_yol"] is None:
        t = os.environ.get("FIRM_LOG_DOK")
        if t:
            st["spill_yol"] = t + "_yasam_haftalik.tmp"
    return st["spill_yol"]


def _dok(st, w):
    """w'dan eski (uzlaştırması bitmiş) haftalık satırları sektör toplamına işler. Dosya modu: geçici dosyaya döker (her seferinde aç-kapa) ve bellekten atar.
    Pencere modu (yol yok): bellekte son PENCERE_HF haftayı tutar, eskileri atar (sektör toplamı ve doğum/ölüm/devir satırları etkilenmez)."""
    yeni = [r for r in st["satir"] if st["acc_hf"] < r["hafta"] < w]
    if yeni:
        sektor_topla(yeni, acc=st["acc"])
        st["acc_hf"] = w - 1
    yol = _dok_yolu(st)
    if yol is not None:
        eski = [r for r in st["satir"] if r["hafta"] < w]
        if eski:
            with open(yol, "a", encoding="utf-8") as fh:
                for r in eski:
                    fh.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
            st["satir"] = [r for r in st["satir"] if r["hafta"] >= w]
    else:
        st["satir"] = [r for r in st["satir"] if r["hafta"] >= w - PENCERE_HF]


def _dokulen(st):
    """dosyaya dökülmüş haftalık satırlar (sırayla); dosya modu değilse boş."""
    yol = st["spill_yol"]
    if yol is None or not os.path.exists(yol):
        return
    with open(yol, encoding="utf-8") as fh:
        for ln in fh:
            yield json.loads(ln)


def temizle(W):
    """koşu sonunda (write'tan sonra) geçici haftalık satır dosyasını siler; sonrasında rows() dökülmüş satırları vermez."""
    st = _flog(W)
    if st["spill_yol"] and os.path.exists(st["spill_yol"]):
        os.remove(st["spill_yol"])


def son_satirlar(W, firma, n=8):
    """firmanın son n haftalık satırı (eskiden yeniye); firma başına dizinden okur, sıralama ve tarama yok (n <= SON_N)."""
    st = W.__dict__.get("flog")                                           # salt okur: kayıt kurulmadıysa kurmaz (pano erken haftada da çağırır)
    d = st["idx"].get(firma) if st is not None else None
    return list(d)[-n:] if d else []


def olum_satiri(W, firma):
    """firmanın EN SON ölüm satırı ya da None (canlanıp yeniden ölen firmada sonuncusu); firma başına dizinden okur, kayıt hiç kurulmadıysa kurmaz (salt okur)."""
    st = W.__dict__.get("flog")
    return None if st is None else st["olum_idx"].get(firma)


def olumler(W):
    """tüm ölüm satırları (kayıt sırasıyla, hafta artan); doğrudan liste, sıralama yok."""
    return list(_flog(W)["olum"])


_SIRA = ("dogum", "hafta", "devir", "olum")


def rows(W):
    """tüm kayıt satırları (alan `satir`: hafta, dogum, olum, devir), hafta sırasıyla (dökülmüş satırlar dahil)."""
    st = _flog(W)
    tum = list(_dokulen(st)) + st["satir"] + st["dogum"] + st["olum"] + st["devir"]
    return sorted(tum, key=lambda r: (r["hafta"], _SIRA.index(r["satir"])))


def _bos(r):
    return dict(hafta=r["hafta"], tur=r["tur"], sahip_tipi=r["sahip_tipi"], firma_sayisi=0, isci=0, kasa=0.0, ciro=0.0, ucret=0.0, gider=0.0, kredi_net=0.0, net=0.0, dogum=0, olum=0)


def sektor_topla(haftalik, dogum=(), olum=(), acc=None):
    """SAF (acc verilirse ona ekler): haftalık satırlardan (hafta, tür, sahip tipi) toplamı: firma_sayisi, isci, kasa, ciro, ucret, gider, kredi_net, net (= kasa farkı toplamı), dogum, olum.
    Çıktıda ayrıca faaliyet_net = ciro - gider ve sahibe_ve_sehre_aktarim = net - faaliyet_net - kredi_net (kalan: temettü, NPC kârının şehre aktarımı, tasfiye ve sermaye akışları, gider defterine girmeyen kalemler)."""
    acc = {} if acc is None else acc
    for r in haftalik:
        a = acc.setdefault((r["hafta"], r["tur"], r["sahip_tipi"]), _bos(r))
        a["firma_sayisi"] += 1
        a["isci"] += r["isci"]
        a["kasa"] += r["kasa"]
        a["ciro"] += r["ciro"]
        a["ucret"] += r["ucret"]
        a["gider"] += r["gider"]
        a["kredi_net"] += r["kredi_net"]
        a["net"] += r["kasa_fark"]
    for r in dogum:
        acc.setdefault((r["hafta"], r["tur"], r["sahip_tipi"]), _bos(r))["dogum"] += 1
    for r in olum:
        acc.setdefault((r["hafta"], r["tur"], r["sahip_tipi"]), _bos(r))["olum"] += 1
    cikti = []
    for k in sorted(acc):
        a = dict(acc[k])
        a["faaliyet_net"] = a["ciro"] - a["gider"]
        a["sahibe_ve_sehre_aktarim"] = a["net"] - a["faaliyet_net"] - a["kredi_net"]
        cikti.append(a)
    return cikti


def sektor_rows(W):
    st = _flog(W)
    acc = {k: dict(v) for k, v in st["acc"].items()}
    return sektor_topla([r for r in st["satir"] if r["hafta"] > st["acc_hf"]], st["dogum"], st["olum"], acc=acc)


def write(W, taban_yolu):
    """<taban>_yasam.jsonl (rows; dökülmüş haftalık satırlar önce, sonra bellekte kalanlar, sonra doğum, ölüm, devir) ve <taban>_sektor_para.csv (sektor_rows)."""
    st = _flog(W)
    with open(taban_yolu + "_yasam.jsonl", "w", encoding="utf-8") as fh:
        for grup in (_dokulen(st), st["satir"], st["dogum"], st["olum"], st["devir"], W.__dict__.get("ls_ret", ())):       # ls_ret: REKABET G4 kuruluş kredisi ret satırları (credit_meas.ls_say)
            for r in grup:
                fh.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    with open(taban_yolu + "_sektor_para.csv", "w", newline="", encoding="utf-8") as fh:
        cw = csv.writer(fh)
        cw.writerow(_SEKTOR_ALAN)
        for r in sektor_rows(W):
            cw.writerow([("%.4f" % r[k]) if isinstance(r[k], float) else r[k] for k in _SEKTOR_ALAN])
