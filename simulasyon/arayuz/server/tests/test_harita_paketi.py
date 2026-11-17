"""T10: paketin `harita` alanı (şehir haritası). Sahte saat + süreç içi işçi (test_manager tabanı); firma anlık görüntüsü her canlı koşuda istenir."""
from __future__ import annotations

import json
import random
import unittest

from oyun_server.runs import routes
from oyun_server.sim.extract import harita_of, make_packet

from tests.extract_v2_helpers import QUICK, real_run
from tests.test_manager import ManagerBase

SAHIPLER = {"npc", "oyuncu", "dao"}


def harita_coz(h: dict, tam: bool = False) -> list[list]:
    """Sıkıştırılmış harita bloğunu satırlara çevirir: [id, tür, şehir, çalışan, lonca|None, sahip]; `tam=True` ise sonuna `dogum`, `durum` da eklenir."""
    out = []
    for no, ti, sehir, cal, li, si, dogum, durum in h["firmalar"]:
        tur = h["turler"][ti]
        sat = [no if isinstance(no, str) else "s%d_%s%d" % (sehir, tur, no), tur, sehir, cal, None if li == -1 else h["loncalar"][li], h["sahipler"][si]]
        out.append(sat + [dogum, durum] if tam else sat)
    return out


def _row(i: int, **kw) -> dict:
    d = {"id": "f%d" % i, "kind": "un", "city": i % 5, "owner": "npc", "lonca": None, "orgOwned": False, "workers": 5, "dead": False}
    d.update(kw)
    return d


class TestHaritaOf(unittest.TestCase):
    def test_sahip_turetme(self):
        rows = [_row(0), _row(1, owner="player"), _row(2, owner="player", orgOwned=True), _row(3, owner="public"), _row(4, owner="player", lonca="lonca2")]
        out = harita_of(10, rows)
        self.assertEqual([r[5] for r in harita_coz(out)], ["npc", "oyuncu", "dao", "npc", "oyuncu"])
        self.assertEqual(harita_coz(out)[4], ["f4", "un", 4, 5, "lonca2", "oyuncu"])

    def test_eski_olu_isletme_yok(self):
        out = harita_of(30, [_row(0), _row(1, dead=True, died=5), _row(2)])
        self.assertEqual([r[0] for r in harita_coz(out)], ["f0", "f2"])

    def test_anlik_goruntu_yok(self):
        self.assertIsNone(harita_of(10, None))

    def test_paket_boyutu_3000_isletme(self):
        rng = random.Random(7)
        rows = [_row(i, kind=rng.choice(["tarla_bugday", "maden_komur", "lojistik", "restoran"]), city=rng.randrange(8), workers=rng.randrange(1, 90),
                     owner=rng.choice(["npc", "player"]), lonca=rng.choice([None, "lonca%d" % rng.randrange(6)]), orgOwned=rng.random() < 0.1, id="firma%d" % (10000 + i))
                for i in range(3000)]
        h = harita_of(520, rows)
        self.assertEqual(len(h["firmalar"]), 3000)
        self.assertLess(len(json.dumps(h, ensure_ascii=False, separators=(",", ":")).encode("utf-8")), 150 * 1024)

    def test_make_packet_eski_alanlari_degistirmez(self):
        row = {"week": 1}
        a = make_packet("r", 1, 1, row)
        b = make_packet("r", 1, 1, row, harita=None)
        self.assertEqual(a, b)
        self.assertNotIn("harita", a)
        c = make_packet("r", 1, 1, row, harita={"hafta": 1, "firmalar": []})
        self.assertEqual({k: v for k, v in c.items() if k != "harita"}, a)


class TestDogumDurum(unittest.TestCase):
    """Salt-okunur `dogum` ve `durum` kolonları. Pano sağlık sınıfı: `host.firm_rows` `health` = `W.board["fh"][ref]["h"]` (host.py `firm_rows`, drawers.py `_firm` aynı ölçü);
    modelde sağlıklı = `h >= SB_H_OK` (simkit/params.py, 0.5; sector_board.py `n_h`). Sağlıksız taraf = `h < SB_H_OK`. `n_h_` mevduat sayacıdır, kullanılmaz."""

    @staticmethod
    def _durum(hafta, **kw):
        return harita_coz(harita_of(hafta, [_row(0, **kw)]), tam=True)

    def test_durum_ve_dogum_kolonlari(self):
        from oyun_server.sim.extract import HARITA_ALANLAR, HARITA_DURUMLAR
        self.assertEqual(HARITA_ALANLAR, ["id", "tur", "sehir", "calisan", "lonca", "sahip", "dogum", "durum"])
        self.assertEqual(HARITA_DURUMLAR, ["uretim", "zayif", "issiz", "kapali"])
        out = harita_of(40, [_row(0, born=12, health=0.9), _row(1, born=3, health=0.2), _row(2, workers=0, staffless=True, born=7), _row(3, dead=True, died=35, born=1)])
        self.assertEqual(out["alanlar"], HARITA_ALANLAR)
        self.assertEqual([(r[6], r[7]) for r in harita_coz(out, tam=True)], [(12, "uretim"), (3, "zayif"), (7, "issiz"), (1, "kapali")])
        for sat in out["firmalar"]:
            self.assertEqual(len(sat), 8)

    def test_olu_firma_son_10_haftada_kapali_girer(self):
        self.assertEqual(self._durum(40, dead=True, died=30)[0][7], "kapali")      # died == hafta-10: dahil
        self.assertEqual(self._durum(40, dead=True, died=40)[0][7], "kapali")
        self.assertEqual(self._durum(40, dead=True, died=29), [])                  # 11 hafta önce: girmez

    def test_died_none_olu_ayni_anlik_goruntude_kapali(self):
        self.assertEqual(self._durum(40, dead=True, died=None)[0][7], "kapali")

    def test_eski_olu_firma_girmez(self):
        self.assertEqual(self._durum(100, dead=True, died=2), [])

    def test_staffless_issiz(self):
        self.assertEqual(self._durum(10, staffless=True, workers=0, health=0.1)[0][7], "issiz")      # issiz zayiftan once
        self.assertEqual(self._durum(10, staffless=False)[0][7], "uretim")

    def test_zayif_pano_sinifindan(self):
        self.assertEqual(self._durum(10, health=0.4999)[0][7], "zayif")
        self.assertEqual(self._durum(10, health=0.5)[0][7], "uretim")                 # h >= SB_H_OK sağlıklı
        self.assertEqual(self._durum(10, health=None)[0][7], "uretim")                # pano kapalı
        self.assertEqual(self._durum(10)[0][7], "uretim")                             # alan yok
        self.assertEqual(self._durum(10, health=0.0)[0][7], "zayif")

    def test_esik_modeldeki_sb_h_ok_ile_ayni(self):
        import re
        from pathlib import Path
        from oyun_server.sim.extract import HARITA_ZAYIF_ESIK
        params = Path(__file__).resolve().parents[3] / "kagit-ustu" / "modulerlestirme" / "simkit" / "params.py"
        m = re.search(r"^SB_H_OK\s*=\s*([0-9.]+)", params.read_text(encoding="utf-8"), re.M)
        self.assertIsNotNone(m)
        self.assertEqual(HARITA_ZAYIF_ESIK, float(m.group(1)))

    def test_npc_dogum_null(self):
        self.assertIsNone(self._durum(10, born=None)[0][6])
        self.assertIsNone(self._durum(10)[0][6])
        self.assertEqual(self._durum(10, born=0)[0][6], 0)

    def test_model_ciktisi_degismedi(self):
        """world/cities satırları: harita bloğu eklenip çıkarılınca paketin geri kalanı birebir aynı."""
        row = {"week": 3}
        cities = [{"city": 0, "x": 1.5}]
        a = make_packet("r", 3, 1, row, cities)
        b = make_packet("r", 3, 1, row, cities, harita=harita_of(3, [_row(0, born=1, health=0.1)]))
        self.assertEqual({k: v for k, v in b.items() if k != "harita"}, a)
        self.assertEqual(a["cities"], cities)


class TestAnlikGoruntuSikligi(unittest.TestCase):
    def test_dao_her_hafta(self):
        from oyun_server.sim.worker import _firms_due
        self.assertTrue(all(_firms_due(w, 200, True) for w in range(1, 40)))

    def test_kurucu_de_her_hafta_anlik_goruntu_ister(self):
        """Kurucu'da işçi her hafta firma satırı üretir (aradaki haftalar `haritaFark` olur); tam/delta kararı yöneticide."""
        from oyun_server.sim.worker import _firms_due
        self.assertEqual([w for w in range(1, 36) if _firms_due(w, 35, False)], list(range(1, 36)))

    @staticmethod
    def _gercekci_satirlar(n: int = 3000) -> list[dict]:
        """Gerçek modelin kimlik uzunluğunda (`s<şehir>_<tür><sayı>`), 12 tür, 5 şehir, her beşinci işletme loncalı, bazıları oyuncu/DAO."""
        kinds = ["tarla_bugday", "un", "firin", "market", "lojistik", "tekstil", "maden_komur", "restoran", "giyim", "okul", "ahir", "santral"]
        sayac: dict = {}
        rows = []
        for i in range(n):
            k, c = kinds[i % len(kinds)], (i // len(kinds)) % 5
            no = sayac[(k, c)] = sayac.get((k, c), -1) + 1
            rows.append({"id": "s%d_%s%d" % (c, k, no), "kind": k, "city": c, "workers": 1 + (i * 7) % 90, "lonca": "lonca%d" % (i % 6) if i % 5 == 0 else None,
                         "owner": "player" if i % 7 == 0 else "npc", "orgOwned": i % 23 == 0, "dead": False})
        return rows

    @staticmethod
    def _dao_host():
        from oyun_server.testing import FakeHost
        fh = FakeHost("x", {"HUMAN_ON": 1})
        fh.week = 5
        return fh

    def _boyut(self, cities, chain, holdings, dao) -> int:
        self.assertIsInstance(dao, dict)                       # DAO gözlemi gerçekten pakette
        pkt = make_packet("canli-00000000", 7, 1, {"week": 7}, cities, chain, holdings, None, None, None, harita_of(7, self._gercekci_satirlar()), dao)
        self.assertIn("dao", pkt)
        return len(json.dumps(pkt, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def test_tam_hafta_paketi_3000_isletme_butcesi_sahte_blok(self):
        """QUICK'te de koşar: sahte host'un şehir satırları ve DAO gözlemi (HUMAN_ON açık), zincir bloğu ölçülen en büyük boyutta (36.334 B) dolgu, holdings 2.400 B dolgu."""
        fh = self._dao_host()
        n = self._boyut(fh.snapshot()["cities"], {"dolgu": "x" * 36334}, {"dolgu": "x" * 2400}, fh.dao_gozlem())
        self.assertLess(n, 150 * 1024, n)

    @unittest.skipIf(QUICK, "gerçek model")
    def test_tam_hafta_paketi_3000_isletme_butcesi(self):
        """DAO'da her hafta giden tam paket (gerçek şehirler + zincir + holdings, sahte host DAO gözlemi, 3000 işletme) 150 KB altında."""
        snap = real_run().snaps[-1]
        n = self._boyut(snap.get("cities"), snap.get("chain"), snap.get("holdings"), self._dao_host().dao_gozlem())
        self.assertLess(n, 150 * 1024, n)


class TestHaritaKodlama(unittest.TestCase):
    def test_guvenli_olmayan_buyuk_sayi_dizge_kalir(self):
        out = harita_of(1, [_row(0, id="s0_un%d" % (2 ** 53), kind="un", city=0), _row(1, id="s0_un%d" % (2 ** 53 - 1), kind="un", city=0)])
        self.assertEqual([r[0] for r in out["firmalar"]], ["s0_un%d" % (2 ** 53), 2 ** 53 - 1])

    def test_dizge_olmayan_kimlik_dizge_gider(self):
        out = harita_of(1, [_row(0, id=12345)])
        self.assertEqual(out["firmalar"][0][0], "12345")

    def test_gercek_cikti_fikstur_dosyasi_ayni_bayt(self):
        """Web testi (`harita_tel.json`) aynı baytları `parseHarita` ile çözer. Yenileme: bu testi `YENILE_HARITA_FIKSTURU=1` ile koş."""
        import os
        from pathlib import Path
        yol = Path(__file__).parent / "fixtures" / "harita_tel.json"
        rows = [_row(0, id="s0_tarla_bugday0", kind="tarla_bugday", city=0, workers=40), _row(1, id="s1_un12", kind="un", city=1, lonca="lonca2", owner="player", workers=7),
                _row(2, id="ozel-kimlik", kind="un", city=2, orgOwned=True, owner="player"), _row(3, id=77, kind="firin", city=0, lonca="lonca2"),
                _row(4, id="s0_un%d" % (2 ** 53), kind="un", city=0), _row(5, id="s0_un07", kind="un", city=0, dead=True, died=2),
                _row(6, id="s2_un3", kind="un", city=2, born=4, health=0.2), _row(7, id="s2_un4", kind="un", city=2, born=8, workers=0, staffless=True),
                _row(8, id="s2_un5", kind="un", city=2, born=1, dead=True, died=7)]
        gercek = json.dumps(harita_of(10, rows), ensure_ascii=False, indent=1, sort_keys=False) + "\n"
        if os.environ.get("YENILE_HARITA_FIKSTURU") == "1":
            yol.write_text(gercek, encoding="utf-8")
        self.assertEqual(yol.read_text(encoding="utf-8"), gercek)


class TestOluGecmisi(unittest.TestCase):
    def test_olu_isletmenin_kar_gecmisi_kalir_yeni_deger_eklenmez(self):
        from types import SimpleNamespace
        from oyun_server.sim.host import ModelHost
        firms = {"a": {"owner": None, "prof": 2.0, "workers": [], "kind": "un"}, "b": {"owner": None, "prof": 5.0, "workers": [], "kind": "un"}}
        stub = SimpleNamespace(_W=SimpleNamespace(firms=firms, prof_ema={}), PROFIT_HIST_WEEKS=12)
        for _ in range(2):
            ModelHost._track_profit(stub)
        firms["b"]["dead"] = True
        firms["a"]["prof"] = 3.0
        ModelHost._track_profit(stub)
        hist = stub._profit_hist
        self.assertEqual(list(hist["b"]), [5.0, 5.0])
        self.assertEqual(list(hist["a"]), [2.0, 2.0, 3.0])


class TestHaritaFarkOf(unittest.TestCase):
    """`harita_fark_of`: tabana göre `degisen` (durum ya da boy kovası), `yeni`, `kapanan`."""

    @staticmethod
    def _taban(hafta, rows):
        from oyun_server.sim.extract import harita_taban_of
        return harita_taban_of(hafta, rows)

    def test_boy_kovasi_ayni_calisan_degisimi_tasinmaz(self):
        from oyun_server.sim.extract import harita_fark_of
        t = self._taban(10, [_row(0, workers=10), _row(1, workers=10), _row(2, workers=10)])
        f = harita_fark_of(11, t, [_row(0, workers=19), _row(1, workers=20), _row(2, workers=7)])      # 8-19 aynı kova; 20 üst kova; 7 alt kova
        self.assertEqual(f["degisen"], [["f1", 0, 20], ["f2", 0, 7]])

    def test_durum_degisimi(self):
        from oyun_server.sim.extract import harita_fark_of
        t = self._taban(10, [_row(0, health=0.9), _row(1, health=0.9)])
        f = harita_fark_of(11, t, [_row(0, health=0.2), _row(1, health=0.9)])
        self.assertEqual(f["degisen"], [["f0", 1, 5]])
        self.assertEqual(harita_fark_of(11, t, [_row(0, health=0.9), _row(1, health=0.9)])["degisen"], [])

    def test_yeni_tam_satir_kapanan_listeden_dusen(self):
        from oyun_server.sim.extract import harita_fark_of
        t = self._taban(30, [_row(0), _row(1, dead=True, died=22), _row(2)])
        rows = [_row(0), _row(2), _row(3, id="s1_un9", kind="un", city=1, lonca="lonca4", owner="player", born=31)]
        f = harita_fark_of(33, t, rows)                                 # f1: died 22 < 33-10: listeden düştü
        self.assertEqual(f["kapanan"], ["f1"])
        self.assertEqual(f["yeni"], [["s1_un9", "un", 1, 5, "lonca4", "oyuncu", 31, "uretim"]])       # tam satır, dizgeli (sıkıştırma tabloları yok)
        self.assertEqual(f["degisen"], [])
        self.assertEqual((f["hafta"], f["taban"]), (33, 30))

    def test_olum_listeden_dusme_degil_degisen(self):
        from oyun_server.sim.extract import harita_fark_of
        t = self._taban(10, [_row(0)])
        f = harita_fark_of(12, t, [_row(0, dead=True, died=11, workers=0)])
        self.assertEqual((f["degisen"], f["kapanan"]), ([["f0", 3, 0]], []))

    def test_fark_tam_haritanin_kucuk_bir_kismi(self):
        from oyun_server.sim.extract import harita_fark_of
        rows = TestAnlikGoruntuSikligi._gercekci_satirlar(1000)
        t = self._taban(10, rows)
        degisti = [dict(r, workers=r["workers"] + 30) if i % 50 == 0 else r for i, r in enumerate(rows)]       # %2 işletme kova değiştirir
        f = harita_fark_of(11, t, degisti)
        tam = len(json.dumps(harita_of(10, rows), ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        self.assertLessEqual(len(json.dumps(f, ensure_ascii=False, separators=(",", ":")).encode("utf-8")), tam * 0.30)      # kabul (karar): delta ortalaması <= tam haritanın %30'u

    def test_make_packet_fark_yalniz_verilirse(self):
        row = {"week": 1}
        a = make_packet("r", 1, 1, row)
        b = make_packet("r", 1, 1, row, harita_fark={"hafta": 1, "taban": 1, "degisen": [], "yeni": [], "kapanan": []})
        self.assertNotIn("haritaFark", a)
        self.assertEqual({k: v for k, v in b.items() if k != "haritaFark"}, a)

    def test_fark_tel_fiksturu(self):
        """Web testi (`harita_fark_tel.json`) aynı baytları `parseHaritaFark` ile çözer. Yenileme: bu testi `YENILE_HARITA_FIKSTURU=1` ile koş."""
        import os
        from pathlib import Path
        from oyun_server.sim.extract import harita_fark_of
        yol = Path(__file__).parent / "fixtures" / "harita_fark_tel.json"
        rows = [_row(0, id="s0_tarla_bugday0", kind="tarla_bugday", city=0, workers=40), _row(1, id="s1_un12", kind="un", city=1, workers=7), _row(2, id="ozel-kimlik", kind="un", city=2),
                _row(3, id="s2_un3", kind="un", city=2, health=0.9), _row(4, id="s2_un4", kind="un", city=2, dead=True, died=12, born=1), _row(5, id="s2_un5", kind="un", city=2)]
        t = self._taban(20, rows)
        yeni = rows[:1] + [dict(rows[1], workers=25)] + [rows[2]] + [dict(rows[3], health=0.1)] + [dict(rows[4], died=12)]       # f4 (died 12 < 24-10): listeden düşer; f5 yok: kapanan
        yeni.append(_row(6, id="s1_firin2", kind="firin", city=1, lonca="lonca2", owner="player", born=22))
        gercek = json.dumps(harita_fark_of(24, t, yeni), ensure_ascii=False, indent=1) + "\n"
        if os.environ.get("YENILE_HARITA_FIKSTURU") == "1":
            yol.write_text(gercek, encoding="utf-8")
        self.assertEqual(yol.read_text(encoding="utf-8"), gercek)


class TestHaritaTabanKorumasi(unittest.TestCase):
    def test_kapanan_sonra_yeniden_canlanan_firma_farkta_dogru(self):
        """Tabanda listede olan firma bir haftada düşer (`kapanan`), sonraki haftada tekrar listeye girer: fark yeniden hesaplanır, firma `kapanan`da kalmaz, durumu `degisen`de görünür."""
        from oyun_server.sim.extract import harita_fark_of, harita_taban_of
        t = harita_taban_of(30, [_row(0), _row(1, dead=True, died=22, workers=0)])      # f1 tabanda kapali
        f33 = harita_fark_of(33, t, [_row(0)])                                           # died 22 < 33-10: düştü
        self.assertEqual(f33["kapanan"], ["f1"])
        f34 = harita_fark_of(34, t, [_row(0), _row(1, workers=6)])                       # yeniden canlandı
        self.assertEqual((f34["kapanan"], f34["yeni"], f34["degisen"]), ([], [], [["f1", 0, 6]]))
        f35 = harita_fark_of(35, harita_taban_of(30, [_row(0)]), [_row(0), _row(1, workers=6)])      # tabanda hiç yoksa: yeni
        self.assertEqual([r[0] for r in f35["yeni"]], ["f1"])

    def test_cift_kimlik_sessiz_birlesmez(self):
        import contextlib, io
        from oyun_server.sim.extract import harita_taban_of
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            t = harita_taban_of(10, [_row(0), _row(0, workers=9)])
        self.assertIn("çift işletme kimliği", err.getvalue())
        self.assertEqual(len(t["satir"]), 1)

    def test_boy_esikleri_web_ile_ayni(self):
        """Python `HARITA_BOY_ESIKLERI` ile web `BOY_ESIKLERI` (haritaStili.ts) elle senkrondur; sapma burada kırılır."""
        import re
        from pathlib import Path
        from oyun_server.sim.extract import HARITA_BOY_ESIKLERI
        ts = Path(__file__).resolve().parents[4] / "apps" / "web" / "src" / "oyun" / "harita" / "haritaStili.ts"
        m = re.search(r"BOY_ESIKLERI[^=]*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]", ts.read_text(encoding="utf-8"))
        self.assertIsNotNone(m)
        self.assertEqual(HARITA_BOY_ESIKLERI, tuple(int(x) for x in m.groups()))


class TestHaritaYonetici(ManagerBase):
    def _kos(self, hafta: int) -> list[dict]:
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= hafta)
        m.control(rid, "pause")
        self.mgr.pump(self.clock())
        return m.weeks(rid, 1, hafta)

    def test_kurucu_her_hafta_harita_ya_da_fark(self):
        pk = self._kos(30)
        self.assertEqual([p["week"] for p in pk if "harita" in p], [1, 10, 20, 30])
        for p in pk:
            tam = p["week"] == 1 or p["week"] % 10 == 0
            self.assertEqual(("harita" in p, "haritaFark" in p), (tam, not tam), p["week"])        # her pakette tam ya da fark; ikisi birden değil
            if not tam:
                taban = 1 if p["week"] < 10 else (10 if p["week"] < 20 else 20)
                f = p["haritaFark"]
                self.assertEqual((f["hafta"], f["taban"]), (p["week"], taban), p["week"])
                self.assertEqual(set(f), {"hafta", "taban", "degisen", "yeni", "kapanan"})

    def test_fark_yalniz_degisenleri_tasir(self):
        pk = {p["week"]: p for p in self._kos(20)}
        for w in range(11, 15):                                        # fk3 15. haftada ölür: öncesinde hiçbir şey değişmedi
            self.assertEqual(pk[w]["haritaFark"], {"hafta": w, "taban": 10, "degisen": [], "yeni": [], "kapanan": []}, w)
        for w in range(15, 20):
            f = pk[w]["haritaFark"]
            self.assertEqual(f["degisen"], [["fk3", 3, 0]], w)           # [kimlik, durum indeksi (kapali = 3), çalışan]; öteki 3 işletme taşınmaz
            self.assertEqual((f["yeni"], f["kapanan"]), ([], []), w)

    def test_dao_paketinde_fark_yok_harita_her_hafta(self):
        """DAO ve Kurucu için ayrı kadans: DAO her hafta tam harita (fark yok), Kurucu aradaki haftalarda yalnız fark."""
        from tests.test_dao_isci import DaoBase

        class Dao(DaoBase):
            def runTest(self):
                pass
        t = Dao()
        t.setUp()
        self.addCleanup(t.tearDown)
        m = t.make()
        rid, _ = t.create_dao()
        m.control(rid, "play", 16)
        t.bekle_hafta(rid, 12)
        m.control(rid, "pause")
        for p in m.weeks(rid, 1, 12):
            self.assertIn("harita", p, p["week"])
            self.assertNotIn("haritaFark", p, p["week"])

    def test_satir_bicimi_ve_canli(self):
        pk = self._kos(20)
        h = next(p["harita"] for p in pk if p["week"] == 20)
        self.assertEqual(h["hafta"], 20)
        self.assertEqual(len(h["firmalar"]), 4)                      # fk3 15. haftada öldü; 20 - 15 <= 10: kapali olarak listede
        durum = {r[0]: r[7] for r in harita_coz(h, tam=True)}
        self.assertEqual(durum["fk3"], "kapali")
        self.assertEqual(sum(1 for v in durum.values() if v == "kapali"), 1)
        for r in harita_coz(h):
            self.assertEqual(len(r), 6)
            self.assertIn(r[5], SAHIPLER)
            self.assertIsInstance(r[2], int)
        self.assertEqual({r[5] for r in harita_coz(h)}, SAHIPLER)

    def test_diskte_haftalar_haritasiz_ve_firmalar_ayni(self):
        import shutil, tempfile
        from pathlib import Path
        from oyun_server.runs import disk
        root = Path(tempfile.mkdtemp(prefix="harita-test-"))
        self.addCleanup(shutil.rmtree, root, True)
        m = self.make()
        m.runs_dir = root
        m.defaults_hash = "abc"
        m._disk = disk.DiskStore(root)
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 20)
        m.control(rid, "pause")
        f = next(p for p in root.iterdir() if p.is_dir())
        satirlar = [json.loads(x) for x in (f / "haftalar.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
        self.assertTrue(satirlar)
        self.assertFalse(any("harita" in s for s in satirlar))
        fj = [json.loads(x) for x in (f / "firmalar.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
        self.assertEqual([x["week"] for x in fj][:3], [1, 10, 20])

    def test_fark_diske_yazilmaz_firmalar_jsonl_ayni(self):
        import shutil, tempfile
        from pathlib import Path
        from oyun_server.runs import disk
        root = Path(tempfile.mkdtemp(prefix="harita-fark-test-"))
        self.addCleanup(shutil.rmtree, root, True)
        m = self.make()
        m.runs_dir = root
        m.defaults_hash = "abc"
        m._disk = disk.DiskStore(root)
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 25)
        m.control(rid, "pause")
        self.assertTrue(any("haritaFark" in p for p in m.weeks(rid, 1, 25)))               # bellekte var
        f = next(p for p in root.iterdir() if p.is_dir())
        for ad in ("haftalar.jsonl", "firmalar.jsonl", "kosu.json"):
            if (f / ad).exists():
                self.assertNotIn("haritaFark", (f / ad).read_text(encoding="utf-8"), ad)
        satirlar = [json.loads(x) for x in (f / "haftalar.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
        self.assertFalse(any("harita" in s or "haritaFark" in s for s in satirlar))
        fj = [json.loads(x) for x in (f / "firmalar.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
        self.assertEqual([x["week"] for x in fj][:3], [1, 10, 20])                        # 10 haftalık kadans değişmedi

    def test_world_cities_chain_ve_weeks_satirlari_degismedi(self):
        """Fark yalnız ek alandır: her haftanın world/cities/chain/holdings'i, aynı haftada BAĞIMSIZ kurulan sahte hostun (harita yolundan geçmeyen) çıktısıyla birebir aynı; anahtar kümesi sabit."""
        from oyun_server.testing import FakeHost
        pk = self._kos(12)
        anahtarlar = {frozenset(set(p) - {"harita", "haritaFark"}) for p in pk}
        self.assertEqual(len(anahtarlar), 1)
        for p in pk:
            fh = FakeHost("", self.hosts[-1]._initial)               # koşunun kendi tohumu; harita/fark yolundan hiç geçmez
            fh.week = p["week"]
            beklenen = fh.snapshot()
            self.assertEqual(p["cities"], beklenen["cities"], p["week"])
            self.assertEqual(p["chain"], beklenen["chain"], p["week"])
            self.assertTrue(p["world"], p["week"])

    def test_taban_yokken_fark_haftasi_tam_haritaya_duser(self):
        """Taban bellekte yoksa (ör. koşu ortasında kayıp) fark üretilemez: o hafta tam `harita` gider ve yeni taban olur; sonraki hafta fark o tabana göredir."""
        m = self.make()
        rid, _ = self.new_run()
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 10)
        m.control(rid, "pause")
        run = m._runs[rid]
        self.assertIsNotNone(run.harita_taban)
        run.harita_taban = None
        m.control(rid, "play", 16)
        self.pump_until(lambda: m.get(rid)["state"]["week"] >= 12)
        m.control(rid, "pause")
        pk = {p["week"]: p for p in m.weeks(rid, 10, 12)}
        self.assertIn("harita", pk[11])
        self.assertNotIn("haritaFark", pk[11])
        self.assertEqual(pk[12]["haritaFark"]["taban"], 11)
        self.assertNotIn("harita", pk[12])


    def test_diskte_olmayan_kosuda_da_var(self):
        self.assertTrue(any("harita" in p for p in self._kos(10)))

    def test_yetenek_anahtari(self):
        self.assertIn("harita", routes.CAPABILITY_KEYS)
        self.assertTrue(routes.App.__dataclass_fields__["capabilities"].default_factory()["harita"])


if __name__ == "__main__":
    unittest.main()
