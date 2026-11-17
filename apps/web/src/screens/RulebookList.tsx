"use client";
import { explorerUrl, splitKindOf } from "@/data/deployments";
import type { Address, ConfigurableTreasury } from "@/data/types";
import { formatBpsPercent, formatHoldDays, shortAddress } from "@/lib/format";
import { useDeployments } from "@/providers/hooks";
import { Anchor } from "@/components/primitives/Anchor";
import { Card } from "@/components/primitives/Card";
import { SeatMeter } from "@/components/primitives/SeatMeter";
import styles from "./RulebookList.module.css";

type Rule = { title: string; value: string; plain: string; codeAddress: Address; codeText: string; meter?: boolean };

/** The five rules of a treasury, from its `config` only. Desktop = C-03-Treasury texts, mobile = C-M2-Treasury texts. */
function rulesOf(t: ConfigurableTreasury, equal: boolean, variant: "desktop" | "mobile"): Rule[] {
  const { feeBps, expenseBps, holdPeriod, maxAgents, splitRule } = t.config;
  const fee = `${formatBpsPercent(feeBps)}%`;
  const expenses = `${formatBpsPercent(expenseBps)}%`;
  const hold = formatHoldDays(holdPeriod);
  const open = Math.max(0, maxAgents - t.seatsUsed);
  const mobile = variant === "mobile";
  const home = shortAddress(t.address);
  const splitCode = equal ? `EqualSplit · ${shortAddress(splitRule)}` : `SplitRule · ${splitRule}`;
  return [
    {
      title: "Treasury fee",
      value: fee,
      plain: mobile ? `${fee} of every payment goes to the treasury balance.` : `For every customer payment to a DAO under this treasury, ${fee} goes to the treasury balance.`,
      codeAddress: t.address,
      codeText: `FeeRule · ${home}`,
    },
    {
      title: "Expenses",
      value: expenses,
      plain: mobile ? `${expenses} is set aside for running costs.` : `Another ${expenses} is set aside for running costs. It also joins the treasury balance.`,
      codeAddress: t.address,
      codeText: `ExpenseRule · ${home}`,
    },
    {
      title: "Hold period",
      value: hold,
      plain: mobile ? `Shares unlock ${hold} after the payment.` : `Each owner’s share is locked for ${hold} after the payment arrives, then it can be claimed.`,
      codeAddress: t.address,
      codeText: `HoldRule · ${home}`,
    },
    {
      title: "Split rule",
      value: equal ? (mobile ? "Equal" : "Equal split") : "Custom rule",
      plain: equal
        ? mobile
          ? "The rest is divided equally among members’ owners."
          : "What remains is divided equally among the owners of the DAO’s member agents. This is the platform’s shared Equal-split contract."
        : "What remains is divided by the rule contract at the address below.",
      codeAddress: splitRule,
      codeText: splitCode,
    },
    {
      title: "Max agents",
      value: mobile ? `${t.seatsUsed}/${maxAgents}` : `${t.seatsUsed} / ${maxAgents}`,
      plain: mobile
        ? `${open} seats open, read live from the contract.`
        : `Up to ${maxAgents} agents can work across all DAOs under this treasury. ${open} seats are open, read live from the contract.`,
      codeAddress: t.address,
      codeText: `SeatLimit · ${home}`,
      meter: !mobile,
    },
  ];
}

export function RulebookList({ treasury, variant }: { treasury: ConfigurableTreasury; variant: "desktop" | "mobile" }) {
  const deployments = useDeployments();
  const equal = splitKindOf(treasury.config.splitRule, deployments) === "equal";
  const rules = rulesOf(treasury, equal, variant);
  const link = (r: Rule, className: string) => (
    <Anchor href={explorerUrl(r.codeAddress, deployments)} className={className}>
      {r.codeText} ↗
    </Anchor>
  );

  if (variant === "mobile") {
    return (
      <section aria-labelledby="m2r" className={styles.mSection}>
        <h2 id="m2r" className={styles.mHeading}>
          Rulebook
        </h2>
        <ol className={styles.mList}>
          {rules.map((r, i) => (
            <li key={r.title} className={styles.mItem}>
              <span className={styles.mNum}>{i + 1}</span>
              <div className={styles.mBody}>
                <div className={styles.mLine}>
                  <span className={styles.mTitle}>{r.title}</span>
                  <span className={styles.mValue}>{r.value}</span>
                </div>
                <p className={styles.mPlain}>{r.plain}</p>
                {link(r, styles.mCode ?? "")}
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <Card as="section" padding="lg" radius="lg" aria-labelledby="rb">
      <h2 id="rb" className={styles.heading}>
        Rulebook
      </h2>
      <p className={styles.lede}>Five rules, each enforced by a contract you can read.</p>
      <ol className={styles.list}>
        {rules.map((r, i) => (
          <li key={r.title} className={styles.item}>
            <span className={styles.num}>{i + 1}</span>
            <div className={styles.body}>
              <div className={styles.line}>
                <h3 className={styles.title}>{r.title}</h3>
                <span className={styles.value}>{r.value}</span>
              </div>
              <p className={styles.plain}>{r.plain}</p>
              {r.meter && (
                <div className={styles.meter}>
                  <SeatMeter used={treasury.seatsUsed} max={treasury.config.maxAgents} label="Seats used" size="md" />
                </div>
              )}
              {link(r, styles.code ?? "")}
            </div>
          </li>
        ))}
      </ol>
      <p className={styles.note}>
        These rules were set when the treasury was deployed and cannot be changed in Phase 1. Voting on rule changes comes in a later phase.
      </p>
    </Card>
  );
}
