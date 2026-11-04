import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { journalEntries } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { postJournal } from "@/lib/gl";

const manualJournalSchema = z.object({
  entryDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date").optional(),
  memo: z.string().trim().min(1).max(255),
  lines: z
    .array(
      z.object({
        accountCode: z.string().trim().min(1).max(20),
        debit: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
        credit: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0"),
      }),
    )
    .min(2),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));
  const branchId = url.searchParams.get("branchId") ?? session.user.branchId;

  const rows = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.refType, "manual"), eq(journalEntries.branchId, branchId)))
    .orderBy(desc(journalEntries.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, entries: rows, page, pageSize });
}

// Manual adjusting/correction entry — same balance validation as every
// posting; rejected before touching the ledger when unbalanced.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = manualJournalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { id } = await postJournal({
      branchId: session.user.branchId,
      entryDate: parsed.data.entryDate ? new Date(parsed.data.entryDate) : undefined,
      refType: "manual",
      memo: parsed.data.memo,
      lines: parsed.data.lines,
      createdBy: session.user.id,
    });

    await audit({
      entityType: "JournalEntry",
      entityId: id,
      action: "create",
      description: `Posted manual journal: ${parsed.data.memo}`,
      newValues: { memo: parsed.data.memo, lines: parsed.data.lines },
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });

    return NextResponse.json({ ok: true, entryId: id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Post failed";
    const status = message.startsWith("UNBALANCED") || message.startsWith("UNKNOWN") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
