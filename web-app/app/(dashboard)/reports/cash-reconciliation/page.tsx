"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ReconRow {
  sessionId: string;
  cashierName: string | null;
  branchName: string | null;
  startTime: string;
  endTime: string | null;
  openingCash: string;
  expectedCash: string | null;
  actualCash: string | null;
  difference: string | null;
}

export default function CashReconPage() {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (start) params.set("startDate", new Date(start).toISOString());
      if (end) params.set("endDate", new Date(end).toISOString());
      const res = await fetch(`/api/admin/reports/cash-reconciliation?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.reconciliation);
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
    <PageShell title="Cash reconciliation" subtitle="Closed-session till trend per cashier" allow={["admin"]}>
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="max-w-48" aria-label="Start date" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="max-w-48" aria-label="End date" />
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "cash-reconciliation",
                  ["cashier", "closed", "opening", "expected", "actual", "difference"],
                  rows.map((r) => [r.cashierName, r.endTime, r.openingCash, r.expectedCash, r.actualCash, r.difference]),
                )
              }
            >
              Export CSV
            </Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>Opening</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.sessionId}>
                    <TableCell>{r.cashierName ?? "—"}</TableCell>
                    <TableCell>{r.endTime ? new Date(r.endTime).toLocaleString() : "—"}</TableCell>
                    <TableCell>{r.openingCash}</TableCell>
                    <TableCell>{r.expectedCash ?? "—"}</TableCell>
                    <TableCell>{r.actualCash ?? "—"}</TableCell>
                    <TableCell>
                      {r.difference ?? "—"}{" "}
                      {r.difference && Number(r.difference) !== 0 && (
                        <Badge variant="destructive">off</Badge>
                      )}
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
