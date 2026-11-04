import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { SettingsTabs } from "./settings-tabs";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>
          </div>
          <SettingsTabs />
          {children}
    </main>
  );
}
