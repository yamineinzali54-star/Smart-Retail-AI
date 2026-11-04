"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface VarianceRow {
  categoryId: string;
  categoryName: string | null;
  limit: string;
  actual: string;
  remaining: string;
  pctUsed: number;
  over: boolean;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function ExpenseBudgetReportPage() {
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(forMonth: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/expense-budget?month=${encodeURIComponent(forMonth)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.variance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load(currentMonth()));
  }, []);

  const overCount = rows.filter((r) => r.over).length;

  return (
    <PageShell title="Expense Budget Report" subtitle="Monthly limit vs actual per category — overruns warn, never block" allow={["admin"]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Variance
            {overCount > 0 && <Badge variant="destructive">{overCount} over budget</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="max-w-48"
              aria-label="Month"
            />
            <Button variant="outline" onClick={() => void load(month)}>Filter</Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "expense-budget",
                  ["category", "limit", "actual", "remaining", "pct_used", "over"],
                  rows.map((r) => [r.categoryName ?? r.categoryId, r.limit, r.actual, r.remaining, r.pctUsed, r.over ? "yes" : "no"]),
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
                  <TableHead>Category</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.categoryId}>
                    <TableCell>{r.categoryName ?? r.categoryId}</TableCell>
                    <TableCell>{r.limit}</TableCell>
                    <TableCell>{r.actual}</TableCell>
                    <TableCell className={Number(r.remaining) < 0 ? "text-red-600" : ""}>
                      {r.remaining}
                    </TableCell>
                    <TableCell>{r.pctUsed}%</TableCell>
                    <TableCell>
                      {r.over ? <Badge variant="destructive">over</Badge> : <Badge variant="secondary">ok</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No budgets for this month — set limits at /expenses/budgets first.</p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
