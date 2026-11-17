import { describe, expect, it } from "vitest";
import { contractRegistryRaw } from "../../helpers/registryFixtures";
import { WireError, parseChange, parseRegistry, parseEvent, parsePacket, parseServerError, parseState } from "@/oyun/sim/live/wire";
import { packetOf } from "../../helpers/fakeLiveServer";

const state = {
  runId: "r", status: "ready", week: 0, durationWeeks: 200, speed: 1, computing: false, version: 1, seedIndex: 0, values: { a: "x", b: 2, c: true },
  scenarioId: "s", name: "Ada", cityNames: ["a", "b", "c", "d", "e"],
};

describe("wire", () => {
  it("test_wire_accepts_valid_state_and_packet", () => {
    expect(parseState(state)).toEqual(state);
    const p = packetOf("r", 3, 1);
    expect(parsePacket(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("test_wire_rejects_nan_and_non_finite", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const p = packetOf("r", 1, 1);
      expect(() => parsePacket({ ...p, world: { ...p.world, served: bad } })).toThrow(WireError);
      expect(() => parseState({ ...state, week: bad })).toThrow(WireError);
      expect(() => parseState({ ...state, values: { a: bad } })).toThrow(WireError);
    }
    // null geçerli; eksik alan (undefined) geçersiz
    const p = packetOf("r", 1, 1);
    expect(parsePacket({ ...p, world: { ...p.world, served: null } }).world.served).toBeNull();
    const rest: Record<string, unknown> = { ...p.world };
    delete rest.served;
    expect(() => parsePacket({ ...p, world: rest })).toThrow(WireError);
  });

  it("world_s5_fields_cities_and_chain_are_parsed_and_bad_types_are_wire_errors", () => {
    const p = packetOf("r", 1, 1);
    const w = { ...p.world, tenants_per_house: 1.2, house_resale_ratio: 0.9, policy_inflation: 0.02, minted_total: 100 };
    const got = parsePacket({ ...p, world: w }).world;
    expect([got.tenants_per_house, got.house_resale_ratio, got.policy_inflation, got.minted_total]).toEqual([1.2, 0.9, 0.02, 100]);
    for (const k of ["tenants_per_house", "house_resale_ratio", "policy_inflation", "minted_total"]) {
      expect(() => parsePacket({ ...p, world: { ...w, [k]: "x" } }), k).toThrow(WireError);
    }
    const city = { index: 0, served: 0.9, employed: 10, unemployed: 2, cash: 5, firms_npc: 3, firms_player: 1, rent_pct: null, occupancy: null, tenants_per_house: null, migration_in: 0, migration_out: 1 };
    expect(parsePacket({ ...p, cities: [city] }).cities?.[0]?.served).toBe(0.9);
    expect(() => parsePacket({ ...p, cities: [{ ...city, employed: "x" }] })).toThrow(WireError);
    const chain = { board: true, edges_rev: 1, edges: [["a", "b", "un"]], sectors: [], nodes: [], scarce: null };
    expect(parsePacket({ ...p, chain }).chain?.edges).toEqual([["a", "b", "un"]]);
    expect(() => parsePacket({ ...p, chain: { ...chain, edges: [["a", "b"]] } })).toThrow(WireError);
    expect(() => parsePacket({ ...p, chain: { ...chain, board: "x" } })).toThrow(WireError);
  });

  it("world_s4_fields_are_parsed_and_bad_types_are_wire_errors", () => {
    const p = packetOf("r", 1, 1);
    const w = { ...p.world, support_denied: 12.5, policy_unemployment: 0.3, city_spend_cut: 0, policy_rate: 0.003 };
    const got = parsePacket({ ...p, world: w }).world;
    expect([got.support_denied, got.policy_unemployment, got.city_spend_cut, got.policy_rate]).toEqual([12.5, 0.3, 0, 0.003]);
    for (const k of ["support_denied", "policy_unemployment", "city_spend_cut"]) {
      expect(() => parsePacket({ ...p, world: { ...w, [k]: "x" } }), k).toThrow(WireError);
      const rest: Record<string, unknown> = { ...w };
      delete rest[k];
      expect(() => parsePacket({ ...p, world: rest }), k).toThrow(WireError);
    }
  });

  it("registry_template_extra_fields_parsed_and_bad_types_rejected", () => {
    const raw = contractRegistryRaw() as { templates: Record<string, unknown>[] };
    const put = (extra: Record<string, unknown>) => ({ ...raw, templates: raw.templates.map((x, i) => (i === 0 ? { ...x, ...extra } : x)) });
    const t0 = parseRegistry(put({ startable: false, blocked_by: ["a"], behavior_changes: ["b"], world_values: { c: 1 } })).templates[0]!;
    expect([t0.startable, t0.blocked_by, t0.behavior_changes, t0.world_values]).toEqual([false, ["a"], ["b"], { c: 1 }]);
    const bare = { ...raw, templates: raw.templates.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !["startable", "blocked_by", "behavior_changes", "world_values"].includes(k)))) };
    expect(parseRegistry(bare as never).templates[0]!.startable).toBeUndefined();
    expect(() => parseRegistry(put({ startable: "evet" }))).toThrow(WireError);
    expect(() => parseRegistry(put({ blocked_by: [1] }))).toThrow(WireError);
  });

  it("rejects_bad_shapes", () => {
    expect(() => parseState(null)).toThrow(WireError);
    expect(() => parseState({ ...state, status: "kosuyor" })).toThrow(WireError);
    expect(() => parseState({ ...state, speed: 2 })).toThrow(WireError);
    // Bozuk tür (dize değil) genel hataya çevrilmez: WireError.
    expect(() => parseState({ ...state, error: { messageKey: 5, week: 1 } })).toThrow(WireError);
    expect(() => parseState({ ...state, error: { messageKey: null, week: 1 } })).toThrow(WireError);
    expect(() => parseState({ ...state, error: { week: 1 } })).toThrow(WireError);
    // M3: bilinmeyen hata anahtarı durumu düşürmez, genel model hatasına döner.
    expect(parseState({ ...state, error: { messageKey: "yok.boyle.anahtar", week: 1 } }).error).toEqual({ messageKey: "hata.model_coktu", week: 1 });
    expect(() => parsePacket({ ...packetOf("r", 1, 1), v: 2 })).toThrow(WireError);
  });

  it("state_optional_fields", () => {
    const s = parseState({ ...state, buffering: true, modelWeeksPerSec: 2.5, endedReason: "duration", error: { messageKey: "hata.model_coktu", week: 4 } });
    expect(s).toMatchObject({ buffering: true, modelWeeksPerSec: 2.5, endedReason: "duration", error: { messageKey: "hata.model_coktu", week: 4 } });
    expect(parseState({ ...state, modelWeeksPerSec: null }).modelWeeksPerSec).toBeUndefined();
  });

  it("version_event_full_fields_p01", () => {
    const ev = {
      id: "version:2:5:gecis_destegi", week: 5, kind: "neutral", textKey: "event.version", params: { hafta: 5, mod: "live", surum: 2 },
      critical: false, sector: null, rule_ids: ["gecis_destegi"],
    };
    expect(parseEvent(ev)).toEqual(ev);
    const noSector: Record<string, unknown> = { ...ev };
    delete noSector.sector;
    expect(() => parseEvent(noSector)).toThrow(WireError);
    const noWeek: Record<string, unknown> = { ...ev };
    delete noWeek.week;
    expect(() => parseEvent(noWeek)).toThrow(WireError);
  });

  it("change_modes_and_error_body", () => {
    expect(parseChange({ accepted: true, runId: "r", mode: "live", scenarioId: "s", seamWeek: 3, version: 2 })).toMatchObject({ accepted: true, mode: "live" });
    expect(() => parseChange({ accepted: true, runId: "r", mode: "x", scenarioId: "s", seamWeek: 3, version: 2 })).toThrow(WireError);
    expect(parseChange({ error: { code: "invalid", message: "m", fields: [{ id: "a", reason: "locked" }, { id: "b", reason: "tuhaf" }] } })).toEqual({
      accepted: false, fields: [{ id: "a", reason: "locked" }, { id: "b", reason: "invalid" }],
    });
  });

  it("server_error_key", () => {
    expect(parseServerError({ messageKey: "hata.sunucu_bozuk" })).toBe("hata.sunucu_bozuk");
    expect(parseServerError({ message_key: "event.version" })).toBe("hata.model_coktu");
    expect(parseServerError(null)).toBe("hata.model_coktu");
  });
});
