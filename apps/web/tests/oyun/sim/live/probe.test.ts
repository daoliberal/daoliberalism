import { afterEach, describe, expect, it, vi } from "vitest";
import { probeLive } from "@/oyun/sim/live";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";

afterEach(() => vi.useRealTimers());

describe("probeLive", () => {
  it("test_probe_ok", async () => {
    const server = createFakeLiveServer();
    const r = await probeLive("http://127.0.0.1:8765", { fetchImpl: server.fetch });
    expect(r).toMatchObject({ ok: true, hello: { modelVersion: "v13.0", secPerWeekP50: 0.4 } });
    expect(server.requests[0]).toMatchObject({ method: "GET", path: "http://127.0.0.1:8765/api/hello", headers: { "x-oyun-istek": "1" } });
  });

  it("test_probe_timeout_false", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hang = ((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; rej(new DOMException("abort", "AbortError")); });
    })) as typeof fetch;
    const p = probeLive("", { fetchImpl: hang });
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(699);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: false });
    expect(aborted).toBe(true);
  });

  it("test_probe_custom_timeout", async () => {
    vi.useFakeTimers();
    const p = probeLive("", { fetchImpl: (() => new Promise<Response>(() => undefined)) as typeof fetch, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await p).toEqual({ ok: false });
  });

  it("test_probe_offline_false", async () => {
    const server = createFakeLiveServer();
    server.failWith = "network";
    expect(await probeLive("", { fetchImpl: server.fetch })).toEqual({ ok: false });
    server.failWith = 500;
    expect(await probeLive("", { fetchImpl: server.fetch })).toEqual({ ok: false });
  });

  it("test_probe_not_a_live_server_false", async () => {
    const html = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    expect(await probeLive("", { fetchImpl: html })).toEqual({ ok: false });
    const notLive = (async () => new Response(JSON.stringify({ ok: true, server_version: "1", model_version: "m", defaults_hash: "h", live: false }))) as unknown as typeof fetch;
    expect(await probeLive("", { fetchImpl: notLive })).toEqual({ ok: false });
  });
});
