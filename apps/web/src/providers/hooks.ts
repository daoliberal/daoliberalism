import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
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
} from "@/data/types";
import { useClock, useDataSource } from "./DataProvider";
import { useWallet } from "./WalletPort";

export { useDeployments } from "./DataProvider";

/** Current time (unix seconds) from the provider's clock. */
export function useNow(): bigint {
  return useClock()();
}

export function useTreasuries(): UseQueryResult<Treasury[]> {
  const ds = useDataSource();
  return useQuery({ queryKey: ["treasuries"], queryFn: () => ds.listTreasuries() });
}

export function useTreasury(a?: Address): UseQueryResult<Treasury | null> {
  const ds = useDataSource();
  return useQuery({ queryKey: ["treasury", a], queryFn: () => ds.getTreasury(a as Address), enabled: a !== undefined });
}

export function useTreasuryAccounting(a?: Address): UseQueryResult<TreasuryAccounting> {
  const ds = useDataSource();
  return useQuery({
    queryKey: ["treasuryAccounting", a],
    queryFn: () => ds.getTreasuryAccounting(a as Address),
    enabled: a !== undefined,
  });
}

export function useSpends(a?: Address): UseQueryResult<SpendRecord[]> {
  const ds = useDataSource();
  return useQuery({ queryKey: ["spends", a], queryFn: () => ds.listSpends(a as Address), enabled: a !== undefined });
}

export function useDaos(f?: { treasury?: Address }): UseQueryResult<Dao[]> {
  const ds = useDataSource();
  return useQuery({ queryKey: ["daos", f?.treasury ?? null], queryFn: () => ds.listDaos(f) });
}

export function useDao(id?: bigint): UseQueryResult<Dao | null> {
  const ds = useDataSource();
  return useQuery({ queryKey: ["dao", id?.toString()], queryFn: () => ds.getDao(id as bigint), enabled: id !== undefined });
}

export function useDaoMembers(id?: bigint): UseQueryResult<DaoMember[]> {
  const ds = useDataSource();
  return useQuery({
    queryKey: ["daoMembers", id?.toString()],
    queryFn: () => ds.listDaoMembers(id as bigint),
    enabled: id !== undefined,
  });
}

export function useMyAgents(): UseQueryResult<Agent[]> {
  const ds = useDataSource();
  const { address } = useWallet();
  return useQuery({
    queryKey: ["myAgents", address],
    queryFn: () => ds.listAgentsOf(address as Address),
    enabled: address !== undefined,
  });
}

export function useMemberships(agentId?: bigint): UseQueryResult<AgentMembership[]> {
  const ds = useDataSource();
  return useQuery({
    queryKey: ["memberships", agentId?.toString()],
    queryFn: () => ds.listMembershipsOf(agentId as bigint),
    enabled: agentId !== undefined,
  });
}

export function useMyCredits(): UseQueryResult<Credit[]> {
  const ds = useDataSource();
  const { address } = useWallet();
  return useQuery({
    queryKey: ["myCredits", address],
    queryFn: () => ds.listCredits(address as Address),
    enabled: address !== undefined,
  });
}

export function useMyClaims(): UseQueryResult<ClaimRecord[]> {
  const ds = useDataSource();
  const { address } = useWallet();
  return useQuery({
    queryKey: ["myClaims", address],
    queryFn: () => ds.listClaims(address as Address),
    enabled: address !== undefined,
  });
}
