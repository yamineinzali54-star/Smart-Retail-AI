import { beforeEach, describe, expect, it, vi } from "vitest";

// Contract tests for the demand-model training relays (mocked session +
// upstream fetch — no DB, no network).
//
//   GET  /api/ai/forecast/train          -> training runs + active model
//   POST /api/ai/forecast/train          -> retrain (admin only)
//   GET  /api/ai/forecast/train/stream   -> SSE relay of the training steps
//   GET  /api/ai/forecast/artifacts/[runId]/dataset -> dataset CSV download
process.env.DATABASE_URL ??= "postgresql://airelay-test:airelay-test@localhost:1/airelay_test";
process.env.AI_SERVICE_TOKEN ??= "test-ai-service-token";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const { getSession } = await import("@/lib/auth");
const mockSession = vi.mocked(getSession);
const fetchMock = vi.fn();

const ADMIN = {
  user: { id: "u1", userName: "admin1", role: "admin" as const, branchId: "branch-ygn" },
  sessionId: "s1",
  expiresAt: 9999999999,
};
const INVENTORY = {
  user: { id: "u2", userName: "inv1", role: "inventory" as const, branchId: "branch-ygn" },
  sessionId: "s2",
  expiresAt: 9999999999,
};
const CASHER = {
  user: { id: "u3", userName: "cashier1", role: "cashier" as const, branchId: "branch-ygn" },
  sessionId: "s3",
  expiresAt: 9999999999,
};

const { GET: trainGet, POST: trainPost } = await import("@/app/api/ai/forecast/train/route");
const { GET: streamGet } = await import("@/app/api/ai/forecast/train/stream/route");
const { GET: datasetGet } = await import(
  "@/app/api/ai/forecast/artifacts/[runId]/dataset/route"
);

beforeEach(() => {
  mockSession.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("GET /api/ai/forecast/train", () => {
  it("401 without a session and 403 for a cashier", async () => {
    mockSession.mockResolvedValue(null);
    expect((await trainGet()).status).toBe(401);
    mockSession.mockResolvedValue(CASHER);
    expect((await trainGet()).status).toBe(403);
  });

  it("returns the runs and the active model for admin and inventory", async () => {
    mockSession.mockResolvedValue(INVENTORY);
    fetchMock.mockResolvedValue(
      Response.json({
        ok: true,
        artifact_dir: "artifacts/forecast",
        active: { model: { algorithm: "additive_seasonal_trend" }, metrics: { test_mae: 1.87 } },
        runs: [{ run_id: "20261022T000000Z_YGN", test_mae: 1.87, steps: [] }],
      }),
    );
    const res = await trainGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.active.model.algorithm).toBe("additive_seasonal_trend");
    expect(body.runs).toHaveLength(1);
  });

  it("503 when the AI service is unreachable", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("conn refused"));
    const res = await trainGet();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_UNAVAILABLE" });
  });
});

describe("POST /api/ai/forecast/train", () => {
  it("is admin only (inventory and cashier are refused)", async () => {
    mockSession.mockResolvedValue(INVENTORY);
    expect(
      (await trainPost(new Request("http://localhost/api/ai/forecast/train", { method: "POST" })))
        .status,
    ).toBe(403);
    mockSession.mockResolvedValue(CASHER);
    expect(
      (await trainPost(new Request("http://localhost/api/ai/forecast/train", { method: "POST" })))
        .status,
    ).toBe(403);
  });

  it("401 without a session", async () => {
    mockSession.mockResolvedValue(null);
    const res = await trainPost(
      new Request("http://localhost/api/ai/forecast/train", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("forwards the training request and returns the run summary", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(
      Response.json({
        ok: true,
        run_id: "20261022T000000Z_YGN",
        model: { algorithm: "additive_seasonal_trend" },
        metrics: { test: { model: { mae: 1.87 } } },
        steps: [{ step: "grid_search", status: "ok", duration_ms: 12 }],
      }),
    );
    const res = await trainPost(
      new Request("http://localhost/api/ai/forecast/train", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run_id).toBe("20261022T000000Z_YGN");
    expect(body.steps).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.method)).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("x-ai-service-token")).toBe(process.env.AI_SERVICE_TOKEN);
  });

  it("422 when the training run fails", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(Response.json({ ok: false, error: "query failed: boom" }));
    const res = await trainPost(
      new Request("http://localhost/api/ai/forecast/train", { method: "POST" }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: "AI_QUERY_FAILED" });
  });
});

describe("GET /api/ai/forecast/train/stream", () => {
  it("401 without a session, 403 for a non-admin", async () => {
    mockSession.mockResolvedValue(null);
    expect((await streamGet(new Request("http://localhost/api/ai/forecast/train/stream"))).status).toBe(401);
    mockSession.mockResolvedValue(INVENTORY);
    expect((await streamGet(new Request("http://localhost/api/ai/forecast/train/stream"))).status).toBe(403);
  });

  it("proxies the upstream event stream", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const payload = 'event: status\ndata: {"step":"grid_search"}\n\nevent: done\ndata: {"ok":true}\n\n';
    fetchMock.mockResolvedValue(
      new Response(payload, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const res = await streamGet(new Request("http://localhost/api/ai/forecast/train/stream"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("grid_search");
    expect(text).toContain("done");
  });

  it("answers 200 with a terminal done event when the AI service is down", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockRejectedValue(new Error("down"));
    const res = await streamGet(new Request("http://localhost/api/ai/forecast/train/stream"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("AI_UNAVAILABLE");
  });
});

describe("GET /api/ai/forecast/artifacts/[runId]/dataset", () => {
  it("401 without a session, 403 for a cashier", async () => {
    mockSession.mockResolvedValue(null);
    const res = await datasetGet(
      new Request("http://localhost/api/ai/forecast/artifacts/run1/dataset"),
      { params: Promise.resolve({ runId: "run1" }) },
    );
    expect(res.status).toBe(401);
    mockSession.mockResolvedValue(CASHER);
    const res2 = await datasetGet(
      new Request("http://localhost/api/ai/forecast/artifacts/run1/dataset"),
      { params: Promise.resolve({ runId: "run1" }) },
    );
    expect(res2.status).toBe(403);
  });

  it("rejects a run id that is not a safe name", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const res = await datasetGet(
      new Request("http://localhost/api/ai/forecast/artifacts/bad%20id/dataset"),
      { params: Promise.resolve({ runId: "bad id" }) },
    );
    expect(res.status).toBe(400);
  });

  it("downloads the dataset as CSV", async () => {
    mockSession.mockResolvedValue(ADMIN);
    fetchMock.mockResolvedValue(
      new Response("branch_code,product_id\nYGN,p1\n", {
        status: 200,
        headers: {
          "content-type": "text/csv",
          "content-disposition": 'attachment; filename="dataset_prepared.csv"',
        },
      }),
    );
    const res = await datasetGet(
      new Request("http://localhost/api/ai/forecast/artifacts/run1/dataset"),
      { params: Promise.resolve({ runId: "run1" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(await res.text()).toContain("product_id");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/forecast/artifacts/run1/dataset");
  });
});
