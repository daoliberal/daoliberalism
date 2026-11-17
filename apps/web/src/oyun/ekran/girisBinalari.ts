"use client";
import { createContext, useContext } from "react";
import type { BinaIstegi } from "./useBinaResimleri";

/** Giriş ekranlarının kullandığı bina çizimleri: zemin döşemesi (soluk şehir) ve kart simgeleri. */
export const KART_SIMGELERI = { kurucu: ["sehir", 3], dao: ["ahir", 3], evren: ["lonca", 3] } as const satisfies Record<string, BinaIstegi>;

/** Süs resimlerinin alt metni: boş (ekran okuyucu atlar). */
export const SUS_ALT = "";

/** Soluk zeminde sırayla dizilen çizimler. */
export const ZEMIN_BINALARI: readonly BinaIstegi[] = [
  ["sehir", 3], ["imalat", 2], ["hizmet", 2], ["hammadde", 2], ["lojistik", 2], ["lonca", 3], ["ahir", 3], ["hizmet", 3], ["imalat", 3], ["hammadde", 3], ["lojistik", 3], ["sehir", 2],
];

export const ISTENEN_BINALAR: readonly BinaIstegi[] = [...new Set([...Object.values(KART_SIMGELERI), ...ZEMIN_BINALARI])];

/** `bina-anahtari -> nesne adresi`; kabuk dışında (ya da yüklenene dek) boştur. */
export const GirisBinalariBaglami = createContext<Readonly<Record<string, string>>>({});
export const useGirisBinalari = (): Readonly<Record<string, string>> => useContext(GirisBinalariBaglami);
