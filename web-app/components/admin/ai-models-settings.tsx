"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

type Provider = "openrouter" | "opencode_zen" | "opencode_console";
type KeyPurpose = "inference" | "management" | "both";

interface KeyRow {
  id: string;
  provider: Provider;
  label: string;
  keyPurpose: KeyPurpose;
  permissions: string | null;
  apiKey: string;
  keyConfigured: boolean;
  keyPreview: string | null;
  expiresAt: string;
  enabled: boolean;
  lastCheckStatus: string | null;
}

interface ModelRow {
  id: string;
  provider: Provider;
  apiKeyId: string;
  name: string;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
  expiresAt: string | null;
  providerContextLength: number | null;
  providerMaxOutputTokens: number | null;
  providerRequestLimits: Record<string, unknown> | null;
  providerLimitsCheckedAt: string | null;
  requestsToday: number;
  requestsThisMonth: number;
  totalTokensToday: number;
  totalTokensThisMonth: number;
  costUsdToday: number;
  costUsdThisMonth: number;
  costReportedToday: boolean;
  costReportedThisMonth: boolean;
  isDraft?: boolean;
}

interface ProviderUsageRow {
  keyId: string;
  provider: Provider;
  label: string;
  scope: string;
  scopeId?: string | null;
  member?: string;
  spentUsd?: number | null;
  limitUsd?: number | null;
  remainingUsd?: number | null;
  dailySpentUsd?: number | null;
  weeklySpentUsd?: number | null;
  monthlySpentUsd?: number | null;
  budgetSource?: string | null;
  exceeded?: boolean;
  resetAt?: string | null;
  resetPeriod?: string | null;
  isFreeTier?: boolean | null;
  providerStatus?: number | null;
  error?: string;
}

interface CatalogModel {
  id: string;
  name: string;
  description: string | null;
  providerContextLength: number | null;
  providerMaxOutputTokens: number | null;
  providerRequestLimits: Record<string, unknown> | null;
  fetchedAt?: string;
}

function providerLimitsSummary(limits: Record<string, unknown> | null, my: boolean, provider: Provider): string {
  if (!limits) return provider === "openrouter"
    ? (my ? "Catalog မှာ model-specific limit မပါ" : "No model-specific limit listed in catalog")
    : (my ? "ဒီ provider catalog မှာ မပါ" : "Not exposed by this provider catalog");
  return Object.entries(limits).map(([name, value]) =>
    `${name}: ${value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}`,
  ).join(" · ");
}

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function money(value: number | null | undefined, digits = 2): string {
  return value != null && Number.isFinite(value) ? `$${value.toFixed(digits)}` : "—";
}

function emptyModel(keys: KeyRow[], index: number): ModelRow {
  const key = keys.find((item) => item.enabled && (item.keyPurpose === "inference" || item.keyPurpose === "both"));
  return {
    id: crypto.randomUUID(), provider: key?.provider ?? "openrouter", apiKeyId: key?.id ?? "",
    name: "", displayName: "", enabled: true, isDefault: index === 0, isDraft: true,
    expiresAt: null, providerContextLength: null, providerMaxOutputTokens: null,
    providerRequestLimits: null, providerLimitsCheckedAt: null,
    requestsToday: 0, requestsThisMonth: 0, totalTokensToday: 0, totalTokensThisMonth: 0,
    costUsdToday: 0, costUsdThisMonth: 0, costReportedToday: false, costReportedThisMonth: false,
  };
}

export function AiModelsSettings() {
  const { locale } = useI18n();
  const my = locale === "my";
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelCatalogs, setModelCatalogs] = useState<Record<string, CatalogModel[]>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [loadingCatalogKeyId, setLoadingCatalogKeyId] = useState<string | null>(null);
  const [providerUsage, setProviderUsage] = useState<ProviderUsageRow[] | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState(false);
  const [savingModels, setSavingModels] = useState(false);
  const [error, setError] = useState("");
  const [keysSaveError, setKeysSaveError] = useState("");
  const [keysSaveNotice, setKeysSaveNotice] = useState("");
  const [modelsSaveError, setModelsSaveError] = useState("");
  const [modelsSaveNotice, setModelsSaveNotice] = useState("");
  const saving = savingKeys || savingModels;

  function readKeys(data: { keys: Array<Omit<KeyRow, "apiKey" | "expiresAt"> & { expiresAt: string | null }> }) {
    const rows = data.keys.map((key) => ({ ...key, apiKey: "", expiresAt: toLocalDateTime(key.expiresAt) }));
    setKeys(rows);
    return rows;
  }

  function readModels(data: { models: Array<ModelRow> }) {
    const rows = data.models.map((model) => ({
      ...model,
      providerLimitsCheckedAt: model.providerLimitsCheckedAt ?? null,
      expiresAt: model.expiresAt ? toLocalDateTime(model.expiresAt) : null,
    }));
    setModels(rows);
    return rows;
  }

  function readResponse(data: { keys: Array<Omit<KeyRow, "apiKey" | "expiresAt"> & { expiresAt: string | null }>; models: Array<ModelRow> }) {
    return { keys: readKeys(data), models: readModels(data) };
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/settings/ai-models");
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error ?? "LOAD_FAILED");
        const loaded = readResponse(data);
        const catalogKeyIds = new Set<string>();
        for (const model of loaded.models) {
          if (model.apiKeyId && !catalogKeyIds.has(model.apiKeyId)) {
            catalogKeyIds.add(model.apiKeyId);
            void Promise.resolve().then(() => loadFreeModels(model, loaded.keys));
          }
        }
      } catch {
        setError(my ? "AI ဆက်တင်များကို ဖွင့်မရပါ။" : "Could not load AI settings.");
      } finally {
        setLoading(false);
      }
    })();
    // These helpers are recreated during render; the initial load intentionally uses the current locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [my]);

  function addKey() {
    setKeys((current) => [...current, {
      id: crypto.randomUUID(), provider: "openrouter", label: "", keyPurpose: "inference",
      permissions: null, apiKey: "", keyConfigured: false, keyPreview: null, expiresAt: "", enabled: true,
      lastCheckStatus: null,
    }]);
  }

  function removeKey(id: string) {
    setKeys((current) => current.filter((key) => key.id !== id));
    setModels((current) => {
      const remaining = current.filter((model) => model.apiKeyId !== id);
      if (!remaining.some((model) => model.isDefault && model.enabled)) {
        const replacementId = remaining.find((model) => model.enabled)?.id;
        return remaining.map((model) => ({ ...model, isDefault: model.id === replacementId }));
      }
      return remaining;
    });
  }

  function addModel() {
    const key = keys.find((item) => item.enabled && (item.keyPurpose === "inference" || item.keyPurpose === "both"));
    if (!key) {
      setError(my ? "Model မထည့်ခင် အသုံးပြုခွင့်ရှိတဲ့ inference key တစ်ခုထည့်ပါ။" : "Add an inference-capable key before adding a model.");
      return;
    }
    const model = emptyModel(keys, models.length);
    setModels((current) => [...current, model]);
    void loadFreeModels(model);
    setError("");
  }

  function updateKey(id: string, patch: Partial<KeyRow>) {
    setKeys((current) => current.map((key) => key.id === id ? { ...key, ...patch } : key));
    if (patch.provider || patch.keyPurpose === "management" || patch.enabled === false) {
      const key = keys.find((item) => item.id === id);
      const updatedProvider = patch.provider ?? key?.provider;
      const unusable = patch.keyPurpose === "management" || patch.enabled === false;
      if (key && updatedProvider) {
        setModels((current) => {
          const changed = current.map((model) => model.apiKeyId === id
            ? { ...model, ...(unusable ? { enabled: false, isDefault: false } : {}), provider: updatedProvider }
            : model);
          if (!changed.some((model) => model.isDefault && model.enabled)) {
            const replacementId = changed.find((model) => model.enabled)?.id;
            return changed.map((model) => ({ ...model, isDefault: model.id === replacementId }));
          }
          return changed;
        });
      }
    }
  }

  function updateModel(id: string, patch: Partial<ModelRow>) {
    setModels((current) => current.map((model) => model.id === id ? { ...model, ...patch } : model));
  }

  async function loadFreeModels(model: ModelRow, availableKeys: KeyRow[] = keys) {
    const inferenceKey = availableKeys.find((item) => item.id === model.apiKeyId);
    if (!inferenceKey || !inferenceKey.enabled || inferenceKey.keyPurpose === "management") {
      setCatalogErrors((current) => ({ ...current, [model.id]: my ? "Model list မယူခင် inference key ရွေးပါ။" : "Select an active inference key first." }));
      return;
    }
    const key = availableKeys.find((item) => item.provider === inferenceKey.provider && item.enabled &&
      (!item.expiresAt || new Date(item.expiresAt) > new Date()) && item.keyPurpose === "management") ??
      availableKeys.find((item) => item.provider === inferenceKey.provider && item.enabled &&
        (!item.expiresAt || new Date(item.expiresAt) > new Date()) && item.keyPurpose === "both") ??
      inferenceKey;
    setLoadingCatalogKeyId(model.id);
    setCatalogErrors((current) => ({ ...current, [model.id]: "" }));
    try {
      const response = await fetch("/api/admin/settings/ai-model-catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: key.provider,
          apiKeyId: key.id,
          keyPurpose: key.keyPurpose,
          enabled: key.enabled,
          expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString() : null,
          ...(key.apiKey.trim() ? { apiKey: key.apiKey.trim() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const messages: Record<string, string> = my ? {
          API_KEY_REQUIRED: "Model list မယူခင် provider API key ထည့်ပါ။",
          INVALID_API_KEY: "API key မှားနေပါတယ်။ Provider key ကိုစစ်ပါ။",
          KEY_MISMATCH: "Provider ပြောင်းထားတဲ့ key အတွက် သက်ဆိုင်ရာ API key ကို ပြန်ထည့်ပါ။",
          INFERENCE_KEY_REQUIRED: "Inference ခွင့်ရှိတဲ့ API key ကိုရွေးပါ။",
          MANAGEMENT_KEY_REQUIRED: "OpenRouter model list ကိုယူဖို့ Management key လိုအပ်ပါတယ်။ Management key ထည့်ပြီး ထပ်စမ်းပါ။",
          OPENCODE_ACCESS_DENIED: "OpenCode က 403 Forbidden ပြန်ပေးပါတယ်။ Service account API key မှာ All permission ရှိကြောင်း၊ သက်ဆိုင်ရာ workspace ရဲ့ key ဖြစ်ကြောင်းနဲ့ ဒီ app server ရဲ့ public IP ကို allowlist ထဲထည့်ထားကြောင်း စစ်ပါ။",
          PROVIDER_ACCESS_DENIED: "Provider က 403 Forbidden ပြန်ပေးပါတယ်။ API key permission နဲ့ allowed IP ကို စစ်ပါ။",
          KEY_INACTIVE: "ဒီ API key ကိုပိတ်ထားခြင်း သို့မဟုတ် သက်တမ်းကုန်နေပါတယ်။",
          PROVIDER_UNAVAILABLE: "Provider model list ကို ယခုရယူမရပါ။ ခဏနေရင် ထပ်စမ်းပါ။",
        } : {
          API_KEY_REQUIRED: "Enter a provider API key to load its catalog.",
          INVALID_API_KEY: "The API key was rejected. Check the provider key.",
          KEY_MISMATCH: "Enter a provider API key for the selected provider.",
          INFERENCE_KEY_REQUIRED: "Select an inference-capable API key.",
          MANAGEMENT_KEY_REQUIRED: "OpenRouter requires a management key to list models. Add one and try again.",
          OPENCODE_ACCESS_DENIED: "OpenCode returned 403 Forbidden. Check that this service account key has All permission, belongs to the intended workspace, and allows this app server's public IP.",
          PROVIDER_ACCESS_DENIED: "The provider returned 403 Forbidden. Check the API key permissions and allowed IP address.",
          KEY_INACTIVE: "This API key is disabled or expired.",
          PROVIDER_UNAVAILABLE: "Could not load the provider model catalog. Try again shortly.",
        };
        throw new Error(messages[data.error] ?? (my ? "Free model များရယူမရပါ။" : "Could not load free models."));
      }
      const fetchedAt = typeof data.fetchedAt === "string" ? data.fetchedAt : new Date().toISOString();
      const catalog = (data.models as CatalogModel[]).map((item) => ({ ...item, fetchedAt }));
      setModelCatalogs((current) => ({ ...current, [key.id]: catalog, [model.apiKeyId]: catalog }));
      const currentCatalogModel = catalog.find((item) => item.id === model.name);
      if (currentCatalogModel) {
        updateModel(model.id, {
          displayName: model.displayName || currentCatalogModel.name,
          providerContextLength: currentCatalogModel.providerContextLength,
          providerMaxOutputTokens: currentCatalogModel.providerMaxOutputTokens,
          providerRequestLimits: currentCatalogModel.providerRequestLimits,
          providerLimitsCheckedAt: currentCatalogModel.fetchedAt ?? fetchedAt,
        });
      }
      if (catalog.length === 0) {
        setCatalogErrors((current) => ({ ...current, [model.id]: my ? "ဒီ provider မှာ အခမဲ့ model မတွေ့ပါ။" : "No free models are currently listed for this provider." }));
      }
    } catch (catalogError) {
      setCatalogErrors((current) => ({ ...current, [model.id]: catalogError instanceof Error ? catalogError.message : (my ? "Model list ရယူမရပါ။" : "Could not load models." ) }));
    } finally {
      setLoadingCatalogKeyId(null);
    }
  }

  function setModelActive(id: string, enabled: boolean) {
    setModels((current) => {
      const changed = current.map((model) => ({
        ...model,
        enabled: model.id === id ? enabled : model.enabled,
        isDefault: model.id === id && !enabled ? false : model.isDefault,
      }));
      if (enabled && !changed.some((model) => model.isDefault && model.enabled)) {
        return changed.map((model) => ({ ...model, isDefault: model.id === id }));
      }
      if (!enabled && current.find((model) => model.id === id)?.isDefault) {
        const replacement = changed.find((model) => model.enabled);
        return changed.map((model) => ({ ...model, isDefault: model.id === replacement?.id }));
      }
      return changed;
    });
  }

  function removeModel(id: string) {
    setModels((current) => {
      const removedDefault = current.some((model) => model.id === id && model.isDefault);
      const remaining = current.filter((model) => model.id !== id);
      if (removedDefault && remaining.some((model) => model.enabled)) {
        const replacementId = remaining.find((model) => model.enabled)?.id;
        return remaining.map((model) => ({ ...model, isDefault: model.id === replacementId }));
      }
      return remaining;
    });
  }

  async function saveKeys() {
    setSavingKeys(true);
    setKeysSaveError("");
    setKeysSaveNotice("");
    try {
      const submittedKeys = keys.filter((key) => !(!key.keyConfigured && !key.label.trim() && !key.apiKey.trim()));
      const incompleteKey = submittedKeys.find((key) => !key.label.trim() || (!key.keyConfigured && !key.apiKey.trim()));
      if (incompleteKey) {
        throw new Error(my ? "Key တစ်ခုချင်းစီအတွက် အမည်နဲ့ API key ဖြည့်ပါ။" : "Enter a label and API key for each new credential.");
      }
      const submittedModels = models.filter((model) => !(model.isDraft && !model.name.trim() && !model.displayName.trim()));
      const incompleteModel = submittedModels.find((model) => !model.name.trim() || !model.displayName.trim() || !model.apiKeyId);
      if (incompleteModel) {
        throw new Error(my ? "ကျန်ရှိတဲ့ model တစ်ခုချင်းစီအတွက် provider, inference key, model နဲ့ ပြသမည့်အမည်ကို ဖြည့်ပါ။" : "Complete each remaining model's provider, inference key, model, and display name before saving provider keys.");
      }
      const response = await fetch("/api/admin/settings/ai-models", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keys: submittedKeys.map(({ id, provider, label, keyPurpose, permissions, apiKey, expiresAt, enabled }) => ({
            id, provider, label, keyPurpose, permissions, enabled,
            expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          })),
          models: submittedModels.map(({ id, provider, apiKeyId, name, displayName, enabled, isDefault, providerContextLength, providerMaxOutputTokens, providerRequestLimits, providerLimitsCheckedAt }) => ({
            id, provider, apiKeyId, name, displayName, enabled, isDefault,
            providerContextLength, providerMaxOutputTokens, providerRequestLimits, providerLimitsCheckedAt,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.error === "API_KEY_REQUIRED") throw new Error(my ? "အသစ်ထည့်ထားတဲ့ key အတွက် API key ထည့်ပါ။" : "Enter an API key for each new credential.");
        if (data.error === "MODEL_INFERENCE_KEY_REQUIRED") throw new Error(my ? "ကျန်ရှိတဲ့ model များအတွက် သက်ဆိုင်ရာ inference key ကိုရွေးပါ။" : "Select a matching inference key for each remaining model.");
        if (data.error === "VALIDATION_ERROR") throw new Error(my ? "Provider key နဲ့ model ဆက်တင်များကို စစ်ပြီး ပြန်သိမ်းပါ။" : "Check the provider key and model settings, then save again.");
        throw new Error(my ? "API key များကို သိမ်းမရပါ။ ထပ်စမ်းပါ။" : "Could not save API keys. Please retry.");
      }
      readResponse(data);
      setKeysSaveNotice(my ? "Provider API key နဲ့ ဆက်စပ် model ဆက်တင်များကို သိမ်းပြီးပါပြီ။" : "Provider keys and model settings saved.");
    } catch (saveError) {
      setKeysSaveError(saveError instanceof Error ? saveError.message : (my ? "API key များကို သိမ်းမရပါ။" : "Could not save API keys."));
    } finally {
      setSavingKeys(false);
    }
  }

  async function saveModels() {
    setSavingModels(true);
    setModelsSaveError("");
    setModelsSaveNotice("");
    try {
      const submittedModels = models.filter((model) => !(model.isDraft && !model.name.trim() && !model.displayName.trim()));
      const incompleteModel = submittedModels.find((model) => !model.name.trim() || !model.displayName.trim() || !model.apiKeyId);
      if (incompleteModel) {
        throw new Error(my ? "Model တစ်ခုချင်းစီအတွက် provider, inference key နဲ့ model ကိုရွေးပြီး ပြသမည့်အမည် ဖြည့်ပါ။" : "Complete the provider, inference credential, model, and display name for each model.");
      }
      if (submittedModels.some((model) => model.name.trim().length > 200 || model.displayName.trim().length > 120)) {
        throw new Error(my ? "Model အမည်မှာ စာလုံး ၂၀၀၊ ပြသမည့်အမည်မှာ စာလုံး ၁၂၀ ထက်မကျော်ရပါ။" : "Model names must be 200 characters or fewer; display names must be 120 or fewer.");
      }
      const invalidLimit = submittedModels.some((model) =>
        [model.providerContextLength, model.providerMaxOutputTokens].some((limit) => limit !== null && (!Number.isInteger(limit) || limit < 1)));
      if (invalidLimit) {
        throw new Error(my ? "Provider model metadata ကို မှန်ကန်သော ကိန်းပြည့်ဖြစ်ကြောင်း စစ်ပါ။" : "Provider model metadata must contain positive whole numbers.");
      }
      const response = await fetch("/api/admin/settings/ai-models/models", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          models: submittedModels.map(({ id, provider, apiKeyId, name, displayName, enabled, isDefault, providerContextLength, providerMaxOutputTokens, providerRequestLimits, providerLimitsCheckedAt }) => ({
            id, provider, apiKeyId, name, displayName, enabled, isDefault,
            providerContextLength, providerMaxOutputTokens, providerRequestLimits, providerLimitsCheckedAt,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (data.error === "MODEL_INFERENCE_KEY_REQUIRED" || data.error === "MODEL_KEY_NOT_FOUND") {
          throw new Error(my ? "Model မသိမ်းခင် သက်ဆိုင်ရာ inference key ကို အရင်သိမ်းပါ။" : "Save the matching inference key before saving this model.");
        }
        if (data.error === "DEFAULT_MODEL_REQUIRED") throw new Error(my ? "အသက်ဝင်နေတဲ့ model တစ်ခုကို ပုံမှန်အဖြစ်ရွေးပါ။" : "Select one active model as the default.");
        throw new Error(my ? "Model များကို သိမ်းမရပါ။ ထပ်စမ်းပါ။" : "Could not save models. Please retry.");
      }
      readModels(data);
      setModelsSaveNotice(my ? "AI model ဆက်တင်များကို သိမ်းပြီးပါပြီ။" : "AI model settings saved.");
    } catch (saveError) {
      setModelsSaveError(saveError instanceof Error ? saveError.message : (my ? "Model များကို သိမ်းမရပါ။" : "Could not save models."));
    } finally {
      setSavingModels(false);
    }
  }

  async function loadProviderUsage() {
    setLoadingUsage(true);
    setError("");
    try {
      const response = await fetch("/api/admin/settings/ai-usage", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error("USAGE_LOAD_FAILED");
      setProviderUsage(data.usage as ProviderUsageRow[]);
    } catch {
      setError(my ? "Provider usage ကို ဖတ်မရပါ။ Key permission နဲ့ internet connection ကိုစစ်ပါ။" : "Could not load provider usage. Check key permissions and connectivity.");
    } finally { setLoadingUsage(false); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{my ? "Provider API keys" : "Provider API keys"}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {my ? "Provider key တစ်ခုကို model အများကြီးမှာ မျှဝေသုံးနိုင်သည်။ Key များကို encrypted သိမ်းထားသည်။" : "Share one provider credential across models. Keys are encrypted at rest and never shown again."}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={addKey} disabled={loading || saving}>{my ? "Key ထည့်ရန်" : "Add key"}</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">{my ? "ဖွင့်နေသည်…" : "Loading…"}</p>}
          {!loading && keys.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{my ? "Provider key မရှိသေးပါ။ Key ထည့်ရန်နှိပ်ပါ။" : "No provider keys configured. Select Add key to create one."}</p>}
          {keys.length > 0 && <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-muted/50 text-left"><tr>{[my ? "Provider" : "Provider", my ? "အမည်" : "Label", my ? "Key access" : "Key access", my ? "API credential" : "API credential", my ? "သက်တမ်းကုန်ချိန်" : "Expires at", my ? "အခြေအနေ" : "Status", ""].map((heading, i) => <th key={i} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
            <tbody className="divide-y">
              {keys.map((key) => {
                const modelUsesKey = models.some((model) => model.apiKeyId === key.id);
                return <tr key={key.id} className="align-top">
                  <td className="w-48 p-3"><select aria-label="Provider" value={key.provider} onChange={(event) => { const provider = event.target.value as Provider; updateKey(key.id, { provider, permissions: provider !== "openrouter" ? (key.keyPurpose === "inference" ? "inference_only" : "all") : null }); }} disabled={saving || modelUsesKey} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="openrouter">OpenRouter</option><option value="opencode_zen">OpenCode Zen</option><option value="opencode_console">OpenCode Console</option></select>{modelUsesKey && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{my ? "Model က ဒီ key ကိုသုံးနေသည်။" : "Used by a model."}</p>}</td>
                  <td className="w-40 p-3"><Input aria-label={my ? "အမည်" : "Label"} value={key.label} placeholder="Production" onChange={(event) => updateKey(key.id, { label: event.target.value })} disabled={saving} /></td>
                  <td className="w-48 p-3"><select aria-label="Key access" value={key.keyPurpose} onChange={(event) => updateKey(key.id, { keyPurpose: event.target.value as KeyPurpose, permissions: key.provider !== "openrouter" ? (event.target.value === "inference" ? "inference_only" : "all") : null })} disabled={saving} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="inference">{my ? "Inference သာ" : "Inference only"}</option><option value="management" disabled={modelUsesKey}>{my ? "Management သာ" : "Management only"}</option>{key.provider !== "openrouter" && <option value="both">Inference + Management (All)</option>}</select>{key.provider !== "openrouter" && <p className="mt-1 max-w-48 text-xs text-muted-foreground">{my ? "Budget API အတွက် All permission လိုသည်။" : "Budget API requires All permission."}</p>}</td>
                  <td className="w-64 p-3"><Input aria-label={key.provider === "openrouter" ? "OpenRouter key" : "OpenCode service key"} type="password" autoComplete="new-password" value={key.apiKey} placeholder={key.keyPreview ?? (my ? "API key ထည့်ပါ" : "Enter API key")} onChange={(event) => updateKey(key.id, { apiKey: event.target.value })} disabled={saving} /><p className="mt-1 text-xs text-muted-foreground">{key.keyConfigured ? `${my ? "သိမ်းထားပြီး" : "Configured"}: ${key.keyPreview}` : (my ? "Server တွင်သာ သိမ်းဆည်းအသုံးပြုသည်။" : "Used server-side; never returned.")}</p>{key.provider !== "openrouter" && <p className="mt-1 max-w-64 text-xs text-muted-foreground">{key.provider === "opencode_zen" ? (my ? "Zen API key သာသုံးပါ။ Console service-account key မသုံးပါနှင့်။" : "Use an OpenCode Zen API key here, not a Console service-account key.") : (my ? "Console service-account key သုံးပါ။ Zen API key မသုံးပါနှင့်။" : "Use an OpenCode Console service-account key here, not a Zen API key.")}</p>}</td>
                  <td className="w-52 p-3"><Input aria-label={my ? "သက်တမ်းကုန်ချိန်" : "Expires at"} type="datetime-local" value={key.expiresAt} onChange={(event) => updateKey(key.id, { expiresAt: event.target.value })} disabled={saving} /></td>
                  <td className="w-36 p-3"><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={key.enabled} onChange={(event) => updateKey(key.id, { enabled: event.target.checked })} disabled={saving} className="size-4 accent-primary" />{key.enabled ? (my ? "အသက်ဝင်" : "Active") : (my ? "ပိတ်ထား" : "Inactive")}</label><p className="mt-1 text-xs text-muted-foreground">{key.lastCheckStatus ?? (my ? "မစစ်ဆေးရသေး" : "Not checked")}</p></td>
                  <td className="p-3"><Button type="button" variant="ghost" size="sm" onClick={() => removeKey(key.id)} disabled={saving}>{my ? "ဖယ်ရှားရန်" : "Remove"}</Button></td>
                </tr>;
              })}
            </tbody>
          </table></div>}
          {keysSaveError && <p role="alert" className="text-sm text-destructive">{keysSaveError}</p>}
          {keysSaveNotice && <p role="status" className="text-sm text-emerald-700">{keysSaveNotice}</p>}
          <div className="flex justify-end border-t pt-4">
            <Button type="button" onClick={() => void saveKeys()} disabled={loading || savingKeys}>
              {savingKeys ? (my ? "Key များသိမ်းနေသည်…" : "Saving keys…") : (my ? "API key များသိမ်းရန်" : "Save API keys")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="space-y-1"><CardTitle>{my ? "Provider သုံးစွဲမှုနှင့် လက်ကျန်" : "Provider usage and remaining budget"}</CardTitle><p className="text-sm text-muted-foreground">{my ? "OpenRouter account credit နဲ့ လက်ရှိ key ရဲ့ credit limit/နေ့စဉ်၊ အပတ်စဉ်၊ လစဉ် သုံးစွဲမှုကို API ကနေဖတ်သည်။ OpenCode Console workspace member လစဉ် budget များကိုဖတ်သည်။ Zen အတွက် budget API မရှိပါ။" : "Reads OpenRouter account credits and the current key’s credit limit plus daily, weekly, and monthly usage. Also reads OpenCode Console workspace member monthly budgets. Zen does not expose a budget API."}</p></div>
          <Button type="button" variant="outline" onClick={() => void loadProviderUsage()} disabled={loading || loadingUsage || saving}>{loadingUsage ? (my ? "စစ်နေသည်…" : "Checking…") : (my ? "Usage စစ်ရန်" : "Check usage")}</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {providerUsage === null && <p className="text-sm text-muted-foreground">{my ? "Usage ကိုစစ်ရန် ခလုတ်နှိပ်ပါ။" : "Select Check usage to fetch current provider data."}</p>}
          {providerUsage?.length === 0 && <p className="text-sm text-muted-foreground">{my ? "စစ်ဆေးနိုင်တဲ့ provider key မရှိပါ။" : "No active provider credentials available to check."}</p>}
          {!!providerUsage?.length && <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[850px] text-sm">
            <thead className="bg-muted/50 text-left"><tr>{[my ? "Provider / Key" : "Provider / Key", my ? "Member / Scope" : "Member / Scope", my ? "သုံးပြီး" : "Spent", my ? "Limit / ကျန်ငွေ" : "Limit / Remaining", my ? "ပြန်စချိန်" : "Reset", my ? "အသုံးပြုမှု" : "Usage"].map((heading, i) => <th key={i} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
            <tbody className="divide-y">{providerUsage.map((usage, index) => {
              const hasLimit = usage.limitUsd != null && Number.isFinite(usage.limitUsd);
              const spent = usage.spentUsd != null && Number.isFinite(usage.spentUsd) ? usage.spentUsd : null;
              const remaining = usage.remainingUsd != null && Number.isFinite(usage.remainingUsd)
                ? usage.remainingUsd
                : hasLimit && spent !== null ? Math.max(0, usage.limitUsd! - spent) : null;
              const ratio = hasLimit && usage.limitUsd! > 0 && spent !== null ? Math.min(100, Math.round(spent / usage.limitUsd! * 100)) : null;
              return <tr key={`${usage.keyId}-${usage.scopeId ?? usage.scope}-${index}`}>
                <td className="px-3 py-3"><p className="font-medium">{usage.provider === "openrouter" ? "OpenRouter" : usage.provider === "opencode_zen" ? "OpenCode Zen" : "OpenCode Console"}</p><p className="text-muted-foreground">{usage.label}</p></td>
                <td className="px-3 py-3">{usage.error === "BUDGETS_NOT_SUPPORTED"
                  ? (my ? "OpenCode Zen budget မရနိုင်ပါ" : "Budget API not available for OpenCode Zen")
                  : usage.member ?? usage.scope}</td>
                <td className="whitespace-nowrap px-3 py-3">{usage.error
                  ? <span className="text-destructive">{usage.error === "BUDGET_PERMISSION_REQUIRED"
                    ? (my ? "All permission လိုသည်" : "All permission required")
                    : usage.error === "BUDGET_ACCESS_DENIED"
                      ? (my ? `OpenCode 403: All permission၊ service account/workspace နဲ့ server public IP allowlist ကို စစ်ပါ${usage.providerStatus ? ` (HTTP ${usage.providerStatus})` : ""}` : `OpenCode 403: check All permission, service account/workspace, and server public IP allowlist${usage.providerStatus ? ` (HTTP ${usage.providerStatus})` : ""}`)
                    : usage.error === "BUDGETS_NOT_SUPPORTED"
                      ? "—"
                      : (my ? "ဖတ်မရပါ" : "Unavailable")}</span>
                  : <>{money(spent, 4)}{usage.scope === "key" && <span className="block text-xs text-muted-foreground">{my ? "နေ့" : "Day"} {money(usage.dailySpentUsd, 4)} · {my ? "အပတ်" : "Week"} {money(usage.weeklySpentUsd, 4)} · {my ? "လ" : "Month"} {money(usage.monthlySpentUsd, 4)}{usage.isFreeTier === true ? (my ? " · Free tier" : " · Free tier") : ""}</span>}</>}</td>
                <td className="whitespace-nowrap px-3 py-3">{usage.error
                  ? "—"
                  : !hasLimit
                    ? (my ? "Limit မရှိ" : "Unlimited")
                    : <>{money(usage.limitUsd)}<span className="block text-xs text-muted-foreground">{my ? "ကျန်" : "Remaining"} {money(remaining)}{usage.budgetSource ? ` · ${usage.budgetSource === "default" ? (my ? "ပုံမှန်" : "default") : usage.budgetSource}` : ""}</span></>}</td>
                <td className="whitespace-nowrap px-3 py-3">{usage.resetAt ? new Date(usage.resetAt).toLocaleDateString() : usage.resetPeriod ?? "—"}</td>
                <td className="w-44 px-3 py-3">{usage.error === "BUDGETS_NOT_SUPPORTED"
                  ? "—"
                  : usage.exceeded
                    ? (my ? "Limit ပြည့်သွားပါပြီ" : "Budget exceeded")
                    : ratio !== null && !usage.error
                      ? <div className="flex items-center gap-2"><div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${ratio >= 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${ratio}%` }} /></div><span className="w-10 text-right tabular-nums">{ratio}%</span></div>
                      : "—"}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="space-y-1"><CardTitle>{my ? "အသုံးပြုမည့် AI model များ" : "Enabled AI models"}</CardTitle><p className="text-sm text-muted-foreground">{my ? "Model တစ်ခုချင်းစီကို inference key နဲ့ချိတ်ပါ။ Provider limit များကို catalog မှဖတ်ပြီး အသစ်ပြန်ရယူရန် catalog ကိုပြန်ဖွင့်ပါ။" : "Assign each model to an inference credential. Provider limits are read from its catalog; reload the catalog to refresh them."}</p></div>
          <Button type="button" variant="outline" onClick={addModel} disabled={loading || saving}>{my ? "Model ထည့်ရန်" : "Add model"}</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{my ? "ဒီ app က request cap မသတ်မှတ်ပါ။ Model-specific provider limit များကို `ai_model` တွင် provider catalog snapshot အဖြစ်၊ key/account/member budget များကို `ai_api_key` တွင် provider response snapshot အဖြစ် သိမ်းထားသည်။ အောက်ပါ request/token/cost အရေအတွက်များသည် app ကတိုင်းတာထားသော usage ဖြစ်ပြီး limit မဟုတ်ပါ။" : "This app does not set request caps. Model-specific provider limits are stored as catalog snapshots on ai_model; key/account/member budgets are stored as provider response snapshots on ai_api_key. Request, token, and cost figures below are app-observed usage, not limits."}</p>
          {!models.length && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{my ? "Model မရှိသေးပါ။ Model ထည့်ရန်နှိပ်ပါ။" : "No models configured. Select Add model to create one."}</p>}
          {!!models.length && <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[1500px] text-sm">
            <thead className="bg-muted/50 text-left"><tr>{["Provider", my ? "Inference key" : "Credential", "Model", my ? "ပြသမည့်အမည်" : "Display name", my ? "Provider limit metadata" : "Provider limit metadata", my ? "Usage (app တိုင်းတာမှု)" : "Observed usage", my ? "အခြေအနေ" : "Status", ""].map((heading, i) => <th key={i} className="px-3 py-2 font-medium">{heading}</th>)}</tr></thead>
            <tbody className="divide-y">{models.map((model) => {
              const usableKeys = keys.filter((key) => key.provider === model.provider && key.enabled && (key.keyPurpose === "inference" || key.keyPurpose === "both"));
              return <tr key={model.id} className="align-top">
                <td className="w-48 p-3"><select aria-label="Provider" value={model.provider} onChange={(event) => { const provider = event.target.value as Provider; const nextKey = keys.find((key) => key.provider === provider && key.enabled && (key.keyPurpose === "inference" || key.keyPurpose === "both")); const changed = { ...model, provider, apiKeyId: nextKey?.id ?? "", name: "", displayName: "", providerContextLength: null, providerMaxOutputTokens: null, providerRequestLimits: null, providerLimitsCheckedAt: null }; updateModel(model.id, changed); setCatalogErrors((current) => ({ ...current, [model.id]: "" })); if (nextKey) void loadFreeModels(changed); }} disabled={saving} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="openrouter">OpenRouter</option><option value="opencode_zen">OpenCode Zen</option><option value="opencode_console">OpenCode Console</option></select></td>
                <td className="w-44 p-3"><select aria-label={my ? "Inference key" : "Inference credential"} value={model.apiKeyId} onChange={(event) => { const apiKeyId = event.target.value; const changed = { ...model, apiKeyId }; updateModel(model.id, changed); setCatalogErrors((current) => ({ ...current, [model.id]: "" })); if (apiKeyId) void loadFreeModels(changed); }} disabled={saving} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="">{my ? "Key ရွေးပါ" : "Select key"}</option>{usableKeys.map((key) => <option key={key.id} value={key.id}>{key.label}</option>)}</select></td>
                <td className="w-64 p-3"><select aria-label={my ? "Provider model ရွေးပါ" : "Select provider model"} value={model.name} onChange={(event) => { const selected = (modelCatalogs[model.apiKeyId] ?? []).find((item) => item.id === event.target.value); if (selected) updateModel(model.id, { name: selected.id, displayName: selected.name, providerContextLength: selected.providerContextLength, providerMaxOutputTokens: selected.providerMaxOutputTokens, providerRequestLimits: selected.providerRequestLimits, providerLimitsCheckedAt: selected.fetchedAt ?? null, isDraft: false }); }} disabled={saving || loadingCatalogKeyId === model.id || !modelCatalogs[model.apiKeyId]?.length} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"><option value="">{loadingCatalogKeyId === model.id ? (my ? "Model များရယူနေသည်…" : "Loading models…") : (my ? "Model ရွေးပါ" : "Select model")}</option>{model.name && !(modelCatalogs[model.apiKeyId] ?? []).some((item) => item.id === model.name) && <option value={model.name}>{model.name}</option>}{(modelCatalogs[model.apiKeyId] ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select>{catalogErrors[model.id] && <p role="status" className="mt-1 max-w-64 text-xs text-muted-foreground">{catalogErrors[model.id]}</p>}</td>
                <td className="w-48 p-3"><Input aria-label={my ? "ပြသမည့်အမည်" : "Display name"} value={model.displayName} placeholder={my ? "ပြသမည့်အမည်" : "Display name"} onChange={(event) => updateModel(model.id, { displayName: event.target.value, isDraft: false })} disabled={saving} /></td>
                <td className="w-96 p-3"><p className="text-xs">{my ? "Context" : "Context"}: {model.providerContextLength?.toLocaleString() ?? "—"}</p><p className="text-xs">{my ? "အများဆုံး output tokens" : "Max output tokens"}: {model.providerMaxOutputTokens?.toLocaleString() ?? "—"}</p><p className="mt-1 text-xs text-muted-foreground">{providerLimitsSummary(model.providerRequestLimits, my, model.provider)}</p><p className="mt-1 text-xs text-muted-foreground">{my ? "ရယူချိန်" : "Fetched"}: {model.providerLimitsCheckedAt ? new Date(model.providerLimitsCheckedAt).toLocaleString() : "—"}</p></td>
                <td className="w-64 p-3"><p className="text-xs">{my ? `ယနေ့ ${model.requestsToday} requests` : `Today ${model.requestsToday} requests`}</p><p className="text-xs">{my ? `ယခုလ ${model.requestsThisMonth} requests` : `Month ${model.requestsThisMonth} requests`}</p><p className="mt-1 text-xs text-muted-foreground">{my ? `Tokens ${model.totalTokensToday.toLocaleString()} · $${model.costUsdToday.toFixed(4)}` : `Tokens ${model.totalTokensToday.toLocaleString()} · $${model.costUsdToday.toFixed(4)}`}</p></td>
                <td className="w-36 p-3"><div className="space-y-2"><label className="flex items-center gap-2 whitespace-nowrap"><input type="radio" name="ai-model-default" checked={model.isDefault} onChange={() => setModels((current) => current.map((item) => ({ ...item, isDefault: item.id === model.id })))} disabled={saving || !model.enabled} className="size-4 accent-primary" />{my ? "ပုံမှန်" : "Default"}</label><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={model.enabled} onChange={(event) => setModelActive(model.id, event.target.checked)} disabled={saving} className="size-4 accent-primary" />{model.enabled ? (my ? "အသက်ဝင်" : "Active") : (my ? "ပိတ်ထား" : "Inactive")}</label></div></td>
                <td className="p-3"><Button type="button" variant="ghost" size="sm" onClick={() => removeModel(model.id)} disabled={saving}>{my ? "ဖယ်ရှားရန်" : "Remove"}</Button></td>
              </tr>;
            })}</tbody>
          </table></div>}
          {modelsSaveError && <p role="alert" className="text-sm text-destructive">{modelsSaveError}</p>}
          {modelsSaveNotice && <p role="status" className="text-sm text-emerald-700">{modelsSaveNotice}</p>}
          <div className="flex justify-end border-t pt-4">
            <Button type="button" onClick={() => void saveModels()} disabled={loading || savingModels}>
              {savingModels ? (my ? "Model များသိမ်းနေသည်…" : "Saving models…") : (my ? "AI model များသိမ်းရန်" : "Save AI models")}
            </Button>
          </div>
        </CardContent>
      </Card>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

