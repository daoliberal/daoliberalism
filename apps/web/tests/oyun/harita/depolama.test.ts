import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { depoOku, depoYaz, bosDepo } from "@/oyun/harita/oyuncuParseli";
import { KOSU_SINIRI, tabloOku, tabloYaz } from "@/oyun/harita/yerlesimTablosu";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
const anahtarlar = (onek: string): string[] => Object.keys(localStorage).filter((k) => k.startsWith(onek));

describe("localStorage budama", () => {
  it("en_cok_KOSU_SINIRI_kosu_tutulur_en_eskisi_silinir", () => {
    let t = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 10));
    for (let i = 0; i < KOSU_SINIRI + 6; i++) {
      tabloYaz(`kosu${i}.izo.0`, new Map([["f", "p0_0"]]), `kosu${i}`);
      tabloYaz(`kosu${i}.klasik.0`, new Map([["f", "p0_0"]]), `kosu${i}`);
      depoYaz(`kosu${i}`, bosDepo());
    }
    const kosular = new Set(anahtarlar("daoliberal.yerlesim.").map((k) => k.split(".")[2]));
    expect(kosular.size).toBe(KOSU_SINIRI);
    expect(kosular.has("kosu0")).toBe(false);
    expect(kosular.has(`kosu${KOSU_SINIRI + 5}`)).toBe(true);
    expect(anahtarlar("daoliberal.oyuncuparsel.").length).toBe(KOSU_SINIRI);
    expect(tabloOku(`kosu${KOSU_SINIRI + 5}.izo.0`)).not.toBeNull();
  });
  it("kota_hatasinda_budar_bir_daha_dener", () => {
    let t = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => (t += 10));
    for (let i = 0; i < 10; i++) tabloYaz(`k${i}.izo.0`, new Map([["f", "p0_0"]]), `k${i}`);
    const gercek = Storage.prototype.setItem;
    let ilk = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (ilk && k.startsWith("daoliberal.yerlesim.yeni")) { ilk = false; throw new DOMException("dolu", "QuotaExceededError"); }
      gercek.call(this, k, v);
    });
    tabloYaz("yeni.izo.0", new Map([["f", "p1_1"]]), "yeni");
    expect(tabloOku("yeni.izo.0")).toEqual(new Map([["f", "p1_1"]]));
    expect(anahtarlar("daoliberal.yerlesim.").length).toBeLessThan(11);
  });
  it("yine_basarisizsa_tek_uyari_sessiz_yutma_yok", () => {
    const uyari = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("dolu", "QuotaExceededError"); });
    tabloYaz("x.izo.0", new Map([["f", "p0_0"]]), "x");
    tabloYaz("x.izo.1", new Map([["f", "p0_0"]]), "x");
    depoYaz("x", bosDepo());
    expect(uyari).toHaveBeenCalledTimes(1);
    expect(depoOku("x")).toEqual(bosDepo());
  });
});
