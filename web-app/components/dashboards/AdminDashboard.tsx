"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  RiArrowRightLine,
  RiBarChartLine,
  RiFileChartLine,
  RiMoneyDollarCircleLine,
  RiRefreshLine,
  RiShoppingBagLine,
  RiShoppingCartLine,
  RiStoreLine,
  RiTeamLine,
  RiTimeLine,
  RiTruckLine,
} from "@remixicon/react";

import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type RangeKey = "1d" | "7d" | "30d" | "1y";

interface SaleRow {
  saleDate: string;
  grandTotal: string;
}

interface ChartPoint {
  label: string;
  revenue: number;
  orders: number;
}

interface InventoryPoint {
  categoryName: string;
  potentialRevenue: number;
  profit: number;
}

interface CashierPoint {
  cashierName: string;
  totalSales: number;
  saleCount: number;
  voidCount: number;
}

interface DashboardData {
  points: ChartPoint[];
  inventory: InventoryPoint[];
  cashiers: CashierPoint[];
  totalRevenue: number;
  totalOrders: number;
  updatedAt: Date | null;
}

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string; description: string }> = [
  { value: "1d", label: "1 day", description: "24 hourly buckets" },
  { value: "7d", label: "7 days", description: "Daily totals" },
  { value: "30d", label: "30 days", description: "Daily totals" },
  { value: "1y", label: "1 year", description: "Monthly totals" },
];

const revenueConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

const ordersConfig = {
  orders: { label: "Orders", color: "var(--chart-2)" },
} satisfies ChartConfig;

const inventoryConfig = {
  potentialRevenue: { label: "Potential revenue", color: "var(--chart-4)" },
  profit: { label: "Profit", color: "var(--chart-5)" },
} satisfies ChartConfig;

const cashierConfig = {
  totalSales: { label: "Sales", color: "var(--chart-1)" },
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
  if (range === "1y") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 11);
  }

  return { start, end };
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  if (range === "1y") {
    const date = new Date(`${value}-01T00:00:00`);
    return date.toLocaleDateString(undefined, { month: "short" });
  }
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function buildPoints(rows: SaleRow[], range: RangeKey): ChartPoint[] {
  const { start } = getWindow(range);
  const buckets = new Map<string, ChartPoint>();

  if (range === "1d") {
    for (let hour = 0; hour < 24; hour += 1) {
      buckets.set(String(hour), { label: `${String(hour).padStart(2, "0")}:00`, revenue: 0, orders: 0 });
    }
  } else if (range === "1y") {
    const cursor = new Date(start);
    for (let index = 0; index < 12; index += 1) {
      const key = monthKey(cursor);
      buckets.set(key, { label: key, revenue: 0, orders: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
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
    const key = range === "1d"
      ? String(saleDate.getHours())
      : range === "1y"
        ? monthKey(saleDate)
        : dateKey(saleDate);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.orders += 1;
    bucket.revenue += amount(row.grandTotal);
  }

  return Array.from(buckets.values());
}

async function fetchAllSales(start: Date, end: Date) {
  const rows: SaleRow[] = [];
  let page = 1;

  while (page <= 1000) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "100",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    const response = await fetch(`/api/admin/reports/sales?${params.toString()}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Unable to load dashboard sales");

    const batch = data.sales as SaleRow[];
    rows.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return rows;
}

function emptyDashboardData(): DashboardData {
  return {
    points: [],
    inventory: [],
    cashiers: [],
    totalRevenue: 0,
    totalOrders: 0,
    updatedAt: null,
  };
}

function KpiCard({ title, value, description, icon: Icon }: {
  title: string;
  value: string;
  description: string;
  icon: ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function SalesLineChart({ data, range }: { data: ChartPoint[]; range: RangeKey }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Revenue trend</CardTitle>
        <CardDescription>{RANGE_OPTIONS.find((item) => item.value === range)?.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={revenueConfig} className="h-full w-full">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                minTickGap={18}
                interval={range === "30d" ? 4 : range === "1d" ? 2 : 0}
                tickFormatter={(value) => formatPointLabel(String(value), range)}
              />
              <YAxis tickLine={false} axisLine={false} width={54} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <RechartsTooltip content={<ChartTooltipContent indicator="line" />} />
              <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function OrdersBarChart({ data, range }: { data: ChartPoint[]; range: RangeKey }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Order volume</CardTitle>
        <CardDescription>Completed orders by {range === "1d" ? "hour" : range === "1y" ? "month" : "day"}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={ordersConfig} className="h-full w-full">
            <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                minTickGap={18}
                interval={range === "30d" ? 4 : range === "1d" ? 2 : 0}
                tickFormatter={(value) => formatPointLabel(String(value), range)}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <RechartsTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Bar dataKey="orders" fill="var(--color-orders)" radius={[0, 0, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function InventoryValueChart({ data }: { data: InventoryPoint[] }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Inventory value by category</CardTitle>
        <CardDescription>Current potential revenue and estimated profit</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={inventoryConfig} className="h-full w-full">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <YAxis dataKey="categoryName" type="category" width={92} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <RechartsTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Bar dataKey="potentialRevenue" fill="var(--color-potentialRevenue)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="profit" fill="var(--color-profit)" radius={[0, 0, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function CashierPerformanceChart({ data }: { data: CashierPoint[] }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Cashier performance</CardTitle>
        <CardDescription>Sales by cashier · hover for order and void counts</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={cashierConfig} className="h-full w-full">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <YAxis
                dataKey="cashierName"
                type="category"
                width={100}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <RechartsTooltip
                content={({ active, payload }) => {
                  const cashier = payload?.[0]?.payload as CashierPoint | undefined;
                  if (!active || !cashier) return null;
                  return (
                    <div className="grid gap-1 border border-border bg-background px-3 py-2 text-xs shadow-md">
                      <span className="font-medium">{cashier.cashierName}</span>
                      <span>Sales: {formatMoney(cashier.totalSales)}</span>
                      <span>Orders: {cashier.saleCount.toLocaleString()}</span>
                      <span>Voids: {cashier.voidCount.toLocaleString()}</span>
                    </div>
                  );
                }}
              />
              <Bar dataKey="totalSales" fill="var(--color-totalSales)" radius={[0, 0, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickActions() {
  const actions = [
    { title: "Create Purchase Order", href: "/purchase-orders/new", icon: RiTruckLine },
    { title: "New GRN", href: "/grn/new", icon: RiShoppingCartLine },
    { title: "New Staff", href: "/staff/new", icon: RiTeamLine },
    { title: "View Reports", href: "/reports/sales", icon: RiFileChartLine },
    { title: "Manage Stock", href: "/stock", icon: RiStoreLine },
    { title: "Audit Logs", href: "/audit-logs", icon: RiBarChartLine },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {actions.map((action) => (
            <Link key={action.title} href={action.href} className="flex flex-col items-center gap-2 border p-4 text-center transition-colors hover:bg-muted">
              <action.icon className="size-5 text-muted-foreground" />
              <span className="text-xs font-medium">{action.title}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminDashboard() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [data, setData] = useState<DashboardData>(emptyDashboardData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    setError(null);

    try {
      const { start, end } = getWindow(range);
      const rows = await fetchAllSales(start, end);
      const periodParams = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      const [inventoryResponse, cashierResponse] = await Promise.all([
        fetch("/api/admin/reports/inventory-valuation", { cache: "no-store" }),
        fetch(`/api/admin/reports/cashier-performance?${periodParams.toString()}`, { cache: "no-store" }),
      ]);
      const [inventoryData, cashierData] = await Promise.all([
        inventoryResponse.json(),
        cashierResponse.json(),
      ]);
      if (!inventoryData.ok) throw new Error(inventoryData.error || "Unable to load inventory analytics");
      if (!cashierData.ok) throw new Error(cashierData.error || "Unable to load cashier analytics");

      const points = buildPoints(rows, range);
      const inventory = (inventoryData.valuation as Array<{
        categoryName: string | null;
        potentialRevenue: string;
        profit: string;
      }>)
        .map((row) => ({
          categoryName: row.categoryName ?? "Uncategorized",
          potentialRevenue: amount(row.potentialRevenue),
          profit: amount(row.profit),
        }))
        .sort((left, right) => right.potentialRevenue - left.potentialRevenue)
        .slice(0, 8);
      const cashiers = (cashierData.performance as Array<{
        cashierName: string;
        totalSales: string;
        saleCount: number;
        voidCount: number;
      }>)
        .map((row) => ({
          cashierName: row.cashierName || "Unknown",
          totalSales: amount(row.totalSales),
          saleCount: Number(row.saleCount),
          voidCount: Number(row.voidCount),
        }))
        .sort((left, right) => right.totalSales - left.totalSales);

      setData({
        points,
        inventory,
        cashiers,
        totalRevenue: rows.reduce((total, row) => total + amount(row.grandTotal), 0),
        totalOrders: rows.length,
        updatedAt: new Date(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load dashboard data");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(true), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const averageOrder = useMemo(
    () => (data.totalOrders > 0 ? data.totalRevenue / data.totalOrders : 0),
    [data.totalOrders, data.totalRevenue],
  );

  const selectedRange = RANGE_OPTIONS.find((item) => item.value === range);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Live overview</p>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Admin dashboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sales performance and operational activity</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-border p-1">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={range === option.value ? "default" : "ghost"}
                onClick={() => setRange(option.value)}
                title={option.description}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading} aria-label="Refresh dashboard">
            <RiRefreshLine className={loading ? "animate-spin" : undefined} />
          </Button>
          <Badge variant="secondary">Live · 1 min</Badge>
        </div>
      </div>

      {error && <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Revenue" value={formatMoney(data.totalRevenue)} description={selectedRange?.description ?? "Selected period"} icon={RiShoppingBagLine} />
        <KpiCard title="Completed orders" value={data.totalOrders.toLocaleString()} description="Completed sales" icon={RiBarChartLine} />
        <KpiCard title="Average order" value={formatMoney(averageOrder)} description="Revenue per completed order" icon={RiMoneyDollarCircleLine} />
        <KpiCard title="Last refresh" value={data.updatedAt ? data.updatedAt.toLocaleTimeString() : "—"} description="Automatic refresh every minute" icon={RiTimeLine} />
      </div>

      {loading && data.points.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {["revenue", "orders", "cashiers", "inventory"].map((key) => (
            <div key={key} className="h-[390px] animate-pulse border border-border bg-muted lg:col-span-2" />
          ))}
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-4">
          <SalesLineChart data={data.points} range={range} />
          <OrdersBarChart data={data.points} range={range} />
          <CashierPerformanceChart data={data.cashiers} />
          <InventoryValueChart data={data.inventory} />
        </div>
      )}

      <QuickActions />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{data.updatedAt ? `Updated ${data.updatedAt.toLocaleString()}` : "Waiting for dashboard data"}</span>
        <Link href="/reports/sales" className="inline-flex items-center gap-1 text-primary hover:underline">
          Open full sales report <RiArrowRightLine className="size-3" />
        </Link>
      </div>
    </div>
  );
}
