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

const TYPE_LABELS: Record<string, string> = {
  percentage: "% off",
  fixed: "Fixed $",
  bundle: "Bundle",
  seasonal: "Seasonal",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  deactivated: "Deactivated",
};

interface Promotion {
  id: string;
  name: string;
  type: string;
  value: string;
  startDate: string;
  endDate: string;
  status: string;
  isAiSuggested: boolean;
}

export default function PromotionsPage() {
  const [rows, setRows] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("type", typeFilter);
      const res = await fetch(`/api/admin/promotions?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.promotions);
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

  async function toggleStatus(p: Promotion, newStatus: string) {
    const res = await fetch(`/api/admin/promotions/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Update failed");
    else void load();
  }

  return (
    <PageShell
      title="Promotions"
      subtitle="Manual promotions only — AI suggestions are separate"
      actions={
        <>
          <Link href="/promotions/ai-suggested">
            <Button variant="outline">AI suggested</Button>
          </Link>
          <Link href="/promotions/new">
            <Button>New Promotion</Button>
          </Link>
        </>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>All Promotions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <LocalizedSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="deactivated">Deactivated</option>
            </LocalizedSelect>
            <LocalizedSelect
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-2 text-sm"
            >
              <option value="">All Types</option>
              <option value="percentage">% off</option>
              <option value="fixed">Fixed $</option>
              <option value="bundle">Bundle</option>
              <option value="seasonal">Seasonal</option>
            </LocalizedSelect>
            <Button variant="outline" onClick={() => void load()}>
              Filter
            </Button>
          </div>

          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>AI</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/promotions/${p.id}/edit`} className="text-primary hover:underline">
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{TYPE_LABELS[p.type] ?? p.type}</Badge>
                    </TableCell>
                    <TableCell>
                      {p.type === "percentage" ? `${p.value}%` : p.type === "fixed" ? `$${p.value}` : "Bundle/Seasonal"}
                    </TableCell>
                    <TableCell>
                      {new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : p.status === "draft" ? "secondary" : "destructive"}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {p.isAiSuggested ? <Badge variant="outline">AI</Badge> : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {p.status !== "active" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void toggleStatus(p, "active")}
                          >
                            Activate
                          </Button>
                        )}
                        {p.status !== "deactivated" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void toggleStatus(p, "deactivated")}
                          >
                            Deactivate
                          </Button>
                        )}
                        <Link href={`/promotions/${p.id}/edit`}>
                          <Button variant="ghost" size="sm">Edit</Button>
                        </Link>
                      </div>
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