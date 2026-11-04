import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/telegram.ts pulls the db chain via lib/app-settings — stub settings and
// use a dummy DATABASE_URL (same pattern as backup.test.ts; never queried).
process.env.DATABASE_URL ??= "postgresql://telegram-test:telegram-test@localhost:1/telegram_test";

vi.mock("@/lib/app-settings", () => ({
  getTelegramSettings: vi.fn(),
}));

const { getTelegramSettings } = await import("@/lib/app-settings");
const {
  escapeHtml,
  formatTelegramMessage,
  notifyTelegram,
  sendTelegramMessage,
} = await import("@/lib/telegram");

const mockSettings = vi.mocked(getTelegramSettings);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  mockSettings.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("formatTelegramMessage", () => {
  const base = { branchCode: "YGN", branchName: "Main Branch" };

  it("renders my-only and en-only variants", () => {
    const my = formatTelegramMessage("low_stock", { ...base, lowStockCount: 5 }, "my");
    expect(my).toContain("5");
    expect(my).toContain("ပြတ်လပ်မှု");
    expect(my).not.toContain("Low stock alert");

    const en = formatTelegramMessage("low_stock", { ...base, lowStockCount: 5 }, "en");
    expect(en).toContain("Low stock alert");
    expect(en).not.toContain("ပြတ်လပ်မှု");
  });

  it("renders both languages for 'both'", () => {
    const text = formatTelegramMessage(
      "expiry",
      { ...base, expiredCount: 2, expiringSoonCount: 3, daysThreshold: 30 },
      "both",
    );
    expect(text).toContain("Expiry alert");
    expect(text).toContain("သက်တမ်းကုန်");
  });

  it("escapes HTML in branch names and amounts", () => {
    const text = formatTelegramMessage(
      "cash_discrepancy",
      {
        branchCode: "YGN",
        branchName: "<b>Main</b>",
        difference: "<100>",
        threshold: "1000",
      },
      "en",
    );
    expect(text).toContain("&lt;b&gt;Main&lt;/b&gt;");
    expect(text).toContain("&lt;100&gt;");
    expect(text).not.toContain("<b>Main</b>");
  });

  it("formats the test message", () => {
    const text = formatTelegramMessage("test", base, "both");
    expect(text).toContain("Telegram");
  });
});

describe("escapeHtml", () => {
  it("escapes & < >", () => {
    expect(escapeHtml("a&b<c>d")).toBe("a&amp;b&lt;c&gt;d");
  });
});

describe("sendTelegramMessage", () => {
  it("fails closed without env config and never calls fetch", async () => {
    const res = await sendTelegramMessage("hi");
    expect(res).toEqual({ ok: false, error: "TELEGRAM_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts chat_id + HTML parse_mode on success", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tok123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-1001");
    fetchMock.mockResolvedValue({ ok: true });
    const res = await sendTelegramMessage("hello");
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bottok123/sendMessage");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ chat_id: "-1001", text: "hello", parse_mode: "HTML" });
  });

  it("never throws on network failure", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tok123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-1001");
    fetchMock.mockRejectedValue(new Error("down"));
    const res = await sendTelegramMessage("hello");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("TELEGRAM_SEND_ERROR");
  });

  it("retries once on 500 then succeeds", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tok123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-1001");
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({ ok: true });
    const res = await sendTelegramMessage("hello");
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tok123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-1001");
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => "bad" });
    const res = await sendTelegramMessage("hello");
    expect(res).toEqual({ ok: false, error: "TELEGRAM_SEND_FAILED_400" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("notifyTelegram", () => {
  const payload = { branchCode: "YGN", branchName: "Main", lowStockCount: 3 };

  it("sends nothing when disabled", async () => {
    mockSettings.mockResolvedValue({ enabled: false, language: "both" });
    await notifyTelegram("low_stock", payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends in the configured language when enabled", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "tok123");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-1001");
    mockSettings.mockResolvedValue({ enabled: true, language: "my" });
    fetchMock.mockResolvedValue({ ok: true });
    await notifyTelegram("low_stock", payload);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain("ပြတ်လပ်မှု");
    expect(body.text).not.toContain("Low stock alert");
  });

  it("never throws even when settings lookup fails", async () => {
    mockSettings.mockRejectedValue(new Error("db down"));
    await expect(notifyTelegram("low_stock", payload)).resolves.toBeUndefined();
  });
});
