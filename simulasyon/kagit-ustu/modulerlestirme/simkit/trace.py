"""simkit.trace: hata ayıklama izi kancası (PK-7). Eskiden dağınık `import sys; print(..., file=sys.stderr)` çağrılarının tek çıkışı.

AMAÇ: DBGF / DBG_EVERY / DBG_FIRMS / DBG_CREDIT bayrakları altındaki izler `trace(W, metin)` ile yazılır. Varsayılan çıkış stderr'dir
(bayt bayt eski çıktı: `print(metin, file=sys.stderr)`); `W.trace_sink = işlev(metin)` atanırsa iz oraya gider (test, kayıt, sunucu günlüğü).
Çağıranlar metni YALNIZ bayrak açıkken üretir (f-string bayrak koşulunun içinde kalır: hız etkilenmez).
ARAYÜZ: trace(W, metin)
KATMAN: L0 (bağımsız).
"""
import sys


def trace(W, text):
    sink = getattr(W, "trace_sink", None)
    if sink is None:
        print(text, file=sys.stderr)
    else:
        sink(text)
