"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PO {
  id: string;
  poNumber: string;
  supplierName: string | null;
  orderDate: string;
  status: string;
  approvalStatus?: string;
  paymentStatus: string;
  totalAmount: string;
}

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const res = await fetch(`/api/admin/purchase-orders?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.purchaseOrders);
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
      title="Purchase Orders"
      actions={
        <Link href="/purchase-orders/new">
          <Button>New PO</Button>
        </Link>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>All purchase orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Search PO number…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <LocalizedSelect
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="">All statuses</option>
              <option value="pending">pending</option>
              <option value="partially_received">partially received</option>
              <option value="received">received</option>
            </LocalizedSelect>
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Payment</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.poNumber}</TableCell>
                    <TableCell>{p.supplierName ?? "—"}</TableCell>
                    <TableCell>{new Date(p.orderDate).toLocaleDateString()}</TableCell>
                    <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={p.approvalStatus === "approved" ? "default" : p.approvalStatus === "rejected" ? "destructive" : "secondary"}>
                        {p.approvalStatus ?? "approved"}
                      </Badge>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{p.paymentStatus}</Badge></TableCell>
                    <TableCell>{p.totalAmount}</TableCell>
                    <TableCell>
                      <Link href={`/purchase-orders/${p.id}`}>
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
