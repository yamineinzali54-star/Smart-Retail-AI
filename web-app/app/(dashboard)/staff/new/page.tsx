"use client"
import { LocalizedSelect } from "@/components/ui/localized-select"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Branch {
  id: string
  name: string
  code: string
}

export default function NewStaffPage() {
  const router = useRouter()
  const [branches, setBranches] = useState<Branch[]>([])
  const [userName, setUserName] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState("cashier")
  const [branchId, setBranchId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch("/api/admin/branches?pageSize=100")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setBranches(d.branches)
          if (d.branches.length > 0) setBranchId(d.branches[0].id)
        }
      })
      .catch(() => undefined)
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userName, password, fullName, role, branchId }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || "Create failed")
        return
      }
      router.push("/staff")
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell title="New staff" allow={["admin"]}>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Create user</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                required
                minLength={3}
                maxLength={50}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fullname">Full name</Label>
              <Input
                id="fullname"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Password (min 8 chars)</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role">Role</Label>
              <LocalizedSelect
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
              >
                <option value="admin">admin</option>
                <option value="inventory">inventory</option>
                <option value="cashier">cashier</option>
              </LocalizedSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="branch">Branch</Label>
              <LocalizedSelect
                id="branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                required
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </LocalizedSelect>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </PageShell>
  )
}
