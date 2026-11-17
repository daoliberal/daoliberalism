import { DEPLOYMENTS } from "@/data/deployments";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIXTURES } from "@/data/mock/fixtures";
import { isConfigurable, type ConfigurableTreasury } from "@/data/types";
import { parseEther } from "viem";
import { EDGE_FIXTURES } from "@/data/mock/fixtures";
import { amountOf, filterTreasuries, hasSeatsOpen, quoteOf, sortTreasuries } from "@/lib/treasuryView";

const all = DEFAULT_FIXTURES.treasuries.filter(isConfigurable);
const byName = (name: string): ConfigurableTreasury => {
  const t = all.find((x) => x.metadata.name === name);
  if (!t) throw new Error(`no fixture ${name}`);
  return t;
};
const names = (ts: ConfigurableTreasury[]) => ts.map((t) => t.metadata.name);

function variant(base: ConfigurableTreasury, name: string, address: string, patch: Partial<ConfigurableTreasury["config"]> = {}): ConfigurableTreasury {
  return { ...base, address: address as ConfigurableTreasury["address"], metadata: { ...base.metadata, name }, config: { ...base.config, ...patch } };
}

describe("hasSeatsOpen", () => {
  it("is_false_for_a_treasury_with_5_percent_or_fewer_seats_free", () => {
    expect(hasSeatsOpen(byName("Meritline"))).toBe(false); // 20 of 1000 free
  });

  it("is_true_when_more_than_5_percent_is_free", () => {
    for (const n of ["Commonwealth", "Lean Guild", "Open Field"]) expect(hasSeatsOpen(byName(n)), n).toBe(true);
  });

  it("is_false_at_exactly_5_percent_and_when_full_and_true_just_above", () => {
    const c = byName("Commonwealth");
    expect(hasSeatsOpen({ ...c, seatsUsed: 475 })).toBe(false); // 25/500 = 5%
    expect(hasSeatsOpen({ ...c, seatsUsed: 474 })).toBe(true);
    expect(hasSeatsOpen({ ...c, seatsUsed: 500 })).toBe(false);
  });
});

describe("filterTreasuries", () => {
  it("all_keeps_every_treasury", () => {
    expect(filterTreasuries(all, "all", DEPLOYMENTS)).toHaveLength(4);
  });

  it("open_hides_the_nearly_full_treasury", () => {
    expect(names(filterTreasuries(all, "open", DEPLOYMENTS)).sort()).toEqual(["Commonwealth", "Lean Guild", "Open Field"]);
  });

  it("short_keeps_holds_of_at_most_7_days", () => {
    expect(names(filterTreasuries(all, "short", DEPLOYMENTS)).sort()).toEqual(["Commonwealth", "Meritline"]);
    const eight = variant(byName("Commonwealth"), "Eight", "0x0000000000000000000000000000000000000008", { holdPeriod: 8 * 86400 });
    expect(filterTreasuries([eight], "short", DEPLOYMENTS)).toEqual([]);
  });

  it("equal_keeps_only_equal_split_treasuries", () => {
    expect(names(filterTreasuries(all, "equal", DEPLOYMENTS)).sort()).toEqual(["Commonwealth", "Lean Guild", "Open Field"]);
  });

  it("equal_follows_the_injected_deployments_rule_address (I3: one source of split kind)", () => {
    const elsewhere = { ...DEPLOYMENTS, equalSplit: byName("Meritline").config.splitRule };
    expect(names(filterTreasuries(all, "equal", elsewhere))).toEqual(["Meritline"]);
  });

  it("does_not_mutate_the_input", () => {
    const copy = [...all];
    filterTreasuries(all, "short", DEPLOYMENTS);
    expect(all).toEqual(copy);
  });
});

describe("sortTreasuries", () => {
  it("name_is_alphabetical", () => {
    expect(names(sortTreasuries(all, "name"))).toEqual(["Commonwealth", "Lean Guild", "Meritline", "Open Field"]);
  });

  it("owners_is_most_to_owners_first", () => {
    expect(names(sortTreasuries(all, "owners"))).toEqual(["Lean Guild", "Open Field", "Commonwealth", "Meritline"]);
  });

  it("hold_is_shortest_first", () => {
    expect(names(sortTreasuries(all, "hold"))).toEqual(["Meritline", "Commonwealth", "Lean Guild", "Open Field"]);
  });

  it("seats_is_most_free_seats_first", () => {
    expect(names(sortTreasuries(all, "seats"))).toEqual(["Commonwealth", "Open Field", "Lean Guild", "Meritline"]);
  });

  it("ties_break_by_name_then_by_address_whatever_the_input_order", () => {
    const c = byName("Commonwealth");
    const b = variant(c, "Beta", "0x00000000000000000000000000000000000000b2");
    const a2 = variant(c, "Alpha", "0x00000000000000000000000000000000000000a2");
    const a1 = variant(c, "Alpha", "0x00000000000000000000000000000000000000a1");
    for (const input of [[b, a2, a1], [a1, a2, b], [a2, b, a1]]) {
      const out = sortTreasuries(input, "owners");
      expect(out.map((t) => t.address)).toEqual([a1.address, a2.address, b.address]);
    }
  });

  it("does_not_mutate_the_input", () => {
    const copy = [...all];
    sortTreasuries(all, "owners");
    expect(all).toEqual(copy);
  });
});

describe("amountOf", () => {
  it("parses_a_decimal_amount_and_treats_everything_else_as_zero", () => {
    expect(amountOf("1.00")).toBe(parseEther("1"));
    expect(amountOf(" 2.5 ")).toBe(parseEther("2.5"));
    expect(amountOf(".5")).toBe(parseEther("0.5"));
    for (const bad of ["", "abc", "1e3", "-1", "1.2.3", "0x10", "1.0000000000000000001"]) expect(amountOf(bad), bad).toBe(0n);
  });

  it("does_not_throw_on_an_enormous_amount", () => {
    expect(amountOf("1" + "0".repeat(30))).toBe(10n ** 48n);
  });
});

describe("quoteOf", () => {
  it("splits_an_amount_into_fee_expenses_and_what_reaches_owners", () => {
    const q = quoteOf(byName("Commonwealth"), parseEther("1"));
    expect(q).toEqual({ fee: parseEther("0.05"), expenses: parseEther("0.03"), owners: parseEther("0.92") });
  });

  it("gives_the_rounding_remainder_to_the_fee_when_fee_and_expenses_total_100_percent", () => {
    const full = EDGE_FIXTURES.fullFee as ConfigurableTreasury;
    const q = quoteOf(full, 3n);
    expect(q.owners).toBe(0n);
    expect(q.fee + q.expenses).toBe(3n);
  });

  it("is_all_zero_for_a_zero_amount", () => {
    expect(quoteOf(byName("Meritline"), 0n)).toEqual({ fee: 0n, expenses: 0n, owners: 0n });
  });
});
