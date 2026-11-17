import { expect, test } from "@playwright/test";
import { DEFAULT_FIXTURES } from "../src/data/mock/fixtures";
import { gotoApp, isProject } from "../fidelity/helpers";

const COMMONWEALTH = DEFAULT_FIXTURES.treasuries[0]!.address;
const ROUTE = `/treasury/?a=${COMMONWEALTH}`;
const RECIPIENT = "0x7e19aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab2c0";

test.describe("treasury detail on a desktop viewport", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light"), "desktop layout only"));

  test("the founder reads the rulebook, spends and sees the balance and history update", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await expect(page.getByRole("heading", { level: 1, name: "Commonwealth" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Treasury fee", "Expenses", "Hold period", "Split rule", "Max agents", "Spending history"]);
    await expect(page.getByText("Balance now").locator("xpath=following-sibling::div")).toHaveText("23.408 ETH");

    await page.getByRole("button", { name: "Spend from treasury" }).click();
    await expect(page.getByLabel("Recipient address")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Review and sign" })).toBeDisabled();
    await page.getByLabel("Recipient address").fill(RECIPIENT);
    await page.getByLabel("Amount (ETH)").fill("1.25");
    await page.getByRole("button", { name: "Review and sign" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Send 1.250 ETH from Commonwealth");
    await dialog.getByRole("button", { name: "Sign spend" }).click();
    await expect(dialog.getByText("Waiting for your wallet")).toBeVisible();
    await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await expect(dialog.getByText("Confirmed on-chain")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(page.getByText("Balance now").locator("xpath=following-sibling::div")).toHaveText("22.158 ETH");
    await expect(page.getByText("Spent so far").locator("xpath=following-sibling::div")).toHaveText("10.850");
    const first = page.getByRole("table", { name: "Spending history" }).getByRole("row").nth(1);
    await expect(first).toContainText("1.250 ETH");
    await expect(page.getByRole("table", { name: "Spending history" }).getByRole("row")).toHaveCount(6);
    await expect(page.getByText("New spend")).toHaveCount(0);
  });

  test("an owner who is not the founder sees the rules but no Spend", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "owner" });
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await expect(page.getByRole("button", { name: "Spend from treasury" })).toHaveCount(0);
  });

  test("a visitor with no wallet sees no Spend", async ({ page }) => {
    await gotoApp(page, ROUTE);
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await expect(page.getByRole("button", { name: "Spend from treasury" })).toHaveCount(0);
  });

  test("the calculator recomputes from the amount and member count", async ({ page }) => {
    await gotoApp(page, ROUTE);
    await expect(page.getByText("Each owner (equal split)").locator("xpath=following-sibling::dd")).toHaveText("0.1533");
    await page.getByLabel("Customer pays (ETH)").fill("2");
    await page.getByLabel("Members in the DAO").fill("4");
    await expect(page.getByText("To members' owners").locator("xpath=following-sibling::dd")).toHaveText("1.84");
    await expect(page.getByText("Each owner (equal split)").locator("xpath=following-sibling::dd")).toHaveText("0.46");
  });

  test("an unknown or missing address says the treasury was not found", async ({ page }) => {
    await gotoApp(page, "/treasury/?a=0x00000000000000000000000000000000000000aa");
    await expect(page.getByText("Treasury not found")).toBeVisible();
    await gotoApp(page, "/treasury/");
    await expect(page.getByText("Treasury not found")).toBeVisible();
  });
});

test.describe("treasury detail on a phone", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark"), "phone layout only"));

  test("shows the rulebook and balance box and no Spend even for the founder", async ({ page }) => {
    await gotoApp(page, ROUTE, { wallet: "founder" });
    await expect(page.getByRole("heading", { level: 1, name: "Commonwealth" })).toBeVisible();
    await expect(page.getByText("142/500")).toBeVisible();
    await expect(page.getByText("23.408 ETH")).toBeVisible();
    await expect(page.getByRole("button", { name: "Spend from treasury" })).toHaveCount(0);
    await expect(page.getByText("Money-flow calculator")).toHaveCount(0);
    const card = page.getByRole("region", { name: "Customer pays" });
    await expect(card.getByRole("textbox")).toHaveValue("1.00");
    await expect(card).toContainText("Fee 5%");
    await expect(card).toContainText("To owners0.92");
    await card.getByRole("textbox").fill("2");
    await expect(card).toContainText("To owners1.84");
  });

  test("Spending history opens a sheet with the history and closes again", async ({ page }) => {
    await gotoApp(page, ROUTE);
    await page.getByRole("button", { name: "Spending history" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("listitem")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(sheet).toContainText("2.500 ETH");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("the history sheet keeps Tab inside, closes on Escape and returns focus to its trigger", async ({ page }) => {
    await gotoApp(page, ROUTE);
    const trigger = page.getByRole("button", { name: "Spending history" });
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
