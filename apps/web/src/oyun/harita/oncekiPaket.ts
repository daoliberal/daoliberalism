import type { WeekPacket } from "@/oyun/sim/types";
import { KATMAN_STILI } from "./haritaStili";

/**
 * Fiyat katmanının kıyas paketi: `cur`dan `KATMAN_STILI.fiyat.hafta` hafta önceki paket (tam o hafta yoksa ondan önceki en yeni paket).
 * Kayıt ve canlı kaynakta aynı: paketler hafta sırasına bakılmadan taranır. Yeterince eski paket yoksa `null` (fiyat katmanı "yok" olur).
 */
export function oncekiPaket(weeks: readonly WeekPacket[], cur: WeekPacket | null): WeekPacket | null {
  if (cur === null) return null;
  const hedef = cur.week - KATMAN_STILI.fiyat.hafta;
  let en: WeekPacket | null = null;
  for (const p of weeks) if (p.week <= hedef && (en === null || p.week > en.week)) en = p;
  return en;
}
