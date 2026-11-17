"use client";
import { useSyncExternalStore } from "react";
import { urlBayragiOku, type GorunumModu } from "./izoTercih";

/**
 * Görünümle ilgili modül düzeyi durum (Canli/DaoOyun ve üst çubuk aynı değeri görür):
 * oturum boyu sprite hatası ve `?gorunum=` bağlantı bayrağı. Sprite hatası bayrağı yalnız açık `setGorunum("izo")` eyleminde (`spriteHatasiYaz(false)`)
 * sıfırlanır; son abone ayrılınca (ekran değişimi) sıfırlanmaz, yoksa çöken izo her ekran geçişinde yeniden denenirdi.
 */
let spriteHatasi = false;
const dinleyiciler = new Set<() => void>();
const bildir = (): void => {
  for (const d of [...dinleyiciler]) d();
};
const abone = (f: () => void): (() => void) => {
  dinleyiciler.add(f);
  window.addEventListener("popstate", f);
  return () => {
    dinleyiciler.delete(f);
    window.removeEventListener("popstate", f);
  };
};

export function spriteHatasiYaz(v: boolean): void {
  if (spriteHatasi === v) return;
  spriteHatasi = v;
  bildir();
}
export function useSpriteHatasi(): boolean {
  return useSyncExternalStore(abone, () => spriteHatasi, () => false);
}

const bayrakAl = (): GorunumModu | null => urlBayragiOku(window.location.search);
export function useUrlBayragi(): GorunumModu | null {
  return useSyncExternalStore(abone, bayrakAl, () => null);
}
/** Menüden açık seçim yapılınca bağlantı bayrağı tercihi ezmesin: `gorunum` paramı adres çubuğundan silinir. */
export function urlBayraginiTemizle(): void {
  const u = new URL(window.location.href);
  if (!u.searchParams.has("gorunum")) return;
  u.searchParams.delete("gorunum");
  window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}${u.hash}`);
  bildir();
}
