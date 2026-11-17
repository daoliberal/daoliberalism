/* eslint-disable @typescript-eslint/no-explicit-any -- pixi sahteleri */
import fs from "node:fs";
import path from "node:path";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adlandirici } from "@/oyun/harita/adlar";
import { IZO_RENGI, IZO_STILI, SEHIR_RENGI } from "@/oyun/harita/haritaStili";
import { hucredenEkrana } from "@/oyun/harita/izometri";
import { binaVurusAlani, IzoCizimi } from "@/oyun/harita/izoCizimi";
import type { Gecis, GorselDurum } from "@/oyun/harita/izoDurum";
import { izoSahneKur, type IzoSahne } from "@/oyun/harita/izoSahne";
import { sehirSahnesi, type SehirSahnesiBaglami } from "@/oyun/harita/sehirSahnesi";
import { SpriteDokuYukleyici, type SpriteDokuKaynakcisi } from "@/oyun/harita/spriteDoku";
import type { SpriteKaydi } from "@/oyun/harita/spriteManifest";
import { MEYDAN_REF, type HaritaDurumu, type HaritaFirmaSatiri, type HaritaVerisi, type HaritaRef } from "@/oyun/harita/tipler";
import type { HoldingsLonca, WeekPacket } from "@/oyun/sim/types";
import { packetOf } from "../helpers/fakeLiveServer";
import { izoManifestFiksturu } from "./fikstur/izoManifest";
import { kayit, sahteSifirla, yapApp } from "./pixiSahte";

vi.mock("pixi.js", async () => (await import("./pixiSahte")).pixiSahteFabrikasi());

const m = izoManifestFiksturu();
const TOK: Record<string, string> = {};
const G = { x: 0, y: 0, olcek: 1 };
const adlar = adlandirici();
const kok = (): Element => document.documentElement;
const tex = (dosya = "x") => ({ width: 200, height: 200, dosya }) as any;
const bekle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

const lonca = (ref: string, members = 5): HoldingsLonca => ({ ref, owner: "player", members, fee: null, capital: null, deposits: null, credit_out: null, equity: null });
const paketOf = (loncaSayisi = 3): WeekPacket => ({ ...packetOf("r", 20, 1), holdings: { loncas: Array.from({ length: loncaSayisi }, (_, i) => lonca(`lonca${i}`, 5 + i * 20)) } as WeekPacket["holdings"] });
const TURLER = ["market", "un", "tarla_bugday", "lojistik", "okul", "maden_komur", "eglence", "restoran"];
const firma = (i: number, durum: HaritaDurumu = "uretim", calisan = 2 + ((i * 7) % 60)): HaritaFirmaSatiri => [`f${i}`, TURLER[i % TURLER.length]!, 0, calisan, null, "npc", null, durum];
const verisi = (n: number, durum: HaritaDurumu = "uretim"): HaritaVerisi => ({ hafta: 20, firmalar: Array.from({ length: n }, (_, i) => firma(i, durum)) });
const ctxOf = (ek: Partial<SehirSahnesiBaglami> = {}): SehirSahnesiBaglami => ({ runId: "kosu-1", sehirAdlari: ["A", "B"], sehir: 0, katman: "yok", izo: true, parselSecilebilir: true, ...ek });
const kur = (n: number, ek: Partial<SehirSahnesiBaglami> = {}, v: HaritaVerisi = verisi(n)): IzoSahne =>
  izoSahneKur(sehirSahnesi(paketOf(3), v, ctxOf(ek)), m, "t1", (_, b) => b);
/** İzo sahnenin klasik kaynağını değiştirir (katman, ilan, ben vb. kaynaktan okunur). */
const kaynakla = (s: IzoSahne, ek: Record<string, unknown>): IzoSahne => ({ ...s, kaynak: { ...s.kaynak, ...ek } as IzoSahne["kaynak"] });

const dokuSahte = (): SpriteDokuKaynakcisi & { doku: ReturnType<typeof vi.fn> } => ({ doku: vi.fn(async (s: SpriteKaydi) => tex(s.dosya)) });

let c: IzoCizimi;
const yap = (dokular: SpriteDokuKaynakcisi = dokuSahte(), tikla: (r: HaritaRef) => void = () => {}, hata: (e: unknown) => void = () => {}, man = m): IzoCizimi => {
  c = new IzoCizimi(kayit.app, tikla, dokular, kok, hata, man);
  return c;
};
/** govde katmanları: zemin, dolgu, yer, plaka, bina, halka, rozet, etiket. */
const kat = (cz: IzoCizimi = c) => {
  const g = (cz.dunya.children[0] as any).children;
  return { zemin: g[0], dolgu: g[1], yer: g[2], plaka: g[3], bina: g[4], halka: g[5], rozet: g[6], etiket: g[7], govde: cz.dunya.children[0] as any };
};
const kapOf = (id: string, cz: IzoCizimi = c): any => kat(cz).bina.children.find((k: any) => k.label === `b:${id}`);
const dolu = (g: any, renk: unknown): boolean => g.calls.some((x: any[]) => x[0] === "fill" && (x[1] === renk || x[1]?.color === renk));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  sahteSifirla();
  for (const k of Object.keys(TOK)) delete TOK[k];
  kayit.app = yapApp(vi);
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ getPropertyValue: (n: string) => TOK[n] ?? `v:${n}` }) as never);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("binaVurusAlani", () => {
  const sp: SpriteKaydi = {
    ad: "x", dosya: "x.png", genislik: 209, yukseklik: 200, ankraj: { x: 104, y: 199 }, parsel: { genislik: 208, yukseklik: 120 }, kaynak: "uretim", insanli: false,
    oyunTurleri: [], grup: "genel", boy: 1, parselSayisi: 1, yalin: true, zeminTuru: null, baglanti: null,
  };
  const icinde = (pts: number[], x: number, y: number): boolean => {
    let ic = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      if (pts[i + 1]! > y !== pts[j + 1]! > y && x < ((pts[j]! - pts[i]!) * (y - pts[i + 1]!)) / (pts[j + 1]! - pts[i + 1]!) + pts[i]!) ic = !ic;
    }
    return ic;
  };

  it("binaVurusAlani_ust_saydam_kose_disarida", () => {
    const o = 0.5;
    const a = { x: 300, y: 400 };
    const p = binaVurusAlani(a, sp, o);
    // sprite kutusunun sol üst köşesi (saydam) dışarıda
    expect(icinde(p, a.x - 104 * o + 2, a.y - 199 * o + 2)).toBe(false);
    expect(icinde(p, a.x + 104 * o - 4, a.y - 199 * o + 2)).toBe(false);
    // gövde ortası ve parsel elması içeride
    expect(icinde(p, a.x, a.y - 150 * o)).toBe(true);
    expect(icinde(p, a.x, a.y - 60 * o)).toBe(true);
    expect(icinde(p, a.x, a.y - 3)).toBe(true);
    // elmasın dışındaki alt köşeler dışarıda
    expect(icinde(p, a.x - 100 * o, a.y - 3)).toBe(false);
  });

  it("iki_parsellik_sprite_ayak_izi_iki_hucreyi_kapsar", () => {
    const iki = { ...sp, parselSayisi: 2 as const, genislik: 313 };
    const o = 0.5;
    const a = { x: 0, y: 0 };
    const p = binaVurusAlani(a, iki, o);
    // ankrajın hemen üstü (genişleme parseli) ve bir hücre geri (ana parsel) içeride
    expect(icinde(p, 0, -20)).toBe(true);
    expect(icinde(p, 52, -60)).toBe(true);
  });
});

describe("IzoCizimi katmanlar ve zemin", () => {
  it("katman_sirasi_zemin_dolgu_yer_plaka_bina_halka_rozet_etiket_ben_hover", () => {
    yap().guncelle(kur(6), null, G, 0, adlar);
    const k = kat();
    expect(k.govde.children).toHaveLength(11); // + ben nabız halkası, hover parlaması, olay balonları (en üstte)
    expect(k.bina.sortableChildren).toBe(true);
    expect(k.zemin.isRenderGroup).toBe(true);
  });

  it("govde_kaydirmayi_dunya_kameradan_ayri_tutar", () => {
    const s = kur(6);
    yap().guncelle(s, null, { x: 10, y: 20, olcek: 2 }, 0, adlar);
    expect(kat().govde.position.x).toBe(s.kaydirma.x);
    expect(kat().govde.position.y).toBe(s.kaydirma.y);
    expect(c.dunya.position.x).toBe(10);
    expect((c.dunya.scale as any).v).toBe(2);
  });

  it("zemin_cerceve_yol_blok_ve_her_parselin_altini_dosemeli_bosluk_birakmaz", async () => {
    const s = kur(10);
    yap().guncelle(s, null, G, 0, adlar);
    await bekle();
    const zeminSpr = kat().zemin.children.flatMap((x: any) => (x.children?.length ? x.children : [x]));
    const sayilan = zeminSpr.filter((x: any) => x.anchor !== undefined);
    // her parsel için tek pişirilmiş sprite (altı boşluksuz döşeli: 16 kaldırım karosu pişirmede); yol, çerçeve ve blok karoları tek tek
    expect(sayilan.length).toBe(s.zemin.yollar.length + s.zemin.cerceve.length + s.zemin.cerceve.filter((x) => x.tur === "agac").length + s.zemin.blokZemini.length + s.zemin.parselZemini.length + s.zemin.seritler.reduce((t, sr) => t + sr.parcalar.length, 0));
    const pisirilmis = kayit.bake.find((b) => b.target.children.length >= 9);
    expect(pisirilmis).toBeDefined();
    expect(pisirilmis.target.children.length).toBeGreaterThanOrEqual(9); // parsel başına en az 9 kaldırım karosu pişirildi
  });

  it("serit_sprite_lari_cerceveye_maskelenir", () => {
    yap().guncelle(kur(10), null, G, 0, adlar);
    const maskeliler = kat().zemin.children.filter((x: any) => x.mask);
    expect(maskeliler.length).toBeGreaterThanOrEqual(1);
    expect(kat().zemin.children.includes(maskeliler[0].mask)).toBe(true);
  });

  it("zemin_sprite_yoksa_graphics_yedegi_cokmez", () => {
    const bos = { ...m, kayitlar: m.kayitlar.filter((k) => k.grup !== "zemin" && k.grup !== "bindirme") };
    TOK[IZO_RENGI.cim] = "cim-renk";
    TOK[IZO_RENGI.asfalt] = "asfalt-renk";
    const s = izoSahneKur(sehirSahnesi(paketOf(3), verisi(8), ctxOf()), bos, "t1", (_, b) => b);
    yap(dokuSahte(), () => {}, () => {}, bos);
    expect(() => c.guncelle(s, null, G, 0, adlar)).not.toThrow();
    expect(kayit.graphics.some((g) => dolu(g, "cim-renk"))).toBe(true);
    expect(kayit.graphics.some((g) => dolu(g, "asfalt-renk"))).toBe(true);
  });

  it("ayni_sahne_ikinci_guncellemede_zemin_yeniden_kurulmaz_tema_degisince_kurulur", () => {
    const s = kur(8);
    yap().guncelle(s, null, G, 0, adlar);
    const once = kayit.sprites.length;
    c.guncelle(kur(8), null, G, 0, adlar);
    expect(kayit.sprites.length).toBe(once);
    c.guncelle(s, null, G, 1, adlar);
    expect(kayit.sprites.length).toBeGreaterThan(once);
  });

  it("tema_degisince_yedek_renkler_yeniden_okunur", () => {
    const bos = { ...m, kayitlar: m.kayitlar.filter((k) => k.grup !== "zemin") };
    const s = izoSahneKur(sehirSahnesi(paketOf(3), verisi(4), ctxOf()), bos, "t1", (_, b) => b);
    TOK[IZO_RENGI.cim] = "ilk";
    yap(dokuSahte(), () => {}, () => {}, bos).guncelle(s, null, G, 0, adlar);
    TOK[IZO_RENGI.cim] = "ikinci";
    c.guncelle(s, null, G, 1, adlar);
    expect(kayit.graphics.some((g) => dolu(g, "ikinci"))).toBe(true);
  });
});

describe("IzoCizimi binalar", () => {
  it("zindex_derinlik_sirasinda", () => {
    const s = kur(12);
    yap().guncelle(s, null, G, 0, adlar);
    for (const b of s.binalar) expect(kapOf(b.id).zIndex, b.id).toBe(b.z);
    const sirali = s.binalar.map((b) => b.z);
    expect(sirali).toEqual([...sirali].sort((a, b) => a - b));
  });

  it("bina_sprite_olcek_ankraj_ve_konumu_manifestten", async () => {
    const s = kur(4);
    yap().guncelle(s, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar); // hepsi görünür
    await bekle();
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    const sp = kapOf(b.id).children[0];
    expect(sp.scale.v).toBe(s.olcek);
    expect(sp.anchor.x).toBeCloseTo(b.sprite.ankraj.x / b.sprite.genislik);
    expect(sp.anchor.y).toBeCloseTo(b.sprite.ankraj.y / b.sprite.yukseklik);
    expect(sp.position.x).toBe(b.ankraj.x);
    expect(sp.position.y).toBe(b.ankraj.y);
    expect(sp.texture).not.toBeNull();
  });

  it("dolgu_zemin_gruplu_olanlar_dolgu_katmaninda_bina_gibi_olanlar_zindexli_bina_katmaninda", () => {
    const s = kur(10);
    yap().guncelle(s, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    const zeminli = s.dolgu.filter((d) => d.sprite?.grup === "zemin");
    const binaLi = s.dolgu.filter((d) => d.sprite && d.sprite.grup !== "zemin");
    expect(zeminli.length + binaLi.length).toBeGreaterThan(0);
    for (const d of zeminli) expect(kat().dolgu.children.some((x: any) => x.label === `d:${d.parselId}`), d.parselId).toBe(true);
    for (const d of binaLi) expect(kat().bina.children.find((x: any) => x.label === `d:${d.parselId}`)?.zIndex, d.parselId).toBe(d.z);
  });

  it("kapali_isletme_tahtali_bindirme_alir", () => {
    const s = kur(3, {}, verisi(3, "kapali"));
    yap().guncelle(s, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    const b = s.binalar.find((x) => x.kapali)!;
    expect(b).toBeDefined();
    expect(kapOf(b.id).children.filter((x: any) => x.anchor)).toHaveLength(2);
    const acik = kur(3);
    sahteSifirla();
    yap().guncelle(acik, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    expect(kapOf(acik.binalar.find((x) => x.tur === "isletme")!.id).children.filter((x: any) => x.anchor)).toHaveLength(1);
  });

  it("ekran_disi_bina_gizli_ve_yakinlasinca_gorunur", async () => {
    const dokular = dokuSahte();
    const s = kur(40);
    yap(dokular).guncelle(s, null, G, 0, adlar);
    await bekle();
    const gorunur = (): number => kat().bina.children.filter((k: any) => k.visible).length;
    const toplam = kat().bina.children.length;
    expect(gorunur()).toBeGreaterThan(0);
    expect(gorunur()).toBeLessThan(toplam);
    // tembel yükleme: yalnız görünen binaların türleri istendi (gizli binaların yalnız-onlara-ait türleri istenmedi)
    const bina = s.binalar.filter((b) => kapOf(b.id)?.visible);
    const gizliBina = s.binalar.filter((b) => !kapOf(b.id).visible);
    const gorunenDosya = new Set(bina.map((b) => b.sprite.dosya));
    const istenen = new Set(dokular.doku.mock.calls.map((a) => (a[0] as SpriteKaydi).dosya));
    const sadeceGizli = gizliBina.map((b) => b.sprite.dosya).filter((d) => !gorunenDosya.has(d));
    expect(sadeceGizli.length).toBeGreaterThan(0);
    for (const d of sadeceGizli) expect(istenen.has(d), d).toBe(false);
    const gizli = kat().bina.children.find((k: any) => !k.visible);
    // uzaklaştırınca hepsi görünür
    c.guncelle(s, null, { x: 0, y: 0, olcek: 0.02 }, 0, adlar);
    await bekle();
    expect(gorunur()).toBe(toplam);
    expect(gizli.children[0].texture).not.toBeNull();
    for (const d of sadeceGizli) expect(new Set(dokular.doku.mock.calls.map((a) => (a[0] as SpriteKaydi).dosya)).has(d), d).toBe(true);
  });

  it("gorunurluk_gercek_gorunum_kutusunu_kullanir_pixi_screen_i_degil", () => {
    const s = kur(40);
    const gorunur = (): number => kat().bina.children.filter((k: any) => k.visible).length;
    yap().guncelle(s, null, G, 0, adlar, { genislik: 100, yukseklik: 80 }); // küçük gerçek kutu: screen (800x560) değil o esas
    const dar = gorunur();
    expect(dar).toBeLessThan(kat().bina.children.length);
    c.guncelle(s, null, G, 0, adlar, { genislik: 6000, yukseklik: 4000 }); // büyük gerçek kutu: hepsi görünür
    expect(gorunur()).toBeGreaterThan(dar);
    expect(gorunur()).toBe(kat().bina.children.length);
  });

  it("kamera_hareketinde_yalniz_esik_gecenler_yeniden_hesaplanir", () => {
    const s = kur(40);
    yap().guncelle(s, null, G, 0, adlar);
    const n0 = c.gorunurlukHesabi;
    expect(n0).toBeGreaterThanOrEqual(1);
    c.guncelle(s, null, { x: -6, y: 4, olcek: 1 }, 0, adlar);
    c.guncelle(s, null, { x: -12, y: 9, olcek: 1 }, 0, adlar);
    expect(c.gorunurlukHesabi).toBe(n0); // küçük kayma: yeniden hesap yok
    c.guncelle(s, null, { x: -3000, y: -1500, olcek: 1 }, 0, adlar);
    expect(c.gorunurlukHesabi).toBe(n0 + 1);
  });

  it("tiklama_refi_cagirir", () => {
    const tikla = vi.fn();
    const s = kur(4);
    yap(dokuSahte(), tikla).guncelle(s, null, G, 0, adlar);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    kapOf(b.id).h.pointertap[0]();
    expect(tikla).toHaveBeenCalledWith(b.ref);
    expect(kapOf(b.id).eventMode).toBe("static");
    expect(kapOf(b.id).hitArea.contains(b.ankraj.x, b.ankraj.y - 5)).toBe(true);
  });

  it("suruklemeyle_tiklama_olmaz", () => {
    const tikla = vi.fn();
    const s = kur(4);
    yap(dokuSahte(), tikla).guncelle(s, null, G, 0, adlar);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    c.tasidi = true;
    kapOf(b.id).h.pointertap[0]();
    expect(tikla).not.toHaveBeenCalled();
  });

  it("dolgu_ve_zemin_sprite_leri_tiklanmaz", () => {
    yap().guncelle(kur(10), null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    for (const k of kat().bina.children) if (String(k.label).startsWith("d:") || String(k.label).startsWith("g:")) expect(k.eventMode ?? "none").not.toBe("static");
  });

  it("binaKutusu_cizilen_sprite_ile_ayni", () => {
    const s = kur(4);
    yap().guncelle(s, null, G, 0, adlar);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    const k = c.binaKutusu(b);
    const sol = b.ankraj.x + s.kaydirma.x - b.sprite.ankraj.x * s.olcek;
    const ust = b.ankraj.y + s.kaydirma.y - b.sprite.ankraj.y * s.olcek;
    expect(k.sol).toBeCloseTo(sol);
    expect(k.sag).toBeCloseTo(sol + b.sprite.genislik * s.olcek);
    expect(k.ust).toBeCloseTo(ust);
    expect(k.alt).toBeCloseTo(ust + b.sprite.yukseklik * s.olcek);
  });

  it("onDoku_binanin_refi_ile_cagrilir", async () => {
    const s = kur(3);
    yap();
    const cagri: HaritaRef[] = [];
    c.onDoku = (r) => cagri.push(r);
    c.guncelle(s, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    await bekle();
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    expect(cagri).toContainEqual(b.ref);
  });
});

describe("IzoCizimi doku ömrü ve hata", () => {
  it("sprite_yuklenemezse_hata_bir_kez", async () => {
    const hata = vi.fn();
    yap({ doku: async () => { throw new Error("404"); } }, () => {}, hata).guncelle(kur(10), null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    await bekle();
    expect(hata).toHaveBeenCalledTimes(1);
  });

  it("yoket_sonrasi_gec_gelen_doku_yazilmaz", async () => {
    const bekleyen: Array<(t: any) => void> = [];
    const hata = vi.fn();
    const d = { doku: vi.fn(() => new Promise<any>((coz) => { bekleyen.push(coz); })), emekliyiAt: vi.fn(), yoket: vi.fn() };
    yap(d, () => {}, hata).guncelle(kur(4), null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    expect(bekleyen.length).toBeGreaterThan(0);
    const spr = [...kayit.sprites];
    c.yoket();
    expect(d.yoket).toHaveBeenCalled();
    kayit.app.render = vi.fn();
    for (const coz of bekleyen) coz(tex());
    await bekle();
    expect(spr.every((s) => s.texture === null)).toBe(true);
    expect(kayit.app.render).not.toHaveBeenCalled();
    expect(d.emekliyiAt).not.toHaveBeenCalled();
    expect(hata).not.toHaveBeenCalled();
  });

  it("doku_omru_emekli_dokular_cizimden_sonra_yok_edilir", async () => {
    const sira: string[] = [];
    const d = { doku: vi.fn(async (s: SpriteKaydi) => tex(s.dosya)), emekliyiAt: vi.fn(() => { sira.push("yoket"); }) };
    yap(d);
    kayit.app.render = vi.fn(() => { sira.push("ciz"); });
    c.guncelle(kur(4), null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    sira.length = 0;
    await bekle();
    expect(sira.filter((x) => x === "yoket").length).toBeGreaterThan(0);
    for (let i = 0; i < sira.length; i++) if (sira[i] === "yoket") expect(sira[i - 1], `yoket öncesi ${i}`).toBe("ciz");
    const kume = (d.emekliyiAt.mock.calls.at(-1) as unknown[])[0] as Set<unknown>;
    expect(kume.size).toBeGreaterThan(0);
  });

  it("yoket_yukleyiciyi_temizler_ve_dunyayi_yok_eder", () => {
    const yoket = vi.fn();
    yap({ doku: async () => tex(), yoket }).guncelle(kur(3), null, G, 0, adlar);
    c.yoket();
    expect(yoket).toHaveBeenCalled();
    expect(c.dunya.destroyed).toBe(true);
  });

  it("paylasilan_doku_iki_binada_tek_texture", async () => {
    const dokuYap = vi.fn(async (k: { url: string }) => ({ url: k.url, width: 209, height: 200 }) as any);
    const yukleyici = new SpriteDokuYukleyici<any>({ dokuYap });
    const s = kur(30);
    yap(yukleyici as unknown as SpriteDokuKaynakcisi).guncelle(s, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    await bekle();
    const isl = s.binalar.filter((b) => b.tur === "isletme");
    const grup = new Map<string, any[]>();
    for (const b of isl) {
      const t = kapOf(b.id).children[0].texture;
      expect(t).not.toBeNull();
      grup.set(b.sprite.dosya, [...(grup.get(b.sprite.dosya) ?? []), t]);
    }
    const ikili = [...grup.values()].find((l) => l.length >= 2);
    expect(ikili).toBeDefined();
    expect(new Set(ikili).size).toBe(1);
    const dosyalar = dokuYap.mock.calls.map((a) => (a[0] as { url: string }).url);
    expect(new Set(dosyalar).size).toBe(dosyalar.length); // her dosya bir kez
  });
});

describe("IzoCizimi DAO işlevleri (klasik karşılıkları)", () => {
  it("izo_bos_parsel_tiklanabilir_ve_secili_kenarlikli", () => {
    const tikla = vi.fn();
    const s = kur(4);
    expect(s.bosHucreler.length).toBeGreaterThan(1);
    yap(dokuSahte(), tikla).guncelle(s, null, G, 0, adlar);
    const bh = s.bosHucreler[0]!;
    const g = (id: string): any => kat().yer.children.find((x: any) => x.label === `bos:${id}`);
    const p = g(bh.parselId);
    expect(p.eventMode).toBe("static");
    const e2 = hucredenEkrana(bh.hucre2);
    expect(p.hitArea.contains(bh.ekran.x, bh.ekran.y)).toBe(true);
    expect(p.hitArea.contains(e2.x, e2.y)).toBe(true); // domino: iki hücre birlikte
    expect(p.hitArea.contains(bh.ekran.x + 500, bh.ekran.y)).toBe(false);
    p.h.pointertap[0]();
    expect(tikla).toHaveBeenCalledWith({ kind: "parsel", ref: bh.parselId });
    c.tasidi = true;
    tikla.mockClear();
    p.h.pointertap[0]();
    expect(tikla).not.toHaveBeenCalled();
    expect(p.calls.some((k: any[]) => k[0] === "stroke")).toBe(false);
    c.guncelle(s, { kind: "parsel", ref: bh.parselId }, G, 0, adlar);
    expect(p.calls.some((k: any[]) => k[0] === "stroke")).toBe(true);
    expect(g(s.bosHucreler[1]!.parselId).calls.some((k: any[]) => k[0] === "stroke")).toBe(false);
    // dolunca düğmesi yok edilir
    const az = { ...s, bosHucreler: s.bosHucreler.slice(1) };
    c.guncelle(az, null, G, 0, adlar);
    expect(p.destroyed).toBe(true);
  });

  it("bos_parsel_yoksa_hedef_yok_sahne_bosParsellerSizse", () => {
    const s = kur(4, { parselSecilebilir: false });
    expect(s.bosHucreler).toHaveLength(0);
    yap().guncelle(s, null, G, 0, adlar);
    expect(kat().yer.children.filter((x: any) => String(x.label).startsWith("bos:"))).toHaveLength(0);
  });

  it("izo_meydan_zemini_secilir", () => {
    const tikla = vi.fn();
    const s = kur(4);
    yap(dokuSahte(), tikla).guncelle(s, null, G, 0, adlar);
    const mg = kat().yer.children.find((x: any) => x.label === "meydan");
    const ort = hucredenEkrana(s.plaza.hucre);
    expect(mg.eventMode).toBe("static");
    expect(mg.hitArea.contains(ort.x, ort.y)).toBe(true);
    expect(mg.hitArea.contains(ort.x + 3000, ort.y)).toBe(false);
    mg.h.pointertap[0]();
    expect(tikla).toHaveBeenCalledWith({ kind: "lonca", ref: MEYDAN_REF });
    expect(mg.calls.some((k: any[]) => k[0] === "stroke")).toBe(false);
    c.guncelle(s, { kind: "lonca", ref: MEYDAN_REF }, G, 0, adlar);
    expect(mg.calls.some((k: any[]) => k[0] === "stroke")).toBe(true);
  });

  it("izo_katman_tonu_taban_plakasina_yazilir_png_tonlanmaz", () => {
    TOK[IZO_RENGI.ton.dar] = "dar-renk";
    const s0 = kur(4);
    const id = s0.binalar.find((b) => b.tur === "isletme")!.id;
    const s = kaynakla(s0, { katman: { tur: "talep", tonlar: new Map([[id, "dar"]]), lejant: [], rozetler: [] } });
    yap().guncelle(s, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    expect(dolu(kat().plaka, "dar-renk")).toBe(true);
    expect(kayit.sprites.every((x) => x.tint === undefined)).toBe(true);
    expect(kayit.containers.every((x) => x.tint === undefined)).toBe(true);
  });

  it("izo_ilan_veren_parlar", () => {
    TOK[SEHIR_RENGI.ilan] = "ilan-renk";
    const s0 = kur(4);
    const id = s0.binalar.find((b) => b.tur === "isletme")!.id;
    const s = kaynakla(s0, { ilanVeren: new Set([id]) });
    yap().guncelle(s, null, G, 0, adlar);
    const g = [kat().plaka];
    expect(g.some((x: any) => x.calls.some((k: any[]) => k[0] === "fill" && k[1]?.color === "ilan-renk" && k[1]?.alpha > 0))).toBe(true);
    expect(g.some((x: any) => x.calls.some((k: any[]) => k[0] === "stroke" && k[1]?.color === "ilan-renk"))).toBe(true);
  });

  it("izo_issizlik_rozetleri_belediye_ve_meydanda", () => {
    const s0 = kur(4);
    const s = kaynakla(s0, { katman: { tur: "issizlik", tonlar: new Map(), lejant: [], rozetler: [{ hedef: "sehir", binaId: s0.kaynak.sehirBinasi.id, sayi: 7 }, { hedef: "meydan", binaId: null, sayi: 12 }] } });
    yap().guncelle(s, null, G, 0, adlar);
    const yazilar = kayit.texts.filter((t) => t.text === "7" || t.text === "12");
    expect(yazilar).toHaveLength(2);
    // belediye rozeti belediye binasının üstünde, meydan rozeti plaza merkezinde
    const bel = s.binalar.find((b) => b.id === s0.kaynak.sehirBinasi.id)!;
    const t7 = kayit.texts.find((t) => t.text === "7")!;
    expect(t7.position.x).toBe(bel.ankraj.x);
    expect(t7.position.y).toBeLessThan(bel.ankraj.y);
    const t12 = kayit.texts.find((t) => t.text === "12")!;
    const ort = hucredenEkrana(s.plaza.hucre);
    expect(t12.position.x).toBeCloseTo(ort.x);
    expect(t12.position.y).toBeCloseTo(ort.y);
  });

  it("izo_ben_halkasi_ve_secim_halkasi_ust_katmanda", () => {
    TOK[IZO_RENGI.ben] = "ben-renk";
    TOK[IZO_RENGI.secili] = "secili-renk";
    const s0 = kur(4);
    const [a, b] = s0.binalar.filter((x) => x.tur === "isletme");
    const s = kaynakla(s0, { ben: { binaId: a!.id, neden: "isyeri" } });
    yap().guncelle(s, { kind: "firm", ref: b!.id }, G, 0, adlar);
    const h = [kat().halka];
    const strokes = h.flatMap((x: any) => x.calls.filter((k: any[]) => k[0] === "stroke").map((k: any[]) => k[1]));
    expect(strokes.some((o: any) => o.color === "ben-renk" && o.width === 5)).toBe(true);
    expect(strokes.some((o: any) => o.color === "secili-renk" && o.width === 3)).toBe(true);
    // ben etiketi
    expect(kayit.texts.some((t) => t.text === "Senin işyerin")).toBe(true);
  });

  it("izo_sehir_ve_ahir_etiketi_her_zaman_isletme_yalniz_secilince", () => {
    const s = kur(4);
    yap().guncelle(s, null, G, 0, adlar);
    const metinler = kayit.texts.map((t) => t.text);
    expect(metinler.length).toBeGreaterThanOrEqual(2);
    const isl = s.binalar.find((b) => b.tur === "isletme")!;
    const once = kayit.texts.length;
    c.guncelle(s, isl.ref, G, 0, adlar);
    expect(kayit.texts.length).toBe(once + 1);
  });

  it("izo_veriYok_notu_ve_cokmeme", () => {
    const s = kaynakla(kur(0, {}, { hafta: 20, firmalar: [] }), { veriYok: true });
    yap();
    expect(() => c.guncelle(s, null, G, 0, adlar)).not.toThrow();
    expect(() => c.guncelle(s, { kind: "lonca", ref: MEYDAN_REF }, G, 0, adlar)).not.toThrow();
    expect(kapOf("yok")).toBeUndefined();
  });

  it("izo_boyut_degisince_bina_yerinde_kalir_sprite_yenilenir", async () => {
    const buyuk = izoSahneKur(sehirSahnesi(paketOf(3), verisi(4), ctxOf()), m, "t1", () => 4);
    const kucuk = izoSahneKur(sehirSahnesi(paketOf(3), verisi(4), ctxOf()), m, "t1", () => 1);
    yap().guncelle(kucuk, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    await bekle();
    const id = kucuk.binalar.find((b) => b.tur === "isletme")!.id;
    const kap = kapOf(id);
    c.guncelle(buyuk, null, { x: 0, y: 0, olcek: 0.01 }, 0, adlar);
    await bekle();
    expect(kapOf(id)).toBe(kap); // aynı nesne
    const nb = buyuk.binalar.find((b) => b.id === id)!;
    expect(kap.children[0].anchor.x).toBeCloseTo(nb.sprite.ankraj.x / nb.sprite.genislik);
  });

  it("IZO_STILI_gorunurluk_ve_plaka_ayarlari_tanimli", () => {
    expect(IZO_STILI.gorunurluk.pay).toBeGreaterThan(0);
    expect(IZO_STILI.plaka.alfa).toBeGreaterThan(0);
  });
});


// --- Görev 11: durum ve büyüme görselleri, animasyon ---------------------------------

type Hareket = { etkinAzalt: boolean; dusukPerformans: boolean };
const TAM: Hareket = { etkinAzalt: false, dusukPerformans: false };
const AZALT: Hareket = { etkinAzalt: true, dusukPerformans: false };
const HEP = { x: 0, y: 0, olcek: 0.01 };
const bindirmeMs = IZO_STILI.buyume.bindirmeMs;
const ticker = (): any => kayit.app.ticker;
/** Sahne: işletme kimliği -> görsel durum; `boy` tüm işletmelere; `gecisler` tek seferlik geçişler. */
const kurD = (n: number, durumlar: Record<string, GorselDurum> = {}, gecisler: Gecis[] = [], boy: 1 | 2 | 3 | 4 = 1): IzoSahne =>
  izoSahneKur(sehirSahnesi(paketOf(3), verisi(n), ctxOf()), m, "t1", () => boy, { durumlar: new Map(Object.entries(durumlar)), gecisler });
/** Önce geçişsiz (bağlanma anı), sonra geçişli sahne: yeni örnek yalnız bağlandıktan sonra gelen geçişleri oynatır. */
const oynat = (s: IzoSahne, h: Hareket = TAM): void => {
  yap().guncelle({ ...s, gecisler: [] }, null, HEP, 0, adlar, undefined, h);
  c.guncelle(s, null, HEP, 0, adlar, undefined, h);
};
const kareler = (ms: number): void => { for (let i = 0; i < Math.ceil(ms / 33); i++) ticker().tick(33); };
const spritelar = (id: string): any[] => kapOf(id).children.filter((x: any) => x.anchor);
const anaSprite = (id: string): any => spritelar(id)[0];
const bindirmeDosyasi = (id: string): string | undefined => spritelar(id)[1]?.texture?.dosya;
const dumanlar = (): any[] => kat().bina.children.flatMap((k: any) => k.children.filter((x: any) => x.label === "duman"));
const renderSayisi = (): number => kayit.app.render.mock.calls.length;

describe("IzoCizimi durum görselleri", () => {
  it("kapali_bina_tahtali_soluk_tint_ile_filtresiz", async () => {
    const s = kurD(3, { f0: "kapali" });
    yap().guncelle(s, null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    const sp = anaSprite("f0");
    expect(sp.alpha).toBe(0.55);
    expect(sp.tint).toBe(IZO_STILI.durum.kapali.tint);
    expect(bindirmeDosyasi("f0")).toMatch(/tahtali_boy/);
    // sprite başına filtre yok: batching korunur
    const hepsi = [...kayit.sprites, ...kayit.containers];
    for (const x of hepsi) expect(x.filters ?? [], "filters").toHaveLength(0);
    expect(anaSprite("f1").alpha).toBe(1);
  });

  it("kuruluyor_iskeleli", async () => {
    yap().guncelle(kurD(3, { f0: "kuruluyor" }), null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    expect(bindirmeDosyasi("f0")).toMatch(/iskele_boy/);
    expect(anaSprite("f0").alpha).toBe(0.85);
  });

  it("azaltilmis_harekette_durum_statik_okunur", async () => {
    const s = kurD(8, { f0: "kapali", f2: "kuruluyor", f5: "uretim" }, [{ id: "f2", hafta: 20, tur: "kuruldu" }]);
    yap().guncelle(s, null, HEP, 0, adlar, undefined, AZALT);
    await bekle();
    expect(bindirmeDosyasi("f0")).toMatch(/tahtali_boy/);
    expect(anaSprite("f0").alpha).toBe(0.55);
    expect(anaSprite("f0").tint).toBe(IZO_STILI.durum.kapali.tint);
    expect(bindirmeDosyasi("f2")).toMatch(/iskele_boy/);
    expect(anaSprite("f2").alpha).toBe(0.85); // geçiş animasyonu yok: son durum hemen
    expect(dumanlar()).toHaveLength(0);
    expect(ticker().started).toBe(false);
  });

  it("azaltilmis_harekette_ticker_hic_acilmaz", () => {
    const gec: Gecis[] = [{ id: "f0", hafta: 20, tur: "batti" }, { id: "f1", hafta: 20, tur: "canlandi" }, { id: "f3", hafta: 20, tur: "buyudu" }];
    oynat(kurD(8, { f0: "kapali", f1: "canlandi" }, gec), AZALT);
    expect(ticker().started).toBe(false);
    expect(ticker().adet).toBe(0);
    expect(dumanlar()).toHaveLength(0);
  });

  it("dusuk_performans_modunda_ticker_hic_acilmaz", () => {
    yap().guncelle(kurD(8), null, HEP, 0, adlar, undefined, { etkinAzalt: false, dusukPerformans: true });
    expect(ticker().started).toBe(false);
    expect(dumanlar()).toHaveLength(0);
  });

  it("sekme_gizlenince_animasyon_durur", () => {
    yap().guncelle(kurD(8), null, HEP, 0, adlar, undefined, TAM);
    expect(ticker().started).toBe(true);
    const sec = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ticker().started).toBe(false);
    sec.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ticker().started).toBe(true);
  });

  it("duman_yalniz_uygun_turlerde", () => {
    const s = kurD(8);
    yap().guncelle(s, null, HEP, 0, adlar, undefined, TAM);
    const dumanli = s.binalar.filter((b) => b.tur === "isletme" && kapOf(b.id).children.some((x: any) => x.label === "duman")).map((b) => b.sahne.etiket);
    expect(dumanli.length).toBeGreaterThan(0);
    for (const t of dumanli) expect(IZO_STILI.dumanTurleri as readonly string[]).toContain(t);
    // dumanTurleri dışındakilerin (market, okul) duman nesnesi yok
    expect(kapOf("f0").children.some((x: any) => x.label === "duman")).toBe(false);
    expect(kapOf("f4").children.some((x: any) => x.label === "duman")).toBe(false);
    expect(ticker().started).toBe(true);
    expect(ticker().maxFPS).toBe(30);
  });

  it("zayif_issiz_kapali_dumansiz_ve_uretimde_isik", () => {
    yap().guncelle(kurD(8, { f5: "zayif", f1: "uretim" }), null, HEP, 0, adlar, undefined, TAM);
    expect(kapOf("f5").children.some((x: any) => x.label === "duman")).toBe(false);
    expect(kapOf("f1").children.some((x: any) => x.label === "duman")).toBe(true);
    expect(kapOf("f1").children.some((x: any) => x.label === "isik")).toBe(true);
    expect(kapOf("f5").children.some((x: any) => x.label === "isik")).toBe(false);
    expect(anaSprite("f5").alpha).toBe(0.9);
  });

  it("ekran_disi_animasyon_calismaz", () => {
    yap().guncelle(kurD(8), null, { x: -90000, y: -90000, olcek: 1 }, 0, adlar, undefined, TAM);
    expect(dumanlar()).toHaveLength(0);
    expect(ticker().started).toBe(false);
  });

  it("bina_basina_animasyon_nesnesi_sinirli", () => {
    const n = 300;
    const s = kurD(n);
    const duman = s.binalar.filter((b) => b.tur === "isletme" && (IZO_STILI.dumanTurleri as readonly string[]).includes(b.sahne.etiket));
    expect(duman.length).toBeGreaterThan(IZO_STILI.animasyon.enCok);
    yap().guncelle(s, null, HEP, 0, adlar, undefined, TAM);
    expect(dumanlar().length).toBeLessThanOrEqual(IZO_STILI.animasyon.enCok);
    expect(dumanlar().length).toBeGreaterThan(0);
    expect(ticker().adet).toBe(1); // tek kare dinleyicisi
  });
});

describe("IzoCizimi geçişler", () => {
  const f0 = (tur: Gecis["tur"], hafta = 20): Gecis[] => [{ id: "f0", hafta, tur }];

  it("animasyon_bitince_ticker_durur", () => {
    oynat(kurD(1, { f0: "zayif" }, f0("zayifladi")));
    expect(ticker().started).toBe(true);
    const once = renderSayisi();
    kareler(bindirmeMs + 200);
    expect(ticker().started).toBe(false);
    expect(ticker().adet).toBe(0);
    expect(renderSayisi()).toBeGreaterThan(once); // son kare çizilir
    const sonra = renderSayisi();
    ticker().tick(33);
    expect(renderSayisi()).toBe(sonra);
  });

  it("kuruldu_iskeleden_sprite_a", async () => {
    oynat(kurD(1, { f0: "kuruluyor" }, f0("kuruldu")));
    await bekle();
    expect(anaSprite("f0").alpha).toBeLessThan(0.85);
    expect(bindirmeDosyasi("f0")).toMatch(/iskele_boy/);
    kareler(bindirmeMs + 200);
    expect(anaSprite("f0").alpha).toBeCloseTo(0.85);
  });

  it("batti_alfa_dususu_ve_tahta", async () => {
    yap().guncelle(kurD(1, { f0: "uretim" }), null, HEP, 0, adlar, undefined, TAM);
    c.guncelle(kurD(1, { f0: "kapali" }, f0("batti")), null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    expect(anaSprite("f0").alpha).toBeGreaterThan(0.9); // geçiş başında hâlâ yüksek
    kareler(bindirmeMs / 2);
    const orta = anaSprite("f0").alpha;
    expect(orta).toBeLessThan(0.95);
    expect(orta).toBeGreaterThan(0.55);
    kareler(bindirmeMs);
    expect(anaSprite("f0").alpha).toBeCloseTo(0.55);
    expect(bindirmeDosyasi("f0")).toMatch(/tahtali_boy/);
  });

  it("buyume_gecisi_iskele_sonra_yeni_sprite", async () => {
    const kucuk = kurD(1, {}, [], 1);
    yap().guncelle(kucuk, null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    const eski = anaSprite("f0").texture.dosya;
    const yeni = kurD(1, {}, f0("buyudu"), 2);
    const yeniDosya = yeni.binalar.find((b) => b.id === "f0")!.sprite.dosya;
    expect(yeniDosya).not.toBe(eski);
    c.guncelle(yeni, null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    expect(anaSprite("f0").texture.dosya).toBe(eski); // önce iskele, eski sprite
    expect(bindirmeDosyasi("f0")).toMatch(/iskele_boy/);
    kareler(bindirmeMs + 200);
    await bekle();
    expect(anaSprite("f0").texture.dosya).toBe(yeniDosya); // sonra yeni sprite
    expect(spritelar("f0")).toHaveLength(1); // iskele kalkar
  });

  it("kuculme_gecisi_tahtali_ek_yapi", async () => {
    const buyuk = kurD(1, {}, [], 2);
    yap().guncelle(buyuk, null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    const eski = anaSprite("f0").texture.dosya;
    const kucuk = kurD(1, {}, f0("kuculdu"), 1);
    const yeniDosya = kucuk.binalar.find((b) => b.id === "f0")!.sprite.dosya;
    c.guncelle(kucuk, null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    expect(anaSprite("f0").texture.dosya).toBe(eski);
    expect(bindirmeDosyasi("f0")).toMatch(/tahtali_boy/);
    kareler(bindirmeMs + 200);
    await bekle();
    expect(anaSprite("f0").texture.dosya).toBe(yeniDosya);
    expect(spritelar("f0")).toHaveLength(1);
  });

  it("azaltilmis_harekette_buyume_aninda_yeni_sprite_iskelesiz", async () => {
    yap().guncelle(kurD(1, {}, [], 1), null, HEP, 0, adlar, undefined, AZALT);
    await bekle();
    const yeni = kurD(1, {}, f0("buyudu"), 2);
    c.guncelle(yeni, null, HEP, 0, adlar, undefined, AZALT);
    await bekle();
    expect(anaSprite("f0").texture.dosya).toBe(yeni.binalar.find((b) => b.id === "f0")!.sprite.dosya);
    expect(spritelar("f0")).toHaveLength(1);
    expect(ticker().started).toBe(false);
  });

  it("canlanma_gecisi_bir_kez", () => {
    const parlama = (): any[] => kapOf("f0").children.filter((x: any) => x.label === "parlama");
    const sahne = (): IzoSahne => kurD(1, { f0: "canlandi" }, f0("canlandi"));
    oynat(sahne());
    expect(parlama()).toHaveLength(1);
    kareler(IZO_STILI.animasyon.parlamaMs + 200);
    expect(parlama()).toHaveLength(0);
    expect(ticker().started).toBe(false);
    // aynı geçiş kimliği (id:hafta:tur) yeniden gelirse tekrar oynamaz
    c.guncelle(sahne(), null, HEP, 0, adlar, undefined, TAM);
    expect(parlama()).toHaveLength(0);
    expect(ticker().started).toBe(false);
  });

  it("gecis_sirasinda_mod_azalinca_son_duruma_atlar", async () => {
    oynat(kurD(1, { f0: "kuruluyor" }, f0("kuruldu")));
    await bekle();
    c.guncelle(kurD(1, { f0: "kuruluyor" }, f0("kuruldu")), null, HEP, 0, adlar, undefined, AZALT);
    expect(anaSprite("f0").alpha).toBe(0.85);
    expect(ticker().started).toBe(false);
  });

  it("yoket_ticker_dinleyicisini_kaldirir", () => {
    yap().guncelle(kurD(8), null, HEP, 0, adlar, undefined, TAM);
    expect(ticker().adet).toBe(1);
    c.yoket();
    expect(ticker().adet).toBe(0);
    expect(ticker().started).toBe(false);
  });

  it("yeni_ornek_son_haftanin_gecislerini_yeniden_oynatmaz", () => {
    const s = kurD(1, { f0: "canlandi" }, f0("canlandi"));
    yap().guncelle(s, null, HEP, 0, adlar, undefined, TAM); // bağlanma anı: geçişler eski sayılır
    expect(kapOf("f0").children.some((x: any) => x.label === "parlama")).toBe(false);
    expect(ticker().started).toBe(false);
    c.guncelle(kurD(1, { f0: "canlandi" }, [{ id: "f0", hafta: 21, tur: "canlandi" }]), null, HEP, 0, adlar, undefined, TAM); // sonradan gelen oynar
    expect(kapOf("f0").children.some((x: any) => x.label === "parlama")).toBe(true);
  });
});

describe("IzoCizimi ışık, sabitler ve yedek bindirme", () => {
  it("isik_ve_parlama_tema_bagimsiz_sicak_takma_adi_kullanir", () => {
    TOK[IZO_RENGI.isikSicak] = "sicak-renk";
    TOK[IZO_RENGI.isik] = "koyu-yuzey";
    oynat(kurD(1, { f0: "canlandi" }, [{ id: "f0", hafta: 20, tur: "canlandi" }]));
    const kap = kapOf("f0");
    const isik = kap.children.find((x: any) => x.label === "isik");
    const parlama = kap.children.find((x: any) => x.label === "parlama");
    expect(dolu(isik, "sicak-renk")).toBe(true);
    expect(parlama.calls.some((x: any[]) => x[0] === "stroke" && x[1].color === "sicak-renk")).toBe(true);
    expect(dolu(isik, "koyu-yuzey")).toBe(false);
  });

  it("isik_nesnesi_300_binada_sinirli_ve_ekran_disinda_yok", () => {
    const n = 300;
    yap().guncelle(kurD(n), null, HEP, 0, adlar, undefined, TAM);
    const isiklar = (): number => kat().bina.children.flatMap((k: any) => k.children.filter((x: any) => x.label === "isik")).length;
    expect(isiklar()).toBeGreaterThan(0);
    expect(isiklar()).toBeLessThanOrEqual(IZO_STILI.animasyon.isikEnCok);
    sahteSifirla(); kayit.app = yapApp(vi);
    yap().guncelle(kurD(n), null, { x: -90000, y: -90000, olcek: 1 }, 0, adlar, undefined, TAM);
    expect(isiklar()).toBe(0);
  });

  it("yedek_bindirme_graphics_olusur_tur_degisince_ve_kalkinca_destroy_edilir", async () => {
    const yedeksiz = { ...m, kayitlar: m.kayitlar.filter((k) => k.grup !== "bindirme") };
    yap(dokuSahte(), () => {}, () => {}, yedeksiz).guncelle(kurD(1, { f0: "kuruluyor" }), null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    const iskele = kapOf("f0").children.find((x: any) => x.label === "yedek-iskele");
    expect(iskele).toBeDefined();
    expect(spritelar("f0")).toHaveLength(1); // manifest bindirmesi yok
    expect(dolu(iskele, "v:" + IZO_RENGI.iskele) || iskele.calls.length > 0).toBe(true);
    c.guncelle(kurD(1, { f0: "kapali" }), null, HEP, 0, adlar, undefined, TAM);
    expect(iskele.destroyed).toBe(true); // tür değişti: eskisi yok edildi
    const tahta = kapOf("f0").children.find((x: any) => x.label === "yedek-tahtali");
    expect(tahta).toBeDefined();
    c.guncelle(kurD(1, { f0: "uretim" }), null, HEP, 0, adlar, undefined, TAM);
    expect(tahta.destroyed).toBe(true);
    expect(kapOf("f0").children.some((x: any) => x.label?.startsWith("yedek-"))).toBe(false);
  });
});

// --- Görev 12: ben vurgusu, hover, ipucu ---------------------------------------------

const fare = (x = 10, y = 20) => ({ pointerType: "mouse", global: { x, y } });
const dokunus = (x = 10, y = 20) => ({ pointerType: "touch", global: { x, y } });
const hoverKat = (): any => kat().govde.children[9];
const benKat = (): any => kat().govde.children[8];

describe("IzoCizimi ben vurgusu, hover ve ipucu", () => {
  it("ben_halkasi_yalniz_ben_binada_nabiz_katmani", () => {
    const s0 = kur(4);
    const a = s0.binalar.find((x) => x.tur === "isletme")!;
    yap().guncelle(kaynakla(s0, { ben: { binaId: a.id, neden: "isletme" } }), null, G, 0, adlar, undefined, TAM);
    expect(benKat().calls.filter((k: any[]) => k[0] === "poly")).toHaveLength(1);
    c.yoket();
    sahteSifirla(); kayit.app = yapApp(vi);
    yap().guncelle(kur(4), null, G, 0, adlar, undefined, TAM);
    expect(benKat().calls.filter((k: any[]) => k[0] === "poly")).toHaveLength(0);
  });

  it("nabiz_yalniz_tam_modda_azaltilmiste_statik_kalin_halka", () => {
    const s0 = kur(4);
    const a = s0.binalar.find((x) => x.tur === "isletme")!;
    const s = kaynakla(s0, { ben: { binaId: a.id, neden: "isletme" } });
    yap().guncelle(s, null, G, 0, adlar, undefined, TAM);
    expect(ticker().started).toBe(true);
    const a0 = benKat().alpha;
    kareler(IZO_STILI.etkilesim.nabizMs / 4);
    expect(benKat().alpha).not.toBe(a0);
    c.yoket();
    sahteSifirla(); kayit.app = yapApp(vi);
    yap().guncelle(s, null, G, 0, adlar, undefined, AZALT);
    expect(ticker().started).toBe(false);
    expect(benKat().alpha).toBe(1);
    const strokes = kat().halka.calls.filter((k: any[]) => k[0] === "stroke").map((k: any[]) => k[1]);
    expect(strokes.some((o: any) => o.width === 5)).toBe(true);
  });

  it("hover_parlamasi_yalniz_fare_ve_cikinca_kapanir", () => {
    const s = kur(4);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    yap().guncelle(s, null, G, 0, adlar);
    kapOf(b.id).h.pointerover[0](dokunus());
    expect(hoverKat().calls.filter((k: any[]) => k[0] === "poly")).toHaveLength(0);
    kapOf(b.id).h.pointerover[0](fare());
    expect(hoverKat().calls.filter((k: any[]) => k[0] === "poly")).toHaveLength(1);
    kapOf(b.id).h.pointerout[0](fare());
    expect(hoverKat().calls.filter((k: any[]) => k[0] === "poly")).toHaveLength(0);
  });

  it("onHover_ad_durum_calisan_sahip_ve_konum_verir_cikinca_null", () => {
    const s = kur(4);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    const olaylar: any[] = [];
    yap().guncelle(s, null, G, 0, adlar);
    c.onHover = (v) => olaylar.push(v);
    kapOf(b.id).h.pointerover[0](fare(33, 44));
    expect(olaylar[0]).toMatchObject({ durum: b.durum, calisan: b.sahne.calisan, sahip: b.sahne.sahip ?? null, x: 33, y: 44 });
    expect(typeof olaylar[0].ad).toBe("string");
    kapOf(b.id).h.pointerout[0](fare());
    expect(olaylar[1]).toBeNull();
  });

  it("ipucu_kutusu_pixi_sahnesinde_imleci_izler_ve_cikinca_gizlenir", () => {
    const s = kur(4);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    yap().guncelle(s, null, G, 0, adlar, { genislik: 800, yukseklik: 600 });
    const ip = (c as any).ipucuKat;
    expect(ip.visible).toBe(false);
    kapOf(b.id).h.pointerover[0](fare(100, 100));
    expect(ip.visible).toBe(true);
    expect(ip.position).toMatchObject({ x: 100 + IZO_STILI.ipucu.bosluk, y: 100 + IZO_STILI.ipucu.bosluk });
    kapOf(b.id).h.pointermove[0](fare(300, 250));
    expect(ip.position).toMatchObject({ x: 300 + IZO_STILI.ipucu.bosluk, y: 250 + IZO_STILI.ipucu.bosluk });
    kapOf(b.id).h.pointermove[0](fare(790, 590));
    expect(ip.position.x).toBeLessThan(790);
    expect(ip.position.y).toBeLessThan(590);
    kapOf(b.id).h.pointerout[0](fare());
    expect(ip.visible).toBe(false);
  });

  it("dokunmatikte_ilk_dokunus_secer_ve_ipucu_gosterir", () => {
    const s = kur(4);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    const tikla = vi.fn();
    const olaylar: any[] = [];
    yap(dokuSahte(), tikla).guncelle(s, null, G, 0, adlar);
    c.onHover = (v) => olaylar.push(v);
    kapOf(b.id).h.pointertap[0](dokunus(50, 60));
    expect(tikla).toHaveBeenCalledWith(b.ref);
    expect(olaylar[0]).toMatchObject({ x: 50, y: 60 });
    // fare tıklaması ipucu açmaz (hover zaten gösterir)
    kapOf(b.id).h.pointertap[0](fare());
    expect(olaylar).toHaveLength(1);
  });

  it("secimde_halka_kisa_belirir_azaltilmiste_aninda", () => {
    const s = kur(4);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    yap().guncelle(s, null, G, 0, adlar, undefined, TAM);
    c.guncelle(s, b.ref, G, 0, adlar, undefined, TAM);
    expect(kat().halka.alpha).toBeLessThan(1);
    kareler(IZO_STILI.etkilesim.secimMs + 100);
    expect(kat().halka.alpha).toBe(1);
    c.yoket();
    sahteSifirla(); kayit.app = yapApp(vi);
    yap().guncelle(s, null, G, 0, adlar, undefined, AZALT);
    c.guncelle(s, b.ref, G, 0, adlar, undefined, AZALT);
    expect(kat().halka.alpha).toBe(1);
  });

  it("hover_ipucu_sahne_guncellenince_tazelenir_degismediyse_tekrar_bildirilmez", () => {
    const s = kur(4);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    const olaylar: any[] = [];
    yap().guncelle(s, null, G, 0, adlar);
    c.onHover = (v) => olaylar.push(v);
    kapOf(b.id).h.pointerover[0](fare(5, 6));
    c.guncelle(s, null, G, 0, adlar);
    expect(olaylar).toHaveLength(1);
    const yeni = { ...s, binalar: s.binalar.map((x) => (x.id === b.id ? { ...x, durum: "kapali" as const } : x)) };
    c.guncelle(yeni, null, G, 0, adlar);
    expect(olaylar).toHaveLength(2);
    expect(olaylar[1]).toMatchObject({ durum: "kapali", x: 5, y: 6 });
  });
});

describe("IzoCizimi şehir kurumları (Liman, İhracat)", () => {
  it("kurum_binalari_cizilir_adlari_etikette_her_zaman_gorunur", () => {
    const s = kur(4);
    yap().guncelle(s, null, G, 0, adlar);
    expect(kapOf("liman")).toBeDefined();
    expect(kapOf("ihracat")).toBeDefined();
    const metinler = kayit.texts.map((t) => t.text);
    expect(metinler).toContain("Liman (ithalat)");
    expect(metinler).toContain("İhracat");
  });

  it("tiklama_kurum_referansiyla_secer", () => {
    const s = kur(4);
    const tikla = vi.fn();
    yap(dokuSahte(), tikla).guncelle(s, null, G, 0, adlar);
    kapOf("liman").h.pointertap[0](fare());
    expect(tikla).toHaveBeenLastCalledWith({ kind: "kurum", ref: "liman" });
    kapOf("ihracat").h.pointertap[0](fare());
    expect(tikla).toHaveBeenLastCalledWith({ kind: "kurum", ref: "ihracat" });
  });

  it("hover_ipucu_kurum_adi_calisan_ve_sahip_satiri_yok", () => {
    const s = kur(4);
    const olaylar: any[] = [];
    yap().guncelle(s, null, G, 0, adlar);
    c.onHover = (v) => olaylar.push(v);
    kapOf("liman").h.pointerover[0](fare(7, 8));
    kapOf("ihracat").h.pointerover[0](fare(9, 10));
    expect(olaylar[0]).toMatchObject({ ad: "Liman (ithalat)", calisan: null, sahip: null, x: 7, y: 8 });
    expect(olaylar[1]).toMatchObject({ ad: "İhracat", calisan: null, sahip: null });
  });
});

// --- Görev 14: performans ve bellek bütçesi -------------------------------------------------

const BUT = IZO_STILI.performans;
/** Ağaçtaki düğüm ve sprite sayıları; `gorunur`: kendisi ve atalarının hepsi görünür olan sprite (Pixi'nin gerçekten çizeceği). */
const say = (cz: IzoCizimi = c): { dugum: number; sprite: number; gorunur: number } => {
  let dugum = 0, sprite = 0, gorunur = 0;
  const gez = (k: any, ust: boolean): void => {
    dugum++;
    const g = ust && k.visible !== false;
    if ("texture" in k) { sprite++; if (g) gorunur++; } // Sprite (Text'in `texture` alanı yok)
    for (const ch of k.children) gez(ch, g);
  };
  gez(cz.dunya, true);
  return { dugum, sprite, gorunur };
};
const KUTU = { genislik: 1280, yukseklik: 800 };
/** Bu kameranın (olcek 1, merkez sığdırma yok) kapsama kutusu ile kesişen bina sayısı. */
const gorunmesiGerekenBina = (s: IzoSahne, g = G, kutu = KUTU): number => {
  const pay = IZO_STILI.gorunurluk.pay;
  const px = kutu.genislik / g.olcek * pay, py = kutu.yukseklik / g.olcek * pay;
  const x0 = -g.x / g.olcek - s.kaydirma.x - px, y0 = -g.y / g.olcek - s.kaydirma.y - py;
  const x1 = (kutu.genislik - g.x) / g.olcek - s.kaydirma.x + px, y1 = (kutu.yukseklik - g.y) / g.olcek - s.kaydirma.y + py;
  return s.binalar.filter((b) => { const k = c.binaKutusu(b); const sol = k.sol - s.kaydirma.x, sag = k.sag - s.kaydirma.x, ust = k.ust - s.kaydirma.y, alt = k.alt - s.kaydirma.y; return sag >= x0 && sol <= x1 && alt >= y0 && ust <= y1; }).length;
};
const sehirKur = (n: number, sehir = 0): IzoSahne => kur(n, { sehir });

describe("IzoCizimi performans ve bellek bütçesi", () => {
  it("performans_butcesi_tanimli", () => {
    expect(BUT.dprUst).toBe(2);
    expect(BUT.mipmap).toBe(true);
    expect(BUT.dokuButcesiMB).toBeGreaterThan(0);
    expect(BUT.gorunenSpriteButcesi).toBeGreaterThan(0);
    expect(BUT.toplamSpriteButcesi).toBeGreaterThan(BUT.gorunenSpriteButcesi);
  });

  it("parsel_zemini_tek_sprite_ve_ortak_doku_parsel_basina_16_karo_yok", async () => {
    const s = kur(10);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    await bekle();
    const n = s.zemin.parselZemini.length;
    // kaldırım pişirmesi: tek `generateTexture` (ölçek/ro/dosya başına), her parsel tek sprite
    const kaldirimBake = kayit.bake.filter((b) => b.target.children.length >= 4);
    expect(kaldirimBake.length).toBeGreaterThanOrEqual(1);
    expect(kaldirimBake.length).toBeLessThanOrEqual(1 + new Set(s.dolgu.map((d) => d.sprite?.dosya)).size + 2);
    const tum = kat().zemin.children.flatMap((x: any) => (x.children?.length ? x.children : [x])).filter((x: any) => x.anchor !== undefined);
    expect(n).toBeGreaterThan(0);
    // eski düzen parsel başına >= 9 karo sprite'ı verirdi; yeni düzende zemin toplamı bunun altında
    const eskiTaban = s.zemin.yollar.length + s.zemin.cerceve.length + s.zemin.blokZemini.length + 9 * n;
    expect(tum.length).toBeLessThan(eskiTaban);
  });

  it("pisirilmis_parsel_zemini_kutu_ve_ankraj_parsel_elmasini_kapsar", async () => {
    const s = kur(10);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    await bekle();
    const b = kayit.bake[0];
    expect(b).toBeDefined();
    const w = IZO_STILI.karo.genislik, h = IZO_STILI.karo.yukseklik;
    expect(b.frame.width).toBeGreaterThanOrEqual(w * s.olcek * 0.9);
    expect(b.frame.height).toBeGreaterThanOrEqual(h * s.olcek * 0.9);
    expect(b.resolution).toBeGreaterThanOrEqual(2);
  });

  it("pisirme_yoksa_renderer_destegi_yoksa_eski_karo_dosemesi_cokmez", async () => {
    kayit.app = yapApp(vi, false);
    const s = kur(10);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    await bekle();
    const tum = kat().zemin.children.flatMap((x: any) => (x.children?.length ? x.children : [x])).filter((x: any) => x.anchor !== undefined);
    expect(tum.length).toBeGreaterThan(9 * s.zemin.parselZemini.length);
    expect(kayit.bake).toHaveLength(0);
  });

  it("sehir_degisince_dokular_paylasilir_yeniden_yuklenmez", async () => {
    const dokular = dokuSahte();
    yap(dokular).guncelle(sehirKur(40, 0), null, G, 0, adlar, KUTU);
    await bekle();
    const ilk = dokular.doku.mock.calls.length;
    expect(ilk).toBeGreaterThan(0);
    c.guncelle(sehirKur(40, 1), null, G, 0, adlar, KUTU);
    await bekle();
    c.guncelle(sehirKur(40, 0), null, G, 0, adlar, KUTU);
    await bekle();
    // aynı dosya ikinci kez istenmez (zemin, dolgu ve bina grupları kalıcı)
    const dosyalar = dokular.doku.mock.calls.map((a) => (a[0] as SpriteKaydi).dosya);
    expect(new Set(dosyalar).size).toBe(dosyalar.length);
    expect(dokular.doku.mock.calls.length).toBeLessThanOrEqual(ilk + 8); // yalnız yeni şehirde yeni görünen türler
  });

  it("sehir_degisince_zemin_grup_hedefleri_sizmaz", async () => {
    yap().guncelle(sehirKur(40, 0), null, G, 0, adlar, KUTU);
    await bekle();
    const sayi = (): number => kayit.sprites.filter((x) => !x.destroyed).length;
    c.guncelle(sehirKur(40, 1), null, G, 0, adlar, KUTU);
    await bekle();
    const a = sayi();
    for (let i = 0; i < 6; i++) { c.guncelle(sehirKur(40, i % 2), null, G, 0, adlar, KUTU); await bekle(); }
    expect(sayi()).toBeLessThanOrEqual(a + 2); // canlı sprite sayısı turlarda birikmez
  });

  it("300_bina_cizim_listesinde_gorunenler_kadar_sprite_gorunur", () => {
    const s = kur(300);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    const n = say();
    expect(s.binalar.filter((b) => kapOf(b.id).visible).length).toBe(gorunmesiGerekenBina(s));
    expect(gorunmesiGerekenBina(s)).toBeLessThan(s.binalar.length);
    expect(n.gorunur).toBeLessThanOrEqual(BUT.gorunenSpriteButcesi);
    expect(n.gorunur).toBeLessThan(n.sprite * 0.5); // ekran dışı büyük çoğunluk çizilmez
  });

  it("300_bina_tum_sehir_sigdirilmis_toplam_sprite_butce_icinde_eski_duzenin_ucte_biri", async () => {
    const s = kur(300);
    const k = Math.min(KUTU.genislik / s.dunya.genislik, KUTU.yukseklik / s.dunya.yukseklik);
    yap().guncelle(s, null, { x: 0, y: 0, olcek: k }, 0, adlar, KUTU);
    await bekle();
    const n = say();
    expect(n.gorunur).toBeLessThanOrEqual(BUT.toplamSpriteButcesi);
    expect(n.sprite).toBeLessThanOrEqual(BUT.toplamSpriteButcesi);
  });

  it("uc_kademede_gorunen_sprite_sayisi_butce_icinde_ve_kucuk_sehir_tam_gorunur", () => {
    for (const n of [3, 40, 120, 300]) {
      sahteSifirla(); kayit.app = yapApp(vi);
      yap().guncelle(kur(n), null, G, 0, adlar, KUTU);
      expect(say().gorunur, `n=${n}`).toBeLessThanOrEqual(BUT.gorunenSpriteButcesi);
    }
  });

  it("kamera_uzaga_gidince_zemin_ve_dolgu_sprite_leri_gorunmez", async () => {
    const s = kur(120);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    await bekle();
    const yakin = say().gorunur;
    c.guncelle(s, null, { x: -90000, y: -90000, olcek: 1 }, 0, adlar, KUTU);
    expect(say().gorunur).toBe(0);
    expect(yakin).toBeGreaterThan(0);
    c.guncelle(s, null, G, 0, adlar, KUTU);
    expect(say().gorunur).toBe(yakin);
  });

  it("kamera_hareketi_gorunurluk_hesabi_esikli", () => {
    const s = kur(120);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    const n0 = c.gorunurlukHesabi;
    const g0 = say().gorunur;
    for (let i = 1; i <= 5; i++) c.guncelle(s, null, { x: -4 * i, y: 3 * i, olcek: 1 }, 0, adlar, KUTU);
    expect(c.gorunurlukHesabi).toBe(n0); // küçük kayma: yeniden hesap ve görünürlük değişimi yok
    expect(say().gorunur).toBe(g0);
    c.guncelle(s, null, { x: -4000, y: -2500, olcek: 1 }, 0, adlar, KUTU);
    expect(c.gorunurlukHesabi).toBe(n0 + 1);
  });

  it("tint_kullanilir_filtre_yok", () => {
    const dizin = path.resolve(__dirname, "../../../src/oyun/harita");
    for (const f of ["izoCizimi.ts", "HaritaSahnesi.tsx", "spriteDoku.ts", "pixiDoku.ts"]) {
      const kod = fs.readFileSync(path.join(dizin, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(kod, f).not.toMatch(/\.filters\s*=|new\s+\w*Filter\b|from\s+["']pixi-filters["']|BlurFilter|ColorMatrixFilter|DropShadowFilter/);
    }
    // tint gerçekten yazılır: kapalı işletme gri tint ile (filtresiz)
    yap().guncelle(kurD(3, { f0: "kapali" }), null, HEP, 0, adlar, undefined, TAM);
    expect(anaSprite("f0").tint).toBe(IZO_STILI.durum.kapali.tint);
    expect(anaSprite("f0").filters).toBeUndefined();
  });

  it("bos_kare_cpu_sifir_animasyon_yokken_ticker_kapali_render_artmaz", async () => {
    yap().guncelle(kurD(8, Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, "issiz"]))), null, HEP, 0, adlar, undefined, TAM);
    await bekle();
    expect(ticker().adet).toBe(0);
    expect(ticker().started).toBe(false);
    const r = renderSayisi();
    ticker().tick(33); ticker().tick(33);
    await bekle();
    expect(renderSayisi()).toBe(r);
  });

  it("yoket_pisirilmis_dokulari_gercekten_destroy_eder", async () => {
    yap().guncelle(kur(10), null, G, 0, adlar, KUTU);
    await bekle();
    const dokular = kayit.bake.map((b) => b.sonuc);
    expect(dokular.length).toBeGreaterThan(0);
    for (const d of dokular) expect(d.destroyed).toBe(false);
    c.yoket();
    for (const d of dokular) expect(d.destroyed).toBe(true);
  });

  it("olcek_degisince_eski_pisirilmis_dokular_render_sonrasi_destroy_edilir_yenisi_yasar", async () => {
    const s = kur(10);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    await bekle();
    const eskiler = kayit.bake.map((b) => b.sonuc);
    expect(eskiler.length).toBeGreaterThan(0);
    c.guncelle({ ...s, olcek: s.olcek * 1.5 } as IzoSahne, null, G, 0, adlar, KUTU);
    await bekle();
    expect(kayit.bake.length).toBeGreaterThan(eskiler.length);
    for (const d of eskiler) expect(d.destroyed).toBe(true);
    for (const b of kayit.bake.slice(eskiler.length)) expect(b.sonuc.destroyed).toBe(false);
  });

  it("pisirilmis_doku_mipmapli_ve_dogrusal", async () => {
    yap().guncelle(kur(10), null, G, 0, adlar, KUTU);
    await bekle();
    expect(kayit.bake[0].textureSourceOptions).toMatchObject({ autoGenerateMipmaps: true, scaleMode: "linear", mipmapFilter: "linear" });
  });

  it("generateTexture_atarsa_hata_bir_kez_bildirilir_cizim_cokmez", async () => {
    kayit.app.renderer.generateTexture = vi.fn(() => { throw new Error("gl"); });
    const hata = vi.fn();
    yap(dokuSahte(), () => {}, hata).guncelle(kur(10), null, G, 0, adlar, KUTU);
    await bekle();
    expect(kayit.app.renderer.generateTexture.mock.calls.length).toBeGreaterThan(1);
    expect(hata).toHaveBeenCalledTimes(1);
  });

  it("webgl_baglami_geri_gelince_pisirmeler_atilir_ve_zemin_yeniden_kurulur", async () => {
    yap().guncelle(kur(10), null, G, 0, adlar, KUTU);
    await bekle();
    const eskiler = kayit.bake.map((b) => b.sonuc);
    const once = kayit.bake.length;
    expect(once).toBeGreaterThan(0);
    kayit.app.canvas.dispatchEvent(new Event("webglcontextrestored"));
    await bekle();
    for (const d of eskiler) expect(d.destroyed).toBe(true);
    expect(kayit.bake.length).toBe(once * 2); // aynı sayıda yeniden pişirildi
    for (const b of kayit.bake.slice(once)) expect(b.sonuc.destroyed).toBe(false);
    const parselSpr = kat().zemin.children.flatMap((x: any) => x.children ?? []).filter((x: any) => !x.destroyed && kayit.bake.slice(once).some((b) => b.sonuc === x.texture));
    expect(parselSpr.length).toBeGreaterThan(0);
    c.yoket();
    kayit.app.canvas.dispatchEvent(new Event("webglcontextrestored")); // yoket sonrası dinleyici yok: atmaz
  });

  it("hafta_basina_nesne_sayisi_buyumez_300_hafta", () => {
    const s = kur(60);
    yap().guncelle(s, null, G, 0, adlar, KUTU);
    const d0 = say().dugum;
    for (let h = 0; h < 300; h++) c.guncelle(h % 2 ? { ...s } : s, null, G, 0, adlar, KUTU);
    expect(say().dugum).toBe(d0);
  });
});

// --- Görev 18: olay balonları -----------------------------------------------------------

describe("IzoCizimi olay balonları", () => {
  const balonOf = (binaId: string, omur = 3000, id = `${binaId}:kuruldu:20`): any => ({ id, hedef: { binaId }, metinAnahtari: "harita.balon.kuruldu", params: {}, ton: "iyi", omur });
  const balonKat = (): any => kat().govde.children[kat().govde.children.length - 1];
  const balonlar = (): any[] => balonKat().children.filter((k: any) => k.label?.startsWith("balon:"));
  const sahneB = (bl: any[]): IzoSahne => ({ ...kurD(4), balonlar: bl });

  it("azaltilmis_harekette_balon_statik_ve_kisa_omurlu", () => {
    vi.useFakeTimers();
    try {
      yap().guncelle({ ...sahneB([]) }, null, HEP, 0, adlar, undefined, AZALT);
      c.guncelle(sahneB([balonOf("f0")]), null, HEP, 0, adlar, undefined, AZALT);
      expect(balonlar()).toHaveLength(1);
      expect(ticker().started).toBe(false);
      expect(ticker().adet).toBe(0);
      expect(balonlar()[0].alpha).toBe(1);
      vi.advanceTimersByTime(IZO_STILI.balon.azaltMs + 50);
      expect(balonlar()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("balon_binayla_birlikte_kamerada_kayar", () => {
    yap().guncelle(sahneB([]), null, HEP, 0, adlar, undefined, AZALT);
    c.guncelle(sahneB([balonOf("f0")]), null, { x: 50, y: 20, olcek: 0.5 }, 0, adlar, undefined, AZALT);
    const b = balonlar()[0];
    const bina = c.binaKutusu(kurD(4).binalar.find((x) => x.id === "f0")!);
    expect(balonKat().parent).toBe(kat().govde);
    expect(kat().govde.parent.scale.x).toBe(0.5);
    // ekranda sabit boyut: kamera ölçeğinin tersi
    expect(b.scale.x).toBeCloseTo(2);
    const ib = kurD(4).binalar.find((x) => x.id === "f0")!;
    expect(b.position.x).toBeCloseTo(ib.ankraj.x);
    expect(b.position.y).toBeLessThan(ib.ankraj.y);
    expect(bina.sol).toBeDefined();
  });

  it("ayni_balon_bir_kez_ve_yeni_ornek_eskisini_oynatmaz", () => {
    yap().guncelle(sahneB([balonOf("f0")]), null, HEP, 0, adlar, undefined, AZALT);
    expect(balonlar()).toHaveLength(0);
    c.guncelle(sahneB([balonOf("f1")]), null, HEP, 0, adlar, undefined, AZALT);
    expect(balonlar()).toHaveLength(1);
    c.guncelle(sahneB([balonOf("f1")]), null, HEP, 0, adlar, undefined, AZALT);
    expect(balonlar()).toHaveLength(1);
  });

  it("ekran_disi_hedefte_balon_oynatilmaz_kimlik_tuketilmez", () => {
    const UZAK = { x: 1e7, y: 1e7, olcek: 1 };
    const kutu = { genislik: 100, yukseklik: 100 };
    yap().guncelle(sahneB([]), null, UZAK, 0, adlar, kutu, AZALT);
    c.guncelle(sahneB([balonOf("f0")]), null, UZAK, 0, adlar, kutu, AZALT);
    expect(balonlar()).toHaveLength(0);
    c.guncelle(sahneB([balonOf("f0")]), null, HEP, 0, adlar, undefined, AZALT);
    expect(balonlar()).toHaveLength(1);
  });

  it("tam_modda_balon_omrunu_doldurunca_kalkar", () => {
    yap().guncelle(sahneB([]), null, HEP, 0, adlar, undefined, TAM);
    c.guncelle(sahneB([balonOf("f0", 1000)]), null, HEP, 0, adlar, undefined, TAM);
    expect(balonlar()).toHaveLength(1);
    kareler(1200);
    expect(balonlar()).toHaveLength(0);
  });
});
