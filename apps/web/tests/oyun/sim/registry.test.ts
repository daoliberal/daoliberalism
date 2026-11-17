import { describe, expect, it } from "vitest";
import { loadRegistry } from "@/oyun/sim/registry";
import { createFakeSource } from "../helpers/fakeSource";
import { contractRegistry } from "../helpers/registryFixtures";
import type { SimSource } from "@/oyun/sim/types";

describe("loadRegistry", () => {
  it("loads_from_info_and_caches_per_source", async () => {
    const src = createFakeSource([]);
    let calls = 0;
    const orig = src.info;
    src.info = async () => (calls++, orig());
    const a = await loadRegistry(src);
    const b = await loadRegistry(src);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(a.cards).toHaveLength(contractRegistry().cards.length);
  });

  it("prefers_source_registry_method", async () => {
    const src = createFakeSource([]) as SimSource;
    const reg = contractRegistry();
    const own: SimSource = { ...src, registry: async () => ({ ...reg, cards: reg.cards.slice(0, 1) }) };
    expect((await loadRegistry(own)).cards).toHaveLength(1);
  });

  it("failure_is_not_cached", async () => {
    const src = createFakeSource([]);
    let n = 0;
    const orig = src.info;
    src.info = async () => {
      if (n++ === 0) throw new Error("x");
      return orig();
    };
    await expect(loadRegistry(src)).rejects.toThrow();
    expect((await loadRegistry(src)).cards.length).toBeGreaterThan(0);
  });

  it("missing_registry_rejects", async () => {
    const src = createFakeSource([]);
    src.info = async () => ({ kind: "replay", modelNote: "", seeds: [], durationWeeks: 1, settings: [], fixedRules: [], templates: [] });
    await expect(loadRegistry(src)).rejects.toThrow();
  });
});
