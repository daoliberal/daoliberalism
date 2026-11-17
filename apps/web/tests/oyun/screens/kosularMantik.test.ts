import { describe, expect, it } from "vitest";
import { girdiOf } from "@/oyun/screens/kosular/kosularMantik";
import type { RunState } from "@/oyun/sim/types";

const state = (over: Partial<RunState> = {}): RunState => ({
  runId: "r", status: "paused", week: 3, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "dayanikli_taban", name: "Ada",
  cityNames: ["a", "b", "c", "d", "e"], ...over,
});

describe("girdiOf", () => {
  it("name_over_64_is_a_field_error_not_trimmed", () => {
    expect(girdiOf(state({ name: "u".repeat(64) }), "live", new Date()).ok).toBe(true);
    expect(girdiOf(state({ name: "u".repeat(65) }), "live", new Date())).toEqual({ ok: false, neden: "ad_uzun" });
  });

  it("previous_entry_supplies_parent_fork_week_and_the_users_name_when_the_state_has_none", () => {
    const onceki = { id: "r", name: "Benim adım", recipe: { v: 1 as const, templateId: "x", durationWeeks: 100, seedIndex: 0, values: {} }, savedAt: "2026-10-29T10:00:00.000Z", source: "live" as const, parentId: "kok", forkWeek: 9 };
    const g = girdiOf(state(), "live", new Date(), onceki);
    expect(g.ok && g.run).toMatchObject({ parentId: "kok", forkWeek: 9, name: "Benim adım" });
    const d = girdiOf(state({ parentRunId: "baska", forkWeek: 4 }), "live", new Date(), onceki);
    expect(d.ok && d.run).toMatchObject({ parentId: "baska", forkWeek: 4 });
  });
});
