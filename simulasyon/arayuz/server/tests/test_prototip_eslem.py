"""K2: prototip katalog çıkarıcı ve prototip -> kart eşlemi (registry/prototip_eslem.json).

Kart kimlikleri henüz kayıtta yok: R1a–R10 her biri kendi grubunu `MAPPED_GROUPS`'a ekleyerek "kayıtta var" testini açar.
"""
from __future__ import annotations

import functools
import json
import subprocess
import sys
import unittest
from collections import Counter
from pathlib import Path

ARAYUZ = Path(__file__).resolve().parents[2]            # simulasyon/arayuz
REGISTRY = ARAYUZ / "registry"
ARACLAR = REGISTRY / "araclar"
sys.path.insert(0, str(ARACLAR))

import katalog_cikar as kc  # noqa: E402

# R1a–R10 kendi bölümünü ekler. Değer: kartın `bolum` alanı (P için kayıt grubu; V için aktör; S "piyasa"; Y "dunya").
MAPPED_GROUPS: list[str] = ["para_faiz", "kredi", "bankacilik", "vergi", "sabit_kalemler",    # R1a
                            "butce", "kurtarma", "girisim", "fiyat", "loncalar", "pano", "konut", "inovasyon",    # R1b
                            "hane", "girisimci", "isci", "yatirimci", "yerlesik", "dunya", "piyasa"]    # R1c (V aktörleri, Y "dunya", S "piyasa")
# Eşlemde olup kayıtta başka görevde açılacak kartlar (gerekçeli)
KAYIT_DISI: dict[str, str] = {}      # R10 kartları kayıtta (R10 kartlandı)

R10_KARTLARI = ("kredi_para", "sehir_kasasi_kurali", "kar_firmada_kalir", "faize_duyarli_davranis", "beklenen_kar_girisim")
DENETIM_GIZLE = {53, 60, 62, 94}
BOLUNEN = {10: "Doğal işsizlik ve katsayısı", 54: "Girişim kapıları açık", 61: "Genç firma reçetesi", 80: "Sektör panosu"}
SABLON_KIMLIKLERI = ["bos_sart", "serbest_piyasa", "dayanikli_taban", "gecis_destegi", "pano_destek", "girisime_acik"]
# (prototip varsayılanı, birleşik model varsayılanı): şablon tabanını modelin varsayılanına bırakmak adının tersini üretir
FARKLI = {
    "TRANS_SUPPORT": (0, 2), "NPC_KEEP": (0.5, 2.0), "WAGE_TAX": (0.0, 0.1), "CORP_TAX": (0.0, 0.2),
    "SHRINK_FIRST": (False, True), "INFRA_CONT": (False, True), "FOUND_FUND": (0, 1), "SECTOR_BOARD": (0, 1),
    "ORDER_BOOK": (0, 1), "FOUND_COLLAT": (False, True), "SB_ENTRY_PERSIST": (0.02, -1.0),
}
# denetim satırı -> {ek anahtar: gerekçe}: satırın "Model" sütununda yazmayan ama kartın sahiplendiği anahtarlar
EK_ANAHTAR: dict[int, dict[str, str]] = {
    5: {"CM_RESERVE": "kredi parası uzman alanı (DK-10)", "CM_BRAKE": "kredi parası uzman alanı (DK-10)", "CM_PD": "kredi parası uzman alanı (DK-10)",
        "CREDIT_MONEY": "prototipin CREDIT_MINT adı modelde yok; birleşik modelde CREDIT_MONEY"},
    10: {"LAB_U_STAR": "V parçası: ücret denkleminin doğal işsizliği (denetim 'Sorun' sütunu)", "LAB_K": "V parçası: işgücü kıtlığında ücret artışı (§3.6 yeni satır)",
         "LAB_DOWN": "V parçası: ücret yapışkanlığı (§3.6 yeni satır)"},
    13: {"FF_FALLBACK": "kaynak çipi 'fon yetmezse lonca havuzuna düş' (#20 FF_*)"},
    15: {"CX_MIN_AGE": "büyüme kredisi şartı (cx_ok; denetim 'Sorun'da yok)", "CX_MIN_OREP": "büyüme kredisi şartı (cx_ok)"},
    65: {"PLAYER_MIGRATE_AFTER": "R1c: bekleme süresi 'Hareketli işgücü' senaryosunda değişir (1 hafta); modelde oyuncu göçünün ayarı"},
    93: {"TELIF_MEMBER_RATIO": "'üyeye oran' ikinci kontrol (denetim satırı 'iki kontrol' der)"},
    95: {"HW_UNLOCK": "'SW_UNLOCK ve benzerleri'", "MODA_UNLOCK": "'SW_UNLOCK ve benzerleri'", "TOUR_UNLOCK": "'SW_UNLOCK ve benzerleri'"},
}
IZINLI_DISARI: dict[str, tuple[list[str], str]] = {
    "yerli_uretim_programi": (["DOMESTIC_EVERY"], "denetim §2.10"),
    "kredi_dayanma": (["YK_RUNWAY_WEEKS"], "prototip crDefaults.dayanma.lim (26 hf)"),
    "kredi_devir": (["PRIV_RATE_MULT", "PRIV_TERM", "PRIV_GRACE", "PRIV_LTV", "PRIV_POOL_SHARE"], "prototip crDefaults.ozel: fc, vade, odm, pay, kota"),
    "kredi_medya": (["CX_MEDIA_TERM", "CX_MEDIA_LTV"], "prototip crDefaults.medya: vade, pay"),
    "kredi_ortak": (["CX_MARGIN", "CX_RATE_MIN", "LOAN_RATE", "CX_REPRICE", "LOAN_TERM", "LOAN_FLOOR"], "prototip crDefaults.common: marj, lt, reprice, vade, once"),
    "az_birikimli_harcama": (["POOR_SHARE", "WR_WEEKS"], "denetim §3.6 hane: POOR_SHARE, WR_WEEKS"),
    "aliskanlik_hizi": (["HAB_UP", "HAB_DOWN"], "denetim §3.1: alışkanlık hızı"),
    "mevduat_elde_tutma": (["DEP_KEEP_NEW", "DEP_SHARE"], "denetim §3.6 hane: DEP_KEEP_NEW, DEP_SHARE"),
    "tecrube_terfisi": (["SKILL_ON"], "denetim §3.3: tecrübe basamakları"),
    "konut_yatirim_karari": (["HOUSE_RISK_PREM"], "denetim §3.4"),
    "konut_fiyat_beklentisi": (["HOUSE_EXP_N", "HOUSE_EXP_DAMP"], "denetim §3.4"),
    "dao_payi_karari": (["EQ_RISK_INV", "EQ_FRAC", "EQ_MAX_HOLD"], "denetim §3.4"),
    "konut_satis_sikismasi": (["HOUSE_SQUEEZE_W"], "denetim §3.4"),
    "lonca_risk_payi": (["RISK_K", "RISK_MAX"], "prototip bhvDefs l_risk; credit_core.py risk marjı"),
    "yerlesik_batma_suresi": (["NPC_DIE_WEEKS"], "denetim §3.5"),
    "sehir_kasasi_kurali": (["TREASURY_RULE", "TR_WEEKS", "TR_CONV"], "PLAN-DILIM2 R10 (K-219)"),
    "kar_firmada_kalir": (["PROFIT_KEEP", "PK_WEEKS"], "PLAN-DILIM2 R10 (K-220)"),
    "faize_duyarli_davranis": (["RATE_BEHAV", "RB_CREDIT"], "PLAN-DILIM2 R10"),
    "beklenen_kar_girisim": (["ENTRY_EXP"], "PLAN-DILIM2 R10"),
    "mevduat_yonlendirme": (["DEP_ROUTE"], "PLAN-KREDI T10 (K-221)"),
    "lonca_batik_kapanis": (["LONCA_INSOLV_CLOSE"], "PLAN-KREDI T10 (K-221)"),
    "lonca_kolay_kurulus": (["LONCA_EASY"], "PLAN-KREDI T10 (K-221)"),
    "kadro_talebi_gorur": (["STAFF_DEMAND"], "PLAN-KREDI T10 (K-222)"),
    "ise_alim_kasa_sarti": (["HIRE_CASH_GATE"], "PLAN-KREDI T10 (K-222)"),
    "issiz_kurucu": (["ENTRY_JOBLESS"], "PLAN-KREDI T10 (K-187.5)"),
    "dunya_tohumu": (["PM_ADJ"], "MVP kartı"),
    "dunya_sabit_kalemleri": (["HOUSE_MAINT"], "denetim §2.8"),
}
MVP_SAHIPLERI = {"gecis_destegi": 45, "ucret_stopaji": 27, "kurumlar_vergisi": 28, "zararda_once_kucul": 51}


@functools.lru_cache(maxsize=1)
def taslak() -> dict:
    return kc.cikar()


@functools.lru_cache(maxsize=1)
def eslem() -> dict:
    return json.loads((REGISTRY / "prototip_eslem.json").read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def model_defaults() -> dict:
    from oyun_server import config
    from oyun_server.registry import defaults
    return defaults.read_param_defaults(str(config.MODEL_ROOT))


def isimler(r: dict) -> set[str]:
    return {r["proto"], *r.get("proto_adlari", [])}


def satir_indeksi() -> dict[str, list[dict]]:
    idx: dict[str, list[dict]] = {}
    for r in eslem()["satirlar"]:
        for n in isimler(r):
            idx.setdefault(n, []).append(r)
    return idx


class ExtractTests(unittest.TestCase):
    def test_extract_counts(self):
        t = taslak()
        readme_sha = kc.readme_sha()
        self.assertEqual(t["meta"]["sha256"], readme_sha, "prototip değişti: ref/README.md sha256 ile eşit olmalı")
        self.assertEqual(len(t["denetim"]), 97)
        # 97 = eski katalog 88 + denetimin Kredi grubundaki 9 satır (#13-#21; prototipte crTypes/crCommonDefs)
        self.assertEqual(len(t["katalog_eski"]) + 9, 97)
        # grup grup: denetim (Kredi hariç) = eski katalog; Kredi grubu 9 satır (#13-#21)
        den_g = Counter(r["grup"] for r in t["denetim"])
        eski_g = Counter(r["grup"] for r in t["katalog_eski"])
        self.assertEqual(den_g.pop("Kredi"), 9)
        self.assertEqual(eski_g.pop("Kredi", 0), 0)
        self.assertEqual(den_g, eski_g)
        self.assertEqual(len(t["katalog"]), 57)
        self.assertEqual(len(t["katalog_gruplari"]), 10)
        b = t["davranis"]
        by_id = {a["id"]: a for a in b["actors"]}
        self.assertGreaterEqual(len(by_id["hane"]["rows"]), 9)
        self.assertGreaterEqual(len(by_id["giri"]["rows"]), 12)
        self.assertEqual(len(t["piyasa"]), 11)
        self.assertEqual(len(t["kredi_turleri"]), 10)
        self.assertEqual(len(t["kredi_ortak"]), 9)
        self.assertEqual(len(t["sablonlar"]), 6)
        self.assertEqual(len(t["senaryolar"]), 8)
        self.assertEqual(len(t["profiller"]), 5)
        self.assertEqual(len(t["tohumlar"]), 6)
        self.assertEqual(sum(len(a["rows"]) for a in b["actors"]) + len(b["world"]) + len(b["consts"]) + len(b["calib"]), 52)
        self.assertTrue(t["gercek_dunya"] and t["takma_adlar"])

    def test_denetim_class_counts_parsed(self):
        c = Counter(r["sinif"] for r in taslak()["denetim"])
        self.assertEqual((c["P"], c["V"], c["S"], c["Y"]), (61, 27, 2, 7))
        self.assertEqual([r["no"] for r in taslak()["denetim"]], list(range(1, 98)))

    def test_prototype_untouched(self):
        before = kc.sha256(kc.PROTOTIP)
        kc.cikar()
        self.assertEqual(kc.sha256(kc.PROTOTIP), before)

    def test_cli_json(self):
        p = subprocess.run([sys.executable, "-P", str(ARACLAR / "katalog_cikar.py"), "--json"], capture_output=True, text=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stderr)
        d = json.loads(p.stdout)
        self.assertEqual(len(d["denetim"]), 97)
        self.assertEqual(len(d["katalog"]), 57)
        p = subprocess.run([sys.executable, "-P", str(ARACLAR / "katalog_cikar.py"), "--ozet"], capture_output=True, text=True, timeout=120)
        self.assertEqual(json.loads(p.stdout)["piyasa"], 11)

    def test_catalog_rows_have_all_fields(self):
        for r in taslak()["katalog"]:
            for f in kc.CATALOG_FIELDS:
                self.assertIn(f, r)
            self.assertTrue(r["name"] and r["label"], r)


class EslemTests(unittest.TestCase):
    def test_eslem_pins_prototype(self):
        self.assertEqual(eslem()["kaynak"]["prototip_sha256"], taslak()["meta"]["sha256"])

    def test_every_catalog_row_mapped(self):
        t = taslak()
        idx = satir_indeksi()
        beklenen: list[tuple[str, str]] = []
        beklenen += [("katalog", r["name"]) for r in t["katalog"]]
        beklenen += [("katalog_eski", r["name"]) for r in t["katalog_eski"]]
        beklenen += [("denetim", r["proto"]) for r in t["denetim"]]
        b = t["davranis"]
        beklenen += [("davranis", r["t"]) for a in b["actors"] for r in a["rows"]]
        beklenen += [("davranis", r["t"]) for r in b["world"] + b["consts"] + b["calib"]]
        beklenen += [("piyasa", r["t"]) for r in t["piyasa"]]
        beklenen += [("kredi_turu", "Kredi › " + r["ad"]) for r in t["kredi_turleri"]]
        beklenen += [("kredi_ortak", "Kredi › Ortak › " + r["label"]) for r in t["kredi_ortak"]]
        eksik = [(k, n) for k, n in beklenen if n not in idx]
        self.assertEqual(eksik, [])

    def test_denetim_rows_once_each(self):
        nos = [r["no"] for r in eslem()["satirlar"] if r.get("kaynak") == "denetim"]
        self.assertEqual(sorted(nos), list(range(1, 98)))
        den = {r["no"]: r for r in taslak()["denetim"]}
        for r in eslem()["satirlar"]:
            if r["kaynak"] == "denetim":
                self.assertEqual(r["proto"], den[r["no"]]["proto"])
                self.assertEqual(r["sinif"], den[r["no"]]["sinif"], r["proto"])
                self.assertEqual(r["grup"], den[r["no"]]["grup"], r["proto"])

    def test_every_davranis_row_once(self):
        ids = [r["bhv_id"] for r in eslem()["satirlar"] if r["kaynak"] == "davranis"]
        beklenen = [r["id"] for a in taslak()["davranis"]["actors"] for r in a["rows"]]
        b = taslak()["davranis"]
        beklenen += [r["id"] for r in b["world"] + b["consts"] + b["calib"]]
        self.assertEqual(sorted(ids), sorted(beklenen))
        self.assertEqual(sum(1 for r in eslem()["satirlar"] if r["kaynak"] == "piyasa"), 11)
        self.assertEqual(sum(1 for r in eslem()["satirlar"] if r["kaynak"] == "kredi_turu"), 10)

    def test_class_counts(self):
        c = Counter(r["sinif"] for r in eslem()["satirlar"] if r["kaynak"] == "denetim")
        self.assertEqual((c["P"], c["V"], c["S"], c["Y"]), (61, 27, 2, 7))
        for r in eslem()["satirlar"]:
            self.assertIn(r["sinif"], "PVSY", r["proto"])
            self.assertIn(r["durum"], {"kart", "bolundu", "gizli", "pasif", "r10"}, r["proto"])

    def test_composite_split(self):
        rows = {r["proto"]: r for r in eslem()["satirlar"]}
        kartlar = eslem()["kartlar"]
        for no, ad in BOLUNEN.items():
            r = next(x for x in eslem()["satirlar"] if x.get("no") == no)
            self.assertEqual(r["durum"], "bolundu", ad)
            layers = {kartlar[k]["layer"] for k in r["kartlar"]}
            self.assertIn("P", layers, ad)
            v_var = "V" in layers
            for ad2 in r.get("v_parca_satirlari", []):
                self.assertIn(ad2, satir_indeksi(), ad2)
                self.assertTrue(any(x["sinif"] == "V" for x in satir_indeksi()[ad2]), ad2)
                v_var = True
            self.assertTrue(v_var, f"{ad}: V parçası yok")
        # yalnız bu dört satır bölünür
        self.assertEqual(sorted(r["no"] for r in eslem()["satirlar"] if r["durum"] == "bolundu"), sorted(BOLUNEN))
        # bölünen V parçaları gerçek kartlara karşılık gelir
        self.assertIn("issizlik_ucret_tepkisi", rows["Doğal işsizlik ve katsayısı"]["kartlar"])
        self.assertIn("genc_firma_davranisi", rows["Genç firma reçetesi"]["kartlar"])
        self.assertIn("itibar_sarti", rows["Girişim kapıları açık"]["kartlar"])
        self.assertIn("sektor_panosu", rows["Sektör panosu"]["kartlar"])

    def test_gizli_has_reason(self):
        rows = eslem()["satirlar"]
        gizli = [r for r in rows if r["durum"] == "gizli"]
        self.assertGreaterEqual(len(gizli), 4)
        for r in gizli:
            self.assertTrue(r["gerekce"].strip(), r["proto"])
            self.assertEqual(r["kartlar"], [], r["proto"])
            if r["kaynak"] == "denetim":
                self.assertIn(r["no"], DENETIM_GIZLE)
            else:
                self.assertIn("ayni_satir", r)
                hedef = satir_indeksi()[r["ayni_satir"]][0]
                self.assertEqual(hedef["durum"], "gizli")
        self.assertEqual(sorted(r["no"] for r in gizli if r["kaynak"] == "denetim"), sorted(DENETIM_GIZLE))

    def test_r10_rows(self):
        r10 = [r for r in eslem()["satirlar"] if r["kaynak"] == "r10" or any(k in R10_KARTLARI for k in r["kartlar"])]
        self.assertTrue(all(r["durum"] in ("kart", "r10") for r in r10))
        self.assertTrue(all(r["durum"] == "kart" for r in r10 if r["kartlar"]))
        kartlar = {k for r in r10 for k in r["kartlar"]}
        self.assertEqual(kartlar, {"kredi_para", "sehir_kasasi_kurali", "kar_firmada_kalir", "faize_duyarli_davranis", "beklenen_kar_girisim"})
        self.assertTrue(any(r.get("no") == 5 and r["durum"] == "kart" for r in r10))

    def test_mapped_ids_unique_owner(self):
        rows, kartlar = eslem()["satirlar"], eslem()["kartlar"]
        sahip: dict[str, list[str]] = {}
        for r in rows:
            for k in r["kartlar"]:
                sahip.setdefault(k, []).append(r["proto"])
        self.assertEqual({k: v for k, v in sahip.items() if len(v) > 1}, {})
        self.assertEqual(sorted(set(sahip) - set(kartlar)), [], "satırda olup kartlar sözlüğünde olmayan kimlik")
        self.assertEqual(sorted(set(kartlar) - set(sahip)), [], "sahipsiz kart")
        idx = satir_indeksi()
        for r in rows:
            ayni = r.get("ayni_satir")
            if ayni is not None:
                for a in ([ayni] if isinstance(ayni, str) else ayni):
                    self.assertIn(a, idx, f"{r['proto']}: ayni_satir bulunamadı")
                    self.assertTrue(any(x["kartlar"] or x.get("ayni_satir") for x in idx[a]) or idx[a][0]["durum"] == "gizli", a)
            if not r["kartlar"] and r["durum"] != "gizli":
                self.assertTrue(ayni, f"{r['proto']}: kartı yok ve ayni_satir da yok")
        protos = [r["proto"] for r in rows]
        self.assertEqual(len(protos), len(set(protos)), "proto adı tekil olmalı")
        for k, c in kartlar.items():
            self.assertRegex(k, r"^[a-z][a-z0-9_]*$")
            self.assertIn(c["layer"], "PVSY")

    @staticmethod
    def world_fields() -> set[str]:
        wire = json.loads((ARAYUZ / "server" / "tests" / "fixtures" / "wire_contract.json").read_text(encoding="utf-8"))
        return set(wire["weeks"][0]["world"])

    def test_cards_layer_matches_rows(self):
        kartlar = eslem()["kartlar"]
        for r in eslem()["satirlar"]:
            for k in r["kartlar"]:
                c = kartlar[k]
                if r["durum"] in ("bolundu",):
                    continue
                # satır sınıfı ile kart katmanı: bilinçli farklar (zararda_once_kucul, #10 P parçası) dışında eşit
                if r["sinif"] != c["layer"]:
                    self.assertIn(r["proto"], {"Doğal işsizlik ve katsayısı", "Girişim kapıları açık", "Genç firma reçetesi", "Sektör panosu"}, f"{r['proto']} -> {k}")
        for k, c in kartlar.items():
            if c["layer"] == "V":
                self.assertIn(c["bolum"], {"hane", "girisimci", "isci", "yatirimci", "yerlesik", "dunya"}, k)
            elif c["layer"] == "S":
                self.assertEqual(c["bolum"], "piyasa", k)
            elif c["layer"] == "Y":
                self.assertEqual(c["bolum"], "dunya", k)
            if c["layer"] == "S":
                self.assertTrue(c.get("source_world_field"), k)
                self.assertIn(c["source_world_field"], self.world_fields(), k)

    def test_mvp_ids_reused(self):
        mvp = {s["id"]: s for s in json.loads((REGISTRY / "settings.mvp.json").read_text(encoding="utf-8"))["settings"]}
        kartlar = eslem()["kartlar"]
        rows = eslem()["satirlar"]
        for id_ in mvp:
            self.assertIn(id_, kartlar, id_)
            self.assertTrue(kartlar[id_]["mevcut"], id_)
            self.assertEqual(kartlar[id_]["params"], mvp[id_]["params"], id_)
        for id_, no in MVP_SAHIPLERI.items():
            sahip = next(r for r in rows if id_ in r["kartlar"])
            self.assertEqual(sahip.get("no"), no, id_)
        sahip = next(r for r in rows if "dunya_tohumu" in r["kartlar"])
        self.assertEqual(sahip["kaynak"], "tohum")
        # korunan gruplar
        self.assertEqual(kartlar["gecis_destegi"]["bolum"], "kurtarma")
        self.assertEqual(kartlar["ucret_stopaji"]["bolum"], "vergi")
        self.assertEqual(kartlar["kurumlar_vergisi"]["bolum"], "vergi")
        self.assertEqual(kartlar["dunya_tohumu"]["bolum"], "dunya")
        # vergi kartları vergi grubunda: denetim §1.5 (#26-#34) hepsi
        for r in rows:
            if r.get("no") in range(26, 35):
                for k in r["kartlar"]:
                    self.assertEqual(kartlar[k]["bolum"], "vergi", k)
        # başlangıç dünyası: tohum satırı Y, mevcut kimlik
        self.assertEqual(kartlar["dunya_tohumu"]["layer"], "Y")
        # şablonlar
        sab = {s["kimlik"]: s for s in eslem()["sablonlar"]}
        self.assertEqual(list(sab), SABLON_KIMLIKLERI)
        tpl = json.loads((REGISTRY / "templates.json").read_text(encoding="utf-8"))["templates"]
        for t in tpl:
            self.assertIn(t["id"], sab, t["id"])
        self.assertTrue(sab["gecis_destegi"]["not"])
        # zararda önce küçül: şablon 2'de açık
        self.assertIn("zararda_once_kucul", sab["dayanikli_taban"]["kartlar"])

    def test_params_exist_or_passive(self):
        d = model_defaults()
        for k, c in eslem()["kartlar"].items():
            for p in c["params"] + c["gosterir"]:
                self.assertIn(p, d, f"{k}: model anahtarı yok: {p}")
            if c["status"] == "passive":
                self.assertEqual(c["params"], [], k)
                self.assertFalse(c["duzenlenebilir"], k)
                self.assertTrue(c.get("not"), f"{k}: pasif kartın nedeni yazılmalı")
            elif c["layer"] != "S":
                if c["duzenlenebilir"]:
                    self.assertTrue(c["params"], f"{k}: düzenlenebilir aktif kartın anahtarı yok")
                else:
                    self.assertTrue(c["params"] or c["gosterir"], f"{k}: salt okunur kartın gösterdiği anahtar yok")
            self.assertIn(c["status"], {"active", "passive", "experimental"}, k)
            for p in c["params"]:
                self.assertIsInstance(p, str)
                self.assertNotIsInstance(d[p], str, f"{k}: dize parametre kartlanmaz: {p}")

    def test_params_unique_owner(self):
        sahip: dict[str, list[str]] = {}
        for k, c in eslem()["kartlar"].items():
            for p in c["params"]:
                sahip.setdefault(p, []).append(k)
        self.assertEqual({p: v for p, v in sahip.items() if len(v) > 1}, {})

    def test_collapsed_flags_not_carded(self):
        for k, c in eslem()["kartlar"].items():
            for p in c["params"] + c["gosterir"]:
                self.assertNotIn(p, {"INNOV_ON", "LIFE_ON"}, k)

    def test_audit_params_covered(self):
        """Denetimin 'Model' sütunundaki her model adı ya bir kartın params/gosterir'inde ya da gerekçeli dışarıda."""
        d = model_defaults()
        kart_params = {p for c in eslem()["kartlar"].values() for p in c["params"] + c["gosterir"]}
        disarida = {
            "LOAN_LEV": "eski büyüme limiti; CX_GROW_K/CX_INV_K yerini aldı (denetim #15)",
            "LONCA_LEVERAGE": "yapı anahtarı; kart yalnız LEV_K'yı verir, requires olarak okur (#22)",
            "NPC_GRACE": "Gizli satır (#53)", "ENTRY_JOBLESS": "Gizli satır (#60)", "NPC_LAB_PF": "Gizli satır (#62)",
            "DIFFUSE_LAG": "Ölü parametre, gizli satır (#94)",
        }
        eksik = []
        for r in taslak()["denetim"]:
            for n in r["model_adlari"]:
                if n in d and n not in kart_params and n not in disarida:
                    eksik.append((r["no"], n))
        self.assertEqual(eksik, [])

    def test_sablon_ve_senaryo_eslemi(self):
        kartlar = eslem()["kartlar"]
        t = {x["id"]: x for x in taslak()["sablonlar"]}
        for s in eslem()["sablonlar"]:
            self.assertEqual(s["proto"], t[s["proto_id"]]["ad"])
            for k in s["kartlar"] + s["davranis_kartlari"]:
                self.assertIn(k, kartlar, f"şablon {s['kimlik']}: {k}")
            for ham in t[s["proto_id"]]["set_anahtarlari"]:
                self.assertIn(ham, s["set_anahtarlari"])
        self.assertEqual(len(eslem()["sablonlar"]), 6)
        # şablon 5 girişimci davranışlarını da değiştirir (R34 notu)
        sab5 = next(s for s in eslem()["sablonlar"] if s["kimlik"] == "girisime_acik")
        self.assertIn("girisimci_dalgasi", sab5["davranis_kartlari"])
        ids = {s["id"]: s for s in taslak()["senaryolar"]}
        self.assertEqual([x["kimlik"] for x in eslem()["senaryolar"]], list(ids))
        for s in eslem()["senaryolar"]:
            self.assertEqual(sorted(s["satirlar"]), sorted(ids[s["proto_id"]]["ch"]))
            for k in s["kartlar"]:
                self.assertEqual(kartlar[k]["layer"], "V", k)

    # ------------------------------------------------------------------ düzeltme turu 1
    def test_card_params_within_row_model_names(self):
        """Bir denetim satırının kartları yalnız o satırın model adlarını (ya da gerekçeli ek listeyi) sahiplenir:
        yanlış satıra yazılmış anahtar (ör. satış vergisi <-> temettü takası) düşer."""
        d = model_defaults()
        kartlar = eslem()["kartlar"]
        den = {r["no"]: r for r in taslak()["denetim"]}
        ihlal = []
        for r in eslem()["satirlar"]:
            if r["kaynak"] != "denetim":
                continue
            izinli = set(den[r["no"]]["model_adlari"]) | set(EK_ANAHTAR.get(r["no"], {}))
            for kal in den[r["no"]]["model_kaliplari"]:
                pre, suf = kal.split("*")
                izinli |= {k for k in d if k.startswith(pre) and k.endswith(suf)}
            for k in r["kartlar"]:
                for p in kartlar[k]["params"]:
                    if p not in izinli:
                        ihlal.append((r["no"], k, p))
        self.assertEqual(ihlal, [])
        for no, ek in EK_ANAHTAR.items():
            for p, neden in ek.items():
                self.assertTrue(neden.strip(), (no, p))

    def test_extractor_reads_all_backtick_names(self):
        den = {r["no"]: r for r in taslak()["denetim"]}
        self.assertEqual(den[9]["model_adlari"], ["POL_MAX", "POL_MIN", "POL_NEUT", "POL_STEP"])
        self.assertIn("YOUNG_GRACE", den[14]["model_adlari"])
        self.assertIn("YOUNG_RATE_MULT", den[14]["model_adlari"])
        self.assertIn("YOUNG_POOL_SHARE", den[14]["model_adlari"])
        self.assertIn("CX_MORT_MARGIN", den[16]["model_adlari"])
        self.assertIn("FEE_MAX", den[72]["model_adlari"])
        self.assertIn("RM_HI", den[13]["model_adlari"])
        self.assertEqual(den[20]["model_kaliplari"], ["FF_*"])

    def test_arge_credit_is_active_readonly(self):
        c = eslem()["kartlar"]["kredi_arge"]
        self.assertEqual(c["status"], "active")
        self.assertFalse(c["duzenlenebilir"])
        self.assertEqual(c["params"], [])
        for p in ("CX_INV_K", "CX_MIN_AGE", "CX_MIN_OREP"):
            self.assertIn(p, c["gosterir"])
        self.assertIn("yatırım kredisiyle ortak", c["not"])
        for k in ("kredi_yatirim", "kredi_buyume"):
            self.assertIn("ortak", eslem()["kartlar"][k]["not"], k)
        yat = eslem()["kartlar"]["kredi_yatirim"]
        self.assertIn("CX_MIN_AGE", yat["gosterir"])
        row = next(r for r in eslem()["satirlar"] if "kredi_arge" in r["kartlar"])
        self.assertEqual(row["durum"], "kart")

    def test_scarcity_growth_is_resident_firm_behaviour(self):
        c = eslem()["kartlar"]["kitlikta_buyume"]
        self.assertEqual((c["layer"], c["bolum"]), ("V", "yerlesik"))
        self.assertIn("pano açık", eslem()["kartlar"]["pano_kurallari"]["not"])
        rows = {r["proto"]: r for r in eslem()["satirlar"]}
        # girişimci ekranının 'Kıtlıkta büyüme' satırı yalnız pano kurallarına bağlı; PM_BOOST_MAX yerleşik firma kartı
        self.assertEqual(rows["Girişimciler › Kıtlıkta büyüme"]["ayni_satir"], "Fiyat, kadro ve üretim kuralları")
        self.assertIn("yerleşik", rows["Kıtlıkta fiyat/kadro desteği"]["gerekce"])
        self.assertNotIn("girişimci", rows["Kıtlıkta fiyat/kadro desteği"]["gerekce"])

    def test_templates_carry_full_values(self):
        d = model_defaults()
        for p, (proto, model) in FARKLI.items():
            self.assertEqual(d[p], model, p)
        sab = {s["kimlik"]: s for s in eslem()["sablonlar"]}
        kart_of = {p: k for k, c in eslem()["kartlar"].items() for p in c["params"]}
        for kimlik, s in sab.items():
            v = s["model_degerleri"]
            for p in FARKLI:
                self.assertIn(p, v, f"{kimlik}: {p} açıkça yazılmalı")
            for p in v:
                self.assertIn(p, d, p)
                self.assertIn(p, kart_of, f"{kimlik}: {p} hiçbir kartın anahtarı değil")
            self.assertTrue(s["anlatim"].strip(), kimlik)
            farkli_kartlar = {kart_of[p] for p in FARKLI}
            self.assertTrue(farkli_kartlar <= set(s["kartlar"]), kimlik)
        # değerler TAM bağlı: her şablonun model_degerleri beklenenle birebir eşit (tek bir değerin kayması düşer)
        proto = {p: pv for p, (pv, mv) in FARKLI.items()}
        mvp_taban = dict(d_ for d_ in ((p, mv) for p, (pv, mv) in FARKLI.items()))
        b = dict(mvp_taban, NPC_KEEP=2.0, WAGE_TAX=0.1, CORP_TAX=0.2, INFRA_CONT=True, SHRINK_FIRST=True, ORDER_BOOK=1, FOUND_COLLAT=True,
                 TRANS_SUPPORT=0, FOUND_FUND=1, SECTOR_BOARD=1, SB_ENTRY_PERSIST=-1.0)
        beklenen = {
            "bos_sart": proto, "serbest_piyasa": proto, "dayanikli_taban": b,
            "gecis_destegi": dict(b, TRANS_SUPPORT=2, TRANS_CAP=28000.0, TRANS_PRIV_OK=0),
            "pano_destek": dict(b, TRANS_SUPPORT=1, SECTOR_BOARD=1, SB_ENTRY_PERSIST=-1.0),
            "girisime_acik": dict(b, ENTRY_OPEN=1),
        }
        for kimlik, bek in beklenen.items():
            self.assertEqual(sab[kimlik]["model_degerleri"], bek, kimlik)
        # MVP şablonu (ölçülmüş, kayıtlı koşular onunla üretildi) bağlayıcı: kuruluş fonu ve sektör panosu model varsayılanında kalır
        mvp = {t["id"]: t for t in json.loads((REGISTRY / "templates.json").read_text(encoding="utf-8"))["templates"]}
        self.assertEqual(mvp["dayanikli_taban"]["values"], {"gecis_destegi": "kapali"})
        self.assertEqual(sab["dayanikli_taban"]["model_degerleri"]["TRANS_SUPPORT"], 0)
        self.assertEqual((b["FOUND_FUND"], b["SECTOR_BOARD"]), (d["FOUND_FUND"], d["SECTOR_BOARD"]))
        notu = sab["dayanikli_taban"]["not"]
        self.assertIn("kuruluş fonu", notu)
        self.assertIn("sektör panosu", notu)
        self.assertIn("prototip", notu)

    def test_outside_audit_rows_params_bounded(self):
        """Denetim satırı olmayan kartlar (kredi türleri, ortak kurallar, davranış, R10, kalibrasyon) için de satır sınırı:
        her kartın params'ı gerekçeli izinli listeyle birebir; kartlar arası takas düşer."""
        kartlar = eslem()["kartlar"]
        sahipsiz = []
        for r in eslem()["satirlar"]:
            if r["kaynak"] == "denetim":
                continue
            for k in r["kartlar"]:
                if not kartlar[k]["params"]:
                    continue
                if k not in IZINLI_DISARI:
                    sahipsiz.append(k)
                    continue
                izin, neden = IZINLI_DISARI[k]
                self.assertTrue(neden.strip(), k)
                self.assertEqual(sorted(kartlar[k]["params"]), sorted(izin), k)
        self.assertEqual(sahipsiz, [])
        sahip_satir = {k for r in eslem()["satirlar"] if r["kaynak"] != "denetim" for k in r["kartlar"] if kartlar[k]["params"]}
        self.assertEqual(sorted(set(IZINLI_DISARI) - sahip_satir), [], "izin listesinde artık kart var")

    def test_model_notes_follow_the_code(self):
        d = model_defaults()
        self.assertEqual(d["WORKING_CAPITAL_CYCLES"], 2)
        self.assertEqual(d["CYCLES_PER_WEEK"], 7)
        rows = {r["proto"]: r for r in eslem()["satirlar"]}
        gerekli = ["NPC kâr tamponu", "Faiz kuralı", "Büyüme / yatırım paketi", "Zararda önce küçül", "Kuruluş kredisi paketi",
                   "Kredi › Ortak › Önce ücret", "Kredi › Dayanma limiti (genç firma reçetesi)", "Kredi › Ortak kredi kuralları"]
        for ad in gerekli:
            self.assertTrue(rows[ad].get("model_notu", "").strip(), ad)
        self.assertIn("2 döngü", rows["NPC kâr tamponu"]["model_notu"])
        self.assertIn("mevduat faizi", rows["Faiz kuralı"]["model_notu"])
        self.assertIn("CX_MIN_AGE", rows["Büyüme / yatırım paketi"]["model_notu"])
        self.assertIn("yerleşik", rows["Zararda önce küçül"]["model_notu"])
        self.assertIn("LOAN_RATE", rows["Kuruluş kredisi paketi"]["model_notu"])
        self.assertIn("GELİŞTİRİCİ NOTU", eslem()["not"])
        # birim iddiaları kodla tutarlı: LOAN_LEV hâlâ yenileme kredisinde ve fonsuz genç firma yolunda kullanılır; LOAN_TERM hafta
        buyume = rows["Büyüme / yatırım paketi"]["model_notu"]
        self.assertNotIn("kullanılmıyor", buyume)
        self.assertIn("yenileme", buyume)
        ortak = rows["Kredi › Ortak kredi kuralları"]["model_notu"]
        self.assertIn("LOAN_TERM hafta", ortak)
        self.assertNotIn("Ortak vade' birimleri", ortak)
        for r in eslem()["satirlar"]:
            if "model_notu" in r and "LOAN_TERM" in r["model_notu"]:
                self.assertNotIn("LOAN_TERM) işletme", r["model_notu"])

    def test_minor_notes(self):
        k = eslem()["kartlar"]
        self.assertIn("0,02", k["kalici_kitlik"]["not"])
        self.assertIn("TRANS_ON", k["sektor_moda"]["not"])
        self.assertTrue({"CM_RESERVE", "CM_BRAKE", "CM_PD"} <= set(k["kredi_para"]["params"]))
        self.assertIn("eski ölçüm", k["kredi_para"]["not"])
        self.assertIn("CM_RESERVE", k["mevduat_nakit_rezervi"]["not"])
        self.assertIn("kaynak", k["kredi_genc"]["not"])
        self.assertIn("çarpan", k["sektor_acilis_esikleri"]["not"])
        self.assertIn("düzenlenebilir", k["zararda_once_kucul"]["not"])

    def test_registry_has_mapped_groups(self):
        """R görevleri `MAPPED_GROUPS`'a bölüm ekledikçe: eşlemdeki kart kayıtta, aynı katman/bölüm/params ile."""
        if not MAPPED_GROUPS:
            self.skipTest("henüz hiçbir R görevi grubunu açmadı")
        sys.path.insert(0, str(ARAYUZ / "server"))
        from tests.registry_helpers import real_registry
        reg = real_registry()
        kayit = {s.id: s for s in reg.settings}
        kartlar = eslem()["kartlar"]
        for bolum in MAPPED_GROUPS:
            ks = [k for k, c in kartlar.items() if c["bolum"] == bolum]
            self.assertTrue(ks, f"eşlemde {bolum} bölümü yok")
            for k in ks:
                if k in KAYIT_DISI:
                    continue
                self.assertIn(k, kayit, f"{bolum}: {k} kayıtta yok")
                s, c = kayit[k], kartlar[k]
                if c["status"] == "passive":
                    self.assertEqual(s.status, "passive", k)
                else:
                    self.assertEqual(list(s.params), c["params"], k)
                if c["layer"] == "P":
                    self.assertEqual(s.group, bolum, k)
                else:
                    self.assertEqual(s.layer, c["layer"], k)
                    if c["layer"] == "V":
                        self.assertEqual(s.actor, bolum, k)


if __name__ == "__main__":
    unittest.main()
