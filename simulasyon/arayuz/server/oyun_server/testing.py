"""FakeHost (A4): ModelHost ile aynı arayüz, belirlenimli sentetik satırlar, anında. `OYUN_HOST=fake` ile seçilir."""
from __future__ import annotations

import hashlib
import os
import queue
import re
import shutil
import signal
import sys
import threading
import time
from typing import Any, Callable, Iterator

# Satır sütunları (kayit_aktar FIELDS ile uyumlu alt küme; değerler metin, model satırları gibi).
_COLS = ["calisan", "issiz", "npc_firma", "oyuncu_firma", "batan_kum", "sehir_kasasi", "gini_servet", "para_toplam"]


_FAKE_KINDS = (("ahir", "sut"), ("un", "un"), ("firin", "ekmek"))      # S5: sahte zincir: ahır -> un -> fırın
_FAKE_FIRMS = ("fk0", "fk1", "fk2")


def _unit(seed: str, *parts: Any) -> float:
    d = hashlib.sha256((seed + "|" + "|".join(map(str, parts))).encode()).digest()
    return int.from_bytes(d[:8], "big") / 2**64


_DAO_TURLER = ("mevduat", "cek", "sermaye_ekle", "lonca_sec", "lonca_kur", "ayril", "ahirdan_cik", "goc", "kur", "basvur", "kadro")
# Karar türü -> zorunlu alanlar (gerçek `simkit.human._ALANLAR` ile aynı tablo; `tur` hep vardır).
_DAO_ALANLAR = {"mevduat": ("lonca", "oran"), "cek": ("miktar",), "sermaye_ekle": ("miktar",), "lonca_sec": ("lonca",), "lonca_kur": ("yol",), "ayril": (), "ahirdan_cik": (), "goc": ("sehir",), "kur": ("sektor",), "basvur": ("firma",), "kadro": ("hedef",)}
_DAO_LONCA_KUR_YOLLARI = ("girisimci", "medya", "yeniden")
_DAO_LONCA_KUR_EKSIK = {"girisimci": ("erken", "inovator_degil"), "medya": ("erken", "medya_firma"), "yeniden": ("yuva_yok",)}      # F3: sahte gözlemde hep eksik (gerçek `lonca_kur_eksikleri` kimlikleri)
_DAO_KAPASITE = 25                                       # sahte insan işletmesinin kapasitesi (kadro kararı üst sınırı; gerçek: CAP_OTHER)
_DAO_ISTEN_CIKARMA = 3                                    # kabul edilen başvurudan bu kadar hafta sonra sahte firma oyuncuyu çıkarır (isten_cikarildi)
_DAO_ILAN_FIRMALARI = ("fk0", "fk1", "fk2")              # sahte ilan veren firmalar (gerçek ilanlar: `simkit.human.ilanlar`)
_DAO_SEKTORLER = (("tarla_bugday", "bugday"), ("un", "un"), ("firin", "ekmek"))


class FakeKararHatasi(ValueError):
    """Sahte host'un geçersiz kararı (gerçek `simkit.human.KararHatasi` ile aynı sözleşme: `str(e)` kod, `fields` nedenler)."""

    def __init__(self, kod: str, fields: Any = ()):
        super().__init__(kod)
        self.fields = list(fields)


class FakeHost:
    model_version = "fake"

    def __init__(self, model_root: str, overrides: dict[str, Any], weeks: int = 200, n_cities: int = 5,
                 csv_dir: str | None = None, live_keys: Any = None):
        self._live_keys = None if live_keys is None else frozenset(live_keys)   # ikinci kapı (ModelHost ile aynı sözleşme)
        self._csv_dir = csv_dir                   # ModelHost ile aynı sözleşme: verilen dizin close()'da silinir
        self.weeks = weeks
        self.week = 0
        self._seed = repr(sorted(overrides.items(), key=lambda kv: kv[0]))
        self.effective: dict[str, Any] = dict(overrides)
        self.base_values: dict[str, Any] = {}
        self._initial = dict(overrides)
        self._dao_tek: dict[int, dict] = {}               # DAO (T6a): uygulama haftası -> tek seferlik karar
        self._dao_pref: dict | None = None                # sürekli mevduat tercihi
        self._dao_ev: list[dict] = []                     # son hesaplanan haftanın insan olayları
        self._dao_cikti: int | None = None                # ahirdan_cik'in uygulandığı hafta (ondan sonra ahırda değil, iş arayan)
        self._dao_is: tuple[int, str] | None = None       # kabul edilen başvuru: (hafta, firma); ondan sonra o firmada çalışan
        self._dao_hedef: int | None = None                # kadro kararı (G17i; HIRE_TARGET); uygulanmış (insan_hedef karşılığı)
        self._dao_kadro: dict[int, int | None] = {}       # kadro kararı: uygulama haftası -> hedef (gerçekte kendi yuvası; hafta açılışında uygulanır)
        self._dao_sahip = False                           # sahte insan işletme sahibi mi (varsayılan hayır: `kur` hep kurulamadi; testler True yapar)
        self._dao_ayrildi: str | None = None              # `ayril` ile bırakılan firma (geri alınma engeli)
        # Hata/çıktı enjeksiyonu (P-08; yalnız ortam değişkeni ile): çökme haftası, başıboş print, stderr taşması, adım gecikmesi
        env = os.environ
        self._fail_week = int(env["OYUN_FAKE_FAIL_WEEK"]) if env.get("OYUN_FAKE_FAIL_WEEK") else None
        self._print = env.get("OYUN_FAKE_PRINT") or None
        self._crash_week = int(env["OYUN_FAKE_CRASH_WEEK"]) if env.get("OYUN_FAKE_CRASH_WEEK") else None
        self._step_ms = float(env.get("OYUN_FAKE_STEP_MS") or 0)
        kb = int(env.get("OYUN_FAKE_STDERR_KB") or 0)
        if kb:
            line = ("x" * 1023) + "\n"
            for _ in range(kb):
                sys.stderr.write(line)
            sys.stderr.flush()

    def _salt(self) -> str:
        return "" if self.effective == self._initial else repr(sorted(self.effective.items(), key=lambda kv: kv[0]))

    def step(self) -> dict[str, Any]:
        if self.week >= self.weeks:
            raise ValueError("model %d. haftada bitti" % self.weeks)
        if self._step_ms:
            time.sleep(self._step_ms / 1000)
        if self._print:
            print(self._print)                       # worker bunu stderr'e yönlendirir
            os.write(1, (self._print + "\n").encode())  # fd düzeyinde de
        if self._crash_week is not None and self.week + 1 == self._crash_week:
            os.kill(os.getpid(), signal.SIGKILL)     # sert ölüm (çökme raporu açmaz): failed olayı yok
        if self._fail_week is not None and self.week + 1 == self._fail_week:
            raise KeyError("enjekte hata (hafta %d)" % self._fail_week)
        self.week += 1
        w = self.week
        self._dao_ev = self._dao_uygula(w)
        row: dict[str, Any] = {"hafta": str(w)}
        # patch sonrası talep_karsilama ayrışır (etkin küme tohuma girer); öteki sütunlar yalnız kuruluş tohumuna bağlı
        row["talep_karsilama"] = "%.4f" % (0.5 + 0.4 * _unit(self._seed + self._salt(), "talep", w))
        for i, c in enumerate(_COLS):
            row[c] = "%.4f" % (_unit(self._seed, c, w) * (1000 if i else 1))
        return row

    def _dao_durum(self, w: int) -> str:
        """Sahte oyuncunun w. haftadaki durumu: 2. haftaya dek ahır; `ahirdan_cik` ya da 2. hafta sonrası ahırdan çıkmış; başvuru kabulünden sonra çalışan."""
        if self._dao_is is not None and self._dao_is[0] <= w < self._dao_is[0] + _DAO_ISTEN_CIKARMA:
            return "calisan"
        if self._dao_cikti is not None and w >= self._dao_cikti:
            return "is_arayan"
        return "calisan" if w >= 2 else "ahir"

    def _dao_ilanlar(self, w: int) -> list[dict[str, Any]]:
        """w. haftanın sahte ilanları (ücrete göre azalan; yalnız açık kadro olanlar): fk2 5. haftadan sonra ilanı kapatır."""
        satirlar = [("fk0", "un", 2, 101.5, "guclu", False), ("fk1", "firin", 1, 84.0, "orta", False), ("fk2", "tarla_bugday", 1, 66.5, "zayif", True)]       # ücret HAFTALIK (modelde döngü ücreti x 7)
        return [{"firma": f, "ad": f, "sektor": k, "acik": a, "ucret": u, "kasa_gucu": g, "maas_odeyemedi": m} for f, k, a, u, g, m in satirlar if not (f == "fk2" and w >= 5)]

    def _dao_uygula(self, w: int) -> list[dict[str, Any]]:
        """w. haftanın açılışında sıradaki tek seferlik kararın sahte etkisi (olay): gerçek modeldeki olay adlarıyla."""
        k = self._dao_tek.pop(w, None)
        cikar: list[dict[str, Any]] = []
        if self._dao_is is not None and w == self._dao_is[0] + _DAO_ISTEN_CIKARMA:
            cikar = [{"tur": "isten_cikarildi", "hafta": w, "firma": self._dao_is[1], "neden": "ucret_odenmedi"}]
        if w in self._dao_kadro:
            self._dao_hedef = self._dao_kadro.pop(w)
            if self._dao_sahip:
                cikar.append({"tur": "kadro_hedefi", "hafta": w, "firma": "fk0", "hedef": self._dao_hedef})      # gerçek human_week_open: hedef bir sonraki hafta açılışında uygulanır
        if k is None:
            return cikar
        return cikar + self._dao_karar_olayi(w, k)

    def _dao_karar_olayi(self, w: int, k: dict[str, Any]) -> list[dict[str, Any]]:
        tur = k["tur"]
        if tur == "ayril":
            self._dao_ayrildi = "fk0"
            return [{"tur": "ayrildi", "hafta": w}]
        if tur == "ahirdan_cik":
            self._dao_cikti = w
            return [{"tur": "ahirdan_cikti", "hafta": w}]
        if tur == "basvur":
            firma = k["firma"]
            eski = self._dao_is[1] if (self._dao_durum(w) == "calisan" and self._dao_is is not None) else None
            if eski == firma:
                return [{"tur": "basvuru_red", "hafta": w, "firma": firma, "neden": "ayni_firma"}]
            if not any(i["firma"] == firma for i in self._dao_ilanlar(w)):
                return [{"tur": "basvuru_red", "hafta": w, "firma": firma, "neden": "ilan_kapandi"}]
            self._dao_is = (w, firma)
            kabul = [{"tur": "basvuru_kabul", "hafta": w, "firma": firma}]
            return kabul + ([{"tur": "is_degistirdi", "hafta": w, "eski": eski, "yeni": firma}] if eski is not None else [])      # çalışan insan işten ayrılmadan başvurur; kabulde eski işten çıkış yeni girişle aynı adımda
        if tur == "cek":
            return [{"tur": "cekilemedi", "hafta": w}]
        if tur == "sermaye_ekle":
            return [{"tur": "sermaye_eklenemedi", "hafta": w}]
        if tur == "lonca_sec":
            return [{"tur": "karar_uygulanamadi", "hafta": w, "karar": "lonca_sec", "neden": "kurucu_degil"}]      # sahte insanın işletmesi yok
        if tur == "lonca_kur":
            return [{"tur": "lonca_kurulamadi", "hafta": w, "yol": k["yol"], "neden": list(_DAO_LONCA_KUR_EKSIK[k["yol"]])}]      # sahte insan kurucu değil: şartlar eksik
        if tur == "goc":
            return [{"tur": "goc_etti", "hafta": w, "sehir": k["sehir"]}]
        return [{"tur": "kurulamadi", "hafta": w, "sektor": k["sektor"], "neden": "sart"}]

    def _dao_firmam(self, w: int) -> dict[str, Any] | None:
        """Sahte işletmem (gerçek `human.gozlem` firmam): yalnız sahte insan işletme sahibiyse; HIRE_TARGET açıkken hedef (karar yoksa None) ve kapasite eklenir."""
        if not self._dao_sahip:
            return None
        f: dict[str, Any] = {"ad": "fk0", "sektor": "un", "nakit": 100.0 + w, "isci": 2, "kar": 0.0, "yas": w, "kasa_degisim": None, "kasa_hafta": None}
        if self._initial.get("HIRE_TARGET"):
            f["hedef"] = self._dao_hedef
            f["kapasite"] = _DAO_KAPASITE
        return f

    def dao_gozlem(self) -> dict[str, Any] | None:
        """Sahte DAO gözlemi (gerçek `simkit.human.gozlem` ile aynı anahtarlar, belirlenimli); `HUMAN_ON` yoksa None (Kurucu)."""
        if not self._initial.get("HUMAN_ON"):
            return None
        w = self.week
        durum = self._dao_durum(w)
        firma = self._dao_is[1] if self._dao_is is not None and w >= self._dao_is[0] else "fk0"
        calisan = durum == "calisan"
        return {
            "hafta": w,
            "ben": {"sehir": 0, "nakit": 100.0 + w, "mevduat": {"lonca": None, "tutar": 0.0},
                    "is": {"firma": firma if calisan else ("s0_ahir0" if durum == "ahir" else None), "sektor": "un" if calisan else ("ahir" if durum == "ahir" else None), "ucret": 10.0 if durum != "is_arayan" else 0.0},
                    "durum": durum, "calisilan_hafta": max(0, w - 1), "itibar": 0.3, "tecrube_hafta": 0.5 * max(0, w - 1), "terfi_esik": {"kalfa": {"hafta": 40.0, "itibar": 4.0}, "usta": {"hafta": 150.0, "itibar": 12.0}}, "servet_dilimi": 1 + w % 5, "unvan": "cirak",
                    **({"loncam": None} if self._initial.get("HUMAN_LONCA") else {})},      # F3: sahte insanın loncası yok
            "firmam": self._dao_firmam(w),      # K5: gerçekte firmam sahiplikten gelir (kadro kararından değil); hedef karar yoksa/null'da None
            "kurabilir": {"evet": False, "eksikler": ["calisma"], "harc": 0.0, "gereken_hafta": 1},
            "sektorler": [dict({"sektor": k, "urun": u, "fiyat": 1.0 + 0.1 * i, "firma": 1 + i, "eksik": 10.0 * i, "disaridan": 5.0 * i},
                               **({"kasa_egilim": -50.0 * i, "firma_sayisi_13hf": i} if self._initial.get("FIRM_LIFE_LOG") else {})) for i, (k, u) in enumerate(_DAO_SEKTORLER)],      # F4: sektör eğilimi (gerçek gözlemde ilk 13 haftada None; sahte hep sayı)
            **({"lonca_kur": {y: list(_DAO_LONCA_KUR_EKSIK[y]) for y in _DAO_LONCA_KUR_YOLLARI},
                "lonca_kur_ayrinti": {y: [{"id": i} for i in _DAO_LONCA_KUR_EKSIK[y]] for y in _DAO_LONCA_KUR_YOLLARI}} if self._initial.get("HUMAN_LONCA") else {}),      # F3: yol -> eksik kimlikleri (gerçek gözlemle aynı anahtar)
            "loncalar": [dict({"ad": "lonca%d" % i, "mevduat_faizi": 0.01 * i, "kapali": i == 5, "mevduat": 100.0 * i},
                              **({"pay_orani": 0.02, "kredi_verebilir": i % 2 == 0, "skor": None} if self._initial.get("HUMAN_LONCA") else {})) for i in range(6)],      # F2: HUMAN_LONCA açıkken gerçek gözlemle aynı üç ek alan (sahte insanın işletmesi yok: skor None)
            "sehir": {"talep_karsilama": 0.5 + 0.4 * _unit(self._seed, "dao", w), "is_arayan": 10 + w % 3},
            "tercih": {"mevduat": dict(self._dao_pref) if self._dao_pref else None},
            "gecmis": {"dilim0": 2, "firmalar": []},
            "ilanlar": self._dao_ilanlar(w),
            "olaylar": [dict(e) for e in self._dao_ev],
        }

    def dao_karar(self, karar: dict[str, Any]) -> int:
        """Sahte DAO kararı: tür ve alan doğrulaması gerçek `human_submit` ile aynı kodları verir (karar_gecersiz, ayni_hafta); uygulama haftası `week + 1`."""
        if not self._initial.get("HUMAN_ON"):
            raise FakeKararHatasi("karar_gecersiz", ["human"])
        if not isinstance(karar, dict) or karar.get("tur") not in _DAO_TURLER:
            raise FakeKararHatasi("karar_gecersiz", ["tur"])
        tur = karar["tur"]
        gerekli = _DAO_ALANLAR[tur]
        fazla = sorted(set(karar) - {"tur", *gerekli})
        eksik = [a for a in gerekli if a not in karar]
        if fazla or eksik:
            raise FakeKararHatasi("karar_gecersiz", fazla or eksik)
        if tur in ("lonca_sec", "lonca_kur") and not self._initial.get("HUMAN_LONCA"):
            raise FakeKararHatasi("karar_gecersiz", ["tur"])                                          # gerçek human_submit gibi: bayrak kapalıyken karar yok
        if tur == "lonca_kur" and karar["yol"] not in _DAO_LONCA_KUR_YOLLARI:
            raise FakeKararHatasi("karar_gecersiz", ["yol"])
        if tur == "kadro":
            if not self._initial.get("HIRE_TARGET"):
                raise FakeKararHatasi("karar_gecersiz", [{"id": "tur", "reason": "bayrak_kapali"}])      # gerçek human_submit gibi: yalnız HIRE_TARGET açıkken (G17i)
            if not (self._initial.get("HIRE_CASH_GATE", 1) or self._initial.get("HIRE_GATE_ALL", 1)):
                raise FakeKararHatasi("karar_gecersiz", [{"id": "tur", "reason": "kasa_kapisi_kapali"}])      # gerçek human_submit gibi (varsayılan ikisi de 1)
            if not self._dao_sahip:
                raise FakeKararHatasi("karar_gecersiz", [{"id": "tur", "reason": "isletme_sahibi_degil"}])      # gerçek human_submit gibi: işletme sahibi olmayanın kararı kabul edilmez
            hd = karar["hedef"]
            if hd is not None and (not isinstance(hd, int) or isinstance(hd, bool) or not 1 <= hd <= _DAO_KAPASITE):
                raise FakeKararHatasi("karar_gecersiz", ["hedef"])                                    # sahte insanın işletmesi kapasite _DAO_KAPASITE
        ahirda = self._dao_durum(self.week) == "ahir"
        if tur in ("ayril", "basvur") and ahirda:
            raise FakeKararHatasi("karar_gecersiz", [{"id": "tur", "reason": "ahirda"}])        # ahırdan yalnız ahirdan_cik ile çıkılır
        if tur == "ahirdan_cik" and not ahirda:
            raise FakeKararHatasi("karar_gecersiz", [{"id": "tur", "reason": "ahirda_degil"}])
        if tur == "basvur":
            if karar["firma"] not in _DAO_ILAN_FIRMALARI:
                raise FakeKararHatasi("karar_gecersiz", ["firma"])
            if karar["firma"] == self._dao_ayrildi:
                raise FakeKararHatasi("karar_gecersiz", [{"id": "firma", "reason": "geri_alinmaz"}])
            if self._dao_is is not None and self._dao_durum(self.week) == "calisan" and karar["firma"] == self._dao_is[1]:
                raise FakeKararHatasi("karar_gecersiz", [{"id": "firma", "reason": "ayni_firma"}])          # çalışan insan kendi işverenine başvuramaz (başka ilana başvurabilir: iş değiştirme)
        hafta = self.week + 1
        if tur == "mevduat":
            self._dao_pref = {"lonca": karar["lonca"], "oran": float(karar["oran"])}
            return hafta
        if tur == "kadro":
            self._dao_kadro[hafta] = karar["hedef"]                  # gerçek: hedef bir sonraki hafta açılışında uygulanır
            return hafta
        if hafta in self._dao_tek:
            raise FakeKararHatasi("ayni_hafta", ["tur"])
        self._dao_tek[hafta] = dict(karar)
        return hafta

    def facts(self) -> dict[str, Any]:
        """Sahte işsizlik/NPC havuzu olguları (D5; gerçek `ModelHost.facts` ile aynı anahtarlar, belirlenimli); öteki `x_*` olguları yok."""
        w = self.week
        pool = 150 + w
        return {"x_npc_pool": pool, "x_npc_employed": 1000 - w, "x_npc_broke": pool // 10, "x_npc_pool_cash_avg": 12.5 + 0.1 * w,
                "x_players_seeking": 50 + w % 7, "x_players_in_ahir": 20, "x_players_students": 6, "x_benefit_paid": 1000.0 + w,
                "x_benefit_paid_npc": None, "x_muni_wages": 500.0 + w, "x_bursary_paid": 90.0, "x_benefit_cut": 0.0,
                "x_players_total": 1500 + 2 * w, "x_players_new": 2, "x_players_new_total": 2 * w, "x_ahir_capacity": 1500, "x_ahir_fill": 0.9 + 0.001 * w,
                "x_npc_firm_npc": 900 - w, "x_npc_firm_players": 40 + w, "x_hired_player": 3, "x_hired_npc": 5 + w % 3, "x_fired_player": w % 2, "x_fired_npc": 4,
                "x_ahir_moves": 3, "x_ahir_backfilled": 1, "x_inflow_blocked": 0,
                "x_staff_fill": 0.8 + 0.001 * w, "x_kinds_full": 3, "x_house_stock": 1955.0 + w, "x_opening_staff": 2663,
                "x_npc_dependents": 0, "x_npc_lfp": 1.0,
                "x_npc_discouraged": 0, "x_muni_npc": 0, "x_hires": 8 + w % 3, "x_separations": 4 + w % 2, "x_quits_npc": 0, "x_job_finding_rate": 0.04 + 0.001 * w,
                "x_money_households": 60000.0 - 100 * w, "x_money_npc_firms": 30000.0 + 50 * w, "x_money_player_firms": 8000.0, "x_money_city": 250000.0 + 500 * w,
                "x_money_lonca": 90000.0, "x_money_other": 9000.0,
                "x_city_in_tax": 30000.0 + w, "x_city_in_profit": 20000.0, "x_city_in_rent": 17000.0, "x_city_in_mint": 0.0, "x_city_in_other": 4000.0,
                "x_city_out_households": 33000.0, "x_city_out_wages": 2000.0, "x_city_out_services": 5000.0, "x_city_out_firms": 11000.0, "x_city_out_other": 100.0,
                "x_ghost_firms": 40 + w % 3, "x_ghost_closed": 0,
                "x_wealth_top10": 0.6 + 0.001 * w, "x_wealth_top1": 0.2 + 0.001 * w, "x_wealth_median": 120.0 + w, "x_income_gini": 0.4 + 0.001 * w, "x_income_top10": 0.3,
                # likit varlık dilimleri (T3) gerçekte satırın para_* / mev_* sütunlarından türer; sahte host sütunları olgu olarak verir (satıra birleşir)
                "para_yoksul": 1000.0 + w, "para_orta": 3000.0, "para_zengin": 5000.0, "mev_yoksul": 0.0, "mev_orta": 100.0, "mev_zengin": 900.0}

    def snapshot(self) -> dict[str, Any]:
        """Sahte şehir satırları ve zincir (gerçek `ModelHost.snapshot` ile aynı anahtarlar; deterministik)."""
        from .sim import holdings, labels
        w = self.week
        cities = []
        for i in range(5):
            u = _unit(self._seed, "city", i, w)
            cities.append({"index": i, "served": 0.5 + 0.4 * u, "employed": 100 + i * 10 + w, "unemployed": 10 + i, "cash": 1000.0 * (i + 1) + w, "cash_weeks": 2.0 + 0.5 * i + 0.01 * w,
                           "firms_npc": 20 + i, "firms_player": i, "firms_total": 20 + 2 * i, "rent_pct": 0.08 + 0.01 * u, "occupancy": 0.8 + 0.1 * u, "tenants_per_house": 1.0 + 0.1 * u,
                           "migration_in": i % 2, "migration_out": (i + 1) % 2,
                           "npc_pool": 30 + i, "npc_broke": i, "players_seeking": 10 + i,
                           "population": 500 + 10 * i + w, "players_in_ahir": 4 + i})
        sectors, nodes = [], []
        for k, (kind, prod) in enumerate(_FAKE_KINDS):
            u = _unit(self._seed, "sector", kind, w)
            sectors.append({"sector": kind, "product": prod, "firms": 5 + k, "healthy": 3 + k, "shortage": 0.1 * u,
                            "persist": 0.2 * u, "cover_days": 2.0 + k, "price_trend": 0.01 * u, "price": 1.0 + 0.1 * u})
            for i in range(5):
                nodes.append({"sector": kind, "city": i, "shortage": 0.1 * u, "price": 1.0 + 0.1 * u + 0.01 * i, "firms": 1 + k, "healthy": 1,
                              "demand": 100.0 + i, "output": 90.0 + i, "stock": 10.0 + k})
        prods = dict(_FAKE_KINDS)
        chain = {"board": True, "sectors": sectors, "nodes": nodes, "edges_rev": 0,
                 "scarce": [{"sector": s["sector"], "product": prods[s["sector"]], "persist": s["persist"], "shortage": s["shortage"],
                             "firms": s["firms"], "healthy": s["healthy"]} for s in sorted(sectors, key=lambda r: -r["persist"])]}
        pl = {g: {"n": 10 + k, "cash": 1000 * (k + 1) + w, "deposits": 100 * k} for k, g in enumerate(holdings.PLAYER_GROUPS)}
        npc = {g: [50 + k, 500 * (k + 1) + w] for k, g in enumerate(holdings.NPC_GROUPS)}
        hold = {"money": {"deposits_players": 900 + w, "deposits_insurance": 80, "found_fund": 5000, "insurance_reserve": 400, "lonca_cash_net": -150 + w,
                          "credit_out": 2000, "fund_credit_out": 300, "bonds_out": 40, "lonca_equity": 1200},
                "groups": {"player": pl, "npc": npc},
                "deposits": {"by_group": {**{g: e["deposits"] for g, e in pl.items()}, "insurance": 80}},
                "loncas": self.fake_loncas(),
                "firms": {"player_count": 12 + w % 3, "owners": 9, "multi_owners": 2, "cash_top10_share": round(0.3 + 0.01 * (w % 10), 4)},
                "wealth": {"b50": 0.05, "m40": 0.25, "t10": 0.7, "t1": round(0.2 + 0.001 * w, 6), "median": 150 + w, "gini": 0.62, "n": 1500},
                "flows": [["players", "npc_firms", 88000 + w], ["public_firms", "players", 51000], ["npc_firms", "players", 49000], ["city", "public_firms", 49000],
                          ["mint", "city", 1200], ["other", "other", 400]]}
        kurumlar = []
        for i in range(5):
            u = _unit(self._seed, "kurum", i, w)
            kurumlar.append({"sehir": i, "ithalat_hacim": round(2000.0 * (1 + u) + 10 * i + w, 4),
                             "ithalat_urunler": [{"urun": p, "pay": round(0.4 / (k + 1), 6)} for k, (_kind, p) in enumerate(_FAKE_KINDS)],
                             "ihracat_hacim": round(1500.0 * (1 + u) + 5 * i + w, 4)})
        return {"cities": cities, "chain": chain, "holdings": hold, "kurumlar": kurumlar, "ekonomi": self.fake_ekonomi(), "makro": self.fake_makro()}

    def fake_makro(self) -> dict[str, Any]:
        """Sahte M10 `makro` bloğu (gerçek `makro.build` ile aynı şekil, belirlenimli; ilk 13 haftada büyüme alanları null)."""
        w = self.week
        u = _unit(self._seed, "makro", 0, w)
        tuk = 1.0 + 0.003 * w
        ucret = 1.0 + 0.004 * w
        gercek = 300000 + 500 * w
        kredi = 40000 + 300 * w
        return {
            "v": 1,
            "fiyat": {"tuk": round(tuk, 3), "enf": None if w < 2 else round(0.04 + 0.02 * u, 4), "uretici": round(1.0 + 0.002 * w, 3), "ucret": round(ucret, 3), "gercek_ucret": round(ucret / tuk, 3)},
            "uretim": {"nominal": round(gercek * tuk), "gercek": gercek, "buyume": None if w <= 13 else round(0.02 + 0.01 * u, 4), "verimlilik": round(80.0 + 0.1 * w, 2)},
            "para": {"stok": 450000, "korunum": 0.0, "mali": 440000, "kredi_net": 0, "acilis": 10000, "hiz": round(0.4 - 0.001 * w, 4)},
            "faiz": {"politika": round(0.15 + 0.001 * w, 4), "mevduat": None if w < 8 else 0.08, "kredi": None if w < 8 else 0.2, "gercek": None if w < 2 else round(0.11 - 0.02 * u, 4)},
            "marj": {"npc": round(0.05 + 0.01 * u, 4), "oyuncu": round(0.02 + 0.01 * u, 4)},
            "konut": {"kira": round(1.0 + 0.004 * w, 3), "kira_gelir": round(0.1 + 0.0005 * w, 4)},
            "dagilim": {"gini_nakit": round(0.4 + 0.002 * w, 3), "gini_gelir": 0.14, "gini_servet": round(0.5 + 0.001 * w, 3), "yoksul": round(0.6 - 0.002 * w, 3), "medyan_sepet": 0.8},
            "kredi": {"stok": kredi, "buyume": None if w <= 13 else round(0.05 * u, 4), "temerrut": round(0.01 * u, 4)},
        }

    def fake_ekonomi(self) -> dict[str, Any]:
        """Sahte M10 `ekonomi` bloğu (gerçek `extract_ekonomi.build` ile aynı şekil, belirlenimli): 5 şehir, 3 sektör, 3 ürün."""
        w = self.week
        def hane(n: int, k: float, sepet: float) -> dict[str, Any]:
            return {"n": n, "karsilanma": round(k, 4), "sepet": round(sepet * 7, 2)}   # haftalık kişi başı (tek döngü ≈ sepet/7)
        sehir, isl = [], []
        for i in range(5):
            u = _unit(self._seed, "eko", i, w)
            sehir.append({"sehir": i, "ise": hane(900 + i * 10, 0.8 + 0.1 * u, 40 + 5 * u), "issiz": hane(60 + i, 0.5 + 0.2 * u, 20 + 4 * u),
                          "npc": {"ise": hane(3000 + i * 50, 0.7 + 0.1 * u, 30 + 3 * u), "issiz": hane(400 + i, 0.4 + 0.2 * u, 12 + u), "dis": hane(100 + i, 0.6, 25.0)},
                          "npc_issiz_parasiz": round(10 + 30 * u, 1), "harcama": {"oyuncu": 20000 + 100 * i + w, "npc": 80000 + 500 * i + w}})
            isl.append({"sehir": i, "ozel_calisan": 300 + 10 * i, "kamu_calisan": 40 + i, "calisan_oyuncu": 120 + i, "calisan_npc": 220 + 9 * i,
                        "isgucu_disi": 15 + i, "boy": [20 + i, 8, 3, 1], "hareket": {"kurulan": i % 2, "buyuyen": 2, "kuculen": 1, "batan": 0}})
        return {
            "v": 1,
            "tuketim": {
                "hane": {"ise": hane(4600, 0.82, 41.5), "issiz": hane(310, 0.55, 21.0),
                         "npc": {"ise": hane(15200, 0.74, 31.0), "issiz": hane(2010, 0.45, 12.5), "dis": hane(510, 0.6, 25.0)},
                         "npc_issiz_parasiz": 120.5, "sehir": sehir},
                "harcama": {"npc": 402500 + w, "oyuncu": 100500 + w, "toplam": 503000 + 2 * w},
                "urunler": [{"urun": p, "istek": 5000.0 - 100 * k, "karsilanmayan": 800.0 - 50 * k, "uretim": 4000.0, "stok": 120.0 + k} for k, (_kind, p) in enumerate(_FAKE_KINDS)],
                "ucret": {
                    "dunya": [round(1.0 + 0.004 * w, 3), round(1.0 + 0.003 * w, 3), round(63.0 * (1.0 + 0.004 * w), 1), round(1.5 + 0.002 * w, 2)],
                    "sehir": [[round(1.0 + (0.004 + 0.0005 * i) * w, 3), round(1.0 + (0.003 + 0.0004 * i) * w, 3),
                               round(63.0 * (1.0 + (0.004 + 0.0005 * i) * w), 1), round(1.4 + 0.05 * i + 0.002 * w, 2)] for i in range(5)],
                },
            },
            "isletme": {
                "istihdam": {"oyuncu": 610, "npc": 1150, "ozel": 1500, "kamu": 260},
                "hareket": {"kurulan": 2, "buyuyen": 9, "kuculen": 4, "batan": 1},
                "sektor": [{"tur": k, "calisan": 700 - 100 * j, "firma": 30 - 5 * j} for j, (k, _p) in enumerate(_FAKE_KINDS)],
                "sektor_diger": {"calisan": 0, "firma": 0},
                "sehir": isl,
            },
            "para": {"oyuncu_n": 1500, "oyuncu_ust10": 900000, "oyuncu_alt90": 300000, "npc_hane_nakit": 250000, "npc_hane_mevduat": 400000},
        }

    def fake_loncas(self) -> list[dict[str, Any]]:
        """Sahte lonca satırları (§4.2): 6 lonca; lonca1 sahipli, lonca5 kapalı, öbürleri sahipsiz. Kişi kimliği yok."""
        w = self.week
        return [{"ref": f"lonca{i}", "owner": "player" if i == 1 else ("closed" if i == 5 else "none"), "members": 10 + i, "fee": 0.05,
                 "capital": 6000 + 100 * i + w, "deposits": 900 + 10 * i, "credit_out": 100 * i + w, "equity": 5000 - 50 * i + w} for i in range(6)]

    def firm_rows(self) -> list[dict[str, Any]]:
        """Sahte firma düzeyi anlık görüntü (D2): 3 canlı firma + `fk3` 15. haftada ölür (`diedSource` model)."""
        rows = []
        for i, ref in enumerate(_FAKE_FIRMS + ("fk3",)):
            dead = ref == "fk3" and self.week >= 15
            rows.append({"id": ref, "kind": "un", "city": i % 5, "owner": "npc" if i % 3 == 0 else "player", "lonca": "lonca%d" % i if i % 2 == 0 else None,
                         "orgOwned": i % 3 == 2, "privatized": False, "born": None, "workers": 0 if dead else 8,
                         "cash": 500.0 + self.week + i, "cashWeeks": 4.0, "health": 0.9, "lossStreak": 0, "staffless": dead, "exiting": dead,
                         "dead": dead, "died": 15 if dead else None, "diedSource": "model" if dead else None,
                         **({"diedReason": "kredi_odenemedi"} if dead and self._initial.get("FIRM_LIFE_LOG") else {})})      # F4: ölü firmada firm_log ölüm kodu (gerçek host gibi, yalnız FIRM_LIFE_LOG açıkken)
        return rows

    def drawer(self, kind: str, ref: str) -> dict[str, Any]:
        """Sahte çekmece (yalnız okur): şehir 0-4, sektör ahir/un/firin, firma fk0-fk2, lonca lonca0-lonca5, urun sut/un/ekmek; ötesi `UnknownRef`."""
        from .sim import labels
        from .sim.drawers import UnknownRef
        snap = self.snapshot()
        if kind == "city" and ref.isdigit() and int(ref) < 5:
            row = snap["cities"][int(ref)]
            return {"kind": kind, "ref": ref, "title": ref, "fields": dict(row, players=300)}
        if kind == "sector" and any(ref == k for k, _p in _FAKE_KINDS):
            row = next(s for s in snap["chain"]["sectors"] if s["sector"] == ref)
            return {"kind": kind, "ref": ref, "title": labels.sector_label(ref),
                    "fields": dict(row, label=labels.sector_label(ref), workers=50, cities=[{k: n[k] for k in ("city", "firms", "price", "healthy", "demand", "output", "stock", "shortage")}
                                                           for n in snap["chain"]["nodes"] if n["sector"] == ref], inputs=[], users=[], firm_refs=[])}
        if kind == "firm" and ref in _FAKE_FIRMS:
            return {"kind": kind, "ref": ref, "title": labels.sector_label("un"),
                    "fields": {"kind": "un", "sector_label": labels.sector_label("un"), "city": 0, "lonca": "lonca0", "workers": 8, "capacity": 20,
                               "cash": 500.0 + self.week, "ownership": "npc", "privatized": False, "born": None, "age": None, "alive": True,
                               "died": None, "profit": 1.5, "debt": 0.0, "loan_rate": None, "health": 0.9, "cover_weeks": 3.0, "loss_streak": 0,
                               "staffless": False, "exiting": False, "stock_units": 12.0, "insolvent_weeks": 0,
                               "product": "un", "price": 1.25 + 0.01 * self.week, "wage_avg": 14.5, "sold_week": 40.0 + self.week,
                               "profit_hist": [round(1.5 + 0.1 * k, 2) for k in range(max(1, self.week - 11), self.week + 1)][-12:]}}
        if kind == "lonca" and re.fullmatch(r"lonca[0-5]", ref):
            row = next(r for r in self.fake_loncas() if r["ref"] == ref)
            return {"kind": kind, "ref": ref, "title": labels.lonca_label(ref),
                    "fields": {k: v for k, v in row.items() if k != "ref"}}
        if kind == "urun" and ref in {p for _k, p in _FAKE_KINDS}:
            w = self.week
            sehirler = [{"sehir": i, "talep": 20.0 + i, "uretim": 18.0 + i, "stok": 5.0 + i, "firma": 2 + i, "saglikli": 1 + i} for i in range(5)]
            return {"kind": kind, "ref": ref, "title": labels.sector_label(next(k for k, p in _FAKE_KINDS if p == ref)),
                    "fields": {"urun": ref, "istek": 110.0 + w, "karsilanmayan": 12.0, "uretim": sum(s["uretim"] for s in sehirler), "stok": sum(s["stok"] for s in sehirler),
                               "kapsama_hf": 0.8, "fiyat_endeksi": 1.05, "firma": sum(s["firma"] for s in sehirler), "saglikli": sum(s["saglikli"] for s in sehirler),
                               "sehirler": sehirler}}
        raise UnknownRef(ref)

    def patch(self, overrides: dict[str, Any]) -> int:
        """Çok ayarlı yama atomik: önce hepsi denetlenir, sonra hepsi yazılır."""
        if self._live_keys is not None:
            for k in overrides:
                if k not in self._live_keys:
                    raise ValueError("%s canlı yamalanamaz (yalnız yeni koşuda)" % k)
        for k in overrides:
            self.base_values.setdefault(k, self.effective.get(k))
        self.effective.update(overrides)
        return len(overrides)

    def revert_to(self, effective: dict[str, Any]) -> None:
        self.effective = dict(effective)

    def close(self) -> None:
        if self._csv_dir:
            shutil.rmtree(self._csv_dir, ignore_errors=True)


class InProcWorker:
    """WorkerClient ile aynı arayüz (send/events/alive/kill), süreç içi iş parçacığı; A7a testleri için.

    `sleep(step_delay)` her adımdan önce çağrılır: sahte saat/kapı enjekte edilebilir. Aynı oturum çekirdeği (sim.worker.Session).
    """

    def __init__(self, spec: dict | None = None, step_delay: float = 0.0,
                 sleep: Callable[[float], Any] = time.sleep,
                 host_factory: Callable[[dict], Any] | None = None):
        from .sim.worker import Session, make_host
        self.spec = spec or {}
        self.pid = -1
        self.bad_lines = 0
        self._cmds: "queue.Queue" = queue.Queue()
        self._out: "queue.Queue" = queue.Queue()
        self._done = threading.Event()
        self._closed = False
        self.eof = False

        def emit(ev: dict) -> None:
            self._out.put(ev)

        def before() -> None:
            if step_delay:
                sleep(step_delay)
            if self._closed:
                raise SystemExit

        sess = Session(self._cmds, emit, host_factory or make_host, before)

        def run() -> None:
            try:
                sess.run()
            except SystemExit:
                pass
            finally:
                self._done.set()
                self._out.put(None)

        self._t = threading.Thread(target=run, daemon=True)
        self._t.start()

    def send(self, cmd: dict) -> None:
        if self._closed or self._done.is_set():
            raise BrokenPipeError("işçi kapalı")
        self._cmds.put(cmd)

    def events(self, timeout: float) -> Iterator[dict]:
        while True:
            try:
                item = self._out.get(timeout=timeout)
            except queue.Empty:
                return
            if item is None:
                self._out.put(None)
                self.eof = True
                return
            yield item

    def alive(self) -> bool:
        return not self._done.is_set()

    def wait(self, timeout: float | None = None) -> int | None:
        return 0 if self._done.wait(timeout) else None

    def close_stdin(self) -> None:
        self._cmds.put(None)

    def stop(self, timeout: float = 5.0) -> None:
        self.close_stdin()
        self._done.wait(timeout)
        self.kill()

    def kill(self) -> None:
        self._closed = True
        self._cmds.put(None)
        self._t.join(2)
