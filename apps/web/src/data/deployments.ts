import type { Address, Hex } from "./types";

export interface Deployments {
  agentRegistry: Address;
  treasuryRegistry: Address;
  treasuryFactory: Address;
  daoFactory: Address;
  paymentRouter: Address;
  equalSplit: Address;
  explorerBase: string;
}

// Phase 1b placeholders: first 6 / last 4 chars match the prototype's short addresses.
export const DEPLOYMENTS: Deployments = {
  agentRegistry: "0x9e2d00000000000000000000000000000000" + "41b3" as Address,
  treasuryRegistry: "0x6e4800000000000000000000000000000000" + "0c9f" as Address,
  treasuryFactory: "0xa4c700000000000000000000000000000000" + "0e55" as Address,
  daoFactory: "0x2b5100000000000000000000000000000000" + "d7e0" as Address,
  paymentRouter: "0x5c3a00000000000000000000000000000000" + "8b27" as Address,
  equalSplit: "0x2e0b00000000000000000000000000000000" + "c4d1" as Address,
  explorerBase: "https://sepolia.arbiscan.io",
};

export function splitKindOf(splitRule: Address, d: Deployments = DEPLOYMENTS): "equal" | "custom" {
  return splitRule.toLowerCase() === d.equalSplit.toLowerCase() ? "equal" : "custom";
}

export function explorerUrl(target: Address | Hex, d: Deployments = DEPLOYMENTS): string {
  const kind = target.length === 66 ? "tx" : "address";
  return `${d.explorerBase}/${kind}/${target}`;
}
