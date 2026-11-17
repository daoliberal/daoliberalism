/** driveApproval phase detection, against a static fixture dialog that swaps its own content like the app does. */
import { expect, test } from "@playwright/test";
import { driveApproval } from "./approval.helpers";
import { isProject } from "./helpers";

test.beforeEach(({}, info) => test.skip(!isProject(info, "desktop-light")));

const REVIEW = `<button id=cta onclick="go('waiting')">Sign spend</button>`;
const WAITING = `<p>Waiting for your wallet</p><button onclick="go('done')">Prototype: simulate wallet approval</button>`;
const DONE = `<p>Confirmed on-chain</p>`;

// Each click is counted on window so tests can see exactly which buttons were pressed.
const FIXTURE = `<body><div role="dialog" aria-label="d" id="d">${REVIEW}</div><script>
window.clicks = [];
const views = { review: ${JSON.stringify(REVIEW)}, waiting: ${JSON.stringify(WAITING)}, done: ${JSON.stringify(DONE)} };
function go(p) { window.clicks.push(p); document.getElementById('d').innerHTML = views[p]; }
</script></body>`;

const clicks = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as { clicks: string[] }).clicks);

test("review to done presses the CTA then the simulate button", async ({ page }) => {
  await page.setContent(FIXTURE);
  await driveApproval(page, "spend", "done");
  expect(await clicks(page)).toEqual(["waiting", "done"]);
});

test("repeating a phase is a no-op", async ({ page }) => {
  await page.setContent(FIXTURE);
  await driveApproval(page, "spend", "review");
  await driveApproval(page, "spend", "waiting");
  await driveApproval(page, "spend", "waiting");
  expect(await clicks(page)).toEqual(["waiting"]);
  await driveApproval(page, "spend", "done");
  await driveApproval(page, "spend", "done");
  expect(await clicks(page)).toEqual(["waiting", "done"]);
});

test("waiting to done presses simulate only", async ({ page }) => {
  await page.setContent(FIXTURE);
  await driveApproval(page, "spend", "waiting");
  await driveApproval(page, "spend", "done");
  expect(await clicks(page)).toEqual(["waiting", "done"]);
});

test("going backwards throws", async ({ page }) => {
  await page.setContent(FIXTURE);
  await driveApproval(page, "spend", "done");
  await expect(driveApproval(page, "spend", "review")).rejects.toThrow(/already past review/);
});
