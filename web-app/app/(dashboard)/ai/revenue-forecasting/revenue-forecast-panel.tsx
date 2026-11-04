"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import { localizeNode, translateDisplayText, useI18n } from "@/lib/i18n";

interface RevenueMetrics {
  weeks: number;
  mae: number;
  wape_pct: number | null;
  mape_nonzero_pct: number | null;
}

interface RevenueTrainStep {
  step: string;
  status: "running" | "ok" | "error";
  duration_ms: number;
  detail?: Record<string, unknown>;
}

interface RevenueData {
  ok?: boolean;
  trained?: boolean;
  error?: string;
  detail?: string;
  run_id?: string;
  trained_at?: string;
  metrics?: {
    algorithm: string;
    history_weeks: number;
    week_from: string;
    week_to: string;
    total: {
      metrics: RevenueMetrics;
      baselines: Record<string, RevenueMetrics>;
      test_weeks: string[];
      test_actual: number[];
      test_predicted: number[];
      future: Array<{ week: string; amount: number }>;
    };
    products: Array<{
      product_id: string;
      product_name: string;
      metrics: RevenueMetrics;
      future: Array<{ week: string; amount: number }>;
    }>;
  };
  actual_weeks?: string[];
  actual_revenue?: number[];
  forecast?: Array<{ week: string; amount: number }>;
  top_products?: Array<{
    product_id: string;
    product_name: string;
    next_week_amount: number;
  }>;
  last_actual_week?: string;
  history_weeks?: number;
  weeks_required?: number;
}

const TRAINING_STEPS = [
  "collect_sales",
  "collect_refunds",
  "collect_totals",
  "validate_history",
  "prepare_dataset",
  "split_data",
  "tune_model",
  "fit_final_model",
  "evaluate_model",
  "train_product_models",
  "save_artifacts",
  "activate_model",
] as const;

const TRAINING_STEP_LABELS: Record<string, string> = {
  collect_sales: "Collect completed sales",
  collect_refunds: "Collect approved returns",
  collect_totals: "Collect branch totals",
  validate_history: "Check sales history",
  prepare_dataset: "Prepare weekly revenue dataset",
  split_data: "Split data by time",
  tune_model: "Tune model parameters",
  fit_final_model: "Fit final model",
  evaluate_model: "Evaluate forecast accuracy",
  train_product_models: "Train top product models",
  save_artifacts: "Save model artifacts",
  activate_model: "Activate model",
};

function RevenueTrainingStepRow({ step }: { step: RevenueTrainStep }) {
  const { locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const detail = step.detail ?? {};
  const hasDetails = Object.keys(detail).length > 0;
  const statusLabel = step.status === "ok"
    ? "✓"
    : step.status === "error"
      ? "●"
      : "◌";

  return localizeNode(locale, (
    <div className="border-b border-border/40 last:border-0">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        className={`flex w-full items-center gap-2 py-1.5 text-left text-xs ${hasDetails ? "hover:bg-muted/30" : "cursor-default"}`}
        aria-expanded={hasDetails ? expanded : undefined}
      >
        <span aria-hidden="true" className={step.status === "error" ? "text-red-600" : step.status === "ok" ? "text-emerald-600" : "text-amber-600"}>
          {statusLabel}
        </span>
        <span className="font-medium text-foreground">{TRAINING_STEP_LABELS[step.step] ?? step.step}</span>
        <span className="font-mono text-[10px] text-muted-foreground/50">{step.step}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">{step.duration_ms} ms</span>
        {hasDetails && <span className="shrink-0 text-muted-foreground/40">{expanded ? "▾" : "▸"}</span>}
      </button>
      {expanded && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-2 pl-6 text-[11px]">
          {Object.entries(detail).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{translateDisplayText(locale, key.replaceAll("_", " "))}</dt>
              <dd className="min-w-0 break-words font-mono">
                {typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  ));
}

function RevenueTrainingProgress({ steps }: { steps: RevenueTrainStep[] }) {
  const { locale } = useI18n();
  const seen = new Set(steps.map((step) => step.step));
  const completed = TRAINING_STEPS.filter((step) => seen.has(step)).length;
  const progressPercent = Math.round((completed / TRAINING_STEPS.length) * 100);

  return localizeNode(locale, (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Progress</span>
        <span className="font-mono">{completed}/{TRAINING_STEPS.length} steps · {progressPercent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  ));
}

function money(value: number, locale: "en" | "my"): string {
  const number = new Intl.NumberFormat(locale === "my" ? "my-MM" : "en-US", { maximumFractionDigits: 0 });
  return `${number.format(Math.round(value))} ${locale === "my" ? "ကျပ်" : "MMK"}`;
}

function weekLabel(value: string, locale: "en" | "my"): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(locale === "my" ? "my-MM" : "en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

export function RevenueForecastPanel({ isAdmin }: { isAdmin: boolean }) {
  const { locale } = useI18n();
  const mmk = new Intl.NumberFormat(locale === "my" ? "my-MM" : "en-US", { maximumFractionDigits: 0 });
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trainingSteps, setTrainingSteps] = useState<RevenueTrainStep[]>([]);
  const [showModelPanel, setShowModelPanel] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/forecast/revenue");
      const result = (await response.json()) as RevenueData;
      if (!response.ok || result.ok === false) {
        throw new Error(result.detail ?? result.error ?? "Could not load revenue forecast");
      }
      setData(result);
    } catch (cause) {
      setError(locale === "my" ? "ရောင်းရငွေခန့်မှန်းချက်ကို ဖွင့်မရပါ။ ထပ်ကြိုးစားပါ။" : cause instanceof Error ? cause.message : "Could not load revenue forecast");
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  function train() {
    setTraining(true);
    setError(null);
    setTrainingSteps([]);
    const source = new EventSource("/api/ai/forecast/revenue/train/stream");
    source.addEventListener("status", (event) => {
      try {
        const step = JSON.parse((event as MessageEvent<string>).data) as RevenueTrainStep;
        if (typeof step.step !== "string") return;
        setTrainingSteps((previous) => [
          ...previous.filter((item) => item.step !== step.step),
          step,
        ]);
      } catch {
        // Ignore malformed status events; the terminal event reports the outcome.
      }
    });
    source.addEventListener("done", (event) => {
      source.close();
      setTraining(false);
      try {
        const result = JSON.parse((event as MessageEvent<string>).data) as RevenueData;
        if (!result.ok) {
          setError(formatTrainingError(result.error ?? "Revenue model training failed", locale));
          setTrainingSteps((previous) => previous.map((step) =>
            step.status === "running" ? { ...step, status: "error" } : step,
          ));
          return;
        }
        void load();
      } catch {
        setError(locale === "my" ? "လေ့ကျင့်မှုရလဒ်ကို ဖတ်မရပါ။" : "Could not read the training result.");
      }
    });
    source.onerror = () => {
      source.close();
      setTraining(false);
      setError(locale === "my" ? "လေ့ကျင့်မှု ချိတ်ဆက်မှု ပြတ်တောက်သွားပါသည်။ ထပ်ကြိုးစားပါ။" : "The training stream was interrupted. Try again.");
      setTrainingSteps((previous) => previous.map((step) =>
        step.status === "running" ? { ...step, status: "error" } : step,
      ));
    };
  }

  function formatTrainingError(message: string, activeLocale: "en" | "my") {
    if (activeLocale === "my") {
      const weeksError = message.match(/At least (\d+) weeks of sales history are required; found (\d+)/i);
      if (weeksError) {
        return `အနည်းဆုံး ${weeksError[1]} ပတ်စာ အရောင်းမှတ်တမ်းလိုအပ်ပါသည်။ လက်ရှိ ${weeksError[2]} ပတ်စာသာ ရရှိထားပါသည်။`;
      }
      if (message.includes("At least 40 weeks of sales history are required")) {
        return "အနည်းဆုံး ၄၀ ပတ်စာ အရောင်းမှတ်တမ်းလိုအပ်ပါသည်။";
      }
      return "ရောင်းရငွေမော်ဒယ်ကို လေ့ကျင့်မရပါ။ ထပ်ကြိုးစားပါ။";
    }
    return message;
  }

  const active = Boolean(data?.trained && data.metrics);
  const metrics = data?.metrics?.total.metrics;
  const baseline = data?.metrics?.total.baselines.moving_average_4;
  const testChart = data?.metrics?.total.test_weeks.map((week, index) => ({
    week: weekLabel(week, locale),
    actual: data.metrics?.total.test_actual[index] ?? 0,
    predicted: data.metrics?.total.test_predicted[index] ?? 0,
  })) ?? [];
  const productChart = data?.top_products?.slice(0, 10).map((product) => ({
    name: product.product_name.length > 22
      ? `${product.product_name.slice(0, 21)}…`
      : product.product_name,
    amount: product.next_week_amount,
  })) ?? [];

  return localizeNode(locale, (
    <PageShell
      title="Revenue Forecasting"
      subtitle="Weekly net sales revenue forecasts in MMK, with a separate model from unit demand."
      allow={["admin", "inventory"]}
      actions={isAdmin && (
        <>
          <Button variant="outline" onClick={() => void train()} disabled={training}>
            {training ? "Training revenue model…" : "Train revenue model"}
          </Button>
          <Button variant="ghost" onClick={() => setShowModelPanel((value) => !value)}>
            {showModelPanel ? "Hide model" : "Model details"}
          </Button>
        </>
      )}
    >
      <section className="space-y-4">

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading revenue forecast…</p>}

      {isAdmin && (
        <Card>
          <CardContent className="space-y-2 pt-4 text-sm text-muted-foreground">
            <p>
              {locale === "my"
                ? `မော်ဒယ်လေ့ကျင့်ရန် အနည်းဆုံး ${data?.weeks_required ?? 40} ပတ်စာ ပြီးဆုံးပြီးသော အရောင်းမှတ်တမ်းလိုအပ်သည်။`
                : `At least ${data?.weeks_required ?? 40} complete weeks of sales history are required to train this model.`}
            </p>
            {data?.history_weeks !== undefined && (
              <p>
                {locale === "my"
                  ? `လက်ရှိဒေတာ: ${data.history_weeks} / ${data.weeks_required ?? 40} ပတ်`
                  : `Available history: ${data.history_weeks} / ${data.weeks_required ?? 40} weeks`}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {(showModelPanel || training || trainingSteps.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Revenue model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Estimator</p>
                <p className="text-sm font-medium">{data?.metrics?.algorithm ?? "XGBoost weekly net revenue"}</p>
                <p className="text-xs text-muted-foreground">MMK · 4-week horizon</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trained at</p>
                <p className="text-sm font-medium">
                  {data?.trained_at ? new Date(data.trained_at).toLocaleString(locale === "my" ? "my-MM" : "en-US") : "—"}
                </p>
                {data?.metrics?.week_from && data.metrics.week_to && (
                  <p className="text-xs text-muted-foreground">{weekLabel(data.metrics.week_from, locale)} → {weekLabel(data.metrics.week_to, locale)}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Test MAE</p>
                <p className="text-sm font-medium">{metrics ? money(metrics.mae, locale) : "—"}</p>
                {metrics && <p className="text-xs text-muted-foreground">{metrics.weeks} test weeks</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">vs 4-week moving average</p>
                <p className="text-sm font-medium">
                  {metrics && baseline?.mae
                    ? `${((1 - metrics.mae / baseline.mae) * 100).toFixed(1)}% better`
                    : "—"}
                </p>
                {baseline && <p className="text-xs text-muted-foreground">baseline {money(baseline.mae, locale)}</p>}
              </div>
            </div>
            {trainingSteps.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">Training log</p>
                <RevenueTrainingProgress steps={trainingSteps} />
                <div className="rounded-md border px-2">
                  {trainingSteps.map((step) => <RevenueTrainingStepRow key={step.step} step={step} />)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && !active && !error && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No revenue model has been trained for this branch yet.
            {isAdmin ? " Train the model to create the first forecast." : " Ask an administrator to train it."}
          </CardContent>
        </Card>
      )}

      {active && data?.metrics && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">First forecast week</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{money(data.forecast?.[0]?.amount ?? 0, locale)}</p>
                {data.forecast?.[0] && <p className="mt-1 text-xs text-muted-foreground">Week of {weekLabel(data.forecast[0].week, locale)}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Backtest MAE</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{money(metrics?.mae ?? 0, locale)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Backtest WAPE</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">
                {metrics?.wape_pct == null ? "—" : `${metrics.wape_pct}%`}
                <p className="mt-1 text-xs font-normal text-muted-foreground">
                  4-week moving-average baseline: {baseline?.wape_pct == null ? "—" : `${baseline.wape_pct}%`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Non-zero MAPE</CardTitle></CardHeader>
              <CardContent className="text-2xl font-bold">{metrics?.mape_nonzero_pct == null ? "—" : `${metrics.mape_nonzero_pct}%`}</CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>Actual vs predicted weekly net sales</CardTitle>
                <Badge variant="secondary">{metrics?.weeks ?? 0} test weeks</Badge>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={testChart} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" minTickGap={22} />
                    <YAxis tickFormatter={(value: number) => mmk.format(value)} width={78} />
                    <Tooltip formatter={(value) => money(Number(value ?? 0), locale)} />
                    <Line type="monotone" dataKey="actual" name={locale === "my" ? "အမှန်တကယ်" : "Actual"} stroke="#2563eb" dot={false} />
                    <Line type="monotone" dataKey="predicted" name={locale === "my" ? "ခန့်မှန်းချက်" : "Predicted"} stroke="#f97316" strokeDasharray="5 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top products — current-week revenue</CardTitle>
              </CardHeader>
              <CardContent className="h-80">
                {productChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={productChart} margin={{ top: 8, right: 12, bottom: 44, left: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} />
                      <YAxis tickFormatter={(value: number) => mmk.format(value)} width={78} />
                      <Tooltip formatter={(value) => money(Number(value ?? 0), locale)} />
                      <Bar dataKey="amount" name={locale === "my" ? "လက်ရှိအပတ်" : "Current week"} fill="#0d9488" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">No product forecasts are available.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Four-week net sales outlook</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data.forecast?.map((item) => (
                <div key={item.week} className="rounded-md border p-3">
                  <p className="text-sm text-muted-foreground">Week of {weekLabel(item.week, locale)}</p>
                  <p className="text-lg font-semibold">{money(item.amount, locale)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Net sales are calculated before tax from completed sale lines less approved refunds.
            This revenue forecast is not used to calculate reorder quantities.
            {data.trained_at
              ? locale === "my"
                ? ` နောက်ဆုံးလေ့ကျင့်ချိန် ${new Date(data.trained_at).toLocaleString("my-MM")}.`
                : ` Last trained ${new Date(data.trained_at).toLocaleString("en-US")}.`
              : ""}
          </p>
        </>
      )}
      </section>
    </PageShell>
  ));
}
