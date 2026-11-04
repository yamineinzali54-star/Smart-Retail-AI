import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { getClientIp, getSession } from "@/lib/auth";
import {
  getAiApiKeys,
  getAiModels,
  publicAiApiKey,
  publicAiModel,
  replaceAiProviderSettings,
} from "@/lib/ai-model-settings";

const keySchema = z.object({
  id: z.string().uuid().optional(),
  provider: z.enum(["openrouter", "opencode_zen", "opencode_console"]),
  label: z.string().trim().min(1).max(120),
  keyPurpose: z.enum(["inference", "management", "both"]),
  permissions: z.string().max(30).nullable(),
  apiKey: z.string().max(5000).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  enabled: z.boolean(),
});

const modelSchema = z.object({
  id: z.string().uuid().optional(),
  provider: z.enum(["openrouter", "opencode_zen", "opencode_console"]),
  apiKeyId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  providerContextLength: z.number().int().positive().nullable(),
  providerMaxOutputTokens: z.number().int().positive().nullable(),
  providerRequestLimits: z.record(z.string(), z.unknown()).nullable(),
  providerLimitsCheckedAt: z.string().datetime({ offset: true }).nullable(),
});

const putSchema = z.object({ keys: z.array(keySchema).max(20), models: z.array(modelSchema).max(100) }).superRefine((value, context) => {
  const keyIds = value.keys.flatMap((key) => key.id ? [key.id] : []);
  if (new Set(keyIds).size !== keyIds.length) {
    context.addIssue({ code: "custom", path: ["keys"], message: "API key IDs must be unique" });
  }
  const labels = value.keys.map((key) => `${key.provider}:${key.label.toLowerCase()}`);
  if (new Set(labels).size !== labels.length) {
    context.addIssue({ code: "custom", path: ["keys"], message: "Key labels must be unique per provider" });
  }
  for (const key of value.keys) {
    const validOpenCodePermission = key.provider === "openrouter" ||
      (key.keyPurpose === "inference" && key.permissions === "inference_only") ||
      ((key.keyPurpose === "management" || key.keyPurpose === "both") && key.permissions === "all");
    if (!validOpenCodePermission) {
      context.addIssue({ code: "custom", path: ["keys"], message: "OpenCode permission does not match the key access" });
      break;
    }
  }
  const ids = value.models.flatMap((model) => model.id ? [model.id] : []);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["models"], message: "Model IDs must be unique" });
  }
  if (value.models.filter((model) => model.isDefault).length > 1) {
    context.addIssue({ code: "custom", path: ["models"], message: "Only one default model is allowed" });
  }
  if (value.models.some((model) => model.isDefault && !model.enabled)) {
    context.addIssue({ code: "custom", path: ["models"], message: "The default model must be active" });
  }
  for (const model of value.models) {
    if (!value.keys.some((key) => key.id === model.apiKeyId && key.provider === model.provider && key.keyPurpose !== "management" && (!model.enabled || key.enabled))) {
      context.addIssue({ code: "custom", path: ["models"], message: "Each model must use a matching inference key" });
      break;
    }
  }
  const activeModels = value.models.filter((model) => model.enabled);
  if (activeModels.length > 0 && !activeModels.some((model) => model.isDefault)) {
    context.addIssue({ code: "custom", path: ["models"], message: "Choose a default active model" });
  }
});

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") return null;
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });

  const models = await getAiModels();
  const keys = await getAiApiKeys();
  return NextResponse.json({ ok: true, keys: keys.map(publicAiApiKey), models: models.map(publicAiModel) });
}

export async function PUT(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const settings = await replaceAiProviderSettings(
      parsed.data.keys.map((key) => ({
        ...key,
        expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
      })),
      parsed.data.models,
      session.user.id,
    );
    const publicModels = settings.models.map(publicAiModel);
    const publicKeys = settings.keys.map(publicAiApiKey);
    await audit({
      entityType: "AiModel",
      entityId: "configured-models",
      action: "update",
      description: `AI provider settings updated (${settings.keys.length} keys, ${settings.models.length} models)`,
      newValues: { keys: publicKeys, models: publicModels },
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });
    return NextResponse.json({ ok: true, keys: publicKeys, models: publicModels });
  } catch (error) {
    if (error instanceof Error && error.message === "API_KEY_REQUIRED") {
      return NextResponse.json({ ok: false, error: "API_KEY_REQUIRED" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "MODEL_INFERENCE_KEY_REQUIRED") {
      return NextResponse.json({ ok: false, error: "MODEL_INFERENCE_KEY_REQUIRED" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "SETTINGS_SAVE_FAILED" }, { status: 500 });
  }
}
