import type { ClaimRecord, Credit, Hex } from "@/data/types";
import { formatDuration, formatReleaseIn, holdProgressPct, isNeverRelease } from "./time";

export interface EarningsSummary {
  available: bigint;
  availableCount: number;
  onHold: bigint;
  nextReleaseIn?: string;
  claimed: bigint;
  claimCount: number;
}

/** A credit can be claimed when it has not been claimed and its hold has ended. */
export function isClaimable(c: Credit, now: bigint): boolean {
  return !c.claimed && c.releaseTime <= now;
}

export function summarizeCredits(credits: Credit[], claims: ClaimRecord[], now: bigint): EarningsSummary {
  let available = 0n;
  let availableCount = 0;
  let onHold = 0n;
  let soonest: bigint | undefined;
  for (const c of credits) {
    if (c.claimed) continue;
    if (isClaimable(c, now)) {
      available += c.amount;
      availableCount += 1;
      continue;
    }
    onHold += c.amount;
    if (!isNeverRelease(c.releaseTime) && (soonest === undefined || c.releaseTime < soonest)) soonest = c.releaseTime;
  }
  return {
    available,
    availableCount,
    onHold,
    ...(soonest === undefined ? {} : { nextReleaseIn: formatDuration(soonest - now) }),
    claimed: claims.reduce((sum, r) => sum + r.amount, 0n),
    claimCount: claims.length,
  };
}

/** Total of the selected credits that can be claimed now; a selected credit that has not matured counts for nothing. */
export function selectedTotal(credits: Credit[], selected: Set<Hex>, now: bigint): bigint {
  let total = 0n;
  for (const c of credits) if (selected.has(c.receiptKey) && isClaimable(c, now)) total += c.amount;
  return total;
}

export interface CreditStatus {
  /** "Available", "in 2 d 04 h · 23 Oct", "never releases" or (not in the prototype) "Claimed". */
  text: string;
  /** Hold progress for the bar, 0 to 100. */
  pct: number;
  ready: boolean;
}

export function creditStatus(c: Credit, now: bigint): CreditStatus {
  if (c.claimed) return { text: "Claimed", pct: 100, ready: false };
  const ready = isClaimable(c, now);
  if (isNeverRelease(c.releaseTime)) return { text: formatReleaseIn(c.releaseTime, now), pct: 0, ready: false };
  return {
    text: ready ? "Available" : formatReleaseIn(c.releaseTime, now),
    pct: ready ? 100 : holdProgressPct(c.creditedAt, c.releaseTime, now),
    ready,
  };
}
