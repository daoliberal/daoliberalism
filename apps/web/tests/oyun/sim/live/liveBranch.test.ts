import { afterEach, describe, expect, it } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { createLiveSource } from "@/oyun/sim/live";
import { WireError, parseState } from "@/oyun/sim/live/wire";
import type { RunConfig, SimEvent, SimSource } from "@/oyun/sim/types";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
const cfg: RunConfig = { name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 0, values: { gecis_destegi: "kapali" } };
let toDispose: SimSource[] = [];
afterEach(() => { toDispose.forEach((s) => s.dispose()); toDispose = []; });
function mk() {
  const server = createFakeLiveServer();
  const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765/", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  toDispose.push(source);
  return { server, source };
}

describe("LiveSource dallanma", () => {
  it("branch_posts_week_and_patch_and_returns_preparing_child", async () => {
    const { server, source } = mk();
    const parent = await source.start(cfg);
    const h = await source.branch!(parent.runId, 12, { gecis_destegi: "kurtarma_fonuyla" });
    const req = server.requests.at(-1)!;
    expect(req.method).toBe("POST");
    expect(req.path).toMatch(new RegExp(`/api/runs/${parent.runId}/branch$`));
    expect(req.body).toEqual({ week: 12, patch: { gecis_destegi: "kurtarma_fonuyla" } });
    expect(h.runId).not.toBe(parent.runId);
    expect(h.state).toMatchObject({ preparing: { done: 0, total: 12 }, parentRunId: parent.runId, forkWeek: 12 });
  });

  it("branch_without_patch_sends_only_week", async () => {
    const { server, source } = mk();
    const parent = await source.start(cfg);
    await source.branch!(parent.runId, 3);
    expect(server.requests.at(-1)!.body).toEqual({ week: 3 });
  });

  it.each([["too_many_runs"], ["busy_preparing"], ["invalid_branch"]] as const)("branch_%s_hatasi_ayri_kimlik_verir", async (code) => {
    const { server, source } = mk();
    const parent = await source.start(cfg);
    server.branchFailWith = code;
    const err = await source.branch!(parent.runId, 5).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimUnsupported);
    expect((err as SimUnsupported).message).toBe(code);
  });

  it("branch_unknown_run", async () => {
    const { source } = mk();
    const err = await source.branch!("yok", 5).catch((e: unknown) => e);
    expect((err as SimUnsupported).message).toBe("unknown_run");
  });

  it("preparing_progress_reaches_subscriber_then_clears", async () => {
    const { server, source } = mk();
    const parent = await source.start(cfg);
    const h = await source.branch!(parent.runId, 4);
    const events: SimEvent[] = [];
    source.subscribe(h.runId, (e) => events.push(e));
    await flush();
    server.fastForwardTo(h.runId, 2);
    await flush();
    const prep = () => events.flatMap((e) => (e.type === "state" ? [e.state.preparing] : []));
    expect(prep().at(-1)).toEqual({ done: 2, total: 4 });
    server.fastForwardTo(h.runId, 4);
    await flush();
    expect(prep().at(-1)).toBeUndefined();
    expect(events.filter((e) => e.type === "state").at(-1)).toMatchObject({ state: { week: 4 } });
  });

  it("discard_deletes_child_and_keeps_parent", async () => {
    const { server, source } = mk();
    const parent = await source.start(cfg);
    const h = await source.branch!(parent.runId, 4);
    await source.discard!(h.runId);
    expect(server.requests.at(-1)).toMatchObject({ method: "DELETE" });
    expect(server.requests.at(-1)!.path).toMatch(new RegExp(`/api/runs/${h.runId}$`));
    expect(await source.open(h.runId)).toBeNull();
    expect(await source.open(parent.runId)).not.toBeNull();
  });

  it("discard_unknown_is_silent", async () => {
    const { source } = mk();
    await expect(source.discard!("yok")).resolves.toBeUndefined();
  });

  it("wire_preparing_is_strict", () => {
    const base = { runId: "r", status: "paused", week: 0, durationWeeks: 10, speed: 1, computing: false, version: 1, seedIndex: 0, values: {}, scenarioId: "s", name: "x", cityNames: ["a"] };
    expect(parseState({ ...base, preparing: { done: 2, total: 5 } }).preparing).toEqual({ done: 2, total: 5 });
    for (const bad of [{ done: 6, total: 5 }, { done: -1, total: 5 }, { done: 1, total: -2 }, { done: 1.5, total: 5 }, { done: "1", total: 5 }, { done: 1 }]) {
      expect(() => parseState({ ...base, preparing: bad })).toThrow(WireError);
    }
  });
});
