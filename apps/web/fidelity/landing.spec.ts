/**
 * Fidelity gate for the landing page (C-01-Landing, route "/"). Expected values are the prototype's inline styles resolved to
 * computed values. G1 copy, G2 computed styles, G3 layout, G4 screenshot, G5 axe in both themes. The phone has no landing
 * prototype (the desktop header and page are kept), so on the phone only G3 and G5 apply.
 */
import { expect, test } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { columnCount, expectNoA11yViolations, expectNoHorizontalScroll, expectStyles, expectToken, expectTouchTargets, gotoApp, isProject, screenshotPair } from "./helpers";

const INK = "rgb(18, 24, 31)";
const BRAND = "rgb(11, 107, 93)";
const WHITE = "rgb(255, 255, 255)";
const LINE = "rgb(213, 219, 224)";
const LINE_STRONG = "rgb(195, 203, 210)";
const INK_3 = "rgb(61, 73, 84)";
const INK_4 = "rgb(79, 91, 102)";

test.describe("landing, desktop (C-01-Landing)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 copy equals the prototype's", async ({ page }) => {
    await gotoApp(page, "/");
    await assertCopyParity(page, "C-01-Landing");
  });

  test("G2 hero", async ({ page }) => {
    await gotoApp(page, "/");
    // :31
    await expectStyles(page.getByRole("main"), { "max-width": "1200px", "padding-top": "64px", "padding-right": "32px", "padding-bottom": "80px", "padding-left": "32px", "row-gap": "72px", "box-sizing": "border-box" });
    const h1 = page.getByRole("heading", { level: 1 });
    // :35 :36 :37
    await expectStyles(page.getByText("Programmable liberalism", { exact: true }), { "font-weight": "700", color: BRAND, "letter-spacing": "0.32px" });
    await expectStyles(h1, { "font-size": "60px", "font-weight": "700", "line-height": "61.2px", "letter-spacing": "-1.5px", "margin-top": "12px", "margin-bottom": "0px", "text-wrap": "balance" });
    await expect(h1).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectToken(h1, "font-size", "--fs-60");
    await expectStyles(page.getByText("Bring your own software agents."), { "font-size": "19px", color: INK_3, "max-width": "540px", "margin-top": "20px", "text-wrap": "pretty" });
    const connect = page.getByRole("main").getByRole("link", { name: "Connect wallet" });
    await expectStyles(connect, { "min-height": "52px", "padding-left": "24px", "padding-right": "24px", "border-top-left-radius": "999px", "background-color": INK, color: WHITE, "font-size": "17px", "font-weight": "700", "text-decoration-line": "none" });
    await expectStyles(page.getByRole("link", { name: "Browse treasuries first" }), { "min-height": "52px", "background-color": WHITE, color: INK, "border-top-width": "1px", "border-top-color": LINE_STRONG, "font-size": "17px", "font-weight": "700", "text-decoration-line": "none" });
    await expectStyles(connect.locator(".."), { "column-gap": "12px", "margin-top": "28px", "flex-wrap": "wrap" });
    await expectStyles(page.getByText("Phase 1 runs on an Ethereum L2 testnet."), { "font-size": "14px", "margin-top": "14px", color: INK_4 });
  });

  test("G2 organisation diagram", async ({ page }) => {
    await gotoApp(page, "/");
    const diagram = page.getByLabel("How daoliberal is organised");
    const hero = page.getByRole("main").locator("section").first();
    // :44
    await expectStyles(diagram, { "background-color": WHITE, "border-top-color": LINE, "border-top-width": "1px", "border-top-left-radius": "24px", "padding-top": "28px", "padding-left": "28px", "row-gap": "10px", display: "flex", "flex-direction": "column" });
    const treasury = diagram.getByText("The economic model: fee, expenses, hold period, split rule, seats").locator("xpath=../..");
    await expectStyles(treasury, { "border-top-width": "2px", "border-top-color": BRAND, "border-top-left-radius": "16px", "padding-top": "14px", "padding-left": "16px", "justify-content": "space-between", "column-gap": "12px", "align-items": "center" });
    const rulebook = diagram.getByText("rulebook", { exact: true });
    await expectStyles(rulebook, { "font-size": "13px", color: BRAND });
    await expect(rulebook).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    await expectStyles(diagram.getByText("A company that sells work"), { "font-size": "14px", color: INK_4 });
    const dao = diagram.getByText("A company that sells work").locator("..");
    await expectStyles(dao, { "border-top-width": "1px", "border-top-color": LINE_STRONG, "border-top-left-radius": "16px", "padding-top": "12px", "padding-left": "16px" });
    expect(await columnCount(dao.locator(".."))).toBe(2);
    const agent = diagram.getByText("does the work"); // the box itself: its own text node follows <b>Agent</b>
    await expectStyles(agent, { "background-color": "rgb(243, 245, 247)", "border-top-left-radius": "12px", "padding-top": "10px", "padding-left": "12px", "font-size": "14px" });
    expect(await columnCount(agent.locator(".."))).toBe(3);
    const owner = diagram.getByText("Receives all earnings. Signs every membership action.").locator("..");
    await expectStyles(owner, { "background-color": INK, color: WHITE, "border-top-left-radius": "16px", "padding-top": "14px", "padding-left": "16px" });
    await expectStyles(diagram.getByText("Receives all earnings. Signs every membership action."), { "font-size": "14px", color: LINE_STRONG });
    expect(await columnCount(hero)).toBe(2);
  });

  test("G2 follow one payment, ideas, roles", async ({ page }) => {
    await gotoApp(page, "/");
    const flow = page.getByRole("region", { name: "Follow one payment" });
    // :80
    await expectStyles(flow, { "background-color": WHITE, "border-top-color": LINE, "border-top-left-radius": "24px", "padding-top": "32px", "padding-left": "32px" });
    const h2 = flow.getByRole("heading", { level: 2 });
    await expectStyles(h2, { "font-size": "30px", "font-weight": "700", "letter-spacing": "-0.3px", "margin-top": "0px" });
    await expect(h2).toHaveCSS("font-family", /Bricolage Grotesque/);
    await expectStyles(flow.getByText("An example treasury with a 5% fee"), { color: INK_3, "margin-top": "6px", "margin-bottom": "24px" });
    const steps = flow.getByRole("list");
    await expectStyles(steps, { "column-gap": "12px", "row-gap": "12px", "list-style-type": "none", "padding-left": "0px", "margin-top": "0px" });
    expect(await columnCount(steps)).toBe(5);
    const first = flow.getByRole("listitem").first();
    await expectStyles(first, { "border-top-width": "1px", "border-top-color": LINE, "border-top-left-radius": "16px", "padding-top": "16px", "padding-left": "16px" });
    await expectStyles(first.getByText("Customer pays the DAO"), { "font-size": "14px", color: INK_4 });
    const value = first.getByText("1.00 ETH");
    await expectStyles(value, { "font-size": "24px" });
    await expect(value).toHaveCSS("font-family", /Atkinson Hyperlegible Mono/);
    const owners = flow.getByRole("listitem").nth(3);
    await expectStyles(owners, { "border-top-width": "2px", "border-top-color": BRAND, "background-color": "rgb(227, 240, 236)" });
    await expectStyles(owners.getByText("0.92 ETH"), { color: "rgb(7, 74, 64)" });

    // :95 three ideas, :107 roles
    const ideas = page.getByRole("region", { name: "Three ideas" });
    await expectStyles(ideas, { "row-gap": "20px" });
    const idea = ideas.getByRole("heading", { level: 3 }).first().locator("..");
    await expectStyles(idea, { "border-top-left-radius": "20px", "padding-top": "24px", "padding-left": "24px", "background-color": WHITE, "border-top-color": LINE });
    await expectStyles(idea.getByRole("heading", { level: 3 }), { "font-size": "19px", "margin-bottom": "6px" });
    expect(await columnCount(idea.locator(".."))).toBe(3);
    await expectStyles(idea.getByText("Every rule comes with"), { color: INK_3, "margin-top": "0px" });
    const role = page.getByRole("link", { name: /^Own agents/ });
    await expectStyles(role, { display: "flex", "flex-direction": "column", "row-gap": "6px", "border-top-left-radius": "20px", "padding-top": "24px", color: INK, "text-decoration-line": "none" });
    await expectStyles(role.getByText("Own agents"), { "font-size": "19px", "font-weight": "700" });
    await expectStyles(role.getByText("Register an agent →"), { color: BRAND, "font-weight": "700" });
    expect(await columnCount(role.locator(".."))).toBe(3);

    await expectStyles(page.getByText("Coming in later phases:"), { "font-size": "14px", color: INK_4, "border-top-width": "1px", "border-top-color": LINE, "padding-top": "20px", "margin-top": "0px" });
  });

  test("G3 layout, G4 screenshot, G5 axe", async ({ page }, info) => {
    await gotoApp(page, "/");
    expect(await columnCount(page.getByRole("main").locator("section").first())).toBe(2);
    await expectTouchTargets(page);
    await expectNoHorizontalScroll(page, 1280);
    await screenshotPair(page, info, "landing");
    await expectNoA11yViolations(page);
  });
});

test.describe("landing, phone (no prototype: the desktop page keeps working)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G3 no sideways scroll, single column, G4 screenshot, G5 axe", async ({ page }, info) => {
    await gotoApp(page, "/");
    await expectNoHorizontalScroll(page, 390);
    expect(await columnCount(page.getByRole("main").locator("section").first())).toBe(1);
    await expectTouchTargets(page);
    await screenshotPair(page, info, "landing");
    await expectNoA11yViolations(page);
  });
});
