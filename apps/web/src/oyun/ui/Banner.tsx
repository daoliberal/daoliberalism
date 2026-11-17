import type { ReactNode } from "react";
import { cx } from "@/components/primitives/cx";
import { t } from "@/oyun/copy/t";
import styles from "./Banner.module.css";

export type BannerTone = "ok" | "warn" | "crisis" | "neutral";

const GLYPH = { ok: "●", warn: "▲", crisis: "■", neutral: "◆" } as const;
const PREFIX = { ok: "banner.tamam", warn: "banner.uyari", crisis: "banner.kriz", neutral: "banner.bilgi" } as const;

/** Durum bandı: farklı glif + görünür ön ek; `asItem` liste öğesi olarak canlı bölge gürültüsü üretmez. */
export function Banner({ tone, children, asItem }: { tone: BannerTone; children?: ReactNode; asItem?: boolean }) {
  return (
    <div role={asItem ? undefined : "status"} className={cx(styles.banner, styles[tone])}>
      <span aria-hidden="true">
        {GLYPH[tone]}
      </span>
      <span className={styles.metin}>
        <strong className={styles.onek}>{t(PREFIX[tone])}</strong> {children}
      </span>
    </div>
  );
}
