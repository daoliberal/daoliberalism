/**
 * Renders the visible text of a prototype screen (apps/web/prototype/*.dc.html) without a browser.
 *
 * The prototype files are design-tool templates: markup with `{{expr}}` bindings, `<sc-for list as>` and `<sc-if value>`,
 * plus a `<script type="text/x-dc">` that defines `class Component extends DCLogic { renderVals() {...} }`. They cannot
 * render here (no support.js), so this module runs that class with a stand-in `DCLogic`, expands the template in jsdom
 * and returns the text a reader would see: script/style/svg are dropped and every block-level box starts a new line.
 *
 * The files are local, committed and trusted, which is why the class is evaluated with `new Function`.
 */
import { JSDOM } from "jsdom";

type Dict = Record<string, unknown>;

/** Elements whose content is never visible text. */
const SKIPPED = new Set(["script", "style", "svg", "helmet", "template", "head", "noscript", "title", "link", "meta"]);

/** Elements that start their own line (everything else is inline text unless its own or its parent's display says otherwise). */
const BLOCK_TAGS = new Set([
  "x-dc", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "section", "article", "header",
  "footer", "nav", "main", "aside", "form", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "button", "input",
  "select", "option", "textarea", "fieldset", "legend", "figure", "figcaption", "summary", "details", "blockquote", "pre", "hr",
]);

/** Stand-in for the design tool's runtime base class: just carries props and state. */
class DCLogic {
  props: Dict;
  state: Dict;
  constructor(props: Dict, state: Dict) {
    this.props = props;
    this.state = state;
  }
  setState(patch: Dict): void {
    Object.assign(this.state, patch);
  }
}

/** Default value of every declared prop in `data-props` (keys starting with `$` are design-tool metadata). */
function propDefaults(dataProps: string | null): Dict {
  if (!dataProps) return {};
  const declared = JSON.parse(dataProps) as Dict;
  const out: Dict = {};
  for (const [key, spec] of Object.entries(declared)) {
    if (key.startsWith("$")) continue;
    if (spec && typeof spec === "object" && "default" in spec) out[key] = (spec as { default: unknown }).default;
  }
  return out;
}

function runComponent(doc: Document, state: Dict, props: Dict): Dict {
  const script = doc.querySelector("script[data-dc-script]");
  if (!script) throw new Error("prototype has no <script data-dc-script>");
  const defaults = propDefaults(script.getAttribute("data-props"));
  const make = new Function("DCLogic", `${script.textContent ?? ""}\nreturn Component;`) as (base: typeof DCLogic) => new (
    p: Dict,
    s: Dict,
  ) => { renderVals(): Dict };
  const Component = make(DCLogic);
  return new Component({ ...defaults, ...props }, { ...state }).renderVals();
}

type Scope = Dict;

/** Resolves a dotted path against the scope chain. The first segment must exist; later missing keys read as undefined. */
function lookup(path: string, scope: Scope, strict: boolean): unknown {
  const text = path.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "undefined") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  const quoted = /^(['"])(.*)\1$/.exec(text);
  if (quoted) return quoted[2];
  const segments = text.split(".");
  const head = segments[0] ?? "";
  if (!(head in scope)) throw new Error(`prototype binding "${text}" is not defined (no "${head}" in renderVals or the loop scope)`);
  let value: unknown = scope[head];
  for (const key of segments.slice(1)) {
    if (value === null || value === undefined) return undefined;
    const obj = value as Dict;
    if (strict && typeof value === "object" && !(key in obj)) throw new Error(`prototype binding "${text}" is not defined (no "${key}")`);
    value = obj[key];
  }
  return value;
}

function evalCondition(raw: string | null, scope: Scope): boolean {
  const match = /^\s*\{\{\s*(!?)\s*([^}]*?)\s*\}\}\s*$/.exec(raw ?? "");
  if (!match) throw new Error(`unsupported sc-if value: ${raw}`);
  const truthy = Boolean(lookup(match[2] ?? "", scope, false));
  return match[1] === "!" ? !truthy : truthy;
}

function expandText(text: string, scope: Scope): string {
  return text.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_all, expr: string) => {
    const v = lookup(expr, scope, true);
    return v === undefined || v === null ? "" : String(v);
  });
}

function ownDisplay(el: Element): string {
  const match = /(?:^|;)\s*display\s*:\s*([a-z-]+)/i.exec(el.getAttribute("style") ?? "");
  return (match?.[1] ?? "").toLowerCase();
}

const isFlexLike = (display: string): boolean => /^(inline-)?(flex|grid)$/.test(display);

class Lines {
  private done: string[] = [];
  private current = "";
  add(text: string): void {
    this.current += text;
  }
  flush(): void {
    const line = this.current.replace(/\s+/g, " ").trim();
    if (line) this.done.push(line);
    this.current = "";
  }
  result(): string {
    this.flush();
    return this.done.join("\n");
  }
}

function walk(node: Node, scope: Scope, parentFlex: boolean, out: Lines): void {
  if (node.nodeType === 3) {
    out.add(expandText(node.textContent ?? "", scope));
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const name = el.localName;
  if (SKIPPED.has(name)) return;

  if (name === "sc-if") {
    if (evalCondition(el.getAttribute("value"), scope)) for (const child of Array.from(el.childNodes)) walk(child, scope, parentFlex, out);
    return;
  }
  if (name === "sc-for") {
    const listMatch = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/.exec(el.getAttribute("list") ?? "");
    const as = el.getAttribute("as");
    if (!listMatch || !as) throw new Error("sc-for needs list=\"{{expr}}\" and as=\"name\"");
    const list = lookup(listMatch[1] ?? "", scope, false);
    if (!Array.isArray(list)) throw new Error(`sc-for list "${listMatch[1]}" is not an array`);
    for (const item of list) {
      const inner: Scope = Object.create(scope) as Scope;
      inner[as] = item;
      for (const child of Array.from(el.childNodes)) walk(child, inner, parentFlex, out);
    }
    return;
  }
  if (name === "br") {
    out.flush();
    return;
  }

  const display = ownDisplay(el);
  const block = parentFlex || BLOCK_TAGS.has(name) || (display !== "" && !display.startsWith("inline"));
  if (block) out.flush();
  for (const child of Array.from(el.childNodes)) walk(child, scope, isFlexLike(display), out);
  if (block) out.flush();
}

/**
 * Visible text of a prototype screen, one block per line.
 * @param state  what the design tool would hold as `this.state` (e.g. `{ k: 'claim', phase: 'done' }`)
 * @param props  overrides for `this.props` (defaults come from the file's `data-props`, e.g. `{ viewerIsFounder: false }`)
 */
export function renderPrototypeText(prototypeHtml: string, state: Dict = {}, props: Dict = {}): string {
  const doc = new JSDOM(prototypeHtml).window.document;
  const vals = runComponent(doc, state, props);
  const root = doc.querySelector("x-dc") ?? doc.body;
  const out = new Lines();
  walk(root, vals as Scope, false, out);
  const text = out.result();
  if (text.includes("{{")) throw new Error(`unexpanded binding left in the rendered text: ${text.slice(text.indexOf("{{"), text.indexOf("{{") + 60)}`);
  return text;
}
