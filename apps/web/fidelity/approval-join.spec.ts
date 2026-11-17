/**
 * Approval gate for joinDao: C-09-Approval (desktop 1280 light, phases review -> waiting -> done in order, one dialog) and
 * C-Mobile (the join sheet, 390x844 dark). The dialog is opened from the real DAO page: Northwind Studio, Atlas‑7.
 */
import { expect, test } from "@playwright/test";
import { expectApprovalGate, expectDialogMetrics, expectMobileJoinGate, expectSheetMetrics, OPENERS } from "./approval.helpers";
import { expectNoA11yViolations, expectNoHorizontalScroll, isProject, screenshotPair } from "./helpers";

// approval flows drive several dialogs; the 30s default flakes under parallel load
test.describe.configure({ timeout: 60_000 });

const TX = /^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i;

const openJoin = OPENERS.joinDao;

test.describe("joinDao approval, desktop (C-09)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  test("G1 to G5 in the three phases", async ({ page }, info) => {
    await openJoin(page);
    await expectApprovalGate(page, "joinDao", "review");
    await expectDialogMetrics(page);
    // N1: the contract line names the DAO membership contract and shows this DAO's own address
    await expect(page.getByRole("dialog").getByText("DAO membership · 0x61f0…aa32 ↗")).toBeVisible();
    await expectNoHorizontalScroll(page, 1280);
    await expectNoA11yViolations(page);
    await screenshotPair(page, info, "approval-join-review");

    await expectApprovalGate(page, "joinDao", "waiting");
    await expectNoA11yViolations(page);
    await screenshotPair(page, info, "approval-join-waiting");

    await expectApprovalGate(page, "joinDao", "done");
    await expect(page.getByRole("dialog").getByText(TX)).toBeVisible();
    await expectNoA11yViolations(page);
    await screenshotPair(page, info, "approval-join-done");
  });
});

test.describe("joinDao approval, phone (C-Mobile sheet)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("G1 to G5 on the sheet, then the C-09 text for the waiting and done phases", async ({ page }, info) => {
    await openJoin(page);
    await expectMobileJoinGate(page);
    await expectSheetMetrics(page);
    await expectNoHorizontalScroll(page, 390);
    await expectNoA11yViolations(page);
    await screenshotPair(page, info, "approval-join-sheet");

    await page.getByRole("dialog").getByRole("button", { name: "Approve and sign" }).click();
    await expectApprovalGate(page, "joinDao", "waiting");
    await expectApprovalGate(page, "joinDao", "done");
    await expect(page.getByRole("dialog").getByText(TX)).toBeVisible();
    await expectNoA11yViolations(page);
    await screenshotPair(page, info, "approval-join-sheet-done");
  });
});
