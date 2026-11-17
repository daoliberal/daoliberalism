import { defineConfig } from "@playwright/test";

/** Parallel worktrees can each run their own server: set E2E_PORT to avoid a clash. */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "fidelity/**/*.spec.ts"],
  outputDir: "test-results",
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Pixi tuvalinin gerçekten çizilmesi için yazılım GL (swiftshader); başsız Chromium'da GPU yok.
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  // Every spec runs in both projects unless it gates itself by `testInfo.project.name`.
  // The phone project is always dark: the mobile prototype files are dark and the app is dark at <= 720px (Global Constraints, Theme).
  projects: [
    { name: "desktop-light", use: { viewport: { width: 1280, height: 900 }, colorScheme: "light" } },
    { name: "mobile-dark", use: { viewport: { width: 390, height: 844 }, colorScheme: "dark" } },
  ],
  webServer: {
    // The variable is inlined at build time, so it must be in the build's environment.
    // E2E_REUSE=1: çalışan sunucu yeniden kullanılır; NEXT_PUBLIC_MOCK_LATENCY=0 ile derlenmiş olmalıdır (aksi halde gecikmeli sahte kaynak testleri yavaşlar/zaman aşar).
    command: `NEXT_PUBLIC_MOCK_LATENCY=0 pnpm build && pnpm exec serve out -l ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 300_000,
  },
});
