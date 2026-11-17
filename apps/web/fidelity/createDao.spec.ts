/**
 * Fidelity gate for /daos/new/ against C-06-CreateDAO.
 * G1 copy per step ({step: N} is passed: the prototype's design-tool default is step 2, the app opens at step 1);
 * G2 computed styles from the prototype's inline styles; G3 layout at 1280 and 390; G4 screenshots; G5 axe in both themes.
 */
import { expect, test, type Page } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import {
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  expectStyles,
  expectToken,
  expectTouchTargets,
  gotoApp,
  isProject,
  screenshotPair,
} from "./helpers";

const PROTO = "C-06-CreateDAO";
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function openAtStep(page: Page, step: 1 | 2 | 3) {
  await gotoApp(page, "/daos/new/", { wallet: "owner" });
  await expect(page.getByLabel("Name")).toBeVisible();
  if (step >= 2) await next(page);
  if (step === 3) await next(page);
}

test.describe("C-06 desktop (G1, G2)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  for (const step of [1, 2, 3] as const) {
    test(`G1 copy: step ${step}`, async ({ page }) => {
      await openAtStep(page, step);
      await assertCopyParity(page, PROTO, { step });
    });
  }

  test("G2 page head, stepper and card", async ({ page }) => {
    await openAtStep(page, 1);
    const h1 = page.getByRole("heading", { level: 1 });
    await expectStyles(h1, { "font-size": "44px", "font-weight": "700", "line-height": "46.2px", "letter-spacing": "-0.88px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectToken(h1, "font-size", "--fs-44");
    await expectStyles(page.locator("main"), { "max-width": "960px", "padding-top": "28px", "padding-left": "32px", "padding-bottom": "80px", "row-gap": "24px" });
    await expectStyles(page.getByText("A DAO is a company your agents work in."), { "margin-top": "8px", color: "rgb(61, 73, 84)", "max-width": "620px" });
    const current = page.getByRole("list", { name: "Steps" }).getByRole("button", { name: /Details/ });
    await expectStyles(current, { "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "min-height": "44px", "font-size": "15px", "padding-right": "16px", "padding-left": "6px" });
    const card = page.getByRole("heading", { level: 2, name: "About the DAO" }).locator("xpath=ancestor::section[1]");
    await expectStyles(card, { "background-color": "rgb(255, 255, 255)", "border-top-width": "1px", "border-top-color": "rgb(213, 219, 224)", "border-top-left-radius": "24px", "padding-top": "28px", "padding-left": "28px", "row-gap": "20px" });
    await expectStyles(page.getByRole("heading", { level: 2, name: "About the DAO" }), { "font-size": "22px", "font-weight": "700" });
  });

  test("G2 fields", async ({ page }) => {
    await openAtStep(page, 1);
    const name = page.getByLabel("Name");
    await expectStyles(name, { "font-size": "17px" });
    await expectStyles(name.locator("xpath=.."), { height: "48px", "border-top-left-radius": "12px", "border-top-color": "rgb(195, 203, 210)" });
    await expectStyles(name, { "padding-left": "14px" });
    const desc = page.getByLabel("What it does");
    await expectStyles(desc, { "padding-top": "12px", "padding-left": "14px" });
    await expect(desc).toHaveAttribute("rows", "3");
    await expectStyles(page.getByText("Descriptions can't be edited after creation in Phase 1."), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    const web = page.getByLabel("Website (where customers pay)");
    await expectStyles(web, { "font-size": "16px" });
    await expectStyles(web.locator("xpath=.."), { height: "48px" });
    const meta = page.getByLabel("Metadata URL");
    await expect(meta).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const select = page.getByLabel("Founder agent");
    await expectStyles(select, { "font-size": "16px", "padding-left": "12px" });
    await expectStyles(select.locator("xpath=.."), { height: "48px", "background-color": "rgb(255, 255, 255)", "border-top-left-radius": "12px" });
    await expectStyles(page.getByText("Name", { exact: true }), { "font-weight": "700" });
  });

  test("G2 treasury cards", async ({ page }) => {
    await openAtStep(page, 2);
    await expectStyles(page.getByText("Joining is free."), { color: "rgb(61, 73, 84)" });
    const lean = page.getByRole("button", { name: /Lean Guild/ });
    await expectStyles(lean, { "border-top-width": "2px", "border-top-color": "rgb(11, 107, 93)", "background-color": "rgb(242, 248, 246)", "border-top-left-radius": "18px", "padding-top": "18px", "padding-left": "20px", "column-gap": "28px", "row-gap": "12px", "text-align": "left" });
    const common = page.getByRole("button", { name: /Commonwealth/ });
    await expectStyles(common, { "border-top-color": "rgb(213, 219, 224)", "background-color": "rgb(255, 255, 255)" });
    await expectStyles(lean.getByText("Lean Guild", { exact: true }), { "font-size": "19px", "font-weight": "700" });
    const rules = lean.getByText("1% fee · 0% exp · 14-day hold · Equal");
    await expectStyles(rules, { "font-size": "13px", color: "rgb(51, 64, 76)" });
    await expect(rules).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(lean.getByText("Per 1 ETH to owners"), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    const mem = lean.getByText("0.99");
    await expectStyles(mem, { "font-size": "22px", color: "rgb(11, 107, 93)" });
    await expect(mem).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(lean.getByText("63"), { "font-size": "18px" });
    await expectStyles(lean.getByText("Selected"), { "font-size": "14px", "font-weight": "700", color: "rgb(11, 107, 93)" });
    await expectStyles(page.getByRole("link", { name: "Compare treasuries in detail" }), { "font-weight": "700", color: "rgb(11, 107, 93)" });
  });

  test("G2 confirm step and footer", async ({ page }) => {
    await openAtStep(page, 3);
    const founder = page.getByText("Founder agent", { exact: true });
    await expectStyles(founder.locator("xpath=.."), { "border-top-width": "1px", "border-top-color": "rgb(226, 231, 235)", "border-top-left-radius": "14px", "padding-top": "14px" });
    await expectStyles(page.getByText("Ox‑Relay", { exact: true }), { "font-weight": "700" });
    const rules = page.getByText("1% fee · 0% exp · 14-day hold · Equal");
    await expectStyles(rules, { "font-size": "14px" });
    const note = page.getByRole("note");
    await expectStyles(note, { "border-top-width": "2px", "border-top-color": "rgb(138, 59, 9)", "background-color": "rgb(253, 240, 228)", "border-top-left-radius": "18px", "padding-top": "20px", "row-gap": "12px" });
    await expectStyles(note.getByText("This choice is final in Phase 1"), { "font-size": "18px", "font-weight": "700", color: "rgb(107, 44, 5)" });
    await expectStyles(note.getByText(/cannot leave/), { color: "rgb(90, 42, 11)", "margin-top": "0px" });
    const create = page.getByRole("button", { name: "Create DAO and sign" });
    // The pointer is still where "Continue" was, i.e. over this button: park it elsewhere so :hover does not colour it.
    await page.mouse.move(0, 0);
    await expectStyles(create, { "background-color": "rgb(213, 219, 224)", color: "rgb(79, 91, 102)", "min-height": "48px", "padding-left": "24px" });
    await note.getByRole("checkbox").check();
    await expectStyles(create, { "background-color": "rgb(11, 107, 93)", color: "rgb(255, 255, 255)" });
    await expectStyles(create.locator("xpath=.."), { "border-top-width": "1px", "border-top-color": "rgb(226, 231, 235)", "padding-top": "18px", "justify-content": "space-between" });
    await expectStyles(page.getByRole("button", { name: "Back" }), { "background-color": "rgb(255, 255, 255)", "min-height": "48px", "padding-left": "20px" });
  });
});

test.describe("C-06 layout, screenshots, accessibility (both projects)", () => {
  test("G3 no sideways scroll on every step", async ({ page }, info) => {
    const width = isProject(info, "mobile-dark") ? 390 : 1280;
    for (const step of [1, 2, 3] as const) {
      await openAtStep(page, step);
      await expectNoHorizontalScroll(page, width);
    }
  });

  test("G3 touch targets are at least 44px", async ({ page }) => {
    await openAtStep(page, 1);
    await expectTouchTargets(page, ["input[type=checkbox]", "nav[aria-label=Breadcrumb] a"]);
    await openAtStep(page, 2);
    await expectTouchTargets(page, ["input[type=checkbox]", "nav[aria-label=Breadcrumb] a"]);
    await openAtStep(page, 3);
    await expectTouchTargets(page, ["input[type=checkbox]", "nav[aria-label=Breadcrumb] a"]);
  });

  test("G4 screenshots and G5 axe: every step", async ({ page }, info) => {
    for (const step of [1, 2, 3] as const) {
      await openAtStep(page, step);
      await screenshotPair(page, info, `create-dao-${step}`);
      await expectNoA11yViolations(page);
    }
  });

  test("G5 axe with a full treasury in the picker", async ({ page }) => {
    // Fill a treasury through the app: deploy one with a single seat, then create a DAO under it. Moving between the two
    // pages uses the in-app links (a full page load would reset the in-memory mock state).
    await gotoApp(page, "/treasuries/new/", { wallet: "owner" });
    await page.getByLabel("Treasury name").fill("Solo Seat");
    await page.getByLabel("Max agents").fill("1");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Deploy and sign" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Deploy and sign", exact: true }).click();
    await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "DAOs" }).click();
    await expect(page).toHaveURL(/\/daos\/$/);
    await page.getByRole("main").getByRole("link", { name: "Create a DAO" }).click();
    await expect(page).toHaveURL(/\/daos\/new\/$/);
    await expect(page.getByLabel("Name")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /Solo Seat/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create DAO and sign" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create and sign", exact: true }).click();
    await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await page.getByRole("list", { name: "Steps" }).getByRole("button", { name: /Choose treasury/ }).click();
    const full = page.getByRole("button", { name: /Solo Seat/ });
    await expect(full).toHaveAttribute("aria-disabled", "true");
    await expect(full.getByText("No seats left under this treasury")).toBeVisible();
    await full.focus();
    await expect(full).toBeFocused();
    await expectNoA11yViolations(page);
  });
});
