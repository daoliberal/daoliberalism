import { defineConfig } from "@playwright/test";

/**
 * B7: Service Worker, on onbellek, surum gecisi, onceki model paketi ve CSP uctan uca (Chromium). Sunucuyu (yerel `wrangler dev`, deploy YOK) ve derlemeleri
 * spec kendisi yonetir: bayrakli derleme, yeni model paketli ikinci surum ve bayraksiz (onizleme) derleme. Yavas (gercek model): normal `pnpm e2e` calistirmasina
 * girmez (`e2e/oyun/swOnbellek.spec.ts` bu yapilandirma disinda atlanir).
 *
 *   pnpm --filter web e2e:sw        (E2E_SW_PORT ile kapi secilir)
 */
process.env.E2E_SW = "1";

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/oyun/swOnbellek.spec.ts"],
  outputDir: "test-results/sw",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    actionTimeout: 30_000,
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [{ name: "desktop-light", use: { viewport: { width: 1280, height: 900 }, colorScheme: "light" } }],
});
