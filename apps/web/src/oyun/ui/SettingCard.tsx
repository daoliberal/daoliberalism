import { useId, type ReactNode } from "react";
import { Card } from "@/components/primitives/Card";
import { Stack } from "@/components/primitives/Stack";
import { t, type CopyKey } from "@/oyun/copy/t";
import { Rozet, type RozetKind } from "./Rozet";
import styles from "./SettingCard.module.css";

type NameKey = Extract<CopyKey, `setting.${string}.name`>;
export type SettingId = NameKey extends `setting.${infer I}.name` ? I : never;

type Lock = { state: "active"; lockReason?: undefined } | { state: "locked"; lockReason: CopyKey };
export type SettingCardProps = Lock & {
  id: SettingId;
  badges?: RozetKind[];
  /** Başlık düzeyi; kart bir grup başlığının altındaysa 4. Varsayılan 3. */
  headingLevel?: 3 | 4;
  /** `describedBy`/`labelledBy`: seçenek grubuna (`role="group"`) verilir; kilitliyken neden paragrafı ve başlık. */
  children: (p: { disabled: boolean; describedBy?: string; labelledBy: string }) => ReactNode;
};

export function SettingCard({ id, state, lockReason, badges, headingLevel = 3, children }: SettingCardProps) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const uid = useId();
  const titleId = `${uid}-baslik`;
  const lockId = `${uid}-kilit`;
  const locked = state === "locked";
  const key = (part: string) => `setting.${id}.${part}` as CopyKey;
  const rows = [
    ["card.what", key("what")],
    ["card.changes", key("changes")],
    ["card.hint", key("hint")],
  ] as const;
  return (
    <Card as="article" gap="14" aria-labelledby={titleId}>
      <Stack gap="8" direction="row" wrap align="center">
        <Heading id={titleId} className={styles.baslik} tabIndex={locked ? 0 : -1}>
          {t(key("name"))}
        </Heading>
        {badges?.map((b) => <Rozet key={b} kind={b} />)}
      </Stack>
      <dl className={styles.satirlar}>
        {rows.map(([label, text]) => (
          <div key={label} className={styles.satir}>
            <dt className={styles.etiket}>{t(label)}</dt>
            <dd className={styles.metin}>{t(text)}</dd>
          </div>
        ))}
      </dl>
      {locked && lockReason ? (
        <p id={lockId} className={styles.kilit}>
          {t(lockReason)}
        </p>
      ) : null}
      {children({ disabled: locked, describedBy: locked && lockReason ? lockId : undefined, labelledBy: titleId })}
    </Card>
  );
}
