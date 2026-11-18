"""B4a: kayıt ve devam (Python tarafı). Görüntü (`goruntu.py`, host + dünya) ile birlikte yazılması gereken YÖNETİCİ durumu, yeniden oynatma günlüğü ve oynatma sürücüsü.

Akış (B4b/B5 JS tarafı bunları çağırır; tel biçimi `tel_b4.json`):
  - `disa_aktar(manager, koşu)` yönetici durumunu JSON'a dönüşebilir sözlük olarak verir; `TarayiciCekirdegi.goruntu_al` bunu görüntü parçalarıyla birlikte döner.
  - `ice_aktar` görüntü yüklenmiş işçiyle koşuyu geri kurar (paketlerin kendisi JS'te: son <= 4 haftanın paketi `paketler` olarak verilir).
  - `oynat` günlükteki kararları/şart değişikliklerini kendi haftalarında (dikiş = host haftası) uygulayarak hedef haftaya dek adım adım ilerler. Yeniden oynatma ADIM ADIM yönetici
    yolundan geçer (`control step` + `advance_once` + `pump`): paketler kesintisiz koşuyla aynı kodla üretilir (bayt eşitliği testlerle kilitli). Reddedilen/sapan giriş
    oynatmayı DURDURUR ve açık sonuç verir (sessiz sapma yok); koşu bellekte kalır, çağıran silebilir.

Yönetici durumu eksiksizliği: `_Run.__dict__` her anahtarı `ALANLAR` (yazılır) ya da `DISARIDA` (gerekçeyle yazılmaz) içinde olmalıdır (`test_alanlar_run_ile_eksiksiz`).
"""
from __future__ import annotations

import copy
import json
from typing import Any

from ..runs.manager import RunManager, TooManyRuns, _Run
from .goruntu import UyumsuzGoruntu

SEMA = 1


class GoruntuHazirDegil(RuntimeError):
    """Görüntü şimdi alınamaz (hazırlık, bekleyen değişiklik/karar/çekmece, koşu bitti/çöktü). B4b: kısa süre sonra yineler."""


# ---- eksiksizlik: `_Run` her alanı ya yazılır ya da gerekçeyle dışarıda -------------------------------------------------
ALANLAR = (
    "id", "duration", "world_id", "world_values", "goals", "name", "city_names", "seed_index", "scenario_id", "overrides", "later_overrides", "values",
    "status", "speed", "version", "accepted_version", "version_sets", "version_from", "version_notes", "locks", "dao0", "harita0", "model_version",
    "released", "packet_base", "hist_worlds", "hist_versions", "buf", "worker_week", "target", "credit", "vevents_due", "vevents",
    "raw_config", "schedule", "tarif_takvim", "sched_total", "sched_applied", "parent_id", "fork_week", "mode", "dunya_kodu", "oyuncu",
    "flush_one", "olay", "dao_sonuc", "karar_sira", "harita_taban", "gunluk_sira",
)
DISARIDA = {
    "worker": "görüntü (host + dünya) taşır; geri kurulurken yeni işçi",
    "ready": "görüntü yüklenmiş işçi hazırdır (geri kurulurken True)",
    "owed_since": "duvar saati; yeniden kurulurken None",
    "error": "çökmüş koşu görüntülenmez",
    "packets": "paketler JS'te (B3); son pencere `devam(paketler=...)` ile verilir",
    "arrival": "duvar saati (zamanında yayım ölçüsü); buf paketleri geri kurulurken 'şimdi' ile işaretlenir",
    "last_release": "duvar saati; yeniden kurulurken şimdi",
    "streak": "pacer histerezisi (model çıktısını etkilemez)", "buffering": "pacer histerezisi",
    "computing": "bekleyen değişiklik varken görüntü alınmaz (GoruntuHazirDegil)", "pending": "aynı",
    "subs": "abonelikler yeniden kurulur (koşu yaratılınca hemen abone ol)",
    "idle_deadline": "duvar saati; abonesizlik süresi yeniden başlar", "last_state_t": "state olay hız sınırı", "dirty": "state olay hız sınırı",
    "step_times": "süre ölçümü (p50); yeniden ölçülür", "step_start": "süre ölçümü",
    "prep": "hızlı ileri sarma sürerken görüntü alınmaz (GoruntuHazirDegil)",
    "drawer_seq": "istek kimliği sayacı: yalnız çağrı süresince anlamlı", "drawer_reqs": "bekleyen istek yok (görüntü alınırken doğrulanır)",
    "disk": "tarayıcıda disk yok", "disk_final": "tarayıcıda disk yok", "started_wall": "duvar saati", "ended_wall": "duvar saati",
    "karar_seq": "istek kimliği sayacı", "karar_reqs": "bekleyen istek yok (doğrulanır)", "karar_info": "aynı",
    "firm_buf": "yalnız diske yazım içindir (tarayıcıda disk yok)", "last_firms": "yalnız diske yazım içindir",
    "gunluk": "yeniden oynatma günlüğü JS deposundadır (`gunluk_al` ile verilir); yalnız sayaç (`gunluk_sira`) yazılır",
}


def _json(o: Any) -> Any:
    return json.loads(json.dumps(o, ensure_ascii=False, separators=(",", ":")))


def _hazir_mi(m: RunManager, run: _Run) -> None:
    if run.worker is None or run.status in ("ended", "failed"):
        raise GoruntuHazirDegil("koşu bitti ya da çöktü")
    if run.prep is not None:
        raise GoruntuHazirDegil("hızlı ileri sarma sürüyor")
    if run.pending is not None or run.computing:
        raise GoruntuHazirDegil("bekleyen değişiklik var")
    if run.drawer_reqs or run.karar_reqs:
        raise GoruntuHazirDegil("bekleyen çekmece/karar isteği var")
    if getattr(run.worker, "_out", None):
        raise GoruntuHazirDegil("işlenmemiş işçi olayı var")


def disa_aktar(m: RunManager, run_id: str, goruntu_kimligi: str) -> dict:
    """Yönetici durumu (JSON'a dönüşebilir sözlük). Çağıran görüntüyü AYNI anda (aynı kilit/çağrı) alır; `goruntu_kimligi` ikisini eşler."""
    with m._lock:
        run = m._get(run_id)
        m._drain(run, m._clock())                                   # işçi olayları yöneticiye işlenmiş olsun (aksi halde host yöneticiden ileridedir)
        _hazir_mi(m, run)
        d: dict[str, Any] = {k: getattr(run, k) for k in ALANLAR}
        d["version_sets"] = [[n, v] for n, v in sorted(run.version_sets.items())]
        d["version_from"] = [[n, v] for n, v in sorted(run.version_from.items())]
        d["version_notes"] = [[n, v] for n, v in sorted(run.version_notes.items())]
        d["locks"] = sorted(run.locks)
        d["vevents_due"] = [[s, e] for s, e in run.vevents_due]
        d["buf"] = [run.buf[w] for w in sorted(run.buf)]
        d["sema"], d["goruntu_kimligi"] = SEMA, goruntu_kimligi
        return _json(d)


def _yer_ac(m: RunManager, korunan: str | None) -> None:
    """`create` ile aynı kural: `MAX_RUNS` doluysa abonesiz en eski koşular çıkar; yetmezse `TooManyRuns` (kilit altında)."""
    max_runs = max(1, int(m.cfg.MAX_RUNS))
    need = len(m._runs) - max_runs + 1
    if need > 0:
        victims = [rid for rid, r in m._runs.items() if not r.subs and rid != korunan][:need]
        if len(victims) < need:
            raise TooManyRuns()
        for rid in victims:
            m._drop(rid, graceful=True)


def ice_aktar(m: RunManager, d: dict, worker: Any, run_id: str | None = None, ebeveyn: tuple[str, int] | None = None, paketler: list | None = None) -> _Run:
    """Görüntüsü yüklenmiş `worker` ile koşuyu kayda alır (kilit altında çağrılır). Koşu `paused` kurulur (oyuncu başlatır); paketler/abonelikler boş."""
    if d.get("sema") != SEMA:
        raise UyumsuzGoruntu({"yonetici_sema": (d.get("sema"), SEMA)})
    try:
        return _ice_aktar(m, copy.deepcopy(d), worker, run_id, ebeveyn, copy.deepcopy(paketler))
    except (KeyError, TypeError) as e:                              # alan kümesi değişmiş / bozuk durum: sürüm uyumsuzluğu gibi ele alınır
        raise UyumsuzGoruntu({"yonetici": (type(e).__name__, str(e))}) from e


def _ice_aktar(m: RunManager, d: dict, worker: Any, run_id: str | None, ebeveyn: tuple[str, int] | None, paketler: list | None) -> _Run:
    eski_id = d["id"]
    rid = run_id or eski_id
    cfg_run = {"duration": d["duration"], "worldScenarioId": d["world_id"], "worldScenarioValues": d["world_values"], "goals": d["goals"],
               "name": d["name"], "cityNames": d["city_names"], "seedIndex": d["seed_index"], "templateId": d["scenario_id"], "mode": d["mode"]}
    run = _Run(rid, cfg_run, d["overrides"], d["values"], worker)
    for k in ("later_overrides", "version", "accepted_version", "dao0", "harita0", "model_version", "released", "worker_week", "target", "credit", "vevents",
              "raw_config", "schedule", "tarif_takvim", "sched_total", "sched_applied", "dunya_kodu", "oyuncu", "flush_one", "olay", "dao_sonuc", "karar_sira",
              "harita_taban", "gunluk_sira", "hist_worlds", "hist_versions", "speed"):
        setattr(run, k, d[k])
    run.version_sets = {n: v for n, v in d["version_sets"]}
    run.version_from = {n: v for n, v in d["version_from"]}
    run.version_notes = {n: v for n, v in d["version_notes"]}
    run.locks = frozenset(d["locks"])
    run.vevents_due = [(s, e) for s, e in d["vevents_due"]]
    now = m._clock()
    pk = [p for p in (d["buf"] or [])]
    for p in pk:
        p["run_id"] = rid
    run.buf = {p["week"]: p for p in pk}
    run.arrival = {w: now for w in run.buf}
    run.ready, run.status, run.last_release = True, "paused", now
    run.parent_id, run.fork_week = (ebeveyn if ebeveyn else (d["parent_id"], d["fork_week"]))
    pencere = list(paketler or [])
    for p in pencere:
        p["run_id"] = rid
    if m.packet_keep is not None:
        pencere = pencere[-m.packet_keep:]
    if pencere:
        hf = [p["week"] for p in pencere]
        if hf != list(range(hf[0], hf[0] + len(hf))) or hf[-1] != run.released:
            raise ValueError("paketler son yayımlanan haftada biten ardışık haftalar olmalı: %r (yayımlanan %d)" % (hf, run.released))
    run.packets = pencere
    run.packet_base = run.released - len(pencere)
    m._runs[rid] = run
    return run


# ---- yeniden oynatma sürücüsü ------------------------------------------------------------------------------------------
def _sonuc(durum: str, run: _Run, uygulanan: int, kalan: int, **ek: Any) -> dict:
    return {"durum": durum, "kosu_id": run.id, "hafta": run.released, "uygulanan": uygulanan, "kalan": kalan, **ek}


def _giris_sekli(e: Any) -> str | None:
    """Günlük girişinin şekil hatası (None = geçerli)."""
    if not isinstance(e, dict):
        return "giris_nesne_degil"
    for k in ("sira", "dikis"):
        if type(e.get(k)) is not int or e[k] < 0:
            return "%s_gecersiz" % k
    if e.get("tur") == "karar":
        return None if isinstance(e.get("karar"), dict) else "karar_gecersiz"
    if e.get("tur") == "sart":
        return None if isinstance(e.get("yama"), dict) else "yama_gecersiz"
    return "bilinmeyen_tur"


def _uygula(m: RunManager, run: _Run, e: dict) -> dict | None:
    """Günlük girişini uygular. Sorun varsa `{"durum": "reddedildi"|"sapma", "giris", "neden", ...}` (kısmi sonuç), yoksa None. Hiçbir istisna kaçmaz (sonuç sözlüğüne çevrilir);
    şekil ve `sira` bitişikliği UYGULAMADAN önce denetlenir; DAO koşusunda şart değişikliği canlı yolla aynı kapıdan reddedilir (`dao_kural_degistiremez`)."""
    hata = _giris_sekli(e)
    if hata is not None:
        return {"durum": "sapma", "giris": e, "neden": hata}
    if e["sira"] != run.gunluk_sira + 1:
        return {"durum": "sapma", "giris": e, "neden": "gunluk_sirasi", "beklenen": run.gunluk_sira + 1, "gercek": e["sira"]}
    try:
        if e["tur"] == "karar":
            r = m.dao_karar(run.id, copy.deepcopy(e["karar"]))
            if r.get("kabul") is not True:
                return {"durum": "reddedildi", "giris": e, "neden": r.get("kod"), "fields": r.get("fields")}
            if r.get("hafta") != e["dikis"] + 1:
                return {"durum": "sapma", "giris": e, "neden": "uygulama_haftasi", "beklenen": e["dikis"] + 1, "gercek": r.get("hafta")}
        else:
            if run.mode == "dao":
                return {"durum": "reddedildi", "giris": e, "neden": "dao_kural_degistiremez", "fields": []}
            r = m.apply_change(run.id, copy.deepcopy(e["yama"]), e.get("not"), timeout=60.0)
            if r.get("accepted") is not True:
                return {"durum": "reddedildi", "giris": e, "neden": "sart_reddedildi", "fields": r.get("fields")}
            if r.get("seamWeek") != e["dikis"] or r.get("version") != e.get("surum"):
                return {"durum": "sapma", "giris": e, "neden": "dikis_ya_da_surum", "beklenen": [e["dikis"], e.get("surum")], "gercek": [r.get("seamWeek"), r.get("version")]}
    except Exception as x:                                              # noqa: BLE001  NotDao, DaoFinished, DaoTimeout, DaoPreparing, ...: açık sonuç
        return {"durum": "reddedildi", "giris": e, "neden": type(x).__name__, "fields": []}
    if run.gunluk_sira != e["sira"]:
        return {"durum": "sapma", "giris": e, "neden": "gunluk_sirasi", "beklenen": e["sira"], "gercek": run.gunluk_sira}
    return None


def _adim(m: RunManager, run: _Run) -> bool:
    """Tek hafta yayımlar (`control step`: duraklatılmış koşuda bir kredi; işçi o haftayı hesaplar; `pump` yayımlar). False = ilerlenemedi."""
    beklenen = run.released + 1
    m.control(run.id, "step")
    if run.worker is not None:
        run.worker.advance_once()
    m.pump()
    if run.released < beklenen and run.status not in ("ended", "failed"):
        m.pump()
    return run.released >= beklenen


def oynat(m: RunManager, run_id: str, gunluk: list, hedef: int, ilerleme: Any = None) -> dict:
    """`hedef` yayımlanan haftaya dek günlüğü uygulayarak ilerler (`sira` > koşunun `gunluk_sira`sı olan girişler, `sira` sırasıyla; her giriş host haftası = `dikis` iken).
    `ilerleme(hafta)`: her yayımlanan haftadan sonra bir kez çağrılır (iptal yok: Worker terminate).
    Sonuç: `{"durum": "tamam"|"reddedildi"|"sapma"|"takildi"|"basarisiz", "kosu_id", "hafta", "uygulanan", "kalan", ...}`; tamam dışında `giris` (sorunlu giriş) ve `neden` bulunur."""
    run = m._get(run_id)
    ham = [e for e in (gunluk or [])]
    kotu = next((e for e in ham if _giris_sekli(e) is not None), None)
    if kotu is not None:
        return _sonuc("sapma", run, 0, len(ham), giris=kotu, neden=_giris_sekli(kotu))
    giris = sorted((e for e in ham if e["sira"] > run.gunluk_sira), key=lambda e: e["sira"])
    i = uygulanan = 0
    m.pump()                                                           # ready ve bekleyen olaylar işlensin
    while True:
        while i < len(giris) and giris[i]["dikis"] <= run.worker_week:
            e = giris[i]
            if e["dikis"] < run.worker_week:
                return _sonuc("sapma", run, uygulanan, len(giris) - i, giris=e, neden="dikis_gecti", gercek=run.worker_week)
            sorun = _uygula(m, run, e)
            if sorun is not None:
                return _sonuc(sorun.pop("durum"), run, uygulanan, len(giris) - i, **sorun)
            i, uygulanan = i + 1, uygulanan + 1
        if run.status == "failed":
            return _sonuc("basarisiz", run, uygulanan, len(giris) - i, neden=(run.error or {}).get("messageKey"))
        if run.released >= hedef or run.status == "ended":
            break
        if not _adim(m, run):
            return _sonuc("takildi" if run.status != "failed" else "basarisiz", run, uygulanan, len(giris) - i, neden="hafta_yayimlanmadi")
        if ilerleme is not None:
            ilerleme(run.released)
    return _sonuc("tamam", run, uygulanan, len(giris) - i)
