import { describe, expect, it } from "vitest";
import { num, pct } from "@/oyun/lib/format";

describe("format", () => {
  it("pct", () => {
    expect(pct(0.0031)).toBe("%0,31");
    expect(pct(0.5, 0)).toBe("%50");
    expect(pct(null)).toBe("–");
  });
  it("num", () => {
    expect(num(1234567)).toBe("1.234.567");
    expect(num(NaN)).toBe("–");
    expect(num(null)).toBe("–");
  });
});
