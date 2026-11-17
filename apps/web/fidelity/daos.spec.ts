/**
 * Fidelity gate for C-05-DAOs at /daos/. Expected values are the prototype's inline styles resolved to computed values.
 * The phone has no DAOs prototype (plan T14): the phone project checks layout (G3), the screenshot (G4) and axe (G5) only.
 */
import { expect, test } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { expectNoA11yViolations, expectNoHorizontalScroll, expectStyles, expectToken, expectTouchTargets, gotoApp, isProject, screenshotPair } from "./helpers";

const LOADED = "Sparrow Data";

test.describe("C-05-DAOs desktop", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 copy parity: default state and the Lean Guild filter", async ({ page }) => {
    await gotoApp(page, "/daos/", { wallet: "owner" });
    await expect(page.getByRole("link", { name: LOADED, exact: true })).toBeVisible();
    await assertCopyParity(page, "C-05-DAOs");
    await page.getByLabel("Treasury").selectOption({ label: "Lean Guild" });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Quiet Harbor"]);
    await assertCopyParity(page, "C-05-DAOs", { tr: "Lean Guild" });
  });

  test("G2 metrics", async ({ page }) => {
    await gotoApp(page, "/daos/", { wallet: "owner" });
    await expect(page.getByRole("link", { name: LOADED, exact: true })).toBeVisible();
    // C-05-DAOs:38 main
    await expectStyles(page.getByRole("main"), { "max-width": "1200px", "padding-top": "40px", "padding-left": "32px", "padding-bottom": "80px", "row-gap": "24px" });
    const h1 = page.getByRole("heading", { level: 1 });
    await expectStyles(h1, { "font-size": "46px", "font-weight": "700", "line-height": "48.3px", "letter-spacing": "-0.92px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectToken(h1, "font-size", "--fs-46");
    await expectStyles(page.getByText("Companies where agents work."), { color: "rgb(61, 73, 84)", "margin-top": "8px", "max-width": "600px" });
    await expectStyles(page.getByRole("link", { name: "Create a DAO" }), { "min-height": "48px", "padding-left": "22px", "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "font-weight": "700", "border-top-left-radius": "999px" });
    // C-05-DAOs:48-49 filter controls
    const search = page.getByLabel("Search");
    await expectStyles(search.locator(".."), { height: "48px", "border-top-left-radius": "12px", "border-top-color": "rgb(195, 203, 210)", "border-top-width": "1px", "background-color": "rgb(255, 255, 255)" });
    await expectStyles(page.getByText("Search", { exact: true }), { "font-size": "14px", "font-weight": "700" });
    await expectStyles(page.getByLabel("Treasury").locator(".."), { height: "48px", "border-top-left-radius": "12px" });
    // C-05-DAOs:57 card
    const card = page.getByRole("article").first();
    await expectStyles(card, { "background-color": "rgb(255, 255, 255)", "border-top-color": "rgb(213, 219, 224)", "border-top-width": "1px", "border-top-left-radius": "20px", "padding-top": "20px", "padding-left": "24px", "row-gap": "16px", "column-gap": "28px" });
    await expectStyles(card.getByRole("heading", { level: 2 }), { "font-size": "20px", "margin-top": "0px" });
    await expectStyles(card.getByRole("link").first(), { color: "rgb(18, 24, 31)" });
    // C-05-DAOs:62 treasury box
    const box = card.getByText("Treasury", { exact: true }).locator("..");
    await expectStyles(box, { "background-color": "rgb(243, 245, 247)", "border-top-left-radius": "14px", "padding-top": "10px", "padding-left": "14px" });
    await expectStyles(card.getByText(/% fee · /), { "font-size": "13px", color: "rgb(51, 64, 76)" });
    await expect(card.getByText(/% fee · /)).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(card.getByText("Members").locator("xpath=following-sibling::div"), { "font-size": "18px" });
    await expectStyles(card.getByText("Members"), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    await expectStyles(card.getByRole("link", { name: "View" }), { "min-height": "44px", "padding-left": "18px", "border-top-color": "rgb(195, 203, 210)", "font-weight": "700", color: "rgb(18, 24, 31)", "border-top-left-radius": "999px" });
    await expectStyles(page.getByText("Customers don't pay here"), { "font-size": "14px", color: "rgb(79, 91, 102)" });
  });

  test("G3 layout, G4 screenshot, G5 axe", async ({ page }, info) => {
    await gotoApp(page, "/daos/", { wallet: "owner" });
    await expect(page.getByRole("link", { name: LOADED, exact: true })).toBeVisible();
    await expectTouchTargets(page);
    await expectNoHorizontalScroll(page, 1280);
    const articles = page.getByRole("article");
    expect(await articles.count()).toBe(7);
    // one card per row, and inside a card the four parts sit on one row at 1280
    const lefts = await articles.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    expect(lefts).toBe(1);
    // (align-items: center, so the parts share a vertical centre rather than a top edge)
    const centres = await articles.first().evaluate((el) => Array.from(el.children).map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; }));
    expect(centres).toHaveLength(4);
    expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(2);
    await screenshotPair(page, info, "daos");
    await expectNoA11yViolations(page);
  });
});

test.describe("C-05-DAOs phone (390 dark)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G3 no horizontal scroll with one column, G4, G5", async ({ page }, info) => {
    await gotoApp(page, "/daos/", { wallet: "owner" });
    await expect(page.getByRole("link", { name: LOADED, exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, 390);
    // the description and the treasury box stack (the stats and View may share a row, as in the prototype's wrapping flex)
    const rows = await page.getByRole("article").first().evaluate((el) => new Set(Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().top))).size);
    expect(rows).toBeGreaterThanOrEqual(3);
    await expectTouchTargets(page, ["nav a"]);
    await screenshotPair(page, info, "daos");
    await expectNoA11yViolations(page);
  });

  test("a 90-character DAO name and a long search do not widen the page", async ({ page }) => {
    await gotoApp(page, "/daos/");
    await page.getByLabel("Search").fill("x".repeat(90));
    await expectNoHorizontalScroll(page, 390);
  });
});
