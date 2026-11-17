"""Sunucu sabitleri ve alt süreç ortamı."""
from __future__ import annotations

import functools
import json
import os
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8765

SERVER_ROOT = Path(__file__).resolve().parent.parent          # simulasyon/arayuz/server
REPO_ROOT = SERVER_ROOT.parent.parent.parent                   # depo kökü
MODEL_ROOT = Path(
    os.environ.get("OYUN_MODEL_ROOT")
    or REPO_ROOT / "simulasyon" / "kagit-ustu" / "modulerlestirme"
).resolve()

# Canlı hız modeli (ms/hafta; 16x için 0: tampon varsa hemen).
LIVE_WEEK_MS = {1: 2000, 4: 500, 16: 0}
LOOKAHEAD = 2
MAX_RUNS = 3  # S2 çoklu koşu: bellek/CPU sınırı; yenisi gelince abonesiz en eski çıkar, hepsi abonliyse 429
IDLE_PAUSE_S = 15
LOG_DIR = Path(os.environ.get("OYUN_LOG_DIR") or SERVER_ROOT / "logs")


def runs_dir() -> Path:
    """D1: koşuların diske yazıldığı dizin (`OYUN_RUNS_DIR` ya da `--runs-dir`; varsayılan simulasyon/arayuz/kosular, .gitignore'da)."""
    return Path(os.environ.get("OYUN_RUNS_DIR") or REPO_ROOT / "simulasyon" / "arayuz" / "kosular")

# Yalnız --dev ile eklenir; :3201 bilerek yok (yalnız açık --origin ile).
DEFAULT_ORIGINS = frozenset({"http://localhost:3000", "http://127.0.0.1:3000"})

DECISIONS_PATH = SERVER_ROOT / "bench" / "decisions.json"

_ENV_WHITELIST = ("PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SYSTEMROOT", "OYUN_HOST", "OYUN_QUICK",
                  "OYUN_FAKE_FAIL_WEEK", "OYUN_FAKE_PRINT", "OYUN_FAKE_STDERR_KB", "OYUN_FAKE_STEP_MS",
                  "OYUN_FAKE_CRASH_WEEK")


def child_env(extra: dict | None = None) -> dict:
    """İşçi/alt süreç ortamı: beyaz liste + PYTHONPATH=SERVER_ROOT (yalnız o)."""
    env = {k: os.environ[k] for k in _ENV_WHITELIST if k in os.environ}
    env["OYUN_MODEL_ROOT"] = str(MODEL_ROOT)
    env["PYTHONUNBUFFERED"] = "1"
    env.update({str(k): str(v) for k, v in (extra or {}).items()})
    env["PYTHONPATH"] = str(SERVER_ROOT)
    return env


def load_decisions() -> dict:
    """A1 ölçüm kararı: {lookahead, seam_mode, max_runs}. Dosya yoksa/bozuksa varsayılan."""
    out = {"lookahead": LOOKAHEAD, "seam_mode": "frontier", "max_runs": MAX_RUNS}
    try:
        data = json.loads(DECISIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out
    if not isinstance(data, dict):
        return out
    la = data.get("lookahead")
    if isinstance(la, int) and not isinstance(la, bool) and la in (1, 2, 3):
        out["lookahead"] = la
    sm = data.get("seam_mode")
    if isinstance(sm, str) and sm:
        out["seam_mode"] = sm
    out["max_runs"] = MAX_RUNS  # sabit
    return out


DEFAULT_LIVE_KEYS = ("CORP_TAX", "TRANS_SUPPORT", "WAGE_TAX")
LIVE_APPLY = ("live", "live_sync")        # koşu ortasında yamalanabilir `apply` sınıfları


BENCH_RESULT = SERVER_ROOT / "bench" / "results" / "bench-sonuc.json"
DERIVED_FALLBACK = frozenset({"SALES_TAX"})     # ölçüm dosyası yoksa bilinen türetim farkı anahtarı (SALES_TAX -> MARKET_MARKUP0)


APPLY_CLASSES = SERVER_ROOT.parent / "registry" / "apply_classes.json"      # R2 kanıt dosyası (kayıt `apply` kaynağı)
DERIVED_REASONS = frozenset({"turetim", "w_kopya", "modul_duzeyi", "anahtar_kilidi", "yon_ters"})   # son ikisi: koşu ortası değişim anlamı kilidi (R2-ek2)


def _apply_derived() -> frozenset:
    """R2 kanıtından: `derived_diff` dolu ya da nedeni türetim/W kopyası/modül düzeyi olan anahtarlar."""
    try:
        keys = json.loads(APPLY_CLASSES.read_text(encoding="utf-8"))["keys"]
        return frozenset(k for k, v in keys.items() if isinstance(v, dict) and (v.get("derived_diff") or v.get("reason") in DERIVED_REASONS))
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:   # sessiz boş küme ikinci kapıyı açardı: kapalı başarısızlık
        raise RuntimeError("R2 kanıt dosyası okunamadı (%s): %s" % (APPLY_CLASSES, e)) from e


@functools.lru_cache(maxsize=1)
def _bench_derived() -> frozenset:
    try:
        lp = json.loads(BENCH_RESULT.read_text(encoding="utf-8"))["livepatch"]
        bench = frozenset(k for k, v in lp.items() if isinstance(v, dict) and v.get("derived_diff"))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        bench = DERIVED_FALLBACK
    return bench | _apply_derived()


def derived_diff_keys() -> frozenset:
    """Kuruluşta türetilen sabitleri değiştiren (A1 ölçümü `derived_diff` boş değil) anahtarlar: kayıt `apply` ne derse
    desin, `W_SYNC` yeniden türetim tarifi yoksa canlı yamalanamaz. Kayıttan BAĞIMSIZ ikinci kapı (ModelHost de denetler)."""
    from .sim import livepatch
    bad = _bench_derived()
    return frozenset(k for k in bad if k not in livepatch.W_SYNC)


def live_keys_from_registry(registry) -> frozenset | None:
    """DK-17: kayıttaki `apply in {live, live_sync}` kartların model parametreleri; ancak (a) türetim farkı olup `W_SYNC`
    tarifi olmayan anahtarlar ve (b) `live_sync` kartında `W_SYNC` tarifi olmayan parametreler DIŞARIDA bırakılır.
    Kayıt `apply` taşımıyorsa (kart yoksa ya da alan yoksa; gerçek kayıtta alan zorunlu) None döner."""
    from .sim import livepatch
    cards = list(getattr(registry, "settings", None) or [])
    if not cards or not any(hasattr(c, "apply") for c in cards):
        return None
    blocked = derived_diff_keys()
    keys = set()
    for c in cards:
        a = getattr(c, "apply", None)
        if a not in LIVE_APPLY:
            continue
        for p in c.params:
            if p in blocked or (a == "live_sync" and p not in livepatch.W_SYNC):
                continue
            keys.add(p)
    return frozenset(keys)


def load_decisions_live_keys() -> frozenset:
    """A1 kararı `mvp_live_keys`. Dosya yoksa/bozuksa varsayılan üç anahtar."""
    try:
        keys = json.loads(DECISIONS_PATH.read_text(encoding="utf-8")).get("mvp_live_keys")
    except (OSError, ValueError, AttributeError):
        keys = None
    if isinstance(keys, list) and keys and all(isinstance(k, str) for k in keys):
        return frozenset(keys)
    return frozenset(DEFAULT_LIVE_KEYS)


def load_live_keys(registry=None) -> frozenset:
    """Canlı yamalanabilir anahtarlar. `registry` verilirse kayıt kartlarından türetilir (DK-17); kayıt `apply`
    içermiyorsa ya da hiç verilmediyse `bench/decisions.json` `mvp_live_keys`. Yönetici bunu başlangıçta BİR kez çağırır."""
    derived = live_keys_from_registry(registry) if registry is not None else None
    return derived if derived is not None else load_decisions_live_keys()
