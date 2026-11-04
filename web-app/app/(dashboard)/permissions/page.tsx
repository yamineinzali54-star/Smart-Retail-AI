"use client"

import { useEffect, useState } from "react"

import { PageShell } from "@/components/page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const ROLES = ["admin", "inventory", "cashier"]

export default function PermissionsPage() {
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>(
    {}
  )
  const [keys, setKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function load() {
    const res = await fetch("/api/admin/permissions")
    const data = await res.json()
    if (data.ok) {
      setMatrix(data.permissions)
      setKeys(data.actionKeys)
    } else {
      setError(data.error || "Failed to load")
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load())
  }, [])

  async function toggle(role: string, actionKey: string, current: boolean) {
    setMessage(null)
    const res = await fetch("/api/admin/permissions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, actionKey, isAllowed: !current }),
    })
    const data = await res.json()
    if (!data.ok) setMessage(data.error || "Update failed")
    else void load()
  }

  return (
    <PageShell
      title="Permissions"
      subtitle="Per-role overrides — admin is always allowed"
      allow={["admin"]}
    >
      <Card>
        <CardHeader>
          <CardTitle>Approval matrix</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                {ROLES.map((r) => (
                  <TableHead key={r}>{r}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k}>
                  <TableCell className="font-mono text-xs">{k}</TableCell>
                  {ROLES.map((r) => (
                    <TableCell key={r}>
                      <input
                        type="checkbox"
                        checked={matrix[k]?.[r] ?? false}
                        disabled={r === "admin"}
                        onChange={() =>
                          void toggle(r, k, matrix[k]?.[r] ?? false)
                        }
                        aria-label={`${k} for ${r}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageShell>
  )
}
