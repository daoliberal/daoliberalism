// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { semaHatalari, semayaUyar, type SemaTuru } from "@/oyun/tarayici/kayit/sema";
import { HATA_TURLERI, SABITLER, TEL_SEMA, type DevamSonuc, type Yonetici } from "@/oyun/tarayici/kayit/tel";
import { SahteCekirdek, karar, kosuyuKur, sart, tarifOrnek, ANAHTAR } from "./yardimci";

const TEL = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/oyun_server/tarayici/tel_b4.json"), "utf-8")) as Record<string, unknown> & {
  sabitler: Record<string, number>;
  hatalar: Record<string, string>;
  anahtar: SemaTuru;
  goruntu_al: SemaTuru;
  yonetici: SemaTuru;
  gunluk: { karar: SemaTuru; sart: SemaTuru };
  tarif: SemaTuru;
  devam_sonuc: SemaTuru;
  devam_durumlari: Record<string, string>;
};

// Derleme zamani: Yonetici arayuzu ile TEL_SEMA.yonetici ayni anahtar kumesi.
type YonAnahtar = keyof Yonetici;
type SemaAnahtar = keyof typeof TEL_SEMA.yonetici;
const _a: Exclude<YonAnahtar, SemaAnahtar> extends never ? true : never = true;
const _b: Exclude<SemaAnahtar, YonAnahtar> extends never ? true : never = true;
void _a;
void _b;

describe("tel_b4.json sozlesmesi", () => {
  it("sabitler_dosya_ile_ayni", () => {
    expect(SABITLER).toEqual(TEL.sabitler);
  });

  it("tel_sema_kopyasi_dosya_ile_birebir", () => {
    expect(TEL_SEMA.anahtar).toEqual(TEL.anahtar);
    expect(TEL_SEMA.goruntu_al).toEqual(TEL.goruntu_al);
    expect(TEL_SEMA.yonetici).toEqual(TEL.yonetici);
    expect(TEL_SEMA.gunluk).toEqual(TEL.gunluk);
    expect(TEL_SEMA.tarif).toEqual(TEL.tarif);
    expect(TEL_SEMA.devam_sonuc).toEqual(TEL.devam_sonuc);
  });

  it("hata_turleri_dosyadaki_hatalarla_ayni", () => {
    expect([...HATA_TURLERI].sort()).toEqual(Object.keys(TEL.hatalar).sort());
  });

  it("devam_durumlari_dosya_ile_ayni", () => {
    const durumlar: DevamSonuc["durum"][] = ["tamam", "reddedildi", "sapma", "takildi", "basarisiz"];
    expect(durumlar.sort()).toEqual(Object.keys(TEL.devam_durumlari).sort());
  });

  it("sahte_cekirdek_ciktilari_dosya_semasina_uyar", async () => {
    const c = new SahteCekirdek();
    await kosuyuKur(c, "k1", 13);
    c.gunlugeEkle("k1", karar(1, 3));
    c.gunlugeEkle("k1", sart(2, 5));
    const parcalar: Uint8Array[] = [];
    const g = await c.goruntuAl("k1", (p) => parcalar.push(p.slice()));
    const { yonetici, ...ozet } = g;
    expect(semaHatalari(TEL.goruntu_al, ozet)).toEqual([]);
    expect(semaHatalari(TEL.yonetici, yonetici)).toEqual([]);
    expect(semaHatalari(TEL.anahtar, await c.uyumlulukAnahtari())).toEqual([]);
    expect(semaHatalari(TEL.tarif, await c.tarifAl("k1"))).toEqual([]);
    const [k1, s1] = await c.gunlukAl("k1", 0);
    expect(semaHatalari(TEL.gunluk.karar, k1)).toEqual([]);
    expect(semaHatalari(TEL.gunluk.sart, s1)).toEqual([]);
    const r = await c.tariftenOynat({ tarif: tarifOrnek(), gunluk: [], hedefHafta: 2, kosuId: "k2" });
    expect(semaHatalari(TEL.devam_sonuc, r)).toEqual([]);
    c.reddet = 1;
    const red = await c.tariftenOynat({ tarif: tarifOrnek(), gunluk: [karar(1, 0)], hedefHafta: 3, kosuId: "k3" });
    expect(red.durum).toBe("reddedildi");
    expect(semaHatalari(TEL.devam_sonuc, red)).toEqual([]);
  });

  it("anahtar_ornegi_sema_ile_uyumlu", () => {
    expect(semayaUyar(TEL.anahtar, ANAHTAR)).toBe(true);
  });
});

describe("sema yorumlayicisi", () => {
  it("temel_turler_birlesik_ve_isteğe_bagli", () => {
    const s: SemaTuru = { a: "int", b: "str|null", "c?": "dict", d: ["int"] };
    expect(semayaUyar(s, { a: 1, b: null, d: [1, 2] })).toBe(true);
    expect(semayaUyar(s, { a: 1.5, b: null, d: [] })).toBe(false);
    expect(semayaUyar(s, { a: 1, b: "x", d: [1, "y"] })).toBe(false);
    expect(semayaUyar(s, { a: 1, b: "x", d: [], c: [] })).toBe(false);
    expect(semaHatalari(s, { a: 1, b: "x", d: [], z: 1 })).toEqual(["$.z:fazla"]);
    expect(semayaUyar(s, { a: 1, b: "x", d: [], z: 1 }, { siki: false })).toBe(true);
    expect(semaHatalari(s, { b: "x", d: [] })).toEqual(["$.a:yok"]);
    expect(semayaUyar("int|list|null", [1])).toBe(true);
    expect(semayaUyar("bool", 0)).toBe(false);
  });
});
