import { describe, expect, it } from "vitest";
import { decodeRecipe, encodeRecipe, recipeToConfig, RECIPE_MAX_BYTES, RECIPE_PREFIX, sealPayload } from "@/oyun/sim/recipe";
import { tarifOf } from "@/oyun/screens/canli/SifirdanBaslat";
import type { RunConfig, RunState } from "@/oyun/sim/types";

const cfg: RunConfig = {
  name: "Benim dünyam", cityNames: ["A", "B", "C", "D", "E"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 3,
  values: { gecis_destegi: "kisa_sureli", ucret_stopaji: 12.5, gider_onceligi: ["a", "b"], kredi: { oran: 4, vade: "kisa", acik: true }, acik: false },
  worldScenarioId: "ozel", worldScenarioValues: { ornek_akce: 3000, b: "x" }, goals: ["alive", "serve"],
  schedule: [{ week: 30, patch: { gecis_destegi: "kapali" } }, { week: 60, patch: { ucret_stopaji: 5 } }],
};

describe("paylaşım kodu", () => {
  it("recipe_code_roundtrip_and_rejects_tampered", () => {
    const e = encodeRecipe(cfg);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.code.startsWith(RECIPE_PREFIX)).toBe(true);
    expect(e.code).toMatch(/^[A-Za-z0-9_.-]+$/); // panoya ve adrese güvenle taşınır
    const d = decodeRecipe(e.code);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    // Ad ve şehir adları koda girmez (kişisel); öteki her alan aynen döner.
    const back = recipeToConfig(d.recipe, "Yeni", ["1", "2", "3", "4", "5"]);
    expect(back).toEqual({ ...cfg, name: "Yeni", cityNames: ["1", "2", "3", "4", "5"] });
    expect(encodeRecipe(back)).toEqual(e); // kararlı: aynı tarif aynı kod
    // Aynı tarifin anahtar sırası değişse de kod değişmez
    expect(encodeRecipe({ ...cfg, values: Object.fromEntries(Object.entries(cfg.values).reverse()) })).toEqual(e);

    // Bozulmuş kod: bir karakter değişir, kesilir, boşluk girer, önek yanlış.
    const i = RECIPE_PREFIX.length + 5;
    const flip = e.code.slice(0, i) + (e.code[i] === "A" ? "B" : "A") + e.code.slice(i + 1);
    expect(decodeRecipe(flip).ok).toBe(false);
    expect(decodeRecipe(e.code.slice(0, -3)).ok).toBe(false);
    expect(decodeRecipe(`${e.code} x`).ok).toBe(false);
    expect(decodeRecipe(e.code.replace(RECIPE_PREFIX, "XYZ9-"))).toEqual({ ok: false, reason: "prefix" });
    expect(decodeRecipe("")).toEqual({ ok: false, reason: "prefix" });
    expect(decodeRecipe(`  ${e.code}\n`).ok).toBe(true); // kenar boşlukları (yapıştırma) kırpılır
  });

  it("rejects_wrong_version_shape_and_oversize", () => {
    const seal = (o: unknown): string => sealPayload(JSON.stringify(o));
    const ok = { v: 1, templateId: "x", durationWeeks: 200, seedIndex: 0, values: {} };
    expect(decodeRecipe(seal(ok)).ok).toBe(true);
    expect(decodeRecipe(seal({ ...ok, v: 2 }))).toEqual({ ok: false, reason: "version" });
    for (const bad of [
      { ...ok, durationWeeks: 0 }, { ...ok, durationWeeks: 1.5 }, { ...ok, seedIndex: -1 }, { ...ok, templateId: 4 },
      { ...ok, values: { a: null } }, { ...ok, values: { a: { b: [] } } }, { ...ok, values: [] }, { ...ok, goals: ["yok"] },
      { ...ok, schedule: [{ week: 0, patch: { a: 1 } }] }, { ...ok, schedule: [{ week: 5, patch: {} }] }, { ...ok, worldScenarioId: 3 }, { ...ok, worldScenarioValues: { a: null } },
      JSON.parse('{"v":1,"templateId":"x","durationWeeks":200,"seedIndex":0,"values":{"__proto__":1}}'),
    ]) expect(decodeRecipe(seal(bad)), JSON.stringify(bad)).toEqual({ ok: false, reason: "shape" });
    expect(decodeRecipe(sealPayload("{kırık"))).toEqual({ ok: false, reason: "json" });
    const big = { ...cfg, values: { ...cfg.values, uzun: "x".repeat(RECIPE_MAX_BYTES) } };
    expect(encodeRecipe(big)).toEqual({ ok: false, reason: "size" });
    expect(decodeRecipe(RECIPE_PREFIX + "A".repeat(RECIPE_MAX_BYTES + 1))).toEqual({ ok: false, reason: "size" });
  });

  it("optional_fields_are_omitted_and_survive_absence", () => {
    const min: RunConfig = { name: "", cityNames: [], templateId: "t", durationWeeks: 100, seedIndex: 0, values: {} };
    const e = encodeRecipe(min);
    if (!e.ok) throw new Error("kodlanmalı");
    const d = decodeRecipe(e.code);
    if (!d.ok) throw new Error("çözülmeli");
    expect(recipeToConfig(d.recipe, "", [])).toEqual(min);
  });

  it("builds_the_code_from_the_runs_recipe_with_the_version_schedule", () => {
    const state = {
      runId: "r", status: "ended", week: 200, durationWeeks: 200, speed: 1, computing: false, version: 2, seedIndex: 2, scenarioId: "dayanikli_taban", name: "A", cityNames: ["1", "2", "3", "4", "5"],
      values: { gecis_destegi: "kapali" },
      versions: [{ version: 1, fromWeek: 0, values: { gecis_destegi: "kisa_sureli" } }, { version: 2, fromWeek: 40, values: { gecis_destegi: "kapali" } }],
    } satisfies RunState;
    const e = encodeRecipe(tarifOf(state));
    if (!e.ok) throw new Error("kodlanmalı");
    const d = decodeRecipe(e.code);
    expect(d.ok && d.recipe.schedule).toEqual([{ week: 40, patch: { gecis_destegi: "kapali" } }]);
    expect(d.ok && d.recipe.values).toEqual({ gecis_destegi: "kisa_sureli" });
  });
});
