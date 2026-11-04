import "server-only";

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { promotionProducts, promotions, products } from "@/db/schema";
import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

// POST /api/ai/basket/save — persist one AI-suggested bundle as a DRAFT
// promotion (is_ai_suggested = true, status = draft). Admin only, mirroring
// the manual promotion guards: both products must exist in-branch, bundle
// needs 2 products. Activation stays a separate Admin action at
// /promotions (PROJECT_PLAN.md §4 Rule 26 — AI never auto-activates).

const saveSchema = z.object({
  name: z.string().trim().min(1).max(150),
  productIds: z.array(z.string().uuid()).length(2),
  discountPct: z.number().min(1).max(90),
  validDays: z.number().int().min(1).max(365).default(30),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: session ? "FORBIDDEN" : "UNAUTHENTICATED" },
      { status: session ? 403 : 401 },
    );
  }

  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const { name, productIds, discountPct, validDays } = parsed.data;

  const found = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        inArray(products.id, productIds),
        eq(products.branchId, session.user.branchId),
        eq(products.isDeleted, false),
      ),
    );
  if (found.length !== productIds.length) {
    return NextResponse.json({ ok: false, error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }

  const now = new Date();
  const [draft] = await db
    .insert(promotions)
    .values({
      branchId: session.user.branchId,
      name,
      type: "bundle",
      value: discountPct.toFixed(2),
      startDate: now,
      endDate: new Date(now.getTime() + validDays * 86_400_000),
      status: "draft",
      isAiSuggested: true,
      createdBy: session.user.id,
    })
    .returning({ id: promotions.id, name: promotions.name });

  await db.insert(promotionProducts).values(
    productIds.map((productId) => ({
      promotionId: draft.id,
      productId,
      requiredQuantity: 1,
    })),
  );

  await audit({
    entityType: "Promotion",
    entityId: draft.id,
    action: "create",
    description: `Saved AI-suggested bundle draft: ${name}`,
    newValues: { name, productIds, discountPct, isAiSuggested: true },
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, promotion: draft }, { status: 201 });
}
