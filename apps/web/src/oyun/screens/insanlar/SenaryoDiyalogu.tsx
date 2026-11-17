"use client";
import { Grid } from "@/components/primitives/Grid";
import { t } from "@/oyun/copy/t";
import type { Registry } from "@/oyun/sim/types";
import { Diyalog } from "@/oyun/ui/Diyalog";
import { Rozet } from "@/oyun/ui/Rozet";
import { GERCEKCI_SENARYO, OZEL_SENARYO, senaryoSatirlari } from "./insanlarMantik";
import styles from "./Insanlar.module.css";

/** Dünya senaryosu seçici: hazır senaryolar + Özel. Başlatılamayan senaryo (`startable: false`) nedenli kilitlidir. */
export function SenaryoDiyalogu({ registry, secili, onSec, onKapat }: { registry: Registry; secili: string | null; onSec(id: string): void; onKapat(): void }) {
  const aktif = secili ?? GERCEKCI_SENARYO;
  const baslik = (id: string) => registry.cards.find((c) => c.id === id)?.title ?? id;
  return (
    <Diyalog baslik={t("senaryo.baslik")} onKapat={onKapat}>
      <p className={styles.giris}>{t("senaryo.giris")}</p>
      <p className={styles.not}>{t("senaryo.kurucu_not")}</p>
      <Grid minItem="260" gap="12">
        {registry.scenarios.map((s) => {
          const kilitli = s.startable === false;
          const satirlar = senaryoSatirlari(registry, s);
          return (
            <button key={s.id} type="button" className={styles.senaryo} aria-pressed={s.id === aktif} disabled={kilitli} onClick={() => onSec(s.id)}>
              <span className={styles.senaryoUst}>
                <strong className={styles.senaryoAd}>{s.title}</strong>
                {s.measured === false || (s.measured === undefined && s.id !== GERCEKCI_SENARYO) ? <Rozet kind="unmeasured" /> : null}
              </span>
              {s.what ? <span>{s.what}</span> : null}
              <span className={styles.not}>
                {t("senaryo.degisen", { liste: s.id === OZEL_SENARYO ? t("senaryo.degisen_ozel") : satirlar.length > 0 ? satirlar.join(", ") : t("senaryo.degisen_yok") })}
              </span>
              {kilitli ? <span className={styles.not}>{t("senaryo.baslatilamaz", { liste: (s.blocked_by ?? []).map(baslik).join(", ") })}</span> : null}
            </button>
          );
        })}
      </Grid>
      <p className={styles.not}>{t("senaryo.olculmedi_not")}</p>
    </Diyalog>
  );
}
