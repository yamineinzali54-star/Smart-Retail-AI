import "server-only";

import { and, eq, gt, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { branches, items, notifications, products } from "@/db/schema";
import { notifyTelegram } from "@/lib/telegram";

// Alert scan — single implementation shared by the HTTP cron endpoint
// (/api/cron/alerts), the manual /cron UI, and the internal scheduler
// (lib/internal-cron.ts). Scans ALL branches for low-stock and expiry
// alerts with today-dedupe (skip a type if an unread notification of that
// type was already created today), so overlapping runs are harmless.

// Structural executor: both the global db client and a transaction satisfy it.
interface ScanDb {
  select: typeof db.select;
  insert: typeof db.insert;
}

export interface BranchScanResult {
  lowStock: number;
  expired: number;
  expiringSoon: number;
  notified: string[];
  branchCode: string;
  branchName: string;
  daysThreshold: number;
}

export interface AlertScanResult {
  skipped: boolean;
  branches: Record<string, BranchScanResult>;
}

const DEFAULT_DAYS_THRESHOLD = 30;

export interface AlertScanOptions {
  /** Scan one branch only (default: all branches). */
  branchId?: string;
  /** Expiry horizon in days, 1–90 (default 30). */
  daysThreshold?: number;
}

async function scanWith(
  ex: ScanDb,
  options: AlertScanOptions = {},
): Promise<Record<string, BranchScanResult>> {
  const daysThreshold =
    typeof options.daysThreshold === "number" && options.daysThreshold > 0
      ? Math.min(90, Math.floor(options.daysThreshold))
      : DEFAULT_DAYS_THRESHOLD;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const allBranches = await ex
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches);
  const branchRows = options.branchId
    ? allBranches.filter((b) => b.id === options.branchId)
    : allBranches;

  const results: Record<string, BranchScanResult> = {};

  for (const branch of branchRows) {
    const branchId = branch.id;
    const existing = await ex
      .select({ type: notifications.type })
      .from(notifications)
      .where(
        and(
          eq(notifications.branchId, branchId),
          eq(notifications.isRead, false),
          gte(notifications.createdAt, startOfDay),
        ),
      );
    const haveToday = new Set(existing.map((n) => n.type));

    // Product-level low-stock: sum stock across batches per product and
    // compare the SUM to the product's reorder threshold. A product with
    // many small batches but a healthy total is NOT low stock.
    const lowRows = await ex
      .select({
        product_id: items.productId,
        on_hand: sql<number>`COALESCE(SUM(${items.currentStockQuantity}), 0)`,
        reorder_threshold: sql<number>`COALESCE(MAX(${products.reorderThreshold}), 5)`,
      })
      .from(items)
      .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
      .where(and(eq(items.branchId, branchId), gt(items.currentStockQuantity, 0)))
      .groupBy(items.productId)
      .having(
        sql`COALESCE(SUM(${items.currentStockQuantity}), 0) <= COALESCE(MAX(${products.reorderThreshold}), 5)`,
      );
    const lowCount = lowRows.length;

    const cutoff = new Date(Date.now() + daysThreshold * 86_400_000);
    const expiring = await ex
      .select({ id: items.id, expiryDate: items.expiryDate })
      .from(items)
      .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
      .where(
        and(
          eq(items.branchId, branchId),
          gt(items.currentStockQuantity, 0),
          lte(items.expiryDate, cutoff),
        ),
      )
      .limit(5000);
    const now = new Date();
    const expiredCount = expiring.filter((r) => r.expiryDate && new Date(r.expiryDate) < now).length;
    const soonCount = expiring.length - expiredCount;

    const created: string[] = [];
    if (lowCount > 0 && !haveToday.has("low_stock")) {
      await ex.insert(notifications).values({
        branchId,
        userId: null,
        type: "low_stock",
        title: "Low stock alert",
        message: `${lowCount} product(s) at or below reorder threshold.`,
      });
      created.push("low_stock");
    }
    if ((expiredCount > 0 || soonCount > 0) && !haveToday.has("expiry")) {
      await ex.insert(notifications).values({
        branchId,
        userId: null,
        type: "expiry",
        title: "Expiry alert",
        message: `${expiredCount} expired, ${soonCount} expiring within ${daysThreshold} days (stock > 0).`,
      });
      created.push("expiry");
    }

    results[branchId] = {
      lowStock: lowCount,
      expired: expiredCount,
      expiringSoon: soonCount,
      notified: created,
      branchCode: branch.code,
      branchName: branch.name,
      daysThreshold,
    };
  }

  return results;
}

function fanOutToTelegram(branches: Record<string, BranchScanResult>): void {
  for (const r of Object.values(branches)) {
    const base = { branchCode: r.branchCode, branchName: r.branchName };
    if (r.notified.includes("low_stock")) {
      void notifyTelegram("low_stock", { ...base, lowStockCount: r.lowStock });
    }
    if (r.notified.includes("expiry")) {
      void notifyTelegram("expiry", {
        ...base,
        expiredCount: r.expired,
        expiringSoonCount: r.expiringSoon,
        daysThreshold: r.daysThreshold,
      });
    }
  }
}

export async function runAlertScan(options: AlertScanOptions = {}): Promise<AlertScanResult> {
  // Single-flight across instances: claim a transaction-scoped advisory lock
  // and hold it for the whole scan. Drivers without transaction support fall
  // back to a direct run — today-dedupe keeps that idempotent.
  try {
    const out = await db.transaction(async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('srai-alert-scan')) AS locked`,
      )) as Array<{ locked: boolean }>;
      if (!rows[0]?.locked) return { skipped: true, branches: {} };
      return { skipped: false, branches: await scanWith(tx, options) };
    });
    // Telegram fan-out only after commit — a rolled-back scan must not alert.
    if (!out.skipped) fanOutToTelegram(out.branches);
    return out;
  } catch (err) {
    console.warn("[internal-cron] transaction lock unavailable, running scan directly:", err);
    const out = { skipped: false, branches: await scanWith(db, options) };
    fanOutToTelegram(out.branches);
    return out;
  }
}
