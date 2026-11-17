import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/shell/AppShell";
import { ConnectPrompt } from "@/components/shell/ConnectPrompt";
import { MobileHeader } from "@/components/shell/MobileHeader";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { RouteShell, routeFor } from "@/components/shell/RouteShell";
import { Empty, ErrorState, Loading } from "@/components/shell/StateViews";
import { NARROW_QUERY, useIsNarrow } from "@/components/shell/useIsNarrow";
import { PERSONAS } from "@/data/mock/fixtures";
import { mockViewport, removeViewportMock, walletPort, WithWallet } from "../helpers/shell";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const SHELL = path.resolve(__dirname, "../../src/components/shell");
const cssOf = (name: string) => fs.readFileSync(path.join(SHELL, `${name}.module.css`), "utf8");
/** Declarations of every rule whose selector list names `selector`. */
const rulesFor = (css: string, selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(",").some((s) => s.trim() === selector)).map((m) => m[2]!).join("\n");

afterEach(removeViewportMock);

describe("AppShell (wide)", () => {
  beforeEach(() => {
    mockViewport(false);
  });

  it("app_variant_shows_the_four_nav_links_with_the_current_one_marked", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="app" current="treasuries">
          <p>content</p>
        </AppShell>
      </WithWallet>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Treasuries", "DAOs", "My agents", "My earnings"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/treasuries/", "/daos/", "/agents/", "/earnings/"]);
    expect(links.filter((a) => a.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: "Treasuries" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("marks_no_link_when_no_section_is_current", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="app">x</AppShell>
      </WithWallet>,
    );
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("shows_the_testnet_badge_and_the_connected_wallet_chip", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="app" current="daos">x</AppShell>
      </WithWallet>,
    );
    expect(screen.getByText("Testnet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0x91c4…a4F2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
  });

  it("shows_the_founder_address_for_the_founder_persona", () => {
    render(
      <WithWallet wallet={walletPort({ address: PERSONAS.founder })}>
        <AppShell variant="app">x</AppShell>
      </WithWallet>,
    );
    expect(screen.getByRole("button", { name: "0x3b02…7E21" })).toBeInTheDocument();
  });

  it("offers_connect_wallet_when_disconnected", async () => {
    const wallet = walletPort({ address: null });
    render(
      <WithWallet wallet={wallet}>
        <AppShell variant="app">x</AppShell>
      </WithWallet>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(wallet.connect).toHaveBeenCalledTimes(1);
  });

  it("landing_variant_has_no_nav_and_a_connect_wallet_link_to_treasuries", async () => {
    const wallet = walletPort({ address: null });
    render(
      <WithWallet wallet={wallet}>
        <AppShell variant="landing">x</AppShell>
      </WithWallet>,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("Testnet")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Connect wallet" });
    expect(link).toHaveAttribute("href", "/treasuries/");
    await userEvent.click(link);
    expect(wallet.connect).toHaveBeenCalledTimes(1);
  });

  it("landing_variant_shows_the_chip_once_connected", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="landing">x</AppShell>
      </WithWallet>,
    );
    expect(screen.getByRole("button", { name: "0x91c4…a4F2" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect wallet" })).toBeNull();
  });

  it("the_logo_links_to_the_landing_page", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="app">x</AppShell>
      </WithWallet>,
    );
    expect(screen.getByRole("link", { name: "daoliberal" })).toHaveAttribute("href", "/");
  });
});

describe("AppShell (390px)", () => {
  beforeEach(() => {
    mockViewport(true);
  });

  it("draws_the_mobile_header_and_tab_bar_instead_of_the_desktop_nav", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="app" current="treasuries">
          <p>content</p>
        </AppShell>
      </WithWallet>,
    );
    const navs = screen.getAllByRole("navigation");
    expect(navs).toHaveLength(1);
    const tabs = within(navs[0]!).getAllByRole("link");
    expect(tabs.map((a) => a.textContent)).toEqual(["Treasuries", "DAOs", "Agents", "Earnings"]);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(tabs.slice(1).every((a) => !a.hasAttribute("aria-current"))).toBe(true);
    expect(screen.queryByText("My agents")).toBeNull();
    expect(screen.queryByText("My earnings")).toBeNull();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("the_wallet_button_is_labelled_with_the_short_address", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="app" current="treasuries">x</AppShell>
      </WithWallet>,
    );
    expect(screen.getByRole("button", { name: "Wallet 0x91c4…a4F2" })).toBeInTheDocument();
    expect(screen.getByText("Testnet")).toBeInTheDocument();
  });

  it("a_disconnected_visitor_gets_a_connect_wallet_button_in_the_header", async () => {
    const wallet = walletPort({ address: null });
    render(
      <WithWallet wallet={wallet}>
        <AppShell variant="app" current="treasuries">x</AppShell>
      </WithWallet>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(wallet.connect).toHaveBeenCalledTimes(1);
  });

  it("detail_routes_get_the_back_header", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <AppShell variant="app" current="treasuries" mobile={{ variant: "detail", backHref: "/treasuries/", backLabel: "Back to treasuries", title: "Treasury" }}>
          x
        </AppShell>
      </WithWallet>,
    );
    expect(screen.getByRole("link", { name: "Back to treasuries" })).toHaveAttribute("href", "/treasuries/");
    expect(screen.getByText("Treasury")).toBeInTheDocument();
    expect(screen.getByText("Testnet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Wallet/ })).toBeNull();
  });

  it("landing_keeps_the_landing_header_and_has_no_tab_bar", () => {
    render(
      <WithWallet wallet={walletPort({ address: null })}>
        <AppShell variant="landing">x</AppShell>
      </WithWallet>,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("link", { name: "Connect wallet" })).toBeInTheDocument();
  });
});

describe("MobileHeader / MobileTabBar", () => {
  it("root_header_has_logo_testnet_and_a_wallet_icon_button", () => {
    render(
      <WithWallet wallet={walletPort()}>
        <MobileHeader variant="root" />
      </WithWallet>,
    );
    expect(screen.getByRole("link", { name: "daoliberal" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Testnet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wallet 0x91c4…a4F2" })).toBeInTheDocument();
  });

  it("the_tab_bar_marks_the_current_tab_and_links_each_section", () => {
    render(<MobileTabBar current="agents" />);
    const tabs = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(tabs.map((a) => a.getAttribute("href"))).toEqual(["/treasuries/", "/daos/", "/agents/", "/earnings/"]);
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Treasuries" })).not.toHaveAttribute("aria-current");
  });

  it("touch_targets_are_declared_44px_and_the_tab_uses_the_tab_token", () => {
    const header = cssOf("MobileHeader");
    for (const selector of [".iconButton", ".back"]) {
      expect(rulesFor(header, selector)).toMatch(/width:\s*var\(--size-target\)/);
      expect(rulesFor(header, selector)).toMatch(/height:\s*var\(--size-target\)/);
    }
    expect(rulesFor(cssOf("MobileTabBar"), ".tab")).toMatch(/min-height:\s*var\(--size-tab\)/);
  });
});

describe("useIsNarrow", () => {
  function Probe() {
    return <p>{useIsNarrow() ? "narrow" : "wide"}</p>;
  }

  it("uses_the_single_breakpoint_query", () => {
    expect(NARROW_QUERY).toBe("(max-width: 720px)");
  });

  it("writes_layout_and_theme_when_the_viewport_is_known_and_follows_changes", () => {
    const vp = mockViewport(false);
    render(<Probe />);
    expect(vp.matchMedia).toHaveBeenCalledWith(NARROW_QUERY);
    expect(screen.getByText("wide")).toBeInTheDocument();
    expect(document.documentElement.dataset.layout).toBe("wide");
    expect(document.documentElement.dataset.theme).toBe("light");
    vp.set(true);
    expect(screen.getByText("narrow")).toBeInTheDocument();
    expect(document.documentElement.dataset.layout).toBe("narrow");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("starts_narrow_when_the_viewport_already_is", () => {
    mockViewport(true);
    render(<Probe />);
    expect(screen.getByText("narrow")).toBeInTheDocument();
    expect(document.documentElement.dataset.layout).toBe("narrow");
  });

  it("stays_wide_and_writes_nothing_without_matchMedia", () => {
    removeViewportMock();
    render(<Probe />);
    expect(screen.getByText("wide")).toBeInTheDocument();
    expect(document.documentElement.dataset.layout).toBeUndefined();
  });
});

describe("ConnectPrompt", () => {
  it("asks_the_visitor_to_connect_and_connects_on_click", async () => {
    const wallet = walletPort({ address: null });
    render(
      <WithWallet wallet={wallet}>
        <ConnectPrompt />
      </WithWallet>,
    );
    expect(screen.getByText("Connect your wallet to continue.")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(wallet.connect).toHaveBeenCalledTimes(1);
  });

  it("shows_an_optional_page_title", () => {
    render(
      <WithWallet wallet={walletPort({ address: null })}>
        <ConnectPrompt title="My agents" />
      </WithWallet>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "My agents" })).toBeInTheDocument();
  });
});

describe("StateViews", () => {
  it("loading_announces_itself", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("error_state_offers_a_retry", async () => {
    const retry = vi.fn();
    render(<ErrorState retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this page. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("empty_shows_its_message", () => {
    render(<Empty message="No agents yet." />);
    expect(screen.getByText("No agents yet.")).toBeInTheDocument();
  });
});

describe("RouteShell", () => {
  const renderAt = (p: string, wallet = walletPort()) => {
    pathname = p;
    return render(
      <WithWallet wallet={wallet}>
        <RouteShell>
          <p>page</p>
        </RouteShell>
      </WithWallet>,
    );
  };

  it("routing_table", () => {
    expect(routeFor("/")).toEqual({ variant: "landing" });
    expect(routeFor("/treasuries/")).toMatchObject({ variant: "app", current: "treasuries", mobile: { variant: "root" } });
    expect(routeFor("/treasuries/new/")).toMatchObject({ current: "treasuries", mobile: { variant: "root" } });
    expect(routeFor("/treasury/")).toMatchObject({
      current: "treasuries",
      mobile: { variant: "detail", backHref: "/treasuries/", backLabel: "Back to treasuries", title: "Treasury" },
    });
    expect(routeFor("/daos/")).toMatchObject({ current: "daos", mobile: { variant: "root" } });
    expect(routeFor("/daos/new/")).toMatchObject({ current: "daos", mobile: { variant: "root" } });
    expect(routeFor("/dao/")).toMatchObject({ current: "daos", mobile: { variant: "root" } });
    expect(routeFor("/agents/")).toMatchObject({ current: "agents" });
    expect(routeFor("/earnings/")).toMatchObject({ current: "earnings" });
  });

  it("tolerates_a_missing_trailing_slash_and_unknown_routes", () => {
    expect(routeFor("/treasuries")).toEqual(routeFor("/treasuries/"));
    expect(routeFor("/nope/")).toMatchObject({ variant: "app" });
    expect(routeFor("/nope/")).not.toHaveProperty("current");
  });

  it("wraps_the_page_in_the_shell_for_the_current_route", () => {
    mockViewport(false);
    renderAt("/earnings/");
    expect(screen.getByRole("link", { name: "My earnings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("uses_the_landing_header_at_the_root", () => {
    mockViewport(false);
    renderAt("/", walletPort({ address: null }));
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("link", { name: "Connect wallet" })).toBeInTheDocument();
  });

  it("uses_the_detail_header_on_the_treasury_route_on_a_phone", () => {
    mockViewport(true);
    renderAt("/treasury/");
    expect(screen.getByRole("link", { name: "Back to treasuries" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Treasuries" })).toHaveAttribute("aria-current", "page");
  });
});
