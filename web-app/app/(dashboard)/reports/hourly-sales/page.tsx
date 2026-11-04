"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface HourlyRow {
  hour: number;
  hourLabel: string;
  saleCount: number;
  totalAmount: string;
  avgAmount: string;
}

export default function HourlySalesPage() {
  const [rows, setRows] = useState<HourlyRow[]>([]);
  const [peak, setPeak] = useState<HourlyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (start) params.set("startDate", new Date(start).toISOString());
      if (end) params.set("endDate", new Date(end).toISOString());
      const res = await fetch(`/api/admin/reports/hourly-sales?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.hourly);
      setPeak(data.peak);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell title="Hourly Sales" subtitle="Sales distribution by hour — use for shift planning" allow={["admin"]}>
      <Card>
        <CardHeader>
          <CardTitle>Hourly Distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="max-w-48" aria-label="Start date" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="max-w-48" aria-label="End date" />
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "hourly-sales",
                  ["hour", "sale_count", "total_amount", "avg_amount"],
                  rows.map((r) => [r.hourLabel, r.saleCount, r.totalAmount, r.avgAmount]),
                )
              }
            >
              Export CSV
            </Button>
          </div>
          {peak && (
            <p className="text-sm text-muted-foreground">
              Peak hour: <span className="font-medium">{peak.hourLabel}</span> ({peak.saleCount} sales, {peak.totalAmount})
            </p>
          )}
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && rows.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="hourLabel" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  formatter={(value, name) => [
                    name === "saleCount" ? value : `K ${Number(value).toLocaleString()}`,
                    name === "saleCount" ? "Sales" : "Total",
                  ]}
                />
                <Bar dataKey="saleCount" radius={[4, 4, 0, 0]}>
                  {rows.map((r) => (
                    <Cell
                      key={r.hour}
                      fill={peak && r.hour === peak.hour ? "var(--color-chart-1)" : "var(--color-chart-2)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hour</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.hour}>
                    <TableCell>{r.hourLabel}</TableCell>
                    <TableCell>{r.saleCount}</TableCell>
                    <TableCell>{r.totalAmount}</TableCell>
                    <TableCell>{r.avgAmount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
