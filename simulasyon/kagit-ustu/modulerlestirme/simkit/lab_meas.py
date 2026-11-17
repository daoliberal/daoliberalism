"""simkit.lab_meas: davranışsız iş piyasası ölçüm yardımcıları (PLAN-KREDI T5, §4.6; yalnız KR_MEAS=1 iken çağrılır).

AMAÇ: işe alım ve işten çıkış olaylarını `W.lab_stat` (birikimli sayaç, anahtar `<olay>_<firma türü>`) içinde sayar; firma türünü KURULUŞTA bir kez `W.lab_type[f]` içine damgalar.
  Tür sonraki sınıf değişimlerini (özelleştirme, medya satışı, org_owner) İZLEMEZ: böylece her tür için hafta içi Σ işe alım - Σ çıkış = çalışan değişimi tam kapanır.
  Türler: npc (sahipsiz, ahır ve belediye dışı), player (sahibi oyuncu ya da org_owner'lı, DAO hariç), dao (kind "arge"), public (ahır, belediye); sunucunun `labour` bloğuyla aynı sınıflama.
  Olay anahtarları: `ise` (her işe alım/giriş), `cikis_<neden>` (neden: ucret, kuculme, ayrilma, dao, olum, gecis, belediye, goc, egitim, diger; DAO oyunu HUMAN_ON: ahir, is_degistirme), `kurucu_ucret_cikis` (türsüz).
ARAYÜZ: hk_snap (REKABET G17a: işe alım kapı dökümü satırı), hk_yol (satırı yolla kapatır), hij_say (hijyen ölçümü sayacı), lab_kind, lab_stamp, lab_type, lab_ev, human_batis (DAO oyunu: insanın işletmesinin batış nedeni işareti), human_cikis (DAO oyunu: insanın istemsiz iş kaybı nedeni işareti; yalnız HUMAN_ON ve q == W.human iken W.human_cikis'e yazar)
OKUR: W.firms, W.lab_type. YAZAR: yalnız W.lab_type ve W.lab_stat (hiçbir karara girmez; L.flows'a ve sonuç sözlüğüne yazılmaz).
  REKABET G17a (KR_MEAS=1): W.hk_rows (haftalık firma başına işe alım kapı satırı), okunan ve sıfırlanan sayaçlar W.hk_dem, W.hk_sp (market.clear_fp), W.hk_so (week_cycle_parts.phase_cycle_buy); yalnız KR_MEAS açıkken oluşur.
KATMAN: L0 (yalnız params).
"""
from collections import defaultdict
from simkit.params import *          # noqa: F401,F403

_PUBLIC = ("ahir", "belediye")


def lab_kind(W, f):
    """firmanın ANLIK sınıfı (kuruluşta damgalanır): public (ahır, belediye), dao (arge), player (sahibi ya da org_owner'ı olan), npc."""
    d = W.firms[f]
    k = d.get("kind")
    if k in _PUBLIC:
        return "public"
    if k == "arge":
        return "dao"
    return "player" if (d.get("owner") is not None or d.get("org_owner")) else "npc"


def lab_stamp(W, f):
    """firmanın türünü bir kez damgalar (ikinci çağrı değiştirmez); firma yoksa dokunmaz."""
    lt = W.lab_type
    if f not in lt and f in W.firms:
        lt[f] = lab_kind(W, f)
    return lt.get(f)


def lab_type(W, f):
    """damgalı tür; kuruluşta kaçırılmış firma ilk olayında damgalanır."""
    t = W.lab_type.get(f)
    return t if t is not None else lab_stamp(W, f)


def lab_ev(W, ev, f, n=1):
    """`ev` olayını f firmasının türü adına n kez sayar (örn. lab_ev(W, "cikis_ucret", f))."""
    W.lab_stat[f"{ev}_{lab_type(W, f)}"] += n


def human_cikis(W, q, neden):
    """çıkarma noktaları (K-23 ücret ödenemedi, küçültme, firma ölümü/temerrüdü) çağırır: q insansa nedeni işaretler; human_week_end okuyup temizler. Başkasına dokunmaz."""
    if HUMAN_ON and q == W.human:
        W.human_cikis = neden


def human_batis(W, f, d):
    """kurucusu ayrılan (işçisiz kalan) oyuncu firmasının GERÇEK ölüm noktası (week_close) çağırır: firma insanın işletmesiyse batış nedenini W.human_batis[f]'ye yazar (human_week_end `firma_batti.neden` olarak okur).
    Neden, ölümün o haftaki izinden: `sahip_ayrildi` (insan ayrıl kararıyla kapattı), `kredi_odenemedi` (temerrüt: kredi tasfiyesi işçileri dağıttı), `ucret_odenmedi` (insan ücret ödenemediği için işten çıktı: kasa ücreti karşılamadı),
    aksi `diger`. Başkasının firmasına ve HUMAN_ON kapalıyken hiçbir şeye dokunmaz."""
    if HUMAN_ON and d.get("owner") == W.human:
        if d.get("kapaniyor"):
            W.human_batis[f] = "sahip_ayrildi"
        elif d.get("defaulted"):
            W.human_batis[f] = "kredi_odenemedi"
        elif W.human_cikis == "ucret_odenmedi":
            W.human_batis[f] = "ucret_odenmedi"
        else:
            W.human_batis[f] = "diger"


def hij_say(W, ad, q=None, yeni=False):
    """Davranışsız sayaç (hijyen ölçümü; KR_MEAS'tan bağımsız, çıktıya/flows'a yazılmaz): W.hij_cnt[ad] += 1. ad == "ise": q'nun bu hafta işe alındığı damgalanır (W.hij_hw). ad == "ucret_cikis": ücret ödenemediği için çıkış; q bu hafta alınmışsa (ya da yeni: avans fazı) ayrıca "ayni_hf_cikis" sayılır."""
    cnt = getattr(W, "hij_cnt", None)
    if cnt is None:
        cnt = W.hij_cnt = defaultdict(int)
        W.hij_hw = {}
    cnt[ad] += 1
    if ad == "ise":
        W.hij_hw[q] = W.week_no
    elif ad == "ucret_cikis" and (yeni or W.hij_hw.get(q) == W.week_no):
        cnt["ayni_hf_cikis"] += 1


def hk_snap(W, w, c, fname, d, fn):
    """REKABET G17a (KR_MEAS=1, davranışsız): sahipli firmanın bu haftaki işe alım kararı için kapı dökümü satırı (SAF okuma; yalnız W.hk_dem/hk_sp/hk_so sayaçlarını okur ve sıfırlar).
    fn: kapı işlevleri sözlüğü, çağıran (week_people) kendi modül kopyasından verir (lab_meas L0'dır, üst katmanı içe aktaramaz): wc working_capital, kopru credit_core.kopru_limit, gate econ_core.hire_gate,
    sb sb_hire_ok, sm sm_hire_ok, pm prod_mult, fee econ_core.fee_rate. Satır W.hk_rows'a hk_yol ile eklenir. Gerçek dünya karşılığı: işletmenin işe alım kararındaki sıralı eleme (talep, finansman, işgücü).
    KAPI SÜTUNLARI ESKİ YOLUN KAPILARIDIR: g_wc = kasa >= GROW_FACTOR x wc1 (çarpanlı); HIRE_TARGET açıkken gerçek karar çarpansız `kasa + köprü >= wc1` ölçütüyle verilir (son inceleme K4), bu yüzden HT koşularında g_wc ve yalniz_bu istatistiği eski kapıyı ölçer; HT yolunun sonucu `yol` sütunundadır."""
    L = W.L
    people, firms = W.people, W.firms
    n = len(d["workers"])
    bal = L.bal[fname]
    r = dict(w=w, f=fname, k=d["kind"], ci=c["i"], n=n, cap=d["capacity"], bal=round(bal, 1), own=d.get("owner"))      # own: sahip kimliği (REKABET G17h ölçüm: aynı sahibin yeniden kuruluşu)
    wc1 = fn["wc"](W, firms, people, fname, 1)
    r["wc1"] = round(wc1, 1)
    r["g_sb"] = (not SECTOR_BOARD) or fn["sb"](W, d)
    r["g_sm"] = fn["sm"](W, d, fname)
    r["g_cap"] = n < d["capacity"]
    r["g_wc"] = bal >= GROW_FACTOR * wc1                          # ESKİ yolun kasa kapısı (çarpanlı). HIRE_TARGET yolu çarpansız `bal + köprü >= wc1` kullanır; HT açık koşularda g_wc / yalniz_bu bu eski kapıyı ölçer (son inceleme K4), HT yolunun gerçek kapısı ilk_kapanan yolunda (kasa_kap / hedefte) görünür
    r["g_hc"] = fn["gate"](W, fname, bal, fn["kopru"](W, fname))[0]
    r["sm_so"] = d.get("sm_so", 0)
    r["uns"] = d.get("uns_prev")
    r["sp"] = d.get("sold_prev")
    r["capu"] = r["des"] = None
    if d["kind"] != "market" and W.RECIPES[d["kind"]][0]:
        r["capu"] = next(iter(W.RECIPES[d["kind"]][0].values())) * d.get("tech", 1.0) * fn["pm"](W, d) * n
        r["des"] = d.get("sm_des")
    r["seek"] = len(c["seekers"])
    r["pool"] = len(c["pool"])
    ln_ = W.loans.get(fname)
    r["ln"] = round(ln_["out"], 1) if ln_ else 0.0
    dem = W.__dict__.get("hk_dem")
    sp0 = W.__dict__.get("hk_sp")
    so = W.__dict__.get("hk_so")
    r["dem0"] = round(dem.pop(fname, 0.0), 2) if dem is not None else 0.0
    r["sp0"] = round(sp0.pop(fname, 0.0), 2) if sp0 is not None else 0.0
    s_ = so.pop(fname, None) if so is not None else None
    r["ncyc"], r["nfull"], r["off"], r["rem"] = (s_[0], s_[1], round(s_[2], 2), round(s_[3], 2)) if s_ else (0, 0, 0.0, 0.0)
    r["fpm"] = round(W.FPM.get(fname, 1.0), 4)
    r["q"] = round(d.get("q", QDEF), 4)
    r["orep"] = round(W.orep.get(fname, 50.0), 2)
    r["tech"] = round(d.get("tech", 1.0), 4)
    r["pm"] = round(fn["pm"](W, d), 4)
    if FIRM_PROD:
        r["fc_rel"] = round(d.get("fc_rel", 1.0), 4)             # REKABET G17g: firmanın hücre içi göreli verimi (ölçüm; FIRM_PROD kapalıyken anahtar yok)
        if "fc_z" in d:
            r["fc_z"] = round(d["fc_z"], 4)                       # REKABET G17h ölçüm: doğuştan (kalıcı) verim; fc_rel'deki öğrenme etkisini ayırır (FIRM_PROD kapalıyken anahtar yok; kuruluş haftası satırı fc_step'ten önce alınır, fc_z henüz yok: anahtar yok, csv'de boş)
    r["fee"] = round(fn["fee"](W, d["lonca"]), 4) if d.get("lonca") else None
    return r


def hk_yol(W, rec, yol):
    """hk_snap satırını yolla kapatır ve W.hk_rows'a ekler (satır başına bir kez; yol yazılmışsa dokunmaz). yol: shrink, smfire, sb, sm, kasa_kap, ise, isci_yok (kapıları açık, işçi bulamadı), ulasilmadi (şehir döngüsü başka firmanın işçi bulamamasıyla kesildi; karara varmadı, kapı alanları yine dolu), yk, insan (REKABET G17i: insan işletmesi kadro kararıyla hedefe indi). hedefte (son inceleme K1: HIRE_TARGET yolunda kadro zaten hedefte, kapıya gelinmedi; kasa_kap değil).
    Not: dem0/sp0/ncyc/nfull/off/rem bir önceki haftanın döngülerini anlatır (snap hafta başında alınır); fpm, q, n, bal anlıktır."""
    if rec is None or "yol" in rec:
        return
    rec["yol"] = yol
    rows = W.__dict__.get("hk_rows")
    if rows is None:
        rows = W.hk_rows = []
    rows.append(rec)
