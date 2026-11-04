"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useI18n } from "@/lib/i18n";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppDialog } from "@/components/ui/use-app-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SupplierProduct {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  products: SupplierProduct[];
}

interface CatalogProduct {
  id: string;
  name: string;
}

interface ImportPreview {
  validRows: unknown[];
  errorRows: { index: number; errors: string }[];
}

type AddMode = "single" | "bulk";

export default function SuppliersPage() {
  const { confirm, dialog } = useAppDialog();
  const { t } = useI18n();
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addMode, setAddMode] = useState<AddMode>("single");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/suppliers?pageSize=100");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.suppliers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    fetch("/api/admin/products?pageSize=200")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCatalogProducts(d.products);
      })
      .catch(() => undefined);
  }, []);

  function resetForm() {
    setName("");
    setPhone("");
    setEmail("");
    setSelectedProductIds([]);
    setEditingId(null);
  }

  function toggleProduct(id: string) {
    setSelectedProductIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  function startEdit(s: Supplier) {
    setEditingId(s.id);
    setName(s.name);
    setPhone(s.phone ?? "");
    setEmail(s.email ?? "");
    setSelectedProductIds(s.products.map((p) => p.id));
    setAddMode("single");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name,
        phone: phone || undefined,
        email: email || undefined,
        productIds: selectedProductIds,
      });
      const res = editingId
        ? await fetch(`/api/admin/suppliers/${editingId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body,
          })
        : await fetch("/api/admin/suppliers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Save failed");
        return;
      }
      resetForm();
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function runBulkPreview() {
    setBulkMessage(null);
    setPreview(null);
    try {
      const res = await fetch("/api/admin/suppliers/import?mode=preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!data.ok) {
        setBulkMessage(data.error || t("common.previewFailed"));
        return;
      }
      setPreview({ validRows: data.validRows, errorRows: data.errorRows });
    } catch {
      setBulkMessage(t("common.previewFailed"));
    }
  }

  async function commitBulk() {
    setBulkBusy(true);
    setBulkMessage(null);
    try {
      const res = await fetch("/api/admin/suppliers/import?mode=commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!data.ok) {
        setBulkMessage(data.error || t("common.importFailed"));
        return;
      }
      setBulkMessage(`${t("common.imported")} ${data.importedCount}, ${t("common.skipped")} ${data.skippedCount}`);
      setPreview(null);
      setCsv("");
      void load();
    } catch {
      setBulkMessage(t("common.importFailed"));
    } finally {
      setBulkBusy(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("suppliers.deleteConfirm")))) return;
    const res = await fetch(`/api/admin/suppliers/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Delete failed");
    else void load();
  }

  return (
    <PageShell title={t("nav.suppliers")}>
      {dialog}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t("suppliers.allSuppliers")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("suppliers.phone")}</TableHead>
                    <TableHead>{t("suppliers.email")}</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.phone ?? "—"}</TableCell>
                      <TableCell>{s.email ?? "—"}</TableCell>
                      <TableCell>
                        {s.products.length > 0 ? (
                          <span className="text-sm text-muted-foreground">
                            {s.products.map((p) => p.name).join(", ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Link href={`/suppliers/${s.id}/statement`}>
                            <Button variant="outline" size="sm">{t("suppliers.statement")}</Button>
                          </Link>
                          <Button variant="outline" size="sm" onClick={() => startEdit(s)}>
                            {t("common.edit")}
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => void remove(s.id)}>
                            {t("common.delete")}
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
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? t("common.edit") : t("suppliers.addSuppliers")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2" aria-label="Supplier insert mode">
              <Button type="button" variant={addMode === "single" ? "default" : "outline"} onClick={() => setAddMode("single")}>
                {t("common.oneInsert")}
              </Button>
              <Button type="button" variant={addMode === "bulk" ? "default" : "outline"} onClick={() => setAddMode("bulk")}>
                {t("common.bulkInsert")}
              </Button>
            </div>
            {addMode === "single" ? <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="name">{t("common.name")}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">{t("suppliers.phone")}</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">{t("suppliers.email")}</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={150} />
              </div>
              <div className="space-y-1">
                <Label>Products</Label>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1" data-testid="supplier-product-picker">
                  {catalogProducts.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("common.noData")}</p>
                  )}
                  {catalogProducts.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(p.id)}
                        onChange={() => toggleProduct(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedProductIds.length} selected
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? t("common.loading") : editingId ? t("common.save") : t("common.create")}
                </Button>
                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    {t("common.cancel")}
                  </Button>
                )}
              </div>
            </form> : <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="supplier-csv">{t("common.csvContent")}</Label>
                <Link href="/api/admin/suppliers/import/template" prefetch={false} className="text-sm underline underline-offset-4">
                  {t("common.downloadTemplate")}
                </Link>
              </div>
              <textarea
                id="supplier-csv"
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setPreview(null); setBulkMessage(null); }}
                rows={8}
                className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                placeholder="name,contact_person,phone,email,address"
              />
              <Button type="button" variant="outline" onClick={() => void runBulkPreview()} disabled={!csv.trim() || bulkBusy}>
                {t("common.previewWritesNothing")}
              </Button>
              {bulkMessage && <p role="status" className="text-sm text-muted-foreground">{bulkMessage}</p>}
              {preview && <div className="space-y-1 text-sm">
                <p>{t("common.valid")}: {preview.validRows.length} · {t("common.errors")}: {preview.errorRows.length}</p>
                {preview.errorRows.slice(0, 10).map((row) => (
                  <p key={row.index} className="text-xs text-red-600">{t("common.row")} {row.index}: {row.errors}</p>
                ))}
                {preview.errorRows.length > 10 && <p className="text-xs text-muted-foreground">{t("common.moreErrors")} {preview.errorRows.length - 10}</p>}
                {preview.validRows.length > 0 && <Button type="button" onClick={() => void commitBulk()} disabled={bulkBusy}>
                  {bulkBusy ? t("common.importing") : `${t("common.import")} ${preview.validRows.length} ${t("suppliers.itemsPlural")}`}
                </Button>}
              </div>}
            </div>}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
