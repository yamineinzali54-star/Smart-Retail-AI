import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { AdminDashboard } from "@/components/dashboards/AdminDashboard";
import BranchScopeCards from "@/components/branch-scope-cards";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
          <BranchScopeCards />
          <AdminDashboard />
    </div>
  );
}
