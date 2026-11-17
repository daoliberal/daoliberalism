"""T8b: dünya yayınlama HTTP uçları, `/d/<kod>` sayfası, DAO bitiş kancası, sürüm dizesi, `/info` kalıcılık."""
from __future__ import annotations

import copy
import http.client
import json
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from oyun_server.dunyalar.bellek import BellekDepo
from oyun_server.runs import disk
from oyun_server.sim import host as sim_host

from tests.route_helpers import call, live_app, make_cfg

K1 = "oyuncu-0001"
K2 = "oyuncu-0002"
TARIF = {"v": 1, "templateId": "dayanikli_taban", "durationWeeks": 100, "seedIndex": 0, "values": {}}


def ham(srv, method, path):
    """(durum, başlıklar, metin): JSON olmayan yanıtlar için."""
    c = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=10)
    try:
        c.request(method, path)
        r = c.getresponse()
        return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read().decode("utf-8")
    finally:
        c.close()


class Taban(unittest.TestCase):
    def kur(self, **kw):
        self.depo = kw.pop("depo", None) or BellekDepo()
        root = Path(tempfile.mkdtemp(prefix="dunya-8b-"))
        self.addCleanup(shutil.rmtree, root, True)
        cm = live_app(cfg=make_cfg(MAX_RUNS=4), depo=self.depo, **kw)
        self.srv, self.app, _w = cm.__enter__()
        self.addCleanup(cm.__exit__, None, None, None)
        self.app.manager._disk = disk.DiskStore(root)

    def yayinla(self, ad="Kıtlık", ac="Zor dünya", oyuncu=K1, tarif=None):
        s, _, b = call(self.srv, "POST", "/api/dunyalar", {"tarif": tarif or TARIF, "ad": ad, "aciklama": ac, "oyuncu": oyuncu})
        self.assertEqual(s, 201, b)
        return b["kod"]

    def oyna(self, kod, oyuncu=K1):
        return call(self.srv, "POST", "/api/dunyalar/%s/oyna" % kod, {"oyuncu": oyuncu})

    def bekle(self, kosul, timeout=20.0):
        end = time.time() + timeout
        while time.time() < end:
            if kosul():
                return
            time.sleep(0.01)
        self.fail("koşul sağlanmadı")

    def bitir(self, rid, hafta=2):
        """Koşuyu kısa sürede bitir (süre testte indirilir) ve bitişini bekle."""
        self.app.manager._runs[rid].duration = hafta
        call(self.srv, "POST", "/api/runs/%s/control" % rid, {"action": "play", "speed": 16})
        self.bekle(lambda: call(self.srv, "GET", "/api/runs/" + rid)[2]["state"]["status"] == "ended")
        self.bekle(lambda: self.app.manager._dao_end == [])


class TestUclar(Taban):
    def test_yayinla_getir_liste_skor(self):
        self.kur()
        s, _, b = call(self.srv, "POST", "/api/dunyalar", {"tarif": TARIF, "ad": "Kıtlık", "aciklama": "Zor", "oyuncu": K1})
        self.assertEqual(s, 201)
        self.assertEqual(b["baglanti"], "/d/" + b["kod"])
        kod = b["kod"]
        s, h, g = call(self.srv, "GET", "/api/dunyalar/%s" % kod.lower())
        self.assertEqual(s, 200)
        self.assertEqual(g, {"kod": kod, "ad": "Kıtlık", "aciklama": "Zor", "tarif": TARIF, "modelSurumu": "v-test-1",
                             "oynanma": 0, "guncelSurum": "v-test-1"})
        self.assertEqual(h["cache-control"], "no-store")
        s, _, liste = call(self.srv, "GET", "/api/dunyalar?kurucu=" + K1)
        self.assertEqual([x["kod"] for x in liste], [kod])
        self.assertEqual(call(self.srv, "GET", "/api/dunyalar?kurucu=" + K2)[2], [])
        self.assertEqual(call(self.srv, "GET", "/api/dunyalar/%s/skor" % kod), (200, call(self.srv, "GET", "/api/dunyalar/%s/skor" % kod)[1], []))
        s, _, e = call(self.srv, "GET", "/api/dunyalar/K7M2QX0")
        self.assertEqual((s, e["error"]["code"]), (404, "dunya_yok"))
        s, _, e = call(self.srv, "GET", "/api/dunyalar/K7M2QX0/skor")
        self.assertEqual((s, e["error"]["code"]), (404, "dunya_yok"))
        s, _, e = call(self.srv, "GET", "/api/dunyalar")                     # kurucu yok
        self.assertEqual((s, e["error"]["code"]), (422, "karar_gecersiz"))
        s, _, e = call(self.srv, "POST", "/api/dunyalar", {"tarif": {}, "ad": "x", "oyuncu": K1})
        self.assertEqual((s, e["error"]["code"]), (422, "invalid_config"))
        s, _, e = call(self.srv, "POST", "/api/dunyalar", {"tarif": TARIF, "ad": "a‎b", "oyuncu": K1})
        self.assertEqual((s, e["error"]["code"]), (422, "karar_gecersiz"))
        # kurucu kimliği hiçbir genel yanıtta yok
        for yol in ("/api/dunyalar/" + kod, "/api/dunyalar/%s/skor" % kod):
            self.assertNotIn(K1, json.dumps(call(self.srv, "GET", yol)[2]))

    def test_sinir_429(self):
        self.kur()
        for i in range(20):
            self.yayinla(ad="d%d" % i)
        s, _, e = call(self.srv, "POST", "/api/dunyalar", {"tarif": TARIF, "ad": "fazla", "oyuncu": K1})
        self.assertEqual((s, e["error"]["code"]), (429, "sinir"))

    def test_oyna_520_ve_baglanti(self):
        self.kur()
        kod = self.yayinla()                                              # tarif süresi 100: oyun yine 520
        s, _, b = self.oyna(kod.lower())
        self.assertEqual(s, 201, b)
        self.assertEqual(set(b), {"runId"})
        rid = b["runId"]
        st = call(self.srv, "GET", "/api/runs/" + rid)[2]["state"]
        self.assertEqual((st["mode"], st["durationWeeks"], st["dunyaKodu"], st["name"]), ("dao", 520, kod, "Kıtlık"))
        self.assertNotIn("oyuncu", json.dumps(call(self.srv, "GET", "/api/runs/" + rid)[2]))     # oyuncu kimliği durumda yok
        self.assertNotIn(K1, json.dumps(call(self.srv, "GET", "/api/runs")[2]))
        self.assertEqual(call(self.srv, "GET", "/api/dunyalar/" + kod)[2]["oynanma"], 1)
        self.oyna(kod)
        self.assertEqual(call(self.srv, "GET", "/api/dunyalar/" + kod)[2]["oynanma"], 2)
        # tarifteki değerler koşuya geçer; depodaki tarif bozulmaz
        self.assertEqual(self.depo.getir(kod).tarif, TARIF)
        # hatalar
        s, _, e = self.oyna("K7M2QX0")
        self.assertEqual((s, e["error"]["code"]), (404, "dunya_yok"))
        s, _, e = self.oyna(kod, oyuncu="kisa")
        self.assertEqual((s, e["error"]["code"]), (422, "karar_gecersiz"))
        self.assertEqual(call(self.srv, "GET", "/api/dunyalar/" + kod)[2]["oynanma"], 2)           # başarısız çağrı sayılmaz
        # Kurucu koşusu dunyaKodu taşımaz
        s, _, h = call(self.srv, "POST", "/api/runs", {"config": {"name": "k", "cityNames": [], "templateId": "dayanikli_taban", "durationWeeks": 100, "seedIndex": 0, "values": {}}})
        self.assertNotIn("dunyaKodu", h["state"])

    def test_oyna_takvimli_tarif(self):
        self.kur()
        t = dict(TARIF, durationWeeks=100, schedule=[{"week": 10, "patch": {"gecis_destegi": "kisa_sureli"}}])
        kod = self.yayinla(tarif=t)
        s, _, b = self.oyna(kod)
        self.assertEqual(s, 201, b)

    def test_eski_surum(self):
        self.kur()
        kod = self.yayinla()
        self.app.surum = "v-test-2"                                       # model değişti
        s, _, e = self.oyna(kod)
        self.assertEqual((s, e["error"]["code"]), (409, "eski_surum"))
        g = call(self.srv, "GET", "/api/dunyalar/" + kod)[2]
        self.assertEqual((g["modelSurumu"], g["guncelSurum"], g["oynanma"]), ("v-test-1", "v-test-2", 0))
        self.assertEqual(call(self.srv, "GET", "/api/runs")[2], [])

    def test_sonuc_tek_ve_bagli(self):
        self.kur()
        kod = self.yayinla()
        rid = self.oyna(kod)[2]["runId"]
        self.bitir(rid, 2)
        sk = call(self.srv, "GET", "/api/dunyalar/%s/skor" % kod)[2]
        self.assertEqual(len(sk), 1)
        # sahte host: hafta 2 -> servet_dilimi 3, nakit 102.0, unvan cirak, kurulan işletme yok
        self.assertEqual(sk[0], {"ad": None, "dilim": 3, "unvan": "cirak", "isletme": 0, "servet": 102.0})
        # ikinci yazım (kanca iki kez çağrılırsa) sessizce yok sayılır; sonuç tek kalır
        from oyun_server.dunyalar import uclar
        run = self.app.manager._runs[rid]
        uclar.dao_bitti_kancasi(self.depo)(rid, run.dao_sonuc, dict(self.app.manager._dao_meta(run), dunyaKodu=kod, oyuncu=K1))
        self.assertEqual(len(self.depo.skor(kod)), 1)
        # sonuç istemciden gelmez: ad ucu yalnız ad yazar
        s, _, e = call(self.srv, "POST", "/api/runs/%s/dao/ad" % rid, {"oyuncu": K1, "ad": "Ayşe", "dilim": 5, "servet": 1e9})
        self.assertEqual(s, 200)
        self.assertEqual(call(self.srv, "GET", "/api/dunyalar/%s/skor" % kod)[2][0]["dilim"], 3)

    def test_baglantisiz_dao_kosusu_sonuc_yazmaz(self):
        self.kur()
        kod = self.yayinla()
        s, _, h = call(self.srv, "POST", "/api/runs", {"config": {"name": "k", "cityNames": [], "templateId": "dayanikli_taban", "durationWeeks": 200, "seedIndex": 0, "values": {}, "mode": "dao"}})
        self.assertEqual(s, 201, h)
        self.bitir(h["runId"], 2)
        self.assertEqual(self.depo.skor(kod), [])
        self.assertEqual(self.depo._sonuclar, {})
        s, _, e = call(self.srv, "POST", "/api/runs/%s/dao/ad" % h["runId"], {"oyuncu": K1, "ad": "Z"})
        self.assertEqual((s, e["error"]["code"]), (409, "sonuc_yok"))

    def test_ad_tek_ve_sahibine(self):
        self.kur()
        kod = self.yayinla()
        rid = self.oyna(kod, K1)[2]["runId"]
        yol = "/api/runs/%s/dao/ad" % rid
        s, _, e = call(self.srv, "POST", yol, {"oyuncu": K1, "ad": "Ayşe"})                  # sonuç henüz yok
        self.assertEqual((s, e["error"]["code"]), (409, "sonuc_yok"))
        self.bitir(rid, 2)
        s, _, e = call(self.srv, "POST", yol, {"oyuncu": K2, "ad": "Veli"})
        self.assertEqual((s, e["error"]["code"]), (403, "oyuncu_uyusmuyor"))
        s, _, e = call(self.srv, "POST", yol, {"oyuncu": K1, "ad": "x" * 31})
        self.assertEqual((s, e["error"]["code"]), (422, "karar_gecersiz"))
        s, _, e = call(self.srv, "POST", yol, {"oyuncu": K1, "ad": "a‮b"})
        self.assertEqual((s, e["error"]["code"]), (422, "karar_gecersiz"))
        s, _, e = call(self.srv, "POST", yol, {"oyuncu": K1, "ad": "Ayşe"})
        self.assertEqual((s, e), (200, {"ok": True}))
        s, _, e = call(self.srv, "POST", yol, {"oyuncu": K1, "ad": "Veli"})
        self.assertEqual((s, e["error"]["code"]), (409, "ad_var"))
        sk = call(self.srv, "GET", "/api/dunyalar/%s/skor" % kod)[2]
        self.assertEqual([r["ad"] for r in sk], ["Ayşe"])
        self.assertNotIn(K1, json.dumps(sk))
        self.assertNotIn(rid, json.dumps(sk))

    def test_info_kalicilik(self):
        self.kur()
        self.assertIs(call(self.srv, "GET", "/api/info")[2]["dunyalarKalici"], False)
        self.app.depo.kalici = True                                       # kalıcı depo takılmış gibi
        self.assertIs(call(self.srv, "GET", "/api/info")[2]["dunyalarKalici"], True)
        self.app.depo = None
        self.assertIs(call(self.srv, "GET", "/api/info")[2]["dunyalarKalici"], False)

    def test_depo_yoksa_uc_yok(self):
        with live_app() as (srv, _a, _w):
            self.assertEqual(call(srv, "GET", "/api/dunyalar?kurucu=" + K1)[0], 404)
            self.assertIs(call(srv, "GET", "/api/info")[2]["dunyalarKalici"], False)
            self.assertEqual(ham(srv, "GET", "/d/K7M2QXA")[0], 404)


class TestSayfa(Taban):
    def test_d_sayfasi_og_kacis_yonlendirme(self):
        self.kur()
        kod = self.yayinla(ad='<script>alert(1)</script>"&', ac="a'b <b>x</b>")
        for yol in ("/d/" + kod, "/d/" + kod.lower(), "/d/ " + kod.lower() + " "):
            s, h, html = ham(self.srv, "GET", yol.replace(" ", "%20"))
            self.assertEqual(s, 200, yol)
            self.assertTrue(h["content-type"].startswith("text/html"))
            self.assertEqual(h["x-content-type-options"], "nosniff")
            self.assertNotIn("<script", html.lower())
            self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;", html)
            self.assertIn('property="og:title"', html)
            self.assertIn('name="twitter:card" content="summary"', html)
            self.assertIn('<meta http-equiv="refresh" content="0; url=/oyun/?kaynak=canli#/dao/d/%s">' % kod, html)
            self.assertNotIn(K1, html)
        s, h, _ = ham(self.srv, "HEAD", "/d/" + kod)
        self.assertEqual(s, 200)
        s, h, html = ham(self.srv, "GET", "/d/K7M2QX0")
        self.assertEqual(s, 404)
        self.assertTrue(h["content-type"].startswith("text/html"))
        self.assertIn("bulunamadı", html)
        for yol in ("/d/", "/d", "/d/AAAAAAA/x", "/d/%3Cscript%3E"):
            self.assertEqual(ham(self.srv, "GET", yol)[0], 404, yol)
        # /api altı etkilenmez; POST /d/<kod> yöntem hatası
        self.assertEqual(call(self.srv, "POST", "/d/" + kod, {})[0], 405)


class TestSurum(unittest.TestCase):
    def test_surum_dizesi_simkit(self):
        with tempfile.TemporaryDirectory() as d:
            sk = Path(d) / "simkit"
            sk.mkdir()
            (sk / "params.py").write_text("VERSION = 'v1'\n")
            (sk / "step.py").write_text("x = 1\n")
            (sk / "notlar.txt").write_text("a\n")
            a = sim_host._version(d, "v1")
            self.assertRegex(a, r"^v1-[0-9a-f]{8}$")
            self.assertEqual(sim_host._version(d, "v1"), a)
            (sk / "notlar.txt").write_text("b\n")                          # .py olmayan dosya sürümü etkilemez
            self.assertEqual(sim_host._version(d, "v1"), a)
            (sk / "step.py").write_text("x = 2\n")                         # params.py dışındaki bir simkit dosyası
            b = sim_host._version(d, "v1")
            self.assertNotEqual(a, b)
            (sk / "yeni.py").write_text("")                                # yeni dosya
            self.assertNotEqual(sim_host._version(d, "v1"), b)
            # önbellekli sürüm: süreç içinde bir kez hesaplanır
            sim_host.guncel_surum.cache_clear()
            c = sim_host.guncel_surum(d, "v1")
            (sk / "step.py").write_text("x = 3\n")
            self.assertEqual(sim_host.guncel_surum(d, "v1"), c)
            sim_host.guncel_surum.cache_clear()

    def test_surum_dizesi_dosya_yoksa(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(sim_host._version(d, "v1"), "v1-?")


if __name__ == "__main__":
    unittest.main()
