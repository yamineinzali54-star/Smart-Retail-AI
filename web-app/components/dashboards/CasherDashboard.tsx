"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  RiDashboardLine,
  RiShoppingCartLine,
  RiMoneyDollarCircleLine,
  RiShieldLine,
  RiArrowRightLine,
  RiArrowUpLine,
  RiArrowDownLine,
  RiShoppingBagLine,
  RiFileTextLine,
  RiAddLine,
  RiCheckLine,
  RiCoinLine,
  RiBankCardLine,
  RiSmartphoneLine,
} from "@remixicon/react";
import {
  ChartContainer,
} from "@/components/ui/chart";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const todaySalesData = [
  { time: "08:30", items: 3, total: 12500, payment: "Cash" },
  { time: "09:15", items: 5, total: 28900, payment: "Card" },
  { time: "10:00", items: 2, total: 8500, payment: "Mobile" },
  { time: "10:45", items: 4, total: 19800, payment: "Cash" },
  { time: "11:30", items: 6, total: 35200, payment: "Credit" },
  { time: "12:15", items: 3, total: 15600, payment: "Card" },
  { time: "13:00", items: 7, total: 42100, payment: "Mobile" },
  { time: "14:30", items: 4, total: 22400, payment: "Cash" },
];

const recentTransactions = [
  { id: "SALE-YGN-20261005-0042", time: "14:32", items: 4, total: 22400, payment: "Cash", status: "completed" },
  { id: "SALE-YGN-20261005-0041", time: "13:58", items: 7, total: 42100, payment: "Mobile", status: "completed" },
  { id: "SALE-YGN-20261005-0040", time: "13:02", items: 3, total: 15600, payment: "Card", status: "completed" },
  { id: "SALE-YGN-20261005-0039", time: "12:17", items: 6, total: 35200, payment: "Credit", status: "completed" },
  { id: "SALE-YGN-20261005-0038", time: "11:35", items: 4, total: 19800, payment: "Cash", status: "completed" },
];

const paymentMethodData = [
  { name: "Cash", value: 85000, color: "hsl(var(--chart-1))" },
  { name: "Card", value: 125000, color: "hsl(var(--chart-2))" },
  { name: "Mobile", value: 89000, color: "hsl(var(--chart-3))" },
  { name: "Credit", value: 45000, color: "hsl(var(--chart-4))" },
];

const kpiCards = [
  {
    title: "Today's Sales",
    value: "384,300 MMK",
    change: "+12.5% vs yesterday",
    trend: "up",
    icon: RiMoneyDollarCircleLine,
    description: "14 transactions",
  },
  {
    title: "Total Transactions",
    value: "14",
    change: "+2 vs yesterday",
    trend: "up",
    icon: RiShoppingBagLine,
    description: "avg 27,450 MMK",
  },
  {
    title: "Items Sold",
    value: "42",
    change: "+8 vs yesterday",
    trend: "up",
    icon: RiShoppingCartLine,
    description: "avg 3 items/txn",
  },
  {
    title: "Avg Transaction",
    value: "27,450 MMK",
    change: "+5.2% vs yesterday",
    trend: "up",
    icon: RiCoinLine,
    description: "above average",
  },
] as const;

function KPICard({
  title,
  value,
  change,
  trend,
  icon: Icon,
  description,
}: {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
  icon: React.ElementType;
  description: string;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="flex items-center gap-2 text-xs mt-1">
          <span
            className={cn(
              "font-medium",
              trend === "up" && "text-primary",
              trend === "down" && "text-destructive",
              trend === "neutral" && "text-muted-foreground"
            )}
          >
            {trend === "up" && <RiArrowUpLine className="h-3 w-3" />}
            {trend === "down" && <RiArrowDownLine className="h-3 w-3" />}
            {trend === "neutral" && <span>—</span>}
            {change}
          </span>
          <span className="text-muted-foreground">{description}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentMethodChart() {
  const total = paymentMethodData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card className="col-span-1 md:col-span-2 lg:col-span-3">
      <CardHeader>
        <CardTitle>Payment Methods (Today)</CardTitle>
        <CardDescription>Breakdown by payment type</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-6 h-[300px]">
          <div className="flex-1">
            <ChartContainer config={{}} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentMethodData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent = 0 }) => name + " " + (percent * 100).toFixed(1) + "%"}
                    labelLine={false}
                  >
                    {paymentMethodData.map((entry, index) => (
                      <Cell key={"cell-" + index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={() => total.toLocaleString() + " MMK"}
                    content={<div className="p-2 bg-background border rounded">Total: {total.toLocaleString()} MMK</div>}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
          <div className="flex flex-col justify-center gap-2 md:w-64">
            {paymentMethodData.map((method) => (
              <div key={method.name} className="flex items-center gap-2 p-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: method.color }}
                />
                <span className="text-sm font-medium">{method.name}</span>
                <span className="text-sm font-medium ml-auto">
                  {((method.value / total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionInfo({ session }: { session: { id: string; counter: string; openedAt: string; openingCash: number; expectedCash: number } | null }) {
  if (!session) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <RiDashboardLine className="h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium">No Active Session</h3>
          <p className="text-muted-foreground mt-1">Select a counter to start your session</p>
          <Link href="/pos/select-counter" className="mt-4">
            <Button size="lg"><RiAddLine className="h-4 w-4 mr-2" /> Open Session</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Active Session</CardTitle>
        <Badge variant="outline" className="text-primary border-primary">
          <RiCheckLine className="h-3 w-3 mr-1" /> Active
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">Counter</p>
            <p className="font-bold text-lg">{session.counter}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">Opened</p>
            <p className="font-bold">{new Date(session.openedAt).toLocaleTimeString()}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">Opening Cash</p>
            <p className="font-bold">{session.openingCash.toLocaleString()} MMK</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">Expected Cash</p>
            <p className="font-bold">{session.expectedCash.toLocaleString()} MMK</p>
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <Link href="/pos/terminal" className="w-full">
            <Button size="lg" className="w-full justify-start gap-2">
              <RiShoppingCartLine className="h-4 w-4" />
              <span>Go to POS Terminal</span>
            </Button>
          </Link>
          <Link href="/pos/end-session" className="w-full">
            <Button size="lg" variant="outline" className="w-full justify-start gap-2">
              <RiCoinLine className="h-4 w-4" />
              <span>End Session (Cash Reconciliation)</span>
            </Button>
          </Link>
          <Link href="/pos/today-sales" className="w-full">
            <Button size="lg" variant="ghost" className="w-full justify-start gap-2">
              <RiFileTextLine className="h-4 w-4" />
              <span>View Today&apos;s Sales</span>
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function TodaySalesSummary({ className }: { className?: string }) {
  const totals = todaySalesData.reduce(
    (acc, sale) => ({
      total: acc.total + sale.total,
      cash: acc.cash + (sale.payment === "Cash" ? sale.total : 0),
      card: acc.card + (sale.payment === "Card" ? sale.total : 0),
      mobile: acc.mobile + (sale.payment === "Mobile" ? sale.total : 0),
      credit: acc.credit + (sale.payment === "Credit" ? sale.total : 0),
    }),
    { total: 0, cash: 0, card: 0, mobile: 0, credit: 0 }
  );

  return (
    <Card className={cn("col-span-1 md:col-span-2 lg:col-span-3", className)}>
      <CardHeader>
        <CardTitle>Today&apos;s Sales</CardTitle>
        <CardDescription>{todaySalesData.length} transactions • {totals.total.toLocaleString()} MMK total</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
            <p className="text-xs text-muted-foreground">Cash</p>
            <p className="font-bold">{totals.cash.toLocaleString()} MMK</p>
          </div>
          <div className="rounded-lg border border-border bg-muted p-3">
            <p className="text-xs text-muted-foreground">Card</p>
            <p className="font-bold">{totals.card.toLocaleString()} MMK</p>
          </div>
          <div className="rounded-lg border border-border bg-muted p-3">
            <p className="text-xs text-muted-foreground">Mobile</p>
            <p className="font-bold">{totals.mobile.toLocaleString()} MMK</p>
          </div>
          <div className="rounded-lg border border-border bg-muted p-3">
            <p className="text-xs text-muted-foreground">Credit</p>
            <p className="font-bold">{totals.credit.toLocaleString()} MMK</p>
          </div>
        </div>
        <PaymentMethodChart />
      </CardContent>
    </Card>
  );
}

function RecentTransactions() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Transactions</CardTitle>
        <Link href="/pos/today-sales" className="text-sm text-primary hover:underline">
          View All <RiArrowRightLine className="h-3 w-3 inline" />
        </Link>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sale #</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentTransactions.map((txn, index) => (
              <TableRow key={index}>
                <TableCell className="font-mono text-xs">{txn.id}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{txn.time}</TableCell>
                <TableCell className="text-right">{txn.items}</TableCell>
                <TableCell className="text-right font-medium">{txn.total.toLocaleString()} MMK</TableCell>
                <TableCell>
                  <Badge variant={getPaymentBadgeVariant(txn.payment)}>
                    {getPaymentIcon(txn.payment)}
                    {txn.payment}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="text-primary border-primary">
                    <RiCheckLine className="h-3 w-3 mr-1" />
                    {txn.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function getPaymentBadgeVariant(payment: string) {
  switch (payment) {
    case "Cash": return "default";
    case "Card": return "secondary";
    case "Mobile": return "outline";
    case "Credit": return "destructive";
    default: return "outline";
  }
}

function getPaymentIcon(payment: string) {
  switch (payment) {
    case "Cash": return <RiCoinLine className="h-2 w-2 mr-1" />;
    case "Card": return <RiBankCardLine className="h-2 w-2 mr-1" />;
    case "Mobile": return <RiSmartphoneLine className="h-2 w-2 mr-1" />;
    case "Credit": return <RiFileTextLine className="h-2 w-2 mr-1" />;
    default: return null;
  }
}

function QuickActions() {
  const actions = [
    { title: "Open Session", href: "/pos/select-counter", icon: RiAddLine, desc: "Start new POS session" },
    { title: "POS Terminal", href: "/pos/terminal", icon: RiShoppingCartLine, desc: "Process sales" },
    { title: "Today's Sales", href: "/pos/today-sales", icon: RiFileTextLine, desc: "View today's transactions" },
    { title: "Sale Returns", href: "/pos/sale-returns/new", icon: RiShieldLine, desc: "Process returns" },
    { title: "End Session", href: "/pos/end-session", icon: RiCoinLine, desc: "Cash reconciliation" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {actions.map((action) => (
            <Link
              key={action.title}
              href={action.href}
              className="flex flex-col items-center gap-2 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
            >
              <action.icon className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium text-center">{action.title}</span>
              <span className="text-xs text-muted-foreground text-center">{action.desc}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function CasherDashboard({ session }: { session: { id: string; counter: string; openedAt: string; openingCash: number; expectedCash: number } | null }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Session Card */}
      <SessionInfo session={session} />

      {/* KPI Cards (only show if session active) */}
      {session && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpiCards.map((kpi, index) => (
              <KPICard key={index} {...kpi} />
            ))}
          </div>

          {/* Today's Sales & Payment Methods */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <TodaySalesSummary className="lg:col-span-3" />
          </div>

          {/* Quick Actions & Recent Transactions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <QuickActions />
            <RecentTransactions />
          </div>
        </>
      )}
    </div>
  );
}
