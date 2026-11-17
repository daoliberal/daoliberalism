import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  formatBpsPercent, formatEth, formatEthExact, formatEthFlow, formatEthVolume, formatHoldDayCount, formatHoldDays,
  formatOrderId, shortAddress, shortHash,
} from "@/lib/format";

const ETH = 10n ** 18n;

describe("format", () => {
  it("formatEth truncates down", () => {
    expect(formatEth(412000000000000000n)).toBe("0.412");
    expect(formatEth(1999999999999999999n)).toBe("1.999");
    expect(formatEth(0n)).toBe("0.000");
    expect(formatEth(ETH, 0)).toBe("1");
  });
  it("formatEthExact keeps 3 decimals when exact and shows full precision otherwise", () => {
    expect(formatEthExact(1_250_000_000_000_000_000n)).toBe("1.250");
    expect(formatEthExact(0n)).toBe("0.000");
    expect(formatEthExact(500_000_000_000_000n)).toBe("0.0005");
    expect(formatEthExact(1n)).toBe("0.000000000000000001");
    expect(formatEthExact(1_234_567_890_123_456_789n)).toBe("1.234567890123456789");
    expect(formatEthExact(12_345_600_000_000_000_000n)).toBe("12.3456");
  });
  it("formatEthFlow", () => {
    expect(formatEthFlow(920000000000000000n)).toBe("0.92");
    expect(formatEthFlow(ETH)).toBe("1.00");
    expect(formatEthFlow(50000000000000000n)).toBe("0.05");
    expect(formatEthFlow(153333333333333333n)).toBe("0.1533");
    expect(formatEthFlow(1n)).toBe("<0.0001");
    expect(formatEthFlow(0n)).toBe("0.00");
  });
  it("formatEthVolume", () => {
    expect(formatEthVolume(1204100000000000000000n)).toBe("1,204.10");
    expect(formatEthVolume(999999999999999999n)).toBe("0.99");
  });
  it("short forms keep stored case", () => {
    expect(shortAddress(("0x91c4" + "0".repeat(32) + "a4F2") as Address)).toBe("0x91c4…a4F2");
    expect(shortAddress("0x3b02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaBc" as Address)).toBe("0x3b02…aaBc");
    expect(shortHash(("0x9a1c" + "0".repeat(60)) as Hex)).toBe("0x9a1c…");
  });
  it("formatOrderId", () => {
    expect(formatOrderId(("0x" + "0".repeat(61) + "412") as Hex)).toBe("#1042");
    expect(formatOrderId(("0x" + "f".repeat(64)) as Hex)).toBe("0xffff…");
    const h = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
    expect(formatOrderId(h(988))).toBe("#0988");
    expect(formatOrderId(h(7))).toBe("#0007");
    expect(formatOrderId(h(12345))).toBe("#12345");
  });
  it("formatBpsPercent / formatHoldDays", () => {
    expect(formatBpsPercent(250)).toBe("2.5");
    expect(formatBpsPercent(500)).toBe("5");
    expect(formatBpsPercent(10000)).toBe("100");
    expect(formatBpsPercent(1)).toBe("0.01");
    expect(formatHoldDays(604800)).toBe("7 days");
    expect(formatHoldDayCount(604800)).toBe("7");
    expect(formatHoldDayCount(86400)).toBe("1");
    expect(formatHoldDayCount(4294967295)).toBe("49,710");
    expect(formatHoldDays(86400)).toBe("1 day");
    expect(formatHoldDays(0)).toBe("0 days");
    expect(formatHoldDays(4294967295)).toBe("49,710 days");
  });
});
