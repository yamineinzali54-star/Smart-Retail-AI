"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Supplier {
  id: string;
  name: string;
}

interface Batch {
  id: string;
  barcode: string;
  productName: string | null;
  currentStockQuantity: number;
  purchasePrice: string;
}

function NewSupplierReturnForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const grnId = searchParams.get("grnId") ?? "";
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/suppliers?pageSize=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.suppliers.length > 0) {
          setSuppliers(d.suppliers);
          setSupplierId(d.suppliers[0].id);
        }
      })
      .catch(() => undefined);
    const url = grnId ? `/api/admin/grn/${grnId}` : "/api/admin/stock?pageSize=50";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setBatches(grnId ? d.grn.items.map((b: Batch & { id: string }) => ({ ...b })) : d.stock);
      })
      .catch(() => undefined);
  }, [grnId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lines = Object.entries(qty)
        .filter(([, v]) => Number(v) > 0)
        .map(([itemId, v]) => {
          const b = batches.find((x) => x.id === itemId)!;
          return { itemId, quantity: Number(v), unitCost: b.purchasePrice };
        });
      if (lines.length === 0) {
        setError("Enter at least one quantity");
        return;
      }
      const res = await fetch("/api/admin/supplier-returns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ supplierId, grnId: grnId || undefined, reason, lines }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Create failed");
        return;
      }
      router.push(`/supplier-returns/${data.return.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="New supplier return" subtitle="Draft until confirmed">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Return lines</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="supplier">Supplier</Label>
              <LocalizedSelect id="supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm" required>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </LocalizedSelect>
            </div>
            {batches.map((b) => (
              <div key={b.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 text-sm">
                <span>{b.barcode} — {b.productName} (have {b.currentStockQuantity})</span>
                <Input placeholder="Qty" value={qty[b.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [b.id]: e.target.value }))} inputMode="numeric" />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={255} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft"}</Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}

export default function NewSupplierReturnPage() {
  return (
    <Suspense>
      <NewSupplierReturnForm />
    </Suspense>
  );
}
