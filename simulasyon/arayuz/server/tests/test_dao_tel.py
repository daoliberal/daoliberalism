"""T1c: DAO gözleminin, yeni olayların ve karar redlerinin gerçek model çıktısından fikstürü (`tests/fixtures/dao_tel.json`).
Web testi aynı dosyayı `parseDaoGozlem` ile çözer. Yenileme: bu testi `YENILE_DAO_FIKSTURU=1` ile koş (gerçek model, yavaş; QUICK'te atlanır).
Sahte host'un (`FakeHost`) gözlemi ve olayları aynı fikstürle şekil olarak karşılaştırılır (QUICK'te de koşar)."""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from oyun_server.testing import FakeHost, FakeKararHatasi
from tests.extract_v2_helpers import QUICK
from tests.test_dao_isci import Isci, dao_overrides, sekil_farki

FIKSTUR: dict | None = None
YOL = Path(__file__).parent / "fixtures" / "dao_tel.json"


def _yuvarla(x, n=6):
    """Kayan noktalı değerleri yuvarlar (fikstür platformdan bağımsız kalsın)."""
    if isinstance(x, float):
        return round(x, n)
    if isinstance(x, dict):
        return {k: _yuvarla(v, n) for k, v in x.items()}
    if isinstance(x, list):
        return [_yuvarla(v, n) for v in x]
    return x


def gercek_fikstur(test: unittest.TestCase) -> dict:
    """Gerçek model: ahırdan çık, başka şehrin firmasına (sehir) ve ilanı kapalı firmaya (ilan_kapandi) başvur, açık ilana başvur (kabul); ret örnekleri."""
    i = Isci(test, dao_overrides(), weeks=12)
    sayac = [0]
    ret: list[dict] = []

    def karar(k: dict) -> dict:
        sayac[0] += 1
        n = sayac[0]
        i.w.send({"cmd": "karar", "id": n, "karar": k})
        ev = i.bekle(lambda e: e.get("ev") == "karar" and e["id"] == n)
        if not ev["kabul"]:
            ret.append({"karar": k, "kod": ev["kod"], "fields": ev["fields"]})
        return ev

    olaylar: list[dict] = []
    g1 = i.hafta(1)["dao"]
    firma0 = g1["ilanlar"][0]["firma"]
    karar({"tur": "ayril"})                                   # ahırdayken: ahirda
    karar({"tur": "basvur", "firma": firma0})                 # ahırdayken: ahirda
    karar({"tur": "ahirdan_cik"})
    g2 = i.hafta(2)["dao"]
    olaylar += g2["olaylar"]
    karar({"tur": "ahirdan_cik"})                             # ahırda değilken: ahirda_degil
    karar({"tur": "basvur", "firma": "yok_firma"})            # geçersiz firma
    karar({"tur": "basvur", "firma": "s1_universite0"})       # başka şehir: basvuru_red sehir
    olaylar += i.hafta(3)["dao"]["olaylar"]
    karar({"tur": "basvur", "firma": "s0_market0"})           # kadro hedefi yok: basvuru_red ilan_kapandi
    g4 = i.hafta(4)["dao"]
    olaylar += g4["olaylar"]
    firma0 = next((x["firma"] for x in g4["ilanlar"] if x["sektor"] == "belediye"), firma0)          # ücreti şehir hesabından ödenen kamu işi: kabul sonrası ücret kaybı gürültüsü yok, iş değiştirme görünür
    karar({"tur": "basvur", "firma": firma0})                 # açık ilan: basvuru_kabul
    g5 = i.hafta(5)["dao"]
    olaylar += g5["olaylar"]
    firma1 = next(x["firma"] for x in g5["ilanlar"] if x["firma"] != firma0 and x["sektor"] not in ("arge", "universite"))
    karar({"tur": "basvur", "firma": firma0})                 # kendi işvereni: karar_gecersiz ayni_firma
    karar({"tur": "basvur", "firma": firma1})                 # çalışırken başka ilana başvuru (iş değiştirme): kabulde is_degistirdi, aksi basvuru_red
    for w in range(6, 13):                                    # kabul sonrası gözlem: çalışıyor; sonraki haftalarda işten çıkarılırsa olay (isten_cikarildi{neden})
        gw = i.hafta(w)["dao"]
        olaylar += gw["olaylar"]
    return _yuvarla({"gozlem": g2, "kabul_gozlemi": g5, "olaylar": olaylar, "ret": ret})


def _tur_ornegi(olaylar: list[dict], tur: str, **alan) -> dict:
    return next(o for o in olaylar if o["tur"] == tur and all(o.get(k) == v for k, v in alan.items()))


class TestDaoTelFiksturu(unittest.TestCase):
    def setUp(self):
        global FIKSTUR
        FIKSTUR = json.loads(YOL.read_text(encoding="utf-8")) if YOL.exists() else None

    @unittest.skipIf(QUICK, "gerçek model")
    def test_gercek_cikti_fikstur_dosyasi_ayni(self):
        gercek = json.dumps(gercek_fikstur(self), ensure_ascii=False, indent=1) + "\n"
        if os.environ.get("YENILE_DAO_FIKSTURU") == "1":
            YOL.write_text(gercek, encoding="utf-8")
        self.assertEqual(YOL.read_text(encoding="utf-8"), gercek)

    def test_fikstur_kapsami(self):
        """Fikstür yeni sözleşmenin her parçasını taşır: ilanlar, üç yeni olay (kabul ve iki red nedeni), ret nedenleri."""
        self.assertIsNotNone(FIKSTUR, "tests/fixtures/dao_tel.json yok (YENILE_DAO_FIKSTURU=1 ile üret)")
        g = FIKSTUR["gozlem"]
        self.assertTrue(g["ilanlar"])
        self.assertEqual(set(g["ilanlar"][0]), {"firma", "ad", "sektor", "acik", "ucret", "kasa_gucu", "maas_odeyemedi"})
        self.assertTrue(all(i["kasa_gucu"] in ("zayif", "orta", "guclu") for i in g["ilanlar"]))
        self.assertEqual([i["ucret"] for i in g["ilanlar"]], sorted((i["ucret"] for i in g["ilanlar"]), reverse=True))
        self.assertEqual([o["tur"] for o in g["olaylar"]], ["ahirdan_cikti"])
        o = FIKSTUR["olaylar"]
        self.assertEqual(sorted({(e["tur"], e.get("neden")) for e in o}), [("ahirdan_cikti", None), ("basvuru_kabul", None), ("basvuru_red", "ilan_kapandi"), ("basvuru_red", "sehir"), ("is_degistirdi", None), ("ise_girdi", None), ("isten_cikarildi", "ucret_odenmedi")])
        dg = next(e for e in o if e["tur"] == "is_degistirdi")
        self.assertEqual(set(dg), {"tur", "hafta", "eski", "yeni"})          # çalışan insan işten ayrılmadan başvurdu; eski işten isten_cikarildi yok
        self.assertNotIn(dg["eski"], [e["firma"] for e in o if e["tur"] == "isten_cikarildi"])
        self.assertIn("kabul_gozlemi", FIKSTUR)
        nedenler = {(f["id"], f["reason"]) if isinstance(f, dict) else (f, "invalid") for r in FIKSTUR["ret"] for f in r["fields"]}
        self.assertEqual(nedenler, {("tur", "ahirda"), ("tur", "ahirda_degil"), ("firma", "invalid"), ("firma", "ayni_firma")})
        self.assertTrue(all(r["kod"] == "karar_gecersiz" for r in FIKSTUR["ret"]))

    def test_tecrube_hafta_sozlesmesi(self):
        """ben.tecrube_hafta terfi sayacıdır (calisilan_hafta değil); terfi_esik kalfa/usta hafta ve itibar eşiklerini taşır."""
        b = FIKSTUR["gozlem"]["ben"]
        self.assertIsInstance(b["tecrube_hafta"], float)
        self.assertGreaterEqual(b["tecrube_hafta"], 0.0)
        self.assertEqual(set(b["terfi_esik"]), {"kalfa", "usta"})
        self.assertEqual(set(b["terfi_esik"]["kalfa"]), {"hafta", "itibar"})
        self.assertLess(b["terfi_esik"]["kalfa"]["hafta"], b["terfi_esik"]["usta"]["hafta"])

    def test_sahte_host_gozlemi_gercek_sekilde(self):
        """Sahte host: aynı anahtarlar ve türler (ilanlar dahil), ürettiği her yeni olay fikstürdeki aynı türün şekline uyar."""
        h = FakeHost("", {"HUMAN_ON": 1})
        h.step()
        h.dao_karar({"tur": "ahirdan_cik"})
        h.step()
        h.step()
        g = h.dao_gozlem()
        self.assertEqual(sekil_farki(g, FIKSTUR["gozlem"]), [])
        for kar, tur in (({"tur": "ahirdan_cik"}, "ahirdan_cikti"), ({"tur": "basvur", "firma": "fk1"}, "basvuru_kabul")):
            h = FakeHost("", {"HUMAN_ON": 1})
            h.step()
            if kar["tur"] == "basvur":
                h.dao_karar({"tur": "ahirdan_cik"})
                h.step()
            h.dao_karar(kar)
            h.step()
            olay = h.dao_gozlem()["olaylar"][0]
            self.assertEqual(olay["tur"], tur)
            self.assertEqual(sekil_farki(olay, _tur_ornegi(FIKSTUR["olaylar"], tur)), [])
        h.step()
        h.dao_karar({"tur": "basvur", "firma": "fk2"})
        h.step()
        red = h.dao_gozlem()["olaylar"][0]
        self.assertEqual(red["tur"], "basvuru_red")
        self.assertEqual(sekil_farki(red, _tur_ornegi(FIKSTUR["olaylar"], "basvuru_red", neden="sehir")), [])

    def test_sahte_host_kadro_karari(self):
        """G17i + son inceleme K5: sahte host kadro {hedef} gercek human_submit gibi: HIRE_TARGET kapaliyken bayrak_kapali; isletme sahibi degilse isletme_sahibi_degil; sahibe 1..kapasite tam sayi kabul; hedef BIR SONRAKI hafta acilisinda uygulanir (kadro_hedefi olayi); firmam sahiplikten gelir, hedef null'da kaybolmaz (hedef None)."""
        h = FakeHost("", {"HUMAN_ON": 1})
        h.step()
        with self.assertRaises(FakeKararHatasi) as cm:
            h.dao_karar({"tur": "kadro", "hedef": 3})
        self.assertEqual((str(cm.exception), cm.exception.fields), ("karar_gecersiz", [{"id": "tur", "reason": "bayrak_kapali"}]))
        self.assertIsNone(h.dao_gozlem()["firmam"])
        h = FakeHost("", {"HUMAN_ON": 1, "HIRE_TARGET": 1})
        h.step()
        with self.assertRaises(FakeKararHatasi) as cm:                                 # sahte insan isletme sahibi degil: karar kabul edilmez, firmam yok
            h.dao_karar({"tur": "kadro", "hedef": 3})
        self.assertEqual((str(cm.exception), cm.exception.fields), ("karar_gecersiz", [{"id": "tur", "reason": "isletme_sahibi_degil"}]))
        self.assertIsNone(h.dao_gozlem()["firmam"])
        h._dao_sahip = True                                                            # sahte insan isletme sahibi
        self.assertEqual(h.dao_gozlem()["firmam"]["hedef"], None)                      # firmam sahiplikten gelir; karar yok -> hedef None
        self.assertEqual(h.dao_gozlem()["firmam"]["kapasite"], 25)
        for kotu in (0, -1, 26, 2.5, True, "3"):
            with self.assertRaises(FakeKararHatasi, msg=repr(kotu)) as cm:
                h.dao_karar({"tur": "kadro", "hedef": kotu})
            self.assertEqual(cm.exception.fields, ["hedef"])
        with self.assertRaises(FakeKararHatasi):
            h.dao_karar({"tur": "kadro"})
        self.assertEqual(h.dao_karar({"tur": "kadro", "hedef": 4}), 2)
        self.assertIsNone(h.dao_gozlem()["firmam"]["hedef"])                           # hedef bir sonraki hafta acilisinda uygulanir
        h.step()
        self.assertEqual(h.dao_gozlem()["firmam"]["hedef"], 4)
        self.assertEqual([e for e in h.dao_gozlem()["olaylar"] if e["tur"] == "kadro_hedefi"], [{"tur": "kadro_hedefi", "hafta": 2, "firma": "fk0", "hedef": 4}])
        h.dao_karar({"tur": "kadro", "hedef": None})                                  # null: bot sezgisine donus
        self.assertEqual(h.dao_gozlem()["firmam"]["hedef"], 4)
        h.step()
        self.assertIsNotNone(h.dao_gozlem()["firmam"])                                 # firmam kaybolmaz
        self.assertIsNone(h.dao_gozlem()["firmam"]["hedef"])
        h = FakeHost("", {"HUMAN_ON": 1, "HIRE_TARGET": 1, "HIRE_CASH_GATE": 0, "HIRE_GATE_ALL": 0})
        h.step()
        with self.assertRaises(FakeKararHatasi) as cm:
            h.dao_karar({"tur": "kadro", "hedef": 3})
        self.assertEqual(cm.exception.fields, [{"id": "tur", "reason": "kasa_kapisi_kapali"}])

    def test_sahte_host_is_degistirdi_gercek_sekilde(self):
        """Sahte host: çalışan oyuncu başka ilana başvurunca `is_degistirdi{eski, yeni}` fikstürdeki gerçek olayla aynı şekilde gelir."""
        h = FakeHost("", {"HUMAN_ON": 1})
        h.step()
        h.dao_karar({"tur": "ahirdan_cik"})
        h.step()
        h.dao_karar({"tur": "basvur", "firma": "fk0"})
        h.step()
        h.dao_karar({"tur": "basvur", "firma": "fk1"})
        h.step()
        olay = [e for e in h.dao_gozlem()["olaylar"] if e["tur"] == "is_degistirdi"]
        self.assertEqual(len(olay), 1)
        self.assertEqual(sekil_farki(olay[0], _tur_ornegi(FIKSTUR["olaylar"], "is_degistirdi")), [])
        self.assertEqual((olay[0]["eski"], olay[0]["yeni"]), ("fk0", "fk1"))

    def test_sahte_host_ret_nedenleri_gercekle_ayni(self):
        """Sahte host'un ret nedenleri fikstürdeki gerçek model nedenleriyle birebir (kod ve `{id, reason}` biçimi)."""
        from oyun_server.testing import FakeKararHatasi
        h = FakeHost("", {"HUMAN_ON": 1})
        h.step()
        gorulen = []
        for r in FIKSTUR["ret"]:
            k = dict(r["karar"])
            if k["tur"] == "ahirdan_cik":
                h.step()                                                      # sahte oyuncu 2. haftadan sonra ahırdan çıkmış
            if k["tur"] == "basvur" and r["fields"] == [{"id": "firma", "reason": "ayni_firma"}]:
                h.dao_karar({"tur": "basvur", "firma": "fk0"})                # sahte oyuncu fk0'da çalışır; kendi işvereni: ayni_firma
                h.step()
                k = {"tur": "basvur", "firma": "fk0"}
            with self.assertRaises(FakeKararHatasi) as cm:
                h.dao_karar(k)
            gorulen.append({"karar": r["karar"], "kod": str(cm.exception), "fields": cm.exception.fields})
        self.assertEqual(gorulen, FIKSTUR["ret"])


if __name__ == "__main__":
    unittest.main()


class TestSahteIstenCikarma(unittest.TestCase):
    def test_kabulden_uc_hafta_sonra_isten_cikarildi_ve_is_arayan(self):
        """Sahte host: kabul edilen işten 3 hafta sonra `isten_cikarildi{firma, neden}` gelir (gerçek olay şekli), oyuncu yeniden iş arayan olur."""
        h = FakeHost("", {"HUMAN_ON": 1})
        h.step()
        h.dao_karar({"tur": "ahirdan_cik"})
        h.step()
        h.dao_karar({"tur": "basvur", "firma": "fk1"})
        h.step()
        self.assertEqual(h.dao_gozlem()["ben"]["durum"], "calisan")
        h.step()
        h.step()
        self.assertEqual(h.dao_gozlem()["olaylar"], [])
        h.step()
        g = h.dao_gozlem()
        self.assertEqual(g["olaylar"], [{"tur": "isten_cikarildi", "hafta": 6, "firma": "fk1", "neden": "ucret_odenmedi"}])
        self.assertEqual(g["ben"]["durum"], "is_arayan")
        o = next(e for e in FIKSTUR_OLAYLARI() if e["tur"] == "isten_cikarildi")
        self.assertEqual(set(o), set(g["olaylar"][0]))


def FIKSTUR_OLAYLARI() -> list[dict]:
    return json.loads(YOL.read_text(encoding="utf-8"))["olaylar"]
