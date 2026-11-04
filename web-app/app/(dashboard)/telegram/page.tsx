"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Language = "my" | "en" | "both";

const LANGUAGE_LABELS: Record<Language, string> = {
  my: "မြန်မာ only",
  en: "English only",
  both: "မြန်မာ + English (recommended for groups)",
};

export default function TelegramSettingsPage() {
  const [enabled, setEnabled] = useState(true);
  const [language, setLanguage] = useState<Language>("both");
  const [configured, setConfigured] = useState(false);
  const [chatPreview, setChatPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings/telegram");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setEnabled(data.telegram.enabled);
      setLanguage(data.telegram.language);
      setConfigured(data.telegram.configured);
      setChatPreview(data.telegram.chatIdPreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, []);

  async function save() {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings/telegram", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, language }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Save failed");
      setNotice("Saved. New alerts use these settings immediately.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings/telegram/test", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(
          data.error === "TELEGRAM_NOT_CONFIGURED"
            ? "Bot token or group chat ID is missing on the server (.env.local)."
            : `Test message failed (${data.error}). Check the group + bot membership.`,
        );
      }
      setNotice("Test message sent — check the Telegram group.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <PageShell
      title="Telegram Alerts"
      subtitle="Group notifications for stock, expiry and cash alerts — admin only"
      allow={["admin"]}
    >
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Group notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-green-700">{notice}</p>}

          {!loading && (
            <>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">Enabled</p>
                  <p className="text-sm text-muted-foreground">
                    Off = in-app notifications only, nothing leaves the server.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-5 w-5"
                  aria-label="Enable Telegram notifications"
                />
              </div>

              <div className="space-y-2">
                <p className="font-medium">Message language</p>
                <LocalizedSelect
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                >
                  {(Object.keys(LANGUAGE_LABELS) as Language[]).map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </LocalizedSelect>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Bot + group:</span>
                {configured ? (
                  <Badge variant="default">connected{chatPreview ? ` (${chatPreview})` : ""}</Badge>
                ) : (
                  <Badge variant="destructive">not configured — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID</Badge>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button variant="outline" onClick={() => void sendTest()} disabled={testing || !configured}>
                  {testing ? "Sending…" : "Send test message"}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Covers low-stock, expiry (daily 8 AM scan) and cash-discrepancy (session close)
                alerts for your branch. Changes are audit-logged.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
