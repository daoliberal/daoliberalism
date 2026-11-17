import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IZO_STILI } from "@/oyun/harita/haritaStili";
import { YOL_ORANI, parselDikdortgeni, type Dikdortgen } from "@/oyun/harita/izometri";
import { izoZeminKur, yolTuruBaglantidan, type IzoZemin, type YolKarosu } from "@/oyun/harita/izoZemin";
import { sokakAgi } from "@/oyun/harita/sokakAgi";
import { manifestCoz, type SpriteManifesti } from "@/oyun/harita/spriteManifest";
import { fnv1a } from "@/oyun/harita/yerlesim";
import { izoManifestFiksturu } from "./fikstur/izoManifest";

const RO = YOL_ORANI;
const EPS = 1e-6;
const m = izoManifestFiksturu();
const kur = (kademe: number, tohum = "tohum-a", manifest: SpriteManifesti = m): IzoZemin => izoZeminKur(sokakAgi(kademe, 92).parseller, manifest, tohum, 0);
const kesisir = (a: Dikdortgen, b: Dikdortgen): boolean => a.c0 < b.c1 - EPS && a.c1 > b.c0 + EPS && a.r0 < b.r1 - EPS && a.r1 > b.r0 + EPS;
const kare = (h: { c: number; r: number }, ro = RO): Dikdortgen => ({ c0: h.c - ro / 2, c1: h.c + ro / 2, r0: h.r - ro / 2, r1: h.r + ro / 2 });
const anahtar = (y: YolKarosu): string => `${y.hucre.c.toFixed(6)},${y.hucre.r.toFixed(6)}`;
const bagStr = (y: YolKarosu): string => `${y.tur}|${y.ana}|${y.baglanti.K ? "K" : ""}${y.baglanti.D ? "D" : ""}${y.baglanti.G ? "G" : ""}${y.baglanti.B ? "B" : ""}`;

describe("izoZeminKur", () => {
  it("yol_agi_surekli_bosluk_yok", () => {
    const z = kur(1);
    const parseller = sokakAgi(1, 92).parseller.map((p) => parselDikdortgeni(p.id));
    const yuvalar = z.blokZemini.map((k) => kare(k.hucre, RO));
    const yollar = z.yollar.map((y) => kare(y.hucre));
    // Ağ kutusu içinde parsel/boş yuva dışında kalan her nokta bir yol karosuyla örtülür (ince ızgarayla bağımsız örnekleme).
    const { kapsam } = z;
    let ornek = 0;
    for (let c = kapsam.c0 + 0.011; c < kapsam.c1; c += 0.037) {
      for (let r = kapsam.r0 + 0.011; r < kapsam.r1; r += 0.037) {
        const p = { c0: c, c1: c, r0: r, r1: r };
        const icinde = (d: Dikdortgen): boolean => c > d.c0 + EPS && c < d.c1 - EPS && r > d.r0 + EPS && r < d.r1 - EPS;
        if (parseller.some(icinde)) continue;
        // parselsiz meydan yuvaları blok zemini ile dolu: bunlar yuva kutusuyla ayrıca sınanır
        const yuvaDisi = z.blokZemini.length === 0 || !yuvalar.some(icinde);
        if (!yuvaDisi) continue;
        ornek++;
        expect(yollar.some((k) => c >= k.c0 - EPS && c <= k.c1 + EPS && r >= k.r0 - EPS && r <= k.r1 + EPS), `boşluk (${c.toFixed(3)}, ${r.toFixed(3)}) ${JSON.stringify(p)}`).toBe(true);
      }
    }
    expect(ornek).toBeGreaterThan(1000);
    // her yol karosunun en az bir yol komşusu var (yarım karo içinde, ortak eksende)
    for (const y of z.yollar) {
      const komsu = z.yollar.some((o) => o !== y && Math.hypot(o.hucre.c - y.hucre.c, o.hucre.r - y.hucre.r) <= RO * 1.05 + EPS);
      expect(komsu).toBe(true);
    }
  });

  it("ana_caddeler_uctan_uca_bagli", () => {
    const z = kur(2);
    const ana = z.yollar.filter((y) => y.ana);
    expect(ana.length).toBeGreaterThan(0);
    const merkezC = (parselDikdortgeni("p0_-1").c1 + parselDikdortgeni("p0_0").c0) / 2;
    const merkezR = (parselDikdortgeni("p-1_0").r1 + parselDikdortgeni("p0_0").r0) / 2;
    const dikey = ana.filter((y) => Math.abs(y.hucre.c - merkezC) < 1e-6).sort((a, b) => a.hucre.r - b.hucre.r);
    const yatay = ana.filter((y) => Math.abs(y.hucre.r - merkezR) < 1e-6).sort((a, b) => a.hucre.c - b.hucre.c);
    // tek karo genişliğinde (ana cadde yalnız genis sprite ile ayrılır): tek sütun/satır, tam merkezde
    expect(new Set(dikey.map((y) => y.hucre.c.toFixed(6))).size).toBe(1);
    expect(new Set(yatay.map((y) => y.hucre.r.toFixed(6))).size).toBe(1);
    expect(dikey[0]!.hucre.c).toBeCloseTo(merkezC, 9);
    expect(yatay[0]!.hucre.r).toBeCloseTo(merkezR, 9);
    for (const [dizi, eksen, bas, son] of [[dikey, "r", z.kapsam.r0, z.kapsam.r1], [yatay, "c", z.kapsam.c0, z.kapsam.c1]] as const) {
      const degerler = dizi.map((y) => y.hucre[eksen]).sort((a, b) => a - b);
      expect(degerler[0]!).toBeLessThanOrEqual(bas + RO / 2 + EPS);
      expect(degerler[degerler.length - 1]!).toBeGreaterThanOrEqual(son - RO / 2 - EPS);
      for (let i = 1; i < degerler.length; i++) expect(degerler[i]! - degerler[i - 1]!).toBeLessThanOrEqual(RO + EPS);
    }
    // ana karoların hepsi geniş sprite alır, ara sokak karoları dar
    expect(ana.every((y) => y.sprite?.zeminTuru?.startsWith("yol-ana"))).toBe(true);
    expect(z.yollar.filter((y) => !y.ana).every((y) => y.sprite?.zeminTuru?.startsWith("yol-") && !y.sprite.zeminTuru.startsWith("yol-ana"))).toBe(true);
  });

  it("kavsak_t_kose_sonu_baglantidan", () => {
    const b = (s: string) => ({ K: s.includes("K"), D: s.includes("D"), G: s.includes("G"), B: s.includes("B") });
    const tablo: [string, string][] = [
      ["KDGB", "kavsak"],
      ["DGB", "t"], ["KGB", "t"], ["KDB", "t"], ["KDG", "t"],
      ["KG", "duz"], ["DB", "duz"],
      ["KD", "kose"], ["DG", "kose"], ["GB", "kose"], ["BK", "kose"],
      ["K", "sonu"], ["D", "sonu"], ["G", "sonu"], ["B", "sonu"],
    ];
    for (const [bag, tur] of tablo) expect(yolTuruBaglantidan(b(bag)), bag).toBe(tur);

    // gerçek ağda: köşeler dönüş (yönleri içeri doğru), kenar ortası T, iç kesişim kavşak
    const z = kur(0);
    const { kapsam } = z;
    const iceri = kur(2); // iç ara sokak kavşakları ancak büyük ağda var
    expect(iceri.yollar.some((y) => y.tur === "kavsak" && !y.ana)).toBe(true);
    const enUc = (sec: (y: YolKarosu) => number): YolKarosu => z.yollar.reduce((a, y) => (sec(y) < sec(a) ? y : a));
    const sol = enUc((y) => y.hucre.c * 10 + y.hucre.r); // c ve r en küçük: üst-sol köşe
    expect([sol.tur, sol.baglanti]).toEqual(["kose", b("DG")]);
    const sag = enUc((y) => -(y.hucre.c * 10 + y.hucre.r));
    expect([sag.tur, sag.baglanti]).toEqual(["kose", b("KB")]);
    // kuzey kenarında ana cadde kesişimi: yukarı (K) yok -> T, yalnız D G B
    const kuzeyAna = z.yollar.filter((y) => y.ana && y.hucre.r < kapsam.r0 + RO).sort((p, q) => p.hucre.c - q.hucre.c);
    expect(kuzeyAna.length).toBeGreaterThan(0);
    for (const y of kuzeyAna) expect(y.tur).toBe("t");
    // iç kavşaklar kavşak, bantların düz kısımları düz
    expect(z.yollar.some((y) => y.tur === "kavsak" && y.ana)).toBe(true);
    expect(z.yollar.some((y) => y.tur === "duz" && y.baglanti.K && y.baglanti.G)).toBe(true);
    expect(z.yollar.some((y) => y.tur === "duz" && y.baglanti.D && y.baglanti.B)).toBe(true);
    // sprite bağlantı kümesiyle birebir eşleşir
    for (const y of z.yollar) {
      expect(y.sprite).not.toBeNull();
      expect(y.sprite!.baglanti).toEqual(y.baglanti);
    }
  });

  it("blok_ici_parseller_bitisik_yolla_kesilmez", () => {
    const z = kur(2);
    const parseller = sokakAgi(2, 92).parseller.map((p) => p.id);
    const kareler = z.yollar.map((y) => kare(y.hucre));
    // hiçbir yol karosu hiçbir parselin içine girmez; parseller kendi aralarında bitişik (blok içi bant yok)
    for (const id of parseller) {
      const d = parselDikdortgeni(id);
      expect(kareler.some((k) => kesisir(k, d)), id).toBe(false);
    }
    const sagKomsu = (id: string): string => { const [dr, dc] = id.slice(1).split("_").map(Number) as [number, number]; return `p${dr}_${dc + 1}`; };
    const kume = new Set(parseller);
    let bitisik = 0;
    for (const id of parseller) {
      const dc = Number(id.split("_")[1]);
      const sag = sagKomsu(id);
      if (((dc % 3) + 3) % 3 === 2 || !kume.has(sag)) continue; // blok sınırı ya da meydan
      expect(parselDikdortgeni(sag).c0).toBeCloseTo(parselDikdortgeni(id).c1, 9);
      bitisik++;
    }
    expect(bitisik).toBeGreaterThan(10);
  });

  it("yol_karosu_hicbir_parselle_cakismaz", () => {
    for (const k of [0, 1, 3]) {
      const z = kur(k);
      const parseller = sokakAgi(k, 92).parseller.map((p) => parselDikdortgeni(p.id));
      for (const y of z.yollar) for (const d of parseller) expect(kesisir(kare(y.hucre), d)).toBe(false);
      // blok zemini yalnız parselsiz yuvalara döşenir; boşluksuz olsun diye karolar kenarda en çok (ro - adım)/2 < 0,01 taşar
      for (const b of z.blokZemini) for (const d of parseller) expect(kesisir(kare(b.hucre, RO - 0.02), d)).toBe(false);
      expect(z.parselZemini).toHaveLength(parseller.length);
    }
  });

  it("meydan_yuvalari_kaldirimla_dolar", () => {
    const z = kur(2);
    const eksik = new Set(sokakAgi(2, 92).parseller.map((p) => p.id));
    // meydan 92 yarıçaplı: kimi merkez parselleri kullanılmıyor; en az bir yuva olmalı ve kaldırım karosuyla dolu
    const butun = sokakAgi(2, 92).parseller.length;
    expect(butun).toBeLessThan(18 * 8);
    expect(eksik.size).toBe(butun);
    expect(z.blokZemini.length).toBeGreaterThan(0);
    expect(z.blokZemini.every((k) => k.tur === "kaldirim" && k.sprite?.zeminTuru === "kaldirim")).toBe(true);
  });

  it("cerceve_ve_seritler_kapsam_disinda_ve_kararli", () => {
    const z = kur(1, "tohum-x");
    const { kapsam, kutu } = z;
    expect(kutu).toEqual({ c0: kapsam.c0 - IZO_STILI.kenarHucre, c1: kapsam.c1 + IZO_STILI.kenarHucre, r0: kapsam.r0 - IZO_STILI.kenarHucre, r1: kapsam.r1 + IZO_STILI.kenarHucre });
    const disinda = (h: { c: number; r: number }): boolean => h.c <= kapsam.c0 + EPS || h.c >= kapsam.c1 - EPS || h.r <= kapsam.r0 + EPS || h.r >= kapsam.r1 - EPS;
    expect(z.cerceve.length).toBeGreaterThan(100);
    for (const k of z.cerceve) {
      expect(disinda(k.hucre)).toBe(true);
      expect(["cim", "agac"]).toContain(k.tur);
      expect(k.sprite?.zeminTuru).toBe(k.tur);
    }
    const agac = z.cerceve.filter((k) => k.tur === "agac").length / z.cerceve.length;
    expect(agac).toBeGreaterThan(0.25);
    expect(agac).toBeLessThan(0.5);
    // bütün çerçeve ağın etrafını boşluksuz sarar (şeritler altında çim kalır: çentik yok)
    const hepsi = z.cerceve.map((k) => kare(k.hucre));
    for (let c = kutu.c0 + 0.013; c < kutu.c1; c += 0.31) for (let r = kutu.r0 + 0.013; r < kutu.r1; r += 0.31) {
      if (c >= kapsam.c0 && c <= kapsam.c1 && r >= kapsam.r0 && r <= kapsam.r1) continue;
      expect(hepsi.some((d) => c >= d.c0 - EPS && c <= d.c1 + EPS && r >= d.r0 - EPS && r <= d.r1 + EPS), `${c.toFixed(2)},${r.toFixed(2)}`).toBe(true);
    }
    // şeritler: nehir fnv1a(tohum|nehir) % 4 kenarında, park bitişik kenarda; çerçevenin dış bandının içinde, dış kenarla hizalı, aralıksız
    const yonler = ["kuzey", "dogu", "guney", "bati"];
    const nehirYon = yonler[fnv1a("tohum-x|nehir") % 4];
    const nehir = z.seritler.find((s) => s.tur === "nehir")!;
    const park = z.seritler.find((s) => s.tur === "park")!;
    expect(nehir.yon).toBe(nehirYon);
    expect(park.yon).toBe(yonler[(yonler.indexOf(nehirYon!) + 1) % 4]);
    for (const s of [nehir, park]) {
      expect(s.parcalar.length).toBeGreaterThan(3);
      expect(s.sprite?.zeminTuru).toBe(s.tur);
      expect(s.uzunluk).toBeGreaterThanOrEqual(1);
      expect(s.genislik).toBeGreaterThan(0);
      expect(s.genislik).toBeLessThanOrEqual(IZO_STILI.kenarHucre);
      const yatayMi = s.yon === "kuzey" || s.yon === "guney";
      const boyu = s.parcalar.map((h) => (yatayMi ? h.c : h.r)).sort((a, b) => a - b);
      const derin = new Set(s.parcalar.map((h) => (yatayMi ? h.r : h.c).toFixed(9)));
      expect(derin.size).toBe(1); // aynı hizada
      const d = (yatayMi ? s.parcalar[0]!.r : s.parcalar[0]!.c);
      const dis = { kuzey: kutu.r0, guney: kutu.r1, bati: kutu.c0, dogu: kutu.c1 }[s.yon];
      expect(Math.abs(d - dis)).toBeCloseTo(s.genislik / 2, 9); // dış kenarla aynı hiza
      expect(Math.abs(d - dis) + s.genislik / 2).toBeLessThanOrEqual(IZO_STILI.kenarHucre + EPS); // kapsam dışında
      // aralıksız: komşu parça merkezleri arası <= uzunluk, uçlar kenarı örter
      for (let i = 1; i < boyu.length; i++) expect(boyu[i]! - boyu[i - 1]!).toBeLessThanOrEqual(s.uzunluk + EPS);
      const [bas, son] = yatayMi ? [s.tur === "nehir" ? kutu.c0 : kapsam.c0, s.tur === "nehir" ? kutu.c1 : kapsam.c1] : [s.tur === "nehir" ? kutu.r0 : kapsam.r0, s.tur === "nehir" ? kutu.r1 : kapsam.r1];
      expect(boyu[0]! - s.uzunluk / 2).toBeLessThanOrEqual(bas + EPS);
      expect(boyu[boyu.length - 1]! + s.uzunluk / 2).toBeGreaterThanOrEqual(son - EPS);
    }
    // nehir ve park parçaları üst üste binmez (park yalnız ağ uzunluğunca)
    const ayak = (s: (typeof z.seritler)[number]) => s.parcalar.map((h) => (s.yon === "kuzey" || s.yon === "guney" ? { c0: h.c - s.uzunluk / 2, c1: h.c + s.uzunluk / 2, r0: h.r - s.genislik / 2, r1: h.r + s.genislik / 2 } : { c0: h.c - s.genislik / 2, c1: h.c + s.genislik / 2, r0: h.r - s.uzunluk / 2, r1: h.r + s.uzunluk / 2 }));
    for (const a of ayak(nehir)) for (const b of ayak(park)) expect(kesisir(a, b)).toBe(false);
    // aynı girdi aynı çıktı; farklı tohum farklı yerleşim (en az bir tohumda nehir kenarı değişir)
    expect(kur(1, "tohum-x")).toEqual(z);
    const kenarlar = new Set(["a", "b", "c", "d", "e", "f"].map((t) => kur(0, t).seritler.find((s) => s.tur === "nehir")!.yon));
    expect(kenarlar.size).toBeGreaterThan(1);
    expect(kur(1, "tohum-y").cerceve.map((k) => k.tur).join()).not.toBe(z.cerceve.map((k) => k.tur).join());
  });

  it("kademe_buyuyunce_icerdeki_yollar_ayni", () => {
    const kucuk = kur(0);
    const buyuk = kur(2);
    const buyukHarita = new Map(buyuk.yollar.map((y) => [anahtar(y), y]));
    const halka = (y: YolKarosu): boolean => y.hucre.c < kucuk.kapsam.c0 + RO + EPS || y.hucre.c > kucuk.kapsam.c1 - RO - EPS || y.hucre.r < kucuk.kapsam.r0 + RO + EPS || y.hucre.r > kucuk.kapsam.r1 - RO - EPS;
    let ic = 0;
    for (const y of kucuk.yollar) {
      const b = buyukHarita.get(anahtar(y));
      if (halka(y)) {
        // eski dış halka: karo hâlâ var, yalnız bağlantı kazanabilir (kaybetmez)
        expect(b, anahtar(y)).toBeDefined();
        for (const d of ["K", "D", "G", "B"] as const) if (y.baglanti[d]) expect(b!.baglanti[d]).toBe(true);
        continue;
      }
      ic++;
      expect(b, anahtar(y)).toBeDefined();
      expect(bagStr(b!), anahtar(y)).toBe(bagStr(y));
      expect(b!.sprite?.ad).toBe(y.sprite?.ad);
    }
    expect(ic).toBeGreaterThan(50);
    expect(buyuk.yollar.length).toBeGreaterThan(kucuk.yollar.length);
  });

  it("dort_kapi_ana_cadde_uclarinda", () => {
    const z = kur(2);
    expect(z.kapilar.map((k) => k.yon).sort()).toEqual(["bati", "dogu", "guney", "kuzey"]);
    const merkezC = (parselDikdortgeni("p0_-1").c1 + parselDikdortgeni("p0_0").c0) / 2;
    const merkezR = (parselDikdortgeni("p-1_0").r1 + parselDikdortgeni("p0_0").r0) / 2;
    const { kapsam } = z;
    const k = (yon: string) => z.kapilar.find((x) => x.yon === yon)!.hucre;
    expect(k("kuzey").c).toBeCloseTo(merkezC, 9); expect(k("kuzey").r).toBeCloseTo(kapsam.r0 + RO / 2, 9);
    expect(k("guney").c).toBeCloseTo(merkezC, 9); expect(k("guney").r).toBeCloseTo(kapsam.r1 - RO / 2, 9);
    expect(k("bati").r).toBeCloseTo(merkezR, 9); expect(k("bati").c).toBeCloseTo(kapsam.c0 + RO / 2, 9);
    expect(k("dogu").r).toBeCloseTo(merkezR, 9); expect(k("dogu").c).toBeCloseTo(kapsam.c1 - RO / 2, 9);
    // her kapı ana cadde karolarının üstünde (iki sütundan birinin komşuluğunda)
    for (const { hucre } of z.kapilar) expect(z.yollar.some((y) => y.ana && Math.hypot(y.hucre.c - hucre.c, y.hucre.r - hucre.r) <= RO + EPS)).toBe(true);
  });

  it("sprite_yoksa_null_cokmez", () => {
    const bos = manifestCoz({
      surum: 1,
      zemin_karosu: { piksel: [55, 32] },
      parsel_karosu: { piksel: [208, 120] },
      girdiler: [{ ad: "hizmet_boy1", tur: "bina_merdiven", grup: "hizmet", boy: 1, parsel_sayisi: 1, insanli: false, yalin: { dosya: "x.png", genislik: 209, yukseklik: 120, ankraj: [104, 119] } }],
    });
    const z = kur(0, "t", bos);
    expect(z.yollar.length).toBeGreaterThan(50);
    expect(z.yollar.every((y) => y.sprite === null)).toBe(true);
    expect(z.cerceve.every((k) => k.sprite === null)).toBe(true);
    expect(z.seritler.every((s) => s.sprite === null)).toBe(true);
    // boş parsel listesi de çökmez
    const bosSahne = izoZeminKur([], bos, "t", 0);
    expect(bosSahne.yollar).toHaveLength(0);
    expect(bosSahne.kapilar).toHaveLength(0);
  });

  // Dosya yoksa test sessizce geçmez: açıkça atlandı olarak görünür.
  const GERCEK_MANIFEST = path.resolve(process.cwd(), "public/oyun-sprite/manifest.json");
  it.skipIf(!fs.existsSync(GERCEK_MANIFEST))("gercek_manifestle_tum_zemin_spriteli_ve_ro_uyumlu", () => {
    const yol = GERCEK_MANIFEST;
    const gercek = manifestCoz(JSON.parse(fs.readFileSync(yol, "utf8")));
    expect(gercek.yolOrani).toBeCloseTo(YOL_ORANI, 9);
    const z = kur(2, "gercek", gercek);
    expect(z.ro).toBeCloseTo(YOL_ORANI, 9);
    for (const y of z.yollar) expect(y.sprite, `${anahtar(y)} ${bagStr(y)}`).not.toBeNull();
    for (const k of [...z.cerceve, ...z.blokZemini]) expect(k.sprite).not.toBeNull();
    for (const s of z.seritler) expect(s.sprite).not.toBeNull();
    expect(z.seritler.find((s) => s.tur === "park")!.uzunluk).toBeCloseTo(3.57, 1); // gerçek sprite ~3,6 x 0,8 parsel
    const gp = z.seritler.find((s) => s.tur === "park")!;
    expect(gp.genislik).toBeCloseTo(0.8, 1);
  });
});
