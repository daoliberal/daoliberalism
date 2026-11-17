import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tarifOf, tarifKapaliNedeni } from "@/oyun/screens/canli/SifirdanBaslat";
import type { RunState } from "@/oyun/sim/types";

const durum = (over: Partial<RunState>): RunState => ({
  runId: "r", status: "ended", week: 200, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, scenarioId: "dayanikli_taban", name: "A", cityNames: ["1", "2", "3", "4", "5"],
  values: {}, ...over,
});

describe("tarifOf: sürüm takvimi", () => {
  it("one_version_with_two_changes_in_the_same_week_is_one_schedule_entry_with_only_the_changed_keys", () => {
    const tarif = tarifOf(durum({
      version: 2, values: { a: 1, b: 2, c: 3 },
      versions: [{ version: 1, fromWeek: 0, values: { a: 1, b: 1, c: 3 } }, { version: 2, fromWeek: 30, values: { a: 2, b: 2, c: 3 } }],
    }));
    expect(tarif.values).toEqual({ a: 1, b: 1, c: 3 });
    expect(tarif.schedule).toEqual([{ week: 30, patch: { a: 2, b: 2 } }]);
  });

  it("a_key_reverted_to_its_start_value_is_a_diff_against_the_previous_version_not_the_first", () => {
    const tarif = tarifOf(durum({
      version: 3, values: { a: 1 },
      versions: [{ version: 1, fromWeek: 0, values: { a: 1 } }, { version: 2, fromWeek: 10, values: { a: 2 } }, { version: 3, fromWeek: 20, values: { a: 1 } }],
    }));
    expect(tarif.schedule).toEqual([{ week: 10, patch: { a: 2 } }, { week: 20, patch: { a: 1 } }]);
  });

  it("a_version_without_a_diff_is_not_in_the_schedule_and_versions_are_sorted", () => {
    const tarif = tarifOf(durum({
      version: 3, values: { a: 2 },
      versions: [{ version: 3, fromWeek: 40, values: { a: 2 } }, { version: 1, fromWeek: 0, values: { a: 1 } }, { version: 2, fromWeek: 10, values: { a: 2 } }],
    }));
    expect(tarif.schedule).toEqual([{ week: 10, patch: { a: 2 } }]);
  });

  it("object_valued_keys_compare_by_content", () => {
    const tarif = tarifOf(durum({
      version: 2, values: { t: { acik: true, vade: 52 } },
      versions: [{ version: 1, fromWeek: 0, values: { t: { acik: true, vade: 52 } } }, { version: 2, fromWeek: 5, values: { t: { acik: true, vade: 52 } } }],
    }));
    expect(tarif.schedule).toBeUndefined();
  });
});

describe("tek 'özel' sabiti (W9b M-a)", () => {
  it("sifirdan_baslat_uses_the_one_constant_from_insanlarMantik", () => {
    const kaynak = readFileSync(path.resolve(import.meta.dirname, "../../../src/oyun/screens/canli/SifirdanBaslat.tsx"), "utf-8");
    expect(kaynak).not.toMatch(/const\s+\w+\s*=\s*"ozel"/);
    expect(kaynak).toMatch(/import \{[^}]*OZEL_SENARYO[^}]*\} from "\.\.\/insanlar\/insanlarMantik"/);
    expect(tarifKapaliNedeni(durum({ worldScenarioId: "ozel" }))).toBe("ozel");
    expect(tarifKapaliNedeni(durum({ worldScenarioId: "ozel", worldScenarioValues: {} }))).toBeNull();
  });
});

describe("taslakOf: Kurucu'ya devredilen taslak (son inceleme I3)", () => {
  it("sablon_ve_ozel_dunya_degerleri_korunur_cityNames_bes_ise_sehirler_gelir", async () => {
    const { taslakOf } = await import("@/oyun/screens/canli/SifirdanBaslat");
    const taslak = taslakOf(tarifOf(durum({
      scenarioId: "bos_sart", name: "Ada", seedIndex: 3, durationWeeks: 100, goals: ["alive"], worldScenarioId: "ozel", worldScenarioValues: { dunya_x: 5 },
      values: { a: 1 }, cityNames: ["a", "b", "c", "d", "e"],
    })), { a: 2, b: 3 });
    expect(taslak).toMatchObject({
      name: "Ada", templateId: "bos_sart", seedIndex: 3, durationWeeks: 100, goals: ["alive"], worldScenarioId: "ozel", worldScenarioValues: { dunya_x: 5 },
      values: { a: 2, b: 3 }, cities: ["a", "b", "c", "d", "e"],
    });
  });

  it("sehir_sayisi_bes_degilse_bos_sehirler_ve_dunya_yoksa_null", async () => {
    const { taslakOf } = await import("@/oyun/screens/canli/SifirdanBaslat");
    const taslak = taslakOf(tarifOf(durum({ cityNames: ["a"] })), {});
    expect(taslak.cities).toEqual(["", "", "", "", ""]);
    expect(taslak.worldScenarioId).toBeNull();
    expect(taslak.worldScenarioValues).toEqual({});
    expect(taslak.goals).toEqual([]);
  });
});
