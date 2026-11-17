import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EKRAN_STILI } from "@/oyun/ekran/ekranStili";

const EKRAN = path.resolve(__dirname, "../../../src/oyun/ekran");
const TOKENS = fs.readFileSync(path.resolve(__dirname, "../../../src/styles/tokens.css"), "utf8");
const css = (f: string): string => fs.readFileSync(path.join(EKRAN, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("ekran stilleri", () => {
  it("tokens_css_degismedi", () => {
    const sha = crypto.createHash("sha256").update(TOKENS).digest("hex");
    expect(sha).toBe("84ae90d10d41fed415f017c8e9b5d7200510f20b6a229340ddefaacb814d22df");
  });

  it("her_renk_takma_adi_var_olan_tokene_cozulur", () => {
    const blok = /\.kok\s*\{([^}]*)\}/.exec(css("ekranRenkleri.module.css"));
    expect(blok).not.toBeNull();
    const ozellikler = [...blok![1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({ ad: m[1], deger: m[2].trim() }));
    expect(ozellikler.length).toBeGreaterThan(8);
    for (const o of ozellikler) {
      expect(/^--(ekran|harita)-/.test(o.ad), o.ad).toBe(true);
      const m = /^var\((--[\w-]+)\)$/.exec(o.deger);
      expect(m, `${o.ad}: ${o.deger}`).not.toBeNull();
      expect(TOKENS.includes(`${m![1]}:`), `${m![1]} tokens.css'te yok`).toBe(true);
    }
  });

  it("kullanilan_her_ekran_takma_adi_tanimli", () => {
    const tanimli = new Set([...css("ekranRenkleri.module.css").matchAll(/(--ekran-[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const f of fs.readdirSync(EKRAN).filter((x) => x.endsWith(".module.css") && x !== "ekranRenkleri.module.css")) {
      for (const m of css(f).matchAll(/var\((--ekran-[\w-]+)\)/g)) expect(tanimli.has(m[1]), `${f} ${m[1]}`).toBe(true);
    }
  });

  it("kirilma_noktalari_css_ile_ayni", () => {
    const hepsi = fs.readdirSync(EKRAN).filter((x) => x.endsWith(".module.css")).map(css).join("\n");
    const px = new Set([...hepsi.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1])));
    expect([...px].sort((a, b) => a - b)).toEqual([EKRAN_STILI.kirilma.telefon, EKRAN_STILI.kirilma.dar].sort((a, b) => a - b));
    expect(EKRAN_STILI.kirilma.telefon).toBe(720);
    expect(EKRAN_STILI.kirilma.dar).toBe(1280);
  });

  it("sehir_listesi_ust_serit_alt_sayfanin_ustunde", () => {
    const z = (f: string, sinif: string): number => Number(new RegExp(`\\.${sinif}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css(f))![1]);
    expect(z("OyunEkrani.module.css", "ustSerit")).toBeGreaterThan(z("AltSayfa.module.css", "sayfa"));
  });

  it("kaplama_tiklamayi_tuvale_birakir_paneller_yakalar", () => {
    const k = css("OyunEkrani.module.css");
    expect(/\.kaplama\s*\{[^}]*pointer-events:\s*none/.test(k)).toBe(true);
    expect(/\.kaplama\s*>\s*\*\s*\{[^}]*pointer-events:\s*auto/.test(k)).toBe(true);
  });
});
