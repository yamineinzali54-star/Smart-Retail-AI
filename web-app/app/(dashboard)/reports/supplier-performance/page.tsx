"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PerfRow {
  supplierId: string;
  supplierName: string;
  poCount: number;
  receivedCount: number;
  openCount: number;
  fulfillmentRate: number | null;
  totalSpend: string;
  avgLeadDays: number | null;
}

export default function SupplierPerformancePage() {
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/reports/supplier-performance")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setRows(data.suppliers);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell title="Supplier performance" subtitle="Fulfillment, spend, and lead time" allow={["admin"]}>
      <div>
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv(
              "supplier-performance",
              ["supplier", "pos", "received", "open", "fulfillment_pct", "spend", "avg_lead_days"],
              rows.map((r) => [r.supplierName, r.poCount, r.receivedCount, r.openCount, r.fulfillmentRate, r.totalSpend, r.avgLeadDays]),
            )
          }
        >
          Export CSV
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Suppliers</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>POs</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Open</TableHead>
                  <TableHead>Fulfillment %</TableHead>
                  <TableHead>Spend</TableHead>
                  <TableHead>Avg lead (days)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.supplierId}>
                    <TableCell>{r.supplierName}</TableCell>
                    <TableCell>{r.poCount}</TableCell>
                    <TableCell>{r.receivedCount}</TableCell>
                    <TableCell>{r.openCount}</TableCell>
                    <TableCell>{r.fulfillmentRate ?? "—"}</TableCell>
                    <TableCell>{r.totalSpend}</TableCell>
                    <TableCell>{r.avgLeadDays ?? "—"}</TableCell>
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
