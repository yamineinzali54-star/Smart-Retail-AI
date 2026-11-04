"use client";

import { use, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PriceRow {
  id: string;
  oldPrice: string;
  newPrice: string;
  changedAt: string;
  reason: string | null;
}

interface Batch {
  id: string;
  barcode: string;
  productName: string | null;
  categoryName: string | null;
  unitName: string | null;
  receivedQuantity: number;
  currentStockQuantity: number;
  purchasePrice: string;
  sellingPrice: string;
  expiryDate: string | null;
  remarks: string | null;
  poNumber: string | null;
  priceHistory: PriceRow[];
}

export default function StockDetailPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/stock/${itemId}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setBatch(data.item);
      setPrice(data.item.sellingPrice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function savePrice(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch(`/api/admin/stock/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sellingPrice: price,
        priceChangeReason: reason || undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(data.error || "Update failed");
      return;
    }
    setMessage("Price updated — history logged");
    setReason("");
    void load();
  }

  return (
    <PageShell title={batch ? batch.barcode : "Batch"}>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {batch && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {batch.productName} — {batch.currentStockQuantity} in stock
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Category: {batch.categoryName ?? "—"} · Unit: {batch.unitName ?? "—"}</p>
              <p>Received: {batch.receivedQuantity} · Buy: {batch.purchasePrice} · Sell: {batch.sellingPrice}</p>
              <p>Expiry: {batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : "—"}</p>
              <p>PO: {batch.poNumber ?? "—"} · Remarks: {batch.remarks ?? "—"}</p>
              <p>
                <a href={`/stock/${batch.id}/labels`} className="text-sm text-primary hover:underline">
                  Barcode labels (preview)
                </a>
              </p>
              <form onSubmit={savePrice} className="space-y-2 pt-2">
                <div className="space-y-1">
                  <Label htmlFor="price">Selling price</Label>
                  <Input id="price" value={price} onChange={(e) => setPrice(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reason">Change reason</Label>
                  <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} />
                </div>
                <Button type="submit" size="sm">Update price</Button>
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Price history</CardTitle>
            </CardHeader>
            <CardContent>
              {batch.priceHistory.length === 0 && (
                <p className="text-sm text-muted-foreground">No changes recorded.</p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Old</TableHead>
                    <TableHead>New</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batch.priceHistory.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>{new Date(h.changedAt).toLocaleDateString()}</TableCell>
                      <TableCell>{h.oldPrice}</TableCell>
                      <TableCell>{h.newPrice}</TableCell>
                      <TableCell>{h.reason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
