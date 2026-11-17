import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { Piyasa, piyasaMetni } from "@/oyun/screens/piyasa/Piyasa";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import { sartTabani } from "@/oyun/screens/sart/sartMantik";
import type { Registry, RegistryCard, World } from "@/oyun/sim/types";
import { contractRegistry } from "../helpers/registryFixtures";

afterEach(() => cleanup());

const gosterge = (id: string, title: string, alan: string, unit: string): RegistryCard => ({
  id, layer: "S", group: "dunya", actor: null, level: "A", editable: false, status: "active", kind: "number", params: [], requires: [],
  title, what: `${title}: nasıl oluşur`, changes: "Bu bir göstergedir.", control: { type: "number", min: 0, max: 1000, step: 1, unit, integer: false },
  default: 0, apply: "unknown", measured_values: null, measured_with: null, measured_weeks: null, hint_source: null, credit_type: null, scenario_editable: false, source_world_field: alan,
});

function kayit(): Registry {
  const reg = contractRegistry();
  reg.cards = [
    ...reg.cards.filter((c) => c.layer === "P"),
    gosterge("g_fiyat", "Fiyat endeksi", "price_index", "sayi"),
    gosterge("g_faiz", "Mevduat faizi", "deposit_rate", "yuzde_hafta"),
    gosterge("g_enflasyon", "Yıllık enflasyon", "inflation_yoy", "yuzde"),
  ];
  return reg;
}

const dunya = (over: Partial<World> = {}): World => ({
  served: 0.9, unemployed: 1, employed: 2, npc_firms: 3, player_firms: 1, failed_cum: 0, city_cash_total: 1, city_cash_weeks: 1, gini: 0.3, price_index: 100,
  inflation_yoy: null, unemployment_rate: 0.05, policy_rate: null, minted_year: null, mint_cap: null, loans_applied: null, loans_rejected: null, loans_granted: null,
  loan_rate_avg: null, support_weekly: null, survival_52: null, wage_index: 100, rent_pct: null, occupancy: null, house_index: null, deposit_rate: 0.0031, bond_rate: null,
  lonca_fee_avg: null, royalty_avg: null, money_total: null, velocity: null, privatized_firms: null, no_founder: null, reject_pool: null, reject_reputation: null,
  no_buyer_cum: null, support_denied: null, policy_unemployment: null, city_spend_cut: null, tenants_per_house: null, house_resale_ratio: null,
  policy_inflation: null, minted_total: null, ...over,
});

const satir = (ad: string) => screen.getByRole("row", { name: new RegExp(ad) });

describe("C katmanı: piyasa", () => {
  it("builder_shows_every_value_as_visible_after_the_run_starts", () => {
    render(<Piyasa registry={kayit()} kimlik={(id) => id} />);
    expect(screen.getByRole("heading", { name: t("piyasa.baslik") })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: t("piyasa.sutun_simdi") })).toBeNull();
    for (const ad of ["Fiyat endeksi", "Mevduat faizi", "Yıllık enflasyon"]) expect(within(satir(ad)).getByText(t("piyasa.kosu_baslayinca"))).toBeInTheDocument();
    // henüz koşu yokken "ölçülmüyor" denmez (ölçülmeyen ile henüz ölçülmemiş ayrıdır)
    expect(screen.queryByText(t("piyasa.olculmuyor"))).toBeNull();
  });

  it("market_null_reads_olculmuyor", () => {
    render(<Piyasa registry={kayit()} kimlik={(id) => id} veri={{ baslangic: dunya({ deposit_rate: null }), simdi: dunya({ deposit_rate: null }), week: 100 }} />);
    const faiz = within(satir("Mevduat faizi"));
    // görünür "–" ve ekran okuyucuya "ölçülmüyor"; iki sütunda da
    expect(faiz.getAllByText(t("piyasa.yok_isareti"))).toHaveLength(2);
    expect(faiz.getAllByText(t("piyasa.olculmuyor"))).toHaveLength(2);
    expect(faiz.getAllByText(t("piyasa.yok_isareti"))[0]).toHaveAttribute("aria-hidden", "true");
  });

  it("values_are_formatted_with_units_and_both_columns", () => {
    render(<Piyasa registry={kayit()} kimlik={(id) => id} veri={{ baslangic: dunya({ price_index: 100 }), simdi: dunya({ price_index: 104.5, deposit_rate: 0.0031 }), week: 40 }} />);
    expect(within(satir("Fiyat endeksi")).getByText("100")).toBeInTheDocument();
    expect(within(satir("Fiyat endeksi")).getByText("104,5")).toBeInTheDocument();
    // haftalık faiz kesirden yüzdeye çevrilir ve yıllığı yanında yazılır
    expect(within(satir("Mevduat faizi")).getAllByText(/%0,31\/hafta/)).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: t("piyasa.sutun_simdi") })).toBeInTheDocument();
  });

  it("opening_period_explains_the_empty_yearly_inflation", () => {
    render(<Piyasa registry={kayit()} kimlik={(id) => id} veri={{ baslangic: dunya(), simdi: dunya({ inflation_yoy: null, policy_inflation: 0.021 }), week: 30 }} />);
    const enf = within(satir("Yıllık enflasyon"));
    expect(enf.getByText(t("piyasa.acilis_enflasyon", { hafta: 66 }))).toBeInTheDocument();
    expect(enf.getByText(t("piyasa.faiz_enflasyonu", { n: "%2,1" }))).toBeInTheDocument();
    expect(enf.getAllByText(t("piyasa.olculmuyor")).length).toBeGreaterThan(0);
  });

  it("after_the_opening_period_a_missing_inflation_is_plain_olculmuyor", () => {
    render(<Piyasa registry={kayit()} kimlik={(id) => id} veri={{ baslangic: dunya(), simdi: dunya({ inflation_yoy: null }), week: 90 }} />);
    expect(within(satir("Yıllık enflasyon")).queryByText(/Açılış dönemi/)).toBeNull();
  });

  it("piyasaMetni_is_null_for_null_unknown_field_and_missing_world", () => {
    const reg = kayit();
    const faiz = reg.cards.find((c) => c.id === "g_faiz")!;
    expect(piyasaMetni(reg, faiz, null)).toBeNull();
    expect(piyasaMetni(reg, faiz, dunya({ deposit_rate: null }))).toBeNull();
    expect(piyasaMetni(reg, { ...faiz, source_world_field: null }, dunya())).toBeNull();
  });

  it("market_layer_tab_appears_only_when_the_registry_has_indicators", () => {
    const reg = kayit();
    const base = sartTabani(reg, {});
    const ui = (r: Registry) => <SartEditoru mode="builder" registry={r} base={base} draft={base} onDraft={() => {}} context={{ durationWeeks: 200 }} />;
    const { rerender } = render(ui(reg));
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("sart.katman_piyasa")) }));
    expect(screen.getByRole("heading", { name: t("piyasa.baslik") })).toBeInTheDocument();
    rerender(ui({ ...reg, cards: reg.cards.filter((c) => c.layer !== "S") }));
    expect(screen.queryByRole("tab", { name: new RegExp(t("sart.katman_piyasa")) })).toBeNull();
    expect(screen.getByRole("tab", { name: new RegExp(t("sart.katman_kurallar")) })).toHaveAttribute("aria-selected", "true");
  });

  it("works_with_the_real_registry_whatever_the_indicator_count", () => {
    const reg = contractRegistry();
    const n = reg.cards.filter((c) => c.layer === "S").length;
    render(<Piyasa registry={reg} kimlik={(id) => id} />);
    expect(screen.getAllByRole("row")).toHaveLength(n + 1);
  });
});
