import { expect, test } from "@playwright/test";
import { gotoApp, isProject } from "../fidelity/helpers";

// Mock state lives in memory: after the first load every step navigates through in-app links (no page.goto), or the join would be lost.

test.describe("join a DAO with my agent (desktop)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("DAOs -> Northwind Studio -> join with Atlas‑7 -> 7 agents, in the list too", async ({ page }) => {
    await gotoApp(page, "/daos/", { wallet: "owner" });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Brightwater Research", "Fieldnotes Co-op", "Ledgerline Labs", "Northwind Studio", "Paper Lantern Translation", "Quiet Harbor", "Sparrow Data"]);
    await page.getByRole("link", { name: "Northwind Studio", exact: true }).click();
    await expect(page).toHaveURL(/\/dao\/\?id=1$/);
    const members = page.getByRole("region", { name: /^Members/ });
    await expect(members.getByRole("heading", { level: 2 })).toHaveText("Members 6 agents");

    const panel = page.getByRole("complementary", { name: "Join with my agent" });
    await expect(panel.getByRole("button", { name: /Atlas‑7/ })).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "Review and sign" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Approve and sign" }).click();
    await expect(dialog.getByText("Waiting for your wallet")).toBeVisible();
    await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await expect(dialog.getByText("Confirmed on-chain")).toBeVisible();
    await expect(dialog.getByText(/^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i)).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(members.getByRole("heading", { level: 2 })).toHaveText("Members 7 agents");
    await expect(members.getByRole("cell", { name: "Atlas‑7" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Atlas‑7/ })).toHaveAttribute("aria-disabled", "true");
    await expect(panel.getByRole("button", { name: /Atlas‑7/ })).toContainText("Already a member");
    await expect(page.getByRole("region", { name: /Works under/ })).toContainText("143/500");

    // back to the list through the nav: the member count moved to 7 and survived (no reload happened)
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "DAOs" }).click();
    const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: "Northwind Studio", exact: true }) });
    await expect(card.getByText("Members").locator("xpath=following-sibling::div")).toHaveText("7");
  });

  test("a visitor without a wallet is asked to connect, and can then join", async ({ page }) => {
    await gotoApp(page, "/daos/");
    await page.getByRole("link", { name: "Fieldnotes Co-op", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Join with my agent" });
    await expect(panel.getByText("Connect your wallet to continue.")).toBeVisible();
    await panel.getByRole("button", { name: "Connect wallet" }).click();
    // Atlas‑7 is already in Fieldnotes: the next free agent is the default
    await expect(panel.getByRole("button", { name: /Juniper/ })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("button", { name: /Atlas‑7/ })).toHaveAttribute("aria-disabled", "true");
  });

  test("the list filters by treasury and by search", async ({ page }) => {
    await gotoApp(page, "/daos/");
    await page.getByLabel("Treasury").selectOption({ label: "Lean Guild" });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Quiet Harbor"]);
    await page.getByLabel("Treasury").selectOption({ label: "All treasuries" });
    await page.getByLabel("Search").fill("transcription");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Fieldnotes Co-op"]);
    await page.getByLabel("Search").fill("zzz");
    await expect(page.getByText("No DAOs match.")).toBeVisible();
  });

  test("an unknown id shows the not-found message", async ({ page }) => {
    await gotoApp(page, "/dao/?id=999");
    await expect(page.getByText("DAO not found.")).toBeVisible();
  });
});

test.describe("join a DAO with my agent (phone)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("an equal-split DAO opens the join sheet", async ({ page }) => {
    await gotoApp(page, "/daos/", { wallet: "owner" });
    await page.getByRole("link", { name: "Northwind Studio", exact: true }).click();
    await page.getByRole("button", { name: "Review and sign" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("Let Atlas‑7 join Northwind Studio?");
    await expect(sheet.getByText("If a customer pays")).toBeVisible();
    await sheet.getByRole("button", { name: "Approve and sign" }).click();
    await sheet.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await expect(sheet.getByText("Confirmed on-chain")).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("region", { name: /^Members/ }).getByRole("heading", { level: 2 })).toHaveText("Members 7 agents");
  });

  test("a custom-split DAO falls back to the full approval view in the sheet (owner approval pending)", async ({ page }) => {
    await gotoApp(page, "/daos/", { wallet: "owner" });
    await page.getByRole("link", { name: "Ledgerline Labs", exact: true }).click();
    await page.getByRole("button", { name: "Review and sign" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("What will happen")).toBeVisible();
    await expect(sheet.getByText("If a customer pays")).toHaveCount(0);
    await expect(sheet.getByText(/Custom rule/)).toBeVisible();
  });
});
