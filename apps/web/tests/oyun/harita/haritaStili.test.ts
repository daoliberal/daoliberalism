import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { binaStili, HARITA_STILI, izoCozunurluk, KATMAN_STILI } from "@/oyun/harita/haritaStili";

const HARITA = path.resolve(__dirname, "../../../src/oyun/harita");
const TOKENS = fs.readFileSync(path.resolve(__dirname, "../../../src/styles/tokens.css"), "utf8");
const tokenVar = (n: string): boolean => new RegExp(`${n.replace(/[-]/g, "\\-")}\\s*:`).test(TOKENS);

/** Stilin içindeki tüm `--` ile başlayan dizgiler. */
function tokenAdlari(o: unknown, out: string[] = []): string[] {
  if (typeof o === "string") { if (o.startsWith("--")) out.push(o); }
  else if (o && typeof o === "object") for (const v of Object.values(o)) tokenAdlari(v, out);
  return out;
}

describe("haritaStili", () => {
  it("her_bina_turu_ve_grup_tanimli", () => {
    for (const tur of ["lonca", "sehir", "ahir"] as const) {
      const s = binaStili(tur, undefined);
      expect(["kare", "daire", "dikdortgen"]).toContain(s.sekil);
      expect(s.renk.startsWith("--")).toBe(true);
    }
    const kare = binaStili("isletme", "imalat");
    expect(kare.sekil).toBe("kare");
    expect(binaStili("lonca", undefined).sekil).toBe("daire");
    expect(binaStili("sehir", undefined).sekil).toBe("dikdortgen");
    expect(binaStili("ahir", undefined).sekil).toBe("dikdortgen");
    const renkler = (["hammadde", "imalat", "hizmet", "lojistik"] as const).map((g) => binaStili("isletme", g).renk);
    expect(new Set(renkler).size).toBe(4);
    for (const k of [1, 2, 3, 4] as const) expect(HARITA_STILI.boyut[k]).toBeGreaterThan(0);
    expect(HARITA_STILI.kenarlik.ben).toBeGreaterThan(HARITA_STILI.kenarlik.secili);
    expect(HARITA_STILI.kenarlik.secili).toBeGreaterThan(HARITA_STILI.kenarlik.normal);
  });

  it("her_renk_girisi_tokens_css_icinde", () => {
    // Ton takma adları (`--harita-*`) tokene ekran/ekranRenkleri.test.ts guard'ında çözülür.
    const adlar = tokenAdlari(HARITA_STILI);
    for (const n of tokenAdlari(KATMAN_STILI.ton)) expect(n.startsWith("--harita-"), n).toBe(true);
    expect(adlar.length).toBeGreaterThan(10);
    for (const n of adlar) expect(tokenVar(n), n).toBe(true);
  });

  it("bilesenlerde_renk_ve_token_adi_yok", () => {
    // `//` yorumu yalnız dizge dışında satır sonuna kadar silinir (dizge içindeki `//` ve `://` korunur).
    const yorumsuz = (k: string): string => k.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^(\s*)\/\/.*$/gm, "$1").replace(/([;{}),])\s*\/\/.*$/gm, "$1");
    const RENK = [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/, /\bhsla?\(/, /\b0x[0-9a-fA-F]{6}\b/];
    for (const f of ["HaritaSahnesi.tsx", "SehirTuvaliKap.tsx", "pixiDoku.ts", "varlikYukleyici.ts", "gorunum.ts", "HaritaTablosu.tsx", "adlar.ts", "sehirSahnesi.ts", "sokakAgi.ts", "binaKatalogu.ts"]) {
      const kod = yorumsuz(fs.readFileSync(path.join(HARITA, f), "utf8"));
      for (const re of RENK) expect(kod, `${f} ${re}`).not.toMatch(re);
      expect(kod, f).not.toMatch(/--color-/);
    }
    // CSS modülünde token kullanımı serbest, ham renk yasak.
    const css = fs.readFileSync(path.join(HARITA, "SehirHaritasi.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const re of RENK) expect(css, `css ${re}`).not.toMatch(re);
  });

  it("kaynak_taramasi_yakalar", () => {
    const RENK = [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/, /\bhsla?\(/, /\b0x[0-9a-fA-F]{6}\b/];
    for (const kotu of ['const a = "#fff";', "x = rgba(0,0,0,.5)", "x = hsl(1 2% 3%)", "n = 0xff00aa"]) expect(RENK.some((re) => re.test(kotu)), kotu).toBe(true);
  });
});

describe("izoCozunurluk (DPR üst sınırı)", () => {
  it("izo_dpr_ust_siniri_2", () => {
    expect(izoCozunurluk(3, true)).toBe(2);
    expect(izoCozunurluk(2.625, true)).toBe(2);
    expect(izoCozunurluk(1.5, true)).toBe(1.5);
    expect(izoCozunurluk(1, true)).toBe(1);
  });
  it("klasik_cozunurluk_degismez_gecersiz_dpr_1", () => {
    expect(izoCozunurluk(3, false)).toBe(3);
    expect(izoCozunurluk(0, true)).toBe(1);
    expect(izoCozunurluk(Number.NaN, true)).toBe(1);
  });
});
