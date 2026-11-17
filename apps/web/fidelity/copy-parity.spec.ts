/** The root argument of assertCopyParity scopes the comparison: text outside it must not satisfy parity. */
import { expect, test } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { isProject } from "./helpers";

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

const page_ = (inside: string) =>
  `<body><p>Waiting for your wallet</p><div role="dialog" aria-label="d"><p>${inside}</p></div></body>`;

test("text behind the dialog does not satisfy parity when root is the dialog", async ({ page }) => {
  await page.setContent(page_("something else"));
  await expect(assertCopyParity(page, "C-09-Approval", { k: "join", phase: "waiting" }, {}, page.getByRole("dialog"))).rejects.toThrow(/Waiting for your wallet/);
});

test("the same line inside the dialog is found", async ({ page }) => {
  await page.setContent(page_("Waiting for your wallet Check the request in your wallet. Nothing happens until you approve it there. Prototype: simulate wallet approval Membership Testnet Let Atlas‑7 join Northwind Studio"));
  await assertCopyParity(page, "C-09-Approval", { k: "join", phase: "waiting" }, {}, page.getByRole("dialog"));
});
