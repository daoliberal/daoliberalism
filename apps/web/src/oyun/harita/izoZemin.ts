import { IZO_STILI } from "./haritaStili";
import { BLOK_SATIR, BLOK_SUTUN, YOL_ORANI, blokAraligi, blokSolKenari, blokUstKenari, derinlik, parselHucresi, yolBantlari, type Dikdortgen, type Hucre } from "./izometri";
import { zeminSprite, type SpriteKaydi, type SpriteManifesti } from "./spriteManifest";
import type { Parsel } from "./tipler";
import { fnv1a } from "./yerlesim";

export type Baglanti = { K: boolean; D: boolean; G: boolean; B: boolean };
export type YolTuru = "duz" | "kavsak" | "t" | "kose" | "sonu";
/**
 * Tek yol karosu: `hucre` karonun MERKEZİ (sürekli parsel birimi), kenarı `ro` (yol bandı genişliği = bir zemin karosu).
 * `baglanti`: K/D/G/B = r-1/c+1/r+1/c-1 (manifest `baglanti` ile aynı). Sprite bağlantı kümesiyle birebir seçilir (döndürme yok).
 */
export type YolKarosu = { hucre: Hucre; tur: YolTuru; ana: boolean; baglanti: Baglanti; sprite: SpriteKaydi | null };
export type ZeminKarosu = { hucre: Hucre; tur: "kaldirim" | "cim" | "arsa" | "park" | "konut" | "agac" | "nehir" | "otopark"; sprite: SpriteKaydi | null };
export type Yon = "kuzey" | "dogu" | "guney" | "bati";
/**
 * Kıyı/park şeridi. `parcalar`: sprite parçalarının ayak izi MERKEZLERİ (uzunluk x genislik parsel; boyuna aralıksız, üst üste azıcık biner).
 * `yon` kenarı verir: kuzey/güney'de parça c boyunca, doğu/batı'da r boyunca uzanır (sprite c boyuna çizilidir; doğu/batı'da yatay aynalanır).
 * Sprite ankrajı ayak izinin (c boyunca) alt köşesidir: (merkez.c + uzunluk/2, merkez.r + genislik/2); aynalıda (merkez.c + genislik/2, merkez.r + uzunluk/2).
 */
export type Serit = { tur: "nehir" | "park"; yon: Yon; parcalar: readonly Hucre[]; uzunluk: number; genislik: number; sprite: SpriteKaydi | null };
export type IzoZemin = {
  /** Zemin karosu kenarı (parsel birimi): yol bandı genişliği. Karo ekran ölçeği = `ro * IZO_STILI.karo.genislik`. */
  ro: number;
  /** Yol karoları; önce düz şeritler, sonra kavşak/dönüş karoları (üst üste binen ince kenarda kavşak üstte). */
  yollar: readonly YolKarosu[];
  /** Parselsiz kalan blok yuvaları (ör. meydanın kestiği yerler): kaldırım karoları. */
  blokZemini: readonly ZeminKarosu[];
  /** Her parselin altı için tek öğe (parsel padı kendi zeminini getirir): karo döşenmez. */
  parselZemini: readonly { id: string; hucre: Hucre }[];
  /** Yol ağının dışında `kenarHucre` kalınlığında çim + ağaç (tam; şeritler üstüne konur). */
  cerceve: readonly ZeminKarosu[];
  seritler: readonly Serit[];
  /** Ana cadde uçlarının dış kenar ortası. */
  kapilar: readonly { yon: Yon; hucre: Hucre }[];
  /** Yol ağının dış kutusu (dış halka dahil); çerçeve bunun dışındadır. */
  kapsam: Dikdortgen;
  /** Çerçeveyle birlikte dış kutu. */
  kutu: Dikdortgen;
};

const BOS_KUTU: Dikdortgen = { c0: 0, c1: 0, r0: 0, r1: 0 };
const YONLER: readonly Yon[] = ["kuzey", "dogu", "guney", "bati"];
const EPS = 1e-9;

/** Bağlantı kümesinden yol türü: 4 kavşak, 3 T, 2 (karşılıklı düz / bitişik dönüş), 1 yol sonu. Bağlantısız: `sonu`. */
export function yolTuruBaglantidan(b: Baglanti): YolTuru {
  const n = Number(b.K) + Number(b.D) + Number(b.G) + Number(b.B);
  if (n >= 4) return "kavsak";
  if (n === 3) return "t";
  if (n === 2) return (b.K && b.G) || (b.D && b.B) ? "duz" : "kose";
  return "sonu";
}

/** `[a, b]` aralığını adımı `ro`'yu aşmayacak (boşluksuz) eşit aralıklı karo merkezleriyle döşer. */
function dizi(a: number, b: number, ro: number): number[] {
  const n = Math.max(1, Math.ceil((b - a) / ro - EPS));
  const s = (b - a) / n;
  return Array.from({ length: n }, (_, i) => a + s * (i + 0.5));
}

/** Tam `n` karoluk bant: kenarı `a`, karo merkezleri `a + ro/2 + i*ro`. */
const bantMerkezleri = (a: number, n: number, ro: number): number[] => Array.from({ length: n }, (_, i) => a + ro * (i + 0.5));

function yolKarosu(m: SpriteManifesti, c: number, r: number, ana: boolean, baglanti: Baglanti): YolKarosu {
  const tur = yolTuruBaglantidan(baglanti);
  return { hucre: { c, r }, tur, ana, baglanti, sprite: zeminSprite(m, `${ana ? "yol-ana" : "yol"}-${tur}`, baglanti) };
}

function zeminKarosu(m: SpriteManifesti, c: number, r: number, tur: ZeminKarosu["tur"]): ZeminKarosu {
  return { hucre: { c, r }, tur, sprite: zeminSprite(m, tur) };
}

const bosZemin = (ro: number): IzoZemin => ({ ro, yollar: [], blokZemini: [], parselZemini: [], cerceve: [], seritler: [], kapilar: [], kapsam: BOS_KUTU, kutu: BOS_KUTU });

/**
 * Zemin katmanı (saf veri, çizim değil; K4/K5). Yol ağı: her blok sınırında sürekli bant, ana cadde (merkez çizgileri) de tek karo geniş (yalnız `genis` sprite ile ayrılır, K5 ek),
 * iki uçta bir dış halka yol; bantlar zemin karosu boyunda karolarla döşenir. Parseller bitişik (blok içinde yol yok); parselsiz blok yuvaları
 * kaldırımla dolar. Ağın dışı çim + ağaç çerçevedir; bir kenarda nehir, bitişik kenarda park şeridi vardır.
 * Yol karosu yalnız kendi bandına/blok sınırına bağlıdır: kademe büyüyünce içerdeki karolar aynı kalır (yalnız eski dış halka bağlantı kazanır).
 */
export function izoZeminKur(parseller: readonly Parsel[], m: SpriteManifesti, tohum: string, sehir: number): IzoZemin {
  const ro = m.yolOrani > 0 ? m.yolOrani : YOL_ORANI;
  const ar = blokAraligi(parseller.map((p) => p.id));
  if (!ar) return bosZemin(ro);
  const { bantlar, kavsaklar, kutu: kapsam } = yolBantlari(ar, ro);

  // --- Yol karoları ---
  const duzler: YolKarosu[] = [];
  const kavsakKarolari: YolKarosu[] = [];
  const dik = bantlar.filter((b) => b.eksen === "dikey");
  const yat = bantlar.filter((b) => b.eksen === "yatay");
  for (const b of dik) {
    const sutunlar = bantMerkezleri(b.konum - b.genislik / 2, Math.round(b.genislik / ro), ro);
    for (let l = ar.br0; l <= ar.br1; l++) {
      const ust = blokUstKenari(l, ro);
      for (const r of dizi(ust, ust + BLOK_SATIR, ro)) for (const c of sutunlar) duzler.push(yolKarosu(m, c, r, b.ana, { K: true, D: false, G: true, B: false }));
    }
  }
  for (const b of yat) {
    const satirlar = bantMerkezleri(b.konum - b.genislik / 2, Math.round(b.genislik / ro), ro);
    for (let k = ar.bc0; k <= ar.bc1; k++) {
      const sol = blokSolKenari(k, ro);
      for (const c of dizi(sol, sol + BLOK_SUTUN, ro)) for (const r of satirlar) duzler.push(yolKarosu(m, c, r, b.ana, { K: false, D: true, G: false, B: true }));
    }
  }
  for (const v of kavsaklar) {
    const sutunlar = bantMerkezleri(v.c0, v.sutun, ro);
    const satirlar = bantMerkezleri(v.r0, v.satir, ro);
    sutunlar.forEach((c, i) => satirlar.forEach((r, j) => {
      const baglanti: Baglanti = {
        K: j > 0 || v.l > ar.br0,
        G: j < v.satir - 1 || v.l <= ar.br1,
        B: i > 0 || v.k > ar.bc0,
        D: i < v.sutun - 1 || v.k <= ar.bc1,
      };
      kavsakKarolari.push(yolKarosu(m, c, r, v.ana, baglanti));
    }));
  }
  const sirala = (a: YolKarosu, b: YolKarosu): number => derinlik(a.hucre) - derinlik(b.hucre) || a.hucre.c - b.hucre.c;
  duzler.sort(sirala);
  kavsakKarolari.sort(sirala);

  // --- Parsel altı ve parselsiz blok yuvaları ---
  const mevcut = new Set(parseller.map((p) => p.id));
  const blokZemini: ZeminKarosu[] = [];
  for (let dr = ar.br0 * BLOK_SATIR; dr < (ar.br1 + 1) * BLOK_SATIR; dr++) {
    for (let dc = ar.bc0 * BLOK_SUTUN; dc < (ar.bc1 + 1) * BLOK_SUTUN; dc++) {
      if (mevcut.has(`p${dr}_${dc}`)) continue;
      const h = parselHucresi(`p${dr}_${dc}`, ro);
      for (const r of dizi(h.r - 0.5, h.r + 0.5, ro)) for (const c of dizi(h.c - 0.5, h.c + 0.5, ro)) blokZemini.push(zeminKarosu(m, c, r, "kaldirim"));
    }
  }
  const parselZemini = parseller.map((p) => ({ id: p.id, hucre: parselHucresi(p.id, ro) }));

  // --- Çerçeve kutusu ve şeritler ---
  const kal = IZO_STILI.kenarHucre;
  const kutu: Dikdortgen = { c0: kapsam.c0 - kal, c1: kapsam.c1 + kal, r0: kapsam.r0 - kal, r1: kapsam.r1 + kal };
  const nehirKenari = fnv1a(`${tohum}|nehir`) % 4;
  const parkKenari = (nehirKenari + 1) % 4;
  // Şerit parçaları çerçevenin DIŞ bandının içinde, çerçeve dış kenarıyla aynı hizada, aralıksız dizilir. Çerçeve karoları şeridin
  // altında tam kalır (çentik olmaz); çizici şeridi çerçevenin üstüne koyar. Nehir köşeleri de kapsar; park yalnız yol ağının
  // uzunluğunca (köşe çakışması olmaz). Parça ölçüsü sprite'tan: ankraj.x = uzunluk, genişlik = sprite genişliği - uzunluk (yarım-karo birimiyle).
  const seritOlcusu = (sp: SpriteKaydi | null): { uzunluk: number; genislik: number } => {
    const yarim = m.parselKaro.genislik / 2;
    const u = sp ? sp.ankraj.x / yarim : IZO_STILI.seritYedek.uzunluk;
    const g = sp ? sp.genislik / yarim - u : IZO_STILI.seritYedek.genislik;
    return { uzunluk: Math.max(1, u), genislik: Math.min(Math.max(0.1, g), kal) };
  };
  const serit = (tur: "nehir" | "park", kenar: number, tam: boolean): Serit => {
    const sp = zeminSprite(m, tur);
    const { uzunluk, genislik } = seritOlcusu(sp);
    const yatayMi = kenar === 0 || kenar === 2;
    const bas = yatayMi ? (tam ? kutu.c0 : kapsam.c0) : tam ? kutu.r0 : kapsam.r0;
    const son = yatayMi ? (tam ? kutu.c1 : kapsam.c1) : tam ? kutu.r1 : kapsam.r1;
    const derin = kenar === 0 ? kutu.r0 + genislik / 2 : kenar === 2 ? kutu.r1 - genislik / 2 : kenar === 3 ? kutu.c0 + genislik / 2 : kutu.c1 - genislik / 2;
    const parcalar = dizi(bas, son, uzunluk).map((x) => (yatayMi ? { c: x, r: derin } : { c: derin, r: x }));
    return { tur, yon: YONLER[kenar]!, parcalar, uzunluk, genislik, sprite: sp };
  };
  const seritler: Serit[] = [serit("nehir", nehirKenari, true), serit("park", parkKenari, false)];

  // --- Çerçeve: ağın dışında 4 şerit (üst/alt tam genişlik), çim + ağaç ---
  const sekiller: Dikdortgen[] = [
    { c0: kutu.c0, c1: kutu.c1, r0: kutu.r0, r1: kapsam.r0 },
    { c0: kutu.c0, c1: kutu.c1, r0: kapsam.r1, r1: kutu.r1 },
    { c0: kutu.c0, c1: kapsam.c0, r0: kapsam.r0, r1: kapsam.r1 },
    { c0: kapsam.c1, c1: kutu.c1, r0: kapsam.r0, r1: kapsam.r1 },
  ];
  const cerceve: ZeminKarosu[] = [];
  for (const s of sekiller) {
    for (const r of dizi(s.r0, s.r1, ro)) {
      for (const c of dizi(s.c0, s.c1, ro)) {
        const agac = fnv1a(`${tohum}|${sehir}|agac|${Math.round(c * 1000)}|${Math.round(r * 1000)}`) % 100 < IZO_STILI.agacOrani;
        cerceve.push(zeminKarosu(m, c, r, agac ? "agac" : "cim"));
      }
    }
  }

  // --- Kapılar: ana cadde uçlarının dış kenar ortası ---
  const anaD = dik.find((b) => b.ana);
  const anaY = yat.find((b) => b.ana);
  const kapilar: { yon: Yon; hucre: Hucre }[] = [];
  if (anaD) {
    kapilar.push({ yon: "kuzey", hucre: { c: anaD.konum, r: kapsam.r0 + ro / 2 } });
    kapilar.push({ yon: "guney", hucre: { c: anaD.konum, r: kapsam.r1 - ro / 2 } });
  }
  if (anaY) {
    kapilar.push({ yon: "dogu", hucre: { c: kapsam.c1 - ro / 2, r: anaY.konum } });
    kapilar.push({ yon: "bati", hucre: { c: kapsam.c0 + ro / 2, r: anaY.konum } });
  }

  return Object.freeze({
    ro,
    yollar: Object.freeze([...duzler, ...kavsakKarolari]),
    blokZemini: Object.freeze(blokZemini),
    parselZemini: Object.freeze(parselZemini),
    cerceve: Object.freeze(cerceve),
    seritler: Object.freeze(seritler),
    kapilar: Object.freeze(kapilar),
    kapsam: Object.freeze(kapsam),
    kutu: Object.freeze(kutu),
  });
}
