/** expectToken: passes when the computed value comes from the token, fails for a wrong value and for an undefined token. */
import { expect, test } from "@playwright/test";
import { expectToken, isProject } from "./helpers";

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

const PAGE = `<style>:root{--fs-x:22px;--color-x:rgb(1, 2, 3)}</style><body><p id=a style="font-size:var(--fs-x)">a</p><p id=b style="font-size:20px">b</p></body>`;

test("matches the token's value", async ({ page }) => {
  await page.setContent(PAGE);
  await expectToken(page.locator("#a"), "font-size", "--fs-x");
});

test("fails when the value differs from the token", async ({ page }) => {
  await page.setContent(PAGE);
  await expect(expectToken(page.locator("#b"), "font-size", "--fs-x")).rejects.toThrow();
});

test("fails for a token name that does not exist, even for an inherited property", async ({ page }) => {
  await page.setContent(PAGE);
  await expect(expectToken(page.locator("#a"), "color", "--color-missing")).rejects.toThrow(/not defined in tokens\.css/);
});
