import type {
  ActionRequest,
  Address,
  Agent,
  AgentMembership,
  ClaimRecord,
  Credit,
  Dao,
  DaoMember,
  SpendRecord,
  Treasury,
  TreasuryAccounting,
  TxResult,
} from "./types";

export interface DataSource {
  listTreasuries(): Promise<Treasury[]>;
  getTreasury(address: Address): Promise<Treasury | null>;
  getTreasuryAccounting(address: Address): Promise<TreasuryAccounting>;
  listSpends(address: Address): Promise<SpendRecord[]>;
  listDaos(filter?: { treasury?: Address }): Promise<Dao[]>;
  getDao(id: bigint): Promise<Dao | null>;
  listDaoMembers(id: bigint): Promise<DaoMember[]>;
  listAgentsOf(owner: Address): Promise<Agent[]>;
  listMembershipsOf(agentId: bigint): Promise<AgentMembership[]>;
  listCredits(owner: Address): Promise<Credit[]>;
  listClaims(owner: Address): Promise<ClaimRecord[]>;
  /** Throws ActionError when rejected. */
  execute(request: ActionRequest, signer: Address): Promise<TxResult>;
}
