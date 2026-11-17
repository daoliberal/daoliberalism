"use client";
import { useState } from "react";
import { ApprovalDialog } from "@/components/shell/ApprovalDialog";
import { ConnectPrompt } from "@/components/shell/ConnectPrompt";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import { Button } from "@/components/primitives/Button";
import { Stack } from "@/components/primitives/Stack";
import type { ActionRequest, Address, Agent } from "@/data/types";
import { useActionFlow } from "@/providers/actionFlow";
import { describeAction } from "@/providers/describeAction";
import { useDeployments, useMemberships, useMyAgents } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";
import styles from "./Agents.module.css";
import { AgentCard } from "./AgentCard";
import type { AgentPatch } from "./EditAgentForm";
import { RegisterAgentForm, type RegisterValues } from "./RegisterAgentForm";

function AgentRow({ agent, editing, onToggle, onUpdate }: { agent: Agent; editing: boolean; onToggle(): void; onUpdate(p: AgentPatch): void }) {
  const memberships = useMemberships(agent.id);
  return <AgentCard agent={agent} memberships={memberships.data ?? []} onUpdate={onUpdate} editing={editing} onToggleEdit={onToggle} />;
}

/** My agents (C-07-Agents). */
export function Agents() {
  const wallet = useWallet();
  const deployments = useDeployments();
  const agents = useMyAgents();
  const flow = useActionFlow();
  const [regOpen, setRegOpen] = useState(false);
  const [editing, setEditing] = useState<bigint | null>(null);

  const signer = wallet.address;
  if (wallet.status !== "connected" || signer === undefined) return <ConnectPrompt title="My agents" />;

  const begin = (request: ActionRequest, agentName?: string) =>
    flow.start(request, describeAction(request, { deployments, signer, agentName }));

  const register = (v: RegisterValues) =>
    begin({ kind: "registerAgent", agentKey: v.agentKey, metadataURI: v.metadataURI }, v.name);
  const update = (agent: Agent, patch: AgentPatch) =>
    begin({ kind: "updateAgent", agentId: agent.id, ...patch }, agent.profile.name);

  // A finished action closes the form it came from; a failed or cancelled one leaves the form as the user filled it.
  const dialogFlow = {
    ...flow,
    close: () => {
      const { phase, request } = flow.state;
      if (phase === "done" && request?.kind === "registerAgent") setRegOpen(false);
      if (phase === "done" && request?.kind === "updateAgent") setEditing(null);
      flow.close();
    },
  };

  return (
    <main className={styles.main}>
      <Stack gap="16" direction="row" wrap justify="between" align="end">
        <div>
          <h1 className={styles.title}>My agents</h1>
          <p className={styles.lede}>
            Agents do the work and never hold money. Everything they earn goes to this wallet. One agent can work in several DAOs at once.
          </p>
        </div>
        <Button variant="primary" onClick={() => setRegOpen((v) => !v)}>
          {regOpen ? "Close form" : "Register agent"}
        </Button>
      </Stack>

      {regOpen && <RegisterAgentForm owner={signer as Address} onSubmit={register} />}

      <div className={styles.list}>
        {agents.isPending && <Loading />}
        {agents.isError && <ErrorState retry={() => void agents.refetch()} />}
        {agents.data?.length === 0 && <Empty message="You haven't registered an agent yet." />}
        {agents.data?.map((a) => (
          <AgentRow
            key={a.id.toString()}
            agent={a}
            editing={editing === a.id}
            onToggle={() => setEditing((cur) => (cur === a.id ? null : a.id))}
            onUpdate={(p) => update(a, p)}
          />
        ))}
      </div>
      <ApprovalDialog flow={dialogFlow} />
    </main>
  );
}
