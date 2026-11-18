import { defineConfig } from "@playwright/test";

/**
 * B5: tarayicida calisan model (Pyodide + Web Worker) uctan uca. Derleme `NEXT_PUBLIC_OYUN_KAYNAK=tarayici` ile yapilir ve statik `out/`
 * `wrangler dev` (Cloudflare Workers statik varlik sunumu, yerel; deploy YOK) ile sunulur. Yavas test (gercek model, ~3 sn/hafta): ayri yapilandirma,
 * normal `pnpm e2e` calistirmasina girmez (`e2e/oyun/tarayici.spec.ts` bu yapilandirma disinda atlanir).
 *
 *   pnpm --filter web e2e:tarayici        (E2E_PORT ile kapi secilir; E2E_REUSE=1 calisan sunucuyu yeniden kullanir, bayrakli derlenmis olmalidir)
 */
process.env.E2E_TARAYICI = "1";
const PORT = Number(process.env.E2E_PORT ?? 3102);

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/oyun/tarayici.spec.ts", "e2e/oyun/tarayiciB8.spec.ts"],
  outputDir: "test-results/tarayici",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [{ name: "desktop-light", use: { viewport: { width: 1280, height: 900 }, colorScheme: "light" } }],
  webServer: {
    command: `NEXT_PUBLIC_OYUN_KAYNAK=tarayici pnpm build && npx --yes wrangler@4.163.0 dev --config ../../wrangler.jsonc --port ${PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/oyun/`,
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 400_000,
  },
});
