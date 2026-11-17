import { describe, expect, it } from "vitest";
import {
  birlesikHane, boyDagilimi, CYCLES_PER_WEEK, eksikUrunler, endeksSeri, tamSepet, ucretOraniSeri, ucretSatiri, enBuyukFirmalar, firmaSeri, haneKirilimi, haneSeri, harcamaSeri, hareketSeri, kisiHafta, ozelIstihdamSeri, urunAcilabilir,
} from "@/oyun/sim/ekonomiSeri";
import { parseEkonomi, parsePacket } from "@/oyun/sim/live/wire";
import type { HaritaFirmaSatiri } from "@/oyun/harita/tipler";
import type { WeekPacket } from "@/oyun/sim/types";
import { EKONOMI_TEL, packetOf } from "../helpers/fakeLiveServer";

/** Fikstür bloğundan, haftaya göre değişen değerlerle paket. */
const paket = (hafta: number, degis: (t: Record<string, any>) => void = () => {}): WeekPacket => {
  const t = structuredClone(EKONOMI_TEL) as Record<string, any>;
  t.tuketim.hane.ise.karsilanma = 0.5 + hafta / 100;
  t.tuketim.harcama.toplam = hafta * 1000;
  t.isletme.istihdam.ozel = 1000 + hafta;
  t.isletme.sehir[2].ozel_calisan = 200 + hafta;
  t.isletme.hareket = hafta === 1 ? null : { kurulan: hafta, buyuyen: 0, kuculen: 0, batan: 0 };
  degis(t);
  return { ...packetOf("r", hafta, 1), ekonomi: parseEkonomi(t)! };
};
const harita = (hafta: number, firmalar: HaritaFirmaSatiri[]): WeekPacket => ({ ...packetOf("r", hafta, 1), harita: { hafta, firmalar } });

describe("ekonomiSeri", () => {
  it("test_hane_seri_haftaya_hizali_eksik_hafta_null", () => {
    const w = [paket(1), paket(2), paket(4)];
    const s = haneSeri(w, "ise", "karsilanma");
    expect(s).toHaveLength(4);
    expect(s[0]).toBeCloseTo(0.51);
    expect(s[2]).toBeNull();
    expect(s[3]).toBeCloseTo(0.54);
    expect(haneSeri([], "ise", "sepet")).toEqual([]);
    expect(harcamaSeri(w, "toplam")).toEqual([1000, 2000, null, 4000]);
  });

  it("test_olculmeyen_deger_null_kalir", () => {
    const w = [paket(1, (t) => { t.tuketim.hane.issiz = { n: 0, karsilanma: null, sepet: null }; t.tuketim.harcama = null; })];
    expect(haneSeri(w, "issiz", "karsilanma")).toEqual([null]);
    expect(harcamaSeri(w, "npc")).toEqual([null]);
  });

  it("test_ozel_istihdam_sehir_ve_dunya", () => {
    const w = [paket(1), paket(2)];
    expect(ozelIstihdamSeri(w, null)).toEqual([1001, 1002]);
    expect(ozelIstihdamSeri(w, 2)).toEqual([201, 202]);
    expect(ozelIstihdamSeri(w, 99)).toEqual([null, null]);
  });

  it("test_hareket_ilk_hafta_null", () => {
    const w = [paket(1), paket(2), paket(3)];
    expect(hareketSeri(w, null, "kurulan")).toEqual([null, 2, 3]);
    expect(hareketSeri(w, 1, "kurulan")).toEqual([1, 1, 1]);
    expect(hareketSeri(w, 99, "kurulan")).toEqual([null, null, null]);
  });

  it("test_boy_dunya_sehirlerin_toplami", () => {
    const p = paket(1, (t) => {
      t.isletme.sehir = [{ sehir: 0, boy: [60, 12, 4, 1] }, { sehir: 1, boy: [10, 2, 1, 0] }];
    });
    expect(boyDagilimi(p, null)).toEqual([70, 14, 5, 1]);
    expect(boyDagilimi(p, 1)).toEqual([10, 2, 1, 0]);
    expect(boyDagilimi(p, 7)).toBeNull();
    expect(boyDagilimi(null, null)).toBeNull();
    expect(boyDagilimi(packetOf("r", 1, 1), null)).toBeNull();
  });

  it("test_eksik_urunler_blok_yoksa_null", () => {
    expect(eksikUrunler(null)).toBeNull();
    expect(eksikUrunler(packetOf("r", 1, 1))).toBeNull();
    expect(eksikUrunler(paket(1, (t) => { t.tuketim.urunler = null; }))).toBeNull();
    expect(eksikUrunler(paket(1))!.map((u) => u.urun)).toEqual(["sut", "un", "ekmek"]);
  });

  it("test_urun_acilabilir_yalniz_panodakiler", () => {
    const p = paket(1, (t) => { t.tuketim.urunler = [{ urun: "un", istek: 1, karsilanmayan: 1, uretim: 0, stok: 0 }]; });
    expect(urunAcilabilir(p, "un")).toBe(true);
    expect(urunAcilabilir(p, "deri")).toBe(false);
    expect(urunAcilabilir(null, "un")).toBe(false);
  });

  it("test_firma_seri_haritadan", () => {
    const f = (id: string, calisan: number): HaritaFirmaSatiri => [id, "firin", 0, calisan, null, "npc", null, "uretim"];
    const w = [harita(1, [f("a", 3), f("b", 5)]), harita(2, [f("a", 4)]), harita(3, [f("a", 4), f("b", 7)])];
    expect(firmaSeri(w, "b")).toEqual([5, null, 7]);
    expect(firmaSeri(w, "a")).toEqual([3, 4, 4]);
    expect(firmaSeri([...w, packetOf("r", 5, 1)], "a")).toEqual([3, 4, 4, null, null]);
  });

  it("test_en_buyuk_firmalar_siralama_ve_sehir_suzgeci", () => {
    const f = (id: string, sehir: number, calisan: number, durum: HaritaFirmaSatiri[7] = "uretim"): HaritaFirmaSatiri => [id, "un", sehir, calisan, null, "npc", null, durum];
    const p = harita(1, [f("a", 0, 5), f("b", 1, 9), f("c", 0, 12), f("d", 0, 12), f("e", 0, 40, "kapali"), f("g", 0, 0)]).harita!;
    expect(enBuyukFirmalar(p, null, 3).map((x) => x.id)).toEqual(["c", "d", "b"]);
    expect(enBuyukFirmalar(p, 0, 10).map((x) => x.id)).toEqual(["c", "d", "a"]);
    expect(enBuyukFirmalar(p, 1, 5)).toEqual([{ id: "b", tur: "un", calisan: 9 }]);
    expect(enBuyukFirmalar(null, null, 3)).toEqual([]);
  });

  it("test_firma_seri_ara_haftalarda_harita_farki", () => {
    const f = (id: string, calisan: number): HaritaFirmaSatiri => [id, "firin", 0, calisan, null, "npc", null, "uretim"];
    const fark = (hafta: number, degisen: [string, HaritaFirmaSatiri[7], number][], yeni: HaritaFirmaSatiri[], kapanan: string[]): WeekPacket =>
      ({ ...packetOf("r", hafta, 1), haritaFark: { hafta, taban: 1, degisen, yeni, kapanan } });
    const w = [
      harita(1, [f("a", 3), f("b", 5), f("c", 2)]),
      fark(2, [], [], []),
      fark(3, [["a", "uretim", 6]], [], []),
      fark(4, [], [f("n", 1)], ["b"]),
      fark(5, [], [], []),
    ];
    expect(firmaSeri(w, "a")).toEqual([3, 3, 6, 3, 3]);
    expect(firmaSeri(w, "b")).toEqual([5, 5, 5, null, 5]);
    expect(firmaSeri(w, "n")).toEqual([null, null, null, 1, null]);
    expect(firmaSeri(w, "yok")).toEqual([null, null, null, null, null]);
    // Taban penceredeyse (tam harita yok) fark çözülemez: null, çökme yok.
    expect(firmaSeri(w.slice(1), "a")).toEqual([null, null, null, null, null]);
    // Karışık: sonraki tam harita kendi satırını verir.
    expect(firmaSeri([...w, harita(6, [f("a", 9)])], "a")).toEqual([3, 3, 6, 3, 3, 9]);
  });

  it("test_en_buyuk_firmalar_guncel_harita_parametresi", () => {
    const f = (id: string, calisan: number): HaritaFirmaSatiri => [id, "un", 0, calisan, null, "npc", null, "uretim"];
    expect(enBuyukFirmalar({ hafta: 2, firmalar: [f("a", 3), f("b", 8)] }, null, 1)).toEqual([{ id: "b", tur: "un", calisan: 8 }]);
  });

  it("test_birlesik_karsilanma_n_agirlikli_ve_null_korunur", () => {
    const b = birlesikHane([{ n: 100, karsilanma: 0.8, sepet: 10 }, { n: 300, karsilanma: 0.4, sepet: 30 }]);
    expect(b).toEqual({ n: 400, karsilanma: 0.5, sepet: 25 });
    expect(birlesikHane([{ n: 0, karsilanma: null, sepet: null }, { n: null, karsilanma: null, sepet: null }])).toEqual({ n: null, karsilanma: null, sepet: null });
    expect(birlesikHane([{ n: 100, karsilanma: null, sepet: null }, { n: 100, karsilanma: 0.6, sepet: 5 }])).toEqual({ n: 200, karsilanma: 0.6, sepet: 5 });
    const k = haneKirilimi(paket(1), "ise")!;
    expect(k.oyuncu.n).toBe(4600);
    expect(k.birlesik.n).toBe(4600 + 15200);
    expect(k.birlesik.karsilanma).toBeCloseTo((4600 * 0.51 + 15200 * 0.74) / 19800, 6);
    expect(k.nKisiHaftaBirlesik).toBeCloseTo(19800 / CYCLES_PER_WEEK, 6);
    expect(haneKirilimi(null, "ise")).toBeNull();
    expect(haneSeri([paket(1)], "ise", "karsilanma", "birlesik")[0]).toBeCloseTo(k.birlesik.karsilanma!, 9);
  });

  it("test_kisi_hafta_birimi", () => {
    expect(CYCLES_PER_WEEK).toBe(7);
    expect(kisiHafta(700)).toBe(100);
    expect(kisiHafta(null)).toBeNull();
  });

  it("test_520_hafta_seriler_hizli", () => {
    const w = Array.from({ length: 520 }, (_, i) => ({ ...paket(i + 1), harita: { hafta: i + 1, firmalar: Array.from({ length: 200 }, (_, j): HaritaFirmaSatiri => [`f${j}`, "un", j % 5, j, null, "npc", null, "uretim"]) } }));
    const t0 = performance.now();
    haneSeri(w, "ise", "karsilanma"); haneSeri(w, "issiz", "sepet", "birlesik"); harcamaSeri(w, "oyuncu");
    ozelIstihdamSeri(w, null); ozelIstihdamSeri(w, 3); hareketSeri(w, null, "batan"); hareketSeri(w, 2, "kurulan");
    boyDagilimi(w[519]!, null); eksikUrunler(w[519]!); firmaSeri(w, "f7"); enBuyukFirmalar(w[519]!.harita!, null, 10);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(haneSeri(w, "ise", "karsilanma")).toHaveLength(520);
  });

  it("test_paketler_ayristiricidan_gecer", () => {
    expect(parsePacket(packetOf("r", 2, 1, { ekonomi: true })).ekonomi?.tuketim.urunler).toHaveLength(3);
  });
});

describe("ekonomiSeri: ücret ve fiyat", () => {
  const ucretli = (hafta: number, ucret: number, fiyat: number): WeekPacket =>
    paket(hafta, (t) => { t.tuketim.ucret = { dunya: [ucret, fiyat, 70, 1.4], sehir: [[ucret * 2, fiyat * 2, 80, 1.6]] }; });

  it("test_endeks_ilk_olculen_hafta_100", () => {
    const w = [ucretli(1, 1.0, 1.0), ucretli(2, 1.1, 1.2), ucretli(4, 1.2, 1.5)];
    expect(endeksSeri(w, "ucret", null)).toEqual([100, expect.closeTo(110), null, expect.closeTo(120)]);
    expect(endeksSeri(w, "fiyat", null)).toEqual([100, expect.closeTo(120), null, expect.closeTo(150)]);
    expect(endeksSeri(w, "fiyat", 0)![3]).toBeCloseTo(150);                         // şehir de kendi ilk haftasına göre
    expect(endeksSeri(w, "ucret", 3)).toEqual([null, null, null, null]);              // olmayan şehir
    expect(ucretOraniSeri(w, 0)).toEqual([1.6, 1.6, null, 1.6]);
    expect(ucretSatiri(w[0]!, null)).toEqual({ ucret: 1, fiyat: 1, net: 70, oran: 1.4 });
    expect(tamSepet(ucretSatiri(w[0]!, null))).toBeCloseTo(50);                       // net / oran
    expect(tamSepet({ ucret: 1, fiyat: 1, net: 70, oran: null })).toBeNull();
    expect(tamSepet({ ucret: 1, fiyat: 1, net: 70, oran: 0 })).toBeNull();
    expect(tamSepet(null)).toBeNull();
  });

  it("test_ucret_yoksa_seri_bos_satir_null", () => {
    const w = [paket(1, (t) => { delete t.tuketim.ucret; })];
    expect(endeksSeri(w, "ucret", null)).toEqual([null]);
    expect(ucretSatiri(w[0]!, null)).toBeNull();
    expect(ucretSatiri(null, null)).toBeNull();
  });
});
