/**
 * Runs G1 for one screen: driven by `pnpm --filter web fidelity:copy <C-0x file> <route> [state-json]` (see run-copy.mjs).
 * Without the environment variables the test skips, so a plain `pnpm fidelity` stays green.
 */
import { test } from "@playwright/test";
import { assertCopyParity } from "./copy-parity";
import { gotoApp } from "./helpers";

const file = process.env.FIDELITY_FILE;
const route = process.env.FIDELITY_ROUTE;
const state = JSON.parse(process.env.FIDELITY_STATE ?? "{}") as Record<string, unknown>;
const props = JSON.parse(process.env.FIDELITY_PROPS ?? "{}") as Record<string, unknown>;

test("copy parity with the prototype", async ({ page }) => {
  test.skip(!file || !route, "set FIDELITY_FILE and FIDELITY_ROUTE, or run pnpm fidelity:copy");
  await gotoApp(page, route!);
  await assertCopyParity(page, file!, state, props);
});
