"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import { Card } from "@/components/primitives/Card";
import { cx } from "@/components/primitives/cx";
import { Grid } from "@/components/primitives/Grid";
import { Table } from "@/components/primitives/Table";
import { ApprovalDialog } from "@/components/shell/ApprovalDialog";
import { ConnectPrompt } from "@/components/shell/ConnectPrompt";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import { explorerUrl, type Deployments } from "@/data/deployments";
import type { ClaimRecord, Hex } from "@/data/types";
import { formatEth, shortAddress, shortHash } from "@/lib/format";
import { isClaimable, selectedTotal, summarizeCredits } from "@/lib/creditView";
import { plural } from "@/lib/text";
import { formatDate } from "@/lib/time";
import { useActionFlow } from "@/providers/actionFlow";
import { describeAction } from "@/providers/describeAction";
import { useDeployments, useMyClaims, useMyCredits, useNow } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";
import { CreditsTable } from "./CreditsTable";
import styles from "./Earnings.module.css";
import shared from "./shared.module.css";

type Tab = "credits" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "credits", label: "Credits" },
  { id: "history", label: "Claim history" },
];


function ClaimHistory({ claims, deployments }: { claims: ClaimRecord[]; deployments: Deployments }) {
  if (claims.length === 0) return <Empty message="No claims yet." />;
  return (
    <Table
      columns="even4"
      minWidth="md"
      frame="card"
      caption="Claim history"
      align={["start", "start", "end", "end"]}
      header={["Date", "Credits", "Amount", "Transaction"]}
      rows={claims.map((c) => [
        formatDate(c.at),
        plural(c.creditCount, "credit", "credits"),
        <span key="a" className={styles.mono}>{formatEth(c.amount)} ETH</span>,
        <Anchor key="t" href={explorerUrl(c.txHash, deployments)} className={cx(styles.mono, shared.linkText)}>
          {shortHash(c.txHash)} ↗
        </Anchor>,
      ])}
    />
  );
}

/** My earnings (C-08-Earnings). */
export function Earnings() {
  const wallet = useWallet();
  const deployments = useDeployments();
  const now = useNow();
  const credits = useMyCredits();
  const claims = useMyClaims();
  const flow = useActionFlow();
  const [tab, setTab] = useState<Tab>("credits");
  // null = the default: every claimable credit is ticked.
  const [picked, setPicked] = useState<Set<Hex> | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ credits: null, history: null });

  const signer = wallet.address;
  if (wallet.status !== "connected" || signer === undefined) return <ConnectPrompt title="My earnings" />;

  const all = credits.data ?? [];
  const claimable = all.filter((c) => isClaimable(c, now));
  const selected: Set<Hex> = picked ?? new Set(claimable.map((c) => c.receiptKey));
  const chosen = claimable.filter((c) => selected.has(c.receiptKey));
  const total = selectedTotal(all, selected, now);
  const summary = summarizeCredits(all, claims.data ?? [], now);

  const toggle = (key: Hex) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
  };
  const claim = () => {
    if (chosen.length === 0) return;
    const request = { kind: "claim" as const, receiptKeys: chosen.map((c) => c.receiptKey) };
    flow.start(request, describeAction(request, { deployments, signer, credits: all }));
  };
  const dialogFlow = {
    ...flow,
    close: () => {
      if (flow.state.phase === "done" && flow.state.request?.kind === "claim") setPicked(null);
      flow.close();
    },
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length]!;
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  const loading = credits.isPending || claims.isPending;
  const failed = credits.isError || claims.isError;

  return (
    <main className={styles.main}>
      <div>
        <h1 className={styles.title}>My earnings</h1>
        <p className={styles.lede}>
          Each order your agents work on creates a credit in ETH. A credit becomes claimable when its treasury&apos;s hold period ends.
        </p>
      </div>

      {loading && <Loading />}
      {failed && <ErrorState retry={() => void Promise.all([credits.refetch(), claims.refetch()])} />}
      {!loading && !failed && (
        <>
          <Grid minItem="260" gap="16">
            <Card tone="panel" padding="sm" radius="md">
              <div className={styles.panelLabel}>Available now</div>
              <div className={cx(styles.value, styles.valuePanel)}>{formatEth(summary.available)} ETH</div>
              <div className={styles.panelSub}>{plural(summary.availableCount, "credit", "credits")}</div>
            </Card>
            <Card padding="sm" radius="md">
              <div className={styles.label}>On hold</div>
              <div className={styles.value}>{formatEth(summary.onHold)} ETH</div>
              {summary.nextReleaseIn && <div className={styles.sub}>next release in {summary.nextReleaseIn}</div>}
            </Card>
            <Card padding="sm" radius="md">
              <div className={styles.label}>Claimed so far</div>
              <div className={styles.value}>{formatEth(summary.claimed)} ETH</div>
              <div className={styles.sub}>{plural(summary.claimCount, "claim", "claims")}</div>
            </Card>
          </Grid>

          <div role="tablist" aria-label="Earnings views" className={styles.tabs}>
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={cx(styles.tab, tab === t.id && styles.tabOn)}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "credits" ? (
            <div role="tabpanel" id="panel-credits" aria-labelledby="tab-credits">
              {all.length === 0 ? (
                <Empty message="No credits yet." />
              ) : (
                <CreditsTable
                  credits={all}
                  now={now}
                  selected={selected}
                  onToggle={toggle}
                  footer={
                    <div className={styles.bar}>
                      <span className={styles.barText}>
                        {chosen.length} of {claimable.length} available credits selected · sent to{" "}
                        <span className={styles.mono}>{shortAddress(signer)}</span>
                      </span>
                      <Button variant="brand" size="lg" disabled={total === 0n} onClick={claim}>
                        Claim {formatEth(total)} ETH
                      </Button>
                    </div>
                  }
                />
              )}
            </div>
          ) : (
            <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
              <ClaimHistory claims={claims.data ?? []} deployments={deployments} />
            </div>
          )}
        </>
      )}
      <ApprovalDialog flow={dialogFlow} />
    </main>
  );
}
