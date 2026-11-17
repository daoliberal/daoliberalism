import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globals are off, so Testing Library cannot auto-register its cleanup.
afterEach(cleanup);

// next.config.ts sets trailingSlash: true; next/link reads this build-time flag, so tests mirror it.
process.env.__NEXT_TRAILING_SLASH = "true";
