"use client";
import { useEffect, useSyncExternalStore } from "react";
import { manifestCoz, SPRITE_YOLU, type SpriteManifesti } from "./spriteManifest";

export type ManifestDurumu = "yukleniyor" | "hazir" | "hata";
type Anlik = { durum: ManifestDurumu; manifest: SpriteManifesti | null };

const YUKLENIYOR: Anlik = { durum: "yukleniyor", manifest: null };
let anlik: Anlik = YUKLENIYOR;
let istendi = false;
const dinleyiciler = new Set<() => void>();
const yayinla = (a: Anlik): void => {
  anlik = a;
  for (const d of [...dinleyiciler]) d();
};

/** Test için: modül önbelleğini sıfırlar. */
export function manifestOnbelleginiSifirla(): void {
  anlik = YUKLENIYOR;
  istendi = false;
}

/** Hata durumundaki önbelleği sıfırlar (kullanıcı açıkça yeniden denerken); sonraki `useSpriteManifest(true)` yeniden çeker. */
export function manifestHatasiniSifirla(): void {
  if (anlik.durum !== "hata") return;
  istendi = false;
  yayinla(YUKLENIYOR);
}

function iste(): void {
  if (istendi) return;
  istendi = true;
  void (async () => {
    try {
      const r = await fetch(`${SPRITE_YOLU}manifest.json`);
      if (!r.ok) throw new Error(`manifest: ${r.status}`);
      yayinla({ durum: "hazir", manifest: manifestCoz(await r.json()) });
    } catch {
      yayinla({ durum: "hata", manifest: null });
    }
  })();
}

const abone = (f: () => void): (() => void) => {
  dinleyiciler.add(f);
  return () => void dinleyiciler.delete(f);
};

/**
 * Sprite manifesti (modül önbelleği, tek istek). `iste` false iken (kullanıcı klasik seçti, WebGL yok) hiç çekilmez ve durum "yukleniyor" kalır;
 * hangi modun istendiğine `useGorunumModu` karar verir.
 */
export function useSpriteManifest(iste_ = true): Anlik {
  const a = useSyncExternalStore(abone, () => anlik, () => YUKLENIYOR);
  useEffect(() => {
    if (iste_) iste();
  }, [iste_, a.durum]);
  return a;
}
