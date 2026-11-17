import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Landing } from "@/screens/Landing";
import { walletPort, WithWallet } from "../helpers/shell";

function open(connect = vi.fn()) {
  render(
    <WithWallet wallet={walletPort({ address: null, connect })}>
      <Landing />
    </WithWallet>,
  );
  return { connect };
}

describe("Landing", () => {
  it("states_the_proposition_and_the_example_payment", () => {
    open();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Economic models, written as code. You choose which one to work under.");
    const flow = screen.getByRole("region", { name: "Follow one payment" });
    const steps = within(flow).getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([
      "Customer pays the DAO1.00 ETH",
      "Treasury fee · 5%−0.05",
      "Expenses · 3%−0.03",
      "Split equally among members' owners0.92 ETH",
      "Withdrawable after7 days",
    ]);
    expect(screen.getByRole("heading", { level: 2, name: "Three ideas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "What you can do" })).toBeInTheDocument();
  });

  it("connects_the_wallet_and_opens_the_treasuries_from_the_hero_button", async () => {
    const { connect } = open();
    const hero = screen.getByRole("link", { name: "Connect wallet" });
    expect(hero).toHaveAttribute("href", "/treasuries/");
    await userEvent.click(hero);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("lets_a_visitor_browse_the_treasuries_without_connecting", async () => {
    const { connect } = open();
    const browse = screen.getByRole("link", { name: "Browse treasuries first" });
    expect(browse).toHaveAttribute("href", "/treasuries/");
    await userEvent.click(browse);
    expect(connect).not.toHaveBeenCalled();
  });

  it("links_the_hero_to_the_economy_game", () => {
    open();
    expect(screen.getByRole("link", { name: "Play the economy game →" })).toHaveAttribute("href", "/oyun/");
  });

  it("links_the_three_role_cards", () => {
    open();
    const roles = screen.getByRole("region", { name: "What you can do" });
    expect(within(roles).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Own agentsRegister an agent, choose the DAOs it works in, collect earnings in your wallet.Register an agent →", "/agents/"],
      ["Found a DAOCreate a company and place it under the treasury whose rules you accept.Create a DAO →", "/daos/new/"],
      ["Deploy a treasuryWrite an economic model once and let it compete for DAOs and agents.Deploy a treasury →", "/treasuries/new/"],
    ]);
  });

  it("describes_how_the_platform_is_organised", () => {
    open();
    const diagram = screen.getByLabelText("How daoliberal is organised");
    expect(within(diagram).getByText("Owner wallet (you)")).toBeInTheDocument();
    expect(within(diagram).getAllByText("Agent")).toHaveLength(3);
    expect(screen.getByText("Phase 1 runs on an Ethereum L2 testnet. Payments are in ETH only.")).toBeInTheDocument();
  });
});
