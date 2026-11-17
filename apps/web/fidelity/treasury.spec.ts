/**
 * Fidelity gate for the treasury detail screen.
 * Desktop: C-03-Treasury at 1280 light (founder with the Spend form open, and a non-founder owner).
 * Phone: C-M2-Treasury at 390x844 dark.
 * G1 copy, G2 computed styles (literal values from the prototype inline styles), G3 layout, G4 screenshots, G5 axe.
 */
import { expect, test } from "@playwright/test";
import { DEFAULT_FIXTURES } from "../src/data/mock/fixtures";
import { assertCopyParity } from "./copy-parity";
import { touchAllow } from "./exceptions";
import {
  columnCount,
  expectNoA11yViolations,
  expectNoHorizontalScroll,
  expectStyles,
  expectToken,
  expectTouchTargets,
  gotoApp,
  isProject,
  screenshotPair,
} from "./helpers";

const COMMONWEALTH = DEFAULT_FIXTURES.treasuries[0]!.address;
const ROUTE = `/treasury/?a=${COMMONWEALTH}`;

test.describe("C-03-Treasury (desktop, light)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 founder view with the Spend form open has every prototype line", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await page.getByRole("button", { name: "Spend from treasury" }).click();
    await expect(page.getByText("New spend")).toBeVisible();
    await assertCopyParity(page, "C-03-Treasury", {}, {});
  });

  test("G1 a non-founder owner has every prototype line without Spend", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "owner" });
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await assertCopyParity(page, "C-03-Treasury", {}, { viewerIsFounder: false });
    await expect(page.getByRole("button", { name: "Spend from treasury" })).toHaveCount(0);
    await expect(page.getByText("New spend")).toHaveCount(0);
  });

  test("G2 header, rulebook and calculator metrics", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    const main = page.getByRole("main");
    // C-03-Treasury:34 main
    await expectStyles(main, { "max-width": "1200px", "padding-top": "28px", "padding-right": "32px", "padding-bottom": "80px", "row-gap": "28px", "box-sizing": "border-box" });
    // :40 h1
    const h1 = page.getByRole("heading", { level: 1, name: "Commonwealth" });
    await expectStyles(h1, { "font-size": "52px", "font-weight": "700", "line-height": "52px", "letter-spacing": "-1.04px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    // :43 description
    await expectStyles(page.getByText("A general-purpose model:"), { "font-size": "18px", color: "rgb(61, 73, 84)", "margin-top": "12px" });
    // :41 badge
    await expectStyles(page.getByText("Rules fixed in Phase 1"), { "font-size": "13px", "font-weight": "700", "padding-left": "12px", "background-color": "rgb(255, 255, 255)", color: "rgb(51, 64, 76)", "border-top-left-radius": "999px" });
    // :45 definition list
    await expectStyles(page.locator("dl").first(), { "column-gap": "16px", "row-gap": "4px", "font-size": "14px" });
    await expectStyles(page.getByText("Founder", { exact: true }), { color: "rgb(79, 91, 102)" });

    // :54 rulebook card
    const rulebook = page.getByRole("region", { name: "Rulebook" });
    await expectStyles(rulebook, { "border-top-left-radius": "24px", "padding-top": "28px", "padding-left": "28px", "background-color": "rgb(255, 255, 255)", "border-top-width": "1px", "border-top-color": "rgb(213, 219, 224)" });
    const rbTitle = rulebook.getByRole("heading", { level: 2 });
    await expectStyles(rbTitle, { "font-size": "28px", "font-weight": "700" });
    await expect(rbTitle).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectStyles(rulebook.getByText("Five rules, each enforced"), { "margin-top": "4px", "margin-bottom": "8px", color: "rgb(61, 73, 84)" });
    // :59 list item
    const item = rulebook.getByRole("listitem").first();
    await expectStyles(item, { "padding-top": "20px", "padding-bottom": "20px", "column-gap": "16px", "border-top-width": "1px", "border-top-color": "rgb(226, 231, 235)" });
    await expectStyles(item.locator("span").first(), { width: "32px", height: "32px", "background-color": "rgb(227, 240, 236)", color: "rgb(7, 74, 64)", "font-weight": "700", "border-top-left-radius": "999px" });
    await expectStyles(item.getByRole("heading", { level: 3 }), { "font-size": "18px" });
    const value = item.getByText("5%", { exact: true });
    await expectStyles(value, { "font-size": "24px", "font-weight": "500" });
    await expect(value).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(item.getByText("For every customer payment"), { color: "rgb(51, 64, 76)" });
    const code = item.getByRole("link", { name: /FeeRule/ });
    await expectStyles(code, { "font-size": "13px" });
    await expect(code).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    // :68 meter
    await expectStyles(rulebook.getByRole("meter"), { height: "8px", "border-top-left-radius": "4px" });
    // :75 note
    await expectStyles(rulebook.getByText("These rules were set when"), { "margin-top": "8px", "padding-top": "14px", "padding-left": "16px", "border-top-left-radius": "12px", "background-color": "rgb(243, 245, 247)", "font-size": "14px", color: "rgb(51, 64, 76)" });

    // :78 calculator panel
    const panel = page.getByRole("complementary", { name: "Money-flow calculator" });
    await expectStyles(panel, { "border-top-left-radius": "24px", "padding-top": "24px", "padding-left": "24px", "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "row-gap": "16px" });
    const calcTitle = panel.getByRole("heading", { level: 2 });
    await expectStyles(calcTitle, { "font-size": "22px", "font-weight": "700" });
    await expectStyles(panel.getByText("Customer pays (ETH)"), { "font-size": "13px", color: "rgb(195, 203, 210)" });
    const amount = panel.getByLabel("Customer pays (ETH)");
    await expectStyles(amount, { height: "48px", "border-top-left-radius": "12px", "border-top-width": "1px", "border-top-color": "rgb(79, 91, 102)", "background-color": "rgb(28, 37, 46)", color: "rgb(255, 255, 255)", "font-size": "20px", "padding-left": "12px" });
    await expect(amount).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    // :84 bar
    const bar = panel.getByRole("img");
    await expectStyles(bar, { height: "12px", "border-top-left-radius": "6px", gap: "2px", overflow: "hidden" });
    const slices = bar.locator("> div");
    await expectStyles(slices.nth(0), { "background-color": "rgb(255, 255, 255)" });
    await expectStyles(slices.nth(1), { "background-color": "rgb(141, 154, 166)" });
    await expectStyles(slices.nth(2), { "background-color": "rgb(63, 183, 157)" });
    // :85-90 rows
    const rows = panel.locator("dl");
    await expectStyles(rows, { "font-size": "15px" });
    await expectStyles(panel.getByText("Treasury fee · 5%"), { color: "rgb(195, 203, 210)" });
    await expectStyles(panel.getByText("Treasury fee · 5%").locator(".."), { "padding-top": "8px", "border-bottom-width": "1px", "border-bottom-color": "rgb(44, 54, 64)" });
    await expectStyles(panel.getByText("To members' owners"), { "font-weight": "700" });
    await expectStyles(panel.getByText("To members' owners").locator("xpath=following-sibling::dd"), { color: "rgb(111, 214, 192)" });
    await expectStyles(panel.getByText("Each owner (equal split)").locator("xpath=following-sibling::dd"), { color: "rgb(111, 214, 192)", "font-size": "18px" });
    await expectStyles(panel.getByText("Paid today"), { "padding-top": "12px", "padding-left": "14px", "border-top-left-radius": "12px", "background-color": "rgb(28, 37, 46)", "font-size": "14px", color: "rgb(226, 231, 235)" });
  });

  test("G2 DAOs table and balance metrics", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await page.getByRole("button", { name: "Spend from treasury" }).click();
    const daos = page.getByRole("region", { name: "DAOs under Commonwealth 18" });
    await expectStyles(daos, { "border-top-left-radius": "24px", "padding-top": "28px" });
    await expectStyles(daos.getByRole("link", { name: "See all 18" }), { "font-weight": "700" });
    const header = daos.getByRole("row").first();
    await expectStyles(header, { "padding-top": "10px", "font-size": "13px", color: "rgb(79, 91, 102)", "column-gap": "12px", "border-bottom-width": "1px" });
    const row = daos.getByRole("row").nth(1);
    await expectStyles(row, { "padding-top": "14px", "border-bottom-color": "rgb(226, 231, 235)" });
    await expectStyles(row.getByRole("link"), { "font-weight": "700", color: "rgb(18, 24, 31)" });
    const members = row.getByRole("cell").nth(1).locator("span");
    await expect(members).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);

    // :116 balance section
    const balance = page.getByRole("region", { name: "Treasury balance" });
    await expectStyles(balance, { "border-top-left-radius": "24px", "padding-top": "28px", "row-gap": "20px" });
    await expectStyles(balance.getByRole("heading", { level: 2 }), { "font-size": "28px" });
    await expectStyles(balance.getByText("Fees and expenses collect here."), { "max-width": "560px", color: "rgb(61, 73, 84)" });
    const spend = balance.getByRole("button", { name: "Spend from treasury" });
    await expectStyles(spend, { "min-height": "48px", "padding-left": "22px", "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "border-top-left-radius": "999px", "font-weight": "700" });
    const now = balance.getByText("Balance now");
    await expectStyles(now.locator(".."), { "background-color": "rgb(227, 240, 236)", "border-top-left-radius": "16px", "padding-top": "16px" });
    await expectStyles(now, { "font-size": "14px", color: "rgb(7, 74, 64)" });
    const nowValue = now.locator("xpath=following-sibling::div");
    await expectStyles(nowValue, { "font-size": "32px", color: "rgb(7, 74, 64)" });
    await expect(nowValue).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const fees = balance.getByText("Collected · fees");
    await expectStyles(fees.locator(".."), { "border-top-width": "1px", "border-top-color": "rgb(226, 231, 235)", "border-top-left-radius": "16px", "padding-left": "16px" });
    await expectStyles(fees.locator("xpath=following-sibling::div"), { "font-size": "22px" });

    // :134 spend form
    const form = page.getByRole("region", { name: "New spend" });
    await expectStyles(form, { "border-top-width": "2px", "border-top-color": "rgb(18, 24, 31)", "border-top-left-radius": "20px", "padding-top": "20px", "row-gap": "14px" });
    await expectStyles(form.getByRole("heading", { level: 3 }), { "font-size": "19px" });
    await expectStyles(form.getByText("Founder only · public on-chain"), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    await expectStyles(form.getByText("Recipient address"), { "font-weight": "700", "font-size": "14px" });
    const input = form.getByLabel("Recipient address");
    // the Field box draws the border; the input carries the 12px inset (app convention)
    await expectStyles(input.locator(".."), { height: "48px", "border-top-left-radius": "12px", "border-top-width": "1px", "border-top-color": "rgb(195, 203, 210)" });
    await expectStyles(input, { "padding-left": "12px", "font-size": "15px" });
    await expect(input).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(form.getByText("Up to 23.408 available"), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    await expectStyles(form.getByRole("button", { name: "Cancel" }), { "min-height": "48px", "padding-left": "20px", "border-top-width": "1px", "border-top-color": "rgb(195, 203, 210)", "background-color": "rgb(255, 255, 255)" });
    await expectStyles(form.getByRole("button", { name: "Review and sign" }), { "min-height": "48px", "padding-left": "22px" });

    // :148 history
    await expectStyles(balance.getByRole("heading", { name: "Spending history" }), { "font-size": "18px", "margin-bottom": "8px" });
    const history = balance.getByRole("table", { name: "Spending history" });
    const hRow = history.getByRole("row").nth(1);
    await expectStyles(hRow, { "padding-top": "12px", "border-bottom-color": "rgb(226, 231, 235)" });
    // :153 row is mono 15px, the date cell is the body font at 15px
    await expectStyles(hRow.getByRole("cell").first().locator("span"), { "font-size": "15px" });
    await expect(hRow.getByRole("cell").first().locator("span")).toHaveCSS("font-family", /Atkinson Hyperlegible Next/);
    await expectStyles(hRow.getByRole("cell").nth(1), { "font-size": "15px" });
    await expect(hRow.getByRole("cell").nth(1)).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(hRow.getByRole("cell").nth(2), { "text-align": "right" });
    await expectToken(page.getByRole("main"), "padding-bottom", "--space-80");
  });

  test("G3 layout: rulebook and calculator share a row at 1280, no sideways scroll, the spend form is a 2-column grid", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await page.getByRole("button", { name: "Spend from treasury" }).click();
    await expectNoHorizontalScroll(page, 1280);
    const rulebook = await page.getByRole("region", { name: "Rulebook" }).boundingBox();
    const calc = await page.getByRole("complementary", { name: "Money-flow calculator" }).boundingBox();
    expect(rulebook!.y).toBeLessThan(calc!.y + 5);
    expect(rulebook!.x + rulebook!.width).toBeLessThanOrEqual(calc!.x);
    // :52 rulebook flex 999 1 560 vs panel flex 1 1 340 with a 24px gap inside 1136px: panel ~340-ish
    expect(calc!.width).toBeGreaterThanOrEqual(340);
    // the calculator's two inputs sit side by side (2 columns), not stacked
    expect(await columnCount(page.getByRole("complementary", { name: "Money-flow calculator" }).locator("div").first())).toBe(2);
    expect(await columnCount(page.getByRole("region", { name: "New spend" }).locator("> div").nth(1))).toBe(2);
    // the breadcrumb link is a 14px text link in the prototype (C-03-Treasury:35)
    await expectTouchTargets(page, ['nav[aria-label="Breadcrumb"] a']);
  });

  test("G4 screenshots", async ({ page }, info) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await page.getByRole("button", { name: "Spend from treasury" }).click();
    await screenshotPair(page, info, "treasury-founder");
    await gotoApp(page, ROUTE, { wallet: "owner" });
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await screenshotPair(page, info, "treasury-owner");
  });

  test("G5 axe, both themes", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await page.getByRole("button", { name: "Spend from treasury" }).click();
    await page.getByLabel("Recipient address").fill("0xnope");
    await expect(page.locator("#sp-to-error")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

test.describe("C-M2-Treasury (phone, dark)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G1 every prototype line", async ({ page }) => {
    await gotoApp(page, ROUTE);
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await assertCopyParity(page, "C-M2-Treasury");
  });

  test("G2 phone metrics", async ({ page }) => {
    await gotoApp(page, ROUTE);
    // :24 content column
    await expectStyles(page.getByRole("main"), { "padding-top": "18px", "padding-left": "16px", "padding-bottom": "28px", "row-gap": "16px", "font-size": "15px" });
    const h1 = page.getByRole("heading", { level: 1, name: "Commonwealth" });
    await expectStyles(h1, { "font-size": "34px", "font-weight": "700", "line-height": "34px", "letter-spacing": "-0.68px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectStyles(page.getByText("Rules fixed in Phase 1"), { "padding-top": "3px", "padding-left": "10px", "border-top-width": "1px", "border-top-color": "rgb(58, 71, 83)", color: "rgb(213, 220, 226)", "font-weight": "700", "background-color": "rgba(0, 0, 0, 0)" });
    await expectStyles(page.getByRole("link", { name: "0x4f2a…91c0 ↗" }).first(), { "font-size": "13px" });

    // :33 calculator card
    const card = page.getByRole("region", { name: "Customer pays" });
    await expectStyles(card, { "background-color": "rgb(20, 28, 35)", "border-top-width": "1px", "border-top-color": "rgb(38, 50, 60)", "border-top-left-radius": "20px", "padding-top": "16px", "row-gap": "10px" });
    const input = page.getByRole("textbox", { name: "Customer pays" });
    await expectStyles(input, { width: "66px", "font-size": "18px", "background-color": "rgba(0, 0, 0, 0)" });
    await expectStyles(input.locator(".."), { height: "44px", "border-top-width": "2px", "border-top-color": "rgb(238, 242, 245)", "border-top-left-radius": "12px", "column-gap": "6px" });
    await expectStyles(input, { "padding-left": "10px" });
    const bar = card.getByRole("img");
    await expectStyles(bar, { height: "10px", "border-top-left-radius": "5px", gap: "2px" });
    await expectStyles(bar.locator("> div").nth(0), { "background-color": "rgb(238, 242, 245)" });
    await expectStyles(bar.locator("> div").nth(1), { "background-color": "rgb(123, 137, 149)" });
    await expectStyles(bar.locator("> div").nth(2), { "background-color": "rgb(63, 183, 157)" });
    await expectStyles(card.getByText("To owners").locator(".."), { "border-top-width": "1px", "border-top-color": "rgb(38, 50, 60)", "font-size": "17px", "padding-top": "6px" });
    await expectStyles(card.getByText("0.92"), { color: "rgb(111, 214, 192)" });
    await expectStyles(card.getByText("Split equally, claimable after 7 days"), { "font-size": "13px", color: "rgb(185, 196, 206)" });

    // :47 rulebook
    const rb = page.getByRole("region", { name: "Rulebook" });
    await expectStyles(rb.getByRole("heading", { level: 2 }), { "font-size": "22px", "margin-bottom": "4px" });
    const item = rb.getByRole("listitem").first();
    await expectStyles(item, { "padding-top": "14px", "column-gap": "12px", "border-bottom-width": "1px", "border-bottom-color": "rgb(38, 50, 60)" });
    await expectStyles(item.locator("span").first(), { width: "28px", height: "28px", "background-color": "rgb(23, 51, 45)", color: "rgb(111, 214, 192)", "font-size": "13px", "font-weight": "700" });
    await expectStyles(item.getByText("5% of every payment"), { "font-size": "14px", color: "rgb(185, 196, 206)" });
    await expectStyles(item.getByRole("link"), { "font-size": "12px" });

    // :61 boxes
    const box = page.getByText("Treasury balance", { exact: true }).locator("..");
    await expectStyles(box, { "background-color": "rgb(20, 28, 35)", "border-top-left-radius": "16px", "padding-top": "12px", "border-top-color": "rgb(38, 50, 60)" });
    await expectStyles(page.getByText("Treasury balance", { exact: true }), { "font-size": "12px", color: "rgb(167, 179, 190)" });
    await expectStyles(page.getByText("23.408 ETH"), { "font-size": "18px" });
    await expectStyles(page.getByRole("button", { name: "Spending history" }), { "font-size": "13px" });
  });

  test("G3 layout: one column at 390 and nothing desktop-only", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await expectNoHorizontalScroll(page, 390);
    expect(await columnCount(page.getByRole("main").locator("> div").last())).toBe(2);
    await expect(page.getByRole("button", { name: "Spend from treasury" })).toHaveCount(0);
    await expectTouchTargets(page, touchAllow("C-M2-Treasury"));
  });

  test("G5 axe with the history sheet open, both themes", async ({ page }) => {
    await gotoApp(page, ROUTE);
    await page.getByRole("button", { name: "Spending history" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoHorizontalScroll(page, 390);
    expect(await page.getByRole("dialog").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expectNoA11yViolations(page);
  });

  test("G4 screenshot", async ({ page }, info) => {
    await gotoApp(page, ROUTE);
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await screenshotPair(page, info, "treasury");
    await page.getByRole("button", { name: "Spending history" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: info.outputPath("treasury-history-sheet.png") });
  });

  test("G5 axe, both themes", async ({ page }) => {
    await gotoApp(page, ROUTE);
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
