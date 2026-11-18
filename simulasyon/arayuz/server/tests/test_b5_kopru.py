"""B5: Worker sinir katmani (`tarayici/isci_kopru.py`): her yontem JSON dizgesi doner, Python istisnasi `{tur, mesaj, fark}` olarak tasinir,
`goruntu_al` sink'i her parcayi bir kez alir, `tick` olaylari ayni yanitta verir. Sahte host: biçim ve sozlesme sinanir."""
from __future__ import annotations

import json
import unittest
from unittest import mock

from oyun_server.tarayici import devam as devam_mod
from oyun_server.tarayici import goruntu
from oyun_server.tarayici.isci_kopru import IsciKopru

from tests.route_helpers import CONFIG
from tests.test_tarayici_cekirdek import adim, bekle_hafta, cagri, cekirdek


def kur():
    c = cekirdek()
    return c, IsciKopru(c)


def coz(s: str):
    o = json.loads(s)
    return o


class IsciKopruTesti(unittest.TestCase):
    def test_istek_dizge_zarfi_ve_hata_govdesi_sunucuyla_ayni(self):
        c, k = kur()
        self.addCleanup(c.kapat)
        o = coz(k.istek("GET", "/api/hello"))
        self.assertTrue(o["ok"])
        self.assertEqual(o["s"]["status"], 200)
        self.assertTrue(o["s"]["body"]["live"])
        o = coz(k.istek("GET", "/api/runs/yok"))                          # 404 hata degil sonuc: Python istisnasi yok
        self.assertTrue(o["ok"])
        self.assertEqual(o["s"]["status"], 404)

    def test_python_istisnasi_tur_mesaj_fark_olarak_tasinir(self):
        c, k = kur()
        self.addCleanup(c.kapat)
        fark = {"pyodide": ("0.27.7", "0.28.0"), "schema": (1, 2)}
        with mock.patch.object(c, "tariften_oynat_json", side_effect=goruntu.UyumsuzGoruntu(fark)):
            o = coz(k.tariften_oynat("{}", "[]", 3))
        self.assertFalse(o["ok"])
        self.assertEqual(o["hata"]["tur"], "UyumsuzGoruntu")
        self.assertEqual(o["hata"]["fark"], {"pyodide": ["0.27.7", "0.28.0"], "schema": [1, 2]})
        with mock.patch.object(c, "goruntu_gerekli", side_effect=ValueError("devam_cok_uzun: 30")):
            o = coz(k.goruntu_gerekli("x"))
        self.assertEqual((o["hata"]["tur"], o["hata"]["mesaj"], o["hata"]["fark"]), ("ValueError", "devam_cok_uzun: 30", None))
        with mock.patch.object(c, "goruntu_al_json", side_effect=devam_mod.GoruntuHazirDegil("bekleyen_karar")):
            o = coz(k.goruntu_al("x", lambda b: None))
        self.assertEqual(o["hata"]["tur"], "GoruntuHazirDegil")
        with mock.patch.object(c, "goruntu_al_json", side_effect=goruntu.GuvensizGoruntu({"guvensiz": ("a", "b")})):
            self.assertEqual(coz(k.goruntu_al("x", lambda b: None))["hata"]["tur"], "GuvensizGoruntu")

    def test_tick_olaylari_ayni_yanitta_verir_ve_idempotent_abone(self):
        c, k = kur()
        self.addCleanup(c.kapat)
        st, _, g = cagri(c, "POST", "/api/runs", {"config": CONFIG})
        rid = g["runId"]
        abone = coz(k.istek("GET", f"/api/runs/{rid}/events"))["s"]["body"]["abone"]
        adim(c, rid)
        gorulen = []
        for _ in range(200):
            o = coz(k.tick([abone]))
            self.assertTrue(o["ok"])
            self.assertEqual([x["abone"] for x in o["s"]], [abone])
            gorulen += [e["event"] for e in o["s"][0]["olaylar"]]
            if "week" in gorulen:
                break
        self.assertIn("state", gorulen)
        self.assertIn("week", gorulen)
        o = coz(k.olaylar([abone]))                                       # bosaltildi: yinelenen olay yok
        self.assertEqual(o["s"][0]["olaylar"], [])
        o = coz(k.olaylar([99999]))                                       # bilinmeyen abone: kapandi
        self.assertEqual(o["s"], [{"abone": 99999, "olaylar": [], "kapandi": True}])

    def test_goruntu_al_sink_her_parcayi_alir_ve_to_js_uygulanir(self):
        c, k = kur()
        self.addCleanup(c.kapat)
        verilen = []

        def sahte(kosu_id, sink):
            sink(b"abc")
            sink(b"de")
            return json.dumps({"hafta": 1})
        with mock.patch.object(c, "goruntu_al_json", side_effect=sahte):
            k2 = IsciKopru(c, to_js=lambda b: ("js", bytes(b)))
            o = coz(k2.goruntu_al("x", verilen.append))
        self.assertTrue(o["ok"])
        self.assertEqual(verilen, [("js", b"abc"), ("js", b"de")])

    def test_devam_parcalari_bytes_olur(self):
        c, k = kur()
        self.addCleanup(c.kapat)
        gelen = {}

        def sahte(parcalar, *a):
            gelen["p"] = parcalar
            return "{}"

        class JsGibi:
            def __init__(self, b): self.b = b
            def to_bytes(self): return self.b
        with mock.patch.object(c, "devam_json", side_effect=sahte):
            self.assertTrue(coz(k.devam([JsGibi(b"x"), b"yz"], "{}", "[]", 5))["ok"])
        self.assertEqual(gelen["p"], [b"x", b"yz"])

    def test_p50_ve_kapat_ve_olay_kapat(self):
        c, k = kur()
        self.assertTrue(coz(k.p50(4.5))["ok"])
        self.assertEqual(c.app.sec_per_week_p50, 4.5)
        self.assertTrue(coz(k.p50(None))["ok"])
        self.assertIsNone(c.app.sec_per_week_p50)
        self.assertTrue(coz(k.olay_kapat(7))["ok"])                       # bilinmeyen abone sessiz
        self.assertTrue(coz(k.kapat())["ok"])


if __name__ == "__main__":
    unittest.main()
