"use client";
import { useCallback } from "react";
import { useGorunumTercihi } from "@/oyun/hooks/useOyunTercihleri";
import { spriteHatasiYaz, useSpriteHatasi, useUrlBayragi } from "./gorunumDurumu";
import { gorunumModu, istenenMod, manifestIstenir, type GorunumModu } from "./izoTercih";
import type { SpriteManifesti } from "./spriteManifest";
import { useSpriteManifest } from "./useSpriteManifest";
import { useWebgl } from "./useWebgl";

/**
 * Görünüm modunun tek kaynağı (Canli ve DaoOyun, `SehirTuvaliKap`'ın üstünde): WebGL, manifest durumu, tercih, bağlantı bayrağı ve sprite hatası.
 * `mod`: "bekle" (izo isteniyor, manifest yükleniyor), "izo" ya da "klasik". `manifest` yalnız hazırken doludur.
 * `dustu`: izo istenmişti, WebGL de vardı, ama manifest/sprite hatası yüzünden klasiğe düşüldü (kısa not için).
 */
export function useGorunumModu(): { mod: GorunumModu | "bekle"; spriteHatasiBildir(): void; manifest: SpriteManifesti | null; dustu: boolean } {
  const webgl = useWebgl();
  const urlBayragi = useUrlBayragi();
  const tercih = useGorunumTercihi();
  const spriteHatasi = useSpriteHatasi();
  const istenir = manifestIstenir({ webgl, tercih, urlBayragi, spriteHatasi });
  const { durum, manifest } = useSpriteManifest(istenir);
  const mod = gorunumModu({ webgl, manifest: durum, tercih, spriteHatasi, urlBayragi });
  const spriteHatasiBildir = useCallback(() => spriteHatasiYaz(true), []);
  const dustu = webgl && istenenMod({ tercih, urlBayragi }) === "izo" && mod === "klasik";
  return { mod, spriteHatasiBildir, manifest: mod === "izo" ? manifest : null, dustu };
}
