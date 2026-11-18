"""ModelHost (A4): modeli süreç içinde adım adım çalıştırır (P-07 kalıbı), canlı yama uygular.

`measure_finish` çağrılmaz; `WEEKLY_CSV` yalnız bellek satırları (`W.wk_csv`) için geçici bir yola işaret eder, CSV yazılmaz.
Tek yan etki: akış kancası (`flowhook`, PLAN-TAKIP T4) açıkken model her hafta geçici dizine `w.csv.sx` / `.st` satırları yazar (<= 10 KB/hafta; `close()` dizini siler).
Halka (rewind) kodu yok: A1 kararı seam_mode="frontier" (decisions.json); A8b koşullu görevi atlanır.
"""
from __future__ import annotations

import functools
from collections import deque
import hashlib
import os
import shutil
import sys
import tempfile
import traceback
from contextlib import contextmanager
from typing import Any

from ..config import derived_diff_keys, load_live_keys
from . import credit, drawers, extract_chain, extract_cities, extract_ekonomi, extract_kurumlar, flowhook, holdings, housing_rec, labour, livepatch, makro, nufus, probes

_MISSING = object()


DEBUG_ENV = ("DBGF", "SDUMP", "KDUMP", "PFDUMP", "SCDUMP", "CDUMP", "SECDUMP", "BDUMP", "WEEKLY_CSV")


@contextmanager
def _scrubbed_env(**set_vars: str):
    """Hata ayıklama/ölçüm bayraklarını geçici çıkarır (isteğe bağlı değer atar), çıkışta çağıranın ortamını geri koyar."""
    saved = {k: os.environ.pop(k) for k in DEBUG_ENV if k in os.environ}
    os.environ.update(set_vars)
    try:
        yield
    finally:
        for k in DEBUG_ENV:
            os.environ.pop(k, None)
        os.environ.update(saved)


def _version(model_root: str, version: str) -> str:
    """"<params.VERSION>-<sha1[:8]>" (ör. v13.3-1a2b3c4d). Özet `simkit/*.py` dosyalarının hepsinden (ada göre sıralı, ad + içerik):
    modelde herhangi bir kod değişince sürüm değişir (yayımlanan dünyaların `eski_surum` denetimi buna dayanır)."""
    try:
        dosyalar = sorted(f for f in os.listdir(os.path.join(model_root, "simkit")) if f.endswith(".py"))
        h = hashlib.sha1()
        for f in dosyalar:
            with open(os.path.join(model_root, "simkit", f), "rb") as fh:
                data = fh.read()
            h.update(f.encode("utf-8") + b"\0" + hashlib.sha1(data).digest())
    except OSError:
        return "%s-?" % version
    if not dosyalar:
        return "%s-?" % version
    return "%s-%s" % (version, h.hexdigest()[:8])


@functools.lru_cache(maxsize=4)
def guncel_surum(model_root: str, version: str) -> str:
    """Sunucu açılışında bir kez hesaplanıp süreç boyunca önbellekte kalan sürüm dizesi (işçi gerekmez)."""
    return _version(model_root, version)


class ModelHost:
    def __init__(self, model_root: str, overrides: dict[str, Any], weeks: int = 200, n_cities: int = 5,
                 live_keys: Any = None, csv_dir: str | None = None, max_population: int | None = None,
                 flow_hook: bool = True, hafiza: bool = False):
        self.closed = False
        self._hafiza = bool(hafiza)                        # B3: yalnız tarayıcı kipi (`InProcClient`): her hafta adımından sonra modelin OKUNMAYAN geçmişi bırakılır (`_kirp`); sunucu kipinde False
        self._live_keys = frozenset(live_keys) if live_keys is not None else load_live_keys()
        self._initial = dict(overrides)
        self.weeks = weeks
        self.week = 0
        self._prev_cut = 0.0
        self._labor_prev: dict[str, float] = {}            # D5: akış kalemlerinin bir önceki birikimli toplamı
        self._facts_week = -1
        self._facts_cache: dict[str, Any] = {}
        self._snap_week = -1
        self._holdings_err_shown = False
        self._credit_err_shown = False
        self._housing_err_shown = False
        self._labour_err_shown = False
        self._labour_state: labour.LabourState | None = None   # PLAN-KREDI T4b: bir önceki haftanın iş piyasası durumu (yalnız host'ta; ilk hafta / atlanan hafta / yeni host'ta yeniden kurulur, farka dayalı alanlar null)
        self._labour_week = -1
        self._labour_cache: dict[str, Any] | None = None
        self._last_row: dict[str, Any] | None = None     # PLAN-KREDI: modelin son haftalık satırı (`credit.found`, `x_founders_*`); satırdan AYRI kopya
        self._credit_prev: dict[str, Any] | None = None  # PLAN-KREDI U3: kredi sayaçlarının bir önceki haftaki birikimli toplamı (ilk hafta / yeniden kurulan koşuda None; patch ve revert_to dokunmaz)
        self._flow_hook = flow_hook                      # PLAN-TAKIP T4: kesimden kesime akış kancası (test A/B karşılaştırması için kapatılabilir)
        self._flow_err_shown = False
        self._kurumlar_err_shown = False
        self._ekonomi_state: extract_ekonomi.EkonomiState | None = None   # M10: bir önceki haftanın ekonomi durumu (yalnız host'ta; yeni host / kayıt yükleme / hata sonrası None: hafta > 1 ise farka dayalı alanlar null, durum bu çağrıda dolar)
        self._ekonomi_err_shown = False
        self._makro_state: makro.MakroState | None = None      # M10: Makro göstergeler için önceki haftaların durumu (13 haftalık büyüme geçmişi, önceki temerrüt sayacı); yeni host / kayıt yükleme / hata sonrası None: hafta > 1 ise farka dayalı alanlar null
        self._makro_err_shown = False
        self._snap_cache: dict[str, Any] = {}
        self._city_of: dict[str, int] = {}
        self.effective: dict[str, Any] = dict(overrides)
        self.base_values: dict[str, Any] = {}
        # Dizini ebeveyn (WorkerClient) verir ve SIGKILL yollarında da o siler; verilmediyse (test/araç) kendimiz oluştururuz.
        self._csv_dir = csv_dir or tempfile.mkdtemp(prefix="oyun-host-")
        os.makedirs(self._csv_dir, exist_ok=True)
        try:
            if model_root not in sys.path:
                sys.path.insert(0, model_root)
            import simbuild
            with _scrubbed_env(WEEKLY_CSV=os.path.join(self._csv_dir, "w.csv")):   # yalnız bellek satırları için
                self._model = simbuild.build(simbuild.Params(**overrides))
        except BaseException:
            shutil.rmtree(self._csv_dir, ignore_errors=True)
            raise
        mods = self._model._modules
        self._mods = mods
        self._week_step = mods["simkit.step"].week_step
        with _scrubbed_env():
            self._W = self._model.new_world(weeks, n_cities, True)
            mods["simkit.engine"].start_world(self._W)
        self._P = mods["simkit.params"]
        if "PLAYER_MAX_TOTAL" in self._P.__dict__ and "PLAYER_MAX_TOTAL" not in overrides:
            # D6: toplam kişi sınırı koşu İÇİNDE de uygulanır (yeni oyuncu katılımı sınıra ulaşınca durur); kart değil, sunucu sabiti
            livepatch.apply_overrides(mods, self._W, {"PLAYER_MAX_TOTAL": int(nufus.MAX_POPULATION if max_population is None else max_population)})
        self._hook()
        self._city_of = extract_cities.city_map(self._W)           # göç farkı için hafta 0 durumu
        self._edge_key = extract_chain.edge_key(self._edges())     # tarif sürümü: başlangıç kümesi = `/info.world.chain` (sürüm 0)
        self._edges_rev = 0
        self._house_base: float | None = None
        self.model_version = _version(model_root, str(mods["simkit.params"].VERSION))

    def _check_open(self) -> None:
        if self.closed:
            raise RuntimeError("ModelHost kapatıldı")

    def step(self) -> dict[str, Any]:
        self._check_open()
        if self.week >= self.weeks:
            raise ValueError("model %d. haftada bitti" % self.weeks)
        self.week += 1
        self._hook_io_check()
        with _scrubbed_env():
            self._week_step(self._W, self.week, self.weeks)
        self._hook(take=True)
        row = dict(self._W.wk_csv[-1])
        self._last_row = dict(row)
        self._track_profit()
        if self._hafiza:
            self._kirp()
        return row

    def _kirp(self) -> None:
        """B3 (yalnız `hafiza`): hafta adımı bittikten sonra modelin oyun sırasında GERİ OKUMADIĞI geçmişi bırakır. Model çıktısı değişmez (kanıt: B3 raporu, alan alan okuma/yazma
        satırları; gate golden'ları ve 104 hf oyun paketleri SHA aynı). Yalnız bellek: Pyodide'de yığın geri verilmez, bu yüzden büyüyen geçmiş durdurulur.
        - `L.events` (Ledger.events): satırları yalnız o haftanın diliminde okunur (`week_open.py:149` `W.ev0 = len(L.events)`, `firm_log.py:213`, `week_metrics.py:258`); eski haftaları yalnız koşu sonu raporu okur (`report.py:183`), oyun onu çağırmaz.
          Liste boşalınca sonraki haftanın `W.ev0` 0 olur (aynı dilim).
        - `W.weekly[-1]["events"]`: aynı satırların dilim kopyası (`week_metrics.py:258`); `weekly` kayıtlarının öbür alanları (`series`...) okunmaya devam eder, yalnız `events` boşalır.
        - `W.wk_csv`: ölçüm satırı listesi; model yalnız eklenen son satırı okur (`measure.py:157`), tamamını `measure_finish` okur (çağrılmaz); host son satırı `step()`te kopyalar.
        - akış kancası dosyaları (`w.csv.sx` / `.st`): model her hafta sonuna ekler (`measure.py:90-108`), geri okumaz; Pyodide'de bellek dosya sistemi yığındadır. Hafta başına keser."""
        W = self._W
        L = W.L
        del L.events[:]
        if W.weekly:
            W.weekly[-1]["events"] = []
        del W.wk_csv[:-1]
        try:
            for ad in os.listdir(self._csv_dir):
                if ad.startswith("w.csv."):
                    with open(os.path.join(self._csv_dir, ad), "w"):
                        pass
        except OSError:
            pass                                          # dosya kesilemezse yalnız bellek tasarrufu kaybolur; koşu sürer

    PROFIT_HIST_WEEKS = 12

    def _track_profit(self) -> None:
        """Çekmece için işletme başına son 12 haftanın kârı (halka tampon; eskiden yeniye). Yalnız okur; ölü işletmenin geçmişi kalır, yeni değer eklenmez."""
        hist = self.__dict__.setdefault("_profit_hist", {})
        W = self._W
        for ref, d in W.firms.items():
            if d.get("dead"):
                continue
            q = hist.get(ref)
            if q is None:
                q = hist[ref] = deque(maxlen=self.PROFIT_HIST_WEEKS)
            q.append(probes.finite(drawers.firm_profit(W, ref, d)) or 0.0)

    def _hook_io_check(self) -> None:
        """Kanca açıkken modelin hafta sonu ölçümü `w.csv.sx` / `.st` geçici dosyalarına ekleme yazar (`measure.py:90-108`); bu IO adımın içinde olduğundan
        hata koşuyu düşürürdü. Her adımdan önce dizin yoksa yeniden oluşturulur ve dosyalar eklemeye açılabiliyor mu bakılır. Açılamıyorsa kanca bir kez
        not düşülerek kaldırılır (`L.sx`, `L.secfn` = None) ve o haftadan sonra akış bloğu yoktur; hafta kancasız koşar. Kalan risk: yazma sırasında disk dolması."""
        if not self._flow_hook:
            return
        try:
            os.makedirs(self._csv_dir, exist_ok=True)
            base = os.path.join(self._csv_dir, "w.csv")
            for ek in (".sx", ".st"):
                with open(base + ek, "a"):
                    pass
        except OSError as e:
            self._flow_hook = False
            L = getattr(self._W, "L", None)
            if L is not None:
                L.sx = None
                L.secfn = None
            if not self._flow_err_shown:
                self._flow_err_shown = True
                print("oyun_server: akış kancası kaldırıldı (geçici dizine yazılamadı: %s); koşu kancasız sürer" % e, file=sys.stderr)

    def _hook(self, take: bool = False) -> None:
        """Modelin teşhis kancasını (`L.sx` + `L.secfn`, `flowhook`) kurar / yeniler; `take` iken biten haftanın hücrelerini alır ve haritayı yeniler.
        Yardımcıdır: hata koşuyu düşürmez (ilk hatanın izi bir kez yazılır, akış bloğu o hafta yok)."""
        if not self._flow_hook:
            return
        W = self._W
        try:
            if take:
                flowhook.take(W)
                flowhook.rebuild(W)
            else:
                flowhook.install(W)                    # yeniden kurma güvenlidir: matris ve `last` korunur
        except Exception:                              # noqa: BLE001
            sx = getattr(getattr(W, "L", None), "sx", None)
            if hasattr(sx, "cells"):
                sx.cells = None                        # eski haftanın akışı yeni haftaya yapışmasın
            if not self._flow_err_shown:
                self._flow_err_shown = True
                traceback.print_exc(file=sys.stderr)

    def city_cash_weeks(self) -> list[float | None]:
        """Şehir başına kasa-hafta (`probes.city_cash_weeks`): kayıt üretim aracı ve şehir satırları aynı ölçüyü kullanır. Salt okur."""
        self._check_open()
        return probes.city_cash_weeks(self._W)

    def facts(self) -> dict[str, Any]:
        """Tanılar için model olguları (`extract.EXTRA_FIELDS` `x_*` sütunları); satırdan AYRI (host satırı model satırına eşit kalır),
        işçi satıra ekler. Modeli değiştirmez; bir hafta için tekrar çağrı aynı sonucu verir. Okunamayan olgu `None`."""
        if self._facts_week == self.week:
            return dict(self._facts_cache)
        W = self._W
        facts: dict[str, Any] = {"x_policy_rate": None, "x_policy_unemployment": None, "x_city_spend_cut": None}
        try:
            if getattr(W, "POL_ON", False):
                if W.pol[0] is not None:
                    facts["x_policy_rate"] = float(W.pol[0])
                if W.pol_hist and W.pol_hist[-1][0] == self.week:      # kuralın bu hafta gördüğü işsizlik
                    facts["x_policy_unemployment"] = float(W.pol_hist[-1][2])
            cut = float(sum(W.L.cut.values()))
            facts["x_city_spend_cut"] = max(0.0, cut - self._prev_cut)
            self._prev_cut = cut
        except (AttributeError, IndexError, TypeError, ValueError):
            pass
        facts.update(probes.world_facts(W, self._P))
        facts.update(probes.series_facts(W))                          # T3: servet ve gelir dilimleri (modelin `W.series`i)
        facts.update(probes.credit_facts(W, self._P, self._last_row))   # PLAN-KREDI U4: farklı kurucu sayıları (satırdan)
        facts.update(labour.world_facts(self._labour()))            # PLAN-KREDI T4b: iş piyasası kaydından beş dünya alanı
        facts.update(self._labor_flows())
        raw = facts.get("x_house_index")                              # konut endeksi: 1. haftanın ham değeri taban, yayımlanan = 100 x ham / taban (modelin rapor tanımı)
        if raw is not None:
            if self._house_base is None:
                self._house_base = raw
            facts["x_house_index"] = 100.0 * raw / self._house_base if self._house_base else None                  # S5: modelden doğrudan dünya alanları (`probes.FIELD_NOTES`)
        self._facts_week, self._facts_cache = self.week, dict(facts)
        return facts

    def _labour(self) -> dict[str, Any] | None:
        """PLAN-KREDI T4b: bu haftanın `labour` bloğu (ya da hata / blok yoksa None). Durum her hafta için BİR KEZ güncellenir (tembel: `facts()` ya da `snapshot()` hangisi önce çağırırsa);
        aynı hafta ikinci çağrı önbelleği döner. Hata koşuyu düşürmez: ilk hatanın izi bir kez yazılır, durum atılır (sonraki hafta yeniden kurulur, farka dayalı alanlar null)."""
        if self._labour_week == self.week:
            return self._labour_cache
        block = None
        try:
            block, self._labour_state = labour.build(self._W, self._P, self._labour_state, self._last_row)
        except Exception:                                          # noqa: BLE001
            self._labour_state = None
            if not self._labour_err_shown:
                self._labour_err_shown = True
                traceback.print_exc(file=sys.stderr)
        self._labour_week, self._labour_cache = self.week, block
        return block

    def _labor_flows(self) -> dict[str, Any]:
        """D5/D6/D10/D11: işsizlik, belediye, işe alım, iş piyasası, şehir gelir-gider ve hayalet işletme akışlarının haftalık değeri = birikimli toplamın bir önceki çağrıya göre farkı (`city_spend_cut` ile aynı desen)."""
        out: dict[str, Any] = {}
        for fn, names, tag in ((probes.labor_flow_totals, probes.LABOR_FLOWS, "L"), (probes.hire_flow_totals, probes.HIRE_FLOWS, "H"),
                               (probes.market_flow_totals, probes.MARKET_FLOWS, "M"),
                               (probes.city_flow_totals, probes.CITY_FLOWS, "C"), (probes.ghost_flow_totals, probes.GHOST_FLOWS, "G")):
            try:
                tot = fn(self._W, self._P)
            except (AttributeError, KeyError, TypeError, ValueError):
                out.update({"x_" + k: None for k in names})
                continue
            prev = self._labor_prev
            for k, v in tot.items():
                out["x_" + k] = None if v is None else max(0.0, v - prev.get(tag + k, 0.0))
                if v is not None:
                    prev[tag + k] = v
        fin, start = out.get("x_job_finders"), out.get("x_unemployed_start")          # D10: iş bulma oranı = işsizlikten işe girenler / hafta başı işsizler
        out["x_job_finding_rate"] = probes.finite(fin / start) if (fin is not None and start) else None
        named = [out.get("x_city_in_" + k) for k in ("tax", "profit", "rent")]            # D11: diğer gelir = haftalık toplam giriş - adlı kalemler
        try:
            week_in = probes.city_inflow_week(self._W)
        except (AttributeError, TypeError, ValueError):
            week_in = None
        out["x_city_in_other"] = None if (week_in is None or any(v is None for v in named)) else max(0.0, week_in - sum(named))
        return out

    def _edges(self) -> list[dict[str, Any]]:
        return extract_chain.chain_edges(self._W.RECIPES, list(self._W.TOPO), self._P.PRODUCER)

    def snapshot(self) -> dict[str, Any]:
        """Şehir satırları, zincir, kim-ne-tutuyor, kredi, konut ve iş piyasası kaydı anlık görüntüsü (S5, PLAN-TAKIP, PLAN-KREDI): `{cities, chain, holdings, credit, housing, labour}`.
        `holdings` / `credit` / `housing` / `labour` hata verirse yok (ilk hatanın izi bir kez yazılır). Satırdan AYRI, `W`'yi değiştirmez; göç farkı için
        bir önceki haftanın kişi-şehir eşlemesini tutar (hafta başına bir kez hesaplanır, tekrar çağrı aynı sonucu verir)."""
        self._check_open()
        if self._snap_week == self.week:
            return dict(self._snap_cache)
        cur = extract_cities.city_map(self._W)
        chain = extract_chain.chain_snapshot(self._W, self._P)
        edges = self._edges()
        key = extract_chain.edge_key(edges)
        chain["edges_rev"] = self._edges_rev + (key != self._edge_key)
        if key != self._edge_key:                                  # tarif değişti: yeni sürüm ve tam liste bu haftanın paketinde
            chain["edges"] = extract_chain.edge_rows(edges)
        snap = {"cities": extract_cities.city_rows(self._W, self._P, self._city_of), "chain": chain}
        try:                                                       # Görev 12b: şehir kurumları (Liman/İhracat); yardımcıdır, hata koşuyu ve öbür blokları düşürmez
            snap["kurumlar"] = extract_kurumlar.kurum_satirlari(self._W)
        except Exception:                                          # noqa: BLE001
            if not self._kurumlar_err_shown:
                self._kurumlar_err_shown = True
                traceback.print_exc(file=sys.stderr)
        try:                                                       # M10: Ekonomi paneli (tüketim, işletmeler ve iş gücü, para); yardımcıdır, hata koşuyu ve öbür blokları düşürmez
            snap["ekonomi"], self._ekonomi_state = extract_ekonomi.build(self._W, self._P, self._last_row, self._ekonomi_state)
        except Exception:                                          # noqa: BLE001
            self._ekonomi_state = None
            if not self._ekonomi_err_shown:
                self._ekonomi_err_shown = True
                traceback.print_exc(file=sys.stderr)
        try:                                                       # M10: Makro göstergeler (ekonomi bloğundan ayrı, kendi bayt bütçesi); yardımcıdır, hata koşuyu ve öbür blokları düşürmez
            snap["makro"], self._makro_state = makro.build(self._W, self._P, self._makro_state)
        except Exception:                                          # noqa: BLE001
            self._makro_state = None
            if not self._makro_err_shown:
                self._makro_err_shown = True
                traceback.print_exc(file=sys.stderr)
        try:                                                       # PLAN-TAKIP: kim ne tutuyor; yardımcıdır, hata koşuyu ve şehir/zincir bloklarını düşürmez
            snap["holdings"] = holdings.build(self._W, self._P)
        except Exception:                                          # noqa: BLE001
            if not self._holdings_err_shown:                       # kalıcı hata her hafta iz basmaz: yalnız ilki
                self._holdings_err_shown = True
                traceback.print_exc(file=sys.stderr)
        try:                                                       # PLAN-KREDI S1: kredi kaydı (arayüzde gösterilmez); yardımcıdır, hata koşuyu ve öbür blokları düşürmez
            tot = credit.totals(self._W, self._P)
            snap["credit"] = credit.build(self._W, self._P, self._last_row, self._credit_prev, tot)
            self._credit_prev = {**{k: v for k, v in (self._credit_prev or {}).items() if k.startswith(housing_rec.PREFIX)}, **tot}   # yalnız başarıda (hata sonrası hafta atlanır, sonraki haftalık alanlar null: ardışıklık denetimi); `housing.` önekli farklar korunur (T4)
        except Exception:                                          # noqa: BLE001
            if not self._credit_err_shown:
                self._credit_err_shown = True
                traceback.print_exc(file=sys.stderr)
        try:                                                       # PLAN-KREDI T4, S2d: konut kaydı (arayüzde gösterilmez); farklar `_credit_prev`te `housing.` önekiyle
            htot = housing_rec.totals(self._W, self._P)
            snap["housing"] = housing_rec.build(self._W, self._P, self._credit_prev, htot)
            self._credit_prev = {**(self._credit_prev or {}), **htot}
        except Exception:                                          # noqa: BLE001
            if not self._housing_err_shown:
                self._housing_err_shown = True
                traceback.print_exc(file=sys.stderr)
        lab = self._labour()                                       # PLAN-KREDI T4b: iş piyasası kaydı (arayüzde gösterilmez); yardımcıdır, hata öbür blokları düşürmez
        if lab is not None:
            snap["labour"] = lab
        self._edges_rev, self._edge_key = chain["edges_rev"], key
        self._city_of, self._snap_week, self._snap_cache = cur, self.week, dict(snap)
        return snap

    def dao_gozlem(self) -> dict[str, Any] | None:
        """DAO oyunu (T6a): oyuncunun gözlem paketi (`simkit.human.gozlem`); yalnız okur, `W`'yi ve rastgelelik durumunu değiştirmez. `HUMAN_ON` kapalıysa None (Kurucu)."""
        self._check_open()
        return self._mods["simkit.human"].gozlem(self._W)

    def dao_karar(self, karar: dict[str, Any]) -> int:
        """DAO oyunu (T6a): oyuncunun kararını sıraya koyar (`human_submit`); uygulanacağı haftayı döner (`self.week + 1`: bu host'un son hesapladığı hafta + 1).
        Geçersiz karar `simkit.human.KararHatasi` (ValueError alt sınıfı; `str(e)` = hata kodu, `fields` = nedenler) fırlatır; geçer."""
        self._check_open()
        return self._mods["simkit.human"].human_submit(self._W, karar, self.week)

    def firm_rows(self) -> list[dict[str, Any]]:
        """Firma düzeyi anlık görüntü (D1/D2): `W.firms` + sektör panosunun firma sağlığı (`W.board["fh"]`) + `L.bal`. Salt okur.
        `cashWeeks`/`health`/`lossStreak` panoyla aynı ölçü (pano kapalıysa None). `died`: modelde varsa o hafta (`diedSource: "model"`),
        yoksa ilk ölü görüldüğü anlık görüntü haftası (`"first_seen_snapshot"`); canlıda `died` None."""
        self._check_open()
        W = self._W
        fh = W.board["fh"] if extract_chain.board_on(W, self._P) else {}
        seen = self.__dict__.setdefault("_dead_seen", {})
        olum_satiri = self._mods["simkit.firm_log"].olum_satiri if getattr(self._P, "FIRM_LIFE_LOG", 0) else None      # F4: ölüm kodu yalnız firma yaşam kaydı açıkken (DAO kipi); salt okur (kayıt yoksa kurmaz)
        out = []
        for ref, d in W.firms.items():
            dead = bool(d.get("dead"))
            died, src = d.get("died"), "model"
            if dead and died is None:
                died, src = seen.setdefault(ref, self.week), "first_seen_snapshot"
            if not dead:
                died, src = None, None
            r = fh.get(ref)
            out.append({
                "id": ref, "kind": d["kind"], "city": d["city"], "owner": drawers._ownership(d), "privatized": bool(d.get("priv")),
                "lonca": d.get("lonca"), "orgOwned": bool(d.get("org_owner")),             # T10 harita: lonca bağı; DAO/lonca sahipliği (oyuncu kişisi değil)
                "born": d.get("born"), "workers": len(d["workers"]), "cash": probes.finite(W.L.bal.get(ref, 0.0)),
                "cashWeeks": probes.finite(r["cover_w"]) if r else None, "health": probes.finite(r["h"]) if r else None,
                "lossStreak": r["streak"] if r else None, "staffless": not d["workers"], "exiting": r["exiting"] if r else None,
                "dead": dead, "died": died, "diedSource": src,
            })
            if olum_satiri is not None and dead:
                y = olum_satiri(W, ref)
                out[-1]["diedReason"] = y["neden"] if y is not None else "diger"
        return out

    def drawer(self, kind: str, ref: str) -> dict[str, Any]:
        """Çekmece (S5): o anki (en son hesaplanan) dünyadan salt okuma; adım atmaz, `W`'yi değiştirmez. Bilinmeyen `ref`: `drawers.UnknownRef`."""
        self._check_open()
        rows = self._snap_cache.get("cities") if self._snap_week == self.week else None
        hist = self.__dict__.get("_profit_hist", {}).get(ref) if kind == "firm" else None
        return drawers.build(self._W, self._P, kind, ref, city_rows=rows, profit_hist=list(hist) if hist else None)

    def patch(self, overrides: dict[str, Any]) -> int:
        self._check_open()
        params = self._mods[livepatch.PARAMS_MODULE]
        try:
            derived = derived_diff_keys()
        except RuntimeError as e:                  # kapı okunamıyor: kapalı başarısızlık, tüm canlı yamalar reddedilir
            raise ValueError("canlı yama kapalı: %s" % e) from e
        for key in overrides:                      # önce denetle: hata durumunda hiçbir şey değişmez
            if key not in params.__dict__:
                raise KeyError(key)
            if key not in self._live_keys or key in derived:      # ikinci kapı: türetim farkı kayıttan bağımsız
                raise ValueError("%s canlı yamalanamaz (yalnız yeni koşuda)" % key)
        overrides = {k: livepatch.coerce_like(params.__dict__[k], v) for k, v in overrides.items()}
        if overrides.get("TRANS_SUPPORT") and getattr(getattr(self._W, "L", None), "cexp", True) is None:
            # bağlam kapısı: kuruluşta kasa tabanı yapısı (`L.cexp`) kurulmadıysa (destek, kuruluş fonu ve şehir kasası kuralı kapalı başladı)
            # destek koşu ortasında açılırsa taban hiç işlemez (yarı uygulama); simkit değişmediği için yama reddedilir.
            raise ValueError("TRANS_SUPPORT canlı açılamaz: koşu destek, kuruluş fonu ve şehir kasası kuralı kapalı başladı")
        for key in overrides:
            self.base_values.setdefault(key, params.__dict__[key])
        n = livepatch.apply_overrides(self._mods, self._W, overrides)
        self.effective.update(overrides)
        self._hook()
        return n

    def revert_to(self, effective: dict[str, Any]) -> None:
        """Önce taban değerler, sonra başlangıç override'ları + `effective` yazılır; `self.effective` model durumuyla aynıdır."""
        self._check_open()
        merged = {**self._initial, **effective}
        for key in effective:
            if key not in self._live_keys and key not in self._initial:
                raise ValueError("%s canlı yamalanamaz" % key)
        if self.base_values:
            livepatch.apply_overrides(self._mods, self._W, self.base_values)
        if merged:
            livepatch.apply_overrides(self._mods, self._W, merged)
        self.effective = merged
        self._hook()

    def close(self) -> None:
        self.closed = True
        self._model = self._W = self._mods = self._week_step = None
        shutil.rmtree(self._csv_dir, ignore_errors=True)
