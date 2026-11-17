"use client";
import { useEffect, useState, type RefObject } from "react";
import { VarlikYukleyici } from "@/oyun/harita/varlikYukleyici";
import type { BinaBoyu, Sablon } from "@/oyun/harita/tipler";

export type BinaIstegi = readonly [Sablon, BinaBoyu];
export const binaAnahtari = (sablon: Sablon, boy: BinaBoyu): string => `${sablon}-${boy}`;

/**
 * Giriş ekranları için bina resimleri: haritanın gerçek çizimleri, `kok` öğesinin (`.kok` takma adları) renkleriyle tonlanıp
 * nesne adresi olur. Yükleme başarısız olursa o resim yalnız eksik kalır (dekoratiftir, ekran bozulmaz).
 * Tema değişince yeniden tonlanır.
 */
export function useBinaResimleri(kok: RefObject<HTMLElement | null>, tema: string, istekler: readonly BinaIstegi[]): Readonly<Record<string, string>> {
  const [resimler, setResimler] = useState<Readonly<Record<string, string>>>({});
  const anahtar = istekler.map(([s, b]) => binaAnahtari(s, b)).join(",");
  useEffect(() => {
    const el = kok.current;
    if (el === null || typeof fetch !== "function") return;
    let iptal = false;
    const y = new VarlikYukleyici<string>({
      renk: (ad) => getComputedStyle(el).getPropertyValue(ad).trim(),
      getir: async (yol) => {
        const r = await fetch(yol);
        if (!r.ok) throw new Error(`${yol}: ${r.status}`);
        return r.text();
      },
      dokuYap: async (k) => ("svg" in k ? URL.createObjectURL(new Blob([k.svg], { type: "image/svg+xml" })) : k.url),
      tema: () => tema,
      koyu: () => tema === "dark",
      dokuYoket: (u) => {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      },
    });
    void Promise.all(
      istekler.map(async ([s, b]): Promise<[string, string] | null> => {
        try {
          return [binaAnahtari(s, b), await y.doku(s, b)];
        } catch {
          return null;
        }
      }),
    ).then((bitti) => {
      if (iptal) return;
      setResimler(Object.fromEntries(bitti.filter((x): x is [string, string] => x !== null)));
    });
    return () => {
      iptal = true;
      y.yoket();
    };
    // `istekler` içeriği `anahtar` ile izlenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kok, tema, anahtar]);
  return resimler;
}
