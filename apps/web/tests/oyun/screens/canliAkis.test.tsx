import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { parsePacket } from "@/oyun/sim/live/wire";
import { tr } from "@/oyun/copy/tr";
import { t } from "@/oyun/copy/t";
import type { Diagnostic, RunHandle, SimEvent, RunState, WeekPacket, WorldEvent } from "@/oyun/sim/types";
import { ayrintilariAc, mountCanli, packets, state, week } from "../helpers/canliMount";
import { packet } from "../helpers/sehirZincirVeri";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/canli/r";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tani = (over: Partial<Diagnostic> = {}): Diagnostic => ({ id: "faiz", textKey: "neolmuyor.faiz_dusmuyor", params: { hafta: 13 }, rule_ids: ["faiz_kurali"], since_week: 20, ...over });
const olay = (id: string, kind: WorldEvent["kind"], textKey: WorldEvent["textKey"], w: number, over: Partial<WorldEvent> = {}): WorldEvent => ({
  id, week: w, kind, textKey, params: { hafta: w, sayi: 12, oran: 40 }, critical: false, sector: null, rule_ids: [], ...over,
});
const withPacket = (w: number, extra: Partial<WeekPacket>) => week({ ...packet(w), ...extra });
const handleOf = (id: string, over: Partial<RunState> = {}): RunHandle => ({ runId: id, state: (state({ runId: id, ...over }) as { state: RunState }).state });
const bolge = (ad: string) => screen.getByRole("region", { name: ad });

describe("W9b Ne olmuyor", () => {
  it("diagnostics_render_and_disappear", async () => {
    const { src, view } = mountCanli([state(), ...packets(2), withPacket(3, { diagnostics: [tani()] })]);
    await ayrintilariAc("Olaylar");
    const panel = await screen.findByRole("region", { name: "Ne olmuyor" });
    expect(await within(panel).findByText(/Faiz düşmüyor/)).toBeInTheDocument();
    expect(within(panel).getByText("20. haftadan beri")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Bu kuralı değiştir" })).toBeInTheDocument();
    act(() => src.emit("r", withPacket(4, { diagnostics: [] })));
    expect(await within(bolge("Ne olmuyor")).findByText("Şu an beklenip de olmayan bir şey yok.")).toBeInTheDocument();
    expect(within(bolge("Ne olmuyor")).queryByText(/Faiz düşmüyor/)).toBeNull();
    view.unmount();
  });

  it("no_diagnostics_field_says_record_has_none", async () => {
    mountCanli([state(), ...packets(3)], { kind: "replay", caps: { city: true, chain: true } });
    await ayrintilariAc("Olaylar");
    expect(await within(await screen.findByRole("region", { name: "Ne olmuyor" })).findByText("Bu kayıtta tanı yok")).toBeInTheDocument();
  });

  it("no_diagnostics_field_live_wording_has_no_record_word", async () => {
    mountCanli([state(), ...packets(3)]);
    await ayrintilariAc("Olaylar");
    expect(await within(await screen.findByRole("region", { name: "Ne olmuyor" })).findByText("Bu koşuda tanı yok")).toBeInTheDocument();
  });

  it("unknown_diagnostic_dropped", () => {
    const raw = { v: 1, run_id: "r", week: 3, version: 1, world: packet(3).world, events: [], diagnostics: [
      { id: "a", textKey: "neolmuyor.faiz_dusmuyor", params: {}, rule_ids: [], since_week: 5 },
      { id: "b", textKey: "neolmuyor.hic_yok", params: {}, rule_ids: [], since_week: 5 },
      { id: "c", textKey: "canli.oynat", params: {}, rule_ids: [], since_week: 5 },
    ] };
    expect(parsePacket(raw).diagnostics?.map((d) => d.id)).toEqual(["a"]);
  });

  it("wire_diagnostic_keys_exist_in_copy", () => {
    const wire = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/server/tests/fixtures/wire_contract.json"), "utf-8")) as { enums: { diagnosticTextKeys: string[] } };
    expect(wire.enums.diagnosticTextKeys.length).toBeGreaterThan(0);
    for (const k of wire.enums.diagnosticTextKeys) {
      expect(k.startsWith("neolmuyor.")).toBe(true);
      expect(Object.hasOwn(tr, k), k).toBe(true);
    }
  });
});

describe("W9b olay süzgeci ve neden-sonuç", () => {
  const evs = [olay("kredi_ret:5", "warn", "event.kredi_ret", 5), olay("batis10:6", "bad", "event.batis10", 6, { critical: true }), olay("ozellestirme:7", "neutral", "event.ozellestirme", 7)];

  it("feed_filter_modes", async () => {
    mountCanli([state(), ...packets(2), withPacket(3, { events: [evs[0]!] }), withPacket(4, { events: [evs[1]!, evs[2]!] })]);
    await ayrintilariAc("Olaylar");
    const akis = await screen.findByRole("region", { name: "Olay akışı" });
    const suz = within(akis).getByRole("group", { name: "Süzgeç" });
    await waitFor(() => expect(within(akis).getByText(/toplam 12 yerleşik işletme battı/)).toBeInTheDocument());
    expect(within(suz).getByRole("button", { name: "Yalnız önemli olaylar" })).toHaveAttribute("aria-pressed", "true");
    expect(within(akis).queryByText(/kredi başvurusu reddedildi/)).toBeNull();
    expect(within(akis).queryByText(/ilk özelleştirme/)).toBeNull();
    fireEvent.click(within(suz).getByRole("button", { name: "Tümü" }));
    expect(within(akis).getByText(/kredi başvurusu reddedildi/)).toBeInTheDocument();
    expect(within(akis).getByText(/ilk özelleştirme/)).toBeInTheDocument();
    expect(within(suz).getByRole("button", { name: "Tümü" })).toHaveAttribute("aria-pressed", "true");
  });

  it("event_select_opens_chain_steps", async () => {
    const e = olay("cokus:6", "bad", "event.cokus", 6, { critical: true, rule_ids: ["gecis_destegi"], chain: [
      { step: "a", textKey: "event.destek_basladi", params: { hafta: 4 } }, { step: "b", textKey: "event.kasa25", params: { hafta: 5 } },
    ] });
    mountCanli([state(), ...packets(2), withPacket(3, { events: [e] })]);
    await ayrintilariAc("Olaylar");
    const zincir = await screen.findByRole("region", { name: "Neden-sonuç zinciri" });
    expect(within(zincir).getByText(/Olay akışından bir olaya tıkla/)).toBeInTheDocument();
    fireEvent.click(await within(bolge("Olay akışı")).findByRole("button", { name: /talep karşılama %50 düzeyinin altına indi/ }));
    const adimlar = within(await screen.findByRole("region", { name: "Neden-sonuç zinciri" })).getByRole("list", { name: "Zincir adımları" });
    expect(within(adimlar).getAllByRole("listitem").map((x) => x.textContent)).toEqual([expect.stringContaining("geçiş desteği ödemeleri başladı"), expect.stringContaining("şehir kasası 25 bin altına indi")]);
  });

  it("event_without_chain_lists_rules_or_says_none", async () => {
    const e1 = olay("cokus:6", "bad", "event.cokus", 6, { critical: true, rule_ids: ["gecis_destegi"] });
    const e2 = olay("batis10:6", "bad", "event.batis10", 6, { critical: true });
    mountCanli([state(), ...packets(2), withPacket(3, { events: [e1, e2] })]);
    await ayrintilariAc("Olaylar");
    fireEvent.click(await within(bolge("Olay akışı")).findByRole("button", { name: /yerleşik işletme battı/ }));
    expect(within(bolge("Neden-sonuç zinciri")).getByText("Bu olay için zincir kaydı yok")).toBeInTheDocument();
    fireEvent.click(within(bolge("Olay akışı")).getByRole("button", { name: /düzeyinin altına indi: kriz/ }));
    const z = bolge("Neden-sonuç zinciri");
    expect(within(z).getByRole("list", { name: "Olayı etkileyen kurallar" }).textContent).toContain("→");
    expect(within(z).queryByText("Bu olay için zincir kaydı yok")).toBeNull();
  });
});

describe("W9b zaman çizgisi ve dallanma", () => {
  const branchOk = (id = "d1") => vi.fn(async (): Promise<RunHandle> => handleOf(id, { preparing: { done: 0, total: 2 }, parentRunId: "r", forkWeek: 2 }));

  it("timeline_pick_shows_box_and_branch", async () => {
    const branch = branchOk();
    mountCanli([state({ week: 3 }), ...packets(3)], { caps: { branch: true, city: true, chain: true }, branch });
    await ayrintilariAc("Zaman çizgisi");
    const z = await screen.findByRole("region", { name: "Zaman çizgisi" });
    expect(within(z).queryByRole("button", { name: "Bu haftadan dallan" })).toBeNull();
    fireEvent.change(within(z).getByLabelText("Geçmiş hafta"), { target: { value: "2" } });
    expect(within(z).getByText(/^2\. hafta · karşılama %80 · işsizlik ölçülmüyor$/)).toBeInTheDocument();
    expect(within(z).getByRole("button", { name: "Bu haftadan dallan" })).toBeEnabled();
    fireEvent.click(within(z).getByRole("button", { name: "Kapat" }));
    expect(within(z).queryByText(/^2\. hafta · /)).toBeNull();
    fireEvent.change(within(z).getByLabelText("Geçmiş hafta"), { target: { value: "2" } });
    fireEvent.click(within(z).getByRole("button", { name: "Bu haftanın olayları" }));
    expect(within(bolge("Olay akışı")).getByText("2. hafta olayları")).toBeInTheDocument();
    expect(within(bolge("Olay akışı")).getByRole("button", { name: "Tümü" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(bolge("Olay akışı")).getByRole("button", { name: "Tümünü göster" }));
    expect(within(bolge("Olay akışı")).queryByText("2. hafta olayları")).toBeNull();
  });

  it("branch_progress_then_new_run_route", async () => {
    let bitir!: (h: RunHandle) => void;
    const branch = vi.fn(() => new Promise<RunHandle>((r) => { bitir = r; }));
    mountCanli([state({ week: 3 }), ...packets(3)], { caps: { branch: true, city: true, chain: true }, branch });
    await ayrintilariAc("Zaman çizgisi");
    const z = await screen.findByRole("region", { name: "Zaman çizgisi" });
    fireEvent.change(within(z).getByLabelText("Geçmiş hafta"), { target: { value: "2" } });
    fireEvent.click(within(z).getByRole("button", { name: "Bu haftadan dallan" }));
    expect(branch).toHaveBeenCalledWith("r", 2);
    const d = await screen.findByRole("dialog", { name: "Simülasyon hesaplanıyor" });
    expect(within(d).getByText("Dal koşusu başlatılıyor.")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/canli/r");
    await act(async () => bitir(handleOf("d1", { preparing: { done: 0, total: 2 }, parentRunId: "r", forkWeek: 2 })));
    await waitFor(() => expect(window.location.hash).toBe("#/canli/d1"));
  });

  it("branch_response_after_leaving_does_not_navigate_and_discards_orphan", async () => {
    let bitir!: (h: RunHandle) => void;
    const branch = vi.fn(() => new Promise<RunHandle>((r) => { bitir = r; }));
    const discard = vi.fn(async () => { throw new SimUnsupported("unknown_run"); }); // 404 sessiz
    const { view } = mountCanli([state({ week: 3 }), ...packets(3)], { caps: { branch: true, city: true, chain: true }, branch, discard });
    await ayrintilariAc("Zaman çizgisi");
    const z = await screen.findByRole("region", { name: "Zaman çizgisi" });
    fireEvent.change(within(z).getByLabelText("Geçmiş hafta"), { target: { value: "2" } });
    fireEvent.click(within(z).getByRole("button", { name: "Bu haftadan dallan" }));
    await screen.findByRole("dialog", { name: "Simülasyon hesaplanıyor" });
    view.unmount();
    window.location.hash = "#/kurucu";
    await act(async () => bitir(handleOf("d1", { preparing: { done: 0, total: 2 }, parentRunId: "r", forkWeek: 2 })));
    expect(window.location.hash).toBe("#/kurucu");
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith("d1");
  });

  it("preparing_state_shows_progress_and_cancel_keeps_parent", async () => {
    const discard = vi.fn(async () => {});
    mountCanli([state({ week: 0, preparing: { done: 5, total: 10 }, parentRunId: "p", forkWeek: 10 })], { kind: "live", caps: { branch: true }, discard, aliases: { p: "r" } });
    window.location.hash = "#/canli/cocuk";
    const d = await screen.findByRole("dialog", { name: "Simülasyon hesaplanıyor" });
    const bar = within(d).getByRole("progressbar", { name: "Dal hazırlığı" });
    expect((bar as HTMLProgressElement).value).toBe(5);
    expect((bar as HTMLProgressElement).max).toBe(10);
    expect(within(d).getByText("5 / 10 hafta hazır")).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "İptal et" }));
    await waitFor(() => expect(discard).toHaveBeenCalledWith("r"));
    expect(discard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(window.location.hash).toBe("#/canli/r")); // üst koşunun kendi kimliği (takma ad çözülür)
  });

  it("branch_cancel_without_parent_goes_to_builder", async () => {
    const discard = vi.fn(async () => {});
    mountCanli([state({ week: 0, preparing: { done: 1, total: 10 }, parentRunId: "silinmis", forkWeek: 10 })], { kind: "live", caps: { branch: true }, discard });
    fireEvent.click(await screen.findByRole("button", { name: "İptal et" }));
    await waitFor(() => expect(window.location.hash).toBe("#/kurucu"));
    expect(discard).toHaveBeenCalledWith("r");
  });

  it("branch_error_reasons_are_shown", async () => {
    const branch = vi.fn(async (): Promise<RunHandle> => { throw new SimUnsupported("too_many_runs"); });
    mountCanli([state({ week: 3 }), ...packets(3)], { caps: { branch: true }, branch });
    await ayrintilariAc("Zaman çizgisi");
    const z = await screen.findByRole("region", { name: "Zaman çizgisi" });
    fireEvent.change(within(z).getByLabelText("Geçmiş hafta"), { target: { value: "1" } });
    fireEvent.click(within(z).getByRole("button", { name: "Bu haftadan dallan" }));
    // İstek sürerken pencere "Hesaplanıyor" diyaloğuna yol verir; hata dönünce pencere aynı sekmede ve seçili haftada geri gelir.
    expect(await within(await screen.findByRole("region", { name: "Zaman çizgisi" })).findByText("Açık koşu sınırına ulaşıldı. Bir koşuyu kapatıp yeniden dene.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Simülasyon hesaplanıyor" })).toBeNull();
  });

  it("replay_branch_disabled_with_reason", async () => {
    mountCanli([state({ week: 3 }), ...packets(3)], { kind: "replay", caps: { city: true, chain: true } });
    await ayrintilariAc("Zaman çizgisi");
    const z = await screen.findByRole("region", { name: "Zaman çizgisi" });
    fireEvent.change(within(z).getByLabelText("Geçmiş hafta"), { target: { value: "2" } });
    const dugme = within(z).getByRole("button", { name: "Bu haftadan dallan" });
    expect(dugme).toBeDisabled();
    const neden = within(z).getByText("Dallanma yalnız canlı modelde var; kayıttan oynatılan koşuda kapalı.");
    expect(dugme.getAttribute("aria-describedby")).toBe(neden.id);
  });
});

describe("W9b sıfırdan başlat ve bitiş", () => {
  const bitti = (over: Partial<RunState> = {}) => state({ status: "ended", week: 200, endedReason: "duration", seedIndex: 2, scenarioId: "dayanikli_taban", values: { a: "yeni" }, versions: [{ version: 1, fromWeek: 0, values: { a: "eski", b: 1 } }, { version: 2, fromWeek: 30, values: { a: "yeni", b: 1 } }], version: 2, goals: ["alive"], ...over });
  const cokus = olay("cokus:50", "bad", "event.cokus", 50, { critical: true });
  const topar = olay("toparlanma:80", "good", "event.toparlanma", 80);
  /** Koşu bu oturumda bitiş anına geçer (M8): önce sürüyor, sonra `ended` durumu gelir. */
  const bitisteAc = async (script: SimEvent[], opts: Parameters<typeof mountCanli>[1] = {}, over: Partial<RunState> = {}) => {
    const m = mountCanli([state({ status: "paused", week: 199, durationWeeks: 200, seedIndex: 2, scenarioId: "dayanikli_taban", goals: ["alive"], ...over }), ...script], opts);
    await screen.findByText(t("canli.hafta", { n: 199, toplam: 200 })); // ilk durum ekranda
    act(() => m.src.emit("r", bitti(over)));
    return m;
  };

  it("end_dialog_actions", async () => {
    const branch = vi.fn(async (): Promise<RunHandle> => handleOf("d9", { preparing: { done: 0, total: 199 } }));
    await bitisteAc([withPacket(199, { events: [cokus, topar] }), withPacket(200, {})], { caps: { branch: true }, branch });
    const d = await screen.findByRole("dialog", { name: "200 hafta tamamlandı" });
    expect(within(d).getByText(/50\. haftada çöktü; 80\. haftada toparlandı/)).toBeInTheDocument();
    for (const ad of ["Sonucu gör", "Bu haftadan dallan", "Sıfırdan başlat", "Kapat"]) expect(within(d).getByRole("button", { name: ad })).toBeInTheDocument();
    fireEvent.click(within(d).getByRole("button", { name: "Bu haftadan dallan" }));
    expect(branch).toHaveBeenCalledWith("r", 199); // W < süre
    await waitFor(() => expect(window.location.hash).toBe("#/canli/d9"));
  });

  it("end_dialog_result_and_close", async () => {
    await bitisteAc(packets(2));
    let d = await screen.findByRole("dialog", { name: "200 hafta tamamlandı" });
    fireEvent.click(within(d).getByRole("button", { name: "Kapat" }));
    expect(screen.queryByRole("dialog", { name: "200 hafta tamamlandı" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bitiş seçeneklerini aç" }));
    d = await screen.findByRole("dialog", { name: "200 hafta tamamlandı" });
    fireEvent.click(within(d).getByRole("button", { name: "Sonucu gör" }));
    expect(window.location.hash).toBe("#/sonuc/r");
  });

  it("end_dialog_branch_disabled_on_replay", async () => {
    await bitisteAc(packets(2), { kind: "replay", caps: {} });
    const d = await screen.findByRole("dialog", { name: "200 hafta tamamlandı" });
    expect(within(d).getByRole("button", { name: "Bu haftadan dallan" })).toBeDisabled();
    expect(within(d).getByText(/kayıttan oynatılan koşuda kapalı/)).toBeInTheDocument();
  });

  it("end_dialog_only_on_transition_not_when_ended_run_opens", async () => {
    mountCanli([bitti(), ...packets(2)]);
    expect(await screen.findByRole("button", { name: "Bitiş seçeneklerini aç" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "200 hafta tamamlandı" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bitiş seçeneklerini aç" }));
    expect(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).toBeInTheDocument();
  });

  it("reset_same_config_new_run", async () => {
    const { src } = await bitisteAc(packets(2));
    const start = vi.spyOn(src, "start").mockResolvedValue(handleOf("n1", { status: "ready", week: 0 }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    const r = await screen.findByRole("dialog", { name: "Sıfırdan başlat" });
    expect(within(r).getByText("200 haftalık koşu olduğu gibi kalır. Açık koşu sınırı aşılırsa eski bir koşu silinebilir.")).toBeInTheDocument();
    expect(within(r).queryByText(/kaydedilecek/)).toBeNull();
    fireEvent.click(within(r).getByRole("button", { name: "Aynı şartla 0. haftadan" }));
    await waitFor(() => expect(window.location.hash).toBe("#/canli/n1"));
    expect(start).toHaveBeenCalledWith({
      name: "Dünya", cityNames: ["Ada", "Bora", "Cem", "Dil", "Efe"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 2, values: { a: "eski", b: 1 }, goals: ["alive"], schedule: [{ week: 30, patch: { a: "yeni" } }],
    });
  });

  it("reset_schedule_is_diff_of_consecutive_full_sets", async () => {
    const versions = [
      { version: 1, fromWeek: 0, values: { a: "x", b: 1, c: true, bas: 5 } },
      { version: 2, fromWeek: 20, values: { a: "y", b: 1, c: true, bas: 5 } },
      { version: 3, fromWeek: 20, values: { a: "y", b: 1, c: true, bas: 5 } }, // fark yok: takvime girmez
      { version: 4, fromWeek: 60, values: { a: "y", b: 2, c: false, bas: 5 } },
    ];
    const { src } = await bitisteAc(packets(2), {}, { versions, version: 4, values: { a: "y", b: 2, c: false, bas: 5 } });
    const start = vi.spyOn(src, "start").mockResolvedValue(handleOf("n2", { status: "ready", week: 0 }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Sıfırdan başlat" })).getByRole("button", { name: "Aynı şartla 0. haftadan" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const cfg = start.mock.calls[0]![0];
    expect(cfg.values).toEqual({ a: "x", b: 1, c: true, bas: 5 });
    expect(cfg.schedule).toEqual([{ week: 20, patch: { a: "y" } }, { week: 60, patch: { b: 2, c: false } }]);
  });

  it("reset_without_later_versions_sends_no_schedule", async () => {
    const { src } = await bitisteAc(packets(2), {}, { versions: [{ version: 1, fromWeek: 0, values: { a: "x" } }], version: 1, values: { a: "x" } });
    const start = vi.spyOn(src, "start").mockResolvedValue(handleOf("n3", { status: "ready", week: 0 }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Sıfırdan başlat" })).getByRole("button", { name: "Aynı şartla 0. haftadan" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0]).not.toHaveProperty("schedule");
  });

  it("reset_same_disabled_for_custom_world_with_reason", async () => {
    const { src } = await bitisteAc(packets(2), {}, { worldScenarioId: "ozel" });
    const start = vi.spyOn(src, "start");
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    const r = await screen.findByRole("dialog", { name: "Sıfırdan başlat" });
    const dugme = within(r).getByRole("button", { name: "Aynı şartla 0. haftadan" });
    expect(dugme).toBeDisabled();
    const neden = within(r).getByText(tr["canli.sifirla.kapali_ozel"]);
    expect(dugme.getAttribute("aria-describedby")).toBe(neden.id);
    fireEvent.click(dugme);
    expect(start).not.toHaveBeenCalled();
    expect(within(r).getByRole("button", { name: "Ekonomi Kurucu'ya dön" })).toBeEnabled();
  });

  it("reset_same_disabled_when_changed_rule_has_no_server_versions", async () => {
    const { src } = await bitisteAc(packets(2), {}, { version: 2, versions: [], values: { a: "y" } }); // eski sunucu: `versions` yok
    const start = vi.spyOn(src, "start");
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    const r = await screen.findByRole("dialog", { name: "Sıfırdan başlat" });
    const dugme = within(r).getByRole("button", { name: "Aynı şartla 0. haftadan" });
    expect(dugme).toBeDisabled();
    expect(dugme.getAttribute("aria-describedby")).toBe(within(r).getByText(tr["canli.sifirla.kapali_surum"]).id);
    fireEvent.click(dugme);
    expect(start).not.toHaveBeenCalled();
  });

  it("reset_same_works_for_custom_world_when_the_server_gives_its_values", async () => {
    const { src } = await bitisteAc(packets(2), {}, { worldScenarioId: "ozel", worldScenarioValues: { ornek_akce: 3000 } });
    const start = vi.spyOn(src, "start").mockResolvedValue(handleOf("n4", { status: "ready", week: 0 }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Sıfırdan başlat" })).getByRole("button", { name: "Aynı şartla 0. haftadan" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0]).toMatchObject({ worldScenarioId: "ozel", worldScenarioValues: { ornek_akce: 3000 } });
  });

  it("invalid_branch_message_makes_no_cause_claim", () => {
    expect(tr["canli.dallan.hata.invalid_branch"]).toBe("Bu haftadan dallanılamıyor.");
  });

  it("reset_dialog_builder_and_cancel", async () => {
    await bitisteAc(packets(2));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    let r = await screen.findByRole("dialog", { name: "Sıfırdan başlat" });
    fireEvent.click(within(r).getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByRole("dialog", { name: "Sıfırdan başlat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bitiş seçeneklerini aç" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    r = await screen.findByRole("dialog", { name: "Sıfırdan başlat" });
    fireEvent.click(within(r).getByRole("button", { name: "Ekonomi Kurucu'ya dön" }));
    expect(window.location.hash).toBe("#/kurucu");
  });

  it("reset_start_failure_shows_message", async () => {
    const { src } = await bitisteAc(packets(2));
    const start = vi.spyOn(src, "start").mockRejectedValueOnce(new SimUnsupported("too_many_runs")).mockRejectedValueOnce(new SimUnsupported("unsupported"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "200 hafta tamamlandı" })).getByRole("button", { name: "Sıfırdan başlat" }));
    const r = await screen.findByRole("dialog", { name: "Sıfırdan başlat" });
    fireEvent.click(within(r).getByRole("button", { name: "Aynı şartla 0. haftadan" }));
    expect(await screen.findByText("Açık koşu sınırına ulaşıldı. Bir koşuyu kapatıp yeniden dene.")).toBeInTheDocument();
    fireEvent.click(within(r).getByRole("button", { name: "Aynı şartla 0. haftadan" }));
    expect(await screen.findByText("Yeni koşu başlatılamadı.")).toBeInTheDocument();
    expect(start).toHaveBeenCalledTimes(2);
  });
});
