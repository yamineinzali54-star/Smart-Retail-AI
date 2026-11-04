"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Float {
  id: string;
  holderUserId: string;
  holderName: string | null;
  issuedAmount: string;
  status: string;
  returnedAmount: string | null;
  notes: string | null;
  createdAt: string;
}

interface StaffUser {
  id: string;
  fullName: string;
  userName: string;
}

export default function PettyCashPage() {
  const [floats, setFloats] = useState<Float[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holderId, setHolderId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [closeAmounts, setCloseAmounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [f, s] = await Promise.all([
        fetch("/api/admin/petty-cash/floats").then((r) => r.json()),
        fetch("/api/admin/staff?pageSize=100").then((r) => r.json()),
      ]);
      if (!f.ok) throw new Error(f.error || "Failed to load floats");
      setFloats(f.floats);
      if (s.ok) {
        const active = (s.staff as StaffUser[]).filter((u) => u);
        setStaff(s.staff);
        if (!holderId && active.length > 0) setHolderId(active[0].id);
      }
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

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/petty-cash/floats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        holderUserId: holderId,
        issuedAmount: amount,
        notes: notes || undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(data.error || "Issue failed");
      return;
    }
    setAmount("");
    setNotes("");
    setMessage("Float issued");
    void load();
  }

  async function closeFloat(id: string) {
    setMessage(null);
    const res = await fetch("/api/admin/petty-cash/floats", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ floatId: id, returnedAmount: closeAmounts[id] ?? "0" }),
    });
    const data = await res.json();
    if (!data.ok) {
      setMessage(
        data.error === "CLOSE_MISMATCH"
          ? `Mismatch — issued ${data.issued}, spent ${data.spent}, expected return ${data.expectedReturn}`
          : data.error || "Close failed",
      );
      return;
    }
    setMessage("Float closed");
    void load();
  }

  return (
    <PageShell title="Petty Cash" subtitle="Imprest floats — issued vs spent + returned must reconcile" allow={["admin"]}>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Floats</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Holder</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Returned</TableHead>
                    <TableHead>Close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {floats.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{f.holderName ?? f.holderUserId.slice(0, 8)}</TableCell>
                      <TableCell>{f.issuedAmount}</TableCell>
                      <TableCell>
                        <Badge variant={f.status === "open" ? "default" : "secondary"}>{f.status}</Badge>
                      </TableCell>
                      <TableCell>{f.returnedAmount ?? "—"}</TableCell>
                      <TableCell>
                        {f.status === "open" && (
                          <div className="flex gap-1">
                            <Input
                              value={closeAmounts[f.id] ?? ""}
                              onChange={(e) =>
                                setCloseAmounts((m) => ({ ...m, [f.id]: e.target.value }))
                              }
                              placeholder="returned"
                              className="max-w-28"
                              inputMode="decimal"
                            />
                            <Button size="sm" variant="outline" onClick={() => void closeFloat(f.id)}>
                              Close
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Issue float</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={issue} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="holder">Holder</Label>
                <LocalizedSelect
                  id="holder"
                  value={holderId}
                  onChange={(e) => setHolderId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  required
                >
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName} ({u.userName})</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="amount">Amount</Label>
                <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="notes">Notes</Label>
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} />
              </div>
              <Button type="submit">Issue</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
