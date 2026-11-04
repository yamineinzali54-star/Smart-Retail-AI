"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Adjustment {
  id: string;
  adjustmentNumber: string;
  reasonType: string;
  reason: string;
  createdAt: string;
}

interface Batch {
  id: string;
  barcode: string;
  productName: string | null;
  currentStockQuantity: number;
}

export default function StockAdjustmentsPage() {
  const [rows, setRows] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [search, setSearch] = useState("");
  const [delta, setDelta] = useState<Record<string, string>>({});
  const [reasonType, setReasonType] = useState("damage");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stock-adjustments?pageSize=50");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.adjustments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function searchBatches() {
    const params = new URLSearchParams({ pageSize: "30" });
    if (search.trim()) params.set("search", search.trim());
    const res = await fetch(`/api/admin/stock?${params}`);
    const data = await res.json();
    if (data.ok) setBatches(data.stock);
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    void Promise.resolve().then(() => searchBatches());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const lines = Object.entries(delta)
      .filter(([, v]) => Number(v) !== 0 && v.trim() !== "")
      .map(([itemId, v]) => ({ itemId, quantityDelta: Number(v) }));
    if (lines.length === 0) {
      setMessage("Enter at least one non-zero delta");
      return;
    }
    const res = await fetch("/api/admin/stock-adjustments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reasonType, reason, lines }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(data.error || "Adjustment failed");
      return;
    }
    setMessage(`Posted ${data.adjustment.adjustmentNumber}`);
    setDelta({});
    setReason("");
    void load();
    void searchBatches();
  }

  return (
    <PageShell title="Stock Adjustments" subtitle="Damage / loss / found / correction — posts immediately with audit">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New adjustment</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="Search batches…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Button type="button" variant="outline" onClick={() => void searchBatches()}>Search</Button>
              </div>
              {batches.map((b) => (
                <div key={b.id} className="grid grid-cols-2 items-center gap-2 rounded-md border p-2 text-sm">
                  <span>{b.barcode} — {b.productName} (have {b.currentStockQuantity})</span>
                  <Input
                    placeholder="Δ (e.g. -2 or +5)"
                    value={delta[b.id] ?? ""}
                    onChange={(e) => setDelta((d) => ({ ...d, [b.id]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="rtype">Reason type</Label>
                  <LocalizedSelect id="rtype" value={reasonType} onChange={(e) => setReasonType(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm">
                    <option value="damage">damage</option>
                    <option value="loss">loss</option>
                    <option value="found">found</option>
                    <option value="correction">correction</option>
                  </LocalizedSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="reason">Reason</Label>
                  <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={255} />
                </div>
              </div>
              <Button type="submit">Post adjustment</Button>
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.adjustmentNumber}</TableCell>
                      <TableCell><Badge variant="secondary">{r.reasonType}</Badge></TableCell>
                      <TableCell className="max-w-48 truncate">{r.reason}</TableCell>
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
