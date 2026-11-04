import "server-only";

import { getTelegramSettings, type TelegramLanguage } from "@/lib/app-settings";

// Telegram group notifications (Bot HTTP API). Fail-open by design: every
// public function here either returns { ok: false } or swallows errors —
// a Telegram outage must never break POS checkout, session close, or the
// alert scan. Callers fire-and-forget with `void notifyTelegram(...)`.

export type TelegramAlertType = "low_stock" | "expiry" | "cash_discrepancy" | "test";

export interface TelegramAlertPayload {
  branchCode: string;
  branchName: string;
  // low_stock
  lowStockCount?: number;
  // expiry
  expiredCount?: number;
  expiringSoonCount?: number;
  daysThreshold?: number;
  // cash_discrepancy
  difference?: string;
  threshold?: string;
  sessionLabel?: string;
}

export function escapeHtml(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function header(branchCode: string, branchName: string): string {
  return `<b>SmartRetailAI — ${escapeHtml(branchCode)} ${escapeHtml(branchName)}</b>`;
}

export function formatTelegramMessage(
  type: TelegramAlertType,
  payload: TelegramAlertPayload,
  language: TelegramLanguage,
): string {
  const lines: string[] = [header(payload.branchCode, payload.branchName), ""];
  const push = (my: string, en: string) => {
    if (language === "my") lines.push(my);
    else if (language === "en") lines.push(en);
    else lines.push(my, en);
  };

  switch (type) {
    case "low_stock": {
      const n = payload.lowStockCount ?? 0;
      push(
        `⚠️ ကုန်ပစ္စည်းပြတ်လပ်မှု သတိပေးချက်: ကုန်ပစ္စည်း <b>${n}</b> ခု reorder ပမာဏအောက် ရောက်နေပါပြီ။`,
        `⚠️ Low stock alert: <b>${n}</b> product(s) at or below reorder threshold.`,
      );
      break;
    }
    case "expiry": {
      const expired = payload.expiredCount ?? 0;
      const soon = payload.expiringSoonCount ?? 0;
      const days = payload.daysThreshold ?? 30;
      push(
        `⚠️ သက်တမ်းကုန်သတိပေးချက်: သက်တမ်းကုန်ပြီး <b>${expired}</b> ခု၊ ${days} ရက်အတွင်း ကုန်မည့်ဟာ <b>${soon}</b> ခု ရှိပါတယ်။`,
        `⚠️ Expiry alert: <b>${expired}</b> expired, <b>${soon}</b> expiring within ${days} days.`,
      );
      break;
    }
    case "cash_discrepancy": {
      const diff = escapeHtml(payload.difference ?? "0");
      const threshold = escapeHtml(payload.threshold ?? "0");
      const session = payload.sessionLabel ? ` (${escapeHtml(payload.sessionLabel)})` : "";
      push(
        `💰 ငွေစာရင်းကွာခြားမှု${session}: <b>${diff}</b> Ks (သတ်မှတ်ချက် ${threshold} Ks ကျော်နေပါတယ်)။`,
        `💰 Cash discrepancy${session}: <b>${diff}</b> Ks (over threshold ${threshold} Ks).`,
      );
      break;
    }
    case "test": {
      push(
        `✅ Telegram ချိတ်ဆက်မှု အောင်မြင်ပါတယ်။ SmartRetailAI သတိပေးချက်များ ဒီ group ကို ရောက်လာမှာပါ။`,
        `✅ Telegram link works. SmartRetailAI alerts will arrive in this group.`,
      );
      break;
    }
  }
  return lines.join("\n");
}

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

async function postOnce(token: string, chatId: string, text: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTelegramMessage(text: string): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    return { ok: false, error: "TELEGRAM_NOT_CONFIGURED" };
  }
  try {
    let res = await postOnce(token, chatId, text);
    if (!res.ok && (res.status === 429 || res.status >= 500)) {
      res = await postOnce(token, chatId, text);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("[telegram] sendMessage failed:", res.status, detail.slice(0, 200));
      return { ok: false, error: `TELEGRAM_SEND_FAILED_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[telegram] sendMessage error:", err instanceof Error ? err.message : err);
    return { ok: false, error: "TELEGRAM_SEND_ERROR" };
  }
}

/** Format + send one alert if Telegram is enabled. Never throws. */
export async function notifyTelegram(
  type: TelegramAlertType,
  payload: TelegramAlertPayload,
): Promise<void> {
  try {
    const settings = await getTelegramSettings();
    if (!settings.enabled) return;
    const text = formatTelegramMessage(type, payload, settings.language);
    await sendTelegramMessage(text);
  } catch (err) {
    console.warn("[telegram] notify error:", err instanceof Error ? err.message : err);
  }
}
