import { describe, expect, it } from "vitest";
import {
  isAddressInput, parseDaysToSeconds, parseEthInput, parsePercentToBps, parsePositiveInt,
} from "@/lib/validation";

const ETH = 10n ** 18n;
const ok = <T,>(value: T) => ({ ok: true, value });
const bad = { ok: false };

describe("validation", () => {
  it("parseEthInput", () => {
    expect(parseEthInput("1.00")).toEqual(ok(ETH));
    expect(parseEthInput(".5")).toEqual(ok(5n * 10n ** 17n));
    expect(parseEthInput("1.")).toEqual(ok(ETH));
    expect(parseEthInput(" 2 ")).toEqual(ok(2n * ETH));
    for (const s of ["", "-1", "1e3", "1,5", "abc", ".", "0.0000000000000000001"]) {
      expect(parseEthInput(s)).toEqual(bad);
    }
    const big = parseEthInput("1" + "0".repeat(30));
    expect(big).toEqual(ok(10n ** 48n));
  });
  it("parsePercentToBps", () => {
    expect(parsePercentToBps("5")).toEqual(ok(500));
    expect(parsePercentToBps("2.5")).toEqual(ok(250));
    expect(parsePercentToBps("100")).toEqual(ok(10000));
    for (const s of ["2.555", "100.01", "-1", "", "abc"]) expect(parsePercentToBps(s)).toEqual(bad);
  });
  it("parseDaysToSeconds", () => {
    expect(parseDaysToSeconds("7")).toEqual(ok(604800));
    expect(parseDaysToSeconds("0")).toEqual(ok(0));
    expect(parseDaysToSeconds("49710")).toEqual(ok(4294944000));
    for (const s of ["1.5", "49711", "", "-1"]) expect(parseDaysToSeconds(s)).toEqual(bad);
  });
  it("parsePositiveInt", () => {
    expect(parsePositiveInt("1", 500)).toEqual(ok(1));
    expect(parsePositiveInt("500", 500)).toEqual(ok(500));
    for (const s of ["0", "501", "", "1.5", "-2"]) expect(parsePositiveInt(s, 500)).toEqual(bad);
  });
  it("isAddressInput accepts any-case 40-hex, rejects junk", () => {
    expect(isAddressInput("0x" + "ab".repeat(20))).toBe(true);
    expect(isAddressInput("0x" + "AB".repeat(20))).toBe(true);
    expect(isAddressInput("0x123")).toBe(false);
    expect(isAddressInput("")).toBe(false);
  });
});
