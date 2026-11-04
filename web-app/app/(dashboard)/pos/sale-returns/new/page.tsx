"use client";
import { useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SaleLine {
  id: string;
  productName?: string | null;
  quantity: number;
  lineTotal: string;
}

export default function NewSaleReturnPage() {
  const [saleNumber, setSaleNumber] = useState("");
  const [saleId, setSaleId] = useState("");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function lookup() {
    setError(null);
    setMessage(null);
    // Resolve the sale through today-sales (cashier scope) by number.
    const res = await fetch("/api/pos/today-sales");
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Lookup failed");
      return;
    }
    const found = (data.sales as { id: string; saleNumber: string }[]).find(
      (s) => s.saleNumber === saleNumber.trim(),
    );
    if (!found) {
      setError("Sale not found in today's sales");
      return;
    }
    const detailRes = await fetch(`/api/pos/sales/${found.id}`);
    const detail = await detailRes.json();
    if (!detail.ok) {
      setError(detail.error || "Could not load sale lines");
      return;
    }
    setSaleId(found.id);
    setLines(detail.sale.lines);
    setMessage(`Sale ${found.saleNumber} located.`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const payload = Object.entries(qty)
      .filter(([, v]) => Number(v) > 0)
      .map(([saleDetailId, v]) => ({
        saleDetailId,
        quantity: Number(v),
      }));
    if (payload.length === 0) {
      setError("Enter at least one quantity");
      return;
    }
    const res = await fetch("/api/sale-returns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saleId, lines: payload }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Return failed");
      return;
    }
    setMessage(
      data.queued
        ? `Return ${data.return.returnNumber} queued for admin approval`
        : `Return ${data.return.returnNumber} approved`,
    );
    setQty({});
  }

  return (
    <PageShell title="New sale return" subtitle="Without refund approval the return queues for Admin">
      <div className="grid max-w-2xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>1. Find the sale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input placeholder="SALE-… number" value={saleNumber} onChange={(e) => setSaleNumber(e.target.value)} />
              <Button variant="outline" onClick={() => void lookup()}>Find</Button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
          </CardContent>
        </Card>
        {saleId && (
          <Card>
            <CardHeader>
              <CardTitle>2. Return lines</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-3">
                {lines.map((l) => (
                  <div key={l.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 text-sm">
                    <span>{l.productName ?? l.id} (sold {l.quantity} · {l.lineTotal})</span>
                    <Input placeholder="Return qty" value={qty[l.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} inputMode="numeric" />
                  </div>
                ))}
                <Button type="submit">Submit return</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
