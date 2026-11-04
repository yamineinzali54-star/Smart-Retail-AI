"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

// PROJECT_PLAN.md §8.6 review queue: AI-suggested drafts (from /ai/basket)
// wait here for Admin activation. AI never auto-activates (§4 Rule 26) —
// activation is an explicit button below, same API as manual promotions.
export default function AiSuggestedPromotionsPage() {
  const [rows, setRows] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/promotions?status=draft&pageSize=100");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows((data.promotions as Promotion[]).filter((p) => p.isAiSuggested));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, []);

  async function setStatus(p: Promotion, status: string) {
    const res = await fetch(`/api/admin/promotions/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Update failed");
    else void load();
  }

  return (
    <PageShell
      title="AI-Suggested Promotions"
      subtitle="Draft bundles from market-basket analysis — review, then activate or discard"
      allow={["admin"]}
      actions={
        <Link href="/promotions">
          <Button variant="outline">All promotions</Button>
        </Link>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Pending review ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing waiting — mine rules at{" "}
              <Link href="/ai/basket" className="text-primary hover:underline">
                /ai/basket
              </Link>{" "}
              and save drafts from there.
            </p>
          )}
          {!loading && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Source</TableHead>
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
                      {p.type === "percentage" ? `${p.value}%` : p.type === "fixed" ? `$${p.value}` : "Bundle"}
                    </TableCell>
                    <TableCell>
                      {new Date(p.startDate).toLocaleDateString()} – {new Date(p.endDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">AI</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => void setStatus(p, "active")}>
                          Activate
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void setStatus(p, "deactivated")}>
                          Discard
                        </Button>
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
