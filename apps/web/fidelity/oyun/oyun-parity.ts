/**
 * Prototype fidelity for the game UI (/oyun): text and order of lines, not colors, fonts or sizes.
 * The prototype is `prototype/oyun/Main.dc.html`; its screen is chosen by state keys (`screen`, `bStep`, ...).
 */
import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { requirePrototypeLines } from "../copy-parity";
import { expectNoHorizontalScroll } from "../helpers";
import { renderPrototypeText } from "../prototype-render";
import { OYUN_EXCEPTIONS, type OyunException } from "./exceptions";

export { OYUN_EXCEPTIONS } from "./exceptions";

export const PROTOTYPE_FILE = path.resolve(import.meta.dirname, "../../prototype/oyun/Main.dc.html");
export const STATE_MARKER = "state = this.initialState();";

export type LineRange = { from: number; to: number };

/**
 * Replaces every digit run with `#`: the prototype's made-up numbers are not compared with recorded real ones.
 * Note: a line that is only digits or very short ("%24" becomes "%#", "Ara") matches almost anywhere once masked, so it checks little;
 * screen tasks may exclude such lines with `only`.
 */
export function maskDigits(line: string): string {
  return line.replace(/\d+/g, "#");
}

const squash = (text: string): string => maskDigits(text).replace(/\s+/g, " ").trim();

/**
 * The prototype's `state = this.initialState();` field initializer overwrites the state a stand-in base class assigns, so a passed
 * state would be ignored. The marker is replaced in memory with an Object.assign of the wanted state; the file is never written.
 */
export function patchPrototype(html: string, state: Record<string, unknown>): string {
  const count = html.split(STATE_MARKER).length - 1;
  if (count !== 1) throw new Error(`prototype must contain "${STATE_MARKER}" exactly once, found ${count}`);
  // `editorDraft: true` (not a prototype key): the in-game editor overlay needs `values` set (initially null), a clone of `draft` that JSON cannot express.
  // `readerDraft: true` (not a prototype key): the Şart reader needs a started run (`segs`, `versions`), which JSON cannot express either.
  const { editorDraft, readerDraft, ...rest } = state;
  const json = JSON.stringify(rest);
  const patched =
    readerDraft === true
      ? `state = (() => { const s = Object.assign(this.initialState(), ${json}); s.values = this.clone(s.draft); s.segs = [this.firstSeg(s.values)]; s.versions = [{ v: 1, from: 0, values: this.clone(s.values) }]; return s; })();`
      : editorDraft === true
      ? `state = (() => { const s = Object.assign(this.initialState(), ${json}); s.values = this.clone(s.draft); return s; })();`
      : `state = Object.assign(this.initialState(), ${json});`;
  return html.replace(STATE_MARKER, () => patched);
}

/** Non-empty lines of the prototype screen in the given state (unfiltered, 1-based numbering = array index + 1). */
export function oyunPrototypeText(state: Record<string, unknown>): string {
  const html = patchPrototype(fs.readFileSync(PROTOTYPE_FILE, "utf8"), state);
  const text = renderPrototypeText(html, {});
  return requirePrototypeLines(text, "oyun", state);
}

function applyException(screen: string, line: string, exceptions: readonly OyunException[]): string | null {
  let current = line;
  for (const e of exceptions) {
    if (e.screen !== screen) continue;
    if (e.kind === "omit") {
      const masked = squash(current);
      if (typeof e.line === "string" ? masked === squash(e.line) : e.line.test(current)) return null;
    } else {
      current = typeof e.line === "string" ? current.split(e.line).join("") : current.replace(e.line, "");
    }
  }
  return current.trim() === "" ? null : current;
}

/**
 * The prototype lines a page must show: non-empty lines, restricted to `only` (1-based ranges over the non-empty lines),
 * minus omitted ones and with stripped parts removed. Each result keeps its original line number.
 */
export function expectedLines(
  state: Record<string, unknown>,
  screen: string,
  only?: LineRange[],
  exceptions: readonly OyunException[] = OYUN_EXCEPTIONS,
): { n: number; text: string }[] {
  const lines = oyunPrototypeText(state)
    .split("\n")
    .filter((l) => l.trim() !== "");
  const out: { n: number; text: string }[] = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    if (only && !only.some((r) => n >= r.from && n <= r.to)) return;
    const kept = applyException(screen, line, exceptions);
    if (kept !== null) out.push({ n, text: kept });
  });
  return out;
}

/** Pure comparison: missing lines and the first order break. Exposed so the parity logic can be checked without a browser. */
export function compareLines(
  expected: { n: number; text: string }[],
  pageText: string,
): { missing: string[]; orderBreak: string | null } {
  const hay = squash(pageText);
  const missing: string[] = [];
  let orderBreak: string | null = null;
  // Greedy: each line is searched from where the previous found line ended, so a line whose text also occurs earlier
  // (a nav label, a repeated word) is not mistaken for an order break. Only when it exists solely before the cursor is the order wrong.
  let cursor = 0;
  let prev: { n: number; text: string } | null = null;
  for (const e of expected) {
    const needle = squash(e.text);
    if (needle === "") continue;
    const at = hay.indexOf(needle, cursor);
    if (at !== -1) {
      cursor = at + needle.length;
      prev = e;
    } else if (hay.includes(needle)) {
      orderBreak ??= `order broken: #${prev?.n} "${prev?.text}" must come before #${e.n} "${e.text}"`;
    } else {
      missing.push(`#${e.n}: ${e.text}`);
    }
  }
  return { missing, orderBreak };
}

/**
 * Asserts the open page carries the prototype screen's lines (digits masked) in the prototype's order, and does not scroll sideways.
 * @param state  prototype state, e.g. `{ screen: "builder", bStep: 0 }`
 * @param opts.screen  screen name used for exceptions
 * @param opts.only    1-based ranges over the prototype's non-empty lines; when given only those lines (and their order) are checked
 * @param opts.root    limits the compared text to this element (default: body)
 * @param opts.width   viewport width for the scroll check (default: the page's viewport width)
 */
export async function assertOyunParity(
  page: Page,
  state: Record<string, unknown>,
  opts: { screen: string; root?: Locator; width?: number; only?: LineRange[] },
): Promise<void> {
  const expected = expectedLines(state, opts.screen, opts.only);
  expect(expected.length, `${opts.screen} ${JSON.stringify(state)}: no prototype lines selected`).toBeGreaterThan(0);
  const pageText = await (opts.root ?? page.locator("body")).innerText();
  const { missing, orderBreak } = compareLines(expected, pageText);
  expect(missing, `${opts.screen}: prototype lines missing from the page`).toEqual([]);
  expect(orderBreak, `${opts.screen}: line order`).toBeNull();
  const width = opts.width ?? page.viewportSize()?.width;
  if (width === undefined) throw new Error("no viewport width; pass opts.width");
  await expectNoHorizontalScroll(page, width);
}
