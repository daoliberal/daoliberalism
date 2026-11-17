"""Server-Sent Events akışı."""
from __future__ import annotations

import json
import sys
import traceback


def format_event(event_id: int, event: str, data: dict) -> bytes:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"id: {event_id}\nevent: {event}\ndata: {payload}\n\n".encode("utf-8")


def stream(handler, events, ping_s: float = 10.0) -> None:
    """`events`: (id, ad, veri) üçlüleri ya da None (= `: ping` yorumu) üreten yineleyici.

    `events` çağrılabilirse `events(ping_s)` ile yineleyici alınır: üretici, boşta kalınca
    None vermek için bu aralığı kullanır. İstemci kopunca (yazma hatası) sessizce biter.
    """
    it = events(ping_s) if callable(events) else events
    handler.send_response(200)
    handler.send_common_headers()
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    if not getattr(handler, "_api", False):  # /api'de send_common_headers zaten ekler
        handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Accel-Buffering", "no")
    handler.send_header("Connection", "close")
    handler.end_headers()
    handler.close_connection = True
    try:
        handler.wfile.write(b": ok\n\n")
        handler.wfile.flush()
        for item in it:
            if item is None:
                chunk = b": ping\n\n"
            else:
                chunk = format_event(*item)
            handler.wfile.write(chunk)
            handler.wfile.flush()
    except OSError:
        pass
    except Exception:  # üretici çöktü: başlıklar gitti, akış temiz kapanır (JSON hata yazılmaz)
        print("oyun_server: SSE üreticisi hata verdi:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
    finally:
        close = getattr(it, "close", None)
        if close:
            try:
                close()
            except Exception:
                pass
