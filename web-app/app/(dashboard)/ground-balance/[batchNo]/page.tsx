"use client";

import { use, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Line {
  id: string;
  itemId: string;
  productName: string | null;
  barcode: string | null;
  actualQty: number;
  inventoryQty: number;
  differenceQty: number;
  remark: string | null;
}

interface GB {
  batchNo: string;
  status: string;
  remark: string | null;
  details: Line[];
}

export default function GroundBalanceDetailPage({ params }: { params: Promise<{ batchNo: string }> }) {
  const { batchNo } = use(params);
  const [gb, setGb] = useState<GB | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/ground-balance/${encodeURIComponent(batchNo)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setGb(data.groundBalance);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [batchNo]);

  return (
    <PageShell title={decodeURIComponent(batchNo)}>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {gb && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Badge variant="secondary">{gb.status}</Badge> {gb.remark ?? ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead>Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gb.details.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.barcode ?? "—"}</TableCell>
                    <TableCell>{d.productName ?? "—"}</TableCell>
                    <TableCell>{d.actualQty}</TableCell>
                    <TableCell>{d.inventoryQty}</TableCell>
                    <TableCell className={d.differenceQty !== 0 ? "font-bold text-red-600" : ""}>
                      {d.differenceQty}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
