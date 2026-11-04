import "server-only";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { categories } from "@/db/schema";
import { getSession, getClientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  shortName: z.string().trim().min(1).max(10),
  taxRate: z.string().regex(/^\d+(\.\d{1,2})?$/).default("5.00"),
  isTaxExempt: z.boolean().default(false),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));

  const allCategories = await db
    .select()
    .from(categories)
    .where(
      and(eq(categories.branchId, session.user.branchId), eq(categories.isDeleted, false)),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, categories: allCategories, page, pageSize });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (session.user.role !== "admin" && session.user.role !== "inventory") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }

  const parsed = createCategorySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [newCategory] = await db
    .insert(categories)
    .values({
      branchId: session.user.branchId,
      name: parsed.data.name,
      shortName: parsed.data.shortName,
      taxRate: parsed.data.taxRate,
      isTaxExempt: parsed.data.isTaxExempt,
    })
    .returning();

  await audit({
    entityType: "Category",
    entityId: newCategory.id,
    action: "create",
    description: `Created category: ${parsed.data.name}`,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, category: newCategory }, { status: 201 });
}
