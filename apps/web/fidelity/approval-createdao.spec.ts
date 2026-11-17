/** Approval gate (C-09-Approval) for createDao, opened from /daos/new/ with the prototype defaults. */
import { expect, test } from "@playwright/test";
import { expectApprovalGate, expectDialogMetrics, OPENERS } from "./approval.helpers";
import { expectNoA11yViolations, isProject, screenshotPair } from "./helpers";

// approval flows drive several dialogs; the 30s default flakes under parallel load
test.describe.configure({ timeout: 60_000 });

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

test("createDao: review, waiting, done", async ({ page }, info) => {
  await OPENERS.createDao(page);

  const dialog = page.getByRole("dialog");
  await expectApprovalGate(page, "createDao", "review");
  await expect(dialog.getByText(/^DAO factory · 0x2b51…d7e0 ↗$/)).toBeVisible();
  await expectDialogMetrics(page);
  await expectNoA11yViolations(page);
  await screenshotPair(page, info, "approval-createdao-review");

  await expectApprovalGate(page, "createDao", "waiting");
  await expectApprovalGate(page, "createDao", "done");
  await expect(dialog.getByText(/^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i)).toBeVisible();
  await screenshotPair(page, info, "approval-createdao-done");
});
