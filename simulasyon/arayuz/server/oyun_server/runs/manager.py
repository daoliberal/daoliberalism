"""RunManager (A7a): koşu kaydı, pacer, olay günlüğü ve komutlar. HTTP yok; yalnız stdlib.

Eşzamanlılık (inceleme Ö4): tek `RLock`; yalnız `pump` (pacer iş parçacığı ya da testte elle) işçi olaylarını işler
(`_drain`). İşçiye gönderim ve hafta yayımı `_tick` ile yapılır; `_tick`'i `pump` ve (aynı kilit altında, anında etki
için) `control` çağırır. HTTP iş parçacıkları (`control`, `subscribe`, `apply_change`, ...) kilit altında
kısa işler yapar, uzun beklemeyi (`apply_change` onayı) kilit DIŞINDA `Event` ile bekler. `computing=true` yalnız bir
değişikliğin işçi onayı beklenirken. Değişiklik önce kuyruğa (`run.pending`) girer, `pump` işçiye gönderir; zaman aşımında
henüz gönderilmemişse kuyruktan çekilir ve `busy` döner (işçiye `patch` hiç gitmez).

DAO oyunu (T6a): `config.mode == "dao"` koşusu Kurucu'dan üç yerde ayrılır. (1) Önden hesap yok: işçiden yalnız `released + 1` haftası istenir (lookahead 0), böylece
oyuncunun kararı gösterilen haftanın ertesinde uygulanır. (2) `pause`, hesaplanmakta ya da tamponda bekleyen haftayı bir kez yayımlar (`run.flush_one`), sonra durur:
duraklatılmış DAO koşusunda `worker_week == released`. (3) Her hafta paketi `dao` gözlemini taşır; son hafta `kosu.json`a `daoSonuc` olarak yazılır ve `on_dao_end` kancası
(kilit dışında, `_do_reap` kuyruğu) çağrılır. `dao_karar` kararı işçiye `karar` komutuyla iletir (çekmece kalıbı: kilit dışında zaman aşımlı bekleme).
T6b: `olay` eylemi (yalnız DAO) 16x oynatır, yayımlanan paketin `dao.olaylar`ı doluyken ya da süre bitince duraklatır (işçi haftası yayımlananla eşit kalır). Kabul edilen
kararlar işçi onayı sırasıyla `kararlar.jsonl`ye yazılır (`_karar_kaydet`); `dao_gozlem` yayımlanan son gözlemi verir.

Hız (Ö7): `cfg.LIVE_WEEK_MS` tablosu; `buffering` histerezisli (bekleme > 1,5 x aralık ya da 16x'te > 1 sn açar, art arda
2 zamanında yayım kapatır); `state` olayı (önemsiz değişiklikler için) en çok 2/sn.

S2: koşu tarifi (`recipe.py`): `create(config, schedule, fast_forward_to)` takvim yamalarını işçide uygular (sürüm
numaraları ve sürüm olayları baştan bilinir, önden hesap yok); `fast_forward_to` varsa koşu pacer'sız `preparing` ile o haftaya
hesaplanır, haftalar tek seferde yayımlanır, sonra `paused` (aynı anda en çok bir hazırlık: `BusyPreparing`). `branch` =
ebeveyn tarifinin `week`'e kadarki kısmı + yama `week`'te. `MAX_RUNS` doluysa abonesiz en eski koşu çıkar, yoksa `TooManyRuns`.
"""
from __future__ import annotations

import copy
import json
import os
import queue
import statistics
import sys
import threading
import time
import traceback
import uuid
from collections import deque
from typing import Any, Callable

from .. import __version__, config
from ..registry.loader import Registry
from ..registry.resolve import DEFAULT_DURATION, resolve, run_editable, run_overrides
from ..registry.schema import FieldError, RunConfigError
from ..sim import diagnostics, drawers, nufus, plan as plan_mod
from ..sim.extract import harita_fark_of, harita_of, harita_taban_of, make_packet
from . import recipe
from .disk import DiskStore, iso

CLOSED = "__closed__"
DURATION = DEFAULT_DURATION      # varsayılan süre; koşu başına gerçek süre `run.duration` (100/200/500/520)
MODES = ("kurucu", "dao")        # `config.mode`; yoksa "kurucu"
DAO_DURATION = 520               # DAO oyununun süresi (K-231): `durationWeeks` verilmediyse
DAO_KARAR_WAIT_S = 20.0          # karar yanıtı için işçiyi bekleme üst sınırı (işçi adım arasında yanıtlar)
ACTIONS = ("play", "pause", "step", "olay")     # `olay` (T6b): yalnız DAO; 16x, yayımlanan pakette olay çıkana ya da süre bitene dek
SPEEDS = (1, 4, 16)
LIVE_APPLY = config.LIVE_APPLY       # koşu ortasında yamalanabilir `apply` sınıfları
STATE_MIN_GAP = 0.5            # önemsiz state olayları arası en az süre (<= 2/sn)
PUMP_PERIOD = 0.02
DRAWER_WAIT_S = 20.0           # çekmece yanıtı için işçiyi bekleme üst sınırı (işçi adım arasında okur; sonra paket görünümü)
ERR_CRASH = "hata.model_coktu"
MAX_NAME_LEN = 64
MAX_CITY_NAME_LEN = 64               # şehir adı sınırı: koşu adıyla aynı tek değer (web `lib/sinirlar.ts` ile aynı 64)
MAX_NOTE_LEN = 500                   # Şartı değiştir notu üst sınırı (web `lib/sinirlar.ts` MAX_NOT_UZUNLUK ile aynı tek değer)
MAX_CITIES = 5
REAP_GRACE_S = 2.0             # kapanış/çöküş: stdin EOF sonrası işçiye tanınan toplam süre (sonra kill)
_ENDED = {"accepted": False, "fields": [{"id": "*", "reason": "ended"}]}
_BUSY = {"accepted": False, "fields": [{"id": "*", "reason": "busy"}]}


# Bağlam kilidi (son inceleme I2): kuruluşta bayrağa bağlı yapı. Model, kasa tabanı (`L.cexp` / `mand`) yapısını yalnız kuruluşta
# `TRANS_SUPPORT or FOUND_FUND or TREASURY_RULE` doğruysa kurar; üçü de kapalı başlayan koşuda `TRANS_SUPPORT`'u koşu ortasında
# açmak yarı uygulanır (destek var, taban yok). Bu parametreler o bağlamda koşu ortasında değiştirilemez (simkit değişmez).
CONTEXT_LOCKS = {"TRANS_SUPPORT": ("TRANS_SUPPORT", "FOUND_FUND", "TREASURY_RULE")}
CONTEXT_LOCK_REASON = "no_cash_floor"


def context_locks(registry: Any, overrides: dict) -> frozenset:
    """Koşunun KURULUŞ değerlerinden (geçersiz kılma yoksa model varsayılanı) canlı yamaya kapalı model parametreleri."""
    defaults = getattr(registry, "defaults", None) or {}

    def eff(p: str) -> Any:
        return overrides[p] if p in overrides else defaults.get(p, 0)

    return frozenset(p for p, deps in CONTEXT_LOCKS.items() if not any(eff(d) for d in deps))


def context_lock_cards(registry: Any, locks: frozenset) -> list:
    """Bağlam kilidi altındaki düzenlenebilir kartlar (kayıt sırasıyla)."""
    return [s for s in registry.settings if run_editable(s) and any(p in locks for p in s.params)]


def is_live_changeable(card: Any, live_keys: Any) -> bool:
    """Koşu ortasında değiştirilebilir mi: `apply` sınıfı live/live_sync VE tüm parametreler canlı anahtar kümesinde.
    Yönetici kapısı, `/info?run=` ve `/availability` (koşu bağlamı) aynı yüklemi kullanır."""
    return card.apply in LIVE_APPLY and all(p in live_keys for p in card.params)


def change_block_reason(card: Any, live_keys: Any, locks: Any = frozenset()) -> str | None:
    """Koşu ortası yama için kartın engel nedeni (yoksa None): pasif `passive`, doğrulanmamış `unverified`,
    canlı olmayan ya da koşu bağlamı kilidi (`locks`: `context_locks`) altındaki `start_only`.
    Düzenlenemez/bilinmeyen kimlik çağıranda `locked` olur."""
    if card.status == "passive" or card.apply == "passive":
        return "passive"
    if card.apply == "unknown":
        return "unverified"
    if not is_live_changeable(card, live_keys) or any(p in locks for p in card.params):
        return "start_only"
    return None


def _nedenli_alan(x: Any) -> bool:
    """Karar reddinin nedenli alan öğesi: `{id: str, reason: str}`."""
    return isinstance(x, dict) and isinstance(x.get("id"), str) and isinstance(x.get("reason"), str)


class UnknownRun(KeyError):
    """Bilinmeyen koşu kimliği (A7b 404'e çevirir)."""


class BusyPreparing(Exception):
    """Başka bir koşu hazırlanıyor (hızlı ileri sarma); aynı anda en çok bir hazırlık (409 `busy_preparing`)."""


class TooManyRuns(Exception):
    """`MAX_RUNS` dolu ve çıkarılabilir (abonesiz) koşu yok (429 `too_many_runs`)."""


class NotDao(Exception):
    """Koşu bir DAO oyunu değil (6b: 409 `dao_degil`)."""


class DaoFinished(Exception):
    """Karar için koşu artık yok: bitti, çöktü ya da silindi (6b: 409 `kosu_bitti`)."""


class DaoTimeout(Exception):
    """İşçi karara zamanında yanıt vermedi; karar sonradan uygulanmış olabilir (6b: 504 `karar_belirsiz`)."""


class DaoCrashed(Exception):
    """DAO koşusunun işçisi çöktü (`failed`) ve yayımlanmış gözlem yok: `hazirlaniyor` değil, kalıcı hata (409 `kosu_cokmus`)."""


class DaoPreparing(Exception):
    """DAO koşusunun ilk paketi henüz yok ya da hızlı ileri sarma sürüyor (6b: 409 `hazirlaniyor`)."""


class Subscription:
    """`next(timeout)`: `(olay, veri)`, zaman aşımında `None`, akış bitince `("__closed__", {})`."""

    def __init__(self, manager: "RunManager", run_id: str):
        self._m, self.run_id = manager, run_id
        self._q: "queue.Queue" = queue.Queue()
        self._closed = False

    def _put(self, ev: str, data: dict) -> None:
        self._q.put((ev, data))

    def _finish(self) -> None:
        self._q.put(None)

    def next(self, timeout: float):
        if self._closed:
            return (CLOSED, {})
        try:
            item = self._q.get(timeout=timeout)
        except queue.Empty:
            return None
        if item is None:
            self._closed = True
            return (CLOSED, {})
        return item

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._m._unsubscribe(self)


class _Pending:
    def __init__(self, overrides: dict, ui_patch: dict, version: int, note: str | None = None):
        self.overrides, self.ui_patch, self.version, self.note = overrides, ui_patch, version, note
        self.sent = False
        self.sent_at = 0.0
        self.done = threading.Event()
        self.result: dict | None = None


class _DrawerReq:
    """Bekleyen çekmece isteği: işçi yanıtı gelince `result` (`{"week", "data"}` ya da `{"error"}`) yazılıp `done` kurulur."""

    def __init__(self):
        self.done = threading.Event()
        self.result: dict | None = None


class DrawerNotFound(KeyError):
    """Çekmece kaydı yok (A7b 404 `not_found`)."""


class _Run:
    def __init__(self, run_id: str, cfg_run: dict, overrides: dict, values: dict, worker: Any):
        self.id = run_id
        self.duration = cfg_run.get("duration", DURATION)
        self.world_id = cfg_run.get("worldScenarioId")
        self.world_values = cfg_run.get("worldScenarioValues")      # kullanıcının dünya (V kartı) değerleri; `values`'a karışmaz
        self.goals = cfg_run.get("goals")
        self.name = cfg_run["name"]
        self.city_names = cfg_run["cityNames"]
        self.seed_index = cfg_run["seedIndex"]
        self.scenario_id = cfg_run["templateId"]
        self.overrides = overrides
        self.later_overrides: list[dict] = []      # son inceleme I1: kuruluştan sonra kabul edilen yamaların (takvim ve canlı) model değerleri; "yeni ölçüm" işareti bunları da sayar
        self.values = values
        self.worker = worker
        self.status = "paused"
        self.speed = 1
        self.version = 1                 # RunState.version: son YAYIMLANAN paketin sürümü (ReplaySource gibi)
        self.accepted_version = 1        # kabul edilmiş son sürüm (yama numaralama)
        self.version_sets: dict[int, dict] = {1: dict(values)}
        self.version_from: dict[int, int] = {1: 0}      # sürüm -> dikiş haftası (RunState.versions.fromWeek)
        self.version_notes: dict[int, str] = {}         # sürüm -> oyuncunun Şartı değiştir notu (yalnız varsa)
        self.locks: frozenset = frozenset()             # kuruluş bağlamından canlı yamaya kapalı model parametreleri (`context_locks`)
        self.ready = False
        self.dao0 = None                                            # DAO: hafta 0 gözlemi (harita0 gibi yalnız bellekte; ilk haftalık paketten önce üst metrikleri doldurur)
        self.harita0 = None                                         # DAO: hafta 0 harita anlık görüntüsü (yalnız bellekte; durum yükünde yalnız varken)
        self.owed_since: float | None = None
        self.error: dict | None = None
        self.model_version: str | None = None
        self.released = 0
        self.packets: list[dict] = []
        self.buf: dict[int, dict] = {}
        self.arrival: dict[int, float] = {}
        self.worker_week = 0
        self.target = 0
        self.credit = 0
        self.last_release = 0.0
        self.streak = 0
        self.buffering = False
        self.computing = False
        self.pending: _Pending | None = None
        self.subs: list[Subscription] = []
        self.idle_deadline: float | None = None
        self.last_state_t = -1e9
        self.dirty = False
        self.step_times: deque = deque(maxlen=16)
        self.step_start: float | None = None
        self.vevents_due: list[tuple[int, dict]] = []
        self.vevents: list[dict] = []
        self.raw_config: dict = {}                 # tarifin config'i (dallanma/yeniden kurma için; değişmez)
        self.schedule: list[dict] = []             # tarif takvimi `[{week, patch}]`: kurulum + kabul edilen canlı değişiklikler
        self.sched_total = 0                       # işçide uygulanacak ön yüklü (week > 0) yama sayısı
        self.sched_applied = 0
        self.prep: dict | None = None              # hızlı ileri sarma: {"total": N}; ilerleme `worker_week`'ten
        self.parent_id: str | None = None
        self.fork_week: int | None = None
        self.drawer_seq = 0                        # çekmece istek kimliği sayacı (S5)
        self.drawer_reqs: dict[int, _DrawerReq] = {}
        self.disk: Any = None                      # D1: koşu klasörü (`disk.RunDir`) ya da None (kapalı/açılamadı)
        self.disk_final = False                    # kosu.json bitiş nedeniyle yazıldı (bir kez)
        self.started_wall = 0.0
        self.ended_wall: float | None = None
        self.mode = cfg_run.get("mode", "kurucu")  # "kurucu" | "dao" (kuruluşta belirlenir, değişmez)
        self.dunya_kodu: str | None = None         # T8: koşu yayımlanmış bir dünyadan kurulduysa kodu (durumda `dunyaKodu`)
        self.oyuncu: str | None = None             # T8: koşuyu kuran oyuncunun anonim kimliği; yalnız sunucuda (durumda, diskte, SSE'de yok)
        self.flush_one = False                     # DAO: duraklatılınca hesaplanmakta/tamponda bekleyen haftayı bir kez yayımla
        self.dao_sonuc: dict | None = None         # DAO: son yayımlanan paketin `dao` alanı (koşu bitince)
        self.karar_seq = 0                         # karar istek kimliği sayacı
        self.karar_reqs: dict[int, _DrawerReq] = {}
        self.karar_info: dict[int, tuple[dict, dict]] = {}   # karar istek kimliği -> (karar, verildiği andaki durum); işçi onaylayınca `kararlar.jsonl`ye yazılır (zaman aşımından sonra da)
        self.karar_sira = 0                        # kabul edilen kararların sıra sayacı (0'dan)
        self.olay = False                          # DAO `olay` eylemi: yayımlanan pakette olay çıkana dek oynat
        self.firm_buf: dict[int, list] = {}        # D2: işçiden gelen, henüz yayımlanmamış haftaların firma anlık görüntüleri
        self.last_firms: tuple[int, list] | None = None
        self.harita_taban: dict | None = None      # Kurucu: `haritaFark`ın göreli olduğu son tam `harita` haftasının çözülmüş satırları (yalnız bellekte; diske ve durum yüküne girmez)


class RunManager:
    def __init__(self, registry: Registry, worker_factory: Callable[[dict], Any],
                 clock: Callable[[], float] = time.monotonic, cfg: Any = config, runs_dir: Any = None,
                 on_dao_end: Callable[[str, dict | None, dict], None] | None = None):
        self.registry, self.factory, self._clock, self.cfg = registry, worker_factory, clock, cfg
        self._on_dao_end = on_dao_end                  # DAO koşusu süresini doldurunca (run_id, dao_sonuc, run_meta); kilit dışında, `_do_reap` kuyruğuyla
        self._dao_end: list[tuple[str, dict | None, dict]] = []
        self._disk = DiskStore(runs_dir)               # D1: koşular diske yazılır (`runs_dir` None ise yazılmaz)
        self.defaults_hash: str | None = None          # kosu.json parmak izi (create_app doldurur)
        self.wall: Callable[[], float] = time.time
        self._lock = threading.RLock()
        self._runs: dict[str, _Run] = {}
        self._reap: list[tuple[Any, float, bool]] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # Karar dosyası bir kez okunur (her tick'te değil): sunucu ve işçi koşu boyunca aynı değerlerle çalışır.
        self._lookahead_n = self._read_lookahead()
        self.live_keys = self._read_live_keys()      # kayıt kartlarından (DK-17), BİR kez; işçiye spec ile gider

    # ---- yapılandırma -------------------------------------------------------------------------------------------
    def _read_lookahead(self) -> int:
        try:
            return max(1, int(self.cfg.load_decisions()["lookahead"]))
        except (AttributeError, KeyError, TypeError, ValueError):
            return int(getattr(self.cfg, "LOOKAHEAD", 2))

    def _read_live_keys(self) -> frozenset:
        try:
            return frozenset(self.cfg.load_live_keys(self.registry))
        except (AttributeError, TypeError, ValueError):
            return frozenset(config.DEFAULT_LIVE_KEYS)

    def _lookahead(self) -> int:
        return self._lookahead_n

    def _interval(self, run: _Run) -> float:
        return self.cfg.LIVE_WEEK_MS[run.speed] / 1000.0

    # ---- durum --------------------------------------------------------------------------------------------------
    def _p50(self, run: _Run) -> float | None:
        return statistics.median(run.step_times) if run.step_times else None

    def _state(self, run: _Run) -> dict:
        st: dict[str, Any] = {
            "runId": run.id, "status": run.status, "week": run.released, "durationWeeks": run.duration,
            "speed": run.speed, "computing": run.computing, "version": run.version, "seedIndex": run.seed_index,
            "values": dict(run.values), "scenarioId": run.scenario_id, "name": run.name,
            "cityNames": list(run.city_names),
            "buffering": run.buffering or (not run.ready and run.status in ("running", "paused")),
        }
        if run.mode == "dao":                           # Kurucu durumu bayt bayt aynı kalır: alan yalnız DAO'da
            st["mode"] = "dao"
            if run.dunya_kodu is not None:
                st["dunyaKodu"] = run.dunya_kodu
        if run.mode == "dao" and run.harita0 is not None:
            st["harita0"] = run.harita0
        if run.mode == "dao" and run.dao0 is not None:
            st["dao0"] = run.dao0
        if run.world_id is not None:
            st["worldScenarioId"] = run.world_id
        if run.world_values is not None:
            st["worldScenarioValues"] = copy.deepcopy(run.world_values)
        if run.goals is not None:
            st["goals"] = list(run.goals)
        # Şart sürümleri: TAM değer kümeleri (yama değil) ve dikiş haftaları; "aynı şartla" tarifi (DK-11) bundan kurulur.
        st["versions"] = [{"version": n, "fromWeek": run.version_from.get(n, 0), "values": copy.deepcopy(v),
                           **({"note": run.version_notes[n]} if n in run.version_notes else {})} for n, v in sorted(run.version_sets.items())]
        if run.locks:                                   # bağlam kilidi: koşu ortasında kapalı kartlar (neden `no_cash_floor`)
            st["settingLocks"] = [{"id": c.id, "reason": CONTEXT_LOCK_REASON} for c in context_lock_cards(self.registry, run.locks)]
        if run.prep is not None:
            st["preparing"] = {"done": min(run.worker_week, run.prep["total"]), "total": run.prep["total"]}
        if run.parent_id is not None:
            st["parentRunId"], st["forkWeek"] = run.parent_id, run.fork_week
        if run.status == "ended":
            st["endedReason"] = "duration"
        if run.error:
            st["error"] = dict(run.error)
        p50 = self._p50(run)
        if p50:
            st["modelWeeksPerSec"] = round(1.0 / p50, 3)
        return st

    def _emit(self, run: _Run, ev: str, data: dict) -> None:
        for s in run.subs:
            s._put(ev, data)

    def _emit_state(self, run: _Run, now: float, important: bool) -> None:
        if important or now - run.last_state_t >= STATE_MIN_GAP:
            run.last_state_t, run.dirty = now, False
            self._emit(run, "state", self._state(run))
        else:
            run.dirty = True

    def _get(self, run_id: str) -> _Run:
        run = self._runs.get(run_id)
        if run is None:
            raise UnknownRun(run_id)
        return run

    # ---- genel arayüz -------------------------------------------------------------------------------------------
    @staticmethod
    def _check_shape(config_: dict) -> None:
        bad = []
        name, cities = config_.get("name", ""), config_.get("cityNames")
        if name is not None and (not isinstance(name, str) or len(name) > MAX_NAME_LEN):
            bad.append(FieldError("name", "invalid"))
        if cities is not None and (not isinstance(cities, list) or len(cities) > MAX_CITIES
                                   or not all(isinstance(c, str) and len(c) <= MAX_CITY_NAME_LEN for c in cities)):
            bad.append(FieldError("cityNames", "invalid"))
        mode = config_.get("mode")
        if mode is not None and mode not in MODES:
            bad.append(FieldError("mode", "invalid"))
        if bad:
            raise RunConfigError(bad)

    def create(self, config_: dict, schedule: list | None = None, fast_forward_to: int | None = None,
               parent: tuple[str, int] | None = None, dunya: tuple[str, str] | None = None) -> dict:
        """Yeni koşu. `schedule` = `[{week, patch}]` (hafta 0 yamaları kuruluşa katılır; ötekiler işçide `week` hesaplandıktan
        sonra uygulanır), `fast_forward_to` = pacer'sız hesaplanacak hafta (`<= süre`), `parent` = (ebeveyn kimliği, dal haftası;
        çıkarılmaz), `dunya` = (dünya kodu, oyuncu kimliği; yalnız DAO). Hata: `RunConfigError`, `BusyPreparing`, `TooManyRuns`."""
        self._check_shape(config_)
        if config_.get("mode") == "dao" and "durationWeeks" not in config_:        # `run_overrides` süreyi zorunlu tutar: DAO oyununun süresi sabittir
            config_ = dict(config_, durationWeeks=DAO_DURATION)
        sched_in = [] if schedule is None else schedule
        errors = list(recipe.shape_errors(sched_in))
        if errors:
            raise RunConfigError(errors)
        errors = recipe.validate(self.registry, {"config": config_, "schedule": sched_in}, self.live_keys)
        ff = fast_forward_to
        dw = config_.get("durationWeeks")
        if ff is not None and (type(ff) is not int or ff < 0 or (type(dw) is int and ff > dw)):
            errors.append(FieldError("fastForwardTo", "invalid"))
        if errors:
            raise RunConfigError(errors)
        merged, rest = recipe.split_week0(config_, sched_in)
        overrides = run_overrides(self.registry, merged)
        mode = "dao" if merged.get("mode") == "dao" else "kurucu"
        if mode == "dao":
            overrides["HUMAN_ON"] = 1                                      # kart değil: yalnız kuruluşta `Params(**overrides)` ile verilir (livepatch ile değil)
            overrides["HUMAN_LONCA"] = 1                                   # F2: insan işletmesi için lonca_sec kararı (kapalıyken karar_gecersiz); Kurucu'da yok
            overrides["FIRM_LIFE_LOG"] = 1                                 # F4: firma yaşam kaydı (davranışsız ölçüm): batış nedeni, firma uyarıları, sektör eğilimi panoya; çıktıyı değiştirmez
        tid = merged.get("templateId")
        values = dict(self.registry.templates[tid]["values"]) if tid in self.registry.templates else {}
        values.update(merged.get("values") or {})
        cfg_run = {
            "name": merged.get("name") or "",
            "cityNames": list(merged.get("cityNames") or []),
            "seedIndex": merged["seedIndex"] if type(merged.get("seedIndex")) is int else 0,
            "templateId": tid if isinstance(tid, str) else "canli",
            "duration": merged["durationWeeks"],                     # run_overrides doğruladı (100/200/500/520)
            "mode": mode,
            "worldScenarioId": merged.get("worldScenarioId"),
            "worldScenarioValues": copy.deepcopy(merged["worldScenarioValues"]) if isinstance(merged.get("worldScenarioValues"), dict) else None,
            "goals": list(merged["goals"]) if merged.get("goals") is not None else None,
        }
        sched_spec = []
        for n, e in enumerate(rest):
            res = resolve(self.registry, e["patch"])
            sched_spec.append({"week": e["week"], "overrides": dict(res.params), "version": n + 2})
        run_id = "canli-" + uuid.uuid4().hex[:8]
        spec = {"run_id": run_id, "overrides": overrides, "weeks": cfg_run["duration"], "schedule": sched_spec,
                "host": os.environ.get("OYUN_HOST") or "model", "live_keys": sorted(self.live_keys),
                "firms": True}                                 # T10: harita için her canlı koşuda (diske yazım ayrıca `_disk.root`a bağlı)
        with self._lock:
            if ff and any(r.prep is not None for r in self._runs.values()):
                raise BusyPreparing()
            max_runs = max(1, int(self.cfg.MAX_RUNS))
            need = len(self._runs) - max_runs + 1
            if need > 0:                                           # abonesiz en eskileri çıkar; yetmezse hiçbirini çıkarma
                keep = parent[0] if parent else None
                victims = [rid for rid, r in self._runs.items() if not r.subs and rid != keep][:need]
                if len(victims) < need:
                    raise TooManyRuns()
                for rid in victims:
                    self._drop(rid, graceful=True)
            worker = self.factory(spec)
            run = _Run(run_id, cfg_run, overrides, values, worker)
            if dunya is not None and mode == "dao":
                run.dunya_kodu, run.oyuncu = dunya
            run.locks = context_locks(self.registry, overrides)
            run.raw_config = copy.deepcopy(config_)
            run.schedule = [{"week": e["week"], "patch": copy.deepcopy(e["patch"])} for e in sched_in]
            if parent:
                run.parent_id, run.fork_week = parent
            for n, e in enumerate(rest):                           # sürümler baştan bilinir (2, 3, ...)
                self._add_version(run, n + 2, e["week"], e["patch"])
            run.sched_total = len(rest)
            run.later_overrides.extend(dict(x["overrides"]) for x in sched_spec)
            self._runs[run_id] = run
            run.started_wall = self.wall()
            run.disk = self._disk.open(run_id, run.started_wall)
            self._disk_meta(run)
            now = self._clock()
            self._send(run, dict(spec, cmd="init"), now)
            if ff:
                run.prep = {"total": ff}
                if self._send(run, {"cmd": "ff", "week": ff}, now):
                    run.target, run.owed_since, run.step_start = ff, now, now
            handle = {"runId": run_id, "state": self._state(run)}
        self._do_reap()
        return handle

    def branch(self, run_id: str, week: Any, patch: Any = None) -> dict:
        """Dal: ebeveyn tarifinin `week`'e kadarki kısmı (+ `patch` `week`'te); ebeveyn değişmez. `week > 0`'da `patch`
        yalnız canlı değiştirilebilir ayarlar içerebilir (`start_only` reddedilir: dal baştan kurulmaz); `week == 0`'da
        yama kuruluşa katılır (tüm ayarlar). Hata: `UnknownRun`, `RunConfigError` (kimlikler `week`/`patch`/ayar)."""
        with self._lock:
            parent = self._get(run_id)
            errors = []
            if type(week) is not int or not 0 <= week < parent.duration:
                errors.append(FieldError("week", "invalid"))
            if patch is not None and not isinstance(patch, dict):
                errors.append(FieldError("patch", "invalid"))
            if errors:
                raise RunConfigError(errors)
            sched = [copy.deepcopy(e) for e in parent.schedule if e["week"] <= week]
            if patch:
                if week > 0:
                    bad = self._change_rejects(patch, parent.locks)
                    if bad:
                        raise RunConfigError([FieldError(k, r) for k, r in bad])
                    if not resolve(self.registry, patch).params:
                        raise RunConfigError([FieldError("patch", "invalid")])
                sched.append({"week": week, "patch": copy.deepcopy(patch)})
            raw = copy.deepcopy(parent.raw_config)
        # Kilit dışında: `create` çıkarılan işçilerin kapanışını bekler (Ö4: bir koşunun işi ötekileri durdurmaz). Ebeveyn
        # `parent=` ile çıkarılmaktan korunur; tarif kopyalandığı için ebeveyn bu arada silinse de dal kurulur.
        return self.create(raw, sched, week or None, parent=(run_id, week))

    def list_runs(self) -> list[dict]:
        with self._lock:
            return [{"runId": r.id, "state": self._state(r)} for r in self._runs.values()]

    def get(self, run_id: str) -> dict | None:
        with self._lock:
            run = self._runs.get(run_id)
            return None if run is None else {"runId": run.id, "state": self._state(run)}

    def run_locks(self, run_id: str) -> frozenset:
        """Koşunun bağlam kilidi (`context_locks`); `/info?run=` ve `/availability` aynı kapıyı kullanır."""
        with self._lock:
            return self._get(run_id).locks

    def stats(self, run_id: str) -> dict:
        with self._lock:
            run = self._get(run_id)
            return {"status": run.status, "released": run.released, "worker_week": run.worker_week,
                    "frontier": run.target, "buffered": len(run.buf), "p50": self._p50(run)}

    def control(self, run_id: str, action: str, speed: int | None = None) -> dict:
        if action not in ACTIONS or (speed is not None and (type(speed) is not int or speed not in SPEEDS)):
            raise ValueError("action/speed")
        with self._lock:
            run = self._get(run_id)
            if action == "olay" and run.mode != "dao":
                raise NotDao(run_id)
            if run.status in ("ended", "failed") or run.computing or run.prep is not None:
                return self._state(run)
            now = self._clock()
            before = (run.status, run.speed)
            if speed is not None:
                run.speed = speed
            run.olay = action == "olay"
            if action == "olay":                       # DAO: 16x (0 ms) oynat; `_publish` olay çıkınca duraklatır
                run.speed = 16
                if run.status != "running":
                    run.status = "running"
                    run.last_release = now
                    run.streak = 0
                run.flush_one = False
            elif action == "play":
                if run.status != "running":
                    run.status = "running"
                    run.last_release = now
                    run.streak = 0
                run.flush_one = False
            elif action == "pause":
                run.status = "paused"
                run.credit = 0
                run.buffering = False
                run.flush_one = run.mode == "dao" and run.target > run.released     # DAO: istenen (hesaplanan ya da bekleyen) hafta gelince bir kez yayımlanır, sonra durur
            elif run.status != "running":
                run.credit += 1
            self._tick(run, now)
            if (run.status, run.speed) != before:
                self._emit_state(run, now, True)
            state = self._state(run)
        self._do_reap()
        return state

    def subscribe(self, run_id: str) -> Subscription:
        with self._lock:
            run = self._get(run_id)
            sub = Subscription(self, run_id)
            sub._put("state", self._state(run))
            for pkt in run.packets:
                sub._put("week", pkt)
            for ev in run.vevents:
                sub._put("world_event", ev)
            if run.status == "ended":
                sub._put("ended", {"reason": "duration", "week": run.released})
                sub._finish()
            else:
                run.subs.append(sub)
                run.idle_deadline = None
            return sub

    def _unsubscribe(self, sub: Subscription) -> None:
        with self._lock:
            run = self._runs.get(sub.run_id)
            if run is None or sub not in run.subs:
                return
            run.subs.remove(sub)
            if not run.subs:
                run.idle_deadline = self._clock() + self.cfg.IDLE_PAUSE_S

    def weeks(self, run_id: str, a: int, b: int) -> list[dict]:
        with self._lock:
            run = self._get(run_id)
            lo, hi = max(1, int(a)), min(run.released, int(b))
            return run.packets[lo - 1:hi] if lo <= hi else []

    def _packet_at(self, run: _Run, week: int) -> dict | None:
        return run.packets[week - 1] if 1 <= week <= len(run.packets) else None      # yayımlanmamış (lookahead) hafta görünmez

    def drawer(self, run_id: str, kind: str, ref: str, week: int | None = None, wait_s: float = DRAWER_WAIT_S) -> dict:
        """Çekmece (S5): koşuyu İLERLETMEZ, `W`'yi değiştirmez. İşçi yalnız en son hesaplanan haftanın dünyasını tutar:
        `week` işçinin o anki haftasına eşitse (yayımlanan hafta işçiye yetiştiğinde, ör. duraklatınca; hafta verilmezse yayımlanan son hafta) taze veri `{kind, ref, week, stale:false, title, fields}`; başka haftaysa (ya da
        işçi artık yoksa: bitti/çöktü/hazırlanıyor) `stale:true` ve o haftanın paket alanları (`drawers.from_packet`).
        Lonca istisnadır (PLAN-TAKIP): satırı her hafta pakettedir; `week` için paket satırı varsa her zaman `stale:false` (o haftanın verisi).
        Bilinmeyen `ref` `DrawerNotFound`; bilinmeyen koşu `UnknownRun`. `kind`/`ref`/`week` doğrulaması çağıranındır."""
        with self._lock:
            run = self._get(run_id)
            names = list(run.city_names)
            want = run.released if week is None else week          # en çok yayımlanan hafta: `/weeks` sözleşmesiyle aynı
            if kind == "lonca":                                     # PLAN-TAKIP: lonca satırı pakette; o haftanın verisi her zaman tazedir (işçi önde koşsa da)
                out = drawers.from_packet(kind, ref, self._packet_at(run, want), names)
                if out["fields"]:
                    return {"kind": kind, "ref": ref, "week": want, "stale": False, "title": out["title"], "fields": out["fields"]}
            req = None
            if run.worker is not None and run.ready and run.prep is None and run.status not in ("ended", "failed"):
                run.drawer_seq += 1
                rid = run.drawer_seq
                req = _DrawerReq()
                run.drawer_reqs[rid] = req
                if not self._send(run, {"cmd": "drawer", "id": rid, "kind": kind, "ref": ref}, self._clock()):
                    run.drawer_reqs.pop(rid, None)
                    req = None
        res = None
        if req is not None:
            if req.done.wait(wait_s):
                res = req.result
            else:
                with self._lock:
                    run.drawer_reqs.pop(rid, None)
        if res is not None and res.get("error") == "not_found":
            raise DrawerNotFound(ref)
        if res is not None and "data" in res and res.get("week") == want and isinstance(res["data"], dict):
            data = dict(res["data"])
            if kind == "city" and ref.isdigit() and int(ref) < len(names):
                data["title"] = names[int(ref)]                      # şehir adı koşunun adından
            return {"kind": kind, "ref": ref, "week": want, "stale": False, "title": data.get("title", ref), "fields": data.get("fields", {})}
        with self._lock:                                             # eski hafta / işçi yok / okuma hatası: paket görünümü
            pkt = self._packet_at(run, want)
        try:
            out = drawers.from_packet(kind, ref, pkt, names)
        except drawers.UnknownRef:
            raise DrawerNotFound(ref)
        return {"kind": kind, "ref": ref, "week": want, "stale": True, "title": out["title"], "fields": out["fields"]}

    def dao_gozlem(self, run_id: str) -> dict:
        """Yayımlanan son haftanın DAO gözlemi (derin kopya); bitmiş koşuda `daoSonuc` ile aynıdır. Hata: `UnknownRun`, `NotDao`, `DaoCrashed` (işçi çöktü, gözlem yok), `DaoPreparing` (yayımlanmış paket yok)."""
        with self._lock:
            run = self._get(run_id)
            if run.mode != "dao":
                raise NotDao(run_id)
            dao = run.packets[-1].get("dao") if run.packets else None
            if run.status == "failed" and not isinstance(dao, dict):
                raise DaoCrashed(run_id)                       # N1: ölü işçi hiç paket yayımlamaz; "hazirlaniyor" sonsuza dek beklemek olurdu
            if run.prep is not None or not isinstance(dao, dict):
                raise DaoPreparing(run_id)
            return copy.deepcopy(dao)

    @staticmethod
    def _karar_durumu(run: _Run) -> dict:
        """Karar verildiği andaki yayımlanmış gözlemden `{nakit, durum, servet_dilimi}`; henüz paket yoksa (hafta 0) alanlar null."""
        dao = run.packets[-1].get("dao") if run.packets else None
        ben = dao.get("ben") if isinstance(dao, dict) else None
        ben = ben if isinstance(ben, dict) else {}
        return {"nakit": ben.get("nakit"), "durum": ben.get("durum"), "servet_dilimi": ben.get("servet_dilimi")}

    def dao_karar(self, run_id: str, karar: dict, wait_s: float = DAO_KARAR_WAIT_S) -> dict:
        """DAO oyuncusunun kararını işçiye iletir ve yanıtı bekler (kilit dışında, çekmece kalıbı). Kabul: `{"kabul": True, "hafta": <uygulama haftası>}`; ret:
        `{"kabul": False, "kod": <hata kodu>, "fields": [...]}`. `hafta`, işçinin o anki haftasının ertesidir: duraklatılmış DAO koşusunda gösterilen haftanın ertesi
        (oynarken işçi bir hafta önde olabilir; yanıttaki hafta gerçektir). Kabul edilen karar (yalnız işçi onayından sonra, zaman aşımından sonra gelse de)
        `kararlar.jsonl`ye yazılır. Hata: `UnknownRun`, `NotDao`, `DaoFinished` (bitti/çöktü/silindi), `DaoPreparing` (hızlı ileri sarma sürüyor), `DaoTimeout`."""
        with self._lock:
            run = self._get(run_id)
            if run.mode != "dao":
                raise NotDao(run_id)
            if run.status in ("ended", "failed") or run.worker is None:
                raise DaoFinished(run_id)
            if run.prep is not None:
                raise DaoPreparing(run_id)
            run.karar_seq += 1
            rid = run.karar_seq
            req = _DrawerReq()
            run.karar_reqs[rid] = req
            run.karar_info[rid] = (copy.deepcopy(karar), self._karar_durumu(run))
            if not self._send(run, {"cmd": "karar", "id": rid, "karar": copy.deepcopy(karar)}, self._clock()):
                run.karar_reqs.pop(rid, None)
                run.karar_info.pop(rid, None)
                req = None
        if req is None:
            self._do_reap()
            raise DaoFinished(run_id)
        if not req.done.wait(wait_s):
            with self._lock:
                run.karar_reqs.pop(rid, None)
            raise DaoTimeout(run_id)
        res = req.result or {}
        if res.get("error") == "ended":
            raise DaoFinished(run_id)
        return res

    def _finish_karar_reqs(self, run: _Run) -> None:
        """Yanıt bekleyen kararları uyandırır (koşu bitti/çöktü/silindi): bekleyenler `DaoFinished` alır."""
        reqs, run.karar_reqs = run.karar_reqs, {}
        run.karar_info.clear()
        for req in reqs.values():
            req.result = {"error": "ended"}
            req.done.set()

    def delete(self, run_id: str) -> None:
        with self._lock:
            self._get(run_id)
            self._drop(run_id, graceful=True)
        self._do_reap()

    def _change_rejects(self, patch: dict, locks: Any = frozenset()) -> list[tuple[str, str]]:
        """Çok ayarlı yamanın her reddi `(kimlik, neden)`: bilinmeyen/düzenlenemez `locked`, pasif `passive`,
        doğrulanmamış `unverified`, koşu ortasında canlı olmayan ya da bağlam kilidi altındaki (`locks`) `start_only`, değer geçersizse `invalid`.
        Yama sırası korunur; boş liste = yamanın tamamı uygulanabilir."""
        out = []
        reg = self.registry
        for k, raw in patch.items():
            card = reg.by_id.get(k) if isinstance(k, str) else None
            if card is None or not run_editable(card):
                out.append((str(k), "locked"))
                continue
            why = change_block_reason(card, self.live_keys, locks)
            if why is None:
                try:
                    reg.decode(card, raw)
                except (ValueError, TypeError):
                    why = "invalid"
            if why is not None:
                out.append((k, why))
        return out

    def _prev_ui(self, run: _Run, sid: str) -> Any:
        """Kimliğin değişiklikten ÖNCEKİ arayüz değeri: son sürümün değerleri, yoksa kartın model varsayılanı; ikisi de
        yoksa None."""
        cur = run.version_sets[max(run.version_sets)]
        if sid in cur:
            return cur[sid]
        card = self.registry.by_id.get(sid)
        try:
            return None if card is None else self.registry.default_ui(card)
        except (ValueError, TypeError, KeyError):
            return None

    def apply_change(self, run_id: str, patch: Any, note: str | None = None, timeout: float | None = None) -> dict:
        """Gelecek haftalara değişiklik. `ChangeResult` sözlüğü döner (`accepted`...)."""
        with self._lock:
            run = self._get(run_id)
            if run.status in ("ended", "failed") or run.worker_week >= run.duration:
                return copy.deepcopy(_ENDED)       # son hafta hesaplandı: hiçbir haftaya uygulanamaz
            if run.computing or run.pending is not None or run.prep is not None or run.sched_applied < run.sched_total:
                return copy.deepcopy(_BUSY)               # hazırlık ya da takvimin kalan yamaları sürüyor: sürüm sırası bozulmasın
            if not isinstance(patch, dict):
                return {"accepted": False, "fields": [{"id": "*", "reason": "invalid"}]}
            bad = self._change_rejects(patch, run.locks)
            if bad:                                                # atomik: biri reddedilirse hiçbiri uygulanmaz
                return {"accepted": False, "fields": [{"id": k, "reason": r} for k, r in bad]}
            res = resolve(self.registry, patch)
            if not res.params:
                return {"accepted": False, "fields": [{"id": "*", "reason": "invalid"}]}
            # Önerilen sürüm her zaman +1; gerçek dikişi işçi bildirir (`_patched`): dikiş 0 ise sürüm 1 kalır, olay yok.
            ver = run.accepted_version + 1
            pc = _Pending(dict(res.params), dict(patch), ver, (note.strip() if isinstance(note, str) else "") or None)
            run.pending, run.computing = pc, True
            self._emit_state(run, self._clock(), True)
            limit = timeout if timeout is not None else max(3.0, 3.0 * (self._p50(run) or 0.0))
        if not pc.done.wait(limit):
            with self._lock:
                if not pc.sent and run.pending is pc:             # gönderilmedi: geri çek (işçiye hiç gitmez)
                    run.pending, run.computing = None, False
                    self._emit_state(run, self._clock(), True)
                    return copy.deepcopy(_BUSY)
            while not pc.done.wait(0.25):                          # gönderildi: onay/çöküş/silme bitirir
                pass
        return pc.result or copy.deepcopy(_ENDED)

    # ---- iş parçacığı -------------------------------------------------------------------------------------------
    def start_thread(self) -> None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="oyun-pacer", daemon=True)
            self._thread.start()

    def _loop(self) -> None:
        while not self._stop.wait(PUMP_PERIOD):
            try:
                self.pump()
            except Exception:                                      # pacer ölmesin
                traceback.print_exc(file=sys.stderr)

    def shutdown(self) -> None:
        self._stop.set()
        t = self._thread
        if t is not None and t is not threading.current_thread():
            t.join(2)
        with self._lock:
            for rid in list(self._runs):
                self._drop(rid, graceful=True, reason="server_shutdown")     # işçiler önce stdin EOF ile kapanır (host.close), ≤ 2 sn sonra kill
        self._do_reap(REAP_GRACE_S)

    # ---- iç: yaşam döngüsü --------------------------------------------------------------------------------------
    def _drop(self, run_id: str, graceful: bool, reason: str = "discarded") -> None:
        """Kilit altında çağrılır: koşuyu kayıttan çıkarır, aboneleri kapatır, işçiyi söküme verir. `reason`: diske yazılan bitiş nedeni
        (`discarded` silme/çıkarma, `server_shutdown`); koşu zaten `ended`/`failed` olarak yazıldıysa değişmez."""
        run = self._runs.pop(run_id)
        self._disk_finish(run, reason)
        self._finish_pending(run, copy.deepcopy(_ENDED))
        self._finish_karar_reqs(run)
        for s in run.subs:
            s._finish()
        run.subs = []
        self._retire(run, graceful)

    def _retire(self, run: _Run, graceful: bool) -> None:
        if run.worker is not None:
            self._reap.append((run.worker, REAP_GRACE_S if graceful else 0.0, graceful))
            run.worker = None

    def _do_reap(self, budget: float | None = None) -> None:
        """Kilit dışında: bekleme pump'ı tıkamaz. Nazik olanlara önce hep birlikte stdin EOF verilir, toplam en çok
        `budget` (yoksa en büyük bireysel süre) sn beklenir, sonra hepsi öldürülür (CSV dizini `kill()`'de silinir)."""
        with self._lock:
            items, self._reap = self._reap, []
            ends, self._dao_end = self._dao_end, []
        for end in ends:                                          # DAO bitiş kancası: kilit dışında, işçi beklemelerinden önce (sonuç gecikmez)
            try:
                if self._on_dao_end is not None:
                    self._on_dao_end(*end)
            except Exception:                                      # noqa: BLE001  kanca koşuyu ve pacer'ı düşürmez
                traceback.print_exc(file=sys.stderr)
        graceful = [w for w, _t, g in items if g]
        for w in graceful:
            try:
                w.close_stdin()
            except Exception:
                pass
        limit = budget if budget is not None else max((t for _w, t, g in items if g), default=0.0)
        end = time.monotonic() + limit
        for w in graceful:
            try:
                w.wait(max(0.0, end - time.monotonic()))
            except Exception:
                pass
        for w, _t, _g in items:
            try:
                w.kill()
            except Exception:
                pass

    def _finish_pending(self, run: _Run, result: dict) -> None:
        pc = run.pending
        if pc is not None:
            run.pending, run.computing = None, False
            pc.result = result
            pc.done.set()

    def _fail(self, run: _Run, week: int, now: float) -> None:
        if run.status in ("ended", "failed"):
            return
        run.status, run.error = "failed", {"messageKey": ERR_CRASH, "week": max(0, int(week))}
        self._disk_finish(run, "failed")
        run.prep = None                            # hazırlık yuvası serbest
        run.buf.clear()
        run.credit, run.buffering = 0, False
        self._finish_pending(run, copy.deepcopy(_ENDED))
        self._finish_karar_reqs(run)
        self._retire(run, graceful=True)           # takılı/çökmüş işçi: ≤ 2 sn nazik bekleme, sonra kill (host.close fırsatı)
        self._emit_state(run, now, True)

    def _send(self, run: _Run, cmd: dict, now: float) -> bool:
        if run.worker is None:
            return False
        try:
            run.worker.send(cmd)
            return True
        except (BrokenPipeError, OSError, ValueError):
            self._fail(run, run.worker_week + 1, now)
            return False

    # ---- pacer --------------------------------------------------------------------------------------------------
    def pump(self, now: float | None = None) -> None:
        now = self._clock() if now is None else now
        with self._lock:
            for run in list(self._runs.values()):
                self._drain(run, now)
                self._tick(run, now)
        self._do_reap()

    def _drain(self, run: _Run, now: float) -> None:
        w = run.worker
        if w is None:
            return
        for ev in w.events(0):
            kind = ev.get("ev")
            if kind == "ready":
                run.model_version = ev.get("model_version")
                run.ready = True
                if run.mode == "dao" and isinstance(ev.get("firms"), list):
                    run.harita0 = harita_of(0, ev["firms"])
                if run.mode == "dao" and isinstance(ev.get("dao"), dict):
                    run.dao0 = ev["dao"]
                self._emit_state(run, now, False)
            elif kind == "week":
                n = ev.get("week")
                if type(n) is not int or n != run.worker_week + 1 or not isinstance(ev.get("row"), dict):
                    continue
                run.worker_week = n
                run.owed_since = now if n < run.target else None
                v = ev.get("version")
                cities, chain = ev.get("cities"), ev.get("chain")      # S5: şehir satırları ve zincir (isteğe bağlı)
                hold = ev.get("holdings")                              # PLAN-TAKIP: kim ne tutuyor (isteğe bağlı)
                cred = ev.get("credit")                                # PLAN-KREDI: kredi kaydı (isteğe bağlı; arayüzde gösterilmez)
                hous = ev.get("housing")                               # PLAN-KREDI T4: konut kaydı (isteğe bağlı; arayüzde gösterilmez)
                lab = ev.get("labour")                                 # PLAN-KREDI T4b: iş piyasası kaydı (isteğe bağlı; arayüzde gösterilmez)
                dao = ev.get("dao")                                    # T6a: DAO gözlemi (yalnız DAO koşusunda)
                kur = ev.get("kurumlar")                               # Görev 12b: şehir kurumları (isteğe bağlı)
                eko = ev.get("ekonomi")                                # M10: Ekonomi paneli bloğu (isteğe bağlı)
                mak = ev.get("makro")                                  # M10: Makro göstergeler bloğu (isteğe bağlı)
                firms = ev.get("firms")
                harita = fark = None
                if run.mode != "dao" and n != 1 and n % 10 != 0 and n < run.duration and run.harita_taban is not None:
                    fark = harita_fark_of(n, run.harita_taban, firms)          # Kurucu, tam harita taşımayan hafta: tabana göre hafif fark (tam alan yok)
                else:
                    harita = harita_of(n, firms)
                    if run.mode != "dao" and harita is not None:
                        run.harita_taban = harita_taban_of(n, firms)            # sonraki farkların tabanı
                run.buf[n] = make_packet(run.id, n, max(1, v if type(v) is int else 1), ev["row"],
                                         cities if isinstance(cities, list) else None, chain if isinstance(chain, dict) else None,
                                         hold if isinstance(hold, dict) else None, cred if isinstance(cred, dict) else None,
                                         hous if isinstance(hous, dict) else None, lab if isinstance(lab, dict) else None,
                                         harita, dao if isinstance(dao, dict) else None, fark,
                                         kur if isinstance(kur, list) else None,
                                         eko if isinstance(eko, dict) else None, mak if isinstance(mak, dict) else None)
                run.arrival[n] = now
                if (run.disk is not None and isinstance(ev.get("firms"), list)
                        and (n == 1 or n % 10 == 0 or n >= run.duration)):         # D2: anlık görüntü hafta olayıyla aynı turda gelir; diske eski kadansla (DAO paketi her hafta taşısa da)
                    run.firm_buf[n] = ev["firms"]
                if run.step_start is not None and now > run.step_start:
                    run.step_times.append(now - run.step_start)
                run.step_start = now if run.worker_week < run.target else None
            elif kind == "drawer":
                req = run.drawer_reqs.pop(ev.get("id"), None) if type(ev.get("id")) is int else None
                if req is not None:                                  # beklemesi bırakılmış (zaman aşımı) istek: yanıt atılır
                    req.result = {"error": ev.get("error")} if "error" in ev else {"week": ev.get("week"), "data": ev.get("data")}
                    req.done.set()
            elif kind == "karar":
                req = run.karar_reqs.pop(ev.get("id"), None) if type(ev.get("id")) is int else None
                info = run.karar_info.pop(ev.get("id"), None) if type(ev.get("id")) is int else None
                if info is not None and ev.get("kabul") is True and type(ev.get("hafta")) is int:
                    self._karar_kaydet(run, ev["hafta"], info)     # işçi onayı sırasıyla; yanıtı bekleyen kalmamış olsa da
                if req is not None:
                    if ev.get("kabul") is True and type(ev.get("hafta")) is int:
                        req.result = {"kabul": True, "hafta": ev["hafta"]}
                    else:
                        f = ev.get("fields")
                        req.result = {"kabul": False, "kod": ev.get("kod") if isinstance(ev.get("kod"), str) else "karar_gecersiz",
                                      "fields": [x for x in f if isinstance(x, str) or _nedenli_alan(x)] if isinstance(f, list) else []}
                    req.done.set()
            elif kind == "progress":
                if run.prep is not None:
                    self._emit_state(run, now, True)           # `preparing.done` = işlenen son hafta (worker_week)
            elif kind == "patched":
                self._patched(run, ev, now)
            elif kind == "failed":
                wk = ev.get("week")
                self._fail(run, wk if type(wk) is int else run.worker_week + 1, now)
                return
        if run.worker is not None and getattr(w, "eof", False):    # failed olayı olmadan bitti
            self._fail(run, run.worker_week + 1, now)

    def _karar_kaydet(self, run: _Run, hafta: int, info: tuple[dict, dict]) -> None:
        """Kilit altında: işçinin onayladığı kararı `kararlar.jsonl`ye ekler (yeniden oynatma bu kayıttan: koşuyu bayt bayt yeniden üretir)."""
        sira, run.karar_sira = run.karar_sira, run.karar_sira + 1
        if run.disk is not None:
            run.disk.append_karar({"uygulama_haftasi": hafta, "sira": sira, "karar": info[0], "durum": info[1]})

    def _add_version(self, run: _Run, version: int, seam: int, ui_patch: dict, note: str | None = None) -> None:
        """Sürüm kaydı + sürüm olayı (hafta `seam` yayımlanınca akışa girer). Canlı kabulde ve ön yüklü takvimde ortak."""
        ids = sorted(ui_patch)
        changes = [{"id": i, "from": self._prev_ui(run, i), "to": copy.deepcopy(ui_patch[i])} for i in ids]
        run.accepted_version = version
        run.version_from[version] = seam
        run.version_sets[version] = dict(run.version_sets[max(run.version_sets)], **ui_patch)
        if note:
            run.version_notes[version] = note
        event = {"id": "version:%d:%d:%s" % (version, seam, "+".join(ids)), "week": seam, "kind": "neutral",
                 "textKey": "event.version", "params": {"hafta": seam, "mod": "live", "surum": version},
                 "critical": False, "sector": None, "rule_ids": ids, "changes": changes}
        run.vevents_due.append((seam, event))

    def _patched(self, run: _Run, ev: dict, now: float) -> None:
        if ev.get("scheduled"):                                      # ön yüklü takvim yaması: sürüm/olay baştan hazır
            run.sched_applied += 1
            return
        pc = run.pending
        if pc is None or not pc.sent:
            return
        seam = ev.get("from_week") if type(ev.get("from_week")) is int else run.worker_week
        if seam >= run.duration:                                     # hiçbir haftaya uygulanmaz: sürüm/olay yok
            self._finish_pending(run, copy.deepcopy(_ENDED))
            self._emit_state(run, now, True)
            return
        run.later_overrides.append(dict(pc.overrides))               # kabul edilen canlı yama "yeni ölçüm" işaretine girer
        if seam <= 0:                                              # hafta 0: yeni sürüm yok, 1. sürüm değerleri güncellenir
            run.version_sets[1] = dict(run.version_sets[1], **pc.ui_patch)
            if pc.note:
                run.version_notes[1] = pc.note
            if run.version == 1:
                run.values = dict(run.version_sets[1])
            run.schedule.append({"week": 0, "patch": copy.deepcopy(pc.ui_patch)})
            self._disk_meta(run)
            self._finish_pending(run, {"accepted": True, "runId": run.id, "mode": "live",
                                       "scenarioId": run.scenario_id, "seamWeek": 0, "version": 1})
            self._emit_state(run, now, True)
            return
        version = ev.get("version") if type(ev.get("version")) is int else pc.version
        self._add_version(run, version, seam, pc.ui_patch, pc.note)
        run.schedule.append({"week": seam, "patch": copy.deepcopy(pc.ui_patch)})
        self._disk_meta(run)
        self._flush_vevents(run)
        self._finish_pending(run, {"accepted": True, "runId": run.id, "mode": "live", "scenarioId": run.scenario_id,
                                   "seamWeek": seam, "version": version})
        self._emit_state(run, now, True)

    def _flush_vevents(self, run: _Run) -> None:
        keep = []
        for seam, ev in run.vevents_due:
            if seam <= run.released:
                run.vevents.append(ev)
                self._emit(run, "world_event", ev)
            else:
                keep.append((seam, ev))
        run.vevents_due = keep

    def _tick(self, run: _Run, now: float) -> None:
        if run.status in ("ended", "failed") or run.worker is None:
            return
        if run.idle_deadline is not None and now >= run.idle_deadline:
            run.idle_deadline = None
            if run.status == "running":
                run.status, run.buffering = "paused", False
                self._emit_state(run, now, True)
        pc = run.pending
        if pc is not None and not pc.sent:                         # önce kuyruk, sonra gönderim
            if self._send(run, {"cmd": "patch", "overrides": pc.overrides, "version": pc.version}, now):
                pc.sent, pc.sent_at = True, now
            if run.status == "failed":
                return
        stuck = float(getattr(self.cfg, "STUCK_S", 30.0))
        if (pc is not None and pc.sent and now - pc.sent_at > stuck) or \
                (run.owed_since is not None and now - run.owed_since > stuck):
            self._fail(run, run.worker_week + 1, now)            # işçi canlı ama yanıtsız
            return
        if run.prep is not None:                                   # hızlı ileri sarma: pacer yok, bitince tek seferde yayımla
            if run.worker_week >= run.prep["total"]:
                self._finish_prepare(run, now)
            return
        self._release(run, now)
        if run.status in ("ended", "failed"):
            return
        if run.mode == "dao":                                      # DAO: önden hesap yok (yalnız bir sonraki hafta); karar gösterilen haftanın ertesinde uygulanır
            ahead = 1 if run.status == "running" else min(run.credit, 1)
        else:
            ahead = self._lookahead() if run.status == "running" else min(run.credit, self._lookahead())
        want = min(run.released + ahead, run.duration)
        if want > run.target:
            if self._send(run, {"cmd": "target", "week": want}, now):
                if run.step_start is None:
                    run.step_start = now
                if run.owed_since is None:
                    run.owed_since = now
                run.target = want
            elif run.status == "failed":
                return
        if run.dirty and now - run.last_state_t >= STATE_MIN_GAP:
            self._emit_state(run, now, True)

    def _finish_prepare(self, run: _Run, now: float) -> None:
        total = run.prep["total"]
        run.prep = None
        run.owed_since = None
        run.last_release = now
        for w in range(1, total + 1):
            if run.status in ("ended", "failed"):
                break
            if w in run.buf:
                self._publish(run, w, now)
        if run.status not in ("ended", "failed"):
            self._emit_state(run, now, True)                       # status paused, preparing yok

    def _release(self, run: _Run, now: float) -> None:
        if run.status == "running":
            interval = self._interval(run)
            while run.status == "running":
                due = run.last_release + interval
                if now < due:
                    break
                w = run.released + 1
                if w in run.buf:
                    on_time = run.arrival.get(w, now) <= due
                    self._publish(run, w, now)
                    run.last_release = due if now - due < interval else now
                    run.streak = run.streak + 1 if on_time else 0
                    if run.buffering and run.streak >= 2:
                        run.buffering = False
                        self._emit_state(run, now, False)
                    if interval > 0 or run.status != "running":
                        break
                else:
                    threshold = 1.5 * interval if interval > 0 else 1.0
                    if now - due > threshold and not run.buffering:
                        run.buffering = True
                        run.streak = 0
                        self._emit_state(run, now, False)
                    break
        elif run.credit > 0:
            w = run.released + 1
            if w in run.buf:
                run.credit -= 1
                self._publish(run, w, now)
                if run.buffering:
                    run.buffering = False
                    self._emit_state(run, now, False)
            elif not run.buffering:
                run.buffering = True
                self._emit_state(run, now, False)
        elif run.flush_one:                                        # DAO duraklatma: hesaplanmakta/tamponda bekleyen haftayı bir kez yayımla (`_publish` bayrağı kapatır)
            w = run.released + 1
            if w in run.buf:
                self._publish(run, w, now)
        elif run.buffering:
            run.buffering = False
            self._emit_state(run, now, False)

    def _diagnostics(self, run: _Run, pkt: dict) -> list[dict]:
        """`pkt` `run.packets`'e eklendikten sonra çağrılır (son öğe). Hata koşuyu düşürmez (tanı yardımcıdır)."""
        try:
            worlds = [p["world"] for p in run.packets]
            versions = [p["version"] for p in run.packets]
            return diagnostics.evaluate_run(worlds, versions, run.version_sets, self.registry)
        except Exception:                                          # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            return []

    def _publish(self, run: _Run, w: int, now: float) -> None:
        pkt = run.buf.pop(w)
        run.flush_one = False
        run.arrival.pop(w, None)
        run.packets.append(pkt)
        run.released = w
        pv = pkt["version"]
        if pv != run.version:                                      # sürüm/değerler yayımlanan pakete uyar
            run.version = pv
            run.values = dict(run.version_sets[max(k for k in run.version_sets if k <= pv)])
        pkt["diagnostics"] = self._diagnostics(run, pkt)          # "Ne olmuyor" (S4): yayımlanan sürümün kurallarına göre
        self._emit(run, "week", pkt)
        self._flush_vevents(run)
        self._disk_week(run, pkt)
        if w >= run.duration:
            run.status, run.buffering, run.credit, run.olay = "ended", False, 0, False
            if run.mode == "dao":                                  # sonuç işçi kapanmadan (`_retire`) ve `kosu.json` son yazımından önce kaydedilir
                run.dao_sonuc = pkt.get("dao")
                if self._on_dao_end is not None:
                    self._dao_end.append((run.id, copy.deepcopy(run.dao_sonuc), self._dao_meta(run)))
            self._disk_finish(run, "ended")
            self._finish_karar_reqs(run)
            self._finish_pending(run, copy.deepcopy(_ENDED))
            self._emit_state(run, now, True)                       # önce son state (ended), sonra ended
            self._emit(run, "ended", {"reason": "duration", "week": w})
            for s in run.subs:
                s._finish()
            run.subs = []
            self._retire(run, graceful=True)
        elif run.olay and isinstance((pkt.get("dao") or {}).get("olaylar"), list) and pkt["dao"]["olaylar"]:
            # `olay` eylemi: bu hafta olay var -> dur. Önden hesap yok: işçi bu haftayı hesaplarken `released + 1` henüz istenmemişti (`_tick` yayımdan SONRA ister,
            # durumu paused görünce istemez), yani işçinin haftası yayımlananla eşit kalır.
            run.olay, run.status, run.buffering, run.credit = False, "paused", False, 0
            self._emit_state(run, now, True)
        else:
            self._emit_state(run, now, False)

    def _dao_meta(self, run: _Run) -> dict:
        """`on_dao_end` kancasına giden koşu üst verisi; `dunyaKodu`/`oyuncu` koşu bir dünyadan kurulmadıysa None (yalnız kancaya gider)."""
        return {"runId": run.id, "mode": run.mode, "name": run.name, "scenarioId": run.scenario_id, "seedIndex": run.seed_index,
                "durationWeeks": run.duration, "week": run.released, "modelVersion": run.model_version, "startedAt": iso(run.started_wall),
                "dunyaKodu": run.dunya_kodu, "oyuncu": run.oyuncu}

    # ---- D1: diske yazma ----------------------------------------------------------------------------------------
    DISK_META_EVERY = 10                                           # kosu.json ilerleme (hafta) güncellemesi: en çok bu kadar haftada bir

    @staticmethod
    def tarif_of(st: dict) -> dict:
        """Koşu durumundan tarif (web `tarifOf` ile aynı biçim): ilk sürümün değerleri + sürümler arası fark takvimi."""
        vs = sorted(st.get("versions") or [], key=lambda v: v["version"])
        ilk = vs[0]["values"] if vs else st["values"]
        schedule = []
        for i, v in enumerate(vs[1:]):
            if v["fromWeek"] <= 0:
                continue
            onceki = vs[i]["values"]
            patch = {k: x for k, x in v["values"].items() if k not in onceki or json.dumps(onceki[k], sort_keys=True) != json.dumps(x, sort_keys=True)}
            if patch:
                schedule.append({"week": v["fromWeek"], "patch": patch})
        out = {"name": st["name"], "cityNames": st["cityNames"], "templateId": st["scenarioId"], "durationWeeks": st["durationWeeks"],
               "seedIndex": st["seedIndex"], "values": ilk}
        for src, dst in (("goals", "goals"), ("worldScenarioId", "worldScenarioId"), ("worldScenarioValues", "worldScenarioValues")):
            if st.get(src) not in (None, "", 0, False):              # JS doğruluk: boş dizi/nesne doğru sayılır, null/""/0/false atlanır
                out[dst] = st[src]
        if schedule:
            out["schedule"] = schedule
        return out

    def _population(self, run: _Run) -> dict:
        """D4: koşunun nüfusu (kuruluşta belirlenir, değişmez): şehir başına oyuncu, toplam oyuncu, NPC, toplam nüfus ve başlangıç kasası."""
        d = self.registry.defaults
        t = nufus.totals(run.overrides, d)
        ppc = run.overrides.get("PLAYERS_PER_CITY", d.get("PLAYERS_PER_CITY"))
        return {"playersPerCity": ppc, "cities": nufus.CITIES, **t, "cityStartCash": run.overrides.get("CITY_START_CASH", d.get("CITY_START_CASH", 0))}

    def _disk_meta(self, run: _Run, reason: str | None = None) -> None:
        """Kilit altında: kosu.json'u yeniden yazar (atomik). Hata koşuyu durdurmaz."""
        if run.disk is None:
            return
        try:
            st = self._state(run)
            meta = {
                "runId": run.id, "name": run.name, "cityNames": list(run.city_names), "scenarioId": run.scenario_id,
                "worldScenarioId": run.world_id, "worldScenarioValues": copy.deepcopy(run.world_values), "goals": run.goals,
                "durationWeeks": run.duration, "seedIndex": run.seed_index, "parentRunId": run.parent_id, "forkWeek": run.fork_week,
                "recipe": self.tarif_of(st), "versions": st["versions"],
                "modelVersion": run.model_version, "defaultsHash": self.defaults_hash, "serverVersion": __version__,
                "startedAt": iso(run.started_wall), "endedAt": None if run.ended_wall is None else iso(run.ended_wall),
                "status": run.status, "week": run.released, "endReason": reason, "mode": run.mode,
                **({"dunyaKodu": run.dunya_kodu} if run.dunya_kodu is not None else {}),
                "population": self._population(run),
                "measurement": plan_mod.new_measurement(self.registry.settings, run.overrides, self.registry.defaults, run.later_overrides),     # D7 (A10): dünya kurulumu varsayılan dışıysa "yeni ölçüm"
            }
            if run.dao_sonuc is not None:
                meta["daoSonuc"] = copy.deepcopy(run.dao_sonuc)
            run.disk.write_meta(meta)
        except Exception:                                          # noqa: BLE001 koşu asla durmaz
            traceback.print_exc(file=sys.stderr)

    def _disk_week(self, run: _Run, pkt: dict) -> None:
        if run.disk is None:
            return
        run.disk.append_week({k: v for k, v in pkt.items() if k not in ("harita", "haritaFark")} if ("harita" in pkt or "haritaFark" in pkt) else pkt)      # harita ve fark diske yazılmaz (firmalar.jsonl aynı veriyi taşır)
        rows = run.firm_buf.pop(run.released, None)
        for k in [k for k in run.firm_buf if k <= run.released]:          # yetim anahtar kalmaz
            run.firm_buf.pop(k, None)
        if rows is not None:
            run.last_firms = (run.released, rows)
            run.disk.append_firms(run.released, rows)
        if run.released % self.DISK_META_EVERY == 0 and run.released < run.duration:
            self._disk_meta(run)

    def _disk_finish(self, run: _Run, reason: str) -> None:
        """Bitiş nedeniyle son kosu.json (+ `ended`'da firmalar.json). Bir kez; sonraki çağrılar sessiz."""
        if run.disk is None or run.disk_final:
            return
        run.disk_final = True
        run.firm_buf.clear()
        run.ended_wall = self.wall()
        self._disk_meta(run, reason)
        self._disk_firms(run)

    def _disk_firms(self, run: _Run) -> None:
        """firmalar.json: son firma anlık görüntüsü (`firmLevel: true`) + son yayımlanan haftanın sektör satırları. Firma anlık görüntüsü
        yoksa (işçi vermedi) yalnız `ended`'da sektör özeti (`firmLevel: false`, uydurma yok)."""
        try:
            pkt = run.packets[-1] if run.packets else None
            chain = (pkt or {}).get("chain")
            sectors = copy.deepcopy(chain["sectors"]) if chain else []
            if run.last_firms is not None:
                week, rows = run.last_firms
                run.disk.write_firms({"runId": run.id, "week": week, "source": "model_firms", "firmLevel": True,
                                      "sectorsWeek": pkt["week"] if pkt else None, "sectors": sectors, "firms": rows})
            elif sectors and run.status == "ended":
                run.disk.write_firms({"runId": run.id, "week": pkt["week"], "source": "chain_last_week", "firmLevel": False, "sectors": sectors})
        except Exception:                                          # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
