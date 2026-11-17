/**
 * Driver for the signing dialog's gate (C-09-Approval on desktop, C-Mobile for the phone join sheet).
 *
 * The screen's own spec opens the dialog in its review state (e.g. fills the Spend form and clicks "Review and sign"),
 * then calls `expectApprovalGate(page, kind, phase)`: it advances the dialog to `phase`, and compares the page with the
 * prototype in the same state (G1). G2 to G5 for the dialog come from `expectDialogMetrics` and the helpers in helpers.ts.
 */
import { expect, type Page } from "@playwright/test";
import { DEFAULT_FIXTURES } from "../src/data/mock/fixtures";
import type { ActionRequest } from "../src/data/types";
import { assertCopyParity } from "./copy-parity";
import { expectStyles, expectToken, gotoApp } from "./helpers";

export type ApprovalKind = ActionRequest["kind"];
export type ApprovalPhase = "review" | "waiting" | "done";

/** The key of each kind in C-09-Approval's `V` map. updateAgent has no C-09 view and is not part of the gate. */
export const C09_KEY: Record<Exclude<ApprovalKind, "updateAgent">, "join" | "spend" | "deploy" | "dao" | "agent" | "claim"> = {
  joinDao: "join",
  spend: "spend",
  deployTreasury: "deploy",
  createDao: "dao",
  registerAgent: "agent",
  claim: "claim",
};

/** Label of the signing button per kind (C-09 `V[k].cta`). */
export const CTA: Record<Exclude<ApprovalKind, "updateAgent">, string> = {
  joinDao: "Approve and sign",
  spend: "Sign spend",
  deployTreasury: "Deploy and sign",
  createDao: "Create and sign",
  registerAgent: "Register and sign",
  claim: "Claim and sign",
};

/** The treasury the spend gate opens on (Commonwealth). */
export const COMMONWEALTH = DEFAULT_FIXTURES.treasuries[0]!.address;

/**
 * Openers: each one starts from the real screen and clicks through to the dialog's review state (the single copy of these
 * flows; the per-kind specs and the batch spec both use them).
 */
export const OPENERS: Record<Exclude<ApprovalKind, "updateAgent">, (page: Page) => Promise<void>> = {
  async joinDao(page) {
    await gotoApp(page, "/dao/?id=1", { wallet: "owner" });
    const panel = page.getByRole("complementary", { name: "Join with my agent" });
    await expect(panel.getByRole("button", { name: /Atlas‑7/ })).toContainText("in 2 DAOs");
    await panel.getByRole("button", { name: "Review and sign" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
  async spend(page) {
    await gotoApp(page, `/treasury/?a=${COMMONWEALTH}`, { wallet: "founder" });
    await page.getByRole("button", { name: "Spend from treasury" }).click();
    await page.getByLabel("Recipient address").fill("0x7e19aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab2c0");
    await page.getByLabel("Amount (ETH)").fill("1.25");
    await page.getByRole("button", { name: "Review and sign" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
  async deployTreasury(page) {
    await gotoApp(page, "/treasuries/new/", { wallet: "owner" });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Deploy and sign" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
  async createDao(page) {
    await gotoApp(page, "/daos/new/", { wallet: "owner" });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create DAO and sign" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
  registerAgent: (page) => openRegisterAgent(page, "url"),
  async claim(page) {
    await gotoApp(page, "/earnings/", { wallet: "owner" });
    await page.getByRole("button", { name: "Claim 0.412 ETH" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
};

/** registerAgent with the prototype's Ox-Relay values: through the Metadata URL (as written) or through the Name form. */
export async function openRegisterAgent(page: Page, via: "url" | "name"): Promise<void> {
  await gotoApp(page, "/agents/", { wallet: "owner" });
  await page.getByRole("button", { name: "Register agent" }).click();
  await page.getByLabel("Agent key address").fill("0x0b97f3d21c84a5e60b17d93ac2f4e8b15a6be2C4");
  if (via === "url") await page.getByLabel("Metadata URL").fill("ipfs://bafy…oxrelay.json");
  else await page.getByLabel("Name").fill("Ox\u2011Relay");
  await page.getByRole("button", { name: "Register and sign" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

function keyOf(kind: ApprovalKind): (typeof C09_KEY)[keyof typeof C09_KEY] {
  if (kind === "updateAgent") throw new Error("updateAgent has no C-09 view; it is not part of the approval gate");
  return C09_KEY[kind];
}

/** The prototype state for a kind and phase: what `assertCopyParity` needs. */
export function approvalState(kind: ApprovalKind, phase: ApprovalPhase): { k: string; phase: ApprovalPhase } {
  return { k: keyOf(kind), phase };
}

/** The phase the open dialog is showing. */
async function currentPhase(page: Page): Promise<ApprovalPhase> {
  const dialog = page.getByRole("dialog");
  if (await dialog.getByText("Confirmed on-chain").isVisible()) return "done";
  if (await dialog.getByText("Waiting for your wallet").isVisible()) return "waiting";
  return "review";
}

/**
 * Moves the open dialog forward to `phase` the way a user would (CTA, then the mock wallet approval), starting from
 * whatever phase it shows now. Idempotent at the target phase; it never goes backwards (reopen the dialog for that).
 */
export async function driveApproval(page: Page, kind: ApprovalKind, phase: ApprovalPhase): Promise<void> {
  keyOf(kind);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const order: ApprovalPhase[] = ["review", "waiting", "done"];
  const now = await currentPhase(page);
  if (order.indexOf(now) > order.indexOf(phase)) throw new Error(`dialog is already past ${phase} (at ${now})`);
  if (now === "review" && phase !== "review") {
    await dialog.getByRole("button", { name: CTA[kind as Exclude<ApprovalKind, "updateAgent">], exact: true }).click();
    await expect(dialog.getByText("Waiting for your wallet")).toBeVisible();
  }
  if ((await currentPhase(page)) === "waiting" && phase === "done") {
    await dialog.getByRole("button", { name: "Prototype: simulate wallet approval" }).click();
    await expect(dialog.getByText("Confirmed on-chain")).toBeVisible();
  }
}

/** G1 for the dialog: drive to `phase` (call in order review, waiting, done), then compare the dialog with C-09-Approval. */
export async function expectApprovalGate(page: Page, kind: ApprovalKind, phase: ApprovalPhase): Promise<void> {
  await driveApproval(page, kind, phase);
  await assertCopyParity(page, "C-09-Approval", approvalState(kind, phase), {}, page.getByRole("dialog"));
}

/** G1 for the phone join sheet (390px dark, review phase): compare with C-Mobile. */
export async function expectMobileJoinGate(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toBeVisible();
  await assertCopyParity(page, "C-Mobile", {}, {}, page.getByRole("dialog"));
}

/** G2 for the desktop dialog (C-09-Approval:27-40): twelve computed-style checks against the prototype's inline values. */
export async function expectDialogMetrics(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expectStyles(dialog, { width: "580px", "border-top-left-radius": "28px", "padding-top": "28px", "padding-left": "28px", gap: "18px", "background-color": "rgb(255, 255, 255)" });
  await expectToken(dialog, "box-shadow", "--shadow-modal");
  const title = dialog.getByRole("heading", { level: 2 });
  await expectStyles(title, { "font-size": "30px", "font-weight": "700", "line-height": "33px", "letter-spacing": "-0.3px" });
  await expect(title).toHaveCSS("font-family", /Bricolage Grotesque/);
}

/** G2 for the phone join sheet (C-Mobile:16-27). */
export async function expectSheetMetrics(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog");
  await expectStyles(sheet, { "border-top-left-radius": "28px", "padding-top": "22px", "padding-left": "20px", "padding-bottom": "20px", gap: "16px", "background-color": "rgb(20, 28, 35)" });
  const title = sheet.getByRole("heading", { level: 2 });
  await expectStyles(title, { "font-size": "27px", "font-weight": "700", "letter-spacing": "-0.27px" });
  await expectStyles(sheet.getByRole("button", { name: "Close" }), { width: "44px", height: "44px" });
  await expectStyles(sheet.getByRole("button", { name: "Approve and sign" }), { "min-height": "54px", "background-color": "rgb(111, 214, 192)", color: "rgb(6, 32, 25)" });
}
