import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./DefinitionList.module.css";

type Props = {
  items: { term: ReactNode; detail: ReactNode }[];
  columns?: 1 | 2 | 4;
  mono?: boolean;
};

export function DefinitionList({ items, columns = 1, mono }: Props) {
  return (
    <dl className={cx(styles.list, styles[`c${columns}`])}>
      {items.map((item, i) => (
        <div key={i} className={styles.item}>
          <dt className={cx(styles.term, styles.wrap)}>{item.term}</dt>
          <dd className={cx(styles.detail, styles.wrap, mono && styles.mono)}>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
