import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOYLAR, katalogKaydi } from "@/oyun/harita/binaKatalogu";
import { SVG_KATMANLARI } from "@/oyun/harita/haritaStili";

const KOK = path.resolve(import.meta.dirname, "../../../public/oyun-harita");
const ISLETME = ["hammadde", "imalat", "hizmet", "lojistik"] as const;
/** Brief "vurgu" der; takma ad katmanı ayrinti2 (--harita-vurgu), "kontur" katman değil: yükleyici kontur çizer. */
const ZORUNLU: Record<(typeof ISLETME)[number], string[]> = {
  hammadde: ["duvar", "cati", "pencere", "kapi", "metal", "ayrinti2"],
  imalat: ["duvar", "cati", "pencere", "kapi", "metal", "ayrinti2", "duman"],
  hizmet: ["duvar", "cati", "pencere", "kapi", "ayrinti2"],
  lojistik: ["duvar", "cati", "pencere", "kapi", "metal", "ayrinti2"],
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

describe("işletme şablonu çizimleri", () => {
  for (const s of ISLETME) {
    for (const b of BOYLAR) {
      it(`test_${s}_${b}_dosya_var_renksiz_ve_katmanli`, () => {
        const kayit = katalogKaydi(s, b);
        expect(kayit.dosya).toBe(`sablonlar/${s}-${b}.svg`);
        expect(existsSync(path.join(KOK, kayit.dosya))).toBe(true);
        const svg = oku(kayit.dosya);
        denetle(svg);
        for (const k of ZORUNLU[s]) expect(svg, k).toContain(`data-katman="${k}"`);
        expect(svg).not.toContain("data-ek");
        expect(svg).not.toMatch(/<(g|svg)\b[^>]*\b(fill|stroke)\b/);
      });
    }
    it(`test_${s}_buyuk_boy_daha_ayrintili`, () => {
      const adet = BOYLAR.map((b) => etiketler(oku(`sablonlar/${s}-${b}.svg`)).filter((e) => CIZIM.test(e)).length);
      for (let i = 1; i < adet.length; i++) expect(adet[i]!, `${s} ${i + 1}`).toBeGreaterThan(adet[i - 1]!);
    });
    it(`test_${s}_tum_boylar_viewbox_icinde`, () => {
      for (const b of BOYLAR) {
        const svg = oku(`sablonlar/${s}-${b}.svg`);
        const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.map(Number) as [number, number, number];
        for (const e of etiketler(svg).filter((x) => CIZIM.test(x))) {
          const sayi = (ad: string): number | null => { const m = new RegExp(`\\b${ad}="(-?[\\d.]+)"`).exec(e); return m ? Number(m[1]) : null; };
          const x = sayi("x"), y = sayi("y"), gw = sayi("width"), gh = sayi("height");
          if (x !== null && gw !== null) { expect(x, e).toBeGreaterThanOrEqual(0); expect(x + gw, e).toBeLessThanOrEqual(w); }
          if (y !== null && gh !== null) { expect(y, e).toBeGreaterThanOrEqual(0); expect(y + gh, e).toBeLessThanOrEqual(h); }
          const pts = /\bpoints="([^"]+)"/.exec(e)?.[1];
          if (pts) for (const nokta of pts.split(" ")) {
            const [px, py] = nokta.split(",").map(Number) as [number, number];
            expect(px, e).toBeGreaterThanOrEqual(0); expect(px, e).toBeLessThanOrEqual(w);
            expect(py, e).toBeGreaterThanOrEqual(0); expect(py, e).toBeLessThanOrEqual(h);
          }
        }
      }
    });
  }
});
