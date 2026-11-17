import { describe, expect, expectTypeOf, it } from "vitest";
import type { ChangeResult, RunState, SimSource, WeekPacket, World } from "@/oyun/sim/types";
import { createFakeSource } from "../helpers/fakeSource";

const nullWorld: World = {
  served: null, unemployed: null, employed: null, npc_firms: null, player_firms: null, failed_cum: null,
  city_cash_total: null, city_cash_weeks: null, gini: null, price_index: null, inflation_yoy: null,
  unemployment_rate: null, policy_rate: null, minted_year: null, mint_cap: null, loans_applied: null,
  loans_rejected: null, loans_granted: null, loan_rate_avg: null, support_weekly: null, survival_52: null,
  wage_index: null, rent_pct: null, occupancy: null, house_index: null, deposit_rate: null, bond_rate: null,
  lonca_fee_avg: null, royalty_avg: null, money_total: null, velocity: null, privatized_firms: null,
  no_founder: null, reject_pool: null, reject_reputation: null, no_buyer_cum: null, support_denied: null, policy_unemployment: null, city_spend_cut: null, tenants_per_house: null, house_resale_ratio: null, policy_inflation: null, minted_total: null,
};

describe("veri sözleşmesi", () => {
  it("WeekPacket: world alanları sayı ya da null", () => {
    const p = {
      v: 1, run_id: "r", week: 3, version: 1, events: [],
      world: { ...nullWorld, served: 0.9, gini: 0.31 },
    } satisfies WeekPacket;
    expect(p.world.price_index).toBeNull();
    // @ts-expect-error eksik world alanı
    const bad: WeekPacket = { v: 1, run_id: "r", week: 1, version: 1, events: [], world: { served: null } };
    void bad;
  });

  it("RunState runId taşır; runId'siz örnek derlenmez", () => {
    const s = {
      runId: "a", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1,
      seedIndex: 0, values: { gecis_destegi: "kapali" }, scenarioId: "kapali.0", name: "Ada", cityNames: [],
    } satisfies RunState;
    expect(s.runId).toBe("a");
    // @ts-expect-error runId zorunlu
    const bad: RunState = { status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "x" };
    void bad;
    expectTypeOf<NonNullable<RunState["endedReason"]>>().toEqualTypeOf<"duration">();
  });

  it("ChangeResult ayrımı daraltılır", () => {
    const ok = { accepted: true, runId: "r2", mode: "exact", scenarioId: "kisa.0", seamWeek: 26, version: 2 } satisfies ChangeResult;
    // @ts-expect-error runId zorunlu
    const noId: ChangeResult = { accepted: true, mode: "exact", scenarioId: "k", seamWeek: 1, version: 2 };
    void noId;
    const r = ok as ChangeResult;
    if (r.accepted) {
      expect(r.mode).toBe("exact");
      // @ts-expect-error reddedilmiş dala özgü
      void r.fields;
    } else {
      expect(r.fields).toBeDefined();
      // @ts-expect-error kabul dalına özgü
      void r.mode;
    }
  });

  it("createFakeSource SimSource'u karşılar", () => {
    const src = createFakeSource([]) satisfies SimSource;
    expect(src.kind).toBe("replay");
    expect(Object.values(src.capabilities).every((v) => v === false)).toBe(true);
  });
});
