import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Table.module.css";

type Name =
  | { caption: string; label?: string }
  | { label: string; caption?: string };

type Props = Name & {
  /** grid-template preset, named after the prototype tables: lead2 = 2fr 1fr 1fr 1fr, mid14 = 1fr 1.4fr 1fr 1fr,
   *  triple12 = 1.2fr x3 + 1fr, even4 = four equal columns, even5 = a wider name column + four equal columns, ledger7 = 56px + six fractions. */
  columns: "lead2" | "mid14" | "triple12" | "even4" | "even5" | "ledger7";
  minWidth: "sm" | "md" | "lg" | "xl";
  header: ReactNode[];
  rows: ReactNode[][];
  /** "card" draws the surface, border and radius around the table (earnings ledger, compare table). */
  frame?: "plain" | "card";
  /** regular = 14px row padding (C-03-Treasury:101), compact = 12px (C-03-Treasury:153, C-05b-DAO:75). */
  density?: "regular" | "compact";
  /** Per-column text alignment ("end" = right, C-03-Treasury:151, C-08-Earnings:82). */
  align?: ("start" | "end")[];
  /** Per-column monospace 15px body cells (C-03-Treasury:153). */
  mono?: boolean[];
  /** Body row indexes drawn with the selected background (C-08-Earnings rowBg). */
  selectedRows?: number[];
  /** Bar under the rows inside the same frame, outside the table element (C-08-Earnings:72 claim bar). */
  footer?: ReactNode;
};

/** Grid-based table with ARIA table roles; scrolls horizontally inside its own container.
 *  Accessible name (one of two is required): `caption` names the table (and the scroll region); `label` names the
 *  scroll region explicitly and wins over `caption` there (it names the table too when no caption is given). */
export function Table({ columns, minWidth, header, rows, caption, label, frame = "plain", density = "regular", align, mono, selectedRows, footer }: Props) {
  const row = cx(styles.row, styles[columns]);
  // The scroll wrapper is a named, keyboard-focusable region (axe scrollable-region-focusable).
  const name = label ?? caption;
  const scroll = (
    <div role="region" aria-label={name} tabIndex={0} className={cx(styles.scroll, frame === "card" && !footer && styles.card)}>
      <div role="table" aria-label={caption ?? label} className={cx(styles.table, styles[`min-${minWidth}`])}>
        <div role="rowgroup">
          <div role="row" className={cx(row, styles.head)}>
            {header.map((cell, i) => (
              <div key={i} role="columnheader" className={cx(styles.wrap, align?.[i] === "end" && styles.end)}>
                {cell}
              </div>
            ))}
          </div>
        </div>
        <div role="rowgroup">
          {rows.map((cells, r) => (
            <div key={r} role="row" className={cx(row, styles.body, density === "compact" && styles.compact, selectedRows?.includes(r) && styles.selected)}>
              {cells.map((cell, c) => (
                <div key={c} role="cell" className={cx(styles.wrap, align?.[c] === "end" && styles.end, mono?.[c] && styles.mono)}>
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  if (!footer) return scroll;
  return (
    <div className={cx(styles.frame, frame === "card" && styles.card)}>
      {scroll}
      <div className={styles.footer}>{footer}</div>
    </div>
  );
}
