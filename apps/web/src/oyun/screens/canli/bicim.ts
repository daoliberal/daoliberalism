import { t, type CopyKey } from "@/oyun/copy/t";
import { num, pct } from "@/oyun/lib/format";

/** Görünür kopya: ölçülmeyen (null ya da sonlu olmayan) değer "ölçülmüyor"; uydurma sayı yok. */
export const OLCULMUYOR = (): string => t("canli.gosterge.olculmuyor");

export const sonlu = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** `v` ölçülmüşse `f(v)`, değilse "ölçülmüyor". */
export function goster(v: number | null | undefined, f: (x: number) => string): string {
  return sonlu(v) ? f(v) : OLCULMUYOR();
}

const nf = (d: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
export const ondalik = (d: number) => (x: number): string => nf(d).format(x);
export const oran0 = (x: number): string => pct(x, 0);
export const oran1 = (x: number): string => pct(x, 1);
export const sayi = (x: number): string => num(x);
export const bin = (x: number): string => `${num(x / 1000)} ${t("seri.bin")}`;

/** Haftalık dünya sağlığı: ilk haftalarda uyarı yok (açılış dalgalanması), sonra karşılama eşikleri (prototip). */
export type Seviye = "ok" | "warn" | "bad" | "none";
export function seviye(hafta: number, served: number | null): Seviye {
  if (!sonlu(served)) return "none";
  if (hafta > 26 && served < 0.5) return "bad";
  if (hafta > 8 && served < 0.7) return "warn";
  return "ok";
}
export const SEVIYE_METIN: Record<Seviye, CopyKey> = { ok: "canli.saglik.ok", warn: "canli.saglik.warn", bad: "canli.saglik.bad", none: "canli.saglik.none" };
export const SEVIYE_GLIF: Record<Seviye, string> = { ok: "✓", warn: "▲", bad: "✕", none: "–" };

/** İşsizlik oranı: işsiz / (çalışan + işsiz); iş gücü sıfırsa ölçülmüyor. */
export function issizOrani(employed: number | null | undefined, unemployed: number | null | undefined): number | null {
  if (!sonlu(employed) || !sonlu(unemployed) || employed + unemployed <= 0) return null;
  return unemployed / (employed + unemployed);
}
