"use client";
import { useMemo, useState } from "react";
import { Anchor } from "@/components/primitives/Anchor";
import { Breadcrumb } from "@/components/primitives/Breadcrumb";
import { Button } from "@/components/primitives/Button";
import { Callout } from "@/components/primitives/Callout";
import { Card } from "@/components/primitives/Card";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { Stepper } from "@/components/primitives/Stepper";
import { ApprovalDialog } from "@/components/shell/ApprovalDialog";
import { ConnectPrompt } from "@/components/shell/ConnectPrompt";
import { ErrorState, Loading } from "@/components/shell/StateViews";
import { encodeDaoMetadata, LIMITS, safeHref } from "@/data/metadata";
import { isConfigurable, type ActionRequest, type Address, type Agent, type ConfigurableTreasury } from "@/data/types";
import { formatEthFlow, shortAddress } from "@/lib/format";
import { distributableOf, ONE_ETH } from "@/lib/money";
import { lengthError } from "@/lib/text";
import { freeSeats } from "@/lib/treasuryView";
import { metadataUrlError } from "@/lib/validation";
import { useActionFlow } from "@/providers/actionFlow";
import { describeAction } from "@/providers/describeAction";
import { useDeployments, useMyAgents, useTreasuries } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";
import styles from "./CreateDao.module.css";
import { ruleSummary } from "./daoText";
import { useWizard } from "./useWizard";
import wizard from "./wizard.module.css";

// The prototype opens on this treasury (C-06-CreateDAO:97); it is an example value, like the DAO name.
const PROTOTYPE_PICK = "Lean Guild";

// Prototype values (C-06-CreateDAO:61, 62): real values. Website / Metadata URL start empty with a placeholder.
const INITIAL = {
  name: "Coral Desk",
  description: "Customer-support drafting for small online shops.",
  website: "",
  metadata: "",
};
type Form = typeof INITIAL;

function inspect(f: Form) {
  const website = f.website.trim();
  const metadata = f.metadata.trim();
  const errors = {
    name: f.name.trim() === "" ? "Enter a name." : lengthError(f.name, LIMITS.name),
    description: lengthError(f.description, LIMITS.description),
    website:
      website === ""
        ? undefined
        : safeHref(website) === undefined
          ? "Use an http(s) address."
          : lengthError(website, LIMITS.website),
    metadata: metadataUrlError(metadata),
  };
  return { errors, ok: !errors.name && !errors.description && !errors.website && !errors.metadata };
}

function DaoWizard({ signer, agents, treasuries }: { signer: Address; agents: Agent[]; treasuries: ConfigurableTreasury[] }) {
  const deployments = useDeployments();
  const flow = useActionFlow();
  const [form, setForm] = useState<Form>(INITIAL);
  const [ack, setAck] = useState(false);
  const [founderId, setFounderId] = useState<string | undefined>(undefined);
  const [pickedAddress, setPickedAddress] = useState<Address | undefined>(undefined);

  // Newest registration first, so the most recently registered agent is the default founder.
  const founders = useMemo(() => [...agents].sort((a, b) => (a.registeredAt === b.registeredAt ? 0 : a.registeredAt > b.registeredAt ? -1 : 1)), [agents]);
  const founder = founders.find((a) => a.id.toString() === founderId) ?? founders[0];
  const chosen =
    treasuries.find((t) => t.address === pickedAddress && freeSeats(t) > 0) ??
    (pickedAddress === undefined ? treasuries.find((t) => t.metadata.name === PROTOTYPE_PICK && freeSeats(t) > 0) : undefined);

  const v = inspect(form);
  const valid = [v.ok && founder !== undefined, chosen !== undefined, true];
  const flowSteps = useWizard(3, (s) => valid[s - 1] ?? false);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const labels = ["Details", "Choose treasury", "Confirm and sign"];
  const steps = labels.map((label, i) => ({
    label,
    state: i + 1 === flowSteps.step ? ("current" as const) : i + 1 < flowSteps.step ? ("done" as const) : ("todo" as const),
    onSelect: () => flowSteps.go(i + 1),
  }));
  const canCreate = flowSteps.canSign && ack;

  function sign() {
    if (!canCreate || !founder || !chosen) return;
    const website = form.website.trim();
    const metadataURI =
      form.metadata.trim() !== ""
        ? form.metadata.trim()
        : encodeDaoMetadata({
            name: form.name.trim(),
            description: form.description.trim(),
            ...(website !== "" ? { website } : {}),
          });
    const request: ActionRequest = { kind: "createDao", metadataURI, founderAgentId: founder.id, treasury: chosen.address };
    flow.start(
      request,
      describeAction(request, {
        deployments,
        signer,
        treasury: chosen,
        founderAgentName: founder.profile.name,
        // The form's name, so the approval reads right even when a Metadata URL is used and cannot be read here (C5b).
        daoName: form.name.trim(),
      }),
    );
  }

  const daoName = form.name;

  return (
    <main className={`${wizard.page} ${wizard.narrow}`}>
      <Breadcrumb trail={[{ label: "DAOs", href: "/daos/" }, { label: "Create a DAO" }]} />
      <div>
        <h1 className={wizard.title}>Create a DAO</h1>
        <p className={`${wizard.lede} ${wizard.ledeDao}`}>
          A DAO is a company your agents work in. It joins one treasury for free, and that treasury&apos;s rules decide how
          members&apos; owners get paid.
        </p>
      </div>
      <Stepper steps={steps} />
      <Card as="section" padding="lg" radius="lg" gap="20">
        {flowSteps.step === 1 && (
          <div className={`${wizard.section} ${wizard.gap18}`}>
            <h2 className={wizard.h2}>About the DAO</h2>
            <Field kind="input" id="n-name" label="Name" fontSize="17" value={form.name} onChange={set("name")} error={v.errors.name} />
            <Field
              kind="textarea"
              id="n-desc"
              label="What it does"
              rows={3}
              value={form.description}
              onChange={set("description")}
              hint="Descriptions can't be edited after creation in Phase 1."
              error={v.errors.description}
            />
            <Grid minItem="280" gap="18">
              <Field
                kind="input"
                id="n-web"
                label="Website (where customers pay)"
                placeholder="https://"
                value={form.website}
                onChange={set("website")}
                error={v.errors.website}
              />
              <Field
                kind="input"
                id="n-meta"
                label="Metadata URL"
                mono
                placeholder="ipfs:// or https://"
                value={form.metadata}
                onChange={set("metadata")}
                error={v.errors.metadata}
              />
            </Grid>
            <Field
              kind="select"
              id="n-agent"
              label="Founder agent"
              value={founder?.id.toString() ?? ""}
              onChange={(e) => setFounderId(e.target.value)}
              hint="Your agent becomes the first member. Earnings still go to your wallet."
              error={founder === undefined ? "Register an agent first." : undefined}
            >
              {founders.map((a) => (
                <option key={a.id.toString()} value={a.id.toString()}>
                  {a.profile.name} · {shortAddress(a.agentKey)}
                </option>
              ))}
            </Field>
          </div>
        )}

        {flowSteps.step === 2 && (
          <div className={`${wizard.section} ${wizard.gap14}`}>
            <h2 className={wizard.h2}>Choose a treasury</h2>
            <p className={wizard.text}>Joining is free. Read the rules carefully: in Phase 1 this choice can&apos;t be undone.</p>
            {treasuries.map((t) => {
              const open = freeSeats(t);
              const on = chosen?.address === t.address;
              return (
                <button
                  key={t.address}
                  type="button"
                  className={styles.card}
                  aria-pressed={on}
                  aria-disabled={open === 0 ? true : undefined}
                  onClick={() => open > 0 && setPickedAddress(t.address)}
                >
                  <span className={styles.name}>
                    <span className={styles.nameText}>{t.metadata.name}</span>
                    <span className={styles.rules}>{ruleSummary(t, deployments)}</span>
                  </span>
                  <span className={`${styles.stat} ${styles.statMem}`}>
                    <span className={styles.statLabel}>Per 1 ETH to owners</span>
                    <span className={styles.statMemValue}>
                      {formatEthFlow(distributableOf(ONE_ETH, t.config.feeBps, t.config.expenseBps))}
                    </span>
                  </span>
                  <span className={`${styles.stat} ${styles.statSeats}`}>
                    <span className={styles.statLabel}>Seats open</span>
                    <span className={styles.statSeatsValue}>{open}</span>
                  </span>
                  {on && <span className={styles.chosen}>Selected</span>}
                  {open === 0 && <span className={styles.reason}>No seats left under this treasury</span>}
                </button>
              );
            })}
            <Anchor href="/treasuries/" className={styles.compare}>
              Compare treasuries in detail
            </Anchor>
          </div>
        )}

        {flowSteps.step === 3 && chosen && founder && (
          <div className={`${wizard.section} ${wizard.gap18}`}>
            <h2 className={wizard.h2}>
              Confirm {daoName} under {chosen.metadata.name}
            </h2>
            <dl className={wizard.facts}>
              <div className={wizard.fact}>
                <dt className={wizard.term}>Founder agent</dt>
                <dd className={`${wizard.def} ${wizard.defBold}`}>{founder.profile.name}</dd>
              </div>
              <div className={wizard.fact}>
                <dt className={wizard.term}>Treasury</dt>
                <dd className={`${wizard.def} ${wizard.defBold}`}>{chosen.metadata.name}</dd>
              </div>
              <div className={wizard.fact}>
                <dt className={wizard.term}>Rules</dt>
                <dd className={`${wizard.def} ${wizard.defMono14}`}>{ruleSummary(chosen, deployments)}</dd>
              </div>
            </dl>
            <Callout
              tone="caution"
              icon={false}
              title="This choice is final in Phase 1"
              action={
                <label>
                  <input type="checkbox" checked={ack} onChange={() => setAck((a) => !a)} /> I understand {daoName} stays under{" "}
                  {chosen.metadata.name}
                </label>
              }
            >
              {daoName} cannot leave {chosen.metadata.name} or switch to another treasury. Switching by majority vote of members
              comes in a later phase.
            </Callout>
          </div>
        )}

        <div className={wizard.footer}>
          {flowSteps.step === 1 ? (
            <Button variant="secondary" href="/daos/">
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" onClick={flowSteps.back}>
              Back
            </Button>
          )}
          {flowSteps.step < 3 && (
            <Button variant="primary" size="wide" onClick={flowSteps.next}>
              Continue
            </Button>
          )}
          {flowSteps.step === 3 && (
            <Button variant="brand" size="wide" disabled={!canCreate} onClick={sign}>
              Create DAO and sign
            </Button>
          )}
        </div>
      </Card>
      <ApprovalDialog flow={flow} />
    </main>
  );
}

function Loaded({ signer }: { signer: Address }) {
  const agents = useMyAgents();
  const treasuries = useTreasuries();
  if (agents.isError || treasuries.isError) {
    return (
      <main className={`${wizard.page} ${wizard.narrow}`}>
        <ErrorState
          retry={() => {
            void agents.refetch();
            void treasuries.refetch();
          }}
        />
      </main>
    );
  }
  if (!agents.data || !treasuries.data) {
    return (
      <main className={`${wizard.page} ${wizard.narrow}`}>
        <Loading />
      </main>
    );
  }
  return <DaoWizard signer={signer} agents={agents.data} treasuries={treasuries.data.filter(isConfigurable)} />;
}

/** C-06-CreateDAO: create a DAO in three views, one signature. */
export function CreateDao() {
  const { address } = useWallet();
  if (address === undefined) return <ConnectPrompt title="Create a DAO" />;
  return <Loaded signer={address} />;
}
