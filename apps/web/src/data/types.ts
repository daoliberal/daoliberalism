import type { Address, Hex } from "viem";

export type { Address, Hex };
export type Wei = bigint;
export type UnixSeconds = bigint;

export interface TreasuryConfig {
  feeBps: number;
  expenseBps: number;
  holdPeriod: number;
  maxAgents: number;
  splitRule: Address;
}
export interface TreasuryMetadata {
  name: string;
  description: string;
}
interface TreasuryBase {
  address: Address;
  deployedAt: UnixSeconds;
  seatsUsed: number;
  daoCount: number;
  volume: Wei;
  metadata: TreasuryMetadata;
}
export interface ConfigurableTreasury extends TreasuryBase {
  kind: "configurable";
  founder: Address;
  config: TreasuryConfig;
  metadataURI: string;
}
export interface ExternalTreasury extends TreasuryBase {
  kind: "external";
}
export type Treasury = ConfigurableTreasury | ExternalTreasury;
export function isConfigurable(t: Treasury): t is ConfigurableTreasury {
  return t.kind === "configurable";
}
export interface TreasuryAccounting {
  balance: Wei;
  collectedFees: Wei;
  collectedExpenses: Wei;
  spent: Wei;
}
export interface SpendRecord {
  at: UnixSeconds;
  to: Address;
  amount: Wei;
  txHash: Hex;
}

export interface DaoMetadata {
  name: string;
  description: string;
  website?: string;
}
export interface Dao {
  id: bigint;
  address: Address;
  metadataURI: string;
  metadata: DaoMetadata;
  founder: Address;
  founderAgentId: bigint;
  treasury: Address;
  createdAt: UnixSeconds;
  memberCount: number;
  volume: Wei;
}
export interface DaoMember {
  agentId: bigint;
  name: string;
  agentKey: Address;
  owner: Address;
  joinedAt: UnixSeconds;
  isFounder: boolean;
}

export interface AgentRegistrationFile {
  type?: string;
  name: string;
  description?: string;
  image?: string;
  services?: { name: string; endpoint: string; version?: string }[];
  x402Support?: boolean;
  active?: boolean;
  registrations?: unknown[];
  supportedTrust?: string[];
  [k: string]: unknown;
}
export interface Agent {
  id: bigint;
  owner: Address;
  agentKey: Address;
  metadataURI: string;
  profile: AgentRegistrationFile;
  registeredAt: UnixSeconds;
}
export interface AgentMembership {
  dao: Dao;
  treasury: Treasury;
}

export interface Credit {
  receiptKey: Hex;
  orderId: Hex;
  daoId: bigint;
  daoName: string;
  agentIds: bigint[];
  agentNames: string[];
  treasury: Address;
  treasuryName: string;
  holdPeriod: number;
  amount: Wei;
  creditedAt: UnixSeconds;
  releaseTime: UnixSeconds;
  claimed: boolean;
}
export interface ClaimRecord {
  txHash: Hex;
  at: UnixSeconds;
  creditCount: number;
  amount: Wei;
}

export type ActionRequest =
  | { kind: "registerAgent"; agentKey: Address; metadataURI: string }
  // one change per signature: either the agent key or the metadata URI, never both
  | { kind: "updateAgent"; agentId: bigint; agentKey: Address; metadataURI?: undefined }
  | { kind: "updateAgent"; agentId: bigint; metadataURI: string; agentKey?: undefined }
  | { kind: "joinDao"; daoId: bigint; agentId: bigint }
  | { kind: "createDao"; metadataURI: string; founderAgentId: bigint; treasury: Address }
  | { kind: "deployTreasury"; config: TreasuryConfig; metadataURI: string }
  | { kind: "claim"; receiptKeys: Hex[] }
  | { kind: "spend"; treasury: Address; to: Address; amount: Wei };
export interface TxResult {
  txHash: Hex;
  created?: { treasury?: Address; daoId?: bigint; agentId?: bigint };
}
export type ActionErrorCode =
  | "NotFounder"
  | "AdmissionDenied"
  | "AlreadyMember"
  | "NotMember"
  | "NotAgentOwner"
  | "AgentNotFound"
  | "MemberCapReached"
  | "BpsTooHigh"
  | "InvalidSplitRule"
  | "InsufficientAccrued"
  | "NothingToClaim"
  | "TreasuryNotRegistered"
  | "ZeroAmount"
  | "ZeroAddress"
  | "Rejected"
  | "Unknown";
export class ActionError extends Error {
  code: ActionErrorCode;
  constructor(code: ActionErrorCode, message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}
