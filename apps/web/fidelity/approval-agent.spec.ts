/**
 * Approval window gate for registerAgent (C-09-Approval, agent view): review, waiting, done.
 * The prototype registers Ox-Relay with the key 0x0b97…e2C4 and the profile ipfs://bafy…oxrelay.json, so the form is filled
 * with exactly those values. Done text: C8 (Agent #id when a Metadata URL was used), recorded in exceptions.ts.
 */
import { expect, test } from "@playwright/test";
import { expectApprovalGate, expectDialogMetrics, openRegisterAgent } from "./approval.helpers";
import { expectNoA11yViolations, isProject, screenshotPair } from "./helpers";

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

test("registerAgent: review, waiting, done", async ({ page }, info) => {
  await openRegisterAgent(page, "url");

  const dialog = page.getByRole("dialog");
  await expectApprovalGate(page, "registerAgent", "review");
  await expect(dialog.getByText("Agent registry · 0x9e2d…41b3 ↗")).toBeVisible();
  // the prototype line stays excused in exceptions.ts for the Name path only; on this path it must be on the page as written
  await expect(dialog).toContainText("Agent key 0x0b97…e2C4 is linked to your wallet as its owner. Its profile is read from ipfs://bafy…oxrelay.json.");
  await expectDialogMetrics(page);
  await expectNoA11yViolations(page);
  await screenshotPair(page, info, "approval-agent-review");

  await expectApprovalGate(page, "registerAgent", "waiting");
  await screenshotPair(page, info, "approval-agent-waiting");

  await expectApprovalGate(page, "registerAgent", "done");
  await expect(dialog.getByText("Agent #10 is registered. You can now join DAOs with it.")).toBeVisible();
  await expect(dialog.getByText(/^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i)).toBeVisible();
  await screenshotPair(page, info, "approval-agent-done");
  await expectNoA11yViolations(page);
});

test("registerAgent through the Name path: review, waiting, done", async ({ page }) => {
  await openRegisterAgent(page, "name");

  const dialog = page.getByRole("dialog");
  await expectApprovalGate(page, "registerAgent", "review");
  await expect(dialog.getByText(/Its profile is read from the registration file for Ox\u2011Relay\./)).toBeVisible();
  await expect(dialog).not.toContainText("data:application");
  await expectApprovalGate(page, "registerAgent", "waiting");
  await expectApprovalGate(page, "registerAgent", "done");
  // the done line now matches the prototype's because the name is known
  await expect(dialog.getByText("Ox\u2011Relay is registered. You can now join DAOs with it.")).toBeVisible();
  await expect(dialog.getByText(/^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i)).toBeVisible();
});
