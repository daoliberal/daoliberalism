import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { HaritaTablosu } from "@/oyun/harita/HaritaTablosu";
import { parselTuruOf, type IzoSahne } from "@/oyun/harita/izoSahne";
import { adlandirici } from "@/oyun/harita/adlar";
import { daoBaglamBasligi } from "@/oyun/screens/dao/DaoBaglam";
import type { SahneBina, SehirSahnesi } from "@/oyun/harita/tipler";

const bina = (id: string, tur: SahneBina["tur"]): SahneBina => ({
  id, tur, sehir: 0, x: 0, y: 0, boyut: 1, ref: { kind: tur === "ahir" ? "sector" : "city", ref: id }, etiket: id, parsel: null, sablon: tur === "sehir" ? "sehir" : "ahir", taban: { g: 1, d: 1 },
});
const parsel = (id: string) => ({ id, x: 0, y: 0, genislik: 1, yukseklik: 1, kademe: 0 });
const klasik = (ek: Partial<SehirSahnesi> = {}): SehirSahnesi => ({
  susler: [], sehir: 0, ad: "Ada", genislik: 1, yukseklik: 1, sokaklar: [], parseller: [], binalar: [], meydan: { x: 0, y: 0, yaricap: 1 },
  sehirBinasi: bina("sehir-0", "sehir"), ahir: bina("ahir", "ahir"), ben: null, katman: { tur: "yok", tonlar: new Map(), lejant: [], rozetler: [] }, veriYok: false, ...ek,
});
const izoOf = (dolgu: { parselId: string; tur: "konut" | "park" | "arsa" }[]): IzoSahne => ({ kaynak: klasik(), dolgu } as unknown as IzoSahne);
afterEach(cleanup);

describe("parsel turu (konut/park/arsa kur hedefi)", () => {
  it("parselTuruOf_klasikte_bos_izoda_dolgu_turu", () => {
    expect(parselTuruOf(klasik(), "p0_0")).toBe("bos");
    const iz = izoOf([{ parselId: "p0_0", tur: "konut" }, { parselId: "p0_2", tur: "arsa" }]);
    expect(parselTuruOf(iz, "p0_0")).toBe("konut");
    expect(parselTuruOf(iz, "p0_2")).toBe("arsa");
    expect(parselTuruOf(iz, "p9_9")).toBe("bos");
  });
  it("tablo_dolgu_turune_gore_satir_yazar_bos_parsel_yalniz_gercekten_bos", () => {
    const onSec = vi.fn();
    const turu = (id: string) => (id === "p0_1" ? "konut" : id === "p0_2" ? "park" : id === "p0_3" ? "arsa" : "bos") as "bos" | "konut" | "park" | "arsa";
    render(<HaritaTablosu sahne={klasik()} secili={null} onSec={onSec} bosParseller={[parsel("p0_1"), parsel("p0_2"), parsel("p0_3"), parsel("p0_4")]} parselTuru={turu} />);
    for (const ad of ["Konut (1 adet, işletme kurulabilir)", "Park (1 adet, işletme kurulabilir)", "Boş arsa (1 adet, işletme kurulabilir)", "Boş parsel (1 adet)"]) expect(screen.getByRole("button", { name: ad })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Konut (1 adet, işletme kurulabilir)" }));
    expect(onSec).toHaveBeenCalledWith({ kind: "parsel", ref: "p0_1" });
  });
  it("tablo_turu_verilmezse_eski_metin", () => {
    render(<HaritaTablosu sahne={klasik()} secili={null} onSec={() => {}} bosParseller={[parsel("p0_1")]} />);
    expect(screen.getByRole("button", { name: "Boş parsel (1 adet)" })).toBeInTheDocument();
  });
  it("panel_basligi_ve_notu_turu_soyler", () => {
    const secim = { ref: { kind: "parsel" as const, ref: "p0_1" }, hafta: 1, sehir: 0 };
    const a = adlandirici();
    expect(daoBaglamBasligi(secim, klasik(), a)).toBe("Boş parsel");
    expect(daoBaglamBasligi(secim, klasik(), a, "konut")).toBe("Konut (işletme kurulabilir)");
    expect(daoBaglamBasligi(secim, klasik(), a, "park")).toBe("Park (işletme kurulabilir)");
    expect(daoBaglamBasligi(secim, klasik(), a, "arsa")).toBe("Boş arsa (işletme kurulabilir)");
    expect(t("dao.parsel.not_konut")).toMatch(/Konut/);
  });
});
