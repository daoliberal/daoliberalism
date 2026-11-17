import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KATMAN_STILI, SABLON_RENGI, SEHIR_RENGI, SVG_KATMANLARI } from "@/oyun/harita/haritaStili";

const CSS = fs.readFileSync(path.resolve(__dirname, "../../../src/oyun/ekran/ekranRenkleri.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const blok = /\.kok\s*\{([^}]*)\}/.exec(CSS)![1]!;
const takmaAdlar = new Map([...blok.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

function adlar(o: unknown, out: string[] = []): string[] {
  if (typeof o === "string") { if (o.startsWith("--harita-")) out.push(o); }
  else if (o && typeof o === "object") for (const v of Object.values(o)) adlar(v, out);
  return out;
}

describe("ekranRenkleri (harita kullanımı; token çözümü ekranStili.test.ts guard'ında)", () => {
  it("harita_stilinin_kullandigi_her_takma_ad_tanimli", () => {
    const kullanilan = [...adlar(SEHIR_RENGI), ...adlar(KATMAN_STILI.ton), ...adlar(SABLON_RENGI), ...adlar(SVG_KATMANLARI)];
    expect(kullanilan.length).toBeGreaterThan(25);
    for (const ad of kullanilan) expect(takmaAdlar.has(ad), ad).toBe(true);
  });
});
