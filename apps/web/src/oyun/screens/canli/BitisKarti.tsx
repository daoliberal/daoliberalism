import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import { t } from "@/oyun/copy/t";
import type { WorldEvent } from "@/oyun/sim/types";
import { Banner, type BannerTone } from "@/oyun/ui/Banner";
import { collapseRecovery } from "./olaylar";
import styles from "./Canli.module.css";

/** 200. hafta: çöküş haftası ve toparlanma birlikte yazılır. */
export function bitisMetni(events: WorldEvent[]): { metin: string; tone: BannerTone } {
  const { cokus, toparlanma } = collapseRecovery(events);
  const metin =
    cokus === null
      ? t("bitis.cokmedi")
      : toparlanma === null
        ? t("bitis.cokus_toparlanmadi", { c: cokus })
        : t("bitis.cokus_toparlanma", { c: cokus, r: toparlanma });
  return { metin, tone: cokus === null ? "ok" : toparlanma === null ? "crisis" : "warn" };
}

/** Bitiş diyaloğu kapalıyken kalan özet kartı; diyaloğu yeniden açar. */
export function BitisKarti({ weeks, events, ac }: { weeks: number; events: WorldEvent[]; ac(): void }) {
  const { metin, tone } = bitisMetni(events);
  return (
    <section aria-labelledby="bitis" className={styles.bolum}>
      <h2 id="bitis" className={styles.baslik}>
        {t("bitis.baslik", { n: weeks })}
      </h2>
      <Stack gap="10" align="start">
        <Banner tone={tone}>{metin}</Banner>
        <Button variant="primary" onClick={ac}>
          {t("canli.bitis.ac")}
        </Button>
      </Stack>
    </section>
  );
}
