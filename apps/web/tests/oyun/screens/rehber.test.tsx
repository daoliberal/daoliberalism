import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { degistirKapat } from "@/oyun/screens/canli/degistirDurumu";
import { Baslangic } from "@/oyun/screens/baslangic/Baslangic";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { duraklatildiMi, duraklatildiYaz, ipucuGorulduMu, rehberKosuDevral, rehberKosuIsaretle, rehberKosuMu, turGoruldu, turGorulduYaz } from "@/oyun/screens/rehber/rehberDurumu";
import { turAdimlari } from "@/oyun/screens/rehber/turAdimlari";
import { Sonuc } from "@/oyun/screens/sonuc/Sonuc";
import { ilkKritikOlay } from "@/oyun/sim/eventRules";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Availability, Registry, RunConfig, RunHandle, SimSource, SourceInfo, WorldEvent } from "@/oyun/sim/types";
import { mountCanli, packets, state, week } from "../helpers/canliMount";
import { createFakeSource } from "../helpers/fakeSource";
import { contractRegistry } from "../helpers/registryFixtures";
import { packet } from "../helpers/sehirZincirVeri";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

/** Kayıt kart sayısına bağlı değil: kartlar canlı sayılır (kilit nedenleri bu testlerin konusu değil). */
function kayit(): Registry {
  const reg = contractRegistry();
  reg.cards = reg.cards.map((c) => ({ ...c, apply: "live" as const }));
  reg.scenarios = reg.scenarios.map((s) => ({ ...s, startable: true }));
  return reg;
}

function kaynak(registry: Registry = kayit()) {
  const info: SourceInfo = {
    kind: "live", modelNote: "x", seeds: [0, 1].map((i) => ({ index: i, label: i })) as unknown as SourceInfo["seeds"], durationWeeks: 200, durations: [100, 200, 500],
    settings: [], fixedRules: [], templates: registry.templates.map((x) => ({ id: x.id, values: x.values })), registry,
  };
  const availability = vi.fn(async (): Promise<Availability> => ({ ok: true, scenarioId: "k", blocked: [] }));
  const start = vi.fn(async (c: RunConfig): Promise<RunHandle> => ({
    runId: "y1", state: { runId: "y1", status: "ready", week: 0, durationWeeks: c.durationWeeks, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "kapali", name: c.name, cityNames: c.cityNames },
  }));
  const source = {
    kind: "live", capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => info, availability, start, open: async () => null, subscribe: () => () => {}, control: vi.fn(), applyChange: vi.fn(), weeks: vi.fn(), dispose: () => {},
  } as unknown as SimSource;
  return { source, start, registry };
}

const nav = () => screen.getByRole("navigation", { name: t("kurucu.adim.nav") });
const sade = () => window.sessionStorage.setItem("oyun.kurucu.taslak", JSON.stringify({ name: "Ada", cities: ["a", "b", "c", "d", "e"], templateId: null, values: {}, scenarioId: null, worldScenarioId: null, worldScenarioValues: {}, durationWeeks: null, seedIndex: null, goals: [] }));

async function rehberAc(registry?: Registry) {
  window.location.hash = "#/kurucu/rehberli";
  const k = kaynak(registry);
  const view = render(<SimSourceProvider source={k.source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
  await screen.findByRole("heading", { name: t("rehber.baslik") });
  await within(nav()).findByRole("button", { name: new RegExp(t("rehber.adim.sablon")) });
  return { ...k, ...view };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "#/";
  sade();
});
afterEach(() => {
  degistirKapat(); // "Şartı değiştir" açık durumu modül düzeyindedir; testler arasında sızmasın
  cleanup();
  vi.restoreAllMocks();
});

describe("W12 rehberli akış", () => {
  it("guided_flow_three_steps", async () => {
    const { start } = await rehberAc();
    const adimlar = within(nav()).getAllByRole("button");
    expect(adimlar.map((b) => b.textContent)).toEqual([expect.stringContaining(t("rehber.adim.sablon")), expect.stringContaining(t("rehber.adim.tur")), expect.stringContaining(t("rehber.adim.oynat"))]);
    // Adım 1: şablon ve dünya adı; uzman ayarlar yok, "Rehberi atla" var.
    expect(screen.getByRole("button", { name: t("rehber.atla") })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: t("kurucu.ad_etiket") })).toBeInTheDocument();
    // Adım 2: tur kendiliğinden açılır (tur görülmedi).
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("rehber.adim.tur") }) }));
    const tur = await screen.findByRole("dialog");
    expect(tur).toBeInTheDocument();
    fireEvent.click(within(tur).getByRole("button", { name: t("rehber.tur.bitir") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(turGoruldu()).toBe(true);
    // Uzman ayarları rehberli kipte yok.
    expect(screen.queryByRole("button", { name: /^Göster \(\d+\)$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("rehber.adim.oynat") }) }));
    expect(await screen.findByText(t("rehber.baslat_not"))).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: t("kurucu.baslat") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rehberKosuMu("y1")).toBe(true));
  });

  it("non_guided_start_clears_guided_mark", async () => {
    rehberKosuIsaretle("y1", true);
    window.location.hash = "#/kurucu";
    const k = kaynak();
    render(<SimSourceProvider source={k.source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: t("kurucu.baslat") })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(k.start).toHaveBeenCalled());
    await waitFor(() => expect(rehberKosuMu("y1")).toBe(false));
  });

  it("skip_guide_returns_to_full_builder", async () => {
    await rehberAc();
    fireEvent.click(screen.getByRole("button", { name: t("rehber.atla") }));
    expect(within(nav()).getAllByRole("button")).toHaveLength(5);
    expect(window.location.hash).toBe("#/kurucu");
  });

  it("start_page_suggests_first_game_until_tour_seen", async () => {
    const k = kaynak();
    const view = render(<SimSourceProvider source={k.source}><Baslangic /></SimSourceProvider>);
    expect(screen.getByText(t("rehber.oner"))).toBeInTheDocument();
    view.unmount();
    turGorulduYaz();
    render(<SimSourceProvider source={k.source}><Baslangic /></SimSourceProvider>);
    expect(screen.queryByText(t("rehber.oner"))).toBeNull();
  });
});

describe("W12 tur", () => {
  const turuAc = async (registry?: Registry) => {
    const k = await rehberAc(registry);
    const devam = screen.getByRole("button", { name: t("kurucu.devam", { ad: t("rehber.adim.tur") }) });
    devam.focus();
    fireEvent.click(devam);
    return { ...k, tur: await screen.findByRole("dialog") };
  };

  it("tour_decision_keep_default_or_next", async () => {
    const { tur, start } = await turuAc();
    // Giriş adımları yalnız "İlerle" ile ilerler.
    expect(within(tur).getByRole("button", { name: t("rehber.tur.ilerle") })).toBeInTheDocument();
    expect(within(tur).queryByRole("button", { name: t("rehber.tur.varsayilan") })).toBeNull();
    for (let i = 0; i < 3; i += 1) fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.ilerle") }));
    // Karar adımı: iki düğme de var; kartın kendi metni gösterilir.
    let dlg = screen.getByRole("dialog");
    expect(within(dlg).getByRole("button", { name: t("rehber.tur.varsayilan") })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: t("rehber.tur.sonraki") })).toBeInTheDocument();
    expect(within(dlg).getByText(t("rehber.tur.kural_giris"))).toBeInTheDocument();
    // "Ücret stopajı" adımına gel, değeri değiştir ve "Sonraki" ile koru.
    const adimlar = turAdimlari(kayit());
    const hedef = adimlar.findIndex((a) => a.tur === "kart" && a.cardId === "ucret_stopaji");
    expect(hedef).toBeGreaterThan(2);
    for (let i = 3; i < hedef; i += 1) fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.sonraki") }));
    dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "12,5" } });
    fireEvent.click(within(dlg).getByRole("button", { name: t("rehber.tur.sonraki") }));
    // Sonraki kartta "Varsayılan kalsın" o kartı değiştirmeden geçer; sonra geri dönüp değeri "Varsayılan kalsın" ile sıfırlayamayız (adım ileri gider): değer korunmuştur.
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.bitir") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("rehber.adim.oynat") }) }));
    fireEvent.click(await screen.findByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]![0].values.ucret_stopaji).toBe(12.5);
  });

  it("tour_keep_default_resets_the_card", async () => {
    const { start } = await turuAc();
    const adimlar = turAdimlari(kayit());
    const hedef = adimlar.findIndex((a) => a.tur === "kart" && a.cardId === "ucret_stopaji");
    for (let i = 0; i < 3; i += 1) fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.ilerle") }));
    for (let i = 3; i < hedef; i += 1) fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.sonraki") }));
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "12,5" } });
    fireEvent.click(within(dlg).getByRole("button", { name: t("rehber.tur.varsayilan") }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.bitir") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("rehber.adim.oynat") }) }));
    fireEvent.click(await screen.findByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]![0].values).not.toHaveProperty("ucret_stopaji");
  });

  it("tour_last_step_offers_play", async () => {
    const { start } = await turuAc();
    const n = turAdimlari(kayit()).length;
    for (let i = 0; i < 3; i += 1) fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.ilerle") }));
    for (let i = 3; i < n - 1; i += 1) fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("rehber.tur.sonraki") }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(t("rehber.tur.no", { n, toplam: n }))).toBeInTheDocument();
    expect(within(dlg).queryByRole("button", { name: t("rehber.tur.sonraki") })).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: t("rehber.tur.oyna") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(t("rehber.baslat_not"))).toBeInTheDocument();
    expect(turGoruldu()).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it("tour_skips_missing_card", async () => {
    const tam = turAdimlari(kayit());
    const eksik = kayit();
    eksik.cards = eksik.cards.filter((c) => c.id !== "ucret_stopaji");
    const az = turAdimlari(eksik);
    expect(az).toHaveLength(tam.length - 1);
    expect(az.some((a) => a.tur === "kart" && a.cardId === "ucret_stopaji")).toBe(false);
    // Kayıtta olmayan kart kimliği ekranda da çıkmaz: adım sayısı küçülür.
    const { tur } = await turuAc(eksik);
    expect(within(tur).getByText(t("rehber.tur.no", { n: 1, toplam: az.length }))).toBeInTheDocument();
  });

  it("tour_steps_only_cards_the_player_can_use", () => {
    const reg = kayit();
    reg.cards = reg.cards.map((c) => (c.id === "kurumlar_vergisi" ? { ...c, apply: "unknown" as const } : c.id === "patent_suresi" ? { ...c, editable: false } : c));
    const ids = turAdimlari(reg).flatMap((a) => (a.tur === "kart" ? [a.cardId] : []));
    expect(ids).not.toContain("kurumlar_vergisi");
    expect(ids).not.toContain("patent_suresi");
    expect(ids).toContain("ucret_stopaji");
  });

  it("tour_live_cards_come_before_start_only_cards", () => {
    const reg = contractRegistry();
    const ids = turAdimlari(reg).flatMap((a) => (a.tur === "kart" ? [a.cardId] : []));
    const sinif = ids.map((id) => reg.cards.find((c) => c.id === id)!.apply);
    const ilkBaslangic = sinif.findIndex((x) => x === "start_only");
    if (ilkBaslangic >= 0) expect(sinif.slice(ilkBaslangic).every((x) => x !== "live" && x !== "live_sync")).toBe(true);
  });

  it("tour_focus_management", async () => {
    const { tur } = await turuAc();
    // Açılınca odak iletişim kutusunda.
    expect(tur.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(tur).getByRole("button", { name: t("rehber.tur.ilerle") }));
    // Adım değişince odak (yeni başlıkla duyurulmak üzere) yine kutunun içinde.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    // Esc turu bitirir ve odak açan düğmeye döner.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("rehber.adim.oynat") }) }));
    expect(turGoruldu()).toBe(true);
  });

  it("tour_seen_state_survives_unavailable_storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("kapalı"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("kapalı"); });
    expect(turGoruldu()).toBe(false);
    expect(() => turGorulduYaz()).not.toThrow();
    expect(turGoruldu()).toBe(false);
    expect(() => rehberKosuIsaretle("r", true)).not.toThrow();
    expect(rehberKosuMu("r")).toBe(true);
  });

  it("tour_not_auto_opened_when_seen", async () => {
    turGorulduYaz();
    await rehberAc();
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("rehber.adim.tur") }) }));
    await screen.findByRole("button", { name: t("rehber.tur.baslat") });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("rehber.tur.baslat") }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

const olay = (id: string, w: number, over: Partial<WorldEvent> = {}): WorldEvent => ({
  id: `${id}:${w}`, week: w, kind: "bad", textKey: "event.cokus", params: { hafta: w }, critical: true, sector: null, rule_ids: [], ...over,
});
const withEvents = (w: number, events: WorldEvent[]) => week({ ...packet(w), events });

describe("W12 ilk kritik olay", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

  it("ilkKritikOlay_picks_first_critical_only", () => {
    expect(ilkKritikOlay([])).toBeNull();
    expect(ilkKritikOlay([olay("a", 3, { critical: false }), olay("b", 5), olay("c", 9)])?.id).toBe("b:5");
  });

  for (const kind of ["live", "replay"] as const) {
    it(`first_critical_event_pauses_once_${kind}`, async () => {
      rehberKosuIsaretle("r", true);
      window.location.hash = "#/canli/r";
      const { src, control } = mountCanli([state({ status: "running", week: 2 }), ...packets(2)], { kind });
      await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
      expect(control).not.toHaveBeenCalled();
      act(() => src.emit("r", withEvents(3, [olay("cokus", 3)])));
      const bubble = await screen.findByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) });
      expect(control).toHaveBeenCalledWith("r", { action: "pause" });
      expect(control).toHaveBeenCalledTimes(1);
      expect(duraklatildiMi("r")).toBe(true);
      fireEvent.click(within(bubble).getByRole("button", { name: t("rehber.durdu.devam") }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(control).toHaveBeenLastCalledWith("r", { action: "play", speed: 1 });
      const cagri = control.mock.calls.length;
      act(() => src.emit("r", withEvents(4, [olay("kasa25", 4)])));
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) })).toBeNull();
      expect(control.mock.calls.length).toBe(cagri);
    });
  }

  it("non_guided_run_is_never_paused", async () => {
    window.location.hash = "#/canli/r";
    const { src, control } = mountCanli([state({ status: "running", week: 2 }), ...packets(2)]);
    await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
    act(() => src.emit("r", withEvents(3, [olay("cokus", 3)])));
    await new Promise((r) => setTimeout(r, 50));
    expect(control).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("critical_event_in_history_does_not_pause_again_after_reload", async () => {
    rehberKosuIsaretle("r", true);
    const kayitli = [state({ status: "paused", week: 3 }), ...packets(2), withEvents(3, [olay("cokus", 3)])];
    const ilk = mountCanli(kayitli);
    await screen.findByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) });
    ilk.view.unmount();
    cleanup();
    const { control } = mountCanli(kayitli);
    await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(control).not.toHaveBeenCalled();
  });

  it("guide_change_rule_opens_editor_on_resolved_card", async () => {
    // Sentetik: olayın kural kimliği kayıtta bir karta çözülür (gerçek veride bugün çözülmez).
    rehberKosuIsaretle("r", true);
    const { src } = mountCanli([state({ status: "running", week: 2 }), ...packets(2)]);
    await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
    act(() => src.emit("r", withEvents(3, [olay("cokus", 3, { rule_ids: ["ucret_stopaji"] })])));
    const bubble = await screen.findByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) });
    expect(within(bubble).getByText(t("rehber.durdu.acilacak", { kural: "Ücret stopajı" }))).toBeInTheDocument();
    fireEvent.click(within(bubble).getByRole("button", { name: t("rehber.durdu.degistir") }));
    const editor = await screen.findByRole("dialog", { name: /Şartı değiştir|Şart|sürüm/i });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Ücret stopajı"));
    expect(editor.contains(document.activeElement)).toBe(true);
    expect(screen.queryByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) })).toBeNull();
  });

  it("guide_change_rule_to_start_only_card_shows_lock_reason", async () => {
    rehberKosuIsaretle("r", true);
    const { src } = mountCanli([state({ status: "running", week: 2 }), ...packets(2)]);
    await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
    const kart = contractRegistry().cards.find((c) => c.id === "basim_tavani")!;
    expect(kart.apply).toBe("start_only");
    act(() => src.emit("r", withEvents(3, [olay("cokus", 3, { rule_ids: ["basim_tavani"] })])));
    const bubble = await screen.findByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) });
    fireEvent.click(within(bubble).getByRole("button", { name: t("rehber.durdu.degistir") }));
    const editor = await screen.findByRole("dialog", { name: /Şartı değiştir|Şart|sürüm/i });
    await waitFor(() => expect(document.activeElement?.textContent).toBe(kart.title));
    expect(within(editor).getAllByText(t("lock.yeni_kosu")).length).toBeGreaterThan(0);
  });

  for (const kimlik of ["cokus", "batis10", "kasa25"]) {
    it(`guide_real_event_ids_open_editor_without_target_${kimlik}`, async () => {
      // Gerçek olay kimlikleri kart değildir: yedek kart seçilmez, genel "Şartı değiştir", "Açılacak kural" yok.
      rehberKosuIsaretle("r", true);
      const { src } = mountCanli([state({ status: "running", week: 2 }), ...packets(2)]);
      await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
      act(() => src.emit("r", withEvents(3, [olay(kimlik, 3, { rule_ids: [kimlik] })])));
      const bubble = await screen.findByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) });
      expect(within(bubble).queryByText(/Açılacak kural/)).toBeNull();
      expect(within(bubble).queryByRole("button", { name: t("rehber.durdu.degistir") })).toBeNull();
      expect(within(bubble).queryByText(kimlik)).toBeNull();
      fireEvent.click(within(bubble).getByRole("button", { name: t("degistir.dugme") }));
      await screen.findByRole("dialog", { name: /Şartı değiştir|Şart|sürüm/i });
      expect(screen.queryByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) })).toBeNull();
      // Hedef yok: editör belirli bir karta odaklanmaz (odak kutuda kalır).
      expect(document.activeElement?.tagName).not.toMatch(/^H[34]$/);
    });
  }

  it("event_text_is_not_prefixed_with_a_second_week", async () => {
    rehberKosuIsaretle("r", true);
    const { src } = mountCanli([state({ status: "running", week: 2 }), ...packets(2)]);
    await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
    act(() => src.emit("r", withEvents(3, [olay("cokus", 3)])));
    const bubble = await screen.findByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) });
    expect(bubble.textContent).not.toMatch(/\d+\. hafta: Hf/);
  });

  it("critical_event_while_another_dialog_is_open_pauses_now_and_shows_box_after_it_closes", async () => {
    rehberKosuIsaretle("r", true);
    window.location.hash = "#/canli/r/zincir";
    const { src, control } = mountCanli([state({ status: "running", week: 2 }), ...packets(2)]);
    fireEvent.click((await screen.findByRole("list", { name: "En kıt halkalar" })).querySelector("button")!);
    const cekmece = await screen.findByRole("dialog");
    act(() => src.emit("r", withEvents(3, [olay("cokus", 3)])));
    await waitFor(() => expect(control).toHaveBeenCalledWith("r", { action: "pause" }));
    // İki modal asla üst üste binmez.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) })).toBeNull();
    fireEvent.click(within(cekmece).getByRole("button", { name: t("diyalog.kapat") }));
    const bubble = await screen.findByRole("dialog", { name: new RegExp(t("rehber.durdu.baslik")) });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(bubble.contains(document.activeElement)).toBe(true);
    expect(control).toHaveBeenCalledTimes(1);
  });

  it("rehberKosuDevral_moves_guided_and_paused_marks_to_the_new_id", () => {
    rehberKosuIsaretle("a", true);
    duraklatildiYaz("a");
    rehberKosuDevral("a", "b");
    expect(rehberKosuMu("b")).toBe(true);
    expect(duraklatildiMi("b")).toBe(true);
    rehberKosuDevral("zzz", "c");
    expect(rehberKosuMu("c")).toBe(false);
  });

  it("hints_show_in_first_weeks_and_stay_dismissed", async () => {
    rehberKosuIsaretle("r", true);
    window.location.hash = "#/canli/r";
    const { view } = mountCanli([state({ status: "paused", week: 2 }), ...packets(2)]);
    await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
    expect(await screen.findByText(t("rehber.ipucu.a"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("rehber.ipucu.tamam") }));
    await waitFor(() => expect(screen.queryByText(t("rehber.ipucu.a"))).toBeNull());
    expect(ipucuGorulduMu("a")).toBe(true);
    view.unmount();
  });

  it("hints_not_shown_for_non_guided_run", async () => {
    mountCanli([state({ status: "paused", week: 2 }), ...packets(2)]);
    await screen.findByRole("button", { name: "Ayrıntılar" }); // ekran hazır (Bu hafta şeridi Ayrıntılar penceresindedir)
    expect(screen.queryByText(t("rehber.ipucu.a"))).toBeNull();
  });
});

describe("W12 sonuç: uzman ayarlarını aç", () => {
  const mount = (guided: boolean) => {
    if (guided) rehberKosuIsaretle("r", true);
    const script = [
      { type: "state" as const, state: { runId: "r", status: "paused" as const, week: 3, durationWeeks: 200, speed: 1 as const, computing: false, version: 1, seedIndex: 2, values: { ucret_stopaji: 12 }, scenarioId: "canli", name: "Deneme", cityNames: ["A", "B", "C", "D", "E"], goals: ["alive" as const] } },
      ...packets(3),
    ];
    const src = createFakeSource(script, { kind: "live", caps: { city: true, chain: true } });
    return render(<SimSourceProvider source={src}><Sonuc runId="r" restore={{ status: "ready" }} /></SimSourceProvider>);
  };

  it("expert_button_only_for_guided_run", async () => {
    mount(false);
    await screen.findByRole("heading", { level: 2, name: /Ara durum/ });
    expect(screen.queryByRole("button", { name: t("rehber.uzman_ac") })).toBeNull();
  });

  it("expert_button_opens_builder_with_run_rules_and_expert_cards", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: t("rehber.uzman_ac") }));
    expect(window.location.hash).toBe("#/kurucu/2/uzman");
    const taslak = JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak") ?? "{}") as { name: string; values: Record<string, unknown>; seedIndex: number; durationWeeks: number };
    expect(taslak).toMatchObject({ name: "Deneme", seedIndex: 2, durationWeeks: 200 });
    expect(taslak.values).toMatchObject({ ucret_stopaji: 12 });
  });

  it("expert_button_keeps_template_and_custom_world_values_taslakOf", async () => {
    rehberKosuIsaretle("r", true);
    const script = [
      { type: "state" as const, state: { runId: "r", status: "paused" as const, week: 3, durationWeeks: 200, speed: 1 as const, computing: false, version: 1, seedIndex: 2, values: { ucret_stopaji: 12 }, scenarioId: "serbest_piyasa", name: "Deneme", cityNames: ["A", "B", "C", "D", "E"], goals: ["alive" as const], worldScenarioId: "ozel", worldScenarioValues: { dunya_x: 4 } } },
      ...packets(3),
    ];
    const src = createFakeSource(script, { kind: "live", caps: { city: true, chain: true } });
    render(<SimSourceProvider source={src}><Sonuc runId="r" restore={{ status: "ready" }} /></SimSourceProvider>);
    fireEvent.click(await screen.findByRole("button", { name: t("rehber.uzman_ac") }));
    const taslak = JSON.parse(window.sessionStorage.getItem("oyun.kurucu.taslak") ?? "{}") as { templateId: string; worldScenarioId: string; worldScenarioValues: Record<string, unknown> };
    expect(taslak).toMatchObject({ templateId: "serbest_piyasa", worldScenarioId: "ozel", worldScenarioValues: { dunya_x: 4 } });
  });
});

describe("W12 Kurucu uzman açılışı", () => {
  it("builder_route_with_uzman_opens_expert_cards", async () => {
    window.location.hash = "#/kurucu/2/uzman";
    const k = kaynak();
    render(<SimSourceProvider source={k.source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
    await screen.findByRole("heading", { name: t("kurucu.baslik") });
    const gizle = await screen.findAllByRole("button", { name: /^Gizle \(\d+\)$/ });
    expect(gizle.length).toBeGreaterThan(0);
  });
});
