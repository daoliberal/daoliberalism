import { encodeAbiParameters, keccak256, numberToHex, parseEther, toHex } from "viem";
import { splitPayment } from "@/lib/money";
import { treasuryFallbackName } from "../fallbacks";
import { DEPLOYMENTS } from "../deployments";
import { buildAgentMetadata, encodeDaoMetadata, encodeTreasuryMetadata } from "../metadata";
import type {
  Address,
  Agent,
  AgentMembership,
  AgentRegistrationFile,
  ClaimRecord,
  ConfigurableTreasury,
  Credit,
  Dao,
  DaoMember,
  ExternalTreasury,
  Hex,
  SpendRecord,
  Treasury,
  TreasuryAccounting,
  TreasuryConfig,
} from "../types";
import { MOCK_NOW } from "./clock";

export { MOCK_NOW };

export interface FixtureSet {
  treasuries: Treasury[];
  accounting: Record<Address, TreasuryAccounting>;
  spends: Record<Address, SpendRecord[]>;
  daos: Dao[];
  members: Record<string, DaoMember[]>;
  agents: Agent[];
  memberships: Record<string, AgentMembership[]>;
  credits: Credit[];
  claims: ClaimRecord[];
  agentMetadataByUri: Record<string, AgentRegistrationFile>;
}

// ---------------------------------------------------------------- helpers

/**
 * A 42-character address whose first 6 and last 4 characters are the prototype's short form
 * verbatim (letter case included); the middle is a deterministic filler.
 */
function A(short: string): Address {
  const head = short.slice(0, 6);
  const tail = short.slice(-4);
  const middle = keccak256(toHex(short)).slice(2, 34);
  return `${head}${middle}${tail}` as Address;
}

/** A 32-byte hash whose first 6 characters are the prototype's short form. */
function H(short: string): Hex {
  return `${short.slice(0, 6)}${keccak256(toHex(short)).slice(2, 62)}` as Hex;
}

/** PaymentRouter.receiptKeyOf: keccak256(abi.encode(payer, daoId, orderId)). */
function receiptKeyOf(payer: Address, daoId: bigint, orderId: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes32" }], [payer, daoId, orderId]),
  );
}

/** UTC timestamp (seconds). */
function at(year: number, month: number, day: number, hour = 12): bigint {
  return BigInt(Date.UTC(year, month - 1, day, hour) / 1000);
}

function dataUri(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:application/json;base64,${btoa(bin)}`;
}

const DAY = 86400;

export const PERSONAS: { owner: Address; founder: Address } = {
  owner: A("0x91c4…a4F2"),
  founder: A("0x3b02…7E21"),
};
const { owner: OWNER, founder: FOUNDER } = PERSONAS;

/** The customer address that paid every fixture order (receipt keys are keyed on it). */
export const PAYER: Address = A("0xc057…0b3d");

const CUSTOM_RULE = A("0x7a3d…e914");

// ---------------------------------------------------------------- treasuries

function treasury(p: {
  name: string;
  description: string;
  short: string;
  founder: Address;
  feeBps: number;
  expenseBps: number;
  holdDays: number;
  maxAgents: number;
  splitRule: Address;
  seatsUsed: number;
  daoCount: number;
  volume: string;
  deployedAt: bigint;
}): ConfigurableTreasury {
  const metadata = { name: p.name, description: p.description };
  const config: TreasuryConfig = {
    feeBps: p.feeBps,
    expenseBps: p.expenseBps,
    holdPeriod: p.holdDays * DAY,
    maxAgents: p.maxAgents,
    splitRule: p.splitRule,
  };
  return {
    kind: "configurable",
    address: A(p.short),
    founder: p.founder,
    config,
    metadata,
    metadataURI: encodeTreasuryMetadata(metadata),
    deployedAt: p.deployedAt,
    seatsUsed: p.seatsUsed,
    daoCount: p.daoCount,
    volume: parseEther(p.volume),
  };
}

const commonwealth = treasury({
  name: "Commonwealth",
  description: "A general-purpose model: a modest fee, a one-week hold, and everyone in a DAO shares equally.",
  short: "0x4f2a…91c0",
  founder: FOUNDER,
  feeBps: 500,
  expenseBps: 300,
  holdDays: 7,
  maxAgents: 500,
  splitRule: DEPLOYMENTS.equalSplit,
  seatsUsed: 142,
  daoCount: 18,
  volume: "412.60",
  deployedAt: at(2026, 8, 4),
});
const leanGuild = treasury({
  name: "Lean Guild",
  description: "Almost no overhead and a two-week hold; everyone in a DAO shares equally.",
  short: "0x8c11…02ab",
  founder: A("0x6b0e…9d24"),
  feeBps: 100,
  expenseBps: 0,
  holdDays: 14,
  maxAgents: 100,
  splitRule: DEPLOYMENTS.equalSplit,
  seatsUsed: 37,
  daoCount: 6,
  volume: "58.25",
  deployedAt: at(2026, 8, 20),
});
const meritline = treasury({
  name: "Meritline",
  description: "A short three-day hold and a custom rule that weighs members by contribution.",
  short: "0x19be…44d7",
  founder: A("0xa91d…3e70"),
  feeBps: 800,
  expenseBps: 400,
  holdDays: 3,
  maxAgents: 1000,
  splitRule: CUSTOM_RULE,
  seatsUsed: 980,
  daoCount: 41,
  volume: "1204.10",
  deployedAt: at(2026, 8, 10),
});
const openField = treasury({
  name: "Open Field",
  description: "Small fees, a long thirty-day hold and equal shares for every member.",
  short: "0xd05e…7f3a",
  founder: A("0x58c2…b6f1"),
  feeBps: 200,
  expenseBps: 200,
  holdDays: 30,
  maxAgents: 250,
  splitRule: DEPLOYMENTS.equalSplit,
  seatsUsed: 12,
  daoCount: 3,
  volume: "9.80",
  deployedAt: at(2026, 9, 12),
});
const TREASURIES: ConfigurableTreasury[] = [commonwealth, leanGuild, meritline, openField];

function accountingOf(t: ConfigurableTreasury, spent: bigint): TreasuryAccounting {
  const r = splitPayment(t.volume, t.config.feeBps, t.config.expenseBps, 1);
  if (!r.ok) throw new Error("fixture treasury has invalid bps");
  return {
    collectedFees: r.treasuryFee,
    collectedExpenses: r.expenseFee,
    spent,
    balance: r.treasuryFee + r.expenseFee - spent,
  };
}

const COMMONWEALTH_SPENDS: SpendRecord[] = [
  { at: at(2026, 10, 12), to: A("0x7e19…b2c0"), amount: parseEther("2.500"), txHash: H("0x9a1c…") },
  { at: at(2026, 9, 28), to: A("0x0f44…19de"), amount: parseEther("4.000"), txHash: H("0x51be…") },
  { at: at(2026, 9, 2), to: A("0x7e19…b2c0"), amount: parseEther("1.600"), txHash: H("0xc077…") },
  { at: at(2026, 8, 15), to: A("0xab33…7c21"), amount: parseEther("1.500"), txHash: H("0x2d4f…") },
];
const COMMONWEALTH_SPENT = COMMONWEALTH_SPENDS.reduce((s, x) => s + x.amount, 0n);

const ACCOUNTING: Record<Address, TreasuryAccounting> = {
  [commonwealth.address]: accountingOf(commonwealth, COMMONWEALTH_SPENT),
  [leanGuild.address]: accountingOf(leanGuild, 0n),
  [meritline.address]: accountingOf(meritline, 0n),
  [openField.address]: accountingOf(openField, 0n),
};
const SPENDS: Record<Address, SpendRecord[]> = {
  [commonwealth.address]: COMMONWEALTH_SPENDS,
  [leanGuild.address]: [],
  [meritline.address]: [],
  [openField.address]: [],
};

// ---------------------------------------------------------------- agents

const NAMES = {
  quill: "Quill‑2",
  atlas: "Atlas‑7",
  marlow: "Marlow",
  kestrel: "Kestrel",
  juniper: "Juniper",
  tern: "Tern",
  sable: "Sable‑3",
  wren: "Wren",
  ox: "Ox‑Relay",
} as const;

const AGENT_METADATA_BY_URI: Record<string, AgentRegistrationFile> = {
  "ipfs://bafy…atlas7.json": buildAgentMetadata({ name: NAMES.atlas }),
  "https://juniper.example/agent.json": buildAgentMetadata({ name: NAMES.juniper }),
  "ipfs://bafy…oxrelay.json": buildAgentMetadata({ name: NAMES.ox }),
};

function agent(id: bigint, name: string, owner: Address, agentKey: Address, registeredAt: bigint, uri?: string): Agent {
  if (uri !== undefined) {
    const profile = AGENT_METADATA_BY_URI[uri];
    if (!profile) throw new Error(`fixture agent ${name}: unmapped metadata URI`);
    return { id, owner, agentKey, metadataURI: uri, profile, registeredAt };
  }
  const profile = buildAgentMetadata({ name });
  return { id, owner, agentKey, metadataURI: dataUri(profile), profile, registeredAt };
}

const AGENTS: Agent[] = [
  agent(1n, NAMES.quill, FOUNDER, A("0x88a1…4c10"), at(2026, 8, 5)),
  agent(2n, NAMES.atlas, OWNER, "0x5d3e8a0c71f2b94e0d6a3c55e1b7f4a2c09e19A0", at(2026, 8, 6), "ipfs://bafy…atlas7.json"),
  agent(3n, NAMES.marlow, A("0xe6d2…0B44"), A("0x1f7c…aa09"), at(2026, 8, 10)),
  agent(4n, NAMES.kestrel, A("0x77fa…c1D9"), A("0x4b20…7d3e"), at(2026, 8, 19)),
  agent(5n, NAMES.juniper, OWNER, "0xc2e84b17d0aa63f9e2c815b07de4a9136c1d5f01", at(2026, 8, 30), "https://juniper.example/agent.json"),
  agent(6n, NAMES.tern, A("0x2a6e…f0A1"), A("0x9c05…31b8"), at(2026, 9, 2)),
  agent(7n, NAMES.sable, A("0x5f13…7b2E"), A("0xd1aa…8e62"), at(2026, 9, 21)),
  agent(8n, NAMES.wren, A("0xb8c0…44d3"), A("0x6e48…0c9f"), at(2026, 10, 5)),
  agent(9n, NAMES.ox, OWNER, "0x0b97f3d21c84a5e60b17d93ac2f4e8b15a6be2C4", at(2026, 10, 18), "ipfs://bafy…oxrelay.json"),
];
const agentByName = (n: string): Agent => {
  const a = AGENTS.find((x) => x.profile.name === n);
  if (!a) throw new Error(`fixture agent ${n}`);
  return a;
};

// ---------------------------------------------------------------- daos

function dao(p: {
  id: bigint;
  name: string;
  description: string;
  website?: string;
  short: string;
  founder: Address;
  founderAgent: string;
  treasury: ConfigurableTreasury;
  createdAt: bigint;
  memberCount: number;
  volume: string;
}): Dao {
  const metadata = p.website
    ? { name: p.name, description: p.description, website: p.website }
    : { name: p.name, description: p.description };
  return {
    id: p.id,
    address: A(p.short),
    metadataURI: encodeDaoMetadata(metadata),
    metadata,
    founder: p.founder,
    founderAgentId: agentByName(p.founderAgent).id,
    treasury: p.treasury.address,
    createdAt: p.createdAt,
    memberCount: p.memberCount,
    volume: parseEther(p.volume),
  };
}

const northwind = dao({
  id: 1n, name: "Northwind Studio", description: "Product and brand copy, drafted and reviewed by agents.",
  website: "https://northwind-studio.example", short: "0x61f0…aa32", founder: FOUNDER, founderAgent: NAMES.quill,
  treasury: commonwealth, createdAt: at(2026, 8, 9), memberCount: 6, volume: "96.40",
});
const fieldnotes = dao({
  id: 2n, name: "Fieldnotes Co-op", description: "Interview transcription and field research summaries.",
  short: "0x3d7a…19ce", founder: agentByName(NAMES.marlow).owner, founderAgent: NAMES.marlow,
  treasury: commonwealth, createdAt: at(2026, 8, 14), memberCount: 11, volume: "71.15",
});
const ledgerline = dao({
  id: 3n, name: "Ledgerline Labs", description: "Bookkeeping reconciliation for small businesses.",
  short: "0xb4e9…60d2", founder: agentByName(NAMES.kestrel).owner, founderAgent: NAMES.kestrel,
  treasury: meritline, createdAt: at(2026, 8, 25), memberCount: 24, volume: "310.75",
});
const quietHarbor = dao({
  id: 4n, name: "Quiet Harbor", description: "Code review and test writing for open-source projects.",
  short: "0x72c8…e5b1", founder: agentByName(NAMES.tern).owner, founderAgent: NAMES.tern,
  treasury: leanGuild, createdAt: at(2026, 9, 1), memberCount: 5, volume: "22.10",
});
const paperLantern = dao({
  id: 5n, name: "Paper Lantern Translation", description: "Document translation and proofreading between major languages.",
  short: "0x4ad6…8b09", founder: agentByName(NAMES.kestrel).owner, founderAgent: NAMES.kestrel,
  treasury: commonwealth, createdAt: at(2026, 9, 2), memberCount: 4, volume: "38.02",
});
const brightwater = dao({
  id: 6n, name: "Brightwater Research", description: "Literature reviews and source checking for analysts.",
  short: "0xe18f…3a47", founder: agentByName(NAMES.sable).owner, founderAgent: NAMES.sable,
  treasury: commonwealth, createdAt: at(2026, 9, 19), memberCount: 9, volume: "27.80",
});
const sparrow = dao({
  id: 7n, name: "Sparrow Data", description: "Dataset cleaning and labelling.",
  short: "0x95a3…c7f6", founder: agentByName(NAMES.wren).owner, founderAgent: NAMES.wren,
  treasury: openField, createdAt: at(2026, 9, 28), memberCount: 3, volume: "4.60",
});
const DAOS: Dao[] = [northwind, fieldnotes, ledgerline, quietHarbor, paperLantern, brightwater, sparrow];

/** [dao, agent name, joinedAt] — Northwind is the prototype's member list; the rest are the known agents. */
const JOINS: [Dao, string, bigint][] = [
  [northwind, NAMES.quill, at(2026, 8, 9)],
  [northwind, NAMES.marlow, at(2026, 8, 11)],
  [northwind, NAMES.kestrel, at(2026, 8, 20)],
  [northwind, NAMES.tern, at(2026, 9, 3)],
  [northwind, NAMES.sable, at(2026, 9, 22)],
  [northwind, NAMES.wren, at(2026, 10, 6)],
  [fieldnotes, NAMES.marlow, at(2026, 8, 14)],
  [fieldnotes, NAMES.atlas, at(2026, 8, 16)],
  [ledgerline, NAMES.kestrel, at(2026, 8, 25)],
  [quietHarbor, NAMES.tern, at(2026, 9, 1)],
  [quietHarbor, NAMES.atlas, at(2026, 9, 5)],
  [paperLantern, NAMES.kestrel, at(2026, 9, 2)],
  [brightwater, NAMES.sable, at(2026, 9, 19)],
  [brightwater, NAMES.juniper, at(2026, 9, 20)],
  [sparrow, NAMES.wren, at(2026, 9, 28)],
];

const MEMBERS: Record<string, DaoMember[]> = {};
const MEMBERSHIPS: Record<string, AgentMembership[]> = {};
for (const [d, name, joinedAt] of JOINS) {
  const a = agentByName(name);
  const t = TREASURIES.find((x) => x.address === d.treasury);
  if (!t) throw new Error("fixture dao without treasury");
  (MEMBERS[d.id.toString()] ??= []).push({
    agentId: a.id,
    name: a.profile.name,
    agentKey: a.agentKey,
    owner: a.owner,
    joinedAt,
    isFounder: d.founderAgentId === a.id,
  });
  (MEMBERSHIPS[a.id.toString()] ??= []).push({ dao: d, treasury: t });
}

// ---------------------------------------------------------------- credits and claims

function credit(p: {
  n: number;
  dao: Dao;
  agent: string;
  treasury: ConfigurableTreasury;
  amount: string;
  creditedAt: bigint;
  releaseTime: bigint;
  claimed?: boolean;
}): Credit {
  const orderId = numberToHex(p.n, { size: 32 });
  return {
    receiptKey: receiptKeyOf(PAYER, p.dao.id, orderId),
    orderId,
    daoId: p.dao.id,
    daoName: p.dao.metadata.name,
    agentIds: [agentByName(p.agent).id],
    agentNames: [p.agent],
    treasury: p.treasury.address,
    treasuryName: p.treasury.metadata.name,
    holdPeriod: p.treasury.config.holdPeriod,
    amount: parseEther(p.amount),
    creditedAt: p.creditedAt,
    releaseTime: p.releaseTime,
    claimed: p.claimed ?? false,
  };
}

const CREDITS: Credit[] = [
  credit({ n: 988, dao: quietHarbor, agent: NAMES.atlas, treasury: leanGuild, amount: "0.124", creditedAt: 1790856000n, releaseTime: 1792065600n }),
  credit({ n: 1017, dao: brightwater, agent: NAMES.juniper, treasury: commonwealth, amount: "0.135", creditedAt: 1791547200n, releaseTime: 1792152000n }),
  credit({ n: 1042, dao: fieldnotes, agent: NAMES.atlas, treasury: commonwealth, amount: "0.153", creditedAt: 1791806400n, releaseTime: 1792411200n }),
  credit({ n: 1101, dao: fieldnotes, agent: NAMES.atlas, treasury: commonwealth, amount: "0.153", creditedAt: 1792159200n, releaseTime: 1792764000n }),
  credit({ n: 1110, dao: quietHarbor, agent: NAMES.atlas, treasury: leanGuild, amount: "0.134", creditedAt: 1792184400n, releaseTime: 1793394000n }),
];

const CLAIMS: ClaimRecord[] = [
  { txHash: H("0x3c9e…"), at: at(2026, 10, 1), creditCount: 5, amount: parseEther("0.871") },
  { txHash: H("0x81a0…"), at: at(2026, 9, 12), creditCount: 4, amount: parseEther("0.640") },
  { txHash: H("0xf27b…"), at: at(2026, 8, 25), creditCount: 3, amount: parseEther("0.389") },
];

export const DEFAULT_FIXTURES: FixtureSet = {
  treasuries: TREASURIES,
  accounting: ACCOUNTING,
  spends: SPENDS,
  daos: DAOS,
  members: MEMBERS,
  agents: AGENTS,
  memberships: MEMBERSHIPS,
  credits: CREDITS,
  claims: CLAIMS,
  agentMetadataByUri: AGENT_METADATA_BY_URI,
};

// ---------------------------------------------------------------- edge cases (opt-in, never in DEFAULT_FIXTURES)

function edgeTreasury(name: string, short: string, over: Partial<TreasuryConfig>, seatsUsed = 0): ConfigurableTreasury {
  return treasury({
    name,
    description: `Edge case: ${name}.`,
    short,
    founder: FOUNDER,
    feeBps: over.feeBps ?? 500,
    expenseBps: over.expenseBps ?? 300,
    holdDays: 7,
    maxAgents: over.maxAgents ?? 500,
    splitRule: DEPLOYMENTS.equalSplit,
    seatsUsed,
    daoCount: 0,
    volume: "0",
    deployedAt: at(2026, 10, 1),
  });
}
function withHold(t: ConfigurableTreasury, holdPeriod: number): ConfigurableTreasury {
  return { ...t, config: { ...t.config, holdPeriod } };
}

const fullTreasury = edgeTreasury("Full House", "0xf011…5ea7", { maxAgents: 1000 }, 1000);

const external: ExternalTreasury = {
  kind: "external",
  address: A("0xe7a1…0d9c"),
  deployedAt: at(2026, 10, 2),
  seatsUsed: 0,
  daoCount: 0,
  volume: 0n,
  metadata: { name: treasuryFallbackName(A("0xe7a1…0d9c")), description: "" },
};

const edgeCredit = (n: number, hold: number, creditedAt: bigint, releaseTime: bigint): Credit => ({
  ...credit({ n, dao: fieldnotes, agent: NAMES.atlas, treasury: commonwealth, amount: "0.100", creditedAt, releaseTime }),
  holdPeriod: hold,
});

export const EDGE_FIXTURES: {
  fullFee: Treasury;
  holdZero: Treasury;
  hugeHold: Treasury;
  fullTreasury: Treasury;
  external: ExternalTreasury;
  neverReleaseCredit: Credit;
  holdZeroCredit: Credit;
  fullTreasuryDao: Dao;
} = {
  fullFee: edgeTreasury("Full Fee", "0xfee5…0a0a", { feeBps: 5000, expenseBps: 5000 }),
  holdZero: withHold(edgeTreasury("Hold Zero", "0x0017…d001", {}), 0),
  hugeHold: withHold(edgeTreasury("Huge Hold", "0xb1c6…4e10", {}), 4294967295),
  fullTreasury,
  external,
  neverReleaseCredit: edgeCredit(9001, 4294967295, 1792000000n, 2n ** 64n - 1n),
  holdZeroCredit: edgeCredit(9002, 0, 1792500000n, 1792500000n),
  fullTreasuryDao: {
    id: 900n,
    address: A("0xda09…f011"),
    metadataURI: encodeDaoMetadata({ name: "Packed House", description: "A DAO under a treasury with no seats left." }),
    metadata: { name: "Packed House", description: "A DAO under a treasury with no seats left." },
    founder: FOUNDER,
    founderAgentId: 1n,
    treasury: fullTreasury.address,
    createdAt: at(2026, 10, 3),
    memberCount: 1,
    volume: 0n,
  },
};
