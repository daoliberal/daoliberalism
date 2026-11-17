/* eslint-disable @typescript-eslint/no-explicit-any -- pixi sahteleri */
import fs from "node:fs";
import path from "node:path";
import { act, cleanup, render, screen as ekran, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { adlandirici } from "@/oyun/harita/adlar";
import { VARSAYILAN_KATALOG } from "@/oyun/harita/binaKatalogu";
import { odakHedefi, SehirCizimi, SehirTuvali } from "@/oyun/harita/HaritaSahnesi";
import { KATMAN_STILI, SEHIR_RENGI } from "@/oyun/harita/haritaStili";
import type { SahneBina, SehirSahnesi } from "@/oyun/harita/tipler";
import { izoSahneKur } from "@/oyun/harita/izoSahne";
import { sehirSahnesi } from "@/oyun/harita/sehirSahnesi";
import { manifestOnbelleginiSifirla } from "@/oyun/harita/useSpriteManifest";
import { packetOf } from "../helpers/fakeLiveServer";
import { izoManifestFiksturu } from "./fikstur/izoManifest";
import { kayit, sahteSifirla } from "./pixiSahte";

const appOzellikleri = vi.hoisted(() => ({ resolution: undefined as number | undefined }));
vi.mock("pixi.js", async () => (await import("./pixiSahte")).pixiSahteFabrikasi());
vi.mock("@pixi/react", async () => {
  const React = await import("react");
  return { Application: ({ onInit, resolution }: { onInit(a: unknown): void; resolution?: number }) => { appOzellikleri.resolution = resolution; React.useEffect(() => { onInit(kayit.app); }, [onInit]); return null; } };
});

const TOK: Record<string, string> = {};
const yapApp = (): any => ({
  stage: new Container(), screen: { width: 800, height: 560 }, renderer: { background: { color: 0 } }, render: vi.fn(), canvas: document.createElement("canvas"),
});
const bina = (id: string, sablon: SahneBina["sablon"], tur: SahneBina["tur"], etiket = "x"): SahneBina => ({
  id, tur, sehir: 0, x: 100, y: 100, boyut: 2, ref: { kind: tur === "isletme" ? "firm" : tur === "lonca" ? "lonca" : "city", ref: id }, etiket, parsel: null, sablon, taban: { g: 40, d: 30 },
});
const sahneOf = (binalar: SahneBina[], ek: Partial<SehirSahnesi> = {}): SehirSahnesi => ({
  susler: [], sehir: 0, ad: "Ada", genislik: 800, yukseklik: 600,
  sokaklar: [{ id: "s", ana: true, yon: "yatay", x: 0, y: 300, genislik: 800, yukseklik: 24 }],
  parseller: [{ id: "p0_0", x: 100, y: 100, genislik: 64, yukseklik: 56, kademe: 0 }],
  binalar, meydan: { x: 400, y: 300, yaricap: 92 },
  sehirBinasi: bina("sehir-0", "sehir", "sehir", "Ada"), ahir: bina("ahir", "ahir", "ahir", "ahir"),
  ben: null, katman: { tur: "yok", tonlar: new Map(), lejant: [], rozetler: [] }, veriYok: false, ...ek,
});
const firma = (id: string, sablon: SahneBina["sablon"] = "imalat"): SahneBina => bina(id, sablon, "isletme", "firin");
const G = { x: 0, y: 0, olcek: 1 };
const adlar = adlandirici();
const kok = (): Element => document.documentElement;
const tex = { width: 200, height: 200 };
const dokuSahte = () => ({ doku: vi.fn(async () => tex as any) });
const bekle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  sahteSifirla();
  for (const k of Object.keys(TOK)) delete TOK[k];
  kayit.app = yapApp();
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ getPropertyValue: (n: string) => TOK[n] ?? `v:${n}` }) as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("SehirCizimi (çekirdek)", () => {
  it("ayni_id_ayni_sprite_korunur_ve_kaybolan_yok_edilir", async () => {
    const d = dokuSahte();
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, () => {});
    c.guncelle(sahneOf([firma("f1"), firma("f2")]), null, G, 0, adlar);
    await bekle();
    const once = [...kayit.sprites];
    c.guncelle(sahneOf([firma("f1"), firma("f2")]), null, G, 0, adlar);
    expect(kayit.sprites).toEqual(once);
    expect(kayit.sprites.length).toBe(4); // f1, f2, şehir, ahır
    expect(once.every((s) => !s.destroyed)).toBe(true);
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    expect(kayit.sprites.filter((s) => s.destroyed)).toHaveLength(1);
    // bina başına tek doku isteği (f1, f2); güncellemeler yeniden istemez
    expect(d.doku.mock.calls.filter((a: any[]) => a[0] === "imalat")).toHaveLength(2);
  });

  it("doku_gelince_sprite_ayak_izine_olceklenir_ve_katalog_capasina_oturur", async () => {
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    await bekle();
    const s = kayit.sprites[0];
    expect(s.texture).toBe(tex);
    expect(s.scale.v).toBeGreaterThan(0);
    expect(s.anchor.x).toBe(VARSAYILAN_KATALOG.imalat[2].capa.x);
    expect(s.position.y).toBe(100 + 15);
  });

  it("etiket_katmani_en_son_eklenir_ve_butun_etiketler_orada", () => {
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    c.guncelle(sahneOf([firma("f1")], { ben: { binaId: "f1", neden: "isyeri" } }), null, G, 0, adlar);
    const kat = c.dunya.children;
    expect(kat).toHaveLength(6); // zemin, yerler (meydan/parsel), süsler, binalar, rozetler, etiketler
    const etiketKat = kat[kat.length - 1];
    expect(kayit.texts.length).toBeGreaterThanOrEqual(3); // şehir, ahır, "Senin işyerin"
    expect(kayit.texts.every((t) => t.parent === etiketKat)).toBe(true);
    expect(kayit.texts.some((t) => t.text === "Senin işyerin")).toBe(true);
    // sonradan eklenen bina etiketi de en üstte
    c.guncelle(sahneOf([firma("f1"), bina("l1", "lonca", "lonca", "lonca1")]), null, G, 0, adlar);
    expect(kayit.texts.every((t) => t.parent === etiketKat)).toBe(true);
  });

  it("katman_tonu_takma_addan_okunur_ve_plakaya_yazilir_resim_tonlanmaz", () => {
    TOK[KATMAN_STILI.ton.dar] = "dar-renk";
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    const k = { tur: "talep" as const, tonlar: new Map([["f1", "dar" as const]]), lejant: [], rozetler: [] };
    c.guncelle(sahneOf([firma("f1")], { katman: k }), null, G, 0, adlar);
    const dolu = kayit.graphics.filter((g) => g.calls.some((x: any[]) => x[0] === "fill" && x[1] === "dar-renk"));
    expect(dolu).toHaveLength(1);
    // sprite'a tint uygulanmaz
    expect(kayit.sprites.every((s) => s.tint === undefined)).toBe(true);
  });

  it("tema_degisince_renkler_yeniden_okunur_ve_dokular_yeniden_istenir", async () => {
    TOK[SEHIR_RENGI.meydan] = "ilk";
    const d = dokuSahte();
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, () => {});
    const s = sahneOf([firma("f1")]);
    c.guncelle(s, null, G, 0, adlar);
    await bekle();
    const z = kayit.graphics.find((g) => g.calls.some((x: any[]) => x[0] === "fill" && x[1] === "ilk"))!;
    TOK[SEHIR_RENGI.meydan] = "ikinci";
    c.guncelle(s, null, G, 0, adlar);
    expect(z.calls.some((x: any[]) => x[1] === "ikinci")).toBe(false);
    c.guncelle(s, null, G, 1, adlar);
    expect(z.calls.some((x: any[]) => x[0] === "fill" && x[1] === "ikinci")).toBe(true);
    expect(d.doku.mock.calls.filter((a: any[]) => a[0] === "imalat")).toHaveLength(2);
  });

  it("issizlik_rozetleri_yalniz_sayi_cizer", () => {
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    const k = { tur: "issizlik" as const, tonlar: new Map(), lejant: [], rozetler: [{ hedef: "sehir" as const, binaId: "sehir-0", sayi: 7 }, { hedef: "meydan" as const, binaId: null, sayi: 12 }] };
    c.guncelle(sahneOf([], { katman: k }), null, G, 0, adlar);
    expect(kayit.texts.filter((t) => t.text === "7" || t.text === "12")).toHaveLength(2);
  });

  it("yukleme_hatasi_hata_geri_cagrisini_tetikler", async () => {
    const hata = vi.fn();
    const c = new SehirCizimi(kayit.app, () => {}, { doku: async () => { throw new Error("404"); } }, kok, hata);
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    await bekle();
    expect(hata).toHaveBeenCalled();
  });

  it("surukleme_sonrasi_tiklama_yutulur", () => {
    const tikla = vi.fn();
    const c = new SehirCizimi(kayit.app, tikla, dokuSahte(), kok, () => {});
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    const kap: any = c.dunya.children[3]!.children[0]; // zemin, yerler, süsler, binalar
    c.tasidi = true;
    kap.h.pointertap![0]!();
    expect(tikla).not.toHaveBeenCalled();
    c.tasidi = false;
    kap.h.pointertap![0]!();
    expect(tikla).toHaveBeenCalledWith({ kind: "firm", ref: "f1" });
  });
});

describe("SehirCizimi onDoku bina kimligini verir", () => {
  it("her_bina_dokusunda_o_binanin_ref_i_ile_cagrilir", async () => {
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    const cagrilar: unknown[] = [];
    c.onDoku = (ref) => cagrilar.push(ref);
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    await bekle();
    expect(cagrilar).toContainEqual({ kind: "firm", ref: "f1" });
    expect(cagrilar).toHaveLength(3); // f1, şehir, ahır
  });
});

describe("SehirCizimi seçilebilir yerler (meydan, boş parsel)", () => {
  const parsel = (id: string, x: number, y: number) => ({ id, x, y, genislik: 64, yukseklik: 56, kademe: 0 });
  const yerler = (c: SehirCizimi): any => c.dunya.children[1];

  it("meydan_zemini_tiklaninca_lonca_meydan_ref_gider_surukleme_yutulur", () => {
    const tikla = vi.fn();
    const c = new SehirCizimi(kayit.app, tikla, dokuSahte(), kok, () => {});
    c.guncelle(sahneOf([]), null, G, 0, adlar);
    const m: any = yerler(c).children[0];
    expect(m.eventMode).toBe("static");
    // isabet alanı meydan dairesi: merkez içeride, uzak nokta dışarıda
    expect(m.hitArea.contains(400, 300)).toBe(true);
    expect(m.hitArea.contains(400 + 93, 300)).toBe(false);
    c.tasidi = true;
    m.h.pointertap[0]();
    expect(tikla).not.toHaveBeenCalled();
    c.tasidi = false;
    m.h.pointertap[0]();
    expect(tikla).toHaveBeenCalledWith({ kind: "lonca", ref: "meydan" });
  });

  it("bos_parseller_yalniz_sahnede_verilirse_secilebilir_ve_secili_olan_kenarlik_alir", () => {
    const tikla = vi.fn();
    const c = new SehirCizimi(kayit.app, tikla, dokuSahte(), kok, () => {});
    c.guncelle(sahneOf([]), null, G, 0, adlar);
    expect(yerler(c).children).toHaveLength(1); // yalnız meydan
    const bos = [parsel("p0_1", 200, 100), parsel("p1_1", 300, 100)];
    c.guncelle(sahneOf([], { bosParseller: bos }), null, G, 0, adlar);
    expect(yerler(c).children).toHaveLength(3);
    const p: any = yerler(c).children[1];
    expect(p.hitArea.contains(200, 100)).toBe(true);
    expect(p.hitArea.contains(300, 100)).toBe(false);
    p.h.pointertap[0]();
    expect(tikla).toHaveBeenCalledWith({ kind: "parsel", ref: "p0_1" });
    expect(p.calls.some((k: any[]) => k[0] === "stroke")).toBe(false);
    c.guncelle(sahneOf([], { bosParseller: bos }), { kind: "parsel", ref: "p0_1" }, G, 0, adlar);
    expect(p.calls.some((k: any[]) => k[0] === "stroke")).toBe(true);
    expect((yerler(c).children[2] as any).calls.some((k: any[]) => k[0] === "stroke")).toBe(false);
    // parsel dolunca (artık boş değil) düğmesi yok edilir
    c.guncelle(sahneOf([], { bosParseller: [bos[1]!] }), null, G, 0, adlar);
    expect(p.destroyed).toBe(true);
  });

  it("secili_meydan_kenarlik_alir", () => {
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    c.guncelle(sahneOf([]), { kind: "lonca", ref: "meydan" }, G, 0, adlar);
    expect(yerler(c).children[0].calls.some((k: any[]) => k[0] === "stroke")).toBe(true);
  });
});

describe("SehirCizimi doku ömrü", () => {
  it("doku_gelince_once_cizer_sonra_eski_dokulari_yok_eder_bina_ve_sus", async () => {
    // Gerçek tarayıcıda: eski doku yok edilmeden önce çizim yapılmazsa Pixi toplu çizim listesi yok edilmiş dokuyu bağlamaya çalışıp atar (tema değişimi).
    const sira: string[] = [];
    const d = { doku: vi.fn(async () => tex as any), susDoku: vi.fn(async () => tex as any), emekliyiAt: vi.fn(() => { sira.push("yoket"); }) };
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, () => {});
    kayit.app.render = vi.fn(() => { sira.push("ciz"); });
    c.guncelle(sahneOf([firma("f1")], { susler: [{ id: "s1", tur: "park", x: 5, y: 5, taban: { g: 10, d: 10 } }] }), null, G, 0, adlar);
    sira.length = 0;
    await bekle();
    expect(sira.filter((x) => x === "yoket")).toHaveLength(4); // üç bina (işletme, şehir, ahır) ve bir süs
    for (let i = 0; i < sira.length; i++) if (sira[i] === "yoket") expect(sira[i - 1], `yoket öncesi ${i}`).toBe("ciz");
  });
});

describe("SehirCizimi geç çözülen doku (awaiter koruması)", () => {
  it("yoket_sonrasi_gec_cozulen_doku_ne_cizer_ne_atar_ve_eski_temanin_gec_dokusu_yenisini_ezmez", async () => {
    const bekleyen: Array<(t: any) => void> = [];
    const d = { doku: vi.fn(() => new Promise<any>((coz) => { bekleyen.push(coz); })), emekliyiAt: vi.fn() };
    const hata = vi.fn();
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, hata);
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    const ilk = bekleyen.length;
    expect(ilk).toBeGreaterThan(0);
    c.guncelle(sahneOf([firma("f1")]), null, G, 1, adlar);                 // tema değişti: her bina için yeni istek, eskisi bayat
    expect(bekleyen.length).toBe(2 * ilk);
    kayit.app.render = vi.fn();
    for (const coz of bekleyen.slice(0, ilk)) coz(tex);                    // bayat istekler geç çözülür
    await bekle();
    expect(kayit.app.render).not.toHaveBeenCalled();                       // bayat doku sahneye bağlanmaz, çizim ve emekli çağrısı yok
    expect(d.emekliyiAt).not.toHaveBeenCalled();
    c.yoket();
    for (const coz of bekleyen.slice(ilk)) coz(tex);                       // yok edilmiş çizime geç gelen doku
    await bekle();
    expect(kayit.app.render).not.toHaveBeenCalled();
    expect(d.emekliyiAt).not.toHaveBeenCalled();
    expect(hata).not.toHaveBeenCalled();
  });
});

describe("SehirCizimi süsler", () => {
  const sus = (id: string, tur: "agac-kumesi" | "park" | "cit" | "meydan-dosemesi", x = 50, y = 60) => ({ id, tur, x, y, taban: { g: 40, d: 20 } });
  const susluDoku = () => ({ doku: vi.fn(async () => tex as any), susDoku: vi.fn(async () => tex as any) });

  it("susler_zemin_ile_binalar_arasinda_cizilir_secilemez_ve_tek_doku_ister", async () => {
    const d = susluDoku();
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, () => {});
    c.guncelle(sahneOf([firma("f1")], { susler: [sus("s1", "park"), sus("s2", "agac-kumesi")] }), null, G, 0, adlar);
    await bekle();
    const [zemin, , susKat, binaKat] = c.dunya.children as any[];
    expect(susKat.children).toHaveLength(2);
    expect(c.dunya.children.indexOf(susKat)).toBeGreaterThan(c.dunya.children.indexOf(zemin));
    expect(c.dunya.children.indexOf(susKat)).toBeLessThan(c.dunya.children.indexOf(binaKat));
    for (const s of susKat.children) {
      expect(s.eventMode).toBe("none");
      expect(s.h.pointertap).toBeUndefined();
      expect(s.texture).toBe(tex);
    }
    c.guncelle(sahneOf([firma("f1")], { susler: [sus("s1", "park"), sus("s2", "agac-kumesi")] }), null, G, 0, adlar);
    expect(d.susDoku).toHaveBeenCalledTimes(2);
  });

  it("sus_konumu_olcegi_ve_capasi_katalogdan_ve_kaybolan_sus_yok_edilir", async () => {
    const d = susluDoku();
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, () => {});
    c.guncelle(sahneOf([], { susler: [sus("s1", "cit", 70, 90), sus("s2", "park")] }), null, G, 0, adlar);
    await bekle();
    const susKat: any = c.dunya.children[2];
    const cit = susKat.children[0];
    expect(cit.position.x).toBe(70);
    expect(cit.position.y).toBe(90);
    expect(cit.scale.v).toBe(40 / tex.width);
    c.guncelle(sahneOf([], { susler: [sus("s2", "park")] }), null, G, 0, adlar);
    expect(susKat.children.filter((s: any) => !s.destroyed)).toHaveLength(1);
    expect(cit.destroyed).toBe(true);
  });

  it("sus_dokusu_olmayan_kaynakta_susler_cizilmez_ama_hata_vermez", () => {
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    expect(() => c.guncelle(sahneOf([], { susler: [sus("s1", "park")] }), null, G, 0, adlar)).not.toThrow();
  });

  it("sus_katmana_girmez_ton_plakasi_yok", () => {
    TOK[KATMAN_STILI.ton.dar] = "dar-renk";
    const c = new SehirCizimi(kayit.app, () => {}, susluDoku(), kok, () => {});
    c.guncelle(sahneOf([firma("f1")], { susler: [sus("s1", "park")], katman: { tur: "talep", tonlar: new Map([["s1", "dar" as const]]), lejant: [], rozetler: [] } }), null, G, 0, adlar);
    expect(kayit.graphics.some((g) => g.calls.some((x: any[]) => x[0] === "fill" && x[1] === "dar-renk"))).toBe(false);
  });
});

describe("SehirCizimi (düzeltme turu 1)", () => {
  it("I1_ayni_id_x_degisince_sprite_konumu_da_guncellenir", async () => {
    const c = new SehirCizimi(kayit.app, () => {}, dokuSahte(), kok, () => {});
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    await bekle();
    const s = kayit.sprites[0];
    expect(s.position.x).toBe(100);
    c.guncelle(sahneOf([{ ...firma("f1"), x: 250, taban: { g: 80, d: 30 } }]), null, G, 0, adlar);
    expect(s.position.x).toBe(250);
    expect(s.scale.v).toBeCloseTo((80 * 1.4) / 200, 5);
  });
  it("I1_bekleyen_doku_varken_sahne_degisirse_guncel_kayit_kullanilir", async () => {
    const coz = (t: any): void => cozucu.forEach((r) => r(t));
    const cozucu: ((t: any) => void)[] = [];
    const d = { doku: vi.fn(() => new Promise<any>((r) => { cozucu.push(r); })) };
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, () => {});
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    c.guncelle(sahneOf([{ ...firma("f1"), x: 300 }]), null, G, 0, adlar);
    coz(tex);
    await bekle();
    expect(kayit.sprites[0].position.x).toBe(300);
  });
  it("I2_yeni_doku_gelince_emekli_dokular_kullanimdaki_kumeyle_temizlenir", async () => {
    const emekliyiAt = vi.fn();
    const c = new SehirCizimi(kayit.app, () => {}, { doku: async () => tex as any, emekliyiAt }, kok, () => {});
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    await bekle();
    const kume = emekliyiAt.mock.calls.at(-1)![0] as Set<unknown>;
    expect(kume.has(tex)).toBe(true);
  });
  it("I2_yoket_yukleyiciyi_temizler", () => {
    const yoket = vi.fn();
    const c = new SehirCizimi(kayit.app, () => {}, { doku: async () => tex as any, yoket }, kok, () => {});
    c.yoket();
    expect(yoket).toHaveBeenCalled();
  });
  it("M3_hata_bir_kez_bildirilir", async () => {
    const hata = vi.fn();
    const c = new SehirCizimi(kayit.app, () => {}, { doku: async () => { throw new Error("x"); } }, kok, hata);
    c.guncelle(sahneOf([firma("f1"), firma("f2"), firma("f3")]), null, G, 0, adlar);
    await bekle();
    expect(hata).toHaveBeenCalledTimes(1);
  });
});

describe("SehirTuvali (bileşen)", () => {
  it("M1_kok_bulunamazsa_gelistirici_uyarisi_bir_kez", async () => {
    const uyari = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<SehirTuvali sahne={sahneOf([firma("f1")])} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} dokular={dokuSahte()} />);
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    expect(uyari).toHaveBeenCalledTimes(1);
    expect(String(uyari.mock.calls[0]![0])).toContain("harita");
  });

  const kur = (over: Partial<Parameters<typeof SehirTuvali>[0]> = {}) => {
    const onSec = vi.fn(); const onKamera = vi.fn();
    const r = render(<SehirTuvali sahne={sahneOf([firma("f1")])} secili={null} onSec={onSec} kamera={G} onKamera={onKamera} dokular={dokuSahte()} {...over} />);
    return { onSec, onKamera, ...r };
  };

  it("secili_binanin_kamera_payi_yalniz_kendi_dokusu_gelince_yeniden_hesaplanir", async () => {
    const bekleyen = new Map<string, (t: any) => void>();
    const dokular = { doku: vi.fn((sablon: string) => new Promise<any>((res) => { bekleyen.set(sablon, res); })) };
    const { onKamera } = kur({ secili: { kind: "firm", ref: "f1" }, pay: { ust: 300, alt: 0, sol: 0, sag: 0 }, dokular: dokular as any });
    await waitFor(() => expect(bekleyen.size).toBe(3));
    // kullanıcı kamerayı oynatır (tekerlek): artık seçili binaya geri çekilmemeli
    kayit.app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, clientX: 10, clientY: 10 }));
    onKamera.mockClear();
    await act(async () => { bekleyen.get("sehir")!(tex); bekleyen.get("ahir")!(tex); await Promise.resolve(); await Promise.resolve(); });
    expect(onKamera).not.toHaveBeenCalled(); // başka binaların dokusu kamerayı oynatmaz
    await act(async () => { bekleyen.get("imalat")!(tex); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(onKamera).toHaveBeenCalled()); // seçili binanın dokusu: kutu yeniden hesaplanır
  });

  it("unmount_dinleyicileri_kaldirir_ve_dunyayi_yoket", async () => {
    const kaldir = vi.spyOn(kayit.app.canvas, "removeEventListener");
    const { unmount } = kur();
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    const dunya = kayit.app.stage.children[0];
    unmount();
    expect(kaldir).toHaveBeenCalledWith("wheel", expect.any(Function));
    expect(kayit.app.stage.h.pointerdown).toHaveLength(0);
    expect(dunya.destroyed).toBe(true);
  });

  it("data_theme_degisince_yeniden_okur_ve_cizer", async () => {
    TOK[SEHIR_RENGI.meydan] = "ilk";
    kur();
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    const g = kayit.graphics.find((x) => x.calls.some((c: any[]) => c[0] === "fill" && c[1] === "ilk"))!;
    TOK[SEHIR_RENGI.meydan] = "ikinci";
    await act(async () => { document.documentElement.setAttribute("data-theme", "dark"); await Promise.resolve(); });
    await waitFor(() => expect(g.calls.some((c: any[]) => c[0] === "fill" && c[1] === "ikinci")).toBe(true));
    document.documentElement.removeAttribute("data-theme");
  });

  it("klavye_arti_eksi_yakinlastirir_giris_odaginda_calismaz", async () => {
    const { onKamera } = kur();
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    onKamera.mockClear();
    for (const key of ["+", "=", "-", "−"]) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", code: "NumpadAdd" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", code: "NumpadSubtract" }));
    expect(onKamera).toHaveBeenCalledTimes(6);
    onKamera.mockClear();
    const giris = document.createElement("input");
    document.body.appendChild(giris);
    giris.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    expect(onKamera).not.toHaveBeenCalled();
    giris.remove();
  });

  it("surukleme_kamerayi_kaydirir_ve_ardindan_tiklamayi_yutar", async () => {
    const { onSec, onKamera } = kur();
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    const st = kayit.app.stage;
    const kap: any = st.children[0].children[3].children[0];
    onKamera.mockClear();
    st.h.pointerdown[0]({ global: { x: 0, y: 0 } });
    st.h.pointermove[0]({ global: { x: 60, y: 0 } });
    expect(onKamera).toHaveBeenCalled();
    st.h.pointerup[0]();
    kap.h.pointertap[0]();
    expect(onSec).not.toHaveBeenCalled();
    st.h.pointerdown[0]({ global: { x: 5, y: 5 } });
    st.h.pointerup[0]();
    kap.h.pointertap[0]();
    expect(onSec).toHaveBeenCalledWith({ kind: "firm", ref: "f1" });
  });

  it("ilk_sigdirma_pixi_screen_henuz_guncellenmediyse_gercek_kapsayici_olcusunu_kullanir", async () => {
    // Pixi `screen` kutu değişiminden sonra gecikmeli güncellenir: sığdırma eski (varsayılan) ölçüyle yapılıp şehir kadraj dışında kalmamalı.
    const gercek = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    const gercekY = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    const onKamera = vi.fn();
    const sahne = sahneOf([firma("f1")], { genislik: 800, yukseklik: 600 });
    render(<SehirTuvali sahne={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={onKamera} dokular={dokuSahte()} />);
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    const g = onKamera.mock.calls.at(-1)![0];
    expect(800 * g.olcek).toBeLessThanOrEqual(400); // 800x560 screen ile sığdırılsaydı ölçek ~0,93 olurdu
    expect(600 * g.olcek).toBeLessThanOrEqual(300);
    gercek.mockRestore();
    gercekY.mockRestore();
  });

  it("secili_bina_sag_panelin_altina_dusuyorsa_kamera_serbest_alana_kayar", async () => {
    // Bina yüzen panelin (pay.sag) altında kalmamalı: kullanıcı kamerayı kendisi oynattıysa (otomatik sığdırma kapalı) seçim onu serbest alana getirir.
    const sahne = sahneOf([{ ...firma("f1"), x: 700, y: 300 }], { genislik: 1600 });
    const pay = { ust: 0, alt: 0, sol: 0, sag: 400 };
    const onKamera = vi.fn();
    const r = render(<SehirTuvali sahne={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={onKamera} pay={pay} dokular={dokuSahte()} />);
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    const st = kayit.app.stage;
    st.h.pointerdown[0]({ global: { x: 0, y: 0 } });
    st.h.pointermove[0]({ global: { x: 1, y: 0 } });
    st.h.pointermove[0]({ global: { x: 60, y: 0 } }); // sürükleme: otomatik sığdırma bırakılır
    st.h.pointerup[0]();
    onKamera.mockClear();
    r.rerender(<SehirTuvali sahne={sahne} secili={{ kind: "firm", ref: "f1" }} onSec={() => {}} kamera={G} onKamera={onKamera} pay={pay} dokular={dokuSahte()} />);
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    const g = onKamera.mock.calls.at(-1)![0];
    expect(700 * g.olcek + g.x).toBeLessThanOrEqual(800 - pay.sag);
    // sprite kutusunun (çizim genişliği 56 = taban 40 x 1,4) sağ kenarı da panelin solunda kalır
    expect((700 + 28) * g.olcek + g.x).toBeLessThanOrEqual(800 - pay.sag);
  });

  it("secili_genis_binanin_ust_kenari_ust_payin_altinda_kalir", async () => {
    // Çizim yüksekliği 56 (çapa y 0,9): kutu üstü = y + taban.d/2 - 0,9*56. Anchor yalnız y=60 iken görünür sayılırdı, kutu üstü pay altına taşar.
    const sahne = sahneOf([{ ...firma("f1"), x: 100, y: 60 }], { genislik: 1600, yukseklik: 1200 });
    const pay = { ust: 100, alt: 0, sol: 0, sag: 0 };
    const onKamera = vi.fn();
    const r = render(<SehirTuvali sahne={sahne} secili={null} onSec={() => {}} kamera={{ x: 0, y: 40, olcek: 1 }} onKamera={onKamera} pay={pay} dokular={dokuSahte()} />);
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    const st = kayit.app.stage;
    st.h.pointerdown[0]({ global: { x: 0, y: 0 } });
    st.h.pointermove[0]({ global: { x: 60, y: 0 } });
    st.h.pointerup[0]();
    await bekle(); // doku gelsin (gerçek çizim yüksekliği)
    onKamera.mockClear();
    r.rerender(<SehirTuvali sahne={sahne} secili={{ kind: "firm", ref: "f1" }} onSec={() => {}} kamera={{ x: 0, y: 40, olcek: 1 }} onKamera={onKamera} pay={pay} dokular={dokuSahte()} />);
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    const g = onKamera.mock.calls.at(-1)![0];
    const ust = (60 + 15 - 0.9 * 56) * g.olcek + g.y;
    expect(ust).toBeGreaterThanOrEqual(pay.ust - 1e-9);
  });

  it("secili_bina_zaten_gorunurse_kamera_oynamaz", async () => {
    const sahne = sahneOf([{ ...firma("f1"), x: 100, y: 300 }], { genislik: 1600 });
    const pay = { ust: 0, alt: 0, sol: 0, sag: 400 };
    const onKamera = vi.fn();
    const r = render(<SehirTuvali sahne={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={onKamera} pay={pay} dokular={dokuSahte()} />);
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    const st = kayit.app.stage;
    st.h.pointerdown[0]({ global: { x: 0, y: 0 } });
    st.h.pointermove[0]({ global: { x: 60, y: 0 } });
    st.h.pointerup[0]();
    onKamera.mockClear();
    r.rerender(<SehirTuvali sahne={sahne} secili={{ kind: "firm", ref: "f1" }} onSec={() => {}} kamera={G} onKamera={onKamera} pay={pay} dokular={dokuSahte()} />);
    await act(async () => { await Promise.resolve(); });
    expect(onKamera).not.toHaveBeenCalled();
  });

  it("doku_seçimden_sonra_gelirse_kamera_payi_gercek_yukseklikle_bir_kez_yeniden_hesaplanir", async () => {
    const cozucular: ((t: any) => void)[] = [];
    const dokular = { doku: vi.fn(() => new Promise<any>((r) => { cozucular.push(r); })) };
    const sahne = sahneOf([{ ...firma("f1"), x: 100, y: 150 }], { genislik: 1600, yukseklik: 1200 });
    const pay = { ust: 100, alt: 0, sol: 0, sag: 0 };
    const onKamera = vi.fn();
    const ek = (secili: any) => <SehirTuvali sahne={sahne} secili={secili} onSec={() => {}} kamera={{ x: 0, y: 0, olcek: 1 }} onKamera={onKamera} pay={pay} dokular={dokular as any} />;
    const r = render(ek(null));
    await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0));
    const st = kayit.app.stage;
    st.h.pointerdown[0]({ global: { x: 0, y: 0 } });
    st.h.pointermove[0]({ global: { x: 60, y: 0 } });
    st.h.pointerup[0]();
    r.rerender(ek({ kind: "firm", ref: "f1" }));
    await bekle();
    onKamera.mockClear();
    await act(async () => { for (const c of cozucular) c({ width: 200, height: 400 }); await Promise.resolve(); await Promise.resolve(); }); // yüksek doku: üst kenar payın altına taşar
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    const g = onKamera.mock.calls.at(-1)![0];
    expect((150 + 15 - 0.9 * 112) * g.olcek + g.y).toBeGreaterThanOrEqual(pay.ust - 1e-9);
    expect(onKamera).toHaveBeenCalledTimes(1); // doku gelince bir kez
  });

  it("bina_kutusu_yardimcisi_cizilen_sprite_ile_ayni", async () => {
    const c = new SehirCizimi(kayit.app, () => {}, { doku: vi.fn(async () => ({ width: 200, height: 300 }) as any) }, kok, () => {});
    const b = { ...firma("f1"), x: 210, y: 130, parsel: "p0_0" };
    c.guncelle(sahneOf([b]), null, G, 0, adlar);
    await bekle();
    const sp = kayit.sprites[0];
    const w = 200 * sp.scale.v;
    const h = 300 * sp.scale.v;
    const sol = sp.position.x - sp.anchor.x * w;
    const ust = sp.position.y - sp.anchor.y * h;
    const k = c.binaKutusu(b);
    expect(k.sol).toBeCloseTo(sol);
    expect(k.sag).toBeCloseTo(sol + w);
    expect(k.ust).toBeCloseTo(ust);
    expect(k.alt).toBeCloseTo(ust + h);
  });
});

describe("SehirCizimi yok edilmiş nesneye yazmaz", () => {
  const gecikenDoku = () => {
    const bekleyen: (() => void)[] = [];
    const al = () => new Promise<any>((coz) => { bekleyen.push(() => coz(tex)); });
    return { bekleyen, d: { doku: vi.fn(al), susDoku: vi.fn(al) } };
  };
  const sus = { id: "s1", tur: "park" as const, x: 5, y: 5, taban: { g: 10, d: 10 } };

  it("sus_dokusu_gelmeden_sus_kalkarsa_yok_edilmis_sprite_a_yazilmaz", async () => {
    const hata = vi.fn();
    const { bekleyen, d } = gecikenDoku();
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, hata);
    c.guncelle(sahneOf([], { susler: [sus] }), null, G, 0, adlar);
    c.guncelle(sahneOf([]), null, G, 0, adlar); // süs kalktı, sprite'ı yok edildi
    expect(kayit.sprites.some((s) => s.destroyed && s.anchor === null)).toBe(true);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    for (const b of bekleyen) b();
    await bekle();
    process.off("unhandledRejection", unhandled);
    expect(hata).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("bina_dokusu_gelmeden_bina_kalkarsa_yok_edilmis_sprite_a_yazilmaz", async () => {
    const hata = vi.fn();
    const { bekleyen, d } = gecikenDoku();
    const c = new SehirCizimi(kayit.app, () => {}, d, kok, hata);
    c.guncelle(sahneOf([firma("f1")]), null, G, 0, adlar);
    c.guncelle(sahneOf([]), null, G, 0, adlar);
    for (const b of bekleyen) b();
    await bekle();
    expect(hata).not.toHaveBeenCalled();
  });
});

describe("SehirTuvali (izometrik sahne)", () => {
  const man = izoManifestFiksturu();
  const izoSahne = () => {
    const firmalar = Array.from({ length: 6 }, (_, i) => [`f${i}`, "market", 0, 10, null, "npc", null, "uretim"] as never);
    const k = sehirSahnesi({ ...packetOf("r", 20, 1) } as never, { hafta: 20, firmalar } as never, { runId: "k", sehirAdlari: ["A"], sehir: 0, katman: "yok", izo: true, parselSecilebilir: true });
    return izoSahneKur(k, man, "t", (_, b) => b);
  };
  const spriteDoku = () => ({ doku: vi.fn(async () => tex as any) });
  const izoEtiketli = () => kayit.containers.filter((k) => String(k.label).startsWith("b:") && !k.destroyed);
  beforeEach(() => manifestOnbelleginiSifirla());

  it("izo_sahne_izoCizimi_ile_cizilir_klasik_dokuya_dokunmaz", async () => {
    const klasik = dokuSahte();
    render(<SehirTuvali sahne={izoSahne()} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} dokular={klasik} spriteDokular={spriteDoku()} manifest={man} />);
    await waitFor(() => expect(izoEtiketli().length).toBeGreaterThan(0));
    expect(klasik.doku).not.toHaveBeenCalled();
  });

  it("izo_dpr_ust_siniri_2_tuval_cozunurlugu_izoda_kisitlanir_klasikte_degil", async () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const ek = (sahne: any) => <SehirTuvali sahne={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} dokular={dokuSahte()} spriteDokular={spriteDoku()} manifest={man} />;
    const r = render(ek(izoSahne()));
    await waitFor(() => expect(izoEtiketli().length).toBeGreaterThan(0));
    expect(appOzellikleri.resolution).toBe(2);
    expect(kayit.app.renderer.resolution).toBe(2);
    r.rerender(ek(sahneOf([firma("f1")])));
    await waitFor(() => expect(kayit.app.renderer.resolution).toBe(3));
    vi.unstubAllGlobals();
  });

  it("mod_degisince_cizim_yeniden_kurulur_izo_dunyasi_yok_edilir", async () => {
    const onKamera = vi.fn();
    const ek = (sahne: any) => <SehirTuvali sahne={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={onKamera} dokular={dokuSahte()} spriteDokular={spriteDoku()} manifest={man} />;
    const r = render(ek(izoSahne()));
    await waitFor(() => expect(izoEtiketli().length).toBeGreaterThan(0));
    const izoDunya = kayit.app.stage.children[0];
    r.rerender(ek(sahneOf([firma("f1")])));
    await waitFor(() => expect(izoDunya.destroyed).toBe(true));
    await waitFor(() => expect(kayit.sprites.some((s) => !s.destroyed && s.texture === tex)).toBe(true)); // klasik bina dokusu
  });

  it("sprite_hatasi_onSpriteHatasi_ile_bir_kez_bildirilir_onHata_cagrilmaz", async () => {
    const onSpriteHatasi = vi.fn();
    const onHata = vi.fn();
    render(<SehirTuvali sahne={izoSahne()} secili={null} onSec={() => {}} kamera={{ x: 0, y: 0, olcek: 0.02 }} onKamera={() => {}} onHata={onHata} onSpriteHatasi={onSpriteHatasi} spriteDokular={{ doku: async () => { throw new Error("404"); } }} manifest={man} />);
    await waitFor(() => expect(onSpriteHatasi).toHaveBeenCalledTimes(1));
    expect(onHata).not.toHaveBeenCalled();
  });

  it("onSpriteHatasi_yoksa_hata_onHata_ya_gider", async () => {
    const onHata = vi.fn();
    render(<SehirTuvali sahne={izoSahne()} secili={null} onSec={() => {}} kamera={{ x: 0, y: 0, olcek: 0.02 }} onKamera={() => {}} onHata={onHata} spriteDokular={{ doku: async () => { throw new Error("404"); } }} manifest={man} />);
    await waitFor(() => expect(onHata).toHaveBeenCalledTimes(1));
  });

  it("manifest_yokken_izo_cizim_kurulmaz_cokmez", async () => {
    render(<SehirTuvali sahne={izoSahne()} secili={null} onSec={() => {}} kamera={G} onKamera={() => {}} spriteDokular={spriteDoku()} />);
    await bekle();
    expect(izoEtiketli()).toHaveLength(0);
  });

  it("izo_dunya_olcusune_gore_sigdirir_ve_tiklama_onSec_e_gider", async () => {
    const s = izoSahne();
    const onKamera = vi.fn();
    const onSec = vi.fn();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    render(<SehirTuvali sahne={s} secili={null} onSec={onSec} kamera={G} onKamera={onKamera} spriteDokular={spriteDoku()} manifest={man} />);
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    const g = onKamera.mock.calls.at(-1)![0];
    expect(s.dunya.genislik * g.olcek).toBeLessThanOrEqual(400 + 1e-6);
    expect(s.dunya.yukseklik * g.olcek).toBeLessThanOrEqual(300 + 1e-6);
    const b = s.binalar.find((x) => x.tur === "isletme")!;
    izoEtiketli().find((k) => k.label === `b:${b.id}`).h.pointertap[0]();
    expect(onSec).toHaveBeenCalledWith(b.ref);
  });
});

describe("SehirTuvali kamera: çoklu işaretçi", () => {
  const kurT = (over: Partial<Parameters<typeof SehirTuvali>[0]> = {}) => {
    const onSec = vi.fn(); const onKamera = vi.fn();
    const sahne = sahneOf([firma("f1")]);
    const r = render(<SehirTuvali sahne={sahne} secili={null} onSec={onSec} kamera={{ x: -100, y: -50, olcek: 1 }} onKamera={onKamera} dokular={dokuSahte()} {...over} />);
    return { onSec, onKamera, ...r };
  };
  const pt = (id: number, x: number, y: number) => ({ pointerId: id, global: { x, y } });
  const hazir = async () => { await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0)); return kayit.app.stage; };

  it("iki_isaretci_kistirir_tek_isaretci_kaydirir", async () => {
    const { onKamera } = kurT();
    const st = await hazir();
    const o0 = onKamera.mock.calls.at(-1)![0].olcek; // otomatik sığdırma sonucu (kamera artık bayat prop değil son hesaplanandır)
    onKamera.mockClear();
    st.h.pointerdown[0](pt(1, 300, 300));
    st.h.pointermove[0](pt(1, 340, 300)); // tek parmak: kaydırma (olcek aynı)
    expect(onKamera).toHaveBeenCalledTimes(1);
    expect(onKamera.mock.calls[0]![0].olcek).toBeCloseTo(o0);
    onKamera.mockClear();
    st.h.pointerdown[0](pt(2, 440, 300)); // ikinci parmak: kıstırma başlar, tek başına kaydırma yok
    expect(onKamera).not.toHaveBeenCalled();
    st.h.pointermove[0](pt(2, 540, 300)); // açıklık 100 -> 200
    expect(onKamera).toHaveBeenCalledTimes(1);
    expect(onKamera.mock.calls[0]![0].olcek).toBeCloseTo(o0 * 2, 1);
    st.h.pointerup[0](pt(2, 540, 300));
    onKamera.mockClear();
    st.h.pointermove[0](pt(1, 360, 300)); // kalan parmak yine kaydırır (sıçrama yok)
    expect(onKamera).toHaveBeenCalledTimes(1);
    expect(onKamera.mock.calls[0]![0].olcek).toBeCloseTo(o0 * 2, 1); // kalan parmak kaydırır, ölçek korunur
  });

  it("ucuncu_parmak_yok_sayilir", async () => {
    const { onKamera } = kurT();
    const st = await hazir();
    st.h.pointerdown[0](pt(1, 300, 300));
    st.h.pointerdown[0](pt(2, 400, 300));
    onKamera.mockClear();
    st.h.pointerdown[0](pt(3, 600, 100));
    st.h.pointermove[0](pt(3, 700, 100));
    expect(onKamera).not.toHaveBeenCalled();
    st.h.pointerup[0](pt(3, 700, 100)); // üçüncünün kalkışı iki parmaklı kıstırmayı bozmaz
    st.h.pointermove[0](pt(2, 500, 300));
    expect(onKamera).toHaveBeenCalledTimes(1);
    expect(onKamera.mock.calls[0]![0].olcek).toBeGreaterThan(1);
  });

  it("pointercancel_durumu_sifirlar", async () => {
    const { onKamera } = kurT();
    const st = await hazir();
    expect(st.h.pointercancel?.length ?? 0).toBeGreaterThan(0);
    st.h.pointerdown[0](pt(1, 300, 300));
    st.h.pointerdown[0](pt(2, 400, 300));
    st.h.pointercancel[0](pt(1, 300, 300)); // tarayıcı jesti devraldı
    onKamera.mockClear();
    st.h.pointermove[0](pt(2, 500, 300)); // artık basılı işaretçi yok: hareket yok sayılır
    st.h.pointermove[0](pt(1, 350, 300));
    expect(onKamera).not.toHaveBeenCalled();
    st.h.pointerdown[0](pt(5, 100, 100)); // yeni tek parmak kaydırır
    st.h.pointermove[0](pt(5, 160, 100));
    expect(onKamera).toHaveBeenCalledTimes(1);
  });

  it("kistirma_sonrasi_tiklama_yutulur_ve_iki_parmakla_sayfa_kaydirmasi_tetiklenmez", async () => {
    const { onSec } = kurT();
    const st = await hazir();
    const kap: any = st.children[0].children[3].children[0];
    st.h.pointerdown[0](pt(1, 300, 300));
    st.h.pointerdown[0](pt(2, 400, 300));
    st.h.pointermove[0](pt(2, 460, 300));
    st.h.pointerup[0](pt(2, 460, 300));
    st.h.pointerup[0](pt(1, 300, 300));
    kap.h.pointertap[0]();
    expect(onSec).not.toHaveBeenCalled();
    // kıstırma/kaydırma tuvalde: sayfa kaydırması touch-action: none ile kapalı
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/oyun/harita/SehirHaritasi.module.css"), "utf8");
    expect(css).toMatch(/touch-action:\s*none/);
  });

  it("unmount_pointercancel_dinleyicisini_de_kaldirir", async () => {
    const { unmount } = kurT();
    const st = await hazir();
    unmount();
    expect(st.h.pointercancel ?? []).toHaveLength(0);
  });

  it("mod_degisince_kamera_yeni_yerlesime_yeniden_sigdirilir_kullanici_oynatmis_olsa_da", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    const onKamera = vi.fn();
    const iz = izoSahneKurT();
    const ek = (sahne: any) => <SehirTuvali sahne={sahne} secili={null} onSec={() => {}} kamera={G} onKamera={onKamera} dokular={dokuSahte()} spriteDokular={{ doku: vi.fn(async () => tex as any) }} manifest={izoManifestFiksturu()} />;
    const r = render(ek(iz));
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    kayit.app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, clientX: 10, clientY: 10 })); // kullanıcı oynattı
    onKamera.mockClear();
    const klasik = sahneOf([firma("f1")], { genislik: 800, yukseklik: 600 });
    r.rerender(ek(klasik));
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    const g = onKamera.mock.calls.at(-1)![0];
    expect(800 * g.olcek).toBeLessThanOrEqual(400 + 1e-6);
    expect(600 * g.olcek).toBeLessThanOrEqual(300 + 1e-6);
    onKamera.mockClear();
    r.rerender(ek(iz));
    await waitFor(() => expect(onKamera).toHaveBeenCalled());
    const h = onKamera.mock.calls.at(-1)![0];
    expect(iz.dunya.genislik * h.olcek).toBeLessThanOrEqual(400 + 1e-6);
    expect(iz.dunya.yukseklik * h.olcek).toBeLessThanOrEqual(300 + 1e-6);
  });
});

function izoSahneKurT() {
  const firmalar = Array.from({ length: 6 }, (_, i) => [`f${i}`, "market", 0, 10, null, "npc", null, "uretim"] as never);
  const k = sehirSahnesi({ ...packetOf("r", 20, 1) } as never, { hafta: 20, firmalar } as never, { runId: "k", sehirAdlari: ["A"], sehir: 0, katman: "yok", izo: true, parselSecilebilir: true });
  return izoSahneKur(k, izoManifestFiksturu(), "t", (_, b) => b);
}

describe("SehirTuvali kamera: birikimli olaylar ve eşik", () => {
  const kurT = () => {
    const onKamera = vi.fn();
    render(<SehirTuvali sahne={sahneOf([firma("f1")], { genislik: 3000, yukseklik: 2000 })} secili={null} onSec={() => {}} kamera={{ x: -500, y: -400, olcek: 1 }} onKamera={onKamera} dokular={dokuSahte()} />);
    return onKamera;
  };
  const hazir = async () => { await waitFor(() => expect(kayit.graphics.length).toBeGreaterThan(0)); return kayit.app.stage; };
  const wheel = (o: WheelEventInit) => kayit.app.canvas.dispatchEvent(new WheelEvent("wheel", { clientX: 100, clientY: 100, ...o }));

  /** Haritayı büyütür (sınırlar gevşesin) ve son kamerayı döner. */
  const yakin = (onKamera: ReturnType<typeof vi.fn>) => {
    for (let i = 0; i < 4; i++) wheel({ deltaY: -300 });
    return onKamera.mock.calls.at(-1)![0] as { x: number; y: number; olcek: number };
  };

  it("render_olmadan_iki_ardisik_wheel_birikimli_hesaplanir", async () => {
    const onKamera = kurT();
    await hazir();
    onKamera.mockClear();
    wheel({ deltaY: -100 });
    wheel({ deltaY: -100 });
    const [a, b] = [onKamera.mock.calls[0]![0], onKamera.mock.calls[1]![0]];
    expect(a.olcek).toBeGreaterThan(0);
    expect(b.olcek / a.olcek).toBeCloseTo(Math.exp(0.15), 5); // ikinci olay birincinin sonucundan başlar (prop hiç güncellenmedi)
  });

  it("render_olmadan_iki_ardisik_pointermove_birikimli_kaydirir", async () => {
    const onKamera = kurT();
    const st = await hazir();
    yakin(onKamera);
    st.h.pointerdown[0]({ pointerId: 1, pointerType: "mouse", global: { x: 0, y: 0 } });
    onKamera.mockClear();
    st.h.pointermove[0]({ pointerId: 1, pointerType: "mouse", global: { x: -20, y: 0 } });
    st.h.pointermove[0]({ pointerId: 1, pointerType: "mouse", global: { x: -40, y: 0 } });
    const [a, b] = [onKamera.mock.calls[0]![0], onKamera.mock.calls[1]![0]];
    expect(b.x - a.x).toBeCloseTo(-20); // birikimli: ikinci adım birincinin üstüne biner
  });

  it("trackpad_iki_parmak_kaydirmasi_yakinlastirmaz_kaydirir", async () => {
    const onKamera = kurT();
    await hazir();
    const once = yakin(onKamera);
    onKamera.mockClear();
    wheel({ deltaX: 10, deltaY: 6 });
    const g = onKamera.mock.calls[0]![0];
    expect(g.olcek).toBeCloseTo(once.olcek);
    expect(g.x).toBeCloseTo(once.x - 10);
    expect(g.y).toBeCloseTo(once.y - 6);
  });

  it("surukleme_esigi_dokunmatikte_10_fare_4_piksel", async () => {
    const onKamera = kurT();
    const st = await hazir();
    onKamera.mockClear();
    st.h.pointerdown[0]({ pointerId: 1, pointerType: "touch", global: { x: 0, y: 0 } });
    st.h.pointermove[0]({ pointerId: 1, pointerType: "touch", global: { x: 8, y: 0 } });
    expect(onKamera).not.toHaveBeenCalled();
    st.h.pointermove[0]({ pointerId: 1, pointerType: "touch", global: { x: 12, y: 0 } });
    expect(onKamera).toHaveBeenCalledTimes(1);
    st.h.pointerup[0]({ pointerId: 1 });
    st.h.pointerdown[0]({ pointerId: 2, pointerType: "mouse", global: { x: 0, y: 0 } });
    st.h.pointermove[0]({ pointerId: 2, pointerType: "mouse", global: { x: 3, y: 0 } });
    expect(onKamera).toHaveBeenCalledTimes(1);
    st.h.pointermove[0]({ pointerId: 2, pointerType: "mouse", global: { x: 5, y: 0 } });
    expect(onKamera).toHaveBeenCalledTimes(2);
  });
});

describe("odakHedefi (kimlik tabanli odak)", () => {
  it("ahir_odagi_etkin_izo_sahnenin_ahir_hucresine", () => {
    const iz = izoSahneKurT();
    const ahirIzo = iz.binalar.find((b) => b.id === "ahir")!;
    expect(odakHedefi(iz, { bina: "ahir" })).toEqual({ x: ahirIzo.ekran.x + iz.kaydirma.x, y: ahirIzo.ekran.y + iz.kaydirma.y });
  });
  it("isletme_kimligiyle_izo_hucresine_klasikte_x_y", () => {
    const iz = izoSahneKurT();
    const f = iz.binalar.find((b) => b.tur === "isletme")!;
    expect(odakHedefi(iz, { bina: f.id })).toEqual({ x: f.ekran.x + iz.kaydirma.x, y: f.ekran.y + iz.kaydirma.y });
    const s = sahneOf([firma("f1")]);
    const b = s.binalar.find((x) => x.id === "f1")!;
    expect(odakHedefi(s, { bina: "f1" })).toEqual({ x: b.x, y: b.y });
    expect(odakHedefi(s, { bina: "ahir" })).toEqual({ x: s.ahir.x, y: s.ahir.y });
  });
  it("bilinmeyen_kimlik_null_koordinat_aynen", () => {
    const iz = izoSahneKurT();
    expect(odakHedefi(iz, { bina: "yok" })).toBeNull();
    expect(odakHedefi(iz, { x: -5, y: -7 })).toEqual({ x: -5, y: -7 });
  });
});

describe("SehirTuvali izo ipucu", () => {
  const kurIpucu = async (seciliMi = false) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    const iz = izoSahneKurT();
    const onSec = vi.fn();
    const secili = seciliMi ? iz.binalar.find((x) => x.tur === "isletme")!.ref : null;
    const r = render(<SehirTuvali sahne={iz} secili={secili} onSec={onSec} kamera={G} onKamera={() => {}} dokular={dokuSahte()} spriteDokular={{ doku: vi.fn(async () => tex as any) }} manifest={izoManifestFiksturu()} />);
    await waitFor(() => expect(kayit.containers.some((k: any) => k.label?.startsWith("b:"))).toBe(true));
    const kapOf = (id: string): any => kayit.containers.find((k: any) => k.label === `b:${id}`);
    return { iz, onSec, r, kapOf };
  };
  it("hover_ipucu_gosterir_cikinca_kapanir_ve_tuval_aria_describedby_ile_baglanir", async () => {
    const { iz, kapOf } = await kurIpucu();
    const b = iz.binalar.find((x) => x.tur === "isletme")!;
    expect(document.querySelector("[data-harita-sahne]")).not.toHaveAttribute("aria-describedby");
    act(() => kapOf(b.id).h.pointerover[0]({ pointerType: "mouse", global: { x: 40, y: 50 } }));
    const ip = await ekran.findByRole("tooltip");
    expect(document.querySelector("[data-harita-sahne]")).toHaveAttribute("aria-describedby", ip.id);
    act(() => kapOf(b.id).h.pointerout[0]({ pointerType: "mouse" }));
    expect(ekran.queryByRole("tooltip")).toBeNull();
    expect(document.querySelector("[data-harita-sahne]")).not.toHaveAttribute("aria-describedby");
  });
  it("dokunmatikte_tiklama_secer_ve_ipucu_gosterir_sonraki_dokunus_kapatir", async () => {
    const { iz, kapOf, onSec } = await kurIpucu(true);
    const b = iz.binalar.find((x) => x.tur === "isletme")!;
    act(() => kapOf(b.id).h.pointertap[0]({ pointerType: "touch", global: { x: 40, y: 50 } }));
    expect(onSec).toHaveBeenCalledWith(b.ref);
    expect(await ekran.findByRole("tooltip")).toBeInTheDocument();
    act(() => kayit.app.stage.h.pointerdown[0]({ pointerId: 1, pointerType: "touch", global: { x: 5, y: 5 } }));
    expect(ekran.queryByRole("tooltip")).toBeNull();
  });
});
