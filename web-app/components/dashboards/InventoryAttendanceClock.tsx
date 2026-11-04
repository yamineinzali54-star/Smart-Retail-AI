"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n, translateDisplayText } from "@/lib/i18n";

interface Attendance {
  id: string;
  clockInAt: string;
}

export function InventoryAttendanceClock() {
  const { locale } = useI18n();
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const response = await fetch("/api/inventory/attendance");
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Failed to load attendance");
      setAttendance(data.attendance);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, []);

  async function toggleAttendance() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/inventory/attendance", {
        method: attendance ? "DELETE" : "POST",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Attendance update failed");
      setAttendance(attendance ? null : data.attendance);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Attendance update failed");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const localize = (value: string) => translateDisplayText(locale, value);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{localize("Attendance")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground" aria-live="polite">
          {loading
            ? localize("Loading attendance…")
            : attendance
              ? `${localize("Started at")} ${new Date(attendance.clockInAt).toLocaleTimeString()}`
              : localize("Attendance not started")}
          {error ? <p className="mt-1 text-destructive">{localize(error)}</p> : null}
        </div>
        <Button onClick={() => void toggleAttendance()} disabled={loading || busy}>
          {busy
            ? localize("Please wait…")
            : attendance
              ? localize("End attendance")
              : localize("Start attendance")}
        </Button>
      </CardContent>
    </Card>
  );
}
