"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Package,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
} from "lucide-react";

import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RangeKey = "1d" | "7d" | "30d";

interface SaleRow {
  id: string;
  saleNumber: string;
  saleDate: string;
  grandTotal: string;
  paymentMethod: string;
  cashierName: string | null;
}

interface ChartPoint {
  label: string;
  revenue: number;
  orders: number;
}

interface ProductShare {
  name: string;
  revenue: number;
}

interface InsightItem {
  title: string;
  detail: string;
  href: string;
}

interface ActivityRow {
  id: string;
  time: string;
  action: string;
  entityType: string;
  description: string;
  userName: string | null;
}

interface DashboardData {
  points: ChartPoint[];
  totalRevenue: number;
  totalOrders: number;
  previousRevenue: number;
  previousOrders: number;
  productCount: number;
  lowStockCount: number;
  topProducts: ProductShare[];
  insights: InsightItem[];
  activity: ActivityRow[];
  updatedAt: Date | null;
}

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: "1d", label: "Today" },
  { value: "7d", label: "Week" },
  { value: "30d", label: "Month" },
];

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const revenueConfig = {
  revenue: { label: "Sales", color: "var(--chart-1)" },
} satisfies ChartConfig;

const topProductsConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function getWindow(range: RangeKey) {
  const end = new Date();
  const start = startOfDay(end);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return { start, end };
}

function previousWindow(range: RangeKey) {
  const { start, end } = getWindow(range);
  const span = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - span - 1),
    end: new Date(start.getTime() - 1),
  };
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function amount(value: string | number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} MMK`;
}

function formatPointLabel(value: string, range: RangeKey) {
  if (range === "1d") return value;
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function buildPoints(rows: SaleRow[], range: RangeKey): ChartPoint[] {
  const { start } = getWindow(range);
  const buckets = new Map<string, ChartPoint>();

  if (range === "1d") {
    for (let hour = 0; hour < 24; hour += 1) {
      buckets.set(String(hour), { label: `${String(hour).padStart(2, "0")}:00`, revenue: 0, orders: 0 });
    }
  } else {
    const days = range === "7d" ? 7 : 30;
    const cursor = new Date(start);
    for (let index = 0; index < days; index += 1) {
      const key = dateKey(cursor);
      buckets.set(key, { label: key, revenue: 0, orders: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const row of rows) {
    const saleDate = new Date(row.saleDate);
    const key = range === "1d" ? String(saleDate.getHours()) : dateKey(saleDate);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.orders += 1;
    bucket.revenue += amount(row.grandTotal);
  }

  return Array.from(buckets.values());
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json().catch(() => null);
  return { ok: response.ok && Boolean(data?.ok), data };
}

async function fetchAllSales(start: Date, end: Date) {
  const rows: SaleRow[] = [];
  let page = 1;
  let totals = { totalSales: "0", totalAmount: "0" };

  while (page <= 1000) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "100",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    const { ok, data } = await fetchJson(`/api/admin/reports/sales?${params.toString()}`);
    if (!ok) throw new Error(data?.error || "Unable to load dashboard sales");
    if (page === 1 && data.totals) totals = data.totals;
    const batch = (data.sales as SaleRow[]) ?? [];
    rows.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return { rows, totals };
}

async function countProducts() {
  let page = 1;
  let count = 0;
  while (page <= 50) {
    const { ok, data } = await fetchJson(`/api/admin/products?page=${page}&pageSize=100`);
    if (!ok) break;
    const batch = Array.isArray(data.products) ? data.products : [];
    count += batch.length;
    if (batch.length < 100) break;
    page += 1;
  }
  return count;
}

function emptyDashboardData(): DashboardData {
  return {
    points: [],
    totalRevenue: 0,
    totalOrders: 0,
    previousRevenue: 0,
    previousOrders: 0,
    productCount: 0,
    lowStockCount: 0,
    topProducts: [],
    insights: [],
    activity: [],
    updatedAt: null,
  };
}

function KpiCard({
  title,
  value,
  hint,
  change,
  icon: Icon,
  tone = "teal",
}: {
  title: string;
  value: string;
  hint: string;
  change?: number | null;
  icon: ElementType;
  tone?: "teal" | "cyan" | "warning";
}) {
  const iconClass =
    tone === "warning"
      ? "bg-destructive/10 text-destructive"
      : tone === "cyan"
        ? "bg-[color-mix(in_srgb,#06B6D4_16%,white)] text-[#0891B2]"
        : "bg-gradient-soft text-primary";
  const rising = (change ?? 0) >= 0;

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 pt-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-[1.65rem] font-semibold tracking-tight">{value}</p>
          {change == null ? (
            <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
          ) : (
            <p className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${rising ? "text-success" : "text-destructive"}`}>
              {rising ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {`${rising ? "+" : ""}${change.toFixed(1)}% vs prior period`}
            </p>
          )}
        </div>
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function activityStatus(action: string) {
  const value = action.toLowerCase();
  if (value.includes("void") || value.includes("delete") || value.includes("fail")) {
    return { label: action, variant: "destructive" as const };
  }
  if (value.includes("update") || value.includes("edit") || value.includes("adjust")) {
    return { label: action, variant: "secondary" as const };
  }
  return { label: action, variant: "default" as const };
}

export function AdminDashboard() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const loadAiInsights = useCallback(async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const [forecastRes, basketRes] = await Promise.all([
        fetchJson("/api/ai/forecast?days=30", controller.signal),
        fetchJson("/api/ai/basket?days=90", controller.signal),
      ]);
      setData((current) => {
        const extra: InsightItem[] = [];
        const forecasts = Array.isArray(forecastRes.data?.forecasts) ? forecastRes.data.forecasts : [];
        const restock = forecasts.find((row: { needs_order?: boolean }) => row.needs_order) ?? forecasts[0];
        if (restock?.product_name) {
          extra.push({
            title: "Demand Forecast",
            detail: restock.needs_order
              ? `${restock.product_name} is projected to need ${Number(restock.suggested_qty || 0).toLocaleString()} more units.`
              : `${restock.product_name} currently has healthy cover based on recent demand.`,
            href: "/ai/demand-forecasting",
          });
        }
        const rule = Array.isArray(basketRes.data?.rules) ? basketRes.data.rules[0] : null;
        if (rule) {
          extra.push({
            title: "Basket Opportunity",
            detail: `${rule.antecedent_name || rule.antecedent} is frequently bought with ${rule.consequent_name || rule.consequent}.`,
            href: "/ai/basket",
          });
        }
        if (extra.length === 0) return current;
        const merged = [...extra, ...current.insights].filter(
          (item, index, list) => list.findIndex((entry) => entry.title === item.title) === index,
        );
        return { ...current, insights: merged.slice(0, 4) };
      });
    } catch {
      // AI jobs are optional on the dashboard; core retail metrics still render.
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    setError(null);

    try {
      const { start, end } = getWindow(range);
      const prior = previousWindow(range);
      const periodParams = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        pageSize: "8",
      });
      const priorParams = new URLSearchParams({
        startDate: prior.start.toISOString(),
        endDate: prior.end.toISOString(),
        pageSize: "1",
      });

      const [sales, priorSales, productsCount, lowStockRes, marginRes, expiryRes, activityRes] = await Promise.all([
        fetchAllSales(start, end),
        fetchJson(`/api/admin/reports/sales?${priorParams.toString()}`),
        countProducts(),
        fetchJson("/api/admin/alerts/low-stock"),
        fetchJson(`/api/admin/reports/profit-margin?${periodParams.toString()}`),
        fetchJson("/api/admin/expiry?daysThreshold=14&pageSize=5"),
        fetchJson("/api/admin/audit-logs?pageSize=6"),
      ]);

      const lowStock = Array.isArray(lowStockRes.data?.low_stock) ? lowStockRes.data.low_stock : [];
      const lowStockCount = typeof lowStockRes.data?.count === "number" ? lowStockRes.data.count : lowStock.length;
      const topProducts = (Array.isArray(marginRes.data?.margin) ? marginRes.data.margin : [])
        .map((row: { productName?: string; revenue?: string }) => ({
          name: row.productName || "Unnamed product",
          revenue: amount(row.revenue ?? 0),
        }))
        .filter((row: ProductShare) => row.revenue > 0)
        .slice(0, 5);
      const expiringSoon = Array.isArray(expiryRes.data?.expiringSoon) ? expiryRes.data.expiringSoon : [];
      const activity = (Array.isArray(activityRes.data?.logs) ? activityRes.data.logs : []).map((log: {
        id: string;
        createdAt: string;
        action: string;
        entityType: string;
        description: string;
        userName: string | null;
      }) => ({
        id: log.id,
        time: new Date(log.createdAt).toLocaleString(),
        action: log.action,
        entityType: log.entityType,
        description: log.description,
        userName: log.userName,
      }));

      const insights: InsightItem[] = [];
      const topLowStock = lowStock[0] as { product_name?: string; on_hand?: number; reorder_threshold?: number } | undefined;
      if (topLowStock) {
        insights.push({
          title: "Restock Suggestion",
          detail: `${topLowStock.product_name} is at ${topLowStock.on_hand} units (reorder ${topLowStock.reorder_threshold}).`,
          href: "/stock",
        });
      }
      if (expiringSoon[0]?.productName) {
        insights.push({
          title: "Expiry Alert",
          detail: `${expiringSoon.length} batch${expiringSoon.length === 1 ? "" : "es"} expire within 14 days, including ${expiringSoon[0].productName}.`,
          href: "/expiry",
        });
      }
      if (lowStockCount > 0) {
        insights.push({
          title: "Low Stock Watch",
          detail: `${lowStockCount} product${lowStockCount === 1 ? "" : "s"} are at or below reorder level.`,
          href: "/ai/alerts",
        });
      }

      setData({
        points: buildPoints(sales.rows, range),
        totalRevenue: amount(sales.totals.totalAmount),
        totalOrders: amount(sales.totals.totalSales),
        previousRevenue: amount(priorSales.data?.totals?.totalAmount ?? 0),
        previousOrders: amount(priorSales.data?.totals?.totalSales ?? 0),
        productCount: productsCount,
        lowStockCount,
        topProducts,
        insights,
        activity,
        updatedAt: new Date(),
      });

      void loadAiInsights();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard data");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [loadAiInsights, range]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const salesChange = useMemo(
    () => percentChange(data.totalRevenue, data.previousRevenue),
    [data.previousRevenue, data.totalRevenue],
  );
  const ordersChange = useMemo(
    () => percentChange(data.totalOrders, data.previousOrders),
    [data.previousOrders, data.totalOrders],
  );
  const topTotal = useMemo(
    () => data.topProducts.reduce((sum, item) => sum + item.revenue, 0),
    [data.topProducts],
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-heading text-3xl font-semibold tracking-tight">Dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">Retail operations overview</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
          <Link href="/ai/alerts">
            <Button variant="ai">
              <Sparkles className="size-4" />
              AI Insights
            </Button>
          </Link>
        </div>
      </div>

      {error && <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Sales" value={formatMoney(data.totalRevenue)} hint="Selected period" change={salesChange} icon={ShoppingBag} />
        <KpiCard title="Total Orders" value={data.totalOrders.toLocaleString()} hint="Completed sales" change={ordersChange} icon={ShoppingCart} tone="cyan" />
        <KpiCard title="Total Products" value={data.productCount.toLocaleString()} hint="Active catalog" icon={Package} />
        <KpiCard title="Low Stock" value={data.lowStockCount.toLocaleString()} hint="At or below reorder" icon={AlertTriangle} tone="warning" />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Sales Analytics</CardTitle>
            <div className="flex rounded-md border border-border bg-muted/60 p-1">
              {RANGE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={range === option.value ? "default" : "ghost"}
                  onClick={() => setRange(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] w-full min-w-0">
              {loading && data.points.length === 0 ? (
                <div className="h-full animate-pulse rounded-lg bg-muted" />
              ) : (
                <ChartContainer config={revenueConfig} className="h-full w-full">
                  <AreaChart data={data.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0D9488" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#06B6D4" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={18}
                      interval={range === "30d" ? 4 : range === "1d" ? 2 : 0}
                      tickFormatter={(value) => formatPointLabel(String(value), range)}
                    />
                      <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={54}
                      tickFormatter={(value) => {
                        const amount = Number(value);
                        if (!Number.isFinite(amount) || amount === 0) return "0";
                        if (Math.abs(amount) >= 1000) return `${Math.round(amount / 1000)}k`;
                        return String(Math.round(amount));
                      }}
                    />
                    <RechartsTooltip content={<ChartTooltipContent indicator="line" />} />
                    <Area type="monotone" dataKey="revenue" stroke="#0D9488" strokeWidth={2.5} fill="url(#salesFill)" />
                  </AreaChart>
                </ChartContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Top Products</CardTitle>
          </CardHeader>
          <CardContent>
            {data.topProducts.length === 0 ? (
              <p className="py-10 text-sm text-muted-foreground">No product sales in this period.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
                <div className="mx-auto h-[180px] w-[180px]">
                  <ChartContainer config={topProductsConfig} className="h-full w-full">
                    <PieChart>
                      <Pie data={data.topProducts} dataKey="revenue" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="transparent">
                        {data.topProducts.map((entry, index) => (
                          <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<ChartTooltipContent />} />
                    </PieChart>
                  </ChartContainer>
                </div>
                <ul className="space-y-2">
                  {data.topProducts.map((item, index) => (
                    <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {topTotal > 0 ? `${Math.round((item.revenue / topTotal) * 100)}%` : "0%"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-7 items-center justify-center rounded-md bg-gradient-primary text-white">
                <Sparkles className="size-3.5" />
              </span>
              AI Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">No operational alerts for the current branch.</p>
            ) : (
              data.insights.map((insight) => (
                <Link key={insight.title} href={insight.href} className="block rounded-lg border border-border border-l-4 border-l-primary bg-accent/40 p-3 transition-colors hover:border-primary/40 hover:bg-muted/60">
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{insight.detail}</p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {data.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent audit activity.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.activity.map((row) => {
                    const status = activityStatus(row.action);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>{row.time}</TableCell>
                        <TableCell className="capitalize">{row.entityType.replace(/_/g, " ")}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{row.description || row.entityType}</TableCell>
                        <TableCell>{row.userName || "System"}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{data.updatedAt ? `Updated ${data.updatedAt.toLocaleString()}` : "Waiting for dashboard data"}</span>
        <Link href="/reports/sales" className="inline-flex items-center gap-1 text-primary hover:underline">
          Open full sales report <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
