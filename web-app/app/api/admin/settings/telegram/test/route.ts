import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { branches } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getTelegramSettings } from "@/lib/app-settings";
import { formatTelegramMessage, sendTelegramMessage } from "@/lib/telegram";

// POST /api/admin/settings/telegram/test — send a live test message to the
// group in the currently configured language. Admin only.
export async function POST() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const [branch] = await db
    .select({ code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.id, session.user.branchId))
    .limit(1);
  const settings = await getTelegramSettings();
  const text = formatTelegramMessage(
    "test",
    {
      branchCode: branch?.code ?? "—",
      branchName: branch?.name ?? "",
    },
    settings.language,
  );
  const result = await sendTelegramMessage(text);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "TELEGRAM_SEND_ERROR" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
