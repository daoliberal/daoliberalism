import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeDataUriJson } from "@/data/metadata";
import { DEFAULT_FIXTURES, EDGE_FIXTURES, PERSONAS } from "@/data/mock/fixtures";
import { CreateDao } from "@/screens/CreateDao";
import { mockViewport, removeViewportMock } from "../helpers/shell";
import { renderScreen } from "../helpers/wizard";

beforeEach(() => mockViewport(false));
afterEach(removeViewportMock);

const heading = (name: string) => screen.getByRole("heading", { level: 2, name });
const cont = () => screen.getByRole("button", { name: "Continue" });
const oxRelay = DEFAULT_FIXTURES.agents.find((a) => a.profile.name === "Ox‑Relay")!;
const leanGuild = DEFAULT_FIXTURES.treasuries.find((t) => t.metadata.name === "Lean Guild")!;

async function ready() {
  const view = renderScreen(<CreateDao />);
  await screen.findByLabelText("Name");
  return view;
}

async function paste(label: string, value: string) {
  const el = screen.getByLabelText(label);
  await userEvent.clear(el);
  await userEvent.click(el);
  await userEvent.paste(value);
}

async function toConfirm() {
  await userEvent.click(cont());
  await userEvent.click(cont());
}

async function signAndApprove() {
  await userEvent.click(screen.getByRole("button", { name: "Create DAO and sign" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create and sign" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
  await within(dialog).findByText("Confirmed on-chain");
  return dialog;
}

describe("CreateDao (C-06)", () => {
  it("shows_the_connect_prompt_without_a_wallet", () => {
    renderScreen(<CreateDao />, { disconnected: true });
    expect(screen.getByText("Connect your wallet to continue.")).toBeInTheDocument();
  });

  it("starts_with_the_prototype_values_and_empty_placeholder_fields", async () => {
    await ready();
    expect(screen.getByLabelText("Name")).toHaveValue("Coral Desk");
    expect(screen.getByLabelText("What it does")).toHaveValue("Customer-support drafting for small online shops.");
    expect(screen.getByLabelText("Website (where customers pay)")).toHaveValue("");
    expect(screen.getByLabelText("Website (where customers pay)")).toHaveAttribute("placeholder", "https://");
    expect(screen.getByLabelText("Metadata URL")).toHaveValue("");
    expect(screen.getByLabelText("Metadata URL")).toHaveAttribute("placeholder", "ipfs:// or https://");
    const founder = screen.getByLabelText("Founder agent");
    expect(within(founder).getByRole("option", { name: /^Ox‑Relay · 0x0b97…e2C4$/ })).toBeInTheDocument();
    expect(founder).toHaveValue(oxRelay.id.toString());
  });

  it("rejects_a_javascript_website", async () => {
    await ready();
    await paste("Website (where customers pay)", "javascript:alert(1)");
    expect(screen.getByText("Use an http(s) address.")).toBeInTheDocument();
    await userEvent.click(cont());
    expect(heading("About the DAO")).toBeInTheDocument();
  });

  it("rejects_a_data_metadata_url", async () => {
    await ready();
    await paste("Metadata URL", "data:text/html,x");
    expect(screen.getByText("Use an https:// or ipfs:// address.")).toBeInTheDocument();
    await userEvent.click(cont());
    expect(heading("About the DAO")).toBeInTheDocument();
  });

  it("limits_name_and_description_length", async () => {
    await ready();
    await paste("Name", "n".repeat(81));
    expect(screen.getByText("Use 80 characters or fewer.")).toBeInTheDocument();
    await paste("Name", "ok");
    await paste("What it does", "d".repeat(501));
    expect(screen.getByText("Use 500 characters or fewer.")).toBeInTheDocument();
  });

  it("step_two_lists_treasuries_with_lean_guild_preselected", async () => {
    await ready();
    await userEvent.click(cont());
    expect(heading("Choose a treasury")).toBeInTheDocument();
    const lean = screen.getByRole("button", { name: /Lean Guild/ });
    expect(lean).toHaveAttribute("aria-pressed", "true");
    expect(within(lean).getByText("1% fee · 0% exp · 14-day hold · Equal")).toBeInTheDocument();
    expect(within(lean).getByText("0.99")).toBeInTheDocument();
    expect(within(lean).getByText("63")).toBeInTheDocument();
    expect(within(lean).getByText("Selected")).toBeInTheDocument();
    const mer = screen.getByRole("button", { name: /Meritline/ });
    expect(within(mer).getByText("8% fee · 4% exp · 3-day hold · Custom")).toBeInTheDocument();
    expect(within(mer).getByText("20")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compare treasuries in detail" })).toHaveAttribute("href", "/treasuries/");
  });

  it("a_treasury_with_no_seats_cannot_be_chosen", async () => {
    renderScreen(<CreateDao />, {
      mock: { fixtures: { treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.fullTreasury] } },
    });
    await screen.findByLabelText("Name");
    await userEvent.click(cont());
    const full = screen.getByRole("button", { name: /Full House/ });
    expect(full).toHaveAttribute("aria-disabled", "true");
    expect(within(full).getByText("No seats left under this treasury")).toBeInTheDocument();
    await userEvent.click(full);
    expect(full).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Lean Guild/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("a_treasury_with_few_seats_left_is_still_selectable", async () => {
    await ready();
    await userEvent.click(cont());
    const mer = screen.getByRole("button", { name: /Meritline/ });
    expect(mer).toBeEnabled();
    expect(mer).not.toHaveAttribute("aria-disabled");
    await userEvent.click(mer);
    expect(mer).toHaveAttribute("aria-pressed", "true");
  });

  it("confirm_step_names_the_dao_the_agent_and_the_treasury", async () => {
    await ready();
    await toConfirm();
    expect(heading("Confirm Coral Desk under Lean Guild")).toBeInTheDocument();
    expect(screen.getByText("Ox‑Relay", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("1% fee · 0% exp · 14-day hold · Equal", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("This choice is final in Phase 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create DAO and sign" })).toBeDisabled();
  });

  it("creates_the_dao_with_a_data_uri_without_website_when_website_is_empty", async () => {
    const { execute } = await ready();
    await toConfirm();
    await userEvent.click(screen.getByRole("checkbox", { name: /I understand Coral Desk stays under Lean Guild/ }));
    await signAndApprove();
    expect(execute).toHaveBeenCalledTimes(1);
    const [request, signer] = execute.mock.calls[0]!;
    expect(signer).toBe(PERSONAS.owner);
    if (request.kind !== "createDao") throw new Error("wrong kind");
    expect(request.founderAgentId).toBe(oxRelay.id);
    expect(request.treasury).toBe(leanGuild.address);
    const json = decodeDataUriJson(request.metadataURI);
    expect(json).toEqual({
      ok: true,
      value: { name: "Coral Desk", description: "Customer-support drafting for small online shops." },
    });
  });

  it("puts_a_filled_website_into_the_metadata_json", async () => {
    const { execute } = await ready();
    await paste("Website (where customers pay)", "https://coral.example");
    await toConfirm();
    await userEvent.click(screen.getByRole("checkbox"));
    await signAndApprove();
    const request = execute.mock.calls[0]![0];
    if (request.kind !== "createDao") throw new Error("wrong kind");
    expect(decodeDataUriJson(request.metadataURI)).toMatchObject({ ok: true, value: { website: "https://coral.example" } });
  });

  it("uses_the_metadata_url_as_is_when_filled", async () => {
    const { execute } = await ready();
    await paste("Metadata URL", "ipfs://bafy-coral");
    await toConfirm();
    await userEvent.click(screen.getByRole("checkbox"));
    const dialog = await signAndApprove();
    const request = execute.mock.calls[0]![0];
    if (request.kind !== "createDao") throw new Error("wrong kind");
    expect(request.metadataURI).toBe("ipfs://bafy-coral");
    // the approval names the DAO from the form (the URL cannot be read), and the data layer falls back to DAO #<id>
    expect(within(dialog).getByText("Coral Desk is live under Lean Guild.")).toBeInTheDocument();
  });

  it("approval_shows_the_dao_factory", async () => {
    await ready();
    await toConfirm();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Create DAO and sign" }));
    expect(within(screen.getByRole("dialog")).getByText(/DAO factory · 0x2b51…d7e0/)).toBeInTheDocument();
  });

  it("changing_the_treasury_changes_the_request", async () => {
    const { execute } = await ready();
    await userEvent.click(cont());
    await userEvent.click(screen.getByRole("button", { name: /Commonwealth/ }));
    await userEvent.click(cont());
    expect(heading("Confirm Coral Desk under Commonwealth")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    await signAndApprove();
    const request = execute.mock.calls[0]![0];
    if (request.kind !== "createDao") throw new Error("wrong kind");
    expect(request.treasury).toBe(DEFAULT_FIXTURES.treasuries[0]!.address);
  });

  it("cannot_skip_step_one_with_an_error_through_the_stepper", async () => {
    await ready();
    await paste("Website (where customers pay)", "javascript:1");
    await userEvent.click(screen.getByRole("button", { name: /Confirm and sign/ }));
    await waitFor(() => expect(heading("About the DAO")).toBeInTheDocument());
  });
});
