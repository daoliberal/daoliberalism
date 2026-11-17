"use client";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import type { Registry, RegistryCard, ValuesPatch } from "@/oyun/sim/types";
import { RuleCard } from "@/oyun/ui/RuleCard";
import { kartKimligi } from "./KuralListesi";
import styles from "./SartOzel.module.css";

/**
 * Dünyanın sabit kalemleri: şehir kasasına giden, oyuncunun yazmadığı kalemler. Salt okunurdur (düzenleme denetimi yok);
 * değerleri kartın `shows` satırlarından gelir.
 */
export function SabitKalemler({ uid, cards, registry, draft, durationWeeks, seciliId }: {
  uid: string;
  cards: RegistryCard[];
  registry: Registry;
  draft: ValuesPatch;
  durationWeeks: number;
  seciliId: string | null;
}) {
  return (
    <Stack gap="12">
      <p className={styles.etiket}>{t("sart.salt_okunur")}</p>
      <p className={styles.kucuk}>{t("sart.sabit.not")}</p>
      {cards.map((card) => (
        <div key={card.id} id={kartKimligi(uid, card.id)} data-secili={seciliId === card.id ? "true" : undefined}>
          <RuleCard card={card} registry={registry} value={card.default} draft={draft} durationWeeks={durationWeeks} headingLevel={4} state="locked" lockReason="fixed" onChange={() => {}} />
        </div>
      ))}
    </Stack>
  );
}
