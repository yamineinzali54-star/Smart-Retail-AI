"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GB {
  batchNo: string;
  gbDate: string;
  status: string;
  remark: string | null;
}

export default function GroundBalancePage() {
  const [rows, setRows] = useState<GB[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/ground-balance?pageSize=100")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setRows(data.groundBalances);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell
      title="Ground Balance"
      subtitle="Count-only stock-takes — no automatic write-back"
      actions={
        <Link href="/ground-balance/new">
          <Button>New count</Button>
        </Link>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>All counts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remark</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((g) => (
                  <TableRow key={g.batchNo}>
                    <TableCell>{g.batchNo}</TableCell>
                    <TableCell>{new Date(g.gbDate).toLocaleDateString()}</TableCell>
                    <TableCell><Badge variant="secondary">{g.status}</Badge></TableCell>
                    <TableCell>{g.remark ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={`/ground-balance/${encodeURIComponent(g.batchNo)}`}>
                        <Button variant="outline" size="sm">Open</Button>
                      </Link>
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
