"""bench ortak yardımcıları (A1): model kurulumu, RSS ölçümü, sonuç birleştirme.

Her betik tek süreçte tek `simbuild.build` yapar; `PYTHONHASHSEED=0` değilse kendini bu ortamla yeniden başlatır.
Model yolu `OYUN_MODEL_ROOT` ile geçersiz kılınabilir (varsayılan: <repo>/simulasyon/kagit-ustu/modulerlestirme).
"""
import atexit
import fcntl
import json
import os
import subprocess
import shutil
import sys
import tempfile
import time

BENCH_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_ROOT = os.path.dirname(BENCH_DIR)
REPO = os.path.abspath(os.path.join(SERVER_ROOT, "..", "..", ".."))
MODEL_ROOT = os.environ.get("OYUN_MODEL_ROOT") or os.path.join(REPO, "simulasyon", "kagit-ustu", "modulerlestirme")
RESULTS = os.path.join(BENCH_DIR, "results", "bench-sonuc.json")

PATCH_WEEK = 20
LIVE_KEYS = {"TRANS_SUPPORT": 0, "WAGE_TAX": 0.25, "CORP_TAX": 0.4, "SALES_TAX": 0.10}   # P-10: yeni değerler (varsayılanlardan farklı)


def ensure_hashseed(module):
    """PYTHONHASHSEED=0 değilse `python3 -P -m <module> <argv>` ile yeniden başlat (açık PYTHONPATH)."""
    if os.environ.get("PYTHONHASHSEED") != "0":
        env = dict(os.environ, PYTHONHASHSEED="0", PYTHONPATH=SERVER_ROOT)
        os.execve(sys.executable, [sys.executable, "-P", "-m", module] + sys.argv[1:], env)


class Model:
    """Kurulmuş model kopyası: m (model_mod), mods (simkit.* modülleri), new_world/start_world/week_step."""

    def __init__(self, overrides=None, csv_dir=None):
        self.csv_dir = csv_dir or tempfile.mkdtemp(prefix="oyun-bench-")
        if csv_dir is None:
            atexit.register(shutil.rmtree, self.csv_dir, True)          # süreç çıkışında geçici dizini sil
        os.environ["WEEKLY_CSV"] = os.path.join(self.csv_dir, "w.csv")      # params içe aktarmada okunur; yalnız bellek satırları için
        sys.path.insert(0, MODEL_ROOT)
        import simbuild
        self.m = simbuild.build(simbuild.Params(**(overrides or {})))
        self.mods = self.m._modules
        self.new_world = self.m.new_world
        self.start_world = self.mods["simkit.engine"].start_world
        self.week_step = self.mods["simkit.step"].week_step
        self.params = self.mods["simkit.params"]

    def world(self, weeks=200, n_cities=5):
        W = self.new_world(weeks, n_cities, True)
        self.start_world(W)
        return W

    def patch(self, key, value, all_modules=True):
        """Küresel adı yazar: all_modules ise adı __dict__'inde olan her simkit modülüne, değilse yalnız simkit.params."""
        n = 0
        for name, mod in self.mods.items():
            if (all_modules or name == "simkit.params") and key in mod.__dict__:
                setattr(mod, key, value)
                n += 1
        return n


def rss_mb(pid=None):
    """Anlık RSS (MB), `ps` ile."""
    out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid or os.getpid())], capture_output=True, text=True).stdout.strip()
    return int(out) / 1024.0


def peak_rss_mb():
    """Süreç ömrü tepe RSS (MB): `ru_maxrss` (macOS bayt, Linux KB). Anlık `ps` ölçümü bellek sıkıştırmasında düşük kalır."""
    import resource
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return v / (1024.0 * 1024.0) if sys.platform == "darwin" else v / 1024.0


def median(xs):
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def rows_json(rows):
    return [json.dumps(r, sort_keys=True, default=repr) for r in rows]


def merge_results(update):
    """bench-sonuc.json'a anahtar birleştirir (kilitli; betikler sıralı ya da paralel koşabilir)."""
    os.makedirs(os.path.dirname(RESULTS), exist_ok=True)
    with open(RESULTS + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        cur = {}
        if os.path.exists(RESULTS):
            with open(RESULTS) as fh:
                cur = json.load(fh)
        cur.update(update)
        with open(RESULTS, "w") as fh:
            json.dump(cur, fh, indent=2, sort_keys=True, ensure_ascii=False)
            fh.write("\n")
    return cur


def spawn_child(module, args, env_extra=None):
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "OYUN_MODEL_ROOT")}
    env.update(PYTHONHASHSEED="0", PYTHONPATH=SERVER_ROOT)
    env.update(env_extra or {})
    return subprocess.Popen([sys.executable, "-P", "-m", module] + list(args), env=env)


def now():
    return time.perf_counter()
