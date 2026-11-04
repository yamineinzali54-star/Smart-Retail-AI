"use client";

import { use, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LogDetail {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  description: string | null;
  oldValues: unknown;
  newValues: unknown;
  userName: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export default function AuditLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [log, setLog] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/audit-logs/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load");
        setLog(data.log);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <PageShell title="Audit entry" allow={["admin"]}>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {log && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {log.entityType} · {log.action}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Entity ID: <code className="text-xs">{log.entityId}</code></p>
              <p>User: {log.userName ?? "—"} · IP: {log.ipAddress ?? "—"}</p>
              <p>At: {new Date(log.createdAt).toLocaleString()}</p>
              <p>{log.description ?? ""}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Values</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm font-medium">Old</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(log.oldValues, null, 2)}</pre>
              </div>
              <div>
                <p className="text-sm font-medium">New</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(log.newValues, null, 2)}</pre>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
