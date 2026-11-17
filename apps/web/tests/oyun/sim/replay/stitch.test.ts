import { describe, expect, it } from "vitest";
import { prefixEqual, stitch } from "@/oyun/sim/replay/stitch";
import type { WeekPacket, World } from "@/oyun/sim/types";

const world = (o: Partial<World>): World => ({ served: 1, support_weekly: null, gini: 0.3, ...o }) as World;
const mk = (tag: string, n: number, version = 1, w?: (week: number) => Partial<World>): WeekPacket[] =>
  Array.from({ length: n }, (_, i) => ({ v: 1, run_id: tag, week: i + 1, version, world: world(w?.(i + 1) ?? {}), events: [] }));

describe("stitch", () => {
  const base = mk("A", 10);
  const next = mk("B", 10, 1, (w) => ({ gini: 0.5 + w }));
  it("seam ortada: <= seam base, > seam next, version yalnız sonrası", () => {
    const out = stitch(base, next, 4, 2);
    expect(out).toHaveLength(10);
    expect(out.slice(0, 4).every((p, i) => p === base[i])).toBe(true);
    expect(out.slice(4).map((p) => [p.run_id, p.week, p.version, p.world.gini])).toEqual(
      next.slice(4).map((p) => ["B", p.week, 2, p.world.gini]));
    expect(next[5]!.version).toBe(1);
  });
  it("seam 0: tamamı next", () => {
    const out = stitch(base, next, 0, 3);
    expect(out.map((p) => p.version)).toEqual(Array(10).fill(3));
    expect(out.every((p) => p.run_id === "B")).toBe(true);
  });
  it("seam sonda: tamamı base", () => {
    const out = stitch(base, next, 10, 2);
    expect(out).toHaveLength(10);
    expect(out.every((p, i) => p === base[i])).toBe(true);
  });
  it("seam 200 / uzunluk next kadar", () => {
    const b = mk("A", 200);
    const n = mk("B", 200);
    expect(stitch(b, n, 200, 2)).toHaveLength(200);
    expect(stitch(b, n, 100, 2)).toHaveLength(200);
    expect(stitch(b, mk("B", 8), 4, 2)).toHaveLength(8);
  });
});

describe("prefixEqual", () => {
  it("upToWeek=0 -> true", () => {
    expect(prefixEqual(mk("A", 3), mk("B", 3, 1, () => ({ gini: 9 })), 0)).toBe(true);
  });
  it("null olan alan atlanir (null vs sayi)", () => {
    const a = mk("A", 5, 1, () => ({ support_weekly: null }));
    const b = mk("B", 5, 1, () => ({ support_weekly: 0 }));
    expect(prefixEqual(a, b, 5)).toBe(true);
  });
  it("iki tarafta farkli sayi -> false; kapsayici", () => {
    const a = mk("A", 5);
    const b = mk("B", 5, 1, (w) => (w === 4 ? { served: 0.9 } : {}));
    expect(prefixEqual(a, b, 3)).toBe(true);
    expect(prefixEqual(a, b, 4)).toBe(false);
  });
});
