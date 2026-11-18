/** Cekirdek hatalarinin akis sonuclarina ayrilmasi (B4a Z2) ve oynatma suresi tahmini. */
import { hataFark, hataTuru } from "./cekirdek";
import { BOZUK_FARK_ALANLARI, SURUM_FARK_ALANLARI, type Fark } from "./tel";

/** Hafta basina model suresi araligi (sn): B4a olcumu ~1,5-6 sn/hf. */
export const OYNATMA_SN_HAFTA = { enAz: 1.5, enCok: 6 } as const;

export interface SureTahmini {
  hafta: number;
  enAzSn: number;
  enCokSn: number;
}

export function tahminiOynatma(hafta: number): SureTahmini {
  const h = Math.max(0, Math.floor(hafta));
  return { hafta: h, enAzSn: h * OYNATMA_SN_HAFTA.enAz, enCokSn: h * OYNATMA_SN_HAFTA.enCok };
}

/**
 * `surum`: model/Pyodide/sema/host yapisi farki (yeni surumde bastan oynat); `guvensiz`: izin listesi disi sinif (yerel bozulma ya da kurcalama);
 * `bozuk`: biçim/yukleme/akis hatasi. Yalniz `UyumsuzGoruntu` ailesi icin dolu, diger hatalar `null`.
 */
export type UyumsuzTur = "surum" | "guvensiz" | "bozuk";

export function uyumsuzTuru(e: unknown): UyumsuzTur | null {
  const tur = hataTuru(e);
  if (tur === "GuvensizGoruntu") return "guvensiz";
  if (tur !== "UyumsuzGoruntu") return null;
  const fark = hataFark(e) ?? {};
  if ("guvensiz" in fark) return "guvensiz";
  if (BOZUK_FARK_ALANLARI.some((a) => a in fark)) return "bozuk";
  if (SURUM_FARK_ALANLARI.some((a) => a in fark)) return "surum";
  return "bozuk"; // taninmayan fark: surum farki sayilmaz (sessiz yeniden oynatma yok)
}

/** Iki anahtar arasindaki fark (`{alan: [kayitta, simdi]}`); bos = uyumlu. */
export function anahtarFarki(kayitta: Record<string, unknown>, simdi: Record<string, unknown>): Fark {
  const fark: Fark = {};
  for (const k of Object.keys(simdi)) if (kayitta[k] !== simdi[k]) fark[k] = [kayitta[k] ?? null, simdi[k]];
  return fark;
}

export const KALICI_DUMP_HATALARI = ["TaninmayanReferans", "TaninmayanLambda"] as const;
export function kaliciDumpHatasi(e: unknown): boolean {
  return (KALICI_DUMP_HATALARI as readonly string[]).includes(hataTuru(e));
}
export function gecici(e: unknown): boolean {
  return hataTuru(e) === "GoruntuHazirDegil";
}
