import { describe, expect, it } from "vitest";
import { BOYLAR, katalogKaydi, SABLONLAR, sablonOf, VARSAYILAN_KATALOG } from "@/oyun/harita/binaKatalogu";
import { SEHIR_STILI } from "@/oyun/harita/haritaStili";

describe("binaKatalogu", () => {
  it("test_her_sablon_boy_kaydi_ve_ayak_izi_var", () => {
    expect(SABLONLAR).toHaveLength(7);
    expect(BOYLAR).toHaveLength(4);
    for (const s of SABLONLAR) {
      for (const b of BOYLAR) {
        const k = katalogKaydi(s, b);
        expect(k.dosya, `${s}-${b}`).toMatch(/\.(svg|png|webp)$/);
        expect(["svg-katmanli", "resim"]).toContain(k.tur);
        expect(k.taban.g).toBeGreaterThan(0);
        expect(k.taban.d).toBeGreaterThan(0);
        expect(k.capa.x).toBeGreaterThanOrEqual(0);
        expect(k.capa.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it("test_isletme_ayak_izi_parsele_sigar_ve_boyla_buyur", () => {
    for (const s of ["hammadde", "imalat", "hizmet", "lojistik"] as const) {
      for (const b of BOYLAR) {
        expect(katalogKaydi(s, b).taban.g).toBeLessThan(SEHIR_STILI.parsel.genislik);
        expect(katalogKaydi(s, b).taban.d).toBeLessThan(SEHIR_STILI.parsel.yukseklik);
        if (b > 1) expect(katalogKaydi(s, b).taban.g).toBeGreaterThan(katalogKaydi(s, (b - 1) as 1 | 2 | 3).taban.g);
      }
    }
  });

  it("test_resimle_degistirme_kodu_degistirmez", () => {
    const ozel = { ...VARSAYILAN_KATALOG, hizmet: { ...VARSAYILAN_KATALOG.hizmet, 2: { ...VARSAYILAN_KATALOG.hizmet[2], dosya: "bina/ozel.png", tur: "resim" as const } } };
    expect(katalogKaydi("hizmet", 2, ozel).tur).toBe("resim");
    expect(katalogKaydi("hizmet", 3, ozel)).toEqual(VARSAYILAN_KATALOG.hizmet[3]);
  });

  it("sablonOf", () => {
    expect(sablonOf("isletme", "imalat")).toBe("imalat");
    expect(sablonOf("isletme", undefined)).toBe("hizmet");
    expect(sablonOf("lonca", undefined)).toBe("lonca");
  });
});
