"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SR {
  id: string;
  returnNumber: string;
  saleNumber: string | null;
  status: string;
  refundAmount: string;
}

export default function SaleReturnsPage() {
  const [rows, setRows] = useState<SR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sale-returns?pageSize=100");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.returns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, []);

  async function approve(id: string) {
    setMessage(null);
    const res = await fetch(`/api/sale-returns/${id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolution: "cash_refund" }),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Approve failed");
    else {
      setMessage("Approved — stock restored, cash refunded");
      void load();
    }
  }

  return (
    <PageShell
      title="Sale Returns"
      subtitle="Pending returns wait in the approval queue"
      actions={
        <Link href="/pos/sale-returns/new">
          <Button>New return</Button>
        </Link>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>All returns</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return</TableHead>
                  <TableHead>Sale</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Refund</TableHead>
                    <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.returnNumber}</TableCell>
                    <TableCell>{r.saleNumber ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                    <TableCell>{r.refundAmount}</TableCell>
                    <TableCell>
                      {r.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => void approve(r.id)}>Cash refund</Button>
                        </div>
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
