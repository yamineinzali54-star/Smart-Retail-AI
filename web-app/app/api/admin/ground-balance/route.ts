import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { branches, groundBalanceDetails, groundBalances, items } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildGroundBalanceBatch } from "@/lib/numbers";

const createGroundBalanceSchema = z.object({
  gbDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "invalid date"),
  remark: z.string().max(100).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        actualQty: z.number().int().min(0),
        remark: z.string().max(100).optional(),
      }),
    )
    .min(1),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const allGroundBalances = await db
    .select()
    .from(groundBalances)
    .where(eq(groundBalances.branchId, session.user.branchId))
    .orderBy(desc(groundBalances.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, groundBalances: allGroundBalances, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || (session.user.role !== "admin" && session.user.role !== "inventory")) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createGroundBalanceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { gbDate, remark, lines } = parsed.data;

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const branchItems = await db
    .select({ id: items.id, currentStockQuantity: items.currentStockQuantity })
    .from(items)
    .where(and(inArray(items.id, itemIds), eq(items.branchId, session.user.branchId)));
  if (branchItems.length !== itemIds.length) {
    return NextResponse.json({ ok: false, error: "ITEM_NOT_FOUND" }, { status: 404 });
  }
  const stockByItem = new Map(branchItems.map((i) => [i.id, i.currentStockQuantity ?? 0]));

  const [branch] = await db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);

  let batchNo = "";
  try {
    await db.transaction(async (tx) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !batchNo; attempt++) {
        try {
          const candidate = buildGroundBalanceBatch(branch?.code ?? "BR");
          const [gb] = await tx
            .insert(groundBalances)
            .values({
              batchNo: candidate,
              branchId: session.user.branchId,
              gbDate: new Date(gbDate),
              status: "pending",
              remark: remark ?? null,
              createdBy: session.user.id,
            })
            .returning({ batchNo: groundBalances.batchNo });
          // §4 R18 — server re-looks-up inventoryQty live; count-only, no write-back.
          await tx.insert(groundBalanceDetails).values(
            lines.map((line) => {
              const inventoryQty = stockByItem.get(line.itemId) ?? 0;
              return {
                batchNo: gb.batchNo,
                itemId: line.itemId,
                actualQty: line.actualQty,
                inventoryQty,
                differenceQty: line.actualQty - inventoryQty,
                remark: line.remark ?? null,
              };
            }),
          );
          batchNo = gb.batchNo;
        } catch (err) {
          lastError = err;
        }
      }
      if (!batchNo) throw lastError;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "BATCH_NUMBER_COLLISION" }, { status: 409 });
  }

  await audit({
    entityType: "GroundBalance",
    entityId: batchNo,
    action: "create",
    description: `Created ground balance: ${batchNo}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, groundBalance: { batchNo } }, { status: 201 });
}
