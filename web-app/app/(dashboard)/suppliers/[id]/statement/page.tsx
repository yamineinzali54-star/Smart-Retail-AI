"use client";

import { use, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PO {
  id: string;
  poNumber: string;
  totalAmount: string;
  paymentStatus: string;
}

interface Payment {
  id: string;
  amount: string;
  method: string;
  paymentDate: string;
  poId: string | null;
  reference: string | null;
}

// Printable supplier statement — PREVIEW ONLY until a printer is provisioned.
export default function SupplierStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pos, setPos] = useState<PO[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/purchase-orders?supplierId=${id}&pageSize=100`).then((r) => r.json()),
      fetch(`/api/admin/supplier-payments?supplierId=${id}&pageSize=100`).then((r) => r.json()),
      fetch(`/api/admin/suppliers/${id}`).then((r) => r.json()),
    ])
      .then(([p, pay, s]) => {
        if (!p.ok) throw new Error(p.error || "Failed to load POs");
        setPos(p.purchaseOrders);
        if (pay.ok) setPayments(pay.payments);
        if (s.ok) setName(s.supplier?.name ?? "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  const billed = pos.reduce((s, p) => s + Number(p.totalAmount), 0);
  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <PageShell title={`Statement — ${name || "supplier"}`} subtitle={`Billed ${billed.toFixed(2)} · paid ${paid.toFixed(2)} · balance ${(billed - paid).toFixed(2)}`}>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && (
        <div className="max-w-3xl space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Purchase orders</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pos.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.poNumber}</TableCell>
                      <TableCell>{p.totalAmount}</TableCell>
                      <TableCell>{p.paymentStatus}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{new Date(p.paymentDate).toLocaleDateString()}</TableCell>
                      <TableCell>{p.method}</TableCell>
                      <TableCell>{p.reference ?? "—"}</TableCell>
                      <TableCell>{p.amount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
