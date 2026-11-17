/**
 * Fidelity gate for the shell chrome (header, nav, wallet chip, phone header and tab bar) on the placeholder /treasuries/ page.
 * Expected values are the inline styles of C-02-Treasuries (desktop) and C-M1-Treasuries (phone), resolved to computed values.
 * G1: chrome text equals the prototype's; G2: computed styles; G3: layout; G4: screenshots; G5: axe in both themes.
 */
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { missingLines, prototypeFile } from "./copy-parity";
import { expectNoA11yViolations, expectNoHorizontalScroll, expectStyles, expectToken, expectTouchTargets, gotoApp, isProject, screenshotPair } from "./helpers";
import { renderPrototypeText } from "./prototype-render";

const protoLines = (name: string): string[] => renderPrototypeText(fs.readFileSync(prototypeFile(name), "utf8")).split("\n");

test.describe("desktop shell (C-02-Treasuries header)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 chrome text equals the prototype's header", async ({ page }) => {
    await gotoApp(page, "/treasuries/", { wallet: "owner" });
    const expected = protoLines("C-02-Treasuries").slice(0, 7);
    expect(expected).toEqual(["daoliberal", "Treasuries", "DAOs", "My agents", "My earnings", "Testnet", "0x91c4…a4F2"]);
    const text = await page.getByRole("banner").innerText();
    expect(missingLines(expected.join("\n"), text, "C-02-Treasuries")).toEqual([]);
  });

  test("G2 header metrics", async ({ page }) => {
    await gotoApp(page, "/treasuries/", { wallet: "owner" });
    const header = page.getByRole("banner");
    await expectStyles(header, { "background-color": "rgb(255, 255, 255)", "border-bottom-width": "1px", "border-bottom-color": "rgb(213, 219, 224)" });
    // C-02-Treasuries:20: max-width 1200 + padding 12/32 on a content-box row
    await expectStyles(header.locator("> div"), { "max-width": "1200px", "padding-top": "12px", "padding-left": "32px", "column-gap": "24px", "row-gap": "12px", "box-sizing": "content-box" });
    const logo = header.getByRole("link", { name: "daoliberal" });
    await expectStyles(logo, { "font-size": "22px", "font-weight": "700", gap: "10px", "text-decoration-line": "none" });
    await expect(logo).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectToken(logo, "font-size", "--fs-22");
    const current = header.getByRole("link", { name: "Treasuries" });
    await expectStyles(current, { "background-color": "rgb(227, 240, 236)", color: "rgb(7, 74, 64)", "font-weight": "700", "padding-left": "14px", "border-top-left-radius": "999px", "min-height": "44px" });
    await expectStyles(header.getByRole("link", { name: "DAOs" }), { color: "rgb(51, 64, 76)", "font-weight": "400", "padding-right": "14px" });
    await expectStyles(header.getByRole("navigation"), { gap: "4px" });
    await expectStyles(header.getByText("Testnet"), { "font-size": "13px", "font-weight": "700", "padding-top": "4px", "padding-left": "12px", "background-color": "rgb(255, 241, 214)", color: "rgb(122, 74, 0)" });
    const chip = header.getByRole("button", { name: "0x91c4…a4F2" });
    await expectStyles(chip, { "font-size": "14px", "padding-left": "16px", "border-top-color": "rgb(195, 203, 210)", "border-top-width": "1px", "min-height": "44px", "background-color": "rgb(255, 255, 255)", color: "rgb(18, 24, 31)" });
    await expect(chip).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
  });

  test("G3 layout, G4 screenshot, G5 axe", async ({ page }, info) => {
    await gotoApp(page, "/treasuries/", { wallet: "owner" });
    await expectTouchTargets(page, ["main *", "[role=dialog] *"]);
    await expectNoHorizontalScroll(page, 1280);
    // header content is 1200 wide and centred: 40px from each edge at 1280 (prototype quirk, content-box)
    expect((await page.getByRole("link", { name: "daoliberal" }).boundingBox())?.x).toBe(40);
    await screenshotPair(page, info, "shell-treasuries");
    await expectNoA11yViolations(page);
  });

  test("landing header: logo, Testnet, Connect wallet (C-01-Landing)", async ({ page }, info) => {
    await gotoApp(page, "/");
    const lines = protoLines("C-01-Landing").slice(0, 3);
    expect(lines).toEqual(["daoliberal", "Testnet", "Connect wallet"]);
    const text = await page.getByRole("banner").innerText();
    expect(missingLines(lines.join("\n"), text, "C-01-Landing")).toEqual([]);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expectStyles(page.getByRole("banner").getByRole("link", { name: "Connect wallet" }), { "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "font-weight": "700", "min-height": "44px", "padding-left": "18px" });
    await screenshotPair(page, info, "shell-landing");
    await expectNoA11yViolations(page);
  });
});

test.describe("phone shell (C-M1-Treasuries chrome, 390px dark)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G1 chrome text equals the prototype's", async ({ page }) => {
    await gotoApp(page, "/treasuries/", { wallet: "owner" });
    const lines = protoLines("C-M1-Treasuries");
    const expected = [...lines.slice(0, 2), ...lines.slice(-4)];
    expect(expected).toEqual(["daoliberal", "Testnet", "Treasuries", "DAOs", "Agents", "Earnings"]);
    const text = await page.getByRole("navigation", { name: "Main" }).or(page.getByRole("banner")).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText).join("\n"));
    expect(missingLines(expected.join("\n"), text, "C-M1-Treasuries")).toEqual([]);
  });

  test("G2 header and tab bar metrics", async ({ page }) => {
    await gotoApp(page, "/treasuries/", { wallet: "owner" });
    const header = page.getByRole("banner");
    await expectStyles(header, { "padding-top": "10px", "padding-left": "16px", gap: "10px", "border-bottom-width": "1px", "border-bottom-color": "rgb(38, 50, 60)" });
    const logo = header.getByRole("link", { name: "daoliberal" });
    await expectStyles(logo, { "font-size": "19px", "font-weight": "700", gap: "8px", color: "rgb(238, 242, 245)" });
    await expectStyles(header.getByText("Testnet"), { "font-size": "12px", "padding-top": "3px", "padding-left": "10px", "background-color": "rgb(58, 42, 10)", color: "rgb(255, 213, 138)" });
    await expectStyles(header.getByRole("button", { name: "Wallet 0x91c4…a4F2" }), { width: "44px", height: "44px", "border-top-color": "rgb(38, 50, 60)", "border-top-left-radius": "999px" });
    const bar = page.getByRole("navigation", { name: "Main" });
    await expectStyles(bar, { "background-color": "rgb(14, 21, 27)", "border-top-width": "1px", "border-top-color": "rgb(38, 50, 60)", "padding-top": "4px", "padding-bottom": "8px" });
    const current = bar.getByRole("link", { name: "Treasuries" });
    await expectStyles(current, { color: "rgb(111, 214, 192)", "font-size": "12px", "font-weight": "700", "min-height": "52px", gap: "2px" });
    await expectStyles(bar.getByRole("link", { name: "DAOs" }), { color: "rgb(185, 196, 206)", "font-weight": "400" });
  });

  test("G3 layout, G4 screenshot, G5 axe", async ({ page }, info) => {
    await gotoApp(page, "/treasuries/", { wallet: "owner" });
    await expectTouchTargets(page, ["main *", "[role=dialog] *"]);
    await expectNoHorizontalScroll(page, 390);
    const columns = await page.getByRole("navigation", { name: "Main" }).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(4);
    await screenshotPair(page, info, "shell-treasuries");
    await expectNoA11yViolations(page);
  });

  test("detail header (C-M2-Treasury): back link, title, Testnet", async ({ page }, info) => {
    await gotoApp(page, "/treasury/", { wallet: "owner" });
    const header = page.getByRole("banner");
    const lines = protoLines("C-M2-Treasury").slice(0, 2);
    expect(lines).toEqual(["Treasury", "Testnet"]);
    expect(missingLines(lines.join("\n"), await header.innerText(), "C-M2-Treasury")).toEqual([]);
    await expectStyles(header, { "padding-top": "8px", "padding-left": "12px", gap: "8px" });
    await expectStyles(header.getByRole("link", { name: "Back to treasuries" }), { width: "44px", height: "44px" });
    await screenshotPair(page, info, "shell-treasury");
  });
});
