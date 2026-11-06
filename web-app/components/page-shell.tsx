"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { PageLoading } from "@/components/page-loading"
import { translateDisplayText, useI18n } from "@/lib/i18n"

export interface PageSession {
  user: {
    id: string
    userName: string
    role: "admin" | "inventory" | "cashier"
    branchId: string
  }
}

export function usePageSession() {
  const [session, setSession] = useState<PageSession | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setSession(d.session)
        else setFailed(true)
      })
      .catch(() => setFailed(true))
  }, [])
  return { session, failed }
}

type Role = "admin" | "inventory" | "cashier"

// Central UI guard map (PROJECT_PLAN.md §2). A page-level `allow` prop always
// wins when present; otherwise the longest matching prefix below decides which
// roles may VIEW the page. This is UI hardening only — every API route enforces
// the real authorization server-side, so a stale/missing entry here can never
// grant data access, only show or hide chrome.
const DEFAULT_ALLOW_BY_PREFIX: Array<{ prefix: string; allow: Role[] }> = [
  // Admin-only: finance, staff, infra, oversight.
  { prefix: "/promotions", allow: ["admin"] },
  { prefix: "/expenses", allow: ["admin"] },
  { prefix: "/staff", allow: ["admin"] },
  { prefix: "/branches", allow: ["admin"] },
  { prefix: "/counters", allow: ["admin"] },
  { prefix: "/gl", allow: ["admin"] },
  { prefix: "/petty-cash", allow: ["admin"] },
  { prefix: "/permissions", allow: ["admin"] },
  { prefix: "/audit-logs", allow: ["admin"] },
  { prefix: "/backup", allow: ["admin"] },
  { prefix: "/cron", allow: ["admin"] },
  { prefix: "/telegram", allow: ["admin"] },
  { prefix: "/reports", allow: ["admin"] },
  { prefix: "/admin", allow: ["admin"] },
  { prefix: "/ai-models", allow: ["admin"] },
  // Admin + inventory: master data, purchasing, stock flows, AR/AP visibility.
  { prefix: "/ai", allow: ["admin", "inventory"] },
  { prefix: "/stock-adjustments", allow: ["admin", "inventory"] },
  { prefix: "/stock-transfers", allow: ["admin", "inventory"] },
  { prefix: "/stock", allow: ["admin", "inventory"] },
  { prefix: "/supplier-returns", allow: ["admin", "inventory"] },
  { prefix: "/purchase-orders", allow: ["admin", "inventory"] },
  { prefix: "/grn", allow: ["admin", "inventory"] },
  { prefix: "/ground-balance", allow: ["admin", "inventory"] },
  { prefix: "/expiry", allow: ["admin", "inventory"] },
  { prefix: "/products", allow: ["admin", "inventory"] },
  { prefix: "/categories", allow: ["admin", "inventory"] },
  { prefix: "/units", allow: ["admin", "inventory"] },
  { prefix: "/suppliers", allow: ["admin", "inventory"] },
  // Admin + cashier: POS workspace and own-session returns.
  { prefix: "/pos", allow: ["admin", "cashier"] },
  { prefix: "/sale-returns", allow: ["admin", "cashier"] },
]

function defaultAllowFor(pathname: string | null): Role[] | undefined {
  if (!pathname) return undefined
  let best: { prefix: string; allow: Role[] } | undefined
  for (const entry of DEFAULT_ALLOW_BY_PREFIX) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry
    }
  }
  return best?.allow
}

interface PageShellProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  allow?: Array<"admin" | "inventory" | "cashier">
  children: ReactNode
}

export function PageShell({
  title,
  subtitle,
  actions,
  allow,
  children,
}: PageShellProps) {
  const { session, failed } = usePageSession()
  const { locale } = useI18n()
  const pathname = usePathname()
  const effectiveAllow = allow ?? defaultAllowFor(pathname)

  if (failed) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Session expired.{" "}
          <Link href="/login" className="text-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    )
  }

  if (!session) {
    return <PageLoading />
  }

  if (effectiveAllow && !effectiveAllow.includes(session.user.role)) {
    return (
      <div className="p-6">
        <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Forbidden: this page requires {effectiveAllow.join(" or ")}.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-medium tracking-[0.18em] text-primary uppercase">
            SmartRetailAI
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {translateDisplayText(locale, title)}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">
              {translateDisplayText(locale, subtitle)}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
