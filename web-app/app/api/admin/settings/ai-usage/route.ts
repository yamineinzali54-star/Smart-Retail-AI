import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getAiApiKeys, recordAiApiKeyCheck, recordAiProviderLimits } from "@/lib/ai-model-settings";

const OPENROUTER_API = "https://openrouter.ai/api/v1";
const OPENCODE_CONSOLE = "https://opencode.ai/console";
const MICRO_CENTS_PER_DOLLAR = 100_000_000;

function finiteNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function requiredMicroCentsToUsd(value: unknown): number {
  const parsed = finiteNonNegativeNumber(value);
  if (parsed === null) throw new Error("INVALID_RESPONSE");
  return parsed / MICRO_CENTS_PER_DOLLAR;
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
  return response.json();
}

export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const keys = await getAiApiKeys();
  const usage = await Promise.all(keys
    .filter((key) => key.enabled && (!key.expiresAt || key.expiresAt > new Date()) &&
      (key.provider === "openrouter" || key.keyPurpose === "management" || key.keyPurpose === "both"))
    .map(async (key) => {
      try {
        if (key.provider === "opencode_zen") {
          await recordAiProviderLimits(key.id, "unsupported", null);
          return [{
            keyId: key.id,
            provider: key.provider,
            label: key.label,
            scope: "budget",
            error: "BUDGETS_NOT_SUPPORTED",
          }];
        }

        if (key.provider === "openrouter") {
          const [currentKeyPayload, creditPayload] = await Promise.all([
            getJson(`${OPENROUTER_API}/key`, key.apiKey),
            key.keyPurpose === "management" || key.keyPurpose === "both"
              ? getJson(`${OPENROUTER_API}/credits`, key.apiKey).catch(() => null)
              : Promise.resolve(null),
          ]) as [
            { data?: { label?: string; limit?: unknown; limit_remaining?: unknown; limit_reset?: string | null; usage?: unknown; usage_daily?: unknown; usage_weekly?: unknown; usage_monthly?: unknown; is_free_tier?: boolean } },
            { data?: { total_credits?: unknown; total_usage?: unknown } } | null,
          ];
          const totalCredits = finiteNonNegativeNumber(creditPayload?.data?.total_credits);
          const totalUsage = finiteNonNegativeNumber(creditPayload?.data?.total_usage);
          await recordAiProviderLimits(key.id, "ok", {
            key: currentKeyPayload.data ?? null,
            account: creditPayload?.data ?? null,
          });
          await recordAiApiKeyCheck(key.id, "ok");
          const account = totalCredits !== null && totalUsage !== null ? [{
            keyId: key.id,
            provider: key.provider,
            label: key.label,
            scope: "account",
            spentUsd: totalUsage,
            limitUsd: totalCredits,
            remainingUsd: Math.max(0, totalCredits - totalUsage),
            resetAt: null,
            error: null,
          }] : [];
          const currentKey = currentKeyPayload.data;
          const currentKeyUsage = currentKey ? [{
            keyId: key.id,
            provider: key.provider,
            label: key.label,
            scope: "key",
            member: currentKey.label || "OpenRouter API key",
            spentUsd: finiteNonNegativeNumber(currentKey.usage),
            limitUsd: currentKey.limit == null ? null : finiteNonNegativeNumber(currentKey.limit),
            remainingUsd: currentKey.limit_remaining == null ? null : finiteNonNegativeNumber(currentKey.limit_remaining),
            resetAt: null,
            resetPeriod: currentKey.limit_reset ?? null,
            dailySpentUsd: finiteNonNegativeNumber(currentKey.usage_daily),
            weeklySpentUsd: finiteNonNegativeNumber(currentKey.usage_weekly),
            monthlySpentUsd: finiteNonNegativeNumber(currentKey.usage_monthly),
            isFreeTier: currentKey.is_free_tier ?? null,
            error: null,
          }] : [];
          return [...account, ...currentKeyUsage];
        }

        const payload = await getJson(`${OPENCODE_CONSOLE}/api/v1/budgets/members`, key.apiKey);
        if (!Array.isArray(payload)) throw new Error("INVALID_RESPONSE");
        await recordAiProviderLimits(key.id, "ok", { members: payload });
        await recordAiApiKeyCheck(key.id, "ok");
        return payload.map((member) => {
          const record = member as {
            user_id?: string;
            email?: string;
            limit_micro_cents?: string | null;
            spent_micro_cents?: string;
            exceeded?: boolean;
            resets_at?: string | null;
            source?: string | null;
          };
          const spentUsd = requiredMicroCentsToUsd(record.spent_micro_cents);
          const limitUsd = record.limit_micro_cents == null
            ? null
            : requiredMicroCentsToUsd(record.limit_micro_cents);
          return {
            keyId: key.id,
            provider: key.provider,
            label: key.label,
            scope: "member",
            scopeId: record.user_id ?? null,
            member: record.email ?? "OpenCode workspace member",
            spentUsd,
            limitUsd,
            remainingUsd: limitUsd === null ? null : Math.max(0, limitUsd - spentUsd),
            exceeded: record.exceeded ?? false,
            budgetSource: record.source ?? null,
            resetAt: record.resets_at ?? null,
            error: null,
          };
        });
      } catch (error) {
        const providerLimitStatus = error instanceof Error && error.message === "PROVIDER_HTTP_403" && key.provider === "opencode_console"
          ? "permission_required"
          : "error";
        await recordAiProviderLimits(key.id, providerLimitStatus).catch(() => undefined);
        await recordAiApiKeyCheck(key.id, "error").catch(() => undefined);
        return [{
          keyId: key.id,
          provider: key.provider,
          label: key.label,
          scope: key.provider === "openrouter" ? "account" : "member",
          providerStatus: error instanceof Error && error.message.startsWith("PROVIDER_HTTP_")
            ? Number(error.message.slice("PROVIDER_HTTP_".length))
            : null,
          error: error instanceof Error && error.message === "PROVIDER_HTTP_403" && key.provider === "opencode_console"
            ? "BUDGET_ACCESS_DENIED"
            : "USAGE_UNAVAILABLE",
        }];
      }
    }));

  return NextResponse.json({ ok: true, usage: usage.flat() });
}
