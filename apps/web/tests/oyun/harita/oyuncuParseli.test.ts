import { describe, expect, it } from "vitest";
import { bosDepo, type OyuncuParselDeposu, depoOku, depoYaz, isletmeBagla, sabitlemeler } from "@/oyun/harita/oyuncuParseli";

describe("oyuncuParseli", () => {
  it("bekleyen_kur_kuruldu_firmasina_baglanir_yalniz_kendi_modunda", () => {
    let d: OyuncuParselDeposu = { ...bosDepo(), bekleyen: { parsel: "p2_3", mod: "izo" as const, sektor: "market" } };
    d = isletmeBagla(d, ["f9"]);
    expect(sabitlemeler(d, "izo").get("f9")).toBe("p2_3");
    expect(sabitlemeler(d, "klasik").size).toBe(0);
    expect(d.bekleyen).toBeNull();
  });
  it("bekleyen_yokken_gorulen_firma_islenir_sonraki_kur_eskiye_baglanmaz", () => {
    let d = isletmeBagla(bosDepo(), ["eski"]);
    d = { ...d, bekleyen: { parsel: "p1_1", mod: "klasik", sektor: "un" } };
    d = isletmeBagla(d, ["eski"]);
    expect(sabitlemeler(d, "klasik").size).toBe(0);
    expect(d.bekleyen).not.toBeNull();
    d = isletmeBagla(d, ["eski", "yeni"]);
    expect(sabitlemeler(d, "klasik").get("yeni")).toBe("p1_1");
  });
  it("saklama_gidis_donus_ve_bozuk_guvenli", () => {
    const d = isletmeBagla({ ...bosDepo(), bekleyen: { parsel: "p0_1", mod: "izo", sektor: "x" } }, ["a"]);
    depoYaz("r1", d);
    expect(depoOku("r1")).toEqual(d);
    localStorage.setItem("daoliberal.oyuncuparsel.r2", "{kotu");
    expect(depoOku("r2")).toEqual(bosDepo());
    localStorage.setItem("daoliberal.oyuncuparsel.r3", JSON.stringify({ izo: 5, islenen: "x" }));
    expect(depoOku("r3")).toEqual(bosDepo());
  });
});
