/**
 * Fidelity gate for /treasuries/new/ against C-04-CreateTreasury.
 * G1 copy per state (step 1, 1 over the limit, 2 equal, 2 custom, 3); G2 computed styles from the prototype's inline
 * styles; G3 layout at 1280 and 390; G4 screenshots; G5 axe in both themes.
 * The touch-target check is a separate test so a primitive-level failure (Field control height) shows up on its own.
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

const PROTO = "C-04-CreateTreasury";
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

async function openAtStep(page: Page, step: 1 | 2 | 3, opts: { custom?: boolean } = {}) {
  await gotoApp(page, "/treasuries/new/", { wallet: "owner" });
  if (step >= 2) await next(page);
  if (opts.custom) await page.getByRole("button", { name: /Custom rule contract/ }).click();
  if (step === 3) await next(page);
}

test.describe("C-04 desktop (G1, G2)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 copy: step 1", async ({ page }) => {
    await openAtStep(page, 1);
    await assertCopyParity(page, PROTO, { step: 1 });
  });

  test("G1 copy: step 1 over the 100% limit", async ({ page }) => {
    await openAtStep(page, 1);
    await page.getByLabel("Treasury fee", { exact: true }).fill("60");
    await page.getByLabel("Expenses", { exact: true }).fill("50");
    await assertCopyParity(page, PROTO, { step: 1, fee: "60", exp: "50" });
  });

  test("G1 copy: step 2 equal split", async ({ page }) => {
    await openAtStep(page, 2);
    await assertCopyParity(page, PROTO, { step: 2 });
  });

  test("G1 copy: step 2 custom rule", async ({ page }) => {
    await openAtStep(page, 2, { custom: true });
    await assertCopyParity(page, PROTO, { step: 2, split: "custom" });
  });

  test("G1 copy: step 3", async ({ page }) => {
    await openAtStep(page, 3);
    await assertCopyParity(page, PROTO, { step: 3 });
  });

  test("G2 page head, stepper and form card", async ({ page }) => {
    await openAtStep(page, 1);
    const h1 = page.getByRole("heading", { level: 1 });
    await expectStyles(h1, { "font-size": "44px", "font-weight": "700", "line-height": "46.2px", "letter-spacing": "-0.88px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectToken(h1, "font-size", "--fs-44");
    await expectStyles(page.locator("main"), { "max-width": "1200px", "padding-top": "28px", "padding-left": "32px", "padding-bottom": "80px", "row-gap": "24px" });
    await expectStyles(page.getByText("You are writing an economic model."), { "margin-top": "8px", color: "rgb(61, 73, 84)", "max-width": "640px" });
    const steps = page.getByRole("list", { name: "Steps" });
    await expectStyles(steps, { gap: "8px" });
    const current = steps.getByRole("button", { name: /Economics/ });
    await expectStyles(current, { "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "border-top-color": "rgb(18, 24, 31)", "min-height": "44px", "font-size": "15px", "font-weight": "700", "padding-right": "16px", "padding-left": "6px", "column-gap": "10px" });
    const todo = steps.getByRole("button", { name: /Split rule/ });
    await expectStyles(todo, { "background-color": "rgb(255, 255, 255)", "border-top-color": "rgb(195, 203, 210)" });
    await expectStyles(current.locator("span"), { width: "30px", height: "30px", "background-color": "rgb(255, 255, 255)", color: "rgb(18, 24, 31)", "font-size": "13px" });
    const card = page.getByRole("heading", { level: 2, name: "Name and economics" }).locator("xpath=ancestor::section[1]");
    await expectStyles(card, { "background-color": "rgb(255, 255, 255)", "border-top-width": "1px", "border-top-color": "rgb(213, 219, 224)", "border-top-left-radius": "24px", "padding-top": "28px", "padding-left": "28px", "row-gap": "22px" });
    await expectStyles(page.getByRole("heading", { level: 2, name: "Name and economics" }), { "font-size": "22px", "font-weight": "700" });
  });

  test("G2 fields", async ({ page }) => {
    await openAtStep(page, 1);
    const name = page.getByLabel("Treasury name");
    await expectStyles(name, { "font-size": "17px" });
    const box = name.locator("xpath=..");
    await expectStyles(box, { height: "48px", "border-top-left-radius": "12px", "border-top-color": "rgb(195, 203, 210)", "border-top-width": "1px" });
    // the 14px inset sits on the control itself, so the whole box is clickable
    await expectStyles(name, { "padding-left": "14px", "font-size": "17px" });
    await expectStyles(page.getByText("Treasury name", { exact: true }), { "font-weight": "700" });
    for (const label of ["Treasury fee", "Expenses", "Hold period", "Max agents"]) {
      const input = page.getByLabel(label, { exact: true });
      await expectStyles(input, { "font-size": "18px" });
      await expect(input).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
      await expectStyles(input.locator("xpath=.."), { height: "48px", "column-gap": "6px" });
    }
    await expectStyles(page.getByText("Share of every payment kept by the treasury."), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    const desc = page.getByLabel("Description");
    await expectStyles(desc, { "padding-top": "12px", "padding-left": "14px" });
    await expectStyles(desc.locator("xpath=.."), { "border-top-left-radius": "12px" });
  });

  test("G2 limit alert, footer and live preview", async ({ page }) => {
    await openAtStep(page, 1);
    await page.getByLabel("Treasury fee", { exact: true }).fill("60");
    await page.getByLabel("Expenses", { exact: true }).fill("50");
    await expectStyles(page.getByRole("alert").filter({ hasText: "Fee and expenses" }), { "background-color": "rgb(253, 240, 228)", color: "rgb(138, 59, 9)", "font-weight": "700", "border-top-left-radius": "12px", "padding-top": "12px", "padding-left": "14px" });
    await page.getByLabel("Treasury fee", { exact: true }).fill("2");
    await page.getByLabel("Expenses", { exact: true }).fill("1");
    const cont = page.getByRole("button", { name: "Continue" });
    await expectStyles(cont, { "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "min-height": "48px", "padding-left": "24px", "border-top-left-radius": "999px", "font-weight": "700" });
    const cancel = page.getByRole("link", { name: "Cancel" });
    await expectStyles(cancel, { "background-color": "rgb(255, 255, 255)", "border-top-color": "rgb(195, 203, 210)", "min-height": "48px", "padding-left": "20px", "font-weight": "700", color: "rgb(18, 24, 31)" });
    await expectStyles(cont.locator("xpath=.."), { "border-top-width": "1px", "border-top-color": "rgb(226, 231, 235)", "padding-top": "18px", "justify-content": "space-between", gap: "10px" });

    const aside = page.getByRole("complementary");
    await expectStyles(aside, { "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "border-top-left-radius": "24px", "padding-top": "24px", "padding-left": "24px", "row-gap": "16px" });
    await expectStyles(aside.getByText("LIVE PREVIEW"), { "font-size": "13px", color: "rgb(195, 203, 210)", "font-weight": "700", "letter-spacing": "0.52px" });
    const title = aside.getByRole("heading", { level: 2 });
    await expectStyles(title, { "font-size": "22px", "font-weight": "700" });
    await expect(title).toHaveCSS("font-family", /Bricolage Grotesque/);
    const bar = aside.getByRole("img");
    await expectStyles(bar, { height: "12px", "border-top-left-radius": "6px", "column-gap": "2px" });
    const slices = bar.locator("> div");
    await expectStyles(slices.nth(0), { "background-color": "rgb(255, 255, 255)" });
    await expectStyles(slices.nth(1), { "background-color": "rgb(141, 154, 166)" });
    await expectStyles(slices.nth(2), { "background-color": "rgb(63, 183, 157)" });
    await expectStyles(aside.getByText("Customer pays").locator("xpath=.."), { "font-size": "15px", "padding-top": "8px", "border-bottom-width": "1px", "border-bottom-color": "rgb(44, 54, 64)" });
    await expectStyles(aside.getByText("Customer pays"), { color: "rgb(195, 203, 210)" });
    await expectStyles(aside.getByText("1.00"), { "font-size": "15px" });
    const rest = aside.getByText("0.97");
    await expectStyles(rest, { color: "rgb(111, 214, 192)", "font-size": "20px" });
    await expect(rest).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const sentence = aside.getByText(/Split equally among members’ owners/);
    await expectStyles(sentence, { "background-color": "rgb(28, 37, 46)", "border-top-left-radius": "12px", "padding-top": "12px", "padding-left": "14px", "font-size": "14px", color: "rgb(226, 231, 235)" });
    await expectStyles(aside.getByText("This is exactly how agent owners"), { "font-size": "13px", color: "rgb(195, 203, 210)" });
  });

  test("G2 split rule cards and custom field", async ({ page }) => {
    await openAtStep(page, 2, { custom: true });
    const equal = page.getByRole("button", { name: /Equal split/ });
    await expectStyles(equal, { "border-top-width": "2px", "border-top-color": "rgb(213, 219, 224)", "border-top-left-radius": "16px", "padding-top": "18px", "padding-left": "18px", "row-gap": "4px", "background-color": "rgb(255, 255, 255)", "text-align": "left" });
    const custom = page.getByRole("button", { name: /Custom rule contract/ });
    await expectStyles(custom, { "border-top-color": "rgb(11, 107, 93)" });
    await expectStyles(equal.getByText("Equal split"), { "font-size": "17px", "font-weight": "700" });
    await expectStyles(equal.getByText("0x2e0b…c4d1"), { "font-size": "13px", color: "rgb(11, 107, 93)" });
    await expect(equal.getByText("0x2e0b…c4d1")).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const addr = page.getByLabel("Rule contract address");
    await expectStyles(addr, { "font-size": "16px" });
    await expect(addr).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
  });

  test("G2 review step: facts and caution callout", async ({ page }) => {
    await openAtStep(page, 3);
    const fee = page.getByText("Treasury fee", { exact: true });
    await expectStyles(fee.locator("xpath=.."), { "border-top-width": "1px", "border-top-color": "rgb(226, 231, 235)", "border-top-left-radius": "14px", "padding-top": "14px", "padding-left": "14px" });
    await expectStyles(fee, { "font-size": "13px", color: "rgb(79, 91, 102)" });
    const value = page.getByText("2%", { exact: true });
    await expectStyles(value, { "font-size": "22px" });
    await expect(value).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(page.getByText("Equal split (platform)"), { "font-size": "18px", "font-weight": "700" });
    const note = page.getByRole("note");
    await expectStyles(note, { "border-top-width": "2px", "border-top-color": "rgb(138, 59, 9)", "background-color": "rgb(253, 240, 228)", "border-top-left-radius": "18px", "padding-top": "20px", "padding-left": "20px", "row-gap": "12px" });
    await expectStyles(note.getByText("These rules cannot be changed in Phase 1"), { "font-size": "18px", "font-weight": "700", color: "rgb(107, 44, 5)" });
    await expectStyles(note.getByText(/After deployment nobody/), { color: "rgb(90, 42, 11)", "margin-top": "4px" });
    const ack = note.getByRole("checkbox");
    await expectStyles(ack, { width: "22px", height: "22px" });
    await expectStyles(ack.locator("xpath=.."), { "min-height": "44px", "column-gap": "12px", "font-weight": "700", color: "rgb(107, 44, 5)" });
    const deploy = page.getByRole("button", { name: "Deploy and sign" });
    await expectStyles(deploy, { "background-color": "rgb(213, 219, 224)", color: "rgb(79, 91, 102)", "min-height": "48px", "padding-left": "24px" });
    await ack.check();
    await expectStyles(deploy, { "background-color": "rgb(11, 107, 93)", color: "rgb(255, 255, 255)" });
  });
});

test.describe("C-04 layout, screenshots, accessibility (both projects)", () => {
  test("G3 no sideways scroll; preview beside the form on desktop, below it on a phone", async ({ page }, info) => {
    await openAtStep(page, 1);
    const width = isProject(info, "mobile-dark") ? 390 : 1280;
    await expectNoHorizontalScroll(page, width);
    const form = (await page.getByRole("heading", { level: 2, name: "Name and economics" }).boundingBox())!;
    const preview = (await page.getByRole("complementary").boundingBox())!;
    if (isProject(info, "desktop-light")) expect(preview.x).toBeGreaterThan(form.x + form.width - 1);
    else expect(preview.y).toBeGreaterThan(form.y);
    for (const step of [2, 3] as const) {
      await openAtStep(page, step);
      await expectNoHorizontalScroll(page, width);
    }
  });

  test("G3 touch targets are at least 44px", async ({ page }) => {
    await openAtStep(page, 1);
    await expectTouchTargets(page, ["input[type=checkbox]", "nav[aria-label=Breadcrumb] a"]);
    await openAtStep(page, 3);
    await expectTouchTargets(page, ["input[type=checkbox]", "nav[aria-label=Breadcrumb] a"]);
  });

  test("G4 screenshots and G5 axe: every step", async ({ page }, info) => {
    await openAtStep(page, 1);
    await screenshotPair(page, info, "create-treasury-1");
    await expectNoA11yViolations(page);
    await page.getByLabel("Treasury fee", { exact: true }).fill("60");
    await page.getByLabel("Expenses", { exact: true }).fill("50");
    await screenshotPair(page, info, "create-treasury-1-over");
    await expectNoA11yViolations(page);
    await openAtStep(page, 2, { custom: true });
    await screenshotPair(page, info, "create-treasury-2-custom");
    await expectNoA11yViolations(page);
    await openAtStep(page, 3);
    await screenshotPair(page, info, "create-treasury-3");
    await expectNoA11yViolations(page);
  });
});
