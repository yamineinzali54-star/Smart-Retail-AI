"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface StockRow {
  id: string;
  barcode: string;
  productName: string | null;
  categoryName: string | null;
  currentStockQuantity: number;
  reorderThreshold: number;
  sellingPrice: string;
  expiryDate: string | null;
}

export default function StockPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (search.trim()) params.set("search", search.trim());
      if (lowOnly) params.set("lowStock", "true");
      const res = await fetch(`/api/admin/stock?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.stock);
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
    <PageShell title="Stock" subtitle="Batch-level balances — the stock unit">
      <Card>
        <CardHeader>
          <CardTitle>Batches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Search name or barcode…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              Low stock only
            </label>
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.barcode}</TableCell>
                    <TableCell>{r.productName ?? "—"}</TableCell>
                    <TableCell>{r.categoryName ?? "—"}</TableCell>
                    <TableCell>
                      {r.currentStockQuantity}{" "}
                      {r.currentStockQuantity <= r.reorderThreshold && (
                        <Badge variant="destructive">low</Badge>
                      )}
                    </TableCell>
                    <TableCell>{r.sellingPrice}</TableCell>
                    <TableCell>{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Link href={`/stock/${r.id}`}>
                        <Button variant="outline" size="sm">Open</Button>
                      </Link>
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
