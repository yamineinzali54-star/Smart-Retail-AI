import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth"
import { CasherDashboard } from "@/components/dashboards/CasherDashboard"

export default async function Page() {
  const session = await getSession()
  if (!session) redirect("/login")

  if (session.user.role !== "cashier" && session.user.role !== "admin") {
    redirect("/dashboard")
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
      <CasherDashboard session={null} />
    </div>
  )
}
