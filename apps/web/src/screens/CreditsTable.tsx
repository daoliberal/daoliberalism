"use client";
import type { ReactNode } from "react";
import { Anchor } from "@/components/primitives/Anchor";
import { cx } from "@/components/primitives/cx";
import { Table } from "@/components/primitives/Table";
import type { Credit, Hex } from "@/data/types";
import { formatEth, formatHoldDayCount, formatOrderId } from "@/lib/format";
import { creditStatus } from "@/lib/creditView";
import { formatShortDate } from "@/lib/time";
import styles from "./CreditsTable.module.css";

/** "7-day hold" (C-08-Earnings:57) from the shared day formatter ("7", "49,710"). */
const holdWord = (seconds: number): string => `${formatHoldDayCount(seconds)}-day hold`;

/** The credits ledger (C-08-Earnings:50) on the Table primitive; the claim bar is its footer. */
export function CreditsTable({
  credits,
  now,
  selected,
  onToggle,
  footer,
}: {
  credits: Credit[];
  now: bigint;
  selected: Set<Hex>;
  onToggle(key: Hex): void;
  footer?: ReactNode;
}) {
  const selectedRows: number[] = [];
  const rows = credits.map((c, i) => {
    const status = creditStatus(c, now);
    const order = formatOrderId(c.orderId);
    const on = status.ready && selected.has(c.receiptKey);
    if (on) selectedRows.push(i);
    return [
      status.ready ? (
        <label key="s" className={styles.check}>
          <input
            type="checkbox"
            className={styles.box}
            aria-label={`Select order ${order.replace(/^#/, "")}`}
            checked={on}
            onChange={() => onToggle(c.receiptKey)}
          />
        </label>
      ) : null,
      <span key="o" className={styles.order}>
        {order}
      </span>,
      <span key="d">
        <Anchor href={`/dao/?id=${c.daoId}`} className={styles.dao}>
          {c.daoName}
        </Anchor>
        <br />
        <span className={styles.sub14}>{c.agentNames.join(", ")}</span>
      </span>,
      <span key="t">
        <Anchor href={`/treasury/?a=${c.treasury}`}>{c.treasuryName}</Anchor>
        <br />
        <span className={styles.sub13}>{holdWord(c.holdPeriod)}</span>
      </span>,
      <span key="c" className={styles.date}>
        {formatShortDate(c.creditedAt)}
      </span>,
      <span key="a" className={styles.amount}>
        {formatEth(c.amount)}
      </span>,
      <span key="r" className={styles.release}>
        <span className={cx(styles.status, status.ready && styles.statusReady)}>{status.text}</span>
        <progress
          className={cx(styles.progress, status.ready && styles.progressReady)}
          value={status.pct}
          max={100}
          aria-label={`Hold progress for order ${order}`}
        />
      </span>,
    ];
  });
  return (
    <Table
      columns="ledger7"
      minWidth="xl"
      frame="card"
      caption="Credits"
      label="Credits table"
      align={["start", "start", "start", "start", "start", "end", "start"]}
      selectedRows={selectedRows}
      header={[<span key="h" className={styles.hidden}>Select</span>, "Order", "DAO · agent", "Treasury", "Credited", "Amount", "Release"]}
      rows={rows}
      footer={footer}
    />
  );
}
