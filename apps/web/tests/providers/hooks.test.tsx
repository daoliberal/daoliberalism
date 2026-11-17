import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { DEPLOYMENTS } from "@/data/deployments";
import { encodeTreasuryMetadata } from "@/data/metadata";
import type { ActionRequest } from "@/data/types";
import { useActionFlow } from "@/providers/actionFlow";
import { describeAction } from "@/providers/describeAction";
import { MOCK_NOW } from "@/data/mock/clock";
import { PERSONAS } from "@/data/mock/fixtures";
import { createMockDataSource } from "@/data/mock/MockDataSource";
import { DataProvider } from "@/providers/DataProvider";
import {
  useDao, useDaoMembers, useDaos, useMemberships, useMyAgents, useMyClaims, useMyCredits, useNow, useSpends,
  useTreasuries, useTreasury, useTreasuryAccounting,
} from "@/providers/hooks";
import { MockWalletProvider } from "@/providers/MockWallet";
import { useWallet } from "@/providers/WalletPort";

function wrapperFor(opts: { now?: () => bigint } = {}) {
  const source = createMockDataSource();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <DataProvider source={source} queryClient={queryClient} now={opts.now}>
      <MockWalletProvider>{children}</MockWalletProvider>
    </DataProvider>
  );
  return { Wrapper, source, queryClient };
}

describe("read hooks", () => {
  it("useTreasuries returns the four fixture treasuries", async () => {
    const { Wrapper } = wrapperFor();
    const { result } = renderHook(() => useTreasuries(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(4);
  });

  it("useTreasury / accounting / spends / daos are keyed by address and wait for an argument", async () => {
    const { Wrapper, source } = wrapperFor();
    const [first] = await source.listTreasuries();
    const idle = renderHook(() => useTreasury(undefined), { wrapper: Wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");
    const t = renderHook(() => useTreasury(first!.address), { wrapper: Wrapper });
    await waitFor(() => expect(t.result.current.data?.address).toBe(first!.address));
    const acc = renderHook(() => useTreasuryAccounting(first!.address), { wrapper: Wrapper });
    await waitFor(() => expect(acc.result.current.data).toBeDefined());
    const sp = renderHook(() => useSpends(first!.address), { wrapper: Wrapper });
    await waitFor(() => expect(sp.result.current.isSuccess).toBe(true));
    const all = renderHook(() => useDaos(), { wrapper: Wrapper });
    const under = renderHook(() => useDaos({ treasury: first!.address }), { wrapper: Wrapper });
    await waitFor(() => expect(all.result.current.isSuccess && under.result.current.isSuccess).toBe(true));
    expect(under.result.current.data!.length).toBeLessThan(all.result.current.data!.length);
    expect(under.result.current.data!.every((d) => d.treasury === first!.address)).toBe(true);
  });

  it("useDao / useDaoMembers", async () => {
    const { Wrapper, source } = wrapperFor();
    const [dao] = await source.listDaos();
    const none = renderHook(() => useDao(undefined), { wrapper: Wrapper });
    expect(none.result.current.fetchStatus).toBe("idle");
    const d = renderHook(() => useDao(dao!.id), { wrapper: Wrapper });
    await waitFor(() => expect(d.result.current.data?.id).toBe(dao!.id));
    const m = renderHook(() => useDaoMembers(dao!.id), { wrapper: Wrapper });
    await waitFor(() => expect(m.result.current.isSuccess).toBe(true));
  });

  it("owner-scoped hooks are disabled until a wallet connects, then use its address", async () => {
    const { Wrapper } = wrapperFor();
    const { result } = renderHook(
      () => ({ w: useWallet(), agents: useMyAgents(), credits: useMyCredits(), claims: useMyClaims() }),
      { wrapper: Wrapper },
    );
    expect(result.current.agents.fetchStatus).toBe("idle");
    expect(result.current.credits.fetchStatus).toBe("idle");
    act(() => result.current.w.connect());
    await waitFor(() => expect(result.current.agents.data?.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.credits.data?.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.claims.data?.length).toBeGreaterThan(0));
    expect(result.current.agents.data!.every((a) => a.owner === PERSONAS.owner)).toBe(true);
  });

  it("useMemberships waits for an agent id", async () => {
    const { Wrapper, source } = wrapperFor();
    const agents = await source.listAgentsOf(PERSONAS.owner);
    const idle = renderHook(() => useMemberships(undefined), { wrapper: Wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");
    const m = renderHook(() => useMemberships(agents[0]!.id), { wrapper: Wrapper });
    await waitFor(() => expect(m.result.current.isSuccess).toBe(true));
  });

  it("an executed action invalidates the lists it changes", async () => {
    const { Wrapper } = wrapperFor();
    const { result } = renderHook(() => ({ list: useTreasuries(), flow: useActionFlow(), w: useWallet() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.list.data).toHaveLength(4));
    act(() => result.current.w.connect());
    const request: ActionRequest = {
      kind: "deployTreasury",
      config: { feeBps: 200, expenseBps: 100, holdPeriod: 14 * 86400, maxAgents: 300, splitRule: DEPLOYMENTS.equalSplit },
      metadataURI: encodeTreasuryMetadata({ name: "Tidewater", description: "Harbour fees." }),
    };
    act(() => result.current.flow.start(request, describeAction(request, { deployments: DEPLOYMENTS, signer: PERSONAS.owner })));
    act(() => result.current.flow.sign());
    act(() => result.current.flow.approveMock());
    await waitFor(() => expect(result.current.flow.state.phase).toBe("done"));
    await waitFor(() => expect(result.current.list.data).toHaveLength(5));
  });
});

describe("useNow", () => {
  it("defaults to the wall clock, not the mock one (M2)", () => {
    const { Wrapper } = wrapperFor();
    const before = BigInt(Math.floor(Date.now() / 1000));
    const { result } = renderHook(() => useNow(), { wrapper: Wrapper });
    expect(result.current).not.toBe(MOCK_NOW);
    expect(result.current >= before && result.current <= before + 5n).toBe(true);
  });
  it("uses the injected clock", () => {
    const { Wrapper } = wrapperFor({ now: () => 42n });
    const { result } = renderHook(() => useNow(), { wrapper: Wrapper });
    expect(result.current).toBe(42n);
  });
});
