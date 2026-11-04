import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNull, notInArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { aiApiKeys, aiModels } from "@/db/schema";

const ENVELOPE_VERSION = 1;

export type AiModelProvider = "openrouter" | "opencode_zen" | "opencode_console";
export type AiKeyPurpose = "inference" | "management" | "both";

export interface AiApiKeyConfig {
  id: string;
  provider: AiModelProvider;
  label: string;
  keyPurpose: AiKeyPurpose;
  permissions: string | null;
  apiKey: string;
  expiresAt: Date | null;
  enabled: boolean;
  lastCheckedAt: Date | null;
  lastCheckStatus: string | null;
  providerLimitsSnapshot: unknown;
  providerLimitsCheckedAt: Date | null;
  providerLimitsStatus: string | null;
}

export interface AiApiKeyInput {
  id?: string;
  provider: AiModelProvider;
  label: string;
  keyPurpose: AiKeyPurpose;
  permissions: string | null;
  apiKey?: string;
  expiresAt: Date | null;
  enabled: boolean;
}

export interface AiModelConfig {
  id: string;
  provider: AiModelProvider;
  apiKeyId: string;
  apiKeyLabel: string;
  name: string;
  displayName: string;
  apiKey: string;
  expiresAt: Date | null;
  providerContextLength: number | null;
  providerMaxOutputTokens: number | null;
  providerRequestLimits: Record<string, unknown> | null;
  providerLimitsCheckedAt: Date | null;
  requestsToday: number;
  requestsThisMonth: number;
  totalTokensToday: number;
  totalTokensThisMonth: number;
  costUsdToday: number;
  costUsdThisMonth: number;
  costReportedToday: boolean;
  costReportedThisMonth: boolean;
  usageDay: string;
  usageMonth: string;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
}

export interface AiModelConfigInput {
  id?: string;
  provider: AiModelProvider;
  apiKeyId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  providerContextLength: number | null;
  providerMaxOutputTokens: number | null;
  providerRequestLimits: Record<string, unknown> | null;
  providerLimitsCheckedAt: string | null;
}

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be configured to store AI provider credentials");
  }
  return createHash("sha256").update(`smart-retail-ai-model-settings:${secret}`).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return JSON.stringify({
    version: ENVELOPE_VERSION,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: ciphertext.toString("base64url"),
  });
}

function decrypt(envelope: string): string {
  const parsed = JSON.parse(envelope) as { version?: number; iv?: string; tag?: string; data?: string };
  if (parsed.version !== ENVELOPE_VERSION || !parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error("Stored AI provider settings have an unsupported format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parsed.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function fromKeyRow(row: typeof aiApiKeys.$inferSelect): AiApiKeyConfig {
  return {
    id: row.id,
    provider: row.provider as AiModelProvider,
    label: row.label,
    keyPurpose: row.keyPurpose as AiKeyPurpose,
    permissions: row.permissions,
    apiKey: decrypt(row.apiKey),
    expiresAt: row.expiresAt,
    enabled: row.isActive,
    lastCheckedAt: row.lastCheckedAt,
    lastCheckStatus: row.lastCheckStatus,
    providerLimitsSnapshot: row.providerLimitsSnapshot,
    providerLimitsCheckedAt: row.providerLimitsCheckedAt,
    providerLimitsStatus: row.providerLimitsStatus,
  };
}

function fromModelRow(row: typeof aiModels.$inferSelect, key: typeof aiApiKeys.$inferSelect): AiModelConfig {
  return {
    id: row.id,
    provider: row.provider as AiModelProvider,
    apiKeyId: row.apiKeyId,
    apiKeyLabel: key.label,
    name: row.modelName,
    displayName: row.displayName,
    apiKey: decrypt(key.apiKey),
    expiresAt: key.expiresAt,
    providerContextLength: row.providerContextLength,
    providerMaxOutputTokens: row.providerMaxOutputTokens,
    providerRequestLimits: row.providerRequestLimits as Record<string, unknown> | null,
    providerLimitsCheckedAt: row.providerLimitsCheckedAt,
    requestsToday: row.requestsToday,
    requestsThisMonth: row.requestsThisMonth,
    totalTokensToday: row.totalTokensToday,
    totalTokensThisMonth: row.totalTokensThisMonth,
    costUsdToday: row.costUsdToday,
    costUsdThisMonth: row.costUsdThisMonth,
    costReportedToday: row.costReportedToday,
    costReportedThisMonth: row.costReportedThisMonth,
    usageDay: row.usageDay,
    usageMonth: row.usageMonth,
    enabled: row.isActive && key.isActive,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
  };
}

export async function getAiApiKeys(): Promise<AiApiKeyConfig[]> {
  const rows = await db.select().from(aiApiKeys).orderBy(asc(aiApiKeys.provider), asc(aiApiKeys.createdAt));
  return rows.map(fromKeyRow);
}

export async function recordAiApiKeyCheck(id: string, status: "ok" | "error"): Promise<void> {
  await db.update(aiApiKeys).set({ lastCheckedAt: new Date(), lastCheckStatus: status, updatedAt: new Date() })
    .where(eq(aiApiKeys.id, id));
}

export async function recordAiProviderLimits(
  id: string,
  status: "ok" | "unsupported" | "permission_required" | "error",
  snapshot?: unknown,
): Promise<void> {
  const now = new Date();
  const update = {
    providerLimitsCheckedAt: now,
    providerLimitsStatus: status,
    updatedAt: now,
    ...(snapshot === undefined ? {} : { providerLimitsSnapshot: snapshot }),
  };
  await db.update(aiApiKeys).set(update).where(eq(aiApiKeys.id, id));
}

export async function getAiModels(): Promise<AiModelConfig[]> {
  const rows = await db
    .select({ model: aiModels, key: aiApiKeys })
    .from(aiModels)
    .innerJoin(aiApiKeys, eq(aiModels.apiKeyId, aiApiKeys.id))
    .orderBy(asc(aiModels.sortOrder), asc(aiModels.createdAt));
  return rows.map(({ model, key }) => fromModelRow(model, key));
}

export async function replaceAiApiKeys(
  keyInput: AiApiKeyInput[],
  actorId: string,
): Promise<AiApiKeyConfig[]> {
  const [currentKeys, currentModels] = await Promise.all([getAiApiKeys(), getAiModels()]);
  const keyById = new Map(currentKeys.map((key) => [key.id, key]));
  const keys = keyInput.map((item) => {
    const existing = item.id ? keyById.get(item.id) : undefined;
    const secret = item.apiKey?.trim() || existing?.apiKey || "";
    if (!secret) throw new Error("API_KEY_REQUIRED");
    return {
      id: existing?.id ?? item.id ?? randomUUID(),
      provider: item.provider,
      label: item.label.trim(),
      keyPurpose: item.keyPurpose,
      permissions: item.permissions,
      apiKey: encrypt(secret),
      expiresAt: item.expiresAt,
      isActive: item.enabled,
      updatedBy: actorId,
    };
  });
  const retainedIds = new Set(keys.map((key) => key.id));
  const keyByRetainedId = new Map(keys.map((key) => [key.id, key]));

  for (const model of currentModels) {
    const replacement = keyByRetainedId.get(model.apiKeyId);
    if (!replacement || replacement.provider !== model.provider || replacement.keyPurpose === "management") {
      throw new Error("AI_KEY_IN_USE");
    }
  }

  await db.transaction(async (tx) => {
    for (const key of keys) {
      await tx.insert(aiApiKeys).values({ ...key, createdBy: keyById.has(key.id) ? undefined : actorId })
        .onConflictDoUpdate({ target: aiApiKeys.id, set: { ...key, updatedAt: new Date() } });
    }
    if (retainedIds.size) {
      await tx.delete(aiApiKeys).where(notInArray(aiApiKeys.id, [...retainedIds]));
    } else {
      await tx.delete(aiApiKeys);
    }
  });
  return getAiApiKeys();
}

export async function replaceAiModels(
  modelInput: AiModelConfigInput[],
  actorId: string,
): Promise<AiModelConfig[]> {
  if (modelInput.filter((model) => model.isDefault).length > 1) throw new Error("ONLY_ONE_DEFAULT_MODEL_ALLOWED");
  if (modelInput.some((model) => model.isDefault && !model.enabled)) throw new Error("DEFAULT_MODEL_MUST_BE_ACTIVE");

  const [keys, currentModels] = await Promise.all([getAiApiKeys(), getAiModels()]);
  if (modelInput.some((model) => !keys.some((key) => key.id === model.apiKeyId &&
    key.provider === model.provider && key.keyPurpose !== "management" && (!model.enabled || key.enabled)))) {
    throw new Error("MODEL_INFERENCE_KEY_REQUIRED");
  }
  const keyIds = new Set(keys.map((key) => key.id));
  if (modelInput.some((model) => !keyIds.has(model.apiKeyId))) throw new Error("MODEL_KEY_NOT_FOUND");
  const activeModels = modelInput.filter((model) => model.enabled);
  if (activeModels.length && !activeModels.some((model) => model.isDefault)) throw new Error("DEFAULT_MODEL_REQUIRED");

  const modelById = new Map(currentModels.map((model) => [model.id, model]));
  const models = modelInput.map((item, index) => {
    const existing = item.id ? modelById.get(item.id) : undefined;
    return {
      id: existing?.id ?? item.id ?? randomUUID(),
      provider: item.provider,
      apiKeyId: item.apiKeyId,
      modelName: item.name.trim(),
      displayName: item.displayName.trim(),
      providerContextLength: item.providerContextLength,
      providerMaxOutputTokens: item.providerMaxOutputTokens,
      providerRequestLimits: item.providerRequestLimits,
      providerLimitsCheckedAt: item.providerLimitsCheckedAt ? new Date(item.providerLimitsCheckedAt) : null,
      isActive: item.enabled,
      isDefault: item.isDefault,
      sortOrder: index,
      updatedBy: actorId,
    };
  });

  await db.transaction(async (tx) => {
    await tx.update(aiModels).set({ isDefault: false });
    for (const model of models) {
      await tx.insert(aiModels).values({ ...model, createdBy: modelById.has(model.id) ? undefined : actorId })
        .onConflictDoUpdate({
          target: aiModels.id,
          set: {
            provider: model.provider,
            apiKeyId: model.apiKeyId,
            modelName: model.modelName,
            displayName: model.displayName,
            providerContextLength: model.providerContextLength,
            providerMaxOutputTokens: model.providerMaxOutputTokens,
            providerRequestLimits: model.providerRequestLimits,
            providerLimitsCheckedAt: model.providerLimitsCheckedAt,
            isActive: model.isActive,
            isDefault: model.isDefault,
            sortOrder: model.sortOrder,
            updatedBy: actorId,
            updatedAt: new Date(),
          },
        });
    }
    const modelIds = models.map((model) => model.id);
    if (modelIds.length) await tx.delete(aiModels).where(notInArray(aiModels.id, modelIds));
    else await tx.delete(aiModels);
  });
  return getAiModels();
}

export async function replaceAiProviderSettings(
  keyInput: AiApiKeyInput[],
  modelInput: AiModelConfigInput[],
  actorId: string,
): Promise<{ keys: AiApiKeyConfig[]; models: AiModelConfig[] }> {
  if (modelInput.filter((model) => model.isDefault).length > 1) throw new Error("ONLY_ONE_DEFAULT_MODEL_ALLOWED");
  if (modelInput.some((model) => model.isDefault && !model.enabled)) throw new Error("DEFAULT_MODEL_MUST_BE_ACTIVE");
  if (modelInput.some((model) => !keyInput.some((key) => key.id === model.apiKeyId && key.provider === model.provider && key.keyPurpose !== "management"))) {
    throw new Error("MODEL_INFERENCE_KEY_REQUIRED");
  }

  const [currentKeys, currentModels] = await Promise.all([getAiApiKeys(), getAiModels()]);
  const keyById = new Map(currentKeys.map((key) => [key.id, key]));
  const modelById = new Map(currentModels.map((model) => [model.id, model]));
  const keys = keyInput.map((item) => {
    const existing = item.id ? keyById.get(item.id) : undefined;
    const secret = item.apiKey?.trim() || existing?.apiKey || "";
    if (!secret) throw new Error("API_KEY_REQUIRED");
    return {
      id: existing?.id ?? item.id ?? randomUUID(),
      provider: item.provider,
      label: item.label.trim(),
      keyPurpose: item.keyPurpose,
      permissions: item.permissions,
      apiKey: encrypt(secret),
      expiresAt: item.expiresAt,
      isActive: item.enabled,
      updatedBy: actorId,
    };
  });
  const models = modelInput.map((item, index) => {
    const existing = item.id ? modelById.get(item.id) : undefined;
    return {
      id: existing?.id ?? item.id ?? randomUUID(),
      provider: item.provider,
      apiKeyId: item.apiKeyId,
      modelName: item.name.trim(),
      displayName: item.displayName.trim(),
      providerContextLength: item.providerContextLength,
      providerMaxOutputTokens: item.providerMaxOutputTokens,
      providerRequestLimits: item.providerRequestLimits,
      providerLimitsCheckedAt: item.providerLimitsCheckedAt ? new Date(item.providerLimitsCheckedAt) : null,
      isActive: item.enabled,
      isDefault: item.isDefault,
      sortOrder: index,
      updatedBy: actorId,
    };
  });

  await db.transaction(async (tx) => {
    await tx.update(aiModels).set({ isDefault: false });
    for (const key of keys) {
      await tx.insert(aiApiKeys).values({ ...key, createdBy: keyById.has(key.id) ? undefined : actorId })
        .onConflictDoUpdate({ target: aiApiKeys.id, set: { ...key, updatedAt: new Date() } });
    }
    for (const model of models) {
      await tx.insert(aiModels).values({ ...model, createdBy: modelById.has(model.id) ? undefined : actorId })
        .onConflictDoUpdate({
          target: aiModels.id,
          set: {
            provider: model.provider,
            apiKeyId: model.apiKeyId,
            modelName: model.modelName,
            displayName: model.displayName,
            providerContextLength: model.providerContextLength,
            providerMaxOutputTokens: model.providerMaxOutputTokens,
            providerRequestLimits: model.providerRequestLimits,
            providerLimitsCheckedAt: model.providerLimitsCheckedAt,
            isActive: model.isActive,
            isDefault: model.isDefault,
            sortOrder: model.sortOrder,
            updatedBy: actorId,
            updatedAt: new Date(),
          },
        });
    }
    const modelIds = models.map((model) => model.id);
    if (modelIds.length) await tx.delete(aiModels).where(notInArray(aiModels.id, modelIds));
    else await tx.delete(aiModels);
    const retainedKeyIds = keys.map((key) => key.id);
    if (retainedKeyIds.length) await tx.delete(aiApiKeys).where(notInArray(aiApiKeys.id, retainedKeyIds));
    else await tx.delete(aiApiKeys);
  });

  return { keys: await getAiApiKeys(), models: await getAiModels() };
}

export async function getSelectableAiModels(): Promise<AiModelConfig[]> {
  const now = new Date();
  return (await getAiModels()).filter((model) =>
    model.enabled && (!model.expiresAt || model.expiresAt > now),
  );
}

export async function reserveAiModel(id: string): Promise<
  | { ok: true; model: AiModelConfig }
  | { ok: false; error: "AI_MODEL_UNAVAILABLE" }
> {
  const now = new Date();
  const [reserved] = await db
    .update(aiModels)
    .set({
      requestsToday: sql`case when ${aiModels.usageDay} = current_date then ${aiModels.requestsToday} + 1 else 1 end`,
      requestsThisMonth: sql`case when ${aiModels.usageMonth} = date_trunc('month', current_date)::date then ${aiModels.requestsThisMonth} + 1 else 1 end`,
      totalTokensToday: sql`case when ${aiModels.usageDay} = current_date then ${aiModels.totalTokensToday} else 0 end`,
      totalTokensThisMonth: sql`case when ${aiModels.usageMonth} = date_trunc('month', current_date)::date then ${aiModels.totalTokensThisMonth} else 0 end`,
      costUsdToday: sql`case when ${aiModels.usageDay} = current_date then ${aiModels.costUsdToday} else 0 end`,
      costUsdThisMonth: sql`case when ${aiModels.usageMonth} = date_trunc('month', current_date)::date then ${aiModels.costUsdThisMonth} else 0 end`,
      costReportedToday: sql`case when ${aiModels.usageDay} = current_date then ${aiModels.costReportedToday} else false end`,
      costReportedThisMonth: sql`case when ${aiModels.usageMonth} = date_trunc('month', current_date)::date then ${aiModels.costReportedThisMonth} else false end`,
      usageDay: sql`current_date`,
      usageMonth: sql`date_trunc('month', current_date)::date`,
      updatedAt: sql`now()`,
    })
    .from(aiApiKeys)
    .where(and(
      eq(aiModels.id, id),
      eq(aiApiKeys.id, aiModels.apiKeyId),
      eq(aiModels.isActive, true),
      eq(aiApiKeys.isActive, true),
      sql`${aiApiKeys.keyPurpose} <> 'management'`,
      or(isNull(aiApiKeys.expiresAt), gt(aiApiKeys.expiresAt, now)),
    ))
    .returning({ id: aiModels.id });

  const model = (await getAiModels()).find((item) => item.id === id);
  if (reserved && model) return { ok: true, model };
  if (!model || !model.enabled || (model.expiresAt && model.expiresAt <= now)) {
    return { ok: false, error: "AI_MODEL_UNAVAILABLE" };
  }
  return { ok: false, error: "AI_MODEL_UNAVAILABLE" };
}

export async function recordAiModelUsage(
  id: string,
  usage: { totalTokens: number; costUsd: number; costReported: boolean },
): Promise<void> {
  const totalTokens = Math.max(0, Math.trunc(usage.totalTokens));
  const costUsd = Math.max(0, usage.costUsd);
  await db.update(aiModels).set({
    totalTokensToday: sql`case when ${aiModels.usageDay} = current_date then ${aiModels.totalTokensToday} + ${totalTokens} else ${totalTokens} end`,
    totalTokensThisMonth: sql`case when ${aiModels.usageMonth} = date_trunc('month', current_date)::date then ${aiModels.totalTokensThisMonth} + ${totalTokens} else ${totalTokens} end`,
    costUsdToday: sql`case when ${aiModels.usageDay} = current_date then ${aiModels.costUsdToday} + ${costUsd} else ${costUsd} end`,
    costUsdThisMonth: sql`case when ${aiModels.usageMonth} = date_trunc('month', current_date)::date then ${aiModels.costUsdThisMonth} + ${costUsd} else ${costUsd} end`,
    costReportedToday: sql`case when ${aiModels.usageDay} = current_date then ${aiModels.costReportedToday} or ${usage.costReported} else ${usage.costReported} end`,
    costReportedThisMonth: sql`case when ${aiModels.usageMonth} = date_trunc('month', current_date)::date then ${aiModels.costReportedThisMonth} or ${usage.costReported} else ${usage.costReported} end`,
    updatedAt: sql`now()`,
  }).where(eq(aiModels.id, id));
}

export function publicAiApiKey(key: AiApiKeyConfig) {
  return {
    id: key.id,
    provider: key.provider,
    label: key.label,
    keyPurpose: key.keyPurpose,
    permissions: key.permissions,
    providerLimitsCheckedAt: key.providerLimitsCheckedAt?.toISOString() ?? null,
    providerLimitsStatus: key.providerLimitsStatus,
    keyConfigured: Boolean(key.apiKey),
    keyPreview: key.apiKey ? `••••••${key.apiKey.slice(-4)}` : null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    enabled: key.enabled,
    lastCheckedAt: key.lastCheckedAt?.toISOString() ?? null,
    lastCheckStatus: key.lastCheckStatus,
  };
}

export function publicAiModel(model: AiModelConfig) {
  const day = new Date().toISOString().slice(0, 10);
  const month = `${day.slice(0, 7)}-01`;
  const currentDay = model.usageDay === day;
  const currentMonth = model.usageMonth === month;
  return {
    id: model.id,
    provider: model.provider,
    apiKeyId: model.apiKeyId,
    apiKeyLabel: model.apiKeyLabel,
    name: model.name,
    displayName: model.displayName,
    enabled: model.enabled,
    isDefault: model.isDefault,
    expiresAt: model.expiresAt?.toISOString() ?? null,
    providerContextLength: model.providerContextLength,
    providerMaxOutputTokens: model.providerMaxOutputTokens,
    providerRequestLimits: model.providerRequestLimits,
    providerLimitsCheckedAt: model.providerLimitsCheckedAt?.toISOString() ?? null,
    requestsToday: currentDay ? model.requestsToday : 0,
    requestsThisMonth: currentMonth ? model.requestsThisMonth : 0,
    totalTokensToday: currentDay ? model.totalTokensToday : 0,
    totalTokensThisMonth: currentMonth ? model.totalTokensThisMonth : 0,
    costUsdToday: currentDay ? model.costUsdToday : 0,
    costUsdThisMonth: currentMonth ? model.costUsdThisMonth : 0,
    costReportedToday: currentDay && model.costReportedToday,
    costReportedThisMonth: currentMonth && model.costReportedThisMonth,
    sortOrder: model.sortOrder,
  };
}
