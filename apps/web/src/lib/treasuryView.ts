import { splitKindOf, type Deployments } from "@/data/deployments";
import type { ConfigurableTreasury } from "@/data/types";
import { BPS, distributableOf, splitPayment } from "./money";
import { parseEthInput } from "./validation";

export type TreasuryFilter = "all" | "open" | "short" | "equal";
export type TreasurySort = "name" | "owners" | "hold" | "seats";

const SHORT_HOLD_SECONDS = 7 * 86_400;
const BPS_NUMBER = Number(BPS);

/** Seats still free (never negative). */
export function freeSeats(t: ConfigurableTreasury): number {
  return Math.max(t.config.maxAgents - t.seatsUsed, 0);
}

/** Share of each payment that reaches members' owners, in bps (what is left after the fee and the expenses). */
export function ownersBps(t: ConfigurableTreasury): number {
  return Math.max(BPS_NUMBER - t.config.feeBps - t.config.expenseBps, 0);
}

/** Prototype C-02: free / max > 0.05, written without division. */
export function hasSeatsOpen(t: ConfigurableTreasury): boolean {
  const free = freeSeats(t);
  return free > 0 && free * 20 > t.config.maxAgents;
}

export function filterTreasuries(ts: ConfigurableTreasury[], f: TreasuryFilter, d: Deployments): ConfigurableTreasury[] {
  switch (f) {
    case "open":
      return ts.filter(hasSeatsOpen);
    case "short":
      return ts.filter((t) => t.config.holdPeriod <= SHORT_HOLD_SECONDS);
    case "equal":
      return ts.filter((t) => splitKindOf(t.config.splitRule, d) === "equal");
    default:
      return [...ts];
  }
}

const byNameThenAddress = (a: ConfigurableTreasury, b: ConfigurableTreasury): number => {
  const [x, y] = [a.address.toLowerCase(), b.address.toLowerCase()];
  return a.metadata.name.localeCompare(b.metadata.name) || (x < y ? -1 : x > y ? 1 : 0);
};

const ORDER: Record<TreasurySort, (a: ConfigurableTreasury, b: ConfigurableTreasury) => number> = {
  name: () => 0,
  owners: (a, b) => ownersBps(b) - ownersBps(a),
  hold: (a, b) => a.config.holdPeriod - b.config.holdPeriod,
  seats: (a, b) => freeSeats(b) - freeSeats(a),
};

/** Equal values fall back to name A to Z, then to the address, so the order never depends on the input order. */
export function sortTreasuries(ts: ConfigurableTreasury[], s: TreasurySort): ConfigurableTreasury[] {
  return [...ts].sort((a, b) => ORDER[s](a, b) || byNameThenAddress(a, b));
}

/** The "If a customer pays" input: a decimal amount in ETH; anything else counts as 0 (the prototype shows no error). */
export function amountOf(raw: string): bigint {
  const parsed = parseEthInput(raw);
  return parsed.ok ? parsed.value : 0n;
}

/** What one payment of `amount` turns into under this treasury's rules: fee, expenses, and what reaches members' owners. */
export function quoteOf(t: ConfigurableTreasury, amount: bigint): { fee: bigint; expenses: bigint; owners: bigint } {
  // D5: what reaches owners comes straight from distributableOf; the fee and expense amounts come from splitPayment
  // (one member is enough, only the fee split is used). Both share the contract's rounding rule.
  const { feeBps, expenseBps } = t.config;
  const owners = distributableOf(amount, feeBps, expenseBps);
  const split = splitPayment(amount, feeBps, expenseBps, 1);
  return split.ok ? { fee: split.treasuryFee, expenses: split.expenseFee, owners } : { fee: 0n, expenses: 0n, owners };
}
