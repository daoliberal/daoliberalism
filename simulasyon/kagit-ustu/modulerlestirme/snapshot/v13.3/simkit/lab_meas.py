"""simkit.lab_meas: davranışsız iş piyasası ölçüm yardımcıları (PLAN-KREDI T5, §4.6; yalnız KR_MEAS=1 iken çağrılır).

AMAÇ: işe alım ve işten çıkış olaylarını `W.lab_stat` (birikimli sayaç, anahtar `<olay>_<firma türü>`) içinde sayar; firma türünü KURULUŞTA bir kez `W.lab_type[f]` içine damgalar.
  Tür sonraki sınıf değişimlerini (özelleştirme, medya satışı, org_owner) İZLEMEZ: böylece her tür için hafta içi Σ işe alım - Σ çıkış = çalışan değişimi tam kapanır.
  Türler: npc (sahipsiz, ahır ve belediye dışı), player (sahibi oyuncu ya da org_owner'lı, DAO hariç), dao (kind "arge"), public (ahır, belediye); sunucunun `labour` bloğuyla aynı sınıflama.
  Olay anahtarları: `ise` (her işe alım/giriş), `cikis_<neden>` (neden: ucret, kuculme, ayrilma, dao, olum, gecis, belediye, goc, egitim, diger; DAO oyunu HUMAN_ON: ahir, is_degistirme), `kurucu_ucret_cikis` (türsüz).
ARAYÜZ: lab_kind, lab_stamp, lab_type, lab_ev, human_batis (DAO oyunu: insanın işletmesinin batış nedeni işareti), human_cikis (DAO oyunu: insanın istemsiz iş kaybı nedeni işareti; yalnız HUMAN_ON ve q == W.human iken W.human_cikis'e yazar)
OKUR: W.firms, W.lab_type. YAZAR: yalnız W.lab_type ve W.lab_stat (hiçbir karara girmez; L.flows'a ve sonuç sözlüğüne yazılmaz).
KATMAN: L0 (yalnız params).
"""
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
