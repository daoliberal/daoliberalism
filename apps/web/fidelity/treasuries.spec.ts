/**
 * Fidelity gate for Explore treasuries: C-02-Treasuries (1280 light; states Cards, Side by side, Seats open) and
 * C-M1-Treasuries (390 dark). Expected values are the prototypes' inline styles resolved to computed values.
 * G1 copy, G2 computed styles, G3 layout, G4 screenshots, G5 axe in both themes.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { touchAllow } from "./exceptions";
import { columnCount, expectNoA11yViolations, expectNoHorizontalScroll, expectStyles, expectToken, expectTouchTargets, gotoApp, isProject, screenshotPair } from "./helpers";

const INK = "rgb(18, 24, 31)";
const INK_2 = "rgb(51, 64, 76)";
const INK_3 = "rgb(61, 73, 84)";
const INK_4 = "rgb(79, 91, 102)";
const BRAND = "rgb(11, 107, 93)";
const WHITE = "rgb(255, 255, 255)";
const LINE = "rgb(213, 219, 224)";
const LINE_STRONG = "rgb(195, 203, 210)";
const LINE_SOFT = "rgb(226, 231, 235)";

const card = (page: Page, name: string): Locator => page.getByRole("article").filter({ has: page.getByRole("heading", { level: 2, name }) });
const open = (page: Page) => gotoApp(page, "/treasuries/", { wallet: "owner" });

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

test.describe("explore treasuries, desktop (C-02-Treasuries)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 copy: Cards, Side by side, Seats open", async ({ page }) => {
    await open(page);
    await assertCopyParity(page, "C-02-Treasuries");
    await page.getByRole("button", { name: "Seats open" }).click();
    await assertCopyParity(page, "C-02-Treasuries", { filt: "open" });
    await page.getByRole("button", { name: "All" }).click();
    await page.getByRole("button", { name: "Compare side by side" }).click();
    await assertCopyParity(page, "C-02-Treasuries", { view: "compare" });
  });

  test("G1 copy: another amount and sort", async ({ page }) => {
    await open(page);
    await page.getByLabel("If a customer pays").fill("2.5");
    await page.getByLabel("Sort").selectOption("seats");
    await assertCopyParity(page, "C-02-Treasuries", { amt: "2.5", sort: "seats" });
  });

  test("G2 header block and calculator", async ({ page }) => {
    await open(page);
    // :31
    await expectStyles(page.getByRole("main"), { "max-width": "1200px", "padding-top": "40px", "padding-right": "32px", "padding-bottom": "140px", "padding-left": "32px", "box-sizing": "border-box" });
    const h1 = page.getByRole("heading", { level: 1 });
    await expectStyles(h1, { "font-size": "46px", "font-weight": "700", "line-height": "48.3px", "letter-spacing": "-0.92px", "margin-top": "0px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectToken(h1, "letter-spacing", "--ls-tight");
    await expectStyles(h1.locator("xpath=../.."), { "column-gap": "48px", "row-gap": "24px", "align-items": "end" });
    await expectStyles(page.getByText("Every treasury publishes its rules as code."), { color: INK_3, "margin-top": "14px", "max-width": "540px", "text-wrap": "pretty" });

    const label = page.getByText("If a customer pays", { exact: true });
    const calc = page.locator("label[for=t-amt]").locator("../..");
    // :38
    await expectStyles(calc, { "background-color": WHITE, "border-top-color": LINE, "border-top-width": "1px", "border-top-left-radius": "16px", "padding-top": "18px", "padding-left": "20px" });
    await expectStyles(label, { "font-weight": "700" });
    const input = page.locator("#t-amt");
    const amountBox = input.locator("..");
    await expectStyles(amountBox, { height: "52px", "border-top-width": "2px", "border-top-color": INK, "border-top-left-radius": "12px", "padding-left": "0px", "column-gap": "8px", "background-color": WHITE });
    await expectStyles(input, { width: "114px", "font-size": "22px", color: INK });
    await expect(input).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const suffix = amountBox.getByText("ETH", { exact: true });
    await expectStyles(suffix, { color: INK_4 });
    await expect(suffix).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const hint = page.getByText("every treasury below recalculates");
    await expectStyles(hint, { "font-size": "14px", color: INK_3 });
    // the hint sits beside the box, 12px away, centred on it
    const [a, h] = [await box(amountBox), await box(hint)];
    expect(Math.round(h.x - (a.x + a.width))).toBe(12);
    expect(Math.abs(h.y + h.height / 2 - (a.y + a.height / 2))).toBeLessThan(2);
    // label -> box gap is 10px
    expect(Math.round(a.y - (await box(label)).y - (await box(label)).height)).toBe(10);
  });

  test("G2 controls row", async ({ page }) => {
    await open(page);
    const group = page.getByRole("group", { name: "View" });
    // :53 :55 :56
    await expectStyles(group.locator(".."), { "column-gap": "8px", "margin-top": "32px", "flex-wrap": "wrap", "align-items": "center" });
    await expectStyles(group, { "background-color": WHITE, "border-top-width": "1px", "border-top-color": LINE_STRONG, "border-top-left-radius": "999px", "padding-top": "3px", "padding-left": "3px", "margin-right": "8px" });
    const cards = group.getByRole("button", { name: "Cards" });
    await expectStyles(cards, { "min-height": "40px", "padding-left": "16px", "border-top-left-radius": "999px", "font-size": "14px", "font-weight": "700", "background-color": INK, color: WHITE });
    expect((await box(cards)).height).toBe(40);
    expect((await box(group)).height).toBeGreaterThanOrEqual(44);
    await expectStyles(group.getByRole("button", { name: "Side by side (2)" }), { "background-color": "rgba(0, 0, 0, 0)", color: INK, "font-weight": "700" });
    const all = page.getByRole("button", { name: "All", exact: true });
    await expectStyles(all, { "min-height": "44px", "padding-left": "16px", "border-top-left-radius": "999px", "border-top-color": INK, "background-color": INK, color: WHITE, "font-size": "14px", "font-weight": "400" });
    await expect(all).toHaveAttribute("aria-pressed", "true");
    const seats = page.getByRole("button", { name: "Seats open" });
    await expectStyles(seats, { "min-height": "44px", "border-top-color": LINE_STRONG, "background-color": WHITE, color: INK, "font-size": "14px" });
    await expect(seats).toHaveAttribute("aria-pressed", "false");
    await expectStyles(page.getByText("Sort", { exact: true }), { "font-size": "14px", color: INK_3 });
    const sort = page.getByLabel("Sort");
    await expectStyles(sort, { "font-size": "14px", color: INK, "padding-left": "12px" });
    await expectStyles(sort.locator(".."), { "min-height": "44px", "border-top-left-radius": "12px", "border-top-color": LINE_STRONG, "background-color": WHITE });
    // Sort is pushed to the right edge of the 1136px content box
    const sortBox = await box(sort.locator(".."));
    expect(Math.round(sortBox.x + sortBox.width)).toBe(1280 - 72);
    await expectStyles(page.getByText(/^4 of 4 treasuries/), { "margin-top": "10px", "font-size": "14px", color: INK_4 });
  });

  test("G2 card", async ({ page }) => {
    await open(page);
    const c = card(page, "Commonwealth");
    // :67
    await expectStyles(c, { "background-color": WHITE, "border-top-width": "1px", "border-top-color": BRAND, "border-top-left-radius": "20px", "padding-top": "24px", "padding-left": "24px", "row-gap": "18px", display: "flex", "flex-direction": "column" });
    await expectStyles(card(page, "Lean Guild"), { "border-top-color": LINE });
    const name = c.getByRole("heading", { level: 2 });
    await expectStyles(name, { "font-size": "26px", "font-weight": "700", "letter-spacing": "-0.26px", "margin-top": "0px" });
    await expect(name).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectStyles(c.getByText("18 DAOs · 412.60 ETH total volume"), { "font-size": "14px", color: INK_4 });
    const pick = c.getByRole("checkbox", { name: "Compare" });
    await expectStyles(pick, { width: "20px", height: "20px", "accent-color": BRAND });
    const pickLabel = pick.locator("..");
    await expectStyles(pickLabel, { "min-height": "44px", "column-gap": "8px", "font-size": "14px", color: INK_2 });
    expect((await box(pickLabel)).height).toBeGreaterThanOrEqual(44);
    const big = c.getByText("0.92 ETH", { exact: true });
    await expectStyles(big, { "font-size": "40px", "font-weight": "500", "letter-spacing": "-0.8px", color: BRAND });
    await expect(big).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(c.getByText("reaches members' owners, after 7 days"), { color: INK_2 });
    await expectStyles(big.locator(".."), { "column-gap": "12px", "row-gap": "4px", "align-items": "baseline", "flex-wrap": "wrap" });

    const bar = c.getByRole("img", { name: /^Fee 5 percent/ });
    await expectStyles(bar, { height: "14px", "border-top-left-radius": "7px", "column-gap": "2px", overflow: "hidden" });
    const slices = bar.locator("> div");
    await expectStyles(slices.nth(0), { "background-color": "rgb(44, 54, 64)", "min-width": "3px" });
    await expectStyles(slices.nth(1), { "background-color": "rgb(141, 154, 166)" });
    await expectStyles(slices.nth(2), { "background-color": BRAND });
    const total = (await box(bar)).width;
    expect(Math.abs((await box(slices.nth(0))).width / total - 0.05)).toBeLessThan(0.004);
    expect(Math.abs((await box(slices.nth(1))).width / total - 0.03)).toBeLessThan(0.004);

    const facts = c.locator("dl");
    await expectStyles(facts, { "column-gap": "24px", "row-gap": "14px", display: "grid" });
    expect(await columnCount(facts)).toBe(2);
    await expectStyles(facts.getByText("Treasury fee"), { "font-size": "13px", color: INK_4 });
    const fee = facts.getByText("Treasury fee").locator("xpath=following-sibling::dd");
    await expectStyles(fee, { "font-size": "17px", "margin-top": "0px", "margin-left": "0px" });
    await expect(fee).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(fee.locator("span"), { "font-size": "14px", color: INK_4 });
    const split = facts.getByText("Split rule").locator("xpath=following-sibling::dd");
    await expectStyles(split, { "font-size": "17px", "font-weight": "700" });
    const seatsDd = facts.getByText("Seats used").locator("xpath=following-sibling::dd");
    await expectStyles(seatsDd, { display: "flex", "align-items": "center", "column-gap": "10px", "font-size": "17px" });
    const meter = seatsDd.locator("meter");
    await expectStyles(meter, { height: "6px", "border-top-left-radius": "3px" });
    const [count, bar10] = [await box(seatsDd.getByText("142/500")), await box(meter)];
    expect(Math.round(bar10.x - (count.x + count.width))).toBe(10);
    await expect(seatsDd.getByText("142/500")).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);

    const contract = c.getByText("Contract 0x4f2a…91c0 ↗");
    await expectStyles(contract, { "font-size": "14px", color: BRAND, "text-decoration-line": "underline" });
    await expect(contract).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(contract.locator(".."), { "border-top-width": "1px", "border-top-color": LINE_SOFT, "padding-top": "16px", "column-gap": "12px", "flex-wrap": "wrap", "align-items": "center" });
    const cta = c.getByRole("link", { name: "Read the rulebook" });
    await expectStyles(cta, { "min-height": "44px", "padding-left": "18px", "padding-right": "18px", "border-top-left-radius": "999px", "background-color": INK, color: WHITE, "font-weight": "700", "text-decoration-line": "none" });
    expect((await box(cta)).height).toBe(44);
    // margin-left: auto pushes the button to the card's content edge
    const cb = await box(c);
    expect(Math.round((await box(cta)).x + (await box(cta)).width)).toBe(Math.round(cb.x + cb.width - 24 - 1));
  });

  test("G2 selection tray", async ({ page }) => {
    await open(page);
    const count = page.getByText("2 selected");
    const tray = count.locator("..");
    // :201 inner row
    await expectStyles(tray, { "background-color": INK, "border-top-left-radius": "16px", "padding-top": "12px", "padding-right": "12px", "padding-bottom": "12px", "padding-left": "20px", "column-gap": "12px", "flex-wrap": "wrap", "align-items": "center", color: WHITE });
    await expectStyles(count, { "font-weight": "700" });
    await expectStyles(page.getByText("Commonwealth · Meritline"), { color: LINE_STRONG });
    const button = page.getByRole("button", { name: "Compare side by side" });
    await expectStyles(button, { "min-height": "44px", "padding-left": "18px", "border-top-left-radius": "999px", "background-color": WHITE, color: INK, "font-weight": "700" });
    // sticky: 16px above the bottom of the viewport, 1200 wide with 32px padding, centred
    await expectStyles(tray.locator(".."), { position: "sticky", bottom: "16px", "max-width": "1200px", "padding-left": "32px", "padding-right": "32px" });
    const b = await box(tray);
    expect(Math.round(b.y + b.height)).toBe(900 - 16);
    expect(Math.round(b.x)).toBe(40 + 32);
    expect(Math.round(b.width)).toBe(1200 - 64);
    // the button sits at the right end of the tray
    expect(Math.round((await box(button)).x + (await box(button)).width)).toBe(Math.round(b.x + b.width - 12));
  });

  test("G2 side by side", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Compare side by side" }).click();
    const table = page.getByRole("table");
    const wrap = table.locator("..");
    // :121
    await expectStyles(wrap, { "background-color": WHITE, "border-top-width": "1px", "border-top-color": LINE, "border-top-left-radius": "20px", "overflow-x": "auto", "margin-top": "20px" });
    await expectStyles(table, { "min-width": "760px", "padding-top": "8px", "padding-right": "24px", "padding-bottom": "20px", "padding-left": "24px" });
    const rows = table.getByRole("row");
    const heights = [];
    for (const r of await rows.all()) heights.push(Math.round((await box(r)).height));
    expect(heights).toEqual([84, 88, 60, 60, 60, 76, 72, 60, 76]);
    const headers = table.getByRole("rowheader");
    expect(Math.round((await box(headers.first())).width)).toBe(180);
    await expectStyles(headers.first(), { "font-size": "14px", color: INK, "font-weight": "700", "padding-top": "14px", "border-top-width": "2px", "border-top-color": INK });
    await expectStyles(headers.nth(1), { color: INK_4, "font-weight": "400", "padding-top": "16px", "border-top-width": "1px", "border-top-color": LINE_SOFT });
    const cw = table.getByRole("columnheader").first();
    await expectStyles(cw, { "border-left-width": "1px", "border-left-color": LINE_SOFT, "padding-left": "20px", "padding-top": "16px" });
    // label column 180 + 20 gap, then the first treasury column
    expect(Math.round((await box(cw)).x - (await box(headers.first())).x)).toBe(200);
    await expectStyles(cw.getByText("Commonwealth", { exact: true }), { "font-size": "24px", "font-weight": "700" });
    await expectStyles(cw.getByText("0x4f2a…91c0 ↗"), { "font-size": "13px", color: BRAND });
    const eth = table.getByText("0.92", { exact: true });
    await expectStyles(eth, { "font-size": "28px", color: BRAND });
    await expect(eth).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(table.getByText("split equally, after 7 days"), { "font-size": "13px", color: INK_4 });
    const fee = table.getByRole("cell").filter({ hasText: "5% · 0.05" }).first();
    await expectStyles(fee, { "padding-top": "14px", "border-top-width": "1px", "border-top-color": LINE_SOFT });
    await expectStyles(fee.locator("span").first(), { "font-size": "18px" });
    await expectStyles(table.getByText("Equal split", { exact: true }), { "font-weight": "700" });
    await expectStyles(table.getByText("142/500"), { "font-size": "18px" });
    await expectStyles(table.getByText("18 · 412.60 ETH"), { "font-size": "16px" });
    await expectStyles(table.getByRole("link", { name: "Read the rulebook" }).first(), { "min-height": "44px", "background-color": INK, color: WHITE });
    // the table fits at 1280: no scrolling inside the card
    expect(await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("G2 too few selected", async ({ page }) => {
    await open(page);
    await card(page, "Meritline").getByRole("checkbox", { name: "Compare" }).uncheck();
    await page.getByRole("button", { name: "Side by side (1)" }).click();
    const warning = page.getByText("Select at least two treasuries in the card view to compare them side by side.");
    await expectStyles(warning, { "margin-top": "0px", "margin-right": "24px", "margin-bottom": "24px", "margin-left": "24px", color: INK_3 });
  });

  test("G2 footnote", async ({ page }) => {
    await open(page);
    await expectStyles(page.getByText("Values come straight from each contract."), { "margin-top": "20px", "font-size": "14px", color: INK_4 });
    await expect(page.getByRole("link", { name: "Deploy a treasury" })).toHaveAttribute("href", "/treasuries/new/");
  });

  test("G3 layout, G4 screenshots, G5 axe", async ({ page }, info) => {
    await open(page);
    expect(await columnCount(card(page, "Commonwealth").locator(".."))).toBe(2);
    await expectTouchTargets(page, touchAllow("C-02-Treasuries"));
    await expectNoHorizontalScroll(page, 1280);
    await screenshotPair(page, info, "treasuries-cards");
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Seats open" }).click();
    await expect(page.getByRole("article")).toHaveCount(3);
    await expectTouchTargets(page, touchAllow("C-02-Treasuries"));
    await screenshotPair(page, info, "treasuries-seats-open");
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("button", { name: "Compare side by side" }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await expectTouchTargets(page, touchAllow("C-02-Treasuries"));
    await expectNoHorizontalScroll(page, 1280);
    await screenshotPair(page, info, "treasuries-side-by-side");
    await expectNoA11yViolations(page);
  });

  test("G3 a long unbroken amount does not widen the page", async ({ page }) => {
    await open(page);
    await page.getByLabel("If a customer pays").fill("1".repeat(60));
    await expectNoHorizontalScroll(page, 1280);
    await page.getByRole("button", { name: "Compare side by side" }).click();
    await expectNoHorizontalScroll(page, 1280);
  });
});

test.describe("explore treasuries, phone (C-M1-Treasuries)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  const SURFACE = "rgb(20, 28, 35)";
  const LINE_D = "rgb(38, 50, 60)";
  const TEXT = "rgb(238, 242, 245)";
  const MUTED = "rgb(167, 179, 190)";
  const BG = "rgb(11, 16, 21)";
  const MINT = "rgb(111, 214, 192)";

  test("G1 copy equals the prototype's", async ({ page }) => {
    await open(page);
    await assertCopyParity(page, "C-M1-Treasuries");
  });

  test("G1 copy after the Seats open filter keeps the card copy", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Seats open" }).click();
    await expect(page.getByText("3 treasuries · sorted by name · no ranking")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(3);
    await expect(page.getByRole("heading", { level: 2, name: "Meritline" })).toHaveCount(0);
  });

  test("G2 page, calculator and chips", async ({ page }) => {
    await open(page);
    const main = page.getByRole("main");
    // :30
    await expectStyles(main, { "padding-top": "18px", "padding-right": "16px", "padding-bottom": "24px", "padding-left": "16px", "row-gap": "14px", "font-size": "15px", display: "flex", "flex-direction": "column" });
    const h1 = page.getByRole("heading", { level: 1 });
    await expectStyles(h1, { "font-size": "30px", "font-weight": "700", "line-height": "31.5px", "letter-spacing": "-0.6px", "margin-top": "0px", color: TEXT });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    const label = page.getByText("If a customer pays", { exact: true });
    const calc = label.locator("../..");
    await expectStyles(calc, { "background-color": SURFACE, "border-top-color": LINE_D, "border-top-width": "1px", "border-top-left-radius": "16px", "padding-top": "10px", "padding-left": "12px" });
    await expectStyles(label.locator(".."), { "column-gap": "10px", "align-items": "center" });
    await expectStyles(label, { "font-weight": "700", "flex-grow": "1" });
    const input = page.locator("#m1-amt");
    const amountBox = input.locator("..");
    await expectStyles(amountBox, { height: "44px", "border-top-width": "2px", "border-top-color": TEXT, "border-top-left-radius": "12px", "padding-left": "0px", "column-gap": "6px" });
    await expectStyles(input, { width: "66px", "font-size": "18px", color: TEXT });
    await expect(input).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const suffix = amountBox.getByText("ETH", { exact: true });
    await expectStyles(suffix, { "font-size": "13px", color: MUTED });
    await expect(suffix).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);

    const all = page.getByRole("button", { name: "All", exact: true });
    await expectStyles(all, { "min-height": "44px", "padding-left": "14px", "border-top-left-radius": "999px", "border-top-color": TEXT, "background-color": TEXT, color: BG, "font-size": "14px", "font-weight": "700", "flex-shrink": "0" });
    const seats = page.getByRole("button", { name: "Seats open" });
    await expectStyles(seats, { "min-height": "44px", "border-top-color": "rgb(58, 71, 83)", "background-color": "rgba(0, 0, 0, 0)", color: TEXT, "font-size": "14px", "font-weight": "400" });
    await expectStyles(all.locator(".."), { "column-gap": "8px", "overflow-x": "auto", "padding-bottom": "2px" });
    expect((await box(all)).height).toBe(44);
    await expectStyles(page.getByText("4 treasuries · sorted by name · no ranking"), { "font-size": "13px", color: MUTED, "margin-top": "0px" });
    // chips scroll sideways inside their own row
    expect(await all.locator("..").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });

  test("G2 card", async ({ page }) => {
    await open(page);
    const c = card(page, "Commonwealth");
    // :41
    await expectStyles(c, { "background-color": SURFACE, "border-top-color": LINE_D, "border-top-width": "1px", "border-top-left-radius": "20px", "padding-top": "18px", "padding-left": "18px", "row-gap": "12px", display: "flex", "flex-direction": "column" });
    const name = c.getByRole("heading", { level: 2 });
    await expectStyles(name, { "font-size": "22px", "font-weight": "700", "margin-top": "0px" });
    await expect(name).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectStyles(name.locator(".."), { "justify-content": "space-between", "align-items": "baseline", "column-gap": "8px" });
    await expectStyles(c.getByText("18 DAOs"), { "font-size": "13px", color: MUTED });
    const big = c.getByText("0.92 ETH", { exact: true });
    await expectStyles(big, { "font-size": "30px", color: MINT });
    await expect(big).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(c.getByText("to members' owners, after 7 days"), { "font-size": "14px", color: "rgb(185, 196, 206)" });
    const bar = c.getByRole("img", { name: /^Fee 5 percent/ });
    await expectStyles(bar, { height: "10px", "border-top-left-radius": "5px", "column-gap": "2px" });
    await expectStyles(bar.locator("> div").nth(0), { "background-color": TEXT });
    await expectStyles(bar.locator("> div").nth(1), { "background-color": "rgb(123, 137, 149)" });
    await expectStyles(bar.locator("> div").nth(2), { "background-color": "rgb(63, 183, 157)" });
    const facts = c.locator("dl");
    await expectStyles(facts, { "column-gap": "16px", "row-gap": "8px", "font-size": "14px" });
    expect(await columnCount(facts)).toBe(2);
    await expectStyles(facts.getByText("Fee", { exact: true }), { "font-size": "12px", color: MUTED });
    const fee = facts.getByText("Fee", { exact: true }).locator("xpath=following-sibling::dd");
    await expect(fee).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(facts.getByText("Equal split"), { "font-weight": "700" });
    await expectStyles(facts.getByText("142/500"), { "font-size": "14px" });
    const cta = c.getByRole("link", { name: "Read the rulebook" });
    await expectStyles(cta, { "min-height": "48px", "border-top-left-radius": "999px", "background-color": TEXT, color: BG, "font-weight": "700", "text-decoration-line": "none", "justify-content": "center" });
    expect((await box(cta)).height).toBe(48);
    const cb = await box(c);
    expect(Math.round((await box(cta)).width)).toBe(Math.round(cb.width - 2 - 36)); // stretches across the padded card
    await expect(c.getByText(/total volume|Contract/)).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("G3 layout, G4 screenshot, G5 axe", async ({ page }, info) => {
    await open(page);
    expect(await columnCount(page.getByRole("article").first().locator(".."))).toBe(1);
    await expectTouchTargets(page, touchAllow("C-M1-Treasuries"));
    await expectNoHorizontalScroll(page, 390);
    await screenshotPair(page, info, "treasuries-cards");
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Equal split" }).click();
    await expect(page.getByRole("article")).toHaveCount(3);
    await screenshotPair(page, info, "treasuries-equal-split");
    await expectNoA11yViolations(page);
  });
});
