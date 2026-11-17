import { describe, expect, it } from "vitest";
import { createReplaySource } from "@/oyun/sim/replay";
import type { Job, JobSpec, RunConfig, SimSource } from "@/oyun/sim/types";
import { allFiles, fakeTimer, makeFetch, runJson, type Files } from "../../helpers/replayFixture";

const config = (over: Partial<RunConfig> = {}): Omit<RunConfig, "schedule"> => ({
  name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 100, seedIndex: 2, values: { gecis_destegi: "kapali" }, ...over,
});
const seeds = (over: Partial<RunConfig> = {}, schedule: { week: number; patch: Record<string, string> }[] = []): JobSpec => ({ kind: "seeds", recipe: { config: config(over), schedule } });

/** Her başlangıç dünyasının kaydı farklı: kapalı kümede `1 - 0,1 × dünya`, kısa kümede `0,2 + 0,05 × dünya`. */
function files(): Files {
  const f = allFiles();
  for (let i = 0; i < 6; i++) {
    f[`/k/kapali/pm${i}.json`] = runJson("kapali", i, () => ({ served: Math.round((1 - 0.1 * i) * 100) / 100 }));
    f[`/k/kisa/pm${i}.json`] = runJson("kisa", i, () => ({ served: Math.round((0.2 + 0.05 * i) * 100) / 100 }));
  }
  return f;
}
function setup(): SimSource {
  return createReplaySource({ baseUrl: "/k", fetchImpl: makeFetch(files()), timer: fakeTimer() });
}
async function finished(src: SimSource, id: string): Promise<Job> {
  for (let i = 0; i < 200; i++) {
    const j = await src.job!(id);
    if (j.status !== "queued" && j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("iş bitmedi");
}

describe("ReplaySource işleri", () => {
  it("replay_six_from_recordings_preview_disabled", async () => {
    const src = setup();
    expect(src.capabilities).toMatchObject({ seeds: true, jobs: false, compare: false });
    expect((await src.info()).capabilities).toMatchObject({ seeds: true, jobs: false });
    const id = await src.startJob!(seeds());
    const job = await finished(src, id);
    expect(job).toMatchObject({ kind: "seeds", status: "done", progress: { done: 6, total: 6 } });
    expect(job.members.map((m) => [m.label, m.seedIndex, m.status, m.weeks])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [`seed-${i}`, i, "done", 100]));
    for (const m of job.members) {
      expect(m.series.served).toHaveLength(100);
      expect(m.series.served[0]).toBe(Math.round((1 - 0.1 * m.seedIndex) * 100) / 100);
    }
    // Önizleme ve A/B kayıt kaynağında kapalıdır: gerçek koşu yok.
    const base = { ...config(), schedule: [] };
    await expect(src.startJob!({ kind: "preview", base, draft: base })).rejects.toMatchObject({ message: "invalid_job" });
    await expect(src.startJob!({ kind: "ab", a: { config: config(), schedule: [] }, b: { config: config(), schedule: [] } })).rejects.toMatchObject({ message: "invalid_job" });
  });

  it("follows_the_version_schedule_with_recorded_sets", async () => {
    const src = setup();
    const id = await src.startJob!(seeds({}, [{ week: 40, patch: { gecis_destegi: "kisa_sureli" } }]));
    const job = await finished(src, id);
    const m = job.members[3]!;
    expect(m.series.served[0]).toBe(0.7); // kapalı, 4. dünya: 1 - 0,3
    expect(m.series.served[39]).toBe(0.7); // 40. hafta kapalı
    expect(m.series.served[40]).toBe(0.35); // 41. hafta kısa küme: 0,2 + 0,15
  });

  it("unrecorded_values_and_unknown_jobs_are_reported", async () => {
    const src = setup();
    await expect(src.startJob!(seeds({ values: { gecis_destegi: "yok" } }))).rejects.toMatchObject({ message: "invalid_job" });
    await expect(src.startJob!(seeds({ durationWeeks: 500 }))).rejects.toMatchObject({ message: "invalid_job" });
    await expect(src.job!("job-00000000")).rejects.toMatchObject({ message: "unknown_job" });
    await expect(src.cancelJob!("job-00000000")).rejects.toMatchObject({ message: "unknown_job" });
  });

  it("cancel_keeps_the_job_cancelled", async () => {
    const src = setup();
    const id = await src.startJob!(seeds());
    const c = await src.cancelJob!(id);
    expect(c.status).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 30));
    expect((await src.job!(id)).status).toBe("cancelled");
  });
});
