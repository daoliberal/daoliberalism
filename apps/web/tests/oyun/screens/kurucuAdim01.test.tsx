import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUNYA_ADLARI, SEHIR_ADLARI } from "@/oyun/copy/isimler";
import { t } from "@/oyun/copy/t";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Availability, RunConfig, RunHandle, SimSource, SourceInfo } from "@/oyun/sim/types";
import { contractRegistry } from "../helpers/registryFixtures";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

const SCEN: Record<string, string> = { kapali: "kapali", kisa_sureli: "kisa", kurtarma_fonuyla: "kurtarma" };

function makeInfo(over: Partial<SourceInfo> = {}): SourceInfo {
  return {
    kind: "replay",
    modelNote: "x",
    seeds: [0, 1, 2, 3, 4, 5].map((i) => ({ index: i, label: 0.078 + i * 0.002 })),
    durationWeeks: 200,
    settings: [{ id: "gecis_destegi", options: Object.keys(SCEN).map((value) => ({ value, available: true })) }],
    fixedRules: [{ settingId: "ucret_stopaji", valueKey: "lock.deger.ucret_stopaji" }],
    templates: [
      { id: "dayanikli_taban", values: { gecis_destegi: "kapali" } },
      { id: "gecis_destegi", values: { gecis_destegi: "kurtarma_fonuyla" } },
    ],
    ...over,
  };
}

function setup(over: { info?: Partial<SourceInfo>; start?: (c: RunConfig) => Promise<RunHandle>; rng?: () => number } = {}) {
  const start = vi.fn(over.start ?? (async (c: RunConfig): Promise<RunHandle> => ({ runId: "y1", state: { runId: "y1", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "kapali", name: c.name, cityNames: c.cityNames } })));
  const source = {
    kind: "replay",
    capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => makeInfo(over.info),
    availability: async (values: Record<string, unknown>): Promise<Availability> => (SCEN[String(values.gecis_destegi ?? "kapali")] ? { ok: true, scenarioId: "k", blocked: [] } : { ok: false, scenarioId: null, blocked: [] }),
    start,
    open: async () => null,
    subscribe: () => () => {},
    control: vi.fn(),
    applyChange: vi.fn(),
    weeks: vi.fn(),
    dispose: () => {},
  } as unknown as SimSource;
  const ui = (
    <SimSourceProvider source={source}>
      <Kurucu adopt={() => {}} randomSource={over.rng} />
    </SimSourceProvider>
  );
  return { start, ui, ...render(ui) };
}

// Sabit olmayan, belirlenimli rng: art arda farklı sayılar.
function seqRng(seed = 7): () => number {
  let x = seed;
  return () => {
    x = (x * 48271) % 2147483647;
    return x / 2147483647;
  };
}

const nameInput = () => screen.getByLabelText(t("kurucu.ad_etiket")) as HTMLInputElement;
const cityInput = (n: number) => screen.getByLabelText(t("kurucu.sehir_etiket", { n })) as HTMLInputElement;
const cityValues = () => [1, 2, 3, 4, 5].map((n) => cityInput(n).value);
const rastgele = () => screen.getByRole("button", { name: t("kurucu.rastgele_isim") });
const devam = (ad: string) => screen.getByRole("button", { name: t("kurucu.devam", { ad }) });
const bekle = () => screen.findByRole("heading", { name: t("kurucu.baslik") });

beforeEach(() => {
  window.location.hash = "#/kurucu";
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe("Kurucu adım 0: Rastgele isim", () => {
  it("rastgele_fills_world_and_five_distinct_cities", async () => {
    setup({ rng: seqRng() });
    await bekle();
    fireEvent.click(rastgele());
    expect(DUNYA_ADLARI).toContain(nameInput().value);
    const c = cityValues();
    expect(new Set(c).size).toBe(5);
    for (const x of c) expect(SEHIR_ADLARI).toContain(x);
  });

  it("rastgele_again_changes", async () => {
    setup({ rng: () => 0 }); // sabit rng bile aynı sonucu veremez
    await bekle();
    fireEvent.click(rastgele());
    const ilk = { w: nameInput().value, c: cityValues() };
    fireEvent.click(rastgele());
    expect(nameInput().value).not.toBe(ilk.w);
    expect(cityValues().join("|")).not.toBe(ilk.c.join("|"));
  });

  it("rastgele_then_edit_keeps_edit", async () => {
    setup({ rng: seqRng(3) });
    await bekle();
    fireEvent.click(rastgele());
    fireEvent.change(nameInput(), { target: { value: "Benim Dünyam" } });
    fireEvent.change(cityInput(2), { target: { value: "Özel Şehir" } });
    expect(nameInput().value).toBe("Benim Dünyam");
    expect(cityInput(2).value).toBe("Özel Şehir");
    expect(screen.getByRole("button", { name: t("kurucu.baslat") })).toBeEnabled();
  });

  it("rastgele_dugme_aciklamasi_ve_canli_duyuru", async () => {
    setup({ rng: seqRng() });
    await bekle();
    const aciklama = screen.getByText(t("kurucu.rastgele_aciklama"));
    expect(rastgele()).toHaveAttribute("aria-describedby", aciklama.id);
    const bolge = document.querySelector("[aria-live='polite']") as HTMLElement;
    expect(bolge).not.toBeNull();
    expect(bolge.textContent).toBe("");
    fireEvent.click(rastgele());
    expect(bolge.textContent).toBe(t("kurucu.rastgele.duyuru", { dunya: nameInput().value }));
  });
});

describe("Kurucu adım kabuğu", () => {
  it("adim_gezgini_nav_ve_devam_geri", async () => {
    setup();
    await bekle();
    const nav = screen.getByRole("navigation", { name: t("kurucu.adim.nav") });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("button", { name: t("kurucu.geri") })).toBeDisabled();
    expect(within(nav).getByRole("button", { name: new RegExp(t("kurucu.adim0.ad")) })).toHaveAttribute("aria-current", "step");
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    expect(within(nav).getByRole("button", { name: new RegExp(t("kurucu.adim1.ad")) })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: t("kurucu.geri") })).toBeEnabled();
  });

  it("step_navigation_keeps_draft", async () => {
    setup();
    await bekle();
    fireEvent.change(nameInput(), { target: { value: "Ada" } });
    fireEvent.change(cityInput(4), { target: { value: "Dördüncü" } });
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    fireEvent.click(screen.getByRole("button", { name: t("sablon.gecis_destegi.name") }));
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.geri") }));
    expect(screen.getByRole("button", { name: t("sablon.gecis_destegi.name") })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.geri") }));
    expect(nameInput().value).toBe("Ada");
    expect(cityInput(4).value).toBe("Dördüncü");
  });

  it("taslak_oturumda_korunur_yeniden_baglaninca", async () => {
    const a = setup();
    await bekle();
    fireEvent.change(nameInput(), { target: { value: "Kalıcı" } });
    a.unmount();
    setup();
    await bekle();
    expect(nameInput().value).toBe("Kalıcı");
  });

  it("bozuk_oturum_verisi_yok_sayilir", async () => {
    window.sessionStorage.setItem("oyun.kurucu.taslak", "{bozuk");
    setup();
    await bekle();
    expect(nameInput().value).toBe("");
  });
});

describe("Kurucu adım 1: şablonlar", () => {
  it("template_pick_fills_draft_and_lists_behavior_changes", async () => {
    setup();
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    expect(screen.getByRole("button", { name: "kapalı" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t("sablon.gecis_destegi.name") }));
    expect(screen.getByRole("button", { name: "kurtarma fonuyla" })).toHaveAttribute("aria-pressed", "true");
    // Kayıtta behavior_changes yoksa varsayım cümlesi gösterilmez (sabit metin yok)
    expect(screen.queryByText(/dünya varsayımını da değiştirir/)).toBeNull();
  });

  it("template_assumption_sentence_derives_from_published_behavior_changes", async () => {
    const reg = contractRegistry();
    reg.templates = reg.templates.map((x) => (x.id === "gecis_destegi" ? { ...x, behavior_changes: ["zararda_once_kucul", "kredi_kopru"] } : { ...x, behavior_changes: [] }));
    setup({ info: { registry: reg } });
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    expect(screen.getByText("Bu şablon 2 dünya varsayımını da değiştirir: Zararda önce küçül, Yerleşik firmalara köprü kredisi.")).toBeInTheDocument();
    expect(screen.getAllByText(/dünya varsayımını da değiştirir/)).toHaveLength(1);
  });

  it("template_not_startable_is_locked_with_readable_reason_and_missing_field_keeps_behavior", async () => {
    const reg = contractRegistry();
    reg.templates = reg.templates.map((x) => (x.id === "gecis_destegi" ? { ...x, startable: false, blocked_by: ["kredi_kopru", "zararda_once_kucul"] } : x));
    setup({ info: { registry: reg } });
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    const kilitli = screen.getByRole("button", { name: t("sablon.gecis_destegi.name") });
    expect(kilitli).toBeDisabled();
    expect(screen.getByText(t("kurucu.adim1.kilit_dogrulanmadi", { kartlar: "Yerleşik firmalara köprü kredisi, Zararda önce küçül" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("sablon.dayanikli_taban.name") })).toBeEnabled(); // alan yok: bugünkü davranış
  });

  it("replay_recorded_templates_selectable_others_locked", async () => {
    const registry = { ...contractRegistry(), templates: [{ id: "dayanikli_taban", title: "Dayanıklı taban", values: {} }, { id: "dengeli_buyume", title: "Dengeli büyüme", what: "Örnek açıklama.", values: {} }] };
    setup({ info: { registry } });
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    const kayitli = screen.getByRole("button", { name: t("sablon.dayanikli_taban.name") });
    expect(kayitli).toBeEnabled();
    const kilitli = screen.getByRole("button", { name: "Dengeli büyüme" });
    expect(kilitli).toBeDisabled();
    expect(kilitli).toHaveAccessibleDescription(new RegExp(t("kurucu.adim1.kilit_kayitsiz")));
    expect(screen.getByText(t("kurucu.adim1.kilit_kayitsiz"))).toBeVisible();
  });

  it("name_validation_unchanged", async () => {
    setup();
    await bekle();
    expect(screen.getByRole("button", { name: t("kurucu.baslat") })).toBeDisabled();
    fireEvent.change(nameInput(), { target: { value: "😀".repeat(65) } });
    expect(screen.getByText(t("kurucu.ad_hata"))).toBeVisible();
    expect(screen.getByText(t("kurucu.baslat_neden_gecersiz"))).toBeVisible();
    fireEvent.change(nameInput(), { target: { value: "Tamam" } });
    expect(screen.getByRole("button", { name: t("kurucu.baslat") })).toBeEnabled();
  });
});

describe("Başlangıç dünyası metni", () => {
  it("world_picker_text_no_tohum_no_rastlanti", async () => {
    const { container } = setup();
    await bekle();
    const sayfalar: string[] = [];
    sayfalar.push(container.textContent ?? "");
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    sayfalar.push(container.textContent ?? "");
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    sayfalar.push(container.textContent ?? "");
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    sayfalar.push(container.textContent ?? "");
    fireEvent.click(devam(t("kurucu.adim4.ad")));
    sayfalar.push(container.textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.geri") }));
    for (const s of sayfalar) expect(s).not.toMatch(/tohum|rastlant/i);
    expect(screen.getByRole("heading", { name: t("kurucu.dunya_baslik") })).toBeVisible();
    expect(screen.getByText(t("kurucu.dunya_ipucu"))).toBeVisible();
    // I1: DK-8'in üç cümlesi de ekranda.
    expect(t("kurucu.dunya_ipucu")).toContain("Aynı kuralı birkaç dünyada denemek sonucun ne kadar sağlam olduğunu gösterir.");
    for (let n = 1; n <= 6; n++) expect(screen.getByRole("button", { name: t("kurucu.dunya_ad", { n }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dünya 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("dunya_secimi_start_e_gider_ve_taslakta_kalir", async () => {
    const { start } = setup();
    await bekle();
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    fireEvent.click(screen.getByRole("button", { name: "Dünya 4" }));
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.geri") }));
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    expect(screen.getByRole("button", { name: "Dünya 4" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]![0].seedIndex).toBe(3);
  });
});

describe("W3 düzeltme turu", () => {
  it("uygunluk_denetimi_gonderilen_tum_degerlerle_yapilir", async () => {
    const calls: Record<string, unknown>[] = [];
    const source = {
      kind: "replay", capabilities: {}, info: async () => makeInfo({ templates: [{ id: "dayanikli_taban", values: { gecis_destegi: "kapali", ekstra_ayar: 3 } }] }),
      availability: async (v: Record<string, unknown>) => { calls.push(v); return { ok: true, scenarioId: "k", blocked: [] }; },
      start: vi.fn(), open: async () => null, subscribe: () => () => {}, control: vi.fn(), applyChange: vi.fn(), weeks: vi.fn(), dispose: () => {},
    } as unknown as SimSource;
    render(<SimSourceProvider source={source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
    await bekle();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.at(-1)).toEqual({ gecis_destegi: "kapali", ekstra_ayar: 3 });
  });

  it("saklanan_gecersiz_dunya_ilk_dunyaya_duser", async () => {
    window.sessionStorage.setItem("oyun.kurucu.taslak", JSON.stringify({ name: "D", cities: ["", "", "", "", ""], seedIndex: 99 }));
    const { start } = setup();
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    expect(screen.getByRole("button", { name: "Dünya 1" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0]![0].seedIndex).toBe(0);
  });

  it("son_adima_gecince_odak_geri_dugmesine_gider", async () => {
    setup();
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    const d = devam(t("kurucu.adim4.ad"));
    d.focus();
    fireEvent.click(d);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: t("kurucu.geri") })));
  });

  it("duyuru_elle_duzenlemeden_sonra_temizlenir", async () => {
    setup({ rng: seqRng() });
    await bekle();
    const bolge = document.querySelector("[aria-live='polite']") as HTMLElement;
    fireEvent.click(rastgele());
    expect(bolge.textContent).not.toBe("");
    fireEvent.change(nameInput(), { target: { value: "Elle" } });
    expect(bolge.textContent).toBe("");
  });

  it("dunya_karti_metinleri_bossa_tr_yedegi", async () => {
    const registry = contractRegistry();
    const card = registry.cards.find((c) => c.id === "dunya_tohumu")!;
    card.what = "";
    card.changes = "";
    setup({ info: { registry } });
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    expect(screen.getByText(t("kurucu.dunya_ipucu"))).toBeVisible();
  });

  it("dunya_ipucu_kayittaki_kart_metninden_gelir", async () => {
    const registry = contractRegistry();
    const card = registry.cards.find((c) => c.id === "dunya_tohumu")!;
    setup({ info: { registry } });
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    expect(screen.getByText(card.what)).toBeVisible();
    expect(screen.getByText(card.changes)).toBeVisible();
  });
});

describe("Kayıt büyümesine dayanıklılık", () => {
  it("bilinmeyen_kural_kimligi_kurucuyu_dusurmez", async () => {
    setup({ info: { fixedRules: [{ settingId: "yeni_kural" as never, valueKey: "lock.deger.yeni_kural" as never, valueText: "%7" }] } });
    await bekle();
    fireEvent.click(devam(t("kurucu.adim1.ad")));
    fireEvent.click(devam(t("kurucu.adim2.ad")));
    fireEvent.click(devam(t("kurucu.adim3.ad")));
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: t("kurucu.dunya_baslik") })).toBeVisible();
  });
});

describe("Başlat: sunucu sınırları", () => {
  it.each([
    ["too_many_runs", "kurucu.baslat_hata_cok_kosu"],
    ["busy_preparing", "kurucu.baslat_hata_mesgul"],
  ] as const)("%s_ozel_metin_gosterir", async (code, key) => {
    const { start } = setup({ start: async () => { throw new SimUnsupported(code); } });
    await bekle();
    fireEvent.change(nameInput(), { target: { value: "D" } });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    const uyari = await screen.findByRole("alert");
    expect(uyari).toHaveTextContent(t(key));
    expect(screen.queryByText(t("kurucu.baslat_hata"))).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("429_metni_sayisiz_ve_olmayan_kapatma_yolunu_onermez", () => {
    expect(t("kurucu.baslat_hata_cok_kosu")).not.toMatch(/\d/);
    expect(t("kurucu.baslat_hata_cok_kosu")).not.toMatch(/koşuyu kapat/i);
    expect(t("kurucu.baslat_hata_cok_kosu")).toMatch(/sekme/);
  });

  it("art_arda_baslat_tek_istek", async () => {
    let release: (h: RunHandle) => void = () => {};
    const { start } = setup({ start: () => new Promise<RunHandle>((r) => (release = r)) });
    await bekle();
    fireEvent.change(nameInput(), { target: { value: "D" } });
    const b = screen.getByRole("button", { name: t("kurucu.baslat") });
    fireEvent.click(b);
    fireEvent.click(b);
    fireEvent.click(b);
    expect(start).toHaveBeenCalledTimes(1);
    release({ runId: "z", state: {} as never });
  });
});
