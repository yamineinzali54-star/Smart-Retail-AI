"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";
import Link from "next/link";

import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppDialog } from "@/components/ui/use-app-dialog";

interface Product {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string | null;
  unitId: string;
  unitName: string | null;
  reorderThreshold: number;
}

interface Option {
  id: string;
  name: string;
}

interface ImportPreview {
  validRows: unknown[];
  errorRows: { index: number; errors: string }[];
}

type AddMode = "single" | "bulk";

export default function ProductsPage() {
  const { confirm, dialog } = useAppDialog();
  const { t } = useI18n();
  const [rows, setRows] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [threshold, setThreshold] = useState("5");
  const [addMode, setAddMode] = useState<AddMode>("single");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, c, u] = await Promise.all([
        fetch("/api/admin/products?pageSize=100").then((r) => r.json()),
        fetch("/api/admin/categories?pageSize=100").then((r) => r.json()),
        fetch("/api/admin/units?pageSize=100").then((r) => r.json()),
      ]);
      if (!p.ok) throw new Error(p.error || "Failed to load products");
      setRows(p.products);
      if (c.ok) {
        setCategories(c.categories);
        if (!categoryId && c.categories.length > 0) setCategoryId(c.categories[0].id);
      }
      if (u.ok) {
        setUnits(u.units);
        if (!unitId && u.units.length > 0) setUnitId(u.units[0].id);
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        categoryId,
        unitId,
        reorderThreshold: Number(threshold) || 0,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Create failed");
      return;
    }
    setName("");
    void load();
  }

  async function runBulkPreview() {
    setBulkMessage(null);
    setPreview(null);
    try {
      const res = await fetch("/api/admin/products/import?mode=preview", {
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
      const res = await fetch("/api/admin/products/import?mode=commit", {
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
    if (!(await confirm("Soft-delete this product?"))) return;
    const res = await fetch(`/api/admin/products/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Delete failed");
    else void load();
  }

  const filtered = rows.filter((r) =>
    r.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <PageShell
      title={t("nav.products")}
      subtitle={t("products.catalogSubtitle")}
    >
      {dialog}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t("products.allProducts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder={`${t("common.search")}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
            {loading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("common.category")}</TableHead>
                    <TableHead>{t("common.unit")}</TableHead>
                    <TableHead>{t("products.reorderAt")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.categoryName ?? "—"}</TableCell>
                      <TableCell>{p.unitName ?? "—"}</TableCell>
                      <TableCell>{p.reorderThreshold}</TableCell>
                      <TableCell>
                        <Button variant="destructive" size="sm" onClick={() => void remove(p.id)}>
                          {t("common.delete")}
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
            <CardTitle>{t("products.addProducts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2" aria-label="Product insert mode">
              <Button type="button" variant={addMode === "single" ? "default" : "outline"} onClick={() => setAddMode("single")}>
                {t("common.oneInsert")}
              </Button>
              <Button type="button" variant={addMode === "bulk" ? "default" : "outline"} onClick={() => setAddMode("bulk")}>
                {t("common.bulkInsert")}
              </Button>
            </div>
            {addMode === "single" ? <form onSubmit={create} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="name">{t("common.name")}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat">{t("common.category")}</Label>
                <LocalizedSelect
                  id="cat"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  required
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="unit">{t("products.saleUnit")}</Label>
                <LocalizedSelect
                  id="unit"
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  required
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="thr">{t("products.reorderThreshold")}</Label>
                <Input id="thr" value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="numeric" />
              </div>
              <Button type="submit">{t("common.create")}</Button>
            </form> : <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="product-csv">{t("common.csvContent")}</Label>
                <Link href="/api/admin/products/import/template" prefetch={false} className="text-sm underline underline-offset-4">
                  {t("common.downloadTemplate")}
                </Link>
              </div>
              <textarea
                id="product-csv"
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setPreview(null); setBulkMessage(null); }}
                rows={8}
                className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                placeholder="name,category_name,unit_name,reorder_threshold"
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
                  {bulkBusy ? t("common.importing") : `${t("common.import")} ${preview.validRows.length} ${t("products.items")}`}
                </Button>}
              </div>}
            </div>}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
