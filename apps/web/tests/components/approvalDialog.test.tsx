import { mockNow } from "@/data/mock/clock";
import fs from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalDialog } from "@/components/shell/ApprovalDialog";
import type { DataSource } from "@/data/datasource";
import { DEPLOYMENTS, explorerUrl } from "@/data/deployments";
import { DEFAULT_FIXTURES, PERSONAS } from "@/data/mock/fixtures";
import { ActionError, type ActionRequest, type Address, type Hex, type Treasury, type TxResult } from "@/data/types";
import { useActionFlow } from "@/providers/actionFlow";
import { DataProvider } from "@/providers/DataProvider";
import { describeAction, type ApprovalView } from "@/providers/describeAction";
import { mockViewport, removeViewportMock, walletPort, WithWallet } from "../helpers/shell";

const { owner, founder } = PERSONAS;
const treasuryNamed = (n: string): Treasury => DEFAULT_FIXTURES.treasuries.find((x) => x.metadata.name === n)!;
const commonwealth = treasuryNamed("Commonwealth");
const northwind = DEFAULT_FIXTURES.daos.find((d) => d.metadata.name === "Northwind Studio")!;
const base = { deployments: DEPLOYMENTS, signer: owner };

const joinReq: ActionRequest = { kind: "joinDao", daoId: northwind.id, agentId: 1n };
const joinView = describeAction(joinReq, { ...base, treasury: commonwealth, dao: northwind, agentName: "Atlas‑7", memberCountAfter: 7 });
const spendReq: ActionRequest = { kind: "spend", treasury: commonwealth.address, to: "0x7e19000000000000000000000000000000b2c0" as Address, amount: 1_250_000_000_000_000_000n };
const spendView = describeAction(spendReq, { ...base, signer: founder, treasury: commonwealth, balance: 23_408_000_000_000_000_000n });
const registerReq: ActionRequest = { kind: "registerAgent", agentKey: "0x0b97000000000000000000000000000000e2C4" as Address, metadataURI: "ipfs://bafy-oxrelay.json" };
const registerView = describeAction(registerReq, base);

const TX: Hex = "0x6b0e00000000000000000000000000000000000000000000000000000000009d24";
const OK: TxResult = { txHash: TX };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(opts: { request?: ActionRequest; view?: ApprovalView; mode?: "manual-mock" | "wallet" } = {}) {
  const run = deferred<TxResult>();
  const execute = vi.fn(() => run.promise);
  const source = { execute } as unknown as DataSource;
  const wallet = walletPort({ approvalMode: opts.mode ?? "manual-mock" });
  const request = opts.request ?? joinReq;
  const view = opts.view ?? joinView;
  function Harness() {
    const flow = useActionFlow();
    return (
      <>
        <button onClick={() => flow.start(request, view)}>Open approval</button>
        <ApprovalDialog flow={flow} />
      </>
    );
  }
  const ui = render(
    <DataProvider now={mockNow} source={source} queryClient={new QueryClient()}>
      <WithWallet wallet={wallet}>
        <Harness />
      </WithWallet>
    </DataProvider>,
  );
  const open = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Open approval" }));
    return screen.getByRole("dialog");
  };
  return { ...ui, execute, run, open };
}

afterEach(removeViewportMock);

describe("ApprovalDialog (wide, C-09)", () => {
  beforeEach(() => {
    mockViewport(false);
  });

  it("renders_nothing_until_a_flow_starts", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("review_shows_the_three_numbered_items_the_footer_and_both_buttons", async () => {
    const { open } = setup();
    const dialog = await open();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Let Atlas‑7 join Northwind Studio");
    const d = within(dialog);
    expect(d.getByText("Membership")).toBeInTheDocument();
    expect(d.getByText("Testnet")).toBeInTheDocument();
    const items = d.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items.map((li) => li.firstElementChild?.textContent)).toEqual(["1", "2", "3"]);
    expect(d.getByText("What will happen")).toBeInTheDocument();
    expect(d.getByText(joinView.happen)).toBeInTheDocument();
    expect(d.getByText("Contract you sign")).toBeInTheDocument();
    expect(d.getByText("DAO membership · 0x61f0…aa32 ↗").closest("a")).toHaveAttribute(
      "href",
      explorerUrl(joinView.contractAddress),
    );
    expect(d.getByText("Rules that apply")).toBeInTheDocument();
    expect(d.getByText(joinView.rules)).toBeInTheDocument();
    expect(d.getByText(joinView.flow!)).toBeInTheDocument();
    expect(d.getByText("Signing as")).toBeInTheDocument();
    expect(d.getByText("0x91c4…a4F2")).toBeInTheDocument();
    expect(d.getByText("Network fee shown in your wallet")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Approve and sign" })).toBeInTheDocument();
  });

  it("flow_and_permanence_appear_only_when_the_view_has_them", async () => {
    const withBoth = setup({ request: spendReq, view: spendView });
    let dialog = await withBoth.open();
    expect(within(dialog).getByText("Balance 23.408 → 22.158 ETH")).toBeInTheDocument();
    expect(within(dialog).getByRole("note")).toHaveTextContent("Public: this spend appears in the treasury’s history for everyone");
    withBoth.unmount();

    const neither = setup({ request: registerReq, view: registerView });
    dialog = await neither.open();
    expect(within(dialog).queryByRole("note")).toBeNull();
    expect(within(dialog).queryByText(/Balance|Per 1 ETH/)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Register and sign" })).toBeInTheDocument();
  });

  it("does_not_show_the_phone_sheet_copy", async () => {
    const { open } = setup();
    const dialog = await open();
    expect(within(dialog).queryByText("Not now")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("cancel_closes_the_dialog", async () => {
    const { open } = setup();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a_double_click_on_the_cta_moves_to_waiting_once_and_sends_nothing_yet", async () => {
    const { open, execute } = setup();
    const dialog = await open();
    await userEvent.dblClick(within(dialog).getByRole("button", { name: "Approve and sign" }));
    const d = within(screen.getByRole("dialog"));
    expect(d.getByText("Waiting for your wallet")).toBeInTheDocument();
    expect(d.getByText("Check the request in your wallet. Nothing happens until you approve it there.")).toBeInTheDocument();
    expect(d.queryByText("What will happen")).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("a_double_click_on_simulate_executes_exactly_once", async () => {
    const { open, execute } = setup();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Prototype: simulate wallet approval" }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(joinReq, owner);
  });

  it("with_a_real_wallet_there_is_no_simulate_button_and_the_cta_sends_once", async () => {
    const { open, execute } = setup({ mode: "wallet" });
    const dialog = await open();
    await userEvent.dblClick(within(dialog).getByRole("button", { name: "Approve and sign" }));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Waiting for your wallet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prototype: simulate wallet approval" })).toBeNull();
  });

  it("done_shows_the_confirmation_the_transaction_and_a_done_button_that_closes", async () => {
    const { open, run } = setup();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
    await userEvent.click(screen.getByRole("button", { name: "Prototype: simulate wallet approval" }));
    await act(async () => run.resolve(OK));
    const d = within(screen.getByRole("dialog"));
    expect(d.getByText("Confirmed on-chain")).toBeInTheDocument();
    expect(d.getByText("Atlas‑7 is now a member of Northwind Studio.")).toBeInTheDocument();
    expect(d.getByText("Transaction 0x6b0e…9d24 ↗").closest("a")).toHaveAttribute("href", expect.stringContaining("sepolia.arbiscan.io/"));
    await userEvent.click(d.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("done_prefers_the_text_built_from_the_result", async () => {
    const view: ApprovalView = { ...registerView, doneTextFor: (r) => `Agent #${r.created?.agentId} is registered. You can now join DAOs with it.` };
    const { open, run } = setup({ request: registerReq, view });
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Register and sign" }));
    await userEvent.click(screen.getByRole("button", { name: "Prototype: simulate wallet approval" }));
    await act(async () => run.resolve({ txHash: TX, created: { agentId: 9n } }));
    expect(screen.getByText("Agent #9 is registered. You can now join DAOs with it.")).toBeInTheDocument();
  });

  it("a_declined_or_disconnected_wallet_ends_in_a_neutral_error_with_a_close_button", async () => {
    const { open, run } = setup();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
    await userEvent.click(screen.getByRole("button", { name: "Prototype: simulate wallet approval" }));
    await act(async () => run.reject(new ActionError("Rejected", "x")));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The action didn't go through");
    expect(alert).toHaveTextContent("The request was declined, or the wallet disconnected before it was sent. Nothing was recorded.");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("any_other_error_shows_its_own_message", async () => {
    const { open, run } = setup();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
    await userEvent.click(screen.getByRole("button", { name: "Prototype: simulate wallet approval" }));
    await act(async () => run.reject(new ActionError("MemberCapReached", "This DAO is full.")));
    expect(screen.getByRole("alert")).toHaveTextContent("This DAO is full.");
  });

  it("escape_closes_only_during_review", async () => {
    const { open } = setup();
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await open();
    await userEvent.click(screen.getByRole("button", { name: "Approve and sign" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Waiting for your wallet")).toBeInTheDocument();
  });
});

describe("ApprovalDialog focus", () => {
  beforeEach(() => {
    mockViewport(false);
  });

  it("moves_focus_into_the_dialog_on_the_least_destructive_button", async () => {
    const { open } = setup();
    const dialog = await open();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("tab_wraps_inside_the_dialog_in_both_directions", async () => {
    const { open } = setup();
    const dialog = await open();
    const cta = within(dialog).getByRole("button", { name: "Approve and sign" });
    cta.focus();
    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("button", { name: "Open approval" })).not.toHaveFocus();
    // from the first focusable, Shift+Tab goes to the last
    const first = dialog.querySelector<HTMLElement>("a[href], button:not([disabled])")!;
    first.focus();
    await userEvent.tab({ shift: true });
    expect(cta).toHaveFocus();
    await userEvent.tab();
    expect(first).toHaveFocus();
  });

  it("focus_returns_to_the_trigger_when_the_dialog_closes", async () => {
    const { open } = setup();
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Open approval" })).toHaveFocus();
  });

  it("focus_stays_in_the_dialog_while_waiting", async () => {
    const { open } = setup();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(document.body);
    await userEvent.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });

  it("focus_stays_in_the_dialog_with_a_real_wallet_where_waiting_has_no_buttons", async () => {
    const { open } = setup({ mode: "wallet" });
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("ApprovalDialog (390px, C-Mobile)", () => {
  beforeEach(() => {
    mockViewport(true);
  });

  it("joinDao_shows_every_line_of_the_phone_sheet", async () => {
    const { open } = setup();
    const dialog = await open();
    const d = within(dialog);
    expect(dialog).toHaveAccessibleName("Let Atlas‑7 join Northwind Studio?");
    expect(d.getByText("Testnet")).toBeInTheDocument();
    expect(d.getByText("Free to join. Your agent does the work; payments land in your wallet.")).toBeInTheDocument();
    expect(d.getByText("If a customer pays")).toBeInTheDocument();
    expect(d.getByText("1.00 ETH")).toBeInTheDocument();
    expect(d.getByText("0.92 ETH")).toBeInTheDocument();
    expect(d.getByText("shared equally by members' owners, ready after 7 days")).toBeInTheDocument();
    expect(d.getByRole("img", { name: /5%.*3%/ })).toBeInTheDocument();
    expect(d.getByText("Fee 5% · 0.05")).toBeInTheDocument();
    expect(d.getByText("Expenses 3% · 0.03")).toBeInTheDocument();
    expect(d.getByText("Treasury")).toBeInTheDocument();
    expect(d.getByRole("link", { name: "Commonwealth rulebook ↗" })).toHaveAttribute("href", `/treasury/?a=${commonwealth.address}`);
    expect(d.getByText("You sign")).toBeInTheDocument();
    expect(d.getByText("0x61f0…aa32 ↗")).toBeInTheDocument();
    expect(d.getByText("From wallet")).toBeInTheDocument();
    expect(d.getByText("0x91c4…a4F2")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Approve and sign" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    // the C-09 layout is not shown as well
    expect(d.queryByText("What will happen")).toBeNull();
    expect(d.queryByText("Network fee shown in your wallet")).toBeNull();
  });

  it("the_sheet_close_button_is_labelled_and_44px", async () => {
    const { open } = setup();
    const dialog = await open();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
    const css = fs.readFileSync(path.resolve(__dirname, "../../src/components/shell/ApprovalDialog.module.css"), "utf8");
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(",").some((s) => s.trim() === ".sheetClose")).map((m) => m[2]).join("\n");
    expect(rule).toMatch(/width:\s*var\(--size-target\)/);
    expect(rule).toMatch(/height:\s*var\(--size-target\)/);
  });

  it("close_and_not_now_both_dismiss", async () => {
    const { open } = setup();
    let dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("approve_and_sign_moves_the_sheet_to_waiting", async () => {
    const { open, execute } = setup();
    const dialog = await open();
    await userEvent.dblClick(within(dialog).getByRole("button", { name: "Approve and sign" }));
    const d = within(screen.getByRole("dialog"));
    expect(d.getByText("Waiting for your wallet")).toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });

  it("other_actions_show_the_c09_text_inside_the_sheet", async () => {
    const { open } = setup({ request: spendReq, view: spendView });
    const dialog = await open();
    const d = within(dialog);
    expect(dialog).toHaveAccessibleName("Send 1.250 ETH from Commonwealth");
    expect(d.getByText("What will happen")).toBeInTheDocument();
    expect(d.getByText("Balance 23.408 → 22.158 ETH")).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Sign spend" })).toBeInTheDocument();
  });

  it("keeps_focus_in_the_sheet_and_returns_it_to_the_trigger_on_escape", async () => {
    const { open } = setup();
    const dialog = await open();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Open approval" })).toHaveFocus();
  });
});
