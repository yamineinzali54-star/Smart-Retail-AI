import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { postJournal } from "@/lib/gl";

const openingSchema = z.object({
  entryDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  memo: z.string().max(255).optional(),
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

// Opening balances for go-live cutover: one balanced entry, backdated.
// Rejects unbalanced input before touching the ledger.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = openingSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { id } = await postJournal({
      branchId: session.user.branchId,
      entryDate: new Date(parsed.data.entryDate),
      refType: "opening",
      memo: parsed.data.memo ?? "Opening balances (go-live cutover)",
      lines: parsed.data.lines,
      createdBy: session.user.id,
    });

    await audit({
      entityType: "JournalEntry",
      entityId: id,
      action: "create",
      description: `Posted opening balances (${parsed.data.lines.length} lines)`,
      newValues: { entryDate: parsed.data.entryDate, lines: parsed.data.lines },
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
