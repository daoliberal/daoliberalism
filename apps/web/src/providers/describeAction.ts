import { agentFallbackName } from "@/data/fallbacks";
import { splitKindOf, type Deployments } from "@/data/deployments";
import { decodeDataUriJson, decodeDaoMetadata, decodeTreasuryMetadata, parseAgentMetadata } from "@/data/metadata";
import {
  isConfigurable,
  type ActionRequest,
  type Address,
  type ConfigurableTreasury,
  type Credit,
  type Dao,
  type Treasury,
  type TreasuryConfig,
  type TxResult,
  type Wei,
} from "@/data/types";
import { formatBpsPercent, formatEthExact, formatEthFlow, formatHoldDayCount, formatHoldDays, shortAddress } from "@/lib/format";
import { distributableOf, ONE_ETH, splitPayment } from "@/lib/money";

export interface MobileSheetView {
  title: string;
  lede: string;
  amountLabel: string;
  amountValue: string;
  owners: string;
  outcome: string;
  feeLine: string;
  expenseLine: string;
  /** The fee and expense shares behind the flow bar (basis points). */
  feeBps: number;
  expenseBps: number;
  treasuryName: string;
  treasuryHref: string;
  contractAddress: Address;
  signer: Address;
  approve: string;
  dismiss: string;
}

export interface ApprovalView {
  mobile?: MobileSheetView;
  kind: string;
  title: string;
  happen: string;
  /** Name of the contract the transaction is actually sent to (N1). */
  contractLabel: string;
  /** Address of the contract the transaction is actually sent to (N1). */
  contractAddress: Address;
  rules: string;
  flow?: string;
  permanence?: string;
  cta: string;
  signer: Address;
  doneText: string;
  /** Done text once the result is known (registerAgent: uses the new agent id when the name is unknown). */
  doneTextFor?(r: TxResult): string;
}

export interface DescribeContext {
  deployments: Deployments;
  treasury?: Treasury;
  dao?: Dao;
  agentName?: string;
  founderAgentName?: string;
  daoName?: string;
  memberCountAfter?: number;
  /** Treasury balance before a spend. */
  balance?: Wei;
  credits?: Credit[];
  /** Reserved by the interface; currently unused. */
  treasuries?: Treasury[];
  signer: Address;
}

function need<T>(value: T | undefined, what: string, kind: string): T {
  if (value === undefined) throw new Error(`describeAction(${kind}): context is missing ${what}`);
  return value;
}

function configurable(t: Treasury | undefined, kind: string): ConfigurableTreasury {
  const treasury = need(t, "treasury", kind);
  if (!isConfigurable(treasury)) throw new Error(`describeAction(${kind}): ${treasury.address} has no readable rules`);
  return treasury;
}

const holdWord = (seconds: number): string => `${formatHoldDayCount(seconds)}-day hold`;

function splitLabel(config: TreasuryConfig, d: Deployments): string {
  return splitKindOf(config.splitRule, d) === "equal" ? "Equal split" : "Custom rule";
}

/** "5% fee · 3% expenses · 7-day hold · Equal split" (+ "· 300 max agents" before the split when `withMax`). */
function rulesLine(config: TreasuryConfig, d: Deployments, withMax: boolean): string {
  return [
    `${formatBpsPercent(config.feeBps)}% fee`,
    `${formatBpsPercent(config.expenseBps)}% expenses`,
    holdWord(config.holdPeriod),
    ...(withMax ? [`${config.maxAgents} max agents`] : []),
    splitLabel(config, d),
  ].join(" · ");
}

/** "Per 1 ETH order → 0.92 to <recipients>, after 7 days"; `members` adds "≈ x each" for the equal split. */
function flowLine(config: TreasuryConfig, d: Deployments, members?: number): string {
  const dist = distributableOf(ONE_ETH, config.feeBps, config.expenseBps);
  const head = `Per 1 ETH order → ${formatEthFlow(dist)} to `;
  const tail = `, after ${formatHoldDays(config.holdPeriod)}`;
  if (members === undefined || splitKindOf(config.splitRule, d) !== "equal") return `${head}members’ owners${tail}`;
  const each = dist / BigInt(Math.max(1, members));
  return `${head}${members} ${members === 1 ? "owner" : "owners"} ≈ ${formatEthFlow(each)} each${tail}`;
}

function shorten(uri: string): string {
  return uri.length > 32 ? `${uri.slice(0, 16)}…${uri.slice(-12)}` : uri;
}

/** Where an agent's profile is read from: the agent's name for form-made data: URIs, else the (shortened) URI text. */
function profileSource(uri: string): string {
  if (/^data:/i.test(uri)) {
    const json = decodeDataUriJson(uri);
    const agent = json.ok ? parseAgentMetadata(json.value) : undefined;
    if (agent?.ok) return `the registration file for ${agent.value.name}`;
  }
  return shorten(uri);
}

function mobileJoin(
  t: ConfigurableTreasury,
  dao: Dao,
  agentName: string,
  daoName: string,
  members: number,
  signer: Address,
): MobileSheetView {
  const r = splitPayment(ONE_ETH, t.config.feeBps, t.config.expenseBps, Math.max(1, members));
  if (!r.ok) throw new Error("describeAction(joinDao): treasury rules overflow 100%");
  return {
    title: `Let ${agentName} join ${daoName}?`,
    lede: "Free to join. Your agent does the work; payments land in your wallet.",
    amountLabel: "If a customer pays",
    amountValue: "1.00 ETH",
    owners: `${formatEthFlow(r.distributable)} ETH`,
    outcome: `shared equally by members' owners, ready after ${formatHoldDays(t.config.holdPeriod)}`,
    feeLine: `Fee ${formatBpsPercent(t.config.feeBps)}% · ${formatEthFlow(r.treasuryFee)}`,
    expenseLine: `Expenses ${formatBpsPercent(t.config.expenseBps)}% · ${formatEthFlow(r.expenseFee)}`,
    feeBps: t.config.feeBps,
    expenseBps: t.config.expenseBps,
    treasuryName: t.metadata.name,
    treasuryHref: `/treasury/?a=${t.address}`,
    contractAddress: dao.address,
    signer,
    approve: "Approve and sign",
    dismiss: "Not now",
  };
}

/** Parametrised C-09 copy (and C-Mobile for joinDao). Reads only the context fields the action needs; throws on a missing one. */
export function describeAction(req: ActionRequest, ctx: DescribeContext): ApprovalView {
  const { deployments: d, signer } = ctx;
  switch (req.kind) {
    case "joinDao": {
      const t = configurable(ctx.treasury, req.kind);
      const dao = need(ctx.dao, "dao", req.kind);
      const agent = need(ctx.agentName, "agentName", req.kind);
      const members = need(ctx.memberCountAfter, "memberCountAfter", req.kind);
      const daoName = dao.metadata.name;
      const view: ApprovalView = {
        kind: "Membership",
        title: `Let ${agent} join ${daoName}`,
        happen: `${agent} becomes a member of ${daoName}. Joining is free and uses one ${t.metadata.name} seat. Earnings go to your wallet, never to the agent.`,
        contractLabel: "DAO membership",
        contractAddress: dao.address,
        rules: `${t.metadata.name}: ${rulesLine(t.config, d, false)}`,
        flow: flowLine(t.config, d, members),
        cta: "Approve and sign",
        signer,
        doneText: `${agent} is now a member of ${daoName}.`,
      };
      // The mobile sheet shows the equal-split outcome only; a custom rule has no per-owner promise to make.
      if (splitKindOf(t.config.splitRule, d) === "equal") view.mobile = mobileJoin(t, dao, agent, daoName, members, signer);
      return view;
    }
    case "spend": {
      const t = need(ctx.treasury, "treasury", req.kind);
      const balance = need(ctx.balance, "balance", req.kind);
      const name = t.metadata.name;
      if (req.amount > balance) throw new Error("describeAction(spend): amount exceeds the treasury balance");
      const after = balance - req.amount;
      return {
        kind: "Treasury spend · founder only",
        title: `Send ${formatEthExact(req.amount)} ETH from ${name}`,
        happen: `${formatEthExact(req.amount)} ETH moves from the treasury balance to ${shortAddress(req.to)}.`,
        contractLabel: `${name} treasury`,
        contractAddress: t.address,
        rules: "In Phase 1 only the founder can spend the treasury balance.",
        flow: `Balance ${formatEthExact(balance)} → ${formatEthExact(after)} ETH`,
        permanence: "Public: this spend appears in the treasury’s history for everyone",
        cta: "Sign spend",
        signer,
        doneText: `The spend is recorded in ${name}’s public history.`,
      };
    }
    case "deployTreasury": {
      const meta = decodeTreasuryMetadata(req.metadataURI);
      const name = meta.ok ? meta.value.name : undefined;
      return {
        kind: "New treasury",
        title: name ? `Deploy the ${name} treasury` : "Deploy a new treasury",
        happen:
          "A new treasury contract is created with the rules below. Anyone can read it and compare it with other treasuries.",
        contractLabel: "Treasury factory",
        contractAddress: d.treasuryFactory,
        rules: rulesLine(req.config, d, true),
        flow: flowLine(req.config, d),
        permanence: "These rules cannot be changed in Phase 1",
        cta: "Deploy and sign",
        signer,
        doneText: name ? `${name} is live and listed under Treasuries.` : "The treasury is live and listed under Treasuries.",
      };
    }
    case "createDao": {
      const t = configurable(ctx.treasury, req.kind);
      const founderAgent = need(ctx.founderAgentName, "founderAgentName", req.kind);
      const meta = decodeDaoMetadata(req.metadataURI);
      const daoName = ctx.daoName ?? (meta.ok ? meta.value.name : undefined);
      const dao = need(daoName, "daoName", req.kind);
      const tName = t.metadata.name;
      return {
        kind: "New DAO",
        title: `Create ${dao} under ${tName}`,
        happen: `${dao} is created and joins ${tName} for free. Your agent ${founderAgent} becomes its first member.`,
        contractLabel: "DAO factory",
        contractAddress: d.daoFactory,
        rules: `${tName}: ${rulesLine(t.config, d, false)}`,
        flow: flowLine(t.config, d),
        permanence: `${dao} can’t leave or switch treasury in Phase 1`,
        cta: "Create and sign",
        signer,
        doneText: `${dao} is live under ${tName}.`,
      };
    }
    case "registerAgent": {
      const registered = (name: string) => `${name} is registered. You can now join DAOs with it.`;
      const known = ctx.agentName;
      return {
        kind: "Agent registry",
        title: "Register a new agent",
        happen: `Agent key ${shortAddress(req.agentKey)} is linked to your wallet as its owner. Its profile is read from ${profileSource(req.metadataURI)}.`,
        contractLabel: "Agent registry",
        contractAddress: d.agentRegistry,
        rules: "Agents never hold funds. Ownership transfer arrives in a later phase.",
        cta: "Register and sign",
        signer,
        doneText: registered(known ?? "Your agent"),
        doneTextFor: (r: TxResult) =>
          registered(known ?? (r.created?.agentId !== undefined ? agentFallbackName(r.created.agentId) : "Your agent")),
      };
    }
    case "updateAgent": {
      const name = ctx.agentName ?? agentFallbackName(req.agentId);
      return {
        kind: "Agent registry",
        title: `Update ${name}`,
        happen: `${name}’s registry entry is updated with the changes you entered.`,
        contractLabel: "Agent registry",
        contractAddress: d.agentRegistry,
        rules: "Agents never hold funds. Ownership transfer arrives in a later phase.",
        cta: "Update and sign",
        signer,
        doneText: `${name} is updated.`,
      };
    }
    case "claim": {
      const all = need(ctx.credits, "credits", req.kind);
      const picked = req.receiptKeys.map((k) => {
        const c = all.find((x) => x.receiptKey.toLowerCase() === k.toLowerCase());
        if (!c) throw new Error(`describeAction(claim): unknown receipt key ${k}`);
        return c;
      });
      const total = picked.reduce((s, c) => s + c.amount, 0n);
      const unique = new Map<string, Credit>();
      for (const c of picked) unique.set(`${c.treasury.toLowerCase()}|${c.holdPeriod}`, c);
      const holds = [...unique.values()]
        .sort((a, b) => a.holdPeriod - b.holdPeriod || a.treasuryName.localeCompare(b.treasuryName))
        .map((c) => `${formatHoldDays(c.holdPeriod)} (${c.treasuryName} ${shortAddress(c.treasury)})`);
      const n = picked.length;
      return {
        kind: "Claim earnings",
        title: `Claim ${formatEthExact(total)} ETH`,
        happen: `${n} ${n === 1 ? "credit whose hold period has ended is" : "credits whose hold period has ended are"} paid to your wallet.`,
        contractLabel: "Payment router",
        contractAddress: d.paymentRouter,
        rules: `Hold periods ended: ${holds.join(", ")}.`,
        flow: `${formatEthExact(total)} ETH → ${shortAddress(signer)}`,
        cta: "Claim and sign",
        signer,
        doneText: `${formatEthExact(total)} ETH is in your wallet.`,
      };
    }
  }
}
