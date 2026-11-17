import type { ReactNode, Ref } from "react";
import styles from "./BottomSheet.module.css";

/**
 * Phone modal shell (C-Mobile): a dark sheet pinned to the bottom of the screen on the sheet background.
 * Focus handling belongs to the caller (ApprovalDialog), which passes `ref`.
 */
export function BottomSheet({ labelledBy, ref, children }: { labelledBy: string; ref?: Ref<HTMLElement>; children: ReactNode }) {
  return (
    <div className={styles.overlay}>
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={styles.sheet}>
        {children}
      </section>
    </div>
  );
}
