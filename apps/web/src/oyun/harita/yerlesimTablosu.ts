import { depolamaYaz, KOSU_SINIRI } from "./depolama";
import { yuvaAta, type Yuva } from "./sokakAgi";

export { KOSU_SINIRI };
/** Okunan tablodaki ızgara kademesi ve meydan yarıçapı için makul tavanlar (aşarsa tablo yok sayılır, yeniden tohumlanır). */
export const KADEME_TAVAN = 14;
export const MEYDAN_TAVAN = 600;

/**
 * Kalıcı yerleşim (K9): koşu boyunca {firma kimliği -> yuva kimliği} tablosu. Her hafta sıfırdan `yuvaAta` yerine mevcut atamalar korunur;
 * yeni firma boş yuvaya girer, listeden düşen firmanın yuvası boşalır, hiçbir canlı firma taşınmaz. Tablo yoksa (ilk açılış) çıktı `yuvaAta` ile aynıdır.
 * Yuva = klasikte parsel kimliği, izometrikte domino ankraj kimliği (genişleme parseli dominoyla birlikte rezervedir).
 */
export type YerlesimFirma = { id: string; /** `kapali` firma listedeyken (10 hafta) yuvasını tutar; listeden düşünce yuvası boşalır. */ kapali: boolean };
export type YerlesimTablosu = ReadonlyMap<string, string>;
/** Tabloda firma dışı kayıtlar `#` ile başlar: ızgara kademesi (asla küçülmez) ve tüketilmiş sabitlemeler. */
export const KADEME_ANAHTARI = "#kademe";
const SABIT_ONEKI = "#sabit:";
/** Meydan deliği yarıçapı (monoton; atanmış firma yuvası yutulmasın) ve deliğe sığmayıp parsele konan loncalar (`#lonca:<ref>` -> yuva). */
export const MEYDAN_ANAHTARI = "#meydan";
export const LONCA_ONEKI = "#lonca:";
export const tabloMeydani = (t: YerlesimTablosu | null | undefined): number => {
  const k = Number(t?.get(MEYDAN_ANAHTARI));
  return Number.isFinite(k) && k > 0 ? Math.min(k, MEYDAN_TAVAN) : 0;
};
/** Tablodaki ızgara kademesi tabanı (yoksa 0). */
export function tabloKademesi(t: YerlesimTablosu | null | undefined): number {
  const k = Number(t?.get(KADEME_ANAHTARI));
  return Number.isInteger(k) && k > 0 ? Math.min(k, KADEME_TAVAN) : 0;
}

const yuvaKonumu = (id: string): { r: number; c: number } | null => {
  const k = /^p(-?\d+)_(-?\d+)$/.exec(id);
  return k ? { r: Number(k[1]), c: Number(k[2]) } : null;
};
const mesafe = (a: string, b: string): number => {
  const p = yuvaKonumu(a);
  const q = yuvaKonumu(b);
  return p && q ? Math.hypot(p.r - q.r, p.c - q.c) : Infinity;
};

/**
 * Saf adım. `sabitlemeler` (K8): oyuncunun işletmesi -> seçtiği yuva. Yeni oyuncu firması önce oraya, doluysa en yakın boşa girer; firma sabitlemeden
 * önce başka yuvada (haritaya sabitlemeden önce girdiyse) ve sabit yuva boşsa BİR kez ona taşınır, sonra sabit kalır.
 */
export function yerlesimIlerlet(onceki: YerlesimTablosu | null, firmalar: readonly YerlesimFirma[], yuvalar: readonly Yuva[], tohum: string, sabitlemeler: ReadonlyMap<string, string> = new Map()): YerlesimTablosu {
  const idler = [...new Set(firmalar.map((f) => f.id))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (idler.length > yuvalar.length) throw new Error(`yerlesimIlerlet:${idler.length}>${yuvalar.length}`);
  const gecerli = new Set(yuvalar.map((y) => y.id));
  const sonuc = new Map<string, string>();
  const kullanim = new Set<string>();
  // Başkasının geçerli önceki yuvası (taşınamaz hedef).
  const tutan = new Map<string, string>();
  for (const id of idler) {
    const y = onceki?.get(id);
    if (y !== undefined && gecerli.has(y) && !tutan.has(y)) tutan.set(y, id);
  }
  // Sabitleme bir kez uygulanır: tüketildiyse (tabloda işaret var) firma bir daha taşınmaz.
  const bekleyenSabit = (id: string): string | undefined => (onceki?.has(SABIT_ONEKI + id) ? undefined : sabitlemeler.get(id));
  // 1. Sabitlenenler hedefi başkası tutmuyorsa oraya.
  for (const id of idler) {
    const hedef = bekleyenSabit(id);
    if (hedef === undefined || !gecerli.has(hedef) || kullanim.has(hedef)) continue;
    const sahibi = tutan.get(hedef);
    if (sahibi !== undefined && sahibi !== id) continue;
    sonuc.set(id, hedef);
    kullanim.add(hedef);
  }
  // 2. Mevcut atamalar korunur.
  for (const id of idler) {
    if (sonuc.has(id)) continue;
    const y = onceki?.get(id);
    if (y !== undefined && gecerli.has(y) && !kullanim.has(y)) {
      sonuc.set(id, y);
      kullanim.add(y);
    }
  }
  const bos = (): Yuva[] => yuvalar.filter((y) => !kullanim.has(y.id));
  // 3. Hedefi dolu sabitlenen yeni firma en yakın boşa.
  for (const id of idler) {
    if (sonuc.has(id)) continue;
    const hedef = bekleyenSabit(id);
    if (hedef === undefined) continue;
    let en: Yuva | null = null;
    let enMesafe = Infinity;
    for (const y of bos()) {
      const m = mesafe(hedef, y.id);
      if (en === null || m < enMesafe || (m === enMesafe && y.id < en.id)) { en = y; enMesafe = m; }
    }
    if (en !== null && enMesafe !== Infinity) {
      sonuc.set(id, en.id);
      kullanim.add(en.id);
    }
  }
  // 4. Kalanlar boş yuvalara deterministik.
  const kalan = idler.filter((id) => !sonuc.has(id));
  if (kalan.length > 0) {
    const serbest = bos();
    for (const [id, y] of yuvaAta(kalan, serbest, tohum)) sonuc.set(id, y);
  }
  // Sabitleme değerlendirildi: tüketildi (hedef sonradan boşalsa da firma taşınmaz).
  for (const id of idler) if (sabitlemeler.has(id)) sonuc.set(SABIT_ONEKI + id, "1");
  return sonuc;
}

// --- saklama (localStorage, koşu kimliği anahtarlı; hata/bozuk veri güvenli) ---

const ONEK = "daoliberal.yerlesim.";

function depo(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Kayıtlı tabloyu okur; yok ya da bozuksa null (çağıran `yuvaAta` ile tohumlar). Geçersiz girdiler atılır. */
export function tabloOku(anahtar: string): Map<string, string> | null {
  try {
    const ham = depo()?.getItem(ONEK + anahtar);
    if (ham == null) return null;
    const o: unknown = JSON.parse(ham);
    if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(o)) if (typeof v === "string") m.set(k, v);
    const kademe = m.get(KADEME_ANAHTARI);
    if (kademe !== undefined && !(/^\d+$/.test(kademe) && Number(kademe) <= KADEME_TAVAN)) return null;
    const meydan = m.get(MEYDAN_ANAHTARI);
    if (meydan !== undefined && !(/^\d+(\.\d+)?$/.test(meydan) && Number(meydan) <= MEYDAN_TAVAN)) return null;
    return m;
  } catch {
    return null;
  }
}

export function tabloYaz(anahtar: string, tablo: YerlesimTablosu, kosuId: string = anahtar.split(".")[0]!): void {
  depolamaYaz(kosuId, ONEK + anahtar, JSON.stringify(Object.fromEntries(tablo)));
}
