import { createContext, useContext } from "react";
import type { Address } from "@/data/types";

/**
 * The wallet seam. A later plan swaps the mock for a real wallet behind this interface.
 *
 * deployTreasury and createDao MUST be sent as DIRECT transactions from the connected account (an EOA or the
 * founder's own smart account), never through Multicall3 or any other forwarder/multicall: the contract would then
 * see the forwarder as the founder, and anyone could spend the treasury (contracts plan REVIEW-v5 F4).
 */
export interface WalletPort {
  address: Address | undefined;
  status: "disconnected" | "connected";
  connect(): void;
  disconnect(): void;
  approvalMode: "manual-mock" | "wallet";
}

export const WalletContext = createContext<WalletPort | null>(null);

export function useWallet(): WalletPort {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet must be used inside a wallet provider");
  return w;
}
