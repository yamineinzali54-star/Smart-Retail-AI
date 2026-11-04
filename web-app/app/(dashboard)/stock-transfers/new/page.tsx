"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface Batch {
  id: string;
  barcode: string;
  productName: string | null;
  currentStockQuantity: number;
}

export default function NewStockTransferPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/branches?pageSize=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.branches.length > 0) {
          setBranches(d.branches);
          setFromBranchId(d.branches[0].id);
          if (d.branches.length > 1) setToBranchId(d.branches[1].id);
        }
      })
      .catch(() => undefined);
  }, []);

  async function loadBatches() {
    const res = await fetch("/api/admin/stock?pageSize=50");
    const data = await res.json();
    if (data.ok) setBatches(data.stock.filter((b: Batch) => b.currentStockQuantity > 0));
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadBatches());
     
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const items = Object.entries(qty)
        .filter(([, v]) => Number(v) > 0)
        .map(([itemId, v]) => ({ itemId, quantity: Number(v) }));
      if (items.length === 0) {
        setError("Enter at least one quantity");
        return;
      }
      const res = await fetch("/api/admin/stock-transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromBranchId, toBranchId, items }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Create failed");
        return;
      }
      router.push(`/stock-transfers/${data.transfer.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="New stock transfer" subtitle="Stock moves on approve → in-transit">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Transfer lines</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="from">From branch</Label>
                <LocalizedSelect id="from" value={fromBranchId} onChange={(e) => setFromBranchId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm">
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="to">To branch</Label>
                <LocalizedSelect id="to" value={toBranchId} onChange={(e) => setToBranchId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm">
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </LocalizedSelect>
              </div>
            </div>
            {batches.map((b) => (
              <div key={b.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 text-sm">
                <span>{b.barcode} — {b.productName} (have {b.currentStockQuantity})</span>
                <Input placeholder="Qty" value={qty[b.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [b.id]: e.target.value }))} inputMode="numeric" />
              </div>
            ))}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create transfer"}</Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}
