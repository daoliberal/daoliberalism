import { HARITA_STILI } from "./haritaStili";
import { DUNYA, type Bolge } from "./tipler";

/** Dünya boyutu `tipler.DUNYA`; konumlar yalnız kimlikten (`runId|id`) türer. */
const GENISLIK = DUNYA.genislik;

export type Dikdortgen = { x: number; y: number; genislik: number; yukseklik: number };

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(tohum: number): () => number {
  let a = tohum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KENAR = 20;
const ARALIK = 12;
const ALAN_ALT = 610;
const SERIT_YUKSEKLIK = 64;
const SATIR_EN_COK = 260;
/** Şehir etiketi ve şehir binası için bölgenin üstünde ayrılan bant; işletmeler bunun altına yerleşir. */
const BASLIK = 44;
const IC_BOSLUK = 16;

/** Bina yarıçapı (dünya birimi), boyut 1-4: çizilen boyutun yarısı + aralık; stil değişince çakışma kalmaz. */
export const YARICAP: Record<1 | 2 | 3 | 4, number> = {
  1: HARITA_STILI.boyut[1] / 2 + HARITA_STILI.aralik,
  2: HARITA_STILI.boyut[2] / 2 + HARITA_STILI.aralik,
  3: HARITA_STILI.boyut[3] / 2 + HARITA_STILI.aralik,
  4: HARITA_STILI.boyut[4] / 2 + HARITA_STILI.aralik,
};

export const AHIR: Dikdortgen = { x: 420, y: 630, genislik: 160, yukseklik: 50 };

export const satirSayisi = (sehirSayisi: number): number => (sehirSayisi <= 3 ? 1 : sehirSayisi <= 6 ? 2 : 3);

export type DunyaYerlesimi = { bolgeler: Dikdortgen[]; lonca: Dikdortgen };

/** Şehir bölgeleri ızgarada (1-3 şehir tek sıra, 4-6 iki, 7+ üç sıra); lonca şeridi satırların ortasında. */
export function dunyaYerlesimi(sehirSayisi: number): DunyaYerlesimi {
  const satir = satirSayisi(sehirSayisi);
  const sutun = Math.max(1, Math.ceil(sehirSayisi / satir));
  const alan = ALAN_ALT - KENAR;
  const satirYuksekligi = Math.min(SATIR_EN_COK, (alan - SERIT_YUKSEKLIK - satir * ARALIK) / satir);
  const yigin = satir * satirYuksekligi + SERIT_YUKSEKLIK + satir * ARALIK;
  const baslangic = KENAR + (alan - yigin) / 2;
  const seritSirasi = Math.ceil(satir / 2);
  const genislik = (GENISLIK - 2 * KENAR - (sutun - 1) * ARALIK) / sutun;

  const satirY: number[] = [];
  let y = baslangic;
  let lonca: Dikdortgen = { x: KENAR, y, genislik: GENISLIK - 2 * KENAR, yukseklik: SERIT_YUKSEKLIK };
  for (let s = 0; s <= satir; s++) {
    if (s === seritSirasi) {
      lonca = { x: KENAR, y, genislik: GENISLIK - 2 * KENAR, yukseklik: SERIT_YUKSEKLIK };
      y += SERIT_YUKSEKLIK + ARALIK;
    }
    if (s < satir) {
      satirY.push(y);
      y += satirYuksekligi + ARALIK;
    }
  }
  const bolgeler: Dikdortgen[] = [];
  for (let i = 0; i < sehirSayisi; i++) {
    bolgeler.push({ x: KENAR + (i % sutun) * (genislik + ARALIK), y: satirY[Math.floor(i / sutun)], genislik, yukseklik: satirYuksekligi });
  }
  return { bolgeler, lonca };
}

/** Şehir DAO binasının (sabit) konumu: bölgenin sağ üst köşesi. */
export const sehirBinasiKonumu = (b: Pick<Bolge, "x" | "y" | "genislik">): { x: number; y: number } => ({ x: b.x + b.genislik - 28, y: b.y + 26 });

/** Bir bölgede işletmelerin yerleşebileceği iç alan (başlık bandı hariç). */
export const isletmeAlani = (b: Dikdortgen): Dikdortgen => ({
  x: b.x + IC_BOSLUK, y: b.y + BASLIK + IC_BOSLUK, genislik: Math.max(1, b.genislik - 2 * IC_BOSLUK), yukseklik: Math.max(1, b.yukseklik - BASLIK - 2 * IC_BOSLUK),
});

export const seritAlani = (b: Dikdortgen): Dikdortgen => ({ x: b.x + IC_BOSLUK, y: b.y + 12, genislik: b.genislik - 2 * IC_BOSLUK, yukseklik: Math.max(1, b.yukseklik - 24) });

const DENEME = 24;
const HUCRE = 40;

export type YerlesimIstegi = { id: string; yaricap: number };

/**
 * Alan içinde her kimliğe kendi tohumundan bir nokta verir. Aday noktalar kimliğin kendi akışından
 * gelir; önceden yerleşmiş (kimliğe göre sıralı) binalarla çakışan aday atlanır, `DENEME` içinde yer
 * bulunamazsa son aday kabul edilir (çakışma, taşmadan iyidir). Çakışma yoksa konum yalnız kimliğe
 * bağlıdır: işletme gelip gidince ötekiler yerinde kalır; sıralama kimliğe göre olduğundan girdi sırası etkisizdir.
 */
export function yerlestir(istekler: YerlesimIstegi[], alan: Dikdortgen, runId: string): Map<string, { x: number; y: number }> {
  const sirali = [...istekler].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const hucreler = new Map<string, { x: number; y: number; r: number }[]>();
  const anahtar = (cx: number, cy: number): string => `${cx},${cy}`;
  const cakisir = (x: number, y: number, r: number): boolean => {
    const cx = Math.floor(x / HUCRE);
    const cy = Math.floor(y / HUCRE);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const o of hucreler.get(anahtar(i, j)) ?? []) if (Math.hypot(o.x - x, o.y - y) < o.r + r + 2) return true;
      }
    }
    return false;
  };
  const sonuc = new Map<string, { x: number; y: number }>();
  for (const { id, yaricap } of sirali) {
    const rng = mulberry32(fnv1a(`${runId}|${id}`));
    let x = 0;
    let y = 0;
    for (let d = 0; d < DENEME; d++) {
      x = alan.x + rng() * alan.genislik;
      y = alan.y + rng() * alan.yukseklik;
      if (!cakisir(x, y, yaricap)) break;
    }
    x = Math.round(x * 10) / 10;
    y = Math.round(y * 10) / 10;
    sonuc.set(id, { x, y });
    const k = anahtar(Math.floor(x / HUCRE), Math.floor(y / HUCRE));
    const liste = hucreler.get(k);
    if (liste) liste.push({ x, y, r: yaricap });
    else hucreler.set(k, [{ x, y, r: yaricap }]);
  }
  return sonuc;
}
