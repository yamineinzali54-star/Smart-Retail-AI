import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { categories, products, units } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const rowSchema = z.object({
  name: z.string().trim().min(1).max(150),
  categoryName: z.string().trim().min(1).max(100).optional(),
  categoryId: z.string().uuid().optional(),
  unitName: z.string().trim().min(1).max(50).optional(),
  unitId: z.string().uuid().optional(),
  reorderThreshold: z.coerce.number().int().min(0).default(5),
});

const bodySchema = z.object({
  csv: z.string().max(500_000).optional(),
  rows: z.array(rowSchema).max(1000).optional(),
});

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function normalizeRawRow(raw: Record<string, string>, index: number) {
  return {
    __index: index,
    name: raw["name"] ?? "",
    categoryName: raw["category_name"] || raw["categoryname"] || undefined,
    categoryId: raw["category_id"] || raw["categoryid"] || undefined,
    unitName: raw["unit_name"] || raw["unitname"] || undefined,
    unitId: raw["unit_id"] || raw["unitid"] || undefined,
    reorderThreshold: raw["reorder_threshold"] ?? "5",
  };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (
    !session ||
    (session.user.role !== "admin" && session.user.role !== "inventory")
  ) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "commit" ? "commit" : "preview";

  const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  let candidateRows: unknown[] = [];
  if (parsedBody.data.rows) {
    candidateRows = parsedBody.data.rows;
  } else if (parsedBody.data.csv) {
    candidateRows = parseCsv(parsedBody.data.csv).map(normalizeRawRow);
  } else {
    return NextResponse.json({ ok: false, error: "CSV_OR_ROWS_REQUIRED" }, { status: 400 });
  }

  // Reject duplicate names within the same file (§9)
  const seen = new Set<string>();
  const validRows: z.infer<typeof rowSchema>[] = [];
  const errorRows: { index: number; errors: string }[] = [];

  candidateRows.forEach((row, i) => {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      errorRows.push({ index: i, errors: JSON.stringify(parsed.error.flatten().fieldErrors) });
      return;
    }
    const key = parsed.data.name.trim().toLowerCase();
    if (seen.has(key)) {
      errorRows.push({ index: i, errors: "duplicate name within file" });
      return;
    }
    seen.add(key);
    if (!parsed.data.categoryId && !parsed.data.categoryName) {
      errorRows.push({ index: i, errors: "categoryId or categoryName required" });
      return;
    }
    if (!parsed.data.unitId && !parsed.data.unitName) {
      errorRows.push({ index: i, errors: "unitId or unitName required" });
      return;
    }
    validRows.push(parsed.data);
  });

  if (mode === "preview") {
    return NextResponse.json({ ok: true, validRows, errorRows });
  }

  // commit: resolve category/unit by name within branch, insert in one transaction
  const branchCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(eq(categories.branchId, session.user.branchId), eq(categories.isDeleted, false)),
    );
  const branchUnits = await db
    .select({ id: units.id, name: units.name })
    .from(units)
    .where(and(eq(units.branchId, session.user.branchId), eq(units.isDeleted, false)));
  const categoryByName = new Map(branchCategories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const unitByName = new Map(branchUnits.map((u) => [u.name.trim().toLowerCase(), u.id]));

  const toInsert: { branchId: string; name: string; categoryId: string; unitId: string; reorderThreshold: number }[] = [];
  const commitErrors: { index: number; errors: string }[] = [...errorRows];

  validRows.forEach((row, i) => {
    const categoryId =
      row.categoryId ?? (row.categoryName ? categoryByName.get(row.categoryName.trim().toLowerCase()) : undefined);
    const unitId =
      row.unitId ?? (row.unitName ? unitByName.get(row.unitName.trim().toLowerCase()) : undefined);
    if (!categoryId) {
      commitErrors.push({ index: i, errors: "category not found in branch" });
      return;
    }
    if (!unitId) {
      commitErrors.push({ index: i, errors: "unit not found in branch" });
      return;
    }
    toInsert.push({
      branchId: session.user.branchId,
      name: row.name,
      categoryId,
      unitId,
      reorderThreshold: row.reorderThreshold,
    });
  });

  let imported: { id: string }[] = [];
  if (toInsert.length > 0) {
    imported = await db.transaction(async (tx) => {
      const inserted = await tx.insert(products).values(toInsert).returning({ id: products.id });
      return inserted;
    });
  }

  await audit({
    entityType: "Product",
    entityId: session.user.branchId,
    action: "bulk_import",
    description: `Bulk imported ${imported.length} products (${commitErrors.length} skipped)`,
    newValues: { importedCount: imported.length, skippedCount: commitErrors.length },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, importedCount: imported.length, skippedCount: commitErrors.length, errorRows: commitErrors },
    { status: 201 },
  );
}
