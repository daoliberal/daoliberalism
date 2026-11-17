/**
 * Cross-page checks: what a wizard creates shows up on the Treasuries (T8) and DAOs (T10) list pages.
 * After creating, navigation is by in-app links only: the mock state lives in memory (P39).
 */
import { expect, test } from "@playwright/test";
import { gotoApp, isProject } from "../fidelity/helpers";

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

test("a deployed treasury appears under Treasuries", async ({ page }) => {
  await gotoApp(page, "/treasuries/new/", { wallet: "owner" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Deploy and sign" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Deploy and sign", exact: true }).click();
  await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Treasuries" }).click();
  await expect(page).toHaveURL(/\/treasuries\/$/);
  await expect(page.getByRole("main").getByText("Tidewater").first()).toBeVisible();
});

test("a created DAO appears under DAOs", async ({ page }) => {
  await gotoApp(page, "/daos/new/", { wallet: "owner" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create DAO and sign" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create and sign", exact: true }).click();
  await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "DAOs" }).click();
  await expect(page).toHaveURL(/\/daos\/$/);
  await expect(page.getByRole("main").getByText("Coral Desk").first()).toBeVisible();
});
