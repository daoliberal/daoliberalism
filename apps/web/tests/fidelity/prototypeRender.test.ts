import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPrototypeText } from "../../fidelity/prototype-render";

const PROTOTYPE = path.resolve(__dirname, "../../prototype");
const html = (name: string) => fs.readFileSync(path.join(PROTOTYPE, `${name}.dc.html`), "utf8");

describe("renderPrototypeText", () => {
  it("C-09_claim_review_expands_every_binding", () => {
    const text = renderPrototypeText(html("C-09-Approval"), { k: "claim", phase: "review" });
    for (const s of ["Claim 0.412 ETH", "What will happen", "Contract you sign", "Rules that apply", "Claim and sign", "Cancel"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("{{");
    expect(text).not.toContain("}}");
  });

  it("C-09_phase_selects_the_branch_that_renders", () => {
    const waiting = renderPrototypeText(html("C-09-Approval"), { k: "join", phase: "waiting" });
    expect(waiting).toContain("Waiting for your wallet");
    expect(waiting).not.toContain("What will happen");
    expect(waiting).not.toContain("Confirmed on-chain");

    const done = renderPrototypeText(html("C-09-Approval"), { k: "join", phase: "done" });
    expect(done).toContain("Confirmed on-chain");
    expect(done).toContain("Atlas‑7 is now a member of Northwind Studio.");
    expect(done).not.toContain("Waiting for your wallet");
  });

  it("C-09_optional_rows_follow_their_flags", () => {
    const join = renderPrototypeText(html("C-09-Approval"), { k: "join", phase: "review" });
    expect(join).not.toContain("Public: this spend appears");
    const spend = renderPrototypeText(html("C-09-Approval"), { k: "spend", phase: "review" });
    expect(spend).toContain("Public: this spend appears in the treasury’s history for everyone");
    expect(spend).toContain("Balance 23.408 → 22.158 ETH");
    const agent = renderPrototypeText(html("C-09-Approval"), { k: "agent", phase: "review" });
    expect(agent).not.toContain("Balance");
  });

  it("C-09_defaults_to_join_review_without_a_state", () => {
    const text = renderPrototypeText(html("C-09-Approval"));
    expect(text).toContain("Let Atlas‑7 join Northwind Studio");
    expect(text).toContain("Network fee shown in your wallet");
  });

  it("C-03_renders_static_copy_and_the_rule_titles_from_renderVals", () => {
    const text = renderPrototypeText(html("C-03-Treasury"), {});
    expect(text).toContain("Rulebook");
    expect(text).toContain("Five rules, each enforced by a contract you can read.");
    for (const title of ["Treasury fee", "Hold period", "Max agents"]) expect(text).toContain(title);
  });

  it("C-03_sc_if_renders_only_the_true_branch", () => {
    const closed = renderPrototypeText(html("C-03-Treasury"), {}, { viewerIsFounder: false });
    expect(closed).not.toContain("Spend from treasury");
    const open = renderPrototypeText(html("C-03-Treasury"), {}, { viewerIsFounder: true });
    expect(open).toContain("Spend from treasury");
    // the data-props default for the founder view is true
    expect(renderPrototypeText(html("C-03-Treasury"), {})).toContain("Spend from treasury");
  });

  it("sc_for_expands_for_every_item", () => {
    const text = renderPrototypeText(html("C-02-Treasuries"), {});
    for (const name of ["Commonwealth", "Lean Guild", "Meritline", "Open Field"]) expect(text).toContain(name);
  });

  it("C-02_compare_view_shows_the_side_by_side_row", () => {
    const compare = renderPrototypeText(html("C-02-Treasuries"), { view: "compare" });
    expect(compare).toContain("Side by side");
    expect(compare).toContain("Reaches owners");
  });

  it("drops_script_style_and_svg_text", () => {
    const text = renderPrototypeText(html("C-09-Approval"), { k: "join", phase: "review" });
    expect(text).not.toContain("renderVals");
    expect(text).not.toContain("dlspin");
    expect(text).not.toContain("font-family");
  });

  it("separates_block_elements_into_lines_and_keeps_inline_text_together", () => {
    const text = renderPrototypeText(html("C-Mobile"), {});
    const lines = text.split("\n");
    expect(lines).toContain("If a customer pays 1.00 ETH");
    expect(lines).toContain("Not now");
    expect(lines).toContain("Approve and sign");
  });

  it("throws_on_a_binding_the_script_does_not_define_instead_of_returning_blanks", () => {
    const broken = `<x-dc><div>{{missing.value}}</div></x-dc><script type="text/x-dc" data-dc-script>class Component extends DCLogic { renderVals() { return {}; } }</script>`;
    expect(() => renderPrototypeText(broken)).toThrow(/missing/);
  });
});
