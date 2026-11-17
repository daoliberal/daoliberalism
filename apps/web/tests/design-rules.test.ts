import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanDesignRules, type DesignViolation } from "./helpers/designRules";

const SRC = path.resolve(__dirname, "../src");

type Rule = DesignViolation["rule"];

function rulesOf(file: string, text: string): Rule[] {
  return scanDesignRules([{ path: file, text }]).map((v) => v.rule);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

describe("design rules scanner", () => {
  it("scanner_flags_each_violation_kind", () => {
    // inline styles
    expect(rulesOf("x.tsx", "<div style={{a:1}} />")).toEqual(["inline-style"]);
    expect(rulesOf("x.tsx", '<div style="x" />')).toEqual(["inline-style"]);

    // raw colours (CSS)
    for (const decl of [
      "color:#fff",
      "color:#0B6B5D",
      "color:rgb(0 0 0)",
      "color:hsla(10, 20%, 30%, 0.5)",
      "color:oklch(0.5 0.1 200)",
      "color:color-mix(in srgb, red, blue)",
      "color: white",
      "background: red",
    ]) {
      expect(rulesOf("x.module.css", `.a{${decl}}`), decl).toEqual(["raw-color"]);
    }
    for (const decl of ["color:transparent", "color:currentColor", "color:inherit"]) {
      expect(rulesOf("x.module.css", `.a{${decl}}`), decl).toEqual([]);
    }

    // SVG presentation attributes in TSX
    expect(rulesOf("x.tsx", '<path stroke="#0B6B5D" />')).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", '<path fill="red" />')).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", "<svg width={26} />")).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", '<path fill="none" stroke="currentColor" width={size} />')).toEqual([]);

    // dangerous html
    expect(rulesOf("x.tsx", "<p dangerouslySetInnerHTML={{__html: x}} />")).toEqual(["dangerous-html"]);

    // raw lengths
    expect(rulesOf("x.module.css", ".a{padding:12px}")).toEqual(["raw-length"]);
    expect(rulesOf("x.module.css", ".a{width:2rem}")).toEqual(["raw-length"]);
    expect(rulesOf("x.module.css", ".a{padding:var(--space-12)}")).toEqual([]);
    expect(rulesOf("x.module.css", ".a{border:0}")).toEqual([]);
    expect(rulesOf("x.module.css", "@media (max-width: 720px) {")).toEqual([]);

    // properties that must be tokens
    expect(rulesOf("x.module.css", ".a{font-size:14px}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.module.css", ".a{border-radius:12px}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.module.css", ".a{font-size:var(--fs-14)}")).toEqual([]);

    // font family
    expect(rulesOf("x.module.css", ".a{font-family: Arial}")).toEqual(["font-family-literal"]);
    expect(rulesOf("x.module.css", ".a{font-family: var(--font-body)}")).toEqual([]);
  });

  it("scanner_reports_path_line_and_text", () => {
    const v = scanDesignRules([
      { path: "a.module.css", text: ".a{\n  color: var(--color-ink);\n  padding: 12px;\n}\n" },
    ]);
    expect(v).toEqual([
      { path: "a.module.css", line: 3, rule: "raw-length", text: "padding: 12px;" },
    ]);
  });

  it("scanner_exempts_the_narrow_media_query_literal_and_plain_strings", () => {
    // C11: the single breakpoint constant used by matchMedia.
    expect(
      rulesOf("useIsNarrow.tsx", 'export const NARROW_QUERY = "(max-width: 720px)";'),
    ).toEqual([]);
    // C12: copy such as "Coral Desk" is not a colour.
    expect(rulesOf("CreateDao.tsx", 'const name = "Coral Desk";')).toEqual([]);
    expect(rulesOf("x.tsx", '<a href="#add">Add</a>')).toEqual([]);
    // ...but a real violation next to it is still caught.
    expect(rulesOf("x.tsx", '<g fill="coral" />')).toEqual(["raw-svg-attr"]);
    // comments are ignored
    expect(rulesOf("x.module.css", "/* padding: 12px; */\n.a{margin:0}")).toEqual([]);
  });

  it("css_multiline_declarations_cannot_bypass", () => {
    expect(rulesOf("x.module.css", ".a{box-shadow: 0 1px 2px #000,\n 0 2px 4px #111;}")).toContain("raw-color");
    expect(rulesOf("x.module.css", ".a{box-shadow: 0 1px 2px #000,\n 0 2px 4px #111;}")).toContain("raw-token-property");
    expect(rulesOf("x.module.css", ".a{padding:\n 12px;}")).toEqual(["raw-length"]);
    expect(rulesOf("x.module.css", ".a{font-family:\n Arial;}")).toEqual(["font-family-literal"]);
    expect(rulesOf("x.module.css", ".a{\n  color:\n    red;\n}")).toEqual(["raw-color"]);
    const v = scanDesignRules([{ path: "x.css", text: ".a{\n  margin: 0;\n  padding:\n    12px;\n}" }]);
    expect(v.map((x) => x.line)).toEqual([3]);
  });

  it("css_var_fallbacks_and_custom_properties", () => {
    expect(rulesOf("x.css", ".a{font-size:var(--fs-14, 14px)}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", ".a{color:var(--x, red)}")).toEqual(["raw-color"]);
    expect(rulesOf("x.css", ".a{padding:var(--x, 12px)}")).toEqual(["raw-length"]);
    expect(rulesOf("x.css", ".a{padding:var(--x, var(--space-12))}")).toEqual([]);
    expect(rulesOf("x.css", ".a{padding:var(--x, 0)}")).toEqual([]);
    expect(rulesOf("x.css", ".a{--c: red}")).toEqual(["raw-color"]);
    expect(rulesOf("x.css", ".a{--c: #fff}")).toEqual(["raw-color"]);
    expect(rulesOf("x.css", ".a{--g: 12px}")).toEqual(["raw-length"]);
    expect(rulesOf("x.css", ".a{--g: var(--space-12)}")).toEqual([]);
  });

  it("css_multiple_rules_per_line_and_one_line_media", () => {
    expect(rulesOf("x.css", ".a{color:var(--color-ink)} .b{color:red}")).toEqual(["raw-color"]);
    expect(rulesOf("x.css", "@media (max-width: 720px) { .a{padding:12px} }")).toEqual(["raw-length"]);
    expect(rulesOf("x.css", "@media (max-width: 720px) { .a{padding:var(--space-12)} }")).toEqual([]);
  });

  it("css_all_length_units_are_flagged", () => {
    for (const u of ["px", "rem", "em", "vh", "vw", "vmin", "vmax", "dvh", "svh", "lvh", "ch", "ex", "pt", "pc", "cm", "mm", "in"]) {
      expect(rulesOf("x.css", `.a{margin:10${u}}`), u).toEqual(["raw-length"]);
    }
    expect(rulesOf("x.css", ".a{margin:0px 0}")).toEqual([]);
    expect(rulesOf("x.css", "@container (min-width: 40em) {")).toEqual([]);
  });

  it("tsx_color_attrs_template_literals_spread_and_setProperty", () => {
    for (const attr of ["color", "stopColor", "floodColor", "lightingColor"]) {
      expect(rulesOf("x.tsx", `<stop ${attr}="#fff" />`), attr).toEqual(["raw-svg-attr"]);
    }
    expect(rulesOf("x.tsx", "<path fill={`#fff`} />")).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", "<path fill={`${c}`} />")).toEqual([]);
    expect(rulesOf("x.tsx", '<Icon color="#0B6B5D" />')).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", '<path\n  fill=\n"red"\n/>')).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", "<div {...{style: {a: 1}}} />")).toEqual(["inline-style"]);
    expect(rulesOf("x.ts", 'el.style.setProperty("color", "red");')).toEqual(["inline-style"]);
    expect(rulesOf("x.ts", 'const style = "x";')).toEqual([]);
  });

  it("tsx_raw_svg_attr_only_on_intrinsic_tags_for_sizes", () => {
    for (const tag of ["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "img", "ellipse", "text", "use"]) {
      expect(rulesOf("x.tsx", `<${tag} width="40" />`), tag).toEqual(["raw-svg-attr"]);
    }
    expect(rulesOf("x.tsx", '<Card width="wide" />')).toEqual([]);
    expect(rulesOf("x.tsx", '<Card fill="primary" height={3} />')).toEqual([]);
    expect(rulesOf("x.tsx", '<div width="40" />')).toEqual([]);
  });

  it("custom_properties_cannot_smuggle_raw_values", () => {
    expect(rulesOf("x.css", ".a{--f:'Comic Sans MS'; font-family:var(--f)}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", ".a{--lh:1.7; line-height:var(--lh)}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", ".a{--w:800; font-weight:var(--w)}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", ".a{--x: var(--a) var(--b)}")).toEqual([]);
    expect(rulesOf("x.css", ".a{--x: var(--a, var(--b))}")).toEqual([]);
    expect(rulesOf("x.css", ".a{--x: 0}")).toEqual([]);
  });

  it("font_shorthand_and_font_family_are_token_only", () => {
    expect(rulesOf("x.css", ".a{font: 800 var(--fs-14)/1.7 'Comic Sans MS'}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", ".a{font: 12px/1.5 Arial}")).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", ".a{font: inherit}")).toEqual([]);
    expect(rulesOf("x.css", ".a{font: var(--weight-bold) var(--fs-14)/var(--lh-body) var(--font-body)}")).toEqual([]);
    expect(rulesOf("x.css", ".a{font-family: var(--font-body), 'Comic Sans MS'}")).toEqual(["font-family-literal"]);
    expect(rulesOf("x.css", ".a{font-family: inherit}")).toEqual([]);
    expect(rulesOf("x.css", ".a{font-family: var(--font-body)}")).toEqual([]);
  });

  it("style_element_and_string_literals_in_colour_attrs", () => {
    expect(rulesOf("x.tsx", "<style>{`.a{}`}</style>")).toEqual(["inline-style"]);
    expect(rulesOf("x.tsx", "<path fill={on ? '#fff' : '#000'} />")).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", "<Icon color={on ? 'red' : 'blue'} />")).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", "<Icon color={on ? 'primary' : 'muted'} />")).toEqual([]);
    expect(rulesOf("x.tsx", "<path fill={on ? 'currentColor' : 'none'} />")).toEqual([]);
  });

  it("extra_units_and_named_colours_in_any_value", () => {
    for (const u of ["Q", "cqw", "cqh", "cqi", "cqb", "lh", "rlh", "cap", "ic", "vb", "vi"]) {
      expect(rulesOf("x.css", `.a{margin:10${u}}`), u).toEqual(["raw-length"]);
    }
    expect(rulesOf("x.css", ".a{filter: drop-shadow(0 0 var(--space-4) red)}")).toEqual(["raw-color"]);
  });

  it("prototype_faithful_values_are_not_flagged", () => {
    const ok = [
      ".a{transform: translate(-50%,-50%)}",
      ".a{grid-template-columns: repeat(auto-fit, minmax(min(var(--x),100%),1fr))}",
      ".a{aspect-ratio: 16/9}",
      ".a{width: 100%}",
      ".a{width: calc(100% - var(--space-16))}",
      ".a{z-index: 2; opacity: .5; flex: 1 1 0}",
      "@keyframes spin{from{transform:rotate(0deg)}50%{opacity:.5}to{transform:rotate(360deg)}}",
      ".a{transition: opacity 150ms ease-in-out, color .2s linear}",
      ".a{display:flex; position:absolute; text-align:center; cursor:pointer; white-space:nowrap; overflow-wrap:anywhere}",
      ".a{transform: rotate(calc(tan(1) * 1deg))}",
      ".a{background: url(data:image/svg+xml;base64,AAAA#add)}",
    ];
    for (const css of ok) expect(rulesOf("x.css", css), css).toEqual([]);
  });

  it("math_cannot_smuggle_raw_numbers_into_token_properties", () => {
    for (const decl of [
      "line-height: calc(var(--lh) * 1.2)",
      "line-height: min(var(--lh), 2)",
      "font-weight: calc(var(--w) + 300)",
      "font-weight: max(var(--w), 800)",
      "border-radius: calc(var(--r) * 3)",
      "font-size: calc(var(--fs-14) * 1.5)",
      "letter-spacing: clamp(var(--a), 3, var(--b))",
    ]) {
      expect(rulesOf("x.css", `.a{${decl}}`), decl).toEqual(["raw-token-property"]);
    }
    expect(rulesOf("x.css", ".a{padding: calc(var(--space-8) * 3)}")).toEqual(["raw-length"]);
    expect(rulesOf("x.css", ".a{margin: 0 auto calc(var(--space-8) + 2)}")).toEqual(["raw-length"]);
    // allowed: 0, -1, percentages, operators
    expect(rulesOf("x.css", ".a{margin-top: calc(var(--space-96) * -1)}")).toEqual([]);
    expect(rulesOf("x.css", ".a{padding: calc(100% - var(--space-16))}")).toEqual([]);
    expect(rulesOf("x.css", ".a{line-height: calc(var(--lh) * 0)}")).toEqual([]);
    expect(rulesOf("x.css", ".a{font-size: calc(var(--fs-14) + var(--fs-12))}")).toEqual([]);
    expect(rulesOf("x.css", '.a{font-variation-settings: "opsz" 12}')).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", '.a{font-variation-settings: "opsz" var(--o), "wght" 700}')).toEqual(["raw-token-property"]);
    expect(rulesOf("x.css", ".a{font-variation-settings: var(--fvs)}")).toEqual([]);
  });

  it("no_false_positives_for_expressions_identifiers_and_strings", () => {
    expect(rulesOf("x.tsx", "<path fill={state === 'on' ? 'currentColor' : 'none'} />")).toEqual([]);
    expect(rulesOf("x.tsx", "<path fill={cls('a')} />")).toEqual([]);
    expect(rulesOf("x.tsx", "<path fill={on ? '#fff' : '#000'} />")).toEqual(["raw-svg-attr"]);
    expect(rulesOf("x.tsx", '<path fill="url(#grad)" />')).toEqual([]);
    expect(rulesOf("x.css", ".a{animation: tan 1s}")).toEqual([]);
    expect(rulesOf("x.css", ".a{container-name: navy}")).toEqual([]);
    expect(rulesOf("x.css", ".a{grid-area: red}")).toEqual([]);
    expect(rulesOf("x.css", ".a{animation: red2 1s}")).toEqual([]);
    expect(rulesOf("x.css", ".a{background: red2}")).toEqual([]);
    expect(rulesOf("x.css", ".a{background-image: linear-gradient(red, var(--c))}")).toEqual(["raw-color"]);
    expect(rulesOf("x.css", ".a{border-bottom-color: navy}")).toEqual(["raw-color"]);
    expect(rulesOf("x.css", ".a{mask-image: linear-gradient(black, transparent)}")).toEqual(["raw-color"]);
    expect(rulesOf("x.css", ".a{text-shadow: 0 0 var(--space-2) navy}")).toEqual(["raw-color"]);
    expect(rulesOf("x.ts", 'const css = "<style>";')).toEqual([]);
    expect(rulesOf("x.tsx", "<style>{`.a{}`}</style>")).toEqual(["inline-style"]);
  });

  it("source_tree_has_no_violations", () => {
    const files = walk(SRC)
      .filter((f) => /\.(css|tsx|ts)$/.test(f) && path.basename(f) !== "tokens.css")
      .map((f) => ({ path: path.relative(SRC, f), text: fs.readFileSync(f, "utf8") }));
    expect(files.length).toBeGreaterThan(0);
    expect(scanDesignRules(files)).toEqual([]);
  });
});
