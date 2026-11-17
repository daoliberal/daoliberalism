import { keccak256, toHex } from "viem";
import type { DataSource } from "../datasource";
import { agentFallbackName, daoFallbackName, treasuryFallbackName } from "../fallbacks";
import {
  decodeDaoMetadata,
  decodeDataUriJson,
  decodeTreasuryMetadata,
  parseAgentMetadata,
} from "../metadata";
import {
  ActionError,
  isConfigurable,
  type ActionRequest,
  type Address,
  type Agent,
  type AgentMembership,
  type AgentRegistrationFile,
  type ClaimRecord,
  type ConfigurableTreasury,
  type Credit,
  type Dao,
  type DaoMember,
  type Hex,
  type SpendRecord,
  type Treasury,
  type TreasuryAccounting,
  type TxResult,
} from "../types";
import { mockNow } from "./clock";
import { DEFAULT_FIXTURES, PERSONAS, type FixtureSet } from "./fixtures";

const BPS = 10_000;
const MAX_DAO_MEMBERS = 100; // DAO.MAX_MEMBERS
const NEVER_PAID: TreasuryAccounting = { balance: 0n, collectedFees: 0n, collectedExpenses: 0n, spent: 0n };

interface OwnedClaim {
  owner: Address;
  record: ClaimRecord;
}

/** The whole mutable world. Every action returns a new State; nothing inside is mutated. */
interface State {
  treasuries: Treasury[];
  accounting: Record<string, TreasuryAccounting>;
  spends: Record<string, SpendRecord[]>;
  daos: Dao[];
  members: Record<string, DaoMember[]>;
  agents: Agent[];
  memberOf: Record<string, bigint[]>;
  credits: Credit[];
  claims: OwnedClaim[];
  agentMetadataByUri: Record<string, AgentRegistrationFile>;
  counter: number;
}

const lc = (a: string) => a.toLowerCase();
const same = (a: string, b: string) => lc(a) === lc(b);
const isZero = (a: string) => /^0x0*$/i.test(a);

function lowerKeys<T>(rec: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [lc(k), v]));
}

function initialState(f: FixtureSet): State {
  const memberOf: Record<string, bigint[]> = {};
  for (const [agentId, list] of Object.entries(f.memberships)) memberOf[agentId] = list.map((m) => m.dao.id);
  // Members listed on a DAO also count as memberships.
  for (const [daoId, list] of Object.entries(f.members)) {
    for (const m of list) {
      const key = m.agentId.toString();
      const ids = memberOf[key] ?? [];
      if (!ids.some((id) => id.toString() === daoId)) memberOf[key] = [...ids, BigInt(daoId)];
    }
  }
  return {
    treasuries: [...f.treasuries],
    accounting: lowerKeys(f.accounting),
    spends: lowerKeys(f.spends),
    daos: [...f.daos],
    members: { ...f.members },
    agents: [...f.agents],
    memberOf,
    credits: [...f.credits],
    claims: f.claims.map((record) => ({ owner: PERSONAS.owner, record })),
    agentMetadataByUri: { ...f.agentMetadataByUri },
    counter: 0,
  };
}

function resolveAgentProfile(uri: string, id: bigint, byUri: Record<string, AgentRegistrationFile>): AgentRegistrationFile {
  const known = byUri[uri];
  const raw = known ?? (() => {
    const d = decodeDataUriJson(uri);
    return d.ok ? d.value : undefined;
  })();
  if (raw !== undefined) {
    const p = parseAgentMetadata(raw);
    if (p.ok) return p.value;
  }
  return { name: agentFallbackName(id) };
}

function nextHash(s: State, label: string): { hash: Hex; counter: number } {
  const counter = s.counter + 1;
  return { hash: keccak256(toHex(`${label}:${counter}`)), counter };
}

function addressFrom(hash: Hex): Address {
  return `0x${hash.slice(26)}` as Address;
}

const fail = (code: ConstructorParameters<typeof ActionError>[0], message: string): never => {
  throw new ActionError(code, message);
};

function requireAgent(s: State, agentId: bigint, signer: Address): Agent {
  const a = s.agents.find((x) => x.id === agentId);
  if (!a) return fail("AgentNotFound", `${agentFallbackName(agentId)} is not registered.`);
  if (!same(a.owner, signer)) return fail("NotAgentOwner", `${agentFallbackName(agentId)} belongs to another wallet.`);
  return a;
}

function isMember(s: State, dao: Dao, agentId: bigint): boolean {
  return (
    (s.members[dao.id.toString()] ?? []).some((m) => m.agentId === agentId) ||
    (s.memberOf[agentId.toString()] ?? []).includes(dao.id)
  );
}

/** Seat check the treasury performs when a DAO under it admits an agent. */
function requireSeat(s: State, treasuryAddress: Address): Treasury {
  const t = s.treasuries.find((x) => same(x.address, treasuryAddress));
  if (!t) return fail("AdmissionDenied", "The DAO's treasury could not be asked to admit this agent.");
  if (isConfigurable(t) && t.seatsUsed >= t.config.maxAgents) {
    // DAO._admit: treasury.canAdmit == false reverts AdmissionDenied (MemberCapReached is the DAO's own cap).
    return fail("AdmissionDenied", "No seats left under this treasury.");
  }
  return t;
}

function admit(s: State, dao: Dao, agent: Agent, signer: Address, now: bigint, isFounder: boolean): State {
  const member: DaoMember = {
    agentId: agent.id,
    name: agent.profile.name,
    agentKey: agent.agentKey,
    owner: signer,
    joinedAt: now,
    isFounder,
  };
  const key = dao.id.toString();
  return {
    ...s,
    treasuries: s.treasuries.map((t) => (same(t.address, dao.treasury) ? { ...t, seatsUsed: t.seatsUsed + 1 } : t)),
    daos: s.daos.map((d) => (d.id === dao.id ? { ...d, memberCount: d.memberCount + 1 } : d)),
    members: { ...s.members, [key]: [...(s.members[key] ?? []), member] },
    memberOf: { ...s.memberOf, [agent.id.toString()]: [...(s.memberOf[agent.id.toString()] ?? []), dao.id] },
  };
}

function creditOwner(s: State, c: Credit): Address {
  const first = c.agentIds[0];
  const a = first === undefined ? undefined : s.agents.find((x) => x.id === first);
  return a ? a.owner : PERSONAS.owner;
}

function apply(s: State, req: ActionRequest, signer: Address, now: bigint): { state: State; result: TxResult } {
  switch (req.kind) {
    case "registerAgent": {
      const id = s.agents.reduce((m, a) => (a.id > m ? a.id : m), 0n) + 1n;
      const { hash, counter } = nextHash(s, "tx");
      const agent: Agent = {
        id,
        owner: signer,
        agentKey: req.agentKey,
        metadataURI: req.metadataURI,
        profile: resolveAgentProfile(req.metadataURI, id, s.agentMetadataByUri),
        registeredAt: now,
      };
      return { state: { ...s, agents: [...s.agents, agent], counter }, result: { txHash: hash, created: { agentId: id } } };
    }
    case "updateAgent": {
      const a = requireAgent(s, req.agentId, signer);
      const metadataURI = req.metadataURI ?? a.metadataURI;
      const updated: Agent = {
        ...a,
        agentKey: req.agentKey ?? a.agentKey,
        metadataURI,
        profile: req.metadataURI === undefined ? a.profile : resolveAgentProfile(metadataURI, a.id, s.agentMetadataByUri),
      };
      const { hash, counter } = nextHash(s, "tx");
      return {
        state: { ...s, agents: s.agents.map((x) => (x.id === a.id ? updated : x)), counter },
        result: { txHash: hash },
      };
    }
    case "joinDao": {
      const dao = s.daos.find((d) => d.id === req.daoId);
      if (!dao) return fail("Unknown", `${daoFallbackName(req.daoId)} does not exist.`);
      const agent = requireAgent(s, req.agentId, signer);
      if (isMember(s, dao, agent.id)) return fail("AlreadyMember", `${agent.profile.name} is already a member.`);
      if (dao.memberCount >= MAX_DAO_MEMBERS) return fail("MemberCapReached", "This DAO is full.");
      requireSeat(s, dao.treasury);
      const { hash, counter } = nextHash(s, "tx");
      return { state: { ...admit(s, dao, agent, signer, now, false), counter }, result: { txHash: hash } };
    }
    case "createDao": {
      const agent = requireAgent(s, req.founderAgentId, signer);
      if (!s.treasuries.some((t) => same(t.address, req.treasury))) {
        return fail("TreasuryNotRegistered", "That treasury is not registered.");
      }
      requireSeat(s, req.treasury);
      const id = s.daos.reduce((m, d) => (d.id > m ? d.id : m), 0n) + 1n;
      const h = nextHash(s, "dao");
      const meta = decodeDaoMetadata(req.metadataURI);
      const dao: Dao = {
        id,
        address: addressFrom(h.hash),
        metadataURI: req.metadataURI,
        metadata: meta.ok ? meta.value : { name: daoFallbackName(id), description: "" },
        founder: signer,
        founderAgentId: agent.id,
        treasury: req.treasury,
        createdAt: now,
        memberCount: 0,
        volume: 0n,
      };
      const base: State = {
        ...s,
        daos: [...s.daos, dao],
        treasuries: s.treasuries.map((t) => (same(t.address, req.treasury) ? { ...t, daoCount: t.daoCount + 1 } : t)),
        counter: h.counter,
      };
      const next = admit(base, dao, agent, signer, now, true);
      const tx = nextHash(next, "tx");
      return { state: { ...next, counter: tx.counter }, result: { txHash: tx.hash, created: { daoId: id } } };
    }
    case "deployTreasury": {
      const { feeBps, expenseBps, splitRule } = req.config;
      if (feeBps + expenseBps > BPS) return fail("BpsTooHigh", "Fee and expenses together can't exceed 100%.");
      if (isZero(splitRule)) return fail("InvalidSplitRule", "The split rule is not a valid contract.");
      const h = nextHash(s, "treasury");
      const address = addressFrom(h.hash);
      const meta = decodeTreasuryMetadata(req.metadataURI);
      const treasury: ConfigurableTreasury = {
        kind: "configurable",
        address,
        founder: signer,
        config: req.config,
        metadata: meta.ok ? meta.value : { name: treasuryFallbackName(address), description: "" },
        metadataURI: req.metadataURI,
        deployedAt: now,
        seatsUsed: 0,
        daoCount: 0,
        volume: 0n,
      };
      const tx = nextHash({ ...s, counter: h.counter }, "tx");
      return {
        state: {
          ...s,
          treasuries: [...s.treasuries, treasury],
          accounting: { ...s.accounting, [lc(address)]: NEVER_PAID },
          spends: { ...s.spends, [lc(address)]: [] },
          counter: tx.counter,
        },
        result: { txHash: tx.hash, created: { treasury: address } },
      };
    }
    case "claim": {
      const seen = new Set<string>();
      let total = 0n;
      let count = 0;
      const paid = new Set<string>();
      for (const k of req.receiptKeys) {
        const key = lc(k);
        if (seen.has(key)) continue;
        seen.add(key);
        const c = s.credits.find((x) => lc(x.receiptKey) === key);
        if (!c || c.claimed || !same(creditOwner(s, c), signer) || c.releaseTime > now) continue;
        paid.add(key);
        total += c.amount;
        count += 1;
      }
      if (total === 0n) return fail("NothingToClaim", "Nothing is ready to claim.");
      const { hash, counter } = nextHash(s, "tx");
      const record: ClaimRecord = { txHash: hash, at: now, creditCount: count, amount: total };
      return {
        state: {
          ...s,
          credits: s.credits.map((c) => (paid.has(lc(c.receiptKey)) ? { ...c, claimed: true } : c)),
          claims: [{ owner: signer, record }, ...s.claims],
          counter,
        },
        result: { txHash: hash },
      };
    }
    case "spend": {
      const t = s.treasuries.find((x) => same(x.address, req.treasury));
      if (!t) return fail("TreasuryNotRegistered", "That treasury is not registered.");
      if (!isConfigurable(t)) return fail("Unknown", "This treasury has no spend function.");
      if (!same(t.founder, signer)) return fail("NotFounder", "Only the treasury founder can spend.");
      if (req.amount === 0n) return fail("ZeroAmount", "Amount must be more than 0.");
      if (isZero(req.to)) return fail("ZeroAddress", "Recipient can't be the zero address.");
      const acc = s.accounting[lc(t.address)] ?? NEVER_PAID;
      if (req.amount > acc.balance) return fail("InsufficientAccrued", "Amount is above the available balance.");
      const { hash, counter } = nextHash(s, "tx");
      const record: SpendRecord = { at: now, to: req.to, amount: req.amount, txHash: hash };
      return {
        state: {
          ...s,
          accounting: {
            ...s.accounting,
            [lc(t.address)]: { ...acc, balance: acc.balance - req.amount, spent: acc.spent + req.amount },
          },
          spends: { ...s.spends, [lc(t.address)]: [record, ...(s.spends[lc(t.address)] ?? [])] },
          counter,
        },
        result: { txHash: hash },
      };
    }
  }
}

export interface MockOptions {
  now?: () => bigint;
  /** Artificial delay per call; 0 in tests/Playwright, ~400 in the browser. */
  latencyMs?: number;
  /** Replaces whole keys of DEFAULT_FIXTURES (edge cases are passed in here, never added by default). */
  fixtures?: Partial<FixtureSet>;
}

export function createMockDataSource(opts: MockOptions = {}): DataSource & { reset(): void } {
  const now = opts.now ?? mockNow;
  const latency = opts.latencyMs ?? 0;
  const fixtures: FixtureSet = { ...DEFAULT_FIXTURES, ...opts.fixtures };
  let state = initialState(fixtures);

  const wait = (): Promise<void> =>
    latency > 0 ? new Promise((resolve) => setTimeout(resolve, latency)) : Promise.resolve();

  const treasuryOf = (s: State, address: Address) => s.treasuries.find((t) => same(t.address, address));

  return {
    async listTreasuries() {
      await wait();
      return [...state.treasuries];
    },
    async getTreasury(address) {
      await wait();
      return treasuryOf(state, address) ?? null;
    },
    async getTreasuryAccounting(address) {
      await wait();
      return state.accounting[lc(address)] ?? NEVER_PAID;
    },
    async listSpends(address) {
      await wait();
      return [...(state.spends[lc(address)] ?? [])];
    },
    async listDaos(filter) {
      await wait();
      const t = filter?.treasury;
      return state.daos.filter((d) => t === undefined || same(d.treasury, t));
    },
    async getDao(id) {
      await wait();
      return state.daos.find((d) => d.id === id) ?? null;
    },
    async listDaoMembers(id) {
      await wait();
      // The name is the agent's current profile, so a rename shows up here too.
      return (state.members[id.toString()] ?? []).map((m) => ({
        ...m,
        name: state.agents.find((a) => a.id === m.agentId)?.profile.name ?? m.name,
      }));
    },
    async listAgentsOf(owner) {
      await wait();
      return state.agents.filter((a) => same(a.owner, owner));
    },
    async listMembershipsOf(agentId) {
      await wait();
      const out: AgentMembership[] = [];
      for (const daoId of state.memberOf[agentId.toString()] ?? []) {
        const dao = state.daos.find((d) => d.id === daoId);
        const treasury = dao ? treasuryOf(state, dao.treasury) : undefined;
        if (dao && treasury) out.push({ dao, treasury });
      }
      return out;
    },
    async listCredits(owner) {
      await wait();
      return state.credits.filter((c) => same(creditOwner(state, c), owner));
    },
    async listClaims(owner) {
      await wait();
      return state.claims.filter((c) => same(c.owner, owner)).map((c) => c.record);
    },
    async execute(request, signer) {
      await wait();
      // Check and write happen in one synchronous step, so concurrent identical calls cannot both succeed.
      const { state: next, result } = apply(state, request, signer, now());
      state = next;
      return result;
    },
    reset() {
      state = initialState(fixtures);
    },
  };
}
