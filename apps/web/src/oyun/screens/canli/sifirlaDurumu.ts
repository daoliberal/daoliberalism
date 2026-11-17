"use client";
import { useSyncExternalStore } from "react";

/**
 * "Sıfırdan başlat" diyaloğunun açık/kapalı durumu. Düğme üst çubukta (`UstCubuk`) ve bitiş diyaloğunda, diyalog Canlı Dünya'dadır;
 * `degistirDurumu` gibi paylaşılan küçük bir dış durumdur.
 */
let acik = false;
const dinleyiciler = new Set<() => void>();
const duyur = (): void => {
  for (const d of [...dinleyiciler]) d();
};

export function sifirlaAc(): void {
  if (acik) return;
  acik = true;
  duyur();
}

export function sifirlaKapat(): void {
  if (!acik) return;
  acik = false;
  duyur();
}

export function useSifirlaAcik(): boolean {
  return useSyncExternalStore(
    (l) => {
      dinleyiciler.add(l);
      return () => dinleyiciler.delete(l);
    },
    () => acik,
    () => false,
  );
}
