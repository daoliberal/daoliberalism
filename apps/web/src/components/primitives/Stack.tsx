import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./Stack.module.css";

export type Gap = "2" | "4" | "6" | "8" | "10" | "12" | "16" | "18" | "20" | "24" | "32" | "40";

type Props = Omit<HTMLAttributes<HTMLDivElement>, "className" | "style"> & {
  gap: Gap;
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  direction?: "row" | "column";
};

export function Stack({ gap, align, justify, wrap, direction = "column", children, ...rest }: Props) {
  return (
    <div
      {...rest}
      className={cx(
        styles.stack,
        styles[direction],
        styles[`g${gap}`],
        align && styles[`a-${align}`],
        justify && styles[`j-${justify}`],
        wrap && styles.wrap,
      )}
    >
      {children}
    </div>
  );
}
