"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Radar,
  RadarChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface InventoryCategoryPoint {
  categoryName: string;
  quantity: number;
  stockValue: number;
}

export interface InventoryExpiryPoint {
  label: string;
  batches: number;
  quantity: number;
}

export interface InventoryHealthPoint {
  metric: string;
  count: number;
}

export interface InventoryProductPoint {
  productName: string;
  quantity: number;
  stockValue: number;
}

interface InventoryDashboardVisualsProps {
  categoryData: InventoryCategoryPoint[];
  expiryData: InventoryExpiryPoint[];
  healthData: InventoryHealthPoint[];
  topProducts: InventoryProductPoint[];
}

const categoryConfig = {
  stockValue: { label: "Stock value", color: "var(--chart-1)" },
} satisfies ChartConfig;

const expiryConfig = {
  quantity: { label: "Units", color: "var(--chart-2)" },
  batches: { label: "Batches", color: "var(--chart-3)" },
} satisfies ChartConfig;

const healthConfig = {
  count: { label: "Batches", color: "var(--chart-4)" },
} satisfies ChartConfig;

const productConfig = {
  quantity: { label: "Units", color: "var(--chart-5)" },
} satisfies ChartConfig;

function formatMoney(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} MMK`;
}

function StockValueByCategory({ data }: { data: InventoryCategoryPoint[] }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Stock value by category</CardTitle>
        <CardDescription>Current inventory value at selling price</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={categoryConfig} className="h-full w-full">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
              />
              <YAxis
                dataKey="categoryName"
                type="category"
                width={104}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <RechartsTooltip
                content={<ChartTooltipContent formatter={(value) => formatMoney(Number(value))} />}
              />
              <Bar dataKey="stockValue" fill="var(--color-stockValue)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function ExpiryExposureChart({ data }: { data: InventoryExpiryPoint[] }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Expiry exposure</CardTitle>
        <CardDescription>Units and batches grouped by expiry risk</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={expiryConfig} className="h-full w-full">
            <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={34} />
              <RechartsTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Bar dataKey="quantity" fill="var(--color-quantity)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="batches" fill="var(--color-batches)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function StockHealthRadar({ data }: { data: InventoryHealthPoint[] }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Stock health profile</CardTitle>
        <CardDescription>Batch-level monitoring signals for this branch</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={healthConfig} className="h-full w-full">
            <RadarChart data={data} outerRadius="70%">
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <PolarRadiusAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
              <RechartsTooltip content={<ChartTooltipContent />} />
              <Radar dataKey="count" fill="var(--color-count)" fillOpacity={0.3} stroke="var(--color-count)" strokeWidth={2} />
            </RadarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function TopStockChart({ data }: { data: InventoryProductPoint[] }) {
  return (
    <Card className="min-w-0 lg:col-span-2">
      <CardHeader>
        <CardTitle>Top stock holdings</CardTitle>
        <CardDescription>Products with the highest units currently on hand</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full min-w-0">
          <ChartContainer config={productConfig} className="h-full w-full">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
              <YAxis
                dataKey="productName"
                type="category"
                width={128}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              />
              <RechartsTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Bar dataKey="quantity" fill="var(--color-quantity)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function InventoryDashboardVisuals({
  categoryData,
  expiryData,
  healthData,
  topProducts,
}: InventoryDashboardVisualsProps) {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-4">
      <StockValueByCategory data={categoryData} />
      <ExpiryExposureChart data={expiryData} />
      <StockHealthRadar data={healthData} />
      <TopStockChart data={topProducts} />
    </div>
  );
}
