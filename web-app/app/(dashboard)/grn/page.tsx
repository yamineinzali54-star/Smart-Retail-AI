"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface GRN {
  id: string;
  grnNumber: string;
  poNumber: string | null;
  supplierName: string | null;
  receivedDate: string;
}

export default function GrnPage() {
  const [rows, setRows] = useState<GRN[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [poNumber, setPoNumber] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (poNumber.trim()) params.set("poNumber", poNumber.trim());
      const res = await fetch(`/api/admin/grn?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.grns);
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
    <PageShell title="GRN Receiving" subtitle="Goods received notes — UOM conversion happens here">
      <Card>
        <CardHeader>
          <CardTitle>All GRNs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Filter by PO number…" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="max-w-xs" />
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN number</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>{g.grnNumber}</TableCell>
                    <TableCell>{g.poNumber ?? "—"}</TableCell>
                    <TableCell>{g.supplierName ?? "—"}</TableCell>
                    <TableCell>{new Date(g.receivedDate).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Link href={`/grn/${g.id}`}>
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
