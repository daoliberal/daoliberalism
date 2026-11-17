"use client";
import type { Balon } from "./izoOlay";
import { useEffect, useMemo } from "react";
import type { GorunumModu } from "./izoTercih";
import type { Gecis, GorselDurum } from "./izoDurum";
import { etkinSehirSahnesi, izoSahneKur, type IzoSahne } from "./izoSahne";
import type { SpriteManifesti } from "./spriteManifest";
import type { SehirSahnesi } from "./tipler";

export type EtkinSahne = {
  /** Tuvalde çizilen sahne: izo modunda `IzoSahne`, aksi halde (klasik, bekle, izo kurulamadı) klasik. */
  sahne: SehirSahnesi | IzoSahne | null;
  /** Panel, lejant, ben, ilan, seçim, kur hedefi ve odak etkin sahnenin klasik görünümünden okunur. */
  kaynak: SehirSahnesi | null;
  /** Tuvalde izometrik sahne çiziliyor mu. */
  izoMu: boolean;
};

type Girdi = {
  mod: GorunumModu | "bekle";
  manifest: SpriteManifesti | null;
  /** Klasik yerleşimli sahne (her zaman kurulur; tablo ve klasik/bekle çizimi buradan). */
  klasik: SehirSahnesi | null;
  /** İzo yerleşimli (`izo: true`) klasik sahne; yalnız mod `izo` iken kurulur. */
  izoKaynak: SehirSahnesi | null;
  tohum: string;
  gorselBoy: (id: string, hamBoy: 1 | 2 | 3 | 4) => 1 | 2 | 3 | 4;
  spriteHatasiBildir(): void;
  /** İşletme görsel durumları (id -> durum) ve son güncellemenin yeni geçişleri; çizim içindir, yerleşimi etkilemez. */
  durumlar?: ReadonlyMap<string, GorselDurum>;
  gecisler?: readonly Gecis[];
  /** Olay balonları (`balonlar`); çizim içindir. */
  balonlar?: readonly Balon[];
};

/**
 * Etkin sahneyi `useMemo`'da kurar: izo modunda `izoSahneKur(izoKaynak, manifest, tohum, gorselBoy, { ...(durumlar ? { durumlar } : {}), ...(gecisler ? { gecisler } : {}) })`, klasikte hiç çağrılmaz.
 * Kurulum atarsa (ör. plaza yetmedi) sprite hatası sayılır ve mod klasiğe düşer.
 */
export function useEtkinSahne({ mod, manifest, klasik, izoKaynak, tohum, gorselBoy, spriteHatasiBildir, durumlar, gecisler, balonlar }: Girdi): EtkinSahne {
  const izo = useMemo((): { sahne: IzoSahne | null; hata: unknown } => {
    if (mod !== "izo" || manifest === null || izoKaynak === null) return { sahne: null, hata: null };
    try {
      return { sahne: izoSahneKur(izoKaynak, manifest, tohum, gorselBoy, { ...(durumlar ? { durumlar } : {}), ...(gecisler ? { gecisler } : {}), ...(balonlar ? { balonlar } : {}) }), hata: null };
    } catch (e) {
      return { sahne: null, hata: e };
    }
  }, [mod, manifest, izoKaynak, tohum, gorselBoy, durumlar, gecisler, balonlar]);
  const hata = izo.hata;
  useEffect(() => {
    if (hata !== null) spriteHatasiBildir();
  }, [hata, spriteHatasiBildir]);
  const sahne = izo.sahne ?? klasik;
  return { sahne, kaynak: sahne === null ? null : etkinSehirSahnesi(sahne), izoMu: izo.sahne !== null };
}
