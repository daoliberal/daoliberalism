#!/usr/bin/env python3
"""Kaydı yayımlar: `load_registry` + `public()` -> apps/web/public/oyun-kayit/registry.json.

  python3 -P simulasyon/arayuz/registry/yayinla.py            # yazar
  python3 -P simulasyon/arayuz/registry/yayinla.py --check    # farkta 1 döner ve farkı yazar

Çıktı: sıralı anahtar, ensure_ascii=False, girinti 1, sonda satır sonu. Veriye (settings.*.json, metinler.tr.json,
groups.json, templates.json, dayanaklar.json…) dokunan her görev sonunda çalıştırılır; çıktı aynı commit'e girer.
"""
from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1] / "server"
sys.path.insert(0, str(SERVER_DIR))

from oyun_server import config                       # noqa: E402
from oyun_server.registry import defaults, loader     # noqa: E402

DEFAULT_OUT = config.REPO_ROOT / "apps" / "web" / "public" / "oyun-kayit" / "registry.json"


def render(data_dir: Path, model_root: str) -> str:
    reg = loader.load_registry(data_dir, defaults.read_param_defaults(model_root))
    return json.dumps(reg.public(), sort_keys=True, ensure_ascii=False, indent=1) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="dosya güncel değilse 1 döner ve farkı yazar")
    ap.add_argument("--data-dir", default=str(loader.DEFAULT_DATA_DIR))
    ap.add_argument("--model-root", default=str(config.MODEL_ROOT))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    a = ap.parse_args(argv)
    out = Path(a.out)
    text = render(Path(a.data_dir), a.model_root)
    if a.check:
        cur = out.read_text(encoding="utf-8") if out.is_file() else ""
        if cur == text:
            print(f"yayım güncel: {out.name}")
            return 0
        diff = difflib.unified_diff(cur.splitlines(), text.splitlines(), "yayımlı", "üretilen", lineterm="", n=2)
        print("HATA: yayımlanan kayıt güncel değil (yayinla.py ile yeniden üret):")
        print("\n".join(diff) if cur else f"{out} yok")
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    print(f"yayımlandı: {out} ({len(text)} bayt)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
