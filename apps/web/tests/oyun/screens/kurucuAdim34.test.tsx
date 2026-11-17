import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Availability, Registry, RegistryCard, RunConfig, RunHandle, SimSource, SourceInfo } from "@/oyun/sim/types";
import { contractRegistry } from "../helpers/registryFixtures";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

/** Kayıt kart sayısına ve kilit durumuna bağlı değil: kartlar canlı sayılır, değiştirilecek kart ve senaryolar kayıttan türetilir. */
function kayit(): Registry {
  const reg = contractRegistry();
  reg.cards = reg.cards.map((c) => ({ ...c, apply: "live" as const }));
  reg.scenarios = reg.scenarios.map((s) => ({ ...s, startable: true }));
  return reg;
}
const sayiKarti = (reg: Registry): RegistryCard => reg.cards.find((c) => c.layer === "P" && c.editable && c.status === "active" && c.kind === "number" && typeof c.default === "number" && c.params.length > 0)!;

type KaynakSecenek = { kind?: "replay" | "live"; info?: Partial<SourceInfo>; start?: (c: RunConfig) => Promise<RunHandle> };

function kaynak(o: KaynakSecenek = {}) {
  const info: SourceInfo = {
    kind: o.kind ?? "replay", modelNote: "x",
    // Tipte olmayan `label` (eski sunucunun ham sayısı) bilerek verilir: ekranda görünmemeli.
    seeds: [0, 1, 2, 3, 4, 5].map((i) => ({ index: i, label: 0.078 + i * 0.002 })) as unknown as SourceInfo["seeds"],
    durationWeeks: 200,
    settings: [{ id: "gecis_destegi", options: ["kapali"].map((value) => ({ value, available: true })) }],
    fixedRules: [{ settingId: "ucret_stopaji", valueKey: "lock.deger.ucret_stopaji" }],
    templates: [{ id: "dayanikli_taban", values: { gecis_destegi: "kapali" } }],
    ...o.info,
  };
  const availability = vi.fn(async (): Promise<Availability> => ({ ok: true, scenarioId: "k", blocked: [] }));
  const start = vi.fn(o.start ?? (async (c: RunConfig): Promise<RunHandle> => ({
    runId: "y1", state: { runId: "y1", status: "ready", week: 0, durationWeeks: c.durationWeeks, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "kapali", name: c.name, cityNames: c.cityNames },
  })));
  const source = {
    kind: info.kind, capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => info, availability, start, open: async () => null, subscribe: () => () => {}, control: vi.fn(), applyChange: vi.fn(), weeks: vi.fn(), dispose: () => {},
  } as unknown as SimSource;
  return { source, start, availability };
}

const adim = (n: 0 | 1 | 2 | 3 | 4) => fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t(`kurucu.adim${n}.ad`)) }));
const taslakYaz = (extra: Record<string, unknown> = {}) =>
  window.sessionStorage.setItem("oyun.kurucu.taslak", JSON.stringify({ name: "Ada", cities: ["a", "b", "c", "d", "e"], templateId: null, values: {}, scenarioId: null, worldScenarioId: null, worldScenarioValues: {}, durationWeeks: null, seedIndex: null, goals: [], ...extra }));

async function ac(o: KaynakSecenek = {}, step: 0 | 1 | 2 | 3 | 4 = 3) {
  const k = kaynak(o);
  const view = render(<SimSourceProvider source={k.source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
  await screen.findByRole("heading", { name: t("kurucu.baslik") });
  await waitFor(() => expect(k.availability).toHaveBeenCalled());
  adim(step);
  return { ...k, ...view };
}

const baslat = () => screen.getByRole("button", { name: t("kurucu.baslat") });
const sure = (n: number) => screen.getByRole("button", { name: t("kurucu.adim3.sure_hafta", { n }) });

beforeEach(() => {
  window.sessionStorage.clear();
  window.location.hash = "#/kurucu";
  taslakYaz();
});
afterEach(() => cleanup());

describe("Kurucu adım 3: süre", () => {
  it("duration_options_by_source", async () => {
    await ac({ kind: "replay" });
    expect(sure(200)).toHaveAttribute("aria-pressed", "true");
    for (const n of [100, 500]) {
      expect(sure(n)).toBeDisabled();
      expect(sure(n)).toHaveAccessibleDescription(t("kurucu.adim3.sure_kilit_kayit", { n: 200 }));
    }
    cleanup();
    window.sessionStorage.clear();
    taslakYaz();
    const { start } = await ac({ kind: "live", info: { durations: [100, 200, 500] } });
    for (const n of [100, 200, 500]) expect(sure(n)).toBeEnabled();
    fireEvent.click(sure(500));
    expect(sure(500)).toHaveAttribute("aria-pressed", "true");
    expect(sure(200)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].durationWeeks).toBe(500);
  });

  it("sure_secenekleri_520_i_icerir", async () => {
    await ac({ kind: "live", info: { durations: [100, 200, 500, 520] } });
    expect(sure(520)).toBeEnabled();
    cleanup();
    await ac({ kind: "live", info: { durations: [100, 200, 500] } });
    expect(sure(520)).toBeDisabled();
  });

  it("modelin_sunmadigi_sure_nedenli_kilitli", async () => {
    await ac({ kind: "live", info: { durations: [200] } });
    expect(sure(100)).toBeDisabled();
    expect(sure(100)).toHaveAccessibleDescription(t("kurucu.adim3.sure_kilit_model"));
  });

  it("canlida_durations_gelmezse_de_kayit_dili_yok", async () => {
    await ac({ kind: "live" });
    expect(sure(100)).toHaveAccessibleDescription(t("kurucu.adim3.sure_kilit_model"));
  });

  it("saklanan_ama_kaynakta_olmayan_sure_kaynagin_suresine_duser", async () => {
    taslakYaz({ durationWeeks: 500 });
    const { start } = await ac({ kind: "replay" });
    expect(sure(200)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].durationWeeks).toBe(200);
  });
});

describe("Kurucu adım 3: Başlangıç dünyası", () => {
  it("world_picker_six_worlds_no_tohum_word", async () => {
    const { start, container } = await ac();
    for (let n = 1; n <= 6; n++) expect(screen.getByRole("button", { name: `Dünya ${n}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dünya 1" })).toHaveAttribute("aria-pressed", "true");
    expect(container.textContent).not.toMatch(/tohum|rastlant/i);
    expect(container.textContent).not.toMatch(/0[.,]0\d\d/); // ham değer sızmaz
    fireEvent.click(screen.getByRole("button", { name: "Dünya 4" }));
    expect(screen.getByRole("button", { name: "Dünya 4" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dünya 1" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].seedIndex).toBe(3);
  });

  it("kartin_secenek_etiketi_kullanilir", async () => {
    const reg = kayit();
    const kart = reg.cards.find((c) => c.id === "dunya_tohumu");
    await ac({ info: { registry: reg } });
    const adlar = kart && kart.control.type === "options" ? kart.control.options.map((o) => o.label) : [];
    expect(adlar.length).toBeGreaterThan(0);
    for (const a of adlar) expect(screen.getByRole("button", { name: a })).toBeInTheDocument();
  });
});

describe("Kurucu adım 3: hedefler", () => {
  it("goals_saved_in_config", async () => {
    const { start } = await ac({ kind: "live", info: { durations: [100, 200, 500] } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getByRole("checkbox", { name: t("kurucu.hedef.alive", { n: 200 }) })).not.toBeChecked();
    fireEvent.click(sure(100));
    expect(screen.getByRole("checkbox", { name: t("kurucu.hedef.alive", { n: 100 }) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: t("kurucu.hedef.gini") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("kurucu.hedef.alive", { n: 100 }) }));
    // adım değişince seçim korunur
    adim(4);
    adim(3);
    expect(screen.getByRole("checkbox", { name: t("kurucu.hedef.gini") })).toBeChecked();
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].goals).toEqual(["alive", "gini"]); // kartın sırasıyla
  });

  it("hedefsiz_baslat_bos_liste_gonderir", async () => {
    const { start } = await ac();
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].goals).toEqual([]);
  });
});

describe("Kurucu: kayıt kaynağında hedefler", () => {
  it("goals_locked_with_reason_in_replay", async () => {
    taslakYaz({ goals: ["alive"] }); // eski oturumdan kalan seçim
    const { start } = await ac({ kind: "replay" });
    const kutular = screen.getAllByRole("checkbox");
    expect(kutular).toHaveLength(4);
    for (const k of kutular) {
      expect(k).toBeDisabled();
      expect(k).not.toBeChecked();
    }
    expect(screen.getByRole("group", { name: t("kurucu.adim3.hedef_baslik") })).toHaveAccessibleDescription(t("kurucu.adim3.hedef_kilit_kayit"));
    adim(4);
    expect(screen.getByText(t("kurucu.adim3.hedef_kilit_kayit"))).toBeVisible();
    expect(screen.queryByText(t("kurucu.hedef.alive", { n: 200 }))).toBeNull();
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].goals).toEqual([]);
  });
});

describe("Kurucu: şablon yokken", () => {
  it("template_none_blocks_start_with_reason", async () => {
    const { start } = await ac({ info: { templates: [] } }, 4);
    expect(baslat()).toBeDisabled();
    const neden = screen.getByText(t("kurucu.baslat_neden_sablon"));
    expect(baslat()).toHaveAttribute("aria-describedby", neden.id);
    fireEvent.click(baslat());
    expect(start).not.toHaveBeenCalled();
  });
});

describe("Kurucu adım 4: özet ve Başlat", () => {
  it("summary_lists_changed_rules_and_scenario", async () => {
    const reg = kayit();
    const kart = sayiKarti(reg);
    const senaryo = reg.scenarios.find((s) => s.id !== "gercekci")!;
    taslakYaz({ values: { [kart.id]: (kart.default as number) + 1 }, worldScenarioId: senaryo.id, goals: ["kasa"], seedIndex: 2 });
    const { container } = await ac({ kind: "live", info: { registry: reg, durations: [100, 200, 500] } }, 4);
    const kurallar = screen.getByRole("region", { name: t("kurucu.adim4.kurallar_baslik") });
    expect(within(kurallar).getByText(kart.title)).toBeVisible();
    expect(screen.getByText(t("kurucu.adim4.senaryo_deger", { ad: senaryo.title }))).toBeVisible();
    expect(screen.getByText(t("kurucu.adim3.sure_hafta", { n: 200 }))).toBeVisible();
    expect(screen.getByText("Dünya 3")).toBeVisible();
    expect(screen.getByText(t("kurucu.hedef.kasa"))).toBeVisible();
    expect(container.textContent).not.toMatch(/Zincire işle|EkonomiSarti|kontrat/i); // DK-1 istisnası: zincir kısmı yok
  });

  it("degisiklik_yoksa_sablon_aynen_duruyor", async () => {
    await ac({ kind: "live", info: { registry: kayit() } }, 4);
    expect(screen.getByText(t("kurucu.adim4.kural_yok"))).toBeVisible();
    expect(screen.getByText(t("kurucu.adim4.hedef_yok"))).toBeVisible();
  });

  it("start_sends_full_config", async () => {
    const reg = kayit();
    const kart = sayiKarti(reg);
    const yeni = (kart.default as number) + 1;
    const senaryo = reg.scenarios.find((s) => s.id !== "gercekci" && s.id !== "ozel")!;
    taslakYaz({ values: { [kart.id]: yeni }, worldScenarioId: senaryo.id, goals: ["alive", "serve"], seedIndex: 5, durationWeeks: 100 });
    const { start } = await ac({ kind: "live", info: { registry: reg, durations: [100, 200, 500] } }, 4);
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const c = start.mock.calls[0]![0];
    expect(c).toMatchObject({ name: "Ada", templateId: "dayanikli_taban", durationWeeks: 100, seedIndex: 5, worldScenarioId: senaryo.id, goals: ["alive", "serve"] });
    expect(c.values[kart.id]).toBe(yeni);
    expect(c).not.toHaveProperty("worldScenarioValues"); // yalnız Özel'de gönderilir
  });

  it("ozel_senaryoda_world_scenario_values_gider", async () => {
    taslakYaz({ worldScenarioId: "ozel" });
    const { start } = await ac({ kind: "live", info: { registry: kayit() } }, 4);
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0]).toMatchObject({ worldScenarioId: "ozel", worldScenarioValues: {} });
  });

  it("start_errors_unchanged", async () => {
    let n = 0;
    const hatalar: unknown[] = [new Error("x"), new SimUnsupported("too_many_runs"), new SimUnsupported("busy_preparing")];
    const { start } = await ac({
      start: async (c) => {
        const e = hatalar[n++];
        if (e) throw e;
        return { runId: "r9", state: { runId: "r9", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "k", name: c.name, cityNames: c.cityNames } };
      },
    }, 4);
    fireEvent.click(baslat());
    expect(await screen.findByRole("alert")).toHaveTextContent(t("kurucu.baslat_hata"));
    fireEvent.click(screen.getByRole("button", { name: t("durum.yeniden") }));
    expect(await screen.findByText(t("kurucu.baslat_hata_cok_kosu"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: t("durum.yeniden") }));
    expect(await screen.findByText(t("kurucu.baslat_hata_mesgul"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: t("durum.yeniden") }));
    await waitFor(() => expect(window.location.hash).toBe("#/canli/r9"));
    expect(start).toHaveBeenCalledTimes(4);
  });

  it("adsizken_baslat_kapali_neden_gorunur", async () => {
    taslakYaz({ name: "" });
    await ac({}, 4);
    expect(baslat()).toBeDisabled();
    expect(screen.getByText(t("kurucu.baslat_neden"))).toBeVisible();
  });

  it("registry_yokken_sabit_kurallar_ozette", async () => {
    await ac({}, 4);
    const kart = screen.getByRole("article", { name: t("setting.ucret_stopaji.name") });
    expect(within(kart).getByRole("button", { name: "%10" })).toBeDisabled();
  });
});

describe("Kurucu adımları", () => {
  it("bes_adim_sirayla_gezilir", async () => {
    await ac({}, 2);
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("kurucu.adim3.ad") }) }));
    expect(screen.getByRole("heading", { name: t("kurucu.adim3.sure_baslik") })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("kurucu.adim4.ad") }) }));
    expect(screen.getByText(t("kurucu.adim4.giris"))).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Devam/ })).toBeNull();
    expect(screen.getByRole("button", { name: t("kurucu.geri") })).toBeEnabled();
  });

  it("baslangic_dunyasi_artik_adim_2de_degil", async () => {
    await ac({}, 2);
    expect(screen.queryByRole("heading", { name: t("kurucu.dunya_baslik") })).toBeNull();
  });
});

describe("Kurucu adım 0: şehir profili (SourceInfo.world)", () => {
  const world = {
    basis: "model_defaults",
    cities: [0, 1, 2, 3, 4].map((index) => ({ index, coal: index === 0, gold: index === 1, resources: [{ id: `r${index}`, label: `Kaynak ${index}` }], specialties: [{ sector: `s${index}a`, label: `Sektör ${index}a` }, { sector: `s${index}b`, label: `Sektör ${index}b` }], population_share: 0.2 })),
  };

  it("kaynak_ve_uzman_sektorler_esit_nufus_payi", async () => {
    await ac({ kind: "live", info: { world } }, 0);
    expect(screen.getAllByText(t("kurucu.sehir.kilit"))).toHaveLength(5);
    expect(screen.getAllByText(t("kurucu.sehir.pay", { n: 20 }))).toHaveLength(5);
    expect(screen.getByText("Kaynak 3")).toBeVisible();
    expect(screen.getByText("Sektör 4a, Sektör 4b")).toBeVisible();
  });

  it("canlida_bos_kaynak_kayit_dili_tasimaz", async () => {
    const bos = { ...world, cities: world.cities.map((c, i) => (i === 2 ? { ...c, resources: [], specialties: [] } : c)) };
    const { container } = await ac({ kind: "live", info: { world: bos } }, 0);
    expect(screen.getAllByText(t("kurucu.sehir.kaynak_yok"))).toHaveLength(1);
    expect(screen.getAllByText(t("kurucu.sehir.uzman_yok"))).toHaveLength(1);
    expect(container.textContent).not.toMatch(/kayıtlarda/i);
  });

  it("world_yoksa_kayitlarda_yok_nufus_payi_yine_esit", async () => {
    await ac({}, 0);
    expect(screen.getAllByText(t("kurucu.sehir.yok"))).toHaveLength(10);
    expect(screen.getAllByText(t("kurucu.sehir.pay", { n: 20 }))).toHaveLength(5);
  });
});
