import type { Address, Hex } from "viem";

import { ONE_ETH } from "./money";

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Truncates (never rounds up) wei to `decimals` places; returns whole and fractional digit strings. */
function split(wei: bigint, decimals: number): { whole: bigint; frac: string } {
  const unit = 10n ** BigInt(18 - decimals);
  const scaled = wei / unit;
  const scale = 10n ** BigInt(decimals);
  const whole = scaled / scale;
  const frac = decimals === 0 ? "" : (scaled % scale).toString().padStart(decimals, "0");
  return { whole, frac };
}

export function formatEth(wei: bigint, decimals = 3): string {
  const { whole, frac } = split(wei, decimals);
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * What the user actually signs: the prototype's 3-decimal look when the value is exact at 3 decimals ("1.250"),
 * otherwise the full precision (up to 18 decimals, trailing zeros trimmed, never fewer than 3 decimals).
 */
export function formatEthExact(wei: bigint): string {
  if (wei % 10n ** 15n === 0n) return formatEth(wei);
  const { whole, frac } = split(wei, 18);
  let trimmed = frac;
  while (trimmed.length > 3 && trimmed.endsWith("0")) trimmed = trimmed.slice(0, -1);
  return `${whole}.${trimmed}`;
}

export function formatEthFlow(wei: bigint): string {
  if (wei > 0n && wei < ONE_ETH / 10_000n) return "<0.0001";
  const { whole, frac } = split(wei, 4);
  let trimmed = frac;
  while (trimmed.length > 2 && trimmed.endsWith("0")) trimmed = trimmed.slice(0, -1);
  return `${whole}.${trimmed}`;
}

export function formatEthVolume(wei: bigint): string {
  const { whole, frac } = split(wei, 2);
  return `${group(whole.toString())}.${frac}`;
}

export function shortAddress(a: Address): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function shortHash(h: Hex): string {
  return `${h.slice(0, 6)}…`;
}

export function formatOrderId(id: Hex): string {
  const n = BigInt(id);
  return n < 1_000_000_000n ? `#${n.toString().padStart(4, "0")}` : shortHash(id);
}

export function formatBpsPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = (bps % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Whole days with thousands grouping, no unit ("7", "49,710"). */
export function formatHoldDayCount(seconds: number): string {
  return group(Math.floor(seconds / 86400).toString());
}

export function formatHoldDays(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  return `${formatHoldDayCount(seconds)} ${days === 1 ? "day" : "days"}`;
}
