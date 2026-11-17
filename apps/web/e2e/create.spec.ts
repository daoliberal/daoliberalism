import { expect, test } from "@playwright/test";
import { gotoApp, isProject } from "../fidelity/helpers";

const TX = /^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i;

test.describe("setup wizards", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("Deploy a treasury: three steps, one signature, done text", async ({ page }) => {
    await gotoApp(page, "/treasuries/new/", { wallet: "owner" });
    await expect(page.getByRole("heading", { level: 1, name: "Deploy a treasury" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Split rule" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Review the rulebook for Tidewater" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deploy and sign" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /I understand these rules are permanent/ }).check();
    await page.getByRole("button", { name: "Deploy and sign" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Treasury factory · 0xa4c7…0e55/)).toBeVisible();
    await dialog.getByRole("button", { name: "Deploy and sign", exact: true }).click();
    await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await expect(dialog.getByText("Confirmed on-chain")).toBeVisible();
    await expect(dialog.getByText("Tidewater is live and listed under Treasuries.")).toBeVisible();
    await expect(dialog.getByText(TX)).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("Create a DAO: details, treasury, confirm, one signature, done text", async ({ page }) => {
    await gotoApp(page, "/daos/new/", { wallet: "owner" });
    await expect(page.getByRole("heading", { level: 1, name: "Create a DAO" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: /Lean Guild/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Confirm Coral Desk under Lean Guild" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create DAO and sign" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /I understand Coral Desk stays under Lean Guild/ }).check();
    await page.getByRole("button", { name: "Create DAO and sign" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/DAO factory · 0x2b51…d7e0/)).toBeVisible();
    await dialog.getByRole("button", { name: "Create and sign", exact: true }).click();
    await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await expect(dialog.getByText("Coral Desk is live under Lean Guild.")).toBeVisible();
    await expect(dialog.getByText(TX)).toBeVisible();
  });

  test("an invalid step cannot be skipped from the stepper", async ({ page }) => {
    await gotoApp(page, "/treasuries/new/", { wallet: "owner" });
    await page.getByLabel("Treasury fee", { exact: true }).fill("60");
    await page.getByLabel("Expenses", { exact: true }).fill("50");
    await expect(page.getByRole("alert").filter({ hasText: "Fee and expenses" })).toHaveText("Fee and expenses together can't exceed 100%.");
    await page.getByRole("button", { name: /Confirm and sign/ }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Name and economics" })).toBeVisible();
  });

  test("without a wallet both pages ask to connect", async ({ page }) => {
    await gotoApp(page, "/treasuries/new/");
    await expect(page.getByText("Connect your wallet to continue.")).toBeVisible();
    await page.goto("/daos/new/");
    await expect(page.getByText("Connect your wallet to continue.")).toBeVisible();
  });
});
