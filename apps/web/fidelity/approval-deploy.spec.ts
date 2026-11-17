/** Approval gate (C-09-Approval) for deployTreasury, opened from /treasuries/new/ with the prototype defaults. */
import { expect, test } from "@playwright/test";
import { expectApprovalGate, expectDialogMetrics, OPENERS } from "./approval.helpers";
import { expectNoA11yViolations, isProject, screenshotPair } from "./helpers";

// approval flows drive several dialogs; the 30s default flakes under parallel load
test.describe.configure({ timeout: 60_000 });

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

test("deployTreasury: review, waiting, done", async ({ page }, info) => {
  await OPENERS.deployTreasury(page);

  const dialog = page.getByRole("dialog");
  await expectApprovalGate(page, "deployTreasury", "review");
  await expect(dialog.getByText(/^Treasury factory · 0xa4c7…0e55 ↗$/)).toBeVisible();
  await expectDialogMetrics(page);
  await expectNoA11yViolations(page);
  await screenshotPair(page, info, "approval-deploy-review");

  await expectApprovalGate(page, "deployTreasury", "waiting");
  await expectApprovalGate(page, "deployTreasury", "done");
  await expect(dialog.getByText(/^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i)).toBeVisible();
  await screenshotPair(page, info, "approval-deploy-done");
});
