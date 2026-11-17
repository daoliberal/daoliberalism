"use client";
import { useState } from "react";
import { ApprovalDialog } from "@/components/shell/ApprovalDialog";
import { ConnectPrompt } from "@/components/shell/ConnectPrompt";
import { Breadcrumb } from "@/components/primitives/Breadcrumb";
import { Button } from "@/components/primitives/Button";
import { Callout } from "@/components/primitives/Callout";
import { Card } from "@/components/primitives/Card";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { Stepper } from "@/components/primitives/Stepper";
import { encodeTreasuryMetadata, LIMITS } from "@/data/metadata";
import type { ActionRequest, Address } from "@/data/types";
import { shortAddress } from "@/lib/format";
import { lengthError } from "@/lib/text";
import { isAddressInput, parseDaysToSeconds, parsePercentToBps, parsePositiveInt } from "@/lib/validation";
import { useActionFlow } from "@/providers/actionFlow";
import { useDeployments } from "@/providers/hooks";
import { describeAction } from "@/providers/describeAction";
import { useWallet } from "@/providers/WalletPort";
import { LivePreview } from "./LivePreview";
import { useWizard } from "./useWizard";
import styles from "./wizard.module.css";

const MAX_AGENTS_LIMIT = 4_294_967_295; // uint32
const ZERO_ADDRESS = /^0x0*$/i;
const BPS_TOTAL = 10_000;

// Prototype values (C-04-CreateTreasury:140-144, 62): real values, not placeholders.
const INITIAL = {
  name: "Tidewater",
  description: "Low overhead, two-week hold, equal shares for every member.",
  fee: "2",
  expenses: "1",
  hold: "14",
  max: "300",
  split: "equal" as "equal" | "custom",
  address: "",
};
type Form = typeof INITIAL;

/** Basis points of whatever was typed (prototype `n()`: unreadable or negative counts as 0); display only, never signed. */
function looseBps(s: string): number {
  const x = Number.parseFloat(s);
  return Number.isFinite(x) && x >= 0 ? Math.round(x * 100) : 0;
}

/** Parsed numbers and the error text of each field of the treasury form. */
function inspect(f: Form) {
  const fee = parsePercentToBps(f.fee);
  const expenses = parsePercentToBps(f.expenses);
  const hold = parseDaysToSeconds(f.hold);
  const max = parsePositiveInt(f.max, MAX_AGENTS_LIMIT);
  const errors = {
    name: f.name.trim() === "" ? "Enter a name." : lengthError(f.name, LIMITS.name),
    description: lengthError(f.description, LIMITS.description),
    fee: fee.ok ? undefined : "Enter a percentage with up to 2 decimals.",
    expenses: expenses.ok ? undefined : "Enter a percentage with up to 2 decimals.",
    hold: hold.ok ? undefined : "Enter a whole number of days.",
    max: max.ok ? undefined : "Enter 1 or more.",
    address:
      f.split === "custom" && !(isAddressInput(f.address.trim()) && !ZERO_ADDRESS.test(f.address.trim()))
        ? "Enter a valid 0x address."
        : undefined,
  };
  const over = fee.ok && expenses.ok && fee.value + expenses.value > BPS_TOTAL;
  const step1 = !errors.name && !errors.description && !errors.fee && !errors.expenses && !errors.hold && !errors.max && !over;
  const step2 = !errors.address;
  return { fee, expenses, hold, max, errors, over, valid: [step1, step2, true] };
}

function TreasuryWizard({ signer }: { signer: Address }) {
  const deployments = useDeployments();
  const flow = useActionFlow();
  const [form, setForm] = useState<Form>(INITIAL);
  const [ack, setAck] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const v = inspect(form);
  const wizard = useWizard(3, (s) => v.valid[s - 1] ?? false);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The preview echoes what is typed even when it is not valid yet (as the prototype's parseFloat does); the owners' share
  // then shows a dash and the form itself stays blocked.
  const feeBps = v.fee.ok ? v.fee.value : looseBps(form.fee);
  const expenseBps = v.expenses.ok ? v.expenses.value : looseBps(form.expenses);
  const custom = form.split === "custom";
  const canDeploy = wizard.canSign && ack;

  const labels = ["Economics", "Split rule", "Confirm and sign"];
  const steps = labels.map((label, i) => ({
    label,
    state: i + 1 === wizard.step ? ("current" as const) : i + 1 < wizard.step ? ("done" as const) : ("todo" as const),
    onSelect: () => wizard.go(i + 1),
  }));

  const [seenStep, setSeenStep] = useState(wizard.step);
  if (seenStep !== wizard.step) {
    setSeenStep(wizard.step);
    setAttempted(false);
  }

  function onContinue() {
    // An empty custom address stays quiet until the user tries to move on.
    setAttempted(!(v.valid[wizard.step - 1] ?? false));
    wizard.next();
  }

  function sign() {
    if (!canDeploy || !v.hold.ok || !v.max.ok) return;
    const request: ActionRequest = {
      kind: "deployTreasury",
      config: {
        feeBps,
        expenseBps,
        holdPeriod: v.hold.value,
        maxAgents: v.max.value,
        splitRule: custom ? (form.address.trim() as Address) : deployments.equalSplit,
      },
      metadataURI: encodeTreasuryMetadata({ name: form.name.trim(), description: form.description.trim() }),
    };
    flow.start(request, describeAction(request, { deployments, signer }));
  }

  return (
    <main className={styles.page}>
      <Breadcrumb trail={[{ label: "Treasuries", href: "/treasuries/" }, { label: "Deploy a treasury" }]} />
      <div>
        <h1 className={styles.title}>Deploy a treasury</h1>
        <p className={`${styles.lede} ${styles.ledeTreasury}`}>
          You are writing an economic model. Once deployed, its rules are permanent for Phase 1, so take your time.
        </p>
      </div>
      <Stepper steps={steps} />
      <div className={styles.body}>
        <div className={styles.formCol}>
          <Card as="section" padding="lg" radius="lg" gap="22">
            {wizard.step === 1 && (
              <div className={`${styles.section} ${styles.gap22}`}>
                <h2 className={styles.h2}>Name and economics</h2>
                <Field
                  kind="input"
                  id="w-name"
                  label="Treasury name"
                  fontSize="17"
                  value={form.name}
                  onChange={set("name")}
                  error={v.errors.name}
                />
                <Field
                  kind="textarea"
                  id="w-desc"
                  label="Description"
                  rows={2}
                  value={form.description}
                  onChange={set("description")}
                  hint="Descriptions can't be edited after deployment in Phase 1."
                  error={v.errors.description}
                />
                <Grid minItem="220" gap="18">
                  <Field
                    kind="input"
                    id="w-fee"
                    label="Treasury fee"
                    inputMode="decimal"
                    mono
                    fontSize="18"
                    suffix="%"
                    value={form.fee}
                    onChange={set("fee")}
                    hint="Share of every payment kept by the treasury."
                    error={v.errors.fee}
                  />
                  <Field
                    kind="input"
                    id="w-exp"
                    label="Expenses"
                    inputMode="decimal"
                    mono
                    fontSize="18"
                    suffix="%"
                    value={form.expenses}
                    onChange={set("expenses")}
                    hint="Set aside for running costs; also held by the treasury."
                    error={v.errors.expenses}
                  />
                  <Field
                    kind="input"
                    id="w-hold"
                    label="Hold period"
                    inputMode="numeric"
                    mono
                    fontSize="18"
                    suffix="days"
                    value={form.hold}
                    onChange={set("hold")}
                    hint="How long owners wait before they can withdraw."
                    error={v.errors.hold}
                  />
                  <Field
                    kind="input"
                    id="w-max"
                    label="Max agents"
                    inputMode="numeric"
                    mono
                    fontSize="18"
                    suffix="seats"
                    value={form.max}
                    onChange={set("max")}
                    hint="Total agents across all DAOs under this treasury."
                    error={v.errors.max}
                  />
                </Grid>
                {v.over && (
                  <p role="alert" className={styles.limit}>
                    Fee and expenses together can&apos;t exceed 100%.
                  </p>
                )}
              </div>
            )}

            {wizard.step === 2 && (
              <div className={`${styles.section} ${styles.gap16}`}>
                <h2 className={styles.h2}>Split rule</h2>
                <p className={styles.text}>
                  How the money left after fee and expenses is divided among the owners of a DAO&apos;s member agents.
                </p>
                <button
                  type="button"
                  className={styles.choice}
                  aria-pressed={!custom}
                  onClick={() => setForm((f) => ({ ...f, split: "equal" }))}
                >
                  <span className={styles.choiceTitle}>
                    Equal split <span className={styles.choiceAside}>· platform rule</span>
                  </span>
                  <span className={styles.choiceText}>
                    Every member&apos;s owner gets the same share. Audited contract shared by all equal-split treasuries.
                  </span>
                  <span className={styles.choiceCode}>{shortAddress(deployments.equalSplit)}</span>
                </button>
                <button
                  type="button"
                  className={styles.choice}
                  aria-pressed={custom}
                  onClick={() => setForm((f) => ({ ...f, split: "custom" }))}
                >
                  <span className={styles.choiceTitle}>Custom rule contract</span>
                  <span className={styles.choiceText}>
                    Point to your own deployed split contract. Agent owners will see its address and judge it themselves.
                  </span>
                </button>
                {custom && (
                  <Field
                    kind="input"
                    id="w-addr"
                    label="Rule contract address"
                    mono
                    fontSize="16"
                    placeholder="0x…"
                    value={form.address}
                    onChange={set("address")}
                    hint="We check the contract implements the split interface before you can continue."
                    error={form.address.trim() === "" && !attempted ? undefined : v.errors.address}
                  />
                )}
              </div>
            )}

            {wizard.step === 3 && (
              <div className={`${styles.section} ${styles.gap18}`}>
                <h2 className={styles.h2}>Review the rulebook for {form.name}</h2>
                <dl className={styles.facts}>
                  <div className={styles.fact}>
                    <dt className={styles.term}>Treasury fee</dt>
                    <dd className={`${styles.def} ${styles.defMono22}`}>{form.fee}%</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt className={styles.term}>Expenses</dt>
                    <dd className={`${styles.def} ${styles.defMono22}`}>{form.expenses}%</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt className={styles.term}>Hold period</dt>
                    <dd className={`${styles.def} ${styles.defMono22}`}>{form.hold} days</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt className={styles.term}>Max agents</dt>
                    <dd className={`${styles.def} ${styles.defMono22}`}>{form.max}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt className={styles.term}>Split rule</dt>
                    <dd className={`${styles.def} ${styles.defBold18}`}>{custom ? "Custom rule contract" : "Equal split (platform)"}</dd>
                  </div>
                </dl>
                <Callout
                  tone="caution"
                  title="These rules cannot be changed in Phase 1"
                  action={
                    <label>
                      <input type="checkbox" checked={ack} onChange={() => setAck((a) => !a)} /> I understand these rules are permanent in Phase 1
                    </label>
                  }
                >
                  After deployment nobody can edit the fee, expenses, hold period, split rule or seat limit, including you. Rule voting
                  arrives in a later phase. Treasury balance can be spent only by you, and every spend is public.
                </Callout>
              </div>
            )}

            <div className={styles.footer}>
              {wizard.step === 1 ? (
                <Button variant="secondary" href="/treasuries/">
                  Cancel
                </Button>
              ) : (
                <Button variant="secondary" onClick={wizard.back}>
                  Back
                </Button>
              )}
              {wizard.step < 3 && (
                <Button variant="primary" size="wide" onClick={onContinue}>
                  Continue
                </Button>
              )}
              {wizard.step === 3 && (
                <Button variant="brand" size="wide" disabled={!canDeploy} onClick={sign}>
                  Deploy and sign
                </Button>
              )}
            </div>
          </Card>
        </div>
        <div className={styles.previewCol}>
          <LivePreview
            feeBps={feeBps}
            expenseBps={expenseBps}
            name={form.name}
            feeLabel={form.fee}
            expenseLabel={form.expenses}
            holdLabel={form.hold}
            maxLabel={form.max}
            splitSentence={custom ? "Split by your custom rule contract" : "Split equally among members’ owners"}
          />
        </div>
      </div>
      <ApprovalDialog flow={flow} />
    </main>
  );
}

/** C-04-CreateTreasury: deploy a treasury in three steps, one signature. */
export function CreateTreasury() {
  const { address } = useWallet();
  if (address === undefined) return <ConnectPrompt title="Deploy a treasury" />;
  return <TreasuryWizard signer={address} />;
}
