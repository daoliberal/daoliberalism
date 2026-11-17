import { describe, expect, it } from "vitest";
import { boyOf } from "../../../src/oyun/harita/haritaStili";
import { boyGecisi, boyIlerlet, type BoyHaritasi } from "../../../src/oyun/harita/izoBoy";

const f = (calisan: number, id = "a") => [{ id, calisan }];
function seri(calisanlar: number[], bas = 1, id = "a"): BoyHaritasi {
  let h: BoyHaritasi = new Map();
  calisanlar.forEach((c, i) => { h = boyIlerlet(h, f(c, id), bas + i); });
  return h;
}

describe("izoBoy", () => {
  it("ilk_gorulmede_ham_boy", () => {
    const h = boyIlerlet(new Map(), [{ id: "a", calisan: 25 }, { id: "b", calisan: 3 }], 10);
    expect(h.get("a")).toMatchObject({ gorsel: 3, aday: null, say: 0, son: null });
    expect(h.get("b")?.gorsel).toBe(1);
  });
  it("ham_boy_esik_hafta_surunce_degisir", () => {
    let h = seri([5]);
    h = boyIlerlet(h, f(10), 2);
    h = boyIlerlet(h, f(10), 3);
    expect(h.get("a")?.gorsel).toBe(1);
    expect(h.get("a")?.say).toBe(2);
    h = boyIlerlet(h, f(10), 4);
    expect(h.get("a")).toMatchObject({ gorsel: 2, aday: null, say: 0, son: { eski: 1, yeni: 2, hafta: 4 } });
  });
  it("titreme_histerezisle_yutulur", () => {
    const h = seri([7, 8, 7, 8, 7, 8, 7, 8]);
    expect(h.get("a")?.gorsel).toBe(1);
    expect(h.get("a")?.son).toBeNull();
  });
  it("donunce_sayac_sifirlanir", () => {
    let h = seri([5, 10, 10]);
    expect(h.get("a")?.say).toBe(2);
    h = boyIlerlet(h, f(5), 4);
    expect(h.get("a")).toMatchObject({ gorsel: 1, aday: null, say: 0 });
    h = boyIlerlet(h, f(10), 5);
    h = boyIlerlet(h, f(10), 6);
    expect(h.get("a")?.gorsel).toBe(1);
  });
  it("aday_degisince_sayac_yeniden_baslar", () => {
    let h = seri([5, 10, 10]);
    h = boyIlerlet(h, f(25), 4);
    expect(h.get("a")).toMatchObject({ gorsel: 1, aday: 3, say: 1 });
  });
  it("atlanan_haftalar_hafta_farki_kadar_sayar", () => {
    let h = seri([5]);
    h = boyIlerlet(h, f(10), 3); // hafta 2 atlandi: iki hafta
    expect(h.get("a")).toMatchObject({ gorsel: 1, aday: 2, say: 2 });
    h = boyIlerlet(h, f(10), 4);
    expect(h.get("a")?.gorsel).toBe(2);
    const g = boyIlerlet(seri([5]), f(10), 5); // uc hafta farki
    expect(g.get("a")).toMatchObject({ gorsel: 2, son: { eski: 1, yeni: 2, hafta: 5 } });
  });
  it("ayni_hafta_tekrar_cagrilirsa_degismez", () => {
    const h = seri([5, 10]);
    expect(boyIlerlet(h, f(10), 2).get("a")).toEqual(h.get("a"));
  });
  it("kimlik_dusunce_durum_silinir", () => {
    const h = boyIlerlet(seri([5], 1, "a"), f(5, "b"), 2);
    expect(h.has("a")).toBe(false);
    expect(h.has("b")).toBe(true);
  });
  it("boyGecisi_buyudu_kuculdu_yalniz_o_hafta", () => {
    let h = seri([5, 10, 10, 10]);
    expect(boyGecisi(h.get("a")!, 4)).toBe("buyudu");
    expect(boyGecisi(h.get("a")!, 5)).toBeNull();
    h = boyIlerlet(h, f(5), 5);
    h = boyIlerlet(h, f(5), 6);
    h = boyIlerlet(h, f(5), 7);
    expect(boyGecisi(h.get("a")!, 7)).toBe("kuculdu");
    expect(boyGecisi(h.get("a")!, 8)).toBeNull();
    expect(boyGecisi(seri([5]).get("a")!, 1)).toBeNull();
  });
  it("oyuncu_isletmesi_ayni_kural", () => {
    const h = seri([30, 60, 60, 60], 1, "oyuncu-1");
    expect(h.get("oyuncu-1")).toMatchObject({ gorsel: 4, son: { eski: 3, yeni: 4, hafta: 4 } });
  });
  it("ozel_esik_ve_saflik", () => {
    const onceki = seri([5]);
    const kopya = new Map(onceki);
    const h = boyIlerlet(onceki, f(10), 2, 1);
    expect(h.get("a")?.gorsel).toBe(2);
    expect(onceki).toEqual(kopya);
  });
  it("boyOf_esik_sinirlari", () => {
    expect([boyOf(7), boyOf(8), boyOf(19), boyOf(20), boyOf(49), boyOf(50)]).toEqual([1, 2, 2, 3, 3, 4]);
  });
  it("dort_den_bire_buyuk_dusus_esik_sonra_tek_adimda_kuculur", () => {
    let h = seri([60]);
    h = boyIlerlet(h, f(3), 2);
    h = boyIlerlet(h, f(3), 3);
    expect(h.get("a")?.gorsel).toBe(4);
    h = boyIlerlet(h, f(3), 4);
    expect(h.get("a")).toMatchObject({ gorsel: 1, son: { eski: 4, yeni: 1, hafta: 4 } });
    expect(boyGecisi(h.get("a")!, 4)).toBe("kuculdu");
  });
});
