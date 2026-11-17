/**
 * Fidelity gate for My earnings (C-08-Earnings): Credits and Claim history tabs.
 * G1 copy parity, G2 computed styles, G3 layout, G4 screenshots, G5 axe in both themes.
 * Mobile (390 dark) has no prototype file for this screen: single-column fallback, G3/G4/G5 only.
 */
import { expect, test } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { expectNoA11yViolations, expectNoHorizontalScroll, expectStyles, expectToken, expectTouchTargets, gotoApp, isProject, screenshotPair } from "./helpers";

test.describe("desktop 1280 light", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 copy parity: Credits tab", async ({ page }) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await expect(page.getByText("#0988")).toBeVisible();
    await assertCopyParity(page, "C-08-Earnings", { tab: "credits" });
  });

  test("G1 copy parity: Claim history tab", async ({ page }) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await page.getByRole("tab", { name: "Claim history" }).click();
    await expect(page.getByText("1 Oct 2026")).toBeVisible();
    await assertCopyParity(page, "C-08-Earnings", { tab: "history" });
  });

  test("G2 summary, tabs, ledger and claim bar", async ({ page }) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await expect(page.getByText("#0988")).toBeVisible();
    const h1 = page.getByRole("heading", { level: 1, name: "My earnings" });
    await expectStyles(h1, { "font-size": "46px", "font-weight": "700", "letter-spacing": "-0.92px" });
    await expectStyles(page.locator("main"), { "max-width": "1200px", "padding-top": "40px", "padding-left": "32px", gap: "24px" });
    const panel = page.getByText("Available now").locator("..");
    await expectStyles(panel, { "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "border-top-left-radius": "20px", "padding-top": "20px", "padding-left": "20px" });
    await expectStyles(page.getByText("0.412 ETH", { exact: true }), { "font-size": "36px", color: "rgb(111, 214, 192)" });
    await expect(page.getByText("0.412 ETH", { exact: true })).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(page.getByText("Available now"), { color: "rgb(195, 203, 210)" });
    await expectStyles(page.getByText("3 credits", { exact: true }).first(), { "font-size": "14px", color: "rgb(195, 203, 210)" });
    const onHold = page.getByText("On hold").locator("..");
    await expectStyles(onHold, { "background-color": "rgb(255, 255, 255)", "border-top-color": "rgb(213, 219, 224)", "border-top-left-radius": "20px", "padding-top": "20px" });
    await expectStyles(page.getByText("On hold"), { color: "rgb(79, 91, 102)" });
    await expectStyles(page.getByText("0.287 ETH", { exact: true }), { "font-size": "36px", color: "rgb(18, 24, 31)" });

    const tablist = page.getByRole("tablist", { name: "Earnings views" });
    await expectStyles(tablist, { "border-bottom-width": "1px", "border-bottom-color": "rgb(213, 219, 224)", gap: "4px" });
    const on = page.getByRole("tab", { name: "Credits" });
    await expectStyles(on, { "min-height": "48px", "padding-left": "18px", "border-bottom-width": "3px", "border-bottom-color": "rgb(11, 107, 93)", "font-weight": "700", "margin-bottom": "-1px", "background-color": "rgba(0, 0, 0, 0)" });
    await expectStyles(page.getByRole("tab", { name: "Claim history" }), { "border-bottom-color": "rgba(0, 0, 0, 0)" });

    const ledger = page.getByRole("table", { name: "Credits" });
    const head = ledger.getByRole("row").first();
    await expectStyles(head, { "padding-top": "12px", "padding-left": "20px", "font-size": "13px", color: "rgb(79, 91, 102)", "border-bottom-color": "rgb(226, 231, 235)", "column-gap": "12px" });
    expect((await head.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(" ")[0]).toBe("56px");
    const ready = ledger.getByRole("row").filter({ hasText: "#1042" });
    await expectStyles(ready, { "padding-top": "14px", "background-color": "rgb(242, 248, 246)" });
    await expectStyles(ready.getByText("#1042"), { "font-size": "14px" });
    await expectStyles(ready.getByRole("link", { name: "Fieldnotes Co-op" }), { "font-weight": "700", color: "rgb(18, 24, 31)" });
    await expectStyles(ready.getByText("0.153"), { "font-size": "17px", "text-align": "right" });
    await expectStyles(ready.getByText("Available"), { "font-size": "14px", "font-weight": "700", color: "rgb(11, 107, 93)" });
    // the ledger frame (C-08-Earnings:50): white surface, 1px line border, 20px radius
    await expectStyles(page.getByRole("region", { name: "Credits table" }).locator(".."), { "background-color": "rgb(255, 255, 255)", "border-top-color": "rgb(213, 219, 224)", "border-top-width": "1px", "border-top-left-radius": "20px" });
    const waiting = ledger.getByRole("row").filter({ hasText: "#1101" });
    // unselected rows draw no background of their own; the white card shows through (same pixels as the prototype)
    await expectStyles(waiting, { "background-color": "rgba(0, 0, 0, 0)" });
    await expectStyles(waiting.getByText("in 2 d 04 h · 23 Oct"), { color: "rgb(51, 64, 76)", "font-weight": "700" });
    // C-08-Earnings:63 bar: height 6, radius 3; the track is line-soft, the fill grey while waiting and brand when ready
    await expectStyles(waiting.getByRole("progressbar"), { height: "6px", "border-top-left-radius": "3px", "background-color": "rgb(226, 231, 235)" });
    // the fill colours (grey while waiting, brand when ready) are pseudo-elements: checked on the G4 screenshots
    const box = ready.getByRole("checkbox");
    expect((await box.boundingBox())?.width).toBe(22);

    const bar = page.getByText(/available credits selected/).locator("..");
    await expectStyles(bar, { "background-color": "rgb(243, 245, 247)", "padding-top": "16px", "padding-left": "20px", gap: "12px" });
    const claim = page.getByRole("button", { name: "Claim 0.412 ETH" });
    await expectStyles(claim, { "min-height": "52px", "padding-left": "24px", "font-size": "17px", "background-color": "rgb(11, 107, 93)", color: "rgb(255, 255, 255)", "font-weight": "700" });
    await expectToken(page.locator("body"), "font-size", "--fs-16");
  });

  test("G2 claim history table", async ({ page }) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await page.getByRole("tab", { name: "Claim history" }).click();
    const table = page.getByRole("table", { name: "Claim history" });
    const head = table.getByRole("row").first();
    await expectStyles(head, { "padding-left": "20px", "font-size": "13px", color: "rgb(79, 91, 102)", "column-gap": "12px" });
    const row = table.getByRole("row").nth(1);
    await expectStyles(row, { "padding-top": "14px", "border-bottom-color": "rgb(226, 231, 235)" });
    await expectStyles(row.getByText("0.871 ETH"), { "text-align": "right" });
    await expect(row.getByText("0.871 ETH")).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(row.getByText("0x3c9e… ↗"), { color: "rgb(11, 107, 93)" });
  });

  test("G3 layout: three summary boxes in one row, no sideways scroll, touch targets", async ({ page }) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await expect(page.getByText("#0988")).toBeVisible();
    await expectNoHorizontalScroll(page, 1280);
    const boxes = page.getByText("Available now").locator("../..");
    const lefts = await boxes.locator("> *").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(3);
    // the checkbox is drawn 22px, as in the prototype; its label is the 44px target
    await expectTouchTargets(page, ["input[type=checkbox]"]);
    const label = page.getByRole("checkbox", { name: "Select order 0988" }).locator("..");
    expect((await label.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });

  test("G4 screenshots, G5 axe in both themes", async ({ page }, info) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await expect(page.getByText("#0988")).toBeVisible();
    await screenshotPair(page, info, "earnings-credits");
    await expectNoA11yViolations(page);
    await page.getByRole("tab", { name: "Claim history" }).click();
    await screenshotPair(page, info, "earnings-history");
    await expectNoA11yViolations(page);
  });
});

test.describe("phone 390 dark", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G3 no sideways scroll (the ledger scrolls inside its card); G4; G5 on Credits", async ({ page }, info) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await expect(page.getByText("#0988")).toBeVisible();
    await expectNoHorizontalScroll(page, 390);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectTouchTargets(page, ["input[type=checkbox]"]);
    await screenshotPair(page, info, "earnings-credits");
    await expectNoA11yViolations(page);
  });

  // The Table primitive's scroll wrapper is not keyboard-focusable, so axe's scrollable-region-focusable fails once the
  // 560px table overflows a 390px screen. Fixed centrally (fix 6b).
  test("G3/G5 claim history at 390", async ({ page }, info) => {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await page.getByRole("tab", { name: "Claim history" }).click();
    await expect(page.getByText("1 Oct 2026")).toBeVisible();
    await expectNoHorizontalScroll(page, 390);
    await screenshotPair(page, info, "earnings-history");
    await expectNoA11yViolations(page);
  });
});
