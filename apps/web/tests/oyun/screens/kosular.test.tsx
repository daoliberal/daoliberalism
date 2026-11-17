import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { Hesaplaniyor } from "@/oyun/screens/canli/Hesaplaniyor";
import { Kosular } from "@/oyun/screens/kosular/Kosular";
import { otomatikKayitli } from "@/oyun/screens/kosular/otomatikKayit";
import { abAdayiAl, sonKosuYaz } from "@/oyun/sim/kosuBaglami";
import { LIBRARY_KEY, loadLibrary, type SavedRun } from "@/oyun/sim/library";
import { createLiveSource } from "@/oyun/sim/live";
import { RECIPE_VERSION } from "@/oyun/sim/recipe";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { RunConfig, RunHandle, SimSource } from "@/oyun/sim/types";
import { createFakeLiveServer, type FakeLiveServer } from "../helpers/fakeLiveServer";
import { createFakeSource } from "../helpers/fakeSource";

let disposables: SimSource[] = [];
afterEach(() => {
  cleanup();
  disposables.forEach((s) => s.dispose());
  disposables = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
  sonKosuYaz(null);
  abAdayiAl();
  vi.restoreAllMocks();
});
beforeEach(() => {
  window.localStorage.clear();
});

const run = (id: string, over: Partial<SavedRun> = {}): SavedRun => ({
  id, name: `Koşu ${id}`, savedAt: "2026-10-29T10:00:00.000Z", source: "live",
  recipe: { v: RECIPE_VERSION, templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 1, values: { gecis_destegi: "kapali" } }, ...over,
});
const seed = (runs: SavedRun[]): void => window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schema: 1, runs }));
const cfg: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } };

function mountLive(): { server: FakeLiveServer; source: SimSource } {
  const server = createFakeLiveServer();
  const live = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  disposables.push(live);
  const source = otomatikKayitli(live);
  render(
    <SimSourceProvider source={source}>
      <Kosular />
    </SimSourceProvider>,
  );
  return { server, source };
}
const dugme = (eylem: Parameters<typeof t>[0], ad: string) => screen.getByRole("button", { name: t("kosular.eylem", { eylem: t(eylem), ad }) });
const posts = (s: FakeLiveServer) => s.requests.filter((r) => r.method === "POST" && /\/api\/runs$/.test(r.path));

describe("Koşular ekranı", () => {
  it("empty_library_says_so_and_lists_open_runs", async () => {
    const { source } = mountLive();
    expect(screen.getByRole("heading", { level: 3, name: t("kosular.kayitli.baslik") })).toBeInTheDocument();
    expect(screen.getByText(t("kosular.kayitli.yok"))).toBeInTheDocument();
    expect(screen.queryByText(t("kosular.yok"))).toBeNull();
    expect(await screen.findByText(t("kosular.acik.yok"))).toBeInTheDocument();
    await source.start(cfg);
  });

  it("storage_throws_empty_list_no_crash", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("erişim yok"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("erişim yok"); });
    mountLive();
    expect(screen.getByText(t("kosular.depolama_yok"))).toBeInTheDocument();
    expect(screen.getByText(t("kosular.kayitli.yok"))).toBeInTheDocument();
  });

  it("corrupt_entry_skipped", () => {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schema: 1, runs: [run("a"), { id: "bozuk" }, null] }));
    mountLive();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toContain("Koşu a");
    expect(screen.queryByText("bozuk")).toBeNull();
  });

  it("a_started_run_is_listed_automatically_with_its_recipe_and_there_is_no_save_button", async () => {
    const { server, source } = mountLive();
    const h = await source.start({ ...cfg, name: "Deneme" });
    server.run(h.runId)!.state = { ...server.run(h.runId)!.state, forkWeek: 12, parentRunId: "eski" };
    cleanup();
    render(<SimSourceProvider source={source}><Kosular /></SimSourceProvider>);
    expect(await screen.findByRole("heading", { level: 3, name: "Deneme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("kosular.eylem", { eylem: t("kosular.kaydet"), ad: "Deneme" }) })).toBeNull();
    expect(screen.getByRole("button", { name: t("kosular.eylem", { eylem: t("kosular.kapat"), ad: "Deneme" }) })).toBeInTheDocument();
    const [saved] = loadLibrary().runs;
    expect(saved).toMatchObject({ id: h.runId, name: "Deneme", source: "live", recipe: { templateId: "dayanikli_taban", durationWeeks: 200, values: { gecis_destegi: "kapali" } } });
    expect(screen.getByText(t("kosular.kart.acik"))).toBeInTheDocument();
  });

  it("open_live_rebuilds_from_recipe", async () => {
    seed([run("canli-yok", { name: "Eski", recipe: { ...run("x").recipe, schedule: [{ week: 30, patch: { gecis_destegi: "kurtarma_fonuyla" } }, { week: 60, patch: { ucret_stopaji: 5 } }] } })]);
    const { server } = mountLive();
    fireEvent.click(dugme("kosular.ac", "Eski"));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/canli\/run\d+$/));
    const [p] = posts(server);
    expect(p!.body).toEqual({
      config: { name: "Eski", cityNames: [], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 1, values: { gecis_destegi: "kapali" } },
      schedule: [{ week: 30, patch: { gecis_destegi: "kurtarma_fonuyla" } }, { week: 60, patch: { ucret_stopaji: 5 } }],
      fastForwardTo: 60,
    });
    const yeni = server.run(window.location.hash.slice("#/canli/".length))!;
    expect(yeni.state.preparing).toEqual({ done: 0, total: 60 });
    expect(yeni.state.versions).toHaveLength(3);
  });

  it("open_live_uses_the_server_run_when_it_still_exists", async () => {
    const { server, source } = mountLive();
    const h = await source.start(cfg);
    cleanup();
    seed([run(h.runId, { name: "Duran" })]);
    render(<SimSourceProvider source={source}><Kosular /></SimSourceProvider>);
    const once = posts(server).length;
    fireEvent.click(dugme("kosular.ac", "Duran"));
    await waitFor(() => expect(window.location.hash).toBe(`#/canli/${h.runId}`));
    expect(posts(server).length).toBe(once);
  });

  it.each([["too_many_runs"], ["busy_preparing"]] as const)("open_live_%s_shows_a_reason_and_stays", async (kod) => {
    seed([run("canli-yok", { name: "Eski" })]);
    const { server } = mountLive();
    server.startFailWith = kod;
    fireEvent.click(dugme("kosular.ac", "Eski"));
    expect(await screen.findByText(t(`canli.dallan.hata.${kod}`))).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(dugme("kosular.ac", "Eski")).toBeEnabled());
  });

  it("open_replay_uses_the_recipe_id_and_reports_a_missing_recording", async () => {
    seed([run("kayit-tarifi", { name: "Kayıt", source: "replay" })]);
    const open = vi.fn<SimSource["open"]>(async (id) => (id === "kayit-tarifi" ? ({ runId: "kayit-tarifi", state: {} } as RunHandle) : null));
    const src = { ...createFakeSource([], { kind: "replay" }), open } as SimSource;
    render(<SimSourceProvider source={src}><Kosular /></SimSourceProvider>);
    fireEvent.click(dugme("kosular.ac", "Kayıt"));
    await waitFor(() => expect(window.location.hash).toBe("#/canli/kayit-tarifi"));
    expect(open).toHaveBeenCalledWith("kayit-tarifi", undefined);
    open.mockResolvedValue(null);
    fireEvent.click(dugme("kosular.ac", "Kayıt"));
    expect(await screen.findByText(t("kosular.ac.kayit_yok"))).toBeInTheDocument();
  });

  it("delete_requires_confirm", async () => {
    seed([run("a", { name: "Birinci" }), run("b", { name: "İkinci" })]);
    mountLive();
    fireEvent.click(dugme("kosular.sil", "Birinci"));
    const dlg = await screen.findByRole("dialog", { name: t("kosular.sil.baslik") });
    expect(within(dlg).getByText(t("kosular.sil.metin", { ad: "Birinci" }))).toBeInTheDocument();
    expect(loadLibrary().runs).toHaveLength(2);
    fireEvent.click(within(dlg).getByRole("button", { name: t("kosular.vazgec") }));
    expect(screen.queryByRole("dialog", { name: t("kosular.sil.baslik") })).toBeNull();
    expect(loadLibrary().runs).toHaveLength(2);
    fireEvent.click(dugme("kosular.sil", "Birinci"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: t("kosular.sil.baslik") })).getByRole("button", { name: t("kosular.sil") }));
    expect(loadLibrary().runs.map((r) => r.id)).toEqual(["b"]);
    expect(screen.queryByRole("heading", { level: 3, name: "Birinci" })).toBeNull();
  });

  it("rename_updates_the_card_and_storage", () => {
    seed([run("a", { name: "Birinci" })]);
    mountLive();
    fireEvent.click(dugme("kosular.yeniden_adlandir", "Birinci"));
    fireEvent.change(screen.getByLabelText(t("kosular.yeni_ad")), { target: { value: "  Yeni Ad " } });
    fireEvent.click(screen.getByRole("button", { name: t("kosular.kaydet") }));
    expect(screen.getByRole("heading", { level: 3, name: "Yeni Ad" })).toBeInTheDocument();
    expect(loadLibrary().runs[0]!.name).toBe("Yeni Ad");
  });

  it("copy_rule_writes_a_builder_draft_for_step_two", () => {
    seed([run("a", { name: "Birinci", recipe: { ...run("x").recipe, schedule: [{ week: 30, patch: { ucret_stopaji: 5 } }], goals: ["alive"] } })]);
    mountLive();
    fireEvent.click(dugme("kosular.sarti_kopyala", "Birinci"));
    expect(window.location.hash).toBe("#/kurucu/2");
    const taslak = JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak")!) as Record<string, unknown>;
    expect(taslak).toMatchObject({ name: "Birinci", templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 1, goals: ["alive"], values: { gecis_destegi: "kapali", ucret_stopaji: 5 } });
  });

  it("copy_rule_draft_carries_city_names_and_custom_world_taslakOf", () => {
    seed([run("a", { name: "Birinci", cityNames: ["a", "b", "c", "d", "e"], recipe: { ...run("x").recipe, templateId: "bos_sart", worldScenarioId: "ozel", worldScenarioValues: { dunya_x: 9 } } })]);
    mountLive();
    fireEvent.click(dugme("kosular.sarti_kopyala", "Birinci"));
    const taslak = JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak")!) as Record<string, unknown>;
    expect(taslak).toMatchObject({ templateId: "bos_sart", worldScenarioId: "ozel", worldScenarioValues: { dunya_x: 9 }, cities: ["a", "b", "c", "d", "e"] });
  });

  it("fork_tree_nesting", () => {
    seed([run("a", { name: "Kök" }), run("b", { name: "Dal", parentId: "a", forkWeek: 40 }), run("c", { name: "Alt dal", parentId: "b", forkWeek: 60 }), run("y", { name: "Yetim", parentId: "silinmis", forkWeek: 5 })]);
    mountLive();
    const agac = screen.getByRole("list", { name: t("kosular.agac.baslik") });
    const kok = within(agac).getByText("Kök").closest("li")!;
    const dal = within(kok).getByText("Dal").closest("li")!;
    expect(within(dal).getByText("Alt dal")).toBeInTheDocument();
    expect(within(dal).getByText(new RegExp(t("kosular.agac.bilgi", { n: 40 })))).toBeInTheDocument();
    expect(within(kok).queryByText("Yetim")).toBeNull();
    expect(within(agac).getByText("Yetim").closest("ul")).toBe(agac);
  });

  it("export_then_import_roundtrip_and_field_errors_in_turkish", () => {
    seed([run("a", { name: "Birinci", parentId: "x", forkWeek: 3 })]);
    mountLive();
    fireEvent.click(dugme("kosular.disa_aktar", "Birinci"));
    const disa = screen.getByLabelText(t("kosular.disa.etiket")) as HTMLTextAreaElement;
    const metin = disa.value;
    fireEvent.click(dugme("kosular.sil", "Birinci"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("kosular.sil") }));
    const ice = screen.getByLabelText(t("kosular.ice.etiket"));
    fireEvent.change(ice, { target: { value: metin } });
    fireEvent.click(screen.getByRole("button", { name: t("kosular.ice.dugme") }));
    expect(screen.getByText(t("kosular.ice.tamam"))).toBeInTheDocument();
    expect(loadLibrary().runs).toEqual([run("a", { name: "Birinci", parentId: "x", forkWeek: 3 })]);
    fireEvent.change(ice, { target: { value: "{bozuk" } });
    fireEvent.click(screen.getByRole("button", { name: t("kosular.ice.dugme") }));
    expect(screen.getByText(t("kosular.ice.hata.json"))).toBeInTheDocument();
    fireEvent.change(ice, { target: { value: JSON.stringify({ ...run("z"), name: undefined }) } });
    fireEvent.click(screen.getByRole("button", { name: t("kosular.ice.dugme") }));
    expect(screen.getByText(t("kosular.ice.hata.field", { no: 1, alan: t("kosular.alan.name") }))).toBeInTheDocument();
    expect(loadLibrary().runs).toHaveLength(1);
  });

  it("compare_opens_the_run_and_prefills_it_as_b_on_the_result_of_the_current_run", async () => {
    seed([run("a", { name: "Birinci" })]);
    const open = vi.fn<SimSource["open"]>(async () => ({ runId: "yeni-b", state: {} } as RunHandle));
    const src = { ...createFakeSource([], { kind: "live", caps: { jobs: true }, listRuns: async () => [], startJob: async () => "j" }), open } as SimSource;
    sonKosuYaz("mevcut-a");
    render(<SimSourceProvider source={src}><Kosular /></SimSourceProvider>);
    const d = dugme("kosular.karsilastir", "Birinci");
    await waitFor(() => expect(d).toBeEnabled());
    fireEvent.click(d);
    await waitFor(() => expect(window.location.hash).toBe("#/sonuc/mevcut-a"));
    expect(abAdayiAl()).toBe("yeni-b");
  });

  it("compare_is_closed_with_a_reason_when_there_is_no_current_run_or_on_replay", async () => {
    seed([run("a", { name: "Birinci" })]);
    render(<SimSourceProvider source={createFakeSource([], { kind: "replay" })}><Kosular /></SimSourceProvider>);
    expect(dugme("kosular.karsilastir", "Birinci")).toBeDisabled();
    expect(screen.getByText(t("sonuc.ab.yok_kayit"))).toBeInTheDocument();
    cleanup();
    const src = createFakeSource([], { kind: "live", caps: { jobs: true }, listRuns: async () => [], startJob: async () => "j" });
    render(<SimSourceProvider source={src}><Kosular /></SimSourceProvider>);
    await act(async () => {});
    await waitFor(() => expect(screen.getByText(t("kosular.karsilastir.yok_a"))).toBeInTheDocument());
    expect(dugme("kosular.karsilastir", "Birinci")).toBeDisabled();
  });

  // ---- düzeltme turu 1 ----
  it("open_twice_rebuilds_once_and_remaps_the_entry_id_and_children", async () => {
    seed([run("canli-yok", { name: "Eski" }), run("alt", { name: "Alt", parentId: "canli-yok", forkWeek: 5 })]);
    const { server } = mountLive();
    fireEvent.click(dugme("kosular.ac", "Eski"));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/canli\/run\d+$/));
    const yeni = window.location.hash.slice("#/canli/".length);
    await waitFor(() => expect(loadLibrary().runs.find((r) => r.name === "Eski")!.id).toBe(yeni));
    expect(loadLibrary().runs.find((r) => r.name === "Alt")!.parentId).toBe(yeni);
    window.location.hash = "";
    await waitFor(() => expect(dugme("kosular.ac", "Eski")).toBeEnabled());
    fireEvent.click(dugme("kosular.ac", "Eski"));
    await waitFor(() => expect(window.location.hash).toBe(`#/canli/${yeni}`));
    expect(posts(server)).toHaveLength(1);
    // yeniden kurulan koşu aynı kartta kalır: ikinci kart eklenmez
    expect(loadLibrary().runs.filter((r) => r.name === "Eski")).toHaveLength(1);
  });

  it("long_names_are_refused_with_a_clear_field_error_and_the_rename_field_is_limited", () => {
    seed([run("a", { name: "Birinci" })]);
    mountLive();
    fireEvent.click(dugme("kosular.yeniden_adlandir", "Birinci"));
    expect(screen.getByLabelText(t("kosular.yeni_ad"))).toHaveAttribute("maxlength", "64");
    const ice = screen.getByLabelText(t("kosular.ice.etiket"));
    fireEvent.change(ice, { target: { value: JSON.stringify(run("z", { name: "u".repeat(65) })) } });
    fireEvent.click(screen.getByRole("button", { name: t("kosular.ice.dugme") }));
    expect(screen.getByText(t("kosular.ice.hata.ad_uzun", { no: 1 }))).toBeInTheDocument();
    expect(loadLibrary().runs).toHaveLength(1);
  });

  it("saved_week_and_city_names_drive_the_rebuild", async () => {
    seed([run("canli-yok", { name: "Haftalı", week: 40, cityNames: ["A", "B", "C", "D", "E"], recipe: { ...run("x").recipe, schedule: [{ week: 30, patch: { ucret_stopaji: 5 } }] } })]);
    const { server } = mountLive();
    fireEvent.click(dugme("kosular.ac", "Haftalı"));
    await waitFor(() => expect(posts(server)).toHaveLength(1));
    expect(posts(server)[0]!.body).toMatchObject({ config: { cityNames: ["A", "B", "C", "D", "E"] }, fastForwardTo: 40 });
  });

  it("the_automatic_entry_records_the_week_and_city_names", async () => {
    const { source } = mountLive();
    const h = await source.start({ ...cfg, name: "Deneme" });
    expect(loadLibrary().runs[0]).toMatchObject({ id: h.runId, week: 0, cityNames: ["a", "b", "c", "d", "e"] });
  });

  it("close_an_open_run_asks_for_confirmation_then_discards_it", async () => {
    const { server, source } = mountLive();
    const h = await source.start({ ...cfg, name: "Açık" });
    cleanup();
    render(<SimSourceProvider source={source}><Kosular /></SimSourceProvider>);
    fireEvent.click(await screen.findByRole("button", { name: t("kosular.eylem", { eylem: t("kosular.kapat"), ad: "Açık" }) }));
    const dlg = await screen.findByRole("dialog", { name: t("kosular.kapat.baslik") });
    expect(server.run(h.runId)).toBeDefined();
    fireEvent.click(within(dlg).getByRole("button", { name: t("kosular.vazgec") }));
    expect(server.run(h.runId)).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: t("kosular.eylem", { eylem: t("kosular.kapat"), ad: "Açık" }) }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: t("kosular.kapat.baslik") })).getByRole("button", { name: t("kosular.kapat") }));
    await waitFor(() => expect(server.run(h.runId)).toBeUndefined());
    expect(await screen.findByText(t("kosular.acik.yok"))).toBeInTheDocument();
  });

  it("rebuild_progress_dialog_has_its_own_text_not_the_branch_text", () => {
    render(<Hesaplaniyor yeniden ilerleme={{ done: 3, total: 40 }} />);
    expect(screen.getByText(t("kosular.yeniden.metin", { n: 40 }))).toBeInTheDocument();
    expect(screen.queryByText(/Dal koşusu/)).toBeNull();
    cleanup();
    render(<Hesaplaniyor yeniden />);
    expect(screen.getByText(t("kosular.yeniden.baslatiliyor"))).toBeInTheDocument();
  });

  // ---- düzeltme turu 2 ----
  it("an_entry_keeps_its_parent_and_fork_week_when_the_run_state_has_none", async () => {
    const { source } = mountLive();
    const h = await source.start({ ...cfg, name: "Dal" });
    seed([run("kok", { name: "Kök" }), run(h.runId, { name: "Dal", parentId: "kok", forkWeek: 12 })]);
    const kapat = source.subscribe(h.runId, () => {});
    await source.control(h.runId, { action: "step" });
    await source.control(h.runId, { action: "step" });
    await waitFor(() => expect(loadLibrary().runs.find((r) => r.id === h.runId)).toMatchObject({ parentId: "kok", forkWeek: 12, week: 2 }), { timeout: 3000 });
    kapat();
    cleanup();
    render(<SimSourceProvider source={source}><Kosular /></SimSourceProvider>);
    const agac = screen.getByRole("list", { name: t("kosular.agac.baslik") });
    expect(within(within(agac).getByText("Kök").closest("li")!).getByText("Dal")).toBeInTheDocument();
  });

  it("stored_entries_with_a_name_over_the_limit_are_listed_warned_and_cannot_be_opened", () => {
    const uzun = "u".repeat(70);
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schema: 1, runs: [run("a", { name: uzun })] }));
    mountLive();
    expect(screen.getByRole("heading", { level: 3, name: uzun })).toBeInTheDocument();
    expect(screen.getByText(t("kosular.kart.ad_uzun"))).toBeInTheDocument();
    expect(dugme("kosular.ac", uzun)).toBeDisabled();
    expect(dugme("kosular.karsilastir", uzun)).toBeDisabled();
    fireEvent.click(dugme("kosular.yeniden_adlandir", uzun));
    expect((screen.getByLabelText(t("kosular.yeni_ad")) as HTMLInputElement).value.length).toBeLessThanOrEqual(64);
    fireEvent.click(screen.getByRole("button", { name: t("kosular.kaydet") }));
    expect(screen.queryByText(t("kosular.kart.ad_uzun"))).toBeNull();
    expect(dugme("kosular.ac", "u".repeat(64))).toBeEnabled();
  });

  it("rename_while_an_open_is_in_flight_does_not_lose_the_id_mapping", async () => {
    seed([run("canli-yok", { name: "Eski" }), run("b", { name: "Öteki" })]);
    const server = createFakeLiveServer();
    let birak: () => void = () => {};
    const bekle = new Promise<void>((r) => { birak = r; });
    const fetchImpl: typeof fetch = async (i, init) => {
      if (init?.method === "POST" && String(i).endsWith("/api/runs")) await bekle;
      return server.fetch(i, init);
    };
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl, eventSourceImpl: server.EventSource });
    disposables.push(source);
    render(<SimSourceProvider source={source}><Kosular /></SimSourceProvider>);
    fireEvent.click(dugme("kosular.ac", "Eski"));
    fireEvent.click(dugme("kosular.yeniden_adlandir", "Öteki"));
    fireEvent.change(screen.getByLabelText(t("kosular.yeni_ad")), { target: { value: "Yeni Öteki" } });
    fireEvent.click(screen.getByRole("button", { name: t("kosular.kaydet") }));
    birak();
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/canli\/run\d+$/));
    const yeni = window.location.hash.slice("#/canli/".length);
    await waitFor(() => expect(loadLibrary().runs.map((r) => `${r.id}:${r.name}`).sort()).toEqual([`${yeni}:Eski`, "b:Yeni Öteki"].sort()));
  });

  it("open_rebuild_then_following_the_run_updates_the_same_card_and_keeps_the_saved_week", async () => {
    seed([run("canli-yok", { name: "Eski", week: 40, recipe: { ...run("x").recipe, schedule: [{ week: 30, patch: { ucret_stopaji: 5 } }] } })]);
    const { source } = mountLive();
    fireEvent.click(dugme("kosular.ac", "Eski"));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/canli\/run\d+$/));
    const yeni = window.location.hash.slice("#/canli/".length);
    const kapat = source.subscribe(yeni, () => {}); // Canlı ekranı gibi (koşu hâlâ hazırlanıyor, hafta 0)
    await new Promise((r) => setTimeout(r, 300));
    kapat();
    const kayitlar = loadLibrary().runs;
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0]).toMatchObject({ id: yeni, name: "Eski", week: 40 });
  });
});
