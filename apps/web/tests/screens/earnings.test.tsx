import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Earnings } from "@/screens/Earnings";
import { explorerUrl } from "@/data/deployments";
import { DEFAULT_FIXTURES, EDGE_FIXTURES } from "@/data/mock/fixtures";
import { walletPort } from "../helpers/shell";
import { renderScreen } from "../helpers/screens";

const claimButton = () => screen.getByRole("button", { name: /^Claim .* ETH$/ });
const row = (id: string) => screen.getByText(id).closest('[role="row"]') as HTMLElement;
const checkbox = (id: string) => screen.getByRole("checkbox", { name: `Select order ${id}` });

async function loaded() {
  await screen.findByText("Available now");
  await screen.findByText("#0988");
}

describe("My earnings: summary and credits", () => {
  it("shows the three boxes", async () => {
    renderScreen(<Earnings />);
    await loaded();
    expect(screen.getByText("0.412 ETH")).toBeInTheDocument();
    expect(screen.getByText("3 credits")).toBeInTheDocument();
    expect(screen.getByText("0.287 ETH")).toBeInTheDocument();
    expect(screen.getByText("next release in 2 d 04 h")).toBeInTheDocument();
    expect(screen.getByText("1.900 ETH")).toBeInTheDocument();
    expect(screen.getByText("3 claims")).toBeInTheDocument();
  });

  it("lists the five credits with order, DAO, agent, treasury, hold, date, amount and release status", async () => {
    renderScreen(<Earnings />);
    await loaded();
    const r = within(row("#0988"));
    expect(r.getByRole("link", { name: "Quiet Harbor" })).toHaveAttribute("href", "/dao/?id=4");
    expect(r.getByText("Atlas‑7")).toBeInTheDocument();
    expect(r.getByRole("link", { name: "Lean Guild" })).toHaveAttribute("href", expect.stringMatching(/^\/treasury\/\?a=0x8c11/));
    expect(r.getByText("14-day hold")).toBeInTheDocument();
    expect(r.getByText("1 Oct")).toBeInTheDocument();
    expect(r.getByText("0.124")).toBeInTheDocument();
    expect(r.getByText("Available")).toBeInTheDocument();
    const pending = within(row("#1101"));
    expect(pending.getByText("in 2 d 04 h · 23 Oct")).toBeInTheDocument();
    expect(pending.getByText("16 Oct")).toBeInTheDocument();
    expect(within(row("#1110")).getByText("in 9 d 11 h · 30 Oct")).toBeInTheDocument();
    expect(within(row("#1017")).getByText("9 Oct")).toBeInTheDocument();
    expect(within(row("#1042")).getByText("12 Oct")).toBeInTheDocument();
  });

  it("draws the hold progress with a native progress element", async () => {
    renderScreen(<Earnings />);
    await loaded();
    expect(within(row("#1101")).getByRole("progressbar")).toHaveAttribute("value", "69");
    expect(within(row("#1110")).getByRole("progressbar")).toHaveAttribute("value", "32");
    expect(within(row("#0988")).getByRole("progressbar")).toHaveAttribute("value", "100");
  });

  it("gives a credit whose hold has not ended no checkbox", async () => {
    renderScreen(<Earnings />);
    await loaded();
    expect(within(row("#1101")).queryByRole("checkbox")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("names the checkbox column and gives the table and its region distinct names", async () => {
    renderScreen(<Earnings />);
    await loaded();
    expect(screen.getByRole("columnheader", { name: "Select" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Credits" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Credits table" })).toBeInTheDocument();
  });

  it("shows never releases in the status slot with an empty bar and no checkbox", async () => {
    renderScreen(<Earnings />, { mock: { fixtures: { credits: [EDGE_FIXTURES.neverReleaseCredit] } } });
    const status = await screen.findByText("never releases");
    const r = within(status.closest('[role="row"]') as HTMLElement);
    expect(r.queryByRole("checkbox")).toBeNull();
    expect(r.getByRole("progressbar")).toHaveAttribute("value", "0");
    expect(screen.getByText("0.000 ETH")).toBeInTheDocument();
  });

  it("asks a visitor without a wallet to connect", async () => {
    renderScreen(<Earnings />, { wallet: walletPort({ address: null }) });
    expect(await screen.findByText("Connect your wallet to continue.")).toBeInTheDocument();
  });
});

describe("My earnings: selection and claim", () => {
  it("selects the three ready credits by default", async () => {
    renderScreen(<Earnings />);
    await loaded();
    expect(claimButton()).toHaveTextContent("Claim 0.412 ETH");
    expect(screen.getByText(/3 of 3 available credits selected/)).toHaveTextContent("sent to 0x91c4…a4F2");
    for (const id of ["0988", "1017", "1042"]) expect(checkbox(id)).toBeChecked();
  });

  it("recomputes the total when one is unticked", async () => {
    renderScreen(<Earnings />);
    await loaded();
    await userEvent.click(checkbox("0988"));
    expect(claimButton()).toHaveTextContent("Claim 0.288 ETH");
    expect(screen.getByText(/2 of 3 available credits selected/)).toBeInTheDocument();
  });

  it("disables the claim button when nothing is selected", async () => {
    renderScreen(<Earnings />);
    await loaded();
    for (const id of ["0988", "1017", "1042"]) await userEvent.click(checkbox(id));
    expect(claimButton()).toHaveTextContent("Claim 0.000 ETH");
    expect(claimButton()).toBeDisabled();
    expect(screen.getByText(/0 of 3 available credits selected/)).toBeInTheDocument();
  });

  it("claims the selection: credits become Claimed and the history gains a row", async () => {
    const { source } = renderScreen(<Earnings />);
    await loaded();
    await userEvent.click(claimButton());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Claim 0.412 ETH")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Claim and sign" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
    await within(dialog).findByText("Confirmed on-chain");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(within(row("#0988")).getByText("Claimed")).toBeInTheDocument());
    expect(within(row("#0988")).queryByRole("checkbox")).toBeNull();
    expect(claimButton()).toBeDisabled();
    expect(screen.getByText("2.312 ETH")).toBeInTheDocument();
    expect(screen.getByText("4 claims")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Claim history" }));
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("3 credits")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("0.412 ETH")).toBeInTheDocument();
    expect((await source.listClaims((await source.listAgentsOf(DEFAULT_FIXTURES.agents[1]!.owner))[0]!.owner)).length).toBe(4);
  });

  it("a double click on Claim opens one approval and makes one claim", async () => {
    const { source } = renderScreen(<Earnings />);
    await loaded();
    await userEvent.dblClick(claimButton());
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    const dialog = dialogs[0]!;
    await userEvent.dblClick(within(dialog).getByRole("button", { name: "Claim and sign" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
    await within(dialog).findByText("Confirmed on-chain");
    const claims = await source.listClaims(DEFAULT_FIXTURES.agents[1]!.owner);
    expect(claims).toHaveLength(4);
  });

  it("sends only the ticked receipts in the claim request", async () => {
    const { source } = renderScreen(<Earnings />);
    const seen: unknown[] = [];
    const real = source.execute.bind(source);
    source.execute = (r, s) => (seen.push(r), real(r, s));
    await loaded();
    await userEvent.click(checkbox("0988"));
    await userEvent.click(claimButton());
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Claim and sign" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
    await within(dialog).findByText("Confirmed on-chain");
    const keys = DEFAULT_FIXTURES.credits.filter((c) => ["#1017", "#1042"].includes(`#${BigInt(c.orderId)}`)).map((c) => c.receiptKey);
    expect(seen).toEqual([{ kind: "claim", receiptKeys: keys }]);
  });
});

describe("My earnings: tabs and claim history", () => {
  it("has a Credits / Claim history tablist", async () => {
    renderScreen(<Earnings />);
    await loaded();
    const list = screen.getByRole("tablist", { name: "Earnings views" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Credits", "Claim history"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText("#0988")).toBeNull();
  });

  it("arrow keys move between tabs", async () => {
    renderScreen(<Earnings />);
    await loaded();
    screen.getByRole("tab", { name: "Credits" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Claim history" })).toHaveAttribute("aria-selected", "true");
  });

  it("lists the three fixture claims", async () => {
    renderScreen(<Earnings />);
    await loaded();
    await userEvent.click(screen.getByRole("tab", { name: "Claim history" }));
    expect(screen.getByText("1 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("5 credits")).toBeInTheDocument();
    expect(screen.getByText("0.871 ETH")).toBeInTheDocument();
    const tx = screen.getByText("0x3c9e… ↗");
    const claimTx = DEFAULT_FIXTURES.claims.find((c) => c.txHash.startsWith("0x3c9e"))!.txHash;
    expect(tx.closest("a")).toHaveAttribute("href", explorerUrl(claimTx));
    expect(screen.getByText("12 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("0.389 ETH")).toBeInTheDocument();
  });
});
