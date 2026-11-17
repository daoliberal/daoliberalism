/**
 * Fidelity gate for My agents (C-07-Agents): register form open and Juniper's edit form open, as in the prototype preview.
 * G1 copy parity, G2 computed styles (prototype inline values), G3 layout, G4 screenshots, G5 axe in both themes.
 * Mobile (390 dark) has no prototype file for this screen: single-column fallback, G3/G4/G5 only.
 */
import { expect, test, type Page } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { columnCount, expectNoA11yViolations, expectNoHorizontalScroll, expectStyles, expectTouchTargets, gotoApp, isProject, screenshotPair } from "./helpers";

async function openBoth(page: Page) {
  await gotoApp(page, "/agents/", { wallet: "owner" });
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "Register agent" }).click();
  const juniper = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Juniper" }) });
  await juniper.getByRole("button", { name: "Edit key or metadata" }).click();
  await expect(page.getByText("Works in 2 DAOs")).toBeVisible();
  return juniper;
}

test.describe("desktop 1280 light", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 copy parity with C-07-Agents (form and Juniper edit open)", async ({ page }) => {
    await openBoth(page);
    await assertCopyParity(page, "C-07-Agents", { reg: true, editing: "Juniper" });
  });

  test("G1 copy parity with the form closed and nothing being edited", async ({ page }) => {
    await gotoApp(page, "/agents/", { wallet: "owner" });
    await expect(page.getByText("Works in 2 DAOs")).toBeVisible();
    await assertCopyParity(page, "C-07-Agents", { reg: false, editing: "" });
  });

  test("G2 page head, register form and cards", async ({ page }) => {
    const juniper = await openBoth(page);
    // a valid form, so the sign button is drawn in its enabled state like the prototype's
    await page.locator("#r-key").fill("0x0b97f3d21c84a5e60b17d93ac2f4e8b15a6be2C4");
    await page.locator("#r-name").fill("Ox-Relay");
    const h1 = page.getByRole("heading", { level: 1, name: "My agents" });
    await expectStyles(h1, { "font-size": "46px", "font-weight": "700", "line-height": "48.3px", "letter-spacing": "-0.92px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectStyles(page.locator("main"), { "max-width": "1200px", "padding-top": "40px", "padding-left": "32px", "padding-bottom": "80px", gap: "24px" });
    await expectStyles(page.getByRole("button", { name: "Close form" }), { "min-height": "48px", "padding-left": "22px", "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "border-top-left-radius": "999px" });
    const reg = page.locator("section[aria-labelledby=reg]");
    await expectStyles(reg, { "border-top-width": "2px", "border-top-color": "rgb(18, 24, 31)", "border-top-left-radius": "24px", "padding-top": "24px", gap: "16px", "background-color": "rgb(255, 255, 255)" });
    await expectStyles(reg.getByRole("heading", { name: "Register an agent" }), { "font-size": "22px" });
    await expectStyles(page.getByRole("button", { name: "Register and sign" }), { "min-height": "48px", "background-color": "rgb(11, 107, 93)", color: "rgb(255, 255, 255)" });
    const card = page.getByRole("article").first();
    await expectStyles(card, { "border-top-left-radius": "20px", "padding-top": "24px", "padding-left": "24px", gap: "16px", "border-top-color": "rgb(213, 219, 224)" });
    await expectStyles(card.locator("h2"), { "font-size": "22px" });
    const avatar = card.locator("span[aria-hidden=true]").first();
    await expectStyles(avatar, { width: "48px", height: "48px", "border-top-left-radius": "14px", "background-color": "rgb(227, 240, 236)", color: "rgb(7, 74, 64)", "font-size": "20px", "font-weight": "700" });
    await expectStyles(card.getByText(/^key 0x/), { "font-size": "14px", color: "rgb(51, 64, 76)" });
    await expect(card.getByText(/^key 0x/)).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(card.getByRole("button", { name: "Edit key or metadata" }).or(card.getByRole("button", { name: "Close" })), { "min-height": "44px", "padding-left": "18px", "border-top-color": "rgb(195, 203, 210)" });
    await expectStyles(card.getByText("Works in 2 DAOs"), { "font-size": "14px", "font-weight": "700", color: "rgb(79, 91, 102)" });
    await expectStyles(card.getByRole("link", { name: /Fieldnotes Co-op/ }), { "border-top-left-radius": "14px", "padding-top": "12px", "padding-left": "14px", "border-top-color": "rgb(226, 231, 235)" });
    await expectStyles(card.getByText("Transfer ownership · coming in a later phase").locator(".."), { "font-size": "14px", color: "rgb(79, 91, 102)", "border-top-color": "rgb(226, 231, 235)", "padding-top": "12px", "column-gap": "24px", "row-gap": "8px" });
    // a changed key, so Save is drawn enabled like the prototype's
    await juniper.getByLabel("Agent key address").fill("0x0b97f3d21c84a5e60b17d93ac2f4e8b15a6be2C4");
    const edit = juniper.getByRole("button", { name: "Save and sign" }).locator("xpath=../..");
    await expectStyles(edit, { "background-color": "rgb(243, 245, 247)", "border-top-left-radius": "16px", "padding-top": "16px", gap: "12px" });
    await expectStyles(juniper.getByRole("button", { name: "Save and sign" }), { "min-height": "44px", "padding-left": "18px", "background-color": "rgb(11, 107, 93)" });
  });

  // The prototype's inputs are 48px tall with the border on the input itself; the Field primitive draws a 24px control
  // inside a 48px box. Fixed centrally (fix 6b), not in screen CSS.
  test("G2 form controls are 48px tall", async ({ page }) => {
    await openBoth(page);
    await expectStyles(page.locator("#r-key"), { height: "48px" });
  });

  test("G3 layout: two columns for the forms, DAO links, no sideways scroll, touch targets", async ({ page }) => {
    await openBoth(page);
    await expectNoHorizontalScroll(page, 1280);
    const reg = page.locator("section[aria-labelledby=reg]");
    expect(await columnCount(reg.locator("> div").first())).toBe(2);
    expect(await columnCount(reg.locator("> div").nth(1))).toBe(2);
    // text inputs are checked in the test below (the Field control is 24px inside its 48px box)
    await expectTouchTargets(page, ["input", "textarea"]);
  });

  test("G3 form inputs are at least 44px tall", async ({ page }) => {
    await openBoth(page);
    await expectTouchTargets(page, []);
  });

  test("G4 screenshot, G5 axe in both themes", async ({ page }, info) => {
    await openBoth(page);
    await screenshotPair(page, info, "agents");
    await expectNoA11yViolations(page);
  });
});

test.describe("phone 390 dark", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G3 one column, no sideways scroll; G4; G5", async ({ page }, info) => {
    await openBoth(page);
    await expectNoHorizontalScroll(page, 390);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectTouchTargets(page, ["input", "textarea"]);
    await screenshotPair(page, info, "agents");
    await expectNoA11yViolations(page);
  });

  test("G3 form inputs are at least 44px tall", async ({ page }) => {
    await openBoth(page);
    await expectTouchTargets(page, []);
  });
});
