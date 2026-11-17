import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const PROTOTYPE = path.resolve(__dirname, "../prototype");
const css = fs.readFileSync(path.join(ROOT, "src/styles/tokens.css"), "utf8");

const LIGHT_FILES = [
  "C-01-Landing", "C-02-Treasuries", "C-03-Treasury", "C-04-CreateTreasury", "C-05-DAOs",
  "C-05b-DAO", "C-06-CreateDAO", "C-07-Agents", "C-08-Earnings", "C-09-Approval", "C-Commons",
];
const MOBILE_FILES = ["C-M1-Treasuries", "C-M2-Treasury", "C-Mobile"];
const ALL_FILES = [...LIGHT_FILES, ...MOBILE_FILES];

const read = (name: string) => fs.readFileSync(path.join(PROTOTYPE, `${name}.dc.html`), "utf8");

// ---------- tokens.css parsing ----------

const NOT_IN_MOBILE = "/* not-in-mobile-files */";

/** Body of the first `{ ... }` block that follows `header` (brace matched). */
function blockAfter(source: string, header: string | RegExp, from = 0): string {
  const rest = source.slice(from);
  const m = typeof header === "string" ? { index: rest.indexOf(header), 0: header } : rest.match(header);
  if (!m || m.index === undefined || m.index < 0) throw new Error(`block not found: ${header}`);
  const open = rest.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    if (rest[i] === "}" && --depth === 0) return rest.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${header}`);
}

function declarations(body: string): Map<string, string> {
  const stripped = body.replace(/\/\*(?!\s*not-in-mobile-files)[\s\S]*?\*\//g, "");
  const out = new Map<string, string>();
  for (const m of stripped.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim().replace(/\s+/g, " "));
  return out;
}

const lightBody = blockAfter(css, /^:root\s*\{/m);
const darkMediaBody = blockAfter(blockAfter(css, /^@media \(max-width: 720px\)/m), /^\s*:root:not\(\[data-theme="light"\]\)/m);
const darkAttrBody = blockAfter(css, /^:root\[data-theme="dark"\]/m);

const light = declarations(lightBody);
const darkBlocks = [darkMediaBody, darkAttrBody].map((body) => {
  const idx = body.indexOf(NOT_IN_MOBILE);
  return {
    fromFiles: declarations(idx < 0 ? body : body.slice(0, idx)),
    notInMobile: declarations(idx < 0 ? "" : body.slice(idx)),
  };
});
const dark = new Map([...darkBlocks[0].fromFiles, ...darkBlocks[0].notInMobile]);

const colorNames = (m: Map<string, string>) => [...m.keys()].filter((k) => k.startsWith("--color-"));
const hexes = (text: string) => [...text.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());
const hexSet = (m: Map<string, string>) => new Set([...m.values()].flatMap(hexes));

// ---------- colour tests ----------

describe("tokens: colours", () => {
  it("every_prototype_color_is_a_light_token", () => {
    const known = hexSet(light);
    expect(known.size).toBeGreaterThan(20);
    const missing: string[] = [];
    for (const f of LIGHT_FILES) {
      for (const h of new Set(hexes(read(f)))) if (!known.has(h)) missing.push(`${f}: ${h}`);
    }
    expect(missing).toEqual([]);
  });

  it("dark_theme_defines_every_light_color_token", () => {
    const needed = colorNames(light).filter((n) => !n.startsWith("--color-panel-"));
    expect(needed.length).toBeGreaterThan(30);
    for (const block of darkBlocks) {
      const defined = new Map([...block.fromFiles, ...block.notInMobile]);
      expect(needed.filter((n) => !defined.has(n))).toEqual([]);
      // panel tokens are always-dark: only defined in :root, never redefined.
      expect(colorNames(defined).filter((n) => n.startsWith("--color-panel-"))).toEqual([]);
    }
  });

  it("dark_blocks_are_identical", () => {
    expect([...darkBlocks[0].fromFiles]).toEqual([...darkBlocks[1].fromFiles]);
    expect([...darkBlocks[0].notInMobile]).toEqual([...darkBlocks[1].notInMobile]);
  });

  it("dark_values_come_from_mobile_files", () => {
    const mobileHexes = new Set(MOBILE_FILES.flatMap((f) => hexes(read(f))));
    const darkHexes = hexSet(darkBlocks[0].fromFiles);
    expect(mobileHexes.size).toBeGreaterThan(10);
    // every hex in the mobile files is a dark token value
    expect([...mobileHexes].filter((h) => !darkHexes.has(h))).toEqual([]);
    // every dark token value (outside the not-in-mobile group) is a mobile-file hex: no derivation
    expect([...darkHexes].filter((h) => !mobileHexes.has(h))).toEqual([]);
    // the not-in-mobile group only references existing tokens, it invents no colour
    expect([...hexSet(darkBlocks[0].notInMobile)]).toEqual([]);
    // spot checks from the plan
    expect(dark.get("--color-bg")).toBe("#0B1015");
    expect(dark.get("--color-surface")).toBe("#141C23");
    expect(dark.get("--color-line")).toBe("#26323C");
    expect(dark.get("--color-ink")).toBe("#EEF2F5");
    expect(dark.get("--color-brand")).toBe("#6FD6C0");
  });
});

// ---------- contrast ----------

function resolve(theme: Map<string, string>, name: string, depth = 0): string {
  const v = theme.get(name) ?? light.get(name);
  if (v === undefined) throw new Error(`undefined token ${name}`);
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (!ref) return v;
  if (depth > 5) throw new Error(`var cycle at ${name}`);
  return resolve(theme, ref[1], depth + 1);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXTS = ["ink", "ink-2", "ink-3", "ink-4"];
const SURFACES = ["bg", "surface", "surface-muted", "surface-selected"];
const PAIRS: [string, string][] = [
  ...TEXTS.flatMap((t) => SURFACES.map((s) => [t, s] as [string, string])),
  ["on-brand", "brand"],
  ["on-action", "action"],
  ["warn-fg", "warn-bg"],
  ["caution-fg", "caution-bg"],
  ["brand", "surface"],
  ["slate", "surface"],
  ["panel-ink", "panel-bg"],
  ["panel-muted", "panel-bg"],
  ["panel-accent", "panel-bg"],
  ["panel-note", "panel-surface"],
];
const DARK_ONLY_PAIRS: [string, string][] = [
  ["cta", "on-cta"],
  ["brand-tint", "brand"],
];

describe("tokens: contrast", () => {
  it("text_tokens_meet_aa_contrast", () => {
    const failures: string[] = [];
    for (const [theme, map, pairs] of [
      ["light", new Map<string, string>(), [...PAIRS, ["cta", "on-cta"] as [string, string], ["brand-tint", "brand"] as [string, string]]],
      ["dark", dark, [...PAIRS, ...DARK_ONLY_PAIRS]],
    ] as const) {
      for (const [fg, bg] of pairs) {
        const ratio = contrast(resolve(map, `--color-${fg}`), resolve(map, `--color-${bg}`));
        if (ratio < 4.5) failures.push(`${theme} ${fg}/${bg} = ${ratio.toFixed(2)}`);
      }
    }
    // A failing pair fails here directly; token values are never adjusted to hide it.
    expect(failures).toEqual([]);
  });
});

// ---------- px coverage ----------

const pxOf = (value: string) => Number(value.replace("px", ""));

function pxSet(prefixes: string[]): Set<number> {
  const out = new Set<number>();
  for (const [name, value] of light) {
    if (!/^-?\d*\.?\d+px$/.test(value)) continue;
    if (prefixes.some((p) => name.startsWith(p))) out.add(pxOf(value));
  }
  return out;
}

const FS = pxSet(["--fs-"]);
const RADIUS = pxSet(["--radius-"]);
const SPACE = pxSet(["--space-"]);
const BORDER = pxSet(["--border-"]);
// width/height/min-*/max-*/inset: every length token except type sizes and radii.
const DIMENSION = pxSet(["--size-", "--space-", "--border-", "--measure-", "--min-", "--container-max", "--gutter",
  "--modal-width", "--page-narrow", "--table-min-"]);

// Design-tool artboard sizes only (named, not silently skipped).
const ARTBOARD_PX = new Set([390, 844, 900, 1280]);
const ARTBOARD_MIN_HEIGHT_FROM = 1200;

const pxValues = (value: string) => [...value.matchAll(/-?\d*\.?\d+px/g)].map((m) => Math.abs(pxOf(m[0]))).filter((n) => n !== 0);

function violations(propRe: RegExp, allowed: Set<number>, opts?: { dimension?: boolean }): string[] {
  const out: string[] = [];
  for (const f of ALL_FILES) {
    for (const m of read(f).matchAll(/(?<![a-z-])([a-z-]+)\s*:\s*([^;"}\n]+)/g)) {
      const [, prop, value] = m;
      if (!propRe.test(prop)) continue;
      for (const n of pxValues(value)) {
        if (allowed.has(n)) continue;
        if (opts?.dimension) {
          if (ARTBOARD_PX.has(n)) continue;
          if (prop === "min-height" && n >= ARTBOARD_MIN_HEIGHT_FROM) continue;
        }
        out.push(`${f}: ${prop}: ${value.trim()} -> ${n}px`);
      }
    }
  }
  return [...new Set(out)];
}

describe("tokens: font-size, radius, space, size values are tokens", () => {
  it("every_prototype_font_size_radius_space_size_values_are_tokens", () => {
    expect(FS.size).toBeGreaterThan(15);
    expect(RADIUS.size).toBeGreaterThan(8);
    expect(SPACE.size).toBeGreaterThan(20);
    expect(violations(/^font-size$/, FS)).toEqual([]);
    expect(violations(/^border-radius$/, RADIUS)).toEqual([]);
    expect(violations(/^(gap|row-gap|column-gap|padding(-(top|right|bottom|left))?|margin(-(top|right|bottom|left))?)$/, SPACE)).toEqual([]);
    expect(
      violations(/^(width|height|min-width|min-height|max-width|max-height|top|left|right|bottom|flex-basis)$/, DIMENSION, { dimension: true }),
    ).toEqual([]);
    expect(violations(/^border(-(top|right|bottom|left))?$/, BORDER)).toEqual([]);
  });

  it("modal_shadow_is_the_prototype_shadow", () => {
    const shadows = new Set<string>();
    for (const f of ALL_FILES) {
      for (const m of read(f).matchAll(/box-shadow\s*:\s*([^;"}\n]+)/g)) shadows.add(m[1].trim().replace(/\s+/g, " "));
    }
    const token = light.get("--shadow-modal");
    expect(token).toBeDefined();
    expect([...shadows].filter((s) => s !== token)).toEqual([]);
  });

  it("first_paint_theme_follows_the_layout_not_the_system_theme (M10)", () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it("typography_and_theme_hooks_exist", () => {
    for (const name of ["--font-display", "--font-body", "--font-mono", "--weight-regular", "--weight-medium", "--weight-bold",
      "--lh-body", "--ls-caps", "--container-max", "--size-target", "--bp-narrow"]) {
      expect(light.has(name), name).toBe(true);
    }
    expect(css).toContain("720px");
  });
});
