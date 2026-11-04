// Fast, DB-free: auth-aware fetch wrapper (single refresh + single retry).
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithAuth } from "@/lib/api-client";

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithAuth", () => {
  it("passes through non-401 responses without refreshing", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithAuth("/api/stock");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes once and retries the original request on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => jsonResponse(401))
      .mockImplementationOnce(async (url: string) => {
        expect(url).toContain("/api/auth/refresh");
        return jsonResponse(200, { ok: true, refreshed: true });
      })
      .mockImplementationOnce(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithAuth("/api/stock");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns the original 401 when refresh fails", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/api/auth/refresh")
        ? jsonResponse(401, { ok: false })
        : jsonResponse(401, { ok: false, error: "UNAUTHENTICATED" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithAuth("/api/stock");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "UNAUTHENTICATED" });
  });

  it("never loops the refresh endpoint through itself", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWithAuth("/api/auth/refresh", { method: "POST" });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
