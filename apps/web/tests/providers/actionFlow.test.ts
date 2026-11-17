import { describe, expect, it } from "vitest";
import { DEPLOYMENTS } from "@/data/deployments";
import { PERSONAS } from "@/data/mock/fixtures";
import { ActionError, type ActionRequest, type Hex, type TxResult } from "@/data/types";
import { flowReducer, IDLE, invalidationKeys, type FlowState } from "@/providers/actionFlow";
import type { ApprovalView } from "@/providers/describeAction";

const request: ActionRequest = { kind: "claim", receiptKeys: [] };
const view: ApprovalView = {
  kind: "k", title: "t", happen: "h", contractLabel: "c", contractAddress: DEPLOYMENTS.paymentRouter,
  rules: "r", cta: "go", signer: PERSONAS.owner, doneText: "d",
};
const result: TxResult = { txHash: "0x01" as Hex };
const error = new ActionError("Rejected", "no");

const open = (): FlowState => flowReducer(IDLE, { type: "open", request, view });

describe("flowReducer", () => {
  it("walks idle → review → waiting → done → idle", () => {
    const review = open();
    expect(review).toMatchObject({ phase: "review", request, view });
    const waiting = flowReducer(review, { type: "sign" });
    expect(waiting).toMatchObject({ phase: "waiting", request, view });
    const done = flowReducer(waiting, { type: "approved", result });
    expect(done).toMatchObject({ phase: "done", request, view, result });
    expect(flowReducer(done, { type: "close" })).toEqual({ phase: "idle" });
  });
  it("two sign events stay in waiting; the second changes nothing", () => {
    const waiting = flowReducer(open(), { type: "sign" });
    expect(flowReducer(waiting, { type: "sign" })).toBe(waiting);
  });
  it("ignores sign outside review", () => {
    expect(flowReducer(IDLE, { type: "sign" })).toBe(IDLE);
    const done = flowReducer(flowReducer(open(), { type: "sign" }), { type: "approved", result });
    expect(flowReducer(done, { type: "sign" })).toBe(done);
  });
  it("waiting → failed → error, then close → idle", () => {
    const failed = flowReducer(flowReducer(open(), { type: "sign" }), { type: "failed", error });
    expect(failed).toMatchObject({ phase: "error", error, request, view });
    expect(flowReducer(failed, { type: "close" })).toEqual({ phase: "idle" });
  });
  it("approved/failed only land while waiting", () => {
    const review = open();
    expect(flowReducer(review, { type: "approved", result })).toBe(review);
    expect(flowReducer(review, { type: "failed", error })).toBe(review);
    expect(flowReducer(IDLE, { type: "approved", result })).toBe(IDLE);
  });
  it("open is only accepted from idle", () => {
    const review = open();
    expect(flowReducer(review, { type: "open", request, view })).toBe(review);
  });
  it("close from review returns to idle", () => {
    expect(flowReducer(open(), { type: "close" })).toEqual({ phase: "idle" });
  });
});

describe("invalidationKeys", () => {
  const head = (k: ActionRequest["kind"]) => invalidationKeys(k).map((q) => q[0]);
  it("is fixed per request kind", () => {
    expect(head("registerAgent")).toEqual(["myAgents"]);
    expect(head("claim")).toEqual(expect.arrayContaining(["myCredits", "myClaims", "treasuryAccounting"]));
    expect(head("spend")).toEqual(expect.arrayContaining(["treasuryAccounting", "spends"]));
    expect(head("joinDao")).toEqual(
      expect.arrayContaining(["daos", "dao", "daoMembers", "memberships", "treasuries", "treasury"]),
    );
    expect(head("createDao")).toEqual(expect.arrayContaining(["daos", "treasuries", "treasury", "memberships"]));
    expect(head("deployTreasury")).toEqual(expect.arrayContaining(["treasuries"]));
    expect(head("updateAgent")).toEqual(expect.arrayContaining(["myAgents", "daoMembers"]));
  });
  it("covers every kind", () => {
    const kinds: ActionRequest["kind"][] = ["registerAgent", "updateAgent", "joinDao", "createDao", "deployTreasury", "claim", "spend"];
    for (const k of kinds) expect(invalidationKeys(k).length).toBeGreaterThan(0);
  });
});
