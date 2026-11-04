"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ZReport {
  date: string;
  saleCount: number;
  voidCount: number;
  dayTotal: string;
  byMethod: Record<string, { count: number; total: string }>;
  refunds: { count: number; total: string };
  handovers: {
    id: string;
    cashierName: string | null;
    expectedCash: string;
    blindCount: string;
    difference: string;
    handedAt: string;
  }[];
  sessions: {
    id: string;
    cashierName: string | null;
    openingCash: string;
    expectedClosingCash: string | null;
    actualClosingCash: string | null;
    cashDifference: string | null;
    status: string;
  }[];
}

export default function ZReportPage() {
  const [report, setReport] = useState<ZReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/z-report?date=${date}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setReport(data.zReport);
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

  function exportCsv() {
    if (!report) return;
    const lines = [
      `z-report,${report.date}`,
      `sales,${report.saleCount},${report.dayTotal}`,
      `voids,${report.voidCount}`,
      `refunds,${report.refunds.count},${report.refunds.total}`,
      "method,count,total",
      ...Object.entries(report.byMethod).map(([m, v]) => `${m},${v.count},${v.total}`),
      "handovers,cashier,expected,counted,diff",
      ...report.handovers.map(
        (h) => `handover,${h.cashierName ?? ""},${h.expectedCash},${h.blindCount},${h.difference}`,
      ),
    ].join("\n");
    const blob = new Blob([lines], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `z-report-${report.date}.csv`;
    a.click();
  }

  return (
    <PageShell title="End-of-day (Z-report)" subtitle="Daily close: sales by method, voids, refunds, tills" allow={["admin"]}>
      <div className="grid max-w-3xl gap-4">
        <div className="flex gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-48" aria-label="Day" />
          <Button variant="outline" onClick={() => void load()}>Load day</Button>
          <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
        </div>
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {report && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  {report.date} — {report.saleCount} sales · {report.dayTotal}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Method</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(report.byMethod).map(([m, v]) => (
                      <TableRow key={m}>
                        <TableCell>{m}</TableCell>
                        <TableCell>{v.count}</TableCell>
                        <TableCell>{v.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="pt-2 text-sm text-muted-foreground">
                  Voids: {report.voidCount} · Approved refunds: {report.refunds.count} ({report.refunds.total})
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Shift handovers</CardTitle>
              </CardHeader>
              <CardContent>
                {report.handovers.length === 0 && (
                  <p className="text-sm text-muted-foreground">No handovers recorded this day.</p>
                )}
                {report.handovers.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cashier</TableHead>
                        <TableHead>Expected</TableHead>
                        <TableHead>Counted</TableHead>
                        <TableHead>Diff</TableHead>
                        <TableHead>At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.handovers.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{h.cashierName ?? "—"}</TableCell>
                          <TableCell>{h.expectedCash}</TableCell>
                          <TableCell>{h.blindCount}</TableCell>
                          <TableCell>{h.difference}</TableCell>
                          <TableCell>{new Date(h.handedAt).toLocaleTimeString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sessions</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cashier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Opening</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Diff</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.sessions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.cashierName ?? "—"}</TableCell>
                        <TableCell>{s.status}</TableCell>
                        <TableCell>{s.openingCash}</TableCell>
                        <TableCell>{s.expectedClosingCash ?? "—"}</TableCell>
                        <TableCell>{s.actualClosingCash ?? "—"}</TableCell>
                        <TableCell>{s.cashDifference ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageShell>
  );
}
