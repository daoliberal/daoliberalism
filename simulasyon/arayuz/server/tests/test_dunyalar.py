"""T8a: dünya yayınlama çekirdeği (HTTP yok): depo, kod, tarif çevirisi, sayfa, saf işleyiciler."""
from __future__ import annotations

import copy
import json
import threading
import unittest

from oyun_server.dunyalar import routes, sayfa, tarif
from oyun_server.dunyalar.bellek import MAX_DUNYA, MAX_KURUCU, BellekDepo
from oyun_server.dunyalar.kod import ALFABE, normalize_kod, yeni_kod
from oyun_server.security import HttpError

from tests.registry_helpers import real_registry

K1 = "oyuncu-0001"
K2 = "oyuncu-0002"

# web `encodeRecipe` gövdesinin JSON'u (anahtarlar sıralı, v:1); ad ve şehir adları yoktur
ORNEK = {
    "v": 1, "templateId": "dayanikli_taban", "durationWeeks": 200, "seedIndex": 3,
    "values": {"gecis_destegi": "kisa_sureli"},
    "worldScenarioId": "kitlik", "worldScenarioValues": {"SOME_V": 2},
    "goals": ["alive", "gini"],
    "schedule": [{"week": 10, "patch": {"gecis_destegi": "kisa_sureli"}}],
}
ORNEK_BASIT = {"v": 1, "templateId": "dayanikli_taban", "durationWeeks": 200, "seedIndex": 0, "values": {}}


def sonuc(dilim, servet, unvan="Esnaf", isletme=1):
    return {"dilim": dilim, "servet": servet, "unvan": unvan, "isletme": isletme}


class DunyaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = real_registry()

    def setUp(self):
        self.depo = BellekDepo()

    def yay(self, kurucu=K1, ad="Kıtlık", ac="Zor dünya"):
        return self.depo.yayinla(copy.deepcopy(ORNEK_BASIT), "s1", ad, ac, kurucu)

    def test_yayinla_getir(self):
        kod = self.yay()
        self.assertEqual(len(kod), 7)
        self.assertTrue(set(kod) <= set(ALFABE))
        d = self.depo.getir(kod)
        self.assertEqual((d.ad, d.aciklama, d.kurucu, d.model_surumu, d.oynanma), ("Kıtlık", "Zor dünya", K1, "s1", 0))
        self.assertEqual(d.tarif, ORNEK_BASIT)
        self.depo.oynandi(kod)
        self.depo.oynandi(kod)
        self.assertEqual(self.depo.getir(kod).oynanma, 2)
        self.assertIsNone(self.depo.getir("AAAAAAA"))
        self.assertFalse(self.depo.kalici)
        # getir kopya döner: dışarıdan değiştirmek depoyu bozmaz
        d.ad = "x"
        self.assertEqual(self.depo.getir(kod).ad, "Kıtlık")

    def test_sinirlar(self):
        for i in range(MAX_KURUCU):
            self.yay(ad="d%d" % i)
        with self.assertRaises(HttpError) as c:
            self.yay()
        self.assertEqual((c.exception.status, c.exception.code), (429, "sinir"))
        self.yay(kurucu=K2)                              # başka kurucu etkilenmez
        d = BellekDepo()
        for i in range(MAX_DUNYA):
            d._dunyalar["K%06d" % i] = None             # toplam sınırı: doldur
        with self.assertRaises(HttpError) as c:
            d.yayinla(ORNEK_BASIT, "s1", "a", "", K1)
        self.assertEqual((c.exception.status, c.exception.code), (429, "sinir"))

    def test_ad_filtre(self):
        kotu = ["", "x" * 61, "a\x00b", "a\nb", "a‮b", "a⁦b", "a⁩b", "   ", 5, None]
        for ad in kotu:
            with self.assertRaises(HttpError, msg=repr(ad)) as c:
                self.depo.yayinla(ORNEK_BASIT, "s1", ad, "", K1)
            self.assertEqual((c.exception.status, c.exception.code), (422, "karar_gecersiz"))
            self.assertEqual(c.exception.fields[0]["id"], "ad")
        for ac in ["y" * 281, "a\x07", "a‪b"]:
            with self.assertRaises(HttpError) as c:
                self.depo.yayinla(ORNEK_BASIT, "s1", "ad", ac, K1)
            self.assertEqual(c.exception.code, "karar_gecersiz")
        self.depo.yayinla(ORNEK_BASIT, "s1", "x" * 60, "y" * 280, K1)
        self.depo.yayinla(ORNEK_BASIT, "s1", "a", "", K1)
        for k in ["kisa", "a" * 65, "oyuncu 0001", "oyuncu_0001", None]:
            with self.assertRaises(HttpError):
                self.depo.yayinla(ORNEK_BASIT, "s1", "ad", "", k)
        # görünen ad 1-30
        kod = self.yay()
        self.depo.sonuc_yaz(kod, "r1", K1, sonuc(1, 1))
        for ad in ["", "z" * 31, "a‮b"]:
            with self.assertRaises(HttpError):
                self.depo.ad_yaz("r1", K1, ad)
        self.depo.ad_yaz("r1", K1, "z" * 30)

    def test_gecersiz_tarif(self):
        for kotu in [None, [], {}, dict(ORNEK_BASIT, v=2), dict(ORNEK_BASIT, templateId="../x"), dict(ORNEK_BASIT, templateId="yok_boyle_sablon"),
                     dict(ORNEK_BASIT, durationWeeks=0), dict(ORNEK_BASIT, seedIndex=100), dict(ORNEK_BASIT, values=[]),
                     dict(ORNEK_BASIT, goals=["x"]), dict(ORNEK_BASIT, schedule=[{"week": 0, "patch": {}}]),
                     dict(ORNEK_BASIT, schedule=[{"week": 5, "patch": {"yok_boyle_ayar": 1}}]),
                     dict(ORNEK_BASIT, values={"yok_boyle_ayar": 1})]:
            with self.assertRaises(HttpError, msg=repr(kotu)) as c:
                tarif.dogrula(self.reg, kotu)
            self.assertEqual((c.exception.status, c.exception.code), (422, "invalid_config"), repr(kotu))
            self.assertTrue(c.exception.fields)
        self.assertEqual(tarif.dogrula(self.reg, ORNEK_BASIT), ORNEK_BASIT)
        # bilinmeyen alanlar atılır
        self.assertEqual(tarif.temizle(dict(ORNEK_BASIT, ek="x")), ORNEK_BASIT)

    def test_kod_normalize(self):
        kod = self.yay()
        self.assertEqual(normalize_kod(" %s " % kod.lower()), kod)
        self.assertEqual(self.depo.getir(normalize_kod(" %s " % kod.lower())).kod, kod)
        for kotu in ["K7M2QX0", "K7M2QXI", "K7M2QX", "K7M2QXAA", "", None, 5]:
            self.assertIsNone(normalize_kod(kotu), repr(kotu))
        with self.assertRaises(HttpError) as c:
            routes.dunya_bul(self.depo, "K7M2QX0")
        self.assertEqual((c.exception.status, c.exception.code), (404, "dunya_yok"))
        self.assertEqual(routes.dunya_bul(self.depo, " %s " % kod.lower()).kod, kod)

    def test_kod_cakisma_yeniden(self):
        sayac = []

        def var(k):
            sayac.append(k)
            return len(sayac) < 3                          # ilk iki üretim çakışır
        k = yeni_kod(var)
        self.assertEqual(len(sayac), 3)
        self.assertEqual(sayac[-1], k)
        self.assertEqual(len(k), 7)
        self.assertTrue(set(k) <= set(ALFABE))
        self.assertNotIn("0", ALFABE)
        self.assertEqual(len(ALFABE), 31)

    def test_tarif_ceviri(self):
        gorulen = tarif.temizle(copy.deepcopy(ORNEK))
        self.assertEqual(gorulen, ORNEK)
        kosu = tarif.tariften_kosu(gorulen, "Ad", ["A", "B", "C", "D", "E"])
        self.assertEqual(kosu, {
            "config": {"name": "Ad", "cityNames": ["A", "B", "C", "D", "E"], "templateId": "dayanikli_taban", "durationWeeks": 200,
                       "seedIndex": 3, "values": {"gecis_destegi": "kisa_sureli"}, "worldScenarioId": "kitlik",
                       "worldScenarioValues": {"SOME_V": 2}, "goals": ["alive", "gini"]},
            "schedule": [{"week": 10, "patch": {"gecis_destegi": "kisa_sureli"}}]})
        self.assertNotIn("schedule", kosu["config"])
        self.assertNotIn("v", kosu["config"])
        # isteğe bağlı alanlar yoksa config'te de yok; süre geçersiz kılınabilir (DAO: 520)
        k2 = tarif.tariften_kosu(ORNEK_BASIT, "Ad", ["A"] * 5, 520)
        self.assertEqual(k2["config"], {"name": "Ad", "cityNames": ["A"] * 5, "templateId": "dayanikli_taban", "durationWeeks": 520,
                                        "seedIndex": 0, "values": {}})
        self.assertEqual(k2["schedule"], [])
        # sunucunun mevcut tarif doğrulaması çevrilmiş gövdeyi kabul eder
        from oyun_server.runs import recipe
        self.assertEqual(recipe.validate(self.reg, tarif.tariften_kosu(ORNEK_BASIT, "Ad", ["A"] * 5)), [])
        # JSON ile gidiş-dönüş
        self.assertEqual(tarif.temizle(json.loads(json.dumps(ORNEK))), ORNEK)

    def test_sonuc_tek(self):
        kod = self.yay()
        self.depo.sonuc_yaz(kod, "r1", K1, sonuc(3, 100))
        with self.assertRaises(KeyError) as c:
            self.depo.sonuc_yaz(kod, "r1", K1, sonuc(4, 200))
        self.assertEqual(c.exception.args[0], "sonuc_var")
        self.assertEqual(self.depo.skor(kod)[0]["dilim"], 3)
        with self.assertRaises(KeyError) as c:
            self.depo.sonuc_yaz("AAAAAAA", "r2", K1, sonuc(1, 1))
        self.assertEqual(c.exception.args[0], "dunya_yok")

    def test_ad_tek_ve_sahibine(self):
        kod = self.yay()
        with self.assertRaises(KeyError) as c:
            self.depo.ad_yaz("r1", K1, "Ayşe")
        self.assertEqual(c.exception.args[0], "sonuc_yok")
        self.depo.sonuc_yaz(kod, "r1", K1, sonuc(3, 100))
        with self.assertRaises(PermissionError):
            self.depo.ad_yaz("r1", K2, "Ayşe")
        self.depo.ad_yaz("r1", K1, "Ayşe")
        with self.assertRaises(KeyError) as c:
            self.depo.ad_yaz("r1", K1, "Veli")
        self.assertEqual(c.exception.args[0], "ad_var")
        self.assertEqual(self.depo.skor(kod)[0]["ad"], "Ayşe")
        # işleyici hata kodları
        self.depo.sonuc_yaz(kod, "r2", K1, sonuc(1, 1))
        for rid, oy, st, cd in [("r2", K2, 403, "oyuncu_uyusmuyor"), ("r1", K1, 409, "ad_var")]:
            with self.assertRaises(HttpError) as c:
                routes.ad_yaz(self.depo, rid, {"oyuncu": oy, "ad": "Z"})
            self.assertEqual((c.exception.status, c.exception.code), (st, cd))
        self.assertEqual(routes.ad_yaz(self.depo, "r2", {"oyuncu": K1, "ad": "Z"}), (200, {"ok": True}))

    def test_skor_sirasi(self):
        kod = self.yay()
        self.depo.sonuc_yaz(kod, "a", K1, sonuc(2, 500))
        self.depo.sonuc_yaz(kod, "b", K1, sonuc(5, 10))
        self.depo.sonuc_yaz(kod, "c", K1, sonuc(5, 90))
        self.depo.sonuc_yaz(kod, "d", K1, sonuc(1, 9999))
        s = self.depo.skor(kod)
        self.assertEqual([(r["dilim"], r["servet"]) for r in s], [(5, 90), (5, 10), (2, 500), (1, 9999)])
        for r in s:
            self.assertEqual(set(r), {"ad", "dilim", "unvan", "isletme", "servet"})   # oyuncu ve koşu kimliği çıkmaz
        for i in range(30):
            self.depo.sonuc_yaz(kod, "x%d" % i, K1, sonuc(0, i))
        self.assertEqual(len(self.depo.skor(kod)), 20)
        self.assertEqual(len(self.depo.skor(kod, 500)), 20)
        self.assertEqual(self.depo.skor("AAAAAAA"), [])

    def test_kurucunun_dunyalari(self):
        a = self.yay(ad="a")
        b = self.yay(ad="b")
        c = self.yay(kurucu=K2, ad="c")
        kodlar = {d.kod for d in self.depo.kurucunun(K1)}
        self.assertEqual(kodlar, {a, b})
        self.assertEqual([d.kod for d in self.depo.kurucunun(K2)], [c])
        self.assertEqual(self.depo.kurucunun("baskasi-123"), [])
        st, liste = routes.kurucunun(self.depo, K2)
        self.assertEqual(st, 200)
        self.assertNotIn("kurucu", liste[0])
        self.assertEqual(liste[0]["baglanti"], "/d/" + c)

    def test_d_sayfasi_og_kacis_yonlendirme(self):
        kod = self.depo.yayinla(ORNEK_BASIT, "s1", '<script>alert(1)</script>"&', "a'b <b>x</b> \"q\"", K1)
        html = sayfa.dunya_sayfasi(self.depo.getir(kod))
        self.assertNotIn("<script", html.lower())
        self.assertNotIn("<b>", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;", html)
        self.assertIn('property="og:title"', html)
        self.assertIn('property="og:description"', html)
        self.assertIn("a&#x27;b &lt;b&gt;x&lt;/b&gt; &quot;q&quot;", html)
        self.assertIn('name="twitter:card" content="summary"', html)
        self.assertIn('<meta http-equiv="refresh" content="0; url=/oyun/?kaynak=canli#/dao/d/%s">' % kod, html)
        self.assertIn('<a href="/oyun/?kaynak=canli#/dao/d/%s">' % kod, html)
        self.assertNotIn(K1, html)
        self.assertNotIn("onload", html)
        yok = sayfa.bulunamadi_sayfasi()
        self.assertIn("bulunamadı", yok)
        self.assertNotIn("<script", yok.lower())
        # açıklama boşsa varsayılan metin
        k2 = self.depo.yayinla(ORNEK_BASIT, "s1", "Ad", "", K1)
        self.assertIn(sayfa.VARSAYILAN_ACIKLAMA.replace("'", "&#x27;"), sayfa.dunya_sayfasi(self.depo.getir(k2)))

    def test_isleyiciler_ve_es_zamanlilik(self):
        st, y = routes.yayinla(self.depo, {"tarif": ORNEK_BASIT, "ad": "Dünya", "aciklama": "x", "oyuncu": K1}, self.reg, "s1")
        self.assertEqual(st, 201)
        self.assertEqual(y["baglanti"], "/d/" + y["kod"])
        st, g = routes.getir(self.depo, y["kod"].lower(), "s2")
        self.assertEqual((g["modelSurumu"], g["guncelSurum"], g["ad"]), ("s1", "s2", "Dünya"))
        self.assertNotIn("kurucu", g)
        with self.assertRaises(HttpError) as c:
            routes.yayinla(self.depo, {"tarif": {}, "ad": "x", "oyuncu": K1}, self.reg, "s1")
        self.assertEqual(c.exception.code, "invalid_config")
        with self.assertRaises(HttpError) as c:
            routes.yayinla(self.depo, {"tarif": ORNEK_BASIT, "ad": "x", "oyuncu": "k"}, self.reg, "s1")
        self.assertEqual(c.exception.code, "karar_gecersiz")
        # çok iş parçacıklı: sınır aşılmaz, kodlar benzersiz
        kodlar, hata = [], []

        def is_():
            try:
                kodlar.append(self.depo.yayinla(ORNEK_BASIT, "s1", "t", "", K2))
            except HttpError as e:
                hata.append(e.code)
        ts = [threading.Thread(target=is_) for _ in range(40)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(len(kodlar), MAX_KURUCU)
        self.assertEqual(len(set(kodlar)), MAX_KURUCU)
        self.assertEqual(set(hata), {"sinir"})

    # ---- 8a inceleme düzeltmeleri (8b) ----
    def test_ad_filtre_ek_gorunmez_karakterler(self):
        for ch in ["\u200e", "\u200f", "\u061c", "\u2028", "\u2029"]:
            with self.assertRaises(HttpError, msg=hex(ord(ch))) as c:
                self.depo.yayinla(ORNEK_BASIT, "s1", "a%sb" % ch, "", K1)
            self.assertEqual(c.exception.code, "karar_gecersiz")
            with self.assertRaises(HttpError):
                self.depo.yayinla(ORNEK_BASIT, "s1", "ad", "a%sb" % ch, K1)
        self.depo.yayinla(ORNEK_BASIT, "s1", "👨\u200d👩", "", K1)       # ZWJ emoji bileşimine dokunulmaz

    def test_kopya_derin(self):
        t = copy.deepcopy(ORNEK)
        kod = self.depo.yayinla(t, "s1", "Ad", "", K1)
        t["values"]["gecis_destegi"] = "bozuk"                                  # çağıranın sözlüğü depoyu bozmaz
        t["schedule"][0]["patch"]["x"] = 1
        self.assertEqual(self.depo.getir(kod).tarif, ORNEK)
        d = self.depo.getir(kod)
        d.tarif["values"]["gecis_destegi"] = "bozuk"
        d.tarif["schedule"][0]["patch"]["y"] = 1
        self.assertEqual(self.depo.getir(kod).tarif, ORNEK)
        for x in self.depo.kurucunun(K1):
            x.tarif["values"]["z"] = 1
        self.assertEqual(self.depo.getir(kod).tarif, ORNEK)
        kosu = tarif.tariften_kosu(self.depo.getir(kod).tarif, "Ad", ["A"] * 5, 520)
        kosu["config"]["values"]["q"] = 1
        kosu["schedule"][0]["patch"]["q"] = 1
        self.assertEqual(self.depo.getir(kod).tarif, ORNEK)

    def test_sonuc_yaz_dogrular(self):
        kod = self.yay()
        kotu = [sonuc(None, 1), sonuc(True, 1), sonuc(3, None), sonuc(3, float("nan")), sonuc(3, float("inf")), sonuc(3, "5"),
                sonuc(3, 1, unvan=None), sonuc(3, 1, isletme=-1), sonuc(3, 1, isletme=1.5), sonuc(-1, 1), {"dilim": 3, "servet": 1},
                dict(sonuc(3, 1), oyuncu="x"), "yok", None]
        for i, s in enumerate(kotu):
            with self.assertRaises(ValueError, msg=repr(s)):
                self.depo.sonuc_yaz(kod, "r%d" % i, K1, s)
        self.assertEqual(self.depo.skor(kod), [])
        self.depo.sonuc_yaz(kod, "ok", K1, sonuc(3, 12.5))                       # int ve float servet kabul
        self.depo.sonuc_yaz(kod, "ok2", K1, sonuc(3, 12))
        self.assertEqual(len(self.depo.skor(kod)), 2)


if __name__ == "__main__":
    unittest.main()
