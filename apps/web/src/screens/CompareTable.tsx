import type { ReactNode } from "react";
import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import { explorerUrl, splitKindOf, type Deployments } from "@/data/deployments";
import type { ConfigurableTreasury } from "@/data/types";
import { formatBpsPercent, formatEthFlow, formatEthVolume, formatHoldDays, shortAddress } from "@/lib/format";
import { freeSeats, quoteOf } from "@/lib/treasuryView";
import { useDeployments } from "@/providers/hooks";
import { rulebookHref, splitLabelOf } from "./TreasuryCard";
import styles from "./CompareTable.module.css";

type Row = { key: string; row: string; label: (amountText: string) => ReactNode; cell: (t: ConfigurableTreasury, quote: ReturnType<typeof quoteOf>, d: Deployments) => ReactNode };

const ROWS: Row[] = [
  {
    key: "owners",
    row: styles.owners!,
    label: (amountText) => (
      <>
        Reaches owners
        <br />
        <span className={styles.labelSub}>of {amountText} ETH</span>
      </>
    ),
    cell: (t, q, d) => (
      <>
        <div className={styles.ownersEth}>{formatEthFlow(q.owners)}</div>
        <div className={styles.note}>
          {splitKindOf(t.config.splitRule, d) === "equal" ? "split equally" : "split by custom rule"}, after {formatHoldDays(t.config.holdPeriod)}
        </div>
      </>
    ),
  },
  {
    key: "fee",
    row: styles.short!,
    label: () => "Treasury fee",
    cell: (t, q) => (
      <span className={styles.mono18}>
        {formatBpsPercent(t.config.feeBps)}% <span className={styles.sub}>· {formatEthFlow(q.fee)}</span>
      </span>
    ),
  },
  {
    key: "expenses",
    row: styles.short!,
    label: () => "Expenses",
    cell: (t, q) => (
      <span className={styles.mono18}>
        {formatBpsPercent(t.config.expenseBps)}% <span className={styles.sub}>· {formatEthFlow(q.expenses)}</span>
      </span>
    ),
  },
  { key: "hold", row: styles.short!, label: () => "Hold period", cell: (t) => <span className={styles.mono18}>{formatHoldDays(t.config.holdPeriod)}</span> },
  {
    key: "split",
    row: styles.split!,
    label: () => "Split rule",
    cell: (t, _q, d) => (
      <>
        <div className={styles.bold}>{splitLabelOf(t, d)}</div>
        <Anchor href={explorerUrl(t.config.splitRule, d)} className={styles.address}>
          {shortAddress(t.config.splitRule)} ↗
        </Anchor>
      </>
    ),
  },
  {
    key: "seats",
    row: styles.seats!,
    label: () => "Seats (max agents)",
    cell: (t) => (
      <>
        <div className={styles.mono18}>
          {t.seatsUsed}/{t.config.maxAgents}
        </div>
        <div className={styles.note}>{freeSeats(t)} open · read on-chain</div>
      </>
    ),
  },
  {
    key: "daos",
    row: styles.short!,
    label: () => "DAOs · volume",
    cell: (t) => (
      <span className={styles.mono16}>
        {t.daoCount} · {formatEthVolume(t.volume)} ETH
      </span>
    ),
  },
  {
    key: "go",
    row: styles.go!,
    label: () => null,
    cell: (t) => (
      <Button variant="primary" size="sm" href={rulebookHref(t)}>
        Read the rulebook
      </Button>
    ),
  },
];

/**
 * Side-by-side view (C-02-Treasuries:121). The prototype draws one column per treasury with fixed row heights; here each row is a
 * grid with the same columns, so every cell also has a table role (rows, row headers, column headers) for screen readers.
 */
export function CompareTable({ treasuries, amountText, amount }: { treasuries: ConfigurableTreasury[]; amountText: string; amount: bigint }) {
  const deployments = useDeployments();
  const quotes = treasuries.map((t) => quoteOf(t, amount));
  return (
    <div role="table" aria-label="Treasuries side by side" className={styles.table}>
      <div role="row" className={`${styles.row} ${styles.head}`}>
        <div role="cell" className={styles.labelCell} />
        {treasuries.map((t) => (
          <div key={t.address} role="columnheader" className={styles.cell}>
            <div className={styles.name}>{t.metadata.name}</div>
            <Anchor href={explorerUrl(t.address, deployments)} className={styles.address}>
              {shortAddress(t.address)} ↗
            </Anchor>
          </div>
        ))}
      </div>
      {ROWS.map((r) => {
        const label = r.label(amountText);
        return (
        <div key={r.key} role="row" className={`${styles.row} ${r.row}`}>
          {label === null ? (
            <div role="cell" className={styles.labelCell} />
          ) : (
            <div role="rowheader" className={styles.labelCell}>
              {label}
            </div>
          )}
          {treasuries.map((t, i) => (
            <div key={t.address} role="cell" className={styles.cell}>
              {r.cell(t, quotes[i]!, deployments)}
            </div>
          ))}
        </div>
        );
      })}
    </div>
  );
}
