"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Detail {
  id: string;
  productId: string;
  productName: string | null;
  quantity: number;
  unitPrice: string;
}

interface Payment {
  id: string;
  amount: string;
  method: string;
  paymentDate: string;
  reference: string | null;
}

interface PO {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string | null;
  status: string;
  approvalStatus: string;
  paymentStatus: string;
  totalAmount: string;
  details: Detail[];
  paymentHistory: Payment[];
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [po, setPo] = useState<PO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [deciding, setDeciding] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/purchase-orders/${id}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setPo(data.purchaseOrder);
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

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/admin/supplier-payments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        supplierId: po?.supplierId,
        poId: id,
        amount,
        paymentDate: new Date().toISOString(),
        method,
        reference: reference || undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(data.error || "Payment failed");
      return;
    }
    setAmount("");
    setReference("");
    setMessage(data.warning ? `Recorded with warning: ${data.warning}` : "Payment recorded");
    void load();
  }

  async function decide(action: "approve" | "reject") {
    setDeciding(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/purchase-orders/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "reject" ? JSON.stringify({ reason: rejectReason || undefined }) : "{}",
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(data.error || `${action} failed`);
        return;
      }
      setMessage(action === "approve" ? "PO approved — GRN unlocked" : "PO rejected");
      void load();
    } finally {
      setDeciding(false);
    }
  }

  return (
    <PageShell title={po ? po.poNumber : "Purchase order"}>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {po && (
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {po.poNumber} — {po.supplierName}{" "}
                <Badge variant="secondary">{po.status}</Badge>{" "}
                <Badge variant={po.approvalStatus === "approved" ? "default" : po.approvalStatus === "rejected" ? "destructive" : "secondary"}>
                  {po.approvalStatus}
                </Badge>{" "}
                <Badge variant="secondary">{po.paymentStatus}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Qty (purchase unit)</TableHead>
                    <TableHead>Unit price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.details.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.productName ?? d.productId}</TableCell>
                      <TableCell>{d.quantity}</TableCell>
                      <TableCell>{d.unitPrice}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm font-medium">Total: {po.totalAmount}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/grn/new?poId=${po.id}`}>
                  <Button disabled={po.approvalStatus !== "approved"}>Create GRN</Button>
                </Link>
                {po.approvalStatus === "pending" && (
                  <>
                    <Button variant="outline" disabled={deciding} onClick={() => void decide("approve")}>
                      Approve
                    </Button>
                    <Input
                      placeholder="Reject reason (optional)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="max-w-48"
                      maxLength={255}
                    />
                    <Button variant="destructive" disabled={deciding} onClick={() => void decide("reject")}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
              {po.approvalStatus !== "approved" && (
                <p className="text-xs text-muted-foreground">GRN is blocked until this PO is approved.</p>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Payment history</CardTitle>
              </CardHeader>
              <CardContent>
                {po.paymentHistory.length === 0 && (
                  <p className="text-sm text-muted-foreground">No payments yet.</p>
                )}
                {po.paymentHistory.map((p) => (
                  <div key={p.id} className="flex justify-between border-b py-2 text-sm">
                    <span>{new Date(p.paymentDate).toLocaleDateString()} — {p.method}{p.reference ? ` (${p.reference})` : ""}</span>
                    <span className="font-medium">{p.amount}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Record payment</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={recordPayment} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
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
                    <Label htmlFor="ref">Reference</Label>
                    <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
                  </div>
                  <Button type="submit">Record</Button>
                  {message && <p className="text-sm text-muted-foreground">{message}</p>}
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </PageShell>
  );
}
