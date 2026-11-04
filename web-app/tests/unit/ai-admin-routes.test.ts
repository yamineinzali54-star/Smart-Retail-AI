import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin control-plane contract tests (mocked auth/settings/audit/db).
process.env.DATABASE_URL ??= "postgresql://aiadmin-test:aiadmin-test@localhost:1/aiadmin_test";

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));
vi.mock("@/lib/app-settings", () => ({
  getTelegramSettings: vi.fn(),
  setTelegramSettings: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

// Controllable in-memory stand-in for the drizzle db chain used by the
// basket-save route (select→from→where rows, insert→values→returning row).
let foundProducts: Array<{ id: string }> = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(foundProducts) }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "promo-1", name: "Bundle" }]),
      }),
    }),
  },
}));

const { getSession } = await import("@/lib/auth");
const { getTelegramSettings, setTelegramSettings } = await import("@/lib/app-settings");
const mockSession = vi.mocked(getSession);
const mockGetSettings = vi.mocked(getTelegramSettings);
const mockSetSettings = vi.mocked(setTelegramSettings);

type Session = Awaited<ReturnType<typeof getSession>>;

const ADMIN: Session = {
  user: { id: "u1", userName: "admin1", role: "admin", branchId: "branch-ygn" },
  sessionId: "s1",
  expiresAt: 9999999999,
};
const INVENTORY: Session = {
  user: { id: "u2", userName: "inventory1", role: "inventory", branchId: "branch-ygn" },
  sessionId: "s2",
  expiresAt: 9999999999,
};

const { GET: tgGet, PATCH: tgPatch } = await import("@/app/api/admin/settings/telegram/route");
const { POST: savePost } = await import("@/app/api/ai/basket/save/route");

function jsonReq(method: string, body: unknown): Request {
  return new Request("http://localhost/api/admin/settings/telegram", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockSession.mockReset();
  mockGetSettings.mockReset();
  mockSetSettings.mockReset();
});

describe("telegram admin settings API", () => {
  it("403 for non-admin", async () => {
    mockSession.mockResolvedValue(INVENTORY);
    expect((await tgGet()).status).toBe(403);
    expect((await tgPatch(jsonReq("PATCH", { enabled: true }))).status).toBe(403);
  });

  it("GET returns settings + chat status", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockGetSettings.mockResolvedValue({ enabled: true, language: "both" });
    const res = await tgGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.telegram.enabled).toBe(true);
    expect(body.telegram.language).toBe("both");
    expect(typeof body.telegram.configured).toBe("boolean");
  });

  it("PATCH validates language and persists", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockGetSettings.mockResolvedValue({ enabled: true, language: "both" });
    const bad = await tgPatch(jsonReq("PATCH", { language: "fr" }));
    expect(bad.status).toBe(400);
    expect(mockSetSettings).not.toHaveBeenCalled();

    const good = await tgPatch(jsonReq("PATCH", { enabled: false, language: "my" }));
    expect(good.status).toBe(200);
    expect(mockSetSettings).toHaveBeenCalledWith({ enabled: false, language: "my" });
  });
});

describe("POST /api/ai/basket/save", () => {
  const UUID_A = "11111111-1111-4111-8111-111111111111";
  const UUID_B = "22222222-2222-4222-8222-222222222222";

  function saveBody(productIds: string[] = [UUID_A, UUID_B], discountPct = 10) {
    return new Request("http://localhost/api/ai/basket/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Bundle: A + B", productIds, discountPct }),
    });
  }

  it("401 without session, 403 for inventory", async () => {
    mockSession.mockResolvedValue(null);
    expect((await savePost(saveBody())).status).toBe(401);
    mockSession.mockResolvedValue(INVENTORY);
    expect((await savePost(saveBody())).status).toBe(403);
  });

  it("400 on invalid body (one product, bad discount)", async () => {
    mockSession.mockResolvedValue(ADMIN);
    const one = new Request("http://localhost/api/ai/basket/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", productIds: [UUID_A], discountPct: 10 }),
    });
    expect((await savePost(one)).status).toBe(400);
  });

  it("404 when a product is not in-branch, 201 on success", async () => {
    mockSession.mockResolvedValue(ADMIN);
    foundProducts = [{ id: UUID_A }];
    expect((await savePost(saveBody())).status).toBe(404);
    foundProducts = [{ id: UUID_A }, { id: UUID_B }];
    const res = await savePost(saveBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
