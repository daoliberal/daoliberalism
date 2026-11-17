import { afterEach, describe, expect, it } from "vitest";
import { createLiveSource } from "@/oyun/sim/live";
import type { RunConfig, SimEvent, SimSource, WeekPacket, WorldEvent } from "@/oyun/sim/types";
import { createFakeLiveServer, packetOf, type FakeLiveServer } from "../../helpers/fakeLiveServer";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const cfg: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } };

let toDispose: SimSource[] = [];
afterEach(() => { toDispose.forEach((s) => s.dispose()); toDispose = []; });
const mkSource = (server: FakeLiveServer): SimSource => {
  const s = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  toDispose.push(s);
  return s;
};
const mk = () => { const server = createFakeLiveServer(); return { server, source: mkSource(server) }; };
const listen = (source: SimSource, id: string) => {
  const events: SimEvent[] = [];
  const off = source.subscribe(id, (e) => events.push(e));
  return {
    events, off,
    worldEvents: (): WorldEvent[] => events.flatMap((e) => (e.type === "world_event" ? [e.event] : [])),
    ids: (): string[] => events.flatMap((e) => (e.type === "world_event" ? [e.event.id] : [])),
    weeks: (): number[] => events.flatMap((e) => (e.type === "week" ? [e.packet.week] : [])),
    packets: (): WeekPacket[] => events.flatMap((e) => (e.type === "week" ? [e.packet] : [])),
    errors: (): unknown[] => events.filter((e) => e.type === "error"),
  };
};
/** Sunucudan ham `week` paketi (served değeri ve sürümle). */
const wk = (id: string, week: number, served: number, version = 1): string => {
  const p = packetOf(id, week, version);
  return JSON.stringify({ ...p, world: { ...p.world, served } });
};
const setup = async () => {
  const x = mk();
  const run = await x.source.start(cfg);
  const l = listen(x.source, run.runId);
  await flush();
  return { ...x, id: run.runId, l };
};

describe("LiveSource olaylari", () => {
  it("test_collapse_recovery_events", async () => {
    const { server, id, l } = await setup();
    server.push(id, "week", wk(id, 20, 0.45));
    expect(l.ids().filter((x) => x.startsWith("cokus"))).toEqual([]); // hafta 20 <= 26: tetiklemez
    server.push(id, "week", wk(id, 30, 0.45));
    const cokus = l.worldEvents().find((e) => e.id === "cokus:30")!;
    expect(cokus).toMatchObject({ id: "cokus:30", week: 30, kind: "bad", critical: true, textKey: "event.cokus", rule_ids: ["cokus"] });
    expect(l.packets().find((p) => p.week === 30)!.events.map((e) => e.id)).toContain("cokus:30");
    server.push(id, "week", wk(id, 31, 0.72));
    expect(l.worldEvents().find((e) => e.id === "toparlanma:31")).toMatchObject({ kind: "good", critical: false, params: { hafta: 31, oran: 72 } });
    // cokus kosuyu bitirmez
    expect(l.events.some((e) => e.type === "ended")).toBe(false);
    expect(l.events.filter((e) => e.type === "state").every((e) => e.type === "state" && e.state.status !== "ended")).toBe(true);
    server.push(id, "week", wk(id, 32, 0.8));
    expect(l.ids().filter((x) => x.startsWith("cokus"))).toEqual(["cokus:30"]);
  });

  it("test_events_not_duplicated_on_reconnect", async () => {
    const { server, id, l } = await setup();
    const hist = [wk(id, 29, 0.9), wk(id, 30, 0.45), wk(id, 31, 0.72)];
    for (const h of hist) server.push(id, "week", h);
    const before = l.ids();
    expect(before).toEqual(expect.arrayContaining(["cokus:30", "toparlanma:31"]));
    server.dropStreams();
    // yeniden baglanan akis gecmisi bastan yollar
    for (const h of hist) server.push(id, "week", h);
    const all = l.ids();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(before);
    expect(l.weeks()).toEqual([29, 30, 31]);
  });

  it("test_rebuild_ctx_from_history_after_refresh", async () => {
    const server = createFakeLiveServer();
    const first = mkSource(server);
    const run = await first.start(cfg);
    const r = server.run(run.runId)!;
    r.packets = [29, 30, 31, 32].map((w) => JSON.parse(wk(run.runId, w, w === 30 ? 0.45 : w === 31 ? 0.72 : 0.9)) as WeekPacket);
    r.state = { ...r.state, week: 4, status: "paused" };
    // sayfa yenilemesi: yeni kaynak, yeni abone, gecmis sirayla gelir
    const second = mkSource(server);
    expect((await second.open(run.runId))?.runId).toBe(run.runId);
    const l = listen(second, run.runId);
    await flush();
    expect(l.weeks()).toEqual([29, 30, 31, 32]);
    expect(l.ids().filter((x) => x.startsWith("cokus"))).toEqual(["cokus:30"]); // ilk kez, bir kez
    expect(l.ids()).toContain("toparlanma:31");
    // sonraki canli hafta baglami korur: cokus yeniden yayimlanmaz
    server.push(run.runId, "week", wk(run.runId, 33, 0.3));
    expect(l.ids().filter((x) => x.startsWith("cokus"))).toEqual(["cokus:30"]);
    // gec gelen abone ayni olaylari paketlerden gorur, cift degil
    const late = listen(second, run.runId);
    expect(late.packets().flatMap((p) => p.events.map((e) => e.id))).toContain("cokus:30");
    expect(late.ids().filter((x) => x.startsWith("cokus"))).toEqual([]); // paket olayi world_event olarak tekrar yayilmaz
  });

  it("test_version_event_passthrough_with_surum_param", async () => {
    const { source, id, l } = await setup();
    await source.control(id, { action: "step" });
    await source.control(id, { action: "step" });
    await source.applyChange(id, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" } });
    await flush();
    const v = l.worldEvents().filter((e) => e.textKey === "event.version");
    expect(v).toEqual([{
      id: "version:2:2:gecis_destegi", week: 2, kind: "neutral", textKey: "event.version",
      params: { hafta: 2, mod: "live", surum: 2 }, critical: false, sector: null, rule_ids: ["gecis_destegi"],
      changes: [{ id: "gecis_destegi", from: "kapali", to: "kisa_sureli" }],
    }]);
    // surum olayi kural motoruna sokulmaz, yeni olay uretmez
    expect(l.worldEvents()).toHaveLength(1);
  });

  it("test_sse_drop_emits_error_then_recovers", async () => {
    const { server, id, l } = await setup();
    server.push(id, "week", wk(id, 1, 0.9));
    server.dropStreams();
    expect(l.errors()).toEqual([{ type: "error", messageKey: "hata.sunucu_yok" }]);
    server.dropStreams(); // ayni kesinti: yinelenmez
    expect(l.errors()).toHaveLength(1);
    const n = l.events.length;
    // yeniden baglandi: durum ve gecmis gelir
    server.push(id, "state", JSON.stringify(server.run(id)!.state));
    server.push(id, "week", wk(id, 1, 0.9));
    server.push(id, "week", wk(id, 2, 0.9));
    const after = l.events.slice(n);
    expect(after.map((e) => e.type)).toEqual(["state", "week"]); // hafta 1 yinelenmez
    // useRun semantigi: error'dan sonra gelen state hatayi temizler (error ... state sirasi)
    const idxErr = l.events.findIndex((e) => e.type === "error");
    expect(l.events.slice(idxErr + 1).some((e) => e.type === "state")).toBe(true);
    // yeni kesinti yeniden bildirilir
    server.dropStreams();
    expect(l.errors()).toHaveLength(2);
  });

  it("test_two_listeners_same_events_once", async () => {
    const { server, source, id, l } = await setup();
    const l2 = listen(source, id);
    server.push(id, "week", wk(id, 30, 0.45));
    server.push(id, "week", wk(id, 31, 0.72));
    for (const x of [l, l2]) {
      expect(x.ids().filter((i) => i === "cokus:30")).toHaveLength(1);
      expect(x.ids().filter((i) => i === "toparlanma:31")).toHaveLength(1);
    }
    expect(l.ids()).toEqual(l2.ids());
    expect(server.streamsFor(id)).toBe(1);
  });

  it("test_skip_to_next_critical_with_cached_history", async () => {
    const { server, source, id } = await setup();
    server.push(id, "week", wk(id, 30, 0.45)); // eski kritik olay onbellekte
    // SaatCubugu.skip ile ayni kalip: abonelik anindaki gecmis sayilmaz
    const seen: string[] = [];
    let armed = false;
    const off = source.subscribe(id, (e) => {
      if (!armed) return;
      if (e.type === "world_event" && e.event.critical) seen.push(e.event.id);
    });
    armed = true;
    await flush(); // akis tazelense de gecmis tekrar kritik olay uretmez
    expect(seen).toEqual([]);
    server.push(id, "week", wk(id, 40, 0.9));
    expect(seen).toEqual([]);
    server.push(id, "week", wk(id, 41, 0.8));
    server.push(id, "week", JSON.stringify({ ...packetOf(id, 42, 1), world: { ...packetOf(id, 42, 1).world, served: 0.9, failed_cum: 12 } }));
    expect(seen).toEqual(["batis10:42"]); // yalniz yeni kritik olay
    off();
  });

  it("ended_sonrasi_akis_kapanir_sahte_hata_yok", async () => {
    const { server, source } = mk();
    const run = await source.start({ ...cfg, durationWeeks: 2 });
    const l = listen(source, run.runId);
    await flush();
    await source.control(run.runId, { action: "step" });
    await source.control(run.runId, { action: "step" });
    await flush();
    expect(l.events.filter((e) => e.type === "ended")).toHaveLength(1);
    expect(server.streamsFor(run.runId)).toBe(0);
    server.dropStreams();
    server.killStreams();
    expect(l.errors()).toEqual([]);
    // bitmis kosuya sonradan abone: akis yeniden acilmaz
    const late = listen(source, run.runId);
    await flush();
    expect(server.streamsFor(run.runId)).toBe(0);
    expect(late.events.map((e) => e.type)).toEqual(["state", "week", "week"]);
  });

  it("apply_change_dikis_sonrasi_olay_ve_ended_budanir", async () => {
    const { server, source, id, l } = await setup();
    const r = server.run(id)!;
    r.state = { ...r.state, week: 28 }; // dikis 28. haftada
    for (const w of [27, 28]) server.push(id, "week", wk(id, w, 0.9));
    server.push(id, "week", wk(id, 29, 0.45));
    server.push(id, "week", wk(id, 30, 0.45)); // eski surumde cokus:29 + (karsilama70) dikisten sonra
    expect(l.ids()).toContain("cokus:29");
    server.push(id, "ended", JSON.stringify({ reason: "duration", week: 30 }));
    expect(server.streamsFor(id)).toBe(0);
    const res = await source.applyChange(id, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" } });
    expect(res).toMatchObject({ accepted: true, seamWeek: 28 });
    await flush();
    expect(server.streamsFor(id)).toBe(1); // dinleyici varken akis yeniden acilir
    // gec abone: 28 sonrasi hafta ve eski cokus yok
    const late = listen(source, id);
    expect(late.weeks()).toEqual([27, 28]);
    expect(late.packets().flatMap((p) => p.events.map((e) => e.id))).toEqual([]);
    // yeni surumde ayni hafta tekrar cokerse yeniden yayimlanir (baglam dikise kadar kuruldu), ended yeniden gonderilebilir
    server.push(id, "week", wk(id, 29, 0.45, 2));
    expect(l.ids().filter((i) => i === "cokus:29")).toHaveLength(2);
    server.push(id, "ended", JSON.stringify({ reason: "duration", week: 30 }));
    expect(l.events.filter((e) => e.type === "ended")).toHaveLength(2);
  });

  it("sirasiz_gelen_hafta_olaylari_yeniden_kurar_ve_replay_siralidir", async () => {
    const { server, source, id, l } = await setup();
    server.push(id, "week", wk(id, 40, 0.45));
    expect(l.ids()).toContain("cokus:40");
    server.push(id, "week", wk(id, 30, 0.45)); // daha eski, ilk kez goruluyor
    expect(l.ids()).toContain("cokus:30");
    const late = listen(source, id);
    expect(late.weeks()).toEqual([30, 40]);
    const byWeek = Object.fromEntries(late.packets().map((p) => [p.week, p.events.map((e) => e.id)]));
    expect(byWeek[30]).toContain("cokus:30");
    expect(byWeek[40]).not.toContain("cokus:40"); // cokus kosuda bir kez
  });

  it("killStreams_sonrasi_akis_kendiliginden_yeniden_acilir_gecmis_olay_yinelemez", async () => {
    const { server, source, id, l } = await setup();
    const r = server.run(id)!;
    r.packets = [30, 31].map((w) => JSON.parse(wk(id, w, w === 30 ? 0.45 : 0.72)) as WeekPacket);
    r.state = { ...r.state, week: 2 };
    server.push(id, "week", JSON.stringify(r.packets[0]));
    server.push(id, "week", JSON.stringify(r.packets[1]));
    const before = l.ids();
    expect(before).toEqual(expect.arrayContaining(["cokus:30", "toparlanma:31"]));
    server.killStreams(); // koşu sunucuda var: GET 2xx, akış yeniden açılır (hata yok)
    await flush();
    expect(l.errors()).toEqual([]);
    expect(server.streamsFor(id)).toBe(1);
    const l2 = listen(source, id);
    await flush(); // yeni abone önbellekten beslenir, akış paylaşılır
    expect(server.streamsFor(id)).toBe(1);
    expect(l.ids()).toEqual(before);
    expect(l2.ids()).toEqual([]); // paket olaylari world_event olarak tekrar yayilmaz
    expect(l.weeks()).toEqual([30, 31]);
  });
});
