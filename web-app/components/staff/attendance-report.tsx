"use client";

import { useEffect, useState } from "react";

import { downloadCsv } from "@/components/export-csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface AttendanceRow {
  rosterId: string;
  userId: string;
  userName: string | null;
  date: string;
  planned: string;
  status: "present" | "late" | "absent";
  lateMinutes: number;
  sessions: number;
  workedMinutes: number;
  firstIn: string | null;
}

const STATUS_VARIANT: Record<AttendanceRow["status"], "default" | "secondary" | "destructive"> = {
  present: "default",
  late: "secondary",
  absent: "destructive",
};

export function AttendanceReportContent() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [summary, setSummary] = useState({ present: 0, late: 0, absent: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (start) params.set("startDate", new Date(start).toISOString());
      if (end) params.set("endDate", new Date(end).toISOString());
      const res = await fetch(`/api/admin/reports/attendance?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load");
      setRows(data.attendance);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Present</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{summary.present}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Late</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{summary.late}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Absent</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-destructive">{summary.absent}</p></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Shifts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="max-w-48" aria-label="Start date" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="max-w-48" aria-label="End date" />
            <Button variant="outline" onClick={() => void load()}>Filter</Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(
                  "attendance",
                  ["staff", "date", "planned", "status", "late_minutes", "sessions", "worked_minutes"],
                  rows.map((r) => [r.userName ?? r.userId, r.date, r.planned, r.status, r.lateMinutes, r.sessions, r.workedMinutes]),
                )
              }
            >
              Export CSV
            </Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Late (min)</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead>Worked (min)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.rosterId}>
                    <TableCell>{r.userName ?? r.userId}</TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{r.planned}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.lateMinutes}</TableCell>
                    <TableCell>{r.sessions}</TableCell>
                    <TableCell>{r.workedMinutes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No roster entries in this range — add a planned shift from the Roster & Attendance tab.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
