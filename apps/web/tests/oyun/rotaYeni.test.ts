import { describe, expect, it } from "vitest";
import { kanonikHash, parseHash, sehirRotasi, toHash } from "@/oyun/hooks/useHashRoute";

describe("yeni rotalar", () => {
  it("canli_sehir_numarasi", () => {
    expect(parseHash("#/canli/abc/3")).toEqual({ name: "canli", runId: "abc", view: "sehir-3" });
    expect(toHash({ name: "canli", runId: "abc", view: "sehir-3" })).toBe("#/canli/abc/3");
    expect(parseHash("#/canli/abc/5")).toEqual({ name: "canli", runId: "abc/5" });
  });
  it("dao_sehir_numarasi", () => {
    expect(parseHash("#/dao/canli-1/4")).toEqual({ name: "dao", runId: "canli-1", sehir: 4 });
    expect(toHash({ name: "dao", runId: "canli-1", sehir: 0 })).toBe("#/dao/canli-1/0");
    expect(parseHash("#/dao/canli-1")).toEqual({ name: "dao", runId: "canli-1" });
    expect(parseHash("#/dao/d/K7M2QXA")).toEqual({ name: "dao", dunya: "K7M2QXA" });
  });
  it("stil", () => {
    expect(parseHash("#/stil")).toEqual({ name: "stil" });
    expect(toHash({ name: "stil" })).toBe("#/stil");
  });
  it("eski_gorunum_rotalari_yeni_yerlerine_yonlenir", () => {
    // Dünya ve Harita görünümleri artık şehir ekranının kendisidir; Zincir Ayrıntılar penceresinin sekmesidir (rota yerinde kalır, ekran pencereyi açar).
    expect(kanonikHash("#/canli/abc/dunya")).toBe("#/canli/abc");
    expect(kanonikHash("#/canli/abc/harita")).toBe("#/canli/abc");
    expect(kanonikHash("#/canli/abc/zincir")).toBeNull();
    expect(kanonikHash("#/dao/abc/dunya")).toBeNull();
  });
  it("sehir_rotasi_her_kurucu_ve_dao_kosu_rotasi", () => {
    expect(sehirRotasi(parseHash("#/canli/abc"))).toBe(true);
    expect(sehirRotasi(parseHash("#/canli/abc/3"))).toBe(true);
    expect(sehirRotasi(parseHash("#/canli/abc/zincir"))).toBe(true);
    expect(sehirRotasi(parseHash("#/sonuc/abc"))).toBe(false);
    expect(sehirRotasi(parseHash("#/kosular"))).toBe(false);
    expect(sehirRotasi(parseHash("#/dao/abc/2"))).toBe(true);
    expect(sehirRotasi(parseHash("#/dao/abc"))).toBe(true); // şehir verilmezse oyuncunun şehri
    expect(sehirRotasi(parseHash("#/dao/d/KOD"))).toBe(false); // paylaşılan dünya sayfa
    expect(sehirRotasi(parseHash("#/dao"))).toBe(false); // giriş ekranı
  });
  it("eski_sehir_bicimi_yeni_yere_yonlenir", () => {
    expect(kanonikHash("#/canli/abc/sehir-2")).toBe("#/canli/abc/2");
    expect(kanonikHash("#/canli/abc/2")).toBeNull();
    expect(kanonikHash("#/canli/abc")).toBeNull();
    expect(kanonikHash("#/kosular")).toBeNull();
  });
});
