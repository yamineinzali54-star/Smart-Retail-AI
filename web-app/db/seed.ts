// SmartRetailAI — Phase 0 idempotent seed (PROJECT_PLAN.md §13).
//
// Run: npm run db:seed
// Safe to re-run: every insert is an upsert / check-then-insert keyed on a
// unique column. Seeds exactly ONE branch (single-branch-first, §16).
// Exported as runSeed() so integration tests can invoke it in-process.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Table } from "drizzle-orm";

// Load .env.local values for local runs (real env vars always win).
// Keeps `npm run db:seed` working without extra flags or dotenv dependency.
function loadLocalEnv(): void {
  const dir = dirname(fileURLToPath(import.meta.url));
  const file = join(dir, "..", ".env.local");
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

export interface SeedSummary {
  branch: number;
  users: number;
  counters: number;
  categories: number;
  units: number;
  permissions: number;
  glAccounts: number;
}

export async function runSeed(): Promise<SeedSummary> {
  const { db } = await import("./index.js");
  const bcrypt = await import("bcryptjs");
  const schema = await import("./schema.js");
  const { and, eq, count } = await import("drizzle-orm");

  const {
    branches,
    users,
    counters,
    categories,
    units,
    permissions,
    glAccounts,
  } = schema;

  // -------------------------------------------------------------------------
  // 1. Branch — exactly one (§13.2)
  // -------------------------------------------------------------------------

  const [branch] = await db
    .insert(branches)
    .values({
      code: "YGN",
      name: "Main Branch",
      cashDiscrepancyThreshold: "1000",
      roundingUnit: 50,
    })
    .onConflictDoUpdate({
      target: branches.code,
      set: { name: "Main Branch" },
    })
    .returning({ id: branches.id });

  // -------------------------------------------------------------------------
  // 2. Users — 3 seed accounts scoped to the branch (§13.3)
  // -------------------------------------------------------------------------

  const seedUsers = [
    {
      userName: "admin1",
      password: "Admin@123",
      fullName: "Admin One",
      email: "admin1@example.com",
      role: "admin" as const,
    },
    {
      userName: "inventory1",
      password: "Inventory@123",
      fullName: "Inventory One",
      email: "inventory1@example.com",
      role: "inventory" as const,
    },
    {
      userName: "cashier1",
      password: "Cashier@123",
      fullName: "Cashier One",
      email: "cashier1@example.com",
      role: "cashier" as const,
    },
  ];

  for (const u of seedUsers) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await db
      .insert(users)
      .values({
        branchId: branch.id,
        userName: u.userName,
        passwordHash,
        fullName: u.fullName,
        email: u.email,
        role: u.role,
        isActive: true,
      })
      // Idempotent: never overwrite an existing password hash on re-seed.
      .onConflictDoNothing({ target: users.userName });
  }

  // -------------------------------------------------------------------------
  // 3. Counters — 2 active counters for the branch (§13.4)
  // -------------------------------------------------------------------------

  const seedCounters = [
    { name: "Counter 1", location: "Main Entrance" },
    { name: "Counter 2", location: "Back Entrance" },
  ];

  for (const c of seedCounters) {
    const existing = await db
      .select({ id: counters.id })
      .from(counters)
      .where(
        and(eq(counters.branchId, branch.id), eq(counters.name, c.name)),
      )
      .limit(1);
    if (existing.length === 0) {
      await db.insert(counters).values({
        branchId: branch.id,
        name: c.name,
        location: c.location,
        isActive: true,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Category + Unit — at least one of each with valid short_name (§13.5)
  //    (short_name is required for batch barcode generation to work at all)
  // -------------------------------------------------------------------------

  await db
    .insert(categories)
    .values({
      branchId: branch.id,
      name: "General",
      shortName: "G",
      taxRate: "5.00",
      isTaxExempt: false,
    })
    .onConflictDoNothing({ target: categories.shortName });

  const existingUnit = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.branchId, branch.id), eq(units.shortName, "PCS")))
    .limit(1);
  if (existingUnit.length === 0) {
    await db
      .insert(units)
      .values({ branchId: branch.id, name: "Piece", shortName: "PCS" });
  }

  // Seed all standard units from units.csv (idempotent).
  const standardUnits: Array<{ name: string; shortName: string }> = [
    { name: "Pack", shortName: "PACK" },
    { name: "Box", shortName: "BOX" },
    { name: "Bottle", shortName: "BTL" },
    { name: "Can", shortName: "CAN" },
    { name: "Sachet", shortName: "SCH" },
    { name: "Kilogram", shortName: "KG" },
    { name: "Gram", shortName: "GRM" },
    { name: "Dozen", shortName: "DZN" },
    { name: "Carton", shortName: "CTN" },
    { name: "Bag", shortName: "BAG" },
    { name: "Roll", shortName: "ROLL" },
    { name: "Jar", shortName: "JAR" },
  ];
  for (const u of standardUnits) {
    await db
      .insert(units)
      .values({ branchId: branch.id, ...u })
      .onConflictDoNothing();
  }

  // -------------------------------------------------------------------------
  // 5. Permission defaults (§13.6 + §2.1)
  // -------------------------------------------------------------------------

  type Role = "admin" | "inventory" | "cashier";

  const permissionDefaults: Array<{
    key: string;
    admin: boolean;
    inventory: boolean;
    cashier: boolean;
  }> = [
    { key: "discount.approve", admin: true, inventory: false, cashier: false },
    { key: "refund.approve", admin: true, inventory: false, cashier: false },
    { key: "transfer.approve", admin: true, inventory: true, cashier: false },
    { key: "void.approve", admin: true, inventory: false, cashier: false },
    {
      key: "supplier_return.confirm",
      admin: true,
      inventory: false,
      cashier: false,
    },
  ];

  for (const p of permissionDefaults) {
    for (const role of ["admin", "inventory", "cashier"] as Role[]) {
      await db
        .insert(permissions)
        .values({ role, actionKey: p.key, isAllowed: p[role] })
        .onConflictDoNothing();
    }
  }

  // -------------------------------------------------------------------------
  // 7. Chart of Accounts — default retail COA (global, shared across branches)
  // -------------------------------------------------------------------------

  const defaultCoa: Array<{
    code: string;
    name: string;
    type: "asset" | "liability" | "equity" | "income" | "expense";
  }> = [
    { code: "1000", name: "Cash on Hand", type: "asset" },
    { code: "1010", name: "Bank Account", type: "asset" },
    { code: "1100", name: "Accounts Receivable", type: "asset" },
    { code: "1200", name: "Inventory", type: "asset" },
    { code: "2000", name: "Accounts Payable", type: "liability" },
    { code: "2010", name: "Gift Voucher Liability", type: "liability" },
    { code: "2020", name: "Customer Credits", type: "liability" },
    { code: "2100", name: "Tax Payable", type: "liability" },
    { code: "3000", name: "Owner Capital", type: "equity" },
    { code: "4000", name: "Sales Revenue", type: "income" },
    { code: "5000", name: "Cost of Goods Sold", type: "expense" },
    { code: "5100", name: "Operating Expenses", type: "expense" },
    { code: "5110", name: "Loyalty & Promotions", type: "expense" },
    { code: "5200", name: "Inventory Adjustments", type: "expense" },
  ];

  for (const a of defaultCoa) {
    await db
      .insert(glAccounts)
      .values({ code: a.code, name: a.name, type: a.type })
      .onConflictDoNothing();
  }

  async function tableCount(table: Table) {
    const rows = (await db
      .select({ n: count() })
      .from(table as never)) as Array<{ n: unknown }>;
    return Number(rows[0]?.n ?? 0);
  }

  return {
    branch: await tableCount(branches),
    users: await tableCount(users),
    counters: await tableCount(counters),
    categories: await tableCount(categories),
    units: await tableCount(units),
    permissions: await tableCount(permissions),
    glAccounts: await tableCount(glAccounts),
  };
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const summary = await runSeed();
  console.log(
    `Seed complete: ${summary.branch} branch (YGN), ${summary.users} users, ` +
      `${summary.counters} counters, ${summary.categories} category, ` +
      `${summary.units} unit, ${summary.permissions} permission rows.`,
  );
}
