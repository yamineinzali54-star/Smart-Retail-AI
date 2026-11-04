// SmartRetailAI — Full demo seed: clears operational tables and seeds
// realistic data spanning January 1 2024 – October 28 2026 (1,032 days).
// The 59-day sales CSV window is tiled cyclically across the full
// range so every period has realistic invoice traffic.
//
// Run: npm run db:seed:demo
// Preserves: branch, users, permissions, gl_account, AI tables,
//            user_branch, auth_session, notification_subscription, app_setting
// Demo users, their branch grants, and their session branch are realigned to YGN.
// Clears & reseeds: everything else (categories, units, products, suppliers,
//   inventory, POS sessions, sales, expenses, journal, attendance, etc.)

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const START_DATE = new Date("2024-01-01T00:00:00Z");
const END_DATE = new Date("2026-10-28T23:59:59.999Z");
const TOTAL_DAYS = Math.floor((END_DATE.getTime() - START_DATE.getTime()) / 86400000) + 1;

const DATASET_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "dataset",
);

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) for reproducible data
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);
const randInt = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) => rng() * (max - min) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function clampToSeedRange(date: Date): Date {
  if (date < START_DATE) return new Date(START_DATE);
  if (date > END_DATE) return new Date(END_DATE);
  return date;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Day offsets of the 1st of every month inside the seed range (0-based).
function monthStartOffsets(): number[] {
  const offsets: number[] = [];
  let year = START_DATE.getUTCFullYear();
  let month = START_DATE.getUTCMonth();
  for (;;) {
    const first = new Date(Date.UTC(year, month, 1));
    if (first > END_DATE) break;
    const offset = daysBetween(START_DATE, first);
    if (offset >= 0) offsets.push(offset);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return offsets;
}

function fmtDateTime(d: Date): string {
  return d.toISOString();
}

function fmtCompact(d: Date): string {
  // yyMMddHHmm
  const y = d.getUTCFullYear() % 100;
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${da}${h}${mi}`;
}

function fmtFull(d: Date): string {
  // yyyyMMddHHmmss
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${mo}${da}${h}${mi}${s}`;
}

// Remap a CSV date (Jan 1–Feb 28) onto the tiled seed range: the 59-day CSV
// window is repeated across Jan 1 2024 – Oct 28 2026 so every period keeps
// the same invoice density as the source data.
const CSV_START = new Date("2026-01-01T00:00:00Z");
const CSV_END = new Date("2026-02-28T00:00:00Z");
const CSV_SPAN = daysBetween(CSV_START, CSV_END) + 1; // 59 days inclusive

// ---------------------------------------------------------------------------
// CSV parsing (simple — no quoted commas in these files)
// ---------------------------------------------------------------------------

function parseCSV(content: string): string[][] {
  const lines = content.trim().split("\n");
  return lines.map((line) => line.split(","));
}

// ---------------------------------------------------------------------------
// Money helper — numeric columns accept strings
// ---------------------------------------------------------------------------

function money(n: number): string {
  return n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

export async function runDemoSeed() {
  const { db } = await import("./index.js");
  const schema = await import("./schema.js");
  const { sql, eq, and, count, inArray } = await import("drizzle-orm");

  const {
    branches,
    users,
    userBranches,
    authSessions,
    counters,
    categories,
    units,
    products,
    suppliers,
    supplierProducts,
    productUomConversions,
    purchaseOrders,
    poDetails,
    grns,
    items,
    posSessions,
    sales,
    saleDetails,
    saleReturns,
    saleReturnDetails,
    expenseCategories,
    expenses,
    expenseBudgets,
    journalEntries,
    journalLines,
    glAccounts,
    staffAttendance,
    shiftRosters,
    rosterSchedules,
    rosterScheduleEntries,
    notifications,
    promotions,
    promotionProducts,
    productPriceHistory,
    supplierPayments,
    pettyCashFloats,
    stockAdjustments,
    stockAdjustmentDetails,
    groundBalances,
    groundBalanceDetails,
    shiftHandovers,
    auditLogs,
    permissions,
  } = schema;

  // -------------------------------------------------------------------------
  // Phase 1 — Clear operational tables (preserve users, AI, branch, etc.)
  // -------------------------------------------------------------------------

  console.log("Phase 1: Clearing operational tables…");

  await db.execute(sql`
    TRUNCATE TABLE
      sale_return_detail,
      sale_return,
      sale_detail,
      sale,
      cart_item,
      cart,
      shift_handover,
      pos_session,
      ground_balance_detail,
      ground_balance,
      stock_adjustment_detail,
      stock_adjustment,
      stock_transfer_detail,
      stock_transfer,
      items,
      grn,
      po_detail,
      purchase_order,
      supplier_return_detail,
      supplier_return,
      supplier_payment,
      product_price_history,
      supplier_product,
      suppliers,
      products,
      product_uom_conversion,
      category,
      unit,
      counter,
      expense,
      expense_budget,
      expense_category,
      petty_cash_float,
      journal_line,
      journal_entry,
      staff_attendance,
      roster_schedule_entry,
      roster_schedule,
      shift_roster,
      notification,
      promotion_product,
      promotion,
      audit_log
    RESTART IDENTITY CASCADE
  `);

  // -------------------------------------------------------------------------
  // Phase 2 — Ensure base seed data exists (branch, users, permissions, COA)
  // -------------------------------------------------------------------------

  console.log("Phase 2: Ensuring base seed data…");

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
    .returning({ id: branches.id, code: branches.code });

  // Ensure the seed users exist
  const bcrypt = await import("bcryptjs");
  const seedUsers = [
    { userName: "admin1", password: "Admin@123", fullName: "Admin One", email: "admin1@example.com", role: "admin" as const },
    { userName: "inventory1", password: "Inventory@123", fullName: "Inventory One", email: "inventory1@example.com", role: "inventory" as const },
    { userName: "cashier1", password: "Cashier@123", fullName: "Cashier One", email: "cashier1@example.com", role: "cashier" as const },
    { userName: "casher2", password: "Cashier@123", fullName: "Cashier Two", email: "casher2@example.com", role: "cashier" as const },
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
      .onConflictDoUpdate({
        target: users.userName,
        set: {
          branchId: branch.id,
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          isActive: true,
        },
      });
  }

  // Restrict demo identities and their explicit branch grants to the same
  // YGN branch as the operational seed data. These tables survive Phase 1,
  // so conflict-do-nothing alone would leave stale branch assignments behind.
  const demoUserNames = ["admin1", "inventory1", "cashier1", "casher2"];
  const demoUsers = await db
    .select({ id: users.id, userName: users.userName, role: users.role })
    .from(users)
    .where(inArray(users.userName, demoUserNames));
  const demoUserIds = demoUsers.map((user) => user.id);
  await db.delete(userBranches).where(inArray(userBranches.userId, demoUserIds));
  await db.insert(userBranches).values(
    demoUserIds.map((userId) => ({ userId, branchId: branch.id })),
  );
  await db
    .update(authSessions)
    .set({ branchId: branch.id })
    .where(inArray(authSessions.userId, demoUserIds));

  const requireDemoUser = (userName: string) => {
    const user = demoUsers.find((candidate) => candidate.userName === userName);
    if (!user) throw new Error(`Demo user ${userName} was not created`);
    return user;
  };
  const adminUser = requireDemoUser("admin1");
  const inventoryUser = requireDemoUser("inventory1");
  const casher1User = requireDemoUser("cashier1");
  const casher2User = requireDemoUser("casher2");
  const casherUsers = [casher1User, casher2User];
  console.log(`  ✓ ${demoUserIds.length} demo users assigned only to branch ${branch.code}`);

  // Counters
  const counterData = [
    { name: "Counter 1", location: "Main Entrance" },
    { name: "Counter 2", location: "Back Entrance" },
  ];
  const counterIds: string[] = [];
  for (const c of counterData) {
    const existing = await db.select({ id: counters.id }).from(counters).where(and(eq(counters.branchId, branch.id), eq(counters.name, c.name))).limit(1);
    if (existing.length === 0) {
      const [row] = await db.insert(counters).values({ branchId: branch.id, name: c.name, location: c.location, isActive: true }).returning({ id: counters.id });
      counterIds.push(row.id);
    } else {
      counterIds.push(existing[0].id);
    }
  }

  // Permissions
  const permissionDefaults = [
    { key: "discount.approve", admin: true, inventory: false, cashier: false },
    { key: "refund.approve", admin: true, inventory: false, cashier: false },
    { key: "transfer.approve", admin: true, inventory: true, cashier: false },
    { key: "void.approve", admin: true, inventory: false, cashier: false },
    { key: "supplier_return.confirm", admin: true, inventory: false, cashier: false },
  ];
  for (const p of permissionDefaults) {
    for (const role of ["admin", "inventory", "cashier"] as const) {
      await db.insert(permissions).values({ role, actionKey: p.key, isAllowed: p[role] }).onConflictDoNothing();
    }
  }

  // GL Accounts
  const defaultCoa = [
    { code: "1000", name: "Cash on Hand", type: "asset" as const },
    { code: "1010", name: "Bank Account", type: "asset" as const },
    { code: "1100", name: "Accounts Receivable", type: "asset" as const },
    { code: "1200", name: "Inventory", type: "asset" as const },
    { code: "2000", name: "Accounts Payable", type: "liability" as const },
    { code: "2010", name: "Gift Voucher Liability", type: "liability" as const },
    { code: "2020", name: "Customer Credits", type: "liability" as const },
    { code: "2100", name: "Tax Payable", type: "liability" as const },
    { code: "3000", name: "Owner Capital", type: "equity" as const },
    { code: "4000", name: "Sales Revenue", type: "income" as const },
    { code: "5000", name: "Cost of Goods Sold", type: "expense" as const },
    { code: "5100", name: "Operating Expenses", type: "expense" as const },
    { code: "5110", name: "Loyalty & Promotions", type: "expense" as const },
    { code: "5200", name: "Inventory Adjustments", type: "expense" as const },
  ];
  for (const a of defaultCoa) {
    await db.insert(glAccounts).values({ code: a.code, name: a.name, type: a.type }).onConflictDoNothing();
  }

  const glRows = await db.select({ id: glAccounts.id, code: glAccounts.code }).from(glAccounts);
  const glMap = new Map(glRows.map((r) => [r.code, r.id]));

  // -------------------------------------------------------------------------
  // Phase 3 — Read CSV datasets
  // -------------------------------------------------------------------------

  console.log("Phase 3: Reading CSV datasets…");

  const categoriesCsv = parseCSV(readFileSync(join(DATASET_DIR, "categories.csv"), "utf8"));
  const productsCsv = parseCSV(readFileSync(join(DATASET_DIR, "products.csv"), "utf8"));
  const suppliersCsv = parseCSV(readFileSync(join(DATASET_DIR, "suppliers.csv"), "utf8"));
  const salesCsv = parseCSV(readFileSync(join(DATASET_DIR, "refactor_supermarket_sales.csv"), "utf8"));

  // -------------------------------------------------------------------------
  // Phase 4 — Seed categories (from CSV + keep General)
  // -------------------------------------------------------------------------

  console.log("Phase 4: Seeding categories…");

  // Ensure "General" exists (from base seed)
  await db
    .insert(categories)
    .values({ branchId: branch.id, name: "General", shortName: "G", taxRate: "5.00", isTaxExempt: false })
    .onConflictDoNothing({ target: categories.shortName });

  // Seed categories from CSV (skip header)
  const catMap = new Map<string, string>(); // name → id
  for (let i = 1; i < categoriesCsv.length; i++) {
    const [name, shortName, taxRate, isTaxExempt] = categoriesCsv[i];
    const existing = await db.select({ id: categories.id }).from(categories).where(eq(categories.shortName, shortName)).limit(1);
    if (existing.length === 0) {
      const [row] = await db
        .insert(categories)
        .values({
          branchId: branch.id,
          name,
          shortName,
          taxRate: taxRate || "5.00",
          isTaxExempt: isTaxExempt === "true",
        })
        .returning({ id: categories.id });
      catMap.set(name, row.id);
    } else {
      catMap.set(name, existing[0].id);
    }
  }
  // Also add General to map
  const generalCat = await db.select({ id: categories.id }).from(categories).where(eq(categories.shortName, "G")).limit(1);
  if (generalCat.length > 0) catMap.set("General", generalCat[0].id);

  // Fetch all categories with short names for barcode generation
  const allCats = await db.select({ id: categories.id, name: categories.name, shortName: categories.shortName, taxRate: categories.taxRate }).from(categories);
  const catById = new Map(allCats.map((c) => [c.id, c]));
  const catByName = new Map(allCats.map((c) => [c.name, c]));

  // -------------------------------------------------------------------------
  // Phase 5 — Seed units (all from units.csv; base seed ensures Piece exists)
  // -------------------------------------------------------------------------

  console.log("Phase 5: Seeding units…");

  await db
    .insert(units)
    .values({ branchId: branch.id, name: "Piece", shortName: "PCS" })
    .onConflictDoNothing();

  // Seed remaining units from units.csv.
  const unitsCsvRows: Array<[string, string]> = [
    ["Pack", "PACK"],
    ["Box", "BOX"],
    ["Bottle", "BTL"],
    ["Can", "CAN"],
    ["Sachet", "SCH"],
    ["Kilogram", "KG"],
    ["Gram", "GRM"],
    ["Dozen", "DZN"],
    ["Carton", "CTN"],
    ["Bag", "BAG"],
    ["Roll", "ROLL"],
    ["Jar", "JAR"],
  ];
  for (const [name, shortName] of unitsCsvRows) {
    await db
      .insert(units)
      .values({ branchId: branch.id, name, shortName })
      .onConflictDoNothing();
  }

  const allUnits = await db.select({ id: units.id, name: units.name, shortName: units.shortName }).from(units).where(eq(units.branchId, branch.id));
  const unitByName = new Map(allUnits.map((u) => [u.name.toLowerCase(), u]));
  const pieceUnit = allUnits.find((u) => u.shortName === "PCS") ?? allUnits[0];

  // -------------------------------------------------------------------------
  // Phase 6 — Seed suppliers
  // -------------------------------------------------------------------------

  console.log("Phase 6: Seeding suppliers…");

  const supplierMap = new Map<string, string>(); // name → id
  const supplierRows: Array<{ id: string; name: string }> = [];
  for (let i = 1; i < suppliersCsv.length; i++) {
    const [name, contactPerson, phone, email, address] = suppliersCsv[i];
    const existing = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.branchId, branch.id), eq(suppliers.name, name))).limit(1);
    if (existing.length === 0) {
      const [row] = await db
        .insert(suppliers)
        .values({ branchId: branch.id, name, contactPerson, phone, email, address, isDeleted: false })
        .returning({ id: suppliers.id });
      supplierMap.set(name, row.id);
      supplierRows.push({ id: row.id, name });
    } else {
      supplierMap.set(name, existing[0].id);
      supplierRows.push({ id: existing[0].id, name });
    }
  }

  // Category → supplier mapping
  const catSupplier: Record<string, string> = {
    "Health and beauty": "Myanmar Beauty Supplies",
    "Electronic accessories": "TechZone Distribution",
    "Home and lifestyle": "Home Essentials Co",
    "Sports and travel": "Sports Gear Myanmar",
    "Food and beverages": "Fresh Food Wholesale",
    "Fashion accessories": "Fashion Hub Trading",
  };

  // -------------------------------------------------------------------------
  // Phase 7 — Seed products (from products.csv)
  // -------------------------------------------------------------------------

  console.log("Phase 7: Seeding products…");

  const productRows: Array<{
    id: string;
    name: string;
    categoryId: string;
    categoryName: string;
    unitPrice: number;
    reorderThreshold: number;
  }> = [];

  for (let i = 1; i < productsCsv.length; i++) {
    const [name, categoryName, unitName, unitPrice, reorderThreshold] = productsCsv[i];
    const cat = catByName.get(categoryName);
    if (!cat) {
      console.warn(`  ⚠ Category "${categoryName}" not found for product "${name}", skipping.`);
      continue;
    }

    const existing = await db.select({ id: products.id }).from(products).where(and(eq(products.branchId, branch.id), eq(products.name, name))).limit(1);
    let productId: string;
    if (existing.length === 0) {
      const unit = unitByName.get(unitName.toLowerCase()) ?? pieceUnit;
      const [row] = await db
        .insert(products)
        .values({
          branchId: branch.id,
          categoryId: cat.id,
          unitId: unit.id,
          name,
          reorderThreshold: parseInt(reorderThreshold, 10) || 5,
          isDeleted: false,
        })
        .returning({ id: products.id });
      productId = row.id;
    } else {
      productId = existing[0].id;
    }

    // Supplier-product link
    const supplierName = catSupplier[categoryName];
    const supId = supplierMap.get(supplierName);
    if (supId) {
      const existingLink = await db
        .select()
        .from(supplierProducts)
        .where(and(eq(supplierProducts.supplierId, supId), eq(supplierProducts.productId, productId)))
        .limit(1);
      if (existingLink.length === 0) {
        await db.insert(supplierProducts).values({ supplierId: supId, productId });
      }
    }

    productRows.push({
      id: productId,
      name,
      categoryId: cat.id,
      categoryName,
      unitPrice: parseFloat(unitPrice),
      reorderThreshold: parseInt(reorderThreshold, 10) || 5,
    });
  }

  console.log(`  ✓ ${productRows.length} products seeded`);

  // -------------------------------------------------------------------------
  // Phase 7.5 — Plan the sales (before the inventory is seeded)
  // -------------------------------------------------------------------------
  //
  // The plan decides which product every invoice line sells. It is built
  // here, BEFORE the stock is received, so the restock quantities can be
  // derived from the real demand instead of a category average (the basket
  // affinity pairs deliberately concentrate demand on some products, which an
  // average would under-order).
  console.log("Phase 7.5: Planning sales…");

  interface SaleLine {
    invoiceId: string;
    productLine: string;
    csvUnitPrice: number;
    quantity: number;
    date: string; // CSV date M/D/YYYY
    time: string; // HH:MM
  }

  interface SaleGroup {
    invoiceId: string;
    date: string;
    time: string;
    lines: SaleLine[];
  }

  interface PlannedLine {
    productId: string;
    quantity: number;
  }
  interface PlannedSale {
    targetDate: Date;
    dayIdx: number;
    time: string;
    lines: PlannedLine[];
  }

  // Group the CSV rows into invoices (Phase 9 used to do this).
  const saleGroups = new Map<string, SaleGroup>();
  for (let i = 1; i < salesCsv.length; i++) {
    const row = salesCsv[i];
    const invoiceId = row[0];
    const productLine = row[5];
    const csvUnitPrice = parseFloat(row[6]);
    const quantity = parseInt(row[7], 10);
    const date = row[10];
    const time = row[11];
    const key = `${invoiceId}|${date}|${time}`;
    const group = saleGroups.get(key) ?? { invoiceId, date, time, lines: [] };
    group.lines.push({ invoiceId, productLine, csvUnitPrice, quantity, date, time });
    saleGroups.set(key, group);
  }
  console.log(`  ✓ ${saleGroups.size} unique invoices grouped`);

  // Products by category — the source of the line products.
  const productsByCategory = new Map<string, typeof productRows>();
  for (const p of productRows) {
    const list = productsByCategory.get(p.categoryName) ?? [];
    list.push(p);
    productsByCategory.set(p.categoryName, list);
  }
  // Product-picking cursor per category, so a second line of the same
  // category inside one invoice walks to the next product in that category
  // (that is what makes a basket multi-item instead of the same product twice).
  const categoryPickIndex = new Map<string, number>();

  // Basket affinity: real shoppers buy the same product pairs together
  // ("noodles + eggs", "shampoo + soap"). The raw CSV pairs products at
  // random, so without affinity the co-occurrence support stays too thin for
  // the market-basket analyzer to find a single rule. The strongest pairs are
  // mined out of the CSV's own multi-line invoices and replayed into a share
  // of the sales, so the seeded data carries a genuine basket signal.
  const BASKET_AFFINITY_COUNT = 12;
  const AFFINITY_SHARE = 0.55; // share of multi-item baskets that use a pair
  const affinityPairs: Array<[string, string]> = [];
  {
    const pairCounts = new Map<string, number>();
    for (const group of saleGroups.values()) {
      if (group.lines.length < 2) continue;
      const cats = [...new Set(group.lines.map((l) => l.productLine))];
      for (let i = 0; i < cats.length; i++) {
        for (let j = i + 1; j < cats.length; j++) {
          const key = [cats[i], cats[j]].sort().join("||");
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }
    const strongest = [...pairCounts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, BASKET_AFFINITY_COUNT)
      .map(([key]) => key.split("||") as [string, string]);
    for (const [catA, catB] of strongest) {
      const prodsA = productsByCategory.get(catA) ?? [];
      const prodsB = productsByCategory.get(catB) ?? [];
      if (prodsA.length === 0 || prodsB.length === 0) continue;
      affinityPairs.push([
        prodsA[randInt(0, prodsA.length - 1)].id,
        prodsB[randInt(0, prodsB.length - 1)].id,
      ]);
    }
  }
  console.log(`  ✓ ${affinityPairs.length} basket affinity pairs discovered`);

  // Tile the 59-day CSV window across the whole seed range: cycle N repeats
  // every invoice 59 days later, so every month keeps the source density.
  const cycles = Math.ceil(TOTAL_DAYS / CSV_SPAN);
  const invoiceGroups = [...saleGroups.values()].sort((a, b) => {
    const da = new Date(`${a.date} ${a.time}`);
    const db2 = new Date(`${b.date} ${b.time}`);
    return da.getTime() - db2.getTime();
  });

  const plannedSales: PlannedSale[] = [];
  const demandByDay = new Map<string, number[]>();
  for (const group of invoiceGroups) {
    const [month, day, year] = group.date.split("/").map(Number);
    const csvDate = new Date(Date.UTC(year, month - 1, day));
    const csvOffset = daysBetween(CSV_START, csvDate);
    for (let cycle = 0; cycle < cycles; cycle++) {
      const targetOffset = cycle * CSV_SPAN + csvOffset;
      if (targetOffset >= TOTAL_DAYS) continue;

      // Plan the products for this invoice. A share of multi-line invoices is
      // reshaped into a known affinity pair (both products of the pair).
      const lines: PlannedLine[] = [];
      if (group.lines.length >= 2 && affinityPairs.length > 0 && rng() < AFFINITY_SHARE) {
        const pair = affinityPairs[randInt(0, affinityPairs.length - 1)];
        for (const productId of pair) {
          const prod = productRows.find((p) => p.id === productId);
          if (!prod) continue;
          lines.push({ productId, quantity: randInt(1, 4) });
        }
      } else {
        for (const line of group.lines) {
          const catProducts = productsByCategory.get(line.productLine);
          if (!catProducts || catProducts.length === 0) continue;
          const pickIndex = categoryPickIndex.get(line.productLine) ?? 0;
          const prod = catProducts[pickIndex % catProducts.length];
          categoryPickIndex.set(line.productLine, pickIndex + 1);
          lines.push({ productId: prod.id, quantity: line.quantity });
        }
      }
      if (lines.length === 0) continue;

      for (const line of lines) {
        const series = demandByDay.get(line.productId) ?? new Array(TOTAL_DAYS).fill(0);
        series[targetOffset] += line.quantity;
        demandByDay.set(line.productId, series);
      }
      plannedSales.push({
        targetDate: addDays(START_DATE, targetOffset),
        dayIdx: targetOffset,
        time: group.time,
        lines,
      });
    }
  }
  plannedSales.sort((a, b) => a.dayIdx - b.dayIdx);
  console.log(`  ✓ ${plannedSales.length} sales planned`);

  // -------------------------------------------------------------------------
  // Phase 8 — Seed inventory: POs → GRNs → Items (batches)
  // -------------------------------------------------------------------------

  console.log("Phase 8: Seeding inventory (POs, GRNs, Items)…");

  // Track available batches per product for FIFO sale allocation
  interface Batch {
    itemId: string;
    productId: string;
    remaining: number;
    startedWith: number;
    sellingPrice: number;
    purchasePrice: number;
  }
  const batchesByProduct = new Map<string, Batch[]>();

  // Restock quantities come from the planned demand (Phase 7.5): each wave
  // covers the demand of the days until the next delivery, so the shop ends
  // the period with a lean, realistic stock level instead of a multi-year
  // pile-up.
  //
  // The shop restocks weekly (a small grocery shop does) and every delivery
  // is sized to exactly the demand it covers — no over-delivery, otherwise
  // the surplus accumulates into a mountain of stock.
  const RESTOCK_STEP_DAYS = 7;
  const RESTOCK_COVER = 1.15;
  const restockWaves: Array<{ date: Date; dayOffset: number; coverDays: number }> = [];
  for (let waveOffset = 0; waveOffset < TOTAL_DAYS; waveOffset += RESTOCK_STEP_DAYS) {
    restockWaves.push({
      date: addDays(START_DATE, waveOffset),
      dayOffset: waveOffset,
      coverDays: waveOffset === 0 ? 2 * RESTOCK_STEP_DAYS : RESTOCK_STEP_DAYS,
    });
  }

  let poSeq = 0;
  let grnSeq = 0;

  for (const wave of restockWaves) {
    // Group products by supplier for POs
    const bySupplier = new Map<string, typeof productRows>();
    for (const p of productRows) {
      const supName = catSupplier[p.categoryName];
      const supId = supplierMap.get(supName);
      if (!supId) continue;
      const list = bySupplier.get(supId) ?? [];
      list.push(p);
      bySupplier.set(supId, list);
    }

    // Demand this wave has to cover: the days until the next delivery.
    const windowEnd = Math.min(TOTAL_DAYS, wave.dayOffset + wave.coverDays);
    const demandInWindow = new Map<string, number>();
    for (const [productId, series] of demandByDay) {
      let units = 0;
      for (let day = wave.dayOffset; day < windowEnd; day++) units += series[day] ?? 0;
      if (units > 0) demandInWindow.set(productId, units);
    }

    for (const [supId, prods] of bySupplier) {
      poSeq++;
      // The order is placed a week ahead and the goods are RECEIVED on the
      // wave date itself: a delivery that lands after the demand it was
      // ordered for would show up as a stock-out in the sales history.
      const poDate = clampToSeedRange(addDays(wave.date, -7));
      poDate.setUTCHours(randInt(8, 16), randInt(0, 59), randInt(0, 59), 0);
      const expectedDate = wave.date;
      const poNumber = `PO-YGN-${fmtFull(poDate)}-${String(poSeq).padStart(4, "0")}`;

      // Calculate total — the order covers the demand of the next delivery
      // window for each product (plus a small buffer).
      let totalAmount = 0;
      const poLines: Array<{ productId: string; quantity: number; unitPrice: string }> = [];
      for (const p of prods) {
        const demand = demandInWindow.get(p.id) ?? 0;
        const qty = Math.max(1, Math.round(demand * RESTOCK_COVER) + randInt(0, 2));
        const purchasePrice = money(p.unitPrice * 0.7); // 70% of retail
        poLines.push({ productId: p.id, quantity: qty, unitPrice: purchasePrice });
        totalAmount += qty * p.unitPrice * 0.7;
      }

      const [po] = await db
        .insert(purchaseOrders)
        .values({
          branchId: branch.id,
          poNumber,
          supplierId: supId,
          orderDate: poDate,
          expectedDate,
          status: "received",
          approvalStatus: "approved",
          approvedBy: adminUser.id,
          paymentStatus: rng() > 0.3 ? "paid" : "unpaid",
          totalAmount: money(totalAmount),
          createdBy: inventoryUser.id,
        })
        .returning({ id: purchaseOrders.id });

      // Insert PO details (one multi-row insert per PO)
      await db.insert(poDetails).values(
        poLines.map((line) => ({
          poId: po.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      );

      // GRN — received on the scheduled wave date
      grnSeq++;
      const grnDate = wave.date;
      const grnNumber = `GRN-YGN-${fmtCompact(grnDate)}-${String(grnSeq).padStart(4, "0")}`;
      const [grn] = await db
        .insert(grns)
        .values({
          branchId: branch.id,
          grnNumber,
          poId: po.id,
          receivedDate: grnDate,
          remarks: "Stock received in good condition",
          createdBy: inventoryUser.id,
        })
        .returning({ id: grns.id });

      // Items (batches) — one per PO line, inserted in a single statement
      // (ids are generated up front so the batch rows can be tracked without
      // relying on RETURNING order).
      const grnSequence = String(grnSeq).padStart(4, "0");
      const itemRows = poLines.map((line, lineIndex) => {
        const prod = productRows.find((p) => p.id === line.productId)!;
        const cat = catById.get(prod.categoryId)!;
        const sup4 = supId.slice(0, 4);
        const prod4 = line.productId.slice(0, 4);
        const itemSequence = String(lineIndex + 1).padStart(2, "0");
        const yearShort = String(grnDate.getUTCFullYear()).slice(2);
        // A random UUID prefix is not unique enough across thousands of GRNs.
        // The GRN sequence is unique per receipt; lineSequence distinguishes
        // products within that receipt while keeping the barcode under 50 chars.
        const barcode = `${cat.shortName}-${yearShort}-${sup4}-${prod4}-${grnSequence}-${itemSequence}`;

        const purchasePrice = parseFloat(line.unitPrice);
        const sellingPrice = prod.unitPrice;
        const receivedQty = line.quantity;
        // The batch starts at the quantity it was received with: every sale
        // in the plan is written out, so nothing is "sold before" the batch.
        const currentStock = receivedQty;

        return {
          id: randomUUID(),
          branchId: branch.id,
          productId: line.productId,
          grnId: grn.id,
          poId: po.id,
          barcode,
          receivedQuantity: receivedQty,
          currentStockQuantity: currentStock,
          purchasePrice: money(purchasePrice),
          sellingPrice: money(sellingPrice),
          expiryDate: addDays(grnDate, randInt(540, 900)),
          remarks: null as string | null,
        };
      });
      await db.insert(items).values(itemRows);

      for (const row of itemRows) {
        const prod = productRows.find((p) => p.id === row.productId)!;
        // Track batch for FIFO allocation
        const batchList = batchesByProduct.get(row.productId) ?? [];
        batchList.push({
          itemId: row.id,
          productId: row.productId,
          remaining: row.currentStockQuantity,
          startedWith: row.currentStockQuantity,
          sellingPrice: prod.unitPrice,
          purchasePrice: parseFloat(row.purchasePrice),
        });
        batchesByProduct.set(row.productId, batchList);
      }

      // Supplier payment (for ~70% of POs)
      if (rng() > 0.3) {
        await db.insert(supplierPayments).values({
          branchId: branch.id,
          supplierId: supId,
          poId: po.id,
          amount: money(totalAmount),
          paymentDate: clampToSeedRange(addDays(grnDate, randInt(5, 20))),
          method: pick(["cash", "bank_transfer", "mobile_payment"] as const),
          reference: `PAY-${fmtCompact(grnDate)}-${randInt(100, 999)}`,
          recordedBy: adminUser.id,
        });
      }
    }
  }

  console.log(`  ✓ ${poSeq} POs, ${grnSeq} GRNs, inventory batches created`);

  // -------------------------------------------------------------------------
  // Phase 10 — Seed POS sessions
  // -------------------------------------------------------------------------

  console.log("Phase 10: Seeding POS sessions…");

  // Create 2 sessions per day (Counter 1 → Cashier One, Counter 2 → Cashier Two)
  const sessionMap = new Map<string, string>(); // "dayIdx|counterIdx" → sessionId
  const sessionToCashier = new Map<string, string>(); // sessionId → cashier userId

  // One day = 2 sessions; buffer them and insert in chunks (ids are
  // generated up front so no RETURNING order assumptions are needed).
  const SESSION_CHUNK = 200;
  type PlannedSession = typeof posSessions.$inferInsert;
  let sessionRows: PlannedSession[] = [];
  const flushSessions = async () => {
    if (sessionRows.length === 0) return;
    await db.insert(posSessions).values(sessionRows);
    sessionRows = [];
  };

  for (let dayIdx = 0; dayIdx < TOTAL_DAYS; dayIdx++) {
    const dayDate = addDays(START_DATE, dayIdx);
    const dow = dayDate.getUTCDay();
    // Skip some Sundays for realism (closed)
    if (dow === 0 && rng() > 0.3) continue;

    for (let cIdx = 0; cIdx < counterIds.length; cIdx++) {
      const startTime = addDays(dayDate, 0);
      startTime.setUTCHours(9, 0, 0, 0);
      const endTime = addDays(dayDate, 0);
      endTime.setUTCHours(21, 0, 0, 0);
      const openingCash = 50000;
      const cashier = cIdx === 0 ? casher1User : casher2User;
      const sessionId = randomUUID();

      sessionRows.push({
        id: sessionId,
        userId: cashier.id,
        counterId: counterIds[cIdx],
        branchId: branch.id,
        startTime,
        endTime,
        status: "closed",
        openingCash: money(openingCash),
        expectedClosingCash: money(openingCash), // will update after sales
        actualClosingCash: money(openingCash),   // will update after sales
        cashDifference: "0.00",                   // will update after sales
      });

      sessionMap.set(`${dayIdx}|${cIdx}`, sessionId);
      sessionToCashier.set(sessionId, cashier.id);
    }
    if (sessionRows.length >= SESSION_CHUNK) await flushSessions();
  }
  await flushSessions();

  console.log(`  ✓ ${sessionMap.size} POS sessions created`);

  // -------------------------------------------------------------------------
  // Phase 11 — Seed sales + sale_details from CSV data
  // -------------------------------------------------------------------------

  console.log("Phase 11: Seeding sales…");

  // Track daily cash for session closing
  const dailySessionCash = new Map<string, number>(); // "dayIdx|cIdx" → cash total
  let saleCount = 0;
  let saleLineCount = 0; // total sale_detail rows planned
  let journalEntryCount = 0;
  let plannedLineCount = 0; // invoice lines the plan wanted to sell
  let stockoutLines = 0; // lines dropped because the shop was out of stock

  // Track per-day sale sequence for sale_number
  const dailySaleSeq = new Map<string, number>();

  // Bulk-insert buffer. 18 tiled cycles produce ~9k sales / ~18k sale lines /
  // ~27k journal lines — inserting those one row at a time against a remote
  // Postgres would take hours, so rows are planned in memory and flushed in
  // chunks.
  const SALE_CHUNK = 500;
  type PlannedSaleRow = {
    sale: typeof sales.$inferInsert;
    details: (typeof saleDetails.$inferInsert)[];
    entry: typeof journalEntries.$inferInsert;
    lines: (typeof journalLines.$inferInsert)[];
  };
  let planned: PlannedSaleRow[] = [];

  const flushPlannedSales = async () => {
    if (planned.length === 0) return;
    await db.insert(sales).values(planned.map((p) => p.sale));
    await db.insert(saleDetails).values(planned.flatMap((p) => p.details));
    await db.insert(journalEntries).values(planned.map((p) => p.entry));
    await db.insert(journalLines).values(planned.flatMap((p) => p.lines));
    planned = [];
  };

  for (const { targetDate, dayIdx, time, lines: plannedLines } of plannedSales) {
    plannedLineCount += plannedLines.length;
    // Assign to a counter session
    const cIdx = dayIdx % counterIds.length;
    const sessionKey = `${dayIdx}|${cIdx}`;
    let sessionId = sessionMap.get(sessionKey);
    if (!sessionId) {
      // Fallback: create/find any session for this day
      const altKey = `${dayIdx}|0`;
      sessionId = sessionMap.get(altKey);
      if (!sessionId) {
        // Skip if no session exists for this day
        continue;
      }
    }

    // Build sale date-time from the planned invoice time
    const [hh, mm] = time.split(":").map(Number);
    const saleDate = new Date(targetDate);
    saleDate.setUTCHours(hh, mm, 0, 0);

    // Sale number
    const dateKey = fmtDate(targetDate);
    const seq = (dailySaleSeq.get(dateKey) ?? 0) + 1;
    dailySaleSeq.set(dateKey, seq);
    const saleNumber = `SALE-YGN-${dateKey.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;

    const paymentMethod = "cash" as const;

    // Build sale details
    const detailRows: Array<{
      itemId: string;
      productId: string;
      quantity: number;
      unitPrice: string;
      discount: string;
      taxRateApplied: string;
      lineTotal: string;
    }> = [];

    let subtotal = 0;
    let totalTax = 0;

    for (const planned of plannedLines) {
      const prod = productRows.find((p) => p.id === planned.productId);
      if (!prod) continue;

      // FIFO allocation across batches: a line may be served from more than
      // one batch (the oldest first), exactly like a POS would split it.
      // Only a genuine stock-out drops the line.
      const batches = batchesByProduct.get(prod.id) ?? [];
      let needed = planned.quantity;
      const allocations: Array<{ batch: Batch; quantity: number }> = [];
      for (const batch of batches) {
        if (needed <= 0) break;
        if (batch.remaining <= 0) continue;
        const take = Math.min(batch.remaining, needed);
        batch.remaining -= take;
        needed -= take;
        allocations.push({ batch, quantity: take });
      }
      if (needed > 0) {
        // Genuine stock-out: give the units back to the batches we took.
        for (const allocation of allocations) allocation.batch.remaining += allocation.quantity;
        stockoutLines++;
        continue;
      }

      const cat = catById.get(prod.categoryId);
      const taxRate = parseFloat(cat?.taxRate ?? "5.00");
      for (const allocation of allocations) {
        const unitPrice = allocation.batch.sellingPrice;
        const lineTotal = unitPrice * allocation.quantity;
        const lineTax = lineTotal * (taxRate / 100);

        subtotal += lineTotal;
        totalTax += lineTax;

        detailRows.push({
          itemId: allocation.batch.itemId,
          productId: prod.id,
          quantity: allocation.quantity,
          unitPrice: money(unitPrice),
          discount: "0.00",
          taxRateApplied: money(taxRate),
          lineTotal: money(lineTotal),
        });
      }
    }

    if (detailRows.length === 0) continue; // no valid lines

    // Sale totals
    const totalAmount = subtotal + totalTax;
    // Round to nearest 50
    const grandTotal = Math.round(totalAmount / 50) * 50;
    const roundingAdj = grandTotal - totalAmount;

    // POS demo sales use cash only.
    // Round cash received up to a convenient note.
    const notes = [1000, 5000, 10000];
    let received = grandTotal;
    for (const note of notes) {
      if (grandTotal <= note) { received = note; break; }
    }
    if (grandTotal > 10000) received = Math.ceil(grandTotal / 10000) * 10000;
    const cashReceived = money(received);

    // Plan the sale (ids are generated up front so the bulk inserts do not
    // depend on RETURNING row order).
    const saleId = randomUUID();
    const entryId = randomUUID();
    const cashierId = sessionToCashier.get(sessionId) ?? casher1User.id;

    saleCount++;
    saleLineCount += detailRows.length;
    journalEntryCount++;

    // Track cash for session
    const key = `${dayIdx}|${cIdx}`;
    dailySessionCash.set(key, (dailySessionCash.get(key) ?? 0) + grandTotal);

    const debitAccount = "1000";
    const lines = [
      {
        entryId,
        accountId: glMap.get(debitAccount)!,
        debit: money(grandTotal),
        credit: "0.00",
      },
      {
        entryId,
        accountId: glMap.get("4000")!,
        debit: "0.00",
        credit: money(subtotal),
      },
    ];
    if (totalTax > 0) {
      lines.push({
        entryId,
        accountId: glMap.get("2100")!,
        debit: "0.00",
        credit: money(totalTax),
      });
    }

    planned.push({
      sale: {
        id: saleId,
        branchId: branch.id,
        saleNumber,
        posSessionId: sessionId,
        subtotal: money(subtotal),
        discountAmount: "0.00",
        tax: money(totalTax),
        totalAmount: money(totalAmount),
        roundingAdjustment: money(roundingAdj),
        grandTotal: money(grandTotal),
        paymentMethod,
        paymentReference: null,
        mobileProvider: null,
        mobileTransactionId: null,
        cashReceived,
        cardLast4: null,
        status: "completed" as const,
        saleDate,
        createdBy: cashierId,
      },
      details: detailRows.map((d) => ({
        saleId,
        itemId: d.itemId,
        productId: d.productId,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        discount: d.discount,
        taxRateApplied: d.taxRateApplied,
        lineTotal: d.lineTotal,
      })),
      entry: {
        id: entryId,
        branchId: branch.id,
        entryDate: saleDate,
        refType: "sale" as const,
        refId: saleId,
        memo: `Sale ${saleNumber}`,
        createdBy: cashierId,
      },
      lines,
    });

    if (planned.length >= SALE_CHUNK) await flushPlannedSales();
  }

  await flushPlannedSales();

  console.log(`  ✓ ${saleCount} sales, ${saleLineCount} sale details, ${journalEntryCount} journal entries`);
  console.log(
    `  ✓ ${plannedLineCount} planned invoice lines, ${stockoutLines} dropped as stock-outs ` +
      `(${((stockoutLines / Math.max(1, plannedLineCount)) * 100).toFixed(2)}%)`,
  );

  // Reconcile every batch's live stock balance with what the FIFO allocation
  // actually consumed during the sales pass. Without this the items table
  // would still show the full received quantity, and stock-based features
  // (reorder thresholds, margin watch, dead-stock alerts) would read stock
  // that was never sold. Batched with a single UPDATE ... FROM (VALUES ...).
  const stockRows = Array.from(batchesByProduct.values())
    .flat()
    .map((b) => ({
      id: b.itemId,
      qty: Math.max(0, Math.round(b.remaining)),
      startedWith: b.startedWith,
    }))
    .filter((b) => b.qty !== b.startedWith);
  if (stockRows.length > 0) {
    // sql.join builds a FLAT list — a reduce would nest one level per row and
    // blow the stack on a few thousand batches.
    const values = sql.join(
      stockRows.map((b) => sql`(${b.id}::uuid, ${b.qty}::int)`),
      sql`, `,
    );
    await db.execute(
      sql`UPDATE items AS i
          SET current_stock_quantity = v.qty
          FROM (VALUES ${values}) AS v(id, qty)
          WHERE i.id = v.id`,
    );
  }

  // Finalise every POS session: expected = opening + cash sales; actual =
  // expected + a small non-negative discrepancy (≥ 0). Keeps the stored
  // triple consistent with the live close-route formula and never negative.
  const sessionClose = Array.from(sessionMap.entries()).map(([key, sessionId]) => {
    const cash = dailySessionCash.get(key) ?? 0;
    const opening = 50000;
    const expected = opening + cash;
    const discrepancy = randInt(0, 2000); // always ≥ 0
    return { id: sessionId, expected, actual: expected + discrepancy, discrepancy };
  });
  if (sessionClose.length > 0) {
    const values = sql.join(
      sessionClose.map(
        (s) => sql`(${s.id}::uuid, ${s.expected}::numeric, ${s.actual}::numeric, ${s.discrepancy}::numeric)`,
      ),
      sql`, `,
    );
    await db.execute(
      sql`UPDATE pos_session AS ps
          SET expected_closing_cash = v.expected,
              actual_closing_cash = v.actual,
              cash_difference = v.difference
          FROM (VALUES ${values}) AS v(id, expected, actual, difference)
          WHERE ps.id = v.id`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase 12 — Seed supporting data
  // -------------------------------------------------------------------------

  console.log("Phase 12: Seeding supporting data (expenses, attendance, etc.)…");

  // Expense categories
  const expCatNames = ["Rent", "Utilities", "Supplies", "Maintenance", "Marketing", "Miscellaneous"];
  const expCatIds: string[] = [];
  for (const name of expCatNames) {
    const [row] = await db
      .insert(expenseCategories)
      .values({ branchId: branch.id, name, isDeleted: false })
      .returning({ id: expenseCategories.id });
    expCatIds.push(row.id);
  }

  // Expense budgets (monthly, one row per category per month across the range)
  const months: string[] = [];
  {
    let y = START_DATE.getUTCFullYear();
    let m = START_DATE.getUTCMonth();
    while (true) {
      months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      const next = new Date(Date.UTC(y, m + 1, 1));
      if (next > END_DATE) break;
      y = next.getUTCFullYear();
      m = next.getUTCMonth();
    }
  }
  for (const month of months) {
    for (let ci = 0; ci < expCatIds.length; ci++) {
      const limit = pick([500000, 800000, 1200000, 200000, 300000]);
      await db.insert(expenseBudgets).values({
        branchId: branch.id,
        categoryId: expCatIds[ci],
        month,
        limitAmount: money(limit),
      }).onConflictDoNothing();
    }
  }

  // Expenses — spread across the period
  const EXPENSE_CHUNK = 200;
  type PlannedExpense = {
    expense: typeof expenses.$inferInsert;
    entry: typeof journalEntries.$inferInsert;
    lines: (typeof journalLines.$inferInsert)[];
  };
  let expenseRows: PlannedExpense[] = [];
  const flushExpenses = async () => {
    if (expenseRows.length === 0) return;
    await db.insert(expenses).values(expenseRows.map((e) => e.expense));
    await db.insert(journalEntries).values(expenseRows.map((e) => e.entry));
    await db.insert(journalLines).values(expenseRows.flatMap((e) => e.lines));
    expenseRows = [];
  };
  for (let dayIdx = 0; dayIdx < TOTAL_DAYS; dayIdx += randInt(3, 8)) {
    const expDate = addDays(START_DATE, dayIdx);
    const catIdx = randInt(0, expCatNames.length - 1);
    const amount = randInt(5000, 150000);
    const entryId = randomUUID();

    expenseRows.push({
      expense: {
        branchId: branch.id,
        categoryId: expCatIds[catIdx],
        amount: money(amount),
        expenseDate: expDate,
        method: pick(["cash", "bank_transfer", "mobile_payment"] as const),
        notes: `${expCatNames[catIdx]} expense`,
        recordedBy: adminUser.id,
      },
      // Journal entry for expense
      entry: {
        id: entryId,
        branchId: branch.id,
        entryDate: expDate,
        refType: "expense",
        memo: `${expCatNames[catIdx]} expense`,
        createdBy: adminUser.id,
      },
      lines: [
        {
          entryId,
          accountId: glMap.get("5100")!,
          debit: money(amount),
          credit: "0.00",
        },
        {
          entryId,
          accountId: glMap.get("1000")!,
          debit: "0.00",
          credit: money(amount),
        },
      ],
    });
    if (expenseRows.length >= EXPENSE_CHUNK) await flushExpenses();
  }
  await flushExpenses();

  // Staff attendance — daily for each user during the period (batched:
  // ~4k rows over the full demo date range).
  const ATTENDANCE_CHUNK = 500;
  type PlannedAttendance = typeof staffAttendance.$inferInsert;
  let attendanceRows: PlannedAttendance[] = [];
  const flushAttendance = async () => {
    if (attendanceRows.length === 0) return;
    await db.insert(staffAttendance).values(attendanceRows);
    attendanceRows = [];
  };
  for (let dayIdx = 0; dayIdx < TOTAL_DAYS; dayIdx++) {
    const dayDate = addDays(START_DATE, dayIdx);
    const dow = dayDate.getUTCDay();
    if (dow === 0) continue; // no Sunday attendance

    for (const user of [adminUser, inventoryUser, casher1User, casher2User]) {
      const clockIn = new Date(dayDate);
      clockIn.setUTCHours(randInt(8, 9), randInt(0, 30), 0, 0);
      const clockOut = new Date(dayDate);
      clockOut.setUTCHours(randInt(17, 21), randInt(0, 30), 0, 0);

      attendanceRows.push({
        branchId: branch.id,
        userId: user.id,
        clockInAt: clockIn,
        clockOutAt: clockOut,
      });
    }
    if (attendanceRows.length >= ATTENDANCE_CHUNK) await flushAttendance();
  }
  await flushAttendance();

  // Roster schedules — effective-dated daily schedules (expand-on-read).
  // One schedule covers the whole demo window; a couple of quick-add rows
  // demonstrate per-day overrides.
  const [demoSchedule] = await db
    .insert(rosterSchedules)
    .values({
      branchId: branch.id,
      name: "Demo schedule",
      startDate: START_DATE,
      endDate: END_DATE,
      isActive: true,
      createdBy: adminUser.id,
    })
    .returning();

  await db.insert(rosterScheduleEntries).values([
    {
      scheduleId: demoSchedule.id,
      userId: adminUser.id,
      plannedStart: "09:00",
      plannedEnd: "18:00",
      counterId: counterIds[0], // admin may take a counter
    },
    {
      scheduleId: demoSchedule.id,
      userId: inventoryUser.id,
      plannedStart: "09:00",
      plannedEnd: "18:00",
      // no counterId — inventory staff are not tied to a counter
    },
    {
      scheduleId: demoSchedule.id,
      userId: casher1User.id,
      plannedStart: "10:00",
      plannedEnd: "19:00",
      counterId: counterIds[0], // Cashier One → Counter 1
    },
    {
      scheduleId: demoSchedule.id,
      userId: casher2User.id,
      plannedStart: "10:00",
      plannedEnd: "19:00",
      counterId: counterIds[1], // Cashier Two → Counter 2
    },
  ]);

  // Quick-add overrides (ad-hoc single-day shifts) — alternate cashers.
  for (let dayIdx = 10; dayIdx < TOTAL_DAYS; dayIdx += 20) {
    const rosterDate = addDays(START_DATE, dayIdx);
    if (rosterDate > END_DATE) break;
    const qCIdx = (dayIdx / 10) % 2; // 0 → Cashier One/Counter 1, 1 → Cashier Two/Counter 2
    await db.insert(shiftRosters).values({
      branchId: branch.id,
      userId: qCIdx === 0 ? casher1User.id : casher2User.id,
      rosterDate,
      plannedStart: "12:00",
      plannedEnd: "21:00",
      counterId: counterIds[qCIdx],
      notes: "Quick-add override",
      createdBy: adminUser.id,
    });
  }

  // Notifications — various types across the period
  const notifTemplates = [
    { type: "low_stock", title: "Low Stock Alert", message: "Several products are below reorder threshold." },
    { type: "cash_discrepancy", title: "Cash Discrepancy", message: "Cash difference detected during session close." },
    { type: "po_received", title: "GRN Received", message: "New stock has been received and added to inventory." },
    { type: "promotion_expiry", title: "Promotion Expiring", message: "A promotion will expire within 3 days." },
    { type: "system", title: "System Update", message: "System maintenance scheduled for tonight." },
  ];

  for (let dayIdx = 0; dayIdx < TOTAL_DAYS; dayIdx += randInt(5, 15)) {
    const notifDate = addDays(START_DATE, dayIdx);
    const tmpl = pick(notifTemplates);
    await db.insert(notifications).values({
      branchId: branch.id,
      userId: rng() > 0.5 ? null : pick([adminUser.id, inventoryUser.id]),
      type: tmpl.type,
      title: tmpl.title,
      message: tmpl.message,
      channel: pick(["in_app", "telegram"] as const),
      isRead: rng() > 0.4,
      createdAt: notifDate,
    });
  }

  // Promotions — recurring seasonal campaigns across the whole range
  // (New Year, mid-year and Back-to-School per year, plus a year-end
  // clearance that is still active at the end of the window).
  const promoDefs = [
    { name: "New Year Sale 2024", type: "percentage" as const, value: "10", startOffset: 0, endOffset: 29 },
    { name: "Spring Sale 2024", type: "percentage" as const, value: "8", startOffset: 90, endOffset: 119 },
    { name: "Mid-Year Electronics Deal 2024", type: "fixed" as const, value: "500", startOffset: 180, endOffset: 209 },
    { name: "Back to School Promo 2024", type: "percentage" as const, value: "15", startOffset: 240, endOffset: 269 },
    { name: "New Year Sale 2025", type: "percentage" as const, value: "10", startOffset: 365, endOffset: 394 },
    { name: "Spring Sale 2025", type: "percentage" as const, value: "8", startOffset: 455, endOffset: 484 },
    { name: "Mid-Year Electronics Deal 2025", type: "fixed" as const, value: "500", startOffset: 545, endOffset: 574 },
    { name: "Back to School Promo 2025", type: "percentage" as const, value: "15", startOffset: 605, endOffset: 634 },
    { name: "New Year Sale 2026", type: "percentage" as const, value: "10", startOffset: 730, endOffset: 759 },
    { name: "Spring Sale 2026", type: "percentage" as const, value: "8", startOffset: 820, endOffset: 849 },
    { name: "Mid-Year Electronics Deal 2026", type: "fixed" as const, value: "500", startOffset: 910, endOffset: 939 },
    { name: "Back to School Promo 2026", type: "percentage" as const, value: "15", startOffset: 970, endOffset: 999 },
    { name: "Year-End Clearance 2026", type: "percentage" as const, value: "20", startOffset: 1000, endOffset: TOTAL_DAYS - 1 },
  ];

  for (const promo of promoDefs) {
    const startDate = addDays(START_DATE, promo.startOffset);
    const endDate = addDays(START_DATE, promo.endOffset);
    // The final campaign still runs at the end of the window, so it is the
    // one "active" promotion the promo list shows.
    const status = promo.endOffset >= TOTAL_DAYS - 1 ? "active" : "expired";

    const [pr] = await db
      .insert(promotions)
      .values({
        branchId: branch.id,
        name: promo.name,
        type: promo.type,
        value: promo.value,
        startDate,
        endDate,
        status: status as "active" | "expired",
        isAiSuggested: rng() > 0.7,
        createdBy: adminUser.id,
      })
      .returning({ id: promotions.id });

    // Attach a few products
    const promoProducts = productRows.slice(0, randInt(3, 8));
    for (const p of promoProducts) {
      await db.insert(promotionProducts).values({
        promotionId: pr.id,
        productId: p.id,
        requiredQuantity: 1,
      });
    }
  }

  // Product price history — a few price changes per year
  for (let i = 0; i < randInt(40, 70); i++) {
    const prod = pick(productRows);
    const oldPrice = prod.unitPrice * randFloat(0.85, 0.95);
    const newPrice = prod.unitPrice;
    const changeDate = addDays(START_DATE, randInt(0, TOTAL_DAYS - 1));
    await db.insert(productPriceHistory).values({
      productId: prod.id,
      oldPrice: money(oldPrice),
      newPrice: money(newPrice),
      changedBy: adminUser.id,
      changedAt: changeDate,
      reason: pick(["Cost adjustment", "Supplier price change", "Promotional pricing", "Market rate update"]),
    });
  }

  // Stock adjustments — a few damage/loss corrections
  for (let i = 0; i < randInt(25, 40); i++) {
    const adjDate = addDays(START_DATE, randInt(0, TOTAL_DAYS - 1));
    // Sequence suffix keeps adjustment_number unique when two adjustments
    // land on the same day (the column has a unique constraint).
    const adjNumber = `ADJ-YGN-${fmtFull(adjDate)}-${String(i + 1).padStart(3, "0")}`;
    const reasonType = pick(["damage", "loss", "found", "correction"] as const);

    const [adj] = await db
      .insert(stockAdjustments)
      .values({
        branchId: branch.id,
        adjustmentNumber: adjNumber,
        reasonType,
        reason: `${reasonType} - routine stock check`,
        createdBy: inventoryUser.id,
      })
      .returning({ id: stockAdjustments.id });

    // Pick a random batch
    const allBatches = Array.from(batchesByProduct.values()).flat();
    if (allBatches.length > 0) {
      const batch = pick(allBatches);
      const delta = reasonType === "found" ? randInt(1, 5) : -randInt(1, 10);
      await db.insert(stockAdjustmentDetails).values({
        adjustmentId: adj.id,
        itemId: batch.itemId,
        quantityDelta: delta,
        stockBefore: batch.remaining,
        stockAfter: batch.remaining + delta,
      });
      batch.remaining = Math.max(0, batch.remaining + delta);
    }
  }

  // Sale returns — a random sample of earlier sales
  // (all sales are loaded so the sample spreads across the whole 2.75-year
  // window instead of clustering in the first rows)
  const allSales = await db
    .select({ id: sales.id, saleNumber: sales.saleNumber, saleDate: sales.saleDate })
    .from(sales);
  // Distinct sales only: return_number is unique per original sale.
  const returnCandidates = [...allSales].sort(() => rng() - 0.5).slice(0, randInt(20, 45));
  for (const sale of returnCandidates) {
    // A return happens days after its sale, never before it.
    const returnDate = addDays(sale.saleDate, randInt(1, 30));
    if (returnDate > END_DATE) continue;
    const returnNumber = `RET-${sale.saleNumber}-01`;

    // Get sale details for this sale
    const saleDets = await db.select({ id: saleDetails.id, itemId: saleDetails.itemId, quantity: saleDetails.quantity, lineTotal: saleDetails.lineTotal }).from(saleDetails).where(eq(saleDetails.saleId, sale.id)).limit(1);
    if (saleDets.length === 0) continue;

    const det = saleDets[0];
    const refundAmount = parseFloat(det.lineTotal) * 0.5; // partial return

    const [sr] = await db
      .insert(saleReturns)
      .values({
        branchId: branch.id,
        returnNumber,
        saleId: sale.id,
        status: "approved",
        refundAmount: money(refundAmount),
        createdBy: pick(casherUsers).id,
        approvedBy: adminUser.id,
        createdAt: returnDate,
      })
      .returning({ id: saleReturns.id });

    await db.insert(saleReturnDetails).values({
      returnId: sr.id,
      saleDetailId: det.id,
      itemId: det.itemId,
      quantity: 1,
      refundAmount: money(refundAmount),
    });
  }

  // Ground balances — monthly stock takes
  for (const monthStart of monthStartOffsets()) {
    const gbDate = addDays(START_DATE, monthStart + 28); // end of month-ish
    if (gbDate > END_DATE) continue;
    const batchNo = `GB-YGN-${fmtCompact(gbDate)}`;

    await db.insert(groundBalances).values({
      batchNo,
      branchId: branch.id,
      gbDate,
      status: "completed",
      remark: "Monthly stock count",
      createdBy: inventoryUser.id,
      updatedBy: inventoryUser.id,
    });

    // Sample a few items for the count (random across all batches, so each
    // monthly count covers a different set of items)
    const allBatches = Array.from(batchesByProduct.values()).flat();
    const sample = [...allBatches].sort(() => rng() - 0.5).slice(0, Math.min(10, allBatches.length));
    for (const b of sample) {
      const actual = b.remaining + randInt(-2, 2);
      await db.insert(groundBalanceDetails).values({
        batchNo,
        itemId: b.itemId,
        actualQty: actual,
        inventoryQty: b.remaining,
        differenceQty: actual - b.remaining,
      });
    }
  }

  // Petty cash floats — one per month across the range
  for (const monthStart of monthStartOffsets()) {
    const issueDate = addDays(START_DATE, monthStart);
    if (issueDate > END_DATE) continue;
    await db.insert(pettyCashFloats).values({
      branchId: branch.id,
      holderUserId: adminUser.id,
      issuedAmount: money(200000),
      status: "closed",
      returnedAmount: money(randInt(150000, 200000)),
      closedAt: clampToSeedRange(addDays(issueDate, 28)),
      notes: "Monthly petty cash float",
      createdBy: adminUser.id,
    });
  }

  // Audit logs — sample entries
  const auditActions = ["create", "update", "delete", "login", "logout", "export"];
  const auditEntities = ["product", "sale", "user", "supplier", "inventory", "settings"];
  for (let i = 0; i < 200; i++) {
    const logDate = addDays(START_DATE, randInt(0, TOTAL_DAYS - 1));
    await db.insert(auditLogs).values({
      entityType: pick(auditEntities),
      entityId: randomUUID(),
      action: pick(auditActions),
      description: `Demo audit log entry`,
      userId: pick([adminUser.id, inventoryUser.id, casher1User.id, casher2User.id]),
      branchId: branch.id,
      ipAddress: `192.168.1.${randInt(1, 254)}`,
      createdAt: logDate,
    });
  }

  // Shift handovers — occasional
  const allSessions = await db.select({ id: posSessions.id }).from(posSessions).limit(200);
  for (let i = 0; i < Math.min(40, allSessions.length); i++) {
    const session = pick(allSessions);
    const handoverDate = addDays(START_DATE, randInt(0, TOTAL_DAYS - 1));
    await db.insert(shiftHandovers).values({
      branchId: branch.id,
      posSessionId: session.id,
      outgoingUserId: pick(casherUsers).id,
      incomingUserId: adminUser.id,
      expectedCash: money(randInt(50000, 150000)),
      blindCount: money(randInt(50000, 150000)),
      difference: money(randInt(-1000, 1000)),
      handedAt: handoverDate,
      createdBy: pick(casherUsers).id,
    });
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  async function tableCount(table: unknown) {
    const rows = (await db.select({ n: count() }).from(table as never)) as Array<{ n: unknown }>;
    return Number(rows[0]?.n ?? 0);
  }

  const summary = {
    branch: await tableCount(branches),
    users: await tableCount(users),
    counters: await tableCount(counters),
    categories: await tableCount(categories),
    units: await tableCount(units),
    products: await tableCount(products),
    suppliers: await tableCount(suppliers),
    purchaseOrders: await tableCount(purchaseOrders),
    grns: await tableCount(grns),
    items: await tableCount(items),
    posSessions: await tableCount(posSessions),
    sales: await tableCount(sales),
    saleDetails: await tableCount(saleDetails),
    expenses: await tableCount(expenses),
    journalEntries: await tableCount(journalEntries),
    staffAttendance: await tableCount(staffAttendance),
    permissions: await tableCount(permissions),
    glAccounts: await tableCount(glAccounts),
  };

  console.log("\n✅ Demo seed complete!");
  console.log(`   Date range: ${fmtDate(START_DATE)} → ${fmtDate(END_DATE)} (${TOTAL_DAYS} days)`);
  console.log(`   Products: ${summary.products}, Sales: ${summary.sales}, Sessions: ${summary.posSessions}`);
  console.log(`   Inventory batches: ${summary.items}, Journal entries: ${summary.journalEntries}`);

  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const summary = await runDemoSeed();
  console.log(
    `\nSummary: ${summary.categories} categories, ${summary.products} products, ` +
      `${summary.suppliers} suppliers, ${summary.items} inventory batches, ` +
      `${summary.sales} sales, ${summary.saleDetails} sale lines, ` +
      `${summary.journalEntries} journal entries.`,
  );
}
