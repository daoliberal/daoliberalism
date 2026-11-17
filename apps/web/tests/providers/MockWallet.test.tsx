import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAS } from "@/data/mock/fixtures";
import { MockWalletProvider } from "@/providers/MockWallet";
import { useWallet, type WalletPort } from "@/providers/WalletPort";

const wrapper = ({ children }: { children: ReactNode }) => <MockWalletProvider>{children}</MockWalletProvider>;

afterEach(() => {
  window.history.replaceState({}, "", "/");
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks();
});

describe("MockWalletProvider", () => {
  it("starts disconnected in manual-mock mode", () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current).toMatchObject({ status: "disconnected", address: undefined, approvalMode: "manual-mock" });
  });

  it("connect() connects as the owner persona; disconnect() goes back", () => {
    const { result } = renderHook(() => useWallet(), { wrapper });
    act(() => result.current.connect());
    expect(result.current).toMatchObject({ status: "connected", address: PERSONAS.owner });
    act(() => result.current.disconnect());
    expect(result.current).toMatchObject({ status: "disconnected", address: undefined });
  });

  it("?mockWallet=founder connects as the founder", () => {
    window.history.replaceState({}, "", "/?mockWallet=founder");
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current).toMatchObject({ status: "connected", address: PERSONAS.founder });
  });

  it("?mockWallet=owner connects as the owner", () => {
    window.history.replaceState({}, "", "/treasuries/?x=1&mockWallet=owner");
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.address).toBe(PERSONAS.owner);
  });

  it("ignores unknown ?mockWallet values", () => {
    window.history.replaceState({}, "", "/?mockWallet=admin");
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.status).toBe("disconnected");
  });

  it("the first render is always disconnected, even with the param", () => {
    window.history.replaceState({}, "", "/?mockWallet=founder");
    const seen: WalletPort["status"][] = [];
    function Probe() {
      const w = useWallet();
      seen.push(w.status);
      return <p>{w.status}</p>;
    }
    render(<Probe />, { wrapper });
    expect(seen[0]).toBe("disconnected");
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("keeps the session across a remount via sessionStorage, and disconnect clears it", () => {
    const first = renderHook(() => useWallet(), { wrapper });
    act(() => first.result.current.connect());
    first.unmount();
    const second = renderHook(() => useWallet(), { wrapper });
    expect(second.result.current).toMatchObject({ status: "connected", address: PERSONAS.owner });
    act(() => second.result.current.disconnect());
    second.unmount();
    const third = renderHook(() => useWallet(), { wrapper });
    expect(third.result.current.status).toBe("disconnected");
  });

  it("survives a sessionStorage that throws on every access", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    window.history.replaceState({}, "", "/?mockWallet=founder");
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(result.current.address).toBe(PERSONAS.founder);
    act(() => result.current.disconnect());
    act(() => result.current.connect());
    expect(result.current.address).toBe(PERSONAS.owner);
  });

  it("useWallet outside a provider throws a clear error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useWallet())).toThrow(/wallet provider/);
    spy.mockRestore();
  });
});
