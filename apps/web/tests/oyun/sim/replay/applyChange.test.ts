import { describe, expect, it } from "vitest";
import { createReplaySource } from "@/oyun/sim/replay";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { parseRunId } from "@/oyun/sim/replay/runId";
import type { ChangeResult, RunConfig, SimEvent, SimSource, WeekPacket } from "@/oyun/sim/types";
import { fakeTimer, makeFetch, makeIndex, type Files, type Series } from "../../helpers/replayFixture";

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" }, ...over,
});
/** Kayit kumesine gore farkli seri: kurtarma 27'den, kisa 28'den ayrisir; kapali fonu 0 yazar (V2 taklidi). */
const series = (set: string): Series => (w) => ({
  served: set === "kurtarma" && w >= 27 ? 0.8 : set === "kisa" && w >= 28 ? 0.9 : w >= 60 && w < 90 ? 0.4 : 1,
  support_weekly: set === "kapali" ? 0 : null,
  gini: 0.3 + (set === "kurtarma" && w >= 27 ? 0.0001 * w : 0),
});
function filesFor(): Files {
  const files: Files = { "/k/index.json": JSON.stringify(makeIndex()) };
  for (const s of ["kapali", "kisa", "kurtarma"]) for (let i = 0; i < 6; i++) {
    const cols: Record<string, (number | null)[]> = {};
    const rows = Array.from({ length: 200 }, (_, j) => ({ served: 1, failed_cum: 0, loans_rejected: 0, city_cash_total: 100000, player_firms: 0, privatized_firms: 0, support_weekly: 0, gini: 0.3, ...series(s)(j + 1) }));
    for (const k of Object.keys(rows[0]!)) cols[k] = rows.map((r) => (r as Record<string, number | null>)[k] ?? null);
    files[`/k/${s}/pm${i}.json`] = JSON.stringify({ set: s, pm_index: i, weeks: 200, cols });
  }
  return files;
}
const flush = async (n = 20): Promise<void> => { for (let i = 0; i < n; i++) await Promise.resolve(); };
function setup(files: Files = filesFor()) {
  const timer = fakeTimer();
  const fetchImpl = makeFetch(files);
  const make = () => createReplaySource({ baseUrl: "/k", fetchImpl, timer, computeMs: 300 });
  return { timer, fetchImpl, src: make(), make };
}
async function at(src: SimSource, week: number, over?: Partial<RunConfig>) {
  const h = await src.start(cfg(over));
  const ev: SimEvent[] = [];
  src.subscribe(h.runId, (e) => ev.push(e));
  for (let i = 0; i < week; i++) await src.control(h.runId, { action: "step" });
  return { id: h.runId, ev };
}
async function change(src: SimSource, timer: ReturnType<typeof fakeTimer>, id: string, v: string): Promise<ChangeResult> {
  const p = src.applyChange(id, { from: "next_week", patch: { gecis_destegi: v } });
  await flush();
  timer.advance(300);
  return p;
}
const strip = (ps: WeekPacket[]) => ps.map((p) => ({ ...p, run_id: "" }));

describe("applyChange", () => {
  it("test_no_recording_rejected_run_untouched", async () => {
    const { src, timer } = setup();
    const { id } = await at(src, 5);
    await src.control(id, { action: "play" });
    const before = await src.weeks(id, 1, 200);
    const r = await src.applyChange(id, { from: "next_week", patch: { gecis_destegi: "yok" } });
    expect(r).toEqual({ accepted: false, fields: [{ id: "gecis_destegi", reason: "no_recording" }] });
    expect(await src.weeks(id, 1, 200)).toEqual(before);
    timer.advance(600);
    expect((await src.weeks(id, 1, 200)).length).toBe(6);
    await src.control(id, { action: "pause" });
  });
  it("test_change_after_end_rejected", async () => {
    const { src } = setup();
    const { id } = await at(src, 0);
    for (let i = 0; i < 205; i++) await src.control(id, { action: "step" });
    const st = await src.control(id, { action: "pause" });
    expect(st.status).toBe("ended");
    expect(await src.applyChange(id, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" } })).toEqual({ accepted: false, fields: [{ id: "*", reason: "ended" }] });
    expect(st.week).toBe(200);
  });
  it("test_same_scenario_noop", async () => {
    const { src } = setup();
    const { id } = await at(src, 3);
    const r = await src.applyChange(id, { from: "next_week", patch: { gecis_destegi: "kapali" } });
    expect(r).toMatchObject({ accepted: true, mode: "exact", seamWeek: 3, version: 1, runId: id });
    expect((await src.control(id, { action: "pause" })).version).toBe(1);
  });
  it("test_seam_before_27_is_exact (sentetik) ve 40'ta nearest", async () => {
    const a = setup();
    const x = await at(a.src, 26);
    expect(await change(a.src, a.timer, x.id, "kurtarma_fonuyla")).toMatchObject({ accepted: true, mode: "exact", scenarioId: "kurtarma", seamWeek: 26, version: 2 });
    const b = setup();
    const y = await at(b.src, 40);
    expect(await change(b.src, b.timer, y.id, "kurtarma_fonuyla")).toMatchObject({ accepted: true, mode: "nearest", seamWeek: 40 });
  });
  it("test_change_pauses_and_resumes_on_play + past weeks + version + olay + runId", async () => {
    const { src, timer } = setup();
    const { id, ev } = await at(src, 3);
    await src.control(id, { action: "play" });
    timer.advance(600);
    const before = await src.weeks(id, 1, 200);
    expect(before.length).toBe(4);
    const seam = 4;
    const p = src.applyChange(id, { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" } });
    const busy = await src.applyChange(id, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" } });
    expect(busy).toEqual({ accepted: false, fields: [{ id: "*", reason: "busy" }] });
    expect(await src.control(id, { action: "play" })).toMatchObject({ computing: true, status: "paused", week: seam });
    expect((await src.control(id, { action: "step" })).week).toBe(seam);
    await flush();
    timer.advance(300);
    const r = await p;
    expect(r).toMatchObject({ accepted: true, mode: "exact", scenarioId: "kurtarma", seamWeek: seam, version: 2 });
    if (!r.accepted) throw new Error("x");
    expect(r.runId).not.toBe(id);
    expect(parseRunId(r.runId, makeIndex())?.changes).toEqual([{ week: seam, setId: "kurtarma" }]);
    const st = ev.filter((e) => e.type === "state").at(-1);
    expect(st && st.type === "state" && st.state).toMatchObject({ runId: r.runId, status: "paused", computing: false, version: 2, scenarioId: "kurtarma", values: { gecis_destegi: "kurtarma_fonuyla" }, week: seam });
    const wev = ev.filter((e) => e.type === "world_event" && e.event.textKey === "event.version");
    expect(wev).toHaveLength(1);
    expect(wev[0]).toMatchObject({ event: { kind: "neutral", params: { hafta: seam, mod: expect.stringMatching(/^(exact|nearest)$/) }, rule_ids: ["gecis_destegi"], week: seam } });
    // gecmis degismez
    expect(await src.weeks(id, 1, 200)).toEqual(before);
    timer.advance(5000);
    expect((await src.weeks(id, 1, 200)).length).toBe(seam);
    // play seam+1'den devam
    await src.control(id, { action: "play" });
    timer.advance(600);
    const after = await src.weeks(r.runId, 1, 200);
    expect(after.map((q) => q.week)).toEqual([1, 2, 3, 4, 5]);
    expect(after[3]!.version).toBe(1);
    expect(after[4]!.version).toBe(2);
    const fresh = setup();
    const raw = await fresh.src.start(cfg({ values: { gecis_destegi: "kurtarma_fonuyla" } }));
    for (let i = 0; i < 6; i++) await fresh.src.control(raw.runId, { action: "step" });
    const rawW = await fresh.src.weeks(raw.runId, 1, 200);
    expect(after[4]!.world).toEqual(rawW[4]!.world);
    await src.control(r.runId, { action: "pause" });
  });
  it("test_old_runid_alias_still_controls + test_open_alias_does_not_reset", async () => {
    const { src, timer } = setup();
    const { id } = await at(src, 5);
    const r = await change(src, timer, id, "kisa_sureli");
    if (!r.accepted) throw new Error("x");
    expect((await src.control(id, { action: "step" })).week).toBe(6);
    const h = await src.open(id);
    expect(h?.runId).toBe(r.runId);
    expect(h?.state.week).toBe(6);
    expect((await src.open(r.runId))?.state.week).toBe(6);
    expect((await src.weeks(id, 1, 10)).length).toBe(6);
    const got: SimEvent[] = [];
    src.subscribe(id, (e) => got.push(e));
    expect(got.map((e) => e.type)).toEqual(["state", ...Array(6).fill("week"), "world_event"]);
  });
  it("test_events_recomputed_after_seam", async () => {
    // cokus 60'ta (kapali); hafta 70'te kurtarmaya gec: kurtarma serisi 27'den sonra 0.8 -> yeni seride cokus yok
    const { src, timer } = setup();
    const h = await src.start(cfg());
    for (let i = 0; i < 70; i++) await src.control(h.runId, { action: "step" });
    const old = await src.weeks(h.runId, 1, 200);
    expect(old.flatMap((p) => p.events).map((e) => e.id)).toContain("cokus:60");
    const r = await change(src, timer, h.runId, "kurtarma_fonuyla");
    if (!r.accepted) throw new Error("x");
    for (let i = 0; i < 20; i++) await src.control(r.runId, { action: "step" });
    const now = await src.weeks(r.runId, 1, 200);
    const ids = now.flatMap((p) => p.events).map((e) => e.id);
    expect(ids).toContain("cokus:60");
    expect(ids).not.toContain("toparlanma:90");
    expect(now.slice(0, 70).map((p) => p.events)).toEqual(old.map((p) => p.events));
    // 71+ kurtarma serisi (0.8): cokus bagami korunur -> toparlanma ilk yeni haftada (71)
    expect(ids).toContain("toparlanma:71");
  });
  it("test_runid_updated_and_reopenable", async () => {
    const { src, timer, make } = setup();
    const { id } = await at(src, 10);
    const r = await change(src, timer, id, "kisa_sureli");
    if (!r.accepted) throw new Error("x");
    for (let i = 0; i < 40; i++) await src.control(r.runId, { action: "step" });
    const live = await src.weeks(r.runId, 1, 200);
    const src2 = make();
    const h2 = await src2.open(r.runId);
    expect(h2).not.toBeNull();
    expect(h2!.state.week).toBe(0);
    for (let i = 0; i < 50; i++) await src2.control(h2!.runId, { action: "step" });
    const re = await src2.weeks(r.runId, 1, 200);
    expect(strip(re)).toEqual(strip(live));
    expect(re[10]!.version).toBe(2);
    expect(re[9]!.version).toBe(1);
    expect((await src2.open(id))?.state.version).toBe(1);
  });
  it("yukleme 404 -> invalid, kosu bozulmaz", async () => {
    const files = filesFor();
    delete files["/k/kurtarma/pm0.json"];
    const { src, timer } = setup(files);
    const { id, ev } = await at(src, 5);
    const r = await change(src, timer, id, "kurtarma_fonuyla");
    expect(r).toEqual({ accepted: false, fields: [{ id: "*", reason: "invalid" }] });
    expect(ev.some((e) => e.type === "error" && e.messageKey === "hata.degisiklik_basarisiz")).toBe(true);
    const st = await src.control(id, { action: "step" });
    expect(st).toMatchObject({ computing: false, week: 6, version: 1, scenarioId: "kapali" });
    expect((await src.weeks(id, 1, 10)).length).toBe(6);
  });
  const verEvents = (ev: SimEvent[]) => ev.flatMap((e) => (e.type === "world_event" && e.event.textKey === "event.version" ? [e.event] : []));
  it("reopen: dikis haftasi gecilince event.version bir kez; canli kosuda da bir kez; gec abone gorur", async () => {
    const { src, timer, make } = setup();
    const { id, ev } = await at(src, 5);
    const r = await change(src, timer, id, "kisa_sureli");
    if (!r.accepted) throw new Error("x");
    for (let i = 0; i < 4; i++) await src.control(r.runId, { action: "step" });
    expect(verEvents(ev)).toHaveLength(1);
    expect(verEvents(ev)[0]!.params).toEqual({ hafta: 5, mod: r.mode, surum: 2 });
    const late: SimEvent[] = [];
    src.subscribe(r.runId, (e) => late.push(e));
    expect(verEvents(late)).toHaveLength(1);
    const src2 = make();
    const h2 = await src2.open(r.runId);
    const ev2: SimEvent[] = [];
    src2.subscribe(h2!.runId, (e) => ev2.push(e));
    for (let i = 0; i < 4; i++) await src2.control(h2!.runId, { action: "step" });
    expect(verEvents(ev2)).toHaveLength(0);
    await src2.control(h2!.runId, { action: "step" });
    await src2.control(h2!.runId, { action: "step" });
    expect(verEvents(ev2)).toHaveLength(1);
    expect(verEvents(ev2)[0]).toMatchObject({ params: { hafta: 5, mod: r.mode, surum: 2 }, week: 5, rule_ids: ["gecis_destegi"] });
    expect(verEvents(ev2)[0]!.id).toBe(verEvents(ev)[0]!.id);
  });
  it("dispose hesaplama sirasinda: dikis yok, olay yok", async () => {
    const { src, timer } = setup();
    const { id, ev } = await at(src, 5);
    const p = src.applyChange(id, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" } });
    p.catch(() => {});
    await flush();
    const n = ev.length;
    src.dispose();
    timer.advance(1000);
    await flush();
    await expect(p).rejects.toBeInstanceOf(SimUnsupported);
    expect(ev.length).toBe(n);
    expect(verEvents(ev)).toHaveLength(0);
    expect(timer.pending).toBe(0);
  });
  it("yukleme hatasi: calisan kosu calismaya devam eder", async () => {
    const files = filesFor();
    delete files["/k/kurtarma/pm0.json"];
    const { src, timer } = setup(files);
    const { id } = await at(src, 5);
    await src.control(id, { action: "play" });
    const r = await change(src, timer, id, "kurtarma_fonuyla");
    expect(r).toMatchObject({ accepted: false });
    expect((await src.control(id, { action: "pause" })).status).toBe("paused");
    await src.control(id, { action: "play" });
    timer.advance(600);
    expect((await src.weeks(id, 1, 200)).length).toBe(6);
    const again = setup(files);
    const x = await at(again.src, 5);
    await again.src.control(x.id, { action: "play" });
    const p = again.src.applyChange(x.id, { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" } });
    await flush();
    again.timer.advance(300);
    await p;
    expect((await again.src.control(x.id, { action: "step" })).status).toBe("running");
  });
  it("hafta 0 degisikligi: taban kume degisir, surum artmaz, yeniden acilir", async () => {
    const { src, timer, make } = setup();
    const { id } = await at(src, 0);
    const r = await change(src, timer, id, "kurtarma_fonuyla");
    expect(r).toMatchObject({ accepted: true, mode: "exact", seamWeek: 0, version: 1, scenarioId: "kurtarma" });
    if (!r.accepted) throw new Error("x");
    expect(parseRunId(r.runId, makeIndex())).toMatchObject({ setId: "kurtarma", changes: [] });
    const h = await make().open(r.runId);
    expect(h?.state.scenarioId).toBe("kurtarma");
  });
  it("ayni haftada ikinci degisiklik son dikisi degistirir", async () => {
    const { src, timer, make } = setup();
    const { id } = await at(src, 6);
    const a = await change(src, timer, id, "kisa_sureli");
    if (!a.accepted) throw new Error("x");
    const b = await change(src, timer, a.runId, "kurtarma_fonuyla");
    if (!b.accepted) throw new Error("x");
    expect(b.version).toBe(2);
    expect(parseRunId(b.runId, makeIndex())?.changes).toEqual([{ week: 6, setId: "kurtarma" }]);
    expect((await src.control(id, { action: "step" })).runId).toBe(b.runId);
    const h = await make().open(b.runId);
    expect(h?.state.version).toBe(1);
  });
  it("iki dikisli tarif yeniden acilir, paketler esit", async () => {
    const { src, timer, make } = setup();
    const { id } = await at(src, 10);
    const a = await change(src, timer, id, "kisa_sureli");
    if (!a.accepted) throw new Error("x");
    for (let i = 0; i < 20; i++) await src.control(a.runId, { action: "step" });
    const b = await change(src, timer, a.runId, "kurtarma_fonuyla");
    if (!b.accepted) throw new Error("x");
    expect(b.version).toBe(3);
    for (let i = 0; i < 20; i++) await src.control(b.runId, { action: "step" });
    const live = await src.weeks(b.runId, 1, 200);
    const src2 = make();
    const h2 = await src2.open(b.runId);
    for (let i = 0; i < 50; i++) await src2.control(h2!.runId, { action: "step" });
    const re = await src2.weeks(b.runId, 1, 200);
    expect(strip(re)).toEqual(strip(live));
    expect([re[9]!.version, re[10]!.version, re[29]!.version, re[30]!.version]).toEqual([1, 2, 2, 3]);
    expect((await src2.control(b.runId, { action: "pause" })).version).toBe(3);
  });
  it("gelecekteki dikisler yeni kararla degisir; surum/olay kimlikleri reopen ile uyumlu", async () => {
    const { src, timer, make } = setup();
    const { id } = await at(src, 6);
    const a = await change(src, timer, id, "kisa_sureli");
    if (!a.accepted) throw new Error("x");
    for (let i = 0; i < 6; i++) await src.control(a.runId, { action: "step" });
    const b = await change(src, timer, a.runId, "kurtarma_fonuyla");
    if (!b.accepted) throw new Error("x");
    expect(parseRunId(b.runId, makeIndex())?.changes).toEqual([{ week: 6, setId: "kisa" }, { week: 12, setId: "kurtarma" }]);
    const src2 = make();
    const h = await src2.open(b.runId);
    for (let i = 0; i < 4; i++) await src2.control(h!.runId, { action: "step" });
    const c = await change(src2, timer, h!.runId, "kisa_sureli");
    expect(c).toMatchObject({ accepted: true, seamWeek: 4, version: 2, scenarioId: "kisa" });
    if (!c.accepted) throw new Error("x");
    expect(parseRunId(c.runId, makeIndex())?.changes).toEqual([{ week: 4, setId: "kisa" }]);
    const ev: SimEvent[] = [];
    src2.subscribe(c.runId, (e) => ev.push(e));
    for (let i = 0; i < 12; i++) await src2.control(c.runId, { action: "step" });
    const live = await src2.weeks(c.runId, 1, 200);
    expect(live.map((p) => p.version)).toEqual([...Array(4).fill(1), ...Array(12).fill(2)]);
    const src3 = make();
    const h3 = await src3.open(c.runId);
    const ev3: SimEvent[] = [];
    src3.subscribe(h3!.runId, (e) => ev3.push(e));
    for (let i = 0; i < 16; i++) await src3.control(h3!.runId, { action: "step" });
    expect(strip(await src3.weeks(c.runId, 1, 200))).toEqual(strip(live));
    expect(verEvents(ev3).map((e) => e.id)).toEqual(["version:2:4:kisa"]);
    expect(verEvents(ev).map((e) => e.id)).toEqual(["version:2:4:kisa"]);
  });
  it("ayni hafta ikinci degisiklik: gec abone yalniz sonuncuyu gorur", async () => {
    const { src, timer } = setup();
    const { id } = await at(src, 6);
    const a = await change(src, timer, id, "kisa_sureli");
    if (!a.accepted) throw new Error("x");
    const b = await change(src, timer, a.runId, "kurtarma_fonuyla");
    if (!b.accepted) throw new Error("x");
    const late: SimEvent[] = [];
    src.subscribe(b.runId, (e) => late.push(e));
    expect(verEvents(late).map((e) => e.id)).toEqual(["version:2:6:kurtarma"]);
  });
});
