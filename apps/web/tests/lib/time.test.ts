import { describe, expect, it } from "vitest";
import {
  formatDate, formatDuration, formatReleaseDate, formatReleaseIn, formatShortDate,
  holdProgressPct, isNeverRelease,
} from "@/lib/time";

const MAX = 2n ** 64n - 1n;
const NOW = 1792576800n; // 2026-10-21T10:00:00Z
const DAY = 86400n;

describe("time (UTC)", () => {
  it("formats dates from timestamps", () => {
    expect(formatDate(1793059200n)).toBe("27 Oct 2026");
    expect(formatDate(1793145600n)).toBe("28 Oct 2026");
    expect(formatDate(NOW + 604800n)).toBe("28 Oct 2026");
    expect(formatShortDate(1792159200n)).toBe("16 Oct");
    expect(formatDate(MAX)).toBe("—");
  });
  it("never releases", () => {
    expect(isNeverRelease(MAX)).toBe(true);
    expect(isNeverRelease(253402300800n)).toBe(true);
    expect(isNeverRelease(253402300799n)).toBe(false);
    expect(formatReleaseDate(MAX)).toBe("never releases");
    expect(formatReleaseDate(253402300800n)).toBe("never releases");
    expect(formatReleaseDate(1793145600n)).toBe("28 Oct 2026");
  });
  it("formatReleaseIn / formatDuration", () => {
    expect(formatReleaseIn(MAX, NOW)).toBe("never releases");
    expect(formatReleaseIn(NOW + 2n * DAY + 4n * 3600n, NOW)).toBe("in 2 d 04 h · 23 Oct");
    expect(formatReleaseIn(NOW, NOW)).toBe("Available");
    expect(formatReleaseIn(NOW - 5n, NOW)).toBe("Available");
    expect(formatDuration(2n * DAY + 4n * 3600n + 59n)).toBe("2 d 04 h");
    expect(formatDuration(9n * DAY + 11n * 3600n)).toBe("9 d 11 h");
  });
  it("holdProgressPct", () => {
    const credited = NOW - (4n * DAY + 20n * 3600n);
    expect(holdProgressPct(credited, credited + 7n * DAY, NOW)).toBe(69);
    expect(holdProgressPct(NOW, NOW + 7n * DAY, NOW - 10n)).toBe(0);
    expect(holdProgressPct(NOW, NOW + 7n * DAY, NOW + 8n * DAY)).toBe(100);
    expect(holdProgressPct(NOW, NOW, NOW)).toBe(100);
    expect(holdProgressPct(NOW, MAX, NOW + DAY)).toBe(0);
  });
});
