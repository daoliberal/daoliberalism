import { cx } from "./cx";
import styles from "./SeatMeter.module.css";

type Props = { used: number; max: number; label: string; size?: "sm" | "md" };

export function SeatMeter({ used, max, label, size = "sm" }: Props) {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  const value = Number.isFinite(used) ? Math.min(Math.max(used, 0), top) : 0;
  return (
    <meter className={cx(styles.meter, size === "md" && styles.md)} value={value} min={0} max={top} aria-label={label}>
      {value} / {top}
    </meter>
  );
}
