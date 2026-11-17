import { vi } from "vitest";
import type { SehirOzeti } from "@/oyun/ekran/OyunEkrani";

export const SEHIRLER: SehirOzeti[] = [
  { id: 0, ad: "Kuzey", ozet: "12 işletme" },
  { id: 1, ad: "Güney", ozet: "9 işletme" },
  { id: 2, ad: "Doğu", ozet: "7 işletme" },
];

/** Pencere genişliğini taklit eder: `(max-width: Npx)` sorguları genişliğe göre çözülür. */
export function genislikAyarla(px: number): void {
  vi.stubGlobal("matchMedia", (q: string) => {
    const m = /max-width:\s*(\d+)px/.exec(q);
    return {
      matches: m !== null && px <= Number(m[1]),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    };
  });
}
