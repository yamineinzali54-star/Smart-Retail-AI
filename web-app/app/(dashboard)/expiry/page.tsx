"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppDialog } from "@/components/ui/use-app-dialog";

interface ExpiryRow {
  id: string;
  barcode: string;
  productName: string | null;
  currentStockQuantity: number;
  sellingPrice: string;
  expiryDate: string;
}

export default function ExpiryPage() {
  const { prompt, dialog } = useAppDialog();
  const [expired, setExpired] = useState<ExpiryRow[]>([]);
  const [soon, setSoon] = useState<ExpiryRow[]>([]);
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/expiry?daysThreshold=${Number(days) || 30}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setExpired(data.expired);
      setSoon(data.expiringSoon);
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

  async function writeOff(id: string) {
    const reason = await prompt("Provide a reason for writing off this stock.", {
      title: "Write off stock",
      inputLabel: "Reason",
      placeholder: "Damaged, expired, etc.",
    });
    if (!reason?.trim()) return;
    const res = await fetch(`/api/admin/expiry/${id}/write-off`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Write-off failed");
    else {
      setMessage("Written off");
      void load();
    }
  }

  function table(title: string, rows: ExpiryRow[], badge: "default" | "destructive") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {title} <Badge variant={badge}>{rows.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Barcode</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.barcode}</TableCell>
                  <TableCell>{r.productName ?? "—"}</TableCell>
                  <TableCell>{r.currentStockQuantity}</TableCell>
                  <TableCell>{new Date(r.expiryDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button variant="destructive" size="sm" onClick={() => void writeOff(r.id)}>
                      Write off
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <PageShell title="Expiry management">
      {dialog}
      <div className="flex items-center gap-2">
        <Input
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="max-w-32"
          inputMode="numeric"
          aria-label="Days threshold"
        />
        <Button variant="outline" onClick={() => void load()}>Apply threshold</Button>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {!loading && (
        <div className="grid gap-4">
          {table("Expired", expired, "destructive")}
          {table("Expiring soon", soon, "default")}
        </div>
      )}
    </PageShell>
  );
}
