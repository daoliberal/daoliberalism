import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { describe, expect, it } from "vitest";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import { useRun } from "@/oyun/sim/useRun";
import type { RunState, SimEvent, WeekPacket, World, WorldEvent } from "@/oyun/sim/types";
import type { CopyKey } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { createFakeSource } from "../helpers/fakeSource";

const W = Object.fromEntries(
  ["served","unemployed","employed","npc_firms","player_firms","failed_cum","city_cash_total","city_cash_weeks","gini","price_index","inflation_yoy","unemployment_rate","policy_rate","minted_year","mint_cap","loans_applied","loans_rejected","loans_granted","loan_rate_avg","support_weekly","survival_52","wage_index","rent_pct","occupancy","house_index","deposit_rate","bond_rate","lonca_fee_avg","royalty_avg","money_total","velocity","privatized_firms","no_founder","reject_pool","reject_reputation","no_buyer_cum"].map((k) => [k, null]),
) as World;
const wk = (week: number): SimEvent => ({ type: "week", packet: { v: 1, run_id: "r", week, version: 1, world: W, events: [] } satisfies WeekPacket });
const st = (runId: string): SimEvent => ({
  type: "state",
  state: { runId, status: "running", week: 1, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "s", name: "Ada", cityNames: [] } satisfies RunState,
});
const key = Object.keys(tr)[0] as CopyKey;

function setup(script: SimEvent[], runId: string | null, opts?: Parameters<typeof createFakeSource>[1]) {
  const src = createFakeSource(script, opts);
  const wrapper = ({ children }: { children: ReactNode }) => <SimSourceProvider source={src}>{children}</SimSourceProvider>;
  const hook = renderHook(({ id }: { id: string | null }) => useRun(id), { wrapper, initialProps: { id: runId } });
  return { src, ...hook };
}

describe("useRun", () => {
  it("haftalar 1,2,3", () => {
    const { result } = setup([st("r"), wk(1), wk(2), wk(3)], "r");
    expect(result.current.weeks.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(result.current.state?.runId).toBe("r");
  });
  it("aynı hafta bir kez", () => {
    const { result } = setup([wk(1), wk(1), wk(2)], "r");
    expect(result.current.weeks.map((w) => w.week)).toEqual([1, 2]);
  });
  it("sırasız gelen artan sıralanır", () => {
    const { result } = setup([wk(2), wk(1)], "r");
    expect(result.current.weeks.map((w) => w.week)).toEqual([1, 2]);
  });
  it("null runId abonelik açmaz", () => {
    const { src, result } = setup([wk(1)], null);
    expect(src.subscribeCalls).toBe(0);
    expect(result.current.weeks).toEqual([]);
    expect(result.current.state).toBeNull();
  });
  it("unmount aboneliği kapatır", () => {
    const { src, unmount } = setup([wk(1)], "r");
    expect(src.activeSubscriptions).toBe(1);
    unmount();
    expect(src.activeSubscriptions).toBe(0);
  });
  it("error olayı messageKey olarak yazılır", () => {
    const { result } = setup([{ type: "error", messageKey: key }], "r");
    expect(result.current.error).toBe(key);
  });
  it("canlı olay sonradan gelir", () => {
    const { src, result } = setup([wk(1)], "r");
    act(() => src.emit("r", wk(2)));
    expect(result.current.weeks.map((w) => w.week)).toEqual([1, 2]);
  });
  it("dikişte yeni runId haftaları sıfırlamaz", () => {
    const { src, result } = setup([wk(1), wk(2)], "r");
    act(() => src.emit("r", st("r2")));
    expect(result.current.state?.runId).toBe("r2");
    expect(result.current.weeks.map((w) => w.week)).toEqual([1, 2]);
    expect(src.activeSubscriptions).toBe(1);
  });
  it("500 hafta < 1000 ms", () => {
    const script = Array.from({ length: 500 }, (_, i) => wk(i + 1));
    const t0 = performance.now();
    const { result } = setup(script, "r");
    expect(result.current.weeks).toHaveLength(500);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it("world_event birikir, aynı kimlik bir kez", () => {
    const ev: WorldEvent = { id: "e1", week: 1, kind: "good", textKey: key, params: {}, critical: false, sector: null, rule_ids: [] };
    const { result } = setup([{ type: "world_event", event: ev }, { type: "world_event", event: ev }], "r");
    expect(result.current.events).toHaveLength(1);
  });

  it("packet.events birleşir, world_event ile aynı kimlik bir kez", () => {
    const ev: WorldEvent = { id: "cokus:40", week: 40, kind: "bad", textKey: key, params: { hafta: 40 }, critical: true, sector: null, rule_ids: [] };
    const pkt = (week: number): SimEvent => ({ type: "week", packet: { v: 1, run_id: "r", week, version: 1, world: W, events: [ev] } });
    const { result } = setup([pkt(40), pkt(41), { type: "world_event", event: ev }], "r");
    expect(result.current.events.map((e) => e.id)).toEqual(["cokus:40"]);
  });

  it("StrictMode: tek canlı abonelik, haftalar ikilenmez, son unmount kapatır", () => {
    const src = createFakeSource([st("r"), wk(1), wk(2)]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SimSourceProvider source={src}>{children}</SimSourceProvider>
    );
    const { result, unmount } = renderHook(() => useRun("r"), { wrapper, reactStrictMode: true });
    expect(src.subscribeCalls).toBeGreaterThanOrEqual(2);
    expect(src.activeSubscriptions).toBe(1);
    expect(src.disposed).toBe(0);
    expect(result.current.weeks.map((w) => w.week)).toEqual([1, 2]);
    expect(result.current.error).toBeNull();
    unmount();
    expect(src.activeSubscriptions).toBe(0);
    expect(src.disposed).toBe(0);
  });

  it("fake dispose sonrası çağrılar SimUnsupported(disposed) fırlatır", async () => {
    const src = createFakeSource([]);
    src.dispose();
    expect(() => src.subscribe("r", () => {})).toThrow(SimUnsupported);
    await expect(src.open("r")).rejects.toThrow("disposed");
    await expect(src.weeks("r", 1, 2)).rejects.toThrow("disposed");
  });

  it("bilinmeyen kimlikte gerçek hata anahtarı", () => {
    const { result } = setup([], "yok", { runId: "r" });
    expect(result.current.error).toBe("hata.kosu_bulunamadi");
  });
});

const ver = (n: number, week: number, set: string, withParam = true): SimEvent => ({
  type: "world_event",
  event: { id: `version:${n}:${week}:${set}`, week, kind: "neutral", textKey: "event.version" as CopyKey, params: withParam ? { hafta: week, surum: n } : { hafta: week }, critical: false, sector: null, rule_ids: [] },
});

describe("useRun: son inceleme", () => {
  it("I2: aynı hafta ikinci değişiklik, aynı sürüm numarası: eski sürüm olayı değişir", () => {
    const { result } = setup([ver(2, 6, "kisa"), ver(2, 6, "kurtarma")], "r");
    expect(result.current.events.map((e) => e.id)).toEqual(["version:2:6:kurtarma"]);
  });
  it("I2: daha küçük sürüm gelirse yüksek sürüm de düşer; daha yüksek sürüm eskiyi korur", () => {
    const { result } = setup([ver(2, 6, "kisa"), ver(3, 9, "kurtarma"), ver(3, 9, "kapali"), ver(2, 7, "kapali")], "r");
    expect(result.current.events.map((e) => e.id)).toEqual(["version:2:7:kapali"]);
    const b = setup([ver(2, 6, "kisa"), ver(3, 9, "kurtarma")], "r");
    expect(b.result.current.events.map((e) => e.id)).toEqual(["version:2:6:kisa", "version:3:9:kurtarma"]);
  });
  it("I2: sürüm olayında params.surum yoksa kimlikten okunur", () => {
    const { result } = setup([ver(2, 6, "kisa", false), ver(2, 6, "kurtarma", false)], "r");
    expect(result.current.events).toHaveLength(1);
  });
  it("I1: error sonraki state olayında temizlenir", () => {
    const { src, result } = setup([st("r")], "r");
    act(() => src.emit("r", { type: "error", messageKey: key }));
    expect(result.current.error).toBe(key);
    act(() => src.emit("r", st("r")));
    expect(result.current.error).toBeNull();
  });
});
