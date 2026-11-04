"use client";

import { use, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Line {
  id: string;
  itemId: string;
  productName: string | null;
  barcode: string | null;
  quantity: number;
}

interface Transfer {
  id: string;
  transferNumber: string;
  fromBranchName: string | null;
  toBranchName: string | null;
  status: string;
  details: Line[];
}

const NEXT: Record<string, { status: string; label: string }> = {
  pending: { status: "approved", label: "Approve" },
  approved: { status: "in_transit", label: "Ship (decrement source)" },
  in_transit: { status: "received", label: "Receive at destination" },
};

export default function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [t, setT] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/stock-transfers/${id}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setT(data.transfer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function advance(status: string) {
    setMessage(null);
    const res = await fetch(`/api/admin/stock-transfers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Transition failed");
    else {
      setMessage("Updated");
      void load();
    }
  }

  const next = t ? NEXT[t.status] : null;

  return (
    <PageShell title={t ? t.transferNumber : "Transfer"}>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {t && (
        <Card>
          <CardHeader>
            <CardTitle>
              {t.fromBranchName} → {t.toBranchName} <Badge variant="secondary">{t.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.details.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.barcode ?? "—"}</TableCell>
                    <TableCell>{d.productName ?? "—"}</TableCell>
                    <TableCell>{d.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {next && (
              <Button onClick={() => void advance(next.status)}>{next.label}</Button>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
