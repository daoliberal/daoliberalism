import { expect, test } from "@playwright/test";
import { gotoApp, isProject } from "../fidelity/helpers";

test.describe("explore treasuries on a desktop viewport", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("landing -> browse -> amount -> filter -> side by side -> rulebook", async ({ page }) => {
    await gotoApp(page, "/");
    await page.getByRole("link", { name: "Browse treasuries first" }).click();
    await expect(page).toHaveURL(/\/treasuries\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Choose the economy your agent works in" })).toBeVisible();

    const amount = page.getByLabel("If a customer pays");
    await amount.fill("2");
    const commonwealth = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Commonwealth" }) });
    await expect(commonwealth.getByText("1.84 ETH")).toBeVisible();

    await page.getByRole("button", { name: "Seats open" }).click();
    await expect(page.getByRole("article")).toHaveCount(3);
    await expect(page.getByText(/^3 of 4 treasuries/)).toBeVisible();

    // Meritline is hidden by the filter but still counts as selected: add Lean Guild to compare it with Commonwealth.
    await page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Lean Guild" }) }).getByRole("checkbox", { name: "Compare" }).check();
    await page.getByRole("button", { name: "Compare side by side" }).click();
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveCount(2);
    await expect(table.getByText("of 2 ETH")).toBeVisible();
    await expect(table.getByText("1.84", { exact: true })).toBeVisible();

    const rulebook = table.getByRole("link", { name: "Read the rulebook" }).first();
    const href = await rulebook.getAttribute("href");
    expect(href).toMatch(/^\/treasury\/\?a=0x[0-9a-fA-F]{40}$/);
    await rulebook.click();
    await expect(page).toHaveURL(/\/treasury\/\?a=0x[0-9a-fA-F]{40}$/);
    expect(page.url().endsWith(href!)).toBe(true);
  });

  test("Connect wallet on the landing page connects and opens the treasuries", async ({ page }) => {
    await gotoApp(page, "/");
    await page.getByRole("main").getByRole("link", { name: "Connect wallet" }).click();
    await expect(page).toHaveURL(/\/treasuries\/$/);
    await expect(page.getByRole("button", { name: "0x91c4…a4F2" })).toBeVisible();
  });

  test("sorting reorders the cards", async ({ page }) => {
    await gotoApp(page, "/treasuries/");
    await page.getByLabel("Sort").selectOption("owners");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Lean Guild", "Open Field", "Commonwealth", "Meritline"]);
  });
});

test.describe("explore treasuries on a phone", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("shows cards only, filters with the short chips and links to the rulebook", async ({ page }) => {
    await gotoApp(page, "/treasuries/");
    await expect(page.getByText("4 treasuries · sorted by name · no ranking")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await page.getByRole("button", { name: "Hold ≤ 7 d" }).click();
    await expect(page.getByText("2 treasuries · sorted by name · no ranking")).toBeVisible();
    await page.getByRole("link", { name: "Read the rulebook" }).first().click();
    await expect(page).toHaveURL(/\/treasury\/\?a=0x[0-9a-fA-F]{40}$/);
  });
});
