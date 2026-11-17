import type { ReactNode } from "react";
import { cx } from "./cx";
import { LockIcon } from "./icons";
import styles from "./Callout.module.css";

type Props = {
  tone: "caution";
  /** block (default): bordered box with optional title and body paragraph; inline: one-row notice (C-09-Approval:45). */
  layout?: "block" | "inline";
  title?: string;
  /** false drops the lock icon and the head row (C-06-CreateDAO:85). */
  icon?: boolean;
  /** Acknowledgement row (label + checkbox) rendered below the body (C-04-CreateTreasury:94). */
  action?: ReactNode;
  children: ReactNode;
};

export function Callout({ tone, layout = "block", title, icon = true, action, children }: Props) {
  if (layout === "inline") {
    return (
      <div role="note" className={cx(styles.callout, styles[tone], styles.inline)}>
        <span className={styles.icon}>
          <LockIcon size="20" />
        </span>
        <span className={styles.inlineText}>{children}</span>
      </div>
    );
  }
  const text = <p className={cx(styles.text, title && icon && styles.textAfterTitle)}>{children}</p>;
  const heading = title ? <div className={styles.title}>{title}</div> : null;
  return (
    <div role="note" className={cx(styles.callout, styles[tone], styles.block)}>
      {icon ? (
        <div className={styles.head}>
          <span className={styles.icon}>
            <LockIcon size="28" />
          </span>
          <div className={styles.body}>
            {heading}
            {text}
          </div>
        </div>
      ) : (
        <>
          {heading}
          {text}
        </>
      )}
      {action && (
        <div className={styles.ack} data-ack>
          {action}
        </div>
      )}
    </div>
  );
}
