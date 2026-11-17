/**
 * Approval window gate for claim (C-09-Approval, claim view): review, waiting, done.
 * N1: the contract row names the Payment router and the rules line carries the treasury addresses (both recorded in exceptions.ts).
 */
import { expect, test } from "@playwright/test";
import { expectApprovalGate, expectDialogMetrics, OPENERS } from "./approval.helpers";
import { expectNoA11yViolations, isProject, screenshotPair } from "./helpers";

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

test("claim: review, waiting, done", async ({ page }, info) => {
  await OPENERS.claim(page);

  const dialog = page.getByRole("dialog");
  await expectApprovalGate(page, "claim", "review");
  await expect(dialog.getByText("Payment router · 0x5c3a…8b27 ↗")).toBeVisible();
  await expect(dialog.getByText("Hold periods ended: 7 days (Commonwealth 0x4f2a…91c0), 14 days (Lean Guild 0x8c11…02ab).")).toBeVisible();
  await expectDialogMetrics(page);
  await expectNoA11yViolations(page);
  await screenshotPair(page, info, "approval-claim-review");

  await expectApprovalGate(page, "claim", "waiting");
  await screenshotPair(page, info, "approval-claim-waiting");

  await expectApprovalGate(page, "claim", "done");
  await expect(dialog.getByText(/^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i)).toBeVisible();
  await screenshotPair(page, info, "approval-claim-done");
  await expectNoA11yViolations(page);
});
