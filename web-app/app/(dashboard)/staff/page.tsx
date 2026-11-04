"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { PageShell } from "@/components/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AttendanceReportContent } from "@/components/staff/attendance-report"
import { RosterAttendanceContent } from "@/components/staff/roster-attendance"
import { useI18n, translateDisplayText } from "@/lib/i18n"

interface StaffUser {
  id: string
  userName: string
  fullName: string
  role: string
  isActive: boolean
}

interface BranchOption {
  id: string
  code: string
  name: string
}

export default function StaffPage() {
  const { locale } = useI18n()
  const [rows, setRows] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [allBranches, setAllBranches] = useState<BranchOption[]>([])
  const [editingGrants, setEditingGrants] = useState<string | null>(null)
  const [grantIds, setGrantIds] = useState<string[]>([])
  const [grantMsg, setGrantMsg] = useState<string | null>(null)
  const [pinUser, setPinUser] = useState<StaffUser | null>(null)
  const [pinValue, setPinValue] = useState("")
  const [pinSaving, setPinSaving] = useState(false)
  const [clearPinUser, setClearPinUser] = useState<StaffUser | null>(null)
  const [clearPinSaving, setClearPinSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/staff?pageSize=100")
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || "Failed to load")
      setRows(data.staff)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load())
    fetch("/api/admin/branches?pageSize=100")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setAllBranches(data.branches)
      })
      .catch(() => undefined)
  }, [])

  async function openGrants(userId: string) {
    setGrantMsg(null)
    setEditingGrants(userId)
    try {
      const res = await fetch(`/api/admin/staff/${userId}/branches`)
      const data = await res.json()
      if (data.ok)
        setGrantIds(data.branches.map((b: { branchId: string }) => b.branchId))
    } catch {
      // Editor still works — save writes the full set.
    }
  }

  async function saveGrants(userId: string) {
    setGrantMsg(null)
    const res = await fetch(`/api/admin/staff/${userId}/branches`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branchIds: grantIds }),
    })
    const data = await res.json()
    if (!data.ok) {
      setGrantMsg(data.error || "Save failed")
      return
    }
    setGrantMsg("Saved")
    setEditingGrants(null)
  }

  function openPinDialog(u: StaffUser) {
    setError(null)
    setPinValue("")
    setPinUser(u)
  }

  async function setPin() {
    if (!pinUser) return
    const value = pinValue.trim()
    if (!/^\d{4,6}$/.test(value)) {
      setError("PIN must be 4–6 digits")
      return
    }
    setPinSaving(true)
    const res = await fetch(`/api/admin/staff/${pinUser.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: value }),
    })
    const data = await res.json()
    setPinSaving(false)
    if (!data.ok) setError(data.error || "PIN update failed")
    else {
      setError(null)
      setPinUser(null)
      void load()
    }
  }

  async function clearPin(u: StaffUser) {
    setClearPinSaving(true)
    const res = await fetch(`/api/admin/staff/${u.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: null }),
    })
    const data = await res.json()
    setClearPinSaving(false)
    if (!data.ok) {
      setError(data.error || "PIN update failed")
    } else {
      setClearPinUser(null)
      void load()
    }
  }

  async function toggleActive(u: StaffUser) {
    const res = await fetch(`/api/admin/staff/${u.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    })
    const data = await res.json()
    if (!data.ok) setError(data.error || "Update failed")
    else void load()
  }

  return (
    <PageShell
      title="Staff"
      subtitle="Admin-only user management"
      allow={["admin"]}
      actions={
        <Link href="/staff/new">
          <Button>New staff</Button>
        </Link>
      }
    >
      <Tabs defaultValue="staff" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="staff">
            {translateDisplayText(locale, "Staff")}
          </TabsTrigger>
          <TabsTrigger value="roster">
            {translateDisplayText(locale, "Roster & Attendance")}
          </TabsTrigger>
          <TabsTrigger value="report">
            {translateDisplayText(locale, "Attendance Report")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All staff</CardTitle>
            </CardHeader>
            <CardContent>
              {loading && (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              {!loading && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Full name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.userName}</TableCell>
                        <TableCell>{u.fullName}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{u.role}</Badge>
                        </TableCell>
                        <TableCell>
                          {u.isActive ? (
                            <Badge variant="default">active</Badge>
                          ) : (
                            <Badge variant="destructive">inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void toggleActive(u)}
                            >
                              {u.isActive ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void openGrants(u.id)}
                            >
                              Branches
                            </Button>
                            {u.role === "cashier" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openPinDialog(u)}
                                >
                                  Set PIN
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setClearPinUser(u)}
                                >
                                  Clear PIN
                                </Button>
                              </>
                            )}
                          </div>
                          {editingGrants === u.id && (
                            <div className="mt-2 space-y-1 rounded-md border p-2">
                              {allBranches.map((b) => (
                                <label
                                  key={b.id}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <input
                                    type="checkbox"
                                    checked={grantIds.includes(b.id)}
                                    onChange={(e) =>
                                      setGrantIds((g) =>
                                        e.target.checked
                                          ? [...g, b.id]
                                          : g.filter((x) => x !== b.id)
                                      )
                                    }
                                  />
                                  {b.code} — {b.name}
                                </label>
                              ))}
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  onClick={() => void saveGrants(u.id)}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingGrants(null)}
                                >
                                  X
                                </Button>
                              </div>
                              {grantMsg && (
                                <p className="text-xs text-muted-foreground">
                                  {grantMsg}
                                </p>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Dialog
            open={pinUser !== null}
            onOpenChange={(open) => {
              if (!open && !pinSaving) setPinUser(null)
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Set cashier PIN</DialogTitle>
                <DialogDescription>
                  Set a 4–6 digit PIN for {pinUser?.userName ?? "this cashier"}.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label htmlFor="staff-pin" className="text-sm font-medium">
                  Cashier PIN
                </label>
                <Input
                  id="staff-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pinValue}
                  onChange={(e) =>
                    setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="4–6 digits"
                  minLength={4}
                  maxLength={6}
                  autoFocus
                  disabled={pinSaving}
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setPinUser(null)}
                  disabled={pinSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void setPin()}
                  disabled={pinSaving || pinValue.length < 4}
                >
                  {pinSaving ? "Saving…" : "Save PIN"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={clearPinUser !== null}
            onOpenChange={(open) => {
              if (!open && !clearPinSaving) setClearPinUser(null)
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear cashier PIN</DialogTitle>
                <DialogDescription>
                  Remove the PIN assigned to{" "}
                  {clearPinUser?.userName ?? "this cashier"}?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => setClearPinUser(null)}
                  disabled={clearPinSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => clearPinUser && void clearPin(clearPinUser)}
                  disabled={clearPinSaving}
                >
                  {clearPinSaving ? "Clearing…" : "Clear PIN"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
        <TabsContent value="roster" className="mt-4">
          <RosterAttendanceContent />
        </TabsContent>
        <TabsContent value="report" className="mt-4">
          <AttendanceReportContent />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
