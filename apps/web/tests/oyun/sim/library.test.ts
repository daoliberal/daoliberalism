import { afterEach, describe, expect, it, vi } from "vitest";
import { exportRuns, forkTree, importRuns, loadLibrary, saveLibrary, LIBRARY_KEY, type SavedRun } from "@/oyun/sim/library";
import { RECIPE_VERSION, sealPayload, type SharedRecipe } from "@/oyun/sim/recipe";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const recipe = (over: Partial<SharedRecipe> = {}): SharedRecipe => ({
  v: RECIPE_VERSION, templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 1, values: { gecis_destegi: "kapali" },
  schedule: [{ week: 30, patch: { ucret_stopaji: 5 } }], ...over,
});
const run = (id: string, over: Partial<SavedRun> = {}): SavedRun => ({ id, name: `Koşu ${id}`, recipe: recipe(), savedAt: "2026-10-29T10:00:00.000Z", source: "live", ...over });

describe("koşu kütüphanesi", () => {
  it("storage_throws_empty_list_no_crash", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("erişim yok"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("erişim yok"); });
    expect(loadLibrary()).toEqual({ runs: [], available: false });
    expect(saveLibrary([run("a")])).toBe(false);
  });

  it("empty_storage_is_available_and_empty", () => {
    expect(loadLibrary()).toEqual({ runs: [], available: true });
    expect(saveLibrary([run("a")])).toBe(true);
    expect(loadLibrary().runs).toEqual([run("a")]);
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_KEY)!)).toEqual({ schema: 1, runs: [run("a")] });
  });

  it("corrupt_entry_skipped", () => {
    const bad = [{ id: "x" }, 7, null, { ...run("b"), recipe: { v: 1, templateId: "!" } }, { ...run("c"), source: "başka" }, run("a"), run("a", { name: "kopya" })];
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schema: 1, runs: bad }));
    expect(loadLibrary().runs).toEqual([run("a")]);
    window.localStorage.setItem(LIBRARY_KEY, "{bozuk");
    expect(loadLibrary()).toEqual({ runs: [], available: true });
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schema: 2, runs: [run("a")] }));
    expect(loadLibrary().runs).toEqual([]);
  });

  it("export_import_roundtrip", () => {
    const hepsi = [run("a"), run("b", { parentId: "a", forkWeek: 40 }), run("c", { source: "replay", recipe: recipe({ schedule: undefined, goals: ["alive", "gini"] }) })];
    const r = importRuns(exportRuns(hepsi), []);
    expect(r).toEqual({ ok: true, runs: hepsi });
    const tek = importRuns(exportRuns([hepsi[1]!]), []);
    expect(tek).toEqual({ ok: true, runs: [hepsi[1]] });
  });

  it("import_gives_a_new_id_when_it_collides", () => {
    const r = importRuns(exportRuns([run("a")]), [run("a")], () => "ice-1");
    expect(r).toEqual({ ok: true, runs: [run("ice-1", { name: "Koşu a" })] });
  });

  it("import_invalid_json_field_error", () => {
    expect(importRuns("{bozuk", [])).toEqual({ ok: false, errors: [{ reason: "json" }] });
    expect(importRuns("42", [])).toEqual({ ok: false, errors: [{ reason: "shape" }] });
    const eksik = importRuns(JSON.stringify({ ...run("a"), name: undefined }), []);
    expect(eksik).toEqual({ ok: false, errors: [{ reason: "field", index: 1, field: "name" }] });
    const tarif = importRuns(JSON.stringify([run("a"), { ...run("b"), recipe: { ...recipe(), durationWeeks: 0 } }]), []);
    expect(tarif).toEqual({ ok: false, errors: [{ reason: "recipe", index: 2, field: "recipe" }] });
    const buyuk = importRuns(JSON.stringify({ ...run("a"), recipe: JSON.parse(JSON.stringify(recipe({ values: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`ayar_${i}`, "x".repeat(40)])) }))) }), []);
    expect(buyuk).toEqual({ ok: false, errors: [{ reason: "recipe", index: 1, field: "recipe" }] });
    expect(importRuns(JSON.stringify({ ...run("a"), source: "x" }), [])).toEqual({ ok: false, errors: [{ reason: "field", index: 1, field: "source" }] });
    expect(importRuns(JSON.stringify({ ...run("a"), recipe: { ...recipe(), v: 2 } }), [])).toEqual({ ok: false, errors: [{ reason: "recipe", index: 1, field: "recipe" }] });
  });

  it("import_validates_through_the_shared_recipe_validator", () => {
    // sealPayload yalnız sağlama ekler; doğrulamayı recipe.ts yapar (prototip anahtarı reddedilir)
    expect(sealPayload("{}").startsWith("DAO1-")).toBe(true);
    const zehirli = JSON.parse(`{"id":"a","name":"x","savedAt":"2026-10-29T10:00:00.000Z","source":"live","recipe":{"v":1,"templateId":"t","durationWeeks":100,"seedIndex":0,"values":{"__proto__":1}}}`) as unknown;
    expect(importRuns(JSON.stringify(zehirli), []).ok).toBe(false);
  });

  it("fork_tree_nesting", () => {
    const a = run("a"); const b = run("b", { parentId: "a", forkWeek: 40 }); const c = run("c", { parentId: "b", forkWeek: 60 }); const d = run("d", { parentId: "a", forkWeek: 10 }); const e = run("e");
    const agac = forkTree([a, b, c, d, e]);
    expect(agac.map((n) => n.run.id)).toEqual(["a", "e"]);
    expect(agac[0]!.children.map((n) => n.run.id)).toEqual(["b", "d"]);
    expect(agac[0]!.children[0]!.children.map((n) => n.run.id)).toEqual(["c"]);
  });

  it("fork_tree_missing_parent_is_a_root_and_cycles_do_not_crash", () => {
    const yetim = run("y", { parentId: "silinmis", forkWeek: 5 });
    expect(forkTree([yetim]).map((n) => n.run.id)).toEqual(["y"]);
    const x = run("x", { parentId: "z" }); const z = run("z", { parentId: "x" }); const kendi = run("k", { parentId: "k" });
    const ids: string[] = [];
    const gez = (ns: ReturnType<typeof forkTree>): void => ns.forEach((n) => { ids.push(n.run.id); gez(n.children); });
    gez(forkTree([x, z, kendi]));
    expect(ids.sort()).toEqual(["k", "x", "z"]);
  });

  it("week_and_city_names_are_optional_and_validated", () => {
    expect(importRuns(exportRuns([run("a", { week: 40, cityNames: ["A", "B"] })]), [])).toEqual({ ok: true, runs: [run("a", { week: 40, cityNames: ["A", "B"] })] });
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ schema: 1, runs: [run("eski")] }));
    expect(loadLibrary().runs).toEqual([run("eski")]);
    for (const kotu of [{ week: -1 }, { week: 1.5 }, { week: "3" }, { cityNames: "x" }, { cityNames: [1] }, { cityNames: ["a", "b", "c", "d", "e", "f"] }]) {
      expect(importRuns(JSON.stringify({ ...run("a"), ...kotu }), []).ok).toBe(false);
    }
  });

  it("names_longer_than_the_servers_limit_are_a_distinct_field_error_not_trimmed", () => {
    expect(importRuns(JSON.stringify(run("a", { name: "u".repeat(64) })), []).ok).toBe(true);
    expect(importRuns(JSON.stringify(run("a", { name: "u".repeat(65) })), [])).toEqual({ ok: false, errors: [{ reason: "long", index: 1, field: "name" }] });
  });
});
