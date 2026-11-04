import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Unit + integration (Vitest). Playwright e2e lives in tests/e2e and is
// excluded here — different runner, different lifecycle.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // lib/* modules import "server-only" (Next.js guard that throws in
      // plain Node). Under test it is a no-op — server/client boundaries
      // are covered by e2e instead.
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
    ],
    exclude: ["node_modules", "tests/e2e/**"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    setupFiles: ["./tests/setup.ts"],
  },
});
