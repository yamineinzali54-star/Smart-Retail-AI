"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Branch {
  id: string;
  code: string;
  name: string;
  cashDiscrepancyThreshold: string;
  roundingUnit: number;
  registrationNo: string | null;
  taxInvoicePrefix: string | null;
  poApprovalThreshold: string | null;
}

export default function BranchesPage() {
  const [rows, setRows] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/branches?pageSize=100");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.branches);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  function SettingsEditor({ branch, onSaved }: {
    branch: Branch;
    onSaved: () => void;
  }) {
    const [open, setOpen] = useState(false);
    const [regNo, setRegNo] = useState(branch.registrationNo ?? "");
    const [prefix, setPrefix] = useState(branch.taxInvoicePrefix ?? "");
    const [threshold, setThreshold] = useState(branch.poApprovalThreshold ?? "");
    const [msg, setMsg] = useState<string | null>(null);

    async function save() {
      setMsg(null);
      const res = await fetch(`/api/admin/branches/${branch.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          registrationNo: regNo.trim() === "" ? null : regNo.trim(),
          taxInvoicePrefix: prefix.trim() === "" ? null : prefix.trim(),
          poApprovalThreshold: threshold.trim() === "" ? null : threshold.trim(),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error || "Save failed");
        return;
      }
      setOpen(false);
      onSaved();
    }

    if (!open) {
      return (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {[branch.registrationNo, branch.taxInvoicePrefix, branch.poApprovalThreshold ? `PO≥${branch.poApprovalThreshold}` : null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </Button>
      );
    }
    return (
      <div className="space-y-1 text-xs">
        <Input value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="Reg. no" className="h-7" aria-label="Registration number" maxLength={50} />
        <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Tax prefix" className="h-7" aria-label="Tax invoice prefix" maxLength={10} />
        <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="PO approval ≥ (blank=off)" className="h-7" aria-label="PO approval threshold" />
        <div className="flex gap-1">
          <Button size="sm" onClick={() => void save()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>X</Button>
        </div>
        {msg && <p className="text-red-600">{msg}</p>}
      </div>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/branches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.toUpperCase(), name }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Create failed");
      return;
    }
    setCode("");
    setName("");
    void load();
  }

  return (
    <PageShell title="Branches" subtitle="Single-branch-first: the seeded branch runs the shop" allow={["admin"]}>
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>All branches</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Cash alert ≥</TableHead>
                    <TableHead>Rounding</TableHead>
                    <TableHead>Tax / Approval</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.code}</TableCell>
                      <TableCell>{b.name}</TableCell>
                      <TableCell>{b.cashDiscrepancyThreshold}</TableCell>
                      <TableCell>{b.roundingUnit}</TableCell>
                      <TableCell>
                        <SettingsEditor branch={b} onSaved={() => void load()} />
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
            <CardTitle>New branch</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="code">Code (2–4 letters)</Label>
                <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} required minLength={2} maxLength={4} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
              </div>
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
