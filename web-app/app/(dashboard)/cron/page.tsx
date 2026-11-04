"use client";

import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppDialog } from "@/components/ui/use-app-dialog";

interface CronJob {
  jobid: number;
  schedule: string;
  command: string;
  database: string;
  active: boolean;
}

interface InternalJob {
  name: string;
  hourUtc: number;
  minuteUtc: number;
  label: string;
}

interface CronStatus {
  internal: {
    enabled: boolean;
    note: string;
    jobs: InternalJob[];
  };
  pgCron: {
    available: boolean;
    jobs: CronJob[];
    note?: string;
  };
}

function scheduleToMyanmar(schedule: string): string {
  const parts = schedule.split(" ");
  if (parts.length < 2) return schedule;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) return schedule;

  // Myanmar is UTC+6:30
  const utcMinutes = hour * 60 + minute;
  const myanmarMinutes = utcMinutes + 390; // 6h30m = 390 minutes
  const normalized = ((myanmarMinutes % 1440) + 1440) % 1440;
  const mmHour = Math.floor(normalized / 60);
  const mmMinute = normalized % 60;
  const period = mmHour >= 12 ? "PM" : "AM";
  const displayHour = mmHour > 12 ? mmHour - 12 : mmHour === 0 ? 12 : mmHour;
  return `${displayHour}:${String(mmMinute).padStart(2, "0")} ${period} MMT`;
}

export default function CronManagementPage() {
  const { confirm, dialog } = useAppDialog();
  const [status, setStatus] = useState<CronStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cron");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setStatus({ internal: data.internal, pgCron: data.pgCron });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  async function runNow(jobId: number) {
    setMessage(null);
    const res = await fetch("/api/admin/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: String(jobId) }),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Run failed");
    else setMessage(`Job ${jobId} triggered`);
  }

  async function unschedule(jobId: number) {
    if (!(await confirm(`Unschedule job ${jobId}?`))) return;
    setMessage(null);
    const res = await fetch("/api/admin/cron", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: String(jobId) }),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Unschedule failed");
    else {
      setMessage(`Job ${jobId} unscheduled`);
      void load();
    }
  }

  async function runScanNow() {
    setMessage(null);
    const res = await fetch("/api/admin/notifications/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!data.ok) setMessage(data.error || "Scan failed");
    else {
      setMessage(
        `Scan done: ${data.lowStock ?? 0} low-stock, ${data.expired ?? 0} expired, ` +
          `${data.expiringSoon ?? 0} expiring soon.`,
      );
    }
  }

  return (
    <PageShell title="Cron Jobs" subtitle="Schedulers — internal (primary) + pg_cron (self-hosted Postgres only)" allow={["admin"]}>
      {dialog}
      <div className="max-w-4xl space-y-4">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && status && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Internal scheduler</CardTitle>
                  {status.internal.enabled ? (
                    <Badge variant="default">enabled</Badge>
                  ) : (
                    <Badge variant="secondary">disabled</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{status.internal.note}</p>
                {status.internal.jobs.map((j) => (
                  <div key={j.name} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span className="font-medium">{j.name}</span>
                    <span className="text-muted-foreground">{j.label}</span>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => void runScanNow()}>
                  Run alert scan now
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>pg_cron (database level)</CardTitle>
                  {status.pgCron.available ? (
                    <Badge variant="default">available</Badge>
                  ) : (
                    <Badge variant="secondary">unavailable</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!status.pgCron.available ? (
                  <p className="text-sm text-muted-foreground">{status.pgCron.note}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead>Command</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {status.pgCron.jobs.map((j) => (
                        <TableRow key={j.jobid}>
                          <TableCell>{j.jobid}</TableCell>
                          <TableCell>
                            <code className="text-xs">{j.schedule}</code>
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({scheduleToMyanmar(j.schedule)})
                            </span>
                          </TableCell>
                          <TableCell>
                            {j.active ? (
                              <Badge variant="default">active</Badge>
                            ) : (
                              <Badge variant="secondary">inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-md truncate">
                            <code className="text-xs">{j.command.slice(0, 80)}…</code>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => void runNow(j.jobid)}>
                                Run now
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => void unschedule(j.jobid)}>
                                Remove
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
    </PageShell>
  );
}
