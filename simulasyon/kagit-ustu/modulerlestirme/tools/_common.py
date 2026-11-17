"""Araçlar için ortak yardımcılar (yalnız standart kütüphane).

Bu dosya bir araç değildir; golden.py, digest.py, coverage.py, determinism_check.py tarafından içe aktarılır.
Kural: model dosyası HİÇBİR ZAMAN değiştirilmez; her koşu ayrı süreçte, açık PYTHONHASHSEED ile yapılır.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)                       # .../modulerlestirme
GOLDEN = os.path.join(ROOT, "golden")
SNAP = os.path.join(ROOT, "snapshot")
DEFAULT_MANIFEST = os.path.join(GOLDEN, "manifest.json")
MAX_JOBS = 6


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(path):
    with open(path, "rb") as f:
        return sha256_bytes(f.read())


def load_manifest(path=None):
    with open(path or DEFAULT_MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def params_str(params):
    """{'A': 1, 'B': 0.5} -> 'A=1,B=0.5' (modelin MODEL_PARAMS biçimi)."""
    return ",".join(f"{k}={v}" for k, v in (params or {}).items())


def clean_env(hashseed, params=None, extra=None):
    env = dict(os.environ)
    for k in ("MODEL_PARAMS", "DBGF", "PYTHONHASHSEED"):
        env.pop(k, None)
    env["PYTHONHASHSEED"] = str(hashseed)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    if params:
        env["MODEL_PARAMS"] = params_str(params)
    if extra:
        env.update(extra)
    return env


def model_cmd(model_path, weeks, cities=None, ahir_kamu=None):
    cmd = [sys.executable, model_path, "--weeks", str(weeks)]
    if cities is not None:
        cmd += ["--cities", str(cities)]
    if ahir_kamu is not None:
        cmd += ["--ahir-kamu", str(int(ahir_kamu))]
    return cmd


def run_scenario(model_path, sc, default_hashseed=0, timeout=None):
    """Bir senaryoyu modelin kendi CLI'sı ile koşar. Dönüş: dict(ok, out, err, secs, rc)."""
    hs = sc.get("hashseed", default_hashseed)
    env = clean_env(hs, sc.get("params"))
    cmd = model_cmd(model_path, sc["weeks"], sc.get("cities"), sc.get("ahir_kamu"))
    t0 = time.time()
    try:
        p = subprocess.run(cmd, env=env, capture_output=True, timeout=timeout)
        return dict(ok=p.returncode == 0, out=p.stdout, err=p.stderr.decode("utf-8", "replace"),
                    secs=time.time() - t0, rc=p.returncode)
    except subprocess.TimeoutExpired:
        return dict(ok=False, out=b"", err="ZAMAN AŞIMI", secs=time.time() - t0, rc=-9)


def select(manifest, tiers=None, only=None, include_broken=False):
    """Senaryo seçer. Bilinmeyen --only kimliği, bilinmeyen --tier ya da boş seçim HATADIR (yanlış yeşil olmasın)."""
    known = {sc["id"] for sc in manifest["scenarios"]}
    known_tiers = {sc.get("tier", "fast") for sc in manifest["scenarios"]}
    if only and (only - known):
        sys.exit(f"HATA: manifestte olmayan senaryo kimliği: {sorted(only - known)}")
    if tiers and (tiers - known_tiers):
        sys.exit(f"HATA: bilinmeyen tier: {sorted(tiers - known_tiers)} (var olanlar: {sorted(known_tiers)})")
    out = []
    for sc in manifest["scenarios"]:
        if only and sc["id"] not in only:
            continue
        if tiers and sc.get("tier", "fast") not in tiers:
            continue
        if sc.get("status", "ok") != "ok" and not include_broken and not (only and sc["id"] in only):
            continue
        out.append(sc)
    if not out:
        sys.exit("HATA: seçim boş (0 senaryo); --tier/--only/--include-broken değerlerini kontrol edin")
    return out


def parallel(items, fn, jobs=MAX_JOBS, progress=None):
    """items üzerinde fn'i en çok `jobs` (üst sınır MAX_JOBS) iş parçacığıyla çalıştırır (alt süreçler beklenir)."""
    jobs = max(1, min(jobs, MAX_JOBS))
    res = {}
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        futs = {ex.submit(fn, it): i for i, it in enumerate(items)}
        for fu in as_completed(futs):
            i = futs[fu]
            res[i] = fu.result()
            if progress:
                progress(items[i], res[i])
    return [res[i] for i in range(len(items))]


VERSION_TOKEN = re.compile(r"v\d+\.\d+[^ ]*")


def norm_first(b, skip_version=True):
    """İlk satırda yalnız sürüm jetonunu (v12.3 gibi) etkisizleştirir; satırın geri kalanı (senaryo bilgisi) karşılaştırılır."""
    i = b.find(b"\n")
    first, rest = (b, b"") if i < 0 else (b[:i], b[i:])
    if skip_version:
        first = VERSION_TOKEN.sub("v?", first.decode("utf-8", "replace"), count=1).encode("utf-8")
    return first + rest


def first_diff(a_bytes, b_bytes, skip_first_line=True):
    """İki çıktıyı satır satır karşılaştırır; (eşit_mi, satır_no, a_satırı, b_satırı).
    skip_first_line=True: ilk satırda yalnız sürüm jetonu dışlanır (senaryo bilgisi karşılaştırılır)."""
    if skip_first_line:
        a_bytes, b_bytes = norm_first(a_bytes), norm_first(b_bytes)
    a = a_bytes.decode("utf-8", "replace").split("\n")
    b = b_bytes.decode("utf-8", "replace").split("\n")
    start = 0
    n = max(len(a), len(b))
    for i in range(start, n):
        la = a[i] if i < len(a) else "<yok>"
        lb = b[i] if i < len(b) else "<yok>"
        if la != lb:
            return False, i + 1, la, lb
    return True, 0, "", ""


def body(b, skip_first_line=True):
    """Karşılaştırma gövdesi: skip_first_line=True ise ilk satırdaki yalnız sürüm jetonu etkisizleştirilir."""
    return norm_first(b) if skip_first_line else b


def window(la, lb, width=60):
    """İki satırın ilk farklı sütununu bulur; her iki satırdan o sütun çevresini döndürür: (sütun, a_pencere, b_pencere)."""
    n = min(len(la), len(lb))
    col = next((i for i in range(n) if la[i] != lb[i]), n)
    lo = max(0, col - 30)
    return col + 1, la[lo:col + width], lb[lo:col + width]


def model_version(path):
    """Model dosyasındaki VERSION = "..." değerini ayrıştırır (çalıştırmadan)."""
    m = re.search(r'^VERSION\s*=\s*["\']([^"\']+)["\']', open(path, encoding="utf-8").read(), re.M)
    return m.group(1) if m else "?"


def py_files(path):
    """Dosya -> [dosya]; dizin -> içindeki tüm .py dosyaları (özyinelemeli, sıralı, __pycache__ hariç).
    Modüler klasör (model_mod.py + simkit/ birlikte) verilirse YALNIZ model_mod.py ve simkit/ taranır: tools/, snapshot/, golden/ ve
    üst düzey yardımcılar (simbuild.py) model sayılmaz (PK-5: modulerlestirme/ dizinini doğrudan vermek 86 sahte hata üretiyordu)."""
    if os.path.isdir(path):
        out = []
        pkg = os.path.isfile(os.path.join(path, "model_mod.py")) and os.path.isdir(os.path.join(path, "simkit"))
        if pkg:
            out.append(os.path.join(path, "model_mod.py"))
            path = os.path.join(path, "simkit")
        for d, ds, fs in os.walk(path):
            ds[:] = sorted(x for x in ds if x != "__pycache__")
            out += [os.path.join(d, f) for f in sorted(fs) if f.endswith(".py")]
        return sorted(out)
    return [path]


def read_source(path):
    """Statik araçlar için kaynak metni. PAKET MODU: dizin verilirse içindeki bütün .py dosyaları sırayla birleştirilip
    tek program sayılır (modül düzeyi işlevler ve run() aynı ad uzayı; satır numaraları birleşik kaynağa göredir).
    Paket içi `from simkit... import` satırları ayrıştırmayı bozmaz (yalnız ad bağlar)."""
    files = py_files(path)
    if len(files) == 1 and not os.path.isdir(path):
        return open(files[0], encoding="utf-8").read()
    return "\n".join(open(f, encoding="utf-8").read().rstrip("\n") + "\n" for f in files)
