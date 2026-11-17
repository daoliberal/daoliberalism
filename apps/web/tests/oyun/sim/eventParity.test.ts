import { afterEach, describe, expect, it } from "vitest";
import { createLiveSource } from "@/oyun/sim/live";
import { createReplaySource } from "@/oyun/sim/replay";
import type { RunConfig, SimEvent, SimSource, WeekPacket, WorldEvent } from "@/oyun/sim/types";
import { createFakeLiveServer } from "../helpers/fakeLiveServer";
import { allFiles, fakeTimer, makeFetch, type Series } from "../helpers/replayFixture";

/** L2 incelemesi: aynı paket dizisi kayıt ve canlı kaynağa verilince dünya olayları (kimlik, sıra, parametre) eşit olmalı. */
const SERIES: Series = (w) => ({
  served: w >= 30 && w < 50 ? 0.45 : w >= 50 ? 0.82 : w >= 10 && w < 14 ? 0.66 : 1,
  failed_cum: Math.floor(w / 6),
  loans_rejected: w > 25 ? 4 : 0,
  city_cash_total: w > 60 ? 20000 : 100000,
  player_firms: w >= 40 ? 22 : 3,
  privatized_firms: w >= 70 ? 2 : 0,
  support_weekly: w >= 5 ? 120 : 0,
});
const WEEKS = 90;
const cfg: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } };
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let toDispose: SimSource[] = [];
afterEach(() => { toDispose.forEach((s) => s.dispose()); toDispose = []; });

const worldEvents = (es: SimEvent[]): WorldEvent[] => es.flatMap((e) => (e.type === "world_event" ? [e.event] : []));
const packets = (es: SimEvent[]): WeekPacket[] => es.flatMap((e) => (e.type === "week" ? [e.packet] : []));

describe("olay eşitliği: ReplaySource == LiveSource", () => {
  it("test_same_packets_same_events", async () => {
    const replay = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(allFiles(SERIES)), timer: fakeTimer() });
    toDispose.push(replay);
    const rh = await replay.start(cfg);
    const rEv: SimEvent[] = [];
    replay.subscribe(rh.runId, (e) => rEv.push(e));
    for (let i = 0; i < WEEKS; i += 1) await replay.control(rh.runId, { action: "step" });
    const given = packets(rEv);
    expect(given).toHaveLength(WEEKS);

    const server = createFakeLiveServer();
    const live = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    toDispose.push(live);
    const lh = await live.start(cfg);
    const lEv: SimEvent[] = [];
    live.subscribe(lh.runId, (e) => lEv.push(e));
    await flush();
    for (const p of given) server.push(lh.runId, "week", JSON.stringify({ ...p, run_id: lh.runId, events: [] }));

    const re = worldEvents(rEv);
    const le = worldEvents(lEv);
    expect(re.length).toBeGreaterThanOrEqual(5); // veri gerçekten olay üretiyor
    expect(new Set(re.map((e) => e.rule_ids[0])).size).toBeGreaterThanOrEqual(5);
    expect(le).toEqual(re);
    expect(packets(lEv).map((p) => p.events)).toEqual(given.map((p) => p.events));
  });
});
