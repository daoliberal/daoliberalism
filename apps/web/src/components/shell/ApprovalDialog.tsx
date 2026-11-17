"use client";
import { useId, useRef } from "react";
import { explorerUrl } from "@/data/deployments";
import { shortAddress } from "@/lib/format";
import type { useActionFlow } from "@/providers/actionFlow";
import type { ApprovalView, MobileSheetView } from "@/providers/describeAction";
import { useDeployments } from "@/providers/hooks";
import { useWallet } from "@/providers/WalletPort";
import { Anchor } from "../primitives/Anchor";
import { Badge } from "../primitives/Badge";
import { Button } from "../primitives/Button";
import { Callout } from "../primitives/Callout";
import { CheckIcon, CloseIcon } from "../primitives/icons";
import { cx } from "../primitives/cx";
import { MoneyFlowBar } from "../primitives/MoneyFlowBar";
import styles from "./ApprovalDialog.module.css";
import { BottomSheet } from "./BottomSheet";
import { useIsNarrow } from "./useIsNarrow";
import { useModalFocus } from "./useModalFocus";

type Flow = ReturnType<typeof useActionFlow>;

const REJECTED_TEXT = "The request was declined, or the wallet disconnected before it was sent. Nothing was recorded.";

function Heading({ view, titleId }: { view: ApprovalView; titleId: string }) {
  return (
    <>
      <div className={styles.top}>
        <span className={styles.kind}>{view.kind}</span>
        <Badge tone="warn" dot compact>
          Testnet
        </Badge>
      </div>
      <h2 id={titleId} className={styles.title}>
        {view.title}
      </h2>
    </>
  );
}

const STEPS = ["What will happen", "Contract you sign", "Rules that apply"] as const;

function Review({ view, flow }: { view: ApprovalView; flow: Flow }) {
  const deployments = useDeployments();
  const detail = [
    view.happen,
    <Anchor key="c" href={explorerUrl(view.contractAddress, deployments)} className={styles.contract}>
      {view.contractLabel} · {shortAddress(view.contractAddress)} ↗
    </Anchor>,
    view.rules,
  ];
  return (
    <div className={styles.review}>
      <ol className={styles.steps}>
        {STEPS.map((label, i) => (
          <li key={label} className={styles.step}>
            <span className={styles.num}>{i + 1}</span>
            <div>
              <div className={styles.stepLabel}>{label}</div>
              {i === 1 ? detail[i] : <div className={styles.stepText}>{detail[i]}</div>}
            </div>
          </li>
        ))}
      </ol>
      {view.flow && <div className={styles.flow}>{view.flow}</div>}
      {view.permanence && (
        <Callout tone="caution" layout="inline">
          {view.permanence}
        </Callout>
      )}
      <div className={styles.footer}>
        <span>
          Signing as <span className={styles.signer}>{shortAddress(view.signer)}</span>
        </span>
        <span>Network fee shown in your wallet</span>
      </div>
      <div className={styles.actions}>
        <div className={styles.cancelSlot}>
          <Button variant="secondary" size="dialog" fill onClick={flow.close} data-autofocus="">
            Cancel
          </Button>
        </div>
        <div className={styles.ctaSlot}>
          <Button variant="brand" size="lg" fill onClick={flow.sign}>
            {view.cta}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Waiting({ flow }: { flow: Flow }) {
  const { approvalMode } = useWallet();
  return (
    <div role="status" className={styles.state}>
      <span aria-hidden="true" className={styles.spinner} />
      <div className={styles.stateTitle}>Waiting for your wallet</div>
      <p className={styles.stateText}>Check the request in your wallet. Nothing happens until you approve it there.</p>
      {approvalMode === "manual-mock" && (
        <button type="button" className={styles.simulate} onClick={flow.approveMock} data-autofocus="">
          Prototype: simulate wallet approval
        </button>
      )}
    </div>
  );
}

function Done({ view, flow }: { view: ApprovalView; flow: Flow }) {
  const deployments = useDeployments();
  const { result } = flow.state;
  const text = result && view.doneTextFor ? view.doneTextFor(result) : view.doneText;
  return (
    <div role="status" className={cx(styles.state, styles.stateDone)}>
      <span aria-hidden="true" className={styles.doneMark}>
        <CheckIcon size="24" />
      </span>
      <div className={styles.stateTitle}>Confirmed on-chain</div>
      <p className={styles.stateText}>{text}</p>
      {result && (
        <Anchor href={explorerUrl(result.txHash, deployments)} className={styles.tx}>
          Transaction {shortAddress(result.txHash)} ↗
        </Anchor>
      )}
      <Button variant="primary" onClick={flow.close} data-autofocus="">
        Done
      </Button>
    </div>
  );
}

function Failed({ flow }: { flow: Flow }) {
  const error = flow.state.error;
  return (
    <div className={styles.state}>
      <div role="alert" className={styles.alert}>
        <div className={styles.stateTitle}>The action didn&apos;t go through</div>
        <p className={styles.stateText}>{error?.code === "Rejected" || !error ? REJECTED_TEXT : error.message}</p>
      </div>
      <Button variant="primary" onClick={flow.close} data-autofocus="">
        Close
      </Button>
    </div>
  );
}

function PhoneJoin({ sheet, titleId, flow }: { sheet: MobileSheetView; titleId: string; flow: Flow }) {
  const deployments = useDeployments();
  return (
    <>
      <div className={styles.sheetTop}>
        <Badge tone="warn" dot compact>
          Testnet
        </Badge>
        <button type="button" className={styles.sheetClose} aria-label="Close" onClick={flow.close}>
          <CloseIcon size="16" />
        </button>
      </div>
      <div>
        <h2 id={titleId} className={styles.sheetTitle}>
          {sheet.title}
        </h2>
        <p className={styles.lede}>{sheet.lede}</p>
      </div>
      <div className={styles.outcome}>
        <div className={styles.outcomeLabel}>
          {sheet.amountLabel} <b className={styles.outcomeAmount}>{sheet.amountValue}</b>
        </div>
        <div className={styles.outcomeValue}>{sheet.owners}</div>
        <div className={styles.outcomeText}>{sheet.outcome}</div>
        <MoneyFlowBar feeBps={sheet.feeBps} expenseBps={sheet.expenseBps} size="sm" label={`${sheet.feeLine}, ${sheet.expenseLine}`} />
        <div className={styles.shares}>
          <span>{sheet.feeLine}</span>
          <span>{sheet.expenseLine}</span>
        </div>
      </div>
      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Treasury</span>
          <Anchor href={sheet.treasuryHref}>{sheet.treasuryName} rulebook ↗</Anchor>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>You sign</span>
          <Anchor href={explorerUrl(sheet.contractAddress, deployments)} className={styles.contractMono}>
            {shortAddress(sheet.contractAddress)} ↗
          </Anchor>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>From wallet</span>
          <span className={styles.mono}>{shortAddress(sheet.signer)}</span>
        </div>
      </div>
      <div className={styles.sheetActions}>
        <button type="button" className={styles.approve} onClick={flow.sign}>
          {sheet.approve}
        </button>
        <button type="button" className={styles.dismiss} onClick={flow.close} data-autofocus="">
          {sheet.dismiss}
        </button>
      </div>
    </>
  );
}

function OpenDialog({ flow, view }: { flow: Flow; view: ApprovalView }) {
  const { phase } = flow.state;
  const narrow = useIsNarrow();
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useModalFocus(ref, phase === "review", flow.close, `${phase}:${narrow}`);

  const phoneJoin = narrow && phase === "review" && view.mobile;
  const content = phoneJoin ? (
    <PhoneJoin sheet={view.mobile as MobileSheetView} titleId={titleId} flow={flow} />
  ) : (
    <>
      <Heading view={view} titleId={titleId} />
      {phase === "review" && <Review view={view} flow={flow} />}
      {phase === "waiting" && <Waiting flow={flow} />}
      {phase === "done" && <Done view={view} flow={flow} />}
      {phase === "error" && <Failed flow={flow} />}
    </>
  );

  if (narrow) {
    return (
      <BottomSheet labelledBy={titleId} ref={ref}>
        {content}
      </BottomSheet>
    );
  }
  return (
    <div className={styles.overlay}>
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={styles.dialog}>
        {content}
      </section>
    </div>
  );
}

/**
 * The signing window (C-09 on desktop, C-Mobile bottom sheet on a phone). Driven entirely by `useActionFlow`:
 * review -> waiting -> done (or error). Renders nothing while the flow is idle.
 */
export function ApprovalDialog({ flow }: { flow: Flow }) {
  const { phase, view } = flow.state;
  if (phase === "idle" || !view) return null;
  return <OpenDialog flow={flow} view={view} />;
}
