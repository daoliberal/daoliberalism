import type { Address } from "viem";

export const BPS = 10_000n;
/** One ETH in wei (the "per 1 ETH order" unit used by the calculators and approval lines). */
export const ONE_ETH = 10n ** 18n;

export type SplitResult =
  | { ok: true; treasuryFee: bigint; expenseFee: bigint; distributable: bigint; shares: bigint[] }
  | { ok: false; reason: "no-members" | "bps-overflow" };

type Fees = { treasuryFee: bigint; expenseFee: bigint };

/** Contract ConfigurableTreasury.quote: floor each fee; when fee+expense == 100% the remainder goes to the treasury. */
function feesOf(amount: bigint, feeBps: number, expenseBps: number): Fees {
  const expenseFee = (amount * BigInt(expenseBps)) / BPS;
  if (BigInt(feeBps) + BigInt(expenseBps) === BPS) {
    return { treasuryFee: amount - expenseFee, expenseFee };
  }
  return { treasuryFee: (amount * BigInt(feeBps)) / BPS, expenseFee };
}

export function splitPayment(
  amount: bigint,
  feeBps: number,
  expenseBps: number,
  memberCount: number,
): SplitResult {
  if (BigInt(feeBps) + BigInt(expenseBps) > BPS) return { ok: false, reason: "bps-overflow" };
  const { treasuryFee, expenseFee } = feesOf(amount, feeBps, expenseBps);
  const distributable = amount - treasuryFee - expenseFee;
  if (distributable === 0n) return { ok: true, treasuryFee, expenseFee, distributable, shares: [] };
  if (memberCount < 1) return { ok: false, reason: "no-members" };
  // EqualSplit: base/remainder, first r members get one extra wei, zero entries omitted.
  const n = BigInt(memberCount);
  const base = distributable / n;
  const r = distributable % n;
  const shares: bigint[] = [];
  for (let i = 0n; i < n; i++) {
    const share = base + (i < r ? 1n : 0n);
    if (share > 0n) shares.push(share);
  }
  return { ok: true, treasuryFee, expenseFee, distributable, shares };
}

export function eachOwnerMin(distributable: bigint, memberCount: number): bigint {
  const n = memberCount < 1 ? 1 : memberCount;
  return distributable / BigInt(n);
}

export function distributableOf(amount: bigint, feeBps: number, expenseBps: number): bigint {
  if (BigInt(feeBps) + BigInt(expenseBps) > BPS) return 0n;
  const { treasuryFee, expenseFee } = feesOf(amount, feeBps, expenseBps);
  return amount - treasuryFee - expenseFee;
}

export function sumByOwner(shares: bigint[], owners: Address[]): Map<Address, bigint> {
  const out = new Map<Address, bigint>();
  shares.forEach((share, i) => {
    const owner = owners[i];
    if (owner === undefined) return;
    out.set(owner, (out.get(owner) ?? 0n) + share);
  });
  return out;
}
