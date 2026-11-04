import "server-only";

import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getSession } from "@/lib/auth";

const markReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(100).default([]),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || v.ids.length > 0, {
    message: "ids or all=true required",
  });

// Inbox: own notifications + branch broadcasts (userId null), newest first.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 100));
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";

  const scope = [
    or(eq(notifications.userId, session.user.id), isNull(notifications.userId)),
    eq(notifications.branchId, session.user.branchId),
  ];
  if (unreadOnly) scope.push(eq(notifications.isRead, false));

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      message: notifications.message,
      channel: notifications.channel,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(...scope))
    .orderBy(desc(notifications.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return NextResponse.json({ ok: true, notifications: rows, page, pageSize });
}

// Mark read: explicit ids, or all=true for everything visible to the caller.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const parsed = markReadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "VALIDATION_ERROR", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.all) {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          or(eq(notifications.userId, session.user.id), isNull(notifications.userId)),
          eq(notifications.branchId, session.user.branchId),
          eq(notifications.isRead, false),
        ),
      );
    return NextResponse.json({ ok: true, markedAll: true });
  }

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        inArray(notifications.id, parsed.data.ids),
        or(eq(notifications.userId, session.user.id), isNull(notifications.userId)),
        eq(notifications.branchId, session.user.branchId),
      ),
    );
  return NextResponse.json({ ok: true, marked: parsed.data.ids.length });
}
