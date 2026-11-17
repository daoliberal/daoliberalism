import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEPKI_KATSAYILARI, faizParametreleri, hedefFaiz, haftalikAdim, type FaizParametreleri } from "@/oyun/sim/faizKurali";
import { contractRegistry } from "../helpers/registryFixtures";
import { sartTabani } from "@/oyun/screens/sart/sartMantik";
import fixture from "../fixtures/faizKurali.json";

type Durum = { ad: string; params: FaizParametreleri; girdi: { infl: number; unemp: number; cd: number; idle: number }; beklenen: number };
const durumlar = fixture.durumlar as unknown as Durum[];

describe("faizKurali", () => {
  it("faiz_target_matches_fixture_both_branches", () => {
    expect(durumlar.length).toBeGreaterThanOrEqual(12);
    expect(durumlar.some((d) => d.params.cd)).toBe(true);
    expect(durumlar.some((d) => !d.params.cd)).toBe(true);
    for (const d of durumlar) expect(hedefFaiz(d.params, d.girdi), d.ad).toBeCloseTo(d.beklenen, 12);
  });

  it("faiz_clamped_min_max", () => {
    const p = durumlar[0]!.params;
    expect(hedefFaiz(p, { infl: 1, unemp: 0, cd: 0, idle: 0.5 })).toBe(p.max);
    expect(hedefFaiz(p, { infl: -1, unemp: 1, cd: 1, idle: 0.5 })).toBe(p.min);
    // girdi aralığı dışındaki enflasyon modeldeki gibi -1..+1'e kırpılır
    expect(hedefFaiz(p, { infl: 9, unemp: 0.25, cd: 0.7, idle: 0.5 })).toBe(hedefFaiz(p, { infl: 1, unemp: 0.25, cd: 0.7, idle: 0.5 }));
  });

  it("rule_off_has_no_policy_rate", () => {
    const p = { ...durumlar[0]!.params, on: false };
    expect(hedefFaiz(p, { infl: 0.1, unemp: 0.3, cd: 0.5, idle: 0.5 })).toBeNull();
  });

  it("step_limit_is_the_pol_step_param", () => {
    const p = durumlar[0]!.params;
    expect(haftalikAdim(p)).toBe(p.step);
    // pol_step: eski faiz + sınırlı adım
    expect(haftalikAdim(p, 0.003, 0.01)).toBeCloseTo(0.003 + p.step, 12);
    expect(haftalikAdim(p, 0.003, 0.0001)).toBeCloseTo(0.003 - p.step, 12);
    expect(haftalikAdim(p, 0.003, 0.0031)).toBeCloseTo(0.0031, 12);
  });

  it("params_come_from_registry_values_in_model_units", () => {
    const reg = contractRegistry();
    const p = faizParametreleri(reg, sartTabani(reg, {}))!;
    expect(p).toMatchObject({ on: true, cd: true, neut: 0.003, min: 0.0001, max: 0.01, step: 0.0003, aInf: 0.01, aU: 0.004, aCd: 0.006, infTgt: 0, uStar: 0.25, cdStar: 0.7 });
    const d = { ...sartTabani(reg, {}), faiz_kurali: "piyasa", kredi_canliligi_hedefi: { acik: false, hedef: 0.7, tepki: "guclu" }, enflasyon_hedefi: { hedef: 2, tepki: "guclu" } };
    const q = faizParametreleri(reg, d)!;
    expect(q).toMatchObject({ on: false, cd: false, aInf: 0.02, infTgt: 0.02 });
    expect(faizParametreleri({ ...reg, cards: [] }, {})).toBeNull();
  });

  it("response_table_matches_the_registry_codec", () => {
    const f = path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/registry/settings.p1.json");
    expect(existsSync(f), f).toBe(true);
    const cards = (JSON.parse(readFileSync(f, "utf-8")) as { settings: { id: string; codec: { fields?: { key: string; codec: { map?: Record<string, number> } }[] } }[] }).settings;
    const tepki = (id: string) => cards.find((c) => c.id === id)!.codec.fields!.find((x) => x.key === "tepki")!.codec.map;
    expect(TEPKI_KATSAYILARI.enflasyon_hedefi).toEqual(tepki("enflasyon_hedefi"));
    expect(TEPKI_KATSAYILARI.dogal_issizlik_kurali).toEqual(tepki("dogal_issizlik_kurali"));
    expect(TEPKI_KATSAYILARI.kredi_canliligi_hedefi).toEqual(tepki("kredi_canliligi_hedefi"));
  });
});
