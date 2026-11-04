"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Handover {
  id: string;
  outgoingName: string | null;
  expectedCash: string;
  blindCount: string;
  difference: string;
  notes: string | null;
  handedAt: string;
}

export default function HandoverPage() {
  const [rows, setRows] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blindCount, setBlindCount] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/handovers?pageSize=50");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.handovers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, []);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/pos/handovers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blindCount, notes: notes || undefined }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(data.error || "Record failed");
      return;
    }
    setBlindCount("");
    setNotes("");
    setMessage(`Recorded — difference ${data.handover.difference}`);
    void load();
  }

  return (
    <PageShell title="Shift Handover" subtitle="Blind count vs expected — session stays open">
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Record handover</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={record} className="flex gap-2">
              <div className="space-y-1">
                <Label htmlFor="blind">Counted cash (blind)</Label>
                <Input id="blind" value={blindCount} onChange={(e) => setBlindCount(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" className="max-w-48" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} />
              </div>
              <div className="flex items-end">
                <Button type="submit">Record</Button>
              </div>
            </form>
            {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
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
                    <TableHead>When</TableHead>
                    <TableHead>Cashier</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Counted</TableHead>
                    <TableHead>Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>{new Date(h.handedAt).toLocaleString()}</TableCell>
                      <TableCell>{h.outgoingName ?? "—"}</TableCell>
                      <TableCell>{h.expectedCash}</TableCell>
                      <TableCell>{h.blindCount}</TableCell>
                      <TableCell className={h.difference !== "0.00" ? "font-bold text-red-600" : ""}>
                        {h.difference}
                      </TableCell>
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
