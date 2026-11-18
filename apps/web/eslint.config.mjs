import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import react from "eslint-plugin-react";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "out/**", "node_modules/**", "prototype/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "fidelity/out/**", "public/pyodide/**", "public/oyun/**", ".wrangler/**"],
  },
  {
    // Design rules: no inline styles, no raw HTML injection.
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    plugins: { react },
    rules: {
      "react/forbid-dom-props": ["error", { forbid: ["style"] }],
      "react/forbid-component-props": ["error", { forbid: ["style"] }],
      "react/no-danger": "error",
    },
  },
];

export default config;
