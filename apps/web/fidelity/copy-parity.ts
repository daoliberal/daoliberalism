/**
 * Fidelity Gate G1 core: every line of a prototype screen's rendered text must appear in the page the app renders.
 * Matching ignores whitespace and line breaks only (layout decides those); every other character must match.
 */
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import fs from "node:fs";
import { COPY_EXCEPTIONS, type CopyException } from "./exceptions";
import { renderPrototypeText } from "./prototype-render";

const PROTOTYPE_DIR = path.resolve(import.meta.dirname, "../prototype");

const squash = (s: string): string => s.replace(/\s+/g, "");

/** Absolute path of a prototype screen: accepts `C-09-Approval` or `C-09-Approval.dc.html`. */
export function prototypeFile(screenFile: string): string {
  const name = screenFile.replace(/\.dc\.html$/, "");
  if (!/^C-[A-Za-z0-9-]+$/.test(name)) throw new Error(`not a prototype screen name: ${screenFile}`);
  return path.join(PROTOTYPE_DIR, `${name}.dc.html`);
}

const isExcused = (screen: string, line: string, exceptions: readonly CopyException[]): boolean =>
  exceptions.some(
    (e) =>
      e.kind === "omitted" &&
      e.screen === screen &&
      (typeof e.line === "string" ? squash(e.line) === squash(line) : e.line.test(line)),
  );

/** Prototype lines that are neither on the page nor excused for that screen. */
export function missingLines(
  prototypeText: string,
  pageText: string,
  screen: string,
  exceptions: readonly CopyException[] = COPY_EXCEPTIONS,
): string[] {
  const haystack = squash(pageText);
  return prototypeText
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !haystack.includes(squash(line)) && !isExcused(screen, line, exceptions));
}

/**
 * A prototype render that yields no text (a wrong state value can hide the whole template) would make every comparison pass
 * with nothing checked, so it is an error. Returns the text unchanged otherwise.
 */
export function requirePrototypeLines(prototypeText: string, screen: string, state: Record<string, unknown> = {}): string {
  if (prototypeText.split("\n").every((line) => line.trim() === "")) {
    throw new Error(`${screen} ${JSON.stringify(state)}: the prototype rendered no text, so nothing would be compared`);
  }
  return prototypeText;
}

/**
 * Asserts copy parity between the open page and a prototype screen in the given state.
 * @param state  the prototype's `this.state` (e.g. `{ k: 'claim', phase: 'done' }`)
 * @param props  overrides for the prototype's `this.props` (e.g. `{ viewerIsFounder: false }`)
 * @param root   limits the compared text to this element (default: the whole body). Pass the dialog for approval gates so
 *               text from the page behind it cannot satisfy the comparison.
 */
export async function assertCopyParity(
  page: Page,
  screenFile: string,
  state: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
  root?: Locator,
): Promise<void> {
  const screen = path.basename(prototypeFile(screenFile), ".dc.html");
  const expected = requirePrototypeLines(
    renderPrototypeText(fs.readFileSync(prototypeFile(screenFile), "utf8"), state, props),
    screen,
    state,
  );
  const pageText = root ? await root.innerText() : await page.evaluate(() => document.body.innerText);
  const missing = missingLines(expected, pageText, screen);
  if (missing.length > 0) {
    throw new Error(
      `${screen} ${JSON.stringify(state)}: ${missing.length} prototype line(s) not on the page:\n${missing.map((l) => `  - ${l}`).join("\n")}`,
    );
  }
}
