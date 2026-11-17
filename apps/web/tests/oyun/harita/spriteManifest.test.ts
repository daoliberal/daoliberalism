import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEKTOR_TURLERI } from "@/oyun/harita/sektorGrubu";
import { SPRITE_BOYUT_SINIRI, SPRITE_YOLU, bindirmeSprite, manifestCoz, tekilSprite, turSprite, zeminSprite, type SpriteKaydi, type SpriteManifesti } from "@/oyun/harita/spriteManifest";
import { fnv1a } from "@/oyun/harita/yerlesim";
import { izoManifestFiksturu } from "./fikstur/izoManifest";

const BOYLAR = [1, 2, 3, 4] as const;
const YAYIN = path.resolve(process.cwd(), "public/oyun-sprite"); // vitest apps/web kökünden çalışır
const GERCEK_VAR = fs.existsSync(path.join(YAYIN, "manifest.json"));

/** Gerçek şemaya benzeyen küçük ham manifest. */
function ham(girdiler: unknown[], karo: unknown = [55, 32], parsel: unknown = [208, 120]): unknown {
  return { surum: 1, zemin_karosu: { piksel: karo, hucre_birim: 52 }, parsel_karosu: { piksel: parsel }, girdiler };
}
const blok = (dosya: string): Record<string, unknown> => ({ dosya, genislik: 209, yukseklik: 120, ankraj: [104.2, 119.7], parsel_kose: { ust: [104, 0], sol: [0, 60], sag: [208, 60], alt: [104, 120] } });
const merdiven = (ad: string, grup: string, boy: number, ek: Record<string, unknown> = {}): Record<string, unknown> => ({ ad, tur: "bina_merdiven", grup, boy, parsel_sayisi: 1, kaynak: "uretim", insanli: false, yalin: blok(`merdiven/yalin/${ad}_yalin.png`), oyun_turleri: [`sektor grubu: ${grup}`], ...ek });

describe("manifestCoz", () => {
  it("insanli_kayit_suzulur", () => {
    const m = manifestCoz(ham([merdiven("hizmet_boy1", "hizmet", 1), { ad: "oyun_parki", tur: "bina", insanli: true, parsel_sayisi: 1, tam: blok("insanli/oyun_parki.png") }]));
    expect(m.kayitlar.map((k) => k.ad)).toEqual(["hizmet_boy1"]);
    expect(m.kayitlar.every((k) => !k.insanli)).toBe(true);
  });

  it("bozuk_manifest_atar", () => {
    const iyi = merdiven("hizmet_boy1", "hizmet", 1);
    expect(() => manifestCoz(ham([]))).toThrow("spriteManifest:bos");
    expect(() => manifestCoz({})).toThrow(/^Error: spriteManifest:|spriteManifest:/);
    expect(() => manifestCoz(null)).toThrow("spriteManifest:kok");
    expect(() => manifestCoz(ham([iyi], [0, 32]))).toThrow("spriteManifest:karo");
    expect(() => manifestCoz(ham([iyi], [55, 32], [208, -1]))).toThrow("spriteManifest:parsel_karo");
    const eksikAnkraj = { ...iyi, yalin: { ...blok("a.png"), ankraj: undefined } };
    expect(() => manifestCoz(ham([eksikAnkraj]))).toThrow("spriteManifest:ankraj");
    const negatif = { ...iyi, yalin: { ...blok("a.png"), genislik: -5 } };
    expect(() => manifestCoz(ham([negatif]))).toThrow("spriteManifest:boyut");
    expect(() => manifestCoz(ham([{ ...iyi, yalin: { ...blok("../disari.png") } }]))).toThrow("spriteManifest:dosya");
    expect(() => manifestCoz(ham([{ ...iyi, boy: 7 }]))).toThrow("spriteManifest:boy");
    expect(() => manifestCoz(ham([{ ...iyi, parsel_sayisi: 12 }]))).toThrow("spriteManifest:parsel_sayisi");
    expect(() => manifestCoz(ham([{ ad: "yol_x", tur: "yol", baglanti: "KXZ", parsel_sayisi: 1, ...blok("zemin/yol_x.png") }]))).toThrow("spriteManifest:baglanti");
    // yalnız insanli kayıt: süzülünce boş
    expect(() => manifestCoz(ham([{ ad: "oyun_parki", tur: "bina", insanli: true }]))).toThrow("spriteManifest:bos");
  });

  it("gercek_sema_eslemesi_yalin_zemin_bindirme_arac_serit", () => {
    const m = manifestCoz(
      ham([
        merdiven("sehir_boy1", "sehir", 1, { oyun_turleri: ["sehir"] }),
        merdiven("hammadde_boy4", "hammadde", 4, {
          parsel_sayisi: 2,
          yalin: { ...blok("merdiven/yalin/hammadde_boy4_yalin.png"), karolar: [{ rol: "ana", ust: [208, 38], sag: [312, 98], sol: [104, 98], alt: [208, 158] }] },
        }),
        { ad: "konut_a", tur: "bina", parsel_sayisi: 1, oyun_turleri: ["konut"], kaynak: "kesim (x)", yalin: blok("yalin/konut_a_yalin.png"), tam: blok("konut_a.png") },
        { ad: "arsa_cimen", tur: "bina", parsel_sayisi: 1, yalin: blok("yalin/arsa_cimen_yalin.png") },
        { ad: "yol_genis_kose_KD", tur: "yol_kose", stil: "genis", baglanti: "KD", ...blok("zemin/yol_genis_kose_KD.png"), karo: { sol: [6, 66], sag: [214, 66], ust: [110, 6], alt: [110, 126] }, parsel_sayisi: 1 },
        { ad: "cim_agacli", tur: "cim_agacli", baglanti: "", parsel_sayisi: 1, ...blok("zemin/cim_agacli.png") },
        { ad: "iskele_boy2", tur: "iskele", boy: 2, parsel_sayisi: 1, ...blok("overlay/iskele_boy2.png") },
        { ad: "araba_mor", tur: "arac", yon: "G", parsel_sayisi: 1, tam: blok("arac/araba_mor.png") },
        { ad: "park_seridi", tur: "serit", parsel_sayisi: 1, tam: { dosya: "park_seridi.png", genislik: 455, yukseklik: 269, ankraj: [371, 265] } },
        { ad: "merkez_blok", tur: "blok", parsel_sayisi: 12, tam: blok("merkez_blok.png") },
      ]),
    );
    const k = (ad: string): SpriteKaydi => m.kayitlar.find((x) => x.ad === ad)!;
    expect(m.karo).toEqual({ genislik: 55, yukseklik: 32 });
    expect(m.zeminKaro).toEqual(m.karo);
    expect(m.parselKaro).toEqual({ genislik: 208, yukseklik: 120 });
    expect(m.yolOrani).toBeCloseTo(55 / 208, 6);
    expect(m.kayitlar.some((x) => x.ad === "merkez_blok")).toBe(false);
    expect(k("sehir_boy1").oyunTurleri).toEqual(["sehir", "belediye"]);
    expect(k("hammadde_boy4")).toMatchObject({ grup: "hammadde", boy: 4, parselSayisi: 2, yalin: true, oyunTurleri: [], parsel: { genislik: 208, yukseklik: 120 } });
    expect(k("konut_a")).toMatchObject({ grup: "konut", boy: null, yalin: true, kaynak: "kesim", dosya: "yalin/konut_a_yalin.png" });
    expect(k("arsa_cimen")).toMatchObject({ grup: "dolgu", zeminTuru: "cimen" });
    expect(k("yol_genis_kose_KD")).toMatchObject({ grup: "zemin", zeminTuru: "yol-ana-kose", baglanti: { K: true, D: true, G: false, B: false }, parsel: { genislik: 208, yukseklik: 120 } });
    expect(k("cim_agacli")).toMatchObject({ zeminTuru: "agac", baglanti: null });
    expect(k("iskele_boy2")).toMatchObject({ grup: "bindirme", oyunTurleri: ["iskele"], boy: 2 });
    expect(k("araba_mor")).toMatchObject({ grup: "arac", yon: "G", yalin: false });
    expect(k("park_seridi")).toMatchObject({ grup: "zemin", zeminTuru: "park", parsel: { genislik: 455, yukseklik: 269 } });
  });
});

describe("turSprite", () => {
  const m = izoManifestFiksturu();

  it("turSprite_boy_1_4_her_tur_icin_cokmez", () => {
    for (const tur of SEKTOR_TURLERI) {
      for (const boy of BOYLAR) {
        const s = turSprite(m, tur, boy, `firma-${tur}`);
        expect(s.yalin).toBe(true);
        expect(s.insanli).toBe(false);
        expect(s.boy).not.toBeNull();
      }
    }
  });

  it("monoton_boy_artinca_varyant_indeksi_azalmaz", () => {
    for (const tur of [...SEKTOR_TURLERI, "lonca", "olmayan_tur_xyz"]) {
      let onceki = 0;
      for (const boy of BOYLAR) {
        const b = turSprite(m, tur, boy, "k1").boy!;
        expect(b).toBeGreaterThanOrEqual(onceki);
        onceki = b;
      }
    }
    // delikli merdiven: boy 2 yok -> boy 2 isteği en yakın küçüğe (1) düşer, boy 3 kendisi
    const delikli: SpriteManifesti = { ...m, kayitlar: m.kayitlar.filter((k) => !(k.grup === "imalat" && k.boy === 2)) };
    expect(BOYLAR.map((b) => turSprite(delikli, "kola", b, "x").boy)).toEqual([1, 1, 3, 4]);
    // en küçüğün altı: yalnız boy 2 ve 3 var, boy 1 isteği en küçüğe (2) düşer
    const ustten: SpriteManifesti = { ...m, kayitlar: m.kayitlar.filter((k) => !(k.grup === "imalat" && (k.boy === 1 || k.boy === 4))) };
    expect(BOYLAR.map((b) => turSprite(ustten, "kola", b, "x").boy)).toEqual([2, 2, 3, 3]);
  });

  it("tek_varyantli_grup_her_boyda_ayni_sprite_ve_boy4_iki_parsel", () => {
    const lonca = BOYLAR.map((b) => turSprite(m, "lonca", b, "k"));
    expect(new Set(lonca.map((s) => s.ad)).size).toBe(1);
    expect(lonca[0]!.ad).toBe("lonca_boy1");
    for (const tur of ["tarla_bugday", "kola", "market", "lojistik"]) {
      expect(turSprite(m, tur, 4, "k").parselSayisi).toBe(2);
      for (const b of [1, 2, 3] as const) expect(turSprite(m, tur, b, "k").parselSayisi).toBe(1);
    }
  });

  it("ayni_kimlik_ayni_alternatif_boy_degisse_de", () => {
    // hizmet'te her boyda 3 alternatif
    const ek: SpriteKaydi[] = [];
    for (const k of m.kayitlar.filter((x) => x.grup === "hizmet" && x.boy !== null && !x.insanli)) {
      for (const sonek of ["b", "c"]) ek.push({ ...k, ad: `${k.ad}_${sonek}` });
    }
    const cok: SpriteManifesti = { ...m, kayitlar: [...m.kayitlar, ...ek] };
    const kimlikler = Array.from({ length: 40 }, (_, i) => `firma-${i}`);
    const indeks = new Set<number>();
    for (const kimlik of kimlikler) {
      const sirali = (boy: 1 | 2 | 3 | 4): string[] => cok.kayitlar.filter((k) => k.grup === "hizmet" && k.boy === boy && !k.insanli).map((k) => k.ad).sort();
      for (const boy of BOYLAR) {
        const s = turSprite(cok, "ulasim", boy, kimlik);
        expect(s.boy).toBe(boy);
        const i = sirali(boy).indexOf(s.ad);
        expect(i).toBe(fnv1a(kimlik) % 3);
        indeks.add(i);
        expect(turSprite(cok, "ulasim", boy, kimlik).ad).toBe(s.ad); // tekrar: aynı
      }
    }
    expect(indeks.size).toBe(3); // hash gerçekten dağıtıyor
  });

  it("bilinmeyen_tur_gruba_sonra_genele_duser", () => {
    // bilinmeyen tür -> hizmet
    expect(turSprite(m, "olmayan_tur_xyz", 2, "x").grup).toBe("hizmet");
    // hizmet de yoksa -> genel
    const hizmetsiz: SpriteManifesti = { ...m, kayitlar: m.kayitlar.filter((k) => k.grup !== "hizmet") };
    expect(turSprite(hizmetsiz, "olmayan_tur_xyz", 2, "x").grup).toBe("genel");
    // bilinen tür, grubu yok -> genel
    const imalatsiz: SpriteManifesti = { ...m, kayitlar: m.kayitlar.filter((k) => k.grup !== "imalat") };
    expect(turSprite(imalatsiz, "kola", 3, "x").grup).toBe("genel");
    // hiç aday yoksa açık hata (sessiz yanlış sprite değil)
    const bos: SpriteManifesti = { ...m, kayitlar: m.kayitlar.filter((k) => k.grup === "zemin") };
    expect(() => turSprite(bos, "kola", 1, "x")).toThrow("spriteManifest:aday-yok");
  });

  it("insanli_kayit_hicbir_zaman_secilmez", () => {
    // fikstürdeki insanli kayıt oyunTurleri ["eglence"] taşır; yine de seçilmez
    for (const b of BOYLAR) expect(turSprite(m, "eglence", b, "k").insanli).toBe(false);
  });

  it("oyunTurleri_eslesmesi_gruptan_once_gelir", () => {
    const ozel = { ...m.kayitlar.find((k) => k.ad === "hizmet_boy2")!, ad: "ozel_okul", grup: "ozel", oyunTurleri: ["okul"] };
    const mm: SpriteManifesti = { ...m, kayitlar: [...m.kayitlar, ozel] };
    expect(turSprite(mm, "okul", 2, "x").ad).toBe("ozel_okul");
    expect(turSprite(mm, "okul", 3, "x").ad).toBe("ozel_okul"); // en yakın küçük, tür havuzunda kalır
    expect(turSprite(mm, "eglence", 2, "x").ad).toBe("hizmet_boy2");
  });
});

describe("zemin, bindirme, tekil", () => {
  const m = izoManifestFiksturu();

  it("zeminSprite_bulunmazsa_null", () => {
    expect(zeminSprite(m, "olmayan-zemin")).toBeNull();
    expect(zeminSprite(m, "yol-duz", { K: true, D: true, G: true, B: true })).toBeNull(); // bu bağlantıda düz yol yok
    expect(zeminSprite(m, "cim")?.zeminTuru).toBe("cim");
    expect(zeminSprite(m, "yol-duz", { K: false, D: true, G: false, B: true })?.ad).toBe("yol_duz_dogu_bati");
    expect(zeminSprite(m, "yol-kose", { K: true, D: true, G: false, B: false })?.ad).toBe("yol_kose_KD");
    expect(zeminSprite(m, "yol-ana-t", { K: false, D: true, G: true, B: true })?.ad).toBe("yol-ana_t_kapali_K");
  });

  it("zemin_turlerinin_hepsi_fikstürde_var", () => {
    for (const t of ["yol-duz", "yol-kavsak", "yol-t", "yol-kose", "yol-sonu", "yol-ana-duz", "kaldirim", "cim", "agac", "arsa", "park", "nehir", "cimen", "otopark", "konut"]) {
      expect(zeminSprite(m, t), t).not.toBeNull();
    }
  });

  it("bindirmeSprite_parsel_sayisina_gore", () => {
    expect(bindirmeSprite(m, "iskele", 1)?.boy).toBe(3); // en büyük tek parsel boyu
    expect(bindirmeSprite(m, "iskele", 2)?.boy).toBe(4);
    expect(bindirmeSprite(m, "tahtali", 2)?.parselSayisi).toBe(2);
    expect(bindirmeSprite(m, "iskele", 1, 2)?.ad).toBe("iskele_boy2");
    expect(bindirmeSprite(m, "iskele", 2, 2)).toBeNull();
    const yalnizTek: SpriteManifesti = { ...m, kayitlar: m.kayitlar.filter((k) => k.parselSayisi === 1 || k.grup !== "bindirme") };
    expect(bindirmeSprite(yalnizTek, "iskele", 2)).toBeNull();
  });

  it("tekilSprite_boysuz_yalin_kayitlar", () => {
    const k = (ad: string, ek: Partial<SpriteKaydi>): SpriteKaydi => ({ ...m.kayitlar.find((x) => x.ad === "genel_bina")!, ad, boy: null, grup: "konut", oyunTurleri: ["konut"], ...ek });
    const mm: SpriteManifesti = { ...m, kayitlar: [...m.kayitlar, k("ev_a", {}), k("ev_b", {}), k("ev_insanli", { insanli: true })] };
    expect(tekilSprite(m, "konut", "x")).toBeNull();
    const secilenler = new Set(Array.from({ length: 30 }, (_, i) => tekilSprite(mm, "konut", `h${i}`)!.ad));
    expect([...secilenler].sort()).toEqual(["ev_a", "ev_b"]);
    expect(tekilSprite(mm, "konut", "h1")!.ad).toBe(tekilSprite(mm, "konut", "h1")!.ad);
  });
});

describe.skipIf(!GERCEK_VAR)("gercek sprite seti (public/oyun-sprite)", () => {
  const hamGercek = (): { girdiler: Record<string, unknown>[]; zemin_karosu: { piksel: [number, number] } } => JSON.parse(fs.readFileSync(path.join(YAYIN, "manifest.json"), "utf8"));
  const m = GERCEK_VAR ? manifestCoz(hamGercek()) : izoManifestFiksturu();
  const dosyalar = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? dosyalar(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it("manifest_cozulur_karo_30_derece", () => {
    expect(m.parselKaro).toEqual({ genislik: 208, yukseklik: 120 });
    expect(m.zeminKaro).toEqual({ genislik: 55, yukseklik: 32 });
    expect(SPRITE_YOLU).toBe("/oyun-sprite/");
    // gerçek 30 derece: iki karo da aynı izometri açısında, oran 2:1 değil
    expect(m.parselKaro.genislik / m.parselKaro.yukseklik).toBeCloseTo(Math.sqrt(3), 1);
    expect(m.zeminKaro.genislik / m.zeminKaro.yukseklik).toBeCloseTo(Math.sqrt(3), 1);
  });

  it("yol_orani_k5_goreli_olcek_korunur", () => {
    // K5: zemin karosu / yapı padı ~0,26 (kaynakta pad ~3,8 karo); 0,2-0,35 arası
    expect(m.yolOrani).toBeGreaterThan(0.2);
    expect(m.yolOrani).toBeLessThan(0.35);
    expect(m.yolOrani).toBeCloseTo(m.zeminKaro.genislik / m.parselKaro.genislik, 9);
    // zemin sprite'ları gerçekten zemin karosu boyutunda (büyütülmemiş): yol karosu genişliği ~ zeminKaro + kenar payı
    for (const k of m.kayitlar.filter((x) => x.zeminTuru?.startsWith("yol"))) {
      expect(k.genislik, k.ad).toBeLessThan(m.zeminKaro.genislik * 1.3);
      expect(k.parsel.genislik / k.parsel.yukseklik, k.ad).toBeCloseTo(m.zeminKaro.genislik / m.zeminKaro.yukseklik, 0);
    }
  });

  it("her_sprite_dosyasi_diskte_var", () => {
    for (const k of m.kayitlar) expect(fs.existsSync(path.join(YAYIN, k.dosya)), k.dosya).toBe(true);
  });

  it("ankraj_kutunun_icinde", () => {
    // bindirmenin ankrajı bindirme kutusunun altında kalır (pad köşesine göre): kutu dışı olabilir
    for (const k of m.kayitlar.filter((x) => x.grup !== "bindirme")) {
      expect(k.ankraj.x, k.ad).toBeGreaterThanOrEqual(0);
      expect(k.ankraj.x, k.ad).toBeLessThanOrEqual(k.genislik + 1);
      expect(k.ankraj.y, k.ad).toBeGreaterThanOrEqual(0);
      expect(k.ankraj.y, k.ad).toBeLessThanOrEqual(k.yukseklik + 1);
    }
  });

  it("tum_binalar_ayni_parsel_karosu_orani", () => {
    // 2:1 DEĞİL: gerçek 30 derece izometri, oran manifest karosundan gelir (104/60); tüm yapı parselleri bu elmas oranında
    const oran = m.parselKaro.genislik / m.parselKaro.yukseklik;
    const yapilar = m.kayitlar.filter((k) => k.yalin && k.grup !== "bindirme");
    expect(yapilar.length).toBeGreaterThan(40);
    for (const k of yapilar) expect(k.parsel.genislik / k.parsel.yukseklik, k.ad).toBeCloseTo(oran, 1);
    // ölçek tutarlılığı: yapı padı bir karo genişliğine yakın (üretilenler 1.0, kesimler 0.75-1.0)
    for (const k of yapilar) {
      expect(k.parsel.genislik / m.parselKaro.genislik, k.ad).toBeGreaterThan(0.7);
      expect(k.parsel.genislik / m.parselKaro.genislik, k.ad).toBeLessThan(1.1);
    }
  });

  it("her_isletme_turunun_tur_eslemesinde_acik_satiri_var", () => {
    const md = fs.readFileSync(path.join(YAYIN, "tur_eslemesi.md"), "utf8");
    const satirlar = md
      .split("\n")
      .filter((s) => s.startsWith("|"))
      .map((s) => s.split("|").map((h) => h.trim()))
      .map((h) => ({ tur: h[1]!, sprite: h[3] ?? "" }));
    const adlar = new Set(m.kayitlar.map((k) => k.ad));
    for (const tur of SEKTOR_TURLERI) {
      const s = satirlar.find((x) => x.tur === tur);
      expect(s, `${tur}: tur_eslemesi.md satiri yok`).toBeDefined();
      // paylaşımlı eşleme meşru: yalnız satırdaki sprite adları manifestte var mı
      for (const ad of s!.sprite.split(",").map((x) => x.trim())) expect(adlar.has(ad), `${tur} -> ${ad}`).toBe(true);
      // tür-özel sprite (boy'suz) varsa satırdaki sprite'tır; ve her tür her boyda çözülür
      const ozel = tekilSprite(m, tur, "x");
      if (ozel) expect(s!.sprite.split(",").map((x) => x.trim())).toContain(ozel.ad);
      for (const boy of BOYLAR) expect(() => turSprite(m, tur, boy, "x"), `${tur} boy ${boy}`).not.toThrow();
    }
    // ahir/belediye/lonca işletme-dışı oyun turleri: manifestte oyunTurleri olarak ayrı doğrulanır
    for (const oyunTuru of ["ahir", "belediye", "lonca"]) {
      expect(m.kayitlar.some((k) => k.oyunTurleri.includes(oyunTuru)), oyunTuru).toBe(true);
      expect(turSprite(m, oyunTuru, 4, "x").oyunTurleri, oyunTuru).toContain(oyunTuru);
    }
  });

  it("sehir_kurumlari_ayri_tekil_sprite_lojistik_firmasi_gemili_liman_gormez", () => {
    // Liman ve İhracat şehir kurumudur (firma değil): kendi tekil sprite'ları var; lojistik firması boy 1-4 merdivenini kullanır, gemili limanı değil.
    expect(tekilSprite(m, "liman", "x")?.ad).toBe("liman");
    expect(tekilSprite(m, "ihracat", "x")?.ad).toBe("gumruk");
    expect(tekilSprite(m, "lojistik", "x")).toBeNull();
    for (const boy of BOYLAR) expect(turSprite(m, "lojistik", boy, "x").ad).toBe(`lojistik_boy${boy}`);
    expect(turSprite(m, "lojistik", 4, "x").parselSayisi).toBe(2);
    const liman = m.kayitlar.find((k) => k.ad === "liman")!;
    expect(liman.oyunTurleri).toEqual(["liman"]);
    expect(m.kayitlar.find((k) => k.ad === "gumruk")!.oyunTurleri).toEqual(["ihracat"]);
    const md = fs.readFileSync(path.join(YAYIN, "tur_eslemesi.md"), "utf8");
    expect(md).toMatch(/\| liman \(sehir kurumu[^|]*\| - \| liman \|/);
    expect(md).toMatch(/\| ihracat \(sehir kurumu[^|]*\| - \| gumruk \|/);
  });

  it("buyume_merdiveni_dort_grup_dort_boy_boy4_iki_parsel", () => {
    for (const g of ["hammadde", "imalat", "hizmet", "lojistik"]) {
      for (const b of BOYLAR) {
        const k = m.kayitlar.find((x) => x.grup === g && x.boy === b && x.yalin);
        expect(k, `${g} boy ${b}`).toBeDefined();
        expect(k!.parselSayisi).toBe(b === 4 ? 2 : 1);
      }
    }
  });

  it("zemin_ve_bindirme_seti_tamam", () => {
    for (const t of ["yol-duz", "yol-kavsak", "yol-t", "yol-kose", "yol-sonu", "yol-ana-duz", "yol-ana-kavsak", "kaldirim", "cim", "agac", "arsa", "park", "nehir", "cimen", "otopark"]) {
      expect(zeminSprite(m, t), t).not.toBeNull();
    }
    // yol-t: bağlantıdan dört dönük de bulunur
    for (const s of ["KDG", "DGB", "GBK", "BKD"]) {
      expect(zeminSprite(m, "yol-t", { K: s.includes("K"), D: s.includes("D"), G: s.includes("G"), B: s.includes("B") }), s).not.toBeNull();
    }
    for (const t of ["iskele", "tahtali"] as const) expect(bindirmeSprite(m, t, 1), t).not.toBeNull();
  });

  it("public_oyun_sprite_5MBi_asmaz", () => {
    const toplam = dosyalar(YAYIN).reduce((a, f) => a + fs.statSync(f).size, 0);
    expect(toplam).toBeLessThanOrEqual(SPRITE_BOYUT_SINIRI);
  });

  it("insanli_klasoru_yayinda_yok", () => {
    expect(fs.existsSync(path.join(YAYIN, "insanli"))).toBe(false);
    expect(dosyalar(YAYIN).some((f) => f.includes(`${path.sep}insanli${path.sep}`) || /insanli/i.test(path.basename(f)))).toBe(false);
    expect(hamGercek().girdiler.some((g) => g.insanli === true)).toBe(false);
    expect(m.kayitlar.every((k) => !k.insanli)).toBe(true);
  });

  it("yayinda_yalnizca_manifestteki_png_ler_var", () => {
    const beklenen = new Set(m.kayitlar.map((k) => path.join(YAYIN, k.dosya)));
    for (const f of dosyalar(YAYIN).filter((x) => x.endsWith(".png"))) expect(beklenen.has(f), f).toBe(true);
  });
});
