import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appSettings } from "@/db/schema";

// Global key/value runtime settings, admin-controllable from the panel.
// Code defaults apply when a key has no row, so no seed rows are required.

export const TELEGRAM_ENABLED_KEY = "telegram.enabled";
export const TELEGRAM_LANGUAGE_KEY = "telegram.language";

export type TelegramLanguage = "my" | "en" | "both";

export interface TelegramSettings {
  enabled: boolean;
  language: TelegramLanguage;
}

export async function getAppSetting(key: string, fallback: string): Promise<string> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? fallback;
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

function parseLanguage(raw: string): TelegramLanguage {
  return raw === "my" || raw === "en" || raw === "both" ? raw : "both";
}

export async function getTelegramSettings(): Promise<TelegramSettings> {
  const [enabledRaw, languageRaw] = await Promise.all([
    getAppSetting(TELEGRAM_ENABLED_KEY, "true"),
    getAppSetting(TELEGRAM_LANGUAGE_KEY, "both"),
  ]);
  return {
    enabled: enabledRaw.trim().toLowerCase() === "true",
    language: parseLanguage(languageRaw.trim().toLowerCase()),
  };
}

export async function setTelegramSettings(next: TelegramSettings): Promise<void> {
  await Promise.all([
    setAppSetting(TELEGRAM_ENABLED_KEY, next.enabled ? "true" : "false"),
    setAppSetting(TELEGRAM_LANGUAGE_KEY, next.language),
  ]);
}
