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
  Archive,
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  CalendarClock,
  Clock,
  Database,
  Download,
  FileBarChart,
  FileText,
  KeyRound,
  LayoutDashboard,
  Layers,
  List,
  Package,
  Settings,
  Shield,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Truck,
  Undo2,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react"

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
    { title: t("nav.dashboard"), url: "/dashboard", icon: <LayoutDashboard /> },
    { title: t("nav.pos"), url: "/pos/terminal", icon: <ShoppingCart /> },
    { title: t("nav.stock"), url: "/stock", icon: <Warehouse /> },
    { title: t("nav.expiry"), url: "/expiry", icon: <CalendarClock /> },
    {
      title: t("nav.purchaseOrders"),
      url: "/purchase-orders",
      icon: <Truck />,
    },
    { title: t("nav.grn"), url: "/grn", icon: <Download /> },
    {
      title: t("nav.groundBalance"),
      url: "/ground-balance",
      icon: <Database />,
    },
    {
      title: t("nav.transfers"),
      url: "/stock-transfers",
      icon: <ArrowLeftRight />,
    },
    {
      title: t("nav.adjustments"),
      url: "/stock-adjustments",
      icon: <SlidersHorizontal />,
    },
    {
      title: t("nav.supplierReturns"),
      url: "/supplier-returns",
      icon: <Shield />,
    },
    {
      title: t("nav.saleReturns"),
      url: "/sale-returns",
      icon: <Undo2 />,
    },
    { title: t("nav.suppliers"), url: "/suppliers", icon: <Truck /> },
    { title: t("nav.products"), url: "/products", icon: <Package /> },
    {
      title: t("nav.categories"),
      url: "/categories",
      icon: <Layers />,
    },
    { title: t("nav.units"), url: "/units", icon: <List /> },
    { title: t("nav.staff"), url: "/staff", icon: <Users /> },
    { title: t("nav.branches"), url: "/branches", icon: <Store /> },
    {
      title: t("nav.counters"),
      url: "/counters",
      icon: <ShoppingCart />,
    },
    { title: t("nav.cron"), url: "/cron", icon: <CalendarClock /> },
    {
      title: t("nav.telegram"),
      url: "/telegram",
      icon: <Bell />,
    },
  ]

  const inventoryMain: NavItem[] = [
    { title: t("nav.dashboard"), url: "/dashboard", icon: <LayoutDashboard /> },
    { title: t("nav.stock"), url: "/stock", icon: <Warehouse /> },
    { title: t("nav.expiry"), url: "/expiry", icon: <CalendarClock /> },
    {
      title: t("nav.purchaseOrders"),
      url: "/purchase-orders",
      icon: <Truck />,
    },
    { title: t("nav.grn"), url: "/grn", icon: <Download /> },
    {
      title: t("nav.groundBalance"),
      url: "/ground-balance",
      icon: <Database />,
    },
    {
      title: t("nav.transfers"),
      url: "/stock-transfers",
      icon: <ArrowLeftRight />,
    },
    {
      title: t("nav.adjustments"),
      url: "/stock-adjustments",
      icon: <SlidersHorizontal />,
    },
    {
      title: t("nav.supplierReturns"),
      url: "/supplier-returns",
      icon: <Shield />,
    },
    { title: t("nav.products"), url: "/products", icon: <Package /> },
    {
      title: t("nav.categories"),
      url: "/categories",
      icon: <Layers />,
    },
    { title: t("nav.units"), url: "/units", icon: <List /> },
    { title: t("nav.suppliers"), url: "/suppliers", icon: <Truck /> },
  ]

  const casherMain: NavItem[] = [
    { title: t("nav.pos"), url: "/pos/terminal", icon: <ShoppingCart /> },
    {
      title: `${t("nav.saleReturns")} +`,
      url: "/pos/sale-returns/new",
      icon: <Shield />,
    },
    {
      title: t("nav.todaySales"),
      url: "/pos/today-sales",
      icon: <FileText />,
    },
    {
      title: t("nav.handover"),
      url: "/pos/handover",
      icon: <CalendarClock />,
    },
    {
      title: t("nav.endSession"),
      url: "/pos/end-session",
      icon: <Clock />,
    },
  ]

  const adminReports: NavDocumentItem[] = [
    {
      name: t("nav.reports"),
      url: "/reports/sales",
      icon: <FileBarChart />,
    },
    { name: t("nav.tax"), url: "/reports/tax", icon: <FileText /> },
    {
      name: t("nav.profitLoss"),
      url: "/reports/profit-loss",
      icon: <BarChart3 />,
    },
    {
      name: t("nav.zReport"),
      url: "/reports/z-report",
      icon: <FileBarChart />,
    },
    {
      name: t("nav.cashierPerf"),
      url: "/reports/cashier-performance",
      icon: <BarChart3 />,
    },
    {
      name: t("nav.hourlySales"),
      url: "/reports/hourly-sales",
      icon: <BarChart3 />,
    },
    {
      name: t("nav.inventoryAbc"),
      url: "/reports/inventory-abc",
      icon: <BarChart3 />,
    },
    {
      name: t("nav.inventoryAging"),
      url: "/reports/inventory-aging",
      icon: <Archive />,
    },
  ]

  const adminFinance: NavDocumentItem[] = [
    {
      name: t("nav.expenses"),
      url: "/expenses",
      icon: <Wallet />,
    },
    { name: t("nav.glAccounts"), url: "/gl/accounts", icon: <FileText /> },
    {
      name: t("nav.manualJournals"),
      url: "/gl/manual-journals",
      icon: <BookOpen />,
    },
    {
      name: t("nav.trialBalance"),
      url: "/gl/trial-balance",
      icon: <BarChart3 />,
    },
    {
      name: t("nav.pettyCash"),
      url: "/petty-cash",
      icon: <Wallet />,
    },
    {
      name: t("nav.expenseBudget"),
      url: "/reports/expense-budget",
      icon: <Wallet />,
    },
  ]

  const adminSystem: NavDocumentItem[] = [
    { name: t("nav.auditLogs"), url: "/audit-logs", icon: <FileText /> },
    { name: t("nav.permissions"), url: "/permissions", icon: <KeyRound /> },
    { name: t("nav.aiModels"), url: "/ai-models", icon: <Bot /> },
    { name: t("nav.backup"), url: "/backup", icon: <Database /> },
  ]

  const adminAiReports: NavDocumentItem[] = [
    {
      name: t("nav.demandForecast"),
      url: "/ai/demand-forecasting",
      icon: <BarChart3 />,
    },
    {
      name: t("nav.revenueForecast"),
      url: "/ai/revenue-forecasting",
      icon: <Wallet />,
    },
    { name: t("nav.basket"), url: "/ai/basket", icon: <ShoppingCart /> },
    {
      name: t("nav.opsAlerts"),
      url: "/ai/alerts",
      icon: <Bell />,
    },
    {
      name: t("nav.marginWatch"),
      url: "/ai/margin-watch",
      icon: <Wallet />,
    },
  ]

  // PROJECT_PLAN.md §2: inventory sees master-data + purchasing + stock flows
  // only. Financial/admin surfaces (reports, GL, audit, permissions,
  // backup) are admin-only.
  const inventoryDocs: NavDocumentItem[] = [
    {
      name: t("nav.demandForecast"),
      url: "/ai/demand-forecasting",
      icon: <BarChart3 />,
    },
    {
      name: t("nav.revenueForecast"),
      url: "/ai/revenue-forecasting",
      icon: <Wallet />,
    },
    { name: t("nav.basket"), url: "/ai/basket", icon: <ShoppingCart /> },
    {
      name: t("nav.opsAlerts"),
      url: "/ai/alerts",
      icon: <Bell />,
    },
    {
      name: t("nav.marginWatch"),
      url: "/ai/margin-watch",
      icon: <Wallet />,
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
    icon: <Bot />,
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
      icon: <Bell />,
    },
    {
      title: t("nav.settings"),
      url: "/settings/profile",
      icon: <Settings />,
    },
  ]

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="flex min-h-16 justify-center border-b border-sidebar-border px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="h-auto data-[slot=sidebar-menu-button]:p-1.5!">
              <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-primary text-sm font-semibold text-white">
                S
              </span>
              <span className="font-heading text-[15px] font-semibold tracking-tight text-sidebar-foreground">
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
