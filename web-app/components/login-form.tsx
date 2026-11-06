"use client"

import { cn } from "cn"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

interface LoginFormProps {
  className?: string
}

export function LoginForm({ className, ...props }: LoginFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userName, setUserName] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [pin, setPin] = useState("")
  const [pinMode, setPinMode] = useState(false)
  const [totpCode, setTotpCode] = useState("")
  const [needCode, setNeedCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function goHome(role?: string) {
    // Same-origin paths only: reject absolute (https://…) and
    // protocol-relative (//host or /\host) values so a crafted ?next=
    // cannot bounce a fresh session off-site (open-redirect / phishing).
    const rawNext = searchParams.get("next")
    const requestedPath =
      rawNext?.startsWith("/") &&
      !rawNext.startsWith("//") &&
      !rawNext.startsWith("/\\")
        ? rawNext
        : null
    const roleHome =
      role === "admin"
        ? "/admin"
        : role === "inventory"
          ? "/inventory"
          : role === "cashier"
            ? "/pos"
            : "/dashboard"
    const destination =
      requestedPath === "/dashboard/admin"
        ? "/admin"
        : requestedPath === "/dashboard/inventory"
          ? "/inventory"
          : requestedPath === "/dashboard/cashier"
            ? "/pos"
            : requestedPath &&
                requestedPath !== "/" &&
                requestedPath !== "/dashboard"
              ? requestedPath
              : roleHome
    router.push(destination)
    router.refresh()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          pinMode
            ? { userName, pin }
            : {
                userName,
                password,
                totpCode: needCode ? totpCode : undefined,
              }
        ),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) {
        goHome(data.user?.role)
        return
      }
      if (res.status === 401 && data?.error === "TOTP_REQUIRED") {
        setNeedCode(true)
        setError(null)
        return
      }
      setError(errorMessage(res.status, data?.error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="mb-2 text-center">
        <p className="mb-3 text-xs font-medium tracking-[0.24em] text-primary uppercase">
          SmartRetailAI
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          Welcome back
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to continue to your workspace.
        </p>
      </div>
      <Card className="border border-border shadow-xl shadow-foreground/5">
        <CardHeader className="space-y-1 border-b border-border pb-5">
          <CardTitle className="text-base font-semibold">Sign in</CardTitle>
          <CardDescription>
            Use your account credentials to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <FieldGroup>
              <Field className="gap-2">
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  autoComplete="username"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your username"
                  required
                  disabled={busy}
                />
              </Field>
              {pinMode ? (
                <Field className="gap-2">
                  <FieldLabel htmlFor="pin">
                    Cashier PIN (4–6 digits)
                  </FieldLabel>
                  <Input
                    id="pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="••••"
                    required
                    minLength={4}
                    maxLength={6}
                    disabled={busy}
                  />
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="pr-10"
                      required
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      aria-pressed={showPassword}
                      disabled={busy}
                    >
                      {showPassword ? (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="size-4"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9.9 5.2A10.7 10.7 0 0112 5c5 0 8.3 4.5 9 6-.3.7-1.2 2-2.7 3.3M6.2 6.2C4.2 7.5 2.6 9.6 2 11c.7 1.5 4 6 10 6 1 0 2-.2 2.8-.5"
                          />
                        </svg>
                      ) : (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="size-4"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"
                          />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </Field>
              )}
              <Field className="gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  disabled={busy}
                  onClick={() => {
                    setPinMode((m) => !m)
                    setError(null)
                    setNeedCode(false)
                  }}
                >
                  {pinMode
                    ? "Use password instead"
                    : "Cashier? Use PIN instead"}
                </Button>
              </Field>
              {needCode && (
                <Field className="gap-2">
                  <FieldLabel htmlFor="totpCode">Authenticator code</FieldLabel>
                  <Input
                    id="totpCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="6-digit code"
                    required
                    disabled={busy}
                  />
                </Field>
              )}
              <Field className="gap-2">
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
          {error && (
            <p
              className="mt-4 border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function errorMessage(status: number, code: string | undefined): string {
  if (status === 429)
    return "Too many failed attempts — try again in 15 minutes."
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Invalid username, password, or authenticator code."
    case "VALIDATION_ERROR":
      return "Please fill in all required fields."
    default:
      return "Sign-in failed. Please try again."
  }
}
