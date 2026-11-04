import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { notificationSubscriptions } from "@/db/schema";
import { getSession } from "@/lib/auth";

const linkCodes = new Map<string, { code: string; expiresAt: number }>();

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { chatId } = await req.json().catch(() => null);
  if (!chatId) {
    return NextResponse.json({ ok: false, error: "CHAT_ID_REQUIRED" }, { status: 400 });
  }

  const userId = session.user.id;
  const stored = linkCodes.get(userId);

  if (!stored || stored.expiresAt < Date.now()) {
    return NextResponse.json(
      { ok: false, error: "LINK_CODE_EXPIRED" },
      { status: 400 }
    );
  }

  const existing = await db
    .select()
    .from(notificationSubscriptions)
    .where(eq(notificationSubscriptions.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(notificationSubscriptions)
      .set({ telegramChatId: chatId, isEnabled: true })
      .where(eq(notificationSubscriptions.userId, userId));
  } else {
    await db.insert(notificationSubscriptions).values({
      userId,
      telegramChatId: chatId,
      isEnabled: true,
    });
  }

  linkCodes.delete(userId);

  return NextResponse.json({ ok: true });
}
