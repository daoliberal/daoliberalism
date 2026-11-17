import { mockNow } from "@/data/mock/clock";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { DataSource } from "@/data/datasource";
import { DEFAULT_FIXTURES, EDGE_FIXTURES } from "@/data/mock/fixtures";
import { createMockDataSource } from "@/data/mock/MockDataSource";
import type { Treasury } from "@/data/types";
import { Treasuries } from "@/screens/Treasuries";
import { DataProvider } from "@/providers/DataProvider";
import { MockWalletProvider } from "@/providers/MockWallet";
import { mockViewport, removeViewportMock } from "../helpers/shell";

afterEach(removeViewportMock);

function Providers({ source, children }: { source: DataSource; children: ReactNode }) {
  return (
    <DataProvider now={mockNow} source={source}>
      <MockWalletProvider>{children}</MockWalletProvider>
    </DataProvider>
  );
}

async function open(opts: { narrow?: boolean; treasuries?: Treasury[]; source?: DataSource } = {}) {
  mockViewport(opts.narrow ?? false);
  const source = opts.source ?? createMockDataSource(opts.treasuries ? { fixtures: { treasuries: opts.treasuries } } : {});
  const user = userEvent.setup();
  render(
    <Providers source={source}>
      <Treasuries />
    </Providers>,
  );
  await screen.findByRole("heading", { level: 1, name: "Choose the economy your agent works in" });
  await screen.findAllByRole("article");
  return { user };
}

const card = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("article") as HTMLElement;
const cardNames = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
/** Text of the <dd> that follows the <dt> with this term, spaces normalised. */
const field = (within_: HTMLElement, term: string) => {
  const dt = within(within_).getByText(term, { selector: "dt" });
  return (dt.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim();
};
const setAmount = async (user: ReturnType<typeof userEvent.setup>, value: string) => {
  const input = screen.getByLabelText("If a customer pays");
  await user.clear(input);
  if (value) await user.type(input, value);
};

describe("Treasuries (wide)", () => {
  it("shows_the_four_treasuries_with_the_default_one_eth_amounts", async () => {
    await open();
    expect(cardNames()).toEqual(["Commonwealth", "Lean Guild", "Meritline", "Open Field"]);
    const c = card("Commonwealth");
    expect(within(c).getByText("0.92 ETH")).toBeInTheDocument();
    expect(field(c, "Treasury fee")).toBe("5% · 0.05");
    expect(field(c, "Expenses")).toBe("3% · 0.03");
    expect(field(c, "Seats used")).toContain("142/500");
    expect(field(c, "Split rule")).toBe("Equal split");
    expect(within(c).getByText("reaches members' owners, after 7 days")).toBeInTheDocument();
    expect(within(c).getByText("18 DAOs · 412.60 ETH total volume")).toBeInTheDocument();
    expect(within(card("Meritline")).getByText("1,204.10 ETH total volume", { exact: false })).toBeInTheDocument();
    expect(within(c).getByRole("img", { name: "Fee 5 percent, expenses 3 percent, members 92 percent" })).toBeInTheDocument();
    expect(within(c).getByText("Contract 0x4f2a…91c0 ↗")).toBeInTheDocument();
  });

  it("recalculates_every_card_when_the_amount_changes", async () => {
    const { user } = await open();
    await setAmount(user, "10");
    expect(within(card("Commonwealth")).getByText("9.20 ETH")).toBeInTheDocument();
    expect(field(card("Commonwealth"), "Treasury fee")).toBe("5% · 0.50");
    expect(within(card("Lean Guild")).getByText("9.90 ETH")).toBeInTheDocument();
  });

  it("treats_an_invalid_amount_as_zero_without_an_error_message", async () => {
    const { user } = await open();
    for (const bad of ["abc", "1e3", "-1", "1.2.3"]) {
      await setAmount(user, bad);
      expect(screen.queryByRole("alert"), bad).toBeNull();
      expect(within(card("Commonwealth")).getByText("0.00 ETH"), bad).toBeInTheDocument();
      expect(within(card("Meritline")).getByText("0.00 ETH"), bad).toBeInTheDocument();
    }
  });

  it("does_not_crash_on_an_enormous_amount", async () => {
    const { user } = await open();
    await setAmount(user, "1" + "0".repeat(30));
    expect(within(card("Commonwealth")).getByText(/ETH$/, { selector: "span" })).toBeInTheDocument();
    expect(card("Lean Guild")).toBeInTheDocument();
  });

  it("shows_zero_to_owners_and_an_empty_member_slice_when_fee_and_expenses_take_everything", async () => {
    await open({ treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.fullFee] });
    const c = card("Full Fee");
    expect(within(c).getByText("0.00 ETH")).toBeInTheDocument();
    expect(within(c).getByRole("img", { name: "Fee 50 percent, expenses 50 percent, members 0 percent" })).toBeInTheDocument();
  });

  it("does_not_list_external_treasuries", async () => {
    await open({ treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.external] });
    expect(cardNames()).toHaveLength(4);
    expect(screen.getByText("4 of 4 treasuries · Sort is your choice. The platform doesn't rank or recommend.")).toBeInTheDocument();
  });

  it("filters_by_seats_open_and_updates_the_count", async () => {
    const { user } = await open();
    expect(screen.getByText("4 of 4 treasuries · Sort is your choice. The platform doesn't rank or recommend.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Seats open" }));
    expect(screen.getByRole("button", { name: "Seats open" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    expect(cardNames()).toEqual(["Commonwealth", "Lean Guild", "Open Field"]);
    expect(screen.getByText(/^3 of 4 treasuries/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Short hold (≤ 7 days)" }));
    expect(cardNames()).toEqual(["Commonwealth", "Meritline"]);
    await user.click(screen.getByRole("button", { name: "Equal split" }));
    expect(cardNames()).toEqual(["Commonwealth", "Lean Guild", "Open Field"]);
  });

  it("shows_an_empty_message_when_no_treasury_matches", async () => {
    const meritline = DEFAULT_FIXTURES.treasuries.filter((t) => t.metadata.name === "Meritline");
    const { user } = await open({ treasuries: meritline });
    await user.click(screen.getByRole("button", { name: "Seats open" }));
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No treasuries match this filter.")).toBeInTheDocument();
    expect(screen.getByText(/^0 of 1 treasuries/)).toBeInTheDocument();
  });

  it("reorders_the_cards_when_the_sort_changes", async () => {
    const { user } = await open();
    const sort = screen.getByLabelText("Sort");
    await user.selectOptions(sort, "owners");
    expect(cardNames()).toEqual(["Lean Guild", "Open Field", "Commonwealth", "Meritline"]);
    await user.selectOptions(sort, "hold");
    expect(cardNames()).toEqual(["Meritline", "Commonwealth", "Lean Guild", "Open Field"]);
    await user.selectOptions(sort, "seats");
    expect(cardNames()).toEqual(["Commonwealth", "Open Field", "Lean Guild", "Meritline"]);
    await user.selectOptions(sort, "name");
    expect(cardNames()).toEqual(["Commonwealth", "Lean Guild", "Meritline", "Open Field"]);
  });

  it("preselects_commonwealth_and_meritline_and_shows_the_tray", async () => {
    await open();
    const picked = screen.getAllByRole("checkbox", { name: "Compare" }).map((c) => (c as HTMLInputElement).checked);
    expect(picked).toEqual([true, false, true, false]);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByText("Commonwealth · Meritline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Side by side (2)" })).toBeInTheDocument();
  });

  it("updates_the_selection_count_and_hides_the_tray_when_nothing_is_selected", async () => {
    const { user } = await open();
    await user.click(within(card("Lean Guild")).getByRole("checkbox", { name: "Compare" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByText("Commonwealth · Lean Guild · Meritline")).toBeInTheDocument();
    for (const n of ["Commonwealth", "Lean Guild", "Meritline"]) await user.click(within(card(n)).getByRole("checkbox", { name: "Compare" }));
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Compare side by side" })).toBeNull();
  });

  it("shows_the_side_by_side_table_with_rulebook_links", async () => {
    const { user } = await open();
    expect(screen.getAllByRole("link", { name: "Read the rulebook" })).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Compare side by side" }));
    expect(screen.getByRole("button", { name: "Side by side (2)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Cards" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByText("2 selected")).toBeNull();
    const table = screen.getByRole("table");
    // a line break (no space in the text) separates "Reaches owners" from "of 1.00 ETH"
    const rowHeaders = within(table).getAllByRole("rowheader").map((h) => h.textContent);
    expect(rowHeaders).toEqual([
      "Reaches ownersof 1.00 ETH",
      "Treasury fee",
      "Expenses",
      "Hold period",
      "Split rule",
      "Seats (max agents)",
      "DAOs · volume",
    ]);
    const columns = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(columns).toEqual(["Commonwealth0x4f2a…91c0 ↗", "Meritline0x19be…44d7 ↗"]);
    const links = within(table).getAllByRole("link", { name: "Read the rulebook" });
    const addresses = DEFAULT_FIXTURES.treasuries.filter((t) => ["Commonwealth", "Meritline"].includes(t.metadata.name)).map((t) => t.address);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(addresses.map((a) => `/treasury/?a=${a}`));
    expect(within(table).getByText("0.92")).toBeInTheDocument();
    expect(within(table).getByText("split equally, after 7 days")).toBeInTheDocument();
    expect(within(table).getByText("split by custom rule, after 3 days")).toBeInTheDocument();
    expect(within(table).getByText("142/500")).toBeInTheDocument();
    expect(within(table).getByText("358 open · read on-chain")).toBeInTheDocument();
    expect(within(table).getByText("18 · 412.60 ETH")).toBeInTheDocument();
    expect(screen.queryByText("Select at least two treasuries in the card view to compare them side by side.")).toBeNull();
  });

  it("asks_for_at_least_two_selections_in_the_side_by_side_view", async () => {
    const { user } = await open();
    await user.click(within(card("Meritline")).getByRole("checkbox", { name: "Compare" }));
    await user.click(screen.getByRole("button", { name: "Side by side (1)" }));
    expect(screen.getByText("Select at least two treasuries in the card view to compare them side by side.")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cards" }));
    expect(cardNames()).toHaveLength(4);
  });

  it("recalculates_the_side_by_side_amounts_too", async () => {
    const { user } = await open();
    await setAmount(user, "2");
    await user.click(screen.getByRole("button", { name: "Compare side by side" }));
    expect(screen.getByText("of 2 ETH")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("1.84")).toBeInTheDocument();
  });
});

describe("Treasuries states", () => {
  it("shows_loading_then_the_cards", async () => {
    mockViewport(false);
    const source = createMockDataSource({ latencyMs: 20 });
    render(
      <Providers source={source}>
        <Treasuries />
      </Providers>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
  });

  it("shows_an_error_with_retry_when_the_list_fails", async () => {
    mockViewport(false);
    const base = createMockDataSource();
    let fail = true;
    const source: DataSource = {
      ...base,
      listTreasuries: () => (fail ? Promise.reject(new Error("down")) : base.listTreasuries()),
    };
    const user = userEvent.setup();
    render(
      <Providers source={source}>
        <Treasuries />
      </Providers>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this page. Try again.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(4));
  });
});

describe("Treasuries (narrow)", () => {
  it("shows_the_phone_layout_with_short_chip_labels_and_no_desktop_controls", async () => {
    await open({ narrow: true });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Seats open", "Hold ≤ 7 d", "Equal split"]);
    expect(screen.getByText("4 treasuries · sorted by name · no ranking")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Side by side/)).toBeNull();
    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/The platform doesn't rank/)).toBeNull();
  });

  it("shows_a_compact_card_per_treasury", async () => {
    await open({ narrow: true });
    const c = card("Commonwealth");
    expect(within(c).getByText("18 DAOs")).toBeInTheDocument();
    expect(within(c).getByText("0.92 ETH")).toBeInTheDocument();
    expect(within(c).getByText("to members' owners, after 7 days")).toBeInTheDocument();
    expect(field(c, "Fee")).toBe("5% · 0.05");
    expect(field(c, "Expenses")).toBe("3% · 0.03");
    expect(field(c, "Split")).toBe("Equal split");
    expect(field(c, "Seats")).toBe("142/500");
    expect(within(c).queryByText(/total volume/)).toBeNull();
    expect(within(c).queryByText(/Contract/)).toBeNull();
    const address = DEFAULT_FIXTURES.treasuries.find((t) => t.metadata.name === "Commonwealth")!.address;
    expect(within(c).getByRole("link", { name: "Read the rulebook" })).toHaveAttribute("href", `/treasury/?a=${address}`);
  });

  it("filters_and_recounts_with_the_short_chips", async () => {
    const { user } = await open({ narrow: true });
    await user.click(screen.getByRole("button", { name: "Seats open" }));
    expect(screen.getByText("3 treasuries · sorted by name · no ranking")).toBeInTheDocument();
    expect(cardNames()).toEqual(["Commonwealth", "Lean Guild", "Open Field"]);
    await user.click(screen.getByRole("button", { name: "Hold ≤ 7 d" }));
    expect(cardNames()).toEqual(["Commonwealth", "Meritline"]);
  });

  it("recalculates_from_the_amount_field", async () => {
    const { user } = await open({ narrow: true });
    await setAmount(user, "10");
    expect(within(card("Commonwealth")).getByText("9.20 ETH")).toBeInTheDocument();
    await setAmount(user, "abc");
    expect(within(card("Commonwealth")).getByText("0.00 ETH")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
