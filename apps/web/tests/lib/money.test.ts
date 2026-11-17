import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { distributableOf, eachOwnerMin, splitPayment, sumByOwner } from "@/lib/money";

const ETH = 10n ** 18n;
const ALICE = "0x00000000000000000000000000000000000000a1" as Address;
const BOB = "0x00000000000000000000000000000000000000b2" as Address;

describe("splitPayment", () => {
  it("matches the pinned contract example", () => {
    const r = splitPayment(ETH, 500, 300, 3);
    expect(r).toEqual({
      ok: true,
      treasuryFee: 50000000000000000n,
      expenseFee: 30000000000000000n,
      distributable: 920000000000000000n,
      shares: [306666666666666667n, 306666666666666667n, 306666666666666666n],
    });
    if (!r.ok) throw new Error("unreachable");
    const m = sumByOwner(r.shares, [ALICE, ALICE, BOB]);
    expect(m.get(ALICE)).toBe(613333333333333334n);
    expect(m.get(BOB)).toBe(306666666666666666n);
  });
  it("gives the remainder to the first members and omits zero entries", () => {
    const a = splitPayment(10n, 0, 0, 3);
    expect(a.ok && a.shares).toEqual([4n, 3n, 3n]);
    const b = splitPayment(2n, 0, 0, 3);
    expect(b.ok && b.shares).toEqual([1n, 1n]);
    const c = splitPayment(1n, 500, 0, 3);
    expect(c.ok && c.treasuryFee).toBe(0n);
    expect(c.ok && c.shares).toEqual([1n]);
  });
  it("handles zero members and overflow", () => {
    const a = splitPayment(ETH, 5000, 5000, 0);
    expect(a.ok && a.shares).toEqual([]);
    expect(splitPayment(ETH, 0, 0, 0)).toEqual({ ok: false, reason: "no-members" });
    expect(splitPayment(1n, 6000, 6000, 1)).toEqual({ ok: false, reason: "bps-overflow" });
  });
  it("full-fee: remainder goes to treasury, owners get 0", () => {
    const a = splitPayment(1n, 5000, 5000, 3);
    expect(a).toEqual({ ok: true, treasuryFee: 1n, expenseFee: 0n, distributable: 0n, shares: [] });
    const b = splitPayment(ETH + 1n, 6000, 4000, 2);
    if (!b.ok) throw new Error("unreachable");
    expect(b.treasuryFee + b.expenseFee).toBe(ETH + 1n);
    expect(b.distributable).toBe(0n);
    expect(b.shares).toEqual([]);
  });
  it("conserves value for random inputs", () => {
    let seed = 123456789n;
    const rnd = (max: bigint): bigint => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
      return (seed >> 8n) % (max + 1n);
    };
    for (let i = 0; i < 2000; i++) {
      const amount = (rnd(10n ** 15n) * rnd(10n ** 15n)) % (10n ** 30n + 1n);
      const fee = Number(rnd(10000n));
      const exp = Number(rnd(BigInt(10000 - fee)));
      const n = Number(rnd(99n)) + 1;
      const r = splitPayment(amount, fee, exp, n);
      if (!r.ok) throw new Error("unexpected failure");
      const sum = r.shares.reduce((x, y) => x + y, 0n);
      expect(r.treasuryFee + r.expenseFee + sum).toBe(amount);
    }
  });
});

describe("eachOwnerMin / distributableOf", () => {
  it("floors per member and clamps n", () => {
    expect(eachOwnerMin(920000000000000000n, 6)).toBe(153333333333333333n);
    expect(eachOwnerMin(10n, 0)).toBe(10n);
  });
  it("computes the calculator path", () => {
    expect(distributableOf(ETH, 500, 300)).toBe(920000000000000000n);
    expect(distributableOf(ETH, 10000, 0)).toBe(0n);
    expect(distributableOf(ETH, 6000, 6000)).toBe(0n);
    expect(distributableOf(10n ** 30n, 0, 0)).toBe(10n ** 30n);
  });
});
