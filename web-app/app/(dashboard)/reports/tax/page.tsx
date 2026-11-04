"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface TaxRow {
  taxRate: string;
  lines: string;
  revenue: string;
  taxable: string;
  tax: string;
}

export default function TaxReportPage() {
  const [rows, setRows] = useState<TaxRow[]>([]);
  const [totals, setTotals] = useState({ revenue: "0", taxable: "0", tax: "0" });
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
      const res = await fetch(`/api/admin/reports/tax?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.byRate);
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
    const csv = ["rate_pct,lines,revenue,taxable,tax",
      ...rows.map((r) => [r.taxRate, r.lines, r.revenue, r.taxable, r.tax].join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tax-report.csv";
    a.click();
  }

  async function exportEInvoice(format: "json" | "csv") {
    const params = new URLSearchParams({ detail: "true" });
    if (start) params.set("startDate", new Date(start).toISOString());
    if (end) params.set("endDate", new Date(end).toISOString());
    const res = await fetch(`/api/admin/reports/tax?${params}`);
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Export failed");
      return;
    }
    const payload = {
      format: "smartretail-einvoice-v1 (provisional — verify with accountant before filing)",
      branch: data.totals,
      invoices: data.invoices,
    };
    const body =
      format === "json"
        ? JSON.stringify(payload, null, 2)
        : [
            "sale_number,date,payment_method,subtotal,discount,taxable,tax,grand_total",
            ...data.invoices.map((s: Record<string, string | null>) =>
              [
                s.saleNumber,
                s.saleDate,
                s.paymentMethod,
                s.subtotal,
                s.discountAmount,
                s.taxable,
                s.tax,
                s.grandTotal,
              ].join(","),
            ),
          ].join("\n");
    const blob = new Blob([body], {
      type: format === "json" ? "application/json" : "text/csv",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `e-invoices.${format}`;
    a.click();
  }

  return (
    <PageShell
      title="Tax report"
      subtitle={`Revenue ${totals.revenue} · taxable ${totals.taxable} · tax ${totals.tax}`}
      allow={["admin"]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Collected tax by rate charged</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="max-w-48" aria-label="Start date" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="max-w-48" aria-label="End date" />
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
            <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
            <Button variant="outline" onClick={() => void exportEInvoice("json")}>E-invoice JSON</Button>
            <Button variant="outline" onClick={() => void exportEInvoice("csv")}>E-invoice CSV</Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate %</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Taxable</TableHead>
                  <TableHead>Tax</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.taxRate}>
                    <TableCell>{r.taxRate}</TableCell>
                    <TableCell>{r.lines}</TableCell>
                    <TableCell>{r.revenue}</TableCell>
                    <TableCell>{r.taxable}</TableCell>
                    <TableCell className="font-medium">{r.tax}</TableCell>
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
