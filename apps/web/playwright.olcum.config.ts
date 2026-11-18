import { defineConfig } from "@playwright/test";

/**
 * B9: tarayicida (Pyodide + Web Worker) TEK SEFERLIK olcum. Derleme `NEXT_PUBLIC_OYUN_KAYNAK=tarayici NEXT_PUBLIC_OYUN_OLCUM=1` ile yapilir ve statik `out/`
 * `wrangler dev` (yerel; deploy YOK) ile sunulur. CI'a ve normal `pnpm e2e` / `e2e:tarayici` kosusuna girmez (`e2e/olcum/olcum.spec.ts` bu yapilandirma disinda atlanir).
 *
 *   pnpm --filter web e2e:olcum                      OLCUM_MOTOR=chromium|firefox|webkit  OLCUM_HAFTA=520  OLCUM_ETKINLIK=uzun|ilk|devam|devamdao|arkaplan
 *   (E2E_PORT: kapi; E2E_REUSE=1: calisan, ayni bayrakli derlenmis sunucuyu yeniden kullanir; OLCUM_CIKTI: cikti dizini)
 *
 * Her etkinlik ayri kosulur (tek koşu; tekrar yok): `OLCUM_ETKINLIK` ile secilir.
 */
process.env.E2E_OLCUM = "1";
const PORT = Number(process.env.E2E_PORT ?? 3104);
const MOTOR = (process.env.OLCUM_MOTOR ?? "chromium") as "chromium" | "firefox" | "webkit";

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/olcum/olcum.spec.ts"],
  outputDir: "test-results/olcum",
  fullyParallel: false,
  workers: 1,
  timeout: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...(MOTOR === "chromium" ? { launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] } } : {}),
  },
  projects: [{ name: MOTOR, use: { browserName: MOTOR, viewport: { width: 1280, height: 900 }, colorScheme: "light" } }],
  webServer: {
    command: `NEXT_PUBLIC_OYUN_KAYNAK=tarayici NEXT_PUBLIC_OYUN_OLCUM=1 pnpm build && npx --yes wrangler@4.163.0 dev --config ../../wrangler.jsonc --port ${PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/oyun/`,
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 400_000,
  },
});
