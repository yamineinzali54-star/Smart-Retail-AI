import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// NOTE on "local Supabase": this stack runs PostgreSQL on Neon, not
// Supabase — so there is no `supabase start` here. The equivalent isolation
// is a dedicated Neon branch via TEST_DATABASE_URL (.env.test), which the
// webServer below forwards as DATABASE_URL. Without it, e2e runs against
// .env.local's database (tests are self-cleaning; see global-setup).
loadEnv({ path: ".env.test" });
loadEnv({ path: ".env.local" });

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Use `next dev` for e2e so runtime env vars (DATABASE_URL) are respected.
  // `next start` uses build-time env vars which were set during `npm run build`.
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: true,
    timeout: 120_000,
    env: testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {},
  },
});
