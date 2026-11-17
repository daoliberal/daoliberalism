import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SimUnsupported } from "@/oyun/sim/SimSource";
import { createLiveSource } from "@/oyun/sim/live";
import { WireError, parseDrawer, parseInfo, parsePacket } from "@/oyun/sim/live/wire";
import { chainKenarlari } from "@/oyun/screens/canli/zincir/kenarlar";
import { createFakeLiveServer } from "../../helpers/fakeLiveServer";
import { KENARLAR, packet, worldInfo } from "../../helpers/sehirZincirVeri";

const WIRE = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../../../simulasyon/arayuz/server/tests/fixtures/wire_contract.json"), "utf-8")) as Record<string, Record<string, unknown> & { cities: Record<string, unknown>[] }>;

describe("W9a wire: şehir, zincir, çekmece", () => {
  it("parse_cities_chain_from_s5_fixture", () => {
    const p = parsePacket(WIRE.packet);
    expect(p.cities!.length).toBeGreaterThan(1);
    expect(p.cities![0]).toMatchObject({ index: 0, firms_npc: 20, tenants_per_house: expect.any(Number) });
    expect(p.chain!.board).toBe(true);
    expect(p.chain!.edges).toEqual([["un", "firin", "un"]]);
    expect(p.chain!.scarce![0]).toMatchObject({ sector: "ahir", product: "sut" });
    const info = parseInfo(WIRE.info);
    expect(info.world!.cities).toHaveLength(5);
    expect(info.world!.chain!.edges[0]).toEqual(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
  });

  it("parse_rejects_bad_city_row", () => {
    const bad = { ...WIRE.packet, cities: [{ ...WIRE.packet.cities[0], employed: "x" }] };
    expect(() => parsePacket(bad)).toThrow(WireError);
    expect(() => parsePacket({ ...WIRE.packet, chain: { ...(WIRE.packet.chain as object), edges: [["a", "b"]] } })).toThrow(WireError);
  });

  it("parse_drawer_fixture_fresh_and_stale_and_note_in_fields", () => {
    expect(parseDrawer(WIRE.drawer_fresh)).toMatchObject({ kind: "city", ref: "1", stale: false, title: "Şehir 2" });
    expect(parseDrawer(WIRE.drawer_stale).stale).toBe(true);
    const sektor = parseDrawer({ kind: "sector", ref: "ahir", week: 1, stale: false, title: "Ahır", fields: { note_key: "cekmece.ahir_notu", label: "Ahır" } });
    expect(sektor.note_key).toBe("cekmece.ahir_notu");
    expect(() => parseDrawer({ ...WIRE.drawer_fresh, week: "1" })).toThrow(WireError);
  });

  it("edges_rebuilt_from_packets_from_week_one", () => {
    const base = worldInfo().chain!.edges.map((e) => [e.from, e.to, e.product] as [string, string, string]);
    const w1 = packet(1);
    const w2 = packet(2, { chain: { ...packet(2).chain!, edges_rev: 1, edges: [...KENARLAR, ["firin", "tekstil", "ekmek"]] } });
    const w3 = packet(3, { chain: { ...packet(3).chain!, edges_rev: 1 } });
    expect(chainKenarlari([w1, w2, w3], 1, base)).toEqual(KENARLAR);
    expect(chainKenarlari([w1, w2, w3], 3, base)).toHaveLength(4);
    expect(chainKenarlari([], 0, base)).toEqual(KENARLAR);
  });

  it("live_source_drawer_requests_week_and_parses", async () => {
    const server = createFakeLiveServer();
    server.capabilities.city = true;
    const source = createLiveSource({ baseUrl: "http://127.0.0.1:8765", fetchImpl: server.fetch, eventSourceImpl: server.EventSource });
    const h = await source.start({ name: "Ada", cityNames: ["a", "b", "c", "d", "e"], templateId: "t", durationWeeks: 10, seedIndex: 0, values: {} });
    await source.control(h.runId, { action: "step" });
    const d = await source.drawer!(h.runId, "city", "1", 1);
    expect(d).toMatchObject({ kind: "city", ref: "1", stale: false });
    expect(server.requests.at(-1)!.path).toBe(`http://127.0.0.1:8765/api/runs/${h.runId}/drawer/city/1?week=1`);
    expect(server.requests.at(-1)!.method).toBe("GET");
    await expect(source.drawer!(h.runId, "city", "9", 1)).rejects.toBeInstanceOf(SimUnsupported);
    await expect(source.drawer!("yok", "city", "1", 1)).rejects.toBeInstanceOf(SimUnsupported);
    source.dispose();
  });
});
