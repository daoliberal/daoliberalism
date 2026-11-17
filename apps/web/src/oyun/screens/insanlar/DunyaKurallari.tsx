"use client";
import { useId } from "react";
import { Card } from "@/components/primitives/Card";
import { Grid } from "@/components/primitives/Grid";
import { t } from "@/oyun/copy/t";
import { formatValue } from "@/oyun/sim/formatValue";
import type { Registry, RegistryCard, ValuesPatch } from "@/oyun/sim/types";
import styles from "./Insanlar.module.css";

/** Dünya kuralları (Y): salt okunur; değer koşunun şartından/başlangıcından, yoksa modelin varsayılanından yazılır. */
export function DunyaKurallari({ registry, cards, degerler, kimlik }: { registry: Registry; cards: RegistryCard[]; degerler: ValuesPatch; kimlik(id: string): string }) {
  const uid = useId();
  if (cards.length === 0) return null;
  return (
    <section className={styles.bolum} aria-labelledby={`${uid}-baslik`}>
      <h3 id={`${uid}-baslik`} className={styles.baslik}>{t("insanlar.dunya_kurallari")}</h3>
      <p className={styles.not}>{t("insanlar.dunya_kurallari_not")}</p>
      <Grid minItem="320" gap="16">
        {cards.map((c) => (
          <Card as="article" gap="14" key={c.id} id={kimlik(c.id)} aria-label={c.title}>
            <h4 className={styles.kartBaslik} tabIndex={-1}>{c.title}</h4>
            <dl className={styles.dl}>
              <div className={styles.dlSatir}>
                <dt className={styles.dt}>{t("insanlar.simdiki")}</dt>
                <dd className={styles.dd}><strong className={styles.degerMetni}>{formatValue(c.control, c.id in degerler ? degerler[c.id]! : c.default, registry.units)}</strong></dd>
              </div>
              <div className={styles.dlSatir}>
                <dt className={styles.dt}>{t("card.what")}</dt>
                <dd className={styles.dd}>{c.what}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </Grid>
    </section>
  );
}
