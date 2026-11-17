import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { t } from "@/oyun/copy/t";
import { surumSatirlari } from "@/oyun/screens/canli/OlayAkisi";
import { createReplaySource } from "@/oyun/sim/replay";
import { encodeRunId } from "@/oyun/sim/replay/runId";
import type { SimEvent, WorldEvent } from "@/oyun/sim/types";
import { contractRegistry, contractRegistryRaw } from "../helpers/registryFixtures";
import { allFiles, fakeTimer, makeFetch } from "../helpers/replayFixture";

const KURALLAR = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../simulasyon/arayuz/registry/metin_kurallari.json"), "utf-8")) as { forbidden: { id: string; pattern: string }[] }).forbidden;
const ihlal = (s: string): string[] => KURALLAR.filter((r) => new RegExp(r.pattern, "u").test(s)).map((r) => r.id);

const olay = (changes: NonNullable<WorldEvent["changes"]>, week = 41): WorldEvent => ({
  id: `version:2:${week}:x`, week, kind: "neutral", textKey: "event.version", params: { hafta: week, surum: 2 }, critical: false, sector: null, rule_ids: [], changes,
});

describe("Sürüm olayı metni", () => {
  it("version_event_lines_turkish", () => {
    const reg = contractRegistry();
    const e = olay([
      { id: "gecis_destegi", from: "kapali", to: "kisa_sureli" },
      { id: "ucret_stopaji", from: 10, to: 12.5 },
      { id: "ornek_akce", from: 2000, to: 4500 },
    ]);
    const baslik = t("event.version", { hafta: 41 });
    expect(baslik).toBe("Hf 41: Şart değişti, 41. haftadan sonrası yeni kuralla");
    const satirlar = surumSatirlari(e, reg);
    expect(satirlar).toEqual([
      "Geçiş desteği: kapalı → kısa süreli",
      "Ücret stopajı: %10 → %12,5",
      expect.stringMatching(/^Örnek tutar: .*2\.?000 Akçe → .*4\.?500 Akçe$/),
    ]);
    for (const s of [baslik, ...satirlar]) expect(ihlal(s), s).toEqual([]);
  });

  it("eski_deger_yoksa_yalniz_yeni_ve_kayitta_olmayan_ayar_atlanir", () => {
    const reg = contractRegistry();
    const e = olay([
      { id: "ucret_stopaji", from: null, to: 15 },
      { id: "olmayan_kart", from: 1, to: 2 },
    ]);
    expect(surumSatirlari(e, reg)).toEqual(["Ücret stopajı: %15"]);
    expect(surumSatirlari(e, null)).toEqual([]);
    expect(surumSatirlari({ ...e, textKey: "event.cokus", changes: undefined }, reg)).toEqual([]);
  });
});

describe("Kayıt kaynağı sürüm olayı", () => {
  const CITIES = ["a", "b", "c", "d", "e"];
  const rid = encodeRunId({ setId: "kapali", seedIndex: 0, changes: [], name: "Ada Dünyası", cityNames: CITIES });
  function kur() {
    const files = { ...allFiles(), "/k/registry.json": JSON.stringify(contractRegistryRaw()) };
    const timer = fakeTimer();
    const source = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(files), timer, computeMs: 300 });
    return { source, timer };
  }
  async function bekle(timer: ReturnType<typeof fakeTimer>): Promise<void> {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    timer.advance(300);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  it("replay_version_event_has_changes", async () => {
    const { source, timer } = kur();
    await source.open(rid);
    await source.control(rid, { action: "step" });
    await source.control(rid, { action: "step" });
    const got: WorldEvent[] = [];
    const off = source.subscribe(rid, (e: SimEvent) => {
      if (e.type === "world_event" && e.event.textKey === "event.version") got.push(e.event);
    });
    const p = source.applyChange(rid, { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" } });
    await bekle(timer);
    const r = await p;
    expect(r.accepted).toBe(true);
    expect(got).toHaveLength(1);
    expect(got[0]!.changes).toEqual([{ id: "gecis_destegi", from: "kapali", to: "kurtarma_fonuyla" }]);
    off();
    source.dispose();
  });

  it("replay_note_kept_in_session_and_listed_in_versions", async () => {
    const { source, timer } = kur();
    await source.open(rid);
    await source.control(rid, { action: "step" });
    await source.control(rid, { action: "step" });
    let last: SimEvent | null = null;
    const off = source.subscribe(rid, (e: SimEvent) => {
      if (e.type === "state") last = e;
    });
    const p = source.applyChange(rid, { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" }, note: "  Kriz önlemi " });
    await bekle(timer);
    await p;
    const versions = (last as unknown as { state: { versions?: { version: number; fromWeek: number; note?: string }[] } }).state.versions;
    expect(versions?.map((v) => [v.version, v.fromWeek, v.note])).toEqual([[1, 0, undefined], [2, 2, "Kriz önlemi"]]);
    off();
    source.dispose();
  });

  it("replay_scenario_id_match_unchanged", async () => {
    const { source } = kur();
    const h = await source.open(rid);
    await source.control(rid, { action: "step" });
    const r = await source.applyChange(rid, { from: "next_week", patch: { gecis_destegi: "kapali" } });
    // Aynı kayıt kümesi: koşu kimliği ve sürüm değişmez, olay yok.
    expect(r).toMatchObject({ accepted: true, runId: h!.runId, scenarioId: "kapali", mode: "exact", version: 1 });
    source.dispose();
  });
});
