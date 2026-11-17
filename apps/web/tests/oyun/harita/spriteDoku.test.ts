import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IZO_STILI } from "@/oyun/harita/haritaStili";
import { dokuButcesiBayt, SpriteDokuYukleyici, spriteDokuKaynakcisi } from "@/oyun/harita/spriteDoku";
import { manifestCoz, type SpriteKaydi } from "@/oyun/harita/spriteManifest";
import { izoManifestFiksturu } from "./fikstur/izoManifest";

const secenekler = vi.hoisted(() => [] as unknown[]);
vi.mock("pixi.js", async () => {
  const sahte = await import("./pixiSahte");
  class ImageSource extends sahte.ImageSource {
    constructor(o?: unknown) { super(o); secenekler.push(o); }
  }
  return { ...sahte.pixiSahteFabrikasi(), ImageSource };
});

const kayit = (dosya: string): SpriteKaydi => ({
  ad: dosya, dosya, genislik: 10, yukseklik: 10, ankraj: { x: 5, y: 9 }, parsel: { genislik: 10, yukseklik: 6 }, kaynak: "uretim", insanli: false, oyunTurleri: [], grup: "genel",
  boy: 1, parselSayisi: 1, yalin: true, zeminTuru: null, baglanti: null,
});
const bekle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("SpriteDokuYukleyici", () => {
  it("ayni_dosya_tek_doku_ve_tek_istek", async () => {
    const dokuYap = vi.fn(async (k: { url: string }) => ({ url: k.url }));
    const y = new SpriteDokuYukleyici({ dokuYap });
    const [a, b] = await Promise.all([y.doku(kayit("a.png")), y.doku(kayit("a.png"))]);
    expect(a).toBe(b);
    expect(dokuYap).toHaveBeenCalledTimes(1);
    expect(dokuYap.mock.calls[0]![0]).toEqual({ url: "/oyun-sprite/a.png" });
  });

  it("hata_onbellekten_dusurulur_tekrar_denenir", async () => {
    const dokuYap = vi.fn().mockRejectedValueOnce(new Error("404")).mockResolvedValue({ url: "x" });
    const y = new SpriteDokuYukleyici({ dokuYap });
    await expect(y.doku(kayit("a.png"))).rejects.toThrow("404");
    await expect(y.doku(kayit("a.png"))).resolves.toEqual({ url: "x" });
  });

  it("yoket_sonrasi_gec_cozulen_doku_hemen_yok_edilir", async () => {
    let coz!: (v: { id: number }) => void;
    const yoket = vi.fn();
    const y = new SpriteDokuYukleyici<{ id: number }>({ dokuYap: () => new Promise((r) => { coz = r; }), dokuYoket: yoket });
    const p = y.doku(kayit("a.png"));
    y.yoket();
    const d = { id: 1 };
    coz(d);
    await p;
    expect(yoket).toHaveBeenCalledWith(d);
  });

  it("yoket_cozulmus_dokulari_emekliye_ayirip_yok_eder", async () => {
    const yoket = vi.fn();
    const y = new SpriteDokuYukleyici<{ id: number }>({ dokuYap: async () => ({ id: 1 }), dokuYoket: yoket });
    const d = await y.doku(kayit("a.png"));
    y.yoket();
    expect(yoket).toHaveBeenCalledWith(d);
  });

  it("emekliyiAt_kullanimdakini_korur", async () => {
    const yoket = vi.fn();
    const y = new SpriteDokuYukleyici<{ id: number }>({ dokuYap: async (k) => ({ id: k.url.length }), dokuYoket: yoket });
    const a = await y.doku(kayit("a.png"));
    const b = await y.doku(kayit("bb.png"));
    y.emekliyeAyir("a.png");
    y.emekliyeAyir("bb.png");
    y.emekliyiAt(new Set([a]));
    await bekle();
    expect(yoket).toHaveBeenCalledTimes(1);
    expect(yoket).toHaveBeenCalledWith(b);
    expect(a).toBeDefined();
  });

  it("mipmap_acik_sprite_dokulari_mipmapli_ve_dogrusal_yuklenir", async () => {
    class Resim { decoding = ""; src = ""; async decode(): Promise<void> {} }
    vi.stubGlobal("Image", Resim);
    secenekler.length = 0;
    expect(IZO_STILI.performans.mipmap).toBe(true);
    await spriteDokuKaynakcisi().doku(kayit("a.png"));
    expect(secenekler).toHaveLength(1);
    expect(secenekler[0]).toMatchObject({ autoGenerateMipmaps: true, scaleMode: "linear", mipmapFilter: "linear", resolution: 1 });
    vi.unstubAllGlobals();
  });
});

describe("doku bütçesi", () => {
  const MB = 1024 * 1024;
  it("doku_butcesi_sinirin_altinda_gercek_set", () => {
    const ham = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/oyun-sprite/manifest.json"), "utf8")) as unknown;
    const m = manifestCoz(ham);
    const bayt = dokuButcesiBayt(m.kayitlar, IZO_STILI.performans.mipmap);
    expect(bayt).toBeGreaterThan(5 * MB); // gerçek set okunuyor (boş değil)
    expect(bayt / MB).toBeLessThanOrEqual(IZO_STILI.performans.dokuButcesiMB);
  });

  it("doku_butcesi_fikstur_boyutlariyla_hesaplanir_ve_ayni_dosya_bir_kez_sayilir", () => {
    const ks = izoManifestFiksturu().kayitlar;
    const tek = dokuButcesiBayt(ks, false);
    const kopya = dokuButcesiBayt([...ks, ...ks], false);
    expect(kopya).toBe(tek);
    const el = ks.reduce((t, k, i, a) => (a.findIndex((x) => x.dosya === k.dosya) === i ? t + k.genislik * k.yukseklik * 4 : t), 0);
    expect(tek).toBe(el);
    expect(dokuButcesiBayt(ks, true)).toBeCloseTo((el * 4) / 3, -2);
  });
});
