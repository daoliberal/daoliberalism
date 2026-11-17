import type { WorldPlan, WorldPlanKind } from "@/oyun/sim/types";

const tur = (kind: string, label: string, group: WorldPlanKind["group"], o: Partial<WorldPlanKind> = {}): WorldPlanKind => ({
  kind, label, group, firms: 5, capacity: 75, maxPeople: 375, target: 200, planned: 200, blocked: false, shortfall: 0, growthCeiling: 75, ...o,
});

/** D7 `/api/world/plan` yanıtının tel biçimi (varsayılan dünya: üç tür tıkanır). */
export const planYaniti = (o: Partial<WorldPlan> = {}): WorldPlan => ({
  population: { playersPerCity: 300, cities: 5, players: 1500, npc: 5100, total: 6600 },
  firms: { total: 124, perCity: [25, 25, 25, 25, 24], per1000: 18.8 },
  openingStaff: { total: 2663, perCity: [533, 533, 533, 533, 531], npcRate: 0.522 },
  kinds: [
    tur("tarla_bugday", "Buğday tarlası", "hammadde", { capacity: 75, target: 150, planned: 75, blocked: true, shortfall: 75 }),
    tur("maden_silika", "Silika madeni", "hammadde", { blocked: true, target: 110, shortfall: 35 }),
    tur("market", "Market", "hizmet", { capacity: 75, growthCeiling: 75 }),
    tur("lojistik", "Lojistik", "lojistik", { capacity: 240, growthCeiling: 240 }),
  ],
  blockedKinds: ["tarla_bugday", "maden_silika"],
  housing: { stock: [400, 400, 400, 400, 400], total: 2000, tenants: [330, 330, 330, 330, 330] },
  scale: { employment: 1, population: 1 },
  capMode: "sabit",
  capGrowth: "sabit_taban",
  laborForce: { mode: "tek_kisi", players: 1500, npc: 5100, dependents: 0, participation: 1, total: 6600 },
  ...o,
});
