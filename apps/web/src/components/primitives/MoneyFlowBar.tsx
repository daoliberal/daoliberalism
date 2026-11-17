import { cx } from "./cx";
import styles from "./MoneyFlowBar.module.css";

const MAX_STEPS = 200; // 200 x 0.5% = 100%

function steps(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.min(MAX_STEPS, Math.floor(bps / 50));
}

type Props = { feeBps: number; expenseBps: number; label: string; size?: "md" | "sm" | "lg"; tone?: "default" | "panel"; sliver?: "3" | "2" | "none" };

/** `sliver` = min width of an empty fee/expense slice: 3 (default), 2 (C-04-CreateTreasury:116), none (C-03-Treasury:84). `size` lg = 12px/radius 6 (C-03-Treasury:84); `tone` panel = theme-invariant slices for the dark calculator panel. Fee, expense and members slices; widths come from generated `.wN` classes (no inline style). */
export function MoneyFlowBar({ feeBps, expenseBps, label, size = "md", tone = "default", sliver = "3" }: Props) {
  const fee = steps(feeBps);
  const expense = Math.min(steps(expenseBps), MAX_STEPS - fee);
  return (
    <div role="img" aria-label={label} className={cx(styles.bar, styles[size], tone === "panel" && styles.panel, sliver === "2" && styles.sliver2, sliver === "none" && styles.sliverNone)}>
      <div className={cx(styles.fee, styles[`w${fee}`])} />
      <div className={cx(styles.expense, styles[`w${expense}`])} />
      <div className={styles.members} />
    </div>
  );
}
