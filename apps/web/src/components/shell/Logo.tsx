import { Anchor } from "../primitives/Anchor";
import { cx } from "../primitives/cx";
import styles from "./Logo.module.css";

/** Three linked nodes (C-02-Treasuries:21). Drawn from path data and circles; colour and size come from CSS. */
function Mark({ compact }: { compact?: boolean }) {
  return (
    <svg viewBox="0 0 26 26" aria-hidden="true" focusable="false" className={cx(styles.mark, compact && styles.markCompact)}>
      <circle cx="13" cy="5" r="3" />
      <circle cx="5" cy="20" r="3" />
      <circle cx="21" cy="20" r="3" />
      <path d="M11.5 7.5 6.5 17.5M14.5 7.5l5 10M8 20h10" />
    </svg>
  );
}

/** The "daoliberal" link back to the landing page. `grow` pushes later header items to the right (landing header). */
export function Logo({ compact, grow }: { compact?: boolean; grow?: boolean }) {
  return (
    <Anchor href="/" className={cx(styles.logo, compact && styles.compact, grow && styles.grow)}>
      <Mark compact={compact} />
      daoliberal
    </Anchor>
  );
}
