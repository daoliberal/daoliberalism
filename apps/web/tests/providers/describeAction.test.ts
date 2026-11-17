import { describe, expect, it } from "vitest";
import { DEPLOYMENTS, splitKindOf } from "@/data/deployments";
import { buildAgentMetadata, encodeDaoMetadata, encodeTreasuryMetadata } from "@/data/metadata";
import { DEFAULT_FIXTURES, EDGE_FIXTURES, PERSONAS } from "@/data/mock/fixtures";
import { isConfigurable, type ActionRequest, type Address, type Hex, type Treasury } from "@/data/types";
import { shortAddress } from "@/lib/format";
import { describeAction, type DescribeContext } from "@/providers/describeAction";

const { owner, founder } = PERSONAS;
const treasuryNamed = (n: string): Treasury => {
  const t = DEFAULT_FIXTURES.treasuries.find((x) => x.metadata.name === n);
  if (!t) throw new Error(n);
  return t;
};
const daoNamed = (n: string) => {
  const d = DEFAULT_FIXTURES.daos.find((x) => x.metadata.name === n);
  if (!d) throw new Error(n);
  return d;
};
const commonwealth = treasuryNamed("Commonwealth");
const leanGuild = treasuryNamed("Lean Guild");
const northwind = daoNamed("Northwind Studio");
const base = { deployments: DEPLOYMENTS, signer: owner };
const SPEND_TO = "0x7e19000000000000000000000000000000b2c0" as Address;

const joinReq: ActionRequest = { kind: "joinDao", daoId: northwind.id, agentId: 1n };
const joinCtx: DescribeContext = { ...base, treasury: commonwealth, dao: northwind, agentName: "Atlas‑7", memberCountAfter: 7 };

describe("describeAction: joinDao", () => {
  const v = describeAction(joinReq, joinCtx);
  it("uses the C-09 copy", () => {
    expect(v.kind).toBe("Membership");
    expect(v.title).toBe("Let Atlas‑7 join Northwind Studio");
    expect(v.happen).toBe(
      "Atlas‑7 becomes a member of Northwind Studio. Joining is free and uses one Commonwealth seat. Earnings go to your wallet, never to the agent.",
    );
    expect(v.rules).toBe("Commonwealth: 5% fee · 3% expenses · 7-day hold · Equal split");
    expect(v.flow).toBe("Per 1 ETH order → 0.92 to 7 owners ≈ 0.1314 each, after 7 days");
    expect(v.permanence).toBeUndefined();
    expect(v.cta).toBe("Approve and sign");
    expect(v.doneText).toBe("Atlas‑7 is now a member of Northwind Studio.");
    expect(v.signer).toBe(owner);
  });
  it("names the called contract: the DAO (N1)", () => {
    expect(v.contractLabel).toBe("DAO membership");
    expect(v.contractAddress).toBe(northwind.address);
    expect(shortAddress(v.contractAddress)).toBe("0x61f0…aa32");
  });
  it("builds the mobile sheet from every line of C-Mobile", () => {
    expect(v.mobile).toEqual({
      title: "Let Atlas‑7 join Northwind Studio?",
      lede: "Free to join. Your agent does the work; payments land in your wallet.",
      amountLabel: "If a customer pays",
      amountValue: "1.00 ETH",
      owners: "0.92 ETH",
      outcome: "shared equally by members' owners, ready after 7 days",
      feeLine: "Fee 5% · 0.05",
      expenseLine: "Expenses 3% · 0.03",
      feeBps: 500,
      expenseBps: 300,
      treasuryName: "Commonwealth",
      treasuryHref: `/treasury/?a=${commonwealth.address}`,
      contractAddress: northwind.address,
      signer: owner,
      approve: "Approve and sign",
      dismiss: "Not now",
    });
    expect(shortAddress(v.mobile!.signer)).toBe("0x91c4…a4F2");
  });
  it("singular hold and owner wording", () => {
    const one = { ...commonwealth, config: { ...(commonwealth as Extract<Treasury, { kind: "configurable" }>).config, holdPeriod: 86400 } } as Treasury;
    const w = describeAction(joinReq, { ...joinCtx, treasury: one, memberCountAfter: 1 });
    expect(w.flow).toBe("Per 1 ETH order → 0.92 to 1 owner ≈ 0.92 each, after 1 day");
    expect(w.rules).toContain("1-day hold");
  });
  it("has no mobile sheet for a custom-split DAO", () => {
    const meritline = DEFAULT_FIXTURES.treasuries.find((t) => isConfigurable(t) && splitKindOf(t.config.splitRule) === "custom");
    expect(meritline).toBeDefined();
    const dao = DEFAULT_FIXTURES.daos.find((x) => x.treasury === meritline!.address)!;
    const w = describeAction({ kind: "joinDao", daoId: dao.id, agentId: 1n }, { ...joinCtx, treasury: meritline, dao });
    expect(w.mobile).toBeUndefined();
    expect(w.rules).toContain("Custom rule");
  });
  it("throws on missing context or an external treasury", () => {
    expect(() => describeAction(joinReq, { ...joinCtx, agentName: undefined })).toThrow();
    expect(() => describeAction(joinReq, { ...joinCtx, dao: undefined })).toThrow();
    expect(() => describeAction(joinReq, { ...joinCtx, memberCountAfter: undefined })).toThrow();
    expect(() => describeAction(joinReq, { ...joinCtx, treasury: EDGE_FIXTURES.external })).toThrow();
  });
});

describe("describeAction: day formatting (I3)", () => {
  it("groups thousands in the rules line like every other screen", () => {
    if (!isConfigurable(commonwealth)) throw new Error("configurable fixture");
    const long: Treasury = { ...commonwealth, config: { ...commonwealth.config, holdPeriod: 49_710 * 86_400 } };
    const v = describeAction(joinReq, { ...joinCtx, treasury: long });
    expect(v.rules).toBe("Commonwealth: 5% fee · 3% expenses · 49,710-day hold · Equal split");
    expect(v.flow).toBe("Per 1 ETH order → 0.92 to 7 owners ≈ 0.1314 each, after 49,710 days");
  });
});

describe("describeAction: spend", () => {
  const req: ActionRequest = {
    kind: "spend", treasury: commonwealth.address, to: SPEND_TO, amount: 1_250_000_000_000_000_000n,
  };
  const ctx = { ...base, signer: founder, treasury: commonwealth, balance: 23_408_000_000_000_000_000n };
  const v = describeAction(req, ctx);
  it("uses the C-09 copy", () => {
    expect(v.kind).toBe("Treasury spend · founder only");
    expect(v.title).toBe("Send 1.250 ETH from Commonwealth");
    expect(v.happen).toBe(`1.250 ETH moves from the treasury balance to ${shortAddress(SPEND_TO)}.`);
    expect(v.rules).toBe("In Phase 1 only the founder can spend the treasury balance.");
    expect(v.flow).toBe("Balance 23.408 → 22.158 ETH");
    expect(v.permanence).toBe("Public: this spend appears in the treasury’s history for everyone");
    expect(v.cta).toBe("Sign spend");
    expect(v.doneText).toBe("The spend is recorded in Commonwealth’s public history.");
    expect(v.signer).toBe(founder);
    expect(v.mobile).toBeUndefined();
  });
  it("shows the exact amount the user signs, even below 3 decimals (I1)", () => {
    const tiny = describeAction({ ...req, amount: 500_000_000_000_000n } as ActionRequest, { ...ctx, balance: 12_345_000_000_000_000_000n });
    expect(tiny.title).toBe("Send 0.0005 ETH from Commonwealth");
    expect(tiny.happen).toBe(`0.0005 ETH moves from the treasury balance to ${shortAddress(SPEND_TO)}.`);
    expect(tiny.flow).toBe("Balance 12.345 → 12.3445 ETH");
    const wei = describeAction({ ...req, amount: 1n } as ActionRequest, { ...ctx, balance: 1_000_000_000_000_000_001n });
    expect(wei.title).toBe("Send 0.000000000000000001 ETH from Commonwealth");
    expect(wei.flow).toBe("Balance 1.000000000000000001 → 1.000 ETH");
  });
  it("names the treasury as the called contract (N1)", () => {
    expect(v.contractLabel).toBe("Commonwealth treasury");
    expect(v.contractAddress).toBe(commonwealth.address);
  });
  it("throws when the amount exceeds the balance", () => {
    expect(() => describeAction(req, { ...ctx, balance: 1_249_999_999_999_999_999n })).toThrow();
    expect(() => describeAction(req, { ...ctx, balance: req.kind === "spend" ? req.amount : 0n })).not.toThrow();
  });
  it("needs the balance and the treasury", () => {
    expect(() => describeAction(req, { ...ctx, balance: undefined })).toThrow();
    expect(() => describeAction(req, { ...ctx, treasury: undefined })).toThrow();
  });
});

describe("describeAction: deployTreasury", () => {
  const req: ActionRequest = {
    kind: "deployTreasury",
    config: { feeBps: 200, expenseBps: 100, holdPeriod: 14 * 86400, maxAgents: 300, splitRule: DEPLOYMENTS.equalSplit },
    metadataURI: encodeTreasuryMetadata({ name: "Tidewater", description: "Harbour fees." }),
  };
  const v = describeAction(req, base);
  it("uses the C-09 copy", () => {
    expect(v.kind).toBe("New treasury");
    expect(v.title).toBe("Deploy the Tidewater treasury");
    expect(v.happen).toBe(
      "A new treasury contract is created with the rules below. Anyone can read it and compare it with other treasuries.",
    );
    expect(v.rules).toBe("2% fee · 1% expenses · 14-day hold · 300 max agents · Equal split");
    expect(v.flow).toBe("Per 1 ETH order → 0.97 to members’ owners, after 14 days");
    expect(v.permanence).toBe("These rules cannot be changed in Phase 1");
    expect(v.cta).toBe("Deploy and sign");
    expect(v.doneText).toBe("Tidewater is live and listed under Treasuries.");
  });
  it("names the factory as the called contract: a single signature (N1)", () => {
    expect(v.contractLabel).toBe("Treasury factory");
    expect(v.contractAddress).toBe(DEPLOYMENTS.treasuryFactory);
  });
  it("labels a non-platform split rule as custom", () => {
    const custom: ActionRequest = {
      kind: "deployTreasury",
      config: { feeBps: 200, expenseBps: 100, holdPeriod: 14 * 86400, maxAgents: 300, splitRule: "0x7a3d00000000000000000000000000000000e914" },
      metadataURI: req.kind === "deployTreasury" ? req.metadataURI : "",
    };
    const c = describeAction(custom, base);
    expect(c.rules).toBe("2% fee · 1% expenses · 14-day hold · 300 max agents · Custom rule");
  });
  it("falls back to neutral wording when the metadata cannot be read", () => {
    const n = describeAction({ ...req, metadataURI: "ipfs://x" } as ActionRequest, base);
    expect(n.title).toBe("Deploy a new treasury");
    expect(n.doneText).toBe("The treasury is live and listed under Treasuries.");
  });
});

describe("describeAction: createDao", () => {
  const req: ActionRequest = {
    kind: "createDao",
    metadataURI: encodeDaoMetadata({ name: "Coral Desk", description: "x" }),
    founderAgentId: 1n,
    treasury: leanGuild.address,
  };
  const ctx = { ...base, treasury: leanGuild, daoName: "Coral Desk", founderAgentName: "Ox‑Relay" };
  const v = describeAction(req, ctx);
  it("uses the C-09 copy", () => {
    expect(v.kind).toBe("New DAO");
    expect(v.title).toBe("Create Coral Desk under Lean Guild");
    expect(v.happen).toBe("Coral Desk is created and joins Lean Guild for free. Your agent Ox‑Relay becomes its first member.");
    expect(v.rules).toBe("Lean Guild: 1% fee · 0% expenses · 14-day hold · Equal split");
    expect(v.flow).toBe("Per 1 ETH order → 0.99 to members’ owners, after 14 days");
    expect(v.permanence).toBe("Coral Desk can’t leave or switch treasury in Phase 1");
    expect(v.cta).toBe("Create and sign");
    expect(v.doneText).toBe("Coral Desk is live under Lean Guild.");
  });
  it("names the DAO factory, not the registry (N1)", () => {
    expect(v.contractLabel).toBe("DAO factory");
    expect(v.contractAddress).toBe(DEPLOYMENTS.daoFactory);
  });
  it("reads the DAO name from the metadata when the context has none", () => {
    expect(describeAction(req, { ...ctx, daoName: undefined }).title).toBe("Create Coral Desk under Lean Guild");
  });
  it("throws without the treasury or founder agent name", () => {
    expect(() => describeAction(req, { ...ctx, treasury: undefined })).toThrow();
    expect(() => describeAction(req, { ...ctx, founderAgentName: undefined })).toThrow();
  });
});

const encodeAgentUri = (name: string): string =>
  `data:application/json;base64,${btoa(JSON.stringify(buildAgentMetadata({ name, description: "d" } as never)))}`;

describe("describeAction: registerAgent / updateAgent", () => {
  const key = "0x0b97000000000000000000000000000000e2C4" as Address;
  const reg: ActionRequest = { kind: "registerAgent", agentKey: key, metadataURI: "ipfs://bafy-oxrelay.json" };
  it("registerAgent has no flow and names the registry", () => {
    const v = describeAction(reg, { ...base, agentName: "Ox‑Relay" });
    expect(v.kind).toBe("Agent registry");
    expect(v.title).toBe("Register a new agent");
    expect(v.happen).toBe(
      `Agent key ${shortAddress(key)} is linked to your wallet as its owner. Its profile is read from ipfs://bafy-oxrelay.json.`,
    );
    expect(v.rules).toBe("Agents never hold funds. Ownership transfer arrives in a later phase.");
    expect(v.flow).toBeUndefined();
    expect(v.permanence).toBeUndefined();
    expect(v.cta).toBe("Register and sign");
    expect(v.contractLabel).toBe("Agent registry");
    expect(v.contractAddress).toBe(DEPLOYMENTS.agentRegistry);
    expect(v.doneText).toBe("Ox‑Relay is registered. You can now join DAOs with it.");
    expect(v.doneTextFor?.({ txHash: "0x01" as Hex, created: { agentId: 9n } })).toBe(
      "Ox‑Relay is registered. You can now join DAOs with it.",
    );
  });
  it("registerAgent without a name uses the new agent id", () => {
    const v = describeAction(reg, base);
    expect(v.doneTextFor?.({ txHash: "0x01" as Hex, created: { agentId: 9n } })).toBe(
      "Agent #9 is registered. You can now join DAOs with it.",
    );
  });
  it("registerAgent from the form names the agent instead of the data: URI", () => {
    const uri = encodeAgentUri("Coral Scout");
    const v = describeAction({ ...reg, metadataURI: uri }, base);
    expect(v.happen).toBe(
      `Agent key ${shortAddress(key)} is linked to your wallet as its owner. Its profile is read from the registration file for Coral Scout.`,
    );
    expect(v.happen).not.toContain("data:");
  });
  it("registerAgent keeps the URL text for ipfs and https", () => {
    const v = describeAction({ ...reg, metadataURI: "https://example.org/a.json" }, base);
    expect(v.happen).toContain("read from https://example.org/a.json.");
  });
  it("shortens long metadata URIs", () => {
    const uri = `data:application/json;base64,${"A".repeat(400)}`;
    const v = describeAction({ ...reg, metadataURI: uri }, base);
    expect(v.happen.length).toBeLessThan(200);
    expect(v.happen).toContain("…");
  });
  it("updateAgent follows the register pattern", () => {
    const v = describeAction({ kind: "updateAgent", agentId: 3n, agentKey: key }, { ...base, agentName: "Atlas‑7" });
    expect(v.title).toBe("Update Atlas‑7");
    expect(v.contractLabel).toBe("Agent registry");
    expect(v.contractAddress).toBe(DEPLOYMENTS.agentRegistry);
    expect(v.flow).toBeUndefined();
    expect(v.mobile).toBeUndefined();
  });
});

describe("describeAction: claim", () => {
  const three = [124n, 135n, 153n].map((m) => {
    const c = DEFAULT_FIXTURES.credits.find((x) => x.amount === m * 10n ** 15n);
    if (!c) throw new Error(`no credit ${m}`);
    return c;
  });
  const req: ActionRequest = { kind: "claim", receiptKeys: three.map((c) => c.receiptKey) };
  const ctx = { ...base, credits: DEFAULT_FIXTURES.credits };
  const v = describeAction(req, ctx);
  it("sums the credits", () => {
    expect(three.reduce((s, c) => s + c.amount, 0n)).toBe(412_000_000_000_000_000n);
  });
  it("uses the C-09 copy with N1 changes", () => {
    expect(v.kind).toBe("Claim earnings");
    expect(v.title).toBe("Claim 0.412 ETH");
    expect(v.happen).toBe("3 credits whose hold period has ended are paid to your wallet.");
    expect(v.rules).toBe(
      `Hold periods ended: 7 days (Commonwealth ${shortAddress(commonwealth.address)}), 14 days (Lean Guild ${shortAddress(leanGuild.address)}).`,
    );
    expect(v.flow).toBe(`0.412 ETH → ${shortAddress(owner)}`);
    expect(v.cta).toBe("Claim and sign");
    expect(v.doneText).toBe("0.412 ETH is in your wallet.");
    expect(v.contractLabel).toBe("Payment router");
    expect(v.contractAddress).toBe(DEPLOYMENTS.paymentRouter);
    expect(shortAddress(commonwealth.address)).toBe("0x4f2a…91c0");
  });
  it("shows the exact claim total (I1)", () => {
    const dust = { ...three[0]!, amount: 1_234_567_890_123_456_789n };
    const w = describeAction({ kind: "claim", receiptKeys: [dust.receiptKey] }, { ...ctx, credits: [dust] });
    expect(w.title).toBe("Claim 1.234567890123456789 ETH");
    expect(w.flow).toBe(`1.234567890123456789 ETH → ${shortAddress(owner)}`);
    expect(w.doneText).toBe("1.234567890123456789 ETH is in your wallet.");
  });
  it("throws for an unknown receipt key", () => {
    expect(() => describeAction({ kind: "claim", receiptKeys: ["0xdead" as Hex] }, ctx)).toThrow();
    expect(() => describeAction(req, { ...ctx, credits: undefined })).toThrow();
  });
  it("uses singular wording for one credit", () => {
    const one = describeAction({ kind: "claim", receiptKeys: [three[0]!.receiptKey] }, ctx);
    expect(one.happen).toBe("1 credit whose hold period has ended is paid to your wallet.");
  });
});

describe("isConfigurable guard sanity", () => {
  it("fixtures are configurable", () => {
    expect(isConfigurable(commonwealth)).toBe(true);
  });
});
