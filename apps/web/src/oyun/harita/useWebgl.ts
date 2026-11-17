"use client";
import { useSyncExternalStore } from "react";

let bellek: boolean | null = null;

/** WebGL2 yoklaması bir kez yapılır (jsdom'da `getContext` null/hata verir, sonuç `false`). */
function yokla(): boolean {
  if (bellek !== null) return bellek;
  try {
    bellek = document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    bellek = false;
  }
  return bellek;
}
const abone = (): (() => void) => () => {};

/** Tarayıcıda WebGL2 var mı? Sunucuda ve hidrasyonda `false`. */
export function useWebgl(): boolean {
  return useSyncExternalStore(abone, yokla, () => false);
}
