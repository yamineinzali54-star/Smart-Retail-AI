"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiAddLine, RiSaveLine } from "@remixicon/react";
import { useAppDialog } from "@/components/ui/use-app-dialog";

export default function TelegramSetupPage() {
  const { alert: showAlert, dialog } = useAppDialog();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linkCode, setLinkCode] = useState("");
  const [chatId, setChatId] = useState("");
  const [, setIsLinked] = useState(false);

  useEffect(() => {
    fetchLinkCode();
  }, []);

  async function fetchLinkCode() {
    try {
      const res = await fetch("/api/settings/notifications/link-code");
      const data = await res.json();
      if (data.ok) {
        setLinkCode(data.linkCode);
      }
    } catch (error) {
      console.error("Failed to fetch link code:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notifications/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });

      const data = await res.json();
      if (data.ok) {
        setIsLinked(true);
        await showAlert("Telegram linked successfully");
        router.push("/settings/notifications");
      } else {
        await showAlert(data.error || "Failed to link Telegram");
      }
    } catch (error) {
      console.error("Failed to link Telegram:", error);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {dialog}
      <div>
        <h1 className="text-2xl font-bold">Link Telegram</h1>
        <p className="text-muted-foreground">
          Connect your Telegram account to receive notifications
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1: Get Link Code</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Send this code to the SmartRetailAI Telegram bot to link your account:
          </p>
          <div className="flex items-center gap-4">
            <code className="text-lg font-mono bg-muted px-4 py-2 rounded-lg">
              {linkCode}
            </code>
            <Button variant="outline" onClick={fetchLinkCode}>
              <RiAddLine className="h-4 w-4 mr-2" />
              Refresh Code
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2: Enter Chat ID</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="chatId">Telegram Chat ID</Label>
              <Input
                id="chatId"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="Enter your Telegram chat ID"
                required
              />
              <p className="text-xs text-muted-foreground">
                You can get your chat ID by messaging @userinfobot on Telegram
              </p>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                <RiSaveLine className="h-4 w-4 mr-2" />
                {saving ? "Saving..." : "Link Telegram"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
