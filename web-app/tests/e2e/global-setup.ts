// Playwright global setup: ensure seed baseline + reset admin TOTP so the
// first-login enrollment journey is exercised on every run.
// Runs against TEST_DATABASE_URL when set, else .env.local's DATABASE_URL.
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

loadEnv({ path: ".env.test" });
loadEnv({ path: ".env.local" });
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

async function globalSetup() {
  // Relative imports: Playwright's transform doesn't apply tsconfig paths.
  const { db } = await import("../../db/index.js");
  const schema = await import("../../db/schema.js");
  const { runSeed } = await import("../../db/seed.js");

  const summary = await runSeed();
  if (summary.users < 3) throw new Error("seed baseline missing");

  await db
    .update(schema.users)
    .set({ totpSecret: null, totpVerified: false })
    .where(eq(schema.users.userName, "admin1"));
}

export default globalSetup;
