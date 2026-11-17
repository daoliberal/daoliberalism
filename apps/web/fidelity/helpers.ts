/**
 * Shared helpers for the fidelity gates (G2 metrics, G3 layout, G4 screenshots, G5 accessibility) and for e2e specs.
 * Runs in Playwright (Node); nothing here ships with the app.
 *
 * Projects: "desktop-light" (1280x900, light) and "mobile-dark" (390x844, dark). A screen spec gates itself, e.g.
 *   test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export type ProjectName = "desktop-light" | "mobile-dark";
export const OUT_DIR = path.resolve(import.meta.dirname, "out");

export const isProject = (info: TestInfo, name: ProjectName): boolean => info.project.name === name;

/** "1280-light" or "390-dark": the designed pair of the current project (Global Constraints, Theme). */
export const designedPair = (info: TestInfo): "1280-light" | "390-dark" => (isProject(info, "mobile-dark") ? "390-dark" : "1280-light");

/** Waits until `useIsNarrow` has written `data-layout` (phones show the wide layout for an instant after hydration). */
export async function waitForLayout(page: Page, layout?: "wide" | "narrow"): Promise<void> {
  await page.waitForFunction(
    (want) => {
      const got = document.documentElement.dataset.layout;
      return want ? got === want : got === "wide" || got === "narrow";
    },
    layout,
  );
}

/**
 * Opens a route (path and query as in the app, e.g. "/treasury/?a=0x4f2a…") and waits for the layout.
 * `wallet` connects the mock persona through `?mockWallet=`; fonts are awaited so metrics are final.
 */
export async function gotoApp(page: Page, route: string, opts: { wallet?: "owner" | "founder" } = {}): Promise<void> {
  const url = new URL(route, "http://placeholder.invalid");
  if (opts.wallet) url.searchParams.set("mockWallet", opts.wallet);
  await page.goto(`${url.pathname}${url.search}${url.hash}`);
  await waitForLayout(page);
  await page.evaluate(() => document.fonts.ready);
}

/** G2: the computed value of `property` equals what the token resolves to in this element's context. */
export async function expectToken(target: Locator, property: string, token: string): Promise<void> {
  const [actual, expected] = await target.evaluate(
    (el, { property, token }) => {
      // A token that tokens.css does not define would make an inherited property fall back to the element's own value and
      // pass for the wrong reason, so the token itself must resolve first.
      if (getComputedStyle(document.documentElement).getPropertyValue(token).trim() === "") {
        throw new Error(`token ${token} is not defined in tokens.css`);
      }
      // The probe is a child so em-based tokens (letter-spacing) resolve against the same font size.
      const probe = document.createElement("span");
      probe.style.setProperty(property, `var(${token})`);
      el.appendChild(probe);
      const expectedValue = getComputedStyle(probe).getPropertyValue(property);
      probe.remove();
      return [getComputedStyle(el).getPropertyValue(property), expectedValue];
    },
    { property, token },
  );
  expect(actual, `${property} should resolve ${token}`).toBe(expected);
}

/** G2: literal computed values taken from the prototype's inline style, e.g. { "font-size": "46px", "border-radius": "20px" }. */
export async function expectStyles(target: Locator, expected: Record<string, string>): Promise<void> {
  const actual = await target.evaluate(
    (el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])),
    Object.keys(expected),
  );
  expect(actual).toEqual(expected);
}

/** G2: every visible button, input, select and nav link is at least 44px tall. `allow` lists selectors that are exempt. */
export async function expectTouchTargets(page: Page, allow: string[] = []): Promise<void> {
  const small = await page.evaluate((allowed) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, input, select, nav a")) {
      if (allowed.some((s) => el.matches(s))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 - 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 30)}" ${Math.round(r.height)}px`);
    }
    return out;
  }, allow);
  expect(small, "targets under 44px").toEqual([]);
}

/** G3: at the given viewport width nothing makes the page scroll sideways. */
export async function expectNoHorizontalScroll(page: Page, width: number): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

/** G3: number of grid/flex columns a container lays its children out in (distinct left offsets of visible children). */
export async function columnCount(container: Locator): Promise<number> {
  return container.evaluate((el) => new Set(Array.from(el.children).filter((c) => c.getBoundingClientRect().width > 0).map((c) => Math.round(c.getBoundingClientRect().left))).size);
}

/** G4: writes fidelity/out/<name>-<1280-light|390-dark>.png (git-ignored) for the human comparison. */
export async function screenshotPair(page: Page, info: TestInfo, name: string): Promise<string> {
  await waitForLayout(page, isProject(info, "mobile-dark") ? "narrow" : "wide");
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}-${designedPair(info)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/**
 * G5: axe (wcag2a + wcag2aa) finds nothing in the designed theme and, after switching `data-theme`, in the other one.
 * The override is applied after `data-layout` exists so `useIsNarrow` cannot overwrite it.
 */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  await waitForLayout(page);
  const scan = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(await scan(), "axe, designed theme").toEqual([]);
  const designed = await page.evaluate(() => document.documentElement.dataset.theme ?? "light");
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme === "dark" ? "light" : "dark";
  }, designed);
  expect(await scan(), "axe, other theme").toEqual([]);
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
  }, designed);
}
