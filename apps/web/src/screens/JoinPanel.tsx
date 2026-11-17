"use client";
import { useId, useState } from "react";
import { Card } from "@/components/primitives/Card";
import type { Agent, ConfigurableTreasury, Dao, DaoMember } from "@/data/types";
import { splitKindOf } from "@/data/deployments";
import { formatEthFlow, formatHoldDays, shortAddress } from "@/lib/format";
import { distributableOf, eachOwnerMin, ONE_ETH } from "@/lib/money";
import { plural } from "@/lib/text";
import { useDeployments, useMemberships, useMyAgents } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";
import styles from "./JoinPanel.module.css";

function Shell({ titleId, children }: { titleId: string; children: React.ReactNode }) {
  return (
    <div className={styles.panel}>
      <Card as="aside" tone="panel" radius="lg" padding="md" gap="16" aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.title}>
          Join with my agent
        </h2>
        <p className={styles.lede}>Joining is free. You sign; the agent never touches money.</p>
        {children}
      </Card>
    </div>
  );
}

function AgentChoice({ agent, member, selected, onPick }: { agent: Agent; member: boolean; selected: boolean; onPick(): void }) {
  const memberships = useMemberships(agent.id);
  const count = memberships.data?.length;
  let note = "";
  if (member) note = "Already a member";
  else if (count !== undefined) note = count === 0 ? "not in a DAO yet" : `in ${plural(count, "DAO", "DAOs")}`;
  return (
    <button
      type="button"
      className={styles.agent}
      aria-pressed={selected}
      aria-disabled={member ? true : undefined}
      onClick={() => {
        if (!member) onPick();
      }}
    >
      <span className={styles.agentText}>
        <span className={styles.agentName}>{agent.profile.name}</span>
        <br />
        <span className={styles.agentKey}>{shortAddress(agent.agentKey)}</span>
      </span>
      <span className={styles.note}>{note}</span>
    </button>
  );
}

/** The panel for a DAO whose treasury has no readable rules: nothing to promise, so nothing to sign (new copy). */
export function JoinUnavailable() {
  const titleId = useId();
  return (
    <Shell titleId={titleId}>
      <button type="button" className={styles.sign} disabled>
        Review and sign
      </button>
      <p className={styles.reason}>Joining isn&apos;t available under this treasury.</p>
    </Shell>
  );
}

/**
 * C-05b-DAO "Join with my agent". Free to join; the owner signs. A member agent cannot be picked, and a full treasury
 * disables the button (both are T9 states the prototype does not draw).
 */
export function JoinPanel(props: { dao: Dao; treasury: ConfigurableTreasury; members: DaoMember[]; onJoin(agentId: bigint): void }) {
  const { dao, treasury, members, onJoin } = props;
  const titleId = useId();
  const wallet = useWallet();
  const deployments = useDeployments();
  const agents = useMyAgents();
  const [picked, setPicked] = useState<bigint | undefined>(undefined);

  if (wallet.status !== "connected") {
    return (
      <Shell titleId={titleId}>
        <p className={styles.status}>Connect your wallet to continue.</p>
        <button type="button" className={styles.sign} onClick={wallet.connect}>
          Connect wallet
        </button>
      </Shell>
    );
  }

  const memberIds = new Set(members.map((m) => m.agentId));
  const mine = agents.data ?? [];
  const free = mine.filter((a) => !memberIds.has(a.id));
  const chosen = picked !== undefined && free.some((a) => a.id === picked) ? picked : free[0]?.id;

  const { feeBps, expenseBps, holdPeriod, maxAgents } = treasury.config;
  const full = treasury.seatsUsed >= maxAgents;
  const after = dao.memberCount + 1;
  const open = Math.max(0, maxAgents - treasury.seatsUsed);
  const distributable = distributableOf(ONE_ETH, feeBps, expenseBps);
  const equal = splitKindOf(treasury.config.splitRule, deployments) === "equal";

  let reason: string | undefined;
  if (full) reason = "No seats left under this treasury";
  else if (agents.isSuccess && mine.length === 0) reason = "No agents in this wallet yet.";

  let list;
  if (agents.isError) list = <p className={styles.status}>Couldn&apos;t load your agents.</p>;
  else if (agents.isPending) list = <p role="status" className={styles.status}>Loading…</p>;
  else
    list = mine.map((a) => (
      <AgentChoice key={a.id.toString()} agent={a} member={memberIds.has(a.id)} selected={a.id === chosen} onPick={() => setPicked(a.id)} />
    ));

  return (
    <Shell titleId={titleId}>
      <fieldset className={styles.agents}>
        <legend className={styles.legend}>Choose an agent</legend>
        {list}
      </fieldset>
      <div className={styles.after}>
        <div>
          After joining, {dao.metadata.name} has <b>{plural(after, "member", "members")}</b>.
        </div>
        {equal ? (
          <div>
            Per 1 ETH order, each owner gets <b className={styles.eth}>≈ {formatEthFlow(eachOwnerMin(distributable, after))} ETH</b>, claimable after{" "}
            {formatHoldDays(holdPeriod)}.
          </div>
        ) : (
          <div>Each owner&apos;s share follows the treasury&apos;s custom rule, claimable after {formatHoldDays(holdPeriod)}.</div>
        )}
        <div>
          Uses 1 {treasury.metadata.name} seat ({open} open).
        </div>
      </div>
      <button type="button" className={styles.sign} disabled={chosen === undefined || full} onClick={() => chosen !== undefined && onJoin(chosen)}>
        Review and sign
      </button>
      {reason && <p className={styles.reason}>{reason}</p>}
    </Shell>
  );
}
