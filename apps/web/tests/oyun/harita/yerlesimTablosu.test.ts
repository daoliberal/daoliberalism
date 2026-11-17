import { describe, expect, it } from "vitest";
import { tabloOku, tabloYaz, yerlesimIlerlet, type YerlesimFirma } from "@/oyun/harita/yerlesimTablosu";

const yuvalar = Array.from({ length: 40 }, (_, i) => ({ id: `p${Math.floor(i / 8)}_${i % 8}`, oncelik: Math.floor(i / 8) }));
const f = (id: string, kapali = false): YerlesimFirma => ({ id, kapali });
const rnd = (tohum: number) => () => ((tohum = (tohum * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe("yerlesimIlerlet", () => {
  it("ilk_acilis_yuvaAta_ile_tohumlanir_ve_deterministik", () => {
    const a = yerlesimIlerlet(null, [f("a"), f("b"), f("c")], yuvalar, "t");
    expect(yerlesimIlerlet(null, [f("c"), f("b"), f("a")], yuvalar, "t")).toEqual(a);
    expect(new Set(a.values()).size).toBe(3);
  });

  it("rastgele_dogum_olumde_hicbir_canli_firma_parsel_degistirmez", () => {
    const r = rnd(7);
    let canli = new Set(Array.from({ length: 12 }, (_, i) => `f${i}`));
    let tablo: ReadonlyMap<string, string> | null = null;
    let sayac = 100;
    for (let hafta = 0; hafta < 200; hafta++) {
      const once = tablo;
      for (const id of [...canli]) if (r() < 0.08) canli.delete(id);
      while (r() < 0.5 && canli.size < 30) canli.add(`f${sayac++}`);
      canli = new Set(canli);
      tablo = yerlesimIlerlet(tablo, [...canli].map((id) => f(id)), yuvalar, "t");
      expect(new Set(tablo.values()).size).toBe(canli.size);
      if (once) for (const id of canli) if (once.has(id)) expect(tablo.get(id)).toBe(once.get(id));
    }
  });

  it("dusen_firmanin_parseli_bosalir_ve_yenisi_alabilir_kimse_tasinmaz", () => {
    const t0 = yerlesimIlerlet(null, [f("a"), f("b"), f("c")], yuvalar, "t");
    const t1 = yerlesimIlerlet(t0, [f("a"), f("c")], yuvalar, "t");
    expect(t1.has("b")).toBe(false);
    expect(t1.get("a")).toBe(t0.get("a"));
    expect(t1.get("c")).toBe(t0.get("c"));
  });

  it("kapali_firma_listedeyken_parselini_tutar", () => {
    const t0 = yerlesimIlerlet(null, [f("a"), f("b")], yuvalar, "t");
    const t1 = yerlesimIlerlet(t0, [f("a"), f("b", true), f("n")], yuvalar, "t");
    expect(t1.get("b")).toBe(t0.get("b"));
    expect(t1.get("n")).not.toBe(t0.get("b"));
  });

  it("ayni_girdiyle_tekrar_idempotent", () => {
    const t0 = yerlesimIlerlet(null, [f("a"), f("b")], yuvalar, "t");
    const firmalar = [f("a"), f("b"), f("n")];
    const t1 = yerlesimIlerlet(t0, firmalar, yuvalar, "t");
    expect(yerlesimIlerlet(t1, firmalar, yuvalar, "t")).toEqual(t1);
  });

  it("yuva_kumesi_buyuyunce_eski_atamalar_ayni", () => {
    const kucuk = yuvalar.slice(0, 16);
    const t0 = yerlesimIlerlet(null, Array.from({ length: 10 }, (_, i) => f(`f${i}`)), kucuk, "t");
    const t1 = yerlesimIlerlet(t0, Array.from({ length: 20 }, (_, i) => f(`f${i}`)), yuvalar, "t");
    for (const [k, v] of t0) expect(t1.get(k)).toBe(v);
  });

  it("gecersiz_yuva_yeniden_atanir", () => {
    const t0 = new Map([["a", "p9_9"]]);
    const t1 = yerlesimIlerlet(t0, [f("a")], yuvalar, "t");
    expect(yuvalar.some((y) => y.id === t1.get("a"))).toBe(true);
  });

  it("sabitlenen_yeni_firma_secilen_parsele", () => {
    const t = yerlesimIlerlet(null, [f("a"), f("oyuncu")], yuvalar, "t", new Map([["oyuncu", "p3_5"]]));
    expect(t.get("oyuncu")).toBe("p3_5");
  });

  it("sabit_parsel_doluysa_en_yakin_bosa", () => {
    const t0 = new Map([["a", "p3_5"]]);
    const t = yerlesimIlerlet(t0, [f("a"), f("oyuncu")], yuvalar, "t", new Map([["oyuncu", "p3_5"]]));
    expect(t.get("a")).toBe("p3_5");
    expect(["p3_4", "p3_6", "p2_5", "p4_5"]).toContain(t.get("oyuncu"));
  });

  it("gec_gelen_sabitleme_bosalan_parsele_bir_kez_tasir_sonra_sabit", () => {
    const t0 = yerlesimIlerlet(null, [f("a"), f("oyuncu")], yuvalar, "t");
    const hedef = "p4_7";
    const t1 = yerlesimIlerlet(t0, [f("a"), f("oyuncu")], yuvalar, "t", new Map([["oyuncu", hedef]]));
    expect(t1.get("oyuncu")).toBe(hedef);
    expect(yerlesimIlerlet(t1, [f("a"), f("oyuncu")], yuvalar, "t", new Map([["oyuncu", hedef]]))).toEqual(t1);
  });
});

describe("tablo saklama", () => {
  it("yaz_oku_gidis_donus_ve_bozuk_veri_guvenli", () => {
    const m = new Map([["a", "p0_0"], ["b", "p1_1"]]);
    tabloYaz("k1", m);
    expect(tabloOku("k1")).toEqual(m);
    localStorage.setItem("daoliberal.yerlesim.k2", "{bozuk");
    expect(tabloOku("k2")).toBeNull();
    localStorage.setItem("daoliberal.yerlesim.k3", JSON.stringify({ a: 5, b: "p1_1" }));
    expect(tabloOku("k3")).toEqual(new Map([["b", "p1_1"]]));
    expect(tabloOku("yok")).toBeNull();
  });
});
