import { describe, expect, it } from "vitest";
import { DEFAULT_FIXTURES, EDGE_FIXTURES } from "@/data/mock/fixtures";
import { MOCK_NOW } from "@/data/mock/clock";
import type { Hex } from "@/data/types";
import { creditStatus, isClaimable, selectedTotal, summarizeCredits } from "@/lib/creditView";

const credits = DEFAULT_FIXTURES.credits;
const claims = DEFAULT_FIXTURES.claims;
const byOrder = (n: number) => {
  const c = credits.find((x) => BigInt(x.orderId) === BigInt(n));
  if (!c) throw new Error(String(n));
  return c;
};

describe("summarizeCredits", () => {
  it("sums the fixtures as the prototype shows them", () => {
    expect(summarizeCredits(credits, claims, MOCK_NOW)).toEqual({
      available: 412000000000000000n,
      availableCount: 3,
      onHold: 287000000000000000n,
      nextReleaseIn: "2 d 04 h",
      claimed: 1900000000000000000n,
      claimCount: 3,
    });
  });
  it("has no next release when nothing is on hold", () => {
    expect(summarizeCredits([byOrder(988)], [], MOCK_NOW).nextReleaseIn).toBeUndefined();
  });
  it("does not count claimed credits as available", () => {
    const s = summarizeCredits(credits.map((c) => ({ ...c, claimed: true })), claims, MOCK_NOW);
    expect(s.available).toBe(0n);
    expect(s.availableCount).toBe(0);
    expect(s.onHold).toBe(0n);
  });
  it("holds a never-releasing credit without offering a release time", () => {
    const s = summarizeCredits([EDGE_FIXTURES.neverReleaseCredit], [], MOCK_NOW);
    expect(s.onHold).toBe(EDGE_FIXTURES.neverReleaseCredit.amount);
    expect(s.nextReleaseIn).toBeUndefined();
  });
});

describe("isClaimable", () => {
  it("is true exactly at the release time and after", () => {
    const c = { ...byOrder(988), claimed: false, releaseTime: MOCK_NOW };
    expect(isClaimable(c, MOCK_NOW)).toBe(true);
    expect(isClaimable({ ...c, releaseTime: MOCK_NOW + 1n }, MOCK_NOW)).toBe(false);
  });
  it("is false once claimed", () => {
    expect(isClaimable({ ...byOrder(988), claimed: true }, MOCK_NOW)).toBe(false);
  });
  it("a hold-zero credit is claimable at once", () => {
    const c = EDGE_FIXTURES.holdZeroCredit;
    expect(isClaimable(c, c.creditedAt)).toBe(true);
  });
  it("2^64-1 never releases", () => {
    expect(isClaimable(EDGE_FIXTURES.neverReleaseCredit, MOCK_NOW)).toBe(false);
  });
});

describe("selectedTotal", () => {
  const keys = (...orders: number[]): Set<Hex> => new Set(orders.map((n) => byOrder(n).receiptKey));
  it("adds only the selected claimable credits", () => {
    expect(selectedTotal(credits, keys(1042, 988, 1017), MOCK_NOW)).toBe(412000000000000000n);
    expect(selectedTotal(credits, keys(1042), MOCK_NOW)).toBe(153000000000000000n);
    expect(selectedTotal(credits, new Set(), MOCK_NOW)).toBe(0n);
  });
  it("ignores a selected credit that has not matured", () => {
    expect(selectedTotal(credits, keys(1042, 1101), MOCK_NOW)).toBe(153000000000000000n);
  });
});

describe("creditStatus", () => {
  it("matches the prototype texts and progress", () => {
    expect(creditStatus(byOrder(1042), MOCK_NOW)).toEqual({ text: "Available", pct: 100, ready: true });
    expect(creditStatus(byOrder(1101), MOCK_NOW)).toEqual({ text: "in 2 d 04 h · 23 Oct", pct: 69, ready: false });
    expect(creditStatus(byOrder(1110), MOCK_NOW)).toEqual({ text: "in 9 d 11 h · 30 Oct", pct: 32, ready: false });
  });
  it("a claimed credit reads Claimed with a full bar and no checkbox", () => {
    expect(creditStatus({ ...byOrder(988), claimed: true }, MOCK_NOW)).toEqual({ text: "Claimed", pct: 100, ready: false });
  });
  it("never releases: same slot, bar at zero, not ready", () => {
    expect(creditStatus(EDGE_FIXTURES.neverReleaseCredit, MOCK_NOW)).toEqual({ text: "never releases", pct: 0, ready: false });
  });
});
