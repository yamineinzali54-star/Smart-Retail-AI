"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PoLine {
  productId: string;
  productName: string | null;
  quantity: number;
}

interface RecLine {
  productId: string;
  receivedQty: string;
  sellingPrice: string;
  expiryDate: string;
}

function NewGrnForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const poId = searchParams.get("poId") ?? "";
  const [lines, setLines] = useState<RecLine[]>([]);
  const [poNumber, setPoNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!poId) return;
    Promise.all([
      fetch(`/api/admin/purchase-orders/${poId}`).then((r) => r.json()),
      fetch(`/api/admin/grn/by-po/${poId}`).then((r) => r.json()),
    ])
      .then(([po, hist]) => {
        if (po.ok) {
          setPoNumber(po.purchaseOrder.poNumber);
          const received: Record<string, number> = {};
          for (const r of hist?.alreadyReceived ?? []) received[r.productId] = r.receivedQuantity;
          setLines(
            (po.purchaseOrder.details as PoLine[]).map((d) => ({
              productId: d.productId,
              receivedQty: "",
              sellingPrice: "",
              expiryDate: "",
            })),
          );
          void received;
        }
      })
      .catch(() => undefined);
  }, [poId]);

  function setLine(i: number, patch: Partial<RecLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/grn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          poId,
          remarks: remarks || undefined,
          lines: lines.map((l) => ({
            productId: l.productId,
            receivedQty: Number(l.receivedQty) || 0,
            sellingPrice: l.sellingPrice || "0.00",
            expiryDate: l.expiryDate ? new Date(l.expiryDate).toISOString() : undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Create failed");
        return;
      }
      router.push(`/grn/${data.grn.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!poId) {
    return (
      <PageShell title="New GRN">
        <p className="text-sm text-muted-foreground">
          Open a purchase order first, then click “Create GRN”.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell title={`New GRN — ${poNumber}`} subtitle="Only lines with received qty > 0 are saved">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Receiving lines (purchase unit)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            {lines.map((l, i) => (
              <div key={l.productId} className="grid grid-cols-3 gap-2 rounded-md border p-2">
                <div className="col-span-3 text-sm font-medium">{l.productId.slice(0, 8)}…</div>
                <Input placeholder="Received qty" value={l.receivedQty} onChange={(e) => setLine(i, { receivedQty: e.target.value })} inputMode="numeric" />
                <Input placeholder="Selling price" value={l.sellingPrice} onChange={(e) => setLine(i, { sellingPrice: e.target.value })} pattern="^\d+(\.\d{1,2})?$" />
                <Input type="date" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="remarks">Remarks</Label>
              <Input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={255} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Confirm GRN"}</Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default function NewGrnPage() {
  return (
    <Suspense>
      <NewGrnForm />
    </Suspense>
  );
}
