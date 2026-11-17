import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createLiveSource } from "@/oyun/sim/live";
import { SimSourceProvider } from "@/oyun/sim/SimSourceContext";
import { useSourceInfo } from "@/oyun/sim/useSourceInfo";
import type { SimSource } from "@/oyun/sim/types";
import { createFakeLiveServer } from "../helpers/fakeLiveServer";

function hookFor(source: SimSource) {
  const wrapper = ({ children }: { children: ReactNode }) => <SimSourceProvider source={source}>{children}</SimSourceProvider>;
  return renderHook(() => useSourceInfo(), { wrapper });
}

describe("useSourceInfo", () => {
  it("live_capabilities_from_info", async () => {
    const server = createFakeLiveServer();
    server.capabilities.city = true;
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    const { result } = hookFor(source);
    expect(result.current.loading).toBe(true);
    expect(result.current.capabilities.city).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.capabilities.city).toBe(true);
    expect(result.current.capabilities.branch).toBe(false);
    source.dispose();
  });

  it("live_capabilities_missing_field_all_false", async () => {
    const server = createFakeLiveServer();
    const f = server.fetch;
    const source = createLiveSource({
      baseUrl: "http://127.0.0.1:8765",
      eventSourceImpl: server.EventSource,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await f(input, init);
        if (!String(input).endsWith("/api/info")) return res;
        const body = (await res.json()) as Record<string, unknown>;
        delete body.capabilities;
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch,
    });
    const { result } = hookFor(source);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(Object.values(result.current.capabilities).every((v) => v === false)).toBe(true);
    source.dispose();
  });

  it("single_info_call_per_source_strict_mode_safe", async () => {
    const server = createFakeLiveServer();
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <SimSourceProvider source={source}>{children}</SimSourceProvider>
      </StrictMode>
    );
    const a = renderHook(() => useSourceInfo(), { wrapper });
    const b = renderHook(() => useSourceInfo(), { wrapper });
    await waitFor(() => expect(a.result.current.loading || b.result.current.loading).toBe(false));
    expect(server.requests.filter((r) => r.path.endsWith("/api/info"))).toHaveLength(1);
    source.dispose();
  });
});
