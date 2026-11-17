import { describe, expect, expectTypeOf, it } from "vitest";
import { createLiveSource } from "@/oyun/sim/live";
import { createReplaySource } from "@/oyun/sim/replay";
import { isScalar, sameValue } from "@/oyun/sim/values";
import type { CopyKey } from "@/oyun/copy/t";
import type {
  Capabilities, ChangeResult, Diagnostic, GoalId, Registry, RegistryCard, RunConfig, RunState, SimSource, SourceInfo, UIValue, ValuesPatch, WeekPacket, WorldEvent,
} from "@/oyun/sim/types";
import { tr } from "@/oyun/copy/tr";
import { createFakeLiveServer } from "../helpers/fakeLiveServer";
import { createContractFake } from "../helpers/fakeSource";
import { allFiles, fakeTimer, makeFetch } from "../helpers/replayFixture";

const cfg: RunConfig = {
  name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" },
};

// Mevcut `contractSuite` her kaynakta (contract.test.ts / contract.replay / contract.fake / live/contract.live) olduğu gibi koşar; v2 eklemeleri onu değiştirmez.

describe("sözleşme v2", () => {
  it("scenario_id_semantics_unchanged", async () => {
    // Replay: exact yol, scenarioId kayıt kümesi kimliği.
    const timer = fakeTimer();
    const rep = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(allFiles()), timer });
    const h = await rep.start(cfg);
    expect(h.state.scenarioId).toBe("kapali");
    expect(h.state.worldScenarioId).toBeUndefined();
    await rep.control(h.runId, { action: "pause" });
    const p = rep.applyChange(h.runId, { from: "next_week", patch: { gecis_destegi: "kurtarma_fonuyla" } });
    for (let i = 0; i < 20; i++) { timer.advance(1000); await new Promise((r) => setTimeout(r, 0)); }
    const r = await p;
    expect(r).toMatchObject({ accepted: true, mode: "exact", scenarioId: "kurtarma" });
    rep.dispose();

    // Canlı sahte sunucu: kullanılabilirlik kimliği "canli"; koşunun scenarioId'si şablon kimliği; worldScenarioId ayrı alan.
    const server = createFakeLiveServer();
    const live = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    expect((await live.availability({ gecis_destegi: "kapali" })).scenarioId).toBe("canli");
    const lh = await live.start({ ...cfg, worldScenarioId: "ozel", worldScenarioValues: { x: 1 } });
    expect(lh.state.scenarioId).toBe(cfg.templateId);
    expect(lh.state.worldScenarioId).toBe("ozel");                     // gerçek sunucu durumda dünya senaryosunu ve özel değerleri yankılar (W10)
    expect(lh.state.worldScenarioValues).toEqual({ x: 1 });
    const sent = server.requests.find((q) => q.method === "POST" && q.path.endsWith("/runs"))?.body as { config: RunConfig };
    expect(sent.config.worldScenarioId).toBe("ozel");
    live.dispose();
  });

  it("ui_value_object_and_array_in_patch", () => {
    const patch: ValuesPatch = { a: "x", b: 1, c: true, d: ["p", "q"], e: { vade: 52, acik: true, ad: "t" } };
    expect(Object.keys(patch)).toHaveLength(5);
    expectTypeOf<string[]>().toMatchTypeOf<UIValue>();
    expectTypeOf<Record<string, number | string | boolean>>().toMatchTypeOf<UIValue>();
    expectTypeOf<ValuesPatch[string]>().toEqualTypeOf<UIValue>();
    // @ts-expect-error iç içe nesne değer değildir
    const bad: UIValue = { a: { b: 1 } };
    void bad;
  });

  it("v2_optional_type_additions", () => {
    expectTypeOf<RunConfig["worldScenarioId"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RunConfig["worldScenarioValues"]>().toEqualTypeOf<ValuesPatch | undefined>();
    expectTypeOf<RunConfig["goals"]>().toEqualTypeOf<GoalId[] | undefined>();
    expectTypeOf<RunConfig["schedule"]>().toEqualTypeOf<{ week: number; patch: ValuesPatch }[] | undefined>();
    expectTypeOf<RunConfig["fastForwardTo"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<GoalId>().toEqualTypeOf<"alive" | "serve" | "kasa" | "gini">();
    expectTypeOf<RunState["preparing"]>().toEqualTypeOf<{ done: number; total: number } | undefined>();
    expectTypeOf<RunState["parentRunId"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RunState["forkWeek"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RunState["scenarioId"]>().toEqualTypeOf<string>();
    expectTypeOf<WorldEvent["changes"]>().toEqualTypeOf<{ id: string; from: UIValue | null; to: UIValue }[] | undefined>();
    expectTypeOf<WorldEvent["chain"]>().toEqualTypeOf<{ step: string; textKey: CopyKey; params: Record<string, string | number> }[] | undefined>();
    expectTypeOf<WeekPacket["diagnostics"]>().toEqualTypeOf<Diagnostic[] | undefined>();
    expectTypeOf<SourceInfo["registry"]>().toEqualTypeOf<Registry | undefined>();
    expectTypeOf<SourceInfo["durations"]>().toEqualTypeOf<number[] | undefined>();
    expectTypeOf<SourceInfo["capabilities"]>().toEqualTypeOf<Capabilities | undefined>();
    expectTypeOf<RegistryCard["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Extract<ChangeResult, { accepted: false }>["fields"][number]["reason"]>().toEqualTypeOf<
      "no_recording" | "locked" | "busy" | "ended" | "invalid" | "start_only" | "passive"
    >();
    expectTypeOf<NonNullable<SimSource["branch"]>>().toBeFunction();
    expectTypeOf<NonNullable<SimSource["registry"]>>().returns.resolves.toEqualTypeOf<Registry>();
    // Eski kaynaklar yeni yöntemleri tanımlamadan SimSource'u karşılar
    const src = createContractFake({ weeks: 2 }) satisfies SimSource;
    expect(src.branch).toBeUndefined();
  });

  it("values_helpers", () => {
    expect(isScalar(1) && isScalar("a") && isScalar(false)).toBe(true);
    expect(isScalar(["a"])).toBe(false);
    expect(isScalar({ a: 1 })).toBe(false);
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue(1, "1")).toBe(false);
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameValue({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1 }, ["a"])).toBe(false);
    expect(sameValue(["a"], "a")).toBe(false);
  });

  it("neolmuyor_keys_exist", () => {
    expect(tr["neolmuyor.faiz_dusmuyor"]).toMatch(/^Faiz düşmüyor: /);
    expect(tr["neolmuyor.destek_yok"]).toMatch(/^Kimse destek alamıyor: /);
    expect(tr["neolmuyor.kurulus_kredisi_yok"]).toMatch(/^Kuruluş kredisi verilemiyor: /);
    expect(tr["neolmuyor.basim_siniri"]).toMatch(/^Şehir kasası yetmedi: /);
    for (const k of Object.keys(tr).filter((x) => x.startsWith("neolmuyor."))) expect(tr[k as keyof typeof tr]).not.toMatch(/\d'|\{[a-z_]+\}'/);
  });
});
