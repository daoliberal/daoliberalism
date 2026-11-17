import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { Kurucu } from "@/oyun/screens/kurucu/Kurucu";
import type { DunyaBaglami } from "@/oyun/screens/insanlar/Insanlar";
import { ozelGonderilecek } from "@/oyun/screens/insanlar/insanlarMantik";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import { sartTabani } from "@/oyun/screens/sart/sartMantik";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import type { Availability, Registry, RegistryCard, RunConfig, RunHandle, SimSource, SourceInfo, ValuesPatch } from "@/oyun/sim/types";
import { contractRegistry } from "../helpers/registryFixtures";

vi.mock("@/oyun/sim/live", async (orig) => ({ ...(await orig<typeof import("@/oyun/sim/live")>()), probeLive: async () => ({ ok: false }) }));

beforeEach(() => {
  window.location.hash = "#/kurucu";
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

const sayi = (id: string, title: string, over: Partial<RegistryCard> = {}): RegistryCard => ({
  id, layer: "V", group: "dunya", actor: "hane", level: "A", editable: true, status: "active", kind: "number", params: ["X"], requires: [],
  title, what: `${title}: ne olduğu`, changes: `${title}: oyunda neyi değiştirir`,
  control: { type: "number", min: 0, max: 100, step: 1, unit: "yuzde", integer: false }, default: 10, apply: "live",
  measured_values: null, measured_with: null, measured_weeks: null, hint_source: null, credit_type: null, scenario_editable: true, source_world_field: null,
  ...over,
});

const MODEL_KARTLARI = ["v_hane_acik", "v_hane_sabit", "v_hane_belirsiz", "v_girisimci", "v_yeni_aktor", "v_aktorsuz", "v_kalibrasyon"];

/** Gerçek kayıttaki V/S/Y kartları atılır; sayıları kayda bağlı olmayan sentetik kartlar konur. */
function kayit(): Registry {
  const reg = contractRegistry();
  const p = reg.cards.filter((c) => c.layer === "P").map((c) => ({ ...c, apply: "live" as const }));
  const kural = p.find((c) => c.kind === "toggle")!;
  reg.cards = [
    ...p,
    sayi("v_hane_acik", "Harcama eğrisi"),
    sayi("v_hane_sabit", "Hane sabiti", { scenario_editable: false }),
    sayi("v_hane_belirsiz", "Doğrulanmamış varsayım", { apply: "unknown" }),
    sayi("v_girisimci", "Kurma eğilimi", { actor: "girisimci", warning: "Bu davranışın etkisi ölçülmedi.", effective_when: { [kural.id]: !kural.default } }),
    sayi("v_yeni_aktor", "Yeni aktörün varsayımı", { actor: "yeni_aktor" }),
    sayi("v_aktorsuz", "Aktörsüz varsayım", { actor: null }),
    sayi("v_kalibrasyon", "Kalibrasyon", { actor: "dunya", editable: false, scenario_editable: false, default: 0, shows: [{ label: "Gerçek dünyada", value: 0.4, text: "%40" }] }),
    sayi("s_fiyat", "Fiyat endeksi", { layer: "S", actor: null, editable: false, scenario_editable: false, apply: "unknown", source_world_field: "price_index", control: { type: "number", min: 0, max: 1000, step: 1, unit: "sayi", integer: false } }),
    { ...sayi("y_kural", "Başlangıç dünyası", { layer: "Y", actor: null, kind: "toggle", editable: false, scenario_editable: false, default: true }), control: { type: "options", options: [{ label: "açık", value: true }, { label: "kapalı", value: false }] } },
  ];
  reg.scenarios = [
    { id: "gercekci", title: "Gerçekçi", values: {}, startable: true },
    { id: "tutumlu", title: "Tutumlu toplum", what: "Haneler daha az harcar.", values: { v_hane_acik: 20 }, startable: true, measured: false },
    { id: "blokajli", title: "Henüz yok", values: {}, startable: false, blocked_by: ["v_hane_belirsiz"] },
    { id: "ozel", title: "Özel", values: {}, startable: true, measured: false },
  ];
  return reg;
}

type HostProps = { registry?: Registry; baslangic?: string | null; ozel?: ValuesPatch; kilit?: DunyaBaglami["kilit"]; onDunya?: (n: { scenarioId: string; values: ValuesPatch }) => void };
function Host({ registry = kayit(), baslangic = null, ozel = {}, kilit, onDunya }: HostProps) {
  const base = sartTabani(registry, {});
  const [d, setD] = useState<{ scenarioId: string | null; values: ValuesPatch }>({ scenarioId: baslangic, values: ozel });
  return (
    <SartEditoru
      mode="builder" registry={registry} base={base} draft={base} onDraft={() => {}} context={{ durationWeeks: 200 }}
      dunya={{ scenarioId: d.scenarioId, values: d.values, ...(kilit ? { kilit } : {}), onChange: (n) => { setD(n); onDunya?.(n); } }}
    />
  );
}

const katman = (ad: string) => screen.getByRole("tab", { name: new RegExp(ad) });
const insanlarAc = () => fireEvent.click(katman(t("sart.katman_insanlar")));
const aktorSekmesi = (ad: string) => screen.getByRole("tab", { name: ad });
const KONTROLLER = ["spinbutton", "radio", "checkbox", "slider", "combobox", "textbox", "switch"] as const;

describe("B katmanı: dünyanın insanları", () => {
  it("no_interactive_control_in_V_without_custom", () => {
    render(<Host />);
    insanlarAc();
    for (const g of ["Haneler", "Girişimciler", "Dünya kalibrasyonu", "Diğer"]) {
      fireEvent.click(aktorSekmesi(g));
      const alan = screen.getByRole("tabpanel", { name: g });
      for (const rol of KONTROLLER) expect(within(alan).queryAllByRole(rol), `${g}/${rol}`).toHaveLength(0);
      expect(within(alan).queryAllByRole("button"), g).toHaveLength(0);
    }
    // hazır senaryoda da kontrol yok
    cleanup();
    render(<Host baslangic="tutumlu" />);
    insanlarAc();
    const alan = screen.getByRole("tabpanel", { name: "Haneler" });
    for (const rol of KONTROLLER) expect(within(alan).queryAllByRole(rol), rol).toHaveLength(0);
    // hazır senaryonun değeri "şu anki varsayım" olarak yazılır (varsayılan değil)
    expect(within(screen.getByRole("article", { name: "Harcama eğrisi" })).getByText("%20")).toBeInTheDocument();
  });

  it("every_V_card_in_an_actor", () => {
    const reg = kayit();
    render(<Host registry={reg} />);
    insanlarAc();
    const bulunan = new Set<string>();
    for (const sekme of within(screen.getByRole("tablist", { name: t("insanlar.aktorlar") })).getAllByRole("tab")) {
      fireEvent.click(sekme);
      const alan = screen.getByRole("tabpanel", { name: sekme.textContent ?? "" });
      for (const c of reg.cards.filter((x) => x.layer === "V")) if (within(alan).queryByRole("article", { name: c.title })) bulunan.add(c.id);
    }
    expect([...bulunan].sort()).toEqual(reg.cards.filter((x) => x.layer === "V").map((c) => c.id).sort());
    // aktörü bilinmeyen ve aktörsüz kartlar "Diğer" sekmesinde
    fireEvent.click(aktorSekmesi(t("insanlar.aktor.diger")));
    const diger = screen.getByRole("tabpanel", { name: t("insanlar.aktor.diger") });
    expect(within(diger).getAllByRole("article")).toHaveLength(2);
  });

  it("every_V_card_of_the_real_registry_is_reachable_whatever_the_count", () => {
    const reg = contractRegistry();
    const v = reg.cards.filter((c) => c.layer === "V");
    expect(v.length).toBeGreaterThan(0);
    render(<Host registry={reg} />);
    insanlarAc();
    const sekmeler = within(screen.getByRole("tablist", { name: t("insanlar.aktorlar") })).getAllByRole("tab");
    const basliklar = new Set<string>();
    for (const sekme of sekmeler) {
      fireEvent.click(sekme);
      for (const a of within(screen.getByRole("tabpanel", { name: sekme.textContent ?? "" })).getAllByRole("article")) basliklar.add(a.getAttribute("aria-labelledby") ? document.getElementById(a.getAttribute("aria-labelledby")!)!.textContent! : "");
    }
    for (const c of v) expect(basliklar.has(c.title), c.id).toBe(true);
  });

  it("custom_scenario_unlocks_only_scenario_editable", () => {
    render(<Host baslangic="ozel" />);
    insanlarAc();
    const acik = within(screen.getByRole("article", { name: "Harcama eğrisi" }));
    expect(acik.getByRole("textbox")).toBeEnabled();
    expect(within(screen.getByRole("article", { name: "Harcama eğrisi" }).parentElement!).getByText(t("insanlar.senaryo_etiketi"))).toBeInTheDocument();
    // modelde sabit kartta kontrol yok
    expect(within(screen.getByRole("article", { name: "Hane sabiti" })).queryAllByRole("textbox")).toHaveLength(0);
    // canlılığı doğrulanmamış (unknown) kart kilitli kalır (DK-17)
    const belirsiz = within(screen.getByRole("article", { name: "Doğrulanmamış varsayım" }));
    expect(belirsiz.getByRole("textbox")).toBeDisabled();
    expect(belirsiz.getByRole("textbox")).toHaveAccessibleDescription(expect.stringContaining(t("kart.dogrulanmadi")));
    // kalibrasyon (salt okunur) ve aktörü başka sekmedeki kartlar da kontrolsüz
    fireEvent.click(aktorSekmesi("Dünya kalibrasyonu"));
    expect(within(screen.getByRole("tabpanel", { name: "Dünya kalibrasyonu" })).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("custom_value_edits_a_patch_that_keeps_only_differences_from_the_default", () => {
    const onDunya = vi.fn();
    render(<Host baslangic="ozel" onDunya={onDunya} />);
    insanlarAc();
    const alan = within(screen.getByRole("article", { name: "Harcama eğrisi" })).getByRole("textbox");
    fireEvent.change(alan, { target: { value: "35" } });
    expect(onDunya).toHaveBeenLastCalledWith({ scenarioId: "ozel", values: { v_hane_acik: 35 } });
    fireEvent.change(alan, { target: { value: "10" } }); // varsayılana dönünce yamadan düşer
    expect(onDunya).toHaveBeenLastCalledWith({ scenarioId: "ozel", values: {} });
  });

  it("entry_exp_warning_visible", () => {
    render(<Host />);
    insanlarAc();
    fireEvent.click(aktorSekmesi("Girişimciler"));
    const kart = within(screen.getByRole("article", { name: "Kurma eğilimi" }));
    expect(kart.getByText("Bu davranışın etkisi ölçülmedi.")).toBeInTheDocument();
    // Özel'de RuleCard ile açılsa da uyarı görünür
    cleanup();
    render(<Host baslangic="ozel" />);
    insanlarAc();
    fireEvent.click(aktorSekmesi("Girişimciler"));
    expect(within(screen.getByRole("article", { name: "Kurma eğilimi" })).getByText("Bu davranışın etkisi ölçülmedi.")).toBeInTheDocument();
  });

  it("effective_when_mismatch_says_the_card_is_inactive_now", () => {
    render(<Host />);
    insanlarAc();
    fireEvent.click(aktorSekmesi("Girişimciler"));
    expect(within(screen.getByRole("article", { name: "Kurma eğilimi" })).getByText(/Şu an etkisiz/)).toBeInTheDocument();
    fireEvent.click(aktorSekmesi("Haneler"));
    expect(within(screen.getByRole("article", { name: "Harcama eğrisi" })).queryByText(/Şu an etkisiz/)).toBeNull();
  });

  it("calibration_shows_real_world_rows_read_only", () => {
    render(<Host />);
    insanlarAc();
    fireEvent.click(aktorSekmesi("Dünya kalibrasyonu"));
    const kart = within(screen.getByRole("article", { name: "Kalibrasyon" }));
    expect(kart.getByText("%40")).toBeInTheDocument();
  });

  it("world_rules_Y_are_listed_read_only", () => {
    render(<Host />);
    insanlarAc();
    const bolum = screen.getByRole("region", { name: t("insanlar.dunya_kurallari") });
    expect(within(bolum).getByRole("article", { name: "Başlangıç dünyası" })).toBeInTheDocument();
    for (const rol of KONTROLLER) expect(within(bolum).queryAllByRole(rol)).toHaveLength(0);
  });
});

describe("Dünya senaryosu seçici", () => {
  it("lists_ready_scenarios_and_custom_and_blocks_unstartable_with_reason", () => {
    const onDunya = vi.fn();
    render(<Host onDunya={onDunya} />);
    insanlarAc();
    fireEvent.click(screen.getByRole("button", { name: t("insanlar.senaryo_dugme") }));
    const dlg = within(screen.getByRole("dialog", { name: t("senaryo.baslik") }));
    expect(dlg.getByRole("button", { name: /Gerçekçi/ })).toHaveAttribute("aria-pressed", "true");
    expect(dlg.getByRole("button", { name: /Özel/ })).toBeEnabled();
    const blok = dlg.getByRole("button", { name: /Henüz yok/ });
    expect(blok).toBeDisabled();
    expect(within(blok).getByText(/Doğrulanmamış varsayım/)).toBeInTheDocument();
    // ölçülmedi rozeti gerçekçide yok, öteki senaryolarda var
    expect(within(dlg.getByRole("button", { name: /Gerçekçi/ })).queryByText(/Ölçülmedi/)).toBeNull();
    expect(within(dlg.getByRole("button", { name: /Tutumlu toplum/ })).getByText(/Ölçülmedi/)).toBeInTheDocument();
    fireEvent.click(dlg.getByRole("button", { name: /Tutumlu toplum/ }));
    expect(onDunya).toHaveBeenCalledWith({ scenarioId: "tutumlu", values: {} });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(t("insanlar.senaryo_satiri", { ad: "Tutumlu toplum" }))).toBeInTheDocument();
  });

  it("replay_scenario_locked", () => {
    render(<Host kilit="insanlar.kilit_kayit" />);
    insanlarAc();
    expect(screen.getByRole("button", { name: t("insanlar.senaryo_dugme") })).toBeDisabled();
    expect(screen.getByText(t("insanlar.kilit_kayit"))).toBeInTheDocument();
  });

  it("world_scenario_in_strip_and_not_in_sart_values", () => {
    // gerçekçide de şeritte "Dünya senaryosu: Gerçekçi" ve "Senaryoyu değiştir" vardır (prototip gibi)
    render(<Host />);
    expect(screen.getByText(new RegExp(`Dünya senaryosu: Gerçekçi$`), { selector: "p span" })).toBeInTheDocument();
    cleanup();
    render(<Host baslangic="tutumlu" />);
    expect(screen.getByText(/Dünya senaryosu: Tutumlu toplum$/, { selector: "p span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("sart.senaryoyu_degistir") }));
    expect(katman(t("sart.katman_insanlar"))).toHaveAttribute("aria-selected", "true");
  });

  it("layer_tabs_support_arrow_keys_and_cover_all_layers", () => {
    render(<Host />);
    const a = katman(t("sart.katman_kurallar"));
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(katman(t("sart.katman_insanlar"))).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(katman(t("sart.katman_insanlar")));
    fireEvent.keyDown(katman(t("sart.katman_insanlar")), { key: "End" });
    expect(katman(t("sart.katman_piyasa"))).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", katman(t("sart.katman_piyasa")).id);
  });
});

// ---- Kurucu: senaryo başlatmaya gider, Şart değerlerine girmez ----
function kurucuKurulumu(registry: Registry, tur: "live" | "replay" = "live") {
  const start = vi.fn(async (c: RunConfig): Promise<RunHandle> => ({ runId: "y1", state: { runId: "y1", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: c.seedIndex, values: c.values, scenarioId: "canli", name: c.name, cityNames: c.cityNames } }));
  const info: SourceInfo = {
    kind: tur, modelNote: "x", seeds: [0, 1].map((i) => ({ index: i, label: 0.08 })), durationWeeks: 200, settings: [], fixedRules: [],
    templates: registry.templates.map((x) => ({ id: x.id, values: x.values })), registry,
  };
  const source = {
    kind: tur, capabilities: { branch: false, seeds: false, compare: false, library: false, city: false, chain: false },
    info: async () => info, availability: async (): Promise<Availability> => ({ ok: true, scenarioId: "canli", blocked: [] }),
    start, open: async () => null, subscribe: () => () => {}, control: vi.fn(), applyChange: vi.fn(), weeks: vi.fn(), dispose: () => {},
  } as unknown as SimSource;
  render(<SimSourceProvider source={source}><Kurucu adopt={() => {}} /></SimSourceProvider>);
  return start;
}

describe("Kurucu: dünya senaryosu", () => {
  it("world_scenario_in_strip_and_not_in_sart_values (Kurucu başlatma)", async () => {
    const reg = kayit();
    const start = kurucuKurulumu(reg);
    await screen.findByRole("heading", { name: t("kurucu.baslik") });
    fireEvent.change(screen.getByLabelText(t("kurucu.ad_etiket")), { target: { value: "D" } });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("kurucu.adim1.ad") }) }));
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("kurucu.adim2.ad") }) }));
    insanlarAc();
    fireEvent.click(screen.getByRole("button", { name: t("insanlar.senaryo_dugme") }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Özel/ }));
    fireEvent.change(within(screen.getByRole("article", { name: "Harcama eğrisi" })).getByRole("textbox"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const cfg = start.mock.calls[0]![0];
    expect(cfg.worldScenarioId).toBe("ozel");
    expect(cfg.worldScenarioValues).toEqual({ v_hane_acik: 40 });
    expect("scenarioId" in cfg).toBe(false);
    for (const id of MODEL_KARTLARI) expect(id in cfg.values, id).toBe(false);
  });

  it("gercekci_secimde_worldScenarioId_gonderilmez", async () => {
    const start = kurucuKurulumu(kayit());
    await screen.findByRole("heading", { name: t("kurucu.baslik") });
    fireEvent.change(screen.getByLabelText(t("kurucu.ad_etiket")), { target: { value: "D" } });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]![0].worldScenarioId).toBeUndefined();
  });
});

describe("Özel senaryo gönderimi", () => {
  it("custom_scenario_sends_only_open_scenario_editable_values_that_differ_from_the_default", () => {
    const reg = kayit();
    const yama: ValuesPatch = { v_hane_acik: 25, v_hane_sabit: 5, v_hane_belirsiz: 7, v_girisimci: 10, bilinmeyen_kart: 1 };
    // sabit (scenario_editable değil), doğrulanmamış (unknown), varsayılana eşit ve kayıtta olmayan değer gitmez
    expect(ozelGonderilecek(reg, yama)).toEqual({ v_hane_acik: 25 });
    reg.cards = reg.cards.map((c) => (c.id === "v_hane_belirsiz" ? { ...c, apply: "live" as const } : c));
    expect(ozelGonderilecek(reg, yama)).toEqual({ v_hane_acik: 25, v_hane_belirsiz: 7 });
  });
});

describe("Arama: B, C ve Y kartları", () => {
  const ara = (q: string) => fireEvent.change(screen.getByRole("searchbox", { name: t("sart.ara") }), { target: { value: q } });

  it("search_box_is_on_every_layer", () => {
    render(<Host />);
    for (const k of ["sart.katman_kurallar", "sart.katman_insanlar", "sart.katman_piyasa"] as const) {
      fireEvent.click(katman(t(k)));
      expect(screen.getByRole("searchbox", { name: t("sart.ara") })).toBeInTheDocument();
    }
  });

  it("search_finds_a_V_card_and_opens_its_actor_tab_and_focuses_it", () => {
    render(<Host />);
    ara("kurma eğilimi");
    const sonuclar = within(screen.getByRole("list", { name: t("sart.ara_sonuclar") }));
    const sonuc = sonuclar.getByRole("button", { name: /Kurma eğilimi/ });
    expect(within(sonuc).getByText(t("sart.ara_yer_insanlar", { aktor: "Girişimciler" }))).toBeInTheDocument();
    fireEvent.click(sonuc);
    expect(katman(t("sart.katman_insanlar"))).toHaveAttribute("aria-selected", "true");
    expect(aktorSekmesi("Girişimciler")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Kurma eğilimi" }));
  });

  it("search_finds_a_market_indicator_and_focuses_its_row", () => {
    render(<Host />);
    ara("fiyat endeksi");
    const sonuc = screen.getByRole("button", { name: /Fiyat endeksi/ });
    expect(within(sonuc).getByText(t("sart.ara_yer_piyasa"))).toBeInTheDocument();
    fireEvent.click(sonuc);
    expect(katman(t("sart.katman_piyasa"))).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("row", { name: /Fiyat endeksi/ }));
  });

  it("search_finds_a_world_rule_Y", () => {
    render(<Host />);
    ara("başlangıç dünyası");
    const sonuc = screen.getByRole("button", { name: /Başlangıç dünyası/ });
    expect(within(sonuc).getByText(t("sart.ara_yer_dunya_kurali"))).toBeInTheDocument();
    fireEvent.click(sonuc);
    expect(katman(t("sart.katman_insanlar"))).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Başlangıç dünyası" }));
  });

  it("rule_search_still_lands_on_the_rules_layer", () => {
    render(<Host />);
    fireEvent.click(katman(t("sart.katman_piyasa")));
    const reg = kayit();
    const p = reg.cards.find((c) => c.layer === "P" && c.level !== "U")!;
    ara(p.title);
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(p.title) })[0]!);
    expect(katman(t("sart.katman_kurallar"))).toHaveAttribute("aria-selected", "true");
  });
});

describe("Kayıt kaynağında saklı senaryo", () => {
  it("stored_world_scenario_is_dropped_on_a_replay_source", async () => {
    window.sessionStorage.setItem("oyun.kurucu.taslak", JSON.stringify({ name: "D", worldScenarioId: "tutumlu" }));
    const start = kurucuKurulumu(kayit(), "replay");
    await screen.findByRole("heading", { name: t("kurucu.baslik") });
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("kurucu.adim1.ad") }) }));
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.devam", { ad: t("kurucu.adim2.ad") }) }));
    expect(screen.getByText(/Dünya senaryosu: Gerçekçi$/, { selector: "p span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("kurucu.baslat") }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]![0].worldScenarioId).toBeUndefined();
  });
});
