"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BranchTotal {
  id: string;
  code: string;
  name: string;
  sales: string;
  orders: string;
}

// Batch 2 #14 — multi-branch consolidated view: per-branch sales cards plus
// an all-branches aggregate, fed by the branch-aware sales report.
export default function BranchScopeCards() {
  const [rows, setRows] = useState<BranchTotal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const bRes = await fetch("/api/auth/branches");
        const bData = await bRes.json();
        if (!bData.ok) return;
        const totals: BranchTotal[] = [];
        for (const b of bData.branches as Array<{ id: string; code: string; name: string }>) {
          try {
            const rRes = await fetch(
              `/api/admin/reports/sales?branchId=${b.id}&pageSize=1`,
            );
            const rData = await rRes.json();
            if (rData.ok) {
              totals.push({
                id: b.id,
                code: b.code,
                name: b.name,
                sales: rData.totals?.totalAmount ?? "0",
                orders: rData.totals?.totalSales ?? "0",
              });
            }
          } catch {
            // One branch failing must not hide the others.
          }
        }
        setRows(totals);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading branch totals…</p>;
  }
  if (rows.length <= 1) return null;

  const allSales = rows.reduce((s, r) => s + Number(r.sales), 0);
  const allOrders = rows.reduce((s, r) => s + Number(r.orders), 0);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle>All branches</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{allSales.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">{allOrders} orders</p>
        </CardContent>
      </Card>
      {rows.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle>
              <Link href="/reports/sales" className="hover:underline">
                {r.code} — {r.name}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{Number(r.sales).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">{r.orders} orders</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
