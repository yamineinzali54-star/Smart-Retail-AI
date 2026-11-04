"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export default function AlertScanButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function scan() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/notifications/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ daysThreshold: 30 }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(data.error || "Scan failed");
        return;
      }
      setMessage(
        `Low: ${data.lowStock} · expired: ${data.expired} · soon: ${data.expiringSoon}` +
          (data.notified.length > 0 ? ` · notified: ${data.notified.join(", ")}` : " · already notified today"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={() => void scan()} disabled={busy}>
        {busy ? "Scanning…" : "Run alert scan"}
      </Button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
