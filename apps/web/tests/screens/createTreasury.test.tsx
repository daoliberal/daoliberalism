import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEPLOYMENTS } from "@/data/deployments";
import { decodeTreasuryMetadata } from "@/data/metadata";
import { PERSONAS } from "@/data/mock/fixtures";
import { CreateTreasury } from "@/screens/CreateTreasury";
import { mockViewport, removeViewportMock } from "../helpers/shell";
import { renderScreen } from "../helpers/wizard";

const DESCRIPTION = "Low overhead, two-week hold, equal shares for every member.";

beforeEach(() => mockViewport(false));
afterEach(removeViewportMock);

async function typeInto(label: string, value: string) {
  const el = screen.getByLabelText(label);
  await userEvent.clear(el);
  if (value) await userEvent.type(el, value);
}

const heading = (name: string) => screen.getByRole("heading", { level: 2, name });
const cont = () => screen.getByRole("button", { name: "Continue" });

describe("CreateTreasury (C-04)", () => {
  it("shows_the_connect_prompt_without_a_wallet", () => {
    renderScreen(<CreateTreasury />, { disconnected: true });
    expect(screen.getByText("Connect your wallet to continue.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Treasury name")).not.toBeInTheDocument();
  });

  it("starts_with_the_prototype_values_as_real_values", () => {
    renderScreen(<CreateTreasury />);
    expect(screen.getByLabelText("Treasury name")).toHaveValue("Tidewater");
    expect(screen.getByLabelText("Description")).toHaveValue(DESCRIPTION);
    expect(screen.getByLabelText("Treasury fee")).toHaveValue("2");
    expect(screen.getByLabelText("Expenses")).toHaveValue("1");
    expect(screen.getByLabelText("Hold period")).toHaveValue("14");
    expect(screen.getByLabelText("Max agents")).toHaveValue("300");
    expect(heading("A 1 ETH payment under Tidewater")).toBeInTheDocument();
  });

  it("blocks_continue_and_alerts_when_fee_plus_expenses_exceed_100", async () => {
    renderScreen(<CreateTreasury />);
    await typeInto("Treasury fee", "60");
    await typeInto("Expenses", "50");
    expect(screen.getByRole("alert")).toHaveTextContent("Fee and expenses together can't exceed 100%.");
    const rest = screen.getByText("To members' owners").parentElement!;
    expect(within(rest).getByText("—")).toBeInTheDocument();
    await userEvent.click(cont());
    expect(heading("Name and economics")).toBeInTheDocument();
  });

  it("accepts_exactly_100_and_previews_zero_for_owners", async () => {
    renderScreen(<CreateTreasury />);
    await typeInto("Treasury fee", "100");
    await typeInto("Expenses", "0");
    const rest = screen.getByText("To members' owners").parentElement!;
    expect(within(rest).getByText("0.00")).toBeInTheDocument();
    await userEvent.click(cont());
    expect(heading("Split rule")).toBeInTheDocument();
  });

  it.each([
    ["Treasury fee", "2.555", "Enter a percentage with up to 2 decimals."],
    ["Expenses", "abc", "Enter a percentage with up to 2 decimals."],
    ["Hold period", "1.5", "Enter a whole number of days."],
    ["Max agents", "0", "Enter 1 or more."],
    ["Treasury name", "x".repeat(81), "Use 80 characters or fewer."],
    ["Description", "y".repeat(501), "Use 500 characters or fewer."],
  ])("rejects_%s_%s", async (label, value, message) => {
    renderScreen(<CreateTreasury />);
    const el = screen.getByLabelText(label);
    await userEvent.clear(el);
    await userEvent.click(el);
    await userEvent.paste(value);
    expect(screen.getByText(message)).toBeInTheDocument();
    await userEvent.click(cont());
    expect(heading("Name and economics")).toBeInTheDocument();
  });

  it("counts_code_points_not_utf16_units_for_the_name", async () => {
    renderScreen(<CreateTreasury />);
    const el = screen.getByLabelText("Treasury name");
    await userEvent.clear(el);
    await userEvent.click(el);
    await userEvent.paste("😀".repeat(80));
    expect(screen.queryByText("Use 80 characters or fewer.")).not.toBeInTheDocument();
  });

  it("cannot_skip_an_invalid_step_through_the_stepper", async () => {
    renderScreen(<CreateTreasury />);
    await typeInto("Treasury fee", "2.555");
    await userEvent.click(screen.getByRole("button", { name: /Confirm and sign/ }));
    expect(heading("Name and economics")).toBeInTheDocument();
  });

  it("custom_rule_needs_a_valid_address_to_continue", async () => {
    renderScreen(<CreateTreasury />);
    await userEvent.click(cont());
    expect(screen.getByRole("button", { name: /Equal split/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Audited contract shared by all equal-split treasuries\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Custom rule contract/ }));
    expect(screen.getByText("We check the contract implements the split interface before you can continue.")).toBeInTheDocument();
    expect(screen.getByLabelText("Rule contract address")).toHaveAttribute("placeholder", "0x…");
    await userEvent.type(screen.getByLabelText("Rule contract address"), "0x123");
    await userEvent.click(cont());
    expect(heading("Split rule")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid 0x address.")).toBeInTheDocument();
  });

  it("custom_rule_with_an_empty_address_shows_the_error_after_continue", async () => {
    renderScreen(<CreateTreasury />);
    await userEvent.click(cont());
    await userEvent.click(screen.getByRole("button", { name: /Custom rule contract/ }));
    expect(screen.queryByText("Enter a valid 0x address.")).not.toBeInTheDocument();
    await userEvent.click(cont());
    expect(heading("Split rule")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid 0x address.")).toBeInTheDocument();
  });

  it("the_address_error_is_quiet_again_after_the_step_changes", async () => {
    renderScreen(<CreateTreasury />);
    await userEvent.click(cont());
    await userEvent.click(screen.getByRole("button", { name: /Custom rule contract/ }));
    await userEvent.click(cont());
    expect(screen.getByText("Enter a valid 0x address.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(cont());
    expect(screen.queryByText("Enter a valid 0x address.")).not.toBeInTheDocument();
  });

  it.each([
    ["101", "1", "−1.01", "−0.01", "—"],
    ["abc", "1", "−0.00", "−0.01", "0.99"],
    ["2.555", "1", "−0.0256", "−0.01", "0.9644"],
  ])("preview_for_fee_%s_follows_the_prototype", async (fee, expenses, feeRow, expRow, rest) => {
    renderScreen(<CreateTreasury />);
    await typeInto("Treasury fee", fee);
    await typeInto("Expenses", expenses);
    const row = screen.getByText("To members' owners").parentElement!;
    expect(within(row).getByText(rest)).toBeInTheDocument();
    expect(screen.getByText(feeRow)).toBeInTheDocument();
    expect(screen.getByText(expRow)).toBeInTheDocument();
  });

  it("deploy_is_disabled_until_the_acknowledgement_is_ticked", async () => {
    renderScreen(<CreateTreasury />);
    await userEvent.click(cont());
    await userEvent.click(cont());
    expect(heading("Review the rulebook for Tidewater")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy and sign" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /I understand these rules are permanent in Phase 1/ }));
    expect(screen.getByRole("button", { name: "Deploy and sign" })).toBeEnabled();
  });

  it("deploy_is_disabled_if_an_earlier_step_became_invalid", async () => {
    renderScreen(<CreateTreasury />);
    await userEvent.click(cont());
    await userEvent.click(cont());
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /Economics/ }));
    await typeInto("Hold period", "x");
    await userEvent.click(screen.getByRole("button", { name: /Confirm and sign/ }));
    expect(heading("Name and economics")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deploy and sign" })).not.toBeInTheDocument();
  });

  it("signs_one_deployTreasury_with_config_and_metadata", async () => {
    const { execute } = renderScreen(<CreateTreasury />);
    await userEvent.click(cont());
    await userEvent.click(cont());
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Deploy and sign" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Treasury factory · 0xa4c7…0e55/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Deploy and sign" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
    expect(await within(dialog).findByText("Confirmed on-chain")).toBeInTheDocument();
    expect(execute).toHaveBeenCalledTimes(1);
    const [request, signer] = execute.mock.calls[0]!;
    expect(signer).toBe(PERSONAS.owner);
    if (request.kind !== "deployTreasury") throw new Error("wrong kind");
    expect(request.config).toEqual({
      feeBps: 200,
      expenseBps: 100,
      holdPeriod: 1209600,
      maxAgents: 300,
      splitRule: DEPLOYMENTS.equalSplit,
    });
    const meta = decodeTreasuryMetadata(request.metadataURI);
    expect(meta).toEqual({ ok: true, value: { name: "Tidewater", description: DESCRIPTION } });
  });

  it("uses_the_custom_rule_address_as_split_rule", async () => {
    const { execute } = renderScreen(<CreateTreasury />);
    await userEvent.click(cont());
    await userEvent.click(screen.getByRole("button", { name: /Custom rule contract/ }));
    const addr = "0x7a3d000000000000000000000000000000e914aa";
    await userEvent.type(screen.getByLabelText("Rule contract address"), addr);
    await userEvent.click(cont());
    expect(screen.getByText("Custom rule contract", { selector: "dd" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Deploy and sign" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Deploy and sign" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
    await within(dialog).findByText("Confirmed on-chain");
    const request = execute.mock.calls[0]![0];
    if (request.kind !== "deployTreasury") throw new Error("wrong kind");
    expect(request.config.splitRule.toLowerCase()).toBe(addr);
  });
});
