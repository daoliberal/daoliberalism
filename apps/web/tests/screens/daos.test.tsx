import { mockNow } from "@/data/mock/clock";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { encodeDaoMetadata } from "@/data/metadata";
import { DEFAULT_FIXTURES, EDGE_FIXTURES, PERSONAS } from "@/data/mock/fixtures";
import { createMockDataSource } from "@/data/mock/MockDataSource";
import { ActionError, isConfigurable, type Dao, type DaoMember, type Treasury } from "@/data/types";
import { DataProvider } from "@/providers/DataProvider";
import { Daos } from "@/screens/Daos";
import { DaoDetail } from "@/screens/DaoDetail";
import { walletPort, WithWallet } from "../helpers/shell";

const daoNamed = (n: string): Dao => DEFAULT_FIXTURES.daos.find((d) => d.metadata.name === n)!;
const northwind = daoNamed("Northwind Studio");
const fieldnotes = daoNamed("Fieldnotes Co-op");
const treasuryNamed = (n: string): Treasury => DEFAULT_FIXTURES.treasuries.find((t) => t.metadata.name === n)!;
const commonwealth = treasuryNamed("Commonwealth");

type Fixtures = NonNullable<Parameters<typeof createMockDataSource>[0]>["fixtures"];

function mount(ui: React.ReactNode, opts: { wallet?: "owner" | "founder" | null; fixtures?: Fixtures } = {}) {
  const source = createMockDataSource({ fixtures: opts.fixtures });
  const wallet = walletPort(opts.wallet === null ? { address: null } : { address: PERSONAS[opts.wallet ?? "owner"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <DataProvider now={mockNow} source={source} queryClient={queryClient}>
      <WithWallet wallet={wallet}>{ui}</WithWallet>
    </DataProvider>,
  );
  return { source, wallet, ...view };
}

const member = (agentId: bigint, name: string, isFounder = false): DaoMember => ({
  agentId,
  name,
  agentKey: PERSONAS.owner,
  owner: PERSONAS.owner,
  joinedAt: 1_790_000_000n,
  isFounder,
});

function edgeDao(id: bigint, name: string, treasury: Treasury, website?: string): Dao {
  const metadata = website ? { name, description: "Edge DAO.", website } : { name, description: "Edge DAO." };
  return {
    ...EDGE_FIXTURES.fullTreasuryDao,
    id,
    address: northwind.address,
    metadataURI: encodeDaoMetadata(metadata),
    metadata,
    treasury: treasury.address,
    founderAgentId: 1n,
    memberCount: 1,
  };
}

function withEdge(daos: Dao[], treasuries: Treasury[]): Fixtures {
  return {
    treasuries: [...DEFAULT_FIXTURES.treasuries, ...treasuries],
    daos: [...DEFAULT_FIXTURES.daos, ...daos],
    members: { ...DEFAULT_FIXTURES.members, ...Object.fromEntries(daos.map((d) => [d.id.toString(), [member(1n, "Quill‑2", true)]])) },
  };
}

const NAMES = ["Brightwater Research", "Fieldnotes Co-op", "Ledgerline Labs", "Northwind Studio", "Paper Lantern Translation", "Quiet Harbor", "Sparrow Data"];

describe("Daos (C-05)", () => {
  const cardNames = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

  it("lists the seven DAOs sorted by name (the data layer returns id order)", async () => {
    mount(<Daos />);
    await screen.findByText("Northwind Studio");
    expect(cardNames()).toEqual(NAMES);
  });

  it("shows the title, the lede, the Create a DAO link and the closing note", async () => {
    mount(<Daos />);
    expect(await screen.findByRole("heading", { level: 1, name: "DAOs" })).toBeVisible();
    expect(screen.getByText("Companies where agents work. Each one lives under a treasury, and its rules decide how members' owners get paid.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create a DAO" })).toHaveAttribute("href", "/daos/new/");
    expect(screen.getByText("Customers don't pay here; each DAO links to its own website where it takes orders.")).toBeVisible();
  });

  it("each card shows description, treasury with its rules, members, volume and View", async () => {
    mount(<Daos />);
    const northwindCard = (await screen.findByRole("link", { name: "Northwind Studio" })).closest("article")!;
    const card = within(northwindCard);
    expect(card.getByText("Product and brand copy, drafted and reviewed by agents.")).toBeVisible();
    expect(card.getByText("Commonwealth")).toBeVisible();
    expect(card.getByText("5% fee · 3% exp · 7-day hold · Equal")).toBeVisible();
    expect(card.getByText("Members").nextSibling).toHaveTextContent("6");
    expect(card.getByText("Volume").nextSibling).toHaveTextContent("96.40 ETH");
    expect(card.getByRole("link", { name: "View" })).toHaveAttribute("href", "/dao/?id=1");
    expect(card.getByRole("link", { name: "Northwind Studio" })).toHaveAttribute("href", "/dao/?id=1");
  });

  it("the rule summary comes from the treasury config: a custom split reads Custom", async () => {
    mount(<Daos />);
    const card = (await screen.findByRole("link", { name: "Ledgerline Labs" })).closest("article")!;
    expect(within(card).getByText("8% fee · 4% exp · 3-day hold · Custom")).toBeVisible();
    expect(within(card).getByText("Volume").nextSibling).toHaveTextContent("310.75 ETH");
  });

  it("the treasury selector lists All plus the four treasuries, and filters", async () => {
    const user = userEvent.setup();
    mount(<Daos />);
    await screen.findByText("Quiet Harbor");
    const select = screen.getByLabelText("Treasury");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["All treasuries", "Commonwealth", "Lean Guild", "Meritline", "Open Field"]);
    await user.selectOptions(select, "Lean Guild");
    expect(cardNames()).toEqual(["Quiet Harbor"]);
    await user.selectOptions(select, "All treasuries");
    expect(cardNames()).toEqual(NAMES);
  });

  it("search matches name or description, ignoring case", async () => {
    const user = userEvent.setup();
    mount(<Daos />);
    await screen.findByText("Quiet Harbor");
    const search = screen.getByLabelText("Search");
    expect(search).toHaveAttribute("placeholder", "Name or what it does");
    await user.type(search, "TRANSCRIPTION");
    expect(cardNames()).toEqual(["Fieldnotes Co-op"]);
    await user.clear(search);
    await user.type(search, "sparrow");
    expect(cardNames()).toEqual(["Sparrow Data"]);
  });

  it("search and treasury combine; no match shows the empty message", async () => {
    const user = userEvent.setup();
    mount(<Daos />);
    await screen.findByText("Quiet Harbor");
    await user.selectOptions(screen.getByLabelText("Treasury"), "Lean Guild");
    await user.type(screen.getByLabelText("Search"), "transcription");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No DAOs match.")).toBeVisible();
  });

  it("hold periods use thousands separators and a DAO name is only ever text", async () => {
    const hostile = edgeDao(901n, "<script>x</script>", EDGE_FIXTURES.hugeHold);
    mount(<Daos />, { fixtures: withEdge([hostile], [EDGE_FIXTURES.hugeHold]) });
    const card = (await screen.findByText("<script>x</script>")).closest("article")!;
    expect(card.querySelector("script")).toBeNull();
    expect(within(card).getByText(/49,710-day hold/)).toBeVisible();
  });

  it("shows a retryable error when the data fails to load", async () => {
    const source = createMockDataSource();
    vi.spyOn(source, "listDaos").mockRejectedValue(new Error("boom"));
    render(
      <DataProvider now={mockNow} source={source} queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WithWallet wallet={walletPort()}>
          <Daos />
        </WithWallet>
      </DataProvider>,
    );
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  });
});

describe("DaoDetail (C-05b)", () => {
  const dd = (term: string) => screen.getByText(term, { selector: "dt" }).nextElementSibling as HTMLElement;

  it("header: name, description and the facts list", async () => {
    mount(<DaoDetail id={northwind.id} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Northwind Studio" })).toBeVisible();
    expect(screen.getByText("Product and brand copy, drafted and reviewed by agents.")).toBeVisible();
    expect(dd("DAO contract")).toHaveTextContent("0x61f0…aa32 ↗");
    await waitFor(() => expect(dd("Founder agent")).toHaveTextContent("Quill‑2"));
    expect(dd("Founded")).toHaveTextContent("9 Aug 2026");
    expect(dd("Volume")).toHaveTextContent("96.40 ETH");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("DAOs / Northwind Studio");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "DAOs" })).toHaveAttribute("href", "/daos/");
  });

  it("an https website is a link showing the host", async () => {
    mount(<DaoDetail id={northwind.id} />);
    await screen.findByRole("heading", { level: 1 });
    const link = within(dd("Website")).getByRole("link");
    expect(link).toHaveAttribute("href", "https://northwind-studio.example/");
    expect(link).toHaveTextContent("northwind-studio.example ↗");
  });

  it("a DAO without a website has no Website row", async () => {
    mount(<DaoDetail id={fieldnotes.id} />);
    await screen.findByRole("heading", { level: 1, name: "Fieldnotes Co-op" });
    expect(screen.queryByText("Website", { selector: "dt" })).toBeNull();
  });

  it("a javascript: website is plain text, never a link", async () => {
    const evil = edgeDao(902n, "Evil Site", commonwealth, "javascript:alert(1)");
    mount(<DaoDetail id={902n} />, { fixtures: withEdge([evil], []) });
    await screen.findByRole("heading", { level: 1, name: "Evil Site" });
    expect(dd("Website")).toHaveTextContent("javascript:alert(1)");
    expect(within(dd("Website")).queryByRole("link")).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("a hostile DAO name renders as text and a huge hold is grouped, with the treasury address beside its name", async () => {
    const hostile = edgeDao(903n, "<script>x</script>", EDGE_FIXTURES.hugeHold);
    mount(<DaoDetail id={903n} />, { fixtures: withEdge([hostile], [EDGE_FIXTURES.hugeHold]) });
    expect(await screen.findByRole("heading", { level: 1, name: "<script>x</script>" })).toBeVisible();
    expect(document.querySelector("main script, h1 script")).toBeNull();
    const works = await screen.findByRole("region", { name: /Works under/ });
    expect(within(works).getByText("49,710 days")).toBeVisible();
    expect(within(works).getByText("0xb1c6…4e10")).toBeVisible();
  });

  it("Works under: treasury link, address, the five rules and the per-order line for the current members", async () => {
    mount(<DaoDetail id={northwind.id} />);
    const works = await screen.findByRole("region", { name: /Works under/ });
    expect(within(works).getByRole("heading", { level: 2 })).toHaveTextContent("Works under Commonwealth");
    const href = `/treasury/?a=${commonwealth.address}`;
    expect(within(works).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([href, href]);
    expect(within(works).getByRole("link", { name: "Full rulebook" })).toBeVisible();
    expect(within(works).getByText("0x4f2a…91c0")).toBeVisible();
    const cell = (label: string) => within(works).getByText(label).nextElementSibling;
    expect(cell("Treasury fee")).toHaveTextContent("5%");
    expect(cell("Expenses")).toHaveTextContent("3%");
    expect(cell("Hold")).toHaveTextContent("7 days");
    expect(cell("Split")).toHaveTextContent("Equal");
    expect(cell("Seats")).toHaveTextContent("142/500");
    // the prototype's flow strip is separate spans (spacing comes from the flex gap), so compare without whitespace
    expect(works.textContent?.replace(/\s+/g, "")).toContain("Per1ETHorder:0.92to6memberowners≈0.1533each,after7days");
    expect(within(works).getByText("In Phase 1 a DAO stays under the treasury it chose at creation. Switching by member vote comes later.")).toBeVisible();
  });

  it("Members: heading with count, header row, founder tag on Quill‑2 only", async () => {
    mount(<DaoDetail id={northwind.id} />);
    const members = await screen.findByRole("region", { name: /^Members/ });
    await within(members).findByText("Wren");
    expect(within(members).getByRole("heading", { level: 2 })).toHaveTextContent("Members 6 agents");
    expect(within(members).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Agent", "Agent key", "Owner wallet", "Joined"]);
    const rows = within(members).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveTextContent("Quill‑2 founder");
    expect(rows[0]).toHaveTextContent("0x88a1…4c10");
    expect(rows[0]).toHaveTextContent("0x3b02…7E21 ↗");
    expect(rows[0]).toHaveTextContent("9 Aug 2026");
    expect(within(members).getAllByText("founder")).toHaveLength(1);
  });

  it("an id that does not exist shows a not-found message", async () => {
    mount(<DaoDetail id={999n} />);
    expect(await screen.findByText("DAO not found.")).toBeVisible();
  });

  it("without an id it shows the not-found message too", async () => {
    mount(<DaoDetail />);
    expect(await screen.findByText("DAO not found.")).toBeVisible();
  });

  describe("Join with my agent", () => {
    const panel = () => screen.getByRole("complementary", { name: "Join with my agent" });
    const agentButtons = () => within(panel()).getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));

    it("lists my agents with their DAO counts; Atlas‑7 is selected", async () => {
      mount(<DaoDetail id={northwind.id} />);
      await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Atlas‑7/ });
      expect(within(panel()).getByText("Joining is free. You sign; the agent never touches money.")).toBeVisible();
      await waitFor(() =>
        expect(agentButtons().map((b) => b.textContent)).toEqual(["Atlas‑70x5d3e…19A0in 2 DAOs", "Juniper0xc2e8…5f01in 1 DAO", "Ox‑Relay0x0b97…e2C4not in a DAO yet"]),
      );
      expect(agentButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    });

    it("shows what joining does for the selected agent", async () => {
      mount(<DaoDetail id={northwind.id} />);
      await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Atlas‑7/ });
      const box = panel();
      expect(box).toHaveTextContent("After joining, Northwind Studio has 7 members.");
      expect(box).toHaveTextContent("Per 1 ETH order, each owner gets ≈ 0.1314 ETH, claimable after 7 days.");
      expect(box).toHaveTextContent("Uses 1 Commonwealth seat (358 open).");
      expect(within(box).getByRole("button", { name: "Review and sign" })).toBeEnabled();
    });

    it("picking another agent moves the selection", async () => {
      const user = userEvent.setup();
      mount(<DaoDetail id={northwind.id} />);
      await user.click(await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Juniper/ }));
      expect(agentButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    });

    it("signs the join for the picked agent and the DAO updates when it is confirmed", async () => {
      const user = userEvent.setup();
      const { source } = mount(<DaoDetail id={northwind.id} />);
      const execute = vi.spyOn(source, "execute");
      await user.click(await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Juniper/ }));
      await user.click(within(panel()).getByRole("button", { name: "Review and sign" }));
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Let Juniper join Northwind Studio");
      await user.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
      await user.click(within(dialog).getByRole("button", { name: "Prototype: simulate wallet approval" }));
      await within(dialog).findByText("Confirmed on-chain");
      expect(execute).toHaveBeenCalledWith({ kind: "joinDao", daoId: northwind.id, agentId: 5n }, PERSONAS.owner);
      await user.click(within(dialog).getByRole("button", { name: "Done" }));
      const members = screen.getByRole("region", { name: /^Members/ });
      await within(members).findByText("Juniper");
      expect(within(members).getByRole("heading", { level: 2 })).toHaveTextContent("7 agents");
      expect(within(screen.getByRole("region", { name: /Works under/ })).getByText("143/500")).toBeVisible();
    });

    it("the default pick (Atlas‑7) joins with its own id", async () => {
      const user = userEvent.setup();
      const { source } = mount(<DaoDetail id={northwind.id} />);
      const execute = vi.spyOn(source, "execute");
      await user.click(await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: "Review and sign" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
      await user.click(within(dialog).getByRole("button", { name: "Prototype: simulate wallet approval" }));
      await within(dialog).findByText("Confirmed on-chain");
      expect(execute).toHaveBeenCalledWith({ kind: "joinDao", daoId: northwind.id, agentId: 2n }, PERSONAS.owner);
      await user.click(within(dialog).getByRole("button", { name: "Done" }));
      const members = screen.getByRole("region", { name: /^Members/ });
      await within(members).findByText("Atlas‑7");
      expect(within(members).getAllByRole("row")).toHaveLength(8);
    });

    it("an agent that is already a member cannot be picked and says so; the next free agent is selected", async () => {
      mount(<DaoDetail id={fieldnotes.id} />);
      await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Atlas‑7/ });
      const atlas = agentButtons()[0]!;
      expect(atlas).toHaveAttribute("aria-disabled", "true");
      expect(atlas).toHaveAttribute("aria-pressed", "false");
      expect(atlas).toHaveTextContent("Already a member");
      expect(agentButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    });

    it("clicking a member agent does not select it", async () => {
      const user = userEvent.setup();
      mount(<DaoDetail id={fieldnotes.id} />);
      const atlas = await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Atlas‑7/ });
      await user.click(atlas);
      expect(atlas).toHaveAttribute("aria-pressed", "false");
    });

    it("when every agent is already a member Review and sign is disabled", async () => {
      const members = { ...DEFAULT_FIXTURES.members, "2": [member(2n, "Atlas‑7"), member(5n, "Juniper"), member(9n, "Ox‑Relay")] };
      mount(<DaoDetail id={fieldnotes.id} />, { fixtures: { members } });
      await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Atlas‑7/ });
      expect(within(panel()).getByRole("button", { name: "Review and sign" })).toBeDisabled();
      expect(within(panel()).getAllByText("Already a member")).toHaveLength(3);
    });

    it("a full treasury disables Review and sign and says why", async () => {
      const full = EDGE_FIXTURES.fullTreasuryDao;
      mount(<DaoDetail id={full.id} />, { fixtures: { treasuries: [...DEFAULT_FIXTURES.treasuries, EDGE_FIXTURES.fullTreasury], daos: [...DEFAULT_FIXTURES.daos, full], members: { ...DEFAULT_FIXTURES.members, "900": [member(1n, "Quill‑2", true)] } } });
      await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: /Atlas‑7/ });
      expect(within(panel()).getByRole("button", { name: "Review and sign" })).toBeDisabled();
      expect(within(panel()).getByText("No seats left under this treasury")).toBeVisible();
    });

    async function signFailing(code: "AdmissionDenied" | "MemberCapReached", message: string) {
      const user = userEvent.setup();
      const { source } = mount(<DaoDetail id={northwind.id} />);
      vi.spyOn(source, "execute").mockRejectedValue(new ActionError(code, message));
      await user.click(await within(await screen.findByRole("complementary", { name: "Join with my agent" })).findByRole("button", { name: "Review and sign" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Approve and sign" }));
      await user.click(within(dialog).getByRole("button", { name: "Prototype: simulate wallet approval" }));
      return { user, dialog };
    }

    it.each([
      ["AdmissionDenied", "No seats left under this treasury"],
      ["MemberCapReached", "This DAO is full"],
    ] as const)("a %s failure on submit shows the error view and leaves the DAO unchanged", async (code, message) => {
      const { user, dialog } = await signFailing(code, message);
      expect(await within(dialog).findByText("The action didn't go through")).toBeVisible();
      expect(within(dialog).getByText(message)).toBeVisible();
      await user.click(within(dialog).getByRole("button", { name: "Close" }));
      const members = screen.getByRole("region", { name: /^Members/ });
      expect(within(members).getByRole("heading", { level: 2 })).toHaveTextContent("6 agents");
      expect(within(screen.getByRole("region", { name: /Works under/ })).getByText("142/500")).toBeVisible();
    });

    it("without a connected wallet the panel asks to connect and offers no agents", async () => {
      const user = userEvent.setup();
      const { wallet } = mount(<DaoDetail id={northwind.id} />, { wallet: null });
      const aside = await screen.findByRole("complementary", { name: "Join with my agent" });
      expect(within(aside).getByText("Connect your wallet to continue.")).toBeVisible();
      expect(within(aside).queryByRole("button", { name: "Review and sign" })).toBeNull();
      expect(within(aside).queryAllByRole("button", { pressed: true })).toHaveLength(0);
      await user.click(within(aside).getByRole("button", { name: "Connect wallet" }));
      expect(wallet.connect).toHaveBeenCalledTimes(1);
    });

    it("a wallet with no agents sees a hint instead of an empty list", async () => {
      mount(<DaoDetail id={northwind.id} />, { wallet: "founder", fixtures: { agents: DEFAULT_FIXTURES.agents.filter((a) => a.owner !== PERSONAS.founder) } });
      const aside = await screen.findByRole("complementary", { name: "Join with my agent" });
      expect(await within(aside).findByText("No agents in this wallet yet.")).toBeVisible();
      expect(within(aside).getByRole("button", { name: "Review and sign" })).toBeDisabled();
    });
  });

  it("a DAO under a treasury whose rules cannot be read has no rule grid and no join", async () => {
    const dao = edgeDao(904n, "Mystery Co", EDGE_FIXTURES.external);
    mount(<DaoDetail id={904n} />, { fixtures: withEdge([dao], [EDGE_FIXTURES.external]) });
    await screen.findByRole("heading", { level: 1, name: "Mystery Co" });
    expect(await screen.findByRole("region", { name: /Works under/ })).not.toHaveTextContent("Treasury fee");
    const aside = screen.getByRole("complementary", { name: "Join with my agent" });
    await waitFor(() => expect(within(aside).getByRole("button", { name: "Review and sign" })).toBeDisabled());
    expect(isConfigurable(EDGE_FIXTURES.external)).toBe(false);
  });
});
