/**
 * Final batch of the approval-window gate (plan, Fidelity Gate "Onay penceresi kapisi"): all six C-09 kinds x review, waiting,
 * done, each opened from its real screen (the openers in approval.helpers.ts, shared with the per-kind specs), plus the
 * C-Mobile join sheet re-check at 390 dark. updateAgent has no C-09 view and is not part of the gate.
 */
import { expect, test } from "@playwright/test";
import { COMMONWEALTH, expectApprovalGate, expectDialogMetrics, expectMobileJoinGate, expectSheetMetrics, OPENERS } from "./approval.helpers";
import { expectNoA11yViolations, expectNoHorizontalScroll, isProject } from "./helpers";

// approval flows drive several dialogs; the 30s default flakes under parallel load
test.describe.configure({ timeout: 60_000 });

const TX = /^Transaction 0x[0-9a-f]{4}…[0-9a-f]{4} ↗$/i;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const CONTRACT_LINE: Record<keyof typeof OPENERS, string | RegExp> = {
  joinDao: "DAO membership · 0x61f0…aa32 ↗",
  spend: short(COMMONWEALTH),
  deployTreasury: "Treasury factory · 0xa4c7…0e55 ↗",
  createDao: "DAO factory · 0x2b51…d7e0 ↗",
  registerAgent: "Agent registry · 0x9e2d…41b3 ↗",
  claim: "Payment router · 0x5c3a…8b27 ↗",
};
const KINDS = (Object.keys(OPENERS) as (keyof typeof OPENERS)[]).map((kind) => ({ kind, contract: CONTRACT_LINE[kind] }));

test.describe("C-09 approval window, all kinds (desktop 1280 light)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

  for (const { kind, contract } of KINDS) {
    test(`${kind}: review, waiting, done`, async ({ page }) => {
      await OPENERS[kind](page);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expectApprovalGate(page, kind, "review");
      await expect(dialog.getByText(contract)).toBeVisible();
      await expectDialogMetrics(page);
      await expectNoHorizontalScroll(page, 1280);
      await expectApprovalGate(page, kind, "waiting");
      await expectApprovalGate(page, kind, "done");
      await expect(dialog.getByText(TX)).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }
});

test.describe("C-Mobile join sheet re-check (390 dark)", () => {
  test.beforeEach(({}, info) => test.skip(!isProject(info, "mobile-dark")));

  test("joinDao sheet, then the C-09 text for waiting and done", async ({ page }) => {
    await OPENERS.joinDao(page);
    await expectMobileJoinGate(page);
    await expectSheetMetrics(page);
    await page.getByRole("dialog").getByRole("button", { name: "Approve and sign" }).click();
    await expectApprovalGate(page, "joinDao", "waiting");
    await expectApprovalGate(page, "joinDao", "done");
    await expect(page.getByRole("dialog").getByText(TX)).toBeVisible();
  });
});
