"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppDialog } from "@/components/ui/use-app-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Unit {
  id: string;
  name: string;
  shortName: string;
}

export default function UnitsPage() {
  const { confirm, dialog } = useAppDialog();
  const [rows, setRows] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/units?pageSize=100");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.units);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/units", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, shortName }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Create failed");
      return;
    }
    setName("");
    setShortName("");
    void load();
  }

  async function remove(id: string) {
    if (!(await confirm("Soft-delete this unit?"))) return;
    const res = await fetch(`/api/admin/units/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Delete failed");
    else void load();
  }

  return (
    <PageShell title="Units" subtitle="Sale and purchase units (e.g. PCS, KG, Carton)">
      {dialog}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>All units</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Short</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.name}</TableCell>
                      <TableCell>{u.shortName}</TableCell>
                      <TableCell>
                        <Button variant="destructive" size="sm" onClick={() => void remove(u.id)}>
                          Delete
                        </Button>
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
            <CardTitle>New unit</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={50} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="short">Short name</Label>
                <Input id="short" value={shortName} onChange={(e) => setShortName(e.target.value)} required maxLength={10} />
              </div>
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
