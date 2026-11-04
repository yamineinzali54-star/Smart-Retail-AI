"use client"

import * as React from "react"

import { useI18n } from "@/lib/i18n"
import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  RiDashboardLine,
  RiListUnordered,
  RiBarChartLine,
  RiStoreLine,
  RiShoppingCartLine,
  RiMoneyDollarCircleLine,
  RiSettingsLine,
  RiCalendarLine,
  RiDatabase2Line,
  RiFileChartLine,
  RiFileLine,
  RiCommandLine,
  RiTeamLine,
  RiTruckLine,
  RiShieldLine,
  RiDownloadLine,
  RiKeyLine,
  RiNotificationLine,
  RiBookLine,
  RiTimeLine,
  RiArchiveLine,
} from "@remixicon/react"

interface NavItem {
  title: string
  url: string
  icon: React.ReactNode
}

interface NavDocumentItem {
  name: string
  url: string
  icon: React.ReactNode
}

interface AppSidebarProps {
  role: "admin" | "inventory" | "cashier"
  userName: string
  userRole: string
}

export function AppSidebar({ role, userName, userRole }: AppSidebarProps) {
  const { t } = useI18n()

  const adminMain: NavItem[] = [
    { title: t("nav.dashboard"), url: "/dashboard", icon: <RiDashboardLine /> },
    { title: t("nav.pos"), url: "/pos/terminal", icon: <RiShoppingCartLine /> },
    { title: t("nav.stock"), url: "/stock", icon: <RiStoreLine /> },
    { title: t("nav.expiry"), url: "/expiry", icon: <RiCalendarLine /> },
    {
      title: t("nav.purchaseOrders"),
      url: "/purchase-orders",
      icon: <RiTruckLine />,
    },
    { title: t("nav.grn"), url: "/grn", icon: <RiDownloadLine /> },
    {
      title: t("nav.groundBalance"),
      url: "/ground-balance",
      icon: <RiDatabase2Line />,
    },
    {
      title: t("nav.transfers"),
      url: "/stock-transfers",
      icon: <RiListUnordered />,
    },
    {
      title: t("nav.adjustments"),
      url: "/stock-adjustments",
      icon: <RiListUnordered />,
    },
    {
      title: t("nav.supplierReturns"),
      url: "/supplier-returns",
      icon: <RiShieldLine />,
    },
    {
      title: t("nav.saleReturns"),
      url: "/sale-returns",
      icon: <RiMoneyDollarCircleLine />,
    },
    { title: t("nav.suppliers"), url: "/suppliers", icon: <RiTruckLine /> },
    { title: t("nav.products"), url: "/products", icon: <RiStoreLine /> },
    {
      title: t("nav.categories"),
      url: "/categories",
      icon: <RiListUnordered />,
    },
    { title: t("nav.units"), url: "/units", icon: <RiListUnordered /> },
    { title: t("nav.staff"), url: "/staff", icon: <RiTeamLine /> },
    { title: t("nav.branches"), url: "/branches", icon: <RiStoreLine /> },
    {
      title: t("nav.counters"),
      url: "/counters",
      icon: <RiShoppingCartLine />,
    },
    { title: t("nav.cron"), url: "/cron", icon: <RiCalendarLine /> },
    {
      title: t("nav.telegram"),
      url: "/telegram",
      icon: <RiNotificationLine />,
    },
  ]

  const inventoryMain: NavItem[] = [
    { title: t("nav.dashboard"), url: "/dashboard", icon: <RiDashboardLine /> },
    { title: t("nav.stock"), url: "/stock", icon: <RiStoreLine /> },
    { title: t("nav.expiry"), url: "/expiry", icon: <RiCalendarLine /> },
    {
      title: t("nav.purchaseOrders"),
      url: "/purchase-orders",
      icon: <RiTruckLine />,
    },
    { title: t("nav.grn"), url: "/grn", icon: <RiDownloadLine /> },
    {
      title: t("nav.groundBalance"),
      url: "/ground-balance",
      icon: <RiDatabase2Line />,
    },
    {
      title: t("nav.transfers"),
      url: "/stock-transfers",
      icon: <RiListUnordered />,
    },
    {
      title: t("nav.adjustments"),
      url: "/stock-adjustments",
      icon: <RiListUnordered />,
    },
    {
      title: t("nav.supplierReturns"),
      url: "/supplier-returns",
      icon: <RiShieldLine />,
    },
    { title: t("nav.products"), url: "/products", icon: <RiStoreLine /> },
    {
      title: t("nav.categories"),
      url: "/categories",
      icon: <RiListUnordered />,
    },
    { title: t("nav.units"), url: "/units", icon: <RiListUnordered /> },
    { title: t("nav.suppliers"), url: "/suppliers", icon: <RiTruckLine /> },
  ]

  const casherMain: NavItem[] = [
    { title: t("nav.pos"), url: "/pos/terminal", icon: <RiShoppingCartLine /> },
    {
      title: `${t("nav.saleReturns")} +`,
      url: "/pos/sale-returns/new",
      icon: <RiShieldLine />,
    },
    {
      title: t("nav.todaySales"),
      url: "/pos/today-sales",
      icon: <RiFileLine />,
    },
    {
      title: t("nav.handover"),
      url: "/pos/handover",
      icon: <RiCalendarLine />,
    },
    {
      title: t("nav.endSession"),
      url: "/pos/end-session",
      icon: <RiTimeLine />,
    },
  ]

  const adminReports: NavDocumentItem[] = [
    {
      name: t("nav.reports"),
      url: "/reports/sales",
      icon: <RiFileChartLine />,
    },
    { name: t("nav.tax"), url: "/reports/tax", icon: <RiFileLine /> },
    {
      name: t("nav.profitLoss"),
      url: "/reports/profit-loss",
      icon: <RiBarChartLine />,
    },
    {
      name: t("nav.zReport"),
      url: "/reports/z-report",
      icon: <RiFileChartLine />,
    },
    {
      name: t("nav.cashierPerf"),
      url: "/reports/cashier-performance",
      icon: <RiBarChartLine />,
    },
    {
      name: t("nav.hourlySales"),
      url: "/reports/hourly-sales",
      icon: <RiBarChartLine />,
    },
    {
      name: t("nav.inventoryAbc"),
      url: "/reports/inventory-abc",
      icon: <RiBarChartLine />,
    },
    {
      name: t("nav.inventoryAging"),
      url: "/reports/inventory-aging",
      icon: <RiArchiveLine />,
    },
  ]

  const adminFinance: NavDocumentItem[] = [
    {
      name: t("nav.expenses"),
      url: "/expenses",
      icon: <RiMoneyDollarCircleLine />,
    },
    { name: t("nav.glAccounts"), url: "/gl/accounts", icon: <RiFileLine /> },
    {
      name: t("nav.manualJournals"),
      url: "/gl/manual-journals",
      icon: <RiBookLine />,
    },
    {
      name: t("nav.trialBalance"),
      url: "/gl/trial-balance",
      icon: <RiBarChartLine />,
    },
    {
      name: t("nav.pettyCash"),
      url: "/petty-cash",
      icon: <RiMoneyDollarCircleLine />,
    },
    {
      name: t("nav.expenseBudget"),
      url: "/reports/expense-budget",
      icon: <RiMoneyDollarCircleLine />,
    },
  ]

  const adminSystem: NavDocumentItem[] = [
    { name: t("nav.auditLogs"), url: "/audit-logs", icon: <RiFileLine /> },
    { name: t("nav.permissions"), url: "/permissions", icon: <RiKeyLine /> },
    { name: t("nav.aiModels"), url: "/ai-models", icon: <RiCommandLine /> },
    { name: t("nav.backup"), url: "/backup", icon: <RiDatabase2Line /> },
  ]

  const adminAiReports: NavDocumentItem[] = [
    {
      name: t("nav.demandForecast"),
      url: "/ai/demand-forecasting",
      icon: <RiBarChartLine />,
    },
    {
      name: t("nav.revenueForecast"),
      url: "/ai/revenue-forecasting",
      icon: <RiMoneyDollarCircleLine />,
    },
    { name: t("nav.basket"), url: "/ai/basket", icon: <RiShoppingCartLine /> },
    {
      name: t("nav.opsAlerts"),
      url: "/ai/alerts",
      icon: <RiNotificationLine />,
    },
    {
      name: t("nav.marginWatch"),
      url: "/ai/margin-watch",
      icon: <RiMoneyDollarCircleLine />,
    },
  ]

  // PROJECT_PLAN.md §2: inventory sees master-data + purchasing + stock flows
  // only. Financial/admin surfaces (reports, GL, audit, permissions,
  // backup) are admin-only.
  const inventoryDocs: NavDocumentItem[] = [
    {
      name: t("nav.demandForecast"),
      url: "/ai/demand-forecasting",
      icon: <RiBarChartLine />,
    },
    {
      name: t("nav.revenueForecast"),
      url: "/ai/revenue-forecasting",
      icon: <RiMoneyDollarCircleLine />,
    },
    { name: t("nav.basket"), url: "/ai/basket", icon: <RiShoppingCartLine /> },
    {
      name: t("nav.opsAlerts"),
      url: "/ai/alerts",
      icon: <RiNotificationLine />,
    },
    {
      name: t("nav.marginWatch"),
      url: "/ai/margin-watch",
      icon: <RiMoneyDollarCircleLine />,
    },
  ]

  const reportsDocuments =
    role === "admin" ? adminReports : role === "inventory" ? inventoryDocs : []
  const financeDocuments = role === "admin" ? adminFinance : []
  const systemDocuments = role === "admin" ? adminSystem : []
  const aiDocuments = role === "admin" ? adminAiReports : []
  const aiChat: NavItem = {
    title: t("nav.aiChat"),
    url: "/ai/chat",
    icon: <RiCommandLine />,
  }
  const adminSections = [
    { label: "Overview", items: [adminMain[0], aiChat] },
    {
      label: "Sales",
      items: adminMain.filter((item) =>
        ["/pos/terminal", "/sale-returns"].includes(item.url)
      ),
    },
    {
      label: "Catalog",
      items: adminMain.filter((item) =>
        ["/products", "/categories", "/units"].includes(item.url)
      ),
    },
    {
      label: "Purchasing",
      items: adminMain.filter((item) =>
        [
          "/suppliers",
          "/purchase-orders",
          "/grn",
          "/supplier-returns",
        ].includes(item.url)
      ),
    },
    {
      label: "Inventory",
      items: adminMain.filter((item) =>
        [
          "/stock",
          "/expiry",
          "/stock-transfers",
          "/stock-adjustments",
          "/ground-balance",
        ].includes(item.url)
      ),
    },
    {
      label: "Administration",
      items: adminMain.filter((item) =>
        ["/staff", "/branches", "/counters", "/cron", "/telegram"].includes(
          item.url
        )
      ),
    },
  ]
  const inventorySections = [
    { label: "Overview", items: [inventoryMain[0], aiChat] },
    {
      label: "Catalog",
      items: inventoryMain.filter((item) =>
        ["/products", "/categories", "/units"].includes(item.url)
      ),
    },
    {
      label: "Purchasing",
      items: inventoryMain.filter((item) =>
        [
          "/suppliers",
          "/purchase-orders",
          "/grn",
          "/supplier-returns",
        ].includes(item.url)
      ),
    },
    {
      label: "Inventory",
      items: inventoryMain.filter((item) =>
        [
          "/stock",
          "/expiry",
          "/stock-transfers",
          "/stock-adjustments",
          "/ground-balance",
        ].includes(item.url)
      ),
    },
  ]
  const casherSections = [
    {
      label: "Sales",
      items: casherMain.filter((item) =>
        ["/pos/terminal", "/pos/sale-returns/new", "/pos/today-sales"].includes(
          item.url
        )
      ),
    },
    {
      label: "Cash",
      items: casherMain.filter((item) =>
        ["/pos/handover", "/pos/end-session"].includes(item.url)
      ),
    },
  ]
  const navSections =
    role === "admin"
      ? adminSections
      : role === "inventory"
        ? inventorySections
        : casherSections
  const navSecondary: NavItem[] = [
    {
      title: t("nav.notifications"),
      url: "/notifications",
      icon: <RiNotificationLine />,
    },
    {
      title: t("nav.settings"),
      url: "/settings/profile",
      icon: <RiSettingsLine />,
    },
  ]

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="flex h-12 min-h-12 justify-center border-b border-sidebar-border px-3 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="data-[slot=sidebar-menu-button]:p-1.5!">
              <RiCommandLine className="size-5!" />
              <span className="font-heading text-base font-semibold tracking-tight">
                SmartRetailAI
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain sections={navSections} />
        {reportsDocuments.length > 0 && (
          <NavDocuments
            items={reportsDocuments}
            label={role === "admin" ? "Reports" : "Tools"}
          />
        )}
        {financeDocuments.length > 0 && (
          <NavDocuments items={financeDocuments} label="Finance" />
        )}
        {systemDocuments.length > 0 && (
          <NavDocuments
            items={systemDocuments}
            label={t("nav.systemSecurity")}
          />
        )}
        {aiDocuments.length > 0 && (
          <NavDocuments items={aiDocuments} label="AI Reports" />
        )}
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ name: userName, email: userRole, avatar: "" }} />
      </SidebarFooter>
    </Sidebar>
  )
}
