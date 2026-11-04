"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { downloadCsv } from "@/components/export-csv";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface APRow {
  supplierId: string;
  supplierName: string;
  totalAmount: string;
  paidAmount: string;
  balance: string;
  aging: { d0_30: string; d31_60: string; d60plus: string };
}

export default function AccountsPayablePage() {
  const [rows, setRows] = useState<APRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/reports/accounts-payable")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setRows(data.payables);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell title="Accounts payable" subtitle="Outstanding per supplier with aging" allow={["admin"]}>
      <div>
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv(
              "accounts-payable",
              ["supplier", "billed", "paid", "balance", "d0_30", "d31_60", "d60plus"],
              rows.map((r) => [r.supplierName, r.totalAmount, r.paidAmount, r.balance, r.aging.d0_30, r.aging.d31_60, r.aging.d60plus]),
            )
          }
        >
          Export CSV
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Payables</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Billed</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>0–30d</TableHead>
                  <TableHead>31–60d</TableHead>
                  <TableHead>60+d</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.supplierId}>
                    <TableCell>{r.supplierName}</TableCell>
                    <TableCell>{r.totalAmount}</TableCell>
                    <TableCell>{r.paidAmount}</TableCell>
                    <TableCell className="font-medium">{r.balance}</TableCell>
                    <TableCell>{r.aging.d0_30}</TableCell>
                    <TableCell>{r.aging.d31_60}</TableCell>
                    <TableCell>{r.aging.d60plus}</TableCell>
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
