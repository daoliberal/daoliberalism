import { describe, expect, it } from "vitest";
import { WireError, parsePacket } from "@/oyun/sim/live/wire";
import { toPackets } from "@/oyun/sim/replay/loader";
import { packetOf } from "../../helpers/fakeLiveServer";

const YENI = [
  "npc_pool", "npc_employed", "npc_broke", "npc_pool_cash_avg", "players_seeking", "players_in_ahir", "players_students", "unemployment_rate_all",
  "benefit_paid", "benefit_paid_npc", "muni_wages", "bursary_paid", "benefit_cut",
] as const;
const SEHIR = { index: 0, served: 0.9, employed: 10, unemployed: 2, cash: 5, firms_npc: 3, firms_player: 1, rent_pct: null, occupancy: null, tenants_per_house: null, migration_in: 0, migration_out: 1 };

describe("D5 işsizlik ve NPC havuzu: tel ve kayıt", () => {
  it("yeni_dunya_alanlari_ayristirilir_bozuk_tur_wire_hatasi", () => {
    const p = packetOf("r", 1, 1);
    const w = Object.fromEntries(YENI.map((k, i) => [k, i + 1]));
    const got = parsePacket({ ...p, world: { ...p.world, ...w } }).world;
    for (const [i, k] of YENI.entries()) expect(got[k], k).toBe(i + 1);
    for (const k of YENI) expect(() => parsePacket({ ...p, world: { ...p.world, ...w, [k]: "x" } }), k).toThrow(WireError);
    expect(() => parsePacket({ ...p, world: { ...p.world, npc_pool: Number.NaN } })).toThrow(WireError);
  });

  it("eski_sunucuda_alan_yok_ise_null_hoşgörü", () => {
    const p = packetOf("r", 1, 1);
    const got = parsePacket(JSON.parse(JSON.stringify(p))).world;
    for (const k of YENI) expect(got[k] ?? null, k).toBeNull();
    const nullu = parsePacket({ ...p, world: { ...p.world, npc_pool: null } }).world;
    expect(nullu.npc_pool).toBeNull();
  });

  it("sehir_satirinda_yeni_alanlar_istege_bagli", () => {
    const p = packetOf("r", 1, 1);
    const yeni = parsePacket({ ...p, cities: [{ ...SEHIR, npc_pool: 30, npc_broke: 4, players_seeking: 2 }] }).cities![0]!;
    expect([yeni.npc_pool, yeni.npc_broke, yeni.players_seeking]).toEqual([30, 4, 2]);
    const eski = parsePacket({ ...p, cities: [SEHIR] }).cities![0]!;
    expect(eski).not.toHaveProperty("npc_pool");
    expect(() => parsePacket({ ...p, cities: [{ ...SEHIR, npc_pool: "x" }] })).toThrow(WireError);
  });

  it("kayit_sutunlari_pakete_acilir_sutun_yoksa_null", () => {
    const cols = { served: [1, 1], npc_pool: [10, 12], npc_broke: [0, 3], unemployment_rate_all: [0.1, 0.2] };
    const [a, b] = toPackets({ set: "kapali", pm_index: 0, weeks: 2, cols }, "r");
    expect([a!.world.npc_pool, b!.world.npc_pool, b!.world.npc_broke, b!.world.unemployment_rate_all]).toEqual([10, 12, 3, 0.2]);
    expect(a!.world.npc_employed).toBeNull();
    expect(a!.world.benefit_paid).toBeNull();
  });
});
