"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Account {
  id: string;
  code: string;
  name: string;
}

interface DraftLine {
  accountCode: string;
  debit: string;
  credit: string;
}

export default function OpeningBalancesPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([{ accountCode: "", debit: "0", credit: "0" }]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("Opening balances (go-live cutover)");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/gl/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setAccounts(data.accounts);
      })
      .catch(() => undefined);
  }, []);

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  const totalDebits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebits - totalCredits) < 0.005 && lines.length > 0;

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/gl/opening-balances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryDate: new Date(entryDate).toISOString(),
          memo: memo || undefined,
          lines: lines
            .filter((l) => l.accountCode)
            .map((l) => ({
              accountCode: l.accountCode,
              debit: l.debit || "0",
              credit: l.credit || "0",
            })),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Post failed");
        return;
      }
      setMessage(`Posted opening entry ${data.entryId.slice(0, 8)}…`);
      setLines([{ accountCode: "", debit: "0", credit: "0" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell
      title="Opening Balances"
      subtitle="Go-live cutover — one balanced, backdated entry"
      allow={["admin"]}
    >
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>
            Journal draft{" "}
            <span className={balanced ? "text-green-700" : "text-red-600"}>
              (Dr {totalDebits.toFixed(2)} = Cr {totalCredits.toFixed(2)})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={post} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="date">Entry date</Label>
                <Input id="date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="memo">Memo</Label>
                <Input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={255} />
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Debit</TableHead>
                  <TableHead>Credit</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <LocalizedSelect
                        value={l.accountCode}
                        onChange={(e) => setLine(i, { accountCode: e.target.value })}
                        className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                        required
                      >
                        <option value="">— select —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
                        ))}
                      </LocalizedSelect>
                    </TableCell>
                    <TableCell>
                      <Input value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value })} inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" />
                    </TableCell>
                    <TableCell>
                      <Input value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value })} inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        disabled={lines.length <= 2}
                      >
                        ✕
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLines((ls) => [...ls, { accountCode: "", debit: "0", credit: "0" }])}
              >
                Add line
              </Button>
              <Button type="submit" disabled={busy || !balanced}>
                {busy ? "Posting…" : "Post opening entry"}
              </Button>
            </div>
            {!balanced && (
              <p className="text-sm text-red-600">Debits must equal credits before posting.</p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-green-700">{message}</p>}
          </form>
        </CardContent>
      </Card>
    </PageShell>
  );
}
