"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ValRow {
  categoryId: string;
  categoryName: string | null;
  totalStock: string;
  costValue: string;
  potentialRevenue: string;
  profit: string;
}

export default function ValuationPage() {
  const [rows, setRows] = useState<ValRow[]>([]);
  const [grand, setGrand] = useState({ totalStock: "0", costValue: "0", potentialRevenue: "0", profit: "0" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/reports/inventory-valuation")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setRows(data.valuation);
        setGrand(data.grandTotals);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell
      title="Inventory valuation"
      subtitle={`Stock ${grand.totalStock} · cost ${grand.costValue} · potential ${grand.potentialRevenue} · profit ${grand.profit}`}
      allow={["admin"]}
    >
      <div>
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv(
              "inventory-valuation",
              ["category", "stock", "cost_value", "potential_revenue", "profit"],
              rows.map((r) => [r.categoryName, r.totalStock, r.costValue, r.potentialRevenue, r.profit]),
            )
          }
        >
          Export CSV
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Cost value</TableHead>
                  <TableHead>Potential revenue</TableHead>
                  <TableHead>Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.categoryId}>
                    <TableCell>{r.categoryName ?? "—"}</TableCell>
                    <TableCell>{r.totalStock}</TableCell>
                    <TableCell>{r.costValue}</TableCell>
                    <TableCell>{r.potentialRevenue}</TableCell>
                    <TableCell>{r.profit}</TableCell>
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
