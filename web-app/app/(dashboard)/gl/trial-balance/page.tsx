"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface TBRow {
  accountId: string;
  code: string | null;
  name: string | null;
  type: string | null;
  debits: string;
  credits: string;
  balance: string;
}

export default function TrialBalancePage() {
  const [rows, setRows] = useState<TBRow[]>([]);
  const [totals, setTotals] = useState({ debits: "0", credits: "0", balanced: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (start) params.set("startDate", new Date(start).toISOString());
      if (end) params.set("endDate", new Date(end).toISOString());
      const res = await fetch(`/api/admin/gl/trial-balance?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.accounts);
      setTotals(data.totals);
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
    <PageShell
      title="Trial Balance"
      subtitle={`Debits ${totals.debits} = Credits ${totals.credits}`}
      allow={["admin"]}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              Balances{" "}
              {totals.balanced ? (
                <Badge variant="default">balanced</Badge>
              ) : (
                <Badge variant="destructive">OUT OF BALANCE</Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="max-w-48" aria-label="Start date" />
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="max-w-48" aria-label="End date" />
              <Button variant="outline" onClick={() => void load()}>Filter</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Debits</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.accountId}>
                    <TableCell className="font-mono">{r.code ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={`/gl/ledger?accountId=${r.accountId}`} className="text-primary hover:underline">
                        {r.name ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{r.type ?? "—"}</TableCell>
                    <TableCell>{r.debits}</TableCell>
                    <TableCell>{r.credits}</TableCell>
                    <TableCell className="font-medium">{r.balance}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="font-bold">Totals</TableCell>
                  <TableCell className="font-bold">{totals.debits}</TableCell>
                  <TableCell className="font-bold">{totals.credits}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
