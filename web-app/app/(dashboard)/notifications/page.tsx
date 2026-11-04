"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  channel: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const [rows, setRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (unreadOnly) params.set("unreadOnly", "true");
      const res = await fetch(`/api/notifications?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.notifications);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function markRead(ids: string[]) {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (data.ok) void load();
  }

  async function markAllRead() {
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [], all: true }),
    });
    const data = await res.json();
    if (data.ok) void load();
  }

  return (
    <PageShell title="Notifications" subtitle="Alerts for your branch — scan, cash, sync">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Inbox</CardTitle>
            <div className="flex gap-2">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                />
                Unread only
              </label>
              <Button variant="outline" size="sm" onClick={() => void load()}>Refresh</Button>
              <Button variant="outline" size="sm" onClick={() => void markAllRead()}>
                Mark all read
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No notifications.</p>
          )}
          {rows.map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between rounded-md border p-3 ${n.isRead ? "opacity-60" : ""}`}
            >
              <div>
                <p className="text-sm font-medium">
                  {n.title} <Badge variant="secondary">{n.type}</Badge>
                </p>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString()} · {n.channel}
                </p>
              </div>
              {!n.isRead && (
                <Button size="sm" variant="ghost" onClick={() => void markRead([n.id])}>
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </PageShell>
  );
}
