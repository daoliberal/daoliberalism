/**
 * Design-rule scanner (CSS by whole declarations, TS/TSX as whole text). Raw values (colours, lengths, inline styles, raw SVG
 * attributes, innerHTML) are forbidden outside src/styles/tokens.css.
 *
 * - CSS files: comments are stripped, then the whole text is split into declarations
 *   (terminated by `;` or `}` at paren depth 0), so multi-line values, several rules per line
 *   and one-line @media blocks are all checked. var() fallbacks may only be 0 or another var().
 * - TS/TSX files: scanned as a whole (multi-line JSX attributes included) for inline `style`,
 *   dangerouslySetInnerHTML / innerHTML, raw SVG/colour attributes, colour functions and raw
 *   lengths. Plain string literals are not scanned for hex or named colours (copy such as
 *   "Coral Desk" is not a colour).
 */

export type DesignViolation = {
  path: string;
  line: number;
  rule:
    | "inline-style"
    | "raw-color"
    | "raw-length"
    | "raw-token-property"
    | "font-family-literal"
    | "raw-svg-attr"
    | "dangerous-html";
  text: string;
};

type Rule = DesignViolation["rule"];

const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
    "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/i;
const HEX = /#[0-9a-f]{3,8}\b/i;
const UNITS = "px|rem|em|vh|vw|vmin|vmax|dvh|svh|lvh|dvw|svw|lvw|ch|ex|pt|pc|cm|mm|in|q|cqw|cqh|cqi|cqb|lh|rlh|cap|ic|vb|vi";
const LENGTH = new RegExp(`(?<![\\w.#-])-?(?:\\d*\\.)?\\d+(?:${UNITS})\\b`, "gi");
const TOKEN_PROPS = new Set([
  "font-size", "font-weight", "border-radius", "box-shadow", "letter-spacing", "line-height", "font-variation-settings",
]);
const SPACING_PROP = /^(gap|row-gap|column-gap|padding(-(top|right|bottom|left|block|inline)(-(start|end))?)?|margin(-(top|right|bottom|left|block|inline)(-(start|end))?)?)$/;
// Properties whose values can carry a colour: named colours are only checked here.
const COLOR_BEARING =
  /^(color|background(-.*)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-shadow|filter|backdrop-filter|caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?|mask(-image)?|scrollbar-color|text-emphasis(-color)?|flood-color|stop-color|lighting-color|-webkit-text-(fill|stroke)(-color)?)$/;
const KEYWORD_OK = new Set(["inherit", "initial", "unset", "revert", "normal", "none", "0"]);
// The single breakpoint literal (documented in tokens.css, defined once as NARROW_QUERY).
const NARROW_QUERY = /\(max-width:\s*720px\)/g;

/** Blank out comments (keeping offsets and newlines) so line numbers stay stable. */
function stripComments(text: string, lineComments: boolean): string {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) {
        out += n;
        i += 2;
        continue;
      }
      if (c === quote || (c === "\n" && quote !== "`")) quote = "";
      i++;
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (lineComments && c === "/" && n === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      if (c === '"' || c === "'" || (lineComments && c === "`")) quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

/** Replaces the contents of string literals with spaces (offsets preserved). */
function blankStrings(code: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === "\\") {
        out += "  ";
        i++;
      } else if (c === quote || (c === "\n" && quote !== "`")) {
        quote = "";
        out += c;
      } else out += c === "\n" ? c : " ";
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}

function isZero(len: string): boolean {
  return Number.parseFloat(len) === 0;
}

function rawLengths(value: string): string[] {
  return (value.replace(NARROW_QUERY, "").match(LENGTH) ?? []).filter((l) => !isZero(l));
}

function colorWords(value: string): string[] {
  const cleaned = value.replace(/var\([^)]*\)/g, "").replace(/url\([^)]*\)/g, "").replace(/(["'])(?:(?!\1).)*\1/g, "");
  // Whole identifiers (ease-in-out, red2 are single words) that are not function names (tan(...)).
  return (cleaned.match(/[a-z_][\w-]*(?![\w(-])(?!\s*\()/gi) ?? []).filter((w) => NAMED_COLORS.has(w.toLowerCase()));
}

function hasRawColor(value: string, namedToo: boolean): boolean {
  const noUrl = value.replace(/url\([^)]*\)/g, "");
  return HEX.test(noUrl) || COLOR_FN.test(noUrl) || (namedToo && colorWords(noUrl).length > 0);
}

/** Splits `inner` of a var(...) at the first top-level comma. */
function splitVar(inner: string): { name: string; fallback?: string } {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") depth++;
    else if (inner[i] === ")") depth--;
    else if (inner[i] === "," && depth === 0) return { name: inner.slice(0, i), fallback: inner.slice(i + 1) };
  }
  return { name: inner };
}

function fallbackRule(prop: string, fallback: string): Rule {
  if (prop === "font-family") return "font-family-literal";
  if (TOKEN_PROPS.has(prop)) return "raw-token-property";
  if (hasRawColor(fallback, true)) return "raw-color";
  return "raw-length";
}

function cssValueRules(prop: string, value: string): Rule[] {
  const rules: Rule[] = [];
  // Neutralise var(--x, fallback): fallbacks may only be empty, 0 or another var().
  let flat = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at < 0 || (at > 0 && /[\w-]/.test(value[at - 1]))) {
      if (at < 0) {
        flat += value.slice(i);
        break;
      }
      flat += value.slice(i, at + 4);
      i = at + 4;
      continue;
    }
    flat += value.slice(i, at);
    let depth = 0;
    let j = at + 3;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")" && --depth === 0) break;
    }
    const { name, fallback } = splitVar(value.slice(at + 4, j));
    flat += `var(${name.trim()})`;
    const f = fallback?.trim();
    if (f) {
      if (f.startsWith("var(")) rules.push(...cssValueRules(prop, f));
      else if (f !== "0") rules.push(fallbackRule(prop, f));
    }
    i = j + 1;
  }

  const custom = prop.startsWith("--");
  const withoutVars = flat.replace(/var\((?:[^()]|\([^()]*\))*\)/g, "").trim();
  if (custom) {
    // Outside tokens.css a custom property may only forward other tokens (var(...)) or be 0.
    if (withoutVars !== "" && value.trim() !== "0") {
      if (hasRawColor(flat, true)) rules.push("raw-color");
      else if (rawLengths(flat).length > 0) rules.push("raw-length");
      else rules.push("raw-token-property");
    }
    return rules;
  }
  if (prop === "font-family") {
    if (!/^var\(--[^()]*\)$/.test(flat.trim()) && flat.trim().toLowerCase() !== "inherit") rules.push("font-family-literal");
  } else if (prop === "font") {
    // shorthand: every component must be a var() (or the whole value `inherit`).
    if (withoutVars.replace(/\//g, "").trim() !== "" && flat.trim().toLowerCase() !== "inherit") rules.push("raw-token-property");
  } else if (TOKEN_PROPS.has(prop)) {
    if (
      (!flat.includes("var(") && !KEYWORD_OK.has(flat.toLowerCase())) ||
      rawLengths(flat).length > 0 ||
      hasRawNumber(withoutVars)
    ) {
      rules.push("raw-token-property");
    }
  } else if (rawLengths(flat).length > 0 || (SPACING_PROP.test(prop) && hasRawNumber(withoutVars))) {
    rules.push("raw-length");
  }
  if (hasRawColor(flat, COLOR_BEARING.test(prop))) rules.push("raw-color");
  return rules;
}

/** Raw numbers left once var() calls are removed; only 0, -1 and percentages may remain. */
function hasRawNumber(withoutVars: string): boolean {
  return withoutVars
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .split(/[\s(),*/+]+/)
    .some((t) => /^[-+]?\d*\.?\d+$/.test(t) && t !== "0" && t !== "-1" && t !== "+0");
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

type Hit = { offset: number; rule: Rule; text?: string };

function scanCss(text: string): Hit[] {
  const code = stripComments(text, false);
  const hits: Hit[] = [];
  let segStart = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ";" || c === "{" || c === "}")) {
      const seg = code.slice(segStart, i);
      const start = segStart;
      segStart = i + 1;
      if (c === "{") continue; // selector or at-rule prelude (@media conditions are exempt)
      const trimmed = seg.trim();
      if (!trimmed || trimmed.startsWith("@")) continue;
      const colon = trimmed.indexOf(":");
      if (colon < 0) continue;
      const prop = trimmed.slice(0, colon).trim().toLowerCase();
      if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) continue;
      const value = trimmed.slice(colon + 1).replace(/!important\s*$/i, "").replace(/\s+/g, " ").trim();
      if (!value) continue;
      const offset = start + (seg.length - seg.trimStart().length);
      const shown = trimmed.replace(/\s+/g, " ") + (c === ";" ? ";" : "");
      for (const rule of new Set(cssValueRules(prop, value))) hits.push({ offset, rule, text: shown });
    }
  }
  return hits;
}

const SIZE_TAGS = new Set(["svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "img", "ellipse", "text", "use"]);
const COLOR_ATTRS = "fill|stroke|color|stopColor|stop-color|floodColor|flood-color|lightingColor|lighting-color";
const SIZE_ATTRS = "stroke-width|strokeWidth|width|height";
const ATTR_VALUE = "(?:\"([^\"]*)\"|'([^']*)'|\\{\\s*(?:(-?[\\d.]+)|[\"']([^\"']*)[\"']|`([^`]*)`)\\s*\\})";
const ATTR_OK = new Set(["none", "currentcolor", "inherit", "transparent"]);
const isUrlRef = (v: string) => /^url\(#[\w-]+\)$/.test(v);

/** Finds JSX opening tags and returns tag name plus attribute text (brace and quote aware). */
function jsxTags(code: string): { tag: string; attrs: string; offset: number }[] {
  const out: { tag: string; attrs: string; offset: number }[] = [];
  for (const m of code.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    const attrStart = (m.index ?? 0) + m[0].length;
    let depth = 0;
    let quote = "";
    let end = code.length;
    for (let i = attrStart; i < code.length; i++) {
      const c = code[i];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth <= 0 && code[i - 1] !== "=") {
        end = i;
        break;
      }
    }
    out.push({ tag: m[1], attrs: code.slice(attrStart, end), offset: attrStart });
  }
  return out;
}

function scanScript(text: string): Hit[] {
  const code = stripComments(text, true);
  const hits: Hit[] = [];
  const add = (offset: number, rule: Rule) => hits.push({ offset, rule });

  for (const m of code.matchAll(/\bstyle=(?:\{|"|')/g)) add(m.index ?? 0, "inline-style");
  for (const m of blankStrings(code).matchAll(/<style[\s>/]/g)) add(m.index ?? 0, "inline-style");
  for (const m of code.matchAll(/\.\.\.\s*\{[^}]*\bstyle\s*:/g)) add(m.index ?? 0, "inline-style");
  for (const m of code.matchAll(/\.style\.[a-zA-Z]+\s*=(?!=)|\.style\.setProperty\s*\(|\.style\s*=(?!=)|setAttribute\(\s*["']style["']/g)) {
    add(m.index ?? 0, "inline-style");
  }
  for (const m of code.matchAll(/dangerouslySetInnerHTML|\.(?:inner|outer)HTML\s*=(?!=)/g)) add(m.index ?? 0, "dangerous-html");
  for (const m of code.matchAll(new RegExp(COLOR_FN.source, "gi"))) add(m.index ?? 0, "raw-color");

  for (const { tag, attrs, offset } of jsxTags(code)) {
    const intrinsic = SIZE_TAGS.has(tag);
    const attrRe = new RegExp(`(?<![\\w-])(${COLOR_ATTRS}|${SIZE_ATTRS})\\s*=\\s*${ATTR_VALUE}`, "g");
    for (const m of attrs.matchAll(attrRe)) {
      const name = m[1];
      const isColor = new RegExp(`^(?:${COLOR_ATTRS})$`).test(name);
      if (!isColor && !intrinsic) continue;
      let value = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? "").trim();
      if (m[6] !== undefined) value = value.replace(/\$\{[^}]*\}/g, "").trim(); // pure interpolation is fine
      if (ATTR_OK.has(value.toLowerCase()) || isUrlRef(value) || value === "" || value.endsWith("%") || value === "0") continue;
      if (isColor && !intrinsic && !hasRawColor(value, true)) continue; // component prop such as color="primary"
      add(offset + (m.index ?? 0), "raw-svg-attr");
    }
    // Colour attrs with an expression (ternaries, ...): every string literal inside must be a safe value.
    const exprRe = new RegExp(`(?<![\\w-])(?:${COLOR_ATTRS})\\s*=\\s*\\{`, "g");
    for (const m of attrs.matchAll(exprRe)) {
      let depth = 1;
      let k = (m.index ?? 0) + m[0].length;
      const begin = k;
      for (; k < attrs.length && depth > 0; k++) {
        if (attrs[k] === "{") depth++;
        else if (attrs[k] === "}") depth--;
      }
      const expr = attrs.slice(begin, k - 1);
      for (const lit of expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
        const v = (lit[1] ?? lit[2] ?? lit[3] ?? "").replace(/\$\{[^}]*\}/g, "").trim();
        if (!hasRawColor(v, true)) continue;
        add(offset + (m.index ?? 0), "raw-svg-attr");
      }
    }
  }
  return hits;
}

export function scanDesignRules(files: { path: string; text: string }[]): DesignViolation[] {
  const out: DesignViolation[] = [];
  for (const file of files) {
    const isCss = file.path.endsWith(".css");
    const starts = lineStarts(file.text);
    const original = file.text.split("\n");
    const hits = isCss ? scanCss(file.text) : scanScript(file.text);
    if (!isCss) {
      // raw lengths: line based (comments blanked); the narrow media-query literal is exempt.
      stripComments(file.text, true).split("\n").forEach((line, i) => {
        if (rawLengths(line).length > 0) hits.push({ offset: starts[i], rule: "raw-length" });
      });
    }
    const seen = new Set<string>();
    for (const h of hits) {
      const line = lineOf(starts, h.offset);
      const key = `${line}:${h.rule}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: file.path, line, rule: h.rule, text: h.text ?? original[line - 1].trim() });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}
