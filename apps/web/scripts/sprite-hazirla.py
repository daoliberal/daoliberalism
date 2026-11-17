#!/usr/bin/env python3
"""Izometrik sehir sprite setini yayina hazirlar (apps/web/public/oyun-sprite/).

Kullanim (pillow + numpy + scipy gerekir; ornek: python3 -m venv venv && venv/bin/pip install pillow numpy scipy):
    venv/bin/python apps/web/scripts/sprite-hazirla.py <kaynak sprite klasoru> apps/web/public/oyun-sprite

Ne yapar:
  1. Yalniz K4 icin gerekeni secer: yalin bina, merdiven/yalin, arac, zemin, overlay ve iki serit (park, nehir).
     Tam parselli kok PNG'ler, buyuk merkez blok ve insanli/ GIRMEZ.
  2. Yalin binalarin kenarini temizler: pad kenarindaki ince beyaz cizgiyi (acik, dusuk doygunluklu kenar
     pikselleri) ve ana govdeden kopuk kucuk bilesenleri (lamba izi) siler.
  3. Boyutlandirir (premultiplied Lanczos). K5: tum sprite'lar AYNI faktorle (208/396) olceklenir, goreli olcek korunur:
       yalin pad ~396 px -> ~208 px (parsel karosu 208x120); zemin karosu 104x60 -> ~55x32 (yol orani ~0.26 parsel).
     Koordinatlar (ankraj, merkez, parsel_kose, karolar, karo...) ayni eksen oranlariyla olceklenir.
  4. Manifesti kaynak semasiyla (ayni anahtarlar) ama olcekli degerlerle ve yayin yollariyla yazar.
Cikti deterministiktir (ayni girdi, ayni bayt).
"""
import copy
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

PAD_KAYNAK = 396.0  # yalin pad genisligi (kaynak px)
KARO_HEDEF = 208.0  # 1 oyun karosu = 104 css px x 2
OLCEK_BINA = KARO_HEDEF / PAD_KAYNAK
OLCEK_ZEMIN = OLCEK_BINA  # K5: goreli olcek korunur, zemin karosu binalarla ayni faktor
KUCUK_BILESEN_ORANI = 0.05

BINA_TURLERI = {"bina", "bina_merdiven"}
ZEMIN_TURLERI = {"yol", "yol_kavsak", "yol_t", "yol_kose", "yol_sonu", "kaldirim", "cim", "cim_agacli", "bos_arsa", "dekor"}
DIGER_TURLER = {"arac", "iskele", "tahtali", "serit"}

NOKTA_ANAHTARLARI = {"ankraj", "merkez", "ust_kose"}
KOSE_SOZLUKLERI = {"parsel_kose", "karo"}


def pad_kenar_bandi(shape, kose, genislik):
    """Pad elmasinin (ust, sag, alt, sol) 4 kenarina `genislik` px'den yakin piksellerin maskesi."""
    yy, xx = np.mgrid[0 : shape[0], 0 : shape[1]].astype(np.float32)
    nok = [kose["ust"], kose["sag"], kose["alt"], kose["sol"]]
    en_yakin = np.full(shape, 1e9, dtype=np.float32)
    for i in range(4):
        (x1, y1), (x2, y2) = nok[i], nok[(i + 1) % 4]
        dx, dy = x2 - x1, y2 - y1
        t = np.clip(((xx - x1) * dx + (yy - y1) * dy) / max(dx * dx + dy * dy, 1e-6), 0, 1)
        en_yakin = np.minimum(en_yakin, np.hypot(xx - (x1 + t * dx), yy - (y1 + t * dy)))
    return en_yakin <= genislik


def kenar_temizle(a: np.ndarray, parsel_kose):
    """RGBA dizisi dondurur + rapor. Beyaz kenar cizgisi ve kopuk bilesenleri siler."""
    a = a.copy()
    rapor = {"bilesen": 0, "bilesen_px": 0, "beyaz_px": 0}
    alfa = a[..., 3]

    # 1) pad sol kosesinin disinda havada duran ince yapilar (lamba direkleri): acma islemiyle incelerin artigi
    if parsel_kose:
        x_sol = parsel_kose["sol"][0]
        m = a[..., 3] > 16
        acik = ndimage.binary_opening(m, structure=np.ones((3, 3), dtype=bool), iterations=2)
        artik = m & ~ndimage.binary_dilation(acik, structure=np.ones((3, 3), dtype=bool), iterations=1)
        y_sol = parsel_kose["sol"][1]
        xs_ = np.arange(a.shape[1])[None, :]
        ys_ = np.arange(a.shape[0])[:, None]
        # direk (kose ustu) + kose solunda kalan taban parcasi: padin solunda gercek yapi yoktur
        sol_dis = ((xs_ < x_sol + 14) & (ys_ < y_sol - 3)) | (xs_ < x_sol - 1)
        et2, n2 = ndimage.label(artik & sol_dis, structure=np.ones((3, 3)))
        for i in range(1, n2 + 1):
            kesim = et2 == i
            yk, xk = np.nonzero(kesim)
            direk = yk.max() - yk.min() >= 14 and xk.max() - xk.min() <= 22  # uzun ince: lamba diregi (cit/fayans parcalari kisa)
            if direk or (kesim.sum() >= 6 and xk.max() < x_sol - 1):
                a[ndimage.binary_dilation(kesim, structure=np.ones((3, 3), dtype=bool), iterations=2) & m & sol_dis, 3] = 0
                rapor["bilesen"] += 1
                rapor["bilesen_px"] += int(kesim.sum())

    # 1b) ana govdeden kopuk kucuk bilesenler (lamba tabani artigi)
    alfa = a[..., 3]
    etiket, n = ndimage.label(alfa > 16, structure=np.ones((3, 3)))
    if n > 1:
        boyut = ndimage.sum(np.ones_like(alfa, dtype=float), etiket, index=np.arange(1, n + 1))
        en_buyuk = boyut.max()
        for i, b in enumerate(boyut, start=1):
            if b < en_buyuk * KUCUK_BILESEN_ORANI:
                a[etiket == i, 3] = 0
                rapor["bilesen"] += 1
                rapor["bilesen_px"] += int(b)

    # 1c) yalniz solgun kalintilar: guclu (A>40) komsusu olmayan 0<A<=40 pikseller (silinen direklerin anti-alias izi)
    guclu = ndimage.binary_dilation(a[..., 3] > 40, structure=np.ones((3, 3), dtype=bool), iterations=1)
    iz = (a[..., 3] > 0) & (a[..., 3] <= 40) & ~guclu
    rapor["bilesen_px"] += int(iz.sum())
    a[iz, 3] = 0

    # 2) pad kenarlarindaki acik kenar cizgisi (en cok 3 gecis)
    yy = np.ones(a.shape[:2], dtype=bool)
    if parsel_kose:
        yy = pad_kenar_bandi(a.shape[:2], parsel_kose, 4.0)
    cap = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=bool)
    for _ in range(3):
        alfa = a[..., 3]
        kati = alfa > 8
        sinir = kati & ndimage.binary_dilation(~kati, structure=cap)
        rgb = a[..., :3].astype(np.float32)
        lum = rgb.mean(axis=2)
        doygunluk = rgb.max(axis=2) - rgb.min(axis=2)
        acik = (rgb.min(axis=2) >= 150) & (doygunluk <= 28)
        ic = (kati & ~sinir).astype(np.float32)
        pay = ndimage.uniform_filter(lum * ic, 5)
        payda = ndimage.uniform_filter(ic, 5)
        ref = pay / np.maximum(payda, 1e-6)
        sil = sinir & acik & (lum > ref + 25) & (payda > 0.05) & yy
        rapor["beyaz_px"] += int(sil.sum())
        a[sil, 3] = 0
        if not sil.any():
            break
    return a, rapor


def nokta(v, sx, sy):
    return [round(v[0] * sx, 1), round(v[1] * sy, 1)]


def olcekle(blok, sx, sy):
    """Bir dosya blogunu (tam/yalin/girdi kokunun kendisi) olcekler; yeni genislik/yukseklik disaridan verilir."""
    b = copy.deepcopy(blok)
    for k in NOKTA_ANAHTARLARI:
        if k in b:
            b[k] = nokta(b[k], sx, sy)
    for k in KOSE_SOZLUKLERI:
        if k in b:
            b[k] = {ad: nokta(v, sx, sy) for ad, v in b[k].items()}
    if "parsel_karo" in b:
        b["parsel_karo"]["sol_kenar_px"] = round(b["parsel_karo"]["sol_kenar_px"] * sx, 1)
        b["parsel_karo"]["sag_kenar_px"] = round(b["parsel_karo"]["sag_kenar_px"] * sx, 1)
    if "karolar" in b:
        for kr in b["karolar"]:
            for ad in ("ust", "sag", "sol", "alt"):
                kr[ad] = nokta(kr[ad], sx, sy)
    return b


def isle(kaynak, hedef, blok, olcek, temizle, log):
    """PNG'yi isler, olceklenmis blogu dondurur. blok: dosya/genislik/yukseklik iceren sozluk."""
    ad_kaynak = os.path.join(kaynak, blok["dosya"].removeprefix("sprite/"))
    im = Image.open(ad_kaynak).convert("RGBA")
    a = np.array(im)
    if temizle:
        a, rapor = kenar_temizle(a, blok.get("parsel_kose"))
        log[blok["dosya"]] = rapor
        im = Image.fromarray(a, "RGBA")
    w, h = im.size
    yw, yh = max(1, round(w * olcek)), max(1, round(h * olcek))
    im = im.resize((yw, yh), Image.LANCZOS)  # Pillow RGBA'yi premultiplied yeniden ornekler
    rel = blok["dosya"].removeprefix("sprite/")
    cikti = os.path.join(hedef, rel)
    os.makedirs(os.path.dirname(cikti), exist_ok=True)
    im.save(cikti, optimize=True)
    sx, sy = yw / w, yh / h
    yeni = olcekle(blok, sx, sy)
    yeni["dosya"] = rel
    yeni["genislik"] = yw
    yeni["yukseklik"] = yh
    return yeni


def main():
    kaynak, hedef = sys.argv[1], sys.argv[2]
    ham = json.load(open(os.path.join(kaynak, "manifest.json"), encoding="utf-8"))
    log = {}
    cikti = []
    for g in ham["girdiler"]:
        if g.get("insanli"):
            continue
        tur = g["tur"]
        yeni = copy.deepcopy(g)
        if tur in BINA_TURLERI:
            if "yalin" not in g:
                continue
            yeni.pop("tam", None)
            yeni["yalin"] = isle(kaynak, hedef, g["yalin"], OLCEK_BINA, True, log)
        elif tur == "serit":
            yeni["tam"] = isle(kaynak, hedef, g["tam"], OLCEK_BINA, False, log)
        elif tur in ZEMIN_TURLERI:
            blok = {k: v for k, v in g.items() if k in ("dosya", "genislik", "yukseklik", "ankraj", "ust_kose", "karo")}
            y = isle(kaynak, hedef, blok, OLCEK_ZEMIN, False, log)
            yeni.update(y)
            yeni["karo_piksel"] = [round(g["karo_piksel"][0] * OLCEK_ZEMIN), round(g["karo_piksel"][1] * OLCEK_ZEMIN)] if "karo_piksel" in g else None
            if yeni["karo_piksel"] is None:
                del yeni["karo_piksel"]
        elif tur in DIGER_TURLER:
            if tur in ("iskele", "tahtali"):
                blok = {k: v for k, v in g.items() if k in ("dosya", "genislik", "yukseklik", "ankraj", "merkez", "parsel_kose")}
                y = isle(kaynak, hedef, blok, OLCEK_BINA, False, log)
                yeni.update(y)
            else:  # arac
                yeni["tam"] = isle(kaynak, hedef, g["tam"], OLCEK_BINA, False, log)
        else:
            continue
        cikti.append(yeni)

    manifest = {
        "surum": ham["surum"],
        "tarih": ham["tarih"],
        "olcek": "yayin olcegi: tum sprite'lar kaynak x 208/396 (K5, goreli olcek korunur). parsel karosu 208x120, zemin karosu ~55x32; gercek 30 derece izometri (egim 30/52)",
        "yon_sozlesmesi": ham["yon_sozlesmesi"],
        "zemin_karosu": {"piksel": [round(ham["zemin_karosu"]["piksel"][0] * OLCEK_ZEMIN), round(ham["zemin_karosu"]["piksel"][1] * OLCEK_ZEMIN)], "hucre_birim": ham["zemin_karosu"]["hucre_birim"], "px_per_birim": round(OLCEK_ZEMIN * 2, 4)},
        "parsel_karosu": {"piksel": [208, 120]},
        "hazirlama": {"olcek_bina": round(OLCEK_BINA, 6), "olcek_zemin": OLCEK_ZEMIN},
        "girdiler": cikti,
    }
    with open(os.path.join(hedef, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    tm = os.path.join(kaynak, "tur_eslemesi.md")
    if os.path.exists(tm):
        with open(tm, encoding="utf-8") as src, open(os.path.join(hedef, "tur_eslemesi.md"), "w", encoding="utf-8") as dst:
            dst.write(src.read())
    toplam = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(hedef) for f in fs)
    print(json.dumps({"girdi": len(cikti), "toplam_bayt": toplam, "temizlik": log}, ensure_ascii=False))


if __name__ == "__main__":
    main()
