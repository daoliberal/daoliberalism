import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplaySource } from "@/oyun/sim/replay";
import { allFiles, fakeTimer, makeFetch } from "../../helpers/replayFixture";

const PUBLISHED = readFileSync(path.resolve(import.meta.dirname, "../../../../public/oyun-kayit/registry.json"), "utf-8");

describe("ReplaySource kayıt", () => {
  it("replay_registry_cards_locked_no_recording", async () => {
    const src = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch({ ...allFiles(), "/k/registry.json": PUBLISHED }), timer: fakeTimer() });
    const info = await src.info();
    expect(info.registry?.cards.map((c) => c.id)).toContain("ucret_stopaji");
    expect(Object.entries(info.capabilities ?? {}).filter(([, v]) => v).map(([k]) => k)).toEqual(["seeds"]); // W10: kayıtta yalnız altı dünyada koşu açık
    const by = Object.fromEntries(info.settings.map((s) => [s.id, s]));
    for (const id of ["ucret_stopaji", "kurumlar_vergisi", "zararda_once_kucul"]) expect(by[id]).toMatchObject({ changeable: false, reason: "no_recording" });
    expect(by.gecis_destegi?.changeable).toBeUndefined();
    expect(by.dunya_tohumu).toBeUndefined();
  });

  it("registry_missing_is_tolerated", async () => {
    const src = createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(allFiles()), timer: fakeTimer() });
    const info = await src.info();
    expect(info.registry).toBeUndefined();
    expect(info.settings).toHaveLength(1);
  });

  it("network_error_is_retried_but_permanent_failure_cached", async () => {
    const files = { ...allFiles(), "/k/registry.json": PUBLISHED };
    const inner = makeFetch(files);
    let fail = true;
    const flaky = (async (u: string) => {
      if (u.endsWith("registry.json") && fail) throw new TypeError("ağ yok");
      return inner(u);
    }) as unknown as typeof fetch;
    const src = createReplaySource({ baseUrl: "/k", fetchImpl: flaky, timer: fakeTimer() });
    expect((await src.info()).registry).toBeUndefined();
    fail = false;
    expect((await src.info()).registry).toBeDefined();
    // kalıcı hata (404) önbelleğe alınır: dosya sonradan gelse de yeniden istenmez
    const missing = makeFetch(allFiles());
    const src2 = createReplaySource({ baseUrl: "/k", fetchImpl: missing, timer: fakeTimer() });
    await src2.info();
    await src2.info();
    expect(missing.calls.filter((u) => u.endsWith("registry.json"))).toHaveLength(1);
  });
});
