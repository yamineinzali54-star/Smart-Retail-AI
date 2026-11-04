"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SaleRow {
  id: string;
  saleNumber: string;
  saleDate: string;
  grandTotal: string;
  paymentMethod: string;
  cashierName: string | null;
  counterName: string | null;
}

export default function SalesReportPage() {
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [totals, setTotals] = useState({ totalSales: "0", totalAmount: "0", totalItems: "0" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (start) params.set("startDate", new Date(start).toISOString());
      if (end) params.set("endDate", new Date(end).toISOString());
      const res = await fetch(`/api/admin/reports/sales?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.sales);
      setTotals(data.totals);
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

  function exportCsv() {
    const csv = ["sale_number,date,cashier,counter,payment,total",
      ...rows.map((r) => [r.saleNumber, r.saleDate, r.cashierName ?? "", r.counterName ?? "", r.paymentMethod, r.grandTotal].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sales-report.csv";
    a.click();
  }

  return (
    <PageShell title="Sales report" subtitle={`${totals.totalSales} sales · ${totals.totalAmount} · ${totals.totalItems} items`} allow={["admin"]}>
      <Card>
        <CardHeader>
          <CardTitle>Completed sales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="max-w-48" aria-label="Start date" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="max-w-48" aria-label="End date" />
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
            <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sale</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Counter</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.saleNumber}</TableCell>
                    <TableCell>{new Date(r.saleDate).toLocaleString()}</TableCell>
                    <TableCell>{r.cashierName ?? "—"}</TableCell>
                    <TableCell>{r.counterName ?? "—"}</TableCell>
                    <TableCell>{r.paymentMethod}</TableCell>
                    <TableCell>{r.grandTotal}</TableCell>
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
