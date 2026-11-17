import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ActionError, type ActionRequest, type TxResult } from "@/data/types";
import { useDataSource } from "./DataProvider";
import type { ApprovalView } from "./describeAction";
import { useWallet } from "./WalletPort";

export type FlowPhase = "idle" | "review" | "waiting" | "done" | "error";
export interface FlowState {
  phase: FlowPhase;
  request?: ActionRequest;
  view?: ApprovalView;
  result?: TxResult;
  error?: ActionError;
}
export type FlowEvent =
  | { type: "open"; request: ActionRequest; view: ApprovalView }
  | { type: "sign" }
  | { type: "approved"; result: TxResult }
  | { type: "failed"; error: ActionError }
  | { type: "close" };

export const IDLE: FlowState = { phase: "idle" };

/** Pure state machine. Events that don't apply to the current phase return the same state object. */
export function flowReducer(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case "open":
      return s.phase === "idle" ? { phase: "review", request: e.request, view: e.view } : s;
    case "sign":
      return s.phase === "review" ? { ...s, phase: "waiting" } : s;
    case "approved":
      return s.phase === "waiting" ? { ...s, phase: "done", result: e.result } : s;
    case "failed":
      return s.phase === "waiting" ? { ...s, phase: "error", error: e.error } : s;
    case "close":
      return s.phase === "idle" ? s : { phase: "idle" };
  }
}

const KEYS: Record<ActionRequest["kind"], QueryKey[]> = {
  registerAgent: [["myAgents"]],
  updateAgent: [["myAgents"], ["daoMembers"]],
  joinDao: [["daos"], ["dao"], ["daoMembers"], ["memberships"], ["treasuries"], ["treasury"]],
  createDao: [["daos"], ["dao"], ["daoMembers"], ["memberships"], ["treasuries"], ["treasury"]],
  deployTreasury: [["treasuries"]],
  claim: [["myCredits"], ["myClaims"], ["treasuryAccounting"]],
  spend: [["treasuryAccounting"], ["spends"], ["treasury"]],
};

/** Query keys (prefixes) an executed action makes stale; fixed per request kind. */
export function invalidationKeys(kind: ActionRequest["kind"]): QueryKey[] {
  return KEYS[kind];
}

function asActionError(e: unknown): ActionError {
  if (e instanceof ActionError) return e;
  return new ActionError("Unknown", e instanceof Error ? e.message : "The action failed.");
}

export function useActionFlow(): {
  state: FlowState;
  start(request: ActionRequest, view: ApprovalView): void;
  sign(): void;
  approveMock(): void;
  close(): void;
} {
  const source = useDataSource();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const [state, setState] = useState<FlowState>(IDLE);
  // The reducer is the single source of truth; the ref lets event handlers see the latest phase synchronously,
  // so two clicks in one tick cannot both pass a guard.
  const live = useRef<FlowState>(IDLE);
  // Token of the execute that belongs to the current flow; null when none is running. A run whose token is no longer
  // current (the flow was closed or replaced) is stale: its outcome is dropped.
  const activeRun = useRef<number | null>(null);
  const runCounter = useRef(0);

  const send = useCallback((e: FlowEvent) => {
    const next = flowReducer(live.current, e);
    if (next !== live.current) {
      live.current = next;
      setState(next);
    }
  }, []);

  const run = useCallback(() => {
    const { request } = live.current;
    if (activeRun.current !== null || request === undefined) return;
    const signer = wallet.address;
    if (signer === undefined) {
      send({ type: "failed", error: new ActionError("Rejected", "The wallet was disconnected before the action was sent.") });
      return;
    }
    const token = ++runCounter.current;
    activeRun.current = token;
    const current = () => {
      if (activeRun.current !== token) return false;
      activeRun.current = null;
      return true;
    };
    source.execute(request, signer).then(
      (result) => {
        // The action really happened, so its lists are stale whatever the dialog is doing now.
        for (const queryKey of invalidationKeys(request.kind)) void queryClient.invalidateQueries({ queryKey });
        if (current()) send({ type: "approved", result });
      },
      (e: unknown) => {
        if (current()) send({ type: "failed", error: asActionError(e) });
      },
    );
  }, [source, wallet.address, queryClient, send]);

  const start = useCallback(
    (request: ActionRequest, view: ApprovalView) => {
      if (wallet.status !== "connected") return;
      send({ type: "open", request, view });
    },
    [wallet.status, send],
  );

  const sign = useCallback(() => {
    if (live.current.phase !== "review") return;
    send({ type: "sign" });
    // A real wallet prompts as soon as we ask; the mock waits for the user to simulate the approval.
    if (wallet.approvalMode === "wallet") run();
  }, [wallet.approvalMode, send, run]);

  const approveMock = useCallback(() => {
    if (wallet.approvalMode !== "manual-mock" || live.current.phase !== "waiting") return;
    run();
  }, [wallet.approvalMode, run]);

  const close = useCallback(() => {
    activeRun.current = null;
    send({ type: "close" });
  }, [send]);

  return { state, start, sign, approveMock, close };
}
