import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import type { Gap } from "./Stack";
import styles from "./Grid.module.css";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "className" | "style"> & {
  minItem: "130" | "170" | "200" | "220" | "260" | "280" | "300" | "320" | "420" | "460" | "520";
  gap: Gap;
  /** Fixed column count; overrides the auto-fit minItem layout. */
  cols?: 2 | 3 | 4;
};

export function Grid({ minItem, gap, cols, children, ...rest }: Props) {
  return (
    <div {...rest} className={cx(styles.grid, styles[`g${gap}`], cols ? styles[`c${cols}`] : styles[`m${minItem}`])}>
      {children}
    </div>
  );
}
