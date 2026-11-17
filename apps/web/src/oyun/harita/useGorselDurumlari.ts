"use client";
import { useMemo } from "react";
import { durumHaritasi, type GorselDurum } from "./izoDurum";
import type { HaritaGecisleri } from "./useHaritaGecisleri";
import type { HaritaVerisi } from "./tipler";

/**
 * Haritadaki işletmelerin görsel durumları (id -> durum): `gorselDurum` her satıra uygulanır; `oncekiKapaliydi` yalnız bu haftanın `canlandi` geçişi olan
 * kimliklerde true verilir. Harita yoksa undefined (sahne ham harita durumunu kullanır).
 */
export function useGorselDurumlari(harita: HaritaVerisi | null, gecis: Pick<HaritaGecisleri, "gecisler" | "ilkGorulme">): ReadonlyMap<string, GorselDurum> | undefined {
  const { gecisler, ilkGorulme } = gecis;
  return useMemo(() => {
    if (harita === null) return undefined;
    const canlananlar = new Set(gecisler.filter((g) => g.tur === "canlandi" && g.hafta === harita.hafta).map((g) => g.id));
    return durumHaritasi(harita, ilkGorulme, canlananlar);
  }, [harita, gecisler, ilkGorulme]);
}
