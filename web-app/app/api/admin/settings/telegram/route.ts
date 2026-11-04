import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getClientIp, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  getTelegramSettings,
  setTelegramSettings,
  type TelegramLanguage,
} from "@/lib/app-settings";

// Admin control plane for group Telegram notifications: enabled kill-switch
// + message language (my/en/both). The bot token + group chat ID stay in
// server env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — never in the DB.

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  language: z.enum(["my", "en", "both"]).optional(),
});

function chatStatus(): { configured: boolean; chatIdPreview: string | null } {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const tokenSet = !!process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!chatId || !tokenSet) return { configured: false, chatIdPreview: null };
  return {
    configured: true,
    chatIdPreview: chatId.length > 6 ? `${chatId.slice(0, 4)}…${chatId.slice(-4)}` : chatId,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const settings = await getTelegramSettings();
  return NextResponse.json({ ok: true, telegram: { ...settings, ...chatStatus() } });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const current = await getTelegramSettings();
  const next = {
    enabled: parsed.data.enabled ?? current.enabled,
    language: (parsed.data.language ?? current.language) as TelegramLanguage,
  };
  await setTelegramSettings(next);

  await audit({
    entityType: "AppSetting",
    entityId: "telegram",
    action: "update",
    description: `Telegram settings: enabled=${next.enabled} language=${next.language}`,
    newValues: next,
    userId: session.user.id,
    branchId: session.user.branchId,
    ipAddress: await getClientIp(),
  });

  return NextResponse.json({ ok: true, telegram: { ...next, ...chatStatus() } });
}
