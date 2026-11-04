"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Sale {
  id: string;
  saleNumber: string;
  grandTotal: string;
  paymentMethod: string;
  status: string;
  saleDate: string;
}

export default function TodaySalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState("0.00");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pos/today-sales")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setSales(data.sales);
        setCount(data.count);
        setTotal(data.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell title="Today's sales" subtitle={`${count} completed · total ${total}`}>
      <Card>
        <CardHeader>
          <CardTitle>Sales today</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sale</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.saleNumber}</TableCell>
                    <TableCell>{new Date(s.saleDate).toLocaleTimeString()}</TableCell>
                    <TableCell>{s.paymentMethod}</TableCell>
                    <TableCell><Badge variant="secondary">{s.status}</Badge></TableCell>
                    <TableCell>{s.grandTotal}</TableCell>
                    <TableCell>
                      <a href={`/pos/receipt/${s.id}`} className="text-sm text-primary hover:underline">
                        Receipt
                      </a>
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
