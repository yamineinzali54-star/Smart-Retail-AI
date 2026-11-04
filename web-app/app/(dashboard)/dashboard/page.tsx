import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth"

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect("/login")

  if (session.user.role === "admin") redirect("/admin")
  if (session.user.role === "inventory") redirect("/inventory")
  if (session.user.role === "cashier") redirect("/pos")

  redirect("/login")
}
