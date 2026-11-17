import { describe, expect, it } from "vitest";
import { IZO_STILI } from "@/oyun/harita/haritaStili";
import type { Gecis } from "@/oyun/harita/izoDurum";
import { balonlar, balonlariDiz, unvanDegisimi } from "@/oyun/harita/izoOlay";
import type { DaoGozlem, DaoOlay, DaoUnvan } from "@/oyun/sim/dao";

const hepsi = (): boolean => true;
const g = (id: string, tur: Gecis["tur"], hafta = 10): Gecis => ({ id, tur, hafta });
const gozlem = (unvan: DaoUnvan, hafta = 1): DaoGozlem => ({ hafta, ben: { unvan } } as unknown as DaoGozlem);

describe("balonlar", () => {
  it("kurulus_batis_canlanma_balonu", () => {
    const b = balonlar([g("a", "kuruldu"), g("b", "batti"), g("c", "canlandi"), g("d", "zayifladi")], [], null, hepsi, 9);
    expect(b.map((x) => [x.hedef.binaId, x.metinAnahtari, x.ton])).toEqual([
      ["a", "harita.balon.kuruldu", "iyi"], ["b", "harita.balon.batti", "kotu"], ["c", "harita.balon.canlandi", "iyi"],
    ]);
  });
  it("balon_sayisi_ust_sinirli", () => {
    const hepsiG = Array.from({ length: 10 }, (_, i) => g(`f${i}`, "kuruldu"));
    expect(balonlar(hepsiG, [], null, hepsi)).toHaveLength(IZO_STILI.balon.enCok);
    expect(balonlar(hepsiG, [], null, hepsi, 2)).toHaveLength(2);
  });
  it("ayni_bina_icin_tek_balon_en_yenisi", () => {
    const b = balonlar([g("a", "kuruldu", 8), g("a", "batti", 10)], [], null, hepsi);
    expect(b).toHaveLength(1);
    expect(b[0]!.metinAnahtari).toBe("harita.balon.batti");
  });
  it("oyuncunun_olayi_oncelikli", () => {
    const olay: DaoOlay[] = [{ tur: "ise_girdi", hafta: 9, firma: "ben" }];
    const b = balonlar([g("x1", "kuruldu"), g("x2", "kuruldu"), g("x3", "kuruldu")], olay, null, hepsi, 3);
    expect(b[0]!.hedef.binaId).toBe("ben");
    expect(b[0]!.omur).toBeGreaterThan(b[1]!.omur);
    expect(b[0]!.omur).toBe(IZO_STILI.balon.benOmurMs);
  });
  it("gorunmeyen_sehirdeki_bina_balon_almaz", () => {
    expect(balonlar([g("uzak", "batti"), g("yakin", "batti")], [], null, (id) => id === "yakin")).toHaveLength(1);
  });
  it("binasiz_genel_olay_balon_olmaz", () => {
    const olay: DaoOlay[] = [{ tur: "genel", hafta: 10, kaynak: "x" }, { tur: "ayrildi", hafta: 10 }, { tur: "goc_etti", hafta: 10, sehir: 1 }];
    expect(balonlar([], olay, null, hepsi)).toEqual([]);
  });
  it("ayni_olay_iki_kez_balon_uretmez", () => {
    const olay: DaoOlay[] = [{ tur: "kuruldu", hafta: 10, firma: "a", sektor: "market" }];
    const b = balonlar([g("a", "kuruldu", 10)], olay, null, hepsi);
    expect(b).toHaveLength(1);
    expect(balonlar([g("a", "kuruldu", 10)], olay, null, hepsi).map((x) => x.id)).toEqual(b.map((x) => x.id));
  });
  it("terfi_balonu_unvan_degisiminden", () => {
    const b = balonlar([], [], { eski: "cirak", yeni: "kalfa" }, hepsi, 3, "isyeri");
    expect(b).toHaveLength(1);
    expect(b[0]!.hedef.binaId).toBe("isyeri");
    expect(b[0]!.metinAnahtari).toBe("harita.balon.terfi");
    expect(b[0]!.params).toEqual({ unvan: "Kalfa" });
    expect(balonlar([], [], { eski: "kalfa", yeni: "cirak" }, hepsi, 3, "isyeri")).toEqual([]);
    expect(balonlar([], [], { eski: "cirak", yeni: "kalfa" }, (id) => id !== "isyeri", 3, "isyeri")).toEqual([]);
  });
  it("hizli_oynatmada_balon_sagagani_kirpilir", () => {
    const cok = Array.from({ length: 40 }, (_, i) => g(`f${i}`, i % 2 ? "batti" : "kuruldu", 10 + (i % 5)));
    const b = balonlar(cok, [], null, hepsi);
    expect(b).toHaveLength(IZO_STILI.balon.enCok);
    expect(new Set(b.map((x) => x.hedef.binaId)).size).toBe(b.length);
  });
  it("terfi_kimligi_gozlem_haftasina_baglidir_ayni_unvana_yeniden_yukselis_yeni_balon", () => {
    const u = { eski: "cirak", yeni: "kalfa" } as const;
    const a = balonlar([], [], u, hepsi, 3, "isyeri", 5);
    const b = balonlar([], [], u, hepsi, 3, "isyeri", 9);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });
  it("ayni_hafta_yeni_dao_olayi_yeni_balon_uretir", () => {
    const once = balonlar([g("a", "kuruldu", 10)], [], null, hepsi);
    const sonra = balonlar([g("a", "kuruldu", 10)], [{ tur: "ise_girdi", hafta: 10, firma: "b" }], null, hepsi);
    const yeni = sonra.filter((x) => !once.some((o) => o.id === x.id));
    expect(yeni.map((x) => x.hedef.binaId)).toEqual(["b"]);
  });
  it("kumulatif_eski_dao_olaylari_balon_olmaz", () => {
    const olay: DaoOlay[] = [{ tur: "kuruldu", hafta: 2, firma: "eski", sektor: "market" }];
    expect(balonlar([g("a", "kuruldu", 30)], olay, null, hepsi).map((x) => x.hedef.binaId)).toEqual(["a"]);
  });
});

describe("unvanDegisimi", () => {
  it("unvanDegisimi_ardisik_gozlemden", () => {
    expect(unvanDegisimi(gozlem("cirak"), gozlem("kalfa"))).toEqual({ eski: "cirak", yeni: "kalfa" });
    expect(unvanDegisimi(null, gozlem("kalfa"))).toBeNull();
  });
  it("unvan_ayni_ise_null", () => {
    expect(unvanDegisimi(gozlem("kalfa"), gozlem("kalfa", 2))).toBeNull();
  });
});

describe("balonlariDiz", () => {
  it("cakisan_balonlar_ust_uste_binmez", () => {
    const y = balonlariDiz([{ x: 0, y: 100, w: 60, h: 20 }, { x: 10, y: 105, w: 60, h: 20 }, { x: 300, y: 100, w: 60, h: 20 }], 4);
    expect(y[0]).toBe(100);
    expect(y[1]!).toBeLessThanOrEqual(100 - 20 - 4);
    expect(y[2]).toBe(100);
  });
});
