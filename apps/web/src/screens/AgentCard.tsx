"use client";
import { useState } from "react";
import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import { cx } from "@/components/primitives/cx";
import { Card } from "@/components/primitives/Card";
import { Grid } from "@/components/primitives/Grid";
import { Stack } from "@/components/primitives/Stack";
import { splitKindOf, type Deployments } from "@/data/deployments";
import { safeHref } from "@/data/metadata";
import { isConfigurable, type Agent, type AgentMembership } from "@/data/types";
import { formatBpsPercent, formatHoldDayCount, shortAddress } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { useDeployments } from "@/providers/hooks";
import { displayUri } from "./agentInput";
import styles from "./AgentCard.module.css";
import shared from "./shared.module.css";
import { EditAgentForm, type AgentPatch } from "./EditAgentForm";

/** "5% · 3% · 7 d · Equal" (C-07-Agents:77); an external treasury has no readable rules. */
function rulesOf(m: AgentMembership, d: Deployments): string | undefined {
  const t = m.treasury;
  if (!isConfigurable(t)) return undefined;
  return [
    `${formatBpsPercent(t.config.feeBps)}%`,
    `${formatBpsPercent(t.config.expenseBps)}%`,
    `${formatHoldDayCount(t.config.holdPeriod)} d`,
    splitKindOf(t.config.splitRule, d) === "equal" ? "Equal" : "Custom",
  ].join(" · ");
}

/**
 * A stored address or endpoint, drawn as untrusted text: http(s) through safeHref is a link, ipfs:// is link-styled text
 * (no gateway in Phase 1), a data: URI is the app's own storage, anything else is plain text.
 */
function Reference({ uri }: { uri: string }) {
  const href = safeHref(uri);
  const text = displayUri(uri);
  if (href) {
    return (
      <Anchor href={href} className={styles.mono}>
        {text} ↗
      </Anchor>
    );
  }
  if (/^ipfs:\/\//i.test(uri)) {
    return <span className={cx(styles.ipfs, shared.linkText)}>{text} ↗</span>;
  }
  if (/^data:/i.test(uri)) return <span>On-chain profile</span>;
  return <span className={styles.plain}>{text}</span>;
}

export function AgentCard({
  agent,
  memberships,
  onUpdate,
  editing,
  onToggleEdit,
}: {
  agent: Agent;
  memberships: AgentMembership[];
  onUpdate(patch: AgentPatch): void;
  /** Controlled by the screen so a finished update can close the form; uncontrolled when omitted. */
  editing?: boolean;
  onToggleEdit?(): void;
}) {
  const deployments = useDeployments();
  const [localEditing, setLocalEditing] = useState(false);
  const isEditing = editing ?? localEditing;
  const toggle = onToggleEdit ?? (() => setLocalEditing((v) => !v));
  const name = agent.profile.name;
  const services = agent.profile.services ?? [];

  return (
    <Card as="article" gap="16" padding="md" radius="md">
      <Stack gap="12" direction="row" wrap justify="between" align="start">
        <div className={styles.ident}>
          <span aria-hidden="true" className={styles.avatar}>
            {Array.from(name)[0] ?? "?"}
          </span>
          <div className={styles.who}>
            <h2 className={styles.name}>{name}</h2>
            <div className={styles.key}>key {shortAddress(agent.agentKey)}</div>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={toggle} aria-expanded={isEditing}>
          {isEditing ? "Close" : "Edit key or metadata"}
        </Button>
      </Stack>

      {isEditing && <EditAgentForm agent={agent} onSave={onUpdate} />}

      <div className={styles.daos}>
        <div className={styles.daosLabel}>{memberships.length === 1 ? "Works in 1 DAO" : `Works in ${memberships.length} DAOs`}</div>
        {memberships.length > 0 ? (
          <Grid minItem="300" gap="10">
            {memberships.map(({ dao, treasury }) => {
              const rules = rulesOf({ dao, treasury }, deployments);
              return (
                <Anchor key={dao.id.toString()} href={`/dao/?id=${dao.id}`} className={styles.daoLink}>
                  <span className={styles.daoName}>{dao.metadata.name}</span>
                  <span className={styles.daoMeta}>
                    under {treasury.metadata.name}
                    {rules && (
                      <>
                        {" · "}
                        <span className={styles.mono}>{rules}</span>
                      </>
                    )}
                  </span>
                </Anchor>
              );
            })}
          </Grid>
        ) : (
          <div className={styles.none}>
            Not working in any DAO yet. <Anchor href="/daos/" className={styles.find}>Find a DAO to join</Anchor>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <Reference uri={agent.metadataURI} />
        {services.map((s, i) => (
          <span key={`${s.name}-${i}`}>
            {s.name}: <Reference uri={s.endpoint} />
          </span>
        ))}
        <span>Registered {formatDate(agent.registeredAt)}</span>
        <span>Transfer ownership · coming in a later phase</span>
      </div>
    </Card>
  );
}
