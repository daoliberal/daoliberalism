"""`/d/<kod>` paylaşım sayfası: sosyal önizleme üstverisi + `/oyun/?kaynak=canli#/dao/d/<kod>` yönlendirmesi (sayfayı sunan sunucu canlı sunucudur). Satır içi betik yok."""
from __future__ import annotations

from html import escape

from .depo import Dunya

VARSAYILAN_ACIKLAMA = "DAO Liberal'de paylaşılan bir dünya."


def _e(s: str) -> str:
    return escape(s, quote=True)


def dunya_sayfasi(d: Dunya) -> str:
    hedef = "/oyun/?kaynak=canli#/dao/d/" + d.kod
    ad, acik = _e(d.ad), _e(d.aciklama or VARSAYILAN_ACIKLAMA)
    return (
        '<!doctype html>\n<html lang="tr"><head><meta charset="utf-8">\n'
        f'<title>{ad}</title>\n'
        f'<meta property="og:title" content="{ad}">\n'
        f'<meta property="og:description" content="{acik}">\n'
        '<meta property="og:type" content="website">\n'
        '<meta name="twitter:card" content="summary">\n'
        f'<meta name="twitter:title" content="{ad}">\n'
        f'<meta name="twitter:description" content="{acik}">\n'
        f'<meta http-equiv="refresh" content="0; url={_e(hedef)}">\n'
        f'</head><body><p><a href="{_e(hedef)}">{ad}</a></p></body></html>\n'
    )


def bulunamadi_sayfasi() -> str:
    return (
        '<!doctype html>\n<html lang="tr"><head><meta charset="utf-8"><title>Dünya bulunamadı</title></head>'
        '<body><p>Bu kodla bir dünya bulunamadı.</p><p><a href="/oyun/">Oyuna git</a></p></body></html>\n'
    )
