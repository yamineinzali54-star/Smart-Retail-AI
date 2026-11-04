"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiTelegramLine, RiNotificationLine, RiLinkUnlink, RiSaveLine } from "@remixicon/react";
import { useAppDialog } from "@/components/ui/use-app-dialog";

interface NotificationSettings {
  telegramEnabled: boolean;
  telegramChatId: string | null;
  lowStockAlerts: boolean;
  expiryAlerts: boolean;
  cashDiscrepancyAlerts: boolean;
}

export default function NotificationsPage() {
  const { alert: showAlert, dialog } = useAppDialog();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>({
    telegramEnabled: false,
    telegramChatId: null,
    lowStockAlerts: true,
    expiryAlerts: true,
    cashDiscrepancyAlerts: true,
  });
  const [linkCode, setLinkCode] = useState("");

  async function fetchSettings() {
    try {
      const res = await fetch("/api/settings/notifications");
      const data = await res.json();
      if (data.ok) {
        setSettings(data.settings);
      }
    } catch (error) {
      console.error("Failed to fetch notification settings:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => fetchSettings());
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.ok) {
        await showAlert("Notification settings saved successfully");
      } else {
        await showAlert(data.error || "Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save notification settings:", error);
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateLinkCode() {
    try {
      const res = await fetch("/api/settings/notifications/link-code");
      const data = await res.json();
      if (data.ok) {
        setLinkCode(data.linkCode);
      }
    } catch (error) {
      console.error("Failed to generate link code:", error);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {dialog}
      <div>
        <h1 className="text-2xl font-bold">Notification Settings</h1>
        <p className="text-muted-foreground">Configure how you receive alerts and notifications</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RiTelegramLine className="h-5 w-5" />
            Telegram Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable Telegram Notifications</p>
              <p className="text-sm text-muted-foreground">
                Receive alerts via Telegram bot
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.telegramEnabled}
              onChange={(e) => setSettings({ ...settings, telegramEnabled: e.target.checked })}
              className="h-5 w-5"
            />
          </div>

          {settings.telegramEnabled && (
            <div className="space-y-4 p-4 bg-muted rounded-lg">
              <div>
                <p className="font-medium">Telegram Chat ID</p>
                <p className="text-sm text-muted-foreground">
                  {settings.telegramChatId || "Not configured"}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <Button variant="outline" onClick={handleGenerateLinkCode}>
                  <RiLinkUnlink className="h-4 w-4 mr-2" />
                  Generate Link Code
                </Button>
                {linkCode && (
                  <div className="flex items-center gap-2">
                    <code className="bg-background px-3 py-1 rounded text-sm">
                      {linkCode}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      Send this code to the bot
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RiNotificationLine className="h-5 w-5" />
            Alert Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Low Stock Alerts</p>
              <p className="text-sm text-muted-foreground">
                Get notified when products are running low
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.lowStockAlerts}
              onChange={(e) => setSettings({ ...settings, lowStockAlerts: e.target.checked })}
              className="h-5 w-5"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Expiry Alerts</p>
              <p className="text-sm text-muted-foreground">
                Get notified about products nearing expiration
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.expiryAlerts}
              onChange={(e) => setSettings({ ...settings, expiryAlerts: e.target.checked })}
              className="h-5 w-5"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Cash Discrepancy Alerts</p>
              <p className="text-sm text-muted-foreground">
                Get notified about cash register discrepancies
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.cashDiscrepancyAlerts}
              onChange={(e) => setSettings({ ...settings, cashDiscrepancyAlerts: e.target.checked })}
              className="h-5 w-5"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <RiSaveLine className="h-4 w-4 mr-2" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
