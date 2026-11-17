"use client";
import { Pill } from "@/components/primitives/Pill";
import { t } from "@/oyun/copy/t";
import type { SartGrubu } from "./sartMantik";
import styles from "./Sart.module.css";

/** Ayar grupları: numaralı düğmeler, geçerli grup `aria-current`; gruptaki değişen kural sayısı görünür metin ve okunur etikettir. */
export function GrupGezinme({ gruplar, secili, degisenSayisi, onSec }: { gruplar: SartGrubu[]; secili: string; degisenSayisi: Record<string, number>; onSec(id: string): void }) {
  return (
    <nav aria-label={t("sart.gruplar")} className={styles.gruplar}>
      {gruplar.map((g, i) => {
        const n = degisenSayisi[g.id] ?? 0;
        return (
          <Pill key={g.id} tone={g.id === secili ? "chipOn" : "chip"} aria-current={g.id === secili ? "page" : undefined} onClick={() => onSec(g.id)}>
            <span>{t("sart.grup", { n: i + 1, ad: g.title })}</span>
            {n > 0 ? (
              <span className={styles.sayi} aria-label={t("sart.grup_degisen", { n })}>
                {n}
              </span>
            ) : null}
          </Pill>
        );
      })}
    </nav>
  );
}
