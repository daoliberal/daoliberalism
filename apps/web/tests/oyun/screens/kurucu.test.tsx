import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { tr } from "@/oyun/copy/tr";
import { OyunApp } from "@/oyun/OyunApp";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Availability, RunConfig, RunHandle, SimSource, SourceInfo, ValuesPatch } from "@/oyun/sim/types";
import { allFiles, makeFetch, makeIndex } from "../helpers/replayFixture";

// P-04: kaynak seçimi artık asenkron yoklar; bu test dosyası kayıt kaynağıyla çalışır (sunucu yok).
vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

const SCEN: Record<string, string> = { kapali: "kapali", kisa_sureli: "kisa", kurtarma_fonuyla: "kurtarma" };

function makeInfo(over: Partial<SourceInfo> = {}): SourceInfo {
  return {
    kind: "replay",
    modelNote: "K-211 test",
    seeds: [0, 1, 2, 3, 4, 5].map((i) => ({ index: i, label: 0.078 + i * 0.002 })),
    durationWeeks: 200,
    settings: [{ id: "gecis_destegi", options: Object.keys(SCEN).map((value) => ({ value, available: true })) }],
    fixedRules: [
      { settingId: "ucret_stopaji", valueKey: "lock.deger.ucret_stopaji" },
      { settingId: "kurumlar_vergisi", valueKey: "lock.deger.kurumlar_vergisi" },
      { settingId: "zararda_once_kucul", valueKey: "lock.deger.zararda_once_kucul" },
    ],
    templates: [
      { id: "dayanikli_taban", values: { gecis_destegi: "kapali" } },
      { id: "gecis_destegi", values: { gecis_destegi: "kurtarma_fonuyla" } },
    ],
    ...over,
  };
}

function makeSource(over: { info?: Partial<SourceInfo>; start?: (c: RunConfig) => Promise<RunHandle> } = {}) {
  const calls: string[] = [];
  const availability = vi.fn(async (values: ValuesPatch): Promise<Availability> => {
    const id = SCEN[String(values.gecis_destegi ?? "kapali")] ?? null;
    return id === null ? { ok: false, scenarioId: null, blocked: [{ settingId: "gecis_destegi", option: String(values.gecis_destegi), reason: "no_recording" }] } : { ok: true, scenarioId: id, blocked: [] };
  });
  const start = vi.fn(
    over.start ??
      (async (c: RunConfig): Promise<RunHandle> => {
        calls.push("start");
        return { runId: "yeni1", state: { runId: "yeni1", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "kapali", name: c.name, cityNames: c.cityNames } };
      }),
  );
  const source = {
    kind: "replay",
    capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => makeInfo(over.info),
    availability,
    start,
    open: vi.fn(async () => null),
    subscribe: () => () => {},
    control: vi.fn(),
    applyChange: vi.fn(),
    weeks: vi.fn(),
    dispose: () => {},
  } as unknown as SimSource;
  return { source, availability, start, calls };
}

/** Kurucu adımları: 0 ad, 1 şablon ve geçiş desteği, 2 Şartı yaz, 3 süre ve Başlangıç dünyası (W7), 4 özet ve sabit kurallar (W7); adım gezginindeki düğmeyle gidilir. */
const adim = (n: 0 | 1 | 2 | 3 | 4) => fireEvent.click(within(screen.getByRole("navigation", { name: t("kurucu.adim.nav") })).getByRole("button", { name: new RegExp(t(`kurucu.adim${n}.ad`)) }));

async function setup(over: Parameters<typeof makeSource>[0] = {}, step: 0 | 1 | 2 | 3 | 4 = 0) {
  const s = makeSource(over);
  const adopt = vi.fn(() => {
    s.calls.push(`adopt:${window.location.hash}`);
  });
  const view = render(
    <SimSourceProvider source={s.source}>
      <Kurucu adopt={adopt} />
    </SimSourceProvider>,
  );
  await screen.findByRole("heading", { name: t("kurucu.baslik") });
  await waitFor(() => expect(s.availability).toHaveBeenCalled());
  if (step > 0) adim(step);
  return { ...s, adopt, ...view };
}

const nameInput = () => screen.getByLabelText(t("kurucu.ad_etiket"));
const cityInput = (n: number) => screen.getByLabelText(t("kurucu.sehir_etiket", { n }));
const baslat = () => screen.getByRole("button", { name: t("kurucu.baslat") });

beforeEach(() => {
  window.sessionStorage.clear(); // W3: taslak oturumda korunur; testler birbirine sızmasın
  window.location.hash = "#/kurucu"; // DK-14: giriş adresi
});
afterEach(() => cleanup());

describe("Kurucu: ad ve şehirler", () => {
  it("ad_bosken_baslat_kapali_neden_gorunur_ve_bagli", async () => {
    await setup();
    expect(baslat()).toBeDisabled();
    const neden = screen.getByText(t("kurucu.baslat_neden"));
    expect(neden).toBeVisible();
    expect(baslat()).toHaveAttribute("aria-describedby", neden.id);
    expect(neden.id).not.toBe("");
  });

  it("bosluk_yalniz_ad_bos_sayilir", async () => {
    await setup();
    fireEvent.change(nameInput(), { target: { value: "   \t " } });
    expect(baslat()).toBeDisabled();
    fireEvent.change(nameInput(), { target: { value: " Dünya " } });
    expect(baslat()).toBeEnabled();
    expect(screen.queryByText(t("kurucu.baslat_neden"))).toBeNull();
  });

  it("ad_65_kod_noktasi_hata_64_tamam", async () => {
    await setup();
    fireEvent.change(nameInput(), { target: { value: "😀".repeat(64) } });
    expect(baslat()).toBeEnabled();
    expect(screen.queryByText(t("kurucu.ad_hata"))).toBeNull();
    fireEvent.change(nameInput(), { target: { value: "😀".repeat(65) } });
    expect(screen.getByText(t("kurucu.ad_hata"))).toBeVisible();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(baslat()).toBeDisabled();
    expect(screen.getByText(t("kurucu.baslat_neden_gecersiz"))).toBeVisible();
  });

  it("coklu_bosluk_kirpilir_ve_64_sayimi_kirpilmis_uzerinden", async () => {
    await setup();
    fireEvent.change(nameInput(), { target: { value: `  ${"a".repeat(32)}     ${"b".repeat(31)}  ` } });
    expect(baslat()).toBeEnabled(); // 32 + 1 + 31 = 64
  });

  it("sehir_41_hata_40_tamam_bos_kabul", async () => {
    await setup();
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.change(cityInput(2), { target: { value: "ç".repeat(40) } });
    expect(baslat()).toBeEnabled();
    fireEvent.change(cityInput(2), { target: { value: "ç".repeat(41) } });
    expect(screen.getByText(t("kurucu.sehir_hata"))).toBeVisible();
    expect(cityInput(2)).toHaveAttribute("aria-invalid", "true");
    expect(baslat()).toBeDisabled();
    fireEvent.change(cityInput(2), { target: { value: "" } });
    expect(baslat()).toBeEnabled();
    expect(screen.queryByText(t("kurucu.sehir_hata"))).toBeNull();
  });

  it("bos_sehir_alani_yedek_adi_yer_tutucu_olarak_gosterir", async () => {
    await setup();
    expect(cityInput(3)).toHaveAttribute("placeholder", "Şehir 3");
  });

  it("tekrarlanan_sehir_adina_uyari_yok", async () => {
    await setup();
    fireEvent.change(nameInput(), { target: { value: "D" } });
    for (const n of [1, 2]) fireEvent.change(cityInput(n), { target: { value: "Aynı" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(baslat()).toBeEnabled();
  });
});

describe("Kurucu: geçiş desteği ve şablon", () => {
  it("varsayilan_availability_kapali_senaryo", async () => {
    const { availability } = await setup({}, 1);
    expect(availability).toHaveBeenCalledWith({ gecis_destegi: "kapali" });
    await expect(availability.mock.results[0]!.value).resolves.toMatchObject({ ok: true, scenarioId: "kapali" });
    expect(screen.getByRole("button", { name: "kapalı" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["kapalı", "kapali", "kapali"],
    ["kısa süreli", "kisa_sureli", "kisa"],
    ["kurtarma fonuyla", "kurtarma_fonuyla", "kurtarma"],
  ])("secenek_%s_secilebilir_ve_senaryo_doner", async (label, value, scenario) => {
    const { availability } = await setup({}, 1);
    // başka bir seçenekten dön: her biri seçilebilir
    fireEvent.click(screen.getByRole("button", { name: value === "kapali" ? "kısa süreli" : "kapalı" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
    expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(availability).toHaveBeenLastCalledWith({ gecis_destegi: value }));
    await expect(availability.mock.results.at(-1)!.value).resolves.toMatchObject({ scenarioId: scenario });
  });

  it("sablon_secimi_baslangici_degistirir_sonra_elle_degisir", async () => {
    const { start } = await setup();
    fireEvent.change(nameInput(), { target: { value: "D" } });
    adim(1);
    const tabanBtn = screen.getByRole("button", { name: t("sablon.dayanikli_taban.name") });
    const gecisBtn = screen.getByRole("button", { name: t("sablon.gecis_destegi.name") });
    expect(tabanBtn).toHaveAttribute("aria-pressed", "true");
    expect(gecisBtn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(gecisBtn);
    expect(gecisBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "kurtarma fonuyla" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "kapalı" }));
    expect(screen.getByRole("button", { name: "kapalı" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]![0]).toMatchObject({ templateId: "gecis_destegi", values: { gecis_destegi: "kapali" } });
  });

  it("sablon_metinleri_ve_eski_olcum_etiketi_gorunur", async () => {
    await setup({}, 1);
    expect(screen.getByText(t("sablon.gecis_destegi.olcum_eski"))).toBeVisible(); // yalnız güncel kayda ait olmayan kısım "Eski ölçüm notu" taşır
    expect(screen.getByText(t("sablon.gecis_destegi.desc"))).toBeVisible();
    expect(screen.getAllByText(/500 haftada 3\/3|500 haftalık ölçümde/).length).toBeGreaterThanOrEqual(2); // şablonun eski ölçüm notu + kart notu
    expect(screen.getByText(t("setting.gecis_destegi.eski_olcum"))).toBeVisible();
  });
});

describe("Kurucu: başlangıç dünyası ve kilitli kartlar", () => {
  it("alti_dunya_ilki_secili_secim_degisir", async () => {
    const { start } = await setup();
    fireEvent.change(nameInput(), { target: { value: "D" } });
    adim(3); // W7: Başlangıç dünyası seçici adım 3'te
    for (let n = 1; n <= 6; n++) expect(screen.getByRole("button", { name: t("kurucu.dunya_ad", { n }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dünya 1" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Dünya 4" }));
    expect(screen.getByRole("button", { name: "Dünya 4" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dünya 1" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].seedIndex).toBe(3);
  });

  it("kilitli_kartlar_kontrol_disabled_neden_describedby", async () => {
    await setup({}, 4); // W7: sabit kurallar Özet adımında
    for (const [id, deger] of [["ucret_stopaji", "%10"], ["kurumlar_vergisi", "%20"], ["zararda_once_kucul", "açık"]] as const) {
      const card = screen.getByRole("article", { name: tr[`setting.${id}.name`] });
      const btn = within(card).getByRole("button", { name: deger });
      expect(btn).toBeDisabled();
      const group = within(card).getByRole("group");
      expect(group).toHaveAccessibleDescription(t("lock.sabit"));
      expect(within(card).getByText(t("lock.sabit"))).toBeVisible();
    }
  });

  it("fixedRules_valueKey_ve_settingId_tr_de_var", () => {
    for (const r of makeInfo().fixedRules) {
      expect(tr).toHaveProperty([r.valueKey]);
      expect(tr).toHaveProperty([`setting.${r.settingId}.name`]);
    }
  });

  it("bilinmeyen_settingId_cizilmez_cokmez", async () => {
    await setup({ info: { fixedRules: [{ settingId: "yok_boyle_ayar" as never, valueKey: "lock.deger.ucret_stopaji" }] } }, 4);
    expect(screen.queryAllByRole("article").length).toBe(0);
  });
});

describe("Kurucu: banner ve model notu", () => {
  it("banner_kayit_notu_modelNote_ve_K_numarasi_yok", async () => {
    const { container } = await setup();
    expect(screen.getByText(t("kurucu.kayit_notu"))).toBeVisible();
    expect(container.textContent).not.toMatch(/K-\d+/);
    expect(container.textContent).not.toContain("K-211 test");
  });
});

describe("Kurucu: Başlat", () => {
  it("start_tam_yapilandirma_adopt_sonra_hash", async () => {
    const { start, adopt, calls } = await setup();
    fireEvent.change(nameInput(), { target: { value: "  Ada   Dünyası " } });
    ["A", "B", "", "D", "E"].forEach((v, i) => fireEvent.change(cityInput(i + 1), { target: { value: v } }));
    fireEvent.click(baslat());
    await waitFor(() => expect(window.location.hash).toBe("#/canli/yeni1"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({
      name: "Ada Dünyası",
      cityNames: ["A", "B", "", "D", "E"],
      templateId: "dayanikli_taban",
      durationWeeks: 200,
      seedIndex: 0,
      values: { gecis_destegi: "kapali" },
      goals: [],
    });
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ runId: "yeni1" }));
    // adopt, hash değişmeden ÖNCE çağrılır
    expect(calls).toEqual(["start", "adopt:#/kurucu"]);
  });

  it("durationWeeks_info_den_gelir", async () => {
    const { start } = await setup({ info: { durationWeeks: 150 } });
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(baslat());
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].durationWeeks).toBe(150);
  });

  it("start_too_big_nufus_nedenli_metin", async () => {
    const { SimUnsupported } = await import("@/oyun/sim/SimSource");
    await setup({ start: async () => { throw new SimUnsupported("too_big"); } });
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(baslat());
    expect(await screen.findByText(t("kurucu.baslat_hata_cok_buyuk"))).toBeVisible();
  });

  it("start_reddi_hata_ve_yeniden_dene", async () => {
    let n = 0;
    const { start } = await setup({
      start: async (c) => {
        n += 1;
        if (n === 1) throw new Error("x");
        return { runId: "r2", state: { runId: "r2", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "kapali", name: c.name, cityNames: c.cityNames } };
      },
    });
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(baslat());
    expect(await screen.findByText(t("kurucu.baslat_hata"))).toBeVisible();
    expect(window.location.hash).not.toContain("canli");
    fireEvent.click(screen.getByRole("button", { name: t("durum.yeniden") }));
    await waitFor(() => expect(window.location.hash).toBe("#/canli/r2"));
    expect(start).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(t("kurucu.baslat_hata"))).toBeNull();
  });

  it("hata_sonrasi_yeniden_dene_dogrulamayi_atlamaz", async () => {
    const { start } = await setup({ start: async () => { throw new Error("x"); } });
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(baslat());
    expect(await screen.findByRole("alert")).toHaveTextContent(t("kurucu.baslat_hata"));
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.change(nameInput(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: t("durum.yeniden") }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("kurucu.baslat_neden"))).toBeVisible();
    fireEvent.change(nameInput(), { target: { value: "😀".repeat(65) } });
    fireEvent.click(screen.getByRole("button", { name: t("durum.yeniden") }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("start_beklerken_kaldirilirsa_durum_guncellenmez_adopt_yok", async () => {
    let release: (h: RunHandle) => void = () => {};
    const { start, adopt, unmount } = await setup({ start: () => new Promise<RunHandle>((r) => (release = r)) });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(baslat());
    expect(start).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      release({ runId: "z", state: {} as never });
    });
    expect(adopt).not.toHaveBeenCalled();
    expect(window.location.hash).not.toContain("canli");
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("cift_tiklama_tek_start", async () => {
    let release: (h: RunHandle) => void = () => {};
    const { start } = await setup({ start: () => new Promise<RunHandle>((r) => (release = r)) });
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(baslat());
    expect(baslat()).toBeDisabled();
    fireEvent.click(baslat());
    expect(start).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ runId: "z", state: {} as never });
    });
  });

  it("availability_kayitsizsa_baslat_kapali_ve_uyari", async () => {
    const s = makeSource();
    s.availability.mockImplementation(async () => ({ ok: false, scenarioId: null, blocked: [{ settingId: "gecis_destegi", option: "kapali", reason: "no_recording" }] }));
    render(
      <SimSourceProvider source={s.source}>
        <Kurucu adopt={() => {}} />
      </SimSourceProvider>,
    );
    await screen.findByRole("heading", { name: t("kurucu.baslik") });
    fireEvent.change(nameInput(), { target: { value: "D" } });
    adim(1);
    expect(await screen.findByText(t("lock.kayitsiz"))).toBeVisible();
    await waitFor(() => expect(baslat()).toBeDisabled());
  });
});

describe("OyunApp Kurucu'yu çizer", () => {
  it("sahte_fetch_ile_kurucu_ve_baslat_canliya_gider", async () => {
    const idx = makeIndex();
    idx.fixed_rules = makeInfo().fixedRules;
    idx.templates = makeInfo().templates;
    const files = Object.fromEntries(Object.entries({ ...allFiles(), "/k/index.json": JSON.stringify(idx) }).map(([k, v]) => [k.replace("/k/", "/oyun-kayit/"), v]));
    vi.stubGlobal("fetch", makeFetch(files));
    try {
      render(<OyunApp />);
      await screen.findByRole("heading", { name: t("kurucu.baslik") });
      expect(screen.getByText(t("kurucu.kayit_notu"))).toBeVisible();
      fireEvent.change(nameInput(), { target: { value: "Gerçek" } });
      adim(3);
      expect(screen.getByRole("heading", { name: t("kurucu.dunya_baslik") })).toBeVisible();
      expect(screen.getByText(/Aynı kuralı birkaç dünyada denemek/)).toBeVisible();
      adim(1);
      expect(screen.getAllByRole("article")).toHaveLength(1);
      adim(4);
      expect(screen.getAllByRole("article")).toHaveLength(3);
      await waitFor(() => expect(baslat()).toBeEnabled());
      fireEvent.click(baslat());
      await waitFor(() => expect(window.location.hash).toMatch(/^#\/canli\//));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
