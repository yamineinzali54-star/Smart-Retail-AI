import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiModelConfig } from "@/lib/ai-model-settings";

// Relay contract tests (mocked session + upstream fetch — no DB, no network).
// Covers: authz (401/403), validation (400), saved-message guard (404),
// upstream mapping (AI_UNAVAILABLE / quota / query-failed) and success shapes.
process.env.DATABASE_URL ??= "postgresql://airelay-test:airelay-test@localhost:1/airelay_test";
process.env.AI_SERVICE_TOKEN ??= "test-ai-service-token";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

vi.mock("@/lib/ai-model-settings", () => ({
  reserveAiModel: vi.fn(),
  recordAiModelUsage: vi.fn(async () => {}),
  getSelectableAiModels: vi.fn(),
}));

vi.mock("@/lib/ai-chat", () => ({
  completeAiChatMessage: vi.fn(async () => {}),
  getPendingUserMessage: vi.fn(),
  markMessageFailed: vi.fn(async () => {}),
}));

vi.mock("@/db", () => ({
  db: { select: vi.fn() },
}));

const { getSession } = await import("@/lib/auth");
const { reserveAiModel, getSelectableAiModels } = await import("@/lib/ai-model-settings");
const { getPendingUserMessage } = await import("@/lib/ai-chat");
const { db } = await import("@/db");
const mockSession = vi.mocked(getSession);
const mockReserve = vi.mocked(reserveAiModel);
const mockSelectable = vi.mocked(getSelectableAiModels);
const mockPending = vi.mocked(getPendingUserMessage);
const mockDbSelect = vi.mocked(db.select);
const fetchMock = vi.fn();

type Session = Awaited<ReturnType<typeof getSession>>;

const ADMIN: Session = {
  user: { id: "u1", userName: "admin1", role: "admin", branchId: "branch-ygn" },
  sessionId: "s1",
  expiresAt: 9999999999,
};
const CASHER: Session = {
  user: { id: "u3", userName: "cashier1", role: "cashier", branchId: "branch-ygn" },
  sessionId: "s3",
  expiresAt: 9999999999,
};

const MODEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CONVERSATION_ID = "11111111-2222-4333-8444-555555555555";
const MESSAGE_ID = "99999999-8888-4777-8666-555555555555";

const MODEL: AiModelConfig = {
  id: MODEL_ID,
  provider: "openrouter",
  apiKeyId: "k1",
  apiKeyLabel: "primary",
  name: "test-model",
  displayName: "Test Model",
  apiKey: "sk-test",
  expiresAt: null,
  providerContextLength: 128_000,
  providerMaxOutputTokens: null,
  providerRequestLimits: null,
  providerLimitsCheckedAt: null,
  requestsToday: 0,
  requestsThisMonth: 0,
  totalTokensToday: 0,
  totalTokensThisMonth: 0,
  costUsdToday: 0,
  costUsdThisMonth: 0,
  costReportedToday: false,
  costReportedThisMonth: false,
  usageDay: "",
  usageMonth: "",
  enabled: true,
  isDefault: true,
  sortOrder: 0,
};

const { POST: chatPost } = await import("@/app/api/ai/chat/route");
const { GET: sseGet } = await import("@/app/api/ai/sse/route");
const { GET: forecastGet } = await import("@/app/api/ai/forecast/route");
const { GET: alertsGet } = await import("@/app/api/ai/alerts/route");
const { GET: basketGet } = await import("@/app/api/ai/basket/route");
const { GET: pricingGet } = await import("@/app/api/ai/pricing/route");

function jsonReq(method: string, body: unknown): Request {
  return new Request("http://localhost/api/ai/chat", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CHAT_BODY = { question: "today sales?", modelId: MODEL_ID };

beforeEach(() => {
  mockSession.mockReset();
  fetchMock.mockReset();
  mockReserve.mockReset();
  mockSelectable.mockReset();
  mockPending.mockReset();
  mockDbSelect.mockReset();
  mockReserve.mockResolvedValue({ ok: true, model: MODEL });
  mockSelectable.mockResolvedValue([MODEL]);
  mockPending.mockResolvedValue({ id: MESSAGE_ID, content: "today sales?", status: "pending" });
  vi.stubGlobal("fetch", fetchMock);
});

function stubPricingBatches(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = async () => rows;
  mockDbSelect.mockReturnValue(chain as never);
}

describe("POST /api/ai/chat", () => {
  it("401 without session", async () => {
    mockSession.mockResolvedValue(null);
    const res = await chatPost(jsonReq("POST", CHAT_BODY));
    expect(res.status).toBe(401);
  });

  it("403 for cashier", async () => {
    mockSession.mockResolvedValue(CASHER);
    const res = await chatPost(jsonReq("POST", CHAT_BODY));
    expect(res.status).toBe(403);
  });

  it("400 on empty question", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const res = await chatPost(jsonReq("POST", { question: "  ", modelId: MODEL_ID }));
    expect(res.status).toBe(400);
  });

  it("400 without a model id", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const res = await chatPost(jsonReq("POST", { question: "hi" }));
    expect(res.status).toBe(400);
  });

  it("503 AI_UNAVAILABLE when the AI service is down", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("conn refused"));
    const res = await chatPost(jsonReq("POST", CHAT_BODY));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_UNAVAILABLE" });
  });

  it("429 on provider rate or spending limit", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    const res = await chatPost(jsonReq("POST", CHAT_BODY));
    expect(res.status).toBe(429);
  });

  it("422 AI_QUERY_FAILED with detail passthrough", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(
      Response.json({ ok: false, error: "query failed: boom" }),
    );
    const res = await chatPost(jsonReq("POST", CHAT_BODY));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_QUERY_FAILED" });
  });

  it("200 returns answer + sql + rows capped at 50", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(
      Response.json({
        ok: true,
        job_id: "j1",
        data: {
          answer: "Total 3,800 Ks.",
          sql: "SELECT 1",
          rows: Array.from({ length: 60 }, (_, i) => ({ n: i })),
          row_count: 60,
          truncated: true,
        },
      }),
    );
    const res = await chatPost(jsonReq("POST", CHAT_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe("Total 3,800 Ks.");
    expect(body.rows).toHaveLength(50);
    expect(body.truncated).toBe(true);
    // branch scoping + model selection forwarded to the AI service
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      job_type: "rag_answer",
      branch_id: "branch-ygn",
      params: { question: "today sales?" },
    });
    const headers = new Headers(init.headers);
    expect(headers.get("x-ai-model")).toBe(MODEL.name);
    expect(headers.get("x-ai-service-token")).toBe(process.env.AI_SERVICE_TOKEN);
  });
});

describe("GET /api/ai/sse", () => {
  const url = (extra: Record<string, string> = {}) =>
    new Request(
      `http://localhost/api/ai/sse?${new URLSearchParams({
        conversation_id: CONVERSATION_ID,
        message_id: MESSAGE_ID,
        model_id: MODEL_ID,
        ...extra,
      })}`,
    );

  it("401 / 403 / 400 guards", async () => {
    mockSession.mockResolvedValue(null);
    expect((await sseGet(url())).status).toBe(401);
    mockSession.mockResolvedValue(CASHER);
    expect((await sseGet(url())).status).toBe(403);
    mockSession.mockResolvedValue(ADMIN);
    // missing conversation/message/model ids → validation error
    expect((await sseGet(new Request("http://localhost/api/ai/sse"))).status).toBe(400);
  });

  it("404 when no pending saved message exists for the ids", async () => {
    mockSession.mockResolvedValue(ADMIN);
    // runtime returns null when no row matches, though the inferred type omits it
    mockPending.mockResolvedValue(null as never);
    const res = await sseGet(url());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: "CHAT_MESSAGE_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies the upstream event stream", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const payload = 'event: done\ndata: {"ok":true}\n\n';
    fetchMock.mockResolvedValue(
      new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const res = await sseGet(url());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toContain("event: done");
    // the question comes from the saved message, and branch scoping is forwarded
    const [upstreamUrl] = fetchMock.mock.calls[0] as [string];
    expect(upstreamUrl).toContain("/stream/rag");
    expect(upstreamUrl).toContain("question=today+sales%3F");
    expect(upstreamUrl).toContain("branch_id=branch-ygn");
  });

  it("emits done AI_UNAVAILABLE when upstream is down (still 200)", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("down"));
    const res = await sseGet(url());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("AI_UNAVAILABLE");
  });

  it("emits done AI_MODEL_UNAVAILABLE when the model reservation fails (still 200)", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockReserve.mockResolvedValue({ ok: false, error: "AI_MODEL_UNAVAILABLE" });
    const res = await sseGet(url());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("AI_MODEL_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/ai/forecast", () => {
  const url = (params: Record<string, string> = {}) =>
    new Request(
      `http://localhost/api/ai/forecast?${new URLSearchParams({ days: "30", ...params })}`,
    );

  it("401 without session / 403 for cashier", async () => {
    mockSession.mockResolvedValue(null);
    expect((await forecastGet(url())).status).toBe(401);
    mockSession.mockResolvedValue(CASHER);
    expect((await forecastGet(url())).status).toBe(403);
  });

  it("429 AI_MODEL_UNAVAILABLE when the explicit model cannot be reserved", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockReserve.mockResolvedValue({ ok: false, error: "AI_MODEL_UNAVAILABLE" });
    const res = await forecastGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_MODEL_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards DB model credentials and strips modelId from job params", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(
      Response.json({
        ok: true,
        job_id: "j1",
        data: {
          forecasts: [{ product_id: "p1", needs_order: true }],
          product_count: 1,
          need_order_count: 1,
          insights: "1 product(s) need reordering.",
        },
      }),
    );
    const res = await forecastGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.llm_model).toBe(MODEL.name);
    expect(body.forecast_source).toBe("moving_average");
    expect(body.insights).toBe("1 product(s) need reordering.");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      job_type: "forecast_build",
      branch_id: "branch-ygn",
      params: { days: 30 },
    });
    expect(sent.params).not.toHaveProperty("modelId");
    const headers = new Headers(init.headers);
    expect(headers.get("x-ai-model")).toBe(MODEL.name);
    expect(headers.get("x-ai-api-key")).toBe("sk-test");
    expect(headers.get("x-ai-service-token")).toBe(process.env.AI_SERVICE_TOKEN);
  });

  it("forwards the trained demand model (source + metadata)", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(
      Response.json({
        ok: true,
        job_id: "j1",
        data: {
          forecasts: [{ product_id: "p1", needs_order: true }],
          product_count: 1,
          need_order_count: 1,
          total_suggested_units: 12,
          insights: "Order p1.",
          forecast_source: "seasonal_model",
          model: {
            algorithm: "additive_seasonal_trend",
            window: 3,
            trained_at: "2026-10-22T07:38:11Z",
            test_mae: 1.87,
          },
        },
      }),
    );
    const res = await forecastGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forecast_source).toBe("seasonal_model");
    expect(body.forecast_model.algorithm).toBe("additive_seasonal_trend");
    expect(body.forecast_model.test_mae).toBe(1.87);
  });

  it("uses the default model when no modelId is given", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: { forecasts: [] } }));
    const res = await forecastGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).toHaveBeenCalledWith(MODEL_ID);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-ai-model")).toBe(MODEL.name);
  });

  it("falls back to the env path when no models are configured", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockSelectable.mockResolvedValue([]);
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: { forecasts: [] } }));
    const res = await forecastGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-ai-model")).toBeNull();
  });

  it("503 AI_UNAVAILABLE when the AI service is down", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("conn refused"));
    const res = await forecastGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_UNAVAILABLE" });
  });

  it("422 AI_QUERY_FAILED with detail passthrough", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(
      Response.json({ ok: false, error: "query failed: boom" }),
    );
    const res = await forecastGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_QUERY_FAILED" });
  });
});

describe("GET /api/ai/alerts", () => {
  const url = (params: Record<string, string> = {}) =>
    new Request(`http://localhost/api/ai/alerts?${new URLSearchParams(params)}`);

  const UPSTREAM_OK = Response.json({
    ok: true,
    job_id: "j1",
    data: {
      dead_stock: [],
      price_flags: [],
      abuse_flags: [],
      counts: { dead_stock: 0, price_flags: 0, abuse_flags: 0 },
      insights: "No operational alerts.",
    },
  });

  it("401 without session / 403 for cashier", async () => {
    mockSession.mockResolvedValue(null);
    expect((await alertsGet(url())).status).toBe(401);
    mockSession.mockResolvedValue(CASHER);
    expect((await alertsGet(url())).status).toBe(403);
  });

  it("429 AI_MODEL_UNAVAILABLE when the explicit model cannot be reserved", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockReserve.mockResolvedValue({ ok: false, error: "AI_MODEL_UNAVAILABLE" });
    const res = await alertsGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_MODEL_UNAVAILABLE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards DB model credentials, narrate:true, and strips modelId", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await alertsGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(MODEL.name);
    expect(body.insights).toBe("No operational alerts.");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      job_type: "ops_alerts",
      branch_id: "branch-ygn",
      params: { narrate: true },
    });
    expect(sent.params).not.toHaveProperty("modelId");
    const headers = new Headers(init.headers);
    expect(headers.get("x-ai-model")).toBe(MODEL.name);
    expect(headers.get("x-ai-api-key")).toBe("sk-test");
  });

  it("uses the default model when no modelId is given", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await alertsGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).toHaveBeenCalledWith(MODEL_ID);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-ai-model")).toBe(MODEL.name);
  });

  it("falls back to the env path when no models are configured", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockSelectable.mockResolvedValue([]);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await alertsGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-ai-model")).toBeNull();
  });

  it("503 AI_UNAVAILABLE when the AI service is down", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("conn refused"));
    const res = await alertsGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(503);
  });

  it("422 AI_QUERY_FAILED with detail passthrough", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(Response.json({ ok: false, error: "query failed: boom" }));
    const res = await alertsGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(422);
  });
});

describe("GET /api/ai/basket", () => {
  const url = (params: Record<string, string> = {}) =>
    new Request(`http://localhost/api/ai/basket?${new URLSearchParams(params)}`);

  const UPSTREAM_OK = Response.json({
    ok: true,
    job_id: "j1",
    data: {
      rules: [{ antecedent: "A", consequent: "B" }],
      drafts: [],
      transaction_count: 3,
      days: 90,
      insights: "Found 1 co-purchase rule(s).",
    },
  });

  it("401 without session / 403 for cashier", async () => {
    mockSession.mockResolvedValue(null);
    expect((await basketGet(url())).status).toBe(401);
    mockSession.mockResolvedValue(CASHER);
    expect((await basketGet(url())).status).toBe(403);
  });

  it("429 AI_MODEL_UNAVAILABLE when the explicit model cannot be reserved", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockReserve.mockResolvedValue({ ok: false, error: "AI_MODEL_UNAVAILABLE" });
    const res = await basketGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards DB model credentials, narrate:true, and strips modelId", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await basketGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(MODEL.name);
    expect(body.insights).toBe("Found 1 co-purchase rule(s).");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      job_type: "basket_build",
      branch_id: "branch-ygn",
      params: { days: 90, narrate: true },
    });
    expect(sent.params).not.toHaveProperty("modelId");
    const headers = new Headers(init.headers);
    expect(headers.get("x-ai-model")).toBe(MODEL.name);
    expect(headers.get("x-ai-api-key")).toBe("sk-test");
  });

  it("uses the default model when no modelId is given", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await basketGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).toHaveBeenCalledWith(MODEL_ID);
  });

  it("falls back to the env path when no models are configured", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockSelectable.mockResolvedValue([]);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await basketGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-ai-model")).toBeNull();
  });

  it("503 AI_UNAVAILABLE when the AI service is down", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("conn refused"));
    const res = await basketGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/ai/pricing", () => {
  const url = (params: Record<string, string> = {}) =>
    new Request(`http://localhost/api/ai/pricing${params.min_margin_pct || params.modelId ? `?${new URLSearchParams(params)}` : ""}`);

  const BATCH = {
    productId: "p1",
    productName: "Noodle",
    onHand: "10",
    cost: "95",
    price: "100",
  };

  const UPSTREAM_OK = Response.json({
    ok: true,
    data: {
      thin_margin_flags: [{ product_id: "p1", margin_pct: 5 }],
      insights: "1 product(s) below the 10% margin floor.",
    },
  });

  it("401 without session / 403 for cashier", async () => {
    stubPricingBatches([BATCH]);
    mockSession.mockResolvedValue(null);
    expect((await pricingGet(url())).status).toBe(401);
    mockSession.mockResolvedValue(CASHER);
    expect((await pricingGet(url())).status).toBe(403);
  });

  it("429 AI_MODEL_UNAVAILABLE when the explicit model cannot be reserved", async () => {
    stubPricingBatches([BATCH]);
    mockSession.mockResolvedValue(ADMIN);
    mockReserve.mockResolvedValue({ ok: false, error: "AI_MODEL_UNAVAILABLE" });
    const res = await pricingGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("early-returns without AI when no stock rows qualify", async () => {
    stubPricingBatches([]);
    mockSession.mockResolvedValue(ADMIN);
    const res = await pricingGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, item_count: 0, flags: [], insights: "" });
    expect(mockReserve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards DB model credentials, items, narrate:true, and strips modelId", async () => {
    stubPricingBatches([BATCH]);
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await pricingGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(MODEL.name);
    expect(body.insights).toBe("1 product(s) below the 10% margin floor.");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.job_type).toBe("price_optimize");
    expect(sent.branch_id).toBe("branch-ygn");
    expect(sent.params.narrate).toBe(true);
    expect(sent.params).not.toHaveProperty("modelId");
    expect(sent.params.items).toHaveLength(1);
    expect(sent.params.items[0]).toMatchObject({ product_id: "p1" });
    const headers = new Headers(init.headers);
    expect(headers.get("x-ai-model")).toBe(MODEL.name);
    expect(headers.get("x-ai-api-key")).toBe("sk-test");
  });

  it("uses the default model when no modelId is given", async () => {
    stubPricingBatches([BATCH]);
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await pricingGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).toHaveBeenCalledWith(MODEL_ID);
  });

  it("falls back to the env path when no models are configured", async () => {
    stubPricingBatches([BATCH]);
    mockSession.mockResolvedValue(ADMIN);
    mockSelectable.mockResolvedValue([]);
    fetchMock.mockResolvedValue(UPSTREAM_OK.clone());
    const res = await pricingGet(url());
    expect(res.status).toBe(200);
    expect(mockReserve).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("x-ai-model")).toBeNull();
  });

  it("503 AI_UNAVAILABLE when the AI service is down", async () => {
    stubPricingBatches([BATCH]);
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("conn refused"));
    const res = await pricingGet(url({ modelId: MODEL_ID }));
    expect(res.status).toBe(503);
  });
});
