import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { MoneyFlowBar } from "@/components/primitives/MoneyFlowBar";
import { SeatMeter } from "@/components/primitives/SeatMeter";
import { explorerUrl, splitKindOf, type Deployments } from "@/data/deployments";
import type { ConfigurableTreasury } from "@/data/types";
import { formatBpsPercent, formatEthFlow, formatEthVolume, formatHoldDays, shortAddress } from "@/lib/format";
import { ownersBps, quoteOf } from "@/lib/treasuryView";
import { useDeployments } from "@/providers/hooks";
import styles from "./TreasuryCard.module.css";

/** "Equal split" or "Custom rule", by the split-rule address (the one source of split kind: `splitKindOf`). */
export const splitLabelOf = (t: ConfigurableTreasury, d: Deployments): string =>
  splitKindOf(t.config.splitRule, d) === "equal" ? "Equal split" : "Custom rule";

export const rulebookHref = (t: ConfigurableTreasury): string => `/treasury/?a=${t.address}`;

/** "5% · 0.05": the rate, then what it takes from the amount being compared. */
function Rate({ bps, wei }: { bps: number; wei: bigint }) {
  return (
    <>
      {formatBpsPercent(bps)}% <span className={styles.sub}>· {formatEthFlow(wei)}</span>
    </>
  );
}

function barLabel(t: ConfigurableTreasury): string {
  const { feeBps, expenseBps } = t.config;
  return `Fee ${formatBpsPercent(feeBps)} percent, expenses ${formatBpsPercent(expenseBps)} percent, members ${formatBpsPercent(ownersBps(t))} percent`;
}

/** Desktop card (C-02-Treasuries:67). */
export function TreasuryCard({ t, amount, picked, onToggle }: { t: ConfigurableTreasury; amount: bigint; picked: boolean; onToggle(): void }) {
  const deployments = useDeployments();
  const q = quoteOf(t, amount);
  const { feeBps, expenseBps, holdPeriod, maxAgents } = t.config;
  return (
    <Card as="article" tone={picked ? "selected" : "default"} padding="md" gap="18">
      <div className={styles.head}>
        <div>
          <h2 className={styles.name}>{t.metadata.name}</h2>
          <div className={styles.meta}>
            {t.daoCount} DAOs · {formatEthVolume(t.volume)} ETH total volume
          </div>
        </div>
        <label className={styles.pick}>
          <input type="checkbox" checked={picked} onChange={onToggle} className={styles.checkbox} /> Compare
        </label>
      </div>
      <div className={styles.headline}>
        <span className={styles.big}>{formatEthFlow(q.owners)} ETH</span>
        <span className={styles.bigNote}>reaches members&apos; owners, after {formatHoldDays(holdPeriod)}</span>
      </div>
      <MoneyFlowBar feeBps={feeBps} expenseBps={expenseBps} label={barLabel(t)} />
      <dl className={styles.facts}>
        <div>
          <dt className={styles.term}>Treasury fee</dt>
          <dd className={styles.value}>
            <Rate bps={feeBps} wei={q.fee} />
          </dd>
        </div>
        <div>
          <dt className={styles.term}>Expenses</dt>
          <dd className={styles.value}>
            <Rate bps={expenseBps} wei={q.expenses} />
          </dd>
        </div>
        <div>
          <dt className={styles.term}>Split rule</dt>
          <dd className={styles.valueBold}>{splitLabelOf(t, deployments)}</dd>
        </div>
        <div>
          <dt className={styles.term}>Seats used</dt>
          <dd className={styles.seats}>
            <span className={styles.seatCount}>
              {t.seatsUsed}/{maxAgents}
            </span>
            <SeatMeter used={t.seatsUsed} max={maxAgents} label={`Seats used: ${t.seatsUsed} of ${maxAgents}`} />
          </dd>
        </div>
      </dl>
      <div className={styles.foot}>
        <Anchor href={explorerUrl(t.address, deployments)} className={styles.contract}>
          Contract {shortAddress(t.address)} ↗
        </Anchor>
        <div className={styles.cta}>
          <Button variant="primary" size="sm" href={rulebookHref(t)}>
            Read the rulebook
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Phone card (C-M1-Treasuries:41): name and DAO count, the amount, the bar, four facts, the rulebook button. */
export function TreasuryCardNarrow({ t, amount }: { t: ConfigurableTreasury; amount: bigint }) {
  const deployments = useDeployments();
  const q = quoteOf(t, amount);
  const { feeBps, expenseBps, holdPeriod, maxAgents } = t.config;
  return (
    <Card as="article" padding="compact" gap="12">
      <div className={styles.mHead}>
        <h2 className={styles.mName}>{t.metadata.name}</h2>
        <span className={styles.mMeta}>{t.daoCount} DAOs</span>
      </div>
      <div>
        <span className={styles.mBig}>{formatEthFlow(q.owners)} ETH</span>
        <div className={styles.mBigNote}>to members&apos; owners, after {formatHoldDays(holdPeriod)}</div>
      </div>
      <MoneyFlowBar feeBps={feeBps} expenseBps={expenseBps} label={barLabel(t)} size="sm" />
      <dl className={styles.mFacts}>
        <div>
          <dt className={styles.mTerm}>Fee</dt>
          <dd className={styles.mMono}>
            {formatBpsPercent(feeBps)}% · {formatEthFlow(q.fee)}
          </dd>
        </div>
        <div>
          <dt className={styles.mTerm}>Expenses</dt>
          <dd className={styles.mMono}>
            {formatBpsPercent(expenseBps)}% · {formatEthFlow(q.expenses)}
          </dd>
        </div>
        <div>
          <dt className={styles.mTerm}>Split</dt>
          <dd className={styles.mBold}>{splitLabelOf(t, deployments)}</dd>
        </div>
        <div>
          <dt className={styles.mTerm}>Seats</dt>
          <dd className={styles.mMono}>
            {t.seatsUsed}/{maxAgents}
          </dd>
        </div>
      </dl>
      <Button variant="primary" href={rulebookHref(t)}>
        Read the rulebook
      </Button>
    </Card>
  );
}
