import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
  modal: React.ReactNode;
}

export default async function DashboardLayout({ children, modal }: DashboardLayoutProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <SidebarProvider>
      <AppSidebar role={session.user.role} userName={session.user.userName} userRole={session.user.role} />
      <SidebarInset>
        <SiteHeader />
        {children}
        {modal}
      </SidebarInset>
    </SidebarProvider>
  );
}
