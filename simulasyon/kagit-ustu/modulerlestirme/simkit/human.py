"""simkit.human: insan karakteri ve tek seferlik kararlar (DAO oyunu; HUMAN_ON=1).

AMAÇ: oyuncunun oynadığı tek karakter (HUMAN_CITY şehrinin ilk oyuncusu) bot oyuncuyla aynı kurallarla yaşar; farkı, kararlarını
dışarıdan almasıdır: sürekli mevduat tercihi, çekim, kadro hedefi (G17i, HIRE_TARGET), işten ayrılma, göç, ahırdan çıkış, işletme kurma, ilana başvuru. Kararlar `human_submit` ile sıraya girer, gönderildikleri
haftadan SONRAKİ haftanın açılışında (`human_week_open`) uygulanır. Otomatik pilot üç istisnayla bot kuralıdır: insan kendiliğinden
işletme, lonca, DAO ya da pay sahibi olmaz ve kendiliğinden şehir değiştirmez (dışlama kancaları ilgili modüllerde `HUMAN_ON and q == W.human`).
Her kanca `if HUMAN_ON` ile korunur: kapalıyken çıktı bayt bayt aynıdır.
ARAYÜZ: _faaliyet_fark (F4: satırın faaliyet kasa farkı), _yasam_olum (F4: insanın ölü işletmesi -> firm_log ölüm satırı, olum_satiri ile), _kasa_pisti (F4: nakit pisti, hafta), _firma_uyari (F4: canlı işletme uyarı kodları), _sektor_egilim (F4: şehirde tür başına kasa eğilimi), is_human, human_init, human_submit, human_week_open, human_week_end, human_dep, human_dep_report, human_blocked, human_hide, human_unhide, human_dao_onde, human_basvuru_son, human_cikis, human_batis (lab_meas'te), kasa_gucu,
lonca_kur (F3: karar yolu; şartlar credit_core.lonca_kur_eksikleri, kuruluş lonca.insan_lonca_kur), _lonca_kur_gozlem (F3: gözlemin lonca_kur ve lonca_kur_ayrinti alanları), _loncam (F3: gözlemde insanın sahibi olduğu lonca), _lonca_sec_neden (F2: lonca_sec kararının geçersizlik nedeni; gönderim ve uygulama aynı kuralı kullanır), _loncalar (F2: gözlemde lonca listesi; HUMAN_LONCA açıkken pay_orani, kredi_verebilir, skor), note_firm (işletme kaydı; kuruluş kararı bunu çağırır), human_olay (olay yaz), servet_dilimi, servet_kinti, kur_yeni_yol, kur_eksikleri (kuruluş şartlarının tek kaynağı: hem human_found hem gozlem.kurabilir),
ilan_ucreti, ilanlar (davranışsız iş ilanı: W.staff_tgt'den türetilir), gozlem (oyuncunun gözlem paketi: yalnız okur, yalnız JSON türleri, insanın kendi işletmeleri, işvereni ve ilan veren işletmeler dışında kimlik taşımaz), KararHatasi
OKUR/YAZAR: W.staff_tgt (HUMAN_ON açıkken labor/week_people/young_kit/dao yazar; yalnız son hafta; karara girmez), W.human (insanın adı ya da None), W.human_ev (son haftanın olayları), W.human_hist (başlangıç dilimi ve kurduğu işletmeler),
W.human_q (bekleyen kararlar: uygulanacak hafta -> {"tek", "mevduat"}), W.human_pref (sürekli mevduat tercihi), W.human_left (son ayrıldığı firma ve hafta),
W.human_cikis (istemsiz iş kaybı nedeni işareti; çıkarma noktaları human_cikis ile yazar, human_week_end tüketir), W.human_batis (insanın işletmesi -> batış nedeni; week_close ölüm noktası lab_meas.human_batis ile yazar; human_week_end firma_batti.neden olarak okur), W.human_kabul (bu hafta kabul edilen firma; human_week_end tüketir), W.human_basvuru (bu hafta uygulanan başvuru {firma, hafta, n0, ucret, eski (başvuru anındaki iş ya da None: iş değiştirme), rel} ya da None; hafta içinde human_basvuru_son tüketir), W.human_job0, W.human_kdurum, W.human_kasa (insanın işletmelerinin son iki hafta sonu kasası {onc, bu}; human_week_end kaydırır, gozlem kasa_degisim için okur), W.human_kurabilir (kurabilir_oldu geçişi için önceki hafta durumu), W.human_kur (bu hafta kurulmak istenen sektör ya da None; kuruluş fazı human_found ile tüketir); uygularken W.people, W.cities, W.firms, W.deposits, W.dep_tot, W.jobless, W.L (yalnız Ledger.pay: para yaratmaz, yok etmez).
KATMAN: L2 (yalnız params, lab_meas, econ_core, credit_core, wages ve firm_log; week_* modüllerini içe aktarmaz). gozlem YAZMAZ: W, defter ve rastgelelik durumuna dokunmaz (HUMAN_ON açıkken her hafta çağrılsa da çağrılmasa da model aynı gider).
"""
import math
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403
from simkit.price_index import ix
from simkit.params import _KASA_ZAYIF as KASA_ZAYIF, _KASA_GUCLU as KASA_GUCLU, _MAAS_ODEYEMEDI_HAFTA as MAAS_ODEYEMEDI_HAFTA      # ilan göstergesi eşikleri (davranışsız; alt çizgili ad kayıt/hash dışı)
from simkit.lab_meas import lab_ev, human_cikis      # noqa: F401  (human_cikis: çıkarma noktaları lab_meas'ten çağırır)
from simkit.econ_core import innov_uygun, ahirda, isres, mk_bottleneck, sehir_destekli, fee_rate
from simkit.credit_core import sahip_kapat, home_birak, lendable, lo_risk, lonca_score, lonca_gecis, lonca_kur_eksikleri, LONCA_KUR_YOLLARI
from simkit.wages import kadro_ucreti, res_wage
from simkit.firm_log import son_satirlar, olum_satiri


class KararHatasi(ValueError):
    """Geçersiz karar: str(e) hata kodu (karar_gecersiz, ayni_hafta, once_cek, kurucuyken_goc); `fields` nedenleri taşır (sunucu 422 gövdesi)."""

    def __init__(self, kod, fields=()):
        super().__init__(kod)
        self.kod = kod
        self.fields = list(fields)


def is_human(W, q):
    """q oyuncunun oynadığı karakter mi (HUMAN_ON kapalıyken hep False)."""
    return bool(HUMAN_ON and q == W.human)


def servet_dilimi(W, q):
    """q'nun oyuncular arasındaki servet (nakit + mevduat) dilimi: 0 (en yoksul onda bir) ... 9; eşit servet yarım sayılır."""
    dep = W.deposits
    bal = W.L.bal
    v = bal.get(q, 0.0) + (dep[q][1] if q in dep else 0.0)
    alt = esit = n = 0
    for x, i in W.people.items():
        if i["who"] != "oyuncu":
            continue
        n += 1
        y = bal.get(x, 0.0) + (dep[x][1] if x in dep else 0.0)
        if y < v - 1e-9:
            alt += 1
        elif y <= v + 1e-9:
            esit += 1
    return min(9, int(10 * (alt + 0.5 * esit) / max(1, n)))


def servet_kinti(W, q):
    """q'nun oyuncular arasındaki servet beşte biri: 1 (en yoksul) ... 5. Sıralama tabanlı: servet_dilimi'nin onda birliğinin ikili birleşimi; eşit servet yarım sayılır
    (hepsi eşitse hepsi orta dilim, 3'te)."""
    return servet_dilimi(W, q) // 2 + 1


def human_init(W):
    """new_world sonunda çağrılır: kapalıyken yalnız boş alanlar; açıkken insanı seçer ve şehrin ahır işçi listesinin ortasına koyar.
    pop_ahir_player her ahırda listedeki ilk oyuncuyu çıkarır, ahırlar sırayla boşalır (ilk ahır önce) ve ahırda AHIR_HERD_WORKERS kişi kalınca kimseyi çıkarmaz:
    ilk ahırın başı da, son ahırın sonu da yanlı olurdu. İnsan, ortadaki ahırın ortasındaki işçiyle yer değiştirir (ahır boyları değişmez). İnsan ahırdan kendiliğinden çıkmaz
    (pop_ahir_player ve _peek_mover onu atlar); yalnız `ahirdan_cik` kararı onu iş arayanlara koyar."""
    W.human = None
    W.human_ev = []
    W.human_hist = {"dilim0": 0, "firmalar": []}
    W.human_q = {}
    W.human_pref = None
    W.human_left = None
    W.human_job0 = None
    W.human_kdurum = None
    W.human_kasa = {"onc": {}, "bu": {}}              # F1: insanın işletmelerinin kasası, son iki hafta sonu (human_week_end kaydırır; gozlem yalnız okur)
    W.human_kurabilir = False                  # önceki hafta sonunda kur_eksikleri boş muydu (kurabilir_oldu geçişi)
    W.human_kur = None
    W.human_lonca_odenen = {}                  # F3: insanın kurduğu lonca -> kuruluşta ödediği sermaye (kapanışta kayıp hesabı)
    W.human_lonca_kur = None                   # F3: bu hafta kurulmak istenen lonca yolu ya da None (insan_lonca_kur tüketir)
    W.human_go = None
    W.human_basvuru = None
    W.human_kabul = None
    W.human_cikis = None
    W.human_batis = {}                         # insanın işletmesi -> batış nedeni (lab_meas.human_batis ölüm noktasında yazar, human_week_end okur)
    if not HUMAN_ON:
        return
    h = W.cities[HUMAN_CITY]["players"][0]
    W.human = h
    f = W.people[h]["firm"]
    if f is not None:
        ahirs = [a for a in W.cities[HUMAN_CITY]["firms"] if W.firms[a]["kind"] == "ahir"]
        fm = ahirs[len(ahirs) // 2]
        ws = W.firms[fm]["workers"]
        if fm == f:
            ws.remove(h)
            ws.insert(len(ws) // 2, h)
        else:
            o = ws[len(ws) // 2]
            ws[len(ws) // 2] = h
            w0 = W.firms[f]["workers"]
            w0[w0.index(h)] = o
            W.people[h]["firm"] = fm
            W.people[o]["firm"] = f
    W.human_hist["dilim0"] = servet_dilimi(W, h)


def note_firm(W, fname, sektor, born):
    """insanın kurduğu işletmeyi geçmişe yazar (ölünce human_week_end `died` doldurur). Kuruluş eski işten ayrılmaktır: hafta içi iş farkı artık yeni işletmeye göre ölçülür
    (kurulduğu hafta batan işletme eski işverenden `isten_cikarildi` üretmez)."""
    W.human_hist["firmalar"].append({"ad": fname, "sektor": sektor, "born": born, "died": None})
    W.human_job0 = fname


# ---------------------------------------------------------------- gönderim ve doğrulama
_ALANLAR = {"mevduat": {"tur", "lonca", "oran"}, "cek": {"tur", "miktar"}, "ayril": {"tur"}, "goc": {"tur", "sehir"}, "kur": {"tur", "sektor"}, "ahirdan_cik": {"tur"}, "basvur": {"tur", "firma"}, "sermaye_ekle": {"tur", "miktar"}, "lonca_sec": {"tur", "lonca"}, "lonca_kur": {"tur", "yol"}, "kadro": {"tur", "hedef"}}
_TEK = ("cek", "ayril", "goc", "kur", "ahirdan_cik", "basvur", "lonca_sec", "lonca_kur")       # haftada bir


def _say(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _sahip_firma(W, h):
    """insanın sahibi olduğu canlı işletme (yoksa None)."""
    for f in W.player_firms:
        d = W.firms[f]
        if d["owner"] == h and not d.get("dead"):
            return f
    return None


def _ahir_alt_sinir(W, f):
    """K-111: ahırda AHIR_HERD_WORKERS kişi kalmışken çıkış olmaz."""
    d = W.firms[f]
    return d["kind"] == "ahir" and len(d["workers"]) <= AHIR_HERD_WORKERS


def _lonca_sec_neden(W, h, yeni, hafta):
    """F2: lonca_sec kararı `hafta`da uygulanacaksa geçersizlik nedeni (KararHatasi alanları) ya da None. Gönderimde ve uygulama anında aynı kural (gönderimden sonra durum değişebilir)."""
    fs = _sahip_firma(W, h)
    if fs is None:
        return [{"id": "tur", "reason": "kurucu_degil"}]
    if not isinstance(yeni, str) or yeni not in W.loncas:
        return ["lonca"]
    d = W.firms[fs]
    if yeni in W.closed:
        return [{"id": "lonca", "reason": "lonca_kapali"}]
    if d["lonca"] == yeni:
        return [{"id": "lonca", "reason": "ayni_lonca"}]
    if not FEE_ACT or hafta < OWNER_WEEK:
        return [{"id": "lonca", "reason": "erken"}]                  # bot kuralıyla aynı (lonca.switch_step): lonca payı kapalıyken ya da OWNER_WEEK'ten önce geçiş yok
    if hafta - d.get("sw_last", -999) < SWITCH_COOL:
        return [{"id": "lonca", "reason": "bekleme"}]               # bot kuralıyla aynı: son geçişten (bot ya da insan) SWITCH_COOL hafta
    return None


def human_submit(W, karar, simdi):
    """Kararı doğrular ve sıraya koyar; uygulanacağı haftayı (simdi + 1) döner. `simdi`: yayımlanmış son hafta (W.week_no değil: start_world onu 1 ile başlatır).
    Geçersizse KararHatasi (ValueError alt sınıfı; kod: karar_gecersiz, ayni_hafta, once_cek, kurucuyken_goc)."""
    if not HUMAN_ON or W.human is None:
        raise KararHatasi("karar_gecersiz", ["human"])
    if not isinstance(karar, dict) or not isinstance(simdi, int) or isinstance(simdi, bool) or simdi < 0:
        raise KararHatasi("karar_gecersiz", ["karar"])
    tur = karar.get("tur")
    if not isinstance(tur, str) or tur not in _ALANLAR:
        raise KararHatasi("karar_gecersiz", ["tur"])
    fazla = sorted(set(karar) - _ALANLAR[tur])
    if fazla:
        raise KararHatasi("karar_gecersiz", fazla)
    h = W.human
    p = W.people[h]
    if tur == "mevduat":
        lo, oran = karar.get("lonca"), karar.get("oran")
        if "lonca" not in karar or (lo is not None and lo not in W.loncas):
            raise KararHatasi("karar_gecersiz", ["lonca"])
        if not _say(oran) or not 0.0 <= oran <= 1.0:
            raise KararHatasi("karar_gecersiz", ["oran"])
        ent = W.deposits.get(h)
        if lo is not None and ent is not None and ent[1] > 1e-9 and ent[0] != lo:
            raise KararHatasi("once_cek", ["lonca"])
    elif tur == "cek":
        if not _say(karar.get("miktar")) or karar["miktar"] <= 0:
            raise KararHatasi("karar_gecersiz", ["miktar"])
    elif tur == "sermaye_ekle":
        if not OWNER_INJECT:
            raise KararHatasi("karar_gecersiz", ["tur"])
        if not _say(karar.get("miktar")) or karar["miktar"] <= 0:
            raise KararHatasi("karar_gecersiz", ["miktar"])
        if _sahip_firma(W, h) is None:
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "isletme_sahibi_degil"}])
    elif tur == "kadro":
        if not HIRE_TARGET:
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "bayrak_kapali"}])      # REKABET G17i: kadro kararı yalnız HIRE_TARGET açıkken anlamlı
        if not (HIRE_CASH_GATE or HIRE_GATE_ALL):
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "kasa_kapisi_kapali"}])      # kasa kapıları kapalıyken hedef etkisiz (17c eski yol): karar kabul edilmez
        fs_ = _sahip_firma(W, h)
        if fs_ is None:
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "isletme_sahibi_degil"}])
        ht_ = karar.get("hedef")
        if "hedef" not in karar or (ht_ is not None and (not isinstance(ht_, int) or isinstance(ht_, bool) or not 1 <= ht_ <= W.firms[fs_]["capacity"])):
            raise KararHatasi("karar_gecersiz", ["hedef"])                                    # hedef 1 ile kapasite arası tam sayı ya da null (bot sezgisine dönüş)
    elif tur == "lonca_sec":
        if not HUMAN_LONCA:
            raise KararHatasi("karar_gecersiz", ["tur"])
        neden = _lonca_sec_neden(W, h, karar.get("lonca"), simdi + 1)
        if neden is not None:
            raise KararHatasi("karar_gecersiz", neden)
    elif tur == "lonca_kur":
        if not HUMAN_LONCA:
            raise KararHatasi("karar_gecersiz", ["tur"])
        if karar.get("yol") not in LONCA_KUR_YOLLARI:
            raise KararHatasi("karar_gecersiz", ["yol"])                  # şartlar uygulama anında sınanır (lonca_kurulamadi{neden}); gözlem.lonca_kur eksikleri önceden gösterir
    elif tur == "ayril":
        f = p["firm"]
        if f is not None and W.firms[f]["kind"] == "ahir":
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "ahirda"}])          # ahırdan yalnız ahirdan_cik ile çıkılır
        if f is None or _ahir_alt_sinir(W, f):
            raise KararHatasi("karar_gecersiz", ["ayril"])
    elif tur == "ahirdan_cik":
        if p["firm"] is None or W.firms[p["firm"]]["kind"] != "ahir":
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "ahirda_degil"}])
    elif tur == "basvur":
        if ahirda(W, h):
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "ahirda"}])          # ahırdaki insanın p["firm"] alanı dolu: zaten_calisiyor yanıltıcı olurdu; önce ahirdan_cik
        if _sahip_firma(W, h) is not None or p.get("founder"):
            raise KararHatasi("karar_gecersiz", [{"id": "tur", "reason": "isletme_sahibi"}])
        fi = karar.get("firma")
        d_ = W.firms.get(fi) if isinstance(fi, str) else None
        if d_ is None or d_.get("dead") or d_.get("kapaniyor") or d_["kind"] == "ahir":
            raise KararHatasi("karar_gecersiz", ["firma"])                                    # ahır ilan vermez; ölü ya da kapanan firma ilan vermez
        if human_blocked(W, h, fi):
            raise KararHatasi("karar_gecersiz", [{"id": "firma", "reason": "geri_alinmaz"}])      # HUMAN_REHIRE_BLOCK: son ayrıldığı firmaya süre dolana dek başvurulmaz
        if p["firm"] == fi:
            raise KararHatasi("karar_gecersiz", [{"id": "firma", "reason": "ayni_firma"}])        # çalışan insan başka bir ilana başvurabilir (iş değiştirme); kendi işverenine değil
    elif tur == "kur":
        s_ = karar.get("sektor")
        if not (MARKET_OPEN and s_ == "market") and (not isinstance(s_, str) or s_ == "ahir" or s_ not in PROD_OF or PRODUCER.get(PROD_OF[s_]) != s_):
            raise KararHatasi("karar_gecersiz", ["sektor"])
    elif tur == "goc":
        j = karar.get("sehir")
        if not isinstance(j, int) or isinstance(j, bool) or not 0 <= j < len(W.cities) or j == p["city"]:
            raise KararHatasi("karar_gecersiz", ["sehir"])
        if p.get("founder") or _sahip_firma(W, h) is not None:
            raise KararHatasi("kurucuyken_goc", ["sehir"])
    hafta = simdi + 1
    slot = W.human_q.get(hafta)
    if tur in _TEK and slot is not None and slot.get("tek") is not None:
        raise KararHatasi("ayni_hafta", ["tur"])
    if slot is None:
        slot = W.human_q[hafta] = {"tek": None, "mevduat": None}
    if tur == "mevduat":
        slot["mevduat"] = {"lonca": karar["lonca"], "oran": float(karar["oran"])}
    elif tur == "kadro":
        slot["kadro"] = {"tur": tur, "hedef": None if karar["hedef"] is None else int(karar["hedef"])}      # kendi yuvası (ekle gibi): haftadaki tek karar ile çakışmaz; aynı hafta ikinci kadro kararı sonuncusudur
    elif tur == "sermaye_ekle":
        slot["ekle"] = {"tur": tur, "miktar": float(karar["miktar"]) + (slot["ekle"]["miktar"] if slot.get("ekle") else 0.0)}      # ayni hafta ikinci gonderim toplanir          # kendi yuvasi: haftadaki tek karar (cek/kur/...) ile cakismaz
    else:
        slot["tek"] = dict(karar)
    return hafta


# ---------------------------------------------------------------- hafta açılışı: kuyruğu uygula
def _olay(W, w, tur, **alan):
    W.human_ev.append(dict(tur=tur, hafta=w, **alan))


def human_olay(W, w, tur, **alan):
    """üst katmanların (kuruluş fazı) olay yazması için açık kapı."""
    _olay(W, w, tur, **alan)


def _cikar(W, f, kod):
    """insanı f firmasından çıkarıp şehrinin iş arayanlarına koyar."""
    h = W.human
    p = W.people[h]
    W.firms[f]["workers"].remove(h)
    if KR_MEAS:
        lab_ev(W, kod, f)                                  # davranışsız sayaç (§4.6)
    p["firm"] = None
    W.cities[p["city"]]["seekers"].append(h)


def _kapat(W, f):
    """sahibin ayrılması = işletmeyi kapat (gövde credit_core.sahip_kapat'ta (firm_exit'ten de erişilir): REKABET G17h taşıması, davranış aynı)."""
    sahip_kapat(W, f)


def _uygula(W, w, k):
    h = W.human
    p = W.people[h]
    tur = k["tur"]
    f = p["firm"]
    if tur == "lonca_sec":
        neden = _lonca_sec_neden(W, h, k["lonca"], w)
        if neden is not None:
            kod = neden[0]["reason"] if isinstance(neden[0], dict) else "lonca"
            _olay(W, w, "karar_uygulanamadi", karar="lonca_sec", neden=kod)      # gönderimden sonra durum değişti (lonca kapandı, bekleme, işletme kalmadı)
            return
        fs = _sahip_firma(W, h)
        eski = W.firms[fs]["lonca"]
        lonca_gecis(W, fs, W.firms[fs], k["lonca"], w)
        W.firms[fs]["lonca_insan"] = w
        _olay(W, w, "lonca_degisti", firma=fs, eski=eski, lonca=k["lonca"], kaynak="insan")
        return
    if tur == "lonca_kur":
        W.human_lonca_kur = k["yol"]                       # kuruluş bot lonca adımlarının yerinde (week_people.insan_lonca_kur) yapılır; şartlar o anda sınanır
        return
    if tur == "kadro":
        fs = _sahip_firma(W, h)
        if fs is None:
            _olay(W, w, "karar_uygulanamadi", karar="kadro", neden="isletme_yok")      # gönderimden sonra işletme kalmadı
            return
        d_ = W.firms[fs]
        if k["hedef"] is None:
            d_.pop("insan_hedef", None)                                                 # bot sezgisine dönüş
        else:
            d_["insan_hedef"] = max(1, min(k["hedef"], d_["capacity"]))                  # REKABET G17i: insan yeni karar verene dek geçerli (kalıcı); bot sezgisi yerine geçer (week_people)
        _olay(W, w, "kadro_hedefi", firma=fs, hedef=d_.get("insan_hedef"))
        return
    if tur == "sermaye_ekle":
        fs = _sahip_firma(W, h)
        amt = min(k["miktar"], W.L.bal[h]) if fs is not None else 0.0
        got = W.L.pay(h, fs, amt, "kurucu_sermayesi") if amt > 1e-9 else 0.0
        if got <= 1e-9:
            _olay(W, w, "sermaye_eklenemedi", neden=("isletme_yok" if fs is None else "nakit_yok"))
            return
        if FIRM_LIFE_LOG:
            sg = getattr(W, "fl_sermaye", None)
            if sg is None:
                sg = W.fl_sermaye = {}
            sg[fs] = sg.get(fs, 0.0) + got                       # F4: firm_log o haftanın satırına sermaye_giris olarak yazar (nakit pisti faaliyet akışını sermayeden ayırır)
        W.L.flows["owner_inject_human"] += got
        _olay(W, w, "sermaye_eklendi", miktar=got, firma=fs)
        return
    if tur == "cek":
        ent = W.deposits.get(h)
        if ent is None or ent[1] <= 1e-9:
            _olay(W, w, "cekilemedi")
            return
        lo = ent[0]
        amt = min(k["miktar"], ent[1], W.L.bal[f"{lo}_sermaye"])
        got = W.L.pay(f"{lo}_sermaye", h, amt, "mevduat_cekim") if amt > 1e-9 else 0.0
        if got <= 1e-9:
            _olay(W, w, "cekilemedi")
            return
        ent[1] -= got
        W.dep_tot[lo] -= got
        _olay(W, w, "cekildi", miktar=got)
    elif tur == "ayril":
        if f is None or _ahir_alt_sinir(W, f):
            _olay(W, w, "karar_uygulanamadi", karar="ayril", neden="ahir_alt_sinir" if f is not None else "isiz")      # gönderimden sonra durum değişti (K-111)
            return
        sahip = _sahip_firma(W, h)
        if sahip is not None:
            _kapat(W, sahip)
            f = sahip
        else:
            _cikar(W, f, "cikis_ayrilma")
        W.human_left = (f, w)
        _olay(W, w, "ayrildi")
    elif tur == "ahirdan_cik":
        if f is None or W.firms[f]["kind"] != "ahir":
            _olay(W, w, "karar_uygulanamadi", karar="ahirdan_cik", neden="ahirda_degil")      # gönderimden sonra durum değişti
            return
        _cikar(W, f, "cikis_ahir")                          # ölçümde gönüllü ayrılmadan (cikis_ayrilma) ayrı sebep; ahır alt sınırını atlar: sürüyü labor.py sürü tamamlaması havuzdan doldurur
        _olay(W, w, "ahirdan_cikti")
    elif tur == "basvur":
        fi = k["firma"]
        d = W.firms.get(fi)
        neden = None
        if f is not None and (_sahip_firma(W, h) is not None or p.get("founder")):
            neden = "isletme_sahibi"                             # gönderimden sonra durum değişti
        elif f is not None and f == fi:
            neden = "ayni_firma"                                 # gönderimden sonra durum değişti (yeni işi aynı firma oldu)
        elif d is None or d.get("dead") or d.get("kapaniyor"):
            neden = "ilan_kapandi"
        elif d["city"] != p["city"]:
            neden = "sehir"
        elif d["kind"] == "arge" and innov_uygun(W, h) is None:
            neden = "secilmedi"                                  # Ar-Ge DAO'su yalnız alım şartını sağlayan araştırmacıyı alır; şart gönderimden sonra bozuldu
        if neden is not None:
            _olay(W, w, "basvuru_red", firma=fi, neden=neden)
            return
        W.human_basvuru = {"firma": fi, "hafta": w, "n0": None, "ucret": ilan_ucreti(W, h, fi), "eski": f, "rel": None}      # işe alım adımında yalnız bu firma insanı görür; ilandaki ücret uygulama anında (haftanın ücret/RWI güncellemelerinden önce) sabitlenir; sonucu human_basvuru_son yazar
    elif tur == "kur":
        W.human_kur = k["sektor"]                           # değerlendirme kuruluş fazında (phase_founding), şartlar o anda sınanır
    elif tur == "goc":
        j = k["sehir"]
        neden = "kurucu" if (p.get("founder") or _sahip_firma(W, h) is not None) else ("ayni_sehir" if j == p["city"] else None)
        if neden is not None:
            _olay(W, w, "karar_uygulanamadi", karar="goc", neden=neden)      # gönderimden sonra durum değişti
            return
        if f is not None:
            _cikar(W, f, "cikis_goc")                       # ahırdaysa alt sınırı atlar (ahirdan_cik gibi): sürüyü labor.py havuzdan doldurur
        c0 = W.cities[p["city"]]
        c0["players"].remove(h)                             # bot göçünün üç adımı (week_people.phase_migration)
        if h in c0["seekers"]:
            c0["seekers"].remove(h)
        W.cities[j]["seekers"].append(h)
        W.cities[j]["players"].append(h)
        if HOME_OWN:
            home_birak(W, h)                                # REKABET G12: göç eden ev sahibinin evi eski şehirde kiralık birime döner (bot göçüyle aynı kural)
        p["city"] = j
        W.jobless[h] = 0
        _olay(W, w, "goc_etti", sehir=j)


def human_week_open(W, w):
    """hafta açılışı (phase_begin_week sonu): olay listesini boşaltır, uygulanma haftası gelen kararları uygular, iş durumunu hafta sonu farkı için kaydeder."""
    W.human_ev = []
    W.human_lonca_kur = None                                   # F3: tüketilmemiş istek (lonca adımı çalışmadı) sonraki haftaya taşınmaz
    for hf in sorted(x for x in W.human_q if x <= w):
        slot = W.human_q.pop(hf)
        if slot["mevduat"] is not None:
            W.human_pref = slot["mevduat"]
            W.human_kdurum = None
        if slot["tek"] is not None:
            _uygula(W, w, slot["tek"])
        if slot.get("ekle") is not None:
            _uygula(W, w, slot["ekle"])
        if slot.get("kadro") is not None:
            _uygula(W, w, slot["kadro"])
    W.human_job0 = W.people[W.human]["firm"]


# ---------------------------------------------------------------- istemsiz iş kaybı nedeni
CIKIS_NEDENLERI = ("ucret_odenmedi", "kucultme", "firma_kapandi")


def _cikis_nedeni(neden):
    """işaretlenen neden -> olay nedeni (tek sınıflama yeri). İşaretsiz çıkış (hiçbir çıkarma noktası işaretlemediyse) "diger"."""
    return neden if neden in CIKIS_NEDENLERI else "diger"


# ---------------------------------------------------------------- hafta sonu: iş ve işletme farkı
def human_week_end(W, w):
    """phase_dividends sonu (batışlardan sonra): insanın kendi işletmelerinin ölümü ve işinin hafta başına göre değişimi olay olur."""
    h = W.human
    own = set()
    for r in W.human_hist["firmalar"]:
        own.add(r["ad"])
        d = W.firms.get(r["ad"])
        if r["died"] is None and d is not None and d.get("dead"):
            r["died"] = d.get("died", w)
            r["neden"] = W.human_batis.get(r["ad"], "diger")           # lab_meas.human_batis firmanın gerçekten öldüğü noktada işaretler; işaretsiz yol "diger"
            _olay(W, w, "firma_batti", firma=r["ad"], neden=r["neden"], yas=max(0, int(r["died"]) - int(r["born"])))
    W.human_kasa = {"onc": W.human_kasa["bu"], "bu": {r["ad"]: float(W.L.bal.get(r["ad"], 0.0)) for r in W.human_hist["firmalar"] if r["died"] is None}}      # F1: kasa değişimi için hafta sonu kaydı
    j0, now = W.human_job0, W.people[h]["firm"]
    kf, W.human_kabul = W.human_kabul, None
    neden, W.human_cikis = W.human_cikis, None
    if now != j0 or (kf is not None and now is None):
        if now is None:
            f0 = j0 if j0 is not None else kf              # kf: bu hafta kabul edilip aynı hafta çıkarılan (hafta başı iş yoktu: genel fark bunu görmezdi)
            if f0 is not None and f0 not in own:
                _olay(W, w, "isten_cikarildi", firma=f0, neden=_cikis_nedeni(neden))
            # f0 insanın kendi işletmesiyse (own): işten çıkarılma değil işletmenin ölümü; `firma_batti` (yukarıda) bunun olayıdır, ayrıca isten_cikarildi yazılmaz
        elif now not in own:
            _olay(W, w, "ise_girdi", firma=now)
    kb = not kur_eksikleri(W, h, w + 1)                    # gozlem.kurabilir ile aynı kaynak ve aynı hafta (yayımlanan hafta + 1)
    if kb and not W.human_kurabilir:
        _olay(W, w, "kurabilir_oldu")
    W.human_kurabilir = kb


# ---------------------------------------------------------------- mevduat
def human_dep(W, q, lo_bot):
    """phase_deposits: insanın bu haftaki mevduat kipi (kip, lonca, oran). kip: "bot" (bot kuralı; tercih yok, tercih edilen lonca kapalı ya da hesap dolu başka loncada),
    "hedef" (boş hesap: tercih edilen açık lonca), "yok" (lonca: null, yeni mevduat yatırılmaz). Oran tercihi her kipte DEP_SHARE'in yerini alır."""
    pref = W.human_pref
    if pref is None:
        return ("bot", lo_bot, DEP_SHARE)
    oran, lo = pref["oran"], pref["lonca"]
    if lo is None:
        return ("yok", None, oran)
    ent = W.deposits.get(q)
    if (ent is not None and ent[1] > 1e-9) or lo in W.closed:
        return ("bot", lo_bot, oran)
    return ("hedef", lo, oran)


def human_dep_report(W, lo_i):
    """yatırım denemesinde (lo_i: parayı alan lonca ya da None) tercih edilen loncanın durumunu izler; olay yalnız durum değişince bir kez yazılır."""
    pref = W.human_pref
    durum = None
    if pref is not None and pref["lonca"] is not None and pref["lonca"] in W.closed:
        durum = "lonca_kapali" if lo_i is not None else "mevduat_yatirilmadi"
    if durum != W.human_kdurum:
        W.human_kdurum = durum
        if durum is not None:
            _olay(W, W.week_no, durum, lonca=pref["lonca"])


# ---------------------------------------------------------------- işe alımda geri alınma engeli
def human_blocked(W, q, f):
    """q insansa ve f, son ayrıldığı firma ise HUMAN_REHIRE_BLOCK hafta boyunca True."""
    left = W.human_left
    return bool(HUMAN_ON and q == W.human and left is not None and left[0] == f and W.week_no - left[1] < HUMAN_REHIRE_BLOCK)


def human_hide(W, c, f, acik=True):
    """f firması işe alırken insanı şehrin iş arayanlarından geçici çıkarır (insan iş arayanlarda KALIR; hiçbir firma onu kendiliğinden almaz): yalnız başvurduğu
    firmanın işe alım adımında (ve o firmada açık kadro varsa: `acik`) insan sıranın başına alınır ve görünür kalır. Geri koymak için sıra numarasını (ya da None) döner;
    human_unhide'a verilir. Otomatik tüketimin tamamı bu kancayla sarılıdır (labor, week_people; Ar-Ge için human_dao_onde)."""
    h = W.human
    b = W.human_basvuru
    if h not in c["seekers"]:
        if acik and b is not None and b["firma"] == f and b.get("eski") is not None and W.people[h]["firm"] == b["eski"] and W.firms[b["eski"]]["kind"] != "ahir" and not human_blocked(W, h, f):
            return _birak(W, c, b)                                  # çalışan insan başvurduğu firmanın işe alımında iş arayan gibi görünür (iş değiştirme)
        return None
    i = c["seekers"].index(h)
    c["seekers"].pop(i)
    if acik and b is not None and b["firma"] == f and not human_blocked(W, h, f):
        c["seekers"].insert(0, h)
        if b["n0"] is None:
            b["n0"] = len(W.firms[f]["workers"])
    return i


def _birak(W, c, b):
    """iş değiştirme: çalışan insan, başvurduğu firmanın işe alım adımı süresince eski işinden ayrılmış ve iş arayanların başında sayılır (bot kuralı aynı: işe alım sırası onu görür).
    Adım bitince human_unhide: alındıysa eski işe dönülmez (çıkış ve giriş aynı adımdadır, arada işsiz kalınmaz; sonuç human_basvuru_son'da), alınmadıysa eski işine eski sırasıyla geri döner.
    Dönen -1 human_unhide'ın 'eski işe geri' işaretidir."""
    h = W.human
    old = b["eski"]
    ws = W.firms[old]["workers"]
    b["rel"] = (old, ws.index(h))
    ws.remove(h)
    W.people[h]["firm"] = None
    c["seekers"].insert(0, h)
    if b["n0"] is None:
        b["n0"] = len(W.firms[b["firma"]]["workers"])
    return -1


def human_unhide(W, c, i, q=None):
    """human_hide'in gizlediği (ya da başa aldığı) insanı özgün sırasıyla iş arayanlara geri koyar; işe alındıysa (q: alınan kişi, ya da artık bir firmada) dokunmaz.
    i == -1 (_birak): işe alınmadıysa insan iş arayanlardan çıkıp eski işine eski sırasıyla döner."""
    h = W.human
    if q == h or W.people[h]["firm"] is not None:
        return
    if h in c["seekers"]:
        c["seekers"].remove(h)
    if i == -1:
        b = W.human_basvuru
        old, k = b["rel"]
        b["rel"] = None
        W.firms[old]["workers"].insert(k, h)
        W.people[h]["firm"] = old
        return
    c["seekers"].insert(min(i, len(c["seekers"])), h)


def human_dao_onde(W, f, fi):
    """dao.py işe alımı: f (Ar-Ge DAO'su) için aday listesi fi (free_innovators: insanı dışlar) ya da boş; insan f'ye başvurduysa ve alım şartını sağlıyorsa listenin başına konur."""
    b = W.human_basvuru
    h = W.human
    if b is None or b["firma"] != f or innov_uygun(W, h) is None or W.people[h]["firm"] != b.get("eski") or human_blocked(W, h, f):
        return fi
    if b["n0"] is None:
        b["n0"] = len(W.firms[f]["workers"])
    return [h] + [x for x in fi if x != h]


def human_basvuru_son(W, w):
    """işe alım adımlarından (staffing, founding) sonra, çevrimlerden ÖNCE: bu haftanın başvurusunun sonucunu yazar. Alındıysa ücret firmanın ilanındaki ücrettir
    (ilan_ucreti: phase_wages ve dao.py ile aynı işlevler, başvurunun uygulandığı anda hesaplanmış; alım haftasının avans ödemesi de bunu kullanır) ve `basvuru_kabul`; alınmadıysa `basvuru_red`
    (`secilmedi`: firma başkasını aldı; `ilan_kapandi`: açık kadro yoktu ya da firma işe alım yapmadı)."""
    b = W.human_basvuru
    if b is None:
        return
    W.human_basvuru = None
    h = W.human
    p = W.people[h]
    f = b["firma"]
    if p["firm"] == f:
        p["wage"] = b["ucret"]
        eski = b.get("eski")
        if eski is not None:                                       # iş değiştirme: eski işten çıkış yeni işe girişle aynı adımda oldu (insan arada işsiz sayılmadı)
            if b.get("rel") is not None and KR_MEAS:
                lab_ev(W, "cikis_is_degistirme", eski)             # davranışsız sayaç: ölçümde gönüllü ayrılmadan (cikis_ayrilma) ayrı sebep
            W.human_left = (eski, w)                               # HUMAN_REHIRE_BLOCK: eski işverene süre dolana dek yeniden başvurulmaz (ayril ile aynı)
            W.human_job0 = f                                       # hafta sonu iş farkı yeni işe göre: eski işten `isten_cikarildi` ya da `ise_girdi` üretmez
        W.human_kabul = f                                          # hafta sonunda hâlâ bu işte değilse human_week_end açık `isten_cikarildi` yazar (ör. alım haftasının avansı ödenemedi)
        _olay(W, w, "basvuru_kabul", firma=f)
        if eski is not None:
            _olay(W, w, "is_degistirdi", eski=eski, yeni=f)
        return
    d = W.firms.get(f)
    secilmedi = d is not None and not d.get("dead") and b["n0"] is not None and len(d["workers"]) > b["n0"]
    _olay(W, w, "basvuru_red", firma=f, neden="secilmedi" if secilmedi else "ilan_kapandi")


# ---------------------------------------------------------------- kuruluş şartları (tek kaynak) ve gözlem
def kur_yeni_yol():
    """kuruluş yeni yolda (eo_found, kuruluş fonu) mu, eski lonca yolunda mı; human_found ve kur_eksikleri aynı ifadeyi kullanır."""
    return bool(ENTRY_OPEN or (ENTRY_EXP and EE_REPLACE and not EE_FIN_OLD))


def kur_eksikleri(W, h, w, kind=None):
    """h'nin w. haftada işletme kurabilmesi için eksik şartlar (boş liste = şartlar tamam). SAF okuma; human_found (uygulama) ve gozlem.kurabilir (gösterim) bunu çağırır, ayrışamazlar.
    Kodlar: "erken" (w < FOUND_WEEK), "zaten_kurucu" (kurucu ya da Ar-Ge DAO'sunda çalışıyor), "issiz" (bir firmada değil; ENTRY_JOBLESS açıksa iş arayan sayılır),
    "ahirda" (ahırda: gerçek bir işi yok, kur reddedilir), "calisma" (worked < FOUND_WORKED gün), "harc" (yalnız eski yolda: nakit < FOUND_HARC; yeni yolda harcı kuruluş kredisi karşılar),
    "bekleme" (yalnız kind verilince ve ENTRY_COOLDOWN > 0: o şehirde o ürüne son giriş < ENTRY_COOLDOWN hafta önce; botların girişimci kapısıyla aynı ifade)."""
    p = W.people[h]
    out = []
    if w < FOUND_WEEK:
        out.append("erken")
    if p.get("founder") or isres(p):
        out.append("zaten_kurucu")
    if not (p["firm"] or (ENTRY_JOBLESS and h in W.cities[p["city"]]["seekers"])):
        out.append("issiz")
    if p["firm"] is not None and W.firms[p["firm"]]["kind"] == "ahir":
        out.append("ahirda")                                   # ahır gerçek bir iş değil: önce ahirdan_cik
    if W.worked.get(h, 0) < FOUND_WORKED:
        out.append("calisma")
    if not kur_yeni_yol() and W.L.bal.get(h, 0.0) < ix(W, FOUND_HARC):
        out.append("harc")
    if kind is not None and w - W.LAST_ENTRY.get((p["city"], PROD_OF.get(kind, kind)), -999) < ENTRY_COOLDOWN:
        out.append("bekleme")
    return out


def ilan_ucreti(W, q, f):
    """q kişisinin f firmasındaki ilan ücreti. Sıradan firmada phase_wages'in kullandığı ortak işlev (wages.kadro_ucreti: kişinin kendi tier'ı, firmanın şehrinin WI'ı, sektörün KIND_WM'i);
    Ar-Ge DAO'sunda dao.py'nin işe alımda verdiği res_wage. SAF okuma."""
    d = W.firms[f]
    if d["kind"] == "arge":
        return res_wage(W, d["city"])
    return kadro_ucreti(W, W.people[q]["tier"], d["kind"], d["city"], False)


def kasa_gucu(kasa, yuk):
    """firma kasasının (mevcut kadro + yeni kişi) DÖNGÜLÜK ücret yüküne oranı, döngü cinsinden pist: < KASA_ZAYIF zayif, < KASA_GUCLU orta, aksi guclu (yük 0 ise guclu).
    Eşikler params.py'de: işe alım kapısı (HIRE_CASH_CYCLES) ile aynı birim; kasa_gucu işe alım kapısını geçen firmayı "zayif" göstermez. SAF."""
    if yuk <= 1e-12:
        return "guclu"
    r = kasa / yuk
    return "zayif" if r < KASA_ZAYIF else ("orta" if r < KASA_GUCLU else "guclu")


def maas_odeyemedi(W, f):
    """f firması son MAAS_ODEYEMEDI_HAFTA haftada ücret ödeyemeyip çalışan kaybetti mi (W.wfail_ema: haftada bir 0.9/0.1 üstel ortalama, tek olay 4. haftada 0.1*0.9^3'e iner). SAF okuma, davranışsız."""
    return W.wfail_ema.get(f, 0.0) >= 0.1 * 0.9 ** (MAAS_ODEYEMEDI_HAFTA - 1) - 1e-9


def ode_hesabi(W, f):
    """f firmasının ücreti gerçekte hangi hesaptan ödenir: belediye ve şehir hesabından desteklenen küçük kamu altyapısı (UTILITY, sahipsiz, <= UTILITY_MAX çalışan;
    econ_core.sehir_destekli: week_cycle_parts ile tek koşul) için şehir hesabı, diğerlerinde firmanın kendi hesabı. SAF okuma; kasa_gucu bunu kullanır.
    YAKLAŞIKTIR: şehir hesabı paylaşılan havuzdur (bütün kamu ücretleri, işsizlik ödeneği vb. oradan ödenir) ve firmanın kirası ücret yüküne katılmaz; kasa_gucu bir gösterge, söz değildir."""
    d = W.firms[f]
    if sehir_destekli(d):
        return W.cities[d["city"]]["acct"]
    return f


def ilanlar(W, h):
    """h'nin şehrindeki iş ilanları: W.staff_tgt'nin (son haftanın kadro hedefi; işe alım kapısını geçemeyen firmada hedef = mevcut kadro) açık kadrosu pozitif olan canlı firmaları.
    [{firma, ad, sektor, acik, ucret (HAFTALIK: ilan_ucreti × CYCLES_PER_WEEK; kabulde p["wage"] döngü ücreti kalır), kasa_gucu, maas_odeyemedi}], ücrete göre azalan (eşitlikte açık kadro çok olan, sonra ad), en çok 30. Ahır ilan vermez, belediye verir; Ar-Ge DAO'su yalnız econ_core.innov_uygun şartını sağlayan insana (ücret res_wage); insanın kendi işletmesi ilanı değildir.
    ad: modelde işletmenin başka görünen adı yok, kimlik adıdır."""
    tgt = getattr(W, "staff_tgt", None)
    if not tgt:
        return []
    ci = W.people[h]["city"]
    out = []
    for f, t in tgt.items():
        d = W.firms.get(f)
        if d is None or d.get("dead") or d.get("kapaniyor") or d["city"] != ci or d["kind"] == "ahir" or d["owner"] == h or f == W.people[h]["firm"]:
            continue                                                  # kendi işvereni ilan değil (çalışan insan başka ilana başvurur)
        if d["kind"] == "arge" and innov_uygun(W, h) is None:
            continue                                                  # Ar-Ge DAO'su yalnız alım şartını sağlayan araştırmacıya ilan verir (dao.py'nin free_innovators yüklemi)
        acik = int(round(float(t))) - len(d["workers"])
        if acik <= 0:
            continue
        uc = ilan_ucreti(W, h, f)
        yuk = sum(W.people[x]["wage"] for x in d["workers"]) + uc          # mevcut kadro + yeni kişi, döngülük
        out.append({"firma": f, "ad": f, "sektor": d["kind"], "acik": acik, "ucret": _f(uc * CYCLES_PER_WEEK), "kasa_gucu": kasa_gucu(W.L.bal.get(ode_hesabi(W, f), 0.0), yuk), "maas_odeyemedi": maas_odeyemedi(W, f)})
    out.sort(key=lambda i: (-i["ucret"], -i["acik"], i["firma"]))
    return out[:30]


def _f(x):
    """JSON'a uygun ondalık: sonlu değilse None (NaN/Inf asla çıkmaz)."""
    x = float(x)
    return x if math.isfinite(x) else None


def _loncalar(W, sahip):
    """gözlemdeki lonca listesi. HUMAN_LONCA açıkken (F2) her loncaya pay_orani (fee), kredi_verebilir (lendable > 0) ve skor (botun lonca_score'u, düşük iyi; işletme sahibi değilse ya da lonca kapalıysa None) eklenir."""
    out = [{"ad": lo, "mevduat_faizi": _f(W.dep_ema.get(lo, 0.0)), "kapali": lo in W.closed, "mevduat": _f(W.dep_tot.get(lo, 0.0))} for lo in W.loncas]
    if not HUMAN_LONCA:
        return out
    mc = {}
    d = W.firms[sahip] if sahip is not None else None
    if d is not None:
        for g in W.firms.values():
            if not g.get("dead") and g["workers"] and g["kind"] not in ("belediye", "arge", "ahir"):
                mc[g["lonca"]] = mc.get(g["lonca"], 0) + 1
    tot = max(1, sum(mc.values()))
    mcount = defaultdict(int, mc)
    if LONCA_TERMS:
        W._lt_risk = {l_: lo_risk(W, l_) for l_ in W.loncas if l_ not in W.closed}       # REKABET G5: lonca_score'un lo_risk terimi için gözlem boyunca önbellek
    for x in out:
        lo = x["ad"]
        x["pay_orani"] = _f(fee_rate(W, lo))
        x["kredi_verebilir"] = bool(lendable(W, lo) > 0) if not x["kapali"] else False
        x["skor"] = _f((lonca_score(W, d, lo, mcount, tot, f=sahip) if LONCA_TERMS else lonca_score(W, d, lo, mcount, tot))) if d is not None and not x["kapali"] else None
    W.__dict__.pop("_lt_risk", None)
    return out


def _lonca_kur_gozlem(W, h, w):
    """F3: gözlemin lonca_kur ve lonca_kur_ayrinti alanları (eksikleri bir kez hesaplar)."""
    ham = {y: lonca_kur_eksikleri(W, h, w, y) for y in LONCA_KUR_YOLLARI}
    return {"lonca_kur": {y: [e["id"] for e in v] for y, v in ham.items()},
            "lonca_kur_ayrinti": {y: [{k: (_f(x) if k != "id" else x) for k, x in e.items()} for e in v] for y, v in ham.items()}}


def _loncam(W, h):
    """F3 (HUMAN_LONCA): insanın sahibi olduğu lonca: {ad, sermaye, uye_sayisi, kasa, durum} ya da None. durum: "acik" ya da "tehlikede" (gider/kasa sıkıntısı sayacı işliyor)."""
    for lo, (q, _w0) in W.lonca_owner.items():
        if q == h and lo not in W.closed:
            n = sum(1 for g in W.firms.values() if g["lonca"] == lo and not g.get("dead") and g["workers"] and g["kind"] not in ("belediye", "arge", "ahir"))
            return {"ad": lo, "sermaye": _f(W.L.bal.get(f"{lo}_sermaye", 0.0)), "odenen_sermaye": _f(W.human_lonca_odenen.get(lo, 0.0)), "uye_sayisi": n, "kasa": _f(W.L.bal.get(lo, 0.0)), "durum": "tehlikede" if W.lo_low.get(lo, 0) > 0 else "acik"}
    return None


def _yasam_olum(W):
    """F4 (FIRM_LIFE_LOG): insanın ölü işletmesi -> firm_log ölüm satırı (en son). Firma başına dizinden okur (olumler listesi taranmaz, kopyalanmaz)."""
    out = {}
    for r in W.human_hist["firmalar"]:
        if r["died"] is not None:
            y = olum_satiri(W, r["ad"])
            if y is not None:
                out[r["ad"]] = y
    return out


def _faaliyet_fark(r):
    """firm_log haftalık satırından faaliyet kaynaklı kasa farkı: kasa farkı - net kredi nakdi (çekim eksi taksit anaparası) - eklenen sermaye. Ödenen faiz ve ücret/girdi zaten kasa farkındadır."""
    return r["kasa_fark"] - r["kredi_net"] - r.get("sermaye_giris", 0.0)


def _kasa_pisti(W, f, kasa):
    """F4 (FIRM_LIFE_LOG): nakit pisti (hafta) = kasa / son 4 haftanın ortalama net nakit çıkışı; çıkış FAALİYET akışından hesaplanır (kredi çekimi ve sermaye ekleme kasayı büyütse de çıkışı gizlemez).
    Doğum satırı (kasa farkı tanımsız, 0) ortalamaya girmez; ortalama net çıkış pozitif değilse (kasa erimiyor) ya da hesaplanabilir satır yoksa None (sıfıra bölme yok).
    HAM değer döner (yuvarlama yalnız gösterimde; uyarı eşiği ham değerle karşılaştırılır). Negatif kasa 0 sayılır."""
    sat = [r for r in son_satirlar(W, f, 4) if not r.get("yeni")]
    if not sat:
        return None
    cikis = -sum(_faaliyet_fark(r) for r in sat) / len(sat)
    return max(0.0, kasa) / cikis if cikis > 1e-9 else None


def _firma_uyari(W, f, yuk, kasa):
    """F4 (FIRM_LIFE_LOG): canlı işletme için erken uyarı kodları. kasa_2_hafta_alti: kasa / haftalık ücret yükü < 2; kasa_4_hafta_alti (nakit pisti): _kasa_pisti < 4 (bu hızla 4 haftadan kısa dayanır);
    dort_hafta_zarar: son 4 haftalık satırın hepsinde kasa farkı < 0; taksit_gecikti: son satırda kredi_gecikme >= 1. Yalnız firm_log'un firma dizininden (son 4 satır) okur."""
    u = []
    if yuk > 0 and kasa / yuk < 2.0:
        u.append("kasa_2_hafta_alti")
    pist = _kasa_pisti(W, f, kasa)
    if pist is not None and pist < 4.0:
        u.append("kasa_4_hafta_alti")
    sat = son_satirlar(W, f, 4)
    if len(sat) >= 4 and all(_faaliyet_fark(r) < 0 for r in sat):
        u.append("dort_hafta_zarar")
    if sat and sat[-1]["kredi_gecikme"] >= 1:
        u.append("taksit_gecikti")
    return u


def _sektor_egilim(W, sehir, hafta):
    """F4 (FIRM_LIFE_LOG): sehir şehrinin tür başına {tür: (kasa_egilim, firma_sayisi_13hf)}. kasa_egilim = türün şehirdeki toplam kasasının (firm_log haftalık satırı) şimdi eksi 13 hafta önce;
    firma_sayisi_13hf = 13 hafta önce satırı olan firma sayısı. hafta <= 13 ya da kayıt yoksa sözlük boş (gözlem None yazar). Yalnız firma dizinlerini okur (firma başına bir tarama). NOT: toplam kasa kuruluş sermayesiyle doğan firmayı artı, ölen firmanın 13 hafta önceki kasasını eksi sayar; sağlık göstergesi değil, sektörün para stokundaki değişimdir (girişin çok olduğu sektörde artı çıkabilir; firma_sayisi_13hf yanında okunur)."""
    if hafta <= 13:
        return {}
    sim, once, n13 = defaultdict(float), defaultdict(float), defaultdict(int)
    for f, d in W.firms.items():
        if d.get("city") != sehir:
            continue
        for r in son_satirlar(W, f, 14):
            if r["hafta"] == hafta:
                sim[d["kind"]] += r["kasa"]
            elif r["hafta"] == hafta - 13:
                once[d["kind"]] += r["kasa"]
                n13[d["kind"]] += 1
    return {k: (sim[k] - once[k], n13[k]) for k in set(sim) | set(once)}


def gozlem(W):
    """oyuncunun gözlem paketi (tasarım: simulasyon/arayuz T5). Yalnız okur; HUMAN_ON kapalıyken None. Yalnız JSON türleri: sözlük, liste, dizge, sayı, bool, None.
    Gizlilik: kişi kimliği yalnız insanın kendisidir (paketin hiçbir yerinde geçmez); işletme adı yalnız insanın işletmeleri, işvereni, olaylarda adı geçenler ve ilan verenlerdir.
    hafta = yayımlanmış son hafta (hiç oynanmadıysa 0); kurabilir bu haftadan SONRA gönderilen kararın uygulanacağı hafta (hafta + 1) için değerlendirilir.
    servet_dilimi: servet_kinti (oyuncular arasında sıralama tabanlı beşte bir; eşitlikte yarım sayım). Talep yoksa talep_karsilama None.
    ben.tecrube_hafta = terfi sayacının kendisi (skillw / CYCLES_PER_WEEK × (1 + eğitim hızı); SKILL_ALL_WORK=0 iken yalnız özel işyerinde ödenen haftalar, =1 iken her ücretli iş; calisilan_hafta ahır/belediyeyi de sayar ve eğitimi katmaz); ben.terfi_esik = kalfa/usta hafta ve itibar eşikleri.
    ben.is.ucret HAFTALIKTIR (p["wage"] döngü ücreti × CYCLES_PER_WEEK; ilanlar[].ucret ile aynı birim)."""
    if not HUMAN_ON or W.human is None:
        return None
    h = W.human
    p = W.people[h]
    son = int(getattr(W, "w", 0))
    c = W.cities[p["city"]]
    f = p["firm"]
    sahip = _sahip_firma(W, h)
    fd = W.firms[f] if f is not None else None
    if sahip is not None:
        durum = "kurucu"
    elif fd is not None and fd["kind"] == "ahir":
        durum = "ahir"
    elif fd is not None:
        durum = "calisan"
    else:
        durum = "is_arayan"
    unvan = "girisimci" if sahip is not None else ("cirak", "kalfa", "usta")[min(2, max(0, int(p["tier"])))]
    ent = W.deposits.get(h)
    dolu = ent is not None and ent[1] > 1e-9
    firmam = None
    if sahip is not None:
        d = W.firms[sahip]
        kasa = float(W.L.bal.get(sahip, 0.0))
        yuk = sum(W.people[x]["wage"] for x in d["workers"]) * CYCLES_PER_WEEK                    # haftalık ücret yükü
        ks = getattr(W, "human_kasa", None) or {"onc": {}, "bu": {}}
        kdeg = (ks["bu"][sahip] - ks["onc"][sahip]) if sahip in ks["bu"] and sahip in ks["onc"] else None      # F1: bu hafta kasa - geçen hafta kasa (hafta sonu kayıtları)
        firmam = {"ad": sahip, "sektor": d["kind"], "nakit": _f(kasa), "isci": len(d["workers"]), "kar": _f(W.prof_ema.get(sahip, 0.0)), "yas": max(0, son - d["born"]),
                  "kasa_degisim": None if kdeg is None else _f(kdeg), "kasa_hafta": _f(kasa / yuk) if yuk > 0 else None}
        if HUMAN_LONCA:                                      # F2: firmanın loncası ve değiştirilebilir mi (bekleme geçti, açık başka lonca var)
            firmam["lonca"] = d["lonca"]
            firmam["lonca_degisebilir"] = bool(FEE_ACT and son + 1 >= OWNER_WEEK and son + 1 - d.get("sw_last", -999) >= SWITCH_COOL and any(l != d["lonca"] and l not in W.closed for l in W.loncas))      # bot kuralıyla aynı kapılar (FEE_ACT, OWNER_WEEK)
            firmam["lonca_erken_hafta"] = max(0, OWNER_WEEK - (son + 1)) if FEE_ACT else None      # ilk geçişe kalan hafta (0: kapı açık; None: lonca payı kapalı, geçiş yok)
    if sahip is not None and HIRE_TARGET:
        ih_ = W.firms[sahip].get("insan_hedef")
        firmam["hedef"] = None if ih_ is None else min(ih_, int(W.firms[sahip]["capacity"]))      # REKABET G17i: insanın kadro hedefi (karar yoksa None: bot sezgisi); kapasite üst sınırı
        firmam["kapasite"] = int(W.firms[sahip]["capacity"])
    if sahip is not None and FIRM_LIFE_LOG:
        firmam["uyari"] = _firma_uyari(W, sahip, yuk, kasa)      # F4: erken uyarı kodları
        pist = _kasa_pisti(W, sahip, kasa)
        firmam["kasa_pisti_hafta"] = None if pist is None else round(pist, 1)      # F4: nakit pisti (hafta, bir ondalık); kasa erimiyorsa None
    eks = kur_eksikleri(W, h, son + 1)
    sek = []
    for u, k in PRODUCER.items():
        if k == "ahir":
            continue
        n = sum(1 for g in c["firms"] if W.firms[g]["kind"] == k and not W.firms[g].get("dead"))
        sek.append({"sektor": k, "urun": u, "fiyat": _f(W.PRICE[(c["i"], u)]) if (c["i"], u) in W.PRICE else None, "firma": n,
                    "eksik": _f(W.last_root_short_val.get(u, 0.0)), "disaridan": _f(c["last_imports"].get(u, 0.0))})      # F1: iki ayrı alan (eski: eksik + 0,5 × ithalat)
        if ENTRY_COOLDOWN:
            sek[-1]["bekleme"] = max(0, ENTRY_COOLDOWN - (son + 1 - W.LAST_ENTRY.get((c["i"], u), -999)))      # denge G4: kalan bekleme haftası (0 = serbest)
    if MARKET_OPEN:                                          # M15: market kurulabilir sektör listesinde (urun yok; eksik = talep/kapasite darboğazı oranı)
        n = sum(1 for g in c["firms"] if W.firms[g]["kind"] == "market" and not W.firms[g].get("dead"))
        sek.append({"sektor": "market", "urun": "perakende", "fiyat": 0.0, "firma": n, "eksik": _f(mk_bottleneck(W, c)), "disaridan": 0.0})
    if FIRM_LIFE_LOG:                                        # F4: sektör eğilimi (kasa farkı ve 13 hafta önceki firma sayısı)
        egl = _sektor_egilim(W, c["i"], int(getattr(W, "week_no", 0)))
        for x in sek:
            e = egl.get(x["sektor"], (0.0, 0)) if egl else (None, None)
            x["kasa_egilim"] = None if e[0] is None else _f(e[0])
            x["firma_sayisi_13hf"] = e[1]
    yo = _yasam_olum(W) if FIRM_LIFE_LOG else {}
    gec = []
    for r in W.human_hist["firmalar"]:
        d = W.firms.get(r["ad"])
        olu = r["died"] is not None or (d is not None and bool(d.get("dead")))
        bitis = r["died"] if r["died"] is not None else (d.get("died", son) if olu and d is not None else son)
        gec.append({"ad": r["ad"], "sektor": r["sektor"], "yas": max(0, int(bitis) - r["born"]), "ayakta": not olu,
                    "neden": (r.get("neden") or W.human_batis.get(r["ad"], "diger")) if olu else None, "olum_haftasi": int(bitis) if olu else None})
        if FIRM_LIFE_LOG and olu:                                # F4: firm_log ölüm kodu (eski `neden` üç kodu kalır, kayıtlı oyunlar okunur) ve son 8 hafta
            y = yo.get(r["ad"])
            if y is not None:
                gec[-1].update(neden_ayrinti=y["neden"], yakin_neden=y.get("yakin_neden") or None, kok_neden=y.get("kok_neden") or None, son8_kasa_farki=_f(y["son8_kasa_farki"]), son8_ciro=_f(y["son8_ciro"]), son8_ucret=_f(y["son8_ucret"]))
    pref = W.human_pref
    return {
        "hafta": son,
        "ben": {"sehir": p["city"], "nakit": _f(W.L.bal.get(h, 0.0)),
                "mevduat": {"lonca": ent[0] if dolu else None, "tutar": _f(ent[1]) if dolu else 0.0},
                "is": {"firma": f, "sektor": fd["kind"] if fd is not None else None, "ucret": _f(p.get("wage", 0.0) * CYCLES_PER_WEEK) if f is not None else 0.0},
                "durum": durum, "calisilan_hafta": int(W.worked.get(h, 0) // CYCLES_PER_WEEK), "itibar": _f(W.REP.get(h, 0.0)),
                "tecrube_hafta": _f(W.skillw.get(h, 0.0) / CYCLES_PER_WEEK * (1.0 + (EDU_SPEED[W.edu_lvl.get(h, 0)] if W.EDU_ON else 0.0))),
                "terfi_esik": {"kalfa": {"hafta": _f(KALFA_WEEKS), "itibar": _f(REP_KALFA)}, "usta": {"hafta": _f(USTA_WEEKS), "itibar": _f(REP_USTA)}},
                "servet_dilimi": servet_kinti(W, h), "unvan": unvan,
                **({"loncam": _loncam(W, h)} if HUMAN_LONCA else {})},      # F3: kurduğum lonca
        "firmam": firmam,
        "kurabilir": {"evet": not eks, "eksikler": eks, **({"bekleyen": [x["sektor"] for x in sek if x.get("bekleme")]} if ENTRY_COOLDOWN else {}), "harc": 0.0 if kur_yeni_yol() else _f(ix(W, FOUND_HARC)), "gereken_hafta": max(1, FOUND_WORKED // CYCLES_PER_WEEK)},
        "sektorler": sek,
        "loncalar": _loncalar(W, sahip),
        **(_lonca_kur_gozlem(W, h, son + 1) if HUMAN_LONCA else {}),      # F3: lonca_kur (yol -> eksik kimlikleri; boş = kurulabilir) ve lonca_kur_ayrinti (kimlik + gereken/eldeki/kalan)
        "sehir": {"talep_karsilama": _f(c["got_units"] / c["dem_units"]) if c["dem_units"] > 0 else None, "is_arayan": len(c["seekers"])},
        "tercih": {"mevduat": {"lonca": pref["lonca"], "oran": _f(pref["oran"])} if pref is not None else None},
        "gecmis": {"dilim0": W.human_hist["dilim0"] // 2 + 1, "firmalar": gec},
        "olaylar": [dict(e) for e in W.human_ev],
        "ilanlar": ilanlar(W, h),
    }
