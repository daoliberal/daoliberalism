import { expect, test, type Page } from "@playwright/test";
import { gotoApp } from "../fidelity/helpers";

const KEY = "0x2222222222222222222222222222222222222222";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-light", "flows are driven on the desktop layout"));

async function sign(page: Page, cta: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: cta, exact: true }).click();
  await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
  await expect(dialog.getByText("Confirmed on-chain")).toBeVisible();
  return dialog;
}

test("register an agent from the form: the card carries the Name", async ({ page }) => {
  await gotoApp(page, "/agents/", { wallet: "owner" });
  await expect(page.getByRole("article")).toHaveCount(3);
  await page.getByRole("button", { name: "Register agent" }).click();
  await page.getByLabel("Agent key address").first().fill(KEY);
  await page.getByLabel("Name").fill("Nova");
  await page.getByLabel("Description").fill("Does research.");
  await page.getByRole("button", { name: "Register and sign" }).click();
  const dialog = await sign(page, "Register and sign");
  await expect(dialog.getByText("Nova is registered. You can now join DAOs with it.")).toBeVisible();
  await expect(dialog.getByText(/^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Nova" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Register an agent" })).toHaveCount(0);
});

test("register with a metadata URL: the card is Agent #id", async ({ page }) => {
  await gotoApp(page, "/agents/", { wallet: "owner" });
  await page.getByRole("button", { name: "Register agent" }).click();
  await page.getByLabel("Agent key address").first().fill(KEY);
  await page.getByLabel("Metadata URL").fill("https://unknown.example/agent.json");
  await page.getByRole("button", { name: "Register and sign" }).click();
  const dialog = await sign(page, "Register and sign");
  await expect(dialog.getByText("Agent #10 is registered. You can now join DAOs with it.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Agent #10" })).toBeVisible();
});

test("edit the key of an agent", async ({ page }) => {
  await gotoApp(page, "/agents/", { wallet: "owner" });
  const juniper = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Juniper" }) });
  await juniper.getByRole("button", { name: "Edit key or metadata" }).click();
  await juniper.getByLabel("Agent key address").fill(KEY);
  // one change per signature: the other fields are locked
  await expect(juniper.getByLabel("Name")).toBeDisabled();
  await expect(juniper.getByLabel("Metadata URL")).toBeDisabled();
  await juniper.getByRole("button", { name: "Save and sign" }).click();
  const dialog = await sign(page, "Update and sign");
  await expect(dialog.getByText("Juniper is updated.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(juniper.getByText("key 0x2222…2222")).toBeVisible();
  await expect(juniper.getByRole("button", { name: "Edit key or metadata" })).toBeVisible();
});

test("claim from My earnings, then see it in the claim history (in-app navigation only)", async ({ page }) => {
  await gotoApp(page, "/agents/", { wallet: "owner" });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My earnings" }).click();
  await expect(page).toHaveURL(/\/earnings\/$/);
  const claim = page.getByRole("button", { name: "Claim 0.412 ETH" });
  await expect(claim).toBeEnabled();
  await page.getByRole("checkbox", { name: "Select order 1042" }).uncheck();
  await expect(page.getByRole("button", { name: "Claim 0.259 ETH" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select order 1042" }).check();
  await claim.click();
  const dialog = await sign(page, "Claim and sign");
  await expect(dialog.getByText("0.412 ETH is in your wallet.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Claim 0.000 ETH" })).toBeDisabled();
  await expect(page.getByText("2.312 ETH")).toBeVisible();
  await page.getByRole("tab", { name: "Claim history" }).click();
  await expect(page.getByRole("row").nth(1)).toContainText("3 credits");
  await expect(page.getByRole("row").nth(1)).toContainText("0.412 ETH");
});

test("a visitor without a wallet is asked to connect", async ({ page }) => {
  await page.goto("/earnings/");
  await expect(page.getByText("Connect your wallet to continue.")).toBeVisible();
});
