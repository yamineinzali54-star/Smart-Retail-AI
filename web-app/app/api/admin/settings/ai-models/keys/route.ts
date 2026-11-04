import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { getClientIp, getSession } from "@/lib/auth";
import { publicAiApiKey, replaceAiApiKeys } from "@/lib/ai-model-settings";

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

const bodySchema = z.object({ keys: z.array(keySchema).max(20) }).superRefine(({ keys }, context) => {
  const ids = keys.flatMap((key) => key.id ? [key.id] : []);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["keys"], message: "API key IDs must be unique" });
  }
  const labels = keys.map((key) => `${key.provider}:${key.label.toLowerCase()}`);
  if (new Set(labels).size !== labels.length) {
    context.addIssue({ code: "custom", path: ["keys"], message: "Key labels must be unique per provider" });
  }
  for (const key of keys) {
    const validPermission = key.provider === "openrouter" ||
      (key.keyPurpose === "inference" && key.permissions === "inference_only") ||
      ((key.keyPurpose === "management" || key.keyPurpose === "both") && key.permissions === "all");
    if (!validPermission) {
      context.addIssue({ code: "custom", path: ["keys"], message: "OpenCode permission does not match the key access" });
      break;
    }
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
    const keys = await replaceAiApiKeys(parsed.data.keys.map((key) => ({
      ...key,
      expiresAt: key.expiresAt ? new Date(key.expiresAt) : null,
    })), session.user.id);
    const publicKeys = keys.map(publicAiApiKey);
    await audit({
      entityType: "AiApiKey",
      entityId: "provider-keys",
      action: "update",
      description: `AI provider keys updated (${keys.length} keys)`,
      newValues: { keys: publicKeys },
      userId: session.user.id,
      branchId: session.user.branchId,
      ipAddress: await getClientIp(),
    });
    return NextResponse.json({ ok: true, keys: publicKeys });
  } catch (error) {
    if (error instanceof Error && error.message === "API_KEY_REQUIRED") {
      return NextResponse.json({ ok: false, error: "API_KEY_REQUIRED" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "AI_KEY_IN_USE") {
      return NextResponse.json({ ok: false, error: "AI_KEY_IN_USE" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "AI_KEYS_SAVE_FAILED" }, { status: 500 });
  }
}
