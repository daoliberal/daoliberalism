/** Signing-dialog gate for `spend` (C-09-Approval, {k:'spend', phase}) at 1280 light, opened from the treasury detail. */
import { expect, test } from "@playwright/test";
import { COMMONWEALTH, expectApprovalGate, expectDialogMetrics, OPENERS } from "./approval.helpers";
import { expectNoA11yViolations, expectNoHorizontalScroll, isProject, screenshotPair } from "./helpers";

const TX_LINE = /^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i;

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

test("spend approval: review, waiting, done", async ({ page }, info) => {
  await OPENERS.spend(page);
  const dialog = page.getByRole("dialog");

  await expectApprovalGate(page, "spend", "review");
  await expect(dialog).toContainText(`${COMMONWEALTH.slice(0, 6)}…${COMMONWEALTH.slice(-4)}`); // N1: the treasury contract
  await expectDialogMetrics(page);
  await expectNoHorizontalScroll(page, 1280);
  await expectNoA11yViolations(page);
  await screenshotPair(page, info, "approval-spend-review");

  await expectApprovalGate(page, "spend", "waiting");
  await expectNoA11yViolations(page);
  await screenshotPair(page, info, "approval-spend-waiting");

  await expectApprovalGate(page, "spend", "done");
  const lines = (await dialog.innerText()).split("\n").map((l) => l.trim());
  expect(lines.some((l) => TX_LINE.test(l)), "Transaction line inside the dialog").toBe(true);
  await expectNoA11yViolations(page);
  await screenshotPair(page, info, "approval-spend-done");
});
