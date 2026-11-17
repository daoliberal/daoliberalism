import { mockNow } from "@/data/mock/clock";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEPLOYMENTS } from "@/data/deployments";
import type { DataSource } from "@/data/datasource";
import { PERSONAS } from "@/data/mock/fixtures";
import { ActionError, type ActionRequest, type Hex, type TxResult } from "@/data/types";
import { invalidationKeys, useActionFlow } from "@/providers/actionFlow";
import type { ApprovalView } from "@/providers/describeAction";
import { DataProvider } from "@/providers/DataProvider";
import { WalletContext, type WalletPort } from "@/providers/WalletPort";

const request: ActionRequest = { kind: "spend", treasury: PERSONAS.founder, to: PERSONAS.owner, amount: 1n };
const view: ApprovalView = {
  kind: "k", title: "t", happen: "h", contractLabel: "c", contractAddress: DEPLOYMENTS.paymentRouter,
  rules: "r", cta: "go", signer: PERSONAS.founder, doneText: "d",
};
const result: TxResult = { txHash: "0x01" as Hex };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(opts: { mode?: WalletPort["approvalMode"]; connected?: boolean } = {}) {
  const gates = [deferred<TxResult>(), deferred<TxResult>(), deferred<TxResult>()];
  const gate = gates[0]!;
  let calls = 0;
  const execute = vi.fn(() => gates[calls++]!.promise);
  const source = { execute } as unknown as DataSource;
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const connected = opts.connected ?? true;
  const walletRef: { current: WalletPort } = { current: undefined as unknown as WalletPort };
  walletRef.current = {
    address: connected ? PERSONAS.founder : undefined,
    status: connected ? "connected" : "disconnected",
    connect: () => {},
    disconnect: () => {},
    approvalMode: opts.mode ?? "manual-mock",
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataProvider now={mockNow} source={source} queryClient={queryClient}>
      <WalletContext.Provider value={walletRef.current}>{children}</WalletContext.Provider>
    </DataProvider>
  );
  const hook = renderHook(() => useActionFlow(), { wrapper });
  const disconnect = () => {
    walletRef.current = { ...walletRef.current, address: undefined, status: "disconnected" };
    hook.rerender();
  };
  return { ...hook, gate, gates, execute, invalidate, disconnect };
}

describe("useActionFlow", () => {
  it("refuses to start without a wallet", () => {
    const { result: r } = setup({ connected: false });
    act(() => r.current.start(request, view));
    expect(r.current.state.phase).toBe("idle");
  });

  it("manual-mock: sign only moves to waiting; execute runs on approveMock", async () => {
    const { result: r, execute, gate, invalidate } = setup();
    act(() => r.current.start(request, view));
    expect(r.current.state.phase).toBe("review");
    act(() => r.current.sign());
    expect(r.current.state.phase).toBe("waiting");
    expect(execute).not.toHaveBeenCalled();
    act(() => r.current.approveMock());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(request, PERSONAS.founder);
    await act(async () => gate.resolve(result));
    expect(r.current.state).toMatchObject({ phase: "done", result });
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(invalidationKeys("spend"));
  });

  it("manual-mock: a double simulate calls execute exactly once", async () => {
    const { result: r, execute, gate } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => {
      r.current.approveMock();
      r.current.approveMock();
    });
    act(() => r.current.approveMock());
    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve(result));
    act(() => r.current.approveMock());
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("a double sign in the same tick still moves to waiting once", () => {
    const { result: r, execute } = setup();
    act(() => r.current.start(request, view));
    act(() => {
      r.current.sign();
      r.current.sign();
    });
    expect(r.current.state.phase).toBe("waiting");
    expect(execute).not.toHaveBeenCalled();
  });

  it("approveMock does nothing before sign", () => {
    const { result: r, execute } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.approveMock());
    expect(execute).not.toHaveBeenCalled();
    expect(r.current.state.phase).toBe("review");
  });

  it("wallet mode: sign sends at once, a double sign sends once, approveMock is inert", async () => {
    const { result: r, execute, gate } = setup({ mode: "wallet" });
    act(() => r.current.start(request, view));
    act(() => {
      r.current.sign();
      r.current.sign();
    });
    act(() => r.current.approveMock());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.current.state.phase).toBe("waiting");
    await act(async () => gate.resolve(result));
    expect(r.current.state.phase).toBe("done");
  });

  it("a rejected execute lands in error with the ActionError", async () => {
    const { result: r, gate, invalidate } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    const err = new ActionError("Rejected", "Wallet rejected");
    await act(async () => gate.reject(err));
    expect(r.current.state).toMatchObject({ phase: "error", error: err });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => r.current.close());
    expect(r.current.state.phase).toBe("idle");
  });

  it("wraps an unexpected throw as ActionError Unknown", async () => {
    const { result: r, gate } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    await act(async () => gate.reject(new Error("boom")));
    expect(r.current.state.phase).toBe("error");
    expect(r.current.state.error).toBeInstanceOf(ActionError);
    expect(r.current.state.error?.code).toBe("Unknown");
  });

  it("after close, a late success leaves the state alone but still invalidates its lists", async () => {
    const { result: r, gate, invalidate } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    act(() => r.current.close());
    await act(async () => gate.resolve(result));
    expect(r.current.state.phase).toBe("idle");
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(invalidationKeys("spend"));
  });

  it("a stale resolve never lands on the next action, which still executes once", async () => {
    const { result: r, execute, gates, invalidate } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    act(() => r.current.close());
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    expect(execute).toHaveBeenCalledTimes(2);
    await act(async () => gates[0]!.resolve({ txHash: "0xaa" as Hex }));
    expect(r.current.state.phase).toBe("waiting");
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(invalidationKeys("spend"));
    await act(async () => gates[1]!.resolve({ txHash: "0xbb" as Hex }));
    expect(r.current.state).toMatchObject({ phase: "done", result: { txHash: "0xbb" } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("a stale rejection does not fail the next action", async () => {
    const { result: r, gates, invalidate } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    act(() => r.current.close());
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    await act(async () => gates[0]!.reject(new ActionError("Rejected", "old")));
    expect(r.current.state.phase).toBe("waiting");
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => gates[1]!.resolve(result));
    expect(r.current.state.phase).toBe("done");
  });

  it("wallet mode: a stale run neither completes nor blocks the next action", async () => {
    const { result: r, execute, gates } = setup({ mode: "wallet" });
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.close());
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    expect(execute).toHaveBeenCalledTimes(2);
    await act(async () => gates[0]!.reject(new ActionError("Rejected", "old")));
    expect(r.current.state.phase).toBe("waiting");
    await act(async () => gates[1]!.resolve(result));
    expect(r.current.state).toMatchObject({ phase: "done", result });
  });

  it("fails the flow when the wallet disappears between sign and approve", () => {
    const { result: r, execute, disconnect } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    disconnect();
    act(() => r.current.approveMock());
    expect(execute).not.toHaveBeenCalled();
    expect(r.current.state.phase).toBe("error");
    expect(r.current.state.error).toBeInstanceOf(ActionError);
    expect(r.current.state.error?.code).toBe("Rejected");
  });

  it("can run a second action after close", async () => {
    const { result: r, execute, gate } = setup();
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    await act(async () => gate.resolve(result));
    act(() => r.current.close());
    act(() => r.current.start(request, view));
    act(() => r.current.sign());
    act(() => r.current.approveMock());
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
