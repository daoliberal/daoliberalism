import { shortAddress } from "@/lib/format";
import type { Address } from "./types";

/**
 * The names shown when a profile or metadata file can't be read. Every data source (mock now, chain later), every screen
 * and the edit form take them from here, so a fallback is never mistaken for a name the owner chose.
 */
export const agentFallbackName = (id: bigint | number | string): string => `Agent #${id}`;
export const daoFallbackName = (id: bigint | number | string): string => `DAO #${id}`;
export const treasuryFallbackName = (address: Address): string => `Treasury ${shortAddress(address)}`;

export const isFallbackAgentName = (name: string, id: bigint | number | string): boolean => name === agentFallbackName(id);
