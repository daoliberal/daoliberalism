import { describe, expect, it } from "vitest";
import { halkaYuvalari, izgaraSec, sokakAgi, yuvaAta } from "@/oyun/harita/sokakAgi";

const idler = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${i}`);

describe("sokakAgi", () => {
  it("test_onbellek_isabeti_ayni_nesne", () => {
    expect(sokakAgi(1, 92)).toBe(sokakAgi(1, 92));
    expect(sokakAgi(1, 92)).not.toBe(sokakAgi(1, 120));
    const yuvalar = sokakAgi(0, 92).parseller.map((p) => ({ id: p.id, oncelik: p.kademe }));
    expect(yuvaAta(idler(5), yuvalar, "t")).toBe(yuvaAta(idler(5).reverse(), yuvalar, "t"));
    expect(yuvaAta(idler(5), yuvalar, "t")).not.toBe(yuvaAta(idler(5), yuvalar, "u"));
  });

  it("test_parsel_kimligi_kademeler_arasi_geometrik_kararli", () => {
    const k0 = sokakAgi(0, 92).parseller;
    const k1 = new Map(sokakAgi(1, 92).parseller.map((p) => [p.id, p]));
    for (const p of k0) expect(k1.has(p.id), p.id).toBe(true);
    expect(k1.size).toBeGreaterThan(k0.length);
  });

  it("test_ayni_kimlikler_izgara_buyuyunce_yerinde_kalir", () => {
    const yuva = (k: number) => sokakAgi(k, 92).parseller.map((p) => ({ id: p.id, oncelik: p.kademe }));
    const a = yuvaAta(idler(15), yuva(0), "t");
    const b = yuvaAta(idler(15), yuva(1), "t");
    const kalan = idler(15).filter((id) => a.get(id) === b.get(id)).length;
    expect(kalan / 15).toBeGreaterThanOrEqual(0.8);
    const c = yuvaAta(idler(15), yuva(3), "t");
    expect(idler(15).filter((id) => a.get(id) === c.get(id)).length / 15).toBeGreaterThanOrEqual(0.8);
  });

  it("test_izgara_sec_ve_halka_buyumesi", () => {
    expect(izgaraSec(200, 92).parseller.length).toBeGreaterThanOrEqual(200);
    expect(halkaYuvalari(40).yaricap).toBeGreaterThan(halkaYuvalari(3).yaricap);
    expect(halkaYuvalari(40).yuvalar.length).toBeGreaterThanOrEqual(40);
  });

  it("test_yuva_yetmezse_hata", () => {
    expect(() => yuvaAta(idler(3), [{ id: "a", oncelik: 0 }], "t")).toThrow();
  });
});
