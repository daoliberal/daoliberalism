"""D1: koşuların diske yazılması. Yalnız yerel dosya (yeni HTTP ucu yok); yalnız stdlib.

Dizin: `<kök>/<YYYYMMDD-HHMMSS>_<runId>/` içinde `kosu.json` (koşu üst verisi, atomik yeniden yazım), `haftalar.jsonl` (yayımlanan her
hafta için `/api/runs/<id>/weeks` satırı, tek satır JSON), `firmalar.jsonl` (firma anlık görüntüsü: 1. hafta, 10'un katları ve son hafta; DAO paketi her hafta harita taşısa da diske bu kadansla yazılır) ve bitişte `firmalar.json`. DAO koşusunda ayrıca `kararlar.jsonl` (oyuncunun işçice onaylanan kararları).

Sağlamlık: hiçbir yazma hatası yukarı çıkmaz (koşu durmaz); hata başına koşu için bir kez stderr'e uyarı yazılır. Klasör sayısı
`MAX_FOLDERS`'ı aşarsa yalnız uyarı verilir, hiçbir şey silinmez.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

MAX_FOLDERS = 500
MAX_BYTES = 2 * 1024 ** 3                      # toplam boyut uyarı eşiği (yalnız uyarı)
SAFE_RE = re.compile(r"[^A-Za-z0-9_-]+")
MAX_NAME = 64


def safe_name(run_id: Any) -> str:
    """Dosya adı için yalnız `[A-Za-z0-9_-]`; ardışık güvensiz karakterler tek `_`, uç `_`/`-` kırpılır, en çok 64 karakter."""
    s = SAFE_RE.sub("_", str(run_id)).strip("_-")[:MAX_NAME].strip("_-")
    return s or "kosu"


def iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def make_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def append_text(path: Path, text: str) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(text)


def _warn(msg: str) -> None:
    print("oyun_server: uyarı: " + msg, file=sys.stderr)


class RunDir:
    """Tek koşunun klasörü. Her işlem kendi içinde hatayı yutar (ilk hatada uyarı)."""

    def __init__(self, path: Path):
        self.path = path
        self._warned = False

    def _fail(self, what: str, e: Exception) -> None:
        if not self._warned:
            self._warned = True
            _warn("koşu diske yazılamadı (%s: %s: %s); koşu sürüyor." % (what, type(e).__name__, e))

    def write_meta(self, meta: dict) -> None:
        self._write("kosu.json", json.dumps(meta, ensure_ascii=False, indent=1) + "\n")

    def write_firms(self, data: dict) -> None:
        self._write("firmalar.json", json.dumps(data, ensure_ascii=False, indent=1) + "\n")

    def _write(self, name: str, text: str) -> None:
        try:
            write_atomic(self.path / name, text)
        except Exception as e:                                       # noqa: BLE001 koşu asla durmaz
            self._fail(name, e)

    def append_firms(self, week: int, rows: list) -> None:
        try:
            append_text(self.path / "firmalar.jsonl", json.dumps({"week": week, "firms": rows}, ensure_ascii=False, separators=(",", ":")) + "\n")
        except Exception as e:                                       # noqa: BLE001
            self._fail("firmalar.jsonl", e)

    def append_karar(self, row: dict) -> None:
        """DAO karar kaydı (`kararlar.jsonl`): yalnız işçinin onayladığı kararlar; satır `{uygulama_haftasi, sira, karar, durum}`."""
        try:
            append_text(self.path / "kararlar.jsonl", json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        except Exception as e:                                       # noqa: BLE001
            self._fail("kararlar.jsonl", e)

    def append_week(self, packet: dict) -> None:
        try:
            append_text(self.path / "haftalar.jsonl", json.dumps(packet, ensure_ascii=False, separators=(",", ":")) + "\n")
        except Exception as e:                                       # noqa: BLE001
            self._fail("haftalar.jsonl", e)


class DiskStore:
    """`root` None ise hiçbir şey yazılmaz."""

    def __init__(self, root: Path | str | None, wall=time.time):
        self.root = Path(root) if root else None
        self.wall = wall
        self._quota_warned = False
        self._size_warned = False

    def open(self, run_id: str, started: float) -> RunDir | None:
        if self.root is None:
            return None
        try:
            make_dir(self.root)
            self._check_quota()
            name = "%s_%s" % (time.strftime("%Y%m%d-%H%M%S", time.gmtime(started)), safe_name(run_id))
            path = self.root / name
            make_dir(path)
            return RunDir(path)
        except Exception as e:                                       # noqa: BLE001
            _warn("koşu klasörü açılamadı (%s: %s); koşu diske yazılmayacak." % (type(e).__name__, e))
            return None

    def _check_quota(self) -> None:
        try:
            n = sum(1 for p in self.root.iterdir() if p.is_dir())
        except OSError:
            return
        if n >= MAX_FOLDERS and not self._quota_warned:
            self._quota_warned = True
            _warn("%s içinde %d koşu klasörü var (kota %d aşıldı); hiçbiri silinmez, eskileri elle temizleyin." % (self.root, n, MAX_FOLDERS))
        if not self._size_warned:
            total = 0
            for dp, _dn, fn in os.walk(self.root):
                for f in fn:
                    try:
                        total += os.path.getsize(os.path.join(dp, f))
                    except OSError:
                        pass
            if total > MAX_BYTES:
                self._size_warned = True
                _warn("%s toplam boyutu %.1f GB (uyarı eşiği %.1f GB); hiçbir şey silinmez, eski koşuları elle temizleyin." % (self.root, total / 1024 ** 3, MAX_BYTES / 1024 ** 3))
