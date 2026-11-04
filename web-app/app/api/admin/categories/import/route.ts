import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { categories } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const rowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  shortName: z.string().trim().min(1).max(10),
  taxRate: z.string().regex(/^\d+(\.\d{1,2})?$/).default("5.00"),
  isTaxExempt: z.coerce.boolean().default(false),
});

const bodySchema = z.object({
  csv: z.string().max(500_000).optional(),
  rows: z.array(rowSchema).max(1000).optional(),
});

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
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

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
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
    candidateRows = parseCsv(parsedBody.data.csv).map((raw, index) => ({
      __index: index,
      name: raw["name"] ?? "",
      shortName: raw["short_name"] ?? "",
      taxRate: raw["tax_rate"] || "5.00",
      isTaxExempt: ["true", "1", "yes"].includes(
        (raw["is_tax_exempt"] ?? "false").trim().toLowerCase(),
      ),
    }));
  } else {
    return NextResponse.json({ ok: false, error: "CSV_OR_ROWS_REQUIRED" }, { status: 400 });
  }

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
    validRows.push(parsed.data);
  });

  if (mode === "preview") {
    return NextResponse.json({ ok: true, validRows, errorRows });
  }

  let importedCount = 0;
  if (validRows.length > 0) {
    const inserted = await db
      .insert(categories)
      .values(
        validRows.map((r) => ({
          branchId: session.user.branchId,
          name: r.name,
          shortName: r.shortName,
          taxRate: r.taxRate,
          isTaxExempt: r.isTaxExempt,
        })),
      )
      .returning({ id: categories.id });
    importedCount = inserted.length;
  }

  await audit({
    entityType: "Category",
    entityId: session.user.branchId,
    action: "bulk_import",
    description: `Bulk imported ${importedCount} categories (${errorRows.length} skipped)`,
    newValues: { importedCount, skippedCount: errorRows.length },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json(
    { ok: true, importedCount, skippedCount: errorRows.length, errorRows },
    { status: 201 },
  );
}
