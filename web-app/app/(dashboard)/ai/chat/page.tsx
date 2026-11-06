"use client";

import { useEffect, useRef, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";

const SUGGESTIONS = [
  "Today's total sales?",
  "Top 5 products by quantity sold this week?",
  "Which products are at or below reorder level?",
  "Sales in the last 7 days by day?",
  "ဒီနေ့ ရောင်းအား ဘယ်လောက်လဲ?",
  "စတော့ ကုန်ခါနီး ပစ္စည်း ၁၀ မျိုး ပြပါ",
];

interface PlanItem {
  table: string;
  purpose: string;
  columns: string[];
  filter: string;
}

interface ChatMessage {
  id: number;
  question: string;
  durationSeconds?: number;
  activity?: ProgressLogEntry[];
  understanding?: string;
  plan?: PlanItem[];
  answer?: string;
  findings?: string[];
  summary?: string;
  suggestions?: string[];
  sql?: string;
  sqlError?: string;
  sql_error?: string;
  forecast?: ChatForecast;
  failure?: boolean;
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  truncated?: boolean;
  error?: string;
}

interface ChatForecast {
  type: "demand" | "revenue" | "comparison";
  comparison_type?: "sales_period" | "revenue_forecast";
  available?: boolean;
  period_days?: number;
  current?: { label?: string; start_date?: string; end_date?: string; revenue?: number; sale_count?: number };
  previous?: { label?: string; start_date?: string; end_date?: string; revenue?: number; sale_count?: number };
  actual?: { label?: string; revenue?: number; weeks?: number };
  forecast_period?: { label?: string; revenue?: number; weeks?: number };
  change_amount?: number;
  change_pct?: number | null;
  series?: Array<{ label: string; kind: "actual" | "forecast"; amount: number }>;
  days?: number;
  reorder_only?: boolean;
  forecast_source?: string;
  trained_at?: string | null;
  product_count?: number;
  need_order_count?: number;
  total_suggested_units?: number;
  items?: Array<Record<string, unknown>>;
  trained?: boolean;
  history_weeks?: number;
  weeks_required?: number;
  weeks_missing?: number;
  forecast?: Array<{ week: string; amount: number }>;
  top_products?: Array<{ product_id: string; product_name: string; next_week_amount: number }>;
  metrics?: { mae?: number; wape_pct?: number | null; mape_nonzero_pct?: number | null };
}

type ProgressPhase = "connecting" | "checking_intent" | "loading_schema" | "calling_model" | "validating_sql" | "executing" | "narrating" | "diagnosing_failure";

interface ProgressLogEntry {
  id: string;
  elapsedSeconds: number;
  message: string;
}

interface LiveState extends Omit<ChatMessage, "id" | "question" | "error"> {
  question: string;
  status: string;
  phase: ProgressPhase;
  startedAt: number;
  activity: ProgressLogEntry[];
}

interface AvailableModel {
  id: string;
  provider: "openrouter" | "opencode_zen" | "opencode_console";
  name: string;
  displayName: string;
  isDefault: boolean;
}

interface ConversationRow {
  id: string;
  title: string;
  updatedAt: string;
}

const LAST_MODEL_STORAGE_KEY = "smartretail.ai-chat.last-model";

const CHAT_COMMANDS = [
  { command: "/demand", description: { en: "Demand forecast · next 30 days", my: "လာမည့် ရက် ၃၀ အတွက် လိုအပ်ချက်ခန့်မှန်းချက်" } },
  { command: "/demand 7", description: { en: "Demand forecast · next 7 days", my: "လာမည့် ၇ ရက်အတွက် လိုအပ်ချက်ခန့်မှန်းချက်" } },
  { command: "/demand 30", description: { en: "Demand forecast · next 30 days", my: "လာမည့် ရက် ၃၀ အတွက် လိုအပ်ချက်ခန့်မှန်းချက်" } },
  { command: "/demand 90", description: { en: "Demand forecast · next 90 days", my: "လာမည့် ရက် ၉၀ အတွက် လိုအပ်ချက်ခန့်မှန်းချက်" } },
  { command: "/demand reorder", description: { en: "Products that need reordering", my: "ပြန်မှာယူရန်လိုအပ်သော ပစ္စည်းများ" } },
  { command: "/revenue", description: { en: "Revenue forecast · next 4 weeks", my: "လာမည့် ၄ ပတ်အတွက် ရောင်းရငွေခန့်မှန်းချက်" } },
  { command: "/revenue accuracy", description: { en: "Revenue forecast accuracy and history", my: "ရောင်းရငွေခန့်မှန်းမှု တိကျမှုနှင့် မှတ်တမ်းကာလ" } },
  { command: "/compare sales 7", description: { en: "Compare revenue · last 7 days vs previous 7 days", my: "ပြီးခဲ့သည့် ၇ ရက်နှင့် အရင် ၇ ရက် ရောင်းရငွေ နှိုင်းယှဉ်ရန်" } },
  { command: "/compare sales 30", description: { en: "Compare revenue · last 30 days vs previous 30 days", my: "ပြီးခဲ့သည့် ရက် ၃၀ နှင့် အရင် ရက် ၃၀ ရောင်းရငွေ နှိုင်းယှဉ်ရန်" } },
  { command: "/compare sales 90", description: { en: "Compare revenue · last 90 days vs previous 90 days", my: "ပြီးခဲ့သည့် ရက် ၉၀ နှင့် အရင် ရက် ၉၀ ရောင်းရငွေ နှိုင်းယှဉ်ရန်" } },
  { command: "/compare revenue", description: { en: "Compare last 4 actual weeks with next 4 forecast weeks", my: "ပြီးခဲ့သည့် ၄ ပတ်နှင့် လာမည့် ၄ ပတ်ခန့်မှန်းချက် နှိုင်းယှဉ်ရန်" } },
];

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatColumn(column: string, locale: "en" | "my"): string {
  const labels: Record<string, string> = {
    id: "အမှတ်စဉ်",
    name: "အမည်",
    product_name: "ပစ္စည်းအမည်",
    category_name: "အမျိုးအစား",
    sale_number: "ဘောင်ချာအမှတ်",
    total_amount: "စုစုပေါင်းတန်ဖိုး",
    grand_total: "စုစုပေါင်းကျသင့်ငွေ",
    quantity: "အရေအတွက်",
    current_stock_quantity: "လက်ကျန်ပစ္စည်းအရေအတွက်",
    reorder_threshold: "ပြန်မှာယူရန် သတ်မှတ်အရေအတွက်",
    selling_price: "ရောင်းဈေး",
    purchase_price: "ဝယ်ဈေး",
    unit_price: "တစ်ခုချင်းဈေး",
    line_total: "လိုင်းစုစုပေါင်း",
    sale_date: "ရောင်းချသည့်နေ့",
    expiry_date: "သက်တမ်းကုန်ရက်",
    status: "အခြေအနေ",
    payment_method: "ငွေပေးချေမှုနည်းလမ်း",
    branch_id: "ဆိုင်ခွဲ",
  };
  if (locale === "my") return labels[column] ?? column.replace(/_/g, " ");
  return column.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ComparisonView({ forecast, locale }: { forecast: ChatForecast; locale: "en" | "my" }) {
  const money = (value: number) => new Intl.NumberFormat(locale === "my" ? "my-MM" : "en-US", { maximumFractionDigits: 0 }).format(value);
  const periods = forecast.comparison_type === "sales_period"
    ? [
        { label: `${forecast.previous?.label ?? (locale === "my" ? "ယခင်ကာလ" : "Previous period")}${forecast.previous?.start_date ? ` · ${forecast.previous.start_date} – ${forecast.previous.end_date}` : ""}`, amount: forecast.previous?.revenue ?? 0, detail: forecast.previous?.sale_count },
        { label: `${forecast.current?.label ?? (locale === "my" ? "လက်ရှိကာလ" : "Current period")}${forecast.current?.start_date ? ` · ${forecast.current.start_date} – ${forecast.current.end_date}` : ""}`, amount: forecast.current?.revenue ?? 0, detail: forecast.current?.sale_count },
      ]
    : [
        { label: forecast.actual?.label ?? (locale === "my" ? "လက်တွေ့" : "Actual · previous 4 weeks"), amount: forecast.actual?.revenue ?? 0, detail: undefined as number | undefined },
        { label: forecast.forecast_period?.label ?? (locale === "my" ? "ခန့်မှန်း" : "Forecast · next 4 weeks"), amount: forecast.forecast_period?.revenue ?? 0, detail: undefined as number | undefined },
      ];
  if (forecast.available === false) {
    return <p className="text-sm text-muted-foreground">
      {locale === "my"
        ? `နှိုင်းယှဉ်ချက် မရနိုင်သေးပါ။ လိုအပ်သော ${forecast.weeks_required ?? 40} ပတ်အနက် ${forecast.history_weeks ?? 0} ပတ်သာ ရှိပါသည်။`
        : `Comparison unavailable. Revenue model requires ${forecast.weeks_required ?? 40} weeks; ${forecast.history_weeks ?? 0} available.`}
    </p>;
  }
  const max = Math.max(1, ...periods.map((period) => period.amount));
  const changeText = forecast.change_pct == null
    ? (locale === "my" ? "ယခင်ကာလ ဒေတာမရှိပါ" : "No previous-period baseline")
    : `${forecast.change_pct > 0 ? "+" : ""}${forecast.change_pct}%`;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>{forecast.comparison_type === "sales_period"
        ? locale === "my" ? `ကာလ ${forecast.period_days} ရက်စီ` : `${forecast.period_days}-day periods`
        : locale === "my" ? "၄ ပတ်စီ" : "4 weeks each"}</span>
      <Badge variant="outline">{changeText}</Badge>
      {forecast.change_amount != null && <span>{locale === "my" ? "ကွာခြားချက်" : "Difference"}: {money(forecast.change_amount)} MMK</span>}
    </div>
    <div className="space-y-3">
      {periods.map((period, index) => (
        <div key={period.label} className="space-y-1">
          <div className="flex justify-between gap-2 text-xs"><span>{period.label}</span><span className="font-medium">{money(period.amount)} MMK{period.detail != null ? ` · ${period.detail} ${locale === "my" ? "ဘောင်ချာ" : "sales"}` : ""}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${index === 1 ? "bg-primary" : "bg-primary/45"}`} style={{ width: `${Math.max(period.amount > 0 ? 2 : 0, period.amount / max * 100)}%` }} /></div>
        </div>
      ))}
    </div>
    {forecast.comparison_type === "revenue_forecast" && !!forecast.series?.length && (
      <div className="space-y-2">
        <p className="text-xs font-medium">{locale === "my" ? "အပတ်စဉ် ရောင်းရငွေ" : "Weekly revenue"}</p>
        <div className="flex h-36 items-end gap-2 border-b px-1">
          {forecast.series.map((point, index) => {
            const seriesMax = Math.max(1, ...forecast.series!.map((item) => item.amount));
            return <div key={`${point.kind}-${point.label}-${index}`} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center" title={`${point.kind} ${point.label}: ${money(point.amount)} MMK`}>
              <span className="mb-1 truncate text-[10px] text-muted-foreground">{money(point.amount)}</span>
              <div className={`mx-auto w-full max-w-10 rounded-t ${point.kind === "actual" ? "bg-primary/50" : "bg-primary"}`} style={{ height: `${Math.max(point.amount > 0 ? 4 : 0, point.amount / seriesMax * 90)}%` }} />
              <span className="mt-1 truncate text-[10px] text-muted-foreground">{point.label.slice(5)}</span>
            </div>;
          })}
        </div>
        <div className="flex gap-4 text-[10px] text-muted-foreground">
          <span>■ {locale === "my" ? "လက်တွေ့" : "Actual"}</span><span>■ {locale === "my" ? "ခန့်မှန်း" : "Forecast"}</span>
        </div>
      </div>
    )}
    {forecast.trained_at && <p className="text-xs text-muted-foreground">{locale === "my" ? "လေ့ကျင့်သည့်နေ့" : "Model trained"}: {new Date(forecast.trained_at).toLocaleDateString(locale === "my" ? "my-MM" : "en-US")}</p>}
  </div>;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function formatElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function describeError(code: string, detail: string | null | undefined, locale: "en" | "my"): string {
  if (locale === "my") {
    if (code === "FORECAST_UNAVAILABLE") return "ဆိုင်ခွဲအတွက် ခန့်မှန်းချက် မရရှိနိုင်ပါ။ ဝန်ဆောင်မှုကို စစ်ဆေးပြီး ထပ်ကြိုးစားပါ။";
    if (code === "AI_MODEL_UNAVAILABLE") return "ရွေးထားသော model ကို အသုံးမပြုနိုင်တော့ပါ။ Active model တစ်ခုကို ပြန်ရွေးပါ။";
    if (code === "AI_UNAVAILABLE") return "AI service ကို မဆက်သွယ်နိုင်ပါ။ Service စတင်ပြီး ထပ်စမ်းပါ။";
    if (code === "AI_QUOTA_EXCEEDED") return "Provider rate သို့မဟုတ် spending limit ပြည့်သွားပါပြီ။ Provider console မှာ usage စစ်ပြီး နောက်မှထပ်စမ်းပါ။";
    if (code === "AI_QUERY_FAILED") return `ဒီမေးခွန်းကို မဖြေနိုင်ပါ။${detail ? ` (${detail})` : ""} မေးခွန်းကို အနည်းငယ် ပြောင်းပြီး ထပ်စမ်းပါ။`;
    return `တောင်းဆိုမှု မအောင်မြင်ပါ (${code})။`;
  }
  if (code === "FORECAST_UNAVAILABLE") return "Could not load the forecast for this branch. Check the forecast service and retry.";
  if (code === "AI_MODEL_UNAVAILABLE") return "That model is no longer available. Choose another active model.";
  if (code === "AI_UNAVAILABLE") return "AI service is unreachable. Start it in ai-service and retry.";
  if (code === "AI_QUOTA_EXCEEDED") return "The provider rate or spending limit was reached. Check the provider console and retry later.";
  if (code === "AI_QUERY_FAILED") return `Could not answer that question.${detail ? ` (${detail})` : ""} Try rephrasing.`;
  return `Request failed (${code}).`;
}

export default function AiChatPage() {
  const { locale } = useI18n();
  const labels = locale === "my"
    ? {
        subtitle: "အရောင်း၊ စတော့နှင့် အော်ဒါများကို မေးနိုင်သည် — ကိုယ့် branch အတွင်း၊ ဖတ်ရှုရန်သာ",
        conversation: "စကားဝိုင်း",
        historyTitle: "အရင်စကားဝိုင်းများ",
        noConversations: "သိမ်းထားတဲ့ စကားဝိုင်း မရှိသေးပါ။",
        openingConversation: "စကားဝိုင်း ဖွင့်နေသည်…",
        newConversation: "စကားဝိုင်းအသစ်",
        historyLoading: "စကားဝိုင်းများ ဖွင့်နေသည်…",
        deleteConversation: "ဖျက်ရန်",
        tryOne: "ဒီမေးခွန်းတွေ စမ်းကြည့်ပါ:",
        understanding: "မေးခွန်းကို နားလည်ပုံ",
        plan: "အချက်အလက် ရယူမည့် အစီအစဉ်",
        columns: "ရွေးမည့် column များ",
        filter: "စစ်ထုတ်မည့် စည်းကမ်း",
        sql: "ဖတ်ရှုရန်သာ SQL ကိုကြည့်ရန်",
        table: "Database မှ ရလာသော အချက်အလက်",
        rows: "အတန်း",
        noRows: "ကိုက်ညီတဲ့ အချက်အလက် မတွေ့ပါ။",
        findings: "တွေ့ရှိချက်များ",
        summary: "အနှစ်ချုပ်",
        followups: "ဆက်မေးနိုင်သည့် မေးခွန်းများ",
        firstRows: "ပထမ ၅၀ အတန်း",
        connecting: "ချိတ်ဆက်နေသည်…",
        requestStarted: "AI model ဆီ တောင်းဆိုမှု ပို့လိုက်သည်။",
        checkingIntent: "မေးခွန်းက ဖတ်ရှုရန်လား၊ data ပြောင်းလဲရန်လား စစ်နေသည်…",
        intentReadOnly: "ဖတ်ရှုရန်မေးခွန်းဖြစ်ကြောင်း အတည်ပြုပြီးပါပြီ။",
        requestRejected: "Data ပြောင်းလဲရန် တောင်းဆိုမှုဖြစ်လို့ SQL မထုတ်ဘဲ ငြင်းဆိုလိုက်သည်။",
        diagnosingFailure: "Query သို့မဟုတ် database အမှားကို LLM နဲ့ စစ်ဆေးနေသည်…",
        diagnosisComplete: "အမှားအကြောင်း ရှင်းလင်းချက် ပြင်ဆင်ပြီးပါပြီ။",
        loadingSchema: "Database ရဲ့ table နဲ့ column စာရင်းကို စစ်နေသည်…",
        schemaLoaded: "Database schema ဖတ်ပြီးပါပြီ။",
        generating: "မေးခွန်းကို SQL query အဖြစ် ပြောင်းနေသည်…",
        modelResponded: "Model မှ တုံ့ပြန်မှုရပါပြီ။ SQL ကို ပြန်လည်စစ်ဆေးနေသည်။",
        validating: "SQL ရဲ့ branch filter နဲ့ ဖတ်ရှုရန်သာ စည်းမျဉ်းကို စစ်နေသည်…",
        sqlValidated: "SQL သည် read-only နှင့် branch စည်းမျဉ်းများကို ဖြတ်ကျော်ပြီးပါပြီ။",
        executing: "Database မှ အချက်အလက် ရယူနေသည်…",
        queryComplete: "Database query ပြီးပါပြီ။ ရလဒ်ကို စီစဉ်နေသည်။",
        narrating: "တွေ့ရှိချက်တွေကို အဖြေအဖြစ် စီစဉ်နေသည်…",
        summaryComplete: "အဖြေကို ပြင်ဆင်ပြီးပါပြီ။",
        cacheHit: "Cache မှ သိမ်းထားသော SQL query ကို ပြန်သုံးနေသည်…",
        toolMatched: "အဆင်သင့် query tool ကို ရွေးယူပြီး လုပ်ဆောင်နေသည်…",
        activityLog: "လုပ်ဆောင်မှုမှတ်တမ်း",
        rowsReturned: (count: number) => `${count} row ရရှိပါသည်။`,
        planReady: "အချက်အလက်ရယူမည့် အစီအစဉ်ကို ပြင်ဆင်ပြီးပါပြီ။",
        sqlReady: "ဖတ်ရှုရန်သာ SQL query ကို ပြင်ဆင်ပြီးပါပြီ။",
        workedFor: "လုပ်ဆောင်ချိန်",
        askPlaceholder: "/ ရိုက်၍ command ရွေးပါ၊ သို့မဟုတ် မေးခွန်းရေးပါ…",
        ask: "မေးမည်",
        model: "Model ရွေးရန်",
        chooseModel: "အသုံးပြုမည့် model ကိုရွေးပါ",
        modelsLoading: "Active model များ ဖွင့်နေသည်…",
        noModels: "အသုံးပြုနိုင်သော AI model မရှိပါ။ Admin ကို model တစ်ခု Active ဖွင့်ခိုင်းပါ။",
        commands: "ခန့်မှန်းချက် command များ",
        sqlSupplementFailed: "ခန့်မှန်းချက်ကို ရရှိပါပြီ၊ သို့သော် ထပ်မေးထားသော ဒေတာဘေ့စ်အချက်အလက်ကို မရယူနိုင်ခဲ့ပါ။",
      }
    : {
        subtitle: "Ask about sales, stock and orders — read-only, within your branch",
        conversation: "Conversation",
        historyTitle: "Chat history",
        noConversations: "No saved conversations yet.",
        openingConversation: "Opening conversation…",
        newConversation: "New chat",
        historyLoading: "Loading conversations…",
        deleteConversation: "Delete",
        tryOne: "Try one of these:",
        understanding: "Question understanding",
        plan: "Data retrieval plan",
        columns: "Selected columns",
        filter: "Filter",
        sql: "View read-only SQL",
        table: "Data returned from the database",
        rows: "rows",
        noRows: "No matching data was found.",
        findings: "Findings",
        summary: "Summary",
        followups: "Related questions",
        firstRows: "first 50 rows",
        connecting: "Connecting…",
        requestStarted: "Request sent to the selected AI model.",
        checkingIntent: "Checking whether the request only reads data…",
        intentReadOnly: "Confirmed as a read-only data request.",
        requestRejected: "This request changes data, so it was rejected before SQL generation.",
        diagnosingFailure: "Asking the model to explain the query or database error…",
        diagnosisComplete: "The error explanation is ready.",
        loadingSchema: "Checking the database tables and columns…",
        schemaLoaded: "Database schema loaded.",
        generating: "Turning your question into a SQL query…",
        modelResponded: "Model response received; checking the generated SQL.",
        validating: "Checking branch scope and read-only rules…",
        sqlValidated: "SQL passed the read-only and branch-scope checks.",
        executing: "Retrieving data from the database…",
        queryComplete: "Database query finished; preparing the results.",
        narrating: "Preparing the findings and summary…",
        summaryComplete: "Answer summary is ready.",
        cacheHit: "Reusing a saved SQL query from cache…",
        toolMatched: "Running a ready-made query tool for this question…",
        activityLog: "Activity log",
        rowsReturned: (count: number) => `${count} row${count === 1 ? "" : "s"} returned.`,
        planReady: "Data retrieval plan prepared.",
        sqlReady: "Read-only SQL query prepared.",
        workedFor: "Worked for",
        askPlaceholder: "Type / for commands or ask a question…",
        ask: "Ask",
        model: "Model",
        chooseModel: "Choose a model",
        modelsLoading: "Loading active models…",
        noModels: "No active AI models are available. Ask an admin to enable a model.",
        commands: "Forecast commands",
        sqlSupplementFailed: "The forecast was retrieved, but the additional database lookup did not complete.",
      };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [input, setInput] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [live, setLive] = useState<LiveState | null>(null);
  const [timerNow, setTimerNow] = useState(0);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [openingConversationId, setOpeningConversationId] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const activityRef = useRef<ProgressLogEntry[]>([]);
  const idRef = useRef(1);
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const commandPrefix = input.match(/^\s*(\/[^\s]*)$/)?.[1]?.toLowerCase();
  const commandSuggestions = commandPrefix
    ? CHAT_COMMANDS.filter((item) => item.command.startsWith(commandPrefix))
    : [];
  const progressSteps: Array<{ phase: Exclude<ProgressPhase, "connecting">; label: string }> = [
    { phase: "checking_intent", label: labels.checkingIntent },
    { phase: "loading_schema", label: labels.loadingSchema },
    { phase: "calling_model", label: labels.generating },
    { phase: "validating_sql", label: labels.validating },
    { phase: "executing", label: labels.executing },
    { phase: "narrating", label: labels.narrating },
    { phase: "diagnosing_failure", label: labels.diagnosingFailure },
  ];

  const liveStartedAt = live?.startedAt;
  useEffect(() => {
    if (!liveStartedAt) return;
    const updateTimer = () => setTimerNow(Date.now());
    const timer = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(timer);
  }, [liveStartedAt]);

  useEffect(() => {
    return () => sourceRef.current?.close();
  }, []);

  async function refreshConversations() {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/ai/conversations");
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error("LOAD_HISTORY_FAILED");
      setConversations(data.conversations as ConversationRow[]);
      setHistoryError("");
    } catch {
      setHistoryError(locale === "my" ? "စကားဝိုင်းစာရင်းကို မဖွင့်နိုင်ပါ။" : "Could not load chat history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(refreshConversations);
    // Initial history load runs once; the helper closes over the current locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openConversation(conversationId: string) {
    if (live) return;
    setOpeningConversationId(conversationId);
    setHistoryError("");
    try {
    const response = await fetch(`/api/ai/conversations/${conversationId}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error("LOAD_CONVERSATION_FAILED");
    const saved = data.conversation as {
      id: string;
      messages: Array<{ id: string; role: string; content: string; status: string; metadata: Record<string, unknown> | null }>;
    };
    const restored: ChatMessage[] = [];
    for (let index = 0; index < saved.messages.length; index += 1) {
      const message = saved.messages[index];
      if (message.role !== "user") continue;
      const assistant = saved.messages[index + 1]?.role === "assistant" ? saved.messages[index + 1] : undefined;
      const metadata = assistant?.metadata ?? {};
      const plan = Array.isArray(metadata.plan) ? metadata.plan as PlanItem[] : undefined;
      const findings = Array.isArray(metadata.findings) ? metadata.findings.filter((item): item is string => typeof item === "string") : undefined;
      const suggestions = Array.isArray(metadata.suggestions) ? metadata.suggestions.filter((item): item is string => typeof item === "string") : undefined;
      const sql = typeof metadata.sql === "string" ? metadata.sql : undefined;
      const forecast = metadata.forecast && typeof metadata.forecast === "object"
        ? metadata.forecast as ChatForecast
        : undefined;
      const isFailure = metadata.failure === true;
      const rows = !isFailure && Array.isArray(metadata.rows)
        ? metadata.rows.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)).slice(0, 50)
        : undefined;
      const rowCount = typeof metadata.rowCount === "number" ? metadata.rowCount : rows?.length;
      restored.push({
        id: index + 1,
        question: message.content,
        answer: assistant?.content,
        understanding: typeof metadata.understanding === "string" ? metadata.understanding : undefined,
        plan,
        findings,
        summary: typeof metadata.summary === "string" ? metadata.summary : assistant?.content,
        suggestions,
        sql,
        forecast,
        sqlError: typeof metadata.sqlError === "string" ? metadata.sqlError : undefined,
        failure: isFailure,
        rows,
        rowCount,
        truncated: metadata.truncated === true || (rowCount !== undefined && rows !== undefined && rowCount > rows.length),
        error: !assistant && message.status === "failed" ? describeError("AI_QUERY_FAILED", null, locale) : undefined,
      });
      if (assistant) index += 1;
    }
    setActiveConversationId(saved.id);
    setMessages(restored);
    } catch {
      setHistoryError(locale === "my" ? "စကားဝိုင်းကို ဖွင့်မရပါ။ ထပ်စမ်းပါ။" : "Could not open this conversation. Try again.");
    } finally {
      setOpeningConversationId(null);
    }
  }

  async function deleteSavedConversation(conversationId: string) {
    try {
      const response = await fetch(`/api/ai/conversations/${conversationId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("DELETE_CONVERSATION_FAILED");
      setConversations((items) => items.filter((item) => item.id !== conversationId));
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setMessages([]);
      }
    } catch {
      setHistoryError(locale === "my" ? "စကားဝိုင်းကို ဖျက်မရပါ။ ထပ်စမ်းပါ။" : "Could not delete this conversation. Try again.");
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/ai/models");
        const data = await response.json();
        if (!response.ok || !data.ok) return;
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
        setSelectedModelId(selected?.id ?? "");
      } catch {
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
    })();
  }, []);

  async function ask(question: string, startedAt: number) {
    const text = question.trim();
    if (!text || live || !selectedModelId) return;
    const selectedModel = models.find((model) => model.id === selectedModelId);
    if (!selectedModel) return;
    sourceRef.current?.close();
    setTimerNow(0);
    activityRef.current = [{ id: `${startedAt}-0`, elapsedSeconds: 0, message: labels.requestStarted }];
    setLive({
      question: text,
      status: labels.connecting,
      phase: "connecting",
      startedAt,
      activity: activityRef.current,
    });

    let conversationId = activeConversationId;
    let userMessageId = "";
    try {
      const response = conversationId
        ? await fetch(`/api/ai/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: text }),
          })
        : await fetch("/api/ai/conversations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: text }),
          });
      const created = await response.json();
      if (!response.ok || !created.ok) throw new Error("CHAT_SAVE_FAILED");
      if (!conversationId) {
        conversationId = created.conversation.id as string;
        setActiveConversationId(conversationId);
      }
      userMessageId = created.message.id as string;
      void refreshConversations();
      setHistoryError("");
    } catch {
      setHistoryError(locale === "my" ? "မေးခွန်းကို database ထဲ မသိမ်းနိုင်ပါ။" : "Could not save your question.");
      setLive(null);
      return;
    }

    const id = idRef.current++;
    setInput("");

    const query = new URLSearchParams({ conversation_id: conversationId!, message_id: userMessageId, model_id: selectedModelId, locale });
    const source = new EventSource(`/api/ai/sse?${query.toString()}`);
    sourceRef.current = source;
    const appendActivity = (message: string) => {
      const entry = {
        id: `${startedAt}-${activityRef.current.length}`,
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
        message,
      };
      activityRef.current = [...activityRef.current, entry];
      setLive((prev) => prev ? {
        ...prev,
        activity: [...prev.activity, entry],
      } : prev);
    };

    const fail = (code: string, detail?: string | null) => {
      source.close();
      sourceRef.current = null;
      setMessages((prev) => [...prev, {
        id,
        question: text,
        error: describeError(code, detail, locale),
        durationSeconds: Math.floor((Date.now() - startedAt) / 1000),
        activity: activityRef.current,
      }]);
      setLive(null);
    };

    source.addEventListener("status", (event) => {
      const state = (event as MessageEvent).data as string;
      const phase: ProgressPhase = state === "checking_intent" || state === "request_rejected"
        ? "checking_intent"
        : state === "forecast_loading"
          ? "calling_model"
          : state === "sql_loading"
            ? "loading_schema"
            : state === "combining_results"
              ? "narrating"
        : state === "diagnosing_failure" || state === "diagnosis_complete"
          ? "diagnosing_failure"
          : state === "intent_readonly"
            ? "checking_intent"
            : state === "loading_schema" || state === "generating_sql" || state === "schema_loaded"
              ? "loading_schema"
              : state === "calling_model" || state === "model_responded"
                ? "calling_model"
                : state === "validating_sql" || state === "sql_validated"
                  || state === "cache_hit" || state === "tool_matched"
                  ? "validating_sql"
                  : state === "executing" || state === "query_complete"
                    ? "executing"
                    : state === "narrating" || state === "summary_complete"
                      ? "narrating"
                      : "connecting";
      const statusMessages: Record<string, string> = {
        forecast_loading: locale === "my" ? "သင့်ဆိုင်ခွဲ၏ ခန့်မှန်းချက်ကို ရယူနေသည်…" : "Loading the branch forecast…",
        sql_loading: locale === "my" ? "ထပ်မေးထားသော မေးခွန်းအတွက် ဒေတာရှာနေသည်…" : "Looking up data for your added question…",
        combining_results: locale === "my" ? "ခန့်မှန်းချက်နှင့် ဒေတာဘေ့စ်ရလဒ်များကို ပေါင်းစပ်နေသည်…" : "Combining forecast and database results…",
        checking_intent: labels.checkingIntent,
        intent_readonly: labels.intentReadOnly,
        request_rejected: labels.requestRejected,
        diagnosing_failure: labels.diagnosingFailure,
        diagnosis_complete: labels.diagnosisComplete,
        generating_sql: labels.loadingSchema,
        loading_schema: labels.loadingSchema,
        schema_loaded: labels.schemaLoaded,
        calling_model: labels.generating,
        model_responded: labels.modelResponded,
        validating_sql: labels.validating,
        sql_validated: labels.sqlValidated,
        executing: labels.executing,
        query_complete: labels.queryComplete,
        narrating: labels.narrating,
        summary_complete: labels.summaryComplete,
        cache_hit: labels.cacheHit,
        tool_matched: labels.toolMatched,
      };
      const status = statusMessages[state] ?? labels.connecting;
      const entry = {
        id: `${startedAt}-${activityRef.current.length}`,
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
        message: status,
      };
      activityRef.current = [...activityRef.current, entry];
      setLive((prev) => prev ? {
        ...prev,
        phase,
        status,
        activity: [...prev.activity, entry],
      } : prev);
    });
    source.addEventListener("understanding", (event) => {
      setLive((prev) => (prev ? { ...prev, understanding: (event as MessageEvent).data } : prev));
    });
    source.addEventListener("plan", (event) => {
      const plan = parseJson<PlanItem[]>((event as MessageEvent).data, []);
      setLive((prev) => (prev ? { ...prev, plan } : prev));
      appendActivity(labels.planReady);
    });
    source.addEventListener("sql", (event) => {
      setLive((prev) => (prev ? { ...prev, sql: (event as MessageEvent).data } : prev));
      appendActivity(labels.sqlReady);
    });
    source.addEventListener("rows", (event) => {
      const rows = parseJson<Array<Record<string, unknown>>>((event as MessageEvent).data, []);
      setLive((prev) => (prev ? { ...prev, rows, rowCount: rows.length } : prev));
      appendActivity(labels.rowsReturned(rows.length));
    });
    source.addEventListener("answer", (event) => {
      const narration = parseJson<{ findings?: string[]; summary?: string }>(
        (event as MessageEvent).data,
        { summary: (event as MessageEvent).data },
      );
      setLive((prev) => (prev ? {
        ...prev,
        findings: narration.findings ?? [],
        summary: narration.summary ?? "",
      } : prev));
    });
    source.addEventListener("suggestions", (event) => {
      const suggestions = parseJson<string[]>((event as MessageEvent).data, []);
      setLive((prev) => (prev ? { ...prev, suggestions } : prev));
    });
    source.addEventListener("forecast", (event) => {
      const forecast = parseJson<ChatForecast | undefined>((event as MessageEvent).data, undefined);
      if (forecast?.type === "demand" || forecast?.type === "revenue" || forecast?.type === "comparison") {
        setLive((prev) => prev ? { ...prev, forecast } : prev);
      }
    });
    source.addEventListener("done", (event) => {
      source.close();
      sourceRef.current = null;
      const payload = JSON.parse((event as MessageEvent).data) as {
        ok: boolean;
        error?: string;
        data?: Partial<ChatMessage> & { row_count?: number };
      };
      if (!payload.ok) {
        fail(payload.error ?? "AI_QUERY_FAILED");
        return;
      }
      const data = payload.data ?? {};
      const rows = Array.isArray(data.rows) ? data.rows : undefined;
      setMessages((prev) => [...prev, {
        id,
        question: text,
        durationSeconds: Math.floor((Date.now() - startedAt) / 1000),
        activity: activityRef.current,
        understanding: data.understanding,
        plan: data.plan,
        answer: data.answer,
        findings: data.findings,
        summary: data.summary,
        suggestions: data.suggestions,
        sql: data.sql,
        forecast: data.forecast,
        sqlError: data.sql_error,
        failure: data.failure === true,
        rows,
        rowCount: data.row_count ?? data.rowCount ?? rows?.length,
        truncated: data.truncated,
      }]);
      setLive(null);
      void refreshConversations();
    });
    source.onerror = () => fail("AI_UNAVAILABLE");
  }

  function renderDetails(message: ChatMessage | LiveState) {
    return (
      <div className="space-y-3">
        {message.forecast && (
          <section className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">
              {message.forecast.type === "comparison"
                ? locale === "my" ? "ကာလနှိုင်းယှဉ်ချက်" : "Period comparison"
                : message.forecast.type === "demand"
                ? locale === "my" ? "လိုအပ်ချက်ခန့်မှန်းချက်" : "Demand forecast"
                : locale === "my" ? "ရောင်းရငွေခန့်မှန်းချက်" : "Revenue forecast"}
            </h3>
            {message.forecast.type === "comparison" ? (
              <ComparisonView forecast={message.forecast} locale={locale} />
            ) : message.forecast.type === "demand" ? (
              <>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>{locale === "my" ? `ကာလ ${message.forecast.days} ရက်` : `${message.forecast.days}-day outlook`}</span>
                  <span>{locale === "my" ? `ပြန်မှာရန် ${message.forecast.need_order_count ?? 0} မျိုး` : `${message.forecast.need_order_count ?? 0} products to reorder`}</span>
                  <span>{locale === "my" ? `အကြံပြုစုစုပေါင်း ${message.forecast.total_suggested_units ?? 0} ခု` : `${message.forecast.total_suggested_units ?? 0} suggested units`}</span>
                  <span>{message.forecast.forecast_source === "seasonal_model" ? "Seasonal model" : "Moving average"}</span>
                </div>
                {!!message.forecast.items?.length && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{locale === "my" ? "ပစ္စည်း" : "Product"}</TableHead>
                        <TableHead>{locale === "my" ? "နေ့စဉ်ပျမ်းမျှ" : "Daily avg."}</TableHead>
                        <TableHead>{locale === "my" ? "လက်ကျန်" : "On hand"}</TableHead>
                        <TableHead>{locale === "my" ? "လက်ကျန်ရက်" : "Days left"}</TableHead>
                        <TableHead>{locale === "my" ? "မှာယူရန်" : "Suggested order"}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>{message.forecast.items.slice(0, 10).map((item, index) => (
                        <TableRow key={`${String(item.product_id ?? item.product_name)}-${index}`}>
                          <TableCell>{formatCell(item.product_name)}</TableCell>
                          <TableCell>{formatCell(item.avg_daily_sales)}</TableCell>
                          <TableCell>{formatCell(item.on_hand)}</TableCell>
                          <TableCell>{formatCell(item.days_of_cover)}</TableCell>
                          <TableCell>{formatCell(item.suggested_qty)}</TableCell>
                        </TableRow>
                      ))}</TableBody>
                    </Table>
                    {message.forecast.items.length > 10 && <p className="mt-1 text-xs text-muted-foreground">{locale === "my" ? "ပထမဆုံး ကုန်ပစ္စည်း ၁၀ မျိုး" : "First 10 products"}</p>}
                  </div>
                )}
              </>
            ) : (
              <>
                {(!message.forecast.trained || (message.forecast.history_weeks ?? 0) < (message.forecast.weeks_required ?? 40)) ? (
                  <p className="text-sm text-muted-foreground">
                    {locale === "my"
                      ? `ခန့်မှန်းရန် မော်ဒယ် မလေ့ကျင့်ရသေးပါ သို့မဟုတ် အရောင်းမှတ်တမ်း မလုံလောက်ပါ။ ${message.forecast.history_weeks ?? 0} / ${message.forecast.weeks_required ?? 40} ပတ်။`
                      : `A trained model needs at least ${message.forecast.weeks_required ?? 40} complete weeks. Available: ${message.forecast.history_weeks ?? 0} weeks.`}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>{locale === "my" ? `အရောင်းမှတ်တမ်း ${message.forecast.history_weeks} ပတ်` : `${message.forecast.history_weeks} weeks of history`}</span>
                      {message.forecast.metrics?.wape_pct != null && <span>WAPE {message.forecast.metrics.wape_pct}%</span>}
                      {message.forecast.trained_at && <span>{locale === "my" ? "လေ့ကျင့်သည့်နေ့" : "Trained"}: {new Date(message.forecast.trained_at).toLocaleDateString(locale === "my" ? "my-MM" : "en-US")}</span>}
                    </div>
                    {!!message.forecast.forecast?.length && (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {message.forecast.forecast.map((week) => (
                          <div key={week.week} className="rounded-md bg-muted/50 p-2">
                            <p className="text-xs text-muted-foreground">{locale === "my" ? "အပတ်စတင်ရက်" : "Week of"} {week.week}</p>
                            <p className="font-semibold">{new Intl.NumberFormat(locale === "my" ? "my-MM" : "en-US", { maximumFractionDigits: 0 }).format(week.amount)} {locale === "my" ? "₭" : "MMK"}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {!!message.forecast.top_products?.length && (
                      <p className="text-xs text-muted-foreground">
                        {locale === "my" ? "လာမည့်အပတ် ရောင်းရငွေခန့်မှန်းချက်အမြင့်ဆုံး ပစ္စည်းများ" : "Highest forecast product revenue"}: {message.forecast.top_products.slice(0, 5).map((item) => `${item.product_name} (${new Intl.NumberFormat(locale === "my" ? "my-MM" : "en-US", { maximumFractionDigits: 0 }).format(item.next_week_amount)})`).join(", ")}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            {message.sqlError && <p className="text-xs text-amber-700">{labels.sqlSupplementFailed}</p>}
          </section>
        )}
        {message.understanding && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">{labels.understanding}</h3>
            <p className="text-sm text-muted-foreground">{message.understanding}</p>
          </section>
        )}

        {message.plan && message.plan.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{labels.plan}</h3>
            <div className="space-y-2">
              {message.plan.map((item, index) => (
                <div key={`${item.table}-${index}`} className="rounded-md bg-muted/50 p-2 text-sm">
                  <p className="font-medium">{item.table} — {item.purpose}</p>
                  {item.columns.length > 0 && (
                    <p className="text-xs text-muted-foreground">{labels.columns}: {item.columns.join(", ")}</p>
                  )}
                  {item.filter && <p className="text-xs text-muted-foreground">{labels.filter}: {item.filter}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {message.sql && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              {labels.sql} {message.truncated && <Badge variant="outline">{labels.firstRows}</Badge>}
            </summary>
            <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">{message.sql}</pre>
          </details>
        )}

        {message.rows && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{labels.table}</h3>
            {message.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                        {Object.keys(message.rows[0]).map((column) => (
                        <TableHead key={column}>{formatColumn(column, locale)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {message.rows.slice(0, 50).map((row, index) => (
                      <TableRow key={index}>
                        {Object.keys(message.rows![0]).map((column) => (
                          <TableCell key={column}>{formatCell(row[column])}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-1 text-xs text-muted-foreground">
                  {message.rowCount ?? message.rows.length} {labels.rows}
                  {message.truncated ? ` — ${labels.firstRows}` : ""}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{labels.noRows}</p>
            )}
          </section>
        )}

        {message.findings && message.findings.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">{labels.findings}</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {message.findings.map((finding, index) => <li key={index}>{finding}</li>)}
            </ul>
          </section>
        )}

        {message.summary && (
          <section className="rounded-md border-l-2 border-primary bg-muted/40 px-3 py-2">
            <h3 className="text-sm font-semibold">{labels.summary}</h3>
            <p className="text-sm">{message.summary}</p>
          </section>
        )}

        {message.suggestions && message.suggestions.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{labels.followups}</h3>
            <div className="flex flex-wrap gap-2">
              {message.suggestions.map((suggestion, index) => (
                <Button key={`${suggestion}-${index}`} variant="outline" size="sm" onClick={() => ask(suggestion, Date.now())}>
                  {suggestion}
                </Button>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <PageShell
      title="AI Chat"
      subtitle={labels.subtitle}
      allow={["admin", "inventory"]}
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-gradient-primary text-white">
              <Sparkles className="size-3.5" />
            </span>
            {labels.conversation}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!modelsLoading && models.length === 0 && (
            <p className="text-sm text-muted-foreground">{labels.noModels}</p>
          )}
          {messages.length === 0 && !live && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{labels.tryOne}</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button key={suggestion} variant="outline" size="sm" onClick={() => ask(suggestion, Date.now())} disabled={!selectedModelId}>
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="max-w-full rounded-md bg-gradient-soft px-3 py-2 text-sm font-medium text-foreground">{message.question}</p>
                {message.durationSeconds !== undefined && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    <span className="font-medium">{labels.workedFor}</span>{" "}
                    {formatElapsed(message.durationSeconds)}
                  </p>
                )}
              </div>
              {message.error && <p className="text-sm text-red-600">{message.error}</p>}
              {message.activity && message.activity.length > 0 && (
                <details className="rounded-md border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-xs font-semibold">{labels.activityLog}</summary>
                  <ol className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                    {message.activity.map((entry) => (
                      <li key={entry.id} className="flex gap-2 text-xs">
                        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                          {formatElapsed(entry.elapsedSeconds)}
                        </span>
                        <span>{entry.message}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {renderDetails(message)}
            </div>
          ))}

          {live && (
            <div className="space-y-3 rounded-lg border border-primary/25 bg-gradient-soft p-4" aria-live="polite">
              <p className="text-sm font-medium">{live.question}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">{live.status}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  <span className="font-medium">{labels.workedFor}</span>{" "}
                  {formatElapsed(Math.floor(((timerNow || live.startedAt) - live.startedAt) / 1000))}
                </p>
              </div>
              <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {progressSteps.map((step, index) => {
                  const activeIndex = progressSteps.findIndex((item) => item.phase === live.phase);
                  const complete = live.phase !== "diagnosing_failure" && activeIndex >= 0 && index < activeIndex;
                  const current = step.phase === live.phase;
                  return (
                    <li
                      key={step.phase}
                      aria-current={current ? "step" : undefined}
                      className={`flex min-h-10 items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                        current
                          ? "border-primary bg-primary/5 text-foreground"
                          : complete
                            ? "border-emerald-600/30 text-muted-foreground"
                            : "border-border text-muted-foreground"
                      }`}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular-nums">
                        {complete ? "✓" : index + 1}
                      </span>
                      <span>{step.label}</span>
                    </li>
                  );
                })}
              </ol>
              <section className="space-y-2 rounded-md border bg-muted/20 p-3">
                <h3 className="text-xs font-semibold">{labels.activityLog}</h3>
                <ol className="max-h-48 space-y-1.5 overflow-y-auto">
                  {live.activity.map((entry) => (
                    <li key={entry.id} className="flex gap-2 text-xs">
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                        {formatElapsed(entry.elapsedSeconds)}
                      </span>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ol>
              </section>
              {renderDetails(live)}
            </div>
          )}

          {commandSuggestions.length > 0 && !live && (
            <div className="space-y-1 rounded-md border bg-background p-2 shadow-md" role="listbox" aria-label={labels.commands}>
              <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{labels.commands}</p>
              {commandSuggestions.map((item, index) => (
                <button
                  key={item.command}
                  type="button"
                  role="option"
                  aria-selected={selectedCommandIndex === index}
                  className={`flex w-full items-start justify-between gap-3 rounded px-2 py-2 text-left text-sm ${selectedCommandIndex === index ? "bg-muted" : "hover:bg-muted/60"}`}
                  onMouseEnter={() => setSelectedCommandIndex(index)}
                  onClick={() => {
                    setInput(`${item.command} `);
                    setSelectedCommandIndex(0);
                  }}
                >
                  <span className="font-mono font-medium">{item.command}</span>
                  <span className="text-xs text-muted-foreground">{item.description[locale]}</span>
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              ask(input, Date.now());
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="outline" aria-label={labels.model} disabled={modelsLoading || models.length === 0 || !!live} className="h-10 w-40 justify-between px-2 sm:w-52" />}
              >
                <span className="min-w-0 truncate text-left">
                  {selectedModel?.displayName ?? (modelsLoading ? labels.modelsLoading : labels.chooseModel)}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-72">
                <DropdownMenuRadioGroup
                  value={selectedModelId}
                  onValueChange={(id) => {
                    setSelectedModelId(id);
                    try {
                      localStorage.setItem(LAST_MODEL_STORAGE_KEY, id);
                    } catch {
                      // Keep the selection for this page session if storage is disabled.
                    }
                  }}
                >
                  {models.map((model) => (
                    <DropdownMenuRadioItem key={model.id} value={model.id} className="min-h-10 pr-8">
                      <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {model.provider === "opencode_zen" ? "OpenCode Zen" : model.provider === "opencode_console" ? "OpenCode Console" : "OpenRouter"}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              className="min-w-0 flex-1"
              placeholder={labels.askPlaceholder}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setSelectedCommandIndex(0);
              }}
              onKeyDown={(event) => {
                if (commandSuggestions.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedCommandIndex((index) => (index + 1) % commandSuggestions.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedCommandIndex((index) => (index - 1 + commandSuggestions.length) % commandSuggestions.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const item = commandSuggestions[selectedCommandIndex] ?? commandSuggestions[0];
                  if (item) setInput(`${item.command} `);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setInput("");
                }
              }}
              maxLength={500}
              disabled={!!live || !selectedModelId || modelsLoading}
            />
            <Button type="submit" variant="ai" disabled={!!live || !input.trim() || !selectedModelId || modelsLoading}>
              {labels.ask}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>{labels.historyTitle}</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!!live || !!openingConversationId}
            onClick={() => {
              setActiveConversationId(null);
              setMessages([]);
              setHistoryError("");
            }}
          >
            {labels.newConversation}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="max-h-[calc(100vh-14rem)] space-y-1 overflow-y-auto" aria-label={labels.historyTitle}>
            {historyLoading && conversations.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">{labels.historyLoading}</p>
            )}
            {!historyLoading && conversations.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">{labels.noConversations}</p>
            )}
            {conversations.map((conversation) => (
              <div key={conversation.id} className="flex min-w-0 items-center gap-1">
                <Button
                  type="button"
                  variant={activeConversationId === conversation.id ? "secondary" : "ghost"}
                  className="h-auto min-h-9 min-w-0 flex-1 justify-start px-2 py-2 text-left whitespace-normal"
                  disabled={!!live || !!openingConversationId}
                  title={conversation.title}
                  aria-current={activeConversationId === conversation.id ? "page" : undefined}
                  onClick={() => void openConversation(conversation.id)}
                >
                  <span className="line-clamp-2 min-w-0 flex-1">{conversation.title}</span>
                  {openingConversationId === conversation.id && <span className="text-xs text-muted-foreground">…</span>}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${labels.deleteConversation}: ${conversation.title}`}
                  title={labels.deleteConversation}
                  disabled={!!live || !!openingConversationId}
                  onClick={() => void deleteSavedConversation(conversation.id)}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
          {historyError && <p role="status" className="mt-3 text-sm text-destructive">{historyError}</p>}
        </CardContent>
      </Card>
      </div>
    </PageShell>
  );
}
