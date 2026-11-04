import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "drizzle-kit";

// drizzle-kit does not auto-load .env.local — mirror db/seed.ts loadLocalEnv()
// so `npm run db:migrate` / `db:generate` work without extra flags or a
// dotenv dependency. Real env vars always win.
function loadLocalEnv(): void {
  const dir = dirname(fileURLToPath(import.meta.url));
  const file = join(dir, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*('([^']*)'|"([^"]*)"|(\S+))\s*$/);
    if (!m) continue;
    const key = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

// Phase 0 scaffold: schema lives in db/schema.ts (full SS3 tables land in Step 3).
// Uses server-only DATABASE_URL from .env.local — never exposed to client code.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
