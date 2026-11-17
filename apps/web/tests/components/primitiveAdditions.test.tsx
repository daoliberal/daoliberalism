import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Anchor } from "@/components/primitives/Anchor";
import { Button } from "@/components/primitives/Button";
import { CheckIcon } from "@/components/primitives/icons";

const PRIMITIVES = path.resolve(__dirname, "../../src/components/primitives");
const css = (name: string) => fs.readFileSync(path.join(PRIMITIVES, name), "utf8");

describe("Anchor", () => {
  it("renders_internal_routes_as_links_with_the_route_as_href", () => {
    render(<Anchor href="/treasuries/">Treasuries</Anchor>);
    expect(screen.getByRole("link", { name: "Treasuries" })).toHaveAttribute("href", "/treasuries/");
  });

  it("keeps_query_strings", () => {
    render(<Anchor href="/treasury/?a=0x4f2a">Rulebook</Anchor>);
    expect(screen.getByRole("link", { name: "Rulebook" })).toHaveAttribute("href", "/treasury/?a=0x4f2a");
  });

  it("renders_other_urls_as_plain_anchors", () => {
    render(
      <>
        <Anchor href="https://example.org/x">Site</Anchor>
        <Anchor href="//evil.example/x">Protocol relative</Anchor>
      </>,
    );
    expect(screen.getByRole("link", { name: "Site" })).toHaveAttribute("href", "https://example.org/x");
    expect(screen.getByRole("link", { name: "Protocol relative" })).toHaveAttribute("href", "//evil.example/x");
  });

  it("external_links_stay_in_the_same_tab_with_rel (M5)", () => {
    render(<Anchor href="https://example.org/x">Site</Anchor>);
    const link = screen.getByRole("link", { name: "Site" });
    expect(link).not.toHaveAttribute("target");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("button_links_stay_inert_when_disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" href="/treasuries/" disabled onClick={onClick}>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole("link", { name: "Go" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("dialog-sized primitives", () => {
  it("button_dialog_size_is_52px_without_the_17px_text_of_lg", () => {
    expect(css("Button.module.css")).toMatch(/\.sz-dialog\s*\{[^}]*min-height:\s*var\(--size-52\)/s);
    expect(css("Button.module.css")).not.toMatch(/\.sz-dialog\s*\{[^}]*font-size/s);
    render(
      <Button variant="secondary" size="dialog">
        Cancel
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("sz-dialog");
  });

  it("check_icon_has_a_24px_size", () => {
    expect(css("icons.module.css")).toMatch(/\.size24\s*\{[^}]*width:\s*var\(--size-24\)/s);
    const { container } = render(<CheckIcon size="24" />);
    expect(container.querySelector("svg")).toHaveClass("size24");
  });
});
