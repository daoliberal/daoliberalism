import { tr } from "@/oyun/copy/tr";
import { sektorOkunurAd } from "./sektorAdlari";

/** Sözlükte (`urun.ad.<kimlik>`) tanımlı ürün adı; yoksa `undefined`. */
export function urunSozlukAdi(urun: string): string | undefined {
  return (tr as Record<string, string>)[`urun.ad.${urun}`];
}

/** Ürünün oyuncuya görünen adı: sözlük, yoksa `yedek` (varsa), yoksa kimlikten okunur ad. */
export function urunAdiOf(urun: string, yedek?: (urun: string) => string | null): string {
  return urunSozlukAdi(urun) ?? yedek?.(urun) ?? sektorOkunurAd(urun);
}
