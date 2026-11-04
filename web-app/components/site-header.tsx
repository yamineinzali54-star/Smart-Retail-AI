"use client"

import { usePathname } from "next/navigation"

import BranchSwitcher from "@/components/branch-switcher"
import { LanguageToggle } from "@/components/language-provider"
import { ThemeToggle } from "@/components/theme-toggle"
import { useI18n, type I18nKey } from "@/lib/i18n"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// Longest-prefix match: section path → sidebar i18n key. Unmapped routes
// (e.g. /promotions, /gl/ledger) fall back to a humanized last segment.
const TITLE_BY_PREFIX: Array<{ prefix: string; key: I18nKey }> = [
  { prefix: "/dashboard", key: "nav.dashboard" },
  { prefix: "/admin", key: "nav.dashboard" },
  { prefix: "/pos/handover", key: "nav.handover" },
  { prefix: "/pos", key: "nav.pos" },
  { prefix: "/sale-returns", key: "nav.saleReturns" },
  { prefix: "/stock-adjustments", key: "nav.adjustments" },
  { prefix: "/stock-transfers", key: "nav.transfers" },
  { prefix: "/stock", key: "nav.stock" },
  { prefix: "/supplier-returns", key: "nav.supplierReturns" },
  { prefix: "/purchase-orders", key: "nav.purchaseOrders" },
  { prefix: "/grn", key: "nav.grn" },
  { prefix: "/ground-balance", key: "nav.groundBalance" },
  { prefix: "/expiry", key: "nav.expiry" },
  { prefix: "/expenses", key: "nav.expenses" },
  { prefix: "/suppliers", key: "nav.suppliers" },
  { prefix: "/products", key: "nav.products" },
  { prefix: "/categories", key: "nav.categories" },
  { prefix: "/units", key: "nav.units" },
  { prefix: "/staff", key: "nav.staff" },
  { prefix: "/branches", key: "nav.branches" },
  { prefix: "/counters", key: "nav.counters" },
  { prefix: "/cron", key: "nav.cron" },
  { prefix: "/reports/tax", key: "nav.tax" },
  { prefix: "/reports/profit-loss", key: "nav.profitLoss" },
  { prefix: "/reports/z-report", key: "nav.zReport" },
  { prefix: "/reports/cashier-performance", key: "nav.cashierPerf" },
  { prefix: "/reports/hourly-sales", key: "nav.hourlySales" },
  { prefix: "/reports/inventory-abc", key: "nav.inventoryAbc" },
  { prefix: "/reports/inventory-aging", key: "nav.inventoryAging" },
  { prefix: "/reports", key: "nav.reports" },
  { prefix: "/gl/accounts", key: "nav.glAccounts" },
  { prefix: "/gl/manual-journals", key: "nav.manualJournals" },
  { prefix: "/gl/trial-balance", key: "nav.trialBalance" },
  { prefix: "/petty-cash", key: "nav.pettyCash" },
  { prefix: "/audit-logs", key: "nav.auditLogs" },
  { prefix: "/permissions", key: "nav.permissions" },
  { prefix: "/backup", key: "nav.backup" },
  { prefix: "/notifications", key: "nav.notifications" },
  { prefix: "/settings", key: "nav.settings" },
  { prefix: "/my-profile", key: "nav.settings" },
]

function humanize(segment: string): string {
  return segment
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

function titleFor(
  pathname: string | null,
  t: (key: I18nKey) => string
): string {
  if (!pathname) return ""
  let best: { prefix: string; key: I18nKey } | undefined
  for (const entry of TITLE_BY_PREFIX) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry
    }
  }
  if (best) return t(best.key)
  const last = pathname.split("/").filter(Boolean).pop()
  return last ? humanize(last) : ""
}

export function SiteHeader() {
  const pathname = usePathname()
  const { t } = useI18n()

  return (
    <header className="sticky top-0 z-20 flex h-12 min-h-12 shrink-0 items-center gap-2 border-b border-border bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-8">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="font-heading text-sm font-semibold tracking-tight sm:text-base">{titleFor(pathname, t)}</h1>
        <div className="ml-auto flex items-center gap-2">
          <BranchSwitcher />
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
