"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Category {
  id: string;
  name: string;
}

interface VarianceRow {
  categoryId: string;
  categoryName: string | null;
  limit: string;
  actual: string;
  remaining: string;
  pctUsed: number;
  over: boolean;
}

export default function ExpenseBudgetsPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [categoryId, setCategoryId] = useState("");
  const [limit, setLimit] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [b, c] = await Promise.all([
        fetch(`/api/admin/reports/expense-budget?month=${month}`).then((r) => r.json()),
        fetch("/api/admin/expense-categories").then((r) => r.json()),
      ]);
      if (!b.ok) throw new Error(b.error || "Failed to load");
      setRows(b.variance);
      if (c.ok) {
        setCategories(c.categories);
        if (!categoryId && c.categories.length > 0) setCategoryId(c.categories[0].id);
      }
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/expense-budgets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId, month, limitAmount: limit }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(data.error || "Save failed");
      return;
    }
    setLimit("");
    setMessage("Budget saved");
    void load();
  }

  return (
    <PageShell title="Expense Budgets" subtitle="Monthly limits per category — overruns warn, never block" allow={["admin"]}>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Variance — {month}</CardTitle>
              <div className="flex gap-2">
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-40" aria-label="Month" />
                <Button variant="outline" size="sm" onClick={() => void load()}>Load</Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCsv(
                      `expense-budget-${month}`,
                      ["category", "limit", "actual", "remaining", "pct_used", "over"],
                      rows.map((r) => [r.categoryName, r.limit, r.actual, r.remaining, r.pctUsed, r.over ? "yes" : "no"]),
                    )
                  }
                >
                  CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No budgets set for this month.</p>
            )}
            {!loading && rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Limit</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>Used %</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.categoryId}>
                      <TableCell>{r.categoryName ?? "—"}</TableCell>
                      <TableCell>{r.limit}</TableCell>
                      <TableCell>{r.actual}</TableCell>
                      <TableCell>{r.remaining}</TableCell>
                      <TableCell>{r.pctUsed}%</TableCell>
                      <TableCell>
                        {r.over && <Badge variant="destructive">over</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Set budget</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cat">Category</Label>
                <LocalizedSelect id="cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm" required>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="limit">Monthly limit</Label>
                <Input id="limit" value={limit} onChange={(e) => setLimit(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
              </div>
              <Button type="submit">Save</Button>
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
