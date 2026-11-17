import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Agents } from "@/screens/Agents";
import { decodeDataUriJson, encodeAgentMetadata, parseAgentMetadata } from "@/data/metadata";
import { DEFAULT_FIXTURES, PERSONAS } from "@/data/mock/fixtures";
import type { Agent } from "@/data/types";
import { walletPort } from "../helpers/shell";
import { renderScreen } from "../helpers/screens";

const { owner } = PERSONAS;
const [, atlas, , , juniper, , , , ox] = DEFAULT_FIXTURES.agents;
const KEY = "0x1111111111111111111111111111111111111111";

const card = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("article") as HTMLElement;
const strange = (id: bigint, name: string, over: Partial<Agent> = {}): Agent => ({
  ...atlas!,
  id,
  owner,
  agentKey: `0x${id.toString(16).padStart(40, "a")}` as Agent["agentKey"],
  metadataURI: "https://x.example/a.json",
  profile: { name },
  ...over,
});

async function openRegister() {
  await userEvent.click(await screen.findByRole("button", { name: "Register agent" }));
}
async function approveAndConfirm(cta: string) {
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: cta }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Prototype: simulate wallet approval" }));
  await within(dialog).findByText("Confirmed on-chain");
  return dialog;
}

describe("My agents: list", () => {
  it("shows the three fixture agents with key, DAOs and registration date", async () => {
    renderScreen(<Agents />);
    expect(await screen.findAllByRole("article")).toHaveLength(3);
    expect(within(card("Atlas‑7")).getByText("key 0x5d3e…19A0")).toBeInTheDocument();
    expect(await within(card("Atlas‑7")).findByText("Works in 2 DAOs")).toBeInTheDocument();
    expect(within(card("Atlas‑7")).getByText("Registered 6 Aug 2026")).toBeInTheDocument();
    expect(await within(card("Juniper")).findByText("Works in 1 DAO")).toBeInTheDocument();
    expect(await within(card("Ox‑Relay")).findByText("Not working in any DAO yet.")).toBeInTheDocument();
    expect(within(card("Ox‑Relay")).getByRole("link", { name: "Find a DAO to join" })).toHaveAttribute("href", "/daos/");
    expect(within(card("Atlas‑7")).getByText("Transfer ownership · coming in a later phase")).toBeInTheDocument();
  });

  it("lists each DAO with its treasury and the rule summary", async () => {
    renderScreen(<Agents />);
    const c = await screen.findByRole("heading", { level: 2, name: "Atlas‑7" }).then((h) => h.closest("article") as HTMLElement);
    const link = await within(c).findByRole("link", { name: /Fieldnotes Co-op/ });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^\/dao\/\?id=2$/));
    expect(link).toHaveTextContent("under Commonwealth · 5% · 3% · 7 d · Equal");
    expect(within(c).getByRole("link", { name: /Quiet Harbor/ })).toHaveTextContent("under Lean Guild · 1% · 0% · 14 d · Equal");
  });

  it("links https metadata, keeps ipfs:// as a link-styled span with the arrow", async () => {
    renderScreen(<Agents />);
    await screen.findAllByRole("article");
    const j = within(card("Juniper")).getByRole("link", { name: "https://juniper.example/agent.json ↗" });
    expect(j).toHaveAttribute("href", "https://juniper.example/agent.json");
    const o = within(card("Ox‑Relay")).getByText("ipfs://bafy…oxrelay.json ↗");
    expect(o.tagName).toBe("SPAN");
    expect(o.closest("a")).toBeNull();
  });

  it("asks a visitor without a wallet to connect", async () => {
    renderScreen(<Agents />, { wallet: walletPort({ address: null }) });
    expect(await screen.findByText("Connect your wallet to continue.")).toBeInTheDocument();
    expect(screen.queryByRole("article")).toBeNull();
  });
});

describe("My agents: untrusted metadata", () => {
  it("renders a markup name as text", async () => {
    const { container } = renderScreen(<Agents />, {
      mock: { fixtures: { agents: [strange(20n, "<img src=x onerror=alert(1)>")] } },
    });
    expect(await screen.findByRole("heading", { level: 2, name: "<img src=x onerror=alert(1)>" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("never links a javascript: service endpoint or metadata address", async () => {
    const { container } = renderScreen(<Agents />, {
      mock: {
        fixtures: {
          agents: [
            strange(21n, "Evil", {
              metadataURI: "javascript:alert(1)",
              profile: { name: "Evil", services: [{ name: "web", endpoint: "javascript:alert(1)" }], image: "javascript:alert(2)" },
            }),
          ],
        },
      },
    });
    await screen.findByRole("heading", { level: 2, name: "Evil" });
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(/javascript:alert\(1\)/, { selector: "span" }).length).toBeGreaterThan(0);
  });

  it("links an https service endpoint through safeHref", async () => {
    renderScreen(<Agents />, {
      mock: { fixtures: { agents: [strange(22n, "Svc", { profile: { name: "Svc", services: [{ name: "web", endpoint: "https://svc.example/x" }] } })] } },
    });
    await screen.findByRole("heading", { level: 2, name: "Svc" });
    expect(screen.getByRole("link", { name: /https:\/\/svc\.example\/x/ })).toHaveAttribute("href", "https://svc.example/x");
  });

  it("falls back to Agent #id for unreadable metadata and does not crash", async () => {
    const { source, queryClient } = renderScreen(<Agents />);
    const bad = [
      "data:text/html,<b>x</b>",
      `data:application/json,${"x".repeat(20_000)}`,
      "data:application/json,{not json",
      `data:application/json,${encodeURIComponent(JSON.stringify({ description: "no name" }))}`,
    ];
    const ids: bigint[] = [];
    for (const [i, uri] of bad.entries()) {
      const r = await source.execute({ kind: "registerAgent", agentKey: `0x${(i + 1).toString().repeat(40)}` as Agent["agentKey"], metadataURI: uri }, owner);
      ids.push(r.created!.agentId!);
    }
    await queryClient.invalidateQueries();
    for (const id of ids) expect(await screen.findByRole("heading", { level: 2, name: `Agent #${id}` })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(3 + bad.length);
  });

  it("tells two agents with the same name apart by key", async () => {
    renderScreen(<Agents />, { mock: { fixtures: { agents: [strange(40n, "Twin"), strange(41n, "Twin")] } } });
    const twins = await screen.findAllByRole("heading", { level: 2, name: "Twin" });
    expect(twins).toHaveLength(2);
    const keys = twins.map((h) => (h.closest("article") as HTMLElement).textContent?.match(/key 0x[0-9a-f]{4}…[0-9a-f]{4}/i)?.[0]);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("My agents: register", () => {
  it("toggles the form with the Register agent / Close form button", async () => {
    renderScreen(<Agents />);
    expect(screen.queryByRole("heading", { name: "Register an agent" })).toBeNull();
    await openRegister();
    expect(screen.getByRole("heading", { name: "Register an agent" })).toBeInTheDocument();
    expect(screen.getByText(/Owner will be/)).toHaveTextContent("Owner will be 0x91c4…a4F2. Ownership transfer isn't available in Phase 1.");
    await userEvent.click(screen.getByRole("button", { name: "Close form" }));
    expect(screen.queryByRole("heading", { name: "Register an agent" })).toBeNull();
  });

  it("registers from a name: the card carries the name, the metadata is a data: URI", async () => {
    const { source } = renderScreen(<Agents />);
    await openRegister();
    await userEvent.type(screen.getByLabelText("Agent key address"), KEY);
    await userEvent.type(screen.getByLabelText("Name"), "Nova");
    await userEvent.type(screen.getByLabelText("Description"), "Does research.");
    await userEvent.click(screen.getByRole("button", { name: "Register and sign" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Register a new agent")).toBeInTheDocument();
    await approveAndConfirm("Register and sign");
    expect(within(dialog).getByText("Nova is registered. You can now join DAOs with it.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Nova" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Register an agent" })).toBeNull();
    const mine = await source.listAgentsOf(owner);
    const created = mine.find((a) => a.agentKey === KEY)!;
    expect(created.profile.name).toBe("Nova");
    const decoded = decodeDataUriJson(created.metadataURI);
    expect(decoded.ok && parseAgentMetadata(decoded.value)).toMatchObject({ ok: true, value: { name: "Nova", description: "Does research." } });
  });

  it("registers from a metadata URL: the id names the agent", async () => {
    const { source } = renderScreen(<Agents />);
    await openRegister();
    await userEvent.type(screen.getByLabelText("Agent key address"), KEY);
    await userEvent.type(screen.getByLabelText("Metadata URL"), "https://unknown.example/a.json");
    await userEvent.click(screen.getByRole("button", { name: "Register and sign" }));
    const dialog = await (async () => {
      await approveAndConfirm("Register and sign");
      return screen.getByRole("dialog");
    })();
    expect(within(dialog).getByText("Agent #10 is registered. You can now join DAOs with it.")).toBeInTheDocument();
    const created = (await source.listAgentsOf(owner)).find((a) => a.agentKey === KEY)!;
    expect(created.metadataURI).toBe("https://unknown.example/a.json");
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Agent #10" })).toBeInTheDocument();
  });

  it("needs a name or a metadata address", async () => {
    renderScreen(<Agents />);
    await openRegister();
    const submit = screen.getByRole("button", { name: "Register and sign" });
    await userEvent.type(screen.getByLabelText("Agent key address"), KEY);
    await userEvent.click(screen.getByLabelText("Name"));
    await userEvent.tab();
    expect(await screen.findByText("Enter a name or a metadata address.")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "N");
    expect(screen.queryByText("Enter a name or a metadata address.")).toBeNull();
    expect(submit).toBeEnabled();
  });

  it("rejects a malformed key", async () => {
    renderScreen(<Agents />);
    await openRegister();
    await userEvent.type(screen.getByLabelText("Agent key address"), "0x12");
    await userEvent.type(screen.getByLabelText("Name"), "N");
    expect(screen.getByText("Enter a valid 0x address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register and sign" })).toBeDisabled();
  });

  it("limits name and description and accepts only https:// or ipfs:// addresses", async () => {
    renderScreen(<Agents />);
    await openRegister();
    await userEvent.type(screen.getByLabelText("Agent key address"), KEY);
    await userEvent.type(screen.getByLabelText("Name"), "x".repeat(81));
    expect(screen.getByText("Use 80 characters or fewer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register and sign" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Metadata URL"), "http://plain.example/a.json");
    expect(screen.getByText("Use an https:// or ipfs:// address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register and sign" })).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Metadata URL"));
    await userEvent.type(screen.getByLabelText("Metadata URL"), "ipfs://bafyabc");
    expect(screen.getByRole("button", { name: "Register and sign" })).toBeEnabled();
  });

  it("sends the key and metadata of the form in the registerAgent request", async () => {
    const { source } = renderScreen(<Agents />);
    const seen: unknown[] = [];
    const real = source.execute.bind(source);
    source.execute = (r, s) => (seen.push(r), real(r, s));
    await openRegister();
    await userEvent.type(screen.getByLabelText("Agent key address"), KEY);
    await userEvent.type(screen.getByLabelText("Metadata URL"), "ipfs://bafyabc");
    await userEvent.click(screen.getByRole("button", { name: "Register and sign" }));
    await approveAndConfirm("Register and sign");
    expect(seen).toEqual([{ kind: "registerAgent", agentKey: KEY, metadataURI: "ipfs://bafyabc" }]);
  });
});

describe("My agents: edit", () => {
  async function openEdit(name: string) {
    await screen.findAllByRole("article");
    await userEvent.click(within(card(name)).getByRole("button", { name: "Edit key or metadata" }));
    return card(name);
  }

  it("uses per-agent ids and prefills the current values", async () => {
    renderScreen(<Agents />);
    const c = await openEdit("Juniper");
    expect(c.querySelector(`#e-key-${juniper!.id}`)).toHaveValue(juniper!.agentKey);
    expect(c.querySelector(`#e-meta-${juniper!.id}`)).toHaveValue("https://juniper.example/agent.json");
    expect(within(c).getByLabelText("Name")).toHaveValue("Juniper");
    expect(within(c).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Save and sign" })).toBeDisabled();
  });

  it("changes only the key: the other fields lock and only agentKey is sent", async () => {
    const { source } = renderScreen(<Agents />);
    const seen: unknown[] = [];
    const real = source.execute.bind(source);
    source.execute = (r, s) => (seen.push(r), real(r, s));
    const c = await openEdit("Juniper");
    await userEvent.clear(c.querySelector(`#e-key-${juniper!.id}`)!);
    await userEvent.type(c.querySelector(`#e-key-${juniper!.id}`)!, KEY);
    expect(c.querySelector(`#e-meta-${juniper!.id}`)).toBeDisabled();
    expect(within(c).getByLabelText("Name")).toBeDisabled();
    expect(within(c).getByLabelText("Description")).toBeDisabled();
    await userEvent.click(within(c).getByRole("button", { name: "Save and sign" }));
    await approveAndConfirm("Update and sign");
    expect(seen).toEqual([{ kind: "updateAgent", agentId: juniper!.id, agentKey: KEY }]);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText("key 0x1111…1111")).toBeInTheDocument());
  });

  it("changes name and description into a new data: URI and nothing else", async () => {
    const { source } = renderScreen(<Agents />);
    const c = await openEdit("Atlas‑7");
    await userEvent.clear(within(c).getByLabelText("Name"));
    await userEvent.type(within(c).getByLabelText("Name"), "Atlas Prime");
    expect(c.querySelector(`#e-key-${atlas!.id}`)).toBeDisabled();
    expect(c.querySelector(`#e-meta-${atlas!.id}`)).toBeDisabled();
    await userEvent.click(within(c).getByRole("button", { name: "Save and sign" }));
    await approveAndConfirm("Update and sign");
    const a = (await source.listAgentsOf(owner)).find((x) => x.id === atlas!.id)!;
    expect(a.agentKey).toBe(atlas!.agentKey);
    expect(a.metadataURI.startsWith("data:application/json;base64,")).toBe(true);
    expect(a.profile.name).toBe("Atlas Prime");
  });

  it("keeps services, image, trust and flags of a data: profile when only name and description change (I2)", async () => {
    const full = {
      name: "Svc",
      description: "old",
      image: "https://img.example/a.png",
      services: [{ name: "web", endpoint: "https://svc.example/x", version: "1" }],
      supportedTrust: ["reputation"],
      x402Support: true,
      active: false,
      registrations: [{ agentId: 7 }],
    };
    const uri = encodeAgentMetadata(full);
    const parsed = parseAgentMetadata((decodeDataUriJson(uri) as { ok: true; value: unknown }).value);
    if (!parsed.ok) throw new Error("fixture profile");
    const { source } = renderScreen(<Agents />, {
      mock: { fixtures: { agents: [strange(50n, "Svc", { metadataURI: uri, profile: parsed.value })] } },
    });
    const c = await openEdit("Svc");
    expect(within(c).queryByText(/stores the profile on-chain/)).toBeNull();
    await userEvent.clear(within(c).getByLabelText("Name"));
    await userEvent.type(within(c).getByLabelText("Name"), "Svc Prime");
    expect(within(c).queryByText(/stores the profile on-chain/)).toBeNull();
    await userEvent.click(within(c).getByRole("button", { name: "Save and sign" }));
    await approveAndConfirm("Update and sign");
    const a = (await source.listAgentsOf(owner)).find((x) => x.id === 50n)!;
    expect(a.profile).toMatchObject({ ...full, name: "Svc Prime" });
  });

  it("says a URL profile is replaced by a data: profile when name or description is edited (I2)", async () => {
    const { source } = renderScreen(<Agents />);
    const c = await openEdit("Juniper");
    const note = "Saving stores the profile on-chain in place of your metadata address.";
    expect(within(c).queryByText(note)).toBeNull();
    await userEvent.type(within(c).getByLabelText("Description"), "Handles invoices.");
    expect(within(c).getByText(note)).toBeInTheDocument();
    await userEvent.click(within(c).getByRole("button", { name: "Save and sign" }));
    await approveAndConfirm("Update and sign");
    const a = (await source.listAgentsOf(owner)).find((x) => x.id === juniper!.id)!;
    expect(a.metadataURI.startsWith("data:application/json;base64,")).toBe(true);
    expect(a.profile).toMatchObject({ name: "Juniper", description: "Handles invoices.", active: true });
  });

  it("blocks saving when the merged profile would not fit a data: URI", async () => {
    const services = Array.from({ length: 32 }, (_, i) => ({ name: `svc${i}`, endpoint: `https://e.example/${"x".repeat(180)}` }));
    renderScreen(<Agents />, {
      mock: { fixtures: { agents: [strange(51n, "Big", { profile: { name: "Big", services } })] } },
    });
    const c = await openEdit("Big");
    await userEvent.type(within(c).getByLabelText("Name"), "!");
    expect(within(c).getByText("This profile is too large to update here.")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Save and sign" })).toBeDisabled();
  });

  it("changes only the metadata URL", async () => {
    const { source } = renderScreen(<Agents />);
    const c = await openEdit("Ox‑Relay");
    const meta = c.querySelector(`#e-meta-${ox!.id}`) as HTMLInputElement;
    await userEvent.clear(meta);
    await userEvent.type(meta, "https://new.example/a.json");
    expect(c.querySelector(`#e-key-${ox!.id}`)).toBeDisabled();
    expect(within(c).getByLabelText("Name")).toBeDisabled();
    await userEvent.click(within(c).getByRole("button", { name: "Save and sign" }));
    await approveAndConfirm("Update and sign");
    const a = (await source.listAgentsOf(owner)).find((x) => x.id === ox!.id)!;
    expect(a.metadataURI).toBe("https://new.example/a.json");
    expect(a.agentKey).toBe(ox!.agentKey);
  });

  it("cannot send two changes at once: restoring the first value unlocks the others", async () => {
    renderScreen(<Agents />);
    const c = await openEdit("Juniper");
    const key = c.querySelector(`#e-key-${juniper!.id}`) as HTMLInputElement;
    await userEvent.type(key, "0");
    expect(within(c).getByLabelText("Name")).toBeDisabled();
    await userEvent.type(key, "{Backspace}");
    expect(within(c).getByLabelText("Name")).toBeEnabled();
    expect(within(c).getByRole("button", { name: "Save and sign" })).toBeDisabled();
  });

  it("validates before it allows saving", async () => {
    renderScreen(<Agents />);
    const c = await openEdit("Juniper");
    await userEvent.type(c.querySelector(`#e-key-${juniper!.id}`)!, "z");
    expect(within(c).getByText("Enter a valid 0x address.")).toBeInTheDocument();
    expect(within(c).getByRole("button", { name: "Save and sign" })).toBeDisabled();
  });

  it("Close hides the form", async () => {
    renderScreen(<Agents />);
    const c = await openEdit("Juniper");
    await userEvent.click(within(c).getByRole("button", { name: "Close" }));
    expect(within(card("Juniper")).queryByRole("button", { name: "Save and sign" })).toBeNull();
  });
});
