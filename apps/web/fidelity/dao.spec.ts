/**
 * Fidelity gate for C-05b-DAO at /dao/?id=1 (Northwind Studio). The phone has no DAO prototype (plan T14): the phone
 * project checks layout (G3), the screenshot (G4) and axe (G5); the phone join sheet is gated in approval-join.spec.ts.
 */
import { expect, test } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { columnCount, expectNoA11yViolations, expectNoHorizontalScroll, expectStyles, expectToken, expectTouchTargets, gotoApp, isProject, screenshotPair } from "./helpers";

async function open(page: import("@playwright/test").Page, wallet: "owner" | "founder" = "owner") {
  await gotoApp(page, "/dao/?id=1", { wallet });
  const panel = page.getByRole("complementary", { name: "Join with my agent" });
  await expect(page.getByRole("cell", { name: "Wren" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Ox‑Relay/ })).toContainText("not in a DAO yet");
  return panel;
}

test.describe("C-05b-DAO desktop", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 copy parity: default state and Juniper picked", async ({ page }) => {
    const panel = await open(page);
    await assertCopyParity(page, "C-05b-DAO");
    await panel.getByRole("button", { name: /Juniper/ }).click();
    await expect(panel.getByRole("button", { name: /Juniper/ })).toHaveAttribute("aria-pressed", "true");
    await assertCopyParity(page, "C-05b-DAO", { sel: "Juniper" });
  });

  test("G2 metrics", async ({ page }) => {
    const panel = await open(page);
    await expectStyles(page.getByRole("main"), { "max-width": "1200px", "padding-top": "28px", "padding-left": "32px", "padding-bottom": "80px", "row-gap": "24px" });
    await expectStyles(page.getByRole("navigation", { name: "Breadcrumb" }), { "font-size": "14px", color: "rgb(79, 91, 102)" });
    const h1 = page.getByRole("heading", { level: 1 });
    await expectStyles(h1, { "font-size": "52px", "font-weight": "700", "line-height": "52px", "letter-spacing": "-1.04px" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectToken(h1, "font-size", "--fs-52");
    await expectStyles(page.getByText("Product and brand copy"), { "font-size": "18px", color: "rgb(61, 73, 84)", "margin-top": "12px", "max-width": "620px" });
    const facts = page.locator("dl").first();
    await expectStyles(facts, { "margin-top": "16px", "font-size": "14px", "column-gap": "28px", "row-gap": "8px" });
    await expectStyles(page.getByText("Website", { exact: true }), { color: "rgb(79, 91, 102)" });
    await expectStyles(page.getByText("0x61f0…aa32 ↗"), { "font-size": "14px" });
    await expect(page.getByText("0x61f0…aa32 ↗")).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    // C-05b-DAO:51 Works under card
    const works = page.getByRole("region", { name: /Works under/ });
    await expectStyles(works, { "border-top-left-radius": "24px", "padding-top": "24px", "padding-left": "24px", "row-gap": "16px", "border-top-color": "rgb(213, 219, 224)", "background-color": "rgb(255, 255, 255)" });
    await expectStyles(works.getByRole("heading", { level: 2 }), { "font-size": "20px" });
    const cell = works.getByText("Treasury fee").locator("..");
    await expectStyles(cell, { "background-color": "rgb(243, 245, 247)", "border-top-left-radius": "12px", "padding-top": "10px", "padding-left": "12px" });
    await expectStyles(works.getByText("Treasury fee"), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    await expectStyles(works.getByText("5%", { exact: true }), { "font-size": "18px" });
    await expectStyles(works.getByText("Equal", { exact: true }), { "font-size": "18px", "font-weight": "700" });
    const flow = works.getByText("Per 1 ETH order:").locator("..");
    await expectStyles(flow, { "background-color": "rgb(227, 240, 236)", color: "rgb(7, 74, 64)", "border-top-left-radius": "14px", "padding-top": "14px", "padding-left": "16px", "column-gap": "12px", "row-gap": "4px" });
    await expectStyles(works.getByText("0.92", { exact: true }), { "font-size": "20px" });
    await expectStyles(works.getByText("In Phase 1 a DAO stays"), { "font-size": "14px", color: "rgb(61, 73, 84)" });
    // C-05b-DAO:74 Members
    const members = page.getByRole("region", { name: /^Members/ });
    await expectStyles(members, { "border-top-left-radius": "24px", "padding-top": "24px", "padding-left": "24px" });
    await expectStyles(members.getByRole("heading", { level: 2 }), { "font-size": "20px", "margin-bottom": "8px" });
    await expectStyles(members.getByText("6 agents"), { color: "rgb(79, 91, 102)", "font-weight": "500" });
    await expectStyles(members.getByRole("columnheader").first(), { "font-size": "13px", color: "rgb(79, 91, 102)" });
    const row = members.getByRole("row").nth(1);
    await expectStyles(row, { "border-bottom-color": "rgb(226, 231, 235)", "padding-top": "12px", "column-gap": "12px" });
    await expectStyles(row.getByText("founder"), { "font-size": "13px", "font-weight": "400" });
    await expectStyles(row.getByText("0x88a1…4c10"), { "font-size": "14px" });
    // C-05b-DAO:86 Join panel
    await expectStyles(panel, { "background-color": "rgb(18, 24, 31)", color: "rgb(255, 255, 255)", "border-top-left-radius": "24px", "padding-top": "24px", "padding-left": "24px", "row-gap": "16px" });
    const title = panel.getByRole("heading", { level: 2 });
    await expectStyles(title, { "font-size": "24px", "font-weight": "700" });
    await expect(title).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectStyles(panel.getByText("Joining is free."), { color: "rgb(195, 203, 210)" });
    await expectStyles(panel.getByText("Choose an agent"), { "font-weight": "700" });
    const atlas = panel.getByRole("button", { name: /Atlas‑7/ });
    await expectStyles(atlas, { "min-height": "56px", "border-top-width": "2px", "border-top-color": "rgb(111, 214, 192)", "border-top-left-radius": "14px", "background-color": "rgb(28, 37, 46)", color: "rgb(255, 255, 255)", "padding-top": "10px", "padding-left": "14px" });
    await expectStyles(panel.getByRole("button", { name: /Juniper/ }), { "border-top-color": "rgb(44, 54, 64)" });
    await expectStyles(panel.getByText("0x5d3e…19A0"), { "font-size": "13px", color: "rgb(195, 203, 210)" });
    await expectStyles(panel.getByText("in 2 DAOs"), { "font-size": "13px", color: "rgb(195, 203, 210)" });
    const after = panel.getByText("After joining,").locator("..");
    await expectStyles(after, { "background-color": "rgb(28, 37, 46)", "border-top-left-radius": "14px", "padding-top": "14px", "font-size": "14px", color: "rgb(226, 231, 235)", "row-gap": "6px" });
    await expectStyles(panel.getByText("≈ 0.1314 ETH"), { color: "rgb(111, 214, 192)" });
    await expect(panel.getByText("≈ 0.1314 ETH")).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(panel.getByRole("button", { name: "Review and sign" }), { "min-height": "52px", "background-color": "rgb(111, 214, 192)", color: "rgb(6, 32, 25)", "font-size": "17px", "font-weight": "700", "padding-left": "22px", "border-top-left-radius": "999px" });
  });

  test("G3 two columns at 1280, five rule cells in a row, G4, G5", async ({ page }, info) => {
    await open(page);
    // the breadcrumb link is an inline text link (C-05b-DAO:36), like a link inside a sentence
    await expectTouchTargets(page, ["nav[aria-label=Breadcrumb] a"]);
    await expectNoHorizontalScroll(page, 1280);
    const main = page.getByRole("main");
    expect(await columnCount(main.locator("> div").first())).toBe(2);
    const grid = page.getByRole("region", { name: /Works under/ }).getByText("Treasury fee").locator("../..");
    expect(await columnCount(grid)).toBe(5);
    await screenshotPair(page, info, "dao");
    await expectNoA11yViolations(page);
  });

  test("G4 and G5 with a different agent picked", async ({ page }, info) => {
    const panel = await open(page);
    await panel.getByRole("button", { name: /Juniper/ }).click();
    await screenshotPair(page, info, "dao-juniper");
    await expectNoA11yViolations(page);
  });

  test("a javascript: website would be text; the real one is an external link with a safe rel", async ({ page }) => {
    await open(page);
    const link = page.getByRole("link", { name: /northwind-studio\.example/ });
    await expect(link).toHaveAttribute("href", "https://northwind-studio.example/");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).not.toHaveAttribute("target");
  });
});

test.describe("C-05b-DAO phone (390 dark)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G3 one column without horizontal scroll, G4, G5", async ({ page }, info) => {
    await open(page);
    await expectNoHorizontalScroll(page, 390);
    const main = page.getByRole("main");
    expect(await columnCount(main.locator("> div").first())).toBe(1);
    await expectTouchTargets(page, ["nav a"]);
    await screenshotPair(page, info, "dao");
    await expectNoA11yViolations(page);
  });
});
