import type { ChainPacket, CityRow, DrawerData, Holdings, SourceInfo, WeekPacket, World } from "@/oyun/sim/types";

/** W9a testleri için şehir, zincir ve çekmece verisi (S5 sözleşme biçiminde). */

export const SEKTORLER = [
  { sector: "tarla_bugday", label: "Buğday tarlası", product: "bugday" },
  { sector: "un", label: "Un değirmeni", product: "un" },
  { sector: "firin", label: "Fırın", product: "ekmek" },
  { sector: "tekstil", label: "Tekstil", product: "kumas" },
  { sector: "giyim", label: "Giyim", product: "giysi" },
  { sector: "ahir", label: "Ahır (süt, deri, et)", product: "sut" },
] as const;

export const KENARLAR: [string, string, string][] = [["tarla_bugday", "un", "bugday"], ["un", "firin", "un"], ["tekstil", "giyim", "kumas"]];

export const cityRows = (week: number): CityRow[] =>
  [0, 1, 2, 3, 4].map((i) => ({
    index: i, served: 0.9 - i * 0.1 - week * 0.001, employed: 100 + i, unemployed: 10 + i, cash: 1000 * (i + 1), firms_npc: 20 + i, firms_player: i,
    rent_pct: 0.08, occupancy: 0.9, tenants_per_house: 1.1, migration_in: i, migration_out: 5 - i,
  }));

export function chainPacket(over: Partial<ChainPacket> = {}, board = true): ChainPacket {
  const sectors = SEKTORLER.map((s, i) => ({
    sector: s.sector, product: s.product, firms: 3 + i, healthy: board ? 2 : null, shortage: board ? (s.sector === "un" ? 0.4 : 0.01) : null,
    persist: board ? (s.sector === "un" ? 0.8 : 0.02) : null, cover_days: board ? 3 : null, price_trend: board ? 0.01 : null, price: 1.05,
  }));
  const nodes = SEKTORLER.flatMap((s, i) =>
    [0, 1, 2, 3, 4].map((c) => ({
      sector: s.sector, city: c, shortage: board ? 0.02 : null, price: 1.02, firms: 1 + (i % 4) + (c === 0 && s.sector === "un" ? 7 : 0),
      healthy: board ? 1 : null, demand: board ? 100 : null, output: board ? 90 : null, stock: board ? 10 : null,
    })));
  const scarce = board ? [{ sector: "un", product: "un", persist: 0.8, shortage: 0.4, firms: 4, healthy: 2 }, { sector: "firin", product: "ekmek", persist: 0.3, shortage: 0.2, firms: 5, healthy: 2 }] : null;
  return { board, edges_rev: 0, sectors, nodes, scarce, ...over };
}

const WORLD_NULL = Object.fromEntries(
  ["served", "unemployed", "employed", "npc_firms", "player_firms", "failed_cum", "city_cash_total", "city_cash_weeks", "gini", "price_index", "inflation_yoy", "unemployment_rate", "policy_rate", "minted_year", "mint_cap", "loans_applied", "loans_rejected", "loans_granted", "loan_rate_avg", "support_weekly", "survival_52", "wage_index", "rent_pct", "occupancy", "house_index", "deposit_rate", "bond_rate", "lonca_fee_avg", "royalty_avg", "money_total", "velocity", "privatized_firms", "no_founder", "reject_pool", "reject_reputation", "no_buyer_cum", "support_denied", "policy_unemployment", "city_spend_cut", "tenants_per_house", "house_resale_ratio", "policy_inflation", "minted_total"].map((k) => [k, null]),
) as World;

export const worldOf = (over: Partial<World> = {}): World => ({ ...WORLD_NULL, served: 0.8, unemployment_rate: 0.1, employed: 500, unemployed: 55, city_cash_total: 15000, ...over });

export function packet(week: number, over: { world?: Partial<World>; cities?: CityRow[] | null; chain?: ChainPacket | null; holdings?: Holdings } = {}): WeekPacket {
  const p: WeekPacket = { v: 1, run_id: "r", week, version: 1, world: worldOf(over.world), events: [] };
  const cities = over.cities === undefined ? cityRows(week) : over.cities;
  const chain = over.chain === undefined ? chainPacket() : over.chain;
  return { ...p, ...(cities ? { cities } : {}), ...(chain ? { chain } : {}), ...(over.holdings ? { holdings: over.holdings } : {}) };
}

export const worldInfo = (): NonNullable<SourceInfo["world"]> => ({
  basis: "model_defaults",
  cities: [0, 1, 2, 3, 4].map((index) => ({
    index, coal: index === 0, gold: index === 1, resources: index === 0 ? [{ id: "coal", label: "Kömür madeni" }] : [],
    specialties: [{ sector: "tekstil", label: "Tekstil" }], population_share: 0.2,
  })),
  chain: { sectors: SEKTORLER.map((s) => ({ ...s })), edges: KENARLAR.map(([from, to, product]) => ({ from, to, product })) },
});

export const drawerOf = (kind: string, ref: string, over: Partial<DrawerData> = {}): DrawerData => ({
  kind, ref, week: 3, stale: false, title: kind === "city" ? `Şehir ${Number(ref) + 1}` : "Un değirmeni",
  fields: kind === "city"
    ? { index: Number(ref), served: 0.52, employed: 112, unemployed: 11, cash: 2002, firms_npc: 21, firms_player: 1, rent_pct: 0.08, occupancy: 0.8, tenants_per_house: 1.01, migration_in: 1, migration_out: 0 }
    : { sector: ref, product: "un", label: "Un değirmeni", firms: 6, healthy: 4, shortage: 0.4, persist: 0.8, cover_days: 3, price_trend: 0.01, price: 1.02,
      inputs: [{ from: "tarla_bugday", label: "Buğday tarlası", product: "bugday", qty: 2 }], users: [{ to: "firin", label: "Fırın", product: "un", qty: 1 }] },
  ...over,
});
