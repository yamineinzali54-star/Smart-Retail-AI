"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface PL {
  revenue: string;
  discounts: string;
  tax: string;
  cogs: string;
  grossProfit: string;
  expenses: string;
  netProfit: string;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between border-b py-2 text-sm ${bold ? "font-bold text-base" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function ProfitLossPage() {
  const [pl, setPl] = useState<PL | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (start) params.set("startDate", new Date(start).toISOString());
      if (end) params.set("endDate", new Date(end).toISOString());
      const res = await fetch(`/api/admin/reports/profit-loss?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setPl(data.profitLoss);
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

  function exportCsv() {
    if (!pl) return;
    const csv = ["line,amount",
      `revenue,${pl.revenue}`, `discounts,${pl.discounts}`, `tax,${pl.tax}`,
      `cogs,${pl.cogs}`, `gross_profit,${pl.grossProfit}`, `expenses,${pl.expenses}`,
      `net_profit,${pl.netProfit}`].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "profit-loss.csv";
    a.click();
  }

  return (
    <PageShell title="Profit & Loss" subtitle="Revenue − COGS − operating expenses" allow={["admin"]}>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Statement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="max-w-48" aria-label="Start date" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="max-w-48" aria-label="End date" />
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
            <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {pl && (
            <div>
              <Row label="Revenue" value={pl.revenue} />
              <Row label="Discounts" value={pl.discounts} />
              <Row label="Tax collected" value={pl.tax} />
              <Row label="Cost of goods sold" value={pl.cogs} />
              <Row label="Gross profit" value={pl.grossProfit} bold />
              <Row label="Operating expenses" value={pl.expenses} />
              <Row label="Net profit" value={pl.netProfit} bold />
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
