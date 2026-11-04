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
  debitNoteNumber: string;
  supplierName: string | null;
  returnDate: string;
  status: string;
}

export default function SupplierReturnsPage() {
  const [rows, setRows] = useState<SR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/supplier-returns?pageSize=100")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setRows(data.returns);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell
      title="Supplier Returns"
      subtitle="Debit notes — stock decrements on confirm"
      actions={
        <Link href="/supplier-returns/new">
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
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Debit note</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.debitNoteNumber}</TableCell>
                    <TableCell>{r.supplierName ?? "—"}</TableCell>
                    <TableCell>{new Date(r.returnDate).toLocaleDateString()}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                    <TableCell>
                      <Link href={`/supplier-returns/${r.id}`}>
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
