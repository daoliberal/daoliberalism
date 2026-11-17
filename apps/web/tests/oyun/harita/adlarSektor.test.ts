import { describe, expect, it } from "vitest";
import { adlandirici } from "@/oyun/harita/adlar";
import type { Bina } from "@/oyun/harita/tipler";

const isletme = (etiket: string): Bina => ({ tur: "isletme", etiket } as unknown as Bina);

describe("adlandirici sektör adı", () => {
  it("etiketi_olmayan_ham_sektor_kimligi_okunur_ada_cevrilir_tek_kaynaktan", () => {
    const a = adlandirici();
    expect(a.bina(isletme("market"))).toBe("Market");
    expect(a.bina(isletme("universite"))).toBe("Üniversite");
    expect(a.bina(isletme("yeni_sektor"))).toBe("Yeni sektor");
  });
});
