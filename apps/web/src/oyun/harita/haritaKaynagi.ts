import type { Capabilities, WeekPacket } from "@/oyun/sim/types";
import { haritaModeli } from "./haritaModeli";
import type { HaritaBaglami, HaritaFarki, HaritaModeli, HaritaVerisi } from "./tipler";

/** Canlı ekran ile veri katmanı (haritaModeli) arasındaki köprü. */

/** Kaynak bina verisini taşıyor mu? Kayıt kaynağında yok: sekme kilitli. */
export function haritaAcik(c: Capabilities): boolean {
  return c.harita === true;
}

/** Gelen son `harita` alanı (yalnız anlık görüntü haftalarında gelir). */
export function sonHarita(weeks: WeekPacket[]): HaritaVerisi | null {
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    const h = weeks[i]!.harita;
    if (h) return h;
  }
  return null;
}

/** Gelen son `haritaFark` alanı (Kurucu'da tam harita taşımayan haftalar). Artımlı: yalnız en sonu alınır, geçmiş katlanmaz (fark her zaman son tam haritaya göredir). */
export function sonFark(weeks: WeekPacket[]): HaritaFarki | null {
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    const f = weeks[i]!.haritaFark;
    if (f) return f;
  }
  return null;
}

/**
 * Tam haritayı (`baz`) farkla birleştirir ve `hafta = fark.hafta` yapar; `baz` ya da `fark` yoksa ya da `fark.taban !== baz.hafta` ise (araya giren/yeniden bağlanan istemci: elindeki
 * tam alan farkın tabanı değil) `null`: bir sonraki tam alana kadar beklenir, çökme yok. Baz değişmez. Sıra: tabandaki sıra (değişenler yerinde), sonra `yeni`.
 */
export function haritaBirlestir(baz: HaritaVerisi | null, fark: HaritaFarki | null): HaritaVerisi | null {
  if (baz === null || fark === null || fark.taban !== baz.hafta) return null;
  const degisen = new Map(fark.degisen.map(([id, durum, calisan]) => [id, { durum, calisan }] as const));
  const kapanan = new Set(fark.kapanan);
  const firmalar: HaritaVerisi["firmalar"] = [];
  for (const s of baz.firmalar) {
    if (kapanan.has(s[0])) continue;
    const d = degisen.get(s[0]);
    firmalar.push(d === undefined ? s : [s[0], s[1], s[2], d.calisan, s[4], s[5], s[6], d.durum]);
  }
  for (const s of fark.yeni) firmalar.push(s);
  return { hafta: fark.hafta, firmalar };
}

/** Ekranın kullandığı güncel harita: son tam alan + (tabanı o ise) son fark; fark uymuyorsa son tam alan, o da yoksa null. */
export function guncelHarita(weeks: WeekPacket[]): HaritaVerisi | null {
  const baz = sonHarita(weeks);
  return haritaBirlestir(baz, sonFark(weeks)) ?? baz;
}

export function modelOlustur(cur: WeekPacket, weeks: WeekPacket[], baglam: HaritaBaglami): HaritaModeli {
  return haritaModeli(cur, guncelHarita(weeks), baglam);
}
