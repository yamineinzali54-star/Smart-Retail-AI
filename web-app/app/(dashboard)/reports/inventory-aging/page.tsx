"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Bucket {
  label: string;
  batches: number;
  stock: number;
  costValue: string;
}

interface BatchRow {
  id: string;
  barcode: string;
  productName: string | null;
  ageDays: number;
  bucket: string;
  stock: number;
  costValue: string;
}

export default function InventoryAgingPage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/reports/inventory-aging")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setBuckets(data.buckets);
        setBatches(data.batches);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell
      title="Stock Aging"
      subtitle="Capital locked on shelves, aged from GRN receipt"
      allow={["admin"]}
    >
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Aging buckets</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    "inventory-aging",
                    ["barcode", "product", "age_days", "bucket", "stock", "cost_value"],
                    batches.map((b) => [b.barcode, b.productName, b.ageDays, b.bucket, b.stock, b.costValue]),
                  )
                }
              >
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Age</TableHead>
                    <TableHead>Batches</TableHead>
                    <TableHead>Stock units</TableHead>
                    <TableHead>Locked cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buckets.map((b) => (
                    <TableRow key={b.label}>
                      <TableCell className="font-medium">{b.label}</TableCell>
                      <TableCell>{b.batches}</TableCell>
                      <TableCell>{b.stock}</TableCell>
                      <TableCell>{b.costValue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Oldest batches first</CardTitle>
          </CardHeader>
          <CardContent>
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Age (days)</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Cost value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs">{b.barcode}</TableCell>
                      <TableCell>{b.productName ?? "—"}</TableCell>
                      <TableCell>{b.ageDays}</TableCell>
                      <TableCell>{b.bucket}</TableCell>
                      <TableCell>{b.stock}</TableCell>
                      <TableCell>{b.costValue}</TableCell>
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
