import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOYLAR, katalogKaydi } from "@/oyun/harita/binaKatalogu";
import { SVG_KATMANLARI } from "@/oyun/harita/haritaStili";
import { SUS_KATALOGU, SUSLER } from "@/oyun/harita/susKatalogu";

const KOK = path.resolve(import.meta.dirname, "../../../public/oyun-harita");
const KAMU = ["lonca", "sehir", "ahir"] as const;
const ZORUNLU: Record<(typeof KAMU)[number], string[]> = {
  lonca: ["duvar", "cati", "pencere", "kapi"],
  sehir: ["duvar", "cati", "pencere", "kapi"],
  ahir: ["duvar", "cati", "kapi", "saman"],
};
const oku = (dosya: string): string => readFileSync(path.join(KOK, dosya), "utf8");
const etiketler = (svg: string): string[] => svg.match(/<(?!\/|\?|!)[^>]*>/g) ?? [];
const CIZIM = /^<(rect|polygon|circle|path|ellipse|line|polyline)\b/;

function denetle(svg: string): void {
  expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  expect(svg).not.toMatch(/\b(fill|stroke|style|stop-color|color)\s*=/i);
  expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(svg).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/i);
  expect(svg).not.toMatch(/="(red|green|blue|black|white|gray|grey|orange|yellow|brown|none|currentColor)"/i);
  expect(svg).not.toMatch(/<(text|image|use|linearGradient|radialGradient)\b/);
  for (const e of etiketler(svg)) {
    if (!CIZIM.test(e)) continue;
    const k = /data-katman="([^"]+)"/.exec(e)?.[1];
    expect(k, e).toBeDefined();
    expect(Object.keys(SVG_KATMANLARI), e).toContain(k);
  }
}

describe("kamu binası çizimleri", () => {
  for (const s of KAMU) {
    for (const b of BOYLAR) {
      it(`test_${s}_${b}_dosya_var_renksiz_ve_katmanli`, () => {
        const kayit = katalogKaydi(s, b);
        expect(kayit.dosya).toBe(`sablonlar/${s}-${b}.svg`);
        expect(existsSync(path.join(KOK, kayit.dosya))).toBe(true);
        const svg = oku(kayit.dosya);
        denetle(svg);
        for (const k of ZORUNLU[s]) expect(svg, k).toContain(`data-katman="${k}"`);
        expect(svg).not.toContain("data-ek");
      });
    }
    it(`test_${s}_buyuk_boy_daha_ayrintili`, () => {
      const adet = BOYLAR.map((b) => etiketler(oku(`sablonlar/${s}-${b}.svg`)).filter((e) => CIZIM.test(e)).length);
      for (let i = 1; i < adet.length; i++) expect(adet[i]!, `${s} ${i + 1}`).toBeGreaterThan(adet[i - 1]!);
    });
  }
});

describe("zemin süsleri", () => {
  it("test_dort_sus_kayitli", () => {
    expect([...SUSLER].sort()).toEqual(["agac-kumesi", "cit", "meydan-dosemesi", "park"]);
  });
  for (const s of SUSLER) {
    it(`test_sus_${s}_dosya_var_renksiz_ve_katmanli`, () => {
      const k = SUS_KATALOGU[s];
      expect(existsSync(path.join(KOK, k.dosya))).toBe(true);
      const svg = oku(k.dosya);
      denetle(svg);
      expect(k.capa.x).toBeGreaterThanOrEqual(0);
      expect(k.capa.x).toBeLessThanOrEqual(1);
      expect(k.capa.y).toBeGreaterThanOrEqual(0);
      expect(k.capa.y).toBeLessThanOrEqual(1);
      expect(k.taban.g).toBeGreaterThan(0);
      expect(k.taban.d).toBeGreaterThan(0);
    });
  }
});
