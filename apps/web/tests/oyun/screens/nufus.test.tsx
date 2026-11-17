import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { SartEditoru } from "@/oyun/screens/sart/SartEditoru";
import { sartTabani } from "@/oyun/screens/sart/sartMantik";
import { HizBilgisiProvider } from "@/oyun/sim/hizBilgisi";
import type { Registry, ValuesPatch } from "@/oyun/sim/types";
import { encodeRecipe, decodeRecipe } from "@/oyun/sim/recipe";
import { contractRegistry } from "../helpers/registryFixtures";

afterEach(() => cleanup());

function Host({ registry, mode = "builder", hiz = 0.5 }: { registry: Registry; mode?: "builder" | "live"; hiz?: number | null }) {
  const base = sartTabani(registry, {});
  const [patch, setPatch] = useState<ValuesPatch>({});
  return (
    <HizBilgisiProvider secPerWeekP50={hiz}>
      <SartEditoru mode={mode} registry={registry} base={base} draft={{ ...base, ...patch }} context={{ durationWeeks: 200 }} onDraft={(n) => setPatch(n)} />
    </HizBilgisiProvider>
  );
}

const dunyaGrubu = () => within(screen.getByRole("navigation", { name: t("sart.gruplar") })).getByRole("button", { name: /^\d+\. Dünya$/ });

describe("Dünya grubu: nüfus ve başlangıç kasası (D4)", () => {
  it("üç kart görünür, başlangıçta düzenlenebilir ve toplamlar canlı hesaplanır", () => {
    render(<Host registry={contractRegistry()} />);
    fireEvent.click(dunyaGrubu());
    expect(screen.getByRole("article", { name: "Şehir başına oyuncu" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "NPC nüfusu" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Başlangıç şehir kasası" })).toBeInTheDocument();
    expect(screen.getAllByText("Toplam oyuncu 1.500, toplam NPC 5.100, toplam nüfus 6.600.").length).toBeGreaterThan(0);
    expect(screen.getByText(/Toplam nüfus 6\.600 kişi: 1\.500 oyuncu ve 5\.100 NPC\./)).toBeInTheDocument();
    const oyuncu = within(screen.getByRole("article", { name: "Şehir başına oyuncu" })).getByRole("textbox");
    expect(oyuncu).not.toBeDisabled();
    fireEvent.change(oyuncu, { target: { value: "800" } });
    fireEvent.blur(oyuncu);
    expect(screen.getAllByText("Toplam oyuncu 4.000, toplam NPC 12.600, toplam nüfus 16.600.").length).toBeGreaterThan(0);
  });

  it("tahmini hız açıkça tahmin diye etiketlenir ve nüfusla artar; ölçüm yoksa ayrı metin", () => {
    render(<Host registry={contractRegistry()} hiz={0.5} />);
    fireEvent.click(dunyaGrubu());
    expect(screen.getByText(/Tahmini hız: haftada yaklaşık 0,5 sn\..*Bu bir tahmindir\./)).toBeInTheDocument();
    cleanup();
    render(<Host registry={contractRegistry()} hiz={null} />);
    fireEvent.click(dunyaGrubu());
    expect(screen.getByText(t("sart.nufus.hiz_yok"))).toBeInTheDocument();
  });

  it("koşu ortasında üç kart nedenli kilitli (yeni koşu gerekir)", () => {
    render(<Host registry={contractRegistry()} mode="live" />);
    fireEvent.click(dunyaGrubu());
    for (const ad of ["Şehir başına oyuncu", "NPC nüfusu", "Başlangıç şehir kasası"]) {
      const k = screen.getByRole("article", { name: ad });
      expect(k.textContent).toContain(t("lock.yeni_kosu"));
      expect(within(k).queryAllByRole("textbox").every((x) => (x as HTMLInputElement).disabled)).toBe(true);
    }
  });

  it("paylaşım kodu yeni kart değerlerini taşır", () => {
    const degerler = { sehir_basina_oyuncu: 800, npc_nufusu: { taban: 900, oyuncu_basina: 2.5 }, baslangic_sehir_kasasi: 500000 };
    const tarif = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: degerler };
    const kod = encodeRecipe(tarif);
    expect(kod.ok).toBe(true);
    if (kod.ok) {
      const geri = decodeRecipe(kod.code);
      expect(geri.ok && geri.recipe.values).toEqual(degerler);
    }
  });
});
