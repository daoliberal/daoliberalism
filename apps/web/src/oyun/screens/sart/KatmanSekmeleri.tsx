"use client";
import { t } from "@/oyun/copy/t";
import { Sekmeler, type Sekme } from "@/oyun/ui/Sekmeler";

export type KatmanKimligi = "kurallar" | "insanlar" | "piyasa";

/** Katman sekmeleri: A (Kurallar) her zaman, B (Dünyanın insanları) ve C (Piyasa) kayıtta ilgili kartlar varsa. */
export function KatmanSekmeleri({ onek, mevcut, secili, onSec }: { onek: string; mevcut: KatmanKimligi[]; secili: KatmanKimligi; onSec(k: KatmanKimligi): void }) {
  const hepsi: Record<KatmanKimligi, Sekme> = {
    kurallar: { id: "kurallar", baslik: t("sart.katman_kurallar"), alt: t("sart.katman_kurallar_alt") },
    insanlar: { id: "insanlar", baslik: t("sart.katman_insanlar"), alt: t("sart.katman_insanlar_alt") },
    piyasa: { id: "piyasa", baslik: t("sart.katman_piyasa"), alt: t("sart.katman_piyasa_alt") },
  };
  return (
    <Sekmeler
      etiket={t("sart.katmanlar")} onek={onek} buyuk sekmeler={mevcut.map((k) => hepsi[k])} secili={secili}
      onSec={(id) => onSec(id as KatmanKimligi)}
    />
  );
}
