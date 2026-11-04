"use client";
import { LocalizedSelect } from "@/components/ui/localized-select";

import { useEffect, useState } from "react";

import { downloadCsv } from "@/components/export-csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppDialog } from "@/components/ui/use-app-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface StaffUser {
  id: string;
  fullName: string;
  userName: string;
}

interface RosterRow {
  id: string;
  userId: string;
  userName: string | null;
  rosterDate: string;
  plannedStart: string;
  plannedEnd: string;
  counterName: string | null;
  source: "schedule" | "quick_add";
  scheduleName: string | null;
}

interface ScheduleRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  status: string;
}

interface AttendanceRow {
  rosterId: string;
  userName: string | null;
  date: string;
  planned: string;
  status: string;
  lateMinutes: number;
  sessions: number;
  workedMinutes: number;
}

interface ScheduleEntryDraft {
  userId: string;
  start: string;
  end: string;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function RosterAttendanceContent() {
  const { confirm, dialog } = useAppDialog();
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [rosters, setRosters] = useState<RosterRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [summary, setSummary] = useState({ present: 0, late: 0, absent: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Roster range filter (default today → +6 days).
  const [rangeFrom, setRangeFrom] = useState(() => isoDay(new Date()));
  const [rangeTo, setRangeTo] = useState(() => isoDay(new Date(Date.now() + 6 * 86_400_000)));

  // Quick add (single day override).
  const [qaUserId, setQaUserId] = useState("");
  const [qaDate, setQaDate] = useState(() => isoDay(new Date()));
  const [qaStart, setQaStart] = useState("09:00");
  const [qaEnd, setQaEnd] = useState("18:00");

  // New schedule form.
  const [schName, setSchName] = useState("");
  const [schStart, setSchStart] = useState(() => isoDay(new Date()));
  const [schEntries, setSchEntries] = useState<ScheduleEntryDraft[]>([{ userId: "", start: "09:00", end: "18:00" }]);
  const [schBusy, setSchBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [r, s, sc, a] = await Promise.all([
        fetch(`/api/admin/shift-rosters?from=${rangeFrom}&to=${rangeTo}`).then((x) => x.json()),
        fetch("/api/admin/staff?pageSize=100").then((x) => x.json()),
        fetch("/api/admin/roster-schedules").then((x) => x.json()),
        fetch(`/api/admin/reports/attendance?startDate=${rangeFrom}&endDate=${rangeTo}`).then((x) => x.json()),
      ]);
      if (!r.ok) throw new Error(r.error || "Failed to load");
      setRosters(r.rosters);
      if (s.ok) {
        setStaff(s.staff);
        if (!qaUserId && s.staff.length > 0) setQaUserId(s.staff[0].id);
      }
      if (sc.ok) setSchedules(sc.schedules);
      if (a.ok) {
        setAttendance(a.attendance);
        setSummary(a.summary);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeFrom, rangeTo]);

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/shift-rosters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: qaUserId,
        rosterDate: new Date(qaDate).toISOString(),
        plannedStart: qaStart,
        plannedEnd: qaEnd,
      }),
    });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Create failed");
    else void load();
  }

  async function removeRoster(id: string) {
    if (!(await confirm("Delete this quick-add entry?"))) return;
    const res = await fetch(`/api/admin/shift-rosters/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Delete failed");
    else void load();
  }

  function setSchEntry(i: number, patch: Partial<ScheduleEntryDraft>) {
    setSchEntries((es) => es.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  async function createSchedule(e: React.FormEvent) {
    e.preventDefault();
    setSchBusy(true);
    setError(null);
    try {
      const entries = schEntries
        .filter((x) => x.userId)
        .map((x) => ({ userId: x.userId, plannedStart: x.start, plannedEnd: x.end }));
      if (entries.length === 0) {
        setError("Add at least one staff entry");
        return;
      }
      const res = await fetch("/api/admin/roster-schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: schName, startDate: new Date(schStart).toISOString(), entries }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Create failed");
        return;
      }
      setSchName("");
      setSchEntries([{ userId: "", start: "09:00", end: "18:00" }]);
      void load();
    } finally {
      setSchBusy(false);
    }
  }

  async function deleteSchedule(id: string) {
    if (!(await confirm("Close this schedule? Past dates are kept; future dates stop applying."))) return;
    const res = await fetch(`/api/admin/roster-schedules/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) setError(data.error || "Delete failed");
    else void load();
  }

  return (
    <div className="grid gap-4">
      {dialog}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Attendance summary */}
      <Card>
        <CardHeader>
          <CardTitle>
            Attendance — present {summary.present} · late {summary.late} · absent {summary.absent}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Late (min)</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead>Worked (min)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendance.map((a) => (
                  <TableRow key={a.rosterId}>
                    <TableCell>{a.date}</TableCell>
                    <TableCell>{a.userName ?? "—"}</TableCell>
                    <TableCell>{a.planned}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === "present" ? "default" : a.status === "late" ? "secondary" : "destructive"}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{a.lateMinutes}</TableCell>
                    <TableCell>{a.sessions}</TableCell>
                    <TableCell>{a.workedMinutes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* New schedule */}
        <Card>
          <CardHeader>
            <CardTitle>New schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createSchedule} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sch-name">Name</Label>
                <Input id="sch-name" value={schName} onChange={(e) => setSchName(e.target.value)} required maxLength={150} placeholder="e.g. Nov team" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sch-start">Effective from</Label>
                <Input id="sch-start" type="date" value={schStart} onChange={(e) => setSchStart(e.target.value)} required />
              </div>
              <p className="text-xs text-muted-foreground">Applies every day from the start date until superseded or closed.</p>
              <div className="space-y-2">
                <Label>Staff entries</Label>
                {schEntries.map((x, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-md border p-2">
                    <LocalizedSelect
                      value={x.userId}
                      onChange={(e) => setSchEntry(i, { userId: e.target.value })}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      required
                    >
                      <option value="">— staff —</option>
                      {staff.map((u) => (
                        <option key={u.id} value={u.id}>{u.fullName}</option>
                      ))}
                    </LocalizedSelect>
                    <Input type="time" value={x.start} onChange={(e) => setSchEntry(i, { start: e.target.value })} className="w-28" required />
                    <Input type="time" value={x.end} onChange={(e) => setSchEntry(i, { end: e.target.value })} className="w-28" required />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSchEntries((es) => es.filter((_, j) => j !== i))}
                      disabled={schEntries.length === 1}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSchEntries((es) => [...es, { userId: "", start: "09:00", end: "18:00" }])}
                >
                  Add staff
                </Button>
              </div>
              <Button type="submit" disabled={schBusy}>{schBusy ? "Saving…" : "Create schedule"}</Button>
            </form>
          </CardContent>
        </Card>

        {/* Quick add */}
        <Card>
          <CardHeader>
            <CardTitle>Quick add (single day)</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={quickAdd} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="qa-user">Staff</Label>
                <LocalizedSelect id="qa-user" value={qaUserId} onChange={(e) => setQaUserId(e.target.value)} className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm" required>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName} ({u.userName})</option>
                  ))}
                </LocalizedSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="qa-date">Date</Label>
                <Input id="qa-date" type="date" value={qaDate} onChange={(e) => setQaDate(e.target.value)} required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="qa-start">Start</Label>
                  <Input id="qa-start" type="time" value={qaStart} onChange={(e) => setQaStart(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="qa-end">End</Label>
                  <Input id="qa-end" type="time" value={qaEnd} onChange={(e) => setQaEnd(e.target.value)} required />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Overrides the schedule for that staff member on that day.</p>
              <Button type="submit">Add to roster</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Schedules list */}
      <Card>
        <CardHeader>
          <CardTitle>Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && schedules.length === 0 && (
            <p className="text-sm text-muted-foreground">No schedules yet — create one above.</p>
          )}
          {!loading && schedules.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{new Date(s.startDate).toLocaleDateString()}</TableCell>
                    <TableCell>{s.endDate ? new Date(s.endDate).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : s.status === "upcoming" ? "secondary" : "outline"}>
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.status !== "ended" && (
                        <Button size="sm" variant="destructive" onClick={() => void deleteSchedule(s.id)}>
                          Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Planned roster (expanded) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Planned roster</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="range-from" className="text-xs">From</Label>
                <Input id="range-from" type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="h-8 w-36 text-xs" />
              </div>
              <div className="flex items-center gap-1">
                <Label htmlFor="range-to" className="text-xs">To</Label>
                <Input id="range-to" type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="h-8 w-36 text-xs" />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    "roster",
                    ["date", "staff", "planned", "source", "schedule"],
                    rosters.map((r) => [r.rosterDate, r.userName, `${r.plannedStart}–${r.plannedEnd}`, r.source, r.scheduleName ?? ""]),
                  )
                }
              >
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!loading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Planned</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Counter</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rosters.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.rosterDate).toLocaleDateString()}</TableCell>
                    <TableCell>{r.userName ?? "—"}</TableCell>
                    <TableCell>{r.plannedStart}–{r.plannedEnd}</TableCell>
                    <TableCell>
                      {r.source === "schedule" ? (
                        <Badge variant="secondary">{r.scheduleName ?? "schedule"}</Badge>
                      ) : (
                        <Badge variant="outline">quick add</Badge>
                      )}
                    </TableCell>
                    <TableCell>{r.counterName ?? "—"}</TableCell>
                    <TableCell>
                      {r.source === "quick_add" && (
                        <Button size="sm" variant="destructive" onClick={() => void removeRoster(r.id)}>
                          Delete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
