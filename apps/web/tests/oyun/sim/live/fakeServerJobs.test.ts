import { describe, expect, it } from "vitest";
import { createLiveSource } from "@/oyun/sim/live";
import { jobResult } from "@/oyun/sim/result";
import type { JobSpec, RunConfig } from "@/oyun/sim/types";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";

const config: Omit<RunConfig, "schedule"> = { name: "A", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 1, values: {} };
const seeds: JobSpec = { kind: "seeds", recipe: { config, schedule: [] } };
const ab: JobSpec = { kind: "ab", a: { config, schedule: [] }, b: { config, schedule: [] } };

function setup() {
  const server = createFakeLiveServer();
  server.capabilities.jobs = true;
  const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
  return { server, source };
}

/** Sahte sunucunun iş uçları gerçek sunucunun S3 sözleşmesini taklit eder; ekran testleri buna dayanır. */
describe("sahte sunucu iş uçları", () => {
  it("seeds_job_runs_six_members_and_completes_by_status_with_a_failed_member", async () => {
    const { server, source } = setup();
    const id = await source.startJob!(seeds);
    const running = await source.job!(id);
    expect([running.kind, running.status, running.members.map((m) => m.label)]).toEqual(["seeds", "running", [0, 1, 2, 3, 4, 5].map((i) => `seed-${i}`)]);
    server.jobs.progress(id, 40);
    expect((await source.job!(id)).progress.done).toBe(40);
    server.jobs.complete(id, { failed: ["seed-3"], weeks: 30 });
    const done = await source.job!(id);
    expect(done.status).toBe("done");
    expect(done.progress.done).toBeLessThan(done.progress.total); // bitiş durumdan okunur, sayaçtan değil
    const r = jobResult(done);
    expect([r.lines.length, r.failed.map((f) => [f.label, f.error])]).toEqual([5, [["seed-3", "model_error"]]]);
    expect(server.jobs.all()[0]!.body).toEqual(seeds);
  });

  it("ab_job_uses_a_and_b_labels_busy_invalid_cancel_and_runs_list", async () => {
    const { server, source } = setup();
    const id = await source.startJob!(ab);
    expect((await source.job!(id)).members.map((m) => m.label)).toEqual(["a", "b"]);
    await expect(source.startJob!(seeds)).rejects.toMatchObject({ message: "job_running" });
    expect((await source.cancelJob!(id)).status).toBe("cancelled");
    server.jobs.startFailWith = "invalid_job";
    await expect(source.startJob!(seeds)).rejects.toMatchObject({ message: "invalid_job" });
    server.jobs.startFailWith = null;
    await expect(source.job!("job-ffffffff")).rejects.toMatchObject({ message: "unknown_job" });
    const h = await source.start({ ...config, schedule: [] });
    expect((await source.listRuns!()).map((x) => x.runId)).toEqual([h.runId]);
  });

  it("jobs_capability_off_means_no_such_route", async () => {
    const server = createFakeLiveServer();
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    await expect(source.startJob!(seeds)).rejects.toBeDefined();
  });
});
