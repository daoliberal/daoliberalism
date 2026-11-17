import { encodeAbiParameters, isAddress, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { DEPLOYMENTS, splitKindOf } from "@/data/deployments";
import { MOCK_NOW, mockNow } from "@/data/mock/clock";
import { DEFAULT_FIXTURES, EDGE_FIXTURES, PAYER, PERSONAS } from "@/data/mock/fixtures";
import { createMockDataSource } from "@/data/mock/MockDataSource";
import { decodeTreasuryMetadata, encodeDaoMetadata, encodeTreasuryMetadata } from "@/data/metadata";
import {
  ActionError,
  isConfigurable,
  type ActionErrorCode,
  type Address,
  type ConfigurableTreasury,
  type Hex,
  type Treasury,
} from "@/data/types";
import { formatShortDate, holdProgressPct } from "@/lib/time";
import { shortAddress } from "@/lib/format";
import { splitPayment } from "@/lib/money";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const { owner, founder } = PERSONAS;

function make(opts: Parameters<typeof createMockDataSource>[0] = {}) {
  return createMockDataSource({ now: mockNow, ...opts });
}

async function treasuryByName(ds: ReturnType<typeof make>, name: string): Promise<ConfigurableTreasury> {
  const t = (await ds.listTreasuries()).find((x) => x.metadata.name === name);
  if (!t || !isConfigurable(t)) throw new Error(`no configurable treasury ${name}`);
  return t;
}
async function daoId(ds: ReturnType<typeof make>, name: string): Promise<bigint> {
  const d = (await ds.listDaos()).find((x) => x.metadata.name === name);
  if (!d) throw new Error(`no dao ${name}`);
  return d.id;
}
async function agentId(ds: ReturnType<typeof make>, name: string): Promise<bigint> {
  const nw = await ds.listDaos().then((ds2) => ds2.find((d) => d.metadata.name === "Northwind Studio")!);
  const owners = [owner, founder, ...(await ds.listDaoMembers(nw.id)).map((m) => m.owner)];
  const all = (await Promise.all(owners.map((o) => ds.listAgentsOf(o)))).flat();
  const a = all.find((x) => x.profile.name === name);
  if (!a) throw new Error(`no agent ${name}`);
  return a.id;
}
async function codeOf(p: Promise<unknown>): Promise<ActionErrorCode> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ActionError) return e.code;
    throw e;
  }
  throw new Error("expected ActionError, got success");
}
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const eth = (n: number, decimals = 3) => BigInt(Math.round(n * 10 ** decimals)) * 10n ** BigInt(18 - decimals);

describe("clock", () => {
  it("is the fixed mock time", () => {
    expect(MOCK_NOW).toBe(1792576800n);
    expect(mockNow()).toBe(MOCK_NOW);
    expect(new Date(Number(MOCK_NOW) * 1000).toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });
});

describe("fixtures: treasuries", () => {
  it("lists exactly the 4 prototype treasuries with names", async () => {
    const ds = make();
    const ts = await ds.listTreasuries();
    expect(ts).toHaveLength(4);
    expect(ts.map((t) => t.metadata.name).sort()).toEqual(["Commonwealth", "Lean Guild", "Meritline", "Open Field"]);
    for (const t of ts) expect(t.metadata.name).not.toBe("");
  });

  it("Commonwealth matches the prototype", async () => {
    const ds = make();
    const t = await treasuryByName(ds, "Commonwealth");
    expect(t.config).toEqual({
      feeBps: 500, expenseBps: 300, holdPeriod: 604800, maxAgents: 500, splitRule: DEPLOYMENTS.equalSplit,
    });
    expect(t.seatsUsed).toBe(142);
    expect(t.daoCount).toBe(18);
    expect(t.volume).toBe(412_600_000_000_000_000_000n);
    expect(splitKindOf(t.config.splitRule)).toBe("equal");
    expect(t.founder).toBe(founder);
    expect(shortAddress(t.address)).toBe("0x4f2a…91c0");
    expect(shortAddress(t.founder)).toBe("0x3b02…7E21");
    expect(t.metadata.description).toBe(
      "A general-purpose model: a modest fee, a one-week hold, and everyone in a DAO shares equally.",
    );
    expect(formatShortDate(t.deployedAt)).toBe("4 Aug");
  });

  it("the other three match the prototype numbers", async () => {
    const ds = make();
    const rows: [string, number, number, number, number, number, number, bigint, "equal" | "custom", string][] = [
      ["Lean Guild", 100, 0, 14, 37, 100, 6, 58_250_000_000_000_000_000n, "equal", "0x8c11…02ab"],
      ["Meritline", 800, 400, 3, 980, 1000, 41, 1_204_100_000_000_000_000_000n, "custom", "0x19be…44d7"],
      ["Open Field", 200, 200, 30, 12, 250, 3, 9_800_000_000_000_000_000n, "equal", "0xd05e…7f3a"],
    ];
    for (const [name, fee, exp, days, used, max, daos, vol, kind, short] of rows) {
      const t = await treasuryByName(ds, name);
      expect(t.config.feeBps).toBe(fee);
      expect(t.config.expenseBps).toBe(exp);
      expect(t.config.holdPeriod).toBe(days * 86400);
      expect(t.seatsUsed).toBe(used);
      expect(t.config.maxAgents).toBe(max);
      expect(t.daoCount).toBe(daos);
      expect(t.volume).toBe(vol);
      expect(splitKindOf(t.config.splitRule)).toBe(kind);
      expect(shortAddress(t.address)).toBe(short);
    }
    const merit = await treasuryByName(ds, "Meritline");
    expect(shortAddress(merit.config.splitRule)).toBe("0x7a3d…e914");
    expect(shortAddress(DEPLOYMENTS.equalSplit)).toBe("0x2e0b…c4d1");
    for (const n of ["Commonwealth", "Lean Guild", "Open Field"]) {
      expect((await treasuryByName(ds, n)).config.splitRule).toBe(DEPLOYMENTS.equalSplit);
    }
  });

  it("every treasury metadataURI is a data: URI that decodes to its metadata", async () => {
    const ds = make();
    for (const t of await ds.listTreasuries()) {
      if (!isConfigurable(t)) continue;
      expect(t.metadataURI.startsWith("data:application/json;base64,")).toBe(true);
      const d = decodeTreasuryMetadata(t.metadataURI);
      expect(d.ok && d.value).toEqual(t.metadata);
    }
  });

  it("getTreasury finds by address and returns null when unknown", async () => {
    const ds = make();
    const t = await treasuryByName(ds, "Lean Guild");
    expect((await ds.getTreasury(t.address))?.address).toBe(t.address);
    expect(await ds.getTreasury(ZERO)).toBeNull();
  });
});

describe("fixtures: accounting and spends", () => {
  it("Commonwealth accounting reconciles", async () => {
    const ds = make();
    const t = await treasuryByName(ds, "Commonwealth");
    const a = await ds.getTreasuryAccounting(t.address);
    expect(a.collectedFees).toBe(20_630_000_000_000_000_000n);
    expect(a.collectedExpenses).toBe(12_378_000_000_000_000_000n);
    expect(a.spent).toBe(9_600_000_000_000_000_000n);
    expect(a.balance).toBe(a.collectedFees + a.collectedExpenses - a.spent);
    expect(a.balance).toBe(23_408_000_000_000_000_000n);
    const sp = await ds.listSpends(t.address);
    expect(sp).toHaveLength(4);
    expect(sum(sp.map((s) => s.amount))).toBe(a.spent);
    expect(sp.map((s) => s.amount)).toEqual([eth(2.5), eth(4), eth(1.6), eth(1.5)]);
    expect(sp.map((s) => shortAddress(s.to))).toEqual(["0x7e19…b2c0", "0x0f44…19de", "0x7e19…b2c0", "0xab33…7c21"]);
    for (let i = 1; i < sp.length; i++) expect(sp[i - 1]!.at > sp[i]!.at).toBe(true);
  });

  it("every default treasury reconciles", async () => {
    const ds = make();
    for (const t of await ds.listTreasuries()) {
      const a = await ds.getTreasuryAccounting(t.address);
      const sp = await ds.listSpends(t.address);
      expect(a.balance).toBe(a.collectedFees + a.collectedExpenses - a.spent);
      expect(sum(sp.map((s) => s.amount))).toBe(a.spent);
      if (isConfigurable(t)) {
        // collected fees are what the contract rounding yields for the treasury's volume
        const r = splitPayment(t.volume, t.config.feeBps, t.config.expenseBps, 1);
        if (!r.ok) throw new Error("split failed");
        expect(a.collectedFees).toBe(r.treasuryFee);
        expect(a.collectedExpenses).toBe(r.expenseFee);
      }
    }
  });
});

describe("fixtures: daos, agents, credits, claims", () => {
  it("7 daos with fixture daoCount unchanged", async () => {
    const ds = make();
    const daos = await ds.listDaos();
    expect(daos.map((d) => d.metadata.name).sort()).toEqual([
      "Brightwater Research", "Fieldnotes Co-op", "Ledgerline Labs", "Northwind Studio", "Paper Lantern Translation", "Quiet Harbor",
      "Sparrow Data",
    ]);
    const cw = await treasuryByName(ds, "Commonwealth");
    expect((await ds.listDaos({ treasury: cw.address })).map((d) => d.metadata.name)).toEqual([
      "Northwind Studio", "Fieldnotes Co-op", "Paper Lantern Translation", "Brightwater Research",
    ]);
    const pl = (await ds.getDao(await daoId(ds, "Paper Lantern Translation")))!;
    expect([pl.memberCount, pl.volume, formatShortDate(pl.createdAt)]).toEqual([4, 38_020_000_000_000_000_000n, "2 Sep"]);
    expect(cw.daoCount).toBe(18);
    const nw = (await ds.getDao(await daoId(ds, "Northwind Studio")))!;
    expect(nw.memberCount).toBe(6);
    expect(nw.volume).toBe(96_400_000_000_000_000_000n);
    expect(nw.metadata.description).toBe("Product and brand copy, drafted and reviewed by agents.");
    expect(shortAddress(nw.address)).toBe("0x61f0…aa32");
    expect(nw.founder).toBe(founder);
    expect(formatShortDate(nw.createdAt)).toBe("9 Aug");
    expect(await ds.getDao(9999n)).toBeNull();
  });

  it("Northwind members match the prototype", async () => {
    const ds = make();
    const ms = await ds.listDaoMembers(await daoId(ds, "Northwind Studio"));
    expect(ms.map((m) => m.name)).toEqual(["Quill‑2", "Marlow", "Kestrel", "Tern", "Sable‑3", "Wren"]);
    expect(ms.filter((m) => m.isFounder).map((m) => m.name)).toEqual(["Quill‑2"]);
    expect(ms.map((m) => shortAddress(m.agentKey))).toEqual([
      "0x88a1…4c10", "0x1f7c…aa09", "0x4b20…7d3e", "0x9c05…31b8", "0xd1aa…8e62", "0x6e48…0c9f",
    ]);
    expect(ms.map((m) => shortAddress(m.owner))).toEqual([
      "0x3b02…7E21", "0xe6d2…0B44", "0x77fa…c1D9", "0x2a6e…f0A1", "0x5f13…7b2E", "0xb8c0…44d3",
    ]);
    expect(ms.map((m) => formatShortDate(m.joinedAt))).toEqual(["9 Aug", "11 Aug", "20 Aug", "3 Sep", "22 Sep", "6 Oct"]);
  });

  it("owner has Atlas‑7, Juniper, Ox‑Relay with memberships", async () => {
    const ds = make();
    const as = await ds.listAgentsOf(owner);
    expect(as.map((a) => a.profile.name)).toEqual(["Atlas‑7", "Juniper", "Ox‑Relay"]);
    expect(as.map((a) => a.agentKey)).toEqual([
      "0x5d3e8a0c71f2b94e0d6a3c55e1b7f4a2c09e19A0",
      "0xc2e84b17d0aa63f9e2c815b07de4a9136c1d5f01",
      "0x0b97f3d21c84a5e60b17d93ac2f4e8b15a6be2C4",
    ]);
    expect(as.map((a) => a.metadataURI)).toEqual([
      "ipfs://bafy…atlas7.json", "https://juniper.example/agent.json", "ipfs://bafy…oxrelay.json",
    ]);
    expect(as.every((a) => a.owner === owner)).toBe(true);
    const counts = await Promise.all(as.map(async (a) => (await ds.listMembershipsOf(a.id)).length));
    expect(counts).toEqual([2, 1, 0]);
    const atlas = await ds.listMembershipsOf(as[0]!.id);
    expect(atlas.map((m) => m.dao.metadata.name).sort()).toEqual(["Fieldnotes Co-op", "Quiet Harbor"]);
    expect(atlas.map((m) => m.treasury.metadata.name).sort()).toEqual(["Commonwealth", "Lean Guild"]);
  });

  it("5 credits for the owner with prototype amounts and sums", async () => {
    const ds = make();
    const cs = await ds.listCredits(owner);
    expect(cs).toHaveLength(5);
    expect(cs.map((c) => c.amount)).toEqual([eth(0.124), eth(0.135), eth(0.153), eth(0.153), eth(0.134)]);
    const ready = cs.filter((c) => c.releaseTime <= MOCK_NOW);
    const waiting = cs.filter((c) => c.releaseTime > MOCK_NOW);
    expect(ready).toHaveLength(3);
    expect(sum(ready.map((c) => c.amount))).toBe(412_000_000_000_000_000n);
    expect(sum(waiting.map((c) => c.amount))).toBe(287_000_000_000_000_000n);
    expect(cs.every((c) => !c.claimed)).toBe(true);
    expect(await ds.listCredits(founder)).toEqual([]);
  });

  it("credit times are the pinned constants and progress matches", async () => {
    const ds = make();
    const cs = await ds.listCredits(owner);
    expect(cs.map((c) => [c.creditedAt, c.releaseTime])).toEqual([
      [1790856000n, 1792065600n],
      [1791547200n, 1792152000n],
      [1791806400n, 1792411200n],
      [1792159200n, 1792764000n],
      [1792184400n, 1793394000n],
    ]);
    expect(cs.map((c) => formatShortDate(c.creditedAt))).toEqual(["1 Oct", "9 Oct", "12 Oct", "16 Oct", "16 Oct"]);
    expect(holdProgressPct(cs[3]!.creditedAt, cs[3]!.releaseTime, MOCK_NOW)).toBe(69);
    expect(holdProgressPct(cs[4]!.creditedAt, cs[4]!.releaseTime, MOCK_NOW)).toBe(32);
    expect(cs.map((c) => c.holdPeriod)).toEqual([14, 7, 7, 7, 14].map((d) => d * 86400));
    expect(cs.map((c) => c.daoName)).toEqual([
      "Quiet Harbor", "Brightwater Research", "Fieldnotes Co-op", "Fieldnotes Co-op", "Quiet Harbor",
    ]);
    expect(cs.map((c) => c.treasuryName)).toEqual(["Lean Guild", "Commonwealth", "Commonwealth", "Commonwealth", "Lean Guild"]);
    expect(cs.map((c) => c.agentNames)).toEqual([["Atlas‑7"], ["Juniper"], ["Atlas‑7"], ["Atlas‑7"], ["Atlas‑7"]]);
  });

  it("3 claim records totalling 1.9 ETH", async () => {
    const ds = make();
    const cl = await ds.listClaims(owner);
    expect(cl).toHaveLength(3);
    expect(sum(cl.map((c) => c.amount))).toBe(1_900_000_000_000_000_000n);
    expect(cl.map((c) => [c.creditCount, c.amount])).toEqual([[5, eth(0.871)], [4, eth(0.64)], [3, eth(0.389)]]);
    expect(await ds.listClaims(founder)).toEqual([]);
  });

  it("receipt keys follow keccak256(abi.encode(payer, daoId, orderId))", () => {
    for (const c of DEFAULT_FIXTURES.credits) {
      expect(c.receiptKey).toBe(
        keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes32" }], [PAYER, c.daoId, c.orderId])),
      );
    }
    expect(new Set(DEFAULT_FIXTURES.credits.map((c) => c.receiptKey)).size).toBe(5);
  });

  it("fixture addresses are 42 chars and keep prototype letter case", () => {
    const all: Address[] = [owner, founder];
    expect(owner.slice(0, 6) + "…" + owner.slice(-4)).toBe("0x91c4…a4F2");
    expect(founder.slice(0, 6) + "…" + founder.slice(-4)).toBe("0x3b02…7E21");
    for (const t of DEFAULT_FIXTURES.treasuries) all.push(t.address);
    for (const d of DEFAULT_FIXTURES.daos) all.push(d.address, d.founder);
    for (const a of DEFAULT_FIXTURES.agents) all.push(a.owner, a.agentKey);
    for (const a of all) {
      expect(a).toHaveLength(42);
      expect(isAddress(a, { strict: false })).toBe(true);
    }
    expect(DEFAULT_FIXTURES.treasuries).toHaveLength(4);
    expect(DEFAULT_FIXTURES.credits).toHaveLength(5);
  });
});

describe("execute: joinDao", () => {
  it("adds the member, bumps counts and seats", async () => {
    const ds = make();
    const nw = await daoId(ds, "Northwind Studio");
    const atlas = await agentId(ds, "Atlas‑7");
    const before = await treasuryByName(ds, "Commonwealth");
    const res = await ds.execute({ kind: "joinDao", daoId: nw, agentId: atlas }, owner);
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const ms = await ds.listDaoMembers(nw);
    expect(ms).toHaveLength(7);
    expect(ms[6]!.name).toBe("Atlas‑7");
    expect(ms[6]!.joinedAt).toBe(MOCK_NOW);
    expect(ms[6]!.isFounder).toBe(false);
    expect((await ds.getDao(nw))!.memberCount).toBe(7);
    expect((await treasuryByName(ds, "Commonwealth")).seatsUsed).toBe(before.seatsUsed + 1);
    expect((await treasuryByName(ds, "Commonwealth")).seatsUsed).toBe(143);
    expect((await ds.listMembershipsOf(atlas)).map((m) => m.dao.metadata.name)).toContain("Northwind Studio");
    expect((await ds.listMembershipsOf(atlas)).find((m) => m.dao.id === nw)!.dao.memberCount).toBe(7);
  });

  it("rejects joining twice, foreign agents, unknown agents", async () => {
    const ds = make();
    const nw = await daoId(ds, "Northwind Studio");
    const atlas = await agentId(ds, "Atlas‑7");
    await ds.execute({ kind: "joinDao", daoId: nw, agentId: atlas }, owner);
    expect(await codeOf(ds.execute({ kind: "joinDao", daoId: nw, agentId: atlas }, owner))).toBe("AlreadyMember");
    const marlow = await agentId(ds, "Marlow");
    expect(await codeOf(ds.execute({ kind: "joinDao", daoId: nw, agentId: marlow }, owner))).toBe("NotAgentOwner");
    expect(await codeOf(ds.execute({ kind: "joinDao", daoId: nw, agentId: 9999n }, owner))).toBe("AgentNotFound");
    expect((await ds.getDao(nw))!.memberCount).toBe(7);
  });

  it("an agent already a member through its fixture membership is AlreadyMember", async () => {
    const ds = make();
    const atlas = await agentId(ds, "Atlas‑7");
    const fieldnotes = await daoId(ds, "Fieldnotes Co-op");
    expect(await codeOf(ds.execute({ kind: "joinDao", daoId: fieldnotes, agentId: atlas }, owner))).toBe("AlreadyMember");
  });

  it("a full treasury gives AdmissionDenied and changes nothing", async () => {
    const ds = make({
      fixtures: {
        treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.fullTreasury],
        daos: [...DEFAULT_FIXTURES.daos, EDGE_FIXTURES.fullTreasuryDao],
      },
    });
    const ox = await agentId(ds, "Ox‑Relay");
    const id = EDGE_FIXTURES.fullTreasuryDao.id;
    expect(EDGE_FIXTURES.fullTreasuryDao.treasury).toBe(EDGE_FIXTURES.fullTreasury.address);
    const membersBefore = await ds.listDaoMembers(id);
    expect(await codeOf(ds.execute({ kind: "joinDao", daoId: id, agentId: ox }, owner))).toBe("AdmissionDenied");
    expect((await ds.getTreasury(EDGE_FIXTURES.fullTreasury.address))!.seatsUsed).toBe(1000);
    expect((await ds.getDao(id))!.memberCount).toBe(EDGE_FIXTURES.fullTreasuryDao.memberCount);
    expect(await ds.listDaoMembers(id)).toEqual(membersBefore);
  });

  it("a DAO at 100 members gives MemberCapReached", async () => {
    const fullDao = { ...DEFAULT_FIXTURES.daos[0]!, memberCount: 100 };
    const ds = make({ fixtures: { daos: [fullDao, ...DEFAULT_FIXTURES.daos.slice(1)] } });
    const ox = await agentId(ds, "Ox‑Relay");
    expect(await codeOf(ds.execute({ kind: "joinDao", daoId: fullDao.id, agentId: ox }, owner))).toBe("MemberCapReached");
  });

  it("joinDao on an unknown DAO is Unknown and changes nothing", async () => {
    const ds = make();
    const ox = await agentId(ds, "Ox‑Relay");
    expect(await codeOf(ds.execute({ kind: "joinDao", daoId: 4242n, agentId: ox }, owner))).toBe("Unknown");
    expect(await ds.listDaos()).toHaveLength(7);
    expect(await ds.listMembershipsOf(ox)).toEqual([]);
  });
});

describe("execute: createDao", () => {
  it("creates a DAO with the founder agent as first member", async () => {
    const ds = make();
    const lean = await treasuryByName(ds, "Lean Guild");
    const ox = await agentId(ds, "Ox‑Relay");
    const uri = encodeDaoMetadata({ name: "Coral Desk", description: "Desk work.", website: "https://coral.example" });
    const res = await ds.execute({ kind: "createDao", metadataURI: uri, founderAgentId: ox, treasury: lean.address }, owner);
    const id = res.created?.daoId;
    expect(id).toBeDefined();
    const dao = (await ds.getDao(id!))!;
    expect(dao.metadata).toEqual({ name: "Coral Desk", description: "Desk work.", website: "https://coral.example" });
    expect(dao.founder).toBe(owner);
    expect(dao.founderAgentId).toBe(ox);
    expect(dao.treasury).toBe(lean.address);
    expect(dao.memberCount).toBe(1);
    expect(dao.createdAt).toBe(MOCK_NOW);
    const ms = await ds.listDaoMembers(id!);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ agentId: ox, name: "Ox‑Relay", isFounder: true, owner });
    expect((await treasuryByName(ds, "Lean Guild")).seatsUsed).toBe(lean.seatsUsed + 1);
    expect((await ds.listDaos()).some((d) => d.id === id)).toBe(true);
    expect((await ds.listMembershipsOf(ox)).map((m) => m.dao.id)).toEqual([id]);
    const ids = (await ds.listDaos()).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("unregistered treasury, foreign agent, unknown agent", async () => {
    const ds = make();
    const ox = await agentId(ds, "Ox‑Relay");
    const uri = encodeDaoMetadata({ name: "X", description: "" });
    expect(await codeOf(ds.execute({ kind: "createDao", metadataURI: uri, founderAgentId: ox, treasury: ZERO }, owner))).toBe(
      "TreasuryNotRegistered",
    );
    const lean = await treasuryByName(ds, "Lean Guild");
    const marlow = await agentId(ds, "Marlow");
    expect(
      await codeOf(ds.execute({ kind: "createDao", metadataURI: uri, founderAgentId: marlow, treasury: lean.address }, owner)),
    ).toBe("NotAgentOwner");
    expect(
      await codeOf(ds.execute({ kind: "createDao", metadataURI: uri, founderAgentId: 9999n, treasury: lean.address }, owner)),
    ).toBe("AgentNotFound");
  });

  it("an unresolvable DAO metadataURI falls back to DAO #<id>", async () => {
    const ds = make();
    const lean = await treasuryByName(ds, "Lean Guild");
    const ox = await agentId(ds, "Ox‑Relay");
    const res = await ds.execute(
      { kind: "createDao", metadataURI: "https://nowhere.example/x.json", founderAgentId: ox, treasury: lean.address },
      owner,
    );
    const dao = (await ds.getDao(res.created!.daoId!))!;
    expect(dao.metadata).toEqual({ name: `DAO #${res.created!.daoId!}`, description: "" });
  });
});

describe("execute: createDao under a full treasury", () => {
  it("is AdmissionDenied; no DAO, no seat, daoCount unchanged", async () => {
    const ds = make({ fixtures: { treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.fullTreasury] } });
    const ox = await agentId(ds, "Ox‑Relay");
    const uri = encodeDaoMetadata({ name: "Late", description: "" });
    const before = EDGE_FIXTURES.fullTreasury;
    expect(
      await codeOf(ds.execute({ kind: "createDao", metadataURI: uri, founderAgentId: ox, treasury: before.address }, owner)),
    ).toBe("AdmissionDenied");
    expect(await ds.listDaos()).toHaveLength(7);
    const t = (await ds.getTreasury(before.address))!;
    expect([t.seatsUsed, t.daoCount]).toEqual([1000, before.daoCount]);
    expect(await ds.listMembershipsOf(ox)).toEqual([]);
  });
});

describe("execute: agents", () => {
  it("registerAgent returns a new id and resolves a data: profile", async () => {
    const ds = make();
    const before = (await ds.listAgentsOf(owner)).length;
    const key = "0x1111111111111111111111111111111111111111" as Address;
    const uri =
      "data:application/json;base64," + btoa(JSON.stringify({ name: "Newcomer", description: "hi" }));
    const res = await ds.execute({ kind: "registerAgent", agentKey: key, metadataURI: uri }, owner);
    const id = res.created!.agentId!;
    const as = await ds.listAgentsOf(owner);
    expect(as).toHaveLength(before + 1);
    const a = as.find((x) => x.id === id)!;
    expect(a).toMatchObject({ owner, agentKey: key, metadataURI: uri, registeredAt: MOCK_NOW });
    expect(a.profile.name).toBe("Newcomer");
    const all = [...as, ...(await ds.listAgentsOf(founder))].map((x) => x.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("an unresolvable metadata URL falls back to Agent #<id>", async () => {
    const ds = make();
    const key = "0x2222222222222222222222222222222222222222" as Address;
    const res = await ds.execute({ kind: "registerAgent", agentKey: key, metadataURI: "https://unknown.example/a.json" }, owner);
    const a = (await ds.listAgentsOf(owner)).find((x) => x.id === res.created!.agentId)!;
    expect(a.profile).toEqual({ name: `Agent #${res.created!.agentId!}` });
  });

  it("updateAgent changes only the provided fields", async () => {
    const ds = make();
    const juniper = await agentId(ds, "Juniper");
    const before = (await ds.listAgentsOf(owner)).find((a) => a.id === juniper)!;
    const newKey = "0x3333333333333333333333333333333333333333" as Address;
    await ds.execute({ kind: "updateAgent", agentId: juniper, agentKey: newKey }, owner);
    const afterKey = (await ds.listAgentsOf(owner)).find((a) => a.id === juniper)!;
    expect(afterKey.agentKey).toBe(newKey);
    expect(afterKey.metadataURI).toBe(before.metadataURI);
    expect(afterKey.profile).toEqual(before.profile);
    const uri = "data:application/json;base64," + btoa(JSON.stringify({ name: "Juniper II" }));
    await ds.execute({ kind: "updateAgent", agentId: juniper, metadataURI: uri }, owner);
    const afterUri = (await ds.listAgentsOf(owner)).find((a) => a.id === juniper)!;
    expect(afterUri.agentKey).toBe(newKey);
    expect(afterUri.metadataURI).toBe(uri);
    expect(afterUri.profile.name).toBe("Juniper II");
  });

  it("DAO member names follow the agent's current profile after a rename (M3)", async () => {
    const ds = make();
    const juniper = await agentId(ds, "Juniper");
    const [first] = await ds.listMembershipsOf(juniper);
    expect(first).toBeDefined();
    const uri = "data:application/json;base64," + btoa(JSON.stringify({ name: "Juniper II" }));
    await ds.execute({ kind: "updateAgent", agentId: juniper, metadataURI: uri }, owner);
    const members = await ds.listDaoMembers(first!.dao.id);
    expect(members.find((m) => m.agentId === juniper)?.name).toBe("Juniper II");
  });

  it("updateAgent checks ownership and existence", async () => {
    const ds = make();
    const marlow = await agentId(ds, "Marlow");
    expect(await codeOf(ds.execute({ kind: "updateAgent", agentId: marlow, agentKey: ZERO }, owner))).toBe("NotAgentOwner");
    expect(await codeOf(ds.execute({ kind: "updateAgent", agentId: 9999n, agentKey: ZERO }, owner))).toBe("AgentNotFound");
  });
});

describe("execute: deployTreasury", () => {
  const cfg = {
    feeBps: 300, expenseBps: 200, holdPeriod: 14 * 86400, maxAgents: 50, splitRule: DEPLOYMENTS.equalSplit,
  };

  it("is a single call that deploys and registers", async () => {
    const ds = make();
    const uri = encodeTreasuryMetadata({ name: "Tidewater", description: "Low overhead, two-week hold." });
    const res = await ds.execute({ kind: "deployTreasury", config: cfg, metadataURI: uri }, founder);
    const addr = res.created!.treasury!;
    const ts = await ds.listTreasuries();
    expect(ts).toHaveLength(5);
    const t = (await ds.getTreasury(addr))!;
    expect(isConfigurable(t)).toBe(true);
    if (!isConfigurable(t)) return;
    expect(t.founder).toBe(founder);
    expect(t.seatsUsed).toBe(0);
    expect(t.daoCount).toBe(0);
    expect(t.volume).toBe(0n);
    expect(t.config).toEqual(cfg);
    expect(splitKindOf(t.config.splitRule)).toBe("equal");
    expect(t.metadata).toEqual({ name: "Tidewater", description: "Low overhead, two-week hold." });
    expect(t.metadataURI).toBe(uri);
    expect(t.deployedAt).toBe(MOCK_NOW);
    expect(await ds.getTreasuryAccounting(addr)).toEqual({ balance: 0n, collectedFees: 0n, collectedExpenses: 0n, spent: 0n });
    expect(await ds.listSpends(addr)).toEqual([]);
    // registered at once: createDao under it does not hit TreasuryNotRegistered
    const ox = await agentId(ds, "Ox‑Relay");
    const r2 = await ds.execute(
      { kind: "createDao", metadataURI: encodeDaoMetadata({ name: "D", description: "" }), founderAgentId: ox, treasury: addr },
      owner,
    );
    expect(r2.created?.daoId).toBeDefined();
  });

  it("custom split rule is classified custom", async () => {
    const ds = make();
    const merit = await treasuryByName(ds, "Meritline");
    const res = await ds.execute(
      { kind: "deployTreasury", config: { ...cfg, splitRule: merit.config.splitRule }, metadataURI: encodeTreasuryMetadata({ name: "C", description: "" }) },
      founder,
    );
    const t = (await ds.getTreasury(res.created!.treasury!)) as ConfigurableTreasury;
    expect(splitKindOf(t.config.splitRule)).toBe("custom");
  });

  it("an unresolvable metadataURI still deploys with a short-address name", async () => {
    const ds = make();
    const res = await ds.execute({ kind: "deployTreasury", config: cfg, metadataURI: "ipfs://unknown" }, founder);
    const t = (await ds.getTreasury(res.created!.treasury!))!;
    expect(t.metadata).toEqual({ name: `Treasury ${shortAddress(t.address)}`, description: "" });
  });

  it("BpsTooHigh when fee + expenses exceed 100%, 100% exactly is fine", async () => {
    const ds = make();
    const uri = encodeTreasuryMetadata({ name: "T", description: "" });
    expect(await codeOf(ds.execute({ kind: "deployTreasury", config: { ...cfg, feeBps: 5001, expenseBps: 5000 }, metadataURI: uri }, founder))).toBe("BpsTooHigh");
    expect(await codeOf(ds.execute({ kind: "deployTreasury", config: { ...cfg, feeBps: 6000, expenseBps: 6000 }, metadataURI: uri }, founder))).toBe("BpsTooHigh");
    await ds.execute({ kind: "deployTreasury", config: { ...cfg, feeBps: 5000, expenseBps: 5000 }, metadataURI: uri }, founder);
    expect(await ds.listTreasuries()).toHaveLength(5);
  });

  it("InvalidSplitRule for the zero address, and nothing is deployed", async () => {
    const ds = make();
    const uri = encodeTreasuryMetadata({ name: "T", description: "" });
    expect(await codeOf(ds.execute({ kind: "deployTreasury", config: { ...cfg, splitRule: ZERO }, metadataURI: uri }, founder))).toBe("InvalidSplitRule");
    expect(await ds.listTreasuries()).toHaveLength(4);
  });
});

describe("execute: claim", () => {
  async function keys(ds: ReturnType<typeof make>) {
    const cs = await ds.listCredits(owner);
    return cs.map((c) => c.receiptKey);
  }

  it("claims mature credits into one new record", async () => {
    const ds = make();
    const [k0988, k1017, k1042, k1101] = await keys(ds);
    const res = await ds.execute({ kind: "claim", receiptKeys: [k1042!, k0988!, k1017!] }, owner);
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const cs = await ds.listCredits(owner);
    expect(cs.map((c) => c.claimed)).toEqual([true, true, true, false, false]);
    const cl = await ds.listClaims(owner);
    expect(cl).toHaveLength(4);
    expect(cl[0]).toMatchObject({ amount: 412_000_000_000_000_000n, creditCount: 3, at: MOCK_NOW, txHash: res.txHash });
    expect(k1101).toBeDefined();
  });

  it("skips immature keys; nothing payable throws NothingToClaim", async () => {
    const ds = make();
    const ks = await keys(ds);
    await ds.execute({ kind: "claim", receiptKeys: [ks[2]!, ks[3]!, ks[4]!] }, owner);
    const cs = await ds.listCredits(owner);
    expect(cs.map((c) => c.claimed)).toEqual([false, false, true, false, false]);
    expect((await ds.listClaims(owner))[0]).toMatchObject({ amount: eth(0.153), creditCount: 1 });
    expect(await codeOf(ds.execute({ kind: "claim", receiptKeys: [ks[3]!, ks[4]!] }, owner))).toBe("NothingToClaim");
    expect(await codeOf(ds.execute({ kind: "claim", receiptKeys: [] }, owner))).toBe("NothingToClaim");
  });

  it("a duplicated key pays once", async () => {
    const ds = make();
    const ks = await keys(ds);
    await ds.execute({ kind: "claim", receiptKeys: [ks[0]!, ks[0]!, ks[0]!] }, owner);
    expect((await ds.listClaims(owner))[0]).toMatchObject({ amount: eth(0.124), creditCount: 1 });
  });

  it("someone else's credits are skipped", async () => {
    const ds = make();
    const ks = await keys(ds);
    expect(await codeOf(ds.execute({ kind: "claim", receiptKeys: ks }, founder))).toBe("NothingToClaim");
    expect((await ds.listCredits(owner)).every((c) => !c.claimed)).toBe(true);
  });

  it("D2: a second claim with the same receipt keys throws NothingToClaim and leaves state unchanged", async () => {
    const ds = make();
    const ks = (await keys(ds)).slice(0, 3);
    const first = await ds.execute({ kind: "claim", receiptKeys: ks }, owner);
    const credits = await ds.listCredits(owner);
    const claims = await ds.listClaims(owner);
    expect(await codeOf(ds.execute({ kind: "claim", receiptKeys: ks }, owner))).toBe("NothingToClaim");
    expect(await ds.listCredits(owner)).toEqual(credits);
    expect(await ds.listClaims(owner)).toEqual(claims);
    expect(claims[0]!.txHash).toBe(first.txHash);
  });

  it("D2: two concurrent identical claims -> exactly one succeeds, the other NothingToClaim", async () => {
    const ds = make();
    const ks = (await keys(ds)).slice(0, 3);
    const results = await Promise.allSettled([
      ds.execute({ kind: "claim", receiptKeys: ks }, owner),
      ds.execute({ kind: "claim", receiptKeys: ks }, owner),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ActionError);
    expect((rejected[0]!.reason as ActionError).code).toBe("NothingToClaim");
    expect(await ds.listClaims(owner)).toHaveLength(4);
  });

  it("works with latency enabled (state change still atomic)", async () => {
    const ds = make({ latencyMs: 5 });
    const ks = (await keys(ds)).slice(0, 3);
    const results = await Promise.allSettled([
      ds.execute({ kind: "claim", receiptKeys: ks }, owner),
      ds.execute({ kind: "claim", receiptKeys: ks }, owner),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  });
});

describe("execute: spend on external treasuries", () => {
  it("is Unknown and changes nothing", async () => {
    const ds = make({ fixtures: { treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.external] } });
    const before = await ds.getTreasuryAccounting(EDGE_FIXTURES.external.address);
    const to = "0x4444444444444444444444444444444444444444" as Address;
    expect(
      await codeOf(ds.execute({ kind: "spend", treasury: EDGE_FIXTURES.external.address, to, amount: 1n }, founder)),
    ).toBe("Unknown");
    expect(await ds.getTreasuryAccounting(EDGE_FIXTURES.external.address)).toEqual(before);
    expect(await ds.listSpends(EDGE_FIXTURES.external.address)).toEqual([]);
  });
});

describe("execute: spend", () => {
  const to = "0x4444444444444444444444444444444444444444" as Address;

  it("founder spends; balance drops; history is prepended", async () => {
    const ds = make();
    const cw = await treasuryByName(ds, "Commonwealth");
    const before = await ds.getTreasuryAccounting(cw.address);
    const res = await ds.execute({ kind: "spend", treasury: cw.address, to, amount: eth(1.5) }, founder);
    const after = await ds.getTreasuryAccounting(cw.address);
    expect(after.balance).toBe(before.balance - eth(1.5));
    expect(after.spent).toBe(before.spent + eth(1.5));
    expect(after.balance).toBe(after.collectedFees + after.collectedExpenses - after.spent);
    const sp = await ds.listSpends(cw.address);
    expect(sp).toHaveLength(5);
    expect(sp[0]).toEqual({ at: MOCK_NOW, to, amount: eth(1.5), txHash: res.txHash });
    expect(sum(sp.map((s) => s.amount))).toBe(after.spent);
  });

  it("only the founder; the whole balance is allowed; one wei more is not", async () => {
    const ds = make();
    const cw = await treasuryByName(ds, "Commonwealth");
    const bal = (await ds.getTreasuryAccounting(cw.address)).balance;
    expect(await codeOf(ds.execute({ kind: "spend", treasury: cw.address, to, amount: 1n }, owner))).toBe("NotFounder");
    expect(await codeOf(ds.execute({ kind: "spend", treasury: cw.address, to, amount: bal + 1n }, founder))).toBe("InsufficientAccrued");
    await ds.execute({ kind: "spend", treasury: cw.address, to, amount: bal }, founder);
    expect((await ds.getTreasuryAccounting(cw.address)).balance).toBe(0n);
  });

  it("ZeroAmount, ZeroAddress, unknown treasury; no state change on failure", async () => {
    const ds = make();
    const cw = await treasuryByName(ds, "Commonwealth");
    const before = await ds.getTreasuryAccounting(cw.address);
    expect(await codeOf(ds.execute({ kind: "spend", treasury: cw.address, to, amount: 0n }, founder))).toBe("ZeroAmount");
    expect(await codeOf(ds.execute({ kind: "spend", treasury: cw.address, to: ZERO, amount: 1n }, founder))).toBe("ZeroAddress");
    expect(await codeOf(ds.execute({ kind: "spend", treasury: ZERO, to, amount: 1n }, founder))).toBe("TreasuryNotRegistered");
    expect(await ds.getTreasuryAccounting(cw.address)).toEqual(before);
    expect(await ds.listSpends(cw.address)).toHaveLength(4);
  });
});

describe("edge fixtures are opt-in", () => {
  it("default source still has exactly 4 treasuries and 5 credits", async () => {
    const ds = make();
    expect(await ds.listTreasuries()).toHaveLength(4);
    expect(await ds.listCredits(owner)).toHaveLength(5);
  });

  it("fixtures override defaults per key", async () => {
    const ds = make({ fixtures: { treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.fullFee] } });
    const ts = await ds.listTreasuries();
    expect(ts).toHaveLength(5);
    expect((await ds.listDaos()).length).toBe(7);
    const f = (await ds.getTreasury(EDGE_FIXTURES.fullFee.address))! as ConfigurableTreasury;
    expect(f.config.feeBps + f.config.expenseBps).toBe(10000);
    expect(await ds.getTreasuryAccounting(EDGE_FIXTURES.fullFee.address)).toEqual({
      balance: 0n, collectedFees: 0n, collectedExpenses: 0n, spent: 0n,
    });
  });

  it("edge treasuries have the specified values", () => {
    const e = EDGE_FIXTURES;
    expect((e.fullFee as ConfigurableTreasury).config).toMatchObject({ feeBps: 5000, expenseBps: 5000 });
    expect((e.holdZero as ConfigurableTreasury).config.holdPeriod).toBe(0);
    expect((e.hugeHold as ConfigurableTreasury).config.holdPeriod).toBe(4294967295);
    const full = e.fullTreasury as ConfigurableTreasury;
    expect([full.seatsUsed, full.config.maxAgents]).toEqual([1000, 1000]);
    expect(e.external.kind).toBe("external");
    const addrs = [e.fullFee, e.holdZero, e.hugeHold, e.fullTreasury, e.external].map((t: Treasury) => t.address);
    expect(new Set(addrs.map((a) => a.toLowerCase())).size).toBe(5);
    for (const t of [e.fullFee, e.holdZero, e.hugeHold, e.fullTreasury]) {
      expect((t as ConfigurableTreasury).metadata.name).not.toBe("");
    }
  });

  it("edge credits: never-release lists without crashing; hold zero releases at creditedAt", async () => {
    const e = EDGE_FIXTURES;
    expect(e.neverReleaseCredit.releaseTime).toBe(2n ** 64n - 1n);
    expect(e.holdZeroCredit.holdPeriod).toBe(0);
    expect(e.holdZeroCredit.releaseTime).toBe(e.holdZeroCredit.creditedAt);
    const ds = make({ fixtures: { credits: [...DEFAULT_FIXTURES.credits, e.neverReleaseCredit, e.holdZeroCredit] } });
    const cs = await ds.listCredits(owner);
    expect(cs).toHaveLength(7);
    // never-release stays unclaimable, hold-zero is claimable at once
    expect(await codeOf(ds.execute({ kind: "claim", receiptKeys: [e.neverReleaseCredit.receiptKey] }, owner))).toBe("NothingToClaim");
    await ds.execute({ kind: "claim", receiptKeys: [e.holdZeroCredit.receiptKey] }, owner);
    expect((await ds.listCredits(owner)).find((c) => c.receiptKey === e.holdZeroCredit.receiptKey)!.claimed).toBe(true);
    // edge credit keys are distinct from the defaults
    const keySet = new Set<Hex>(cs.map((c) => c.receiptKey));
    expect(keySet.size).toBe(7);
  });

  it("the external treasury is returned with kind external", async () => {
    const ds = make({ fixtures: { treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.external] } });
    const t = await ds.getTreasury(EDGE_FIXTURES.external.address);
    expect(t?.kind).toBe("external");
    expect(await ds.listTreasuries()).toHaveLength(5);
  });
});

describe("reset", () => {
  it("restores the fixtures", async () => {
    const ds = make();
    const nw = await daoId(ds, "Northwind Studio");
    const atlas = await agentId(ds, "Atlas‑7");
    await ds.execute({ kind: "joinDao", daoId: nw, agentId: atlas }, owner);
    await ds.execute({ kind: "claim", receiptKeys: [(await ds.listCredits(owner))[0]!.receiptKey] }, owner);
    ds.reset();
    expect(await ds.listDaoMembers(nw)).toHaveLength(6);
    expect((await ds.getDao(nw))!.memberCount).toBe(6);
    expect((await treasuryByName(ds, "Commonwealth")).seatsUsed).toBe(142);
    expect(await ds.listClaims(owner)).toHaveLength(3);
    expect((await ds.listCredits(owner)).every((c) => !c.claimed)).toBe(true);
  });

  it("two sources do not share state, and DEFAULT_FIXTURES is never mutated", async () => {
    const a = make();
    const b = make();
    const nw = await daoId(a, "Northwind Studio");
    const atlas = await agentId(a, "Atlas‑7");
    await a.execute({ kind: "joinDao", daoId: nw, agentId: atlas }, owner);
    expect(await b.listDaoMembers(nw)).toHaveLength(6);
    expect(DEFAULT_FIXTURES.daos.find((d) => d.id === nw)!.memberCount).toBe(6);
    expect(DEFAULT_FIXTURES.treasuries.find((t) => t.metadata.name === "Commonwealth")!.seatsUsed).toBe(142);
  });
});
