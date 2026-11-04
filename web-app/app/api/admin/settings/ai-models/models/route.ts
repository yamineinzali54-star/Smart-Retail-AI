import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { getClientIp, getSession } from "@/lib/auth";
import { publicAiModel, replaceAiModels } from "@/lib/ai-model-settings";

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

const bodySchema = z.object({ models: z.array(modelSchema).max(100) }).superRefine(({ models }, context) => {
  const ids = models.flatMap((model) => model.id ? [model.id] : []);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["models"], message: "Model IDs must be unique" });
  }
  if (models.filter((model) => model.isDefault).length > 1) {
    context.addIssue({ code: "custom", path: ["models"], message: "Only one default model is allowed" });
  }
  if (models.some((model) => model.isDefault && !model.enabled)) {
    context.addIssue({ code: "custom", path: ["models"], message: "The default model must be active" });
  }
  const activeModels = models.filter((model) => model.enabled);
  if (activeModels.length && !activeModels.some((model) => model.isDefault)) {
    context.addIssue({ code: "custom", path: ["models"], message: "Choose a default active model" });
  }
});

async function requireAdmin() {
  const session = await getSession();
  return session?.user.role === "admin" ? session : null;
}

export async function PUT(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });

  try {
    const models = await replaceAiModels(parsed.data.models, session.user.id);
    const publicModels = models.map(publicAiModel);
    await audit({
      entityType: "AiModel",
      entityId: "configured-models",
      action: "update",
      description: `AI models updated (${models.length} models)`,
      newValues: { models: publicModels },
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });
    return NextResponse.json({ ok: true, models: publicModels });
  } catch (error) {
    if (error instanceof Error && ["MODEL_INFERENCE_KEY_REQUIRED", "MODEL_KEY_NOT_FOUND"].includes(error.message)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof Error && ["ONLY_ONE_DEFAULT_MODEL_ALLOWED", "DEFAULT_MODEL_MUST_BE_ACTIVE", "DEFAULT_MODEL_REQUIRED"].includes(error.message)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "AI_MODELS_SAVE_FAILED" }, { status: 500 });
  }
}
