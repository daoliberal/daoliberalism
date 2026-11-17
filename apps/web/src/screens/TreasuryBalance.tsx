"use client";
import { useState, type ReactNode } from "react";
import { explorerUrl } from "@/data/deployments";
import type { ActionRequest, Address, ConfigurableTreasury } from "@/data/types";
import { formatEth, shortAddress, shortHash } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { isAddressInput, parseEthInput } from "@/lib/validation";
import { useDeployments, useSpends, useTreasuryAccounting } from "@/providers/hooks";
import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { Stack } from "@/components/primitives/Stack";
import { Table } from "@/components/primitives/Table";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import styles from "./TreasuryBalance.module.css";

export type SpendRequest = Extract<ActionRequest, { kind: "spend" }>;

const ZERO = /^0x0*$/i;
const ADDRESS_ERROR = "Enter a valid 0x address.";
const AMOUNT_ERROR = "Enter an amount up to the available balance.";
const ZERO_AMOUNT_ERROR = "Amount must be more than 0.";

/** Nothing is said before the field has text; the "Review and sign" button stays disabled until both are valid. */
function recipientError(text: string): string | undefined {
  if (text.trim() === "") return undefined;
  const t = text.trim();
  return isAddressInput(t) && !ZERO.test(t) ? undefined : ADDRESS_ERROR;
}

function amountError(text: string, balance: bigint): string | undefined {
  if (text.trim() === "") return undefined;
  const parsed = parseEthInput(text);
  if (!parsed.ok) return AMOUNT_ERROR;
  if (parsed.value === 0n) return ZERO_AMOUNT_ERROR;
  return parsed.value > balance ? AMOUNT_ERROR : undefined;
}

/** The framed card on the desktop page; `bare` (the phone history sheet, which already has a frame) drops the card. */
function Frame({ bare, children }: { bare?: boolean; children: ReactNode }) {
  if (bare) {
    return (
      <section id="bal" aria-labelledby="bal-title" className={styles.bare}>
        {children}
      </section>
    );
  }
  return (
    <Card as="section" padding="lg" radius="lg" gap="20" id="bal" aria-labelledby="bal-title">
      {children}
    </Card>
  );
}

export function TreasuryBalance(props: { treasury: ConfigurableTreasury; isFounder: boolean; onSpend(request: SpendRequest): void; bare?: boolean }) {
  const { treasury, isFounder, onSpend, bare } = props;
  const accounting = useTreasuryAccounting(treasury.address);
  const spends = useSpends(treasury.address);
  const deployments = useDeployments();
  // The form is open for the history length it was opened at: a recorded spend closes it without an effect.
  const [opened, setOpened] = useState<{ at: number } | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");

  const count = spends.data?.length;
  const open = isFounder && opened !== null && opened.at === count;
  const balance = accounting.data?.balance ?? 0n;
  const toError = recipientError(to);
  const amountMessage = amountError(amount, balance);
  const parsed = parseEthInput(amount);
  const ready = open && to.trim() !== "" && toError === undefined && amount.trim() !== "" && amountMessage === undefined && parsed.ok;

  const openForm = () => {
    if (count === undefined) return;
    setTo("");
    setAmount("");
    setOpened({ at: count });
  };
  const review = () => {
    if (!ready || !parsed.ok) return;
    onSpend({ kind: "spend", treasury: treasury.address, to: to.trim() as Address, amount: parsed.value });
  };

  return (
    <Frame bare={bare}>
      <div className={styles.head}>
        <div>
          <h2 id="bal-title" className={styles.heading}>
            Treasury balance
          </h2>
          <p className={styles.lede}>Fees and expenses collect here. In Phase 1 only the founder can spend it, and every spend is public on-chain.</p>
        </div>
        {isFounder && (
          <Button variant="primary" onClick={openForm}>
            Spend from treasury
          </Button>
        )}
      </div>

      {accounting.isPending ? (
        <Loading />
      ) : accounting.isError ? (
        <ErrorState retry={() => void accounting.refetch()} />
      ) : (
        <Grid minItem="200" gap="12">
          <div className={styles.statNow}>
            <div className={styles.statNowLabel}>Balance now</div>
            <div className={styles.statNowValue}>{formatEth(accounting.data.balance)} ETH</div>
          </div>
          <Stat label="Collected · fees" value={formatEth(accounting.data.collectedFees)} />
          <Stat label="Collected · expenses" value={formatEth(accounting.data.collectedExpenses)} />
          <Stat label="Spent so far" value={formatEth(accounting.data.spent)} />
        </Grid>
      )}

      {open && (
        <Card as="section" tone="emphasis" padding="sm" gap="14" aria-labelledby="sp-title">
          <div className={styles.formHead}>
            <h3 id="sp-title" className={styles.formTitle}>
              New spend
            </h3>
            <span className={styles.formNote}>Founder only · public on-chain</span>
          </div>
          <Grid minItem="260" gap="12">
            <Field kind="input" id="sp-to" label="Recipient address" labelSize="14" tight inset="12" mono fontSize="15" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} error={toError} />
            <Field
              kind="input"
              id="sp-amt"
              label="Amount (ETH)"
              labelSize="14"
              tight
              inset="12"
              mono
              fontSize="15"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              hint={`Up to ${formatEth(balance)} available`}
              error={amountMessage}
            />
          </Grid>
          <Stack direction="row" wrap gap="10" justify="end">
            <Button variant="secondary" onClick={() => setOpened(null)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={!ready} onClick={review}>
              Review and sign
            </Button>
          </Stack>
        </Card>
      )}

      <div>
        <h3 className={styles.historyTitle}>Spending history</h3>
        {spends.isPending ? (
          <Loading />
        ) : spends.isError ? (
          <ErrorState retry={() => void spends.refetch()} />
        ) : (
          <>
            {bare ? (
              <ul className={styles.spendList} aria-label="Spending history">
                {spends.data.map((s) => (
                  <li key={s.txHash} className={styles.spendItem}>
                    <span className={styles.spendDate}>{formatDate(s.at)}</span>
                    <span className={styles.spendAmount}>{formatEth(s.amount)} ETH</span>
                    <span className={styles.spendTo}>{shortAddress(s.to)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Table
                columns="mid14"
                minWidth="sm"
                caption="Spending history"
                density="compact"
                align={["start", "start", "end", "end"]}
                mono={[false, true, true, true]}
                header={["Date", "To", "Amount", "Transaction"]}
                rows={spends.data.map((s) => [
                  <span key="d" className={styles.date}>
                    {formatDate(s.at)}
                  </span>,
                  shortAddress(s.to),
                  `${formatEth(s.amount)} ETH`,
                  <Anchor key="tx" href={explorerUrl(s.txHash, deployments)}>
                    {shortHash(s.txHash)} ↗
                  </Anchor>,
                ])}
              />
            )}
            {spends.data.length === 0 && <Empty message="No spends yet." />}
          </>
        )}
      </div>
    </Frame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}
