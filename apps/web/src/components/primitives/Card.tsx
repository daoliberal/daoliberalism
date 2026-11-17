import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./Card.module.css";

type Props = Omit<HTMLAttributes<HTMLElement>, "className" | "style"> & {
  as?: "article" | "section" | "aside";
  /** default = white surface + 1px line; selected = same surface with a brand border; emphasis = 2px ink border; panel = always-dark panel */
  tone?: "default" | "selected" | "emphasis" | "panel";
  /** xs 16, compact 18, sm 20, md 24, lg 28, xl 32, row 20/24 */
  padding?: "xs" | "compact" | "sm" | "md" | "lg" | "xl" | "row";
  /** md = 20, lg = 24 */
  radius?: "md" | "lg";
  /** flex column gap between children; omitted = no gap */
  gap?: "10" | "12" | "14" | "16" | "18" | "20" | "22";
};

export function Card({ as: Tag = "section", tone = "default", padding = "md", radius = "md", gap, children, ...rest }: Props) {
  return (
    <Tag
      {...rest}
      className={cx(styles.card, styles.wrap, styles[tone], styles[`p-${padding}`], styles[`r-${radius}`], gap && styles[`g${gap}`])}
    >
      {children}
    </Tag>
  );
}
