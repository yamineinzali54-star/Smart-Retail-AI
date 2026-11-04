import { isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

// Registry test needs no live DB, but lib/backup.ts pulls the db client
// chain (db/index.ts throws without DATABASE_URL). A dummy URL suffices —
// neon() only connects on query, and this suite never queries.
process.env.DATABASE_URL ??= "postgresql://backup-test:backup-test@localhost:1/backup_test";

const { BACKUP_TABLES, RESTORE_ORDER } = await import("@/lib/backup");

describe("backup registry", () => {
  it("restore order covers exactly the registered tables (no missing, no extras)", () => {
    const keys = Object.keys(BACKUP_TABLES).sort();
    expect([...RESTORE_ORDER].sort()).toEqual(keys);
  });

  it("covers every schema table", async () => {
    const schema = await import("@/db/schema");
    const drizzleTables = Object.values(schema).filter((v) => isTable(v));
    // Every drizzle table object must appear as a registry VALUE.
    const registered = new Set<unknown>(Object.values(BACKUP_TABLES));
    expect(drizzleTables.length).toBeGreaterThan(50);
    for (const t of drizzleTables) {
      expect(registered.has(t)).toBe(true);
    }
  });
});
