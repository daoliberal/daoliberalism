import { describe, expect, it } from "vitest";
import { tarifKapaliNedeni, tarifOf } from "@/oyun/screens/canli/SifirdanBaslat";
import { createReplaySource } from "@/oyun/sim/replay";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import type { RunConfig, SimEvent, SimSource } from "@/oyun/sim/types";
import { allFiles, fakeTimer, makeFetch, type Files, type Series } from "../../helpers/replayFixture";

const cfg = (over: Partial<RunConfig> = {}): RunConfig => ({
  name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" }, ...over,
});
function setup(series?: Series, files: Files = allFiles(series)) {
  const timer = fakeTimer();
  const src = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(files), timer });
  return { timer, src };
}
async function started(src: SimSource, over?: Partial<RunConfig>) {
  const h = await src.start(cfg(over));
  const ev: SimEvent[] = [];
  const off = src.subscribe(h.runId, (e) => ev.push(e));
  return { h, ev, off, weeks: () => ev.flatMap((e) => (e.type === "week" ? [e.packet.week] : [])) };
}
const COLLAPSE: Series = (w) => ({ served: w >= 40 && w < 80 ? 0.45 : w >= 80 ? 0.75 : w >= 20 && w < 25 ? 0.45 : 1 });

describe("ReplaySource", () => {
  it("kimlik, start ready hafta 0, info", async () => {
    const { src } = setup();
    expect(src.kind).toBe("replay");
    // W10: kayıtta yalnız "aynı şartı altı dünyada koş" açıktır (kayıtlı altı başlangıç dünyası); öteki yetenekler kapalı.
    expect(Object.entries(src.capabilities).filter(([, v]) => v).map(([k]) => k)).toEqual(["seeds"]);
    const h = await src.start(cfg());
    expect(h.state).toMatchObject({ status: "ready", week: 0, speed: 1, version: 1, durationWeeks: 200, computing: false, seedIndex: 0, scenarioId: "kapali", runId: h.runId });
    const info = await src.info();
    expect(info).toMatchObject({ kind: "replay", modelNote: "not", durationWeeks: 200 });
    expect(info.seeds).toHaveLength(6);
    expect(info.settings).toEqual([{ id: "gecis_destegi", options: [
      { value: "kapali", available: true }, { value: "kisa_sureli", available: true }, { value: "kurtarma_fonuyla", available: true }] }]);
    expect(info.fixedRules).toHaveLength(1);
    expect(info.templates[0]!.id).toBe("dayanikli_taban");
  });
  it("availability", async () => {
    const { src } = setup();
    expect(await src.availability({ gecis_destegi: "yok" })).toMatchObject({ ok: false, scenarioId: null });
    expect((await src.availability({ gecis_destegi: "yok" })).blocked[0]).toMatchObject({ settingId: "gecis_destegi", reason: "no_recording" });
    expect(await src.availability({})).toEqual({ ok: true, scenarioId: "kapali", blocked: [] });
    expect((await src.availability({ gecis_destegi: "kisa_sureli" })).scenarioId).toBe("kisa");
  });
  it("tohum 6 reddedilir", async () => {
    const { src } = setup();
    await expect(src.start(cfg({ seedIndex: 6 }))).rejects.toBeInstanceOf(SimUnsupported);
    await expect(src.start(cfg({ values: { gecis_destegi: "yok" } }))).rejects.toBeInstanceOf(SimUnsupported);
    await expect(src.start(cfg({ durationWeeks: 201 }))).rejects.toBeInstanceOf(SimUnsupported);
  });
  it("subscribe: once state, sonra mevcut haftalar, sonra canli", async () => {
    const { src, timer } = setup();
    const h = await src.start(cfg());
    await src.control(h.runId, { action: "step" });
    await src.control(h.runId, { action: "step" });
    const ev: SimEvent[] = [];
    src.subscribe(h.runId, (e) => ev.push(e));
    expect(ev.map((e) => e.type)).toEqual(["state", "week", "week"]);
    await src.control(h.runId, { action: "play" });
    timer.advance(600);
    expect(ev.filter((e) => e.type === "week").at(-1)).toMatchObject({ packet: { week: 3 } });
  });
  it("test_play_emits_weeks_in_order", async () => {
    const { src, timer } = setup();
    const { h, weeks } = await started(src);
    const s = await src.control(h.runId, { action: "play" });
    expect(s.status).toBe("running");
    timer.advance(599);
    expect(weeks()).toEqual([]);
    timer.advance(1201);
    expect(weeks()).toEqual([1, 2, 3]);
  });
  it("hiz 16 -> 1000 ms'de en az 26 hafta; hiz 4", async () => {
    const a = setup();
    const x = await started(a.src);
    await a.src.control(x.h.runId, { action: "play", speed: 16 });
    a.timer.advance(1000);
    expect(x.weeks().length).toBeGreaterThanOrEqual(26);
    const b = setup();
    const y = await started(b.src);
    await b.src.control(y.h.runId, { action: "play", speed: 4 });
    b.timer.advance(1500);
    expect(y.weeks()).toHaveLength(10);
  });
  it("test_pause_stops_and_step_advances_exactly_one", async () => {
    const { src, timer } = setup();
    const { h, weeks } = await started(src);
    await src.control(h.runId, { action: "play" });
    timer.advance(1200);
    const p = await src.control(h.runId, { action: "pause" });
    expect(p.status).toBe("paused");
    expect(timer.pending).toBe(0);
    timer.advance(10000);
    expect(weeks()).toEqual([1, 2]);
    const s = await src.control(h.runId, { action: "step" });
    expect(s).toMatchObject({ week: 3, status: "paused" });
    expect(weeks()).toEqual([1, 2, 3]);
    expect(timer.pending).toBe(0);
  });
  it("test_rapid_commands_no_dup_no_skip", async () => {
    const { src, timer } = setup();
    const { h, weeks } = await started(src);
    const id = h.runId;
    await src.control(id, { action: "play" });
    timer.advance(700);
    await src.control(id, { action: "pause" });
    await src.control(id, { action: "play" });
    await src.control(id, { action: "step" });
    expect(timer.pending).toBeLessThanOrEqual(1);
    await src.control(id, { action: "play", speed: 4 });
    timer.advance(1000);
    await src.control(id, { action: "pause" });
    await src.control(id, { action: "pause" });
    expect(timer.pending).toBe(0);
    await src.control(id, { action: "step" });
    const w = weeks();
    expect(w.length).toBeGreaterThan(3);
    expect(w).toEqual(w.map((_, i) => i + 1));
  });
  it("hiz degisimi sonraki tikten gecerli", async () => {
    const { src, timer } = setup();
    const { h, weeks } = await started(src);
    await src.control(h.runId, { action: "play" });
    await src.control(h.runId, { action: "play", speed: 16 });
    timer.advance(600);
    expect(weeks()).toEqual([1]);
    timer.advance(75);
    expect(weeks()).toEqual([1, 2, 3]);
  });
  it("test_unsubscribe_clears_timers", async () => {
    const { src, timer } = setup();
    const { h, off } = await started(src);
    await src.control(h.runId, { action: "play" });
    expect(timer.pending).toBe(1);
    off();
    expect(timer.pending).toBe(0);
  });
  it("test_dispose_clears_everything", async () => {
    const { src, timer } = setup();
    const { h, ev } = await started(src);
    await src.control(h.runId, { action: "play" });
    src.dispose();
    expect(timer.pending).toBe(0);
    const n = ev.length;
    timer.advance(5000);
    expect(ev).toHaveLength(n);
    src.dispose();
    const dis = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ name: "SimUnsupported", message: "disposed" });
    await dis(src.start(cfg()));
    await dis(src.open(h.runId));
    await dis(src.control(h.runId, { action: "play" }));
    await dis(src.applyChange(h.runId, { from: "next_week", patch: {} }));
    await dis(src.weeks(h.runId, 1, 2));
    const got: SimEvent[] = [];
    const off = src.subscribe(h.runId, (e) => got.push(e));
    expect(got).toEqual([]);
    expect(() => off()).not.toThrow();
  });
  it("test_ended_after_200_once", async () => {
    const { src, timer } = setup();
    const { h, ev, weeks } = await started(src);
    await src.control(h.runId, { action: "play", speed: 16 });
    timer.advance(37.5 * 200 + 50);
    expect(weeks()).toHaveLength(200);
    const st = await src.control(h.runId, { action: "play" });
    expect(st).toMatchObject({ status: "ended", week: 200, endedReason: "duration" });
    await src.control(h.runId, { action: "step" });
    await src.control(h.runId, { action: "pause" });
    timer.advance(5000);
    expect(weeks()).toHaveLength(200);
    expect(ev.filter((e) => e.type === "ended")).toEqual([{ type: "ended", reason: "duration", week: 200 }]);
    expect(timer.pending).toBe(0);
    expect((await src.control(h.runId, { action: "step" })).week).toBe(200);
  });
  it("adimla 200'e ulasinca da tek ended", async () => {
    const { src } = setup();
    const { h, ev } = await started(src);
    for (let i = 0; i < 205; i++) await src.control(h.runId, { action: "step" });
    expect(ev.filter((e) => e.type === "ended")).toHaveLength(1);
    expect(ev.filter((e) => e.type === "week")).toHaveLength(200);
  });
  it("test_collapse_does_not_end_run", async () => {
    const { src, timer } = setup(COLLAPSE);
    const { h, ev } = await started(src);
    await src.control(h.runId, { action: "play", speed: 16 });
    timer.advance(37.5 * 200 + 50);
    const evs = ev.flatMap((e) => (e.type === "world_event" ? [e.event] : []));
    const cokus = evs.filter((e) => e.id.startsWith("cokus"));
    expect(cokus.map((e) => e.id)).toEqual(["cokus:40"]);
    expect(cokus[0]).toMatchObject({ critical: true, params: { hafta: 40 } });
    const top = evs.find((e) => e.id.startsWith("toparlanma"))!;
    expect(top).toMatchObject({ id: "toparlanma:80", kind: "good", params: { hafta: 80 } });
    expect(ev.filter((e) => e.type === "week")).toHaveLength(200);
    const ended = ev.filter((e) => e.type === "ended");
    expect(ended).toEqual([{ type: "ended", reason: "duration", week: 200 }]);
    expect(evs.some((e) => e.id === "cokus:20")).toBe(false);
    const st = ev.filter((e) => e.type === "state").at(-1);
    expect(st).toMatchObject({ state: { status: "ended" } });
    const w40 = ev.find((e) => e.type === "week" && e.packet.week === 40);
    expect(w40 && w40.type === "week" && w40.packet.events.map((x) => x.id)).toEqual(["karsilama70:40", "cokus:40"]);
  });
  it("yukleme hatasi failed state ve hata anahtari", async () => {
    const f404 = allFiles();
    delete f404["/k/kapali/pm0.json"];
    const a = setup(undefined, f404);
    const h = await a.src.start(cfg());
    expect(h.state.status).toBe("failed");
    expect(h.state.error?.messageKey).toBe("hata.kayit_yok");
    const ev: SimEvent[] = [];
    a.src.subscribe(h.runId, (e) => ev.push(e));
    expect(ev[0]).toMatchObject({ type: "state", state: { status: "failed", error: { messageKey: "hata.kayit_yok" } } });
    expect((await a.src.control(h.runId, { action: "play" })).status).toBe("failed");
    expect(a.timer.pending).toBe(0);
    const bad = allFiles();
    bad["/k/kapali/pm0.json"] = "{x";
    const b = setup(undefined, bad);
    expect((await b.src.start(cfg())).state.error?.messageKey).toBe("hata.kayit_bozuk");
    const short = allFiles(undefined, 199);
    const c = setup(undefined, short);
    expect((await c.src.start(cfg())).state.error?.messageKey).toBe("hata.kayit_bozuk");
  });
  it("open: idempotent, yenileme, cop", async () => {
    const { src, timer } = setup();
    const { h, weeks } = await started(src);
    await src.control(h.runId, { action: "play" });
    timer.advance(1800);
    await src.control(h.runId, { action: "pause" });
    const again = await src.open(h.runId);
    expect(again!.state.week).toBe(3);
    expect(again!.runId).toBe(h.runId);
    expect(weeks()).toEqual([1, 2, 3]);
    const fresh = setup().src;
    const o = await fresh.open(h.runId);
    expect(o!.state).toMatchObject({ week: 0, status: "paused", version: 1, scenarioId: "kapali", runId: h.runId });
    expect(await fresh.open("çöp")).toBeNull();
    expect(await fresh.open("kapali.9~x")).toBeNull();
  });
  it("open: yuklenemeyen kosu yeniden denenince kurtarilir", async () => {
    const files = allFiles();
    const good = files["/k/kapali/pm0.json"]!;
    delete files["/k/kapali/pm0.json"];
    const { src, timer } = setup(undefined, files);
    const h = await src.start(cfg());
    expect(h.state.status).toBe("failed");
    const ev: SimEvent[] = [];
    src.subscribe(h.runId, (e) => ev.push(e));
    files["/k/kapali/pm0.json"] = good;
    const again = await src.open(h.runId);
    expect(again!.state).toMatchObject({ status: "paused", week: 0 });
    expect(ev.at(-1)).toMatchObject({ type: "state", state: { status: "paused" } });
    await src.control(h.runId, { action: "play" });
    timer.advance(1200);
    expect(ev.filter((e) => e.type === "week")).toHaveLength(2);
  });
  it("start canli tarifte kosuyu sifirlar, aboneler kalir; open ready kosuyu bozmaz", async () => {
    const { src } = setup();
    const { h, ev, weeks } = await started(src);
    expect((await src.open(h.runId))!.state.status).toBe("ready");
    for (let i = 0; i < 3; i++) await src.control(h.runId, { action: "step" });
    const h2 = await src.start(cfg());
    expect(h2.runId).toBe(h.runId);
    expect(h2.state).toMatchObject({ week: 0, status: "ready" });
    expect(ev.at(-1)).toMatchObject({ type: "state", state: { week: 0, status: "ready" } });
    await src.control(h.runId, { action: "step" });
    expect(weeks()).toEqual([1, 2, 3, 1]);
  });
  it("state.values start ve open'da ayni, hiz dogrulanir, kanonik olmayan id null", async () => {
    const { src } = setup();
    const h = await src.start(cfg({ values: {} }));
    expect(h.state.values).toEqual({ gecis_destegi: "kapali" });
    await expect(src.control(h.runId, { action: "play", speed: 0 as never })).rejects.toBeInstanceOf(SimUnsupported);
    const tail = "~" + encodeURIComponent(JSON.stringify({ name: "A", cityNames: [] }));
    expect(await src.open("kapali.01" + tail)).toBeNull();
    expect(await src.open("kapali.1.999_kisa" + tail)).toBeNull();
  });
  it("opened_by_id_with_changes_carries_versions_so_same_rule_features_stay_open_after_the_crossing", async () => {
    // Değişiklikli kayıt koşusu kimliğiyle açılır (yenileme / paylaşılan bağlantı): sürüm geçişinden sonra bile tarif kurulabilmeli.
    const { src, timer } = setup();
    const tail = "~" + encodeURIComponent(JSON.stringify({ name: "A", cityNames: [] }));
    const h = (await src.open("kapali.1.5_kisa" + tail))!;
    expect(h.state.versions).toEqual([
      { version: 1, fromWeek: 0, values: { gecis_destegi: "kapali" } }, { version: 2, fromWeek: 5, values: { gecis_destegi: "kisa_sureli" } },
    ]);
    for (let i = 0; i < 6; i++) await src.control(h.runId, { action: "step" });
    const cur = (await src.open(h.runId))!.state;
    expect(cur.version).toBe(2);
    expect(tarifKapaliNedeni(cur)).toBeNull();
    expect(tarifOf(cur).schedule).toEqual([{ week: 5, patch: { gecis_destegi: "kisa_sureli" } }]);
    void timer;
  });
  it("open iki kez: ilk 50 hafta bayt esit", async () => {
    const grab = async () => {
      const { src } = setup((w) => ({ served: 0.5 + (w % 7) / 20, gini: w / 300 }));
      const h = (await src.open("kapali.3~" + encodeURIComponent(JSON.stringify({ name: "A", cityNames: [] }))))!;
      for (let i = 0; i < 50; i++) await src.control(h.runId, { action: "step" });
      return JSON.stringify(await src.weeks(h.runId, 1, 50));
    };
    const a = await grab();
    expect(a).toBe(await grab());
    expect(JSON.parse(a)).toHaveLength(50);
  });
  it("weeks araligi ve bilinmeyen kosu", async () => {
    const { src } = setup();
    const { h } = await started(src);
    for (let i = 0; i < 5; i++) await src.control(h.runId, { action: "step" });
    expect((await src.weeks(h.runId, 2, 4)).map((p) => p.week)).toEqual([2, 3, 4]);
    expect((await src.weeks(h.runId, 4, 99)).map((p) => p.week)).toEqual([4, 5]);
    await expect(src.weeks("kapali.1~x", 1, 2)).rejects.toBeInstanceOf(SimUnsupported);
    await expect(src.control("yok", { action: "play" })).rejects.toBeInstanceOf(SimUnsupported);
  });
  it("bilinmeyen runId tek error olayi", async () => {
    const { src } = setup();
    const ev: SimEvent[] = [];
    const off = src.subscribe("yok", (e) => ev.push(e));
    expect(ev).toEqual([{ type: "error", messageKey: "hata.kosu_bulunamadi" }]);
    off();
  });
});
