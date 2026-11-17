import type { WeekPacket } from "../types";

/**
 * Dikiş: hafta <= `seamWeek` `base`'ten aynen (aynı nesneler), sonrası `next`'ten
 * `version` ile. Uzunluk `next` kadardır.
 */
export function stitch(base: WeekPacket[], next: WeekPacket[], seamWeek: number, version: number): WeekPacket[] {
  return next.map((p, i) => (p.week <= seamWeek && base[i] ? base[i]! : { ...p, version: p.week > seamWeek ? version : p.version }));
}

/**
 * Hafta 1..`upToWeek` (kapsayıcı) `world` alanları eşit mi? Yalnız iki kayıtta da
 * `null` olmayan alanlar karşılaştırılır.
 */
export function prefixEqual(a: WeekPacket[], b: WeekPacket[], upToWeek: number): boolean {
  for (let w = 1; w <= upToWeek; w++) {
    const x = a[w - 1];
    const y = b[w - 1];
    if (!x || !y) return false;
    const wa = x.world as Record<string, number | null>;
    const wb = y.world as Record<string, number | null>;
    for (const k of Object.keys(wa)) {
      const va = wa[k];
      const vb = wb[k];
      if (va === null || va === undefined || vb === null || vb === undefined) continue;
      if (va !== vb) return false;
    }
  }
  return true;
}
