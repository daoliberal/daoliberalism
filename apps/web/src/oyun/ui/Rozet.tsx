import { t, type CopyKey } from "@/oyun/copy/t";
import { cx } from "@/components/primitives/cx";
import styles from "./Rozet.module.css";

export type RozetKind = "today" | "planned" | "server" | "experimental" | "unmeasured" | "founderPrinciple" | "passive";

const GLYPH: Record<RozetKind, string> = {
  today: "●",
  planned: "○",
  server: "▣",
  experimental: "◇",
  unmeasured: "△",
  founderPrinciple: "★",
  passive: "▫",
};

/** Glif (ayrı şekil) + metin; renk tek başına anlam taşımaz. `etiket` verilirse türün varsayılan metni yerine o yazılır. */
export function Rozet({ kind, etiket }: { kind: RozetKind; etiket?: string }) {
  return (
    <span className={cx(styles.rozet, styles[kind])}>
      <span aria-hidden="true">
        {GLYPH[kind]}
      </span>
      {etiket ?? t(`rozet.${kind}` as CopyKey)}
    </span>
  );
}
