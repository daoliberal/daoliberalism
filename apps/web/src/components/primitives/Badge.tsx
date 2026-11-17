import type { ReactNode } from "react";
import { cx } from "./cx";
import { LockIcon } from "./icons";
import styles from "./Badge.module.css";

type Props = {
  /** warn = "Testnet"; fixed = "Rules fixed in Phase 1" (outlined, with lock). */
  tone: "warn" | "fixed";
  /** Status dot before the text (warn). */
  dot?: boolean;
  /** Lock icon before the text (fixed). */
  lock?: boolean;
  /** Mobile size: padding 3/10, 12px text, 7px dot, 11px lock (C-M1/C-M2). */
  compact?: boolean;
  children: ReactNode;
};

export function Badge({ tone, dot, lock, compact, children }: Props) {
  return (
    <span className={cx(styles.badge, styles[tone], compact && styles.compact)}>
      {dot && <span className={styles.dot} data-dot aria-hidden="true" />}
      {lock && <LockIcon size={compact ? "11" : "12"} />}
      {children}
    </span>
  );
}
