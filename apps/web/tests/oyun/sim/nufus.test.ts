import { describe, expect, it } from "vitest";
import { akceMetni, nufusHesabi, tahminiSaniye } from "@/oyun/sim/nufus";
import { contractRegistry } from "../helpers/registryFixtures";

describe("nüfus hesabı (D4)", () => {
  it("varsayılan: 1.500 oyuncu, 5.100 NPC, toplam 6.600", () => {
    expect(nufusHesabi(contractRegistry(), {})).toEqual({ sehirBasinaOyuncu: 300, oyuncu: 1500, npc: 5100, toplam: 6600, kasa: 0 });
  });
  it("taslak değerleri: 800 oyuncu, taban 900, oyuncu başına 2,5, kasa 500.000", () => {
    const n = nufusHesabi(contractRegistry(), { sehir_basina_oyuncu: 800, npc_nufusu: { taban: 900, oyuncu_basina: 2.5 }, baslangic_sehir_kasasi: 500000 });
    expect(n).toEqual({ sehirBasinaOyuncu: 800, oyuncu: 4000, npc: 10900, toplam: 14900, kasa: 500000 });
  });
  it("kartlar kayıtta yoksa null (eski kayıt)", () => {
    const reg = contractRegistry();
    expect(nufusHesabi({ ...reg, cards: reg.cards.filter((c) => c.id !== "npc_nufusu") }, {})).toBeNull();
  });
  it("hız tahmini: varsayılan oyuncu sayısında ölçümün kendisi, daha çok oyuncuda daha yavaş, ölçüm yoksa null", () => {
    expect(tahminiSaniye(0.5, 1500)).toBeCloseTo(0.5, 6);
    expect(tahminiSaniye(0.5, 4000)!).toBeGreaterThan(1.0);
    expect(tahminiSaniye(0.5, 4000)!).toBeLessThan(1.3);
    expect(tahminiSaniye(null, 4000)).toBeNull();
    expect(tahminiSaniye(0.5, 0)).toBeNull();
  });
  it("Akçe metni kayıt biriminden", () => {
    expect(akceMetni(contractRegistry(), 500000)).toBe("500.000 Akçe");
  });
});
