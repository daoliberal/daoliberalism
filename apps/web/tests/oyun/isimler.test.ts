import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DUNYA_ADLARI, SEHIR_ADLARI } from "@/oyun/copy/isimler";
import { MAX_CITY_NAME, MAX_WORLD_NAME, codePoints, kodNoktasinaKes, normalizeName, randomNames } from "@/oyun/lib/names";
import { DIGER_COGRAFYA, ILCELER, ILLER } from "./fixtures/gercekYerAdlari";

const fold = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/\s+/g, "");
const rules = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../simulasyon/arayuz/registry/metin_kurallari.json"), "utf8"),
) as { forbidden: { id: string; pattern: string }[] };

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("isimler", () => {
  it("lists_sizes", () => {
    expect(DUNYA_ADLARI.length).toBeGreaterThanOrEqual(30);
    expect(SEHIR_ADLARI.length).toBeGreaterThanOrEqual(60);
  });
  it("lists_unique_and_normalized", () => {
    for (const list of [DUNYA_ADLARI, SEHIR_ADLARI]) {
      expect(new Set(list.map(fold)).size).toBe(list.length);
      for (const n of list) expect(normalizeName(n)).toBe(n);
    }
    for (const n of DUNYA_ADLARI) expect(codePoints(n)).toBeLessThanOrEqual(MAX_WORLD_NAME);
    for (const n of SEHIR_ADLARI) expect(codePoints(n)).toBeLessThanOrEqual(MAX_CITY_NAME);
  });
  it("lists_pass_turkish_rules", () => {
    for (const r of rules.forbidden) {
      const re = new RegExp(r.pattern);
      for (const n of [...DUNYA_ADLARI, ...SEHIR_ADLARI]) expect(re.test(n), `${r.id}: ${n}`).toBe(false);
    }
  });
  it("no_real_place_collision", () => {
    // Köy/mahalle düzeyi denetlenmez (fikstür notu).
    expect(ILLER).toHaveLength(81);
    const real = new Set([...ILLER, ...ILCELER].map(fold));
    for (const n of [...DUNYA_ADLARI, ...SEHIR_ADLARI]) expect(real.has(fold(n)), n).toBe(false);
  });
  it("no_real_place_word", () => {
    const generic = new Set(["birliği", "diyarı", "ovası", "yurdu", "cumhuriyeti", "kıyısı", "vadisi", "ovalar", "dağlar", "körfez"].map(fold));
    const real = new Set([...ILLER, ...ILCELER, ...DIGER_COGRAFYA].flatMap((n) => [fold(n), ...n.split(/\s+/).map(fold)]));
    for (const n of [...DUNYA_ADLARI, ...SEHIR_ADLARI]) {
      for (const w of n.split(/\s+/).map(fold)) {
        if (generic.has(w)) continue;
        expect(real.has(w), `${n}: ${w}`).toBe(false);
      }
    }
  });
  it("seeded_rng_deterministic", () => {
    expect(randomNames(lcg(7))).toEqual(randomNames(lcg(7)));
  });
  it("cities_distinct", () => {
    for (let i = 1; i <= 500; i++) {
      const r = randomNames(lcg(i));
      expect(r.cities).toHaveLength(5);
      expect(new Set(r.cities).size).toBe(5);
      expect(DUNYA_ADLARI).toContain(r.world);
      for (const c of r.cities) expect(SEHIR_ADLARI).toContain(c);
    }
  });
  it("previous_excluded", () => {
    const rng = lcg(42);
    let prev = randomNames(rng);
    for (let i = 0; i < 1000; i++) {
      const next = randomNames(rng, prev);
      expect(next.world).not.toBe(prev.world);
      expect([...next.cities].sort()).not.toEqual([...prev.cities].sort());
      prev = next;
    }
  });
  it("previous_excluded_constant_rng", () => {
    // Sabit rng her seferinde aynı kümeyi üretir; dışlama yine de farklı küme vermeli.
    const rng = () => 0.3;
    const first = randomNames(rng);
    const second = randomNames(rng, first);
    expect(second.world).not.toBe(first.world);
    expect([...second.cities].sort()).not.toEqual([...first.cities].sort());
    expect(new Set(second.cities).size).toBe(5);
  });
  it("rng_edge_values", () => {
    for (const v of [0, 0.999999]) {
      const r = randomNames(() => v);
      expect(new Set(r.cities).size).toBe(5);
      expect(DUNYA_ADLARI).toContain(r.world);
      const p = randomNames(() => v, r);
      expect(p.world).not.toBe(r.world);
      expect([...p.cities].sort()).not.toEqual([...r.cities].sort());
      expect(new Set(p.cities).size).toBe(5);
    }
  });
});

describe("kodNoktasinaKes (M9)", () => {
  it("kod_noktasi_sayar_utf16_birimi_degil_ve_cift_vekili_ortadan_bolmez", () => {
    const e = "😀".repeat(5); // 5 kod noktası, 10 UTF-16 birimi
    expect(kodNoktasinaKes(e, 5)).toBe(e);
    expect(kodNoktasinaKes(e, 3)).toBe("😀😀😀");
    expect(kodNoktasinaKes("abc", 5)).toBe("abc");
    expect(codePoints(kodNoktasinaKes("a😀".repeat(40), 60))).toBe(60);
  });
});
