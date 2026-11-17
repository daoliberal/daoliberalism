import { describe, expect, it } from "vitest";
import { DEPLOYMENTS, explorerUrl, splitKindOf } from "@/data/deployments";
import type { Address, Hex } from "@/data/types";

describe("deployments", () => {
  it("pins placeholder addresses to the prototype short forms", () => {
    const d = DEPLOYMENTS;
    const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
    expect(short(d.equalSplit)).toBe("0x2e0b…c4d1");
    expect(short(d.treasuryFactory)).toBe("0xa4c7…0e55");
    expect(short(d.agentRegistry)).toBe("0x9e2d…41b3");
    expect(short(d.daoFactory)).toBe("0x2b51…d7e0");
    for (const a of [d.agentRegistry, d.treasuryRegistry, d.treasuryFactory, d.daoFactory, d.paymentRouter, d.equalSplit]) {
      expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    }
    expect(new Set(Object.values(d)).size).toBe(Object.values(d).length);
  });
  it("splitKindOf is case-insensitive and by address", () => {
    expect(splitKindOf(DEPLOYMENTS.equalSplit)).toBe("equal");
    expect(splitKindOf(("0x" + DEPLOYMENTS.equalSplit.slice(2).toUpperCase()) as Address)).toBe("equal");
    expect(splitKindOf("0x7a3d00000000000000000000000000000000e914")).toBe("custom");
  });
  it("explorerUrl is deterministic", () => {
    const a = DEPLOYMENTS.equalSplit;
    expect(explorerUrl(a)).toBe(`${DEPLOYMENTS.explorerBase}/address/${a}`);
    const h = ("0x" + "ab".repeat(32)) as Hex;
    expect(explorerUrl(h)).toBe(`${DEPLOYMENTS.explorerBase}/tx/${h}`);
  });
});
