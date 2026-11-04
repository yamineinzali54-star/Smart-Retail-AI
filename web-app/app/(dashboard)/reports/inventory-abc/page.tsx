"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AbcRow {
  productId: string;
  productName: string;
  totalStock: string;
  unitsSold: string;
  revenue: string;
  revenuePct: string;
  cumulativePct: string;
  classification: "A" | "B" | "C";
}

interface DeadStockRow {
  productId: string;
  productName: string;
  totalStock: string;
}

export default function InventoryAbcPage() {
  const [abc, setAbc] = useState<AbcRow[]>([]);
  const [deadStock, setDeadStock] = useState<DeadStockRow[]>([]);
  const [summary, setSummary] = useState({ deadCount: 0, aCount: 0, bCount: 0, cCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deadDays, setDeadDays] = useState("30");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ deadDays });
      const res = await fetch(`/api/admin/reports/inventory-abc?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setAbc(data.abc);
      setDeadStock(data.deadStock);
      setSummary(data.summary);
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
    <PageShell title="Dead Stock & ABC Analysis" subtitle="Slow movers + revenue classification" allow={["admin"]}>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 text-sm">
              <span>Dead stock: <span className="font-bold text-red-600">{summary.deadCount}</span></span>
              <span>A (top 70%): <span className="font-bold">{summary.aCount}</span></span>
              <span>B (next 20%): <span className="font-bold">{summary.bCount}</span></span>
              <span>C (bottom 10%): <span className="font-bold">{summary.cCount}</span></span>
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={deadDays}
                onChange={(e) => setDeadDays(e.target.value)}
                className="max-w-32"
                inputMode="numeric"
                aria-label="Dead stock days"
              />
              <Button variant="outline" onClick={() => void load()}>Apply</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dead Stock (no sales in {deadDays} days)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && deadStock.length === 0 && (
              <p className="text-sm text-muted-foreground">No dead stock found.</p>
            )}
            {!loading && deadStock.length > 0 && (
              <>
                <ResponsiveContainer width="100%" height={Math.max(160, Math.min(320, deadStock.length * 28))}>
                  <BarChart
                    data={deadStock.slice(0, 15).map((d) => ({
                      name: d.productName.length > 20 ? d.productName.slice(0, 18) + "…" : d.productName,
                      stock: Number(d.totalStock),
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={140} />
                    <Tooltip formatter={(v) => [Number(v).toLocaleString(), "Stock"]} />
                    <Bar dataKey="stock" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {deadStock.length > 15 && (
                  <p className="mt-1 text-xs text-muted-foreground">Top 15 by stock — table below shows all.</p>
                )}
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deadStock.map((d) => (
                      <TableRow key={d.productId}>
                        <TableCell>{d.productName}</TableCell>
                        <TableCell>{d.totalStock}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>ABC Classification</CardTitle>
              <Button
                variant="outline"
                onClick={() =>
                  downloadCsv(
                    "inventory-abc",
                    ["product", "stock", "units_sold", "revenue", "revenue_pct", "cumulative_pct", "class"],
                    abc.map((r) => [r.productName, r.totalStock, r.unitsSold, r.revenue, r.revenuePct, r.cumulativePct, r.classification]),
                  )
                }
              >
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!loading && abc.length > 0 && (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart
                  data={abc.slice(0, 30).map((r) => ({
                    name: r.productName.length > 12 ? r.productName.slice(0, 10) + "…" : r.productName,
                    revPct: Number(r.revenuePct),
                    cumPct: Number(r.cumulativePct),
                    class: r.classification,
                  }))}
                  margin={{ top: 8, right: 12, left: 8, bottom: 40 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} angle={-40} textAnchor="end" height={60} />
                  <YAxis tickLine={false} axisLine={false} width={40} unit="%" />
                  <Tooltip
                    formatter={(value, name) => [
                      `${Number(value).toFixed(1)}%`,
                      name === "revPct" ? "Revenue %" : "Cumulative %",
                    ]}
                  />
                  <ReferenceLine y={70} stroke="var(--color-chart-1)" strokeDasharray="4 4" />
                  <ReferenceLine y={90} stroke="var(--color-chart-3)" strokeDasharray="4 4" />
                  <Bar dataKey="revPct" radius={[3, 3, 0, 0]}>
                    {abc.slice(0, 30).map((r) => (
                      <Cell
                        key={r.productId}
                        fill={
                          r.classification === "A"
                            ? "var(--color-chart-1)"
                            : r.classification === "B"
                              ? "var(--color-chart-2)"
                              : "var(--color-chart-3)"
                        }
                      />
                    ))}
                  </Bar>
                  <Line dataKey="cumPct" stroke="var(--foreground)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Sold</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Rev %</TableHead>
                    <TableHead>Cum %</TableHead>
                    <TableHead>Class</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {abc.map((r) => (
                    <TableRow key={r.productId}>
                      <TableCell>{r.productName}</TableCell>
                      <TableCell>{r.totalStock}</TableCell>
                      <TableCell>{r.unitsSold}</TableCell>
                      <TableCell>{r.revenue}</TableCell>
                      <TableCell>{r.revenuePct}%</TableCell>
                      <TableCell>{r.cumulativePct}%</TableCell>
                      <TableCell>
                        <Badge variant={r.classification === "A" ? "default" : r.classification === "B" ? "secondary" : "destructive"}>
                          {r.classification}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
