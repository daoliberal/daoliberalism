import type { WeekPacket } from "@/oyun/sim/types";

export type Kenar = [string, string, string];

/**
 * Hafta `upto` için zincir kenar kümesi. Sunucu tam listeyi yalnız küme değiştiği haftanın paketinde yollar (`chain.edges`);
 * önceki haftalarda ve hiç değişmediyse başlangıç kümesi (`/info.world.chain`, sürüm 0) geçerlidir. Paketler artan hafta sıralıdır.
 */
export function chainKenarlari(weeks: WeekPacket[], upto: number, baslangic: Kenar[]): Kenar[] {
  let out = baslangic;
  for (const p of weeks) {
    if (p.week > upto) break;
    if (p.chain?.edges) out = p.chain.edges;
  }
  return out;
}
