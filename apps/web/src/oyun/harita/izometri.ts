import { IZO_STILI } from "./haritaStili";

/** İzometrik hücre ızgarası ve projeksiyon (saf). c: sütun (sağ-aşağı), r: satır (sol-aşağı). */
export type Hucre = { c: number; r: number };
export type Karo = { genislik: number; yukseklik: number };

/** Hücre merkezinin ekran konumu (kesirli hücre kabul eder). Hücre (0,0) merkezi (0,0)'dır. */
export function hucredenEkrana(h: Hucre, karo: Karo = IZO_STILI.karo): { x: number; y: number } {
  return { x: ((h.c - h.r) * karo.genislik) / 2, y: ((h.c + h.r) * karo.yukseklik) / 2 };
}

/** hucredenEkrana'nın tersi (kesirli sonuç verir; yuvarlamak çağıranındır). */
export function ekrandanHucreye(p: { x: number; y: number }, karo: Karo = IZO_STILI.karo): { c: number; r: number } {
  const a = p.x / karo.genislik; // (c - r) / 2
  const b = p.y / karo.yukseklik; // (c + r) / 2
  return { c: a + b, r: b - a };
}

/** Elmas köşeleri: üst, sağ, alt, sol (x,y çiftleri; 8 sayı). */
export function elmas(h: Hucre, karo: Karo = IZO_STILI.karo): number[] {
  const { x, y } = hucredenEkrana(h, karo);
  const w = karo.genislik / 2;
  const t = karo.yukseklik / 2;
  return [x, y - t, x + w, y, x, y + t, x - w, y];
}

/** Çizim sırası: büyük olan öndedir. Negatif ve kesirli hücrelerde de tek yönlü artar. Varsayım: |r| < 1000 (r terimi (c+r)*1000 basamağını aşmaz). */
export function derinlik(h: Hucre): number {
  return (h.c + h.r) * 1000 + h.r;
}

/**
 * Yol bandı genişliği / parsel (K5): zemin karosu 55 px / parsel karosu 208 px. Çözülmüş manifestin `yolOrani` değeriyle aynıdır
 * (testle kilitli); manifest varken çağıran onu geçirir.
 */
export const YOL_ORANI = 55 / 208;

/** Blok boyutu (parsel): 3 sütun x 2 satır. Kaynak `SEHIR_STILI.blok`; sokakAgi ile aynı olmalı (testle kilitli). */
export const BLOK_SUTUN = 3;
export const BLOK_SATIR = 2;

/**
 * Sürekli PARSEL BİRİMİ koordinatı (K5). Hücre = parsel; blok içinde parseller bitişiktir (aralarında yol yok),
 * bloklar arasında genişliği `ro` olan yol bandı vardır, merkez çizgilerindeki ana cadde de `ro`'dur (ayrımı genis yol sprite'ı yapar).
 * Blok sütunu `bc = floor(dc/3)`, satırı `br = floor(dr/2)` (negatiflerde de doğru). Ana cadde `bc=0`/`br=0` bloğunun
 * hemen solunda/üstündedir (tüm bantlar `ro`, kayma `blok*ro`).
 */
const kayma = (blok: number, ro: number): number => blok * ro;

/** `p<dr>_<dc>` parsel kimliğinin MERKEZİ (sürekli koordinat; parsel merkezden ±0,5 yayılır). */
export function parselHucresi(parselId: string, ro: number = YOL_ORANI): Hucre {
  const m = /^p(-?\d+)_(-?\d+)$/.exec(parselId);
  if (!m) throw new Error("izometri:parsel");
  const dr = Number(m[1]);
  const dc = Number(m[2]);
  return { c: dc + kayma(Math.floor(dc / BLOK_SUTUN), ro), r: dr + kayma(Math.floor(dr / BLOK_SATIR), ro) };
}

export type Dikdortgen = { c0: number; c1: number; r0: number; r1: number };

/** Parselin yaslandığı yerin dikdörtgeni (merkez ±0,5). */
export function parselDikdortgeni(parselId: string, ro: number = YOL_ORANI): Dikdortgen {
  const h = parselHucresi(parselId, ro);
  return { c0: h.c - 0.5, c1: h.c + 0.5, r0: h.r - 0.5, r1: h.r + 0.5 };
}

/** Blok sütunu `i`nin sol (c) kenarı. */
export const blokSolKenari = (i: number, ro: number = YOL_ORANI): number => i * BLOK_SUTUN + kayma(i, ro) - 0.5;
/** Blok satırı `i`nin üst (r) kenarı. */
export const blokUstKenari = (i: number, ro: number = YOL_ORANI): number => i * BLOK_SATIR + kayma(i, ro) - 0.5;
/** Her blok sınırındaki bandın genişliği `ro`'dur; ana cadde (`i=0`) yalnız `genis` yol sprite'ı ile ayrılır (K5 ek). */
export const bantGenisligi = (ro: number = YOL_ORANI): number => ro;

/** Parsel kimliklerinin kapladığı blok aralığı (kapsayıcı). Boş listede `null`. */
export type BlokAraligi = { bc0: number; bc1: number; br0: number; br1: number };
export function blokAraligi(parselIdleri: readonly string[]): BlokAraligi | null {
  let bc0 = Infinity, bc1 = -Infinity, br0 = Infinity, br1 = -Infinity;
  for (const id of parselIdleri) {
    const m = /^p(-?\d+)_(-?\d+)$/.exec(id);
    if (!m) throw new Error("izometri:parsel");
    const bc = Math.floor(Number(m[2]) / BLOK_SUTUN);
    const br = Math.floor(Number(m[1]) / BLOK_SATIR);
    bc0 = Math.min(bc0, bc); bc1 = Math.max(bc1, bc);
    br0 = Math.min(br0, br); br1 = Math.max(br1, br);
  }
  return Number.isFinite(bc0) ? { bc0, bc1, br0, br1 } : null;
}

/** Bir yol bandı. `dikey`: c sabit, r boyunca uzanır (blok sütun sınırı); `yatay`: r sabit, c boyunca uzanır. */
export type YolBandi = {
  eksen: "dikey" | "yatay";
  /** Blok sınırı indeksi (bandın sağındaki/altındaki blok). */
  indeks: number;
  /** Bandın merkez çizgisi (dikeyde c, yatayda r). */
  konum: number;
  genislik: number;
  /** Bant boyunca dış kenarlar (dikeyde r, yatayda c); iki uçta dış halka bantlarını da kapsar. */
  bas: number;
  son: number;
  ana: boolean;
};
/** Dikey ve yatay bandın kesiştiği kare: tek zemin karosu (`sutun` = `satir` = 1; ana cadde de `ro` genişliğindedir). */
export type YolKavsagi = Dikdortgen & { k: number; l: number; ana: boolean; sutun: number; satir: number };
export type YolBantlari = { bantlar: readonly YolBandi[]; kavsaklar: readonly YolKavsagi[]; kutu: Dikdortgen };

/**
 * Blok aralığının yol ağı: her blok sınırında bir bant (iki uçtaki dış halka dahil), her çiftin kesişiminde kavşak.
 * Ağ `kutu`yu (dış halkanın dış kenarları) tamamen örter; parseller bantlara hiç taşmaz.
 */
export function yolBantlari(ar: BlokAraligi, ro: number = YOL_ORANI): YolBantlari {
  const kBas = ar.bc0, kSon = ar.bc1 + 1, lBas = ar.br0, lSon = ar.br1 + 1;
  const kutu: Dikdortgen = {
    c0: blokSolKenari(kBas, ro) - bantGenisligi(ro),
    c1: blokSolKenari(kSon, ro),
    r0: blokUstKenari(lBas, ro) - bantGenisligi(ro),
    r1: blokUstKenari(lSon, ro),
  };
  const bantlar: YolBandi[] = [];
  const kavsaklar: YolKavsagi[] = [];
  for (let k = kBas; k <= kSon; k++) {
    const w = bantGenisligi(ro);
    bantlar.push({ eksen: "dikey", indeks: k, konum: blokSolKenari(k, ro) - w / 2, genislik: w, bas: kutu.r0, son: kutu.r1, ana: k === 0 });
  }
  for (let l = lBas; l <= lSon; l++) {
    const w = bantGenisligi(ro);
    bantlar.push({ eksen: "yatay", indeks: l, konum: blokUstKenari(l, ro) - w / 2, genislik: w, bas: kutu.c0, son: kutu.c1, ana: l === 0 });
  }
  for (let l = lBas; l <= lSon; l++) {
    for (let k = kBas; k <= kSon; k++) {
      const wc = bantGenisligi(ro), wr = bantGenisligi(ro);
      kavsaklar.push({ k, l, ana: k === 0 || l === 0, sutun: Math.round(wc / ro), satir: Math.round(wr / ro), c0: blokSolKenari(k, ro) - wc, c1: blokSolKenari(k, ro), r0: blokUstKenari(l, ro) - wr, r1: blokUstKenari(l, ro) });
    }
  }
  return { bantlar, kavsaklar, kutu };
}

/** Hücrelerin elmaslarını kapsayan kutu; `kaydirma` eklenince her şey pad'den başlar. */
export function sinirKutusu(hucreler: readonly Hucre[], pad: number, karo: Karo = IZO_STILI.karo): { genislik: number; yukseklik: number; kaydirma: { x: number; y: number } } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const h of hucreler) {
    const e = elmas(h, karo);
    for (let i = 0; i < 8; i += 2) {
      x0 = Math.min(x0, e[i]!); x1 = Math.max(x1, e[i]!);
      y0 = Math.min(y0, e[i + 1]!); y1 = Math.max(y1, e[i + 1]!);
    }
  }
  if (!hucreler.length) { x0 = y0 = x1 = y1 = 0; }
  return { genislik: x1 - x0 + 2 * pad, yukseklik: y1 - y0 + 2 * pad, kaydirma: { x: pad - x0, y: pad - y0 } };
}

const EPS_KESISIM = 1e-9;
const ortusur = (a: Dikdortgen, b: Dikdortgen): boolean => a.c0 < b.c1 - EPS_KESISIM && a.c1 > b.c0 + EPS_KESISIM && a.r0 < b.r1 - EPS_KESISIM && a.r1 > b.r0 + EPS_KESISIM;

/** Bir yol bandının kapladığı dikdörtgen (dikeyde c boyunca `genislik`, r boyunca bas..son; yatayda tersi). */
export function bandDikdortgeni(b: YolBandi): Dikdortgen {
  const y = b.konum - b.genislik / 2, z = b.konum + b.genislik / 2;
  return b.eksen === "dikey" ? { c0: y, c1: z, r0: b.bas, r1: b.son } : { c0: b.bas, c1: b.son, r0: y, r1: z };
}

/**
 * Dikdörtgen yol ağına (herhangi bir yol bandı ya da kavşak) alan olarak değiyor mu? Yalnızca kenar teğetliği değmek sayılmaz.
 * Bina/lonca/belediye yerlerinin yol üstüne binmemesini sınamak ve sahne yerleşiminde kaçınmak için paylaşılan yardımcı.
 */
export function yolaDegiyor(d: Dikdortgen, yb: Pick<YolBantlari, "bantlar" | "kavsaklar">): boolean {
  return yb.bantlar.some((b) => ortusur(d, bandDikdortgeni(b))) || yb.kavsaklar.some((k) => ortusur(d, k));
}
