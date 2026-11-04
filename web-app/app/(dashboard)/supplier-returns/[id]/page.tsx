"use client";

import { use, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppDialog } from "@/components/ui/use-app-dialog";

interface Line {
  id: string;
  productName: string | null;
  barcode: string | null;
  quantity: number;
  unitCost: string;
  totalValue: string;
}

interface SR {
  id: string;
  debitNoteNumber: string;
  supplierName: string | null;
  status: string;
  details: Line[];
}

export default function SupplierReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { confirm, dialog } = useAppDialog();
  const { id } = use(params);
  const [r, setR] = useState<SR | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/supplier-returns/${id}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setR(data.return);
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

  async function confirmReturn() {
    if (!(await confirm("Confirm return? Stock decrements and the payable adjusts."))) return;
    const res = await fetch(`/api/admin/supplier-returns/${id}`, { method: "PATCH" });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Confirm failed");
    else {
      setMessage("Confirmed");
      void load();
    }
  }

  return (
    <PageShell title={r ? r.debitNoteNumber : "Supplier return"}>
      {dialog}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {r && (
        <Card>
          <CardHeader>
            <CardTitle>
              {r.supplierName} <Badge variant="secondary">{r.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit cost</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.details.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.barcode ?? "—"}</TableCell>
                    <TableCell>{d.productName ?? "—"}</TableCell>
                    <TableCell>{d.quantity}</TableCell>
                    <TableCell>{d.unitCost}</TableCell>
                    <TableCell>{d.totalValue}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {r.status === "draft" && <Button onClick={() => void confirmReturn()}>Confirm return</Button>}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
