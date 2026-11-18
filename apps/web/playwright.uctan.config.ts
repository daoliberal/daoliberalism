import { defineConfig } from "@playwright/test";

/**
 * B10: Faz 2 kabul senaryolari UC motorda (Chromium, Firefox, WebKit). Derlemeleri (`globalSetup`: bayrakli s1 + yeni model paketli s2) ve her senaryonun
 * yerel `wrangler dev` sunucusunu (deploy YOK) test kodu yonetir. Yavas (gercek model): normal `pnpm e2e` calistirmasina girmez
 * (`e2e/oyun/uctan.spec.ts` bu yapilandirma disinda atlanir).
 *
 *   pnpm --filter web e2e:uctan                       (E2E_UCTAN_PORT: kapi; E2E_UCTAN_DIZIN: onceden kurulmus s1/s2 dizini; yoksa gecici kurulur ve silinir)
 *   pnpm --filter web e2e:uctan --project=firefox     (tek motor)
 */
process.env.E2E_UCTAN = "1";

const yazilimGL = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const gorunum = { width: 1280, height: 900 };

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/oyun/uctan.spec.ts"],
  outputDir: "test-results/uctan",
  globalSetup: "./e2e/oyun/uctanKur.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure", actionTimeout: 30_000 },
  projects: [
    { name: "chromium", use: { browserName: "chromium", viewport: gorunum, colorScheme: "light", launchOptions: { args: yazilimGL } } },
    { name: "firefox", use: { browserName: "firefox", viewport: gorunum, colorScheme: "light" } },
    { name: "webkit", use: { browserName: "webkit", viewport: gorunum, colorScheme: "light" } },
  ],
});
