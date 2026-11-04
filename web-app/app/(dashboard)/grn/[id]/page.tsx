"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface BatchLine {
  id: string;
  barcode: string;
  productName: string | null;
  receivedQuantity: number;
  currentStockQuantity: number;
  purchasePrice: string;
  sellingPrice: string;
  expiryDate: string | null;
}

interface GRN {
  id: string;
  grnNumber: string;
  poId: string;
  poNumber: string | null;
  supplierName: string | null;
  items: BatchLine[];
}

export default function GrnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [grn, setGrn] = useState<GRN | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/grn/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setGrn(data.grn);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <PageShell title={grn ? grn.grnNumber : "GRN"}>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {grn && (
        <Card>
          <CardHeader>
            <CardTitle>
              {grn.grnNumber} — PO {grn.poNumber} ({grn.supplierName})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>In stock</TableHead>
                  <TableHead>Buy</TableHead>
                  <TableHead>Sell</TableHead>
                  <TableHead>Expiry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grn.items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.barcode}</TableCell>
                    <TableCell>{b.productName ?? "—"}</TableCell>
                    <TableCell>{b.receivedQuantity}</TableCell>
                    <TableCell>{b.currentStockQuantity}</TableCell>
                    <TableCell>{b.purchasePrice}</TableCell>
                    <TableCell>{b.sellingPrice}</TableCell>
                    <TableCell>{b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Link href={`/supplier-returns/new?grnId=${grn.id}`}>
              <Button variant="outline">Return to supplier</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
