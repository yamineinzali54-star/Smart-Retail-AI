"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Performance {
  cashierId: string;
  cashierName: string;
  totalSales: string;
  saleCount: number;
  voidCount: number;
  totalDiscount: string;
  totalTax: string;
  returnCount: number;
  returnTotal: string;
  discrepancyTotal: string;
  discrepancyCount: number;
}

export default function CashierPerformancePage() {
  const [rows, setRows] = useState<Performance[]>([]);
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
      const res = await fetch(`/api/admin/reports/cashier-performance?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.performance);
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
    <PageShell title="Cashier Performance" subtitle="Per-cashier sales, voids, discounts, returns, discrepancies" allow={["admin"]}>
      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
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
                  "cashier-performance",
                  ["cashier", "sales", "sale_count", "voids", "discounts", "tax", "returns", "return_total", "discrepancy_total", "discrepancy_count"],
                  rows.map((r) => [r.cashierName, r.totalSales, r.saleCount, r.voidCount, r.totalDiscount, r.totalTax, r.returnCount, r.returnTotal, r.discrepancyTotal, r.discrepancyCount]),
                )
              }
            >
              Export CSV
            </Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Sales</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Voids</TableHead>
                  <TableHead>Discounts</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Returns</TableHead>
                  <TableHead>Discrepancy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.cashierId}>
                    <TableCell>{r.cashierName}</TableCell>
                    <TableCell>{r.totalSales}</TableCell>
                    <TableCell>{r.saleCount}</TableCell>
                    <TableCell>{r.voidCount}</TableCell>
                    <TableCell>{r.totalDiscount}</TableCell>
                    <TableCell>{r.totalTax}</TableCell>
                    <TableCell>{r.returnCount} ({r.returnTotal})</TableCell>
                    <TableCell className={Number(r.discrepancyTotal) > 0 ? "text-red-600" : ""}>
                      {r.discrepancyTotal} ({r.discrepancyCount})
                    </TableCell>
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
