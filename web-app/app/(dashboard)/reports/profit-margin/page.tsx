"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface MarginRow {
  productId: string;
  productName: string | null;
  categoryName: string | null;
  unitsSold: string;
  revenue: string;
  cost: string;
  profit: string;
}

export default function ProfitMarginPage() {
  const [rows, setRows] = useState<MarginRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    try {
      const params = new URLSearchParams();
      if (start) params.set("startDate", new Date(start).toISOString());
      if (end) params.set("endDate", new Date(end).toISOString());
      const res = await fetch(`/api/admin/reports/profit-margin?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.margin);
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
    <PageShell title="Profit margin" subtitle="Revenue minus batch cost, per product" allow={["admin"]}>
      <Card>
        <CardHeader>
          <CardTitle>Margins</CardTitle>
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
                  "profit-margin",
                  ["product", "category", "sold", "revenue", "cost", "profit"],
                  rows.map((r) => [r.productName, r.categoryName, r.unitsSold, r.revenue, r.cost, r.profit]),
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
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Sold</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.productId}>
                    <TableCell>{r.productName ?? "—"}</TableCell>
                    <TableCell>{r.categoryName ?? "—"}</TableCell>
                    <TableCell>{r.unitsSold}</TableCell>
                    <TableCell>{r.revenue}</TableCell>
                    <TableCell>{r.cost}</TableCell>
                    <TableCell className="font-medium">{r.profit}</TableCell>
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
