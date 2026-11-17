import fs from "node:fs";
import path from "node:path";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Badge } from "@/components/primitives/Badge";
import { Breadcrumb } from "@/components/primitives/Breadcrumb";
import { Button } from "@/components/primitives/Button";
import { Callout } from "@/components/primitives/Callout";
import { Card } from "@/components/primitives/Card";
import { DefinitionList } from "@/components/primitives/DefinitionList";
import { Field } from "@/components/primitives/Field";
import { Grid } from "@/components/primitives/Grid";
import { CheckIcon, CloseIcon, LockIcon } from "@/components/primitives/icons";
import { MoneyFlowBar } from "@/components/primitives/MoneyFlowBar";
import { Pill } from "@/components/primitives/Pill";
import { SeatMeter } from "@/components/primitives/SeatMeter";
import { Stack } from "@/components/primitives/Stack";
import { Stepper } from "@/components/primitives/Stepper";
import { Table } from "@/components/primitives/Table";

const PRIMITIVES = path.resolve(__dirname, "../../src/components/primitives");
const cssOf = (name: string) => fs.readFileSync(path.join(PRIMITIVES, `${name}.module.css`), "utf8");

describe("Button", () => {
  it("renders_a_native_button_by_default", () => {
    render(<Button variant="primary">Deploy</Button>);
    const b = screen.getByRole("button", { name: "Deploy" });
    expect(b.tagName).toBe("BUTTON");
    expect(b).toHaveAttribute("type", "button");
    expect(b).not.toHaveAttribute("aria-pressed");
  });

  it("fill_is_a_button_prop_so_callers_never_style_the_root_from_outside (M11)", () => {
    render(<Button variant="primary" fill>Fill</Button>);
    expect(screen.getByRole("button", { name: "Fill" }).className).toMatch(/fill/);
    const css = fs.readFileSync(path.join(process.cwd(), "src/components/shell/ApprovalDialog.module.css"), "utf8");
    expect(css).not.toMatch(/>\s*\*/);
  });

  it("renders_a_link_when_href_is_given", () => {
    render(<Button variant="secondary" href="/treasuries/">Browse</Button>);
    const a = screen.getByRole("link", { name: "Browse" });
    expect(a.tagName).toBe("A");
    expect(a).toHaveAttribute("href", "/treasuries/");
  });

  it("button_disabled_uses_native_disabled_and_blocks_click", async () => {
    const onClick = vi.fn();
    render(<Button variant="primary" disabled onClick={onClick}>Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("link_disabled_uses_aria_disabled_and_blocks_click", () => {
    const onClick = vi.fn();
    render(<Button variant="primary" href="/x/" disabled onClick={onClick}>Go</Button>);
    const a = screen.getByRole("link", { name: "Go" });
    expect(a).toHaveAttribute("aria-disabled", "true");
    const notPrevented = fireEvent.click(a);
    expect(notPrevented).toBe(false); // default navigation cancelled
    expect(onClick).not.toHaveBeenCalled();
  });

  it("toggle_reflects_pressed", () => {
    const { rerender } = render(<Button variant="toggle" pressed>Cards</Button>);
    expect(screen.getByRole("button", { name: "Cards" })).toHaveAttribute("aria-pressed", "true");
    rerender(<Button variant="toggle" pressed={false}>Cards</Button>);
    expect(screen.getByRole("button", { name: "Cards" })).toHaveAttribute("aria-pressed", "false");
  });

  it("enabled_button_fires_click", async () => {
    const onClick = vi.fn();
    render(<Button variant="primary" onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Pill", () => {
  it("renders_button_or_link_and_marks_the_current_nav_page", () => {
    render(
      <>
        <Pill tone="navCurrent" href="/treasuries/">Treasuries</Pill>
        <Pill tone="nav" href="/daos/">DAOs</Pill>
        <Pill tone="chip" onClick={() => {}}>Hold ≤ 7 d</Pill>
      </>,
    );
    expect(screen.getByRole("link", { name: "Treasuries" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "DAOs" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Hold ≤ 7 d" }).tagName).toBe("BUTTON");
  });
});

describe("Badge", () => {
  it("shows_text_and_an_optional_dot", () => {
    const { container, rerender } = render(<Badge tone="warn" dot>Testnet</Badge>);
    expect(screen.getByText("Testnet")).toBeInTheDocument();
    expect(container.querySelector("[data-dot]")).not.toBeNull();
    rerender(<Badge tone="fixed">Rules fixed in Phase 1</Badge>);
    expect(container.querySelector("[data-dot]")).toBeNull();
  });
});

describe("Card", () => {
  it("renders_the_requested_element", () => {
    render(
      <>
        <Card as="aside">side</Card>
        <Card as="article">art</Card>
      </>,
    );
    expect(screen.getByRole("complementary")).toHaveTextContent("side");
    expect(screen.getByRole("article")).toHaveTextContent("art");
  });
});

describe("Field", () => {
  it("label_is_bound_to_the_control", () => {
    render(<Field kind="input" id="w-name" label="Treasury name" defaultValue="Coral" />);
    const input = screen.getByLabelText("Treasury name");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveValue("Coral");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("error_sets_aria_invalid_and_an_alert", () => {
    render(<Field kind="input" id="w-fee" label="Treasury fee" error="Enter a percentage with up to 2 decimals." />);
    const input = screen.getByLabelText("Treasury fee");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a percentage with up to 2 decimals.");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("hint_is_linked_with_aria_describedby", () => {
    render(<Field kind="textarea" id="w-desc" label="Description" hint="Descriptions can't be edited." />);
    const control = screen.getByLabelText("Description");
    expect(control.tagName).toBe("TEXTAREA");
    const hint = screen.getByText("Descriptions can't be edited.");
    expect(control.getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("supports_select_and_suffix", () => {
    render(
      <>
        <Field kind="select" id="w-s" label="Sort"><option value="a">A</option></Field>
        <Field kind="input" id="w-d" label="Hold period" suffix="days" />
      </>,
    );
    expect(screen.getByLabelText("Sort").tagName).toBe("SELECT");
    expect(screen.getByText("days")).toBeInTheDocument();
  });

  it("untrusted_error_text_renders_as_text_not_html", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = render(<Field kind="input" id="w-x" label="X" error={evil} />);
    expect(screen.getByRole("alert")).toHaveTextContent(evil);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Callout", () => {
  it("is_a_note_with_title_and_body", () => {
    render(<Callout tone="caution" title="These rules cannot be changed in Phase 1">After deployment nobody can edit.</Callout>);
    const note = screen.getByRole("note");
    expect(within(note).getByText("These rules cannot be changed in Phase 1")).toBeInTheDocument();
    expect(within(note).getByText("After deployment nobody can edit.")).toBeInTheDocument();
  });
});

describe("Stack and Grid", () => {
  it("render_their_children", () => {
    render(
      <Stack gap="8" direction="row" wrap align="center" justify="between">
        <Grid minItem="200" gap="12" cols={2}><span>a</span><span>b</span></Grid>
      </Stack>,
    );
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });
});

describe("DefinitionList", () => {
  it("renders_term_detail_pairs", () => {
    const { container } = render(
      <DefinitionList columns={2} items={[{ term: "Max agents", detail: "500" }, { term: "Split rule", detail: "Equal split" }]} />,
    );
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(container.querySelectorAll("dd")).toHaveLength(2);
    expect(screen.getByText("Max agents").tagName).toBe("DT");
    expect(screen.getByText("Equal split").tagName).toBe("DD");
  });
});

describe("Table", () => {
  const header = ["Treasury", "Fee", "Hold", "Seats"];
  const rows = [["Commonwealth", "5%", "14 days", "142 / 500"], ["Lean Guild", "1%", "7 days", "30 / 100"]];

  it("has_valid_table_structure", () => {
    render(<Table columns="lead2" minWidth="md" header={header} rows={rows} caption="Compare treasuries" />);
    const table = screen.getByRole("table", { name: "Compare treasuries" });
    const groups = within(table).getAllByRole("rowgroup");
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g.parentElement).toBe(table);
    const allRows = within(table).getAllByRole("row");
    expect(allRows).toHaveLength(3);
    for (const r of allRows) expect(r.parentElement?.getAttribute("role")).toBe("rowgroup");
    const heads = within(table).getAllByRole("columnheader");
    expect(heads.map((h) => h.textContent)).toEqual(header);
    for (const h of heads) expect(h.parentElement).toBe(allRows[0]);
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(8);
    for (const c of cells) expect(allRows.slice(1)).toContain(c.parentElement);
  });

  it("scrolls_inside_its_own_container", () => {
    render(<Table columns="even4" minWidth="xl" header={header} rows={rows} caption="Scrolling" />);
    const table = screen.getByRole("table");
    expect(table.parentElement).toHaveClass("scroll");
    expect(cssOf("Table")).toMatch(/\.scroll\s*\{[^}]*overflow-x:\s*auto/);
  });
});

describe("long untrusted content", () => {
  it("wraps_inside_Card_DefinitionList_and_Table_cells", () => {
    const long = "A".repeat(80);
    const name = "N".repeat(64);
    render(
      <>
        <Card data-testid="card">{long}</Card>
        <DefinitionList items={[{ term: "Name", detail: name }]} />
        <Table columns="even4" minWidth="sm" header={["a", "b", "c", "d"]} rows={[[long, name, "x", "y"]]} caption="Long content" />
      </>,
    );
    expect(screen.getByTestId("card")).toHaveClass("wrap");
    expect(screen.getByText(name, { selector: "dd" })).toHaveClass("wrap");
    expect(screen.getAllByRole("cell")[0]).toHaveClass("wrap");
    for (const m of ["Card", "DefinitionList", "Table"]) expect(cssOf(m)).toMatch(/\.wrap\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});

describe("Stepper", () => {
  it("marks_current_and_done_steps_and_selects", async () => {
    const onSelect = vi.fn();
    render(
      <Stepper
        steps={[
          { label: "Basics", state: "done", onSelect: () => {} },
          { label: "Rules", state: "current", onSelect },
          { label: "Review", state: "todo", onSelect: () => {} },
        ]}
      />,
    );
    const current = screen.getByRole("button", { name: /Rules/ });
    expect(current).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Basics/ })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: /Basics/ })).toHaveTextContent("✓");
    expect(screen.getByRole("button", { name: /Review/ })).toHaveTextContent("3");
    await userEvent.click(current);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("Breadcrumb", () => {
  it("links_the_trail_and_marks_the_last_item", () => {
    render(<Breadcrumb trail={[{ label: "Treasuries", href: "/treasuries/" }, { label: "Commonwealth" }]} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Treasuries" })).toHaveAttribute("href", "/treasuries/");
    expect(within(nav).getByText("Commonwealth")).toHaveAttribute("aria-current", "page");
    expect(nav).toHaveTextContent("Treasuries / Commonwealth");
  });
});

describe("MoneyFlowBar", () => {
  const slices = () => Array.from(screen.getByRole("img").children) as HTMLElement[];

  it("draws_three_slices_with_generated_width_classes", () => {
    render(<MoneyFlowBar feeBps={500} expenseBps={300} label="Fee 5 percent, expenses 3 percent, members 92 percent" />);
    const bar = screen.getByRole("img", { name: "Fee 5 percent, expenses 3 percent, members 92 percent" });
    expect(bar.tagName).toBe("DIV");
    const [fee, expense, members] = slices();
    expect(bar.children).toHaveLength(3);
    for (const s of [fee, expense, members]) expect(s.tagName).toBe("DIV");
    expect(fee).toHaveClass("w10");
    expect(expense).toHaveClass("w6");
    expect(members.className).not.toMatch(/\bw\d+\b/);
  });

  it("zero_percent_slice_keeps_a_sliver_class_and_css", () => {
    render(<MoneyFlowBar feeBps={100} expenseBps={0} label="l" />);
    expect(slices()[1]).toHaveClass("w0");
    expect(cssOf("MoneyFlowBar")).toContain("min-width: var(--size-sliver)");
  });

  it("full_and_overflowing_bps_do_not_break", () => {
    const { rerender } = render(<MoneyFlowBar feeBps={5000} expenseBps={5000} label="l" />);
    expect(slices()[0]).toHaveClass("w100");
    expect(slices()[1]).toHaveClass("w100");
    rerender(<MoneyFlowBar feeBps={6000} expenseBps={6000} label="l" />);
    expect(slices()[0]).toHaveClass("w120");
    expect(slices()[1]).toHaveClass("w80");
  });

  it("size_prop_selects_the_bar_size", () => {
    const { rerender } = render(<MoneyFlowBar feeBps={0} expenseBps={0} label="l" />);
    const md = screen.getByRole("img").className;
    rerender(<MoneyFlowBar feeBps={0} expenseBps={0} label="l" size="sm" />);
    expect(screen.getByRole("img").className).not.toBe(md);
    expect(screen.getByRole("img")).toHaveClass("sm");
    expect(cssOf("MoneyFlowBar")).toMatch(/\.sm\s*\{[^}]*var\(--size-bar-sm\)/);
    expect(cssOf("MoneyFlowBar")).toMatch(/\.md\s*\{[^}]*var\(--size-bar\)/);
  });
});

describe("SeatMeter", () => {
  it("renders_a_native_meter", () => {
    render(<SeatMeter used={142} max={500} label="142 of 500 seats" />);
    const m = screen.getByRole("meter", { name: "142 of 500 seats" }) as HTMLMeterElement;
    expect(m.tagName).toBe("METER");
    expect(m.value).toBe(142);
    expect(m.max).toBe(500);
  });

  it("clamps_used_to_max", () => {
    render(<SeatMeter used={600} max={500} label="full" />);
    expect((screen.getByRole("meter") as HTMLMeterElement).value).toBe(500);
  });
});

describe("icons", () => {
  it("use_currentColor_token_sizes_and_no_raw_attributes", () => {
    const { container } = render(
      <>
        <LockIcon size="20" />
        <CheckIcon size="16" />
        <CloseIcon size="22" />
      </>,
    );
    const svgs = Array.from(container.querySelectorAll("svg"));
    expect(svgs).toHaveLength(3);
    expect(svgs[0]).toHaveClass("size20");
    expect(svgs[1]).toHaveClass("size16");
    expect(svgs[2]).toHaveClass("size22");
    for (const svg of svgs) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg.hasAttribute("width")).toBe(false);
      expect(svg.hasAttribute("height")).toBe(false);
      for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
        for (const attr of ["fill", "stroke"]) {
          const v = el.getAttribute(attr);
          if (v !== null) expect(["none", "currentColor"]).toContain(v);
        }
        expect(el.hasAttribute("width") || el.hasAttribute("height") || el.hasAttribute("stroke-width")).toBe(false);
      }
    }
  });
});

// Body of the last rule whose selector ends with `selector` (the standalone rule, not a grouped list).
const ruleOf = (css: string, selector: string) => {
  const esc = selector.replace(/[.[\]]/g, "\\$&");
  const all = [...css.matchAll(new RegExp(`(?<![\\w.-])${esc}\\s*\\{([^}]*)\\}`, "g"))];
  const m = all[all.length - 1];
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
};

describe("fix round 1: Card variants", () => {
  it("padding_radius_gap_and_tone_variants_map_to_token_classes", () => {
    render(
      <>
        <Card data-testid="a" padding="lg" radius="lg" gap="22">x</Card>
        <Card data-testid="b" padding="xl" radius="lg">x</Card>
        <Card data-testid="c" tone="emphasis" padding="md" radius="lg" gap="16">x</Card>
      </>,
    );
    expect(screen.getByTestId("a")).toHaveClass("p-lg", "r-lg", "g22");
    expect(screen.getByTestId("b")).toHaveClass("p-xl", "r-lg");
    expect(screen.getByTestId("b").className).not.toMatch(/\bg\d+\b/); // no flex gap unless asked
    expect(screen.getByTestId("c")).toHaveClass("emphasis");
    const css = cssOf("Card");
    expect(ruleOf(css, ".p-lg")).toBe("padding: var(--space-28);");
    expect(ruleOf(css, ".p-xl")).toBe("padding: var(--space-32);");
    expect(ruleOf(css, ".r-lg")).toBe("border-radius: var(--radius-24);");
    expect(ruleOf(css, ".g22")).toBe("gap: var(--space-22);");
    expect(ruleOf(css, ".emphasis")).toContain("border: var(--border-2) solid var(--color-ink)");
  });

  it("selected_is_a_white_surface_with_a_brand_border", () => {
    const rule = ruleOf(cssOf("Card"), ".selected");
    expect(rule).toContain("border-color: var(--color-brand)");
    expect(rule).not.toContain("surface-selected");
  });
});

describe("fix round 1: Button sizes", () => {
  it("size_prop_selects_height_and_padding_tokens", () => {
    render(
      <>
        <Button variant="primary" size="sm">a</Button>
        <Button variant="primary" size="wide">b</Button>
        <Button variant="brand" size="lg">c</Button>
        <Button variant="panelLight">d</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "a" })).toHaveClass("sz-sm");
    expect(screen.getByRole("button", { name: "b" })).toHaveClass("sz-wide");
    expect(screen.getByRole("button", { name: "c" })).toHaveClass("sz-lg");
    const css = cssOf("Button");
    expect(ruleOf(css, ".sz-sm")).toBe("min-height: var(--size-target); padding: 0 var(--space-18);");
    expect(ruleOf(css, ".sz-wide")).toBe("min-height: var(--size-cta-md); padding: 0 var(--space-24);");
    expect(ruleOf(css, ".sz-lg")).toBe("min-height: var(--size-52); padding: 0 var(--space-24); font-size: var(--fs-17);");
    // always-dark tray (C-02:141): only panel tokens, which tokens.css never redefines for the dark theme
    const panelLight = ruleOf(css, ".panelLight");
    expect(panelLight).toContain("background: var(--color-panel-ink)");
    expect(panelLight).toContain("color: var(--color-panel-bg)");
    expect(panelLight).not.toMatch(/--color-(surface|ink)\b/);
    expect(css).toMatch(/\.panelLight:hover:not\(:disabled\)[^{]*\{[^}]*color: var\(--color-panel-bg\)/);
  });

  it("panelLight_tokens_resolve_identically_in_light_and_dark", () => {
    const tokens = fs.readFileSync(path.resolve(__dirname, "../../src/styles/tokens.css"), "utf8");
    const dark = tokens.slice(tokens.indexOf("@media (max-width: 720px) {"));
    for (const name of ["--color-panel-ink", "--color-panel-bg"]) {
      expect(tokens).toMatch(new RegExp(`${name}:\\s*#[0-9A-Fa-f]{6}`));
      expect(dark).not.toContain(`${name}:`);
    }
  });
});

describe("fix round 1: Pill chips", () => {
  it("desktop_and_mobile_chip_tones_have_their_own_classes", () => {
    render(
      <>
        <Pill tone="chip">a</Pill>
        <Pill tone="chipOn">b</Pill>
        <Pill tone="mChip">c</Pill>
        <Pill tone="mChipOn">d</Pill>
      </>,
    );
    for (const [n, c] of [["a", "chip"], ["b", "chipOn"], ["c", "mChip"], ["d", "mChipOn"]]) {
      expect(screen.getByRole("button", { name: n })).toHaveClass(c);
    }
    const css = cssOf("Pill");
    expect(ruleOf(css, ".chip")).toContain("padding: 0 var(--space-16)");
    expect(ruleOf(css, ".chip")).toContain("background: var(--color-surface)");
    expect(ruleOf(css, ".chipOn")).toContain("background: var(--color-action)");
    expect(ruleOf(css, ".chipOn")).toContain("color: var(--color-on-action)");
    expect(ruleOf(css, ".mChipOn")).toContain("color: var(--color-on-action)");
    expect(ruleOf(css, ".mChip")).toContain("padding: 0 var(--space-14)");
  });
});

describe("fix round 1: Field typography", () => {
  it("fontSize_compact_and_large_variants", () => {
    render(
      <>
        <Field kind="input" id="f1" label="Fee" mono fontSize="18" suffix="%" />
        <Field kind="select" id="f2" label="Sort" compact><option>a</option></Field>
        <Field kind="input" id="f3" label="Amount" large mono fontSize="22" />
      </>,
    );
    expect(screen.getByLabelText("Fee")).toHaveClass("fs18", "mono");
    expect(screen.getByLabelText("Sort").parentElement).toHaveClass("compact");
    expect(screen.getByLabelText("Amount").parentElement).toHaveClass("large");
    const css = cssOf("Field");
    expect(ruleOf(css, ".fs18")).toBe("font-size: var(--fs-18);");
    expect(ruleOf(css, ".fs22")).toBe("font-size: var(--fs-22);");
    expect(ruleOf(css, ".compact")).toContain("min-height: var(--size-target)");
    expect(ruleOf(css, ".large")).toContain("gap: var(--space-8)");
    expect(css).toContain(":has(:focus-visible)");
  });

  it("select_uses_12_horizontal_padding_class", () => {
    render(<Field kind="select" id="f4" label="Agent"><option>a</option></Field>);
    expect(screen.getByLabelText("Agent").parentElement).toHaveClass("boxSelect");
    expect(ruleOf(cssOf("Field"), ".boxSelect")).toContain("--inset: var(--space-12)");
  });
});

describe("fix round 1: Callout", () => {
  it("renders_an_acknowledgement_row_after_the_body", async () => {
    const onChange = vi.fn();
    render(
      <Callout tone="caution" title="Final" action={<label><input type="checkbox" onChange={onChange} /> I understand</label>}>
        Body text
      </Callout>,
    );
    const note = screen.getByRole("note");
    expect(within(note).getByText("Body text").tagName).toBe("P");
    await userEvent.click(within(note).getByLabelText("I understand"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(within(note).getByLabelText("I understand").closest("[data-ack]")).not.toBeNull();
    const css = cssOf("Callout");
    expect(css).toContain("min-height: var(--size-target)");
    expect(css).toContain("accent-color: var(--color-caution-accent)");
  });

  it("icon_false_drops_the_head_and_inline_is_a_single_row", () => {
    const { container, rerender } = render(<Callout tone="caution" title="Final" icon={false}>Body</Callout>);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("Final")).toBeInTheDocument();
    rerender(<Callout tone="caution" layout="inline">Needs permission</Callout>);
    expect(screen.getByRole("note")).toHaveClass("inline");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Needs permission");
  });
});

describe("fix round 2", () => {
  it("callout_title_gap_only_when_icon_and_title", () => {
    const { rerender } = render(<Callout tone="caution" title="T">Body</Callout>);
    expect(screen.getByText("Body")).toHaveClass("textAfterTitle");
    rerender(<Callout tone="caution">Body</Callout>);
    expect(screen.getByText("Body")).not.toHaveClass("textAfterTitle");
    rerender(<Callout tone="caution" title="T" icon={false}>Body</Callout>);
    expect(screen.getByText("Body")).not.toHaveClass("textAfterTitle");
  });

  it("field_large_and_compact_are_mutually_exclusive_types", () => {
    // @ts-expect-error large and compact cannot be combined
    const both = <Field kind="input" id="x" label="X" large compact />;
    expect(both).toBeTruthy();
  });
});

describe("fix round 1: Badge", () => {
  it("has_only_prototype_tones_and_compact_size", () => {
    render(
      <>
        <Badge tone="warn" dot compact>Testnet</Badge>
        <Badge tone="fixed" lock>Rules fixed in Phase 1</Badge>
      </>,
    );
    expect(screen.getByText("Testnet").closest("span")).toHaveClass("compact", "warn");
    const fixed = screen.getByText("Rules fixed in Phase 1");
    expect(fixed).toHaveClass("fixed");
    expect(fixed.querySelector("svg")).not.toBeNull();
    const css = cssOf("Badge");
    expect(css).not.toContain(".neutral");
    expect(ruleOf(css, ".fixed")).toContain("border: var(--border-1) solid var(--color-line-strong)");
    expect(ruleOf(css, ".fixed")).toContain("color: var(--color-ink-5)");
    expect(ruleOf(css, ".compact")).toContain("padding: var(--space-3) var(--space-10)");
  });

  it("small_lock_icons_use_the_12_viewbox_and_thin_stroke", () => {
    const { container } = render(<><LockIcon size="11" /><LockIcon size="12" /></>);
    const svgs = Array.from(container.querySelectorAll("svg"));
    expect(svgs[0]).toHaveClass("size11");
    expect(svgs[1]).toHaveClass("size12");
    expect(svgs[0].getAttribute("viewBox")).toBe("0 0 12 12");
    expect(svgs[0]).toHaveClass("s15");
  });
});

describe("fix round 1: Table", () => {
  const header = ["Date", "To", "Amount", "Tx"];
  const rows = [["d", "to", "1.0 ETH", "0xab"], ["d2", "to2", "2.0 ETH", "0xcd"]];

  it("column_alignment_mono_density_and_selected_rows", () => {
    render(
      <Table caption="Ledger"
        columns="mid14" minWidth="md" header={header} rows={rows} frame="card" density="compact"
        align={["start", "start", "end", "end"]} mono={[false, true, true, true]} selectedRows={[1]}
      />,
    );
    const heads = screen.getAllByRole("columnheader");
    expect(heads[2]).toHaveClass("end");
    expect(heads[0]).not.toHaveClass("end");
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]).getAllByRole("cell")[3]).toHaveClass("end");
    expect(within(bodyRows[0]).getAllByRole("cell")[1]).toHaveClass("mono");
    expect(within(bodyRows[0]).getAllByRole("cell")[0]).not.toHaveClass("mono");
    expect(bodyRows[1]).toHaveClass("selected");
    expect(bodyRows[0]).not.toHaveClass("selected");
    expect(bodyRows[0]).toHaveClass("compact");
    const css = cssOf("Table");
    expect(ruleOf(css, ".card .head")).toContain("padding-block: var(--space-12)");
    expect(ruleOf(css, ".body.compact")).toContain("padding-block: var(--space-12)");
    expect(ruleOf(css, ".selected")).toContain("background: var(--color-surface-selected)");
    expect(ruleOf(css, ".mono")).toContain("font-size: var(--fs-15)");
    expect(ruleOf(css, ".end")).toContain("text-align: right");
  });
});

describe("fix round 1: Stack and Grid variants", () => {
  it("map_props_to_distinct_token_classes", () => {
    render(
      <>
        <Stack data-testid="s" gap="16" direction="row" align="center" justify="between" wrap>x</Stack>
        <Grid data-testid="g" minItem="520" gap="20">x</Grid>
        <Grid data-testid="g2" minItem="200" gap="12" cols={3}>x</Grid>
      </>,
    );
    expect(screen.getByTestId("s")).toHaveClass("row", "g16", "a-center", "j-between", "wrap");
    expect(screen.getByTestId("g")).toHaveClass("m520", "g20");
    expect(screen.getByTestId("g2")).toHaveClass("c3");
    expect(screen.getByTestId("g2").className).not.toMatch(/\bm\d+\b/);
    expect(ruleOf(cssOf("Grid"), ".m520")).toBe("grid-template-columns: repeat(auto-fit, minmax(min(var(--grid-min-520), 100%), 1fr));");
    expect(ruleOf(cssOf("Grid"), ".m200")).toContain("var(--grid-min-200)");
    expect(ruleOf(cssOf("Stack"), ".g16")).toBe("gap: var(--space-16);");
  });
});

describe("task 6b: Table scroll region", () => {
  const header = ["Treasury", "Fee"];
  const rows = [["Commonwealth", "5%"]];

  it("scroll_wrapper_is_a_named_focusable_region", () => {
    render(<Table columns="even4" minWidth="xl" header={header} rows={rows} caption="Compare treasuries" />);
    const region = screen.getByRole("region", { name: "Compare treasuries" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("scroll");
    expect(region).toContainElement(screen.getByRole("table"));
  });

  it("is_reachable_by_keyboard", async () => {
    render(<Table columns="even4" minWidth="xl" header={header} rows={rows} caption="Compare treasuries" />);
    await userEvent.tab();
    expect(screen.getByRole("region", { name: "Compare treasuries" })).toHaveFocus();
  });

  it("label_prop_names_the_region_and_wins_over_caption", () => {
    render(<Table columns="even4" minWidth="xl" header={header} rows={rows} caption="Cap" label="Members table" />);
    expect(screen.getByRole("region", { name: "Members table" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Cap" })).toBeInTheDocument();
  });

  it("label_alone_names_region_and_table", () => {
    render(<Table columns="even4" minWidth="xl" header={header} rows={rows} label="Members table" />);
    expect(screen.getByRole("region", { name: "Members table" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Members table" })).toBeInTheDocument();
  });

  it("requires_a_name_at_compile_time", () => {
    // @ts-expect-error neither label nor caption
    const el = <Table columns="even4" minWidth="xl" header={header} rows={rows} />;
    expect(el).toBeTruthy();
  });

  it("focus_ring_comes_from_tokens", () => {
    expect(ruleOf(cssOf("Table"), ".scroll:focus-visible")).toMatch(/outline:\s*var\(--border-2\) solid var\(--color-brand\)/);
  });
});

describe("task 6b: Field control fills the box", () => {
  it("control_stretches_to_the_box_height_and_covers_its_border", () => {
    const css = cssOf("Field");
    const control = /^\.control\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(control).toContain("align-self: stretch");
    expect(control).toContain("padding-inline: var(--inset)");
    expect(control).toContain("margin-block: calc(var(--bw) * -1)");
    expect(ruleOf(css, ".box")).toContain("--inset: var(--space-14)");
    expect(ruleOf(css, ".box")).toContain("--bw: var(--border-1)");
    expect(ruleOf(css, ".box")).toContain("padding: 0;");
    expect(ruleOf(css, ".large")).toContain("--bw: var(--border-2)");
    expect(ruleOf(css, ".area")).toContain("margin-block: 0");
  });

  it("suffix_keeps_the_trailing_inset", () => {
    render(<Field kind="input" id="s1" label="Fee" suffix="%" />);
    const box = screen.getByLabelText("Fee").parentElement;
    expect(box).toHaveClass("hasSuffix");
    const css = cssOf("Field");
    expect(ruleOf(css, ".hasSuffix .control")).toContain("padding-inline-end: 0");
    expect(ruleOf(css, ".suffix")).toContain("padding-inline-end: var(--inset)");
  });
});

describe("task 6b: Field label size, inset, tight", () => {
  it("labelSize_14_applies_label_class", () => {
    render(
      <>
        <Field kind="input" id="l1" label="Default" />
        <Field kind="input" id="l2" label="Small" labelSize="14" />
      </>,
    );
    expect(screen.getByText("Default")).not.toHaveClass("label14");
    expect(screen.getByText("Small")).toHaveClass("label14");
    expect(ruleOf(cssOf("Field"), ".label14")).toBe("font-size: var(--fs-14);");
  });

  it("inset_12_and_tight_variants", () => {
    render(
      <>
        <Field kind="input" id="i1" label="Plain" />
        <Field kind="input" id="i2" label="Spend" inset="12" tight />
      </>,
    );
    const plain = screen.getByLabelText("Plain");
    const spend = screen.getByLabelText("Spend");
    expect(plain.parentElement).not.toHaveClass("inset12");
    expect(spend.parentElement).toHaveClass("inset12");
    expect(spend.parentElement?.parentElement).toHaveClass("tight");
    expect(plain.parentElement?.parentElement).not.toHaveClass("tight");
    const css = cssOf("Field");
    expect(ruleOf(css, ".inset12")).toBe("--inset: var(--space-12);");
    expect(ruleOf(css, ".tight")).toBe("gap: var(--space-4);");
  });

  it("textarea_inset_is_unchanged", () => {
    expect(ruleOf(cssOf("Field"), ".area")).toContain("padding: var(--space-12) var(--space-14)");
  });
});

describe("task 6b: MoneyFlowBar lg/panel and SeatMeter md", () => {
  const tokens = fs.readFileSync(path.resolve(__dirname, "../../src/styles/tokens.css"), "utf8");

  it("size_lg_is_12px_radius_6", () => {
    render(<MoneyFlowBar feeBps={500} expenseBps={300} label="l" size="lg" />);
    expect(screen.getByRole("img")).toHaveClass("lg");
    const css = cssOf("MoneyFlowBar");
    expect(ruleOf(css, ".lg")).toBe("height: var(--size-bar-lg); border-radius: var(--radius-6);");
    expect(tokens).toMatch(/--size-bar-lg:\s*12px/);
  });

  it("tone_panel_uses_theme_invariant_panel_tokens", () => {
    const { rerender } = render(<MoneyFlowBar feeBps={500} expenseBps={300} label="l" />);
    expect(screen.getByRole("img")).not.toHaveClass("panel");
    rerender(<MoneyFlowBar feeBps={500} expenseBps={300} label="l" tone="panel" />);
    expect(screen.getByRole("img")).toHaveClass("panel");
    const css = cssOf("MoneyFlowBar");
    expect(ruleOf(css, ".panel .fee")).toBe("background: var(--color-panel-ink);");
    expect(ruleOf(css, ".panel .expense")).toBe("background: var(--color-panel-flow);");
    expect(ruleOf(css, ".panel .members")).toBe("background: var(--color-panel-accent-2);");
    expect(tokens).toMatch(/--color-panel-flow:\s*#8D9AA6/);
    expect(tokens).toMatch(/--color-panel-border:\s*#4F5B66/);
    expect(tokens).toMatch(/--color-panel-note:\s*#E2E7EB/);
  });

  it("seat_meter_md_is_8px_radius_4", () => {
    const { rerender } = render(<SeatMeter used={1} max={2} label="m" />);
    expect(screen.getByRole("meter")).not.toHaveClass("md");
    rerender(<SeatMeter used={1} max={2} label="m" size="md" />);
    expect(screen.getByRole("meter")).toHaveClass("md");
    const css = cssOf("SeatMeter");
    expect(ruleOf(css, ".md")).toContain("height: var(--size-meter-md)");
    expect(ruleOf(css, ".md")).toContain("border-radius: var(--radius-4)");
    expect(ruleOf(css, ".md::-webkit-meter-bar")).toContain("height: var(--size-meter-md)");
    expect(css).toMatch(/\.md::-webkit-meter-optimum-value,[^{]*\{[^}]*border-radius: var\(--radius-4\)/);
    expect(tokens).toMatch(/--size-meter-md:\s*8px/);
  });

  it("field_expresses_the_c03_spend_form", () => {
    render(<Field kind="input" id="sp" label="Recipient address" labelSize="14" tight inset="12" mono fontSize="15" error="Bad" />);
    const input = screen.getByLabelText("Recipient address");
    expect(input).toHaveClass("mono", "fs15");
    expect(input.parentElement).toHaveClass("inset12", "invalid");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});

describe("task 6b round 2: Field amount/phone/inline variants", () => {
  const first = (css: string, sel: string) => new RegExp(`^${sel.replace(/[.[\]]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(css)?.[1].replace(/\s+/g, " ").trim() ?? "";

  it("width_100_sets_the_content_width_including_the_inset", () => {
    render(<Field kind="input" id="a1" label="If a customer pays" large mono fontSize="22" suffix="ETH" width="100" />);
    expect(screen.getByLabelText("If a customer pays")).toHaveClass("w100");
    expect(first(cssOf("Field"), ".w100")).toBe("flex: none; width: calc(var(--size-100) + var(--inset));");
  });

  it("hint_inline_renders_beside_the_box_and_stays_described", () => {
    render(<Field kind="input" id="a2" label="Amount" large hint="every treasury below recalculates" hintPlacement="inline" />);
    const input = screen.getByLabelText("Amount");
    const hint = screen.getByText("every treasury below recalculates");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(hint.parentElement).toBe(input.parentElement?.parentElement);
    expect(hint.parentElement).toHaveClass("inlineRow");
    expect(hint).toHaveClass("hintInline");
    const css = cssOf("Field");
    expect(first(css, ".inlineRow")).toContain("flex-wrap: wrap");
    expect(first(css, ".inlineRow")).toContain("gap: var(--space-12)");
    expect(first(css, ".hintInline")).toBe("font-size: var(--fs-14); color: var(--color-ink-3);");
  });

  it("mono_alone_keeps_a_body_font_suffix_and_suffixMono_opts_in", () => {
    render(
      <>
        <Field kind="input" id="a3" label="Fee" mono suffix="%" />
        <Field kind="input" id="a4" label="Amount" mono suffix="ETH" suffixMono />
      </>,
    );
    expect(screen.getByText("%")).not.toHaveClass("mono");
    expect(screen.getByText("ETH")).toHaveClass("mono");
    expect(first(cssOf("Field"), ".suffix.mono")).toContain("font-family: var(--font-mono)");
  });

  it("suffix_never_shrinks_or_wraps", () => {
    expect(first(cssOf("Field"), ".suffix")).toContain("flex: none");
  });

  it("gap_10_is_a_finite_label_to_box_gap", () => {
    render(<Field kind="input" id="g1" label="If a customer pays" large gap="10" />);
    expect(screen.getByLabelText("If a customer pays").parentElement?.parentElement).toHaveClass("gap10");
    expect(first(cssOf("Field"), ".gap10")).toBe("gap: var(--space-10);");
  });

  it("width_with_inline_hint_does_not_hug", () => {
    render(<Field kind="input" id="g3" label="Amt" width="100" hint="h" hintPlacement="inline" />);
    expect(screen.getByLabelText("Amt").parentElement).not.toHaveClass("hug");
  });

  it("width_without_inline_hint_makes_the_box_hug_its_content", () => {
    render(<Field kind="input" id="g2" label="Amt" width="100" />);
    expect(screen.getByLabelText("Amt").parentElement).toHaveClass("hug");
    expect(first(cssOf("Field"), ".hug")).toBe("align-self: flex-start;");
  });

  it("phone_variant_is_a_row_label_left_of_a_hugging_transparent_box", () => {
    render(<Field kind="input" id="a5" label="Customer pays" phone mono fontSize="18" suffix="ETH" suffixMono />);
    const input = screen.getByLabelText("Customer pays");
    expect(input).toHaveClass("mono", "fs18");
    expect(input.parentElement).toHaveClass("phone");
    expect(input.parentElement?.parentElement).toHaveClass("phoneField");
    const css = cssOf("Field");
    expect(first(css, ".phoneField")).toBe("flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--space-10);");
        const r = first(css, ".phone");
    expect(r).toContain("--inset: var(--space-10)");
    expect(r).toContain("--bw: var(--border-2)");
    expect(r).toContain("flex: none");
    expect(r).toContain("background: transparent");
    expect(r).toContain("min-height: var(--size-target)");
    expect(r).toContain("border: var(--border-2) solid var(--color-ink)");
    expect(r).not.toMatch(/(^|[ ;])gap:/);
    expect(first(css, ".phone .control")).toContain("width: calc(var(--size-56) + var(--inset))");
    expect(first(css, ".phone .suffix")).toBe("font-size: var(--fs-13);");
    expect(css).toMatch(/\.phoneField \.hint,\s*\.phoneField \.error\s*\{[^}]*flex-basis: 100%/);
    expect(first(css, ".phoneField .label")).toBe("flex: 1 1 0; min-width: 0;");
  });

  it("inline_label_sits_left_of_a_compact_select", () => {
    render(<Field kind="select" id="a6" label="Sort" compact fontSize="14" labelPlacement="inline"><option>a</option></Field>);
    const field = screen.getByLabelText("Sort").parentElement?.parentElement;
    expect(field).toHaveClass("labelInlineField");
    expect(screen.getByText("Sort")).toHaveClass("labelInline");
    const css = cssOf("Field");
    expect(first(css, ".labelInlineField")).toBe("flex-direction: row; align-items: center; gap: var(--space-8); margin-inline-start: auto;");
    expect(first(css, ".labelInline")).toBe("font-size: var(--fs-14); font-weight: var(--weight-regular); color: var(--color-ink-3);");
  });
});

describe("task 6b round 2: tokens and fidelity helper", () => {
  it("panel_tokens_match_t9_lines_byte_for_byte", () => {
    const tokens = fs.readFileSync(path.resolve(__dirname, "../../src/styles/tokens.css"), "utf8");
    expect(tokens).toContain("  --color-panel-border: #4F5B66; /* calculator input border on the dark panel: C-03-Treasury:81 */\n");
    expect(tokens).toContain("  --color-panel-flow: #8D9AA6; /* expenses slice of the calculator bar on the dark panel: C-03-Treasury:84 */\n");
    expect(tokens).toContain("  --color-panel-note: #E2E7EB; /* note text on the dark panel: C-03-Treasury:92 */\n");
  });

  it("touchAllow_filters_the_list_by_screen_and_the_list_is_exported", async () => {
    const m = await import("../../fidelity/exceptions");
    expect(Array.isArray(m.TOUCH_TARGET_EXCEPTIONS)).toBe(true);
    const all = m.TOUCH_TARGET_EXCEPTIONS;
    for (const e of all) expect(m.touchAllow(e.screen)).toContain(e.selector);
    expect(m.touchAllow("No-Such-Screen")).toEqual([]);
  });
});

describe("task 6b round 3", () => {
  it("button_hover_never_overrides_disabled", () => {
    const css = cssOf("Button");
    const hovers = [...css.matchAll(/^([^{}\n]*:hover[^{}\n]*)\{/gm)].map((m) => m[1]);
    expect(hovers.length).toBeGreaterThanOrEqual(5);
    for (const h of hovers) expect(h).toContain(':not(:disabled):not([aria-disabled="true"])');
  });

  it("moneyflowbar_sliver_variants", () => {
    const { rerender } = render(<MoneyFlowBar feeBps={0} expenseBps={0} label="l" />);
    const bar = () => screen.getByRole("img");
    expect(bar()).not.toHaveClass("sliver2", "sliverNone");
    rerender(<MoneyFlowBar feeBps={0} expenseBps={0} label="l" sliver="2" />);
    expect(bar()).toHaveClass("sliver2");
    rerender(<MoneyFlowBar feeBps={0} expenseBps={0} label="l" sliver="none" />);
    expect(bar()).toHaveClass("sliverNone");
    const css = cssOf("MoneyFlowBar");
    expect(css).toMatch(/\.sliver2 \.fee,\s*\.sliver2 \.expense\s*\{[^}]*min-width: var\(--size-sliver-2\)/);
    expect(css).toMatch(/\.sliverNone \.fee,\s*\.sliverNone \.expense\s*\{[^}]*min-width: 0/);
  });

  it("table_footer_sits_inside_the_frame_but_outside_the_table", () => {
    render(<Table columns="even4" minWidth="md" header={["a"]} rows={[["x"]]} caption="Credits" frame="card" footer={<p>2 selected</p>} />);
    const footer = screen.getByText("2 selected").parentElement as HTMLElement;
    const table = screen.getByRole("table");
    expect(table.contains(footer)).toBe(false);
    expect(footer).toHaveClass("footer");
    const frame = footer.parentElement as HTMLElement;
    expect(frame).toHaveClass("frame", "card");
    expect(frame).toContainElement(screen.getByRole("region", { name: "Credits" }));
    expect(screen.getByRole("region").contains(footer)).toBe(false);
    expect(ruleOf(cssOf("Table"), ".footer")).toContain("background: var(--color-surface-muted)");
  });

  it("table_without_footer_keeps_its_dom", () => {
    render(<Table columns="even4" minWidth="md" header={["a"]} rows={[["x"]]} caption="Credits" frame="card" />);
    expect(screen.getByRole("region")).toHaveClass("scroll", "card");
  });
});

describe("task 6b round 4", () => {
  it("pressed_toggle_does_not_override_disabled", () => {
    expect(cssOf("Button")).toMatch(/\.toggle\[aria-pressed="true"\]:not\(:disabled\):not\(\[aria-disabled="true"\]\)\s*\{/);
    render(<Button variant="toggle" pressed disabled>Cards</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
