import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HAFTA_YAZMA_MS, otomatikKayitli } from "@/oyun/screens/kosular/otomatikKayit";
import { kayitSorunuOku, kayitSorunuYaz, LIBRARY_KEY, loadLibrary, saveLibrary, type SavedRun } from "@/oyun/sim/library";
import { createLiveSource } from "@/oyun/sim/live";
import { RECIPE_VERSION } from "@/oyun/sim/recipe";
import type { RunConfig, SimSource } from "@/oyun/sim/types";
import { createFakeLiveServer, type FakeLiveServer } from "../helpers/fakeLiveServer";
import { createFakeSource } from "../helpers/fakeSource";

let disposables: SimSource[] = [];
afterEach(() => {
  kayitSorunuYaz(null);
  disposables.forEach((s) => s.dispose());
  disposables = [];
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
beforeEach(() => {
  window.localStorage.clear();
});

const cfg: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } };

function kur(): { server: FakeLiveServer; source: SimSource } {
  const server = createFakeLiveServer();
  server.capabilities.branch = true;
  server.capabilities.jobs = true;
  const live = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  disposables.push(live);
  return { server, source: otomatikKayitli(live) };
}
/** Koşuyu dinler (Canlı ekranı gibi): durum olayları sarmalayıcıdan geçer. */
const dinle = (s: SimSource, id: string): (() => void) => s.subscribe(id, () => {});

describe("otomatik kayıt", () => {
  it("start_writes_an_entry_named_after_the_world_at_once", async () => {
    const { source } = kur();
    const h = await source.start({ ...cfg, name: "Deneme Dünyası" });
    const [g, ...diger] = loadLibrary().runs;
    expect(diger).toHaveLength(0);
    expect(g).toMatchObject({ id: h.runId, name: "Deneme Dünyası", source: "live", week: 0, recipe: { templateId: "dayanikli_taban", durationWeeks: 200, values: { gecis_destegi: "kapali" } } });
  });

  it("an_empty_world_name_uses_the_unnamed_text_and_equal_names_make_separate_entries", async () => {
    const { source } = kur();
    const a = await source.start({ ...cfg, name: "" });
    const b = await source.start({ ...cfg, name: "Aynı" });
    const c = await source.start({ ...cfg, name: "Aynı" });
    const runs = loadLibrary().runs;
    expect(runs.map((r) => r.name)).toEqual(["Adsız dünya", "Aynı", "Aynı"]);
    expect(new Set([a.runId, b.runId, c.runId]).size).toBe(3);
    expect(runs.map((r) => r.id)).toEqual([a.runId, b.runId, c.runId]);
  });

  it("a_schedule_change_updates_the_entry_recipe_and_the_week_follows_the_run", async () => {
    const { server, source } = kur();
    const h = await source.start(cfg);
    dinle(source, h.runId);
    await source.control(h.runId, { action: "step" });
    await source.control(h.runId, { action: "step" });
    const res = await source.applyChange(h.runId, { from: "next_week", patch: { ucret_stopaji: 5 } });
    expect(res.accepted).toBe(true);
    await vi.waitFor(() => expect(loadLibrary().runs[0]!.recipe.schedule).toEqual([{ week: 2, patch: { ucret_stopaji: 5 } }]));
    await source.control(h.runId, { action: "step" });
    await vi.waitFor(() => expect(loadLibrary().runs[0]!.week).toBe(3), { timeout: HAFTA_YAZMA_MS + 2000 });
    expect(loadLibrary().runs).toHaveLength(1);
    expect(server.run(h.runId)).toBeDefined();
  });

  it("the_last_week_is_written_when_the_run_ends", async () => {
    const { source } = kur();
    const h = await source.start({ ...cfg, durationWeeks: 3 });
    dinle(source, h.runId);
    for (let i = 0; i < 3; i++) await source.control(h.runId, { action: "step" });
    await vi.waitFor(() => expect(loadLibrary().runs[0]).toMatchObject({ week: 3 }));
  });

  it("a_branch_takes_its_place_in_the_tree_with_parent_and_fork_week", async () => {
    const { source } = kur();
    const ust = await source.start({ ...cfg, name: "Kök" });
    const dal = await source.branch!(ust.runId, 0);
    const runs = loadLibrary().runs;
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.id === dal.runId)).toMatchObject({ name: "Kök", parentId: ust.runId, forkWeek: 0 });
    expect(runs.find((r) => r.id === ust.runId)!.parentId).toBeUndefined();
  });

  it("runs_without_an_entry_that_were_not_started_here_are_never_written", async () => {
    // iş üyesi / önizleme / başka yoldan açılmış koşu: sarmalayıcının `start`/`branch`'inden geçmedi, kütüphanede girdisi yok
    const server = createFakeLiveServer();
    const ham = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    disposables.push(ham);
    const source = otomatikKayitli(ham);
    const yabanci = await ham.start({ ...cfg, name: "Üye" });
    dinle(source, yabanci.runId);
    await source.control(yabanci.runId, { action: "step" });
    await source.applyChange(yabanci.runId, { from: "next_week", patch: { ucret_stopaji: 5 } });
    await new Promise((r) => setTimeout(r, HAFTA_YAZMA_MS + 300));
    expect(loadLibrary().runs).toEqual([]);
  });

  it("a_deleted_entry_is_not_recreated_by_the_running_run", async () => {
    const { source } = kur();
    const h = await source.start(cfg);
    dinle(source, h.runId);
    saveLibrary([]);
    await source.control(h.runId, { action: "step" });
    await new Promise((r) => setTimeout(r, HAFTA_YAZMA_MS + 300));
    expect(loadLibrary().runs).toEqual([]);
  });

  it("a_hand_saved_entry_keeps_its_name_and_start_time_while_it_follows_the_run", async () => {
    const { source } = kur();
    const h = await source.start(cfg);
    const eski: SavedRun = { ...loadLibrary().runs[0]!, name: "Benim adım", savedAt: "2026-10-29T10:00:00.000Z" };
    saveLibrary([eski]);
    dinle(source, h.runId);
    await source.applyChange(h.runId, { from: "next_week", patch: { ucret_stopaji: 5 } });
    await vi.waitFor(() => expect(loadLibrary().runs[0]!.recipe.values).toMatchObject({ ucret_stopaji: 5 }));
    expect(loadLibrary().runs[0]).toMatchObject({ name: "Benim adım", savedAt: "2026-10-29T10:00:00.000Z" });
  });

  it("an_unreadable_old_library_format_does_not_break_the_start", async () => {
    window.localStorage.setItem(LIBRARY_KEY, "{bozuk");
    const { source } = kur();
    const h = await source.start(cfg);
    expect(h.runId).toMatch(/^run/);
    expect(loadLibrary().runs.map((r) => r.id)).toEqual([h.runId]);
  });

  it("storage_unavailable_the_run_still_starts_and_the_entry_stays_in_the_session", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("erişim yok"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("erişim yok"); });
    const { source } = kur();
    const h = await source.start({ ...cfg, name: "Bellekte" });
    expect(h.state.name).toBe("Bellekte");
    const l = loadLibrary();
    expect(l.available).toBe(false);
    expect(l.runs.map((r) => r.name)).toEqual(["Bellekte"]);
  });

  it("the_replay_source_is_returned_unwrapped", () => {
    const kayit = createFakeSource([], { kind: "replay" });
    expect(otomatikKayitli(kayit)).toBe(kayit);
    expect(RECIPE_VERSION).toBeGreaterThan(0);
  });

  // ---- düzeltme turu 1
  it("while_the_run_is_preparing_the_saved_week_is_not_rewritten_backwards", async () => {
    const { server, source } = kur();
    const h = await source.start({ ...cfg, name: "Hazırlanan" });
    saveLibrary([{ ...loadLibrary().runs[0]!, week: 40 }]);
    server.run(h.runId)!.state = { ...server.run(h.runId)!.state, week: 0, preparing: { done: 3, total: 40 } };
    const kapat = dinle(source, h.runId); // ilk durum olayı: hazırlanıyor, hafta 0
    await new Promise((r) => setTimeout(r, HAFTA_YAZMA_MS + 300));
    kapat();
    expect(loadLibrary().runs[0]).toMatchObject({ id: h.runId, week: 40 });
  });

  it("a_recipe_over_the_size_limit_is_not_written_and_says_so_neutrally", async () => {
    const { source } = kur();
    await source.start({ ...cfg, values: { gecis_destegi: "x".repeat(9000) } });
    expect(loadLibrary().runs).toEqual([]);
    expect(kayitSorunuOku()).toBe("buyuk");
    await source.start(cfg);
    expect(kayitSorunuOku()).toBeNull();
    expect(loadLibrary().runs).toHaveLength(1);
  });

  it("when_only_the_write_fails_the_entry_stays_in_the_session_and_the_problem_is_reported", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("kota"); });
    const { source } = kur();
    await source.start({ ...cfg, name: "Kota" });
    expect(kayitSorunuOku()).toBe("depolama");
    expect(loadLibrary().runs.map((r) => r.name)).toEqual(["Kota"]);
  });

  it("dispose_clears_pending_writes_and_the_pagehide_listener", async () => {
    const kaldir = vi.spyOn(window, "removeEventListener");
    const { source } = kur();
    const h = await source.start(cfg);
    dinle(source, h.runId);
    await source.control(h.runId, { action: "step" });
    source.dispose();
    expect(kaldir).toHaveBeenCalledWith("pagehide", expect.any(Function));
    await new Promise((r) => setTimeout(r, HAFTA_YAZMA_MS + 300));
    expect(loadLibrary().runs[0]!.week).toBe(0);
  });
});
