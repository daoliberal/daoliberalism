"""B4a: yönetici durumu dışa/içe aktarımı, yeniden oynatma günlüğü, `devam` / `tariften_oynat`, kadans, tel biçimi (Python tarafı).

Hızlı testler sahte host; gerçek modelli olanlar yavaştır (`OYUN_QUICK=1` ile atlanır). Gerçek model eşitlikleri kesintisiz koşuyla BAYT BAYT karşılaştırılır
(paket JSON'u, `run_id` dahil: devam aynı koşu kimliğiyle kurulur).
"""
from __future__ import annotations

import copy
import json
import os
import time
import unittest
from pathlib import Path

from oyun_server.tarayici import devam as devam_mod
from oyun_server.tarayici import goruntu
from oyun_server.tarayici.cekirdek import PAKET_PENCERESI, TarayiciCekirdegi

from tests.registry_helpers import real_defaults, real_registry
from tests.route_helpers import CONFIG
from tests.test_tarayici_cekirdek import adim, bekle_hafta, cagri, cekirdek

YAVAS = unittest.skipIf(os.environ.get("OYUN_QUICK") == "1", "yavaş (gerçek model)")
TEL = Path(__file__).resolve().parent.parent / "oyun_server" / "tarayici" / "tel_b4.json"
PY = "0.27.7-test"
YAMA = {"gecis_destegi": "kisa_sureli", "ucret_stopaji": 25}               # çift anahtarlı canlı yama (TRANS_SUPPORT + WAGE_TAX)


def dao_tarifi() -> dict:
    return {k: v for k, v in CONFIG.items() if k != "durationWeeks"} | {"mode": "dao"}


def gercek_cekirdek(**kw) -> TarayiciCekirdegi:
    return TarayiciCekirdegi(defaults=real_defaults(), registry=real_registry(), pyodide_surumu=PY, **kw)


def sur(c: TarayiciCekirdegi, rid: str, w: int) -> None:
    """Hafta `w` yayımlanıp işçi haftası yayımlananla eşit olana dek (en çok bir adım atar)."""
    if c.manager.stats(rid)["released"] < w:
        adim(c, rid)
    son = time.monotonic() + 300
    while True:
        st = c.manager.stats(rid)
        if st["released"] >= w and st["worker_week"] == st["released"]:
            return
        c.tick()
        if time.monotonic() > son:
            raise AssertionError("hafta %d gelmedi: %r" % (w, st))


class Depo:
    """JS/IndexedDB rolü: abone olur, hafta paketlerini ve dünya olaylarını biriktirir."""

    def __init__(self, c: TarayiciCekirdegi, rid: str):
        self.c, self.rid, self.haftalar, self.dunya = c, rid, {}, []
        self.abone = c.istek("GET", f"/api/runs/{rid}/events")["body"]["abone"]

    def bosalt(self) -> None:
        for o in self.c.olaylar(self.abone)["olaylar"]:
            if o["event"] == "week":
                self.haftalar[o["data"]["week"]] = o["data"]
            elif o["event"] == "world_event":
                self.dunya.append(o["data"])


def tur_uyar(x, spec, yol="$") -> list:
    """`tel_b4.json` tür dizgeleri/şekilleri (bkz. dosyadaki `_aciklama`). Uyuşmazlık listesi (boş = uyumlu)."""
    if isinstance(spec, str):
        def ok(t):
            return {"int": isinstance(x, int) and not isinstance(x, bool), "num": isinstance(x, (int, float)) and not isinstance(x, bool), "str": isinstance(x, str),
                    "bool": isinstance(x, bool), "null": x is None, "dict": isinstance(x, dict), "list": isinstance(x, list)}[t]
        return [] if any(ok(t) for t in spec.split("|")) else ["%s: %r tür %s değil" % (yol, type(x).__name__, spec)]
    if isinstance(spec, list):
        if not isinstance(x, list):
            return ["%s: liste değil" % yol]
        return [m for i, e in enumerate(x) for m in tur_uyar(e, spec[0], "%s[%d]" % (yol, i))]
    if not isinstance(x, dict):
        return ["%s: nesne değil" % yol]
    out = []
    zorunlu = {k for k in spec if not k.endswith("?")}
    izinli = {k.rstrip("?") for k in spec}
    out += ["%s.%s: eksik" % (yol, k) for k in sorted(zorunlu - set(x))]
    out += ["%s.%s: beklenmeyen" % (yol, k) for k in sorted(set(x) - izinli)]
    for k in x:
        if k in izinli:
            out += tur_uyar(x[k], spec[k] if k in spec else spec[k + "?"], "%s.%s" % (yol, k))
    return out


def j(o) -> str:
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


# ---- hızlı: sahte host -------------------------------------------------------------------------------------------------
class YoneticiDurumu(unittest.TestCase):
    def setUp(self):
        self.c = cekirdek(pyodide_surumu=PY)
        self.addCleanup(self.c.kapat)
        self.rid = cagri(self.c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]

    def test_alanlar_run_ile_eksiksiz(self):
        run = self.c.manager._runs[self.rid]
        yazilan, disarida = set(devam_mod.ALANLAR), set(devam_mod.DISARIDA)
        self.assertFalse(yazilan & disarida)
        self.assertEqual(set(run.__dict__), yazilan | disarida, "yeni/eksik `_Run` alanı: ya ALANLAR'a ya gerekçeyle DISARIDA'ya")

    def test_dis_aktarim_json_ve_alanlar(self):
        adim(self.c, self.rid, 2)
        bekle_hafta(self.c, self.rid, 2)
        d = devam_mod.disa_aktar(self.c.manager, self.rid, "k1")
        self.assertEqual(json.loads(json.dumps(d)), d)
        self.assertEqual(set(d), set(devam_mod.ALANLAR) | {"sema", "goruntu_kimligi"})
        self.assertEqual((d["released"], d["id"], d["sema"], d["goruntu_kimligi"]), (2, self.rid, devam_mod.SEMA, "k1"))
        self.assertEqual([n for n, _ in d["version_sets"]], [1])

    def test_hazir_degilken_goruntu_alinmaz(self):
        run = self.c.manager._runs[self.rid]
        run.computing = True
        with self.assertRaises(devam_mod.GoruntuHazirDegil):
            devam_mod.disa_aktar(self.c.manager, self.rid, "k")
        run.computing = False
        run.prep = {"total": 3}
        with self.assertRaises(devam_mod.GoruntuHazirDegil):
            devam_mod.disa_aktar(self.c.manager, self.rid, "k")
        run.prep = None
        run.status = "failed"
        with self.assertRaises(devam_mod.GoruntuHazirDegil):
            devam_mod.disa_aktar(self.c.manager, self.rid, "k")

    def test_ayri_kadans_karari(self):
        c = self.c
        self.assertFalse(c.goruntu_gerekli(self.rid))
        run = c.manager._runs[self.rid]
        run.released = 12
        self.assertFalse(c.goruntu_gerekli(self.rid))
        run.released = 13
        self.assertTrue(c.goruntu_gerekli(self.rid))
        c._goruntu_kaydi[self.rid] = (13, 100)                                              # görüntü alındı (ham küçük): sonraki 26. haftada
        run.released = 25
        self.assertFalse(c.goruntu_gerekli(self.rid))
        run.released = 26
        self.assertTrue(c.goruntu_gerekli(self.rid))
        c._goruntu_kaydi[self.rid] = (13, goruntu.HAM_ESIK_BAYT + 1)                       # ham görüntü > 300 MB: kadans 26 hafta
        run.released = 38
        self.assertFalse(c.goruntu_gerekli(self.rid))
        run.released = 39
        self.assertTrue(c.goruntu_gerekli(self.rid))
        self.assertFalse(c.goruntu_gerekli("yok"))


class Gunluk(unittest.TestCase):
    def test_sart_degisikligi_gunluge_girer_sunucu_kipinde_girmez(self):
        c = cekirdek()
        self.addCleanup(c.kapat)
        rid = cagri(c, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
        adim(c, rid, 3)
        bekle_hafta(c, rid, 3)
        r = cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": YAMA, "note": "deneme"})[2]
        self.assertTrue(r["accepted"], r)
        g = c.gunluk_al(rid)
        self.assertEqual(len(g), 1)
        self.assertEqual({k: g[0][k] for k in ("sira", "tur", "dikis", "yama", "not", "surum")},
                         {"sira": 1, "tur": "sart", "dikis": r["seamWeek"], "yama": YAMA, "not": "deneme", "surum": r["version"]})
        self.assertEqual(c.gunluk_al(rid, 1), [])
        self.assertEqual(c.tarif_al(rid)["takvim"], [])                                       # kuruluş takvimi: canlı kabul edilenler günlükte, tarifte değil
        self.assertEqual(c.tarif_al(rid)["config"]["templateId"], CONFIG["templateId"])
        from oyun_server.runs.manager import RunManager
        self.assertFalse(RunManager.gunluk_kayit)                                            # sunucu yöneticisi kayıt tutmaz

    def test_sunucu_yoneticisi_gunluk_tutmaz(self):
        from tests.route_helpers import live_app, call
        with live_app() as (srv, app, workers):
            rid = call(srv, "POST", "/api/runs", {"config": CONFIG})[2]["runId"]
            self.assertFalse(app.manager.gunluk_kayit)
            self.assertEqual(app.manager._runs[rid].gunluk, [])


# ---- yavaş: gerçek model ----------------------------------------------------------------------------------------------
@YAVAS
class GercekKucuk(unittest.TestCase):
    """2 haftalık DAO koşusunun görüntüsünü bir kez alır; hata/dal/tel sınamaları ondan."""
    S = 2

    @classmethod
    def setUpClass(cls):
        c = gercek_cekirdek()
        rid = cagri(c, "POST", "/api/runs", {"config": dao_tarifi()})[2]["runId"]
        d = Depo(c, rid)
        cagri(c, "POST", f"/api/runs/{rid}/dao/karar", {"tur": "ahirdan_cik"})
        for w in range(1, cls.S + 1):
            sur(c, rid, w)
        d.bosalt()
        parcalar: list = []
        cls.bilgi = c.goruntu_al(rid, parcalar.append)
        cls.rid, cls.parcalar = rid, parcalar
        cls.paketler = [d.haftalar[w] for w in sorted(d.haftalar)]
        cls.gunluk = c.gunluk_al(rid)
        cls.tarif = c.tarif_al(rid)
        c.kapat()

    def goruntu(self, **ek):
        return {"parcalar": list(self.parcalar), "yonetici": copy.deepcopy(self.bilgi["yonetici"]), **ek}

    def test_goruntu_al_sonuc_ve_tel_bicimi(self):
        b = self.bilgi
        self.assertEqual((b["hafta"], b["yayimlanan"], b["gunluk_sira"]), (self.S, self.S, 1))
        self.assertEqual(b["anahtar"], goruntu.uyumluluk_anahtari(None, PY))
        self.assertEqual(b["parca"], len(self.parcalar))
        self.assertTrue(all(isinstance(p, bytes) for p in self.parcalar))
        tel = json.loads(TEL.read_text(encoding="utf-8"))
        self.assertEqual(tur_uyar({k: v for k, v in b.items() if k != "yonetici"}, tel["goruntu_al"]), [])
        self.assertEqual(tur_uyar(b["yonetici"], tel["yonetici"]), [])
        self.assertEqual(json.loads(json.dumps(b)), b)                                       # tümü JSON'a dönüşür
        self.assertEqual(tur_uyar(self.gunluk[0], tel["gunluk"]["karar"]), [])
        self.assertEqual(tur_uyar(self.tarif, tel["tarif"]), [])
        self.assertEqual(tur_uyar(b["anahtar"], tel["anahtar"]), [])
        self.assertEqual(tel["sabitler"], {"kadans": goruntu.GORUNTU_KADANS, "kadans_uzun": goruntu.GORUNTU_KADANS_UZUN, "ham_esik_bayt": goruntu.HAM_ESIK_BAYT,
                                           "paket_penceresi": PAKET_PENCERESI, "devam_azami_hafta": 12, "yonetici_sema": devam_mod.SEMA, "goruntu_sema": goruntu.SCHEMA,
                                           "host_sema": goruntu.HOST_SEMA})

    def test_devam_sonuc_bicimi_ve_ayni_kimlik(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        r = c.devam(self.goruntu(), self.gunluk, self.S, paketler=copy.deepcopy(self.paketler))
        tel = json.loads(TEL.read_text(encoding="utf-8"))
        self.assertEqual(tur_uyar(r, tel["devam_sonuc"]), [])
        self.assertEqual((r["durum"], r["kosu_id"], r["hafta"], r["uygulanan"], r["kalan"]), ("tamam", self.rid, self.S, 0, 0))
        st = cagri(c, "GET", f"/api/runs/{self.rid}")[2]["state"]
        self.assertEqual((st["week"], st["status"]), (self.S, "paused"))
        self.assertEqual(c.manager._runs[self.rid].packet_base, 0)
        self.assertEqual([p["week"] for p in c.manager._runs[self.rid].packets], [1, 2])

    def test_hedef_hafta_siniri(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        with self.assertRaises(ValueError) as cm:
            c.devam(self.goruntu(), [], self.S + 13)
        self.assertIn("devam_cok_uzun", str(cm.exception))
        with self.assertRaises(ValueError):
            c.devam(self.goruntu(), [], self.S - 1)
        self.assertEqual(c.manager._runs, {})                                                # hiçbir şey kurulmadı

    def test_uyumsuz_pyodide_belirli_hata_ve_temiz(self):
        c = TarayiciCekirdegi(defaults=real_defaults(), registry=real_registry(), pyodide_surumu="0.28.0")
        self.addCleanup(c.kapat)
        with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
            c.devam(self.goruntu(), [], self.S)
        self.assertEqual(cm.exception.fark["pyodide"], (PY, "0.28.0"))
        self.assertEqual(c.manager._runs, {})                                                # işçi söküldü, koşu kaydı yok

    def test_eslesmeyen_yonetici_durumu_reddedilir(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        g = self.goruntu()
        g["yonetici"]["goruntu_kimligi"] = "baska"
        with self.assertRaises(ValueError):
            c.devam(g, [], self.S)
        self.assertEqual(c.manager._runs, {})

    def test_dal_yeni_kimlik_ebeveyn_yasar_ayni_paketler(self):
        """Dal: görüntü yeni koşu kimliğiyle yüklenir (ebeveyn yaşar); iki koşu aynı kararla ilerleyince paketler `run_id` dışında eşit."""
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        r1 = c.devam(self.goruntu(), self.gunluk, self.S, paketler=copy.deepcopy(self.paketler))
        r2 = c.devam(self.goruntu(), self.gunluk, self.S, paketler=copy.deepcopy(self.paketler), kosu_id="dal-1", ebeveyn=(self.rid, self.S))
        self.assertEqual((r1["durum"], r2["durum"], r2["kosu_id"]), ("tamam", "tamam", "dal-1"))
        d1, d2 = Depo(c, self.rid), Depo(c, "dal-1")
        for rid in (self.rid, "dal-1"):
            sur(c, rid, self.S + 1)
        d1.bosalt()
        d2.bosalt()
        a, b = copy.deepcopy(d1.haftalar[self.S + 1]), copy.deepcopy(d2.haftalar[self.S + 1])
        self.assertEqual((a.pop("run_id"), b.pop("run_id")), (self.rid, "dal-1"))
        self.assertEqual(j(a), j(b))
        st = cagri(c, "GET", "/api/runs/dal-1")[2]["state"]
        self.assertEqual((st["parentRunId"], st["forkWeek"]), (self.rid, self.S))
        self.assertTrue(all(p["run_id"] == "dal-1" for p in d2.haftalar.values()))              # pencere paketleri yeni kimliğe yazıldı
        with self.assertRaises(ValueError):                                                     # var olan kimlik
            c.devam(self.goruntu(), [], self.S, kosu_id="dal-1")

    def test_tariften_oynat_reddedilen_kararda_durur(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        g = [{"sira": 1, "tur": "karar", "dikis": 0, "karar": {"tur": "ahirdan_cik"}},
             {"sira": 2, "tur": "karar", "dikis": 2, "karar": {"tur": "ahirdan_cik"}}]        # ahırda değilken: reddedilir
        r = c.tariften_oynat(self.tarif, g, 5, kosu_id="yeni-1")
        self.assertEqual((r["durum"], r["hafta"], r["uygulanan"], r["kalan"]), ("reddedildi", 2, 1, 1))
        self.assertEqual(r["giris"]["sira"], 2)
        self.assertIsInstance(r["neden"], str)
        self.assertEqual(tur_uyar(r, json.loads(TEL.read_text(encoding="utf-8"))["devam_sonuc"]), [])
        self.assertEqual(c.manager.stats("yeni-1")["released"], 2)                              # durdu: 5. haftaya gitmedi

    def test_tariften_oynat_dikis_gecmis_sapma(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        r = c.tariften_oynat(self.tarif, [{"sira": 1, "tur": "karar", "dikis": 0, "karar": {"tur": "ahirdan_cik"}},
                                          {"sira": 3, "tur": "karar", "dikis": 1, "karar": {"tur": "mevduat", "lonca": "lonca0", "oran": 0.3}}], 3, kosu_id="yeni-2")
        self.assertEqual((r["durum"], r["neden"]), ("sapma", "gunluk_sirasi"))                 # sıra 2 yok: günlük eksik, sessiz sapma yok

    def test_yonetici_gidis_donus_eksiksiz(self):
        """K11: `ice_aktar(disa_aktar(x))` her alanı geri kurar (yalnız eşleştirme kimliği, `son_ham` ve pencereye bağlı `packet_base` hariç)."""
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        c.devam(self.goruntu(), self.gunluk, self.S, paketler=copy.deepcopy(self.paketler))
        yeniden = devam_mod.disa_aktar(c.manager, self.rid, "x")
        eski = self.bilgi["yonetici"]
        for k in set(eski) | set(yeniden):
            if k in ("goruntu_kimligi", "son_ham"):
                continue
            self.assertEqual(j(yeniden.get(k)), j(eski.get(k)), k)

    def test_devam_paketleri_degistirmez_ve_kadans_ham_boyutu_hatirlar(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        p = copy.deepcopy(self.paketler)
        c.devam(self.goruntu(), self.gunluk, self.S, paketler=p, kosu_id="baska-1")
        self.assertEqual(j(p), j(self.paketler))                                              # K8: çağıranın verisi değişmedi
        self.assertEqual(c._goruntu_kaydi["baska-1"], (self.S, self.bilgi["ham"]))            # K7

    def test_dal_goruntu_ileride_acik_hata(self):
        """Ö4: görüntünün host haftası dal haftasını aşıyorsa dal açılmaz."""
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        g = self.goruntu()
        g["yonetici"]["worker_week"] = self.S + 1
        with self.assertRaises(ValueError) as cm:
            c.devam(g, [], self.S, kosu_id="dal-x", ebeveyn=(self.rid, self.S))
        self.assertIn("dal_goruntu_ileride", str(cm.exception))
        self.assertEqual(c.manager._runs, {})

    def test_yonetici_sema_uyumsuz(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        g = self.goruntu()
        g["yonetici"]["sema"] = 99
        with self.assertRaises(goruntu.UyumsuzGoruntu):
            c.devam(g, [], self.S)
        g = self.goruntu()
        del g["yonetici"]["hist_worlds"]                                                      # alan kümesi değişmiş: KeyError sarılır
        with self.assertRaises(goruntu.UyumsuzGoruntu):
            c.devam(g, [], self.S)
        self.assertEqual(c.manager._runs, {})

    def test_oynatma_istisnalari_sonuca_cevrilir(self):
        """Ö3: Kurucu tarifine karar (NotDao), eksik alanlı giriş, DAO'da şart değişikliği: istisna kaçmaz, açık sonuç; sıra boşluğu UYGULAMADAN önce yakalanır."""
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        kurucu = {"config": {k: v for k, v in CONFIG.items() if k != "durationWeeks"} | {"durationWeeks": 100}, "takvim": []}
        r = c.tariften_oynat(kurucu, [{"sira": 1, "tur": "karar", "dikis": 0, "karar": {"tur": "ahirdan_cik"}}], 2, kosu_id="k-1")
        self.assertEqual((r["durum"], r["neden"]), ("reddedildi", "NotDao"))
        r = c.tariften_oynat(self.tarif, [{"sira": 1, "tur": "karar"}], 2, kosu_id="k-2")
        self.assertEqual((r["durum"], r["neden"]), ("sapma", "dikis_gecersiz"))
        r = c.tariften_oynat(self.tarif, [{"sira": 1, "tur": "karar", "dikis": 0, "karar": {"tur": "ahirdan_cik"}},
                                          {"sira": 2, "tur": "sart", "dikis": 1, "yama": YAMA, "not": None, "surum": 2}], 3, kosu_id="k-3")
        self.assertEqual((r["durum"], r["neden"], r["hafta"]), ("reddedildi", "dao_kural_degistiremez", 1))
        r = c.tariften_oynat(self.tarif, [{"sira": 2, "tur": "karar", "dikis": 0, "karar": {"tur": "ahirdan_cik"}}], 2, kosu_id="k-4")
        self.assertEqual((r["durum"], r["neden"]), ("sapma", "gunluk_sirasi"))
        self.assertEqual(c.manager._runs["k-4"].gunluk_sira, 0)                               # karar uygulanmadı
        c.manager.delete("k-4")

    def test_beklenmeyen_istisnada_yarim_kosu_silinir(self):
        from unittest import mock
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        with mock.patch.object(devam_mod, "_uygula", side_effect=RuntimeError("patladi")):
            with self.assertRaises(RuntimeError):
                c.tariften_oynat(self.tarif, [{"sira": 1, "tur": "karar", "dikis": 0, "karar": {"tur": "ahirdan_cik"}}], 2, kosu_id="y-1")
        self.assertNotIn("y-1", c.manager._runs)

    def test_ilerleme_geri_cagrisi_hafta_basina_bir(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        gelen: list = []
        r = c.tariften_oynat(self.tarif, self.gunluk, 3, kosu_id="i-1", ilerleme=gelen.append)
        self.assertEqual((r["durum"], gelen), ("tamam", [1, 2, 3]))

    def test_tarif_dal_ve_dunya_bilgisini_tasir(self):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        c.devam(self.goruntu(), self.gunluk, self.S, paketler=copy.deepcopy(self.paketler), kosu_id="dal-t", ebeveyn=(self.rid, self.S))
        t = c.tarif_al("dal-t")
        self.assertEqual((t["parent_id"], t["fork_week"]), (self.rid, self.S))
        self.assertEqual(tur_uyar(t, json.loads(TEL.read_text(encoding="utf-8"))["tarif"]), [])
        r = c.tariften_oynat(t, self.gunluk, 1, kosu_id="dal-t2")
        self.assertEqual(c.manager._runs["dal-t2"].parent_id, self.rid)



# ---- yavaş: uzun ufuklu devam (şart 4) + tariften baştan oynatma (şart 7) --------------------------------------------
class _Ufuk:
    """Kesintisiz koşu + üç basamaklı devam; alt sınıf `kos` ile koşuyu ve olayları (karar/yama) tanımlar."""
    N = 40
    SON = 40

    @classmethod
    def setUpClass(cls):
        c = gercek_cekirdek()
        cls.c = c
        cls.rid = rid = cagri(c, "POST", "/api/runs", {"config": cls.tarif_cfg()})[2]["runId"]
        cls.depo = Depo(c, rid)
        cls.cekmece: dict = {}
        cls.goruntu: dict = {}
        cls.olay(rid, 0)
        for w in range(1, cls.N + 1):
            sur(c, rid, w)
            cls.depo.bosalt()
            if w in (13, 25, 37):
                cls.cekmece[w] = cls.cekmeceler(c, rid, w)
            if w == 13:
                p: list = []
                cls.goruntu[13] = (p, c.goruntu_al(rid, p.append))
            cls.olay(rid, w)
        cls.depo.bosalt()
        cls.gunluk = c.gunluk_al(rid)
        cls.tarif = c.tarif_al(rid)
        cls.durum = cagri(c, "GET", f"/api/runs/{rid}")[2]["state"]

    @classmethod
    def tearDownClass(cls):
        cls.c.kapat()

    @staticmethod
    def cekmeceler(c, rid, w):
        d = c.manager._runs[rid].worker.core.host
        firma = next(iter(d._W.firms))
        return {k: cagri(c, "GET", f"/api/runs/{rid}/drawer/{k}/{ref}?week={w}")[2] for k, ref in (("city", "0"), ("city", "3"), ("firm", firma))}

    def kontrol_hop(self, goruntu, snapshot_hafta, hedef):
        """Görüntüden `hedef`e: günlük, çekmeceler, paketler ve dünya olayları kesintisizle bayt bayt eşit. Döner (çekirdek, depo)."""
        p, bilgi = goruntu
        r = gercek_cekirdek()
        self.addCleanup(r.kapat)
        pencere = [copy.deepcopy(self.depo.haftalar[w]) for w in range(max(1, snapshot_hafta - PAKET_PENCERESI + 1), snapshot_hafta + 1)]
        # K2: yüklemeden HEMEN sonra (oynatma yok) çekmeceler kesintisizin aynı andakiyle eşit
        bos = r.devam({"parcalar": p, "yonetici": bilgi["yonetici"]}, [], snapshot_hafta, paketler=copy.deepcopy(pencere), kosu_id=self.rid)
        self.assertEqual(bos["durum"], "tamam")
        if snapshot_hafta in self.cekmece:
            self.assertEqual(j(self.cekmeceler(r, self.rid, snapshot_hafta)), j(self.cekmece[snapshot_hafta]), "yüklemeden hemen sonra hafta %d çekmeceleri" % snapshot_hafta)
        r.manager.delete(self.rid)
        sonuc = r.devam({"parcalar": p, "yonetici": bilgi["yonetici"]}, self.gunluk, hedef, paketler=pencere)
        self.assertEqual((sonuc["durum"], sonuc["hafta"], sonuc["kosu_id"]), ("tamam", hedef, self.rid), sonuc)
        d = Depo(r, self.rid)
        d.bosalt()
        for w in range(max(1, snapshot_hafta - PAKET_PENCERESI + 1), hedef + 1):              # verilen pencere + yeniden oynatılan haftalar
            self.assertEqual(j(d.haftalar[w]), j(self.depo.haftalar[w]), "hafta %d paketi" % w)
        if hedef in self.cekmece:
            self.assertEqual(j(self.cekmeceler(r, self.rid, hedef)), j(self.cekmece[hedef]), "hafta %d çekmeceleri" % hedef)
        self.assertEqual(j(d.dunya), j([e for e in self.depo.dunya if e["week"] <= hedef]), "dünya (sürüm) olayları")
        self.assertEqual(cagri(r, "GET", f"/api/runs/{self.rid}")[2]["state"]["week"], hedef)
        yeniden = r.gunluk_al(self.rid, bilgi["gunluk_sira"])                                # yeniden oynatılan girişler orijinallerin aynısı
        self.assertEqual(j(yeniden), j([e for e in self.gunluk if e["sira"] > bilgi["gunluk_sira"] and e["dikis"] <= hedef]))
        return r, d

    def test_uc_basamakli_devam_kesintisizle_bayt_bayt_ayni(self):
        """13 -> 25 -> görüntü -> 37 -> görüntü -> 40: 40 haftalık ufuk."""
        self.gerekli()
        r1, _ = self.kontrol_hop(self.goruntu[13], 13, 25)
        p2: list = []
        g2 = (p2, r1.goruntu_al(self.rid, p2.append))
        self.assertEqual(g2[1]["yayimlanan"], 25)
        r2, _ = self.kontrol_hop(g2, 25, 37)
        p3: list = []
        g3 = (p3, r2.goruntu_al(self.rid, p3.append))
        r3, d3 = self.kontrol_hop(g3, 37, self.SON)
        st = cagri(r3, "GET", f"/api/runs/{self.rid}")[2]["state"]
        self.assertEqual(j({k: st[k] for k in ("values", "versions", "version")}), j({k: self.durum[k] for k in ("values", "versions", "version")}))


@YAVAS
class UzunUfuk(_Ufuk, unittest.TestCase):
    """DAO: kararlar hf0, 3, 15, 30, 38 (oyun içinde şart değişikliği DAO'da kapalıdır). Tariften baştan oynatma da burada."""
    TARIFTEN = 26

    @classmethod
    def tarif_cfg(cls):
        return dao_tarifi()

    @classmethod
    def olay(cls, rid, w):
        k = {0: {"tur": "ahirdan_cik"}, 3: {"tur": "mevduat", "lonca": "lonca0", "oran": 0.3}, 15: {"tur": "mevduat", "lonca": "lonca0", "oran": 0.5},
             30: {"tur": "mevduat", "lonca": "lonca0", "oran": 0.2}, 38: {"tur": "mevduat", "lonca": "lonca0", "oran": 0.1}}.get(w)
        if k:
            r = cagri(cls.c, "POST", f"/api/runs/{rid}/dao/karar", k)[2]
            assert r.get("kabul") is True, r

    def gerekli(self):
        self.assertEqual(sum(e["tur"] == "karar" for e in self.gunluk), 5)

    def test_tariften_bastan_oynatma_bayt_bayt_ayni(self):
        r = gercek_cekirdek()
        self.addCleanup(r.kapat)
        s = r.tariften_oynat(self.tarif, self.gunluk, self.TARIFTEN, kosu_id=self.rid)
        self.assertEqual((s["durum"], s["hafta"]), ("tamam", self.TARIFTEN), s)
        with self.assertRaises(ValueError):                                                     # var olan kimlik üzerine yazılmaz
            r.tariften_oynat(self.tarif, [], 1, kosu_id=self.rid)
        d = Depo(r, self.rid)
        d.bosalt()
        for w in range(1, self.TARIFTEN + 1):
            self.assertEqual(j(d.haftalar[w]), j(self.depo.haftalar[w]), "hafta %d paketi" % w)
        self.assertEqual(j(d.dunya), j([e for e in self.depo.dunya if e["week"] <= self.TARIFTEN]))
        self.assertEqual(j(r.gunluk_al(self.rid)), j([e for e in self.gunluk if e["dikis"] <= self.TARIFTEN]))


@YAVAS
class KurucuUfuk(_Ufuk, unittest.TestCase):
    """Kurucu: görüntüden sonra (hf17) ve ilk görüntüden önceki/sonraki çift anahtarlı canlı yamalar; rota kapısı açık."""
    N = 40
    SON = 40

    @classmethod
    def tarif_cfg(cls):
        return {**CONFIG, "durationWeeks": 100}

    @classmethod
    def olay(cls, rid, w):
        yama = {7: {"ucret_stopaji": 10}, 17: YAMA, 28: {"ucret_stopaji": 15, "gecis_destegi": "kapali"}}.get(w)
        if yama:
            r = cagri(cls.c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": yama})[2]
            assert r["accepted"], r

    def gerekli(self):
        self.assertEqual([e["tur"] for e in self.gunluk], ["sart", "sart", "sart"])


@YAVAS
class BufDolu(unittest.TestCase):
    """K1: görüntü host yayımdan İLERİdeyken (`buf` dolu, oynarken) alınır; devam kesintisizle bayt bayt eşit."""
    HEDEF = 10

    def _kos(self, cfg, karar=None, yama_hafta=()):
        c = gercek_cekirdek()
        self.addCleanup(c.kapat)
        rid = cagri(c, "POST", "/api/runs", {"config": cfg})[2]["runId"]
        d = Depo(c, rid)
        if karar:
            self.assertTrue(cagri(c, "POST", f"/api/runs/{rid}/dao/karar", karar)[2]["kabul"])
        cagri(c, "POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 1})
        run = c.manager._runs[rid]
        goruntu_ = None
        yamalar = list(yama_hafta)
        son = time.monotonic() + 600
        while run.released < self.HEDEF + 1:
            c.tick()
            d.bosalt()
            ileri = run.worker_week > run.released and not run.computing and run.pending is None
            if goruntu_ is None and run.released >= 4 and ileri:
                p: list = []
                goruntu_ = (p, c.goruntu_al(rid, p.append))
            if yamalar and ileri and run.released >= yamalar[0][0] and cfg.get("mode") != "dao":
                self.assertTrue(cagri(c, "POST", f"/api/runs/{rid}/changes", {"from": "next_week", "patch": yamalar.pop(0)[1]})[2]["accepted"])
            self.assertLess(time.monotonic(), son)
        cagri(c, "POST", f"/api/runs/{rid}/control", {"action": "pause"})
        d.bosalt()
        return c, rid, d, goruntu_

    def _kontrol(self, c, rid, d, g):
        p, bilgi = g
        self.assertTrue(len(bilgi["yonetici"]["buf"]) >= 1 and bilgi["hafta"] > bilgi["yayimlanan"], "görüntüde buf dolu olmalı")
        S, gunluk = bilgi["yayimlanan"], c.gunluk_al(rid)
        r = gercek_cekirdek()
        self.addCleanup(r.kapat)
        pencere = [copy.deepcopy(d.haftalar[w]) for w in range(max(1, S - PAKET_PENCERESI + 1), S + 1)]
        with self.assertRaises(ValueError):                                                     # Ö4: host (S+1) dal haftası S'i aşıyor
            r.devam({"parcalar": p, "yonetici": bilgi["yonetici"]}, gunluk, S, kosu_id="dal-b", ebeveyn=(rid, S))
        sonuc = r.devam({"parcalar": p, "yonetici": bilgi["yonetici"]}, gunluk, self.HEDEF, paketler=pencere)
        self.assertEqual((sonuc["durum"], sonuc["hafta"]), ("tamam", self.HEDEF), sonuc)
        d2 = Depo(r, rid)
        d2.bosalt()
        for w in range(max(1, S - PAKET_PENCERESI + 1), self.HEDEF + 1):
            self.assertEqual(j(d2.haftalar[w]), j(d.haftalar[w]), "hafta %d paketi" % w)
        self.assertEqual(j(d2.dunya), j([e for e in d.dunya if e["week"] <= self.HEDEF]))

    def test_kurucu_oynarken_buf_dolu(self):
        c, rid, d, g = self._kos({**CONFIG, "durationWeeks": 100}, yama_hafta=[(2, {"ucret_stopaji": 25}), (6, {"gecis_destegi": "kisa_sureli"})])
        self._kontrol(c, rid, d, g)

    def test_dao_oynarken_buf_dolu(self):
        c, rid, d, g = self._kos(dao_tarifi(), karar={"tur": "ahirdan_cik"})
        self._kontrol(c, rid, d, g)


if __name__ == "__main__":
    unittest.main()
