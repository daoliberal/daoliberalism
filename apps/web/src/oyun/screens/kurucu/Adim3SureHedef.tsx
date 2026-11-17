"use client";
import { useId } from "react";
import { Pill } from "@/components/primitives/Pill";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import type { GoalId } from "@/oyun/sim/types";
import { CokluSecim } from "@/oyun/ui/CokluSecim";
import styles from "./Kurucu.module.css";

/** Prototipteki dört hedef, kartın sırasıyla (gönderilen liste de bu sırayla gider). */
export const HEDEFLER: readonly GoalId[] = ["alive", "serve", "kasa", "gini"];

export type SureSecenegi = { hafta: number; /** `null` = seçilebilir; yoksa görünür kilit nedeni. */ neden: string | null };
export type DunyaSecenegi = { index: number; ad: string };

type Props = {
  sureler: SureSecenegi[];
  sure: number;
  onSure(hafta: number): void;
  dunyalar: DunyaSecenegi[];
  dunya: number;
  onDunya(index: number): void;
  dunyaMetni: string[];
  hedefler: GoalId[];
  onHedefler(v: GoalId[]): void;
  /** Kaynak hedefleri izlemiyorsa (kayıt) görünür neden; seçim kilitlenir. */
  hedefKilit?: string;
};

const isHedef = (v: string): v is GoalId => (HEDEFLER as readonly string[]).includes(v);

/** Adım 3 (Süre ve hedefler): koşu süresi, Başlangıç dünyası ve isteğe bağlı hedef karnesi. */
export function Adim3SureHedef({ sureler, sure, onSure, dunyalar, dunya, onDunya, dunyaMetni, hedefler, onHedefler, hedefKilit }: Props) {
  const uid = useId();
  const nedenler = [...new Set(sureler.flatMap((s) => (s.neden === null ? [] : [s.neden])))];
  const nedenId = (neden: string): string => `${uid}-neden-${nedenler.indexOf(neden)}`;
  return (
    <>
      <p className={styles.metin}>{t("kurucu.adim3.giris")}</p>
      <section className={styles.bolum} aria-labelledby={`${uid}-sure`}>
        <h3 id={`${uid}-sure`} className={styles.baslik}>
          {t("kurucu.adim3.sure_baslik")}
        </h3>
        <Stack gap="8" direction="row" wrap>
          {sureler.map((s) => (
            <Pill
              key={s.hafta}
              tone={s.hafta === sure ? "chipOn" : "chip"}
              aria-pressed={s.hafta === sure}
              disabled={s.neden !== null}
              aria-describedby={s.neden !== null ? nedenId(s.neden) : undefined}
              onClick={() => onSure(s.hafta)}
            >
              {t("kurucu.adim3.sure_hafta", { n: s.hafta })}
            </Pill>
          ))}
        </Stack>
        {nedenler.map((n) => (
          <p key={n} id={nedenId(n)} className={styles.kucuk}>
            {n}
          </p>
        ))}
      </section>

      <section className={styles.bolum} aria-labelledby={`${uid}-dunya`}>
        <h3 id={`${uid}-dunya`} className={styles.baslik}>
          {t("kurucu.dunya_baslik")}
        </h3>
        <Stack gap="8" direction="row" wrap>
          {dunyalar.map((d) => (
            <Pill key={d.index} tone={d.index === dunya ? "chipOn" : "chip"} aria-pressed={d.index === dunya} onClick={() => onDunya(d.index)}>
              {d.ad}
            </Pill>
          ))}
        </Stack>
        {dunyaMetni.map((m) => (
          <p key={m} className={styles.kucuk}>
            {m}
          </p>
        ))}
      </section>

      <section className={styles.bolum} aria-labelledby={`${uid}-hedef`}>
        <h3 id={`${uid}-hedef`} className={styles.baslik}>
          {t("kurucu.adim3.hedef_baslik")}
        </h3>
        <p id={`${uid}-hedef-not`} className={styles.kucuk}>
          {hedefKilit ?? t("kurucu.adim3.hedef_not")}
        </p>
        <CokluSecim
          items={HEDEFLER.map((g) => ({ value: g, label: t(`kurucu.hedef.${g}`, { n: sure }) }))}
          value={hedefKilit !== undefined ? [] : hedefler}
          disabled={hedefKilit !== undefined}
          labelledBy={`${uid}-hedef`}
          describedBy={hedefKilit !== undefined ? `${uid}-hedef-not` : undefined}
          onChange={(v) => onHedefler(v.filter(isHedef))}
        />
      </section>
    </>
  );
}
