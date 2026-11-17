"use client";
import { useId } from "react";
import { Card } from "@/components/primitives/Card";
import { MoneyFlowBar } from "@/components/primitives/MoneyFlowBar";
import styles from "./LivePreview.module.css";

/** Prototype `n()` (C-04-CreateTreasury:142): what was typed as a number; unreadable or negative counts as 0. */
const typed = (v: string): number => {
  const x = Number.parseFloat(v);
  return Number.isFinite(x) && x >= 0 ? x : 0;
};
/** Prototype `fmt()` (C-04-CreateTreasury:146): four decimals, then up to two trailing zeros dropped. Display only. */
const fmt = (x: number): string => x.toFixed(4).replace(/0{1,2}$/, "");

type Props = {
  feeBps: number;
  expenseBps: number;
  name: string;
  /** The fee / expenses / hold / seat texts as typed (the prototype echoes the raw input). */
  feeLabel: string;
  expenseLabel: string;
  holdLabel: string;
  maxLabel: string;
  splitSentence: string;
};

/** What a 1 ETH payment does under the treasury being written (C-04-CreateTreasury:112). */
export function LivePreview({ feeBps, expenseBps, name, feeLabel, expenseLabel, holdLabel, maxLabel, splitSentence }: Props) {
  const titleId = useId();
  // The rows follow the prototype exactly: each percentage is read leniently, and only fee + expenses above 100% blanks the
  // owners' share.
  const fee = typed(feeLabel);
  const expense = typed(expenseLabel);
  const rest = fee + expense > 100 ? "—" : fmt((100 - fee - expense) / 100);

  return (
    <Card as="aside" tone="panel" radius="lg" padding="md" gap="16" aria-labelledby={titleId}>
      <div className={styles.caps}>LIVE PREVIEW</div>
      <h2 id={titleId} className={styles.title}>
        A 1 ETH payment under {name}
      </h2>
      <MoneyFlowBar size="lg" tone="panel" sliver="2" feeBps={feeBps} expenseBps={expenseBps} label={`Treasury fee ${feeLabel}%, expenses ${expenseLabel}%`} />
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.term}>Customer pays</dt>
          <dd className={styles.def}>1.00</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Treasury fee · {feeLabel}%</dt>
          <dd className={styles.def}>−{fmt(fee / 100)}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Expenses · {expenseLabel}%</dt>
          <dd className={styles.def}>−{fmt(expense / 100)}</dd>
        </div>
        <div className={`${styles.row} ${styles.last}`}>
          <dt className={styles.termBold}>To members&apos; owners</dt>
          <dd className={`${styles.def} ${styles.rest}`}>{rest}</dd>
        </div>
      </dl>
      <p className={styles.sentence}>
        {splitSentence}, available after <b>{holdLabel} days</b>. Seats: 0 / {maxLabel}.
      </p>
      <p className={styles.note}>This is exactly how agent owners will see your treasury when comparing.</p>
    </Card>
  );
}
