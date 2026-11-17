"""A7b: HTTP uç noktaları (`/api/...`) ve SSE. İş mantığı `RunManager`'da; burada yalnız doğrulama, hata ve tel biçimi.

Tel biçimi `apps/web/src/oyun/sim/live/wire.ts` ile birebir; `tests/fixtures/wire_contract.json` iki tarafı kilitler.
Hata gövdesi: `{"error": {"code", "message", "fields": [{"id", "reason"}]}}` (`security.HttpError`).
"""
from __future__ import annotations

import functools
import json
import re
import statistics
from dataclasses import dataclass, field
from typing import Any

from .. import __version__, config, sse
from ..http import Request, Response, Route
from ..registry import defaults as defaults_mod
from ..registry import loader
from ..registry.resolve import DEFAULT_DURATION, DURATIONS, resolve, run_editable, run_overrides
from ..registry.schema import RunConfigError
from ..security import HttpError
from ..sim import drawers, plan as plan_mod
from ..sim import host as host_mod
from ..sim.extract_cities import static_world_info
from .manager import (ACTIONS, CLOSED, MAX_CITIES, MAX_NOTE_LEN, SPEEDS, BusyPreparing, DaoCrashed, DaoFinished, DaoPreparing, DaoTimeout, DrawerNotFound, NotDao,
                      RunManager, TooManyRuns, UnknownRun, change_block_reason, is_live_changeable)

PING_S = 10.0
MAX_OPTION_LEN = 64
_BENCH = config.SERVER_ROOT / "bench" / "results" / "bench-sonuc.json"
_REASON_OUT = {"unknown": "locked", "passive": "locked"}     # P-18: kimlik/pasif nedenleri başlangıçta `locked`; `unverified` aynen
_CHANGE_OUT = {"unknown": "locked", "unverified": "locked"}  # ChangeResult dış kümesi: `unverified` -> `locked`; start_only/passive aynen
_BLOCK_OUT = {"unknown": "locked", "passive": "locked", "invalid": "locked"}   # Availability.blocked: locked/start_only/unverified
# Tel değer kümeleri: `tests/fixtures/wire_contract.json` `enums` ve web `wire.ts` ile aynı (test_wire_enums_fixture).
CAPABILITY_KEYS = ("branch", "seeds", "compare", "library", "city", "chain", "jobs", "rebuild", "harita")
CHANGE_REASONS = ("no_recording", "locked", "busy", "ended", "invalid", "start_only", "passive")
AVAILABILITY_REASONS = ("no_recording", "locked", "start_only", "unverified")
SETTING_REASONS = ("locked", "no_recording", "start_only", "passive", "unverified")


@dataclass
class App:
    registry: Any
    manager: RunManager
    model_version: str
    defaults_hash: str
    ping_s: float = PING_S
    sec_per_week_p50: float | None = None
    capabilities: dict = field(default_factory=lambda: {k: k in ("branch", "rebuild", "city", "chain", "harita") for k in CAPABILITY_KEYS})   # S2: branch+rebuild; S5: city+chain; S3 jobs'i create_app açar
    world_info: Any = None                             # S5: statik dünya bilgisi (şehir kaynakları); ilk `/info`'da modelin varsayılanlarından kurulur
    jobs: Any = None                                   # S3: JobManager (create_app kurar; yoksa /api/jobs yok, capabilities.jobs false)
    depo: Any = None                                   # T8: dünya deposu (`dunyalar.depo.DunyaDeposu`); yoksa /api/dunyalar ve /d/<kod> yok
    surum: str | None = None                           # T8: güncel model sürüm dizesi (`sim.host.guncel_surum`); yayınlanan dünyaya yazılır, `guncelSurum`


@functools.lru_cache(maxsize=4)
def cached_defaults(model_root: str) -> dict:
    """`read_param_defaults` ~40 ms alt süreç: süreç başına bir kez (yalnız başlangıçta çağrılır)."""
    return defaults_mod.read_param_defaults(model_root)


def bench_p50() -> float | None:
    """A1 ölçümünden hafta başına sn ortancası (canlı koşu ölçümü yoksa ipucu); dosya yoksa/bozuksa None."""
    try:
        vals = list(json.loads(_BENCH.read_text(encoding="utf-8"))["sec_per_week"].values())
        vals = [float(v) for v in vals if isinstance(v, (int, float)) and v > 0]
        return round(statistics.median(vals), 3) if vals else None
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def create_app(worker_factory, model_root: str | None = None, cfg=config, ping_s: float = PING_S, runs_dir: str | None = None,
               depo: Any = None) -> App:
    """Gerçek kayıt + varsayılanlar (önbellekli) + RunManager. Pacer iş parçacığını başlatır. Koşular `runs_dir`'e (yoksa
    `config.runs_dir()`: OYUN_RUNS_DIR ya da simulasyon/arayuz/kosular) yazılır (D1)."""
    root = str(model_root or config.MODEL_ROOT)
    d = cached_defaults(root)
    registry = loader.load_registry(loader.DEFAULT_DATA_DIR, d)
    on_dao_end = None
    if depo is not None:
        from ..dunyalar import uclar
        on_dao_end = uclar.dao_bitti_kancasi(depo)
    manager = RunManager(registry, worker_factory, cfg=cfg, runs_dir=runs_dir or config.runs_dir(), on_dao_end=on_dao_end)
    manager.defaults_hash = defaults_mod.defaults_hash(d)
    manager.start_thread()
    app = App(registry, manager, str(d["VERSION"]), defaults_mod.defaults_hash(d), ping_s, bench_p50(), depo=depo,
              surum=host_mod.guncel_surum(root, str(d["VERSION"])))
    app.world_info = static_world_info(d, MAX_CITIES)
    from ..jobs.manager import JobManager, nice_factory
    app.jobs = JobManager(registry, nice_factory(worker_factory), live_keys=manager.live_keys)
    app.capabilities["jobs"] = True
    return app


def register_shutdown(app: App, hooks: list) -> None:
    if app.jobs is not None:
        hooks.append(app.jobs.shutdown)                 # önce iş işçileri (kısa), sonra koşular
    hooks.append(app.manager.shutdown)


# ---- yardımcılar -----------------------------------------------------------------------------------------------
def _fields(items) -> list[dict]:
    return [{"id": i, "reason": r} for i, r in items]


def _invalid(code: str, message: str, items, status: int = 422) -> HttpError:
    return HttpError(status, code, message, _fields(items))


def _not_found() -> HttpError:
    return HttpError(404, "not_found", "Bu koşu bulunamadı.")


def _busy_preparing() -> HttpError:
    return HttpError(409, "busy_preparing", "Başka bir koşu hazırlanıyor; bitmesini bekleyin.")


def _too_many() -> HttpError:
    return HttpError(429, "too_many_runs", "Açık koşu sınırına ulaşıldı; bir koşuyu kapatın.")


def _not_dao() -> HttpError:
    return HttpError(409, "dao_degil", "Bu koşu bir DAO oyunu değil.")


def _dao_preparing() -> HttpError:
    return HttpError(409, "hazirlaniyor", "Koşu hazırlanıyor; ilk hafta henüz yayımlanmadı.")


def _kural_degistiremez() -> HttpError:
    return HttpError(403, "dao_kural_degistiremez", "DAO oyununda kurallar oyun sırasında değiştirilemez.")


def _out_reason(reason: str) -> str:
    return _REASON_OUT.get(reason, reason)


def _change_reason(reason: str) -> str:
    return _CHANGE_OUT.get(reason, reason)


def _opt_text(raw: Any) -> str:
    try:
        text = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False, default=str)
    except (TypeError, ValueError, RecursionError):
        text = "?"
    return text[:MAX_OPTION_LEN]


def _run_or_404(app: App, run_id: str) -> dict:
    handle = app.manager.get(run_id)
    if handle is None:
        raise _not_found()
    return handle


# ---- uç noktalar -----------------------------------------------------------------------------------------------
def make_routes(app: App) -> list[Route]:
    mgr, reg = app.manager, app.registry

    def hello(req: Request) -> Response:
        return Response.json({"ok": True, "server_version": __version__, "model_version": app.model_version,
                              "defaults_hash": app.defaults_hash, "sec_per_week_p50": app.sec_per_week_p50, "live": True,
                              "capabilities": dict(app.capabilities)})

    def registry_(req: Request) -> Response:
        return Response.json({"model_version": app.model_version, **reg.public()})

    def info(req: Request) -> Response:
        """İki bağlam: başlangıç (`run` yok, Kurucu) `unverified`/pasif dışındaki düzenlenebilir ayarlar seçilebilir;
        `?run=<id>` (koşu ortası) yalnız canlı değiştirilebilir ayarlar (`changeable:true`), öteki `reason:"start_only"`.
        `apply:"unknown"` her bağlamda kapalıdır (`unverified`). Seçenekler ayarın durumunu izler (`locked`)."""
        mid = req.query.get("run")
        duration = DEFAULT_DURATION
        locks = frozenset()
        if mid is not None:
            duration = _run_or_404(app, mid)["state"]["durationWeeks"]
            locks = mgr.run_locks(mid)
        live_keys = mgr.live_keys
        settings = []
        for s in reg.settings:
            if not run_editable(s):
                continue
            why = change_block_reason(s, live_keys, locks)
            if why == "start_only" and mid is None:                # başlangıçta canlılık koşulu yok
                why = None
            c = s.codec
            if c["type"] == "enum":
                values = list(c["map"])
            elif c["type"] == "seed":
                values = [str(i) for i in range(len(reg.seeds))]
            elif c["type"] == "bool":
                values = ["true", "false"]
            else:
                values = []
            item = {"id": s.id, "changeable": why is None}
            if why is not None:
                item["reason"] = why
            item["options"] = [{"value": v, "available": True} if why is None
                               else {"value": v, "available": False, "reason": "locked"} for v in values]
            settings.append(item)
        pub = reg.public()
        if app.world_info is None:
            app.world_info = static_world_info(cached_defaults(str(config.MODEL_ROOT)), MAX_CITIES)
        seeds = [{"index": x["index"], "label": "Dünya %d" % (x["index"] + 1)} for x in reg.public_seeds()]   # ham PM_ADJ sızmaz
        return Response.json({
            "kind": "live", "modelNote": app.model_version, "seeds": seeds, "durationWeeks": duration,
            "durations": list(DURATIONS), "capabilities": dict(app.capabilities), "world": app.world_info,
            "settings": settings, "fixedRules": reg.fixed_rules(),
            "dunyalarKalici": bool(app.depo is not None and app.depo.kalici),
            "templates": [{"id": t["id"], "values": t["values"]} for t in pub["templates"]],
            "registry": {"model_version": app.model_version, **pub},
        })

    def availability(req: Request) -> Response:
        body = req.json()
        values = body.get("values")
        if not isinstance(values, dict):
            raise _invalid("invalid_values", "Ayar değerleri bir nesne olmalı.", [("values", "invalid")])
        run_id = body.get("runId")
        locks = frozenset()
        if run_id is not None:                                  # koşu ortası bağlamı: yalnız apply live ayarlar
            if not isinstance(run_id, str):
                raise _invalid("invalid_values", "Koşu kimliği geçersiz.", [("runId", "invalid")])
            _run_or_404(app, run_id)
            locks = mgr.run_locks(run_id)
        res = resolve(reg, values)
        failed = {e.id: e.reason for e in res.errors}
        blocked = []
        for sid, raw in values.items():
            card = reg.by_id.get(sid) if isinstance(sid, str) else None
            why = None
            if card is not None and run_editable(card):
                why = change_block_reason(card, mgr.live_keys, locks) if run_id is not None else (
                    "unverified" if card.apply == "unknown" else None)
                if why == "passive":
                    why = "locked"
            if why is None and str(sid) in failed:
                why = "locked"
            if why is not None:
                blocked.append({"settingId": str(sid), "option": _opt_text(raw), "reason": _BLOCK_OUT.get(why, why)})
        if not blocked:
            return Response.json({"ok": True, "scenarioId": "canli", "blocked": []})
        return Response.json({"ok": False, "scenarioId": None, "blocked": blocked})

    def world_plan(req: Request) -> Response:
        """D7: Kurucu için saf açılış hesabı (model koşusu yok): `{config}` koşu ayarlarıyla aynı biçimdedir (`durationWeeks` yoksa varsayılan alınır).
        Yanıt biçimi `sim/plan.py` başında."""
        body = req.json()
        config_ = body.get("config")
        if not isinstance(config_, dict):
            raise _invalid("invalid_config", "Koşu ayarları geçersiz.", [("config", "invalid")])
        try:
            ov = run_overrides(reg, {"durationWeeks": DEFAULT_DURATION, **config_})
        except RunConfigError as e:
            raise _invalid("invalid_config", "Koşu ayarları geçersiz.", [(x.id, _out_reason(x.reason)) for x in e.errors])
        try:
            return Response.json(plan_mod.world_plan(str(config.MODEL_ROOT), ov, reg.defaults))
        except (RuntimeError, OSError, ValueError) as e:
            raise HttpError(500, "plan_failed", "Açılış hesabı yapılamadı.") from e

    def create(req: Request) -> Response:
        body = req.json()
        config_ = body.get("config")
        if not isinstance(config_, dict):
            raise _invalid("invalid_config", "Koşu ayarları geçersiz.", [("config", "invalid")])
        try:
            handle = mgr.create(config_, body.get("schedule"), body.get("fastForwardTo"))
        except RunConfigError as e:
            raise _invalid("invalid_config", "Koşu ayarları geçersiz.", [(x.id, _out_reason(x.reason)) for x in e.errors])
        except BusyPreparing:
            raise _busy_preparing()
        except TooManyRuns:
            raise _too_many()
        return Response.json(handle, 201)

    def branch(req: Request) -> Response:
        rid = req.params["id"]
        if _run_or_404(app, rid)["state"].get("mode") == "dao":
            raise _kural_degistiremez()
        body = req.json()
        try:
            handle = mgr.branch(rid, body.get("week"), body.get("patch"))
        except UnknownRun:
            raise _not_found()
        except RunConfigError as e:
            raise _invalid("invalid_branch", "Dallanma isteği geçersiz.", [(x.id, _change_reason(x.reason)) for x in e.errors])
        except BusyPreparing:
            raise _busy_preparing()
        except TooManyRuns:
            raise _too_many()
        return Response.json(handle, 201)

    def list_runs(req: Request) -> Response:
        return Response.json(mgr.list_runs())

    def get_run(req: Request) -> Response:
        return Response.json(_run_or_404(app, req.params["id"]))

    def control(req: Request) -> Response:
        rid = req.params["id"]
        _run_or_404(app, rid)
        body = req.json()
        bad = []
        action = body.get("action")
        if not isinstance(action, str) or action not in ACTIONS:
            bad.append(("action", "invalid"))
        speed = body.get("speed")
        if speed is not None and (type(speed) is not int or speed not in SPEEDS):
            bad.append(("speed", "invalid"))
        if bad:
            raise _invalid("invalid_control", "Denetim isteği geçersiz.", bad)
        try:
            return Response.json(mgr.control(rid, action, speed))
        except UnknownRun:
            raise _not_found()
        except NotDao:
            raise _not_dao()

    def changes(req: Request) -> Response:
        rid = req.params["id"]
        if _run_or_404(app, rid)["state"].get("mode") == "dao":
            raise _kural_degistiremez()
        body = req.json()
        bad = []
        if body.get("from") != "next_week":
            bad.append(("from", "invalid"))
        if not isinstance(body.get("patch"), dict):
            bad.append(("patch", "invalid"))
        note = body.get("note")
        if note is not None and (not isinstance(note, str) or len(note) > MAX_NOTE_LEN):
            bad.append(("note", "invalid"))
        if bad:
            raise _invalid("invalid_change", "Değişiklik isteği geçersiz.", bad)
        return Response.json(apply_change(app, rid, body))

    def weeks(req: Request) -> Response:
        rid = req.params["id"]
        duration = _run_or_404(app, rid)["state"]["durationWeeks"]
        bounds = {}
        bad = []
        for key in ("from", "to"):
            raw = req.query.get(key)
            if raw is None or not re.fullmatch(r"[0-9]{1,6}", raw):
                bad.append((key, "invalid"))
            else:
                bounds[key] = int(raw)
        if not bad and not 1 <= bounds["from"] <= bounds["to"] <= duration:
            bad = [("from", "invalid"), ("to", "invalid")]
        if bad:
            raise _invalid("invalid_range", "Hafta aralığı geçersiz.", bad)
        try:
            return Response.json(mgr.weeks(rid, bounds["from"], bounds["to"]))
        except UnknownRun:
            raise _not_found()

    def drawer(req: Request) -> Response:
        rid = req.params["id"]
        released = _run_or_404(app, rid)["state"]["week"]            # çekmece yayımlanan haftayı geçemez
        kind, ref = req.params["kind"], req.params["ref"]
        bad = []
        if kind not in drawers.KINDS:
            bad.append(("kind", "invalid"))
        if not drawers.REF_RE.fullmatch(ref):
            bad.append(("ref", "invalid"))
        week = None
        raw = req.query.get("week")
        if raw is not None:
            if re.fullmatch(r"[0-9]{1,6}", raw) and 1 <= int(raw) <= released:
                week = int(raw)
            else:
                bad.append(("week", "invalid"))
        if bad:
            raise _invalid("invalid_drawer", "Çekmece isteği geçersiz.", bad, 400)
        try:
            return Response.json(mgr.drawer(rid, kind, ref, week))
        except UnknownRun:
            raise _not_found()
        except DrawerNotFound:
            raise HttpError(404, "not_found", "Bu kayıt bulunamadı.")

    def dao_get(req: Request) -> Response:
        """Yayımlanan son haftanın DAO gözlemi (`gozlem(W)` gövdesi); bitmiş koşuda aynı gövde `daoSonuc`tur."""
        rid = req.params["id"]
        _run_or_404(app, rid)
        try:
            return Response.json(mgr.dao_gozlem(rid))
        except UnknownRun:
            raise _not_found()
        except NotDao:
            raise _not_dao()
        except DaoCrashed:
            raise HttpError(409, "kosu_cokmus", "Koşunun işçisi çöktü; gözlem yok. Yeni bir koşu başlatın.")
        except DaoPreparing:
            raise _dao_preparing()

    def dao_karar(req: Request) -> Response:
        """202 `{kabul:true, hafta}`; işçi reddederse `422 {error:{code:<işçinin kodu>, fields:[{id,reason}]}}` (`reason` modelin nedeni: `ahirda`, `ahirda_degil`, `isletme_sahibi`, `geri_alinmaz` ...; nedensiz alanda `invalid`). Kayıt yalnız onaydan sonra (`kararlar.jsonl`)."""
        rid = req.params["id"]
        _run_or_404(app, rid)
        body = req.json()
        try:
            res = mgr.dao_karar(rid, body)
        except UnknownRun:
            raise _not_found()
        except NotDao:
            raise _not_dao()
        except DaoPreparing:
            raise _dao_preparing()
        except DaoFinished:
            raise HttpError(409, "kosu_bitti", "Koşu bitti; karar verilemez.")
        except DaoTimeout:
            raise HttpError(504, "karar_belirsiz", "Karar yine de uygulanmış olabilir; yeniden denemeden önce gözlemi yenileyin.")
        if res.get("kabul") is True:
            return Response.json({"kabul": True, "hafta": res["hafta"]}, 202)
        raise HttpError(422, str(res.get("kod") or "karar_gecersiz"), "Karar kabul edilmedi.", _fields([(f["id"], f["reason"]) if isinstance(f, dict) else (f, "invalid") for f in res.get("fields", [])]))

    def delete(req: Request) -> Response:
        try:
            mgr.delete(req.params["id"])
        except UnknownRun:
            raise _not_found()
        return Response(204, None, "text/plain; charset=utf-8")

    def events(req: Request):
        try:
            sub = mgr.subscribe(req.params["id"])
        except UnknownRun:
            raise _not_found()

        def gen(ping_s):
            n = 0
            try:
                while True:
                    item = sub.next(ping_s)
                    if item is None:
                        yield None                      # boşta: `: ping`
                        continue
                    if item[0] == CLOSED:
                        return
                    n += 1
                    yield (n, item[0], item[1])
            finally:
                sub.close()

        try:
            sse.stream(req.handler, gen, ping_s=app.ping_s)
        finally:
            sub.close()                                 # akış hiç başlamadıysa da abonelik kalmaz
        return None

    rid = r"(?P<id>[^/]+)"
    job_routes = []
    if app.jobs is not None:
        from ..jobs import routes as job_routes_mod
        job_routes = job_routes_mod.make_routes(app)
    dunya_routes = []
    if app.depo is not None:
        from ..dunyalar import uclar
        dunya_routes = uclar.make_routes(app)
    return job_routes + dunya_routes + [
        Route("GET", re.compile(r"/hello"), hello),
        Route("GET", re.compile(r"/registry"), registry_),
        Route("GET", re.compile(r"/info"), info),
        Route("POST", re.compile(r"/availability"), availability),
        Route("POST", re.compile(r"/world/plan"), world_plan),
        Route("POST", re.compile(r"/runs"), create),
        Route("GET", re.compile(r"/runs"), list_runs),
        Route("POST", re.compile(rf"/runs/{rid}/branch"), branch),
        Route("GET", re.compile(rf"/runs/{rid}"), get_run),
        Route("DELETE", re.compile(rf"/runs/{rid}"), delete),
        Route("GET", re.compile(rf"/runs/{rid}/events"), events),
        Route("POST", re.compile(rf"/runs/{rid}/control"), control),
        Route("GET", re.compile(rf"/runs/{rid}/dao"), dao_get),
        Route("POST", re.compile(rf"/runs/{rid}/dao/karar"), dao_karar),
        Route("POST", re.compile(rf"/runs/{rid}/changes"), changes),
        Route("GET", re.compile(rf"/runs/{rid}/weeks"), weeks),
        Route("GET", re.compile(rf"/runs/{rid}/drawer/(?P<kind>[^/]+)/(?P<ref>[^/]+)"), drawer),
    ]


def apply_change(app: App, run_id: str, body: dict) -> dict:
    """`ChangeResult` (200 her iki durumda): kabul `{accepted:true, runId, mode:"live", scenarioId, seamWeek, version}`,
    ret `{accepted:false, fields:[{id, reason}]}` (reason: locked/invalid/busy/ended/start_only/passive). Yama atomiktir;
    `fields` her reddi listeler. Kapılar `RunManager.apply_change`'te: koşu bitti/çöktü -> ended, hesaplama sürüyor -> busy,
    bilinmeyen/düzenlenemez -> locked, pasif -> passive, canlı olmayan -> start_only, değer -> invalid;
    `apply:"unknown"` (unverified) dışarıya `locked` olarak çevrilir."""
    try:
        res = app.manager.apply_change(run_id, body["patch"], body.get("note"))
    except UnknownRun:
        raise _not_found()
    if not res.get("accepted"):
        res = {"accepted": False, "fields": [{"id": f["id"], "reason": _change_reason(f["reason"])} for f in res["fields"]]}
    return res
