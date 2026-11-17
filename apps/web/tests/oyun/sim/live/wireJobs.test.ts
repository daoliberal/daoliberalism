import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { createLiveSource } from "@/oyun/sim/live";
import { WireError, parseJob, parseJobId } from "@/oyun/sim/live/wire";
import type { JobSpec, PreviewSpec } from "@/oyun/sim/types";

const FILE = path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/tests/fixtures/wire_contract.json");
const FIX = JSON.parse(readFileSync(FILE, "utf-8")) as Record<string, unknown>;

const cfg = { name: "A", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 52, seedIndex: 0, values: {} };
const spec: PreviewSpec = { kind: "preview", base: cfg, draft: { ...cfg, values: { a: 1 } }, weeks: 52 };

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const sourceWith = (calls: { method: string; url: string; body?: unknown }[], answer: (m: string, u: string) => Response) =>
  createLiveSource({
    baseUrl: "http://127.0.0.1:8765/",
    fetchImpl: (async (u: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return answer(init?.method ?? "GET", u);
    }) as typeof fetch,
  });

describe("arka plan işi (S3 sözleşmesi)", () => {
  it("parses_running_done_and_failed_member_fixtures", () => {
    const run = parseJob(FIX.job_running);
    expect([run.kind, run.status, run.progress, run.members.map((m) => m.label)]).toEqual(["preview", "running", { done: 6, total: 104 }, ["base", "draft"]]);
    expect(run.members[0]!.series.served).toHaveLength(3);
    expect(parseJob(FIX.job_done).status).toBe("done");
    const bad = parseJob(FIX.job_done_failed_member);
    expect(bad.members.find((m) => m.status === "failed")?.error).toBe("model_error");
  });

  it("yeni_seriler_varsa_okunur_yoksa_atlanir", () => {
    const base = FIX.job_done as unknown as { members: { series: Record<string, unknown> }[] };
    const sade = JSON.parse(JSON.stringify(FIX.job_done)) as { members: { series: Record<string, unknown> }[] };
    for (const m of sade.members) { delete m.series.failed_total_cum; delete m.series.unemployment_rate_all; }
    const eski = parseJob(sade);
    expect(eski.members[0]!.series.failed_total_cum).toBeUndefined();                                    // eski sunucu: alan yok
    const n = base.members[0]!.series.served as unknown[];
    const yeni = parseJob({ ...(FIX.job_done as object), members: [{ ...base.members[0]!, series: { ...base.members[0]!.series, failed_total_cum: n.map(() => 7), unemployment_rate_all: n.map(() => 0.6) } }] });
    expect(yeni.members[0]!.series.failed_total_cum).toEqual(n.map(() => 7));
    expect(yeni.members[0]!.series.unemployment_rate_all).toEqual(n.map(() => 0.6));
  });

  it("rejects_bad_job_shapes", () => {
    expect(() => parseJob({ ...(FIX.job_done as object), status: "bilinmeyen" })).toThrow(WireError);
    expect(() => parseJob({ ...(FIX.job_done as object), members: [{ label: "a" }] })).toThrow(WireError);
    expect(() => parseJobId({})).toThrow(WireError);
  });

  it("live_source_start_poll_cancel_use_the_jobs_routes", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const s = sourceWith(calls, (m) => (m === "POST" ? reply(201, { jobId: "job-0a1b2c3d" }) : reply(200, FIX.job_running)));
    expect(await s.startJob!(spec)).toBe("job-0a1b2c3d");
    expect((await s.job!("job-0a1b2c3d")).status).toBe("running");
    expect((await s.cancelJob!("job-0a1b2c3d")).jobId).toBe("job-0a1b2c3d");
    expect(calls.map((c) => `${c.method} ${c.url.replace("http://127.0.0.1:8765", "")}`)).toEqual(["POST /api/jobs", "GET /api/jobs/job-0a1b2c3d", "DELETE /api/jobs/job-0a1b2c3d"]);
    expect(calls[0]!.body).toEqual(spec);
  });

  it("start_errors_are_reported_by_code", async () => {
    const busy = sourceWith([], () => reply(409, FIX.error_job_running));
    await expect(busy.startJob!(spec)).rejects.toMatchObject({ message: "job_running" });
    const invalid = sourceWith([], () => reply(422, FIX.error_422_job));
    await expect(invalid.startJob!(spec)).rejects.toBeInstanceOf(SimUnsupported);
    await expect(invalid.startJob!(spec)).rejects.toMatchObject({ message: "invalid_job" });
    const missing = sourceWith([], () => reply(404, FIX.error_404_job));
    await expect(missing.job!("job-00000000")).rejects.toMatchObject({ message: "unknown_job" });
  });

  it("seeds_and_ab_specs_go_to_the_server_unchanged_and_runs_list_is_parsed", async () => {
    const recipe = { config: { name: "A", cityNames: ["a", "b", "c", "d", "e"], templateId: "dayanikli_taban", durationWeeks: 200, seedIndex: 1, values: { a: 1 } }, schedule: [{ week: 5, patch: { a: 2 } }] };
    const seeds: JobSpec = { kind: "seeds", recipe };
    const ab: JobSpec = { kind: "ab", a: recipe, b: { ...recipe, schedule: [] } };
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const s = sourceWith(calls, (m, u) => (m === "POST" ? reply(201, { jobId: "job-0a1b2c3d" }) : u.endsWith("/runs") ? reply(200, FIX.runs_list) : reply(200, FIX.job_done)));
    await s.startJob!(seeds);
    await s.startJob!(ab);
    expect(calls.map((c) => c.body)).toEqual([seeds, ab]);
    const runs = await s.listRuns!();
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]!.state.runId).toBe(runs[0]!.runId);
    const bad = sourceWith([], () => reply(200, { not: "list" }));
    await expect(bad.listRuns!()).rejects.toMatchObject({ message: "hata.sunucu_bozuk" });
  });
});
