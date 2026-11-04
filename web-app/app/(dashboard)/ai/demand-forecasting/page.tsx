"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { localizeNode, useI18n } from "@/lib/i18n";
import { PageShell, usePageSession } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ForecastRow {
  product_id: string;
  product_name: string;
  avg_daily_sales: number;
  on_hand: number;
  days_of_cover: number | null;
  reorder_threshold: number;
  below_threshold: boolean;
  suggested_qty: number;
  needs_order: boolean;
}

interface AvailableModel {
  id: string;
  provider: string;
  name: string;
  displayName: string;
  isDefault: boolean;
}

interface TrainStep {
  step: string;
  status: string;
  duration_ms: number;
  detail?: Record<string, unknown>;
}

interface TrainRun {
  run_id: string;
  run_dir: string;
  trained_at: string;
  test_mae: number | null;
  test_cells?: number;
  baseline_mae: Record<string, number | null>;
  steps: TrainStep[];
  per_product_mae: Array<{ product_id: string; product_name: string; mae: number }>;
  test_samples: Array<{
    product_id: string;
    product_name: string;
    days: string[];
    actual: number[];
    predicted: number[];
  }>;
  split: { train?: string[]; validation?: string[]; test?: string[] };
}

interface ActiveModel {
  trained_at: string;
  run_dir: string;
  model: { algorithm: string; window: number; alpha: number };
  metrics: { test_mae: number; baseline_mae: Record<string, number> };
}

const LAST_MODEL_STORAGE_KEY = "smartretail.ai-forecast.last-model";

const ALL_STEPS = [
  "collect_dataset", "prepare_dataset", "load_dataset", "chronological_split",
  "grid_search", "refit_final_model", "evaluate_on_test", "write_artifacts",
  "activate_model",
] as const;

const STEP_LABELS: Record<string, string> = {
  collect_dataset: "Collect dataset",
  prepare_dataset: "Prepare dataset",
  load_dataset: "Load dataset",
  chronological_split: "Chronological split",
  grid_search: "Grid search",
  refit_final_model: "Refit final model",
  evaluate_on_test: "Evaluate on test",
  write_artifacts: "Write artifacts",
  activate_model: "Activate model",
};

function StatusDot({ status }: { status: string }) {
  const color = status === "ok" ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-amber-500";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.some((v) => typeof v === "object" && v !== null)) {
      return `${value.length} items`;
    }
    return value.join(" → ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number") {
    if (key.endsWith("_pct") || key === "sparsity_pct") return `${value}%`;
    if (key === "improvement") return `${value > 0 ? "+" : ""}${value}%`;
    return String(value);
  }
  return String(value);
}

function StepDetailGrid({ detail }: { detail: Record<string, unknown> }) {
  // Keys with dedicated visual renderers are excluded from the generic grid.
  const skip = new Set(["results", "seasonal_profile", "profile_labels"]);
  const entries = Object.entries(detail).filter(
    ([k, v]) => !skip.has(k) && v !== null && v !== undefined,
  );
  if (entries.length === 0) return null;
  return (
    <div className="ml-5 mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-1.5 text-[11px]">
          <span className="shrink-0 text-muted-foreground/60">{k}</span>
          <span className="font-mono text-muted-foreground">
            {typeof v === "object" && !Array.isArray(v)
              ? Object.entries(v as Record<string, unknown>)
                  .map(([ik, iv]) => `${ik}: ${typeof iv === "number" ? iv : String(iv)}`)
                  .join(", ")
              : formatValue(k, v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function GridResultsTable({ results }: { results: Array<{ window: number; alpha: number; mae: number }> }) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const best = results[0]?.mae;
  const { locale } = useI18n();
  return localizeNode(locale, (
    <div className="ml-5 mt-2 max-h-48 overflow-auto rounded border">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-muted/50">
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1 font-medium">#</th>
            <th className="px-2 py-1 font-medium">window</th>
            <th className="px-2 py-1 font-medium">alpha</th>
            <th className="px-2 py-1 font-medium">validation MAE</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={`${r.window}-${r.alpha}`} className={i === 0 ? "bg-emerald-500/10" : ""}>
              <td className="px-2 py-0.5 text-muted-foreground">{i + 1}</td>
              <td className="px-2 py-0.5 font-mono">{r.window}d</td>
              <td className="px-2 py-0.5 font-mono">{r.alpha}</td>
              <td className={`px-2 py-0.5 font-mono ${i === 0 ? "font-semibold text-emerald-600" : ""}`}>
                {r.mae}{i === 0 ? " ★" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ));
}

function SeasonalProfileBars({ profile, labels }: { profile: number[]; labels: string[] }) {
  if (!Array.isArray(profile) || profile.length === 0) return null;
  const maxAbs = Math.max(...profile.map(Math.abs), 0.01);
  return (
    <div className="ml-5 mt-2 flex items-end gap-1.5">
      {profile.map((v, i) => {
        const h = Math.max(4, Math.abs(v) / maxAbs * 28);
        const positive = v >= 0;
        return (
          <div key={labels[i] ?? i} className="flex flex-col items-center gap-0.5" title={`${labels[i]}: ${v.toFixed(3)}`}>
            <span className="text-[9px] font-mono text-muted-foreground/60">{v.toFixed(2)}</span>
            <div
              className={`w-6 rounded-sm ${positive ? "bg-emerald-500/60" : "bg-red-400/60"}`}
              style={{ height: h }}
            />
            <span className="text-[9px] text-muted-foreground/60">{labels[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

function TrainingStepRow({ step }: { step: TrainStep }) {
  const { locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const detail = step.detail ?? {};
  const hasGrid = Array.isArray(detail.results);
  const hasProfile = Array.isArray(detail.seasonal_profile);
  const hasExpandable = Object.keys(detail).length > 0;
  return localizeNode(locale, (
    <div className="border-b border-border/40 last:border-0">
      <button
        type="button"
        onClick={() => hasExpandable && setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 py-1.5 text-left text-xs ${hasExpandable ? "hover:bg-muted/30" : "cursor-default"}`}
      >
        <StatusDot status={step.status} />
        <span className="font-medium text-foreground">{STEP_LABELS[step.step] ?? step.step}</span>
        <span className="font-mono text-[10px] text-muted-foreground/50">{step.step}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">{step.duration_ms} ms</span>
        {hasExpandable && (
          <span className="shrink-0 text-muted-foreground/40">{expanded ? "▾" : "▸"}</span>
        )}
      </button>
      {expanded && (
        <div className="pb-2">
          <StepDetailGrid detail={detail} />
          {hasGrid && <GridResultsTable results={detail.results as Array<{ window: number; alpha: number; mae: number }>} />}
          {hasProfile && (
            <SeasonalProfileBars
              profile={detail.seasonal_profile as number[]}
              labels={(detail.profile_labels as string[]) ?? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
            />
          )}
        </div>
      )}
    </div>
  ));
}

function TrainingProgressBar({ steps }: { steps: TrainStep[] }) {
  const { locale } = useI18n();
  const done = new Set(steps.map((s) => s.step));
  const completed = ALL_STEPS.filter((s) => done.has(s)).length;
  const pct = Math.round((completed / ALL_STEPS.length) * 100);
  return localizeNode(locale, (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Progress</span>
        <span className="font-mono">{completed}/{ALL_STEPS.length} steps · {pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  ));
}

export default function ForecastingPage() {
  const { locale } = useI18n();
  const { session } = usePageSession();
  const isAdmin = session?.user.role === "admin";
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [insights, setInsights] = useState("");
  const [productCount, setProductCount] = useState(0);
  const [needOrderCount, setNeedOrderCount] = useState(0);
  const [totalSuggested, setTotalSuggested] = useState(0);
  const [days, setDays] = useState(30);
  const [needsOnly, setNeedsOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [forecastSource, setForecastSource] = useState<string>("");
  const [active, setActive] = useState<ActiveModel | null>(null);
  const [runs, setRuns] = useState<TrainRun[]>([]);
  const [trainSteps, setTrainSteps] = useState<TrainStep[]>([]);
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  // The model detail panel (metrics + charts) is the point of this page —
  // it is open by default.
  const [showModelPanel, setShowModelPanel] = useState(true);

  async function loadArtifacts() {
    try {
      const res = await fetch("/api/ai/forecast/train");
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setActive((data.active as ActiveModel | null) ?? null);
        const loadedRuns = (data.runs as TrainRun[]) ?? [];
        setRuns(loadedRuns);
        // After a page reload the SSE stream is gone — restore the training
        // log from the newest run's steps so the detail stays visible.
        if (trainSteps.length === 0 && loadedRuns[0]?.steps?.length) {
          setTrainSteps(loadedRuns[0].steps);
        }
      }
    } catch {
      // The model panel is optional — the forecast itself still works.
    }
  }

  function startTraining() {
    setTraining(true);
    setTrainError(null);
    setTrainSteps([]);
    const source = new EventSource("/api/ai/forecast/train/stream");
    source.addEventListener("status", (event) => {
      const message = (event as MessageEvent).data;
      try {
        const parsed = JSON.parse(message) as TrainStep & { step: string };
        if (parsed && typeof parsed.step === "string") {
          setTrainSteps((prev) => [...prev.filter((s) => s.step !== parsed.step), parsed]);
        }
      } catch {
        // A plain status string ("collecting_dataset") — ignore the payload.
      }
    });
    source.addEventListener("done", (event) => {
      const message = (event as MessageEvent).data;
      try {
        const payload = JSON.parse(message) as { ok: boolean; error?: string };
        if (!payload.ok) setTrainError(locale === "my" ? "မော်ဒယ်လေ့ကျင့်မှု မအောင်မြင်ပါ။" : payload.error ?? "Training failed");
      } catch {
        setTrainError(locale === "my" ? "မော်ဒယ်လေ့ကျင့်မှု မအောင်မြင်ပါ။" : "Training failed");
      }
      source.close();
      setTraining(false);
      void loadArtifacts();
      // The forecast job re-reads the database (slow over the pooler), so the
      // refresh runs in the background: the table below stays visible with the
      // previously loaded data until the new numbers arrive.
      void load(days, selectedModelId);
    });
    source.onerror = () => {
      source.close();
      setTraining(false);
      setTrainError(locale === "my" ? "လေ့ကျင့်မှု ချိတ်ဆက်မှု ပြတ်တောက်သွားပါသည်။" : "The training stream was interrupted.");
    };
  }

  async function load(historyDays: number, modelId: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        days: String(historyDays),
        locale: locale === "my" ? "my" : "en",
      });
      if (modelId) params.set("modelId", modelId);
      const res = await fetch(`/api/ai/forecast?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const code = data?.error ?? `HTTP_${res.status}`;
        throw new Error(
          locale === "my"
            ? code === "AI_UNAVAILABLE"
              ? "AI ဝန်ဆောင်မှုကို ချိတ်ဆက်မရပါ။ ဝန်ဆောင်မှုကို စတင်ပြီး ထပ်ကြိုးစားပါ။"
              : code === "AI_QUOTA_EXCEEDED"
                ? "AI အသုံးပြုမှုကန့်သတ်ချက် ပြည့်သွားပါပြီ။ နောက်မှ ထပ်ကြိုးစားပါ။"
                : code === "AI_MODEL_UNAVAILABLE"
                  ? "ရွေးထားသော AI မော်ဒယ်ကို အသုံးမပြုနိုင်ပါ။ အခြားမော်ဒယ်ကို ရွေးပါ။"
                  : `တောင်းဆိုမှု မအောင်မြင်ပါ (${code})။`
            : code === "AI_UNAVAILABLE"
              ? "AI service is unreachable. Start it with `uvicorn app.main:app --port 8000` in ai-service, then retry."
              : code === "AI_QUOTA_EXCEEDED"
                ? "Provider rate or spending limit reached. Check provider usage and retry later."
                : code === "AI_MODEL_UNAVAILABLE"
                  ? "The selected AI model is unavailable. Choose another active model."
                  : `Request failed (${code}).`,
        );
      }
      setForecasts(data.forecasts);
      setInsights(data.insights);
      setProductCount(data.product_count);
      setNeedOrderCount(data.need_order_count);
      setTotalSuggested(data.total_suggested_units);
      setForecastSource(
        typeof data.forecast_source === "string" ? data.forecast_source : "moving_average",
      );
    } catch (e) {
      setError(locale === "my" ? "ခန့်မှန်းချက်ကို ဖွင့်မရပါ။ ထပ်ကြိုးစားပါ။" : e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      let initialModelId = "";
      try {
        const response = await fetch("/api/ai/models");
        const data = await response.json();
        if (response.ok && data.ok) {
          const available = data.models as AvailableModel[];
          setModels(available);
          let rememberedId = "";
          try {
            rememberedId = localStorage.getItem(LAST_MODEL_STORAGE_KEY) ?? "";
          } catch {
            // Storage may be disabled; use the configured default instead.
          }
          const selected = available.find((model) => model.id === rememberedId)
            ?? available.find((model) => model.isDefault)
            ?? available[0];
          initialModelId = selected?.id ?? "";
          setSelectedModelId(initialModelId);
        }
      } catch {
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
      await load(days, initialModelId);
      await loadArtifacts();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const visible = needsOnly ? forecasts.filter((f) => f.needs_order) : forecasts;
  const latestRun = runs[0] ?? null;

  return (
    <PageShell
      title="Demand Forecasting"
      subtitle="Seasonal-trend demand forecast with reorder suggestions — retrain to refresh the model"
      allow={["admin", "inventory"]}
      actions={
        <>
          {isAdmin && (
            <Button
              variant="outline"
              onClick={startTraining}
              disabled={training}
              aria-label={locale === "my" ? "နောက်ဆုံးဒေတာဖြင့် မော်ဒယ်လေ့ကျင့်ရန်" : "Train model with the latest dataset"}
            >
              {training ? "Training…" : "Train Model with latest dataset"}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setShowModelPanel((value) => !value)}
            aria-label={locale === "my" ? "မော်ဒယ်အသေးစိတ် ပြောင်းရန်" : "Toggle model details"}
          >
            {showModelPanel ? "Hide model" : "Model details"}
          </Button>
          <LocalizedSelect
            value={selectedModelId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedModelId(id);
              try {
                localStorage.setItem(LAST_MODEL_STORAGE_KEY, id);
              } catch {
                // Storage may be disabled; selection stays in memory only.
              }
              void load(days, id);
            }}
            disabled={modelsLoading || models.length === 0}
            aria-label={locale === "my" ? "AI မော်ဒယ်" : "AI model"}
            className="rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            {models.length === 0 && <option value="">No AI models</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </LocalizedSelect>
        </>
      }
    >
      {localizeNode(locale, <>
      {loading && forecasts.length === 0 && (
        <p className="text-sm text-muted-foreground">Forecasting demand…</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {trainError && <p className="text-sm text-red-600">Training: {trainError}</p>}

      {(showModelPanel || training || trainSteps.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Demand model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Estimator</p>
                <p className="text-sm font-medium">
                  {forecastSource === "seasonal_model" || active
                    ? "Seasonal-trend model"
                    : "Moving average (no trained model yet)"}
                </p>
                {(forecastSource === "seasonal_model" || active) && (
                  <p className="text-xs text-muted-foreground">
                    {active?.model?.algorithm ?? "additive_seasonal_trend"}
                    {active?.model?.window ? ` · window ${active.model.window}d` : ""}
                    {active?.model?.alpha !== undefined ? ` · alpha ${active.model.alpha}` : ""}
                    {forecastSource !== "seasonal_model" && (
                      <span className="text-amber-600"> · serving as moving average (branch mismatch?)</span>
                    )}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trained at</p>
                <p className="text-sm font-medium">
                  {active?.trained_at ? active.trained_at.slice(0, 19).replace("T", " ") : "—"}
                </p>
                {latestRun?.split?.test && (
                  <p className="text-xs text-muted-foreground">
                    test {String(latestRun.split.test[0] ?? "").slice(5)} →{" "}
                    {String(latestRun.split.test[1] ?? "").slice(5)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Test MAE</p>
                <p className="text-sm font-medium">
                  {active ? `${active.metrics.test_mae.toFixed(3)} items` : "—"}
                </p>
                {latestRun?.split?.test && (
                  <p className="text-xs text-muted-foreground">
                    {latestRun.test_mae !== null ? latestRun.test_mae.toFixed(3) : "—"} on{" "}
                    {latestRun.test_cells ?? "—"} cells
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">vs previous-day baseline</p>
                <p className="text-sm font-medium">
                  {active
                    ? `${(
                        (1 -
                          active.metrics.test_mae /
                            (active.metrics.baseline_mae.previous_day || 1)) *
                        100
                      ).toFixed(1)}% better`
                    : "—"}
                </p>
                {active && (
                  <p className="text-xs text-muted-foreground">
                    baseline {active.metrics.baseline_mae.previous_day.toFixed(3)} items
                  </p>
                )}
              </div>
            </div>

            {active && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(active.metrics.baseline_mae).map(([name, value]) => (
                  <Badge key={name} variant="outline">
                    {name}: {Number(value).toFixed(3)}
                  </Badge>
                ))}
                <a
                  className="text-sm underline underline-offset-4"
                  href={`/api/ai/forecast/artifacts/${encodeURIComponent(
                    active.run_dir.split(/[\\/]/).pop() ?? "",
                  )}/dataset?kind=prepared`}
                >
                  Download training dataset (CSV)
                </a>
              </div>
            )}

            {trainSteps.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Training log</p>
                <TrainingProgressBar steps={trainSteps} />
                <div className="rounded-md border">
                  {trainSteps.map((step) => (
                    <TrainingStepRow key={step.step} step={step} />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showModelPanel && latestRun && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Model vs baselines (test MAE)</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const baselines = latestRun.baseline_mae ?? {};
                const chartData = [
                  { name: "Model", mae: Number(latestRun.test_mae ?? 0) },
                  ...Object.entries(baselines).map(([name, value]) => ({
                    name,
                    mae: Number(value ?? 0),
                  })),
                ].filter((d) => Number.isFinite(d.mae));
                if (chartData.length === 0 || chartData.every((d) => d.mae === 0)) {
                  return (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No baseline metrics available for this run.
                    </p>
                  );
                }
                return (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={chartData}
                      margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={48} />
                      <Bar dataKey="mae" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MAE by product</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const rows = (latestRun.per_product_mae ?? []).slice(0, 12).map((row) => ({
                  name: row.product_name || row.product_id,
                  mae: Number(row.mae ?? 0),
                })).filter((d) => Number.isFinite(d.mae));
                if (rows.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No per-product MAE available for this run.
                    </p>
                  );
                }
                return (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={rows}
                      margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="name"
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={-30}
                        height={60}
                      />
                      <YAxis tickLine={false} axisLine={false} width={48} />
                      <Bar dataKey="mae" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>

          {(latestRun.test_samples ?? []).slice(0, 1).map((sample) => (
            <Card key={sample.product_id} className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  Actual vs predicted — {sample.product_name || sample.product_id} (test window)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const days = sample.days ?? [];
                  const actual = sample.actual ?? [];
                  const predicted = sample.predicted ?? [];
                  if (days.length === 0) {
                    return (
                      <p className="text-sm text-muted-foreground py-8 text-center">
                        No test sample data available for this run.
                      </p>
                    );
                  }
                  return (
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart
                        data={days.map((day, index) => ({
                          day: String(day).slice(5),
                          actual: Number(actual[index] ?? 0),
                          predicted: Number(predicted[index] ?? 0),
                        }))}
                        margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
                      >
                        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} width={48} />
                        <Legend
                          formatter={(value) => (
                            <span className="text-xs text-muted-foreground capitalize">{value}</span>
                          )}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          name={locale === "my" ? "အမှန်တကယ်" : "Actual"}
                          stroke="var(--color-chart-1)"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="predicted"
                          name={locale === "my" ? "ခန့်မှန်းချက်" : "Predicted"}
                          stroke="var(--color-chart-2)"
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(forecasts.length > 0 || (!loading && !error)) && (
        <>
          {insights && (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{insights}</p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Products analyzed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{productCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Need reorder
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-destructive">{needOrderCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Suggested units
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{totalSuggested.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  History window
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{days}d</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Reorder suggestions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={needsOnly}
                  onChange={(e) => setNeedsOnly(e.target.checked)}
                />
                Show only products needing reorder
              </label>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Avg / day</TableHead>
                    <TableHead>On hand</TableHead>
                    <TableHead>Days of cover</TableHead>
                    <TableHead>Suggested qty</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.slice(0, 100).map((f) => (
                    <TableRow key={f.product_id}>
                      <TableCell>
                        {f.product_name || f.product_id}
                        {f.below_threshold && (
                          <Badge variant="outline" className="ml-2">
                            low stock
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{f.avg_daily_sales}</TableCell>
                      <TableCell>{f.on_hand}</TableCell>
                      <TableCell>{f.days_of_cover === null ? "—" : f.days_of_cover}</TableCell>
                      <TableCell>{f.suggested_qty}</TableCell>
                      <TableCell>
                        {f.needs_order ? (
                          <Badge variant="default">order</Badge>
                        ) : (
                          <Badge variant="secondary">ok</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {visible.length > 100 && (
                <p className="text-xs text-muted-foreground">
                  {locale === "my" ? `ပထမ ၁၀၀ ခုအနက် ${visible.length} ခု ပြထားသည်` : `Showing first 100 of ${visible.length}`}
                </p>
              )}
              {visible.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {productCount === 0
                    ? "Not enough sales history yet — forecasts appear after a week of sales."
                    : "Nothing needs reordering right now."}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
      </>)}
    </PageShell>
  );
}
