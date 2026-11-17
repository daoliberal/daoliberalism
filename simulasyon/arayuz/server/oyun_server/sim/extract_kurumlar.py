"""Şehir kurumları (Liman = ithalat, İhracat) paket bloğu `kurumlar` (Görev 12b). Salt okunur; `W`'ye yazılmaz.

kurumlar = [{sehir, ithalat_hacim, ithalat_urunler, ihracat_hacim}] (şehir başına bir satır, şehir sırasıyla)
  ithalat_hacim    o hafta şehrin başka şehirlerden aldığı malın değeri (Akçe; `cities[i]["imp_val"]`, navlun dahil değil: satıcıya ödenen)
  ihracat_hacim    o hafta şehrin başka şehirlere sattığı malın değeri (`cities[i]["exp_val"]`; kapalı dünyada toplam ihracat = toplam ithalat, K-92 →)
  ithalat_urunler  en çok ithal edilen en fazla URUN_SAYISI ürün `[{urun, pay}]`, paya göre azalan (eşitlikte ürün adı); `pay` = ürünün TÜM ithalat içindeki oranı
                   (kaynak: modelin sönümlü ithalat hafızası `imp_cum`, son haftaların toplamı; ham haftalık ürün kırılımı hafta sonunda sıfırlandığı için tutulmaz)
Kota yok: model kapalı dünyadır (dışsal liman ve kotalı ihracat DAO'su kaldırıldı, K-92 →); ihracat başka şehrin ithalatıdır.
"""
from __future__ import annotations

from typing import Any

from .probes import finite

URUN_SAYISI = 5


def _hacim(x: Any) -> float:
    v = finite(x)
    return 0.0 if v is None or v < 0 else v


def kurum_satirlari(W) -> list[dict[str, Any]]:
    rows = []
    for c in W.cities:
        cum = {}
        for p, v in (c.get("imp_cum") or {}).items():
            f = finite(v)
            if f is not None and f > 0:
                cum[p] = f
        toplam = sum(cum.values())
        top = sorted(cum.items(), key=lambda kv: (-kv[1], kv[0]))[:URUN_SAYISI]
        rows.append({
            "sehir": c["i"],
            "ithalat_hacim": _hacim(c.get("imp_val")),
            "ithalat_urunler": [{"urun": p, "pay": v / toplam} for p, v in top],
            "ihracat_hacim": _hacim(c.get("exp_val")),
        })
    return rows
