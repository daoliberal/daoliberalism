import { describe, expect, it } from "vitest";
import { computeResult, jobResult, KASA_TABAN_HAFTA, SERVE_ESIK, GINI_ESIK } from "@/oyun/sim/result";
import type { GoalId, Job, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";

const NULLS = packetOf("r", 1, 1).world;

/** `n` haftalık sentetik koşu: her hafta için dünya alanları `f(week)` ile üzerine yazılır. */
function run(n: number, f: (w: number) => Partial<World> = () => ({}), events: Record<number, WorldEvent[]> = {}): WeekPacket[] {
  return Array.from({ length: n }, (_, i) => {
    const w = i + 1;
    return { ...packetOf("r", w, 1), world: { ...NULLS, served: 0.9, city_cash_total: 50000, city_cash_weeks: 5, gini: 0.5, ...f(w) }, events: events[w] ?? [] };
  });
}
const ev = (id: string, hafta: number): WorldEvent => ({ id: `${id}:${hafta}`, week: hafta, kind: "bad", textKey: "event.cokus", params: { hafta }, critical: true, sector: null, rule_ids: [] });
const ALL: GoalId[] = ["alive", "serve", "kasa", "gini"];
const goal = (r: ReturnType<typeof computeResult>, id: GoalId) => r.goals.find((g) => g.id === id)!;

describe("computeResult", () => {
  it("collapse_and_recovery_weeks_synthetic", () => {
    const weeks = run(80, () => ({}), { 57: [ev("cokus", 57)], 70: [ev("toparlanma", 70)] });
    const r = computeResult(weeks, ALL, 200);
    expect(r.collapseWeek).toBe(57);
    expect(r.recoveryWeek).toBe(70);
    expect(goal(r, "alive")).toMatchObject({ met: false, reason: null, value: 57 });
    expect(r.over).toBe(true); // çöküşten 10 hafta sonra kesinleşir
  });

  it("collapse_ten_weeks_rule_and_extra_events", () => {
    const weeks = run(66);
    expect(computeResult(weeks, ALL, 200, [ev("cokus", 57)]).over).toBe(false);
    expect(computeResult(run(67), ALL, 200, [ev("cokus", 57)]).over).toBe(true);
  });

  it("no_collapse_nulls", () => {
    const r = computeResult(run(120), ALL, 200);
    expect(r.collapseWeek).toBeNull();
    expect(r.recoveryWeek).toBeNull();
    expect(goal(r, "alive")).toMatchObject({ met: null, reason: "pending", value: null });
    const done = computeResult(run(200), ALL, 200);
    expect(done.over).toBe(true);
    expect(goal(done, "alive").met).toBe(true);
  });

  it("goal_unmeasurable_null", () => {
    const weeks = run(200, () => ({ served: null, city_cash_weeks: null, gini: null }));
    const r = computeResult(weeks, ALL, 200);
    for (const id of ["serve", "kasa", "gini"] as const) expect(goal(r, id), id).toMatchObject({ met: null, reason: "unmeasured", value: null });
    expect(goal(r, "alive").met).toBe(true);
  });

  it("serve_uses_last_30_weeks_average_and_waits_until_over", () => {
    const weeks = run(200, (w) => ({ served: w > 170 ? SERVE_ESIK : 0.1 }));
    expect(goal(computeResult(weeks, ALL, 200), "serve")).toMatchObject({ met: true, value: SERVE_ESIK });
    const low = run(200, (w) => ({ served: w > 170 ? SERVE_ESIK - 0.01 : 0.99 }));
    expect(goal(computeResult(low, ALL, 200), "serve").met).toBe(false);
    expect(goal(computeResult(run(100), ALL, 200), "serve")).toMatchObject({ met: null, reason: "pending" });
  });

  it("serve_ignores_missing_weeks_in_window", () => {
    const weeks = run(200, (w) => ({ served: w === 199 ? null : 0.85 }));
    expect(goal(computeResult(weeks, ALL, 200), "serve")).toMatchObject({ met: true });
  });

  it("kasa_uses_the_models_cash_floor_in_weeks_of_expense_not_a_money_constant", () => {
    // Model kasa tabanı: kasa, sönümlü haftalık zorunlu giderin KASA_TABAN_HAFTA katının altına inmemeli (TRANS_FLOOR_WEEKS).
    const dip = run(60, (w) => ({ city_cash_weeks: w === 30 ? KASA_TABAN_HAFTA - 0.1 : 5, city_cash_total: 1 }));
    expect(goal(computeResult(dip, ALL, 200), "kasa")).toMatchObject({ met: false, value: KASA_TABAN_HAFTA - 0.1 });
    // Para tutarı hükmü etkilemez (eski sabit 24 bin yok): küçük toplam, yeterli hafta sayısı.
    expect(goal(computeResult(run(200, () => ({ city_cash_total: 100, city_cash_weeks: 3 })), ALL, 200), "kasa")).toMatchObject({ met: true, value: 3 });
    const early = run(60, (w) => ({ city_cash_weeks: w <= 13 ? 0 : 5 }));
    expect(goal(computeResult(early, ALL, 200), "kasa")).toMatchObject({ met: null, reason: "pending", value: 5 });
  });

  it("kasa_null_when_the_floor_rule_is_off_means_olculmedi", () => {
    const r = computeResult(run(200, () => ({ city_cash_weeks: null, city_cash_total: 50000 })), ALL, 200);
    expect(goal(r, "kasa")).toMatchObject({ met: null, reason: "unmeasured", value: null });
  });

  it("gini_is_last_value_at_the_end", () => {
    const hi = run(200, () => ({ gini: GINI_ESIK + 0.01 }));
    expect(goal(computeResult(hi, ALL, 200), "gini")).toMatchObject({ met: false });
    expect(goal(computeResult(run(200, () => ({ gini: GINI_ESIK })), ALL, 200), "gini")).toMatchObject({ met: true, value: GINI_ESIK });
    expect(goal(computeResult(run(50), ALL, 200), "gini")).toMatchObject({ met: null, reason: "pending" });
  });

  it("selected_flags_follow_goals_and_empty_run_is_safe", () => {
    const r = computeResult(run(10), ["serve"], 200);
    expect(r.goals.map((g) => [g.id, g.selected])).toEqual([["alive", false], ["serve", true], ["kasa", false], ["gini", false]]);
    const empty = computeResult([], undefined, 200);
    expect(empty).toMatchObject({ week: 0, over: false, collapseWeek: null });
    expect(empty.goals.every((g) => !g.selected && g.met === null && g.reason === "pending")).toBe(true);
  });
});

describe("jobResult", () => {
  const member = (label: string, seedIndex: number, status: Job["members"][number]["status"], served: number[], error?: string): Job["members"][number] => ({
    label, seedIndex, status, weeks: served.length, series: { served, failed_cum: [], city_cash_total: [], gini: [], unemployment_rate: [] }, ...(error ? { error } : {}),
  });
  it("splits_done_members_into_lines_and_failed_into_warnings", () => {
    const job: Job = {
      jobId: "job-00000001", kind: "seeds", status: "done", progress: { done: 5, total: 6 },
      members: [member("seed-0", 0, "done", [0.9]), member("seed-1", 1, "failed", [0.5], "model_error"), member("seed-2", 2, "done", [0.8])],
    };
    const r = jobResult(job);
    expect(r.lines.map((l) => l.seedIndex)).toEqual([0, 2]);
    expect(r.failed).toEqual([{ label: "seed-1", seedIndex: 1, error: "model_error" }]);
  });
});
