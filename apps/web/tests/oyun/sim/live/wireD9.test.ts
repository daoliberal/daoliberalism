import { describe, expect, it } from "vitest";
import { WireError, parsePacket, parseWorldPlan } from "@/oyun/sim/live/wire";
import { isgucuOzeti } from "@/oyun/sim/result";
import { packetOf } from "../../helpers/fakeLiveServer";
import { planYaniti } from "../../helpers/dunyaPlan";

describe("D9 /api/world/plan: işgücü alanı (geriye uyumlu genişleme)", () => {
  it("isgucu_alani_ayristirilir_eski_sunucuda_yoksa_undefined", () => {
    const hane = planYaniti({ laborForce: { mode: "hane", players: 1500, npc: 2550, dependents: 2550, participation: 0.5, total: 4050 } });
    expect(parseWorldPlan(JSON.parse(JSON.stringify(hane))).laborForce).toEqual(hane.laborForce);
    const eski = JSON.parse(JSON.stringify(planYaniti())) as Record<string, unknown>;
    delete eski.laborForce;
    expect(parseWorldPlan(eski).laborForce).toBeUndefined();
  });

  it("bozuk_isgucu_alani_wire_hatasi", () => {
    const p = JSON.parse(JSON.stringify(planYaniti())) as Record<string, unknown>;
    expect(() => parseWorldPlan({ ...p, laborForce: { mode: "baska", players: 1, npc: 1, dependents: 0, participation: 1, total: 2 } })).toThrow(WireError);
    expect(() => parseWorldPlan({ ...p, laborForce: { mode: "hane", players: "x", npc: 1, dependents: 0, participation: 1, total: 2 } })).toThrow(WireError);
    expect(() => parseWorldPlan({ ...p, laborForce: { mode: "hane" } })).toThrow(WireError);
  });
});

describe("D9 dünya göstergeleri: katılım oranı ve bakmakla yükümlü NPC", () => {
  it("alanlar_istege_bagli_bozuk_tur_wire_hatasi", () => {
    const p = packetOf("r", 1, 1);
    const w = parsePacket({ ...p, world: { ...p.world, npc_dependents: 2550, npc_lfp: 0.5 } }).world;
    expect(w.npc_dependents).toBe(2550);
    expect(w.npc_lfp).toBe(0.5);
    expect(parsePacket(JSON.parse(JSON.stringify(p))).world.npc_dependents ?? null).toBeNull();
    expect(() => parsePacket({ ...p, world: { ...p.world, npc_lfp: "x" } })).toThrow(WireError);
  });

  it("isgucu_ozeti_ilk_ve_son_olculen_deger", () => {
    const w = (hafta: number, o: Record<string, number | null>) => ({ ...packetOf("r", hafta, 1), world: { ...packetOf("r", hafta, 1).world, ...o } });
    const o = isgucuOzeti([w(1, { npc_lfp: 0.5, npc_dependents: 2550 }), w(2, { npc_lfp: 0.5, npc_dependents: 2500 }), w(3, {})]);
    expect(o).toEqual({ katilim: 0.5, bagimli: 2500 });
    expect(isgucuOzeti([w(1, {})])).toEqual({ katilim: null, bagimli: null });
  });
});
