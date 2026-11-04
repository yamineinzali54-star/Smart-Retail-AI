import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { getAiApiKeys, recordAiApiKeyCheck } from "@/lib/ai-model-settings";

const requestSchema = z.object({
  provider: z.enum(["openrouter", "opencode_zen", "opencode_console"]),
  apiKeyId: z.string().uuid(),
  keyPurpose: z.enum(["inference", "management", "both"]),
  enabled: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  apiKey: z.string().max(5000).optional(),
});

const endpoints = {
  openrouter: "https://openrouter.ai/api/v1/models",
  opencode_zen: "https://opencode.ai/zen/v1/models",
  opencode_console: "https://opencode.ai/inference/v1/models",
} as const;
const OPENCODE_CONSOLE_CONFIG = "https://opencode.ai/console/api/v2/config";

interface ProviderModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  top_provider?: { max_completion_tokens?: unknown } | null;
  per_request_limits?: unknown;
  limit?: { context?: unknown; output?: unknown } | null;
  architecture?: { output_modalities?: unknown } | null;
  pricing?: { prompt?: unknown; completion?: unknown; request?: unknown } | null;
}

function requestLimits(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getOpenCodeConsoleModelMetadata(apiKey: string): Promise<Map<string, ProviderModel>> {
  try {
    const response = await fetch(OPENCODE_CONSOLE_CONFIG, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return new Map();
    const payload = record(await response.json());
    const providers = record(payload?.providers);
    const opencode = record(providers?.opencode);
    const models = record(opencode?.models);
    if (!models) return new Map();
    return new Map(Object.entries(models).flatMap(([id, value]) => {
      const model = record(value);
      return model ? [[id, {
        id,
        name: model.name,
        limit: record(model.limit) as ProviderModel["limit"],
      }]] : [];
    }));
  } catch {
    // Keep the inference model list usable when optional config metadata is unavailable.
    return new Map();
  }
}

function numericPrice(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function isFreeModel(model: ProviderModel): boolean {
  const id = typeof model.id === "string" ? model.id : "";
  const name = typeof model.name === "string" ? model.name : "";
  // Zen's /v1/models response currently contains only id/object/created/owned_by.
  // Most free Zen models use a -free suffix, while Big Pickle is also free without it.
  if (/:free$|-free$/i.test(id) || (id === "big-pickle" && !name) || /\bfree\s*$/i.test(name)) return true;

  const prompt = numericPrice(model.pricing?.prompt);
  const completion = numericPrice(model.pricing?.completion);
  const request = numericPrice(model.pricing?.request);
  return prompt === 0 && completion === 0 && (request === null || request === 0);
}

function supportsTextChat(model: ProviderModel, provider: "openrouter" | "opencode_zen" | "opencode_console"): boolean {
  const id = typeof model.id === "string" ? model.id : "";
  // OpenCode's Jev models use the dedicated /systemone endpoint, not chat completions.
  if (provider !== "openrouter" && id.startsWith("jev-")) return false;
  const outputModalities = model.architecture?.output_modalities;
  return !Array.isArray(outputModalities) || outputModalities.includes("text");
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "VALIDATION_ERROR" }, { status: 400 });

  const { provider, apiKeyId } = parsed.data;
  const configuredKey = (await getAiApiKeys()).find((key) => key.id === apiKeyId);
  const suppliedKey = parsed.data.apiKey?.trim();
  if (configuredKey && configuredKey.provider !== provider && !suppliedKey) {
    return NextResponse.json({ ok: false, error: "KEY_MISMATCH" }, { status: 400 });
  }
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (!parsed.data.enabled || (expiresAt && expiresAt <= new Date())) {
    return NextResponse.json({ ok: false, error: "KEY_INACTIVE" }, { status: 400 });
  }

  const apiKey = suppliedKey || configuredKey?.apiKey;
  if (!apiKey) return NextResponse.json({ ok: false, error: "API_KEY_REQUIRED" }, { status: 400 });

  try {
    const response = await fetch(endpoints[provider], {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      if (configuredKey) await recordAiApiKeyCheck(configuredKey.id, "error").catch(() => undefined);
      const error = response.status === 403 && provider === "openrouter"
        ? "MANAGEMENT_KEY_REQUIRED"
        : response.status === 403 && provider === "opencode_console"
          ? "OPENCODE_ACCESS_DENIED"
          : response.status === 401
            ? "INVALID_API_KEY"
            : response.status === 403
              ? "PROVIDER_ACCESS_DENIED"
              : "PROVIDER_UNAVAILABLE";
      return NextResponse.json({
        ok: false,
        error,
        providerStatus: response.status,
      }, { status: response.status === 401 || response.status === 403 ? 400 : 502 });
    }

    const payload = await response.json() as { data?: unknown } | unknown[];
    const records = Array.isArray(payload) ? payload :
      payload && typeof payload === "object" && Array.isArray(payload.data) ? payload.data : [];
    const consoleModelMetadata = provider === "opencode_console"
      ? await getOpenCodeConsoleModelMetadata(apiKey)
      : new Map<string, ProviderModel>();
    const models = records
      .filter((item): item is ProviderModel => Boolean(item) && typeof item === "object")
      .filter(isFreeModel)
      .filter((model) => supportsTextChat(model, provider))
      .flatMap((model) => {
        if (typeof model.id !== "string") return [];
        const officialMetadata = consoleModelMetadata.get(model.id);
        const name = typeof model.name === "string" && model.name.trim()
          ? model.name
          : typeof officialMetadata?.name === "string" && officialMetadata.name.trim()
            ? officialMetadata.name
            : model.id;
        return [{
          id: model.id,
          name,
          description: typeof model.description === "string" ? model.description : null,
          providerContextLength: positiveInteger(model.context_length) ?? positiveInteger(officialMetadata?.limit?.context),
          providerMaxOutputTokens: positiveInteger(model.top_provider?.max_completion_tokens) ?? positiveInteger(officialMetadata?.limit?.output),
          providerRequestLimits: requestLimits(model.per_request_limits) ?? requestLimits(officialMetadata?.per_request_limits),
        }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    if (configuredKey) await recordAiApiKeyCheck(configuredKey.id, "ok");
    return NextResponse.json({ ok: true, provider, fetchedAt: new Date().toISOString(), models });
  } catch {
    if (configuredKey) await recordAiApiKeyCheck(configuredKey.id, "error").catch(() => undefined);
    return NextResponse.json({ ok: false, error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}
