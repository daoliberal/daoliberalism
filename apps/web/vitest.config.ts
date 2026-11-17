import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    // CSS-module class names stay literal so component tests can assert on them.
    css: { include: /\.module\.css$/, modules: { classNameStrategy: "non-scoped" } },
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    // Playwright specs (e2e/, fidelity/) must never be picked up by Vitest.
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
