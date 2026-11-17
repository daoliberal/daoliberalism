"""Son review I1 (b): DAO kipi duman koşusu, sunucunun gerçek yoluyla (RunManager + gerçek ModelHost, süreç içi işçi), oyun tarifiyle 104 hafta.

YAVAŞ test: yalnız `DAO_DUMAN=1` ortam değişkeniyle koşar (varsayılan takımda atlanır).
  cd SRV && DAO_DUMAN=1 python3 -m unittest tests.test_dao_duman -v
Betikli insan: ahırdan çıkar, işe başvurur (pasif çalışan), hf 30'da işletme kurmayı dener (nakit yetmez: kurulamadi), hf 31'de ana makinede
3000 Akçe verilir (korunumlu: minted ile birlikte; kuruluş harcı ve sermayesi için) ve hf 32'de yeniden dener, kurulunca lonca seçer ve lonca kurmayı dener.
Her hafta: paket sunucunun tel sözleşmesi fikstüründen (`packet_dao`, `dao_gozlem`) geçer; makro.para.korunum / stok mutlak <= 1e-5; model hata vermez.
Sonuç özeti `DAO_DUMAN_CIKTI` (varsayılan stderr) olarak yazılır."""
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

from oyun_server.runs import disk
from oyun_server.runs.manager import RunManager
from oyun_server.testing import InProcWorker

from tests.registry_helpers import real_registry
from tests.route_helpers import make_cfg
from tests import test_dao as _td                     # modül olarak: sınıflar bu dosyada yeniden toplanmasın
from tests import test_dao_isci as _ti
from tests import test_wire_contract as _tw
from tests.test_manager import FakeClock

_adim, FIXTURE, sekil_farki = _td._adim, _ti.FIXTURE, _ti.sekil_farki

TARIF = Path(__file__).resolve().parents[3] / "kagit-ustu" / "modulerlestirme" / "ornek-ciktilar" / "kredi-yon-araclar" / "oyun_tarifi.json"
HAFTA = int(os.environ.get("DAO_DUMAN_HAFTA", "104"))


@unittest.skipUnless(os.environ.get("DAO_DUMAN") == "1", "yavaş duman koşusu: DAO_DUMAN=1 ile koşar")
class TestDaoDuman(unittest.TestCase):
    # Sahte host fikstürü (wire_contract.json `packet_dao`) credit/housing/labour bloklarını taşımaz (yalnız gerçek model üretir); gerçek koşuda erken haftalarda ölçülmeyen alan null, liste boş olabilir (yalnız bu iki fark serbest; anahtar kümesi ve türler sıkı).
    GERCEK_EK = re.compile(r"^\$\.(credit|housing|labour): yalnız gerçekte$")

    # Fikstürde olmayan olay türleri (gerçek modelin ürettiği biçim; web `daoOlay` ile aynı alanlar)
    EK_OLAYLAR = [
        {"tur": "kuruldu", "hafta": 3, "firma": "s0_un7", "sektor": "un"},
        {"tur": "firmam_kuculdu", "hafta": 4, "firma": "s0_un7", "kisi": "p12", "neden": "satis"},
        {"tur": "sermaye_eklendi", "hafta": 5, "miktar": 100.0, "firma": "s0_un7"},
        {"tur": "lonca_degisti", "hafta": 6, "firma": "s0_un7", "eski": "lonca0", "lonca": "lonca1"},
        {"tur": "lonca_degisti", "hafta": 6, "firma": "s0_un7", "eski": "lonca0", "lonca": "lonca1", "kaynak": "insan"},      # te-rekabet G1: kaynak insan | otomatik | kapanma
        {"tur": "lonca_kapandi_yeniden_atandi", "hafta": 7, "firma": "s0_un7", "eski": "lonca1", "lonca": "lonca2"},
        {"tur": "lonca_kuruldu", "hafta": 8, "lonca": "lonca5"},
        {"tur": "lonca_kurulamadi", "hafta": 9, "yol": "girisimci", "neden": ["erken", "nakit"]},
        {"tur": "loncam_kapandi", "hafta": 10, "lonca": "lonca5", "neden": "gider", "kayip": 10.0, "mevduat_tasindi": {"lonca": "lonca1", "tutar": 5.0}, "mevduat_odendi": 0.0},
        {"tur": "mevduat_yatirilmadi", "hafta": 11}, {"tur": "cekilemedi", "hafta": 12},
        {"tur": "sermaye_eklenemedi", "hafta": 13, "neden": "nakit_yok"},
        {"tur": "isten_cikarildi", "hafta": 14, "firma": "s0_un7", "neden": "kucultme"},
        {"tur": "firma_batti", "hafta": 15, "firma": "s0_un7", "neden": "ucret_odenmedi", "yas": 12},
        {"tur": "is_degistirdi", "hafta": 16, "eski": "s0_un7", "yeni": "s0_sut1"},
        {"tur": "kurabilir_oldu", "hafta": 17},
        {"tur": "karar_uygulanamadi", "hafta": 18, "karar": "lonca_sec", "neden": "erken"},
        {"tur": "lonca_kapali", "hafta": 19, "lonca": "lonca1"},
        {"tur": "kadro_hedefi", "hafta": 20, "firma": "s0_un7", "hedef": 4},      # te-rekabet G17i: insanın kadro kararı uygulandı
    ]

    def tel_farki(self, p):
        ornek = dict(FIXTURE["packet_dao"], harita=_tw.FIX["packet_harita"]["harita"])
        out = [x for x in _tw.shape_diff(p, ornek) if not (x.startswith("$.dao") or self.GERCEK_EK.match(x) or ": null != " in x or x.endswith("gerçek boş, örnek dolu"))]
        out = [x for x in out if x != "$.diagnostics: örnek boş, gerçek dolu"]
        for i, dg in enumerate(p.get("diagnostics") or []):                            # fikstürde "Ne olmuyor" listesi boş; gerçek koşuda kural tetiklenebilir: her öğe web `parseDiagnostic` alan kümesi ve türleriyle birebir
            if not isinstance(dg, dict) or set(dg) != {"id", "textKey", "params", "rule_ids", "since_week"}:
                out.append("$.diagnostics[%d]: alan kümesi farklı: %s" % (i, sorted(dg) if isinstance(dg, dict) else type(dg).__name__))
            elif not (isinstance(dg["id"], str) and isinstance(dg["textKey"], str) and isinstance(dg["params"], dict) and isinstance(dg["rule_ids"], list) and isinstance(dg["since_week"], int)):
                out.append("$.diagnostics[%d]: tür farklı" % i)
        dao_ornek = copy.deepcopy(FIXTURE["dao_gozlem"])
        dao_ornek["olaylar"] += self.EK_OLAYLAR
        out += sekil_farki(p["dao"], dao_ornek, "$.dao")                           # DAO gözlemi: liste öğeleri örneklerden birine uymalı (olay türleri farklı anahtar taşır)
        for k in ("credit", "housing", "labour"):
            if not isinstance(p.get(k), dict):
                out.append("$.%s: sözlük değil" % k)
        return out

    def test_104_hafta_gercek_host(self):
        from oyun_server.sim.worker import make_host
        tarif = dict(json.loads(TARIF.read_text(encoding="utf-8"))["recipe"], mode="dao")                  # süre tarifteki 520; ilk HAFTA hafta oynanır
        hostlar = []

        def host_factory(spec):
            ek = os.environ.get("DAO_DUMAN_EK")                                # te-rekabet G0: JSON bayrak sözlüğü ({"FZ_FIX": 1, ...}) koşunun bayraklarına eklenir (bayrakların verildiği yer: manager.py `overrides`)
            if ek:
                spec = dict(spec, overrides=dict(spec.get("overrides") or {}, **json.loads(ek)))
            h = make_host(spec)
            hostlar.append(h)
            return h

        def factory(spec):
            w = InProcWorker(spec, host_factory=host_factory)
            self.addCleanup(w.kill)
            return w

        root = Path(tempfile.mkdtemp(prefix="dao-duman-"))
        self.addCleanup(shutil.rmtree, root, True)
        m = RunManager(real_registry(), factory, clock=FakeClock(), cfg=make_cfg(MAX_RUNS=2))
        m._disk = disk.DiskStore(root)
        m.start_thread()
        self.addCleanup(m.shutdown)
        rid = m.create(tarif)["runId"]
        t0 = time.time()
        ozet: dict = {"hafta": {}, "olaylar": [], "ret": []}
        kuruldu = False
        lonca_sec_yapildi = False
        lonca_kur_denendi = False
        kadro_denendi = False
        sira = []
        seri = []
        maks_korunum = 0.0

        def gonder(karar, w):
            r = m.dao_karar(rid, karar)
            sira.append((w, karar["tur"], r.get("kabul"), r.get("kod")))
            if not r.get("kabul"):
                ozet["ret"].append((w, karar["tur"], r.get("kod"), r.get("fields")))
            return r

        gonder({"tur": "ahirdan_cik"}, 0)
        for w in range(1, HAFTA + 1):
            _adim(self, m, rid, w)
            p = m.weeks(rid, w, w)[0]
            self.assertEqual(p["week"], w)
            self.assertEqual(self.tel_farki(p), [], w)                                          # tel sözleşmesi: paketin tamamı
            para = p["makro"]["para"]
            self.assertLessEqual(abs(para["korunum"]) / max(1.0, para["stok"]), 1e-5, (w, para))
            maks_korunum = max(maks_korunum, abs(para["korunum"]) / max(1.0, para["stok"]))
            g = p["dao"]
            for e in g["olaylar"]:
                ozet["olaylar"].append((w, e["tur"]))
            fm, ben = g["firmam"], g["ben"]
            wd = p["world"]
            seri.append((w, wd.get("served"), wd.get("employed"), wd.get("unemployment_rate")))
            if w in (26, 52, 104) or w == HAFTA:
                ozet["hafta"][w] = {"dunya": {k: wd.get(k) for k in ("served", "employed", "unemployment_rate", "firms_total", "npc_firms", "player_firms", "failed_cum", "money_total")},
                                    "insan": {"durum": ben["durum"], "unvan": ben.get("unvan"), "nakit": round(ben["nakit"], 2), "calisilan_hafta": ben["calisilan_hafta"], "mevduat": ben["mevduat"],
                                              "firmam": None if fm is None else {k: fm.get(k) for k in ("ad", "isci", "nakit", "lonca", "lonca_degisebilir", "lonca_erken_hafta", "uyari", "kasa_pisti_hafta")}},
                                    "korunum": para["korunum"], "stok": para["stok"]}
            kuruldu = kuruldu or fm is not None
            # betik
            if ben["durum"] == "is_arayan" and g["ilanlar"]:
                fi = [i for i in g["ilanlar"] if i["sektor"] != "belediye"] or g["ilanlar"]
                gonder({"tur": "basvur", "firma": fi[0]["firma"]}, w)
            elif w == 30 and fm is None:
                gonder({"tur": "kur", "sektor": "market"}, w)
            elif w == 31 and fm is None:
                h = hostlar[0]._W
                h.L.bal[h.human] += 3000.0
                h.L.minted += 3000.0                                                              # korunumlu: basım kaydı (tek seferlik başlangıç yardımı)
            elif w == 32 and fm is None:
                gonder({"tur": "kur", "sektor": "market"}, w)
            elif fm is not None and not lonca_sec_yapildi and fm.get("lonca_degisebilir"):
                yeni = next((l["ad"] for l in g["loncalar"] if not l["kapali"] and l["ad"] != fm["lonca"]), None)
                if yeni:
                    lonca_sec_yapildi = True
                    gonder({"tur": "lonca_sec", "lonca": yeni}, w)
            elif fm is not None and not lonca_kur_denendi and w >= 60:
                lonca_kur_denendi = True
                gonder({"tur": "lonca_kur", "yol": "girisimci"}, w)
            elif fm is not None and not kadro_denendi and w >= 70:
                kadro_denendi = True
                gonder({"tur": "kadro", "hedef": max(1, fm["isci"] + 1)}, w)                      # G17i: HIRE_TARGET kapalıysa karar_gecersiz (bayrak_kapali) olarak kaydedilir
        st = m.stats(rid)
        self.assertEqual(st["worker_week"], HAFTA)
        ozet["sure_sn"] = round(time.time() - t0, 1)
        ozet["kararlar"] = sira
        ozet["maks_korunum_orani"] = maks_korunum
        ozet["served_min_maks"] = [min(x[1] for x in seri if x[1] is not None), max(x[1] for x in seri if x[1] is not None)]
        ozet["issizlik_min_maks"] = [min(x[3] for x in seri if x[3] is not None), max(x[3] for x in seri if x[3] is not None)]
        ozet["isletme_kuruldu"] = kuruldu
        yol = os.environ.get("DAO_DUMAN_CIKTI")
        metin = json.dumps(ozet, ensure_ascii=False, indent=1, default=str)
        if yol:
            Path(yol).write_text(metin, encoding="utf-8")
        else:
            print(metin, file=sys.stderr)


if __name__ == "__main__":
    unittest.main()
