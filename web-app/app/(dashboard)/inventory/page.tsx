import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { categories, items, products } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InventoryDashboardVisuals } from "@/components/dashboards/InventoryDashboardVisuals";
import { InventoryAttendanceClock } from "@/components/dashboards/InventoryAttendanceClock";

export default async function InventoryDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "inventory" && session.user.role !== "admin") redirect("/dashboard");

  const batches = await db
    .select({
      stock: items.currentStockQuantity,
      threshold: products.reorderThreshold,
      sellingPrice: items.sellingPrice,
      productName: products.name,
      categoryName: categories.name,
      expiryDate: items.expiryDate,
    })
    .from(items)
    .innerJoin(products, and(eq(items.productId, products.id), eq(products.isDeleted, false)))
    .leftJoin(categories, and(eq(products.categoryId, categories.id), eq(categories.isDeleted, false)))
    .where(and(eq(items.branchId, session.user.branchId), gt(items.currentStockQuantity, 0)));

  const inStock = batches.length;
  const lowCount = batches.filter((row) => (row.stock ?? 0) <= (row.threshold ?? 5)).length;
  const [{ now }] = (await db.execute(sql`select now() as now`)) as unknown as [
    { now: Date | string },
  ];
  // Neon HTTP returns timestamptz as a string ("2026-10-21 11:22:33.456+00"),
  // node-postgres as a Date — normalize either to epoch ms.
  const nowMs = new Date(typeof now === "string" ? now.replace(" ", "T") : now).getTime();
  const soonCutoff = nowMs + 7 * 86_400_000;
  const expiringSoon = batches.filter(
    (row) => row.expiryDate && new Date(row.expiryDate).getTime() <= soonCutoff,
  ).length;
  const stockValue = batches.reduce(
    (total, row) => total + (row.stock ?? 0) * Number(row.sellingPrice),
    0,
  );

  const categoryTotals = new Map<string, { quantity: number; stockValue: number }>();
  const productTotals = new Map<string, { quantity: number; stockValue: number }>();
  const expiryTotals = new Map([
    ["Expired", { batches: 0, quantity: 0 }],
    ["≤ 7 days", { batches: 0, quantity: 0 }],
    ["8–30 days", { batches: 0, quantity: 0 }],
    ["30+ days", { batches: 0, quantity: 0 }],
    ["No expiry", { batches: 0, quantity: 0 }],
  ]);

  for (const row of batches) {
    const quantity = row.stock ?? 0;
    const stockValue = quantity * Number(row.sellingPrice);
    const categoryName = row.categoryName ?? "Uncategorized";
    const category = categoryTotals.get(categoryName) ?? { quantity: 0, stockValue: 0 };
    category.quantity += quantity;
    category.stockValue += stockValue;
    categoryTotals.set(categoryName, category);

    const productName = row.productName ?? "Unnamed product";
    const product = productTotals.get(productName) ?? { quantity: 0, stockValue: 0 };
    product.quantity += quantity;
    product.stockValue += stockValue;
    productTotals.set(productName, product);

    const daysToExpiry = row.expiryDate
      ? (new Date(row.expiryDate).getTime() - nowMs) / 86_400_000
      : null;
    const expiryLabel = daysToExpiry === null
      ? "No expiry"
      : daysToExpiry < 0
        ? "Expired"
        : daysToExpiry <= 7
          ? "≤ 7 days"
          : daysToExpiry <= 30
            ? "8–30 days"
            : "30+ days";
    const expiry = expiryTotals.get(expiryLabel)!;
    expiry.batches += 1;
    expiry.quantity += quantity;
  }

  const categoryData = Array.from(categoryTotals.entries())
    .map(([categoryName, values]) => ({ categoryName, ...values }))
    .sort((left, right) => right.stockValue - left.stockValue)
    .slice(0, 8);
  const topProducts = Array.from(productTotals.entries())
    .map(([productName, values]) => ({ productName, ...values }))
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 8);
  const expiryData = Array.from(expiryTotals.entries()).map(([label, values]) => ({ label, ...values }));
  const healthData = [
    { metric: "Healthy", count: batches.filter((row) => (row.stock ?? 0) > (row.threshold ?? 5)).length },
    { metric: "Low stock", count: lowCount },
    { metric: "Expired", count: expiryTotals.get("Expired")!.batches },
    { metric: "Expiring soon", count: expiringSoon },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Operations</p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Inventory dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Stock management and monitoring</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Batches in stock</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{inStock}</p>
            <p className="text-xs text-muted-foreground"><Link href="/stock" className="text-primary hover:underline">View stock</Link></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Low stock</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-destructive">{lowCount}</p><p className="text-xs text-muted-foreground">At/below threshold</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Expiring (7d)</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-muted-foreground">{expiringSoon}</p>
            <p className="text-xs text-muted-foreground"><Link href="/expiry" className="text-primary hover:underline">Manage expiry</Link></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Stock value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">K {stockValue.toLocaleString()}</p><p className="text-xs text-muted-foreground">At selling price</p></CardContent>
        </Card>
      </div>

      {session.user.role === "inventory" ? <InventoryAttendanceClock /> : null}

      <InventoryDashboardVisuals
        categoryData={categoryData}
        expiryData={expiryData}
        healthData={healthData}
        topProducts={topProducts}
      />

      <Card>
        <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-3">
          <Link href="/purchase-orders" className="flex w-full items-center border bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Purchase orders</Link>
          <Link href="/grn" className="flex w-full items-center border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">GRN receiving</Link>
          <Link href="/ground-balance" className="flex w-full items-center border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground">Ground balance</Link>
        </CardContent>
      </Card>
    </div>
  );
}
