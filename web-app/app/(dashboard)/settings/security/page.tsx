import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import SecuritySettingsForm from "./security-settings-form";

export default async function SecuritySettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Security settings</h1>
        <p className="text-muted-foreground">
          Manage your password and two-factor authentication
        </p>
      </div>
      <SecuritySettingsForm
        userName={session.user.userName}
        hasTotp={false}
      />
    </div>
  );
}
