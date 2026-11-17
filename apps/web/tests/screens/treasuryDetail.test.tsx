import { mockNow } from "@/data/mock/clock";
import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoneyFlowCalculator } from "@/screens/MoneyFlowCalculator";
import { RulebookList } from "@/screens/RulebookList";
import { TreasuryDetail } from "@/screens/TreasuryDetail";
import { TreasuryRoute } from "@/screens/TreasuryRoute";
import { DEPLOYMENTS } from "@/data/deployments";
import { MOCK_NOW } from "@/data/mock/clock";
import { DEFAULT_FIXTURES, EDGE_FIXTURES, PERSONAS, type FixtureSet } from "@/data/mock/fixtures";
import { createMockDataSource } from "@/data/mock/MockDataSource";
import { isConfigurable, type Address, type ConfigurableTreasury, type Treasury } from "@/data/types";
import { DataProvider } from "@/providers/DataProvider";
import { mockViewport, removeViewportMock, walletPort, WithWallet } from "../helpers/shell";

let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params, usePathname: () => "/treasury/" }));

const user = userEvent.setup({ delay: null });

afterEach(removeViewportMock);

const commonwealth = DEFAULT_FIXTURES.treasuries.find((t): t is ConfigurableTreasury => isConfigurable(t) && t.metadata.name === "Commonwealth")!;
const OTHER_RULE = "0x7a3d00000000000000000000000000000000e914" as Address;

function withTreasuries(...extra: Treasury[]): Partial<FixtureSet> {
  return { treasuries: [...DEFAULT_FIXTURES.treasuries, ...extra] };
}
const variant = (over: Partial<ConfigurableTreasury>): ConfigurableTreasury => ({
  ...commonwealth,
  address: "0x1234567890abcdef1234567890abcdef12345678",
  ...over,
});

function mount(ui: React.ReactElement, opts: { wallet?: Address | null; fixtures?: Partial<FixtureSet> } = {}) {
  const source = createMockDataSource({ fixtures: opts.fixtures });
  const wallet = walletPort({ address: opts.wallet === undefined ? null : opts.wallet });
  return render(
    <DataProvider now={mockNow} source={source}>
      <WithWallet wallet={wallet}>{ui}</WithWallet>
    </DataProvider>,
  );
}
const detail = (address: Address, opts: Parameters<typeof mount>[1] = {}) => mount(<TreasuryDetail address={address} />, opts);

describe("RulebookList (desktop)", () => {
  it("lists_the_five_rules_in_order_with_the_contract_texts", async () => {
    detail(commonwealth.address);
    await screen.findByRole("heading", { name: "Rulebook" });
    const titles = within(screen.getByRole("list")).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Treasury fee", "Expenses", "Hold period", "Split rule", "Max agents"]);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("5%");
    expect(items[0]).toHaveTextContent("For every customer payment to a DAO under this treasury, 5% goes to the treasury balance.");
    expect(items[1]).toHaveTextContent("Another 3% is set aside for running costs. It also joins the treasury balance.");
    expect(items[2]).toHaveTextContent("7 days");
    expect(items[2]).toHaveTextContent("Each owner’s share is locked for 7 days after the payment arrives, then it can be claimed.");
    expect(items[3]).toHaveTextContent("Equal split");
    expect(items[3]).toHaveTextContent("This is the platform’s shared Equal-split contract.");
    expect(items[4]).toHaveTextContent("142 / 500");
    expect(items[4]).toHaveTextContent("Up to 500 agents can work across all DAOs under this treasury. 358 seats are open, read live from the contract.");
    expect(within(items[4]!).getByRole("meter")).toHaveAttribute("value", "142");
  });

  it("links_every_rule_to_the_same_treasury_contract", async () => {
    detail(commonwealth.address);
    await screen.findByRole("heading", { name: "Rulebook" });
    const labels = ["FeeRule · 0x4f2a…91c0 ↗", "ExpenseRule · 0x4f2a…91c0 ↗", "HoldRule · 0x4f2a…91c0 ↗", "EqualSplit · 0x2e0b…c4d1 ↗", "SeatLimit · 0x4f2a…91c0 ↗"];
    for (const label of labels) expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    const hrefs = labels.filter((l) => !l.startsWith("EqualSplit")).map((l) => screen.getByRole("link", { name: l }).getAttribute("href"));
    expect(new Set(hrefs).size).toBe(1);
    expect(hrefs[0]).toContain(commonwealth.address);
  });

  it("shows_zero_days_and_a_grouped_huge_hold", async () => {
    const { unmount } = detail(EDGE_FIXTURES.holdZero.address, { fixtures: withTreasuries(EDGE_FIXTURES.holdZero) });
    expect(await screen.findByText("0 days")).toBeInTheDocument();
    unmount();
    detail(EDGE_FIXTURES.hugeHold.address, { fixtures: withTreasuries(EDGE_FIXTURES.hugeHold) });
    expect(await screen.findByText("49,710 days")).toBeInTheDocument();
  });

  it("names_the_equal_split_only_when_the_split_rule_is_the_platform_contract", async () => {
    const lookalike = variant({
      metadata: { name: "Equal split", description: "Looks equal." },
      config: { ...commonwealth.config, splitRule: OTHER_RULE },
    });
    detail(lookalike.address, { fixtures: withTreasuries(lookalike) });
    await screen.findByRole("heading", { name: "Rulebook" });
    const rule = screen.getAllByRole("listitem")[3]!;
    expect(rule).toHaveTextContent("Custom rule");
    expect(rule).toHaveTextContent(OTHER_RULE);
    expect(screen.queryByText(/EqualSplit ·/)).toBeNull();
    expect(screen.queryByText(/shared Equal-split contract/)).toBeNull();
    expect(within(rule).queryByText("Equal split")).toBeNull();
    expect(screen.queryByText(/Each owner \(equal split\)/)).toBeNull();
  });

  it("renders_the_phone_texts_and_values_for_the_mobile_variant", () => {
    mount(<RulebookList treasury={commonwealth} variant="mobile" />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "1Treasury fee5%5% of every payment goes to the treasury balance.FeeRule · 0x4f2a…91c0 ↗",
      "2Expenses3%3% is set aside for running costs.ExpenseRule · 0x4f2a…91c0 ↗",
      "3Hold period7 daysShares unlock 7 days after the payment.HoldRule · 0x4f2a…91c0 ↗",
      "4Split ruleEqualThe rest is divided equally among members’ owners.EqualSplit · 0x2e0b…c4d1 ↗",
      "5Max agents142/500358 seats open, read live from the contract.SeatLimit · 0x4f2a…91c0 ↗",
    ]);
  });
});

describe("TreasuryDetail header and untrusted text", () => {
  it("shows_the_contract_founder_and_deployed_date_beside_the_name", async () => {
    detail(commonwealth.address);
    expect(await screen.findByRole("heading", { level: 1, name: "Commonwealth" })).toBeInTheDocument();
    expect(screen.getByText(commonwealth.metadata.description)).toBeInTheDocument();
    expect(screen.getByText("Rules fixed in Phase 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0x4f2a…91c0 ↗" })).toBeInTheDocument();
    expect(screen.getByText("0x3b02…7E21")).toBeInTheDocument();
    expect(screen.getByText("4 Aug 2026")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Treasuries / Commonwealth");
  });

  it("renders_a_hostile_name_and_description_as_plain_text", async () => {
    const hostile = variant({ metadata: { name: "<img src=x onerror=alert(1)>", description: "<b>x</b>" } });
    const { container } = detail(hostile.address, { fixtures: withTreasuries(hostile) });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(screen.getByText("<b>x</b>")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect([...container.querySelectorAll("b")].some((b) => b.textContent === "x")).toBe(false);
  });

  it("shows_the_contract_address_for_two_treasuries_with_the_same_name", async () => {
    const twin = variant({ address: "0x9999999999999999999999999999999999991234", metadata: { name: "Commonwealth", description: "" } });
    detail(twin.address, { fixtures: withTreasuries(twin) });
    expect(await screen.findByRole("link", { name: "0x9999…1234 ↗" })).toBeInTheDocument();
  });

  it("says_not_found_for_a_missing_unknown_or_external_treasury", async () => {
    const { unmount } = mount(<TreasuryDetail />);
    expect(await screen.findByText("Treasury not found.")).toBeInTheDocument();
    unmount();
    const unknown = detail("0x00000000000000000000000000000000000000aa");
    expect(await screen.findByText("Treasury not found.")).toBeInTheDocument();
    unknown.unmount();
    detail(EDGE_FIXTURES.external.address, { fixtures: withTreasuries(EDGE_FIXTURES.external) });
    expect(await screen.findByText("This treasury has no readable rules.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rulebook" })).toBeNull();
  });

  it("route_reads_the_a_parameter_and_rejects_a_malformed_one", async () => {
    params = new URLSearchParams({ a: commonwealth.address });
    const first = mount(<TreasuryRoute />);
    expect(await screen.findByRole("heading", { level: 1, name: "Commonwealth" })).toBeInTheDocument();
    first.unmount();
    params = new URLSearchParams({ a: "0xnope" });
    mount(<TreasuryRoute />);
    expect(await screen.findByText("Treasury not found.")).toBeInTheDocument();
    params = new URLSearchParams();
  });
});

describe("MoneyFlowCalculator (desktop)", () => {
  const calc = async () => {
    detail(commonwealth.address);
    await screen.findByRole("heading", { name: "Money-flow calculator" });
    return {
      amount: screen.getByLabelText("Customer pays (ETH)") as HTMLInputElement,
      members: screen.getByLabelText("Members in the DAO") as HTMLInputElement,
      rows: () => Object.fromEntries(screen.getAllByRole("term").map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])),
    };
  };

  it("matches_the_contract_example_for_one_eth_and_six_members", async () => {
    const c = await calc();
    expect(c.amount.value).toBe("1.00");
    expect(c.members.value).toBe("6");
    expect(c.rows()).toMatchObject({
      "Customer pays": "1.00",
      "Treasury fee · 5%": "−0.05",
      "Expenses · 3%": "−0.03",
      "To members' owners": "0.92",
      "Each owner (equal split)": "0.1533",
    });
    expect(screen.getByText(/Paid today → claimable on/)).toHaveTextContent("Paid today → claimable on 28 Oct 2026, after the 7-day hold. Amounts in ETH.");
    expect(screen.getByRole("img", { name: "Fee 5 percent, expenses 3 percent, members 92 percent" })).toBeInTheDocument();
  });

  it("treats_a_non_number_silently_as_zero", async () => {
    const c = await calc();
    await user.clear(c.amount);
    await user.type(c.amount, "abc");
    expect(c.rows()).toMatchObject({ "Customer pays": "0.00", "Treasury fee · 5%": "−0.00", "To members' owners": "0.00", "Each owner (equal split)": "0.00" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["0", "", "-3"])("treats_members_%j_as_one", async (value) => {
    const c = await calc();
    await user.clear(c.members);
    if (value) await user.type(c.members, value);
    expect(c.rows()["Each owner (equal split)"]).toBe("0.92");
  });

  it("answers_instantly_for_a_huge_member_count", async () => {
    const c = await calc();
    await user.clear(c.members);
    await user.type(c.members, "1000000000");
    expect(c.rows()["Each owner (equal split)"]).toBe("<0.0001");
  });

  it("shows_zero_owners_share_without_nan_when_fees_take_everything", async () => {
    const full = EDGE_FIXTURES.fullFee as ConfigurableTreasury;
    detail(full.address, { fixtures: withTreasuries(full) });
    await screen.findByRole("heading", { name: "Money-flow calculator" });
    expect(screen.getByText("To members' owners").nextElementSibling).toHaveTextContent("0.00");
    expect(screen.getByText("Each owner (equal split)").nextElementSibling).toHaveTextContent("0.00");
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("says_one_day_in_the_singular_and_groups_a_huge_hold", async () => {
    const one = variant({ config: { ...commonwealth.config, holdPeriod: 86400 } });
    const { unmount } = detail(one.address, { fixtures: withTreasuries(one) });
    expect(await screen.findByText(/Paid today/)).toHaveTextContent("after the 1-day hold");
    unmount();
    detail(EDGE_FIXTURES.hugeHold.address, { fixtures: withTreasuries(EDGE_FIXTURES.hugeHold) });
    expect(await screen.findByText(/Paid today/)).toHaveTextContent("after the 49,710-day hold");
  });

  it("claimable_date_is_today_for_a_zero_hold", async () => {
    detail(EDGE_FIXTURES.holdZero.address, { fixtures: withTreasuries(EDGE_FIXTURES.holdZero) });
    expect(await screen.findByText(/Paid today → claimable on/)).toHaveTextContent("claimable on 21 Oct 2026, after the 0-day hold");
    expect(MOCK_NOW).toBe(1792576800n);
  });

  it("hides_the_member_input_and_per_owner_row_under_a_custom_rule", async () => {
    const custom = variant({ config: { ...commonwealth.config, splitRule: OTHER_RULE } });
    mount(<MoneyFlowCalculator treasury={custom} variant="desktop" />);
    expect(screen.queryByLabelText("Members in the DAO")).toBeNull();
    expect(screen.queryByText(/Each owner/)).toBeNull();
    expect(screen.getByText("To members' owners")).toBeInTheDocument();
  });
});

describe("TreasuryBalance and founder Spend", () => {
  it("shows_the_accounting_numbers_and_four_history_rows", async () => {
    detail(commonwealth.address);
    await screen.findByText("23.408 ETH");
    expect(screen.getByText("20.630")).toBeInTheDocument();
    expect(screen.getByText("12.378")).toBeInTheDocument();
    expect(screen.getByText("9.600")).toBeInTheDocument();
    const history = screen.getByRole("table", { name: "Spending history" });
    const rows = within(history).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(within(rows[1]!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["12 Oct 2026", "0x7e19…b2c0", "2.500 ETH", "0x9a1c… ↗"]);
  });

  it("lists_the_four_daos_under_the_treasury_in_prototype_order", async () => {
    detail(commonwealth.address);
    await screen.findByRole("heading", { name: /DAOs under Commonwealth/ });
    expect(screen.getByRole("heading", { name: /DAOs under Commonwealth/ })).toHaveTextContent("DAOs under Commonwealth 18");
    expect(screen.getByRole("link", { name: "See all 18" })).toHaveAttribute("href", "/daos/");
    const table = await screen.findByRole("table", { name: "DAOs under Commonwealth" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(5));
    const names = within(table).getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Northwind Studio", "Fieldnotes Co-op", "Paper Lantern Translation", "Brightwater Research"]);
  });

  it.each([
    ["a non-founder wallet", PERSONAS.owner],
    ["no wallet", null],
  ] as const)("has_no_spend_button_for_%s", async (_n, wallet) => {
    detail(commonwealth.address, { wallet });
    await screen.findByText("23.408 ETH");
    expect(screen.queryByRole("button", { name: "Spend from treasury" })).toBeNull();
    expect(screen.queryByText("New spend")).toBeNull();
  });

  const openForm = async () => {
    detail(commonwealth.address, { wallet: PERSONAS.founder });
    await user.click(await screen.findByRole("button", { name: "Spend from treasury" }));
    return {
      to: screen.getByLabelText("Recipient address") as HTMLInputElement,
      amount: screen.getByLabelText("Amount (ETH)") as HTMLInputElement,
      review: screen.getByRole("button", { name: "Review and sign" }),
    };
  };
  const RECIPIENT = "0x7e19aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab2c0";

  it("opens_an_empty_form_with_the_available_balance", async () => {
    const f = await openForm();
    expect(f.to.value).toBe("");
    expect(f.to).toHaveAttribute("placeholder", "0x…");
    expect(f.amount.value).toBe("");
    expect(screen.getByText("New spend")).toBeInTheDocument();
    expect(screen.getByText("Founder only · public on-chain")).toBeInTheDocument();
    expect(screen.getByText("Up to 23.408 available")).toBeInTheDocument();
    expect(f.review).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects_an_amount_above_the_balance_or_malformed", async () => {
    const f = await openForm();
    await user.type(f.to, RECIPIENT);
    await user.type(f.amount, "23.409");
    expect(f.review).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount up to the available balance.");
    await user.clear(f.amount);
    await user.type(f.amount, "abc");
    expect(f.review).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount up to the available balance.");
    await user.clear(f.amount);
    await user.type(f.amount, "23.408");
    expect(f.review).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects_a_zero_amount_and_a_zero_or_malformed_recipient", async () => {
    const f = await openForm();
    await user.type(f.to, RECIPIENT);
    await user.type(f.amount, "0");
    expect(f.review).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Amount must be more than 0.");
    await user.clear(f.amount);
    await user.type(f.amount, "1");
    await user.clear(f.to);
    await user.type(f.to, "0x0000000000000000000000000000000000000000");
    expect(f.review).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid 0x address.");
    await user.clear(f.to);
    await user.type(f.to, "0x7e19…b2c0");
    expect(f.review).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid 0x address.");
  });

  it("cancel_closes_the_form", async () => {
    await openForm();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("New spend")).toBeNull();
    expect(screen.getByRole("button", { name: "Spend from treasury" })).toBeInTheDocument();
  });

  it("signs_a_spend_and_refreshes_the_balance_and_history", async () => {
    const f = await openForm();
    await user.type(f.to, RECIPIENT);
    await user.type(f.amount, "1.25");
    await user.click(f.review);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Send 1.250 ETH from Commonwealth");
    expect(dialog).toHaveTextContent("Balance 23.408 → 22.158 ETH");
    await user.click(within(dialog).getByRole("button", { name: "Sign spend" }));
    await user.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
    expect(await within(dialog).findByText("Confirmed on-chain")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(await screen.findByText("22.158 ETH")).toBeInTheDocument();
    expect(screen.getByText("10.850")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "Spending history" })).getAllByRole("row");
    expect(rows).toHaveLength(6);
    expect(within(rows[1]!).getAllByRole("cell").map((c) => c.textContent).slice(0, 3)).toEqual(["21 Oct 2026", "0x7e19…b2c0", "1.250 ETH"]);
    expect(screen.queryByText("New spend")).toBeNull();
  });
});

describe("phone layout (C-M2)", () => {
  const phone = async () => {
    mockViewport(true);
    detail(commonwealth.address, { wallet: PERSONAS.founder });
    await screen.findByRole("heading", { level: 1, name: "Commonwealth" });
  };

  it("shows_the_customer_pays_card_with_the_flow_lines", async () => {
    await phone();
    const card = screen.getByRole("region", { name: "Customer pays" });
    expect(within(card).getByText("ETH")).toBeInTheDocument();
    expect(card).toHaveTextContent("Fee 5%−0.05");
    expect(card).toHaveTextContent("Expenses 3%−0.03");
    expect(card).toHaveTextContent("To owners0.92");
    expect(card).toHaveTextContent("Split equally, claimable after 7 days (28 Oct 2026).");
    expect((screen.getByRole("textbox", { name: "Customer pays" }) as HTMLInputElement).value).toBe("1.00");
  });

  it("shows_five_rules_the_balance_box_and_no_desktop_only_parts", async () => {
    await phone();
    expect(screen.getByText("5%")).toBeInTheDocument();
    expect(screen.getByText("142/500")).toBeInTheDocument();
    expect(screen.getByText("Treasury balance")).toBeInTheDocument();
    await screen.findByText("23.408 ETH");
    expect(screen.getByRole("button", { name: "Spending history" })).toBeInTheDocument();
    expect(screen.getByText("DAOs under it")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse DAOs" })).toHaveAttribute("href", "/daos/");
    expect(screen.queryByRole("button", { name: "Spend from treasury" })).toBeNull();
    expect(screen.queryByText("Money-flow calculator")).toBeNull();
    expect(screen.queryByLabelText("Members in the DAO")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("spending_history_opens_a_sheet_with_the_balance_and_history", async () => {
    await phone();
    await screen.findByText("23.408 ETH");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Spending history" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "Treasury balance" })).toBeInTheDocument();
    const items = await within(sheet).findAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("12 Oct 20262.500 ETH0x7e19…b2c0");
    expect(within(sheet).queryByRole("table")).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Spend from treasury" })).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the_history_sheet_traps_tab_closes_on_escape_and_returns_focus", async () => {
    await phone();
    await screen.findByText("23.408 ETH");
    const trigger = screen.getByRole("button", { name: "Spending history" });
    await user.click(trigger);
    const sheet = await screen.findByRole("dialog");
    const close = within(sheet).getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveFocus());
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(sheet.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps_the_equal_label_to_the_rule_address", async () => {
    mockViewport(true);
    const lookalike = variant({ config: { ...commonwealth.config, splitRule: OTHER_RULE } });
    detail(lookalike.address, { fixtures: withTreasuries(lookalike) });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Equal")).toBeNull();
    expect(screen.queryByText(/Split equally/)).toBeNull();
    expect(DEPLOYMENTS.equalSplit).not.toBe(OTHER_RULE);
  });
});

describe("design rules for this screen", () => {
  it("has_no_inline_styles_and_uses_one_css_module_per_component", () => {
    const dir = path.resolve(__dirname, "../../src/screens");
    for (const f of ["TreasuryDetail", "RulebookList", "MoneyFlowCalculator", "TreasuryBalance"]) {
      expect(fs.existsSync(path.join(dir, `${f}.module.css`)), f).toBe(true);
      expect(fs.readFileSync(path.join(dir, `${f}.tsx`), "utf8")).not.toMatch(/style=\{/);
    }
  });
});
