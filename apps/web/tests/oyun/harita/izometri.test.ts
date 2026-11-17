import { describe, expect, it } from "vitest";
import { BLOK_SATIR, BLOK_SUTUN, YOL_ORANI, blokAraligi, blokSolKenari, blokUstKenari, derinlik, elmas, ekrandanHucreye, hucredenEkrana, parselDikdortgeni, parselHucresi, sinirKutusu, yolBantlari, yolaDegiyor } from "@/oyun/harita/izometri";
import { IZO_STILI, SEHIR_STILI } from "@/oyun/harita/haritaStili";
import { sokakAgi } from "@/oyun/harita/sokakAgi";

describe("izometri", () => {
  it("projeksiyon_gidis_donus", () => {
    let s = 12345;
    const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 40 - 20;
    for (let i = 0; i < 50; i++) {
      const h = i % 2 ? { c: rnd(), r: rnd() } : { c: Math.round(rnd()), r: Math.round(rnd()) };
      const g = ekrandanHucreye(hucredenEkrana(h));
      expect(g.c).toBeCloseTo(h.c, 9);
      expect(g.r).toBeCloseTo(h.r, 9);
    }
  });

  it("elmas_karo_oraninda", () => {
    const { genislik: w, yukseklik: t } = IZO_STILI.karo;
    expect(elmas({ c: 0, r: 0 })).toEqual([0, -t / 2, w / 2, 0, 0, t / 2, -w / 2, 0]);
    const k = { genislik: 200, yukseklik: 50 };
    const e = elmas({ c: 1, r: 0 }, k);
    expect(e[2]! - e[6]!).toBe(200);
    expect(e[5]! - e[1]!).toBe(50);
  });

  it("bitisik_elmaslar_kenar_paylasir", () => {
    const a = elmas({ c: 3, r: 4 });
    const sag = elmas({ c: 4, r: 4 }); // +c: sağ-aşağı
    const alt = elmas({ c: 3, r: 5 }); // +r: sol-aşağı
    // (c,r)'nin sağ-alt kenarı (sağ, alt) = (c+1,r)'nin sol-üst kenarı (üst, sol)
    expect([a[2], a[3], a[4], a[5]]).toEqual([sag[0], sag[1], sag[6], sag[7]]);
    // (c,r)'nin sol-alt kenarı (alt, sol) = (c,r+1)'in sağ-üst kenarı (sağ, üst)
    expect([a[4], a[5], a[6], a[7]]).toEqual([alt[2], alt[3], alt[0], alt[1]]);
  });

  it("derinlik_arkadaki_kucuk", () => {
    expect(derinlik({ c: 0, r: 0 })).toBeLessThan(derinlik({ c: 1, r: 0 }));
    expect(derinlik({ c: 2, r: 0 })).toBeLessThan(derinlik({ c: 1, r: 1 }));
    expect(derinlik({ c: 1, r: 1 })).toBeLessThan(derinlik({ c: 0, r: 2 }));
  });

  it("derinlik_negatif_ve_kesirli_hucrelerde_tutarli", () => {
    expect(derinlik({ c: -3, r: -2 })).toBeLessThan(derinlik({ c: -3, r: -1 }));
    expect(derinlik({ c: -3, r: -1 })).toBeLessThan(derinlik({ c: 0, r: 0 }));
    // kesirli r komşu hücreyi geçmez: (0,0.5) iki komşu (0,0) ve (0,1) arasında kalır
    const k = derinlik({ c: 0, r: 0.5 });
    expect(k).toBeGreaterThan(derinlik({ c: 0, r: 0 }));
    expect(k).toBeLessThan(derinlik({ c: 0, r: 1 }));
    expect(derinlik({ c: -0.5, r: -0.5 })).toBeGreaterThan(derinlik({ c: -1, r: -1 }));
    expect(derinlik({ c: -0.5, r: -0.5 })).toBeLessThan(derinlik({ c: 0, r: 0 }));
  });

  const RO = YOL_ORANI;

  it("yol_orani_ve_blok_olcusu_kilitli", () => {
    expect(RO).toBeCloseTo(55 / 208, 12);
    expect(BLOK_SUTUN).toBe(SEHIR_STILI.blok.sutun);
    expect(BLOK_SATIR).toBe(SEHIR_STILI.blok.satir);
  });

  it("parselHucresi_kimlikten_surekli_koordinat", () => {
    // literal beklenen: c = dc + bc*ro (ana cadde de tek ro bandı)
    const h = parselHucresi("p-3_5");
    expect(h.c).toBeCloseTo(5 + RO, 12); // bc=1
    expect(h.r).toBeCloseTo(-3 - 2 * RO, 12); // br=floor(-3/2)=-2
    expect(parselHucresi("p0_0")).toEqual({ c: 0, r: 0 });
    expect(parselHucresi("p0_-1").c).toBeCloseTo(-1 - RO, 12);
    expect(parselHucresi("p-1_0").r).toBeCloseTo(-1 - RO, 12);
    expect(() => parselHucresi("x")).toThrow("izometri:parsel");
    expect(() => parselHucresi("p1_")).toThrow("izometri:parsel");
    // ro parametresi
    expect(parselHucresi("p0_3", 0.5).c).toBeCloseTo(3.5, 12);
  });

  it("kademe_buyuyunce_ayni_parsel_ayni_koordinat", () => {
    const k0 = sokakAgi(0, 92).parseller;
    const eski = new Map(k0.map((p) => [p.id, parselHucresi(p.id)]));
    const k2 = sokakAgi(2, 92).parseller;
    const k2Idler = new Set(k2.map((p) => p.id));
    expect(eski.size).toBeGreaterThan(0);
    // bağımsız hesap: kimlikten dr/dc ayrıştırılıp formül elle uygulanır (bc = (dc - dc mod 3) / 3)
    const bagimsiz = (id: string): { c: number; r: number } => {
      const [dr, dc] = id.slice(1).split("_").map(Number) as [number, number];
      const bc = (dc - (((dc % 3) + 3) % 3)) / 3, br = (dr - (((dr % 2) + 2) % 2)) / 2;
      return { c: dc + bc * RO, r: dr + br * RO };
    };
    for (const [id, h] of eski) {
      expect(k2Idler.has(id)).toBe(true);
      expect(bagimsiz(id).c).toBeCloseTo(h.c, 12);
      expect(bagimsiz(id).r).toBeCloseTo(h.r, 12);
    }
    // parseller hiçbir kademede çakışmaz
    const dd = k2.map((p) => parselDikdortgeni(p.id));
    for (let i = 0; i < dd.length; i++) for (let j = i + 1; j < dd.length; j++) {
      const a = dd[i]!, b = dd[j]!;
      expect(a.c0 < b.c1 - 1e-9 && a.c1 > b.c0 + 1e-9 && a.r0 < b.r1 - 1e-9 && a.r1 > b.r0 + 1e-9).toBe(false);
    }
  });

  it("blok_icinde_bitisik_bloklar_arasi_tek_bant", () => {
    const d = (id: string) => parselDikdortgeni(id);
    // aynı blok: dc 0,1,2 ve dr 0,1 -> kenarlar tam değer (bitişik, yol yok)
    expect(d("p0_1").c0).toBeCloseTo(d("p0_0").c1, 12);
    expect(d("p0_2").c0).toBeCloseTo(d("p0_1").c1, 12);
    expect(d("p1_0").r0).toBeCloseTo(d("p0_0").r1, 12);
    // komşu bloklar: tam bir ro bandı (dc 2 -> 3, dr 1 -> 2)
    expect(d("p0_3").c0 - d("p0_2").c1).toBeCloseTo(RO, 12);
    expect(d("p2_0").r0 - d("p1_0").r1).toBeCloseTo(RO, 12);
    // ana cadde (merkez) de tek ro (dc -1 -> 0, dr -1 -> 0)
    expect(d("p0_0").c0 - d("p0_-1").c1).toBeCloseTo(RO, 12);
    expect(d("p0_0").r0 - d("p-1_0").r1).toBeCloseTo(RO, 12);
    // negatif tarafta da normal bant ro: dc -3 -> -4
    expect(d("p0_-3").c0 - d("p0_-4").c1).toBeCloseTo(RO, 12);
    expect(d("p-2_0").r0 - d("p-3_0").r1).toBeCloseTo(RO, 12);
  });

  it("yol_bantlari_ana_cadde_merkezde_ve_olculer", () => {
    const ar = blokAraligi(sokakAgi(2, 92).parseller.map((p) => p.id))!;
    expect(ar).toEqual({ bc0: -3, bc1: 2, br0: -2, br1: 1 });
    const { bantlar, kavsaklar, kutu } = yolBantlari(ar);
    const ana = bantlar.filter((b) => b.ana);
    expect(ana.map((b) => b.eksen).sort()).toEqual(["dikey", "yatay"]);
    for (const b of bantlar) expect(b.genislik).toBeCloseTo(RO, 12); // ana cadde de tek karo
    const dikAna = ana.find((b) => b.eksen === "dikey")!;
    // ana dikey bant: bloğun 0 solunda, p0_0 ile p0_-1 arası; merkezi iki parselin orta noktası
    expect(dikAna.konum).toBeCloseTo((parselDikdortgeni("p0_-1").c1 + parselDikdortgeni("p0_0").c0) / 2, 12);
    const yatAna = ana.find((b) => b.eksen === "yatay")!;
    expect(yatAna.konum).toBeCloseTo((parselDikdortgeni("p-1_0").r1 + parselDikdortgeni("p0_0").r0) / 2, 12);
    // sayılar: (bx+1) dikey, (by+1) yatay bant; her çift bir kavşak; kavşak boyutu bantlardan
    expect(bantlar.filter((b) => b.eksen === "dikey")).toHaveLength(7);
    expect(bantlar.filter((b) => b.eksen === "yatay")).toHaveLength(5);
    expect(kavsaklar).toHaveLength(35);
    const merkez = kavsaklar.find((k) => k.k === 0 && k.l === 0)!;
    expect([merkez.sutun, merkez.satir, merkez.ana]).toEqual([1, 1, true]);
    expect(kavsaklar.find((k) => k.k === 1 && k.l === 1)).toMatchObject({ sutun: 1, satir: 1, ana: false });
    // ana cadde ağın tam ortasında
    expect((kutu.c0 + kutu.c1) / 2).toBeCloseTo(dikAna.konum, 12);
    expect((kutu.r0 + kutu.r1) / 2).toBeCloseTo(yatAna.konum, 12);
    expect(blokAraligi([])).toBeNull();
  });

  it("bantlar_parsellere_tasmaz_ve_blok_kenarlariyla_bitisik", () => {
    const parseller = sokakAgi(3, 92).parseller;
    const ar = blokAraligi(parseller.map((p) => p.id))!;
    const { bantlar } = yolBantlari(ar);
    const dd = parseller.map((p) => parselDikdortgeni(p.id));
    for (const b of bantlar) {
      const a = b.konum - b.genislik / 2, z = b.konum + b.genislik / 2;
      for (const p of dd) {
        const ic = b.eksen === "dikey" ? p.c0 < z - 1e-9 && p.c1 > a + 1e-9 : p.r0 < z - 1e-9 && p.r1 > a + 1e-9;
        expect(ic).toBe(false);
      }
    }
    expect(blokSolKenari(0)).toBeCloseTo(-0.5, 12);
    expect(blokUstKenari(1)).toBeCloseTo(blokUstKenari(0) + 2 + RO, 12);
  });

  it("sinir_kutusu_pozitif_ve_kapsar", () => {
    const hs = [{ c: -3, r: -2 }, { c: 4, r: 5 }, { c: 0, r: 0 }];
    const pad = 48;
    const k = sinirKutusu(hs, pad);
    expect(k.genislik).toBeGreaterThan(0);
    expect(k.yukseklik).toBeGreaterThan(0);
    for (const h of hs) {
      const e = elmas(h);
      for (let i = 0; i < 8; i += 2) {
        const x = e[i]! + k.kaydirma.x, y = e[i + 1]! + k.kaydirma.y;
        expect(x).toBeGreaterThanOrEqual(pad - 1e-9);
        expect(y).toBeGreaterThanOrEqual(pad - 1e-9);
        expect(x).toBeLessThanOrEqual(k.genislik - pad + 1e-9);
        expect(y).toBeLessThanOrEqual(k.yukseklik - pad + 1e-9);
      }
    }
  });

  it("yolaDegiyor_bant_ve_kavsakla_kesisimi_bagimsiz_olcer", () => {
    const ar = blokAraligi(sokakAgi(1, 92).parseller.map((p) => p.id))!;
    const yb = yolBantlari(ar);
    // her parsel yol ağına değmez (yalnız komşu kenara yaslanır)
    for (const p of sokakAgi(1, 92).parseller) expect(yolaDegiyor(parselDikdortgeni(p.id), yb), p.id).toBe(false);
    // bir bandın tam üstündeki küçük kare değer; bir kavşağın içindeki kare de
    const b = yb.bantlar.find((x) => x.eksen === "dikey")!;
    const mid = (b.bas + b.son) / 2;
    expect(yolaDegiyor({ c0: b.konum - 0.01, c1: b.konum + 0.01, r0: mid - 0.01, r1: mid + 0.01 }, yb)).toBe(true);
    const k = yb.kavsaklar[0]!;
    expect(yolaDegiyor({ c0: (k.c0 + k.c1) / 2 - 0.001, c1: (k.c0 + k.c1) / 2 + 0.001, r0: (k.r0 + k.r1) / 2 - 0.001, r1: (k.r0 + k.r1) / 2 + 0.001 }, yb)).toBe(true);
    // parselin sol kenarı bandın sağ kenarına teğet: değmez; 0,01 içeri kaydırılırsa değer
    const dis = yb.bantlar.find((x) => x.eksen === "dikey" && x.indeks === ar.bc0)!;
    const pr = parselDikdortgeni(`p${ar.br0 * BLOK_SATIR}_${ar.bc0 * BLOK_SUTUN}`);
    expect(pr.c0).toBeCloseTo(dis.konum + dis.genislik / 2, 9);
    expect(yolaDegiyor(pr, yb)).toBe(false);
    expect(yolaDegiyor({ ...pr, c0: pr.c0 - 0.01 }, yb)).toBe(true);
    // yol ağının tamamen dışı
    expect(yolaDegiyor({ c0: yb.kutu.c1 + 1, c1: yb.kutu.c1 + 2, r0: 0, r1: 1 }, yb)).toBe(false);
  });
});
