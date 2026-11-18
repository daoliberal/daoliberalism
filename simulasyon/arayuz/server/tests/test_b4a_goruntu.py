"""B4a: görüntü düzeltmeleri, uyumluluk anahtarı, kadans (Python tarafı). Yönetici durumu / günlük / devam testleri `test_b4a_devam.py`.

Gerçek model gerekir (yavaş testler `OYUN_QUICK=1` ile atlanır); sahte host görüntülenemez.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import unittest

from oyun_server import config
from oyun_server.sim.worker import SessionCore
from oyun_server.tarayici import goruntu

YAVAS = unittest.skipIf(os.environ.get("OYUN_QUICK") == "1", "yavaş (gerçek model)")


def ozet(o) -> str:
    return hashlib.sha256(json.dumps(o, sort_keys=True, default=repr).encode()).hexdigest()[:16]


def yeni_cekirdek(olaylar: dict, weeks: int = 8, overrides: dict | None = None, ek_spec: dict | None = None):
    """Gerçek modelli `SessionCore`; hafta olayları `olaylar[hafta]` içine tam (özetlenmemiş) yazılır."""
    spec = {"cmd": "init", "host": "model", "overrides": overrides or {}, "weeks": weeks, "model_root": str(config.MODEL_ROOT),
            "csv_dir": tempfile.mkdtemp(prefix="oyun-host-"), **(ek_spec or {})}
    a = SessionCore(lambda e: olaylar.__setitem__(e["week"], e) if e.get("ev") == "week" else None)
    a.handle(spec)
    return a


def ilerle(c: SessionCore, hedef: int) -> None:
    c.handle({"cmd": "target", "week": hedef})
    while not c.idle():
        c.advance()


def goruntu_al(c: SessionCore, **kw) -> list:
    parcalar: list = []
    goruntu.dump_session(c, parcalar.append, **kw)
    return parcalar


def yukle(parcalar: list, olaylar: dict, **kw) -> SessionCore:
    b = SessionCore(lambda e: olaylar.__setitem__(e["week"], e) if e.get("ev") == "week" else None)
    it = iter(list(parcalar) + [b""])
    goruntu.load_session(b, lambda: next(it), csv_dir=tempfile.mkdtemp(prefix="oyun-host-"), model_root=str(config.MODEL_ROOT), **kw)
    return b


class LambdaTanima(unittest.TestCase):
    """Şart 1: lambdalar kimlikle tanınır, çağrılarak değil."""

    def _dump(self, obj):
        goruntu.SnapPickler.UNKNOWN.clear()
        return goruntu.SnapPickler(io.BytesIO(), protocol=5).dump(obj)

    def test_sifir_sifir_lambdalari_taninmaz_ve_cagrilmaz(self):
        cagrilar = []
        for uret in (lambda: [0, 0], lambda: [0.0, 0], lambda: [0.0, 0.0]):                  # `==` ile `[0.0, 0.0]`a eşit olanlar da (eski çağırarak tanıma bunları yutardı)
            f = (lambda u: (lambda: cagrilar.append(1) or u()))(uret)
            with self.assertRaises(goruntu.TaninmayanLambda):
                self._dump({"f": f})
        self.assertEqual(cagrilar, [])                                                          # tanıma lambdayı ÇAĞIRMAZ
        goruntu.SnapPickler.UNKNOWN.clear()

    def test_qualname_taklidi_taninmaz(self):
        """Aynı qualname + aynı `co_names` yetmez: modül ve satır da eşleşmeli."""
        def _st(W):
            return lambda: [0.0, 0.0]                                                             # qualname `..._st.<locals>.<lambda>`'a benzer, modül/satır farklı
        with self.assertRaises(goruntu.TaninmayanLambda):
            self._dump({"f": _st(None)})

    def test_tanimayan_lambda_sessiz_none_degil_acik_hata(self):
        with self.assertRaises(goruntu.TaninmayanLambda) as cm:
            self._dump({"f": lambda: None})
        self.assertIn("tanınmayan lambda", str(cm.exception))

    @YAVAS
    def test_lambda_tablosu_modelle_uyumlu(self):
        """Tablodaki kimlikler gerçek modeldeki lambdalarla tam eşleşir (model satırı kayarsa bu kırmızı olur: görüntü yazılamaz)."""
        from oyun_server.sim.host import ModelHost
        h = ModelHost(str(config.MODEL_ROOT), {}, 3, hafiza=True)
        try:
            h.step()
            W = h._W
            gorulen = set()
            for f in (W.is_player, W.is_npc, W.is_firm, W.is_lonca, W.is_city, W.g, W.dg, W.tsup["by_kind"].default_factory, W.supply.default_factory):
                c = f.__code__
                gorulen.add((f.__module__, f.__qualname__, c.co_firstlineno, tuple(c.co_names)))
            tablo = set(goruntu._NONE_LAMBDALAR) | {goruntu._LAMBDA_DD_LIST, goruntu._LAMBDA_PAIR}
            self.assertEqual(gorulen, tablo)
        finally:
            h.close()


class UyumlulukAnahtari(unittest.TestCase):
    def test_anahtar_alanlari_ve_belirlenimcilik(self):
        a = goruntu.uyumluluk_anahtari(None, "0.27.7")
        self.assertEqual(sorted(a), ["host_sema", "model_sha256", "pyodide", "schema"])
        self.assertEqual((len(a["model_sha256"]), a["pyodide"], a["schema"], a["host_sema"]), (64, "0.27.7", goruntu.SCHEMA, goruntu.HOST_SEMA))
        self.assertEqual(a, goruntu.uyumluluk_anahtari(None, "0.27.7"))
        self.assertNotEqual(goruntu.uyumluluk_anahtari(None, "0.28.0")["pyodide"], a["pyodide"])

    def test_ozet_yalniz_model_dosyalarina_baglidir(self):
        root = tempfile.mkdtemp(prefix="oyun-model-")
        os.makedirs(os.path.join(root, "simkit", "alt"))
        for ad, ic in (("simkit/a.py", "x=1"), ("simkit/alt/b.py", "y=2"), ("simbuild.py", "s"), ("model_mod.py", "m")):
            with open(os.path.join(root, ad), "w") as f:
                f.write(ic)
        h1 = goruntu._model_sha256(root)
        goruntu._model_sha256.cache_clear()
        with open(os.path.join(root, "oyun_server_metin.py"), "w") as f:                       # model dışı dosya özeti değiştirmez
            f.write("z")
        self.assertEqual(goruntu._model_sha256(root), h1)
        goruntu._model_sha256.cache_clear()
        with open(os.path.join(root, "simkit", "alt", "b.py"), "w") as f:
            f.write("y=3")
        self.assertNotEqual(goruntu._model_sha256(root), h1)
        goruntu._model_sha256.cache_clear()

    def test_ozet_satir_sonundan_bagimsiz(self):
        """K10: CRLF'e çevrilmiş model dosyaları anahtarı bozmaz."""
        a, b = tempfile.mkdtemp(prefix="oyun-model-"), tempfile.mkdtemp(prefix="oyun-model-")
        for kok, nl in ((a, "\n"), (b, "\r\n")):
            os.makedirs(os.path.join(kok, "simkit"))
            for ad in ("simkit/a.py", "simbuild.py", "model_mod.py"):
                with open(os.path.join(kok, ad), "w", newline="") as f:
                    f.write("x = 1" + nl + "y = 2" + nl)
        self.assertEqual(goruntu._model_sha256(a), goruntu._model_sha256(b))

    def test_kadans_sabitleri_tek_yerde(self):
        self.assertEqual((goruntu.GORUNTU_KADANS, goruntu.GORUNTU_KADANS_UZUN, goruntu.HAM_ESIK_BAYT), (13, 26, 300 * 1024 * 1024))
        self.assertEqual(goruntu.kadans(None), 13)
        self.assertEqual(goruntu.kadans(300 * 1024 * 1024), 13)                               # eşik AŞILIRSA 26
        self.assertEqual(goruntu.kadans(300 * 1024 * 1024 + 1), 26)


@YAVAS
class GoruntuDuzeltmeleri(unittest.TestCase):
    def test_yukleme_sonrasi_cekmece_ve_snapshot_kesintisizle_esit(self):
        """Şart 2: yüklemeden hemen sonra, adım atmadan: çekmeceler, `snapshot()` ve `facts()` kesintisizle eşit; sonraki haftanın olayı da eşit."""
        ev_a: dict = {}
        a = yeni_cekirdek(ev_a, 5)
        ilerle(a, 3)
        parcalar = goruntu_al(a)
        firma = next(iter(a.host._W.firms))

        def bak(c):
            h = c.host
            return {"sehir": h.drawer("city", "0"), "firma": h.drawer("firm", firma), "snap": h.snapshot(), "facts": h.facts()}
        ref = bak(a)
        ev_b: dict = {}
        b = yukle(parcalar, ev_b)
        self.assertEqual(ozet(bak(b)), ozet(ref))
        self.assertEqual(b.host._snap_week, b.host.week)                                    # önbellek geldi; yeniden hesaplama olmadı
        ilerle(a, 4)
        ilerle(b, 4)
        self.assertEqual(ozet(ev_b[4]), ozet(ev_a[4]))                                      # farka dayalı host durumu iki kez ilerlemedi: sonraki hafta eşit

    def test_yukleme_sonrasi_ayni_hafta_cagri_host_durumunu_ilerletmez(self):
        ev_a: dict = {}
        a = yeni_cekirdek(ev_a, 5)
        ilerle(a, 2)
        parcalar = goruntu_al(a)
        b = yukle(parcalar, {})
        def durum(h):
            return repr([h._prev_cut, h._labor_prev, h._city_of, h._credit_prev, h._ekonomi_state, h._makro_state, h._labour_state, h._labour_week, h._edges_rev, h._edge_key])
        once = durum(b.host)
        for _ in range(3):                                                                    # B4'ün devam ekranı aynı hafta çağırır
            b.host.snapshot()
            b.host.facts()
        self.assertEqual(durum(b.host), once)

    def test_patched_revert_to_sonrasi_dayanikli(self):
        """Şart 3: dal (`revert_to`) sonrası dump/load KeyError vermez, yamalar doğru."""
        ev_a: dict = {}
        a = yeni_cekirdek(ev_a, 5)
        ilerle(a, 1)
        a.handle({"cmd": "patch", "overrides": {"CORP_TAX": 0.31}, "version": 2})
        ilerle(a, 2)
        a.host.revert_to({})                                                                  # `effective` sözlüğünde artık CORP_TAX yok, `base_values`te var
        self.assertNotIn("CORP_TAX", a.host.effective)
        parcalar = goruntu_al(a)
        ev_b: dict = {}
        b = yukle(parcalar, ev_b)
        self.assertEqual(b.host.effective, a.host.effective)
        self.assertEqual(b.host._mods["simkit.params"].CORP_TAX, a.host._mods["simkit.params"].CORP_TAX)
        ilerle(a, 3)
        ilerle(b, 3)
        self.assertEqual(ozet(ev_b[3]), ozet(ev_a[3]))

    def test_uyumsuz_anahtar_belirli_hata(self):
        ev: dict = {}
        a = yeni_cekirdek(ev, 3)
        ilerle(a, 1)
        parcalar = goruntu_al(a, pyodide="0.27.7")
        with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
            yukle(parcalar, {}, pyodide="0.28.0")
        self.assertEqual(sorted(cm.exception.fark), ["pyodide"])
        self.assertEqual(cm.exception.fark["pyodide"], ("0.27.7", "0.28.0"))
        yukle(parcalar, {}, pyodide="0.27.7")                                                 # uyumluysa yüklenir

    def test_model_ozeti_degisince_uyumsuz(self):
        ev: dict = {}
        a = yeni_cekirdek(ev, 3)
        ilerle(a, 1)
        parcalar = goruntu_al(a)
        sahte = dict(goruntu.uyumluluk_anahtari(), model_sha256="0" * 64)
        from unittest import mock
        with mock.patch.object(goruntu, "uyumluluk_anahtari", lambda *a_, **k: sahte):
            with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
                yukle(parcalar, {})
        self.assertEqual(sorted(cm.exception.fark), ["model_sha256"])

    def test_eski_sema_uyumsuz(self):
        ev: dict = {}
        a = yeni_cekirdek(ev, 3)
        ilerle(a, 1)
        from unittest import mock
        with mock.patch.object(goruntu, "SCHEMA", 1):
            parcalar = goruntu_al(a)
        with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
            yukle(parcalar, {})
        self.assertIn("schema", cm.exception.fark)


class DumpAnindaRed(unittest.TestCase):
    """Yazarken red: izin listesinde olmayan sınıf/işlev referansı görüntüde yer alamaz (yükleme anında sürpriz yok)."""

    def _dump(self, obj):
        goruntu.SnapPickler.UNKNOWN.clear()
        return goruntu.SnapPickler(io.BytesIO(), protocol=5).dump(obj)

    def test_izinsiz_islev_ve_sinif_dump_aninda_reddedilir(self):
        import fractions
        with self.assertRaises(goruntu.TaninmayanReferans) as cm:
            self._dump({"f": os.getcwd})
        self.assertIn("getcwd", str(cm.exception))
        with self.assertRaises(goruntu.TaninmayanReferans):
            self._dump({"c": fractions.Fraction})
        with self.assertRaises(goruntu.TaninmayanReferans):
            self._dump({"o": fractions.Fraction(1, 3)})                                      # örnek: sınıfı referans olarak girer
        self.assertTrue(goruntu.SnapPickler.UNKNOWN)
        goruntu.SnapPickler.UNKNOWN.clear()

    def test_izinli_referanslar_gecer(self):
        import collections
        self._dump({"d": collections.deque([1]), "dd": collections.defaultdict(list), "n": goruntu._none, "i": int})

    def test_model_kopyasi_izinsiz_sinif_dump_aninda(self):
        """Model kopyasındaki bir sınıf listeden çıkarılırsa gerçek `W` dump'ı hemen düşer (CreditMoney örneği: CREDIT_MONEY=1)."""
        from unittest import mock
        a = yeni_cekirdek({}, 3, {"CREDIT_MONEY": 1})
        ilerle(a, 1)
        goruntu_al(a)                                                                          # listede: yazılır
        eksik = goruntu.IZIN_MODEL - {("simkit.credit_money", "CreditMoney")}
        with mock.patch.object(goruntu, "IZIN_MODEL", eksik):
            with self.assertRaises(goruntu.TaninmayanReferans) as cm:
                goruntu_al(a)
        self.assertIn("CreditMoney", str(cm.exception))


class StatikTarama(unittest.TestCase):
    """Model kaynağında DEĞER olarak saklanabilecek her çağrılabilir (`partial(f, ...)`, `defaultdict(f)` ilk bağımsız değişkeni; her sınıf) ya `IZIN_MODEL`'de ya da gerekçeli dışlamadadır.
    Model kodu değişince (yeni kanca/fabrika/sınıf) bu test kırmızı olur: liste güncellenmeden yeni görüntüler yazılamaz/yüklenemez."""
    HARIC_ISLEV = {                                                                          # ad -> neden (W/L/host'a ATANMAZ, görüntüde yer almaz)
        "fp_prices": "`pricing_step.py:32` partial hemen çağrılır, saklanmaz", "fp_prices_v2": "aynı",
        "imp_of": "`week_people.py:756` `max(key=partial(...))`: geçici", "_yk_take": "`week_people.py:638` yk_hire'a geçici bağımsız değişken",
    }
    HARIC_SINIF = {"KararHatasi": "istisna sınıfı (fırlatılır, saklanmaz)", "Params": "`simbuild.Params`: host kurulumunda kullanılır, W'ye girmez"}

    def test_model_referanslari_izin_listesinde(self):
        import ast
        kok = str(config.MODEL_ROOT)
        dosyalar = []
        for d, ds, fs in os.walk(os.path.join(kok, "simkit")):
            ds[:] = [x for x in ds if x != "__pycache__"]
            dosyalar += [os.path.join(d, f) for f in fs if f.endswith(".py")]
        dosyalar += [os.path.join(kok, "simbuild.py"), os.path.join(kok, "model_mod.py")]
        agaclar = {}
        for y in dosyalar:
            rel = os.path.relpath(y, kok)[:-3].replace(os.sep, ".")
            with open(y, encoding="utf-8") as f:
                agaclar[rel] = ast.parse(f.read())
        islevler: dict = {}
        siniflar = set()
        for mod, t in agaclar.items():
            for n in t.body:
                if isinstance(n, ast.FunctionDef):
                    islevler.setdefault(n.name, set()).add(mod)
                elif isinstance(n, ast.ClassDef):
                    siniflar.add((mod, n.name))
        gerekli = set(siniflar)
        for mod, t in agaclar.items():
            for n in ast.walk(t):
                if isinstance(n, ast.Call) and getattr(n.func, "id", getattr(n.func, "attr", None)) in ("partial", "defaultdict") and n.args and isinstance(n.args[0], ast.Name):
                    for m in islevler.get(n.args[0].id, ()):
                        gerekli.add((m, n.args[0].id))
        self.assertGreater(len(gerekli), 15)
        eksik = sorted((m, a) for m, a in gerekli if (m, a) not in goruntu.IZIN_MODEL and a not in self.HARIC_ISLEV and a not in self.HARIC_SINIF)
        self.assertEqual(eksik, [], "izin listesi/dışlama güncellenmeli: %r" % (eksik,))
        self.assertIn(("simkit.credit_money", "CreditMoney"), gerekli)                       # tarama gerçekten bulur
        self.assertIn(("simkit.policy", "bond_hook"), gerekli)

    def test_izin_model_listesinde_olu_giris_yok(self):
        """Listedeki her (modül, ad) gerçek modelde var (yazım hatası/eski giriş yok)."""
        import importlib
        import sys
        if str(config.MODEL_ROOT) not in sys.path:
            sys.path.insert(0, str(config.MODEL_ROOT))
        for mod, ad in goruntu.IZIN_MODEL:
            self.assertTrue(hasattr(importlib.import_module(mod), ad), (mod, ad))


@YAVAS
class BayrakDuman(unittest.TestCase):
    """Kartlı alternatif kurallar ve bayraklar açıkken kısa (3 hf) görüntü al -> yükle (+ 1 hf devam, A/B için kesintisizle eşit). Kapsam: bkz. `KAPSAM`."""
    KAPSAM: list = []

    def _al_yukle(self, ov, ad, esit=False):
        ev_a: dict = {}
        a = yeni_cekirdek(ev_a, 5, ov)
        ilerle(a, 3)
        p = goruntu_al(a)
        ev_b: dict = {}
        b = yukle(p, ev_b)
        self.assertEqual(b.host.week, 3, ad)
        if esit:
            ilerle(a, 4)
            ilerle(b, 4)
            self.assertEqual(ozet(ev_b[4]), ozet(ev_a[4]), ad)
        yukle(goruntu_al(b), {})                                                              # yeniden görüntüleme zinciri

    def test_credit_money_ve_tahvil_kancasi(self):
        self._al_yukle({"CREDIT_MONEY": 1}, "CREDIT_MONEY", esit=True)
        self._al_yukle({"MINT_OPEN_WEEKS": 1}, "MINT_OPEN_WEEKS", esit=True)                  # tahvil kancası hf2'de kurulur
        self._al_yukle({"CREDIT_MONEY": 1, "MINT_OPEN_WEEKS": 1}, "ikisi")

    def test_dao_bayraklari(self):
        self._al_yukle({"HUMAN_ON": 1, "HUMAN_LONCA": 1, "FIRM_LIFE_LOG": 1}, "DAO", esit=True)

    def test_kayit_kartlarinin_alternatif_kurallari(self):
        """Kayıttaki çalıştırmada düzenlenebilir bütün `toggle` ve `options` kartları: her kartın alternatif değeri (karttaki varsayılandan farklı) bir koşuda açılır; kartlar
        5'erli gruplanır (az sayıda koşu). Kapsanan kartlar `KAPSAM`a yazılır (rapor)."""
        from oyun_server.registry.resolve import resolve, run_editable
        from tests.registry_helpers import real_registry
        reg = real_registry()
        alt: list = []
        for c in reg.settings:
            if not run_editable(c) or c.kind not in ("toggle", "options") or c.codec.get("type") == "seed":
                continue
            vars_ = [True, False] if c.kind == "toggle" else list(c.codec["map"])
            for v in vars_:
                if v != reg.default_ui(c):
                    alt.append((c.id, v))
        ids = sorted({i for i, _ in alt})
        gruplar: dict = {}
        sayac: dict = {}
        for i, v in alt:
            k = sayac.get(i, 0)
            sayac[i] = k + 1
            gruplar.setdefault((k, ids.index(i) % 5), {})[i] = v
        self.assertGreaterEqual(len(ids), 30)
        for (k, g), vals in sorted(gruplar.items()):
            res = resolve(reg, vals)
            ov = dict(res.params)
            ov["MINT_OPEN_WEEKS"] = 1                                                          # tahvil kancası da kurulsun
            self._al_yukle(ov, "grup %s %s" % ((k, g), sorted(vals)))
            BayrakDuman.KAPSAM.append(sorted(vals))
        print("\nBAYRAK KAPSAMI: %d kart, %d koşu: %s" % (len(ids), len(gruplar), ids))


class GuvenlikVeYapi(unittest.TestCase):
    """Ö1 (düz JSON önek + izin listesi) ve Ö2 (host/yönetici yapı değişimi)."""

    @classmethod
    def setUpClass(cls):
        ev: dict = {}
        a = yeni_cekirdek(ev, 4, {"HUMAN_ON": 1, "HUMAN_LONCA": 1, "FIRM_LIFE_LOG": 1})
        a.handle({"cmd": "karar", "id": 1, "karar": {"tur": "ahirdan_cik"}})
        ilerle(a, 2)
        cls.parcalar = goruntu_al(a)

    def test_onek_duz_json_ve_pickle_acilmadan_denetlenir(self):
        p = self.parcalar[0]
        self.assertEqual(p[:4], goruntu.MAGIC)
        n = int.from_bytes(p[4:8], "big")
        onek = json.loads(p[8:8 + n])
        self.assertEqual(sorted(onek), ["anahtar", "ek", "schema"])
        # uyumsuz önek + kötü niyetli gövde: gövde hiç açılmaz (UyumsuzGoruntu, GuvensizGoruntu değil)
        import pickle
        import zlib
        onek["anahtar"]["pyodide"] = "baska"
        ham = json.dumps(onek).encode()
        kotu = [goruntu.MAGIC + len(ham).to_bytes(4, "big") + ham, zlib.compress(pickle.dumps(_Kotu()))]
        _Kotu.cagrildi = False
        with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
            yukle(kotu, {}, pyodide="x")
        self.assertNotIsInstance(cm.exception, goruntu.GuvensizGoruntu)
        self.assertFalse(_Kotu.cagrildi)

    def test_izin_listesi_disi_sinif_guvensiz_ve_calistirilmaz(self):
        import pickle
        import zlib
        _Kotu.cagrildi = False
        kotu = [self.parcalar[0], zlib.compress(pickle.dumps(_Kotu()))]
        with self.assertRaises(goruntu.GuvensizGoruntu) as cm:
            yukle(kotu, {})
        self.assertIsInstance(cm.exception, goruntu.UyumsuzGoruntu)
        self.assertEqual(cm.exception.fark["guvensiz"][1], "kotu_islev")
        self.assertFalse(_Kotu.cagrildi)

    def test_eski_biciim_ve_bozuk_onek_uyumsuz(self):
        for parca in (b"\x78\x9c" + b"x" * 20, goruntu.MAGIC + (999).to_bytes(4, "big") + b"{", goruntu.MAGIC + (3).to_bytes(4, "big") + b"[1]"):
            with self.assertRaises(goruntu.UyumsuzGoruntu):
                yukle([parca], {})

    def test_getattr_alt_cizgili_ad_reddedilir(self):
        with self.assertRaises(goruntu.GuvensizGoruntu):
            goruntu._guvenli_getattr(object(), "__class__")

    def test_izin_listesi_gercek_goruntuyle_ayni(self):
        """Gerçek görüntünün yüklenmesinde istenen bütün (modül, ad) çiftleri izin listesindedir (model kopyası hariç); liste şişirilmemiştir."""
        gorulen: set = set()
        model_gorulen: set = set()
        orijinal = goruntu.SnapUnpickler.find_class

        def kayit(self, module, name):
            if not (self.mods is not None and module in self.mods):
                gorulen.add((module, name))
            else:
                model_gorulen.add((module, name))
            return orijinal(self, module, name)
        from unittest import mock
        with mock.patch.object(goruntu.SnapUnpickler, "find_class", kayit):
            b = yukle(self.parcalar, {})
            yukle(goruntu_al(b), {})                                                             # yüklenmiş dünyanın yeniden görüntülenmesi (devam zinciri)
        self.assertTrue(gorulen and gorulen <= goruntu.IZIN, gorulen - goruntu.IZIN)
        # Y2: model kopyası listesi: kısa görüntüde görülen 2 sınıf + 13 işlev; ek olarak yalnız para tavanı/tahvil kancası açıkken (hafta > MINT_OPEN_WEEKS) kurulan 2 işlev
        self.assertEqual((sum(1 for _, n in model_gorulen if n[:1].isupper()), sum(1 for _, n in model_gorulen if not n[:1].isupper())), (2, 13))
        self.assertLessEqual(model_gorulen, goruntu.IZIN_MODEL)
        self.assertEqual(goruntu.IZIN_MODEL - model_gorulen, {("simkit.policy", "bond_hook"), ("simkit.policy", "bond_room"), ("simkit.credit_money", "CreditMoney")})
        self.assertIn(("oyun_server.sim.labour", "LabourState"), gorulen)
        self.assertTrue(all(m.split(".")[0] in ("builtins", "collections", "functools", "oyun_server") for m, _ in goruntu.IZIN))

    def _yukle_fabrikali(self, degistir):
        b = SessionCore(lambda e: None)
        eski = b.host_factory

        def fab(spec):
            h = eski(spec)
            degistir(h)
            return h
        b.host_factory = fab
        it = iter(list(self.parcalar) + [b""])
        goruntu.load_session(b, lambda: next(it), csv_dir=tempfile.mkdtemp(prefix="oyun-host-"), model_root=str(config.MODEL_ROOT))
        return b

    def test_host_alani_eklenmis_surume_eski_goruntu_uyumsuz(self):
        with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
            self._yukle_fabrikali(lambda h: setattr(h, "_yeni_farka_dayali", {}))
        self.assertEqual(cm.exception.fark["host_alanlari"][1], ["_yeni_farka_dayali"])

    def test_host_alani_kaldirilmis_surume_uyumsuz(self):
        with self.assertRaises(goruntu.UyumsuzGoruntu):
            self._yukle_fabrikali(lambda h: h.__dict__.pop("_makro_state"))

    def test_canli_anahtarlar_yeni_surumden_alinir(self):
        """Y1: görüntüdeki eski `init.live_keys` listesi yeni sürümde geçerli değildir; GERÇEK yükleme yolu (`load_session(live_keys=...)`)."""
        eski = ["WAGE_TAX"]                                                                    # görüntü alındığı sürümün canlı anahtar listesi
        a = yeni_cekirdek({}, 4, ek_spec={"live_keys": eski})
        ilerle(a, 1)
        with self.assertRaises(ValueError):
            a.host.patch({"CORP_TAX": 0.3})                                                    # eski sürümde canlı değil
        p = goruntu_al(a)
        yeni = set(config.load_live_keys())
        self.assertIn("CORP_TAX", yeni)
        b = yukle(p, {}, live_keys=yeni)
        self.assertEqual(b.host._live_keys, frozenset(yeni))
        b.handle({"cmd": "patch", "overrides": {"CORP_TAX": 0.3}, "version": 2})              # yeni sürümün anahtarı kabul (host reddederse çekirdek `failed` yayımlardı)
        self.assertEqual(b.host.effective["CORP_TAX"], 0.3)
        c = yukle(p, {})                                                                       # liste verilmezse host kendi okumasını kullanır (eski listeyi DEĞİL)
        self.assertEqual(c.host._live_keys, frozenset(config.load_live_keys()))

    def test_kurgulanmis_firm_log_temizle_goruntusu_guvensiz_dosya_silinmez(self):
        """Y2: model kopyasındaki izinsiz işlev (`simkit.firm_log.temizle`) REDUCE ile çağrılamaz."""
        import io
        import pickle
        import pickletools
        import zlib
        hedef = tempfile.mktemp(prefix="kurban-")
        with open(hedef, "w") as f:
            f.write("x")
        self.addCleanup(lambda: os.path.exists(hedef) and os.remove(hedef))
        ham = zlib.decompress(b"".join(self.parcalar[1:]))
        f = io.BytesIO(ham)
        for op, _arg, _pos in pickletools.genops(f):
            if op.name == "STOP":
                break
        baslik = ham[:f.tell()]
        kotu = (b"\x80\x05" + b"csimkit.firm_log\ntemizle\n" + b"(" + b"csimkit.world\nWorld\n" + b")\x81" + pickle.dumps({"flog": {"spill_yol": hedef}}, protocol=5)[2:-1] + b"b" + b"t" + b"R" + b".")
        zs = zlib.compressobj()
        govde = zs.compress(baslik + kotu) + zs.flush()
        with self.assertRaises(goruntu.GuvensizGoruntu) as cm:
            yukle([self.parcalar[0], govde], {})
        self.assertEqual(cm.exception.fark["guvensiz"], ("simkit.firm_log", "temizle"))
        self.assertTrue(os.path.exists(hedef))

    def test_bozuk_kayitlar_uyumsuz_goruntu_bozuk(self):
        """Y3: yarım/kesilmiş/bozuk parça akışı `UyumsuzGoruntu{bozuk}` (B4b tariften oynatmaya yönlendirir); host kurulduysa kapatılır."""
        tam = b"".join(self.parcalar)
        kesik_gövde = [self.parcalar[0], b"".join(self.parcalar[1:])[:200]]
        for parcalar in (kesik_gövde,                                                           # kota/yarım yazım: zlib akışı kesik
                         [self.parcalar[0], b"\x00" * 64],                                      # zlib.error
                         [self.parcalar[0]],                                                    # akış önekte bitti (gövde yok)
                         [tam[:3]]):                                                            # önek bile yarım
            with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
                yukle(parcalar, {})
            self.assertTrue({"bozuk", "bicim"} & set(cm.exception.fark), cm.exception.fark)
        b = SessionCore(lambda e: None)                                                        # akış yarıda tükenir (`next` StopIteration)
        it = iter(self.parcalar[:2])
        with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
            goruntu.load_session(b, lambda: next(it), csv_dir=tempfile.mkdtemp(prefix="oyun-host-"), model_root=str(config.MODEL_ROOT))
        self.assertIn("bozuk", cm.exception.fark)

    def test_yukleme_sirasinda_import_hatasi_uyumsuz_goruntu(self):
        from unittest import mock
        with mock.patch.object(goruntu.SnapUnpickler, "load", side_effect=ModuleNotFoundError("oyun_server.sim.eski")):
            with self.assertRaises(goruntu.UyumsuzGoruntu) as cm:
                yukle(self.parcalar, {})
        self.assertEqual(cm.exception.fark["yukleme"][0], "ModuleNotFoundError")


def kotu_islev():
    _Kotu.cagrildi = True


class _Kotu:
    cagrildi = False

    def __reduce__(self):
        return (kotu_islev, ())


if __name__ == "__main__":
    unittest.main()
