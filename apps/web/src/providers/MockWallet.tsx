import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PERSONAS } from "@/data/mock/fixtures";
import type { Address } from "@/data/types";
import { WalletContext, type WalletPort } from "./WalletPort";

type Persona = keyof typeof PERSONAS;
const STORAGE_KEY = "mockWallet";
const isPersona = (v: string | null | undefined): v is Persona => v === "owner" || v === "founder";

function storedPersona(): Persona | undefined {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return isPersona(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function remember(p: Persona | undefined): void {
  try {
    if (p) window.sessionStorage.setItem(STORAGE_KEY, p);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: the session just isn't remembered */
  }
}

/**
 * Mock wallet. The first render is always disconnected (identical on server and client); the session is restored in an
 * effect from `?mockWallet=owner|founder` (read from window.location, not useSearchParams, which would need Suspense in
 * a static export) or from sessionStorage.
 */
export function MockWalletProvider({ children }: { children: ReactNode }) {
  const [persona, setPersona] = useState<Persona | undefined>(undefined);

  useEffect(() => {
    let fromUrl: string | null = null;
    try {
      fromUrl = new URLSearchParams(window.location.search).get("mockWallet");
    } catch {
      /* no location */
    }
    const next = isPersona(fromUrl) ? fromUrl : storedPersona();
    if (next) {
      remember(next);
      // Deliberate: restoring a browser-only session after hydration, so the first render matches the server (disconnected).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPersona(next);
    }
  }, []);

  const connect = useCallback(() => {
    remember("owner");
    setPersona("owner");
  }, []);
  const disconnect = useCallback(() => {
    remember(undefined);
    setPersona(undefined);
  }, []);

  const value = useMemo<WalletPort>(() => {
    const address: Address | undefined = persona ? PERSONAS[persona] : undefined;
    return {
      address,
      status: address ? "connected" : "disconnected",
      connect,
      disconnect,
      approvalMode: "manual-mock",
    };
  }, [persona, connect, disconnect]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
