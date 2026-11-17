import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/oyun/copy/t";
import { OyunApp, chooseSource } from "@/oyun/OyunApp";
import { encodeRunId } from "@/oyun/sim/replay/runId";
import type { ProbeResult } from "@/oyun/sim/live";
import { createFakeSource } from "./helpers/fakeSource";

const h = vi.hoisted(() => ({
  probe: vi.fn(),
  live: vi.fn(),
  replay: vi.fn(),
}));

vi.mock("@/oyun/sim/live", async (orig) => ({
  ...(await orig<typeof import("@/oyun/sim/live")>()),
  probeLive: (...a: unknown[]) => h.probe(...a) as Promise<ProbeResult>,
  createLiveSource: (...a: unknown[]) => h.live(...a) as unknown,
}));
vi.mock("@/oyun/sim/replay", async (orig) => ({
  ...(await orig<typeof import("@/oyun/sim/replay")>()),
  createReplaySource: (...a: unknown[]) => h.replay(...a) as unknown,
}));

const OK: ProbeResult = { ok: true, hello: { serverVersion: "1", modelVersion: "1", defaultsHash: "x", secPerWeekP50: null } };
const NO: ProbeResult = { ok: false };
const REPLAY_ID = encodeRunId({ setId: "kapali", seedIndex: 0, changes: [], name: "E", cityNames: ["a", "b", "c", "d", "e"] });
const LOC = { hostname: "localhost", port: "8765", origin: "http://localhost:8765", search: "", hash: "" };
const DEV = { ...LOC, port: "3000", origin: "http://localhost:3000" };
const STATIC = { ...LOC, port: "3201", origin: "http://localhost:3201" };

beforeEach(() => {
  h.probe.mockReset();
  h.live.mockReset().mockImplementation(() => createFakeSource([], { kind: "live" }));
  h.replay.mockReset().mockImplementation(() => createFakeSource([], { kind: "replay" }));
  window.history.replaceState(null, "", "/oyun");
  window.location.hash = "#/kurucu"; // DK-14: giriş adresi
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("chooseSource", () => {
  it("test_probe_ok_selects_live", async () => {
    h.probe.mockResolvedValue(OK);
    const r = await chooseSource(LOC);
    expect(r.source?.kind).toBe("live");
    expect(h.live).toHaveBeenCalledTimes(1);
    expect(h.replay).not.toHaveBeenCalled();
  });

  it("test_port_8765_probes_same_origin_only", async () => {
    h.probe.mockResolvedValue(NO);
    await chooseSource(LOC);
    expect(h.probe.mock.calls.map((c) => c[0])).toEqual([""]);
  });

  it("test_dev_port_probes_8765_only", async () => {
    h.probe.mockResolvedValue(OK);
    await chooseSource(DEV);
    expect(h.probe.mock.calls.map((c) => c[0])).toEqual(["http://127.0.0.1:8765"]);
    expect(h.live).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://127.0.0.1:8765" }));
  });

  it("test_forced_canli_on_custom_port_probes_same_origin_and_ignores_canli_port", async () => {
    h.probe.mockResolvedValue(OK);
    const loc = { ...STATIC, hostname: "127.0.0.1", port: "9000", origin: "http://127.0.0.1:9000", search: "?kaynak=canli" };
    const r = await chooseSource(loc);
    expect(h.probe.mock.calls.map((c) => c[0])).toEqual([""]);
    expect(r.source?.kind).toBe("live");
    expect(h.live).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "" }));
    h.probe.mockClear();
    await chooseSource({ ...loc, search: "?kaynak=canli&canli_port=43112" });     // kanca kaldırıldı: parametre yok sayılır
    expect(h.probe.mock.calls.map((c) => c[0])).toEqual([""]);
  });

  it("test_canli_port_param_has_no_effect_without_forced_source", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await chooseSource({ ...STATIC, search: "?canli_port=43112" });
    expect(r.source?.kind).toBe("replay");
    expect(h.probe).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("test_canli_port_param_never_on_remote_host", async () => {
    await chooseSource({ hostname: "ornek.com", port: "", origin: "https://ornek.com", search: "?kaynak=canli&canli_port=43112", hash: "" });
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("test_other_port_zero_requests_replay", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await chooseSource(STATIC);
    expect(r.source?.kind).toBe("replay");
    expect(h.probe).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("test_forced_canli_on_static_site_port_same_origin_missing_without_8765_request", async () => {
    h.probe.mockResolvedValue(NO);
    const r = await chooseSource({ ...STATIC, search: "?kaynak=canli" });
    expect(h.probe.mock.calls.map((c) => c[0])).toEqual([""]);
    expect(r).toEqual({ source: null, missing: true });
  });

  it("test_forced_canli_on_dev_port_probes_8765", async () => {
    h.probe.mockResolvedValue(OK);
    const r = await chooseSource({ ...DEV, search: "?kaynak=canli" });
    expect(h.probe.mock.calls.map((c) => c[0])).toEqual(["http://127.0.0.1:8765"]);
    expect(r.source?.kind).toBe("live");
  });

  it("forced_canli_on_8765_same_origin", async () => {
    h.probe.mockResolvedValue(OK);
    await chooseSource({ ...LOC, search: "?kaynak=canli" });
    expect(h.probe.mock.calls.map((c) => c[0])).toEqual([""]);
  });

  it("jsdom_bos_port_yoklamaz", async () => {
    await chooseSource({ ...LOC, port: "", origin: "http://localhost" });
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("test_remote_host_never_probes", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await chooseSource({ hostname: "ornek.com", port: "", origin: "https://ornek.com", search: "", hash: "" });
    expect(r.source?.kind).toBe("replay");
    expect(h.probe).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("remote_host_zorlanmis_canli_hata_verir_ve_yoklamaz", async () => {
    const r = await chooseSource({ hostname: "ornek.com", port: "", origin: "https://ornek.com", search: "?kaynak=canli", hash: "" });
    expect(r).toEqual({ source: null, missing: true });
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("kaynak_kayit_yoklamaz", async () => {
    const r = await chooseSource({ ...LOC, search: "?kaynak=kayit" });
    expect(r.source?.kind).toBe("replay");
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("test_replay_runid_with_live_server_uses_replay", async () => {
    h.probe.mockResolvedValue(OK);
    const r = await chooseSource({ ...LOC, hash: `#/canli/${REPLAY_ID}` });
    expect(r.source?.kind).toBe("replay");
    expect(h.live).not.toHaveBeenCalled();
  });

  it("canli_onekli_runid_live_kullanir", async () => {
    h.probe.mockResolvedValue(OK);
    const r = await chooseSource({ ...LOC, hash: "#/canli/canli-abc123" });
    expect(r.source?.kind).toBe("live");
  });

  it("canli_onekli_runid_sunucu_yokken_replay_kalir_hata_degil", async () => {
    h.probe.mockResolvedValue(NO);
    const r = await chooseSource({ ...LOC, hash: "#/canli/canli-abc123" });
    expect(r.source?.kind).toBe("replay");
  });

  it("test_probe_fail_selects_replay_within_timeout", async () => {
    vi.useFakeTimers();
    // Gerçek probeLive: asılı sunucu (fetch hiç dönmez) 700 ms sonra reddedilir.
    const real = await vi.importActual<typeof import("@/oyun/sim/live")>("@/oyun/sim/live");
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    h.probe.mockImplementation((base: string) => real.probeLive(base));
    let done = false;
    const p = chooseSource(DEV).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(699);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(r.source?.kind).toBe("replay");
    expect(h.live).not.toHaveBeenCalled();
  });

  it("hizli_basarisizlik_gecikme_eklemez", async () => {
    vi.useFakeTimers();
    h.probe.mockResolvedValue(NO);
    const r = await chooseSource(DEV);
    expect(r.source?.kind).toBe("replay");
  });
});

describe("OyunApp: kaynak seçimi", () => {
  it("test_forced_canli_without_server_shows_error_and_replay_link", async () => {
    window.history.replaceState(null, "", "/oyun?kaynak=canli");
    h.probe.mockResolvedValue(NO);
    render(<OyunApp />);
    expect(await screen.findByText(t("canli.sunucu_yok"))).toBeVisible();
    const link = screen.getByRole("link", { name: t("kaynak.kayitla_ac") });
    expect(link.getAttribute("href")).toContain("kaynak=kayit");
    expect(link.getAttribute("href")).not.toContain("canli");
    expect(h.replay).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: t("kurucu.baslik") })).toBeNull();
    expect(screen.getByText(t("kaynak.canli_degil_bilgi"))).toBeVisible();
  });

  it("canli_secilince_kurucu_canli_notunu_gosterir", async () => {
    window.history.replaceState(null, "", "/oyun?kaynak=canli#/kurucu");
    h.probe.mockResolvedValue(OK);
    render(<OyunApp />);
    expect(await screen.findByText(t("kurucu.kayit_notu.live"))).toBeVisible();
  });

  it("unmount_secilen_kaynagi_dispose_eder_ve_gec_gelen_yoklama_kaynak_kurmaz", async () => {
    let resolve!: (r: ProbeResult) => void;
    h.probe.mockImplementation(() => new Promise<ProbeResult>((r) => (resolve = r)));
    const { unmount } = render(<OyunApp />);
    unmount();
    await act(async () => resolve(OK));
    expect(h.live).not.toHaveBeenCalled();
    expect(h.replay).not.toHaveBeenCalled();
  });

  it("yoklama_sirasinda_yukleniyor_gorunur", async () => {
    h.probe.mockImplementation(() => new Promise<ProbeResult>(() => {}));
    render(<OyunApp />);
    expect(screen.getByText(t("durum.yukleniyor"))).toBeVisible();
    await waitFor(() => expect(h.probe).toHaveBeenCalled());
  });
});
