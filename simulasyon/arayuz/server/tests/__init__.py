"""Test paketi. Koşu kaydı dizini (OYUN_RUNS_DIR) yoksa geçici bir dizine yönlendirilir: testler depodaki `kosular/` klasörüne yazmaz."""
import atexit
import os
import shutil
import tempfile

if not os.environ.get("OYUN_RUNS_DIR"):
    _runs_tmp = tempfile.mkdtemp(prefix="oyun-kosular-test-")
    os.environ["OYUN_RUNS_DIR"] = _runs_tmp
    atexit.register(shutil.rmtree, _runs_tmp, True)
