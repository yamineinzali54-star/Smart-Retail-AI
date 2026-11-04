"use client";

import { useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppDialog } from "@/components/ui/use-app-dialog";

export default function BackupPage() {
  const { confirm, dialog } = useAppDialog();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/backup");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setMessage(data?.error || "Export failed");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `smartretail-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setMessage("Backup downloaded. Store it off-platform (S3/object storage).");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!restoreFile) {
      setRestoreMessage("Select a backup file first");
      return;
    }
    if (!(await confirm("WARNING: This will overwrite all existing data. Continue?"))) return;

    setRestoreBusy(true);
    setRestoreMessage(null);
    try {
      const text = await restoreFile.text();
      const backup = JSON.parse(text);
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tables: backup.tables, confirm: true }),
      });
      const data = await res.json();
      if (!data.ok) {
        setRestoreMessage(data.error || "Restore failed");
        return;
      }
      const total = Object.values(data.restored as Record<string, number>).reduce(
        (s: number, n: number) => s + n,
        0,
      );
      setRestoreMessage(`Restored ${total} rows successfully.`);
    } catch (e) {
      setRestoreMessage(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <PageShell title="Backup" subtitle="Off-platform JSON snapshot — every export is audit-logged" allow={["admin"]}>
      {dialog}
      <div className="grid max-w-xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Exports every table as JSON. Schedule this export nightly via cron/CI.
            </p>
            <Button onClick={() => void download()} disabled={busy}>
              {busy ? "Exporting…" : "Download full backup"}
            </Button>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Restore</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-red-600">
              WARNING: Restore overwrites all existing data. Use only for disaster recovery.
            </p>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <Button onClick={() => void restore()} disabled={restoreBusy || !restoreFile} variant="destructive">
              {restoreBusy ? "Restoring…" : "Restore from backup"}
            </Button>
            {restoreMessage && <p className="text-sm text-muted-foreground">{restoreMessage}</p>}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
