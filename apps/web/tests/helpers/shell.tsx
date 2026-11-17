import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { ReactNode } from "react";
import { PERSONAS } from "@/data/mock/fixtures";
import type { Address } from "@/data/types";
import { WalletContext, type WalletPort } from "@/providers/WalletPort";

/** Installs a controllable window.matchMedia; `set(true)` switches to the 390px layout and fires the change event. */
export function mockViewport(narrow: boolean) {
  let matches = narrow;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "(max-width: 720px)",
    addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
  };
  const matchMedia = vi.fn(() => mql);
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
  return {
    matchMedia,
    set(next: boolean) {
      matches = next;
      act(() => listeners.forEach((l) => l({ matches: next })));
    },
  };
}

export function removeViewportMock() {
  Reflect.deleteProperty(window, "matchMedia");
  delete document.documentElement.dataset.layout;
  delete document.documentElement.dataset.theme;
}

export function walletPort(overrides: Omit<Partial<WalletPort>, "address"> & { address?: Address | null } = {}): WalletPort {
  const address = overrides.address === null ? undefined : (overrides.address ?? PERSONAS.owner);
  const rest: Partial<WalletPort> = { ...overrides, address: undefined };
  delete rest.address;
  return {
    address,
    status: address ? "connected" : "disconnected",
    connect: vi.fn(),
    disconnect: vi.fn(),
    approvalMode: "manual-mock",
    ...rest,
  };
}

export function WithWallet({ wallet, children }: { wallet: WalletPort; children: ReactNode }) {
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}
