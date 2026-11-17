#!/usr/bin/env python3
"""Sehir kurumlari (Liman, Ihracat) ve lojistik merkezi sprite'larini mevcut parcalardan turetir (Gorev 12b).

Kullanim (pillow + numpy gerekir): python3 apps/web/scripts/sprite-kurum-turet.py <kaynak sprite klasoru>
Sonra: python3 apps/web/scripts/sprite-hazirla.py <kaynak sprite klasoru> apps/web/public/oyun-sprite

Ne yapar (kaynak klasorde yerinde, KAYNAK olcegi 396 px pad; yeniden calistirilabilir, ayni girdi ayni bayt):
  1. `liman` (gemili liman, tek parsel) artik YALNIZ sehir kurumudur: oyun_turleri ["liman"] (eskiden "lojistik": lojistik firmalari
     boy 1-3'te gemili liman gorunuyordu, kurum ile firma karisiyordu).
  2. `lojistik_boy4` (eski gemili 2 parsellik kompozit) yerine buyuk lojistik merkezi: arkada genis depo (lojistik_boy2), onde garaj ve kamyonet
     (ulasim_garaj); ayni 2 parsel geometrisi (karolar degismez).
  3. `gumruk` (Ihracat kurumu, tek parsel, oyun_turleri ["ihracat"]): kucuk depo + kamyonet (lojistik_boy1) uzerine konteyner yigini
     (lojistik_boy3'ten kesilir). Gemi/vinc yok: limanla karismaz.
Ilk calistirmada eski kompozit `merdiven/yalin/lojistik_boy4_yalin.png` -> `merdiven/yalin/lojistik_boy4_liman_eski.png` olarak saklanir (yayinlanmaz).
"""
import copy
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image


def yukle(kok, rel):
    return Image.open(os.path.join(kok, rel)).convert("RGBA")


def girdi(manifest, ad):
    return next(g for g in manifest["girdiler"] if g["ad"] == ad)


def kose_ust_y(g):
    return g["yalin"]["parsel_kose"]["ust"][1]


def konteyner_maskesi(im):
    """boy3 gorselinde konteyner yigini: x 195-345, y 70-185 kutusunda asfalt grisinden belirgin ayrilan (doygun) pikseller."""
    a = np.array(im).astype(np.int32)
    rgb, alfa = a[..., :3], a[..., 3]
    doygunluk = rgb.max(axis=2) - rgb.min(axis=2)
    yy, xx = np.mgrid[0 : a.shape[0], 0 : a.shape[1]]
    kutu = (xx >= 195) & (xx <= 360) & (yy >= 70) & (yy <= 200)      # kaynak olcegi (397 px pad): konteyner yigini sag arka-orta
    sag_alt_kenar = 129.0 + (396.0 - xx) * 0.577 - 16.0                # pad'in sag-alt kenari (cim kenarligi) ve 16 px ic payi: kenarlik konteynere katilmaz
    return (alfa > 200) & (doygunluk > 60) & kutu & (yy < sag_alt_kenar)


def main():
    kok = sys.argv[1]
    yol = os.path.join(kok, "manifest.json")
    man = json.load(open(yol, encoding="utf-8"))

    # 1) liman yalniz kurum
    liman = girdi(man, "liman")
    liman["oyun_turleri"] = ["liman"]

    b1 = girdi(man, "lojistik_boy1")
    b2 = girdi(man, "lojistik_boy2")
    b3 = girdi(man, "lojistik_boy3")
    gar = girdi(man, "ulasim_garaj")
    img = {g["ad"]: yukle(kok, g["yalin"]["dosya"].removeprefix("sprite/")) for g in (b1, b2, b3, gar)}

    # 2) lojistik_boy4: buyuk lojistik merkezi
    b4 = girdi(man, "lojistik_boy4")
    eski = os.path.join(kok, "merdiven", "yalin", "lojistik_boy4_liman_eski.png")
    mevcut = os.path.join(kok, b4["yalin"]["dosya"].removeprefix("sprite/"))
    if not os.path.exists(eski):
        shutil.copyfile(mevcut, eski)
    tilar = {k["rol"]: k for k in b4["yalin"]["karolar"]}
    tuval = Image.new("RGBA", (b4["yalin"]["genislik"], b4["yalin"]["yukseklik"]), (0, 0, 0, 0))
    for rol, g in (("ana", b2), ("genisleme", gar)):                   # arkada genis depo, onde garaj ve kamyonet
        kare = tilar[rol]
        sol = round(kare["sol"][0])
        ust = round(kare["ust"][1] - kose_ust_y(g))
        tuval.alpha_composite(img[g["ad"]], (sol, ust))
    tuval.save(mevcut, optimize=True)
    b4["not"] = "buyuk lojistik merkezi: arkada genis depo (lojistik_boy2), onde garaj ve kamyonet (ulasim_garaj); yalnizca yalin. Gemili liman artik `liman` kurumu"

    # 3) gumruk (Ihracat): kucuk depo + kamyonet + konteyner yigini
    zemin = img["lojistik_boy1"].copy()
    kaynak3 = img["lojistik_boy3"]
    mask = konteyner_maskesi(kaynak3)
    # boy1 ve boy3 ayni pad geometrisine sahip, yalniz ust ofseti farkli (boy3 pad'i 15 px asagida)
    kayma = round(kose_ust_y(b1) - kose_ust_y(b3))
    parca = np.array(kaynak3)
    parca[~mask, 3] = 0
    parca_im = Image.fromarray(parca, "RGBA")
    zemin.alpha_composite(parca_im, (0, kayma)) if kayma >= 0 else zemin.alpha_composite(parca_im.crop((0, -kayma, parca_im.width, parca_im.height)), (0, 0))
    hedef = os.path.join(kok, "yalin", "gumruk_yalin.png")
    zemin.save(hedef, optimize=True)
    gm = copy.deepcopy(girdi(man, "lojistik_boy1"))
    gm.update({"ad": "gumruk", "tur": "bina", "oyun_turleri": ["ihracat"]})
    for k in ("grup", "boy", "grup_ad"):
        gm.pop(k, None)
    gm["kaynak"] = "uretim"
    gm["yalin"] = dict(gm["yalin"], dosya="sprite/yalin/gumruk_yalin.png", genislik=zemin.width, yukseklik=zemin.height)
    man["girdiler"] = [g for g in man["girdiler"] if g["ad"] != "gumruk"]
    sira = next(i for i, g in enumerate(man["girdiler"]) if g["ad"] == "liman") + 1
    man["girdiler"].insert(sira, gm)
    with open(yol, "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    print(json.dumps({"liman_oyun_turleri": liman["oyun_turleri"], "lojistik_boy4": [tuval.width, tuval.height], "gumruk": [zemin.width, zemin.height], "konteyner_px": int(mask.sum())}))


if __name__ == "__main__":
    main()
