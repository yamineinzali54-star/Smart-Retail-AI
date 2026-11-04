"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppDialog } from "@/components/ui/use-app-dialog";

interface Category {
  id: string;
  name: string;
  shortName: string;
  taxRate: string;
  isTaxExempt: boolean;
}

interface ImportPreview {
  validRows: unknown[];
  errorRows: { index: number; errors: string }[];
}

type AddMode = "single" | "bulk";

export default function CategoriesPage() {
  const { confirm, dialog } = useAppDialog();
  const { t } = useI18n();
  const [rows, setRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [taxRate, setTaxRate] = useState("5.00");
  const [addMode, setAddMode] = useState<AddMode>("single");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/categories?pageSize=100");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, shortName, taxRate }),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error || "Create failed");
      return;
    }
    setName("");
    setShortName("");
    setTaxRate("5.00");
    void load();
  }

  async function runBulkPreview() {
    setBulkMessage(null);
    setPreview(null);
    try {
      const res = await fetch("/api/admin/categories/import?mode=preview", {
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
      const res = await fetch("/api/admin/categories/import?mode=commit", {
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
    if (!(await confirm(t("categories.deleteConfirm")))) return;
    const res = await fetch(`/api/admin/categories/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Delete failed");
    else void load();
  }

  return (
    <PageShell title={t("nav.categories")} subtitle={t("categories.taxSubtitle")}>
      {dialog}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t("categories.allCategories")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("categories.short")}</TableHead>
                    <TableHead>{t("categories.taxPercent")}</TableHead>
                    <TableHead>{t("categories.exempt")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.shortName}</TableCell>
                      <TableCell>{c.taxRate}</TableCell>
                      <TableCell>
                        {c.isTaxExempt ? <Badge variant="secondary">{t("categories.exempt")}</Badge> : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="destructive" size="sm" onClick={() => void remove(c.id)}>
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
            <CardTitle>{t("categories.addCategories")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2" aria-label="Category insert mode">
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
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="short">{t("categories.shortNameBarcode")}</Label>
                <Input id="short" value={shortName} onChange={(e) => setShortName(e.target.value)} required maxLength={10} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tax">{t("categories.taxRate")}</Label>
                <Input id="tax" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} required pattern="^\d+(\.\d{1,2})?$" />
              </div>
              <Button type="submit">{t("common.create")}</Button>
            </form> : <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="category-csv">{t("common.csvContent")}</Label>
                <Link href="/api/admin/categories/import/template" prefetch={false} className="text-sm underline underline-offset-4">
                  {t("common.downloadTemplate")}
                </Link>
              </div>
              <textarea
                id="category-csv"
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setPreview(null); setBulkMessage(null); }}
                rows={8}
                className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                placeholder="name,short_name,tax_rate,is_tax_exempt"
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
                  {bulkBusy ? t("common.importing") : `${t("common.import")} ${preview.validRows.length} ${t("categories.items")}`}
                </Button>}
              </div>}
            </div>}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
