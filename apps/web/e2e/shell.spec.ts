import { expect, test } from "@playwright/test";
import { waitForLayout } from "../fidelity/helpers";

test.describe("shell on a desktop viewport", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "desktop layout only");
  });

  test("landing: Connect wallet connects and opens the treasuries page", async ({ page }) => {
    await page.goto("/");
    await waitForLayout(page, "wide");
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    await expect(page.getByText("Testnet", { exact: true })).toBeVisible();
    await page.getByRole("banner").getByRole("link", { name: "Connect wallet" }).click();
    await expect(page).toHaveURL(/\/treasuries\/$/);
    await expect(page.getByRole("button", { name: "0x91c4…a4F2" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Treasuries" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link")).toHaveText(["Treasuries", "DAOs", "My agents", "My earnings"]);
  });

  test("?mockWallet=founder shows the founder address", async ({ page }) => {
    await page.goto("/treasuries/?mockWallet=founder");
    await expect(page.getByRole("button", { name: "0x3b02…7E21" })).toBeVisible();
  });

  test("the connected session survives client-side navigation and a reload", async ({ page }) => {
    await page.goto("/treasuries/?mockWallet=owner");
    // A marker on window survives only a client-side (no full page load) navigation.
    await page.evaluate(() => ((window as unknown as { marker: string }).marker = "same-page"));
    await page.getByRole("link", { name: "daoliberal" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe("same-page");
    await expect(page.getByRole("button", { name: "0x91c4…a4F2" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "0x91c4…a4F2" })).toBeVisible();
  });

  test("a visitor can connect from the app header", async ({ page }) => {
    await page.goto("/treasuries/");
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.getByRole("button", { name: "0x91c4…a4F2" })).toBeVisible();
  });

  test("header touch targets are at least 44px", async ({ page }) => {
    await page.goto("/treasuries/?mockWallet=owner");
    await waitForLayout(page, "wide");
    for (const target of [page.getByRole("button", { name: "0x91c4…a4F2" }), ...(await page.getByRole("navigation", { name: "Main" }).getByRole("link").all())]) {
      const box = await target.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("shell on a 390px phone", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-dark", "phone layout only");
  });

  test("the layout and theme attributes are written; tab bar replaces the nav", async ({ page }) => {
    await page.goto("/treasuries/?mockWallet=owner");
    await waitForLayout(page, "narrow");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const tabs = page.getByRole("navigation", { name: "Main" }).getByRole("link");
    await expect(tabs).toHaveText(["Treasuries", "DAOs", "Agents", "Earnings"]);
    await expect(tabs.first()).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("My agents")).toHaveCount(0);
  });

  test("phone controls are 44px and the tab bar uses the tab height", async ({ page }) => {
    await page.goto("/treasuries/?mockWallet=owner");
    await waitForLayout(page, "narrow");
    const wallet = await page.getByRole("button", { name: "Wallet 0x91c4…a4F2" }).boundingBox();
    expect(wallet?.width).toBe(44);
    expect(wallet?.height).toBe(44);
    for (const tab of await page.getByRole("navigation", { name: "Main" }).getByRole("link").all()) {
      expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(52);
    }
  });

  test("the tab bar sits at the bottom of a short page and the page does not scroll sideways", async ({ page }) => {
    await page.goto("/treasuries/?mockWallet=owner");
    await waitForLayout(page, "narrow");
    const bar = await page.getByRole("navigation", { name: "Main" }).boundingBox();
    const viewport = page.viewportSize()!;
    expect(Math.round(bar!.y + bar!.height)).toBe(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test("the treasury route gets the back header", async ({ page }) => {
    await page.goto("/treasury/?mockWallet=owner");
    await waitForLayout(page, "narrow");
    const back = page.getByRole("link", { name: "Back to treasuries" });
    await expect(back).toHaveAttribute("href", "/treasuries/");
    const box = await back.boundingBox();
    expect(box?.width).toBe(44);
    expect(box?.height).toBe(44);
  });
});
