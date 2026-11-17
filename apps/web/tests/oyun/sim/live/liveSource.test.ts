import { afterEach, describe, expect, it, vi } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { createLiveSource } from "@/oyun/sim/live";
import type { RunConfig, SimEvent, SimSource } from "@/oyun/sim/types";
import { createFakeLiveServer, packetOf } from "../../helpers/fakeLiveServer";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const cfg: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } };

function setup() {
  const server = createFakeLiveServer();
  const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  return { server, source };
}
const listen = (source: SimSource, id: string) => {
  const events: SimEvent[] = [];
  const off = source.subscribe(id, (e) => events.push(e));
  return { events, off, types: () => events.map((e) => e.type), weeks: () => events.flatMap((e) => (e.type === "week" ? [e.packet.week] : [])) };
};
let toDispose: SimSource[] = [];
afterEach(() => { toDispose.forEach((s) => s.dispose()); toDispose = []; });
const mk = () => { const x = setup(); toDispose.push(x.source); return x; };

describe("LiveSource", () => {
  it("kind_ve_capabilities", () => {
    const { source } = mk();
    expect(source.kind).toBe("live");
    expect(Object.values(source.capabilities).every((v) => v === false)).toBe(true);
  });

  it.each([["too_many_runs", 429], ["busy_preparing", 409]] as const)("start_%s_ayri_hata_kodu_verir", async (code, status) => {
    const { server, source } = mk();
    server.startFailWith = code;
    const err = await source.start(cfg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimUnsupported);
    expect((err as SimUnsupported).message).toBe(code);
    expect(server.requests.at(-1)?.path).toMatch(/\/api\/runs$/);
    expect(status).toBeGreaterThan(400);
    server.startFailWith = null;
    await expect(source.start(cfg)).resolves.toMatchObject({ state: { status: "paused" } });
  });

  it("start_govdedeki_code_okunur_bilinmeyen_kod_busy_sayilmaz", async () => {
    const server = createFakeLiveServer();
    const fetchImpl = (async (u: string, init?: RequestInit) =>
      init?.method === "POST" && u.endsWith("/api/runs")
        ? new Response(JSON.stringify({ error: { code: "baska_kod", message: "x", fields: [] } }), { status: 409 })
        : server.fetch(u, init)) as typeof fetch;
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl, eventSourceImpl: server.EventSource });
    toDispose.push(source);
    const err = await source.start(cfg).catch((e: unknown) => e);
    expect((err as SimUnsupported).message).not.toBe("busy_preparing");
    expect((err as SimUnsupported).message).not.toBe("too_many_runs");
  });

  it("test_start_posts_config_with_header", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const req = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/api/runs"))!;
    expect(req.path).toBe("http://127.0.0.1:8765/api/runs"); // sondaki bölü atılır
    expect(req.body).toEqual({ config: cfg });
    expect(req.headers["x-oyun-istek"]).toBe("1");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(run.state.status).toBe("paused");
    await source.info();
    expect(server.requests.every((r) => r.headers["x-oyun-istek"] === "1")).toBe(true);
  });

  it("start_sends_schedule_and_fast_forward_at_the_body_top_level", async () => {
    const { server, source } = mk();
    const schedule = [{ week: 30, patch: { gecis_destegi: "kurtarma_fonuyla" } }];
    const run = await source.start({ ...cfg, schedule, fastForwardTo: 30 });
    const req = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/api/runs"))!;
    expect(req.body).toEqual({ config: cfg, schedule, fastForwardTo: 30 });
    expect(run.state.preparing).toEqual({ done: 0, total: 30 });
    const bos = await source.start({ ...cfg, schedule: [] });
    expect(server.requests.at(-1)!.body).toEqual({ config: cfg });
    expect(bos.state.preparing).toBeUndefined();
  });

  it("open_unknown_id_is_null_without_a_recipe_and_rebuilds_with_one", async () => {
    const { server, source } = mk();
    expect(await source.open("canli-yok")).toBeNull();
    const h = await source.open("canli-yok", { ...cfg, schedule: [{ week: 5, patch: { a: 1 } }], fastForwardTo: 5 });
    expect(h?.runId).toMatch(/^run\d+$/);
    expect(server.requests.at(-1)!.body).toEqual({ config: cfg, schedule: [{ week: 5, patch: { a: 1 } }], fastForwardTo: 5 });
    server.startFailWith = "too_many_runs";
    await expect(source.open("canli-yok2", cfg)).rejects.toMatchObject({ message: "too_many_runs" });
    server.failWith = "network";
    await expect(source.open("canli-yok3", cfg)).rejects.toMatchObject({ message: "hata.sunucu_yok" });
    expect(await source.open("canli-yok3")).toBeNull();
  });

  it("info_ve_availability_eslenir", async () => {
    const { source } = mk();
    const info = await source.info();
    expect(info.kind).toBe("live");
    expect(info.fixedRules[0]).toMatchObject({ settingId: "ucret_stopaji", valueText: "%10" });
    expect(info.settings[0]!.options).toHaveLength(3);
    expect(await source.availability({ gecis_destegi: "kapali" })).toEqual({ ok: true, scenarioId: "canli", blocked: [] });
  });

  it("availability_kosu_kimligini_gonderir_yoksa_gondermez", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);         // gerçek sunucu gibi: koşu bağlamı yalnız var olan koşu için (bilinmeyen kimlik 404)
    await source.availability({ gecis_destegi: "kapali" });
    await source.availability({ gecis_destegi: "kisa_sureli" }, run.runId);
    const bodies = server.requests.filter((r) => r.path.endsWith("/api/availability")).map((r) => r.body);
    expect(bodies).toEqual([{ values: { gecis_destegi: "kapali" } }, { values: { gecis_destegi: "kisa_sureli" }, runId: run.runId }]);
  });

  it("test_events_mapped_to_simevents", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const l = listen(source, run.runId);
    await flush();
    await source.control(run.runId, { action: "step" });
    await source.control(run.runId, { action: "step" });
    await flush();
    expect(l.weeks()).toEqual([1, 2]);
    const patch = { gecis_destegi: "kisa_sureli" };
    const res = await source.applyChange(run.runId, { from: "next_week", patch });
    expect(res).toMatchObject({ accepted: true, mode: "live", seamWeek: 2, version: 2 });
    await flush();
    const ver = l.events.find((e) => e.type === "world_event");
    expect(ver).toMatchObject({ event: { textKey: "event.version", week: 2, params: { mod: "live", surum: 2 }, sector: null, rule_ids: ["gecis_destegi"] } });
    // bitiş: sahte sunucuda süreyi kısa tutarak
    const short = await source.start({ ...cfg, durationWeeks: 2 });
    const l2 = listen(source, short.runId);
    await source.control(short.runId, { action: "step" });
    await source.control(short.runId, { action: "step" });
    await flush();
    expect(l2.events.filter((e) => e.type === "ended")).toEqual([{ type: "ended", reason: "duration", week: 2 }]);
    // koşu çökmesi
    server.crashRun(run.runId);
    expect(l.events.at(-1)).toEqual({ type: "error", messageKey: "hata.model_coktu" });
  });

  it("weeks_ve_control_yollari", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    await source.control(run.runId, { action: "step", speed: 4 });
    await source.control(run.runId, { action: "step" });
    expect((await source.weeks(run.runId, 2, 9)).map((p) => p.week)).toEqual([2]);
    expect(server.requests.at(-1)!.path).toContain("/api/runs/run1/weeks?from=2&to=9");
    expect(server.requests.some((r) => r.path.endsWith("/control") && (r.body as { speed?: number }).speed === 4)).toBe(true);
  });

  it("test_error_event_on_http_500_and_network", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    server.failWith = 500;
    const a = listen(source, "bilinmeyen");
    await flush();
    expect(a.events).toEqual([{ type: "error", messageKey: "hata.sunucu_bozuk" }]);
    server.failWith = "network";
    const b = listen(source, "baska");
    await flush();
    expect(b.events).toEqual([{ type: "error", messageKey: "hata.sunucu_yok" }]);
    await expect(source.control(run.runId, { action: "step" })).rejects.toMatchObject({ name: "SimUnsupported", message: "hata.sunucu_yok" });
    server.failWith = 500;
    await expect(source.info()).rejects.toMatchObject({ message: "hata.sunucu_bozuk" });
    // açık akışta bağlantı kopması: kesinti başına tek hata; sonraki ileti kesintiyi kapatır
    server.failWith = null;
    const l = listen(source, run.runId);
    await flush();
    server.dropStreams();
    server.dropStreams();
    expect(l.events.filter((e) => e.type === "error")).toEqual([{ type: "error", messageKey: "hata.sunucu_yok" }]);
    server.killStreams(); // kalıcı kapanış: koşu sunucuda var, akış yeniden açılır; kesinti zaten bildirildi (ikinci bildirim yok)
    await flush();
    expect(l.events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(server.streamsFor(run.runId)).toBe(1);
  });

  it("bozuk_govde_sunucu_bozuk", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const l = listen(source, run.runId);
    await flush();
    server.push(run.runId, "week", "{yarim");
    server.push(run.runId, "week", JSON.stringify({ ...packetOf(run.runId, 1, 1), world: {} }));
    expect(l.events.filter((e) => e.type === "error")).toEqual([
      { type: "error", messageKey: "hata.sunucu_bozuk" }, { type: "error", messageKey: "hata.sunucu_bozuk" },
    ]);
    expect(l.weeks()).toEqual([]);
  });

  it("test_dispose_closes_event_sources_and_throws_after", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    const b = listen(source, run.runId);
    await flush();
    expect(server.openStreams()).toBe(1);
    source.dispose();
    expect(server.openStreams()).toBe(0);
    await expect(source.info()).rejects.toBeInstanceOf(SimUnsupported);
    await expect(source.start(cfg)).rejects.toBeInstanceOf(SimUnsupported);
    const n = a.events.length;
    server.push(run.runId, "state", "{}");
    expect(a.events.length).toBe(n);
    expect(b.events.length).toBe(n);
    const late = listen(source, run.runId);
    await flush();
    expect(late.events).toEqual([]);
    expect(server.openStreams()).toBe(0);
    source.dispose();
  });

  it("subscribe_runId_basina_tek_akis_son_dinleyicide_kapanir", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    const b = listen(source, run.runId);
    await flush();
    expect(server.streamsFor(run.runId)).toBe(1);
    a.off();
    expect(server.streamsFor(run.runId)).toBe(1);
    b.off();
    b.off();
    expect(server.streamsFor(run.runId)).toBe(0);
    const c = listen(source, run.runId); // yeniden aç
    await flush();
    expect(server.streamsFor(run.runId)).toBe(1);
    c.off();
  });

  it("test_subscribe_unknown_run_single_error", async () => {
    const { server, source } = mk();
    const l = listen(source, "yok");
    await flush();
    expect(l.events).toEqual([{ type: "error", messageKey: "hata.kosu_bulunamadi" }]);
    expect(server.openStreams()).toBe(0);
    const again = listen(source, "yok"); // önbelleğe girmez: yine sorulur, yine tek hata
    await flush();
    expect(again.events).toHaveLength(1);
  });

  it("test_open_404_returns_null", async () => {
    const { server, source } = mk();
    expect(await source.open("yok")).toBeNull();
    server.failWith = "network";
    expect(await source.open("yok")).toBeNull(); // open hata fırlatmaz
    server.failWith = null;
    const run = await source.start(cfg);
    const other = createLiveSource({ baseUrl: "", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    toDispose.push(other);
    expect((await other.open(run.runId))?.runId).toBe(run.runId);
  });

  it("test_second_subscriber_gets_cached_history_synchronously", async () => {
    const { source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    for (let i = 0; i < 3; i++) await source.control(run.runId, { action: "step" });
    await source.applyChange(run.runId, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" } });
    await flush();
    const b = listen(source, run.runId); // beklemeden
    expect(b.types()).toEqual(["state", "week", "week", "week", "world_event"]);
    expect(b.weeks()).toEqual([1, 2, 3]);
    expect(a.weeks()).toEqual([1, 2, 3]);
  });

  it("yeniden_baglanma_gecmisi_tekilleştirir", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    await source.control(run.runId, { action: "step" });
    await source.control(run.runId, { action: "step" });
    await source.applyChange(run.runId, { from: "next_week", patch: { gecis_destegi: "kisa_sureli" } });
    await flush();
    const before = a.events.length;
    // sunucu yeniden bağlanmada bütün geçmişi tekrar yollar
    const r = server.run(run.runId)!;
    server.push(run.runId, "state", JSON.stringify(r.state));
    for (const p of r.packets.slice(0, 2)) server.push(run.runId, "week", JSON.stringify(p));
    for (const v of r.versionEvents) server.push(run.runId, "world_event", JSON.stringify(v));
    const added = a.events.slice(before);
    expect(added.map((e) => e.type)).toEqual(["state"]);
    // daha yeni sürümle yeniden hesaplanmış hafta dinleyiciye gider
    server.push(run.runId, "week", JSON.stringify(packetOf(run.runId, 2, 3)));
    expect(a.weeks().at(-1)).toBe(2);
    expect(a.weeks()).toEqual([1, 2, 2]);
  });

  it("cache_ended_bir_kez", async () => {
    const { server, source } = mk();
    const run = await source.start({ ...cfg, durationWeeks: 1 });
    const a = listen(source, run.runId);
    await flush();
    await source.control(run.runId, { action: "step" });
    server.push(run.runId, "ended", JSON.stringify({ reason: "duration", week: 1 }));
    expect(a.events.filter((e) => e.type === "ended")).toHaveLength(1);
  });
});

describe("LiveSource: akış kapanınca kurtarma (I3)", () => {
  const del = (server: ReturnType<typeof createFakeLiveServer>, id: string) =>
    server.fetch(`http://127.0.0.1:8765/api/runs/${id}`, { method: "DELETE", headers: { "X-Oyun-Istek": "1" } });

  it("closed_ve_kosu_404_tek_kosu_bulunamadi_hatasi_akis_yeniden_acilmaz", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    await flush();
    const conns = [...server.run(run.runId)!.conns];
    await del(server, run.runId); // sunucu yeniden başlamış gibi: koşu yok
    const before = server.requests.length;
    for (const c of conns) { // sunucu öldü: akışlar kalıcı kapanır (EventSource CLOSED)
      c.es.readyState = 2;
      (c.es as unknown as { deliver(t: string, d?: string, f?: boolean): void }).deliver("error", undefined, true);
    }
    await flush();
    await flush();
    expect(a.events.filter((e) => e.type === "error")).toEqual([{ type: "error", messageKey: "hata.kosu_bulunamadi" }]);
    expect(server.streamsFor(run.runId)).toBe(0);
    expect(server.requests.slice(before).map((r) => `${r.method} ${r.path}`)).toEqual([`GET http://127.0.0.1:8765/api/runs/${run.runId}`]);
  });

  it("closed_ve_kosu_var_akis_yeniden_acilir_ve_gecmis_tekillesir", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    await flush();
    await source.control(run.runId, { action: "step" });
    server.killStreams();
    await flush();
    await flush();
    expect(server.streamsFor(run.runId)).toBe(1);
    expect(a.events.filter((e) => e.type === "error")).toEqual([]);
    expect(a.weeks()).toEqual([1]); // yeniden gelen geçmiş tekrar yayımlanmaz
  });

  it("closed_ve_ag_yok_tek_sunucu_yok_bildirimi_geri_cekilmeyle_yeniden_dener_donunce_acar", async () => {
    vi.useFakeTimers();
    try {
      const { server, source } = mk();
      const run = await source.start(cfg);
      const a = listen(source, run.runId);
      await vi.advanceTimersByTimeAsync(0);
      server.failWith = "network";
      server.killStreams();
      await vi.advanceTimersByTimeAsync(0);
      expect(a.events.filter((e) => e.type === "error")).toEqual([{ type: "error", messageKey: "hata.sunucu_yok" }]);
      const tries = () => server.requests.filter((r) => r.method === "GET" && r.path.endsWith(`/runs/${run.runId}`)).length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(tries()).toBeGreaterThan(2); // geri çekilmeyle yeniden dener
      expect(a.events.filter((e) => e.type === "error")).toHaveLength(1); // kesinti başına tek bildirim
      server.failWith = null;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(server.streamsFor(run.runId)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("control_404_dinleyiciye_kosu_bulunamadi_bildirir_sessiz_yutulmaz", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    await flush();
    await del(server, run.runId);
    await expect(source.control(run.runId, { action: "play" })).rejects.toMatchObject({ message: "unknown_run" });
    expect(a.events.filter((e) => e.type === "error")).toEqual([{ type: "error", messageKey: "hata.kosu_bulunamadi" }]);
  });

  it("control_ag_hatasi_dinleyiciye_sunucu_yok_bildirir", async () => {
    const { server, source } = mk();
    const run = await source.start(cfg);
    const a = listen(source, run.runId);
    await flush();
    server.failWith = "network";
    await expect(source.control(run.runId, { action: "play" })).rejects.toMatchObject({ message: "hata.sunucu_yok" });
    expect(a.events.filter((e) => e.type === "error")).toEqual([{ type: "error", messageKey: "hata.sunucu_yok" }]);
  });
});
