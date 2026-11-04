// Test env resolution (integration + e2e helpers).
//
// Priority: real process env > .env.test > .env.local.
// TEST_DATABASE_URL (e.g. a dedicated Neon branch) transparently replaces
// DATABASE_URL so suites can run isolated without touching dev data.
import { config } from "dotenv";

config({ path: ".env.test" });
config({ path: ".env.local" });

if (process.env.TEST_DATABASE_URL && !process.env.VITEST_TEST_DATABASE_URL_APPLIED) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.VITEST_TEST_DATABASE_URL_APPLIED = "1";
}
