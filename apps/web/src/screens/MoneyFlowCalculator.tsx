"use client";
import { useState } from "react";
import { splitKindOf } from "@/data/deployments";
import type { ConfigurableTreasury } from "@/data/types";
import { formatBpsPercent, formatEthFlow, formatHoldDays } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { distributableOf, eachOwnerMin, splitPayment } from "@/lib/money";
import { parseEthInput, parsePositiveInt } from "@/lib/validation";
import { useDeployments, useNow } from "@/providers/hooks";
import { Card } from "@/components/primitives/Card";
import { Field } from "@/components/primitives/Field";
import { MoneyFlowBar } from "@/components/primitives/MoneyFlowBar";
import styles from "./MoneyFlowCalculator.module.css";

const MINUS = "−";

/** Amount: anything that is not a plain non-negative number counts as 0 (silent, like the prototype). Members: below 1 or not a number counts as 1. */
function useFlow(treasury: ConfigurableTreasury, amountText: string, membersText: string) {
  const now = useNow();
  const { feeBps, expenseBps, holdPeriod } = treasury.config;
  const parsed = parseEthInput(amountText);
  const amount = parsed.ok ? parsed.value : 0n;
  const split = splitPayment(amount, feeBps, expenseBps, 1);
  const fee = split.ok ? split.treasuryFee : 0n;
  const expense = split.ok ? split.expenseFee : 0n;
  const rest = distributableOf(amount, feeBps, expenseBps);
  const count = parsePositiveInt(membersText, Number.MAX_SAFE_INTEGER);
  const each = eachOwnerMin(rest, count.ok ? count.value : 1);
  return {
    total: formatEthFlow(amount),
    fee: formatEthFlow(fee),
    expense: formatEthFlow(expense),
    rest: formatEthFlow(rest),
    each: formatEthFlow(each),
    date: formatDate(now + BigInt(holdPeriod)),
    hold: formatHoldDays(holdPeriod),
    holdAdjective: `${formatHoldDays(holdPeriod).replace(/ days?$/, "")}-day`,
    feePct: formatBpsPercent(feeBps),
    expensePct: formatBpsPercent(expenseBps),
    membersPct: formatBpsPercent(Math.max(0, 10_000 - feeBps - expenseBps)),
  };
}

export function MoneyFlowCalculator({ treasury, variant }: { treasury: ConfigurableTreasury; variant: "desktop" | "mobile" }) {
  const [amount, setAmount] = useState("1.00");
  const [members, setMembers] = useState("6");
  const deployments = useDeployments();
  const equal = splitKindOf(treasury.config.splitRule, deployments) === "equal";
  const f = useFlow(treasury, amount, members);
  const { feeBps, expenseBps } = treasury.config;

  if (variant === "mobile") {
    return (
      <Card as="section" padding="xs" gap="10" aria-label="Customer pays">
        <Field kind="input" id="m2-amt" label="Customer pays" phone mono suffixMono fontSize="18" suffix="ETH" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <MoneyFlowBar feeBps={feeBps} expenseBps={expenseBps} size="sm" label={`Fee ${f.feePct} percent, expenses ${f.expensePct} percent, members ${f.membersPct} percent`} />
        <div className={styles.mLines}>
          <div className={styles.mLine}>
            <span className={styles.mMuted}>Fee {f.feePct}%</span>
            <span>
              {MINUS}
              {f.fee}
            </span>
          </div>
          <div className={styles.mLine}>
            <span className={styles.mMuted}>Expenses {f.expensePct}%</span>
            <span>
              {MINUS}
              {f.expense}
            </span>
          </div>
          <div className={styles.mTotal}>
            <span className={styles.mTotalLabel}>To owners</span>
            <span className={styles.mAccent}>{f.rest}</span>
          </div>
        </div>
        <div className={styles.mNote}>
          {equal ? "Split equally, claimable" : "Claimable"} after {f.hold} ({f.date}).
        </div>
      </Card>
    );
  }

  return (
    <Card as="aside" tone="panel" radius="lg" padding="md" gap="16" aria-labelledby="calc">
      <h2 id="calc" className={styles.title}>
        Money-flow calculator
      </h2>
      <div className={styles.inputs}>
        <div className={styles.field}>
          <label htmlFor="c3-amt" className={styles.fieldLabel}>
            Customer pays (ETH)
          </label>
          <input id="c3-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={styles.input} />
        </div>
        {equal && (
          <div className={styles.field}>
            <label htmlFor="c3-mem" className={styles.fieldLabel}>
              Members in the DAO
            </label>
            <input id="c3-mem" inputMode="numeric" value={members} onChange={(e) => setMembers(e.target.value)} className={styles.input} />
          </div>
        )}
      </div>
      <MoneyFlowBar size="lg" tone="panel" sliver="none" feeBps={feeBps} expenseBps={expenseBps} label={`Fee ${f.feePct} percent, expenses ${f.expensePct} percent, members ${f.membersPct} percent`} />
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.term}>Customer pays</dt>
          <dd className={styles.detail}>{f.total}</dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Treasury fee · {f.feePct}%</dt>
          <dd className={styles.detail}>
            {MINUS}
            {f.fee}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.term}>Expenses · {f.expensePct}%</dt>
          <dd className={styles.detail}>
            {MINUS}
            {f.expense}
          </dd>
        </div>
        <div className={styles.row}>
          <dt className={styles.strong}>To members&apos; owners</dt>
          <dd className={styles.accent}>{f.rest}</dd>
        </div>
        {equal && (
          <div className={styles.row}>
            <dt className={styles.term}>Each owner (equal split)</dt>
            <dd className={styles.each}>{f.each}</dd>
          </div>
        )}
      </dl>
      <p className={styles.note}>
        Paid today → claimable on <b>{f.date}</b>, after the {f.holdAdjective} hold. Amounts in ETH.
      </p>
    </Card>
  );
}
