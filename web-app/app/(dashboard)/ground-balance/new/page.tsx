"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Batch {
  id: string;
  barcode: string;
  productName: string | null;
  currentStockQuantity: number;
}

export default function NewGroundBalancePage() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function searchBatches() {
    const params = new URLSearchParams({ pageSize: "50" });
    if (search.trim()) params.set("search", search.trim());
    const res = await fetch(`/api/admin/stock?${params}`);
    const data = await res.json();
    if (data.ok) setBatches(data.stock);
  }

  useEffect(() => {
    void Promise.resolve().then(() => searchBatches());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lines = Object.entries(counts)
        .filter(([, v]) => v !== "")
        .map(([itemId, v]) => ({ itemId, actualQty: Number(v) }));
      if (lines.length === 0) {
        setError("Enter at least one count");
        return;
      }
      const res = await fetch("/api/admin/ground-balance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gbDate: new Date().toISOString(),
          remark: remark || undefined,
          lines,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Create failed");
        return;
      }
      router.push(`/ground-balance/${encodeURIComponent(data.groundBalance.batchNo)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="New ground balance" subtitle="Enter physical counts — inventory qty is re-looked-up live">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Count lines</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Search batches…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button type="button" variant="outline" onClick={() => void searchBatches()}>Search</Button>
            </div>
            {batches.map((b) => (
              <div key={b.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 text-sm">
                <span>{b.barcode} — {b.productName} (sys: {b.currentStockQuantity})</span>
                <Input
                  placeholder="Actual qty"
                  value={counts[b.id] ?? ""}
                  onChange={(e) => setCounts((c) => ({ ...c, [b.id]: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label htmlFor="remark">Remark</Label>
              <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={100} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save count"}</Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}
