#!/usr/bin/env bash
# Tek komut: canlı model sunucusu + arayüz, tek adres http://127.0.0.1:8765/oyun/
# Kullanım: canli.sh [--port N] [--dev] [--fake] [--open]
#   --port N  kapı (varsayılan 8765)      --dev   :3000 kökenine izin (pnpm --filter web dev ile)
#   --fake    hızlı sentetik model        --open  hazır olunca tarayıcıyı açar
# Ortam: OYUN_PYTHON (python3), OYUN_MODEL_ROOT, OYUN_WEB_DIR (apps/web/out), OYUN_OPEN_CMD (--open için açıcı komut).
# Adres: varsayılan kapıda http://127.0.0.1:8765/oyun/, başka kapıda .../oyun/?kaynak=canli.
set -eu

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SERVER="$HERE/server"
PORT=8765
DEV=0
FAKE=0
OPEN=0

fail() { echo "canli.sh: $1" >&2; exit "${2:-1}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --port) [ $# -ge 2 ] || fail "--port bir kapı numarası ister." 2; PORT="$2"; shift 2 ;;
    --dev) DEV=1; shift ;;
    --fake) FAKE=1; shift ;;
    --open) OPEN=1; shift ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "bilinmeyen seçenek: $1 (kullanım: canli.sh [--port N] [--dev] [--fake] [--open])" 2 ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) fail "geçersiz kapı numarası: $PORT" 2 ;; esac

PYTHON="${OYUN_PYTHON:-python3}"
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1 \
  || fail "Python 3.12 ya da üstü gerekli (denenen: $PYTHON). OYUN_PYTHON ile doğru yorumlayıcıyı verin."

MODEL_ROOT="${OYUN_MODEL_ROOT:-$REPO/simulasyon/kagit-ustu/modulerlestirme}"
if [ "$FAKE" -eq 0 ] && [ ! -f "$MODEL_ROOT/simbuild.py" ]; then
  fail "model dizini bulunamadı: $MODEL_ROOT
OYUN_MODEL_ROOT ortam değişkeni ile doğru dizini verin ya da --fake kullanın."
fi

WEB="${OYUN_WEB_DIR:-$REPO/apps/web/out}"
if [ ! -d "$WEB" ]; then
  echo "uyarı: arayüz derlemesi yok ($WEB). Önce şunu çalıştırın: pnpm --filter web build" >&2
  echo "       (şimdilik yalnız /api sunulacak)" >&2
fi

ARGS=(--port "$PORT" --web "$WEB")
[ "$DEV" -eq 1 ] && ARGS+=(--dev)
[ "$FAKE" -eq 1 ] && ARGS+=(--host-kind fake)
export OYUN_MODEL_ROOT="$MODEL_ROOT"

if [ "$OPEN" -eq 1 ] && [ "$PORT" -ne 0 ]; then
  # 8765 dışı kapıda arayüz sunucuyu `?kaynak=canli` ile aynı kökende arar (sunucunun yazdığı adresle aynı).
  URL="http://127.0.0.1:$PORT/oyun/"
  [ "$PORT" -eq 8765 ] || URL="$URL?kaynak=canli"
  SELF=$$        # exec sonrası bu süreç sunucudur: ölmüşse (kapı dolu vb.) eski bir sunucuyu açmayız
  (
    for _ in $(seq 1 100); do
      kill -0 "$SELF" 2>/dev/null || exit 0
      if curl -fs "http://127.0.0.1:$PORT/api/hello" >/dev/null 2>&1; then
        if [ -n "${OYUN_OPEN_CMD:-}" ]; then "$OYUN_OPEN_CMD" "$URL"
        elif command -v open >/dev/null 2>&1; then open "$URL"
        elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
        exit 0
      fi
      sleep 0.2
    done
  ) >/dev/null 2>&1 &
fi

# exec: Ctrl-C/SIGTERM doğrudan sunucuya gider; sunucu işçileri temiz kapatır.
export PYTHONPATH="$SERVER"
cd "$SERVER"
exec "$PYTHON" -P -m oyun_server "${ARGS[@]}"
