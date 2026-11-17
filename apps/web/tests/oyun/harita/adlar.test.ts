import { describe, expect, it } from "vitest";
import { adlandirici } from "@/oyun/harita/adlar";
import type { Bina } from "@/oyun/harita/tipler";

const lonca = (etiket: string): Bina => ({ id: etiket, tur: "lonca", sehir: null, x: 0, y: 0, boyut: 1, ref: { kind: "lonca", ref: etiket }, etiket });

describe("harita adlandırıcı", () => {
  it("lonca_kimligi_tablodaki_adla_ayni_cift_ad_yok", () => {
    const a = adlandirici();
    expect(a.bina(lonca("lonca0"))).toBe("Lonca 1");
    expect(a.bina(lonca("lonca1"))).toBe("Lonca 2");
    expect(a.bina(lonca("lonca1"))).not.toMatch(/lonca\d/);
    expect(a.bina(lonca("L1"))).toBe("Lonca L1"); // numarasız ad: olduğu gibi
  });

  it("sehir_kurumlari_okunur_ad_alir", () => {
    const kurum = (tur: "liman" | "ihracat"): Bina => ({ id: tur, tur, sehir: 0, x: 0, y: 0, boyut: 1, ref: { kind: "kurum", ref: tur }, etiket: tur });
    const a = adlandirici();
    expect(a.bina(kurum("liman"))).toBe("Liman (ithalat)");
    expect(a.bina(kurum("ihracat"))).toBe("İhracat");
  });
});
