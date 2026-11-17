import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import { sartTabani } from "@/oyun/screens/sart/sartMantik";
import { HizBilgisiProvider } from "@/oyun/sim/hizBilgisi";
import { decodeRecipe, encodeRecipe } from "@/oyun/sim/recipe";
import type { Registry, ValuesPatch } from "@/oyun/sim/types";
import { contractRegistry } from "../helpers/registryFixtures";

afterEach(() => cleanup());

function Host({ registry, mode = "builder" }: { registry: Registry; mode?: "builder" | "live" }) {
  const base = sartTabani(registry, {});
  const [patch, setPatch] = useState<ValuesPatch>({});
  return (
    <HizBilgisiProvider secPerWeekP50={0.5}>
      <SartEditoru mode={mode} registry={registry} base={base} draft={{ ...base, ...patch }} context={{ durationWeeks: 200 }} onDraft={(n) => setPatch(n)} />
    </HizBilgisiProvider>
  );
}

const grup = () => within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: /^\d+\. İş piyasası$/ });
const KARTLAR = ["Ahırdaki oyuncunun işe geçişi", "İşe alım önceliği", "İşten çıkarma sırası", "Boşluk zinciri", "Yeni oyuncu katılımı", "Ahır kapasitesi (şehir başına)"];

describe("İş piyasası grubu (D6)", () => {
  it("altı_kart_gorunur_ve_baslangicta_duzenlenebilir", () => {
    render(<Host registry={contractRegistry()} />);
    fireEvent.click(grup());
    for (const ad of KARTLAR) expect(screen.getByRole("article", { name: ad })).toBeInTheDocument();
    const kap = within(screen.getByRole("article", { name: "Ahır kapasitesi (şehir başına)" })).getByRole("textbox") as HTMLInputElement;
    expect(kap.disabled).toBe(false);
    expect(kap.value).toBe("300");                                                  // şehir başına toplam: altı ahır x 50
  });

  it("kart_metinleri_olculmus_etkiyi_soyler_olculmeyeni_olculmedi_der", () => {
    render(<Host registry={contractRegistry()} />);
    fireEvent.click(grup());
    const gecis = screen.getByRole("article", { name: "Ahırdaki oyuncunun işe geçişi" }).textContent ?? "";
    expect(gecis).toContain("269 yerine 961");
    expect(gecis).toContain("56 yerine 724");
    const cikar = screen.getByRole("article", { name: "İşten çıkarma sırası" }).textContent ?? "";
    expect(cikar).toContain("269 yerine 414");
    for (const ad of ["İşe alım önceliği", "Boşluk zinciri", "Yeni oyuncu katılımı"]) expect(screen.getByRole("article", { name: ad }).textContent).toContain("ölçülmedi");
  });

  it("canli_kosuda_live_kartlar_acik_ahir_kapasitesi_nedenli_kilitli", () => {
    render(<Host registry={contractRegistry()} mode="live" />);
    fireEvent.click(grup());
    const kap = screen.getByRole("article", { name: "Ahır kapasitesi (şehir başına)" });
    expect(kap.textContent).toContain(t("lock.yeni_kosu"));
    expect(within(kap).getByRole("textbox")).toBeDisabled();
    for (const ad of ["İşe alım önceliği", "Boşluk zinciri"]) {
      const k = screen.getByRole("article", { name: ad });
      expect(k.textContent).not.toContain(t("lock.yeni_kosu"));
    }
  });

  it("paylasim_kodu_yeni_kart_degerlerini_tasir", () => {
    const degerler = { ahir_gecisi: { kural: "gonullu", prim: 30 }, ise_alim_onceligi: "esit", isten_cikarma_sirasi: "son_giren", bosluk_zinciri: true,
      yeni_oyuncu_katilimi: { kural: "sabit", hedef: 0, hiz: 5, en_cok: 600 }, ahir_kapasitesi: 360 };
    const tarif = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: degerler };
    const kod = encodeRecipe(tarif);
    expect(kod.ok).toBe(true);
    if (kod.ok) {
      const geri = decodeRecipe(kod.code);
      expect(geri.ok && geri.recipe.values).toEqual(degerler);
    }
  });

  it("kart_metinlerinde_gizli_ad_ve_karar_numarasi_yok", () => {
    const reg = contractRegistry();
    const kartlar = reg.cards.filter((c) => KARTLAR.includes(c.title));
    expect(kartlar).toHaveLength(6);
    const blob = JSON.stringify(kartlar.map((c) => ({ title: c.title, what: c.what, changes: c.changes, aliases: c.aliases, control: c.control })));
    expect(blob).not.toMatch(/K-\d|PM_ADJ|_CAL\b|BIG_|CAP_AHIR|AHIR_MOVE|HIRE_PRIORITY|FIRE_ORDER|PLAYER_INFLOW|AHIR_BACKFILL|AHIR_TARGET/);
  });
});

describe("Hane geliri ve tüketim grubu (D9, C kartları)", () => {
  const hane = () => within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: /^\d+\. Hane geliri ve tüketim$/ });
  const C_KARTLARI = ["Servete göre harcama", "İşsiz NPC'nin tüketici sayılma eşiği", "İşsiz NPC'lerin birikimine vergi", "İşsiz NPC'ye asgari güvence"];

  it("dort_kart_gorunur_asgari_guvence_kapali_gelir", () => {
    render(<Host registry={contractRegistry()} />);
    fireEvent.click(hane());
    for (const ad of C_KARTLARI) expect(screen.getByRole("article", { name: ad })).toBeInTheDocument();
    const asgari = screen.getByRole("article", { name: "İşsiz NPC'ye asgari güvence" });
    expect(within(asgari).getByRole("button", { name: "kapalı" })).toHaveAttribute("aria-pressed", "true");
  });

  it("asgari_guvence_metni_transferi_notr_soyler_ve_olculmus_etkiyi_verir", () => {
    render(<Host registry={contractRegistry()} />);
    fireEvent.click(hane());
    const m = screen.getByRole("article", { name: "İşsiz NPC'ye asgari güvence" }).textContent ?? "";
    expect(m).toContain("transfer");
    expect(m).toContain("parayı dağıtmanın tek başına sorunu çözmediği");
    expect(m).toContain("269 yerine 641");
    expect(m).toContain("56 yerine 270");
  });

  it("olculmemis_kartlar_etki_iddia_etmez", () => {
    render(<Host registry={contractRegistry()} />);
    fireEvent.click(hane());
    for (const ad of ["Servete göre harcama", "İşsiz NPC'nin tüketici sayılma eşiği", "İşsiz NPC'lerin birikimine vergi"]) {
      expect(screen.getByRole("article", { name: ad }).textContent).toContain("ölçülmedi");
    }
  });

  it("kart_metinlerinde_gizli_ad_ve_karar_numarasi_yok", () => {
    const kartlar = contractRegistry().cards.filter((c) => [...C_KARTLARI, "NPC hanesi ve işgücüne katılım", "Açılış geçişi"].includes(c.title));
    expect(kartlar).toHaveLength(6);
    const blob = JSON.stringify(kartlar.map((c) => ({ title: c.title, what: c.what, changes: c.changes, aliases: c.aliases, control: c.control })));
    expect(blob).not.toMatch(/K-\d|NPC_[A-Z]|OPEN_|HOUSE_|WEALTH_RULE|TR_START|CAPEX_START|BIG_|CAP_/);
  });
});
