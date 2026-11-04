"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface LedgerLine {
  entryId: string;
  debit: string;
  credit: string;
  entryDate: string;
  refType: string | null;
  refId: string | null;
  memo: string | null;
}

function LedgerBody() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId") ?? "";
  const [account, setAccount] = useState<{ code: string; name: string } | null>(null);
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) {
      return;
    }
    fetch(`/api/admin/gl/ledger?accountId=${accountId}&pageSize=100`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setAccount(data.account);
        setLines(data.lines);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [accountId]);

  return (
    <PageShell
      title={account ? `${account.code} — ${account.name}` : "Account ledger"}
      allow={["admin"]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Postings</CardTitle>
        </CardHeader>
        <CardContent>
          {!accountId && (
            <p className="text-sm text-muted-foreground">
              Open an account from the{" "}
              <a href="/gl/trial-balance" className="text-primary hover:underline">
                trial balance
              </a>
              .
            </p>
          )}
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && accountId && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Memo</TableHead>
                  <TableHead>Debit</TableHead>
                  <TableHead>Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={`${l.entryId}-${i}`}>
                    <TableCell>{new Date(l.entryDate).toLocaleDateString()}</TableCell>
                    <TableCell className="font-mono text-xs">{l.refType}{l.refId ? ` ${l.refId.slice(0, 8)}` : ""}</TableCell>
                    <TableCell className="max-w-64 truncate">{l.memo ?? "—"}</TableCell>
                    <TableCell>{l.debit}</TableCell>
                    <TableCell>{l.credit}</TableCell>
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

export default function GLLedgerPage() {
  return (
    <Suspense>
      <LedgerBody />
    </Suspense>
  );
}
