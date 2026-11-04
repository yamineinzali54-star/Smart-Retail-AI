"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Expense {
  id: string;
  categoryName: string | null;
  amount: string;
  expenseDate: string;
  method: string;
  notes: string | null;
}

interface Category {
  id: string;
  name: string;
}

export default function ExpensesPage() {
  const [rows, setRows] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [floats, setFloats] = useState<Array<{ id: string; holderName: string | null; issuedAmount: string }>>([]);
  const [floatId, setFloatId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [e, c, f] = await Promise.all([
        fetch("/api/admin/expenses?pageSize=100").then((r) => r.json()),
        fetch("/api/admin/expense-categories").then((r) => r.json()),
        fetch("/api/admin/petty-cash/floats").then((r) => r.json()).catch(() => null),
      ]);
      if (!e.ok) throw new Error(e.error || "Failed to load");
      setRows(e.expenses);
      if (c.ok) {
        setCategories(c.categories);
        if (!categoryId && c.categories.length > 0) setCategoryId(c.categories[0].id);
      }
      if (f?.ok) {
        setFloats(f.floats.filter((x: { status: string }) => x.status === "open"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addCategory() {
    if (!newCategory.trim()) return;
    const res = await fetch("/api/admin/expense-categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newCategory.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      setNewCategory("");
      void load();
    }
  }

  async function record(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryId,
        amount,
        expenseDate: new Date(date).toISOString(),
        method,
        notes: notes || undefined,
        floatId: floatId || undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(data.error || "Record failed");
      return;
    }
    setAmount("");
    setNotes("");
    setMessage("Expense recorded");
    void load();
  }

  return (
    <PageShell
      title="Expenses"
      subtitle="Operating costs — feeds the P&L report"
      allow={["admin"]}
      actions={
        <a href="/expenses/budgets" className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
          Monthly budgets
        </a>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Record expense</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={record} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cat">Category</Label>
                <LocalizedSelect id="cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm" required>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="flex gap-2">
                <Input placeholder="New category…" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
                <Button type="button" variant="outline" onClick={() => void addCategory()}>Add</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="amount">Amount</Label>
                  <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="method">Method</Label>
                <LocalizedSelect id="method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm">
                  <option value="cash">cash</option>
                  <option value="bank_transfer">bank transfer</option>
                  <option value="mobile_payment">mobile payment</option>
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="float">Petty cash float (optional)</Label>
                <LocalizedSelect id="float" value={floatId} onChange={(e) => setFloatId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm">
                  <option value="">— none —</option>
                  {floats.map((f) => (
                    <option key={f.id} value={f.id}>{f.holderName ?? "float"} · {f.issuedAmount}</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} />
              </div>
              <Button type="submit">Record</Button>
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent expenses</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.expenseDate).toLocaleDateString()}</TableCell>
                      <TableCell>{r.categoryName ?? "—"}</TableCell>
                      <TableCell>{r.amount}</TableCell>
                      <TableCell>{r.method}</TableCell>
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
