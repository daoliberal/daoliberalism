import type { Holdings, HoldingsLonca, HoldingsMoney, World } from "@/oyun/sim/types";
import { worldOf } from "./sehirZincirVeri";

/** Kapanan örnek dünya: kesimlerin toplamı 447.450. */
export const worldOrnek = (over: Partial<World> = {}): World =>
  worldOf({ money_households: 59900, money_npc_firms: 30050, money_player_firms: 8000, money_city: 250500, money_lonca: 90000, money_other: 9000, money_total: 447450, ...over });

/** Kapanan örnek blok: varsayılanda `money_lonca` = lonca_cash_net + mevduatlar + fon + rezerv (90.000). */
export function holdingsOrnek(money: Partial<HoldingsMoney> = {}): Holdings {
  const m: HoldingsMoney = {
    deposits_players: 900, deposits_insurance: 100, found_fund: 5000, insurance_reserve: 400, lonca_cash_net: 90000 - 900 - 100 - 5000 - 400,
    credit_out: 2000, fund_credit_out: 300, bonds_out: 40, lonca_equity: 1200, ...money,
  };
  const loncas: HoldingsLonca[] = [0, 1, 2, 3, 4, 5].map((i) => ({
    ref: `lonca${i}`, owner: i === 1 ? "player" : i === 5 ? "closed" : "none", members: 10 + i, fee: 0.05,
    capital: 6000 + 100 * i, deposits: 900 + 10 * i, credit_out: 100 * i, equity: 5000 - 50 * i,
  }));
  return {
    money: m,
    groups: { player: { lonca_owner: { n: 10, cash: 1000, deposits: 0 } }, npc: { pool: { n: 53, cash: 2000 } } },
    deposits: { by_group: { lonca_owner: 300, firm_owner: 400, employed_player_firm: 50, employed_npc_firm: 50, municipal: 0, ahir: 0, seeking: 50, student: 0, other: 50, insurance: 100 } },
    loncas,
    firms: { player_count: 14, owners: 9, multi_owners: 2, cash_top10_share: 0.32 },
    wealth: { b50: 0.05, m40: 0.25, t10: 0.7, t1: 0.2, median: 151, gini: 0.62, n: 1500 },
    flows: [["players", "npc_firms", 88000], ["public_firms", "players", 51000], ["mint", "city", 1200], ["other", "other", 400]].map(([from, to, amount]) => ({ from: from as string, to: to as string, amount: amount as number })),
  };
}
